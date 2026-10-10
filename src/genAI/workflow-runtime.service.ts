import {
  BadRequestException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(WorkflowRuntimeService.name);

  constructor(
    private readonly workflows: WorkflowService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly modelChat: SonarModelChat,
    private readonly sandbox: SandboxService,
  ) {}

  // ==========================================
  // SYNCHRONOUS WORKFLOW RUN
  // ==========================================

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

  // ==========================================
  // REAL-TIME STREAMING WORKFLOW RUN (SSE)
  // ==========================================

  async runStream(body: chat, res: any): Promise<void> {
    if (!body.workflowName?.trim())
      throw new BadRequestException('workflowName is required');
    if (!Array.isArray(body.messages) || !body.messages.length)
      throw new BadRequestException('At least one chat message is required');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(
        `event: ${event}\ndata: ${
          typeof data === 'string' ? data : JSON.stringify(data)
        }\n\n`,
      );
      res.flush?.();
    };

    let currentNodeName = '';

    try {
      const workflow = await this.workflows.findForExecution(
        body.workflowName,
        body.workflowOwnerId,
      );
      const order = this.topologicalOrder(workflow.nodes, workflow.edges);
      const startedAt = new Date();
      const runId = randomUUID();
      const outputs = new Map<string, NodeOutput>();
      const trace: WorkflowTrace[] = [];
      const citations: Array<{
        documentId: string;
        title?: string;
        excerpt: string;
        score: number;
      }> = [];

      sendEvent('workflow_start', {
        workflow: {
          workflowId: workflow.workflowId,
          name: workflow.name,
          version: workflow.version,
        },
        run: {
          runId,
          status: 'running',
          startedAt: startedAt.toISOString(),
        },
      });

      for (const node of order) {
        currentNodeName = node.name;
        const nodeStartedAt = Date.now();

        sendEvent('node_start', {
          nodeName: node.name,
          nodeType: node.type,
          agentType: node.agentType,
          startedAt: new Date(nodeStartedAt).toISOString(),
        });

        const output = await this.executeNodeStream(
          node,
          outputs,
          body.messages,
          citations,
          workflow.edges,
          sendEvent,
        );

        outputs.set(node.name, output);
        const durationMs = Date.now() - nodeStartedAt;

        trace.push({
          nodeName: node.name,
          nodeType: node.type,
          status: 'completed',
          durationMs,
          output,
        });

        sendEvent('node_complete', {
          nodeName: node.name,
          nodeType: node.type,
          status: 'completed',
          durationMs,
          output,
        });
      }

      const final = this.selectFinalOutput(
        workflow.nodes,
        workflow.edges,
        outputs,
      );
      const completedAt = new Date();

      const resultPayload = {
        workflow: {
          workflowId: workflow.workflowId,
          name: workflow.name,
          version: workflow.version,
        },
        run: {
          runId,
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

      sendEvent('workflow_complete', resultPayload);
      res.write('data: [DONE]\n\n');
    } catch (err: any) {
      this.logger.error(`Workflow streaming error at node '${currentNodeName}': ${err.message}`, err.stack);
      sendEvent('error', {
        nodeName: currentNodeName,
        error: err.message || 'Workflow execution error',
        status: 'failed',
      });
    } finally {
      res.end();
    }
  }

  // ==========================================
  // NODE EXECUTION LOGIC (SYNCHRONOUS)
  // ==========================================

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

  // ==========================================
  // NODE EXECUTION LOGIC (STREAMING)
  // ==========================================

  private async executeNodeStream(
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
    sendEvent: (event: string, data: unknown) => void,
  ): Promise<NodeOutput> {
    if (node.type === 'input') {
      const latest = messages.at(-1)!;
      return { message: latest.content, conversation: messages };
    }

    if (node.type === 'agent') {
      if (node.agentType === 'sandbox_agent') {
        return this.executeSandboxAgentStream(node, outputs, messages, sendEvent);
      }
      if (!node.prompt)
        throw new BadRequestException(
          `Agent node ${node.name} needs a prompt to run`,
        );

      const prompt = this.resolveTemplate(node.prompt, outputs);
      sendEvent('status', {
        nodeName: node.name,
        message: 'Generating agent response...',
      });

      const content = await this.modelChat.completeWorkflowPromptStream(
        {
          provider: node.provider,
          model: node.model,
          prompt: String(prompt),
          messages,
        },
        (chunk) => {
          sendEvent('token', {
            nodeName: node.name,
            chunk,
            delta: chunk,
            text: chunk,
          });
        },
      );

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
        sendEvent('status', {
          nodeName: node.name,
          message: 'Searching knowledge base...',
        });

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

  // ==========================================
  // SANDBOX AGENT EXECUTION (SYNCHRONOUS)
  // ==========================================

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

      let answerText = this.extractSandboxAnswer(resolvedAction, actionRes);

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

      // Check if prompt is directly python code
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
      const systemPrompt = this.getSandboxAutonomousSystemPrompt();

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
      const answerText = this.extractSandboxAnswer(chosenAction, actionRes);

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

  // ==========================================
  // SANDBOX AGENT EXECUTION (STREAMING)
  // ==========================================

  private async executeSandboxAgentStream(
    node: WorkflowNode,
    outputs: Map<string, NodeOutput>,
    messages: conversations[],
    sendEvent: (event: string, data: unknown) => void,
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

    let finalParams: Record<string, unknown> = { ...rawParameters };
    if (explicitCode && !finalParams.code) {
      finalParams.code = explicitCode;
    }

    // Autonomous planning if no action or code is present
    if (!action && node.prompt) {
      const prompt = String(this.resolveTemplate(node.prompt, outputs));
      const pythonBlockMatch = prompt.match(
        /```(?:python|py)?\s*([\s\S]*?)```/i,
      );
      const isDirectPython =
        Boolean(pythonBlockMatch) ||
        /^\s*(import\s+|from\s+\w+\s+import|def\s+|class\s+|print\()/m.test(
          prompt,
        );

      if (isDirectPython) {
        action = 'execute_python';
        finalParams = {
          code: (pythonBlockMatch ? pythonBlockMatch[1] : prompt).trim(),
        };
      } else {
        sendEvent('status', {
          nodeName: node.name,
          message: 'Planning sandbox action with AI...',
        });

        const systemPrompt = this.getSandboxAutonomousSystemPrompt();
        const planResponse = await this.modelChat.completeWorkflowPrompt({
          provider: node.provider,
          model: node.model,
          prompt: `${systemPrompt}\n\nUser Request:\n${prompt}`,
          messages,
        });

        const parsed = this.parseJson(planResponse);
        action =
          typeof parsed?.action === 'string' ? parsed.action : 'execute_python';
        finalParams = (
          parsed?.parameters && typeof parsed.parameters === 'object'
            ? parsed.parameters
            : {}
        ) as Record<string, unknown>;

        if (action === 'execute_python' && !finalParams.code) {
          const codeMatch = planResponse.match(
            /```(?:python|py)?\s*([\s\S]*?)```/i,
          );
          if (codeMatch) finalParams.code = codeMatch[1].trim();
          else if (parsed?.code && typeof parsed.code === 'string')
            finalParams.code = parsed.code;
        }
      }
    }

    if (!action) {
      throw new BadRequestException(
        `Sandbox agent ${node.name} needs an action, code, or prompt to run`,
      );
    }

    const resolvedAction = String(this.resolveValue(action, outputs)).trim();
    const resolvedParams = this.resolveValue(
      finalParams,
      outputs,
    ) as Record<string, unknown>;

    sendEvent('status', {
      nodeName: node.name,
      message: `Executing sandbox action: ${resolvedAction}`,
      action: resolvedAction,
    });

    let streamRes: Response;
    try {
      if (resolvedAction === 'execute_python') {
        streamRes = await this.sandbox.streamPythonExecution({
          code: String(resolvedParams.code || ''),
          timeout_seconds:
            typeof resolvedParams.timeout_seconds === 'number'
              ? resolvedParams.timeout_seconds
              : 30,
          input_files: resolvedParams.input_files as
            | Record<string, string>
            | undefined,
        });
      } else if (resolvedAction === 'run_skill') {
        const skillId = String(
          resolvedParams.skill_id ||
            node.settings?.skill_id ||
            'custom_instruction_execution',
        );
        const skillParams = (resolvedParams.parameters || resolvedParams) as Record<
          string,
          unknown
        >;
        streamRes = await this.sandbox.streamSkill(skillId, skillParams);
      } else {
        streamRes = await this.sandbox.streamAgentAction(
          resolvedAction,
          resolvedParams,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Sandbox stream connection failed, falling back to synchronous execution: ${err.message}`,
      );
      const fallbackRes = await this.sandbox.runAgentAction(
        resolvedAction,
        resolvedParams,
      );
      sendEvent('complete', { nodeName: node.name, ...fallbackRes });
      return {
        content: this.extractSandboxAnswer(resolvedAction, fallbackRes),
        answer: this.extractSandboxAnswer(resolvedAction, fallbackRes),
        summary: fallbackRes.summary,
        action: fallbackRes.action,
        success: fallbackRes.success,
        result: fallbackRes.result,
        files_created: fallbackRes.files_created,
        agentType: 'sandbox_agent',
        ...(typeof fallbackRes.result === 'object' && fallbackRes.result
          ? fallbackRes.result
          : {}),
      };
    }

    let completePayload: any = null;
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const filesCreated: string[] = [];

    for await (const sse of this.sandbox.parseSseStream(streamRes)) {
      sendEvent(sse.event, {
        nodeName: node.name,
        ...(typeof sse.parsed === 'object' && sse.parsed
          ? sse.parsed
          : { data: sse.data }),
      });

      if (sse.event === 'stdout' && sse.parsed?.line) {
        stdoutLines.push(sse.parsed.line);
      } else if (sse.event === 'stderr' && sse.parsed?.line) {
        stderrLines.push(sse.parsed.line);
      } else if (sse.event === 'file_created') {
        const filename = sse.parsed?.relative_path || sse.parsed?.filename;
        if (filename && !filesCreated.includes(filename)) filesCreated.push(filename);
      } else if (sse.event === 'complete') {
        completePayload = sse.parsed;
        if (Array.isArray(sse.parsed?.output_files)) {
          for (const f of sse.parsed.output_files) {
            if (!filesCreated.includes(f)) filesCreated.push(f);
          }
        }
      }
    }

    let answerText =
      completePayload?.summary ||
      completePayload?.result?.summary ||
      '';

    if (resolvedAction === 'execute_python') {
      answerText =
        stdoutLines.join('\n').trim() ||
        completePayload?.result?.stdout?.trim() ||
        answerText ||
        'Execution completed.';
    } else if (
      resolvedAction === 'analyze_csv' &&
      completePayload?.result?.markdown_report
    ) {
      answerText = completePayload.result.markdown_report;
    } else if (
      resolvedAction === 'analyze_excel' &&
      completePayload?.result?.markdown_report
    ) {
      answerText = completePayload.result.markdown_report;
    } else if (
      resolvedAction === 'read_word' &&
      completePayload?.result?.markdown
    ) {
      answerText = completePayload.result.markdown;
    } else if (
      resolvedAction === 'read_file_raw' &&
      (completePayload?.result?.markdown || completePayload?.result?.text)
    ) {
      answerText = completePayload.result.markdown || completePayload.result.text;
    } else if (
      (resolvedAction === 'create_excel' || resolvedAction === 'create_word') &&
      !answerText
    ) {
      answerText =
        completePayload?.message ||
        `Successfully generated document (${
          filesCreated.join(', ') || 'saved in output/'
        })`;
    }

    if (!answerText) {
      answerText = completePayload?.summary || 'Execution completed successfully.';
    }

    // Optional LLM synthesis of the sandbox results
    if (node.prompt && (node.provider || node.model)) {
      try {
        const prompt = this.resolveTemplate(node.prompt, outputs);
        const synthesisPrompt = `The following action "${resolvedAction}" was executed in the sandbox environment:\n\nResult Summary: ${answerText}\n${
          stdoutLines.length ? `Output:\n${stdoutLines.join('\n')}\n` : ''
        }\nUser Instructions:\n${prompt}\n\nPlease provide a clear, helpful final response.`;

        sendEvent('status', {
          nodeName: node.name,
          message: 'Synthesizing final response with AI...',
        });

        const synthesized =
          await this.modelChat.completeWorkflowPromptStream(
            {
              provider: node.provider,
              model: node.model,
              prompt: synthesisPrompt,
              messages,
            },
            (chunk) => {
              sendEvent('token', {
                nodeName: node.name,
                chunk,
                delta: chunk,
                text: chunk,
              });
            },
          );
        if (synthesized && synthesized.trim()) {
          answerText = synthesized.trim();
        }
      } catch {
        // Fallback to answerText
      }
    }

    return {
      content: answerText,
      answer: answerText,
      summary: completePayload?.summary || answerText,
      action: resolvedAction,
      success: completePayload?.success ?? true,
      result: completePayload?.result ?? completePayload,
      files_created: filesCreated.length
        ? filesCreated
        : completePayload?.files_created ?? [],
      agentType: 'sandbox_agent',
      ...(typeof completePayload?.result === 'object' && completePayload?.result
        ? completePayload.result
        : {}),
    };
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private extractSandboxAnswer(action: string, actionRes: any): string {
    let answerText = actionRes.summary || '';
    if (action === 'execute_python' && actionRes.result?.stdout) {
      answerText = actionRes.result.stdout.trim() || actionRes.summary;
    } else if (action === 'analyze_csv' && actionRes.result?.markdown_report) {
      answerText = actionRes.result.markdown_report;
    } else if (action === 'analyze_excel' && actionRes.result?.markdown_report) {
      answerText = actionRes.result.markdown_report;
    } else if (action === 'read_word' && actionRes.result?.markdown) {
      answerText = actionRes.result.markdown;
    } else if (action === 'read_file_raw' && (actionRes.result?.markdown || actionRes.result?.text)) {
      answerText = actionRes.result.markdown || actionRes.result.text;
    } else if (action === 'inspect_excel' && actionRes.result?.sheets) {
      answerText = actionRes.summary || `Excel Sheets: ${Object.keys(actionRes.result.sheets).join(', ')}`;
    } else if (action === 'inspect_word' && actionRes.result?.paragraph_count !== undefined) {
      answerText = actionRes.summary || `Word Document: ${actionRes.result.paragraph_count} paragraphs, ${actionRes.result.word_count || 0} words`;
    } else if (action === 'create_excel' || action === 'create_word') {
      answerText = actionRes.summary || actionRes.result?.message || `Successfully generated document (${actionRes.files_created?.join(', ') || 'saved in output/'})`;
    } else if (action === 'run_skill' && actionRes.result?.summary) {
      answerText = actionRes.result.summary;
    }
    return answerText;
  }

  private getSandboxAutonomousSystemPrompt(): string {
    return `You are an AI Sandbox Agent with access to an isolated Python, data analysis, Excel, Word, and Skills environment.
Available actions in the sandbox:
1. "execute_python": Run Python code. Parameters: { "code": string, "timeout_seconds"?: number }. Code runs Python 3.12 with pandas, numpy, openpyxl, python-docx. Read/write files in 'output/' or 'input/'.
2. "create_excel": Create styled multi-sheet Excel file (.xlsx). Parameters: { "filename": string, "document_title"?: string, "theme"?: "corporate_blue"|"emerald"|"slate"|"violet"|"amber", "sheets": [ { "title": string, "columns": string[], "rows": any[][], "column_formats"?: object, "summary_row"?: object, "zebra_stripes"?: boolean } ] }.
3. "inspect_excel": Inspect sheet names, dimensions, columns, and previews. Parameters: { "filename": string }.
4. "analyze_excel": Statistical column profiling and anomaly detection. Parameters: { "filename": string, "sheet_name"?: string }.
5. "convert_excel_to_csv": Extract sheet as CSV. Parameters: { "filename": string, "sheet_name"?: string, "output_csv_filename"?: string }.
6. "create_word": Create executive Word document (.docx). Parameters: { "filename": string, "document_title": string, "subtitle"?: string, "author"?: string, "theme"?: string, "sections": [ { "heading": string, "level"?: number, "paragraphs"?: string[], "kpis"?: [ { "metric": string, "value": string, "subtitle"?: string } ], "callout"?: string, "numbered_list"?: string[], "bulleted_list"?: string[] } ] }.
7. "inspect_word": Extract headings, paragraph count, word count, tables. Parameters: { "filename": string }.
8. "read_word": Extract full text and tables as clean Markdown. Parameters: { "filename": string }.
9. "extract_word_tables": Extract embedded tables as structured JSON. Parameters: { "filename": string }.
10. "run_skill": Execute instructional skill. Available skills: "excel_kpi_dashboard", "word_executive_report", "word_goal_action_plan", "excel_financial_tracker", "data_clean_and_profile", "custom_instruction_execution". Parameters: { "skill_id": string, "parameters": object }.
11. "create_synthetic_csv": Generate synthetic CSV dataset. Parameters: { "filename": string, "template": "goals_and_milestones"|"sales_performance"|"user_analytics"|"timeseries_metrics"|"project_tasks", "row_count"?: number, "seed"?: number }.
12. "analyze_csv": Statistical column profiling, outlier detection, and Markdown report. Parameters: { "filename": string, "generate_markdown_report"?: boolean }.
13. "query_csv": Filter, project, and sort CSV data. Parameters: { "filename": string, "filter_expression"?: string, "columns"?: string[], "sort_by"?: string, "ascending"?: boolean, "save_result_to"?: string }.
14. "create_csv": Create CSV from JSON records. Parameters: { "filename": string, "data": object[] }.
15. "list_files": List files in workspace. Parameters: {}.
16. "read_file_raw": Read file text/markdown. Parameters: { "folder": "input"|"output", "filename": string }.

Based on the user request, return a JSON object with "action" and "parameters".
Example:
{"action": "create_excel", "parameters": {"filename": "Q3_Report.xlsx", "sheets": [{"title": "Summary", "columns": ["Metric", "Value"], "rows": [["Revenue", 100000]]}]}}
Or for code:
{"action": "execute_python", "parameters": {"code": "import pandas as pd\\n..."}}
Or for skills:
{"action": "run_skill", "parameters": {"skill_id": "word_executive_report", "parameters": {"filename": "Review.docx", "document_title": "Executive Review"}}}

Return ONLY valid JSON.`;
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
