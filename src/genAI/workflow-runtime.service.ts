import {
  BadRequestException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { chat, conversations } from './dto/chatDto';
import { SonarModelChat } from './genAI.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { WorkflowService } from '../workflows/workflow.service';
import { WorkflowEdge, WorkflowNode } from '../workflows/workflow.types';

type NodeOutput = Record<string, unknown>;

type WorkflowTrace = {
  nodeName: string;
  nodeType: string;
  status: 'completed';
  durationMs: number;
  output: NodeOutput;
};

@Injectable()
export class WorkflowRuntimeService {
  constructor(
    private readonly workflows: WorkflowService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly modelChat: SonarModelChat,
  ) {}

  async run(body: chat) {
    if (!body.workflowName?.trim())
      throw new BadRequestException('workflowName is required');
    if (!Array.isArray(body.messages) || !body.messages.length)
      throw new BadRequestException('At least one chat message is required');

    const workflow = await this.workflows.findForExecution(
      body.workflowName,
      body.workflowOwnerId,
    );
    const order = this.topologicalOrder(workflow.nodes, workflow.edges);
    const startedAt = new Date();
    const outputs = new Map<string, NodeOutput>();
    const trace: WorkflowTrace[] = [];
    const citations: Array<{
      documentId: string;
      title?: string;
      excerpt: string;
      score: number;
    }> = [];

    for (const node of order) {
      const nodeStartedAt = Date.now();
      const output = await this.executeNode(
        node,
        outputs,
        body.messages,
        citations,
      );
      outputs.set(node.name, output);
      trace.push({
        nodeName: node.name,
        nodeType: node.type,
        status: 'completed',
        durationMs: Date.now() - nodeStartedAt,
        output,
      });
    }

    const final = this.selectFinalOutput(
      workflow.nodes,
      workflow.edges,
      outputs,
    );
    const completedAt = new Date();

    return {
      workflow: {
        workflowId: workflow.workflowId,
        name: workflow.name,
        version: workflow.version,
      },
      run: {
        runId: randomUUID(),
        status: 'completed',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
      response: {
        message: this.toMessage(final.value),
        finalNode: { name: final.node.name, type: final.node.type },
        outputs: final.outputs,
        citations: this.uniqueCitations(citations),
      },
      trace,
    };
  }

  private async executeNode(
    node: WorkflowNode,
    outputs: Map<string, NodeOutput>,
    messages: conversations[],
    citations: Array<{
      documentId: string;
      title?: string;
      excerpt: string;
      score: number;
    }>,
  ): Promise<NodeOutput> {
    if (node.type === 'input') {
      const latest = messages.at(-1)!;
      return { message: latest.content, conversation: messages };
    }

    if (node.type === 'agent') {
      if (node.agentType === 'sandbox_agent') {
        throw new NotImplementedException(
          `Sandbox agent ${node.name} cannot run yet`,
        );
      }
      if (!node.prompt)
        throw new BadRequestException(
          `Agent node ${node.name} needs a prompt to run`,
        );
      const prompt = this.resolveTemplate(node.prompt, outputs);
      const content = await this.modelChat.completeWorkflowPrompt({
        provider: node.provider,
        model: node.model,
        prompt: String(prompt),
        messages,
      });
      const parsed = this.parseJson(content);
      return {
        content,
        answer: typeof parsed?.answer === 'string' ? parsed.answer : content,
        ...(parsed || {}),
        agentType: node.agentType,
      };
    }

    if (node.type === 'tool') {
      if (node.tool === 'knowledge_base_search') {
        const input = this.resolveValue(node.input || {}, outputs) as {
          query?: unknown;
          topK?: unknown;
        };
        if (typeof input.query !== 'string' || !input.query.trim()) {
          throw new BadRequestException(
            `Tool node ${node.name} needs a resolved input.query string`,
          );
        }
        const topK =
          typeof input.topK === 'number' ? input.topK : Number(input.topK || 3);
        if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
          throw new BadRequestException(
            `Tool node ${node.name} input.topK must be an integer between 1 and 20`,
          );
        }
        const result = await this.knowledgeBase.search({
          query: input.query,
          topK,
        } as any);
        for (const item of result.results) {
          citations.push({
            documentId: item.doc_id,
            title: item.document?.title,
            excerpt: item.text,
            score: item.score,
          });
        }
        return result;
      }
      throw new NotImplementedException(`Tool ${node.tool} cannot run yet`);
    }

    if (node.type === 'condition') {
      throw new NotImplementedException(
        `Condition node ${node.name} cannot run yet`,
      );
    }

    if (node.type === 'output') {
      return { value: this.resolveValue(node.value || '', outputs) };
    }

    throw new BadRequestException(`Unsupported node type: ${node.type}`);
  }

  private topologicalOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    const byName = new Map(nodes.map((node) => [node.name, node]));
    const indegree = new Map(nodes.map((node) => [node.name, 0]));
    const outgoing = new Map(nodes.map((node) => [node.name, [] as string[]]));
    for (const edge of edges) {
      outgoing.get(edge.from)?.push(edge.to);
      indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
    }

    const ready = nodes
      .filter((node) => indegree.get(node.name) === 0)
      .map((node) => node.name);
    const order: WorkflowNode[] = [];
    while (ready.length) {
      const name = ready.shift()!;
      order.push(byName.get(name)!);
      for (const next of outgoing.get(name) || []) {
        const remaining = indegree.get(next)! - 1;
        indegree.set(next, remaining);
        if (remaining === 0) ready.push(next);
      }
    }
    if (order.length !== nodes.length)
      throw new BadRequestException('Workflow cannot be ordered for execution');
    return order;
  }

  /** An Output node is optional; a terminal agent is the natural chat response. */
  private selectFinalOutput(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    outputs: Map<string, NodeOutput>,
  ) {
    const nodesWithNoOutgoingEdges = new Set(nodes.map((node) => node.name));
    for (const edge of edges) nodesWithNoOutgoingEdges.delete(edge.from);
    const terminalNodes = nodes.filter((node) =>
      nodesWithNoOutgoingEdges.has(node.name),
    );
    const selected =
      terminalNodes.find((node) => node.type === 'output') ||
      terminalNodes.find((node) => node.type === 'agent') ||
      terminalNodes[0];
    if (!selected)
      throw new BadRequestException('Workflow has no terminal node');

    const terminalOutputs = Object.fromEntries(
      terminalNodes.map((node) => [node.name, outputs.get(node.name)]),
    );
    const rawOutput = outputs.get(selected.name) || {};
    const value =
      selected.type === 'output'
        ? rawOutput.value
        : (rawOutput.answer ?? rawOutput.content ?? rawOutput);
    return { node: selected, value, outputs: terminalOutputs };
  }

  private toMessage(value: unknown) {
    return typeof value === 'string' ? value : JSON.stringify(value ?? null);
  }

  private resolveValue(
    value: unknown,
    outputs: Map<string, NodeOutput>,
  ): unknown {
    if (typeof value === 'string') return this.resolveTemplate(value, outputs);
    if (Array.isArray(value))
      return value.map((item) => this.resolveValue(item, outputs));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.resolveValue(item, outputs),
        ]),
      );
    }
    return value;
  }

  private resolveTemplate(
    template: string,
    outputs: Map<string, NodeOutput>,
  ): unknown {
    const expression = /{{\s*([^}]+?)\s*}}/g;
    const exact = template.match(/^{{\s*([^}]+?)\s*}}$/);
    if (exact) return this.resolveReference(exact[1], outputs);
    return template.replace(expression, (_, reference: string) => {
      const value = this.resolveReference(reference, outputs);
      return typeof value === 'string' ? value : JSON.stringify(value ?? null);
    });
  }

  private resolveReference(
    reference: string,
    outputs: Map<string, NodeOutput>,
  ): unknown {
    const marker = '.output.';
    const markerIndex = reference.indexOf(marker);
    if (markerIndex < 1) return undefined;
    const nodeName = reference.slice(0, markerIndex).trim();
    const path = reference
      .slice(markerIndex + marker.length)
      .trim()
      .split('.');
    let value: unknown = outputs.get(nodeName);
    for (const key of path) {
      if (!value || typeof value !== 'object') return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  }

  private parseJson(content: string): Record<string, unknown> | undefined {
    const normalized = content
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    try {
      const value = JSON.parse(normalized);
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private uniqueCitations(
    citations: Array<{
      documentId: string;
      title?: string;
      excerpt: string;
      score: number;
    }>,
  ) {
    const seen = new Set<string>();
    return citations.filter((citation) => {
      const key = `${citation.documentId}\u0000${citation.excerpt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
