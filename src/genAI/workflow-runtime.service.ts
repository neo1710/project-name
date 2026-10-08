import {
  BadRequestException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { chat, conversations } from './dto/chatDto';
import { SonarModelChat } from './genAI.service';
import { SandboxService } from './sandbox.service';
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
    private readonly sandbox: SandboxService,
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
        workflow.edges,
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
    edges: WorkflowEdge[] = [],
  ): Promise<NodeOutput> {
    if (node.type === 'input') {
      const latest = messages.at(-1)!;
      return { message: latest.content, conversation: messages };
    }

    if (node.type === 'agent') {
      if (node.agentType === 'sandbox_agent') {
        return this.executeSandboxAgent(node, outputs, messages);
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
      const hasExplicitValue =
        typeof node.value === 'string' && node.value.trim().length > 0;

      const value = hasExplicitValue
        ? this.resolveValue(node.value!, outputs)
        : this.resolveFallbackOutput(node, outputs, edges);

      return { value };
    }

    throw new BadRequestException(`Unsupported node type: ${node.type}`);
  }

  private async executeSandboxAgent(
    node: WorkflowNode,
    outputs: Map<string, NodeOutput>,
    messages: conversations[],
  ): Promise<NodeOutput> {
    const rawAction =
      node.action ??
      (node.settings?.action as string | undefined) ??
      (node.input?.action as string | undefined);

    const rawParameters =
      node.parameters ??
      (node.settings?.parameters as Record<string, unknown> | undefined) ??
      (node.input?.parameters as Record<string, unknown> | undefined) ??
      (node.input as Record<string, unknown> | undefined) ??
      {};

    const explicitCode =
      node.code ??
      (node.settings?.code as string | undefined) ??
      (node.input?.code as string | undefined) ??
      (rawParameters?.code as string | undefined);

    let action = rawAction;
    if (!action && explicitCode) {
      action = 'execute_python';
    }

    const finalParams: Record<string, unknown> = { ...rawParameters };
    if (explicitCode && !finalParams.code) {
      finalParams.code = explicitCode;
    }

    // Case 1: Explicit action or explicit code is provided
    if (action) {
      const resolvedAction = String(
        this.resolveValue(action, outputs),
      ).trim();
      const resolvedParams = this.resolveValue(
        finalParams,
        outputs,
      ) as Record<string, unknown>;

      const actionRes = await this.sandbox.runAgentAction(
        resolvedAction,
        resolvedParams,
      );

      let answerText = actionRes.summary;
      if (resolvedAction === 'execute_python' && actionRes.result?.stdout) {
        answerText = actionRes.result.stdout.trim() || actionRes.summary;
      } else if (
        resolvedAction === 'analyze_csv' &&
        actionRes.result?.markdown_report
      ) {
        answerText = actionRes.result.markdown_report;
      }

      if (node.prompt && (node.provider || node.model)) {
        try {
          const prompt = this.resolveTemplate(node.prompt, outputs);
          const synthesisPrompt = `The following action "${resolvedAction}" was executed in the sandbox environment:\n\nResult Summary: ${actionRes.summary}\n${
            actionRes.result?.stdout
              ? `Output:\n${actionRes.result.stdout}\n`
              : ''
          }${
            actionRes.result?.markdown_report
              ? `Report:\n${actionRes.result.markdown_report}\n`
              : ''
          }\nUser Instructions:\n${prompt}\n\nPlease provide a clear, helpful final response.`;

          const synthesized = await this.modelChat.completeWorkflowPrompt({
            provider: node.provider,
            model: node.model,
            prompt: synthesisPrompt,
            messages,
          });
          if (synthesized && synthesized.trim()) {
            answerText = synthesized.trim();
          }
        } catch {
          // Fallback to answerText if model synthesis fails
        }
      }

      return {
        content: answerText,
        answer: answerText,
        summary: actionRes.summary,
        action: actionRes.action,
        success: actionRes.success,
        result: actionRes.result,
        files_created: actionRes.files_created,
        agentType: 'sandbox_agent',
        ...(typeof actionRes.result === 'object' && actionRes.result
          ? actionRes.result
          : {}),
      };
    }

    // Case 2: No explicit action, but prompt is provided
    if (node.prompt) {
      const prompt = String(this.resolveTemplate(node.prompt, outputs));

      // Check if prompt is directly python code (e.g. contains ```python or begins with import/def/print)
      const pythonBlockMatch = prompt.match(
        /```(?:python|py)?\s*([\s\S]*?)```/i,
      );
      const isDirectPython =
        Boolean(pythonBlockMatch) ||
        /^\s*(import\s+|from\s+\w+\s+import|def\s+|class\s+|print\()/m.test(
          prompt,
        );

      if (isDirectPython) {
        const codeToRun = (
          pythonBlockMatch ? pythonBlockMatch[1] : prompt
        ).trim();
        const actionRes = await this.sandbox.runAgentAction('execute_python', {
          code: codeToRun,
        });

        const answerText =
          actionRes.result?.stdout?.trim() || actionRes.summary;

        return {
          content: answerText,
          answer: answerText,
          summary: actionRes.summary,
          action: 'execute_python',
          success: actionRes.success,
          result: actionRes.result,
          files_created: actionRes.files_created,
          agentType: 'sandbox_agent',
          ...(typeof actionRes.result === 'object' && actionRes.result
            ? actionRes.result
            : {}),
        };
      }

      // Autonomous action selection via LLM
      const systemPrompt = `You are an AI Sandbox Agent with access to an isolated Python and data analysis environment.
Available actions in the sandbox:
1. "execute_python": Run Python code. Parameters: { "code": string, "timeout_seconds"?: number }. Code runs Python 3.12 with pandas, numpy. Read/write files in 'output/' or 'input/'.
2. "create_synthetic_csv": Generate synthetic CSV dataset. Parameters: { "filename": string, "template": "goals_and_milestones"|"sales_performance"|"user_analytics"|"timeseries_metrics"|"project_tasks", "row_count"?: number, "seed"?: number }.
3. "analyze_csv": Statistical column profiling, outlier detection, and Markdown report. Parameters: { "filename": string, "generate_markdown_report"?: boolean }.
4. "query_csv": Filter, project, and sort CSV data. Parameters: { "filename": string, "filter_expression"?: string, "columns"?: string[], "sort_by"?: string, "ascending"?: boolean, "save_result_to"?: string }.
5. "create_csv": Create CSV from JSON records. Parameters: { "filename": string, "data": object[] }.
6. "list_files": List files in workspace. Parameters: {}.

Based on the user request, return a JSON object with "action" and "parameters".
Example:
{"action": "create_synthetic_csv", "parameters": {"filename": "q3_goals.csv", "template": "goals_and_milestones", "row_count": 25}}
Or for code:
{"action": "execute_python", "parameters": {"code": "import pandas as pd\\n..."}}

Return ONLY valid JSON.`;

      const planResponse = await this.modelChat.completeWorkflowPrompt({
        provider: node.provider,
        model: node.model,
        prompt: `${systemPrompt}\n\nUser Request:\n${prompt}`,
        messages,
      });

      const parsed = this.parseJson(planResponse);
      const chosenAction =
        typeof parsed?.action === 'string' ? parsed.action : 'execute_python';
      const chosenParams = (
        parsed?.parameters && typeof parsed.parameters === 'object'
          ? parsed.parameters
          : {}
      ) as Record<string, unknown>;

      if (chosenAction === 'execute_python' && !chosenParams.code) {
        const codeMatch = planResponse.match(
          /```(?:python|py)?\s*([\s\S]*?)```/i,
        );
        if (codeMatch) chosenParams.code = codeMatch[1].trim();
        else if (parsed?.code && typeof parsed.code === 'string')
          chosenParams.code = parsed.code;
      }

      const actionRes = await this.sandbox.runAgentAction(
        chosenAction,
        chosenParams,
      );
      let answerText = actionRes.summary;
      if (chosenAction === 'execute_python' && actionRes.result?.stdout) {
        answerText = actionRes.result.stdout.trim() || actionRes.summary;
      } else if (
        chosenAction === 'analyze_csv' &&
        actionRes.result?.markdown_report
      ) {
        answerText = actionRes.result.markdown_report;
      }

      return {
        content: answerText,
        answer: answerText,
        summary: actionRes.summary,
        action: actionRes.action,
        success: actionRes.success,
        result: actionRes.result,
        files_created: actionRes.files_created,
        agentType: 'sandbox_agent',
        ...(typeof actionRes.result === 'object' && actionRes.result
          ? actionRes.result
          : {}),
      };
    }

    throw new BadRequestException(
      `Sandbox agent ${node.name} needs an action, code, or prompt to run`,
    );
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
        ? rawOutput.value !== undefined &&
          rawOutput.value !== null &&
          rawOutput.value !== ''
          ? rawOutput.value
          : this.resolveFallbackOutput(selected, outputs, edges)
        : (rawOutput.answer ?? rawOutput.content ?? rawOutput);
    return { node: selected, value, outputs: terminalOutputs };
  }

  private toMessage(value: unknown) {
    return typeof value === 'string' ? value : JSON.stringify(value ?? null);
  }

  private resolveFallbackOutput(
    node: WorkflowNode,
    outputs: Map<string, NodeOutput>,
    edges: WorkflowEdge[],
  ): unknown {
    const incomingEdges = edges.filter((edge) => edge.to === node.name);
    const incomingNames = new Set(incomingEdges.map((e) => e.from));
    const entries = Array.from(outputs.entries());

    // 1. If there are incoming edges, take the most recently executed incoming node
    if (incomingNames.size > 0) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const [name, output] = entries[i];
        if (incomingNames.has(name)) {
          return this.extractNodeResponse(output);
        }
      }
    }

    // 2. Otherwise, take the last ran node before this output node
    for (let i = entries.length - 1; i >= 0; i--) {
      const [name, output] = entries[i];
      if (name !== node.name) {
        return this.extractNodeResponse(output);
      }
    }

    return '';
  }

  private extractNodeResponse(output: NodeOutput | undefined): unknown {
    if (!output) return '';
    if (typeof output.answer === 'string' && output.answer.trim().length > 0) {
      return output.answer;
    }
    if (
      output.answer !== undefined &&
      output.answer !== null &&
      output.answer !== ''
    ) {
      return output.answer;
    }
    if (
      typeof output.content === 'string' &&
      output.content.trim().length > 0
    ) {
      return output.content;
    }
    if (
      output.content !== undefined &&
      output.content !== null &&
      output.content !== ''
    ) {
      return output.content;
    }
    if (
      typeof output.message === 'string' &&
      output.message.trim().length > 0
    ) {
      return output.message;
    }
    if (output.message !== undefined && output.message !== null) {
      return output.message;
    }
    if (output.value !== undefined && output.value !== null) {
      return output.value;
    }
    return output;
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
    const trimmed = reference.trim();
    if (
      trimmed === 'last_output' ||
      trimmed === 'last_node.output' ||
      trimmed === 'last' ||
      trimmed === 'lastNode.output'
    ) {
      const entries = Array.from(outputs.entries());
      if (entries.length > 0) {
        return this.extractNodeResponse(entries[entries.length - 1][1]);
      }
      return undefined;
    }

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
