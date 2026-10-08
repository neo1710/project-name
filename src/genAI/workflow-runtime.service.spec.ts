import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { WorkflowService } from '../workflows/workflow.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { SonarModelChat } from './genAI.service';
import { SandboxService } from './sandbox.service';

describe('WorkflowRuntimeService', () => {
  let runtimeService: WorkflowRuntimeService;
  let workflowService: { findForExecution: jest.Mock };
  let knowledgeBaseService: { search: jest.Mock };
  let modelChat: { completeWorkflowPrompt: jest.Mock };
  let sandboxService: { runAgentAction: jest.Mock };

  beforeEach(async () => {
    workflowService = {
      findForExecution: jest.fn(),
    };
    knowledgeBaseService = {
      search: jest.fn(),
    };
    modelChat = {
      completeWorkflowPrompt: jest.fn(),
    };
    sandboxService = {
      runAgentAction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRuntimeService,
        { provide: WorkflowService, useValue: workflowService },
        { provide: KnowledgeBaseService, useValue: knowledgeBaseService },
        { provide: SonarModelChat, useValue: modelChat },
        { provide: SandboxService, useValue: sandboxService },
      ],
    }).compile();

    runtimeService = module.get<WorkflowRuntimeService>(WorkflowRuntimeService);
  });

  it('takes the last ran agent node response when output node value is omitted', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-1',
      name: 'Test Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'AgentNode',
          type: 'agent',
          agentType: 'prompt_agent',
          position: { x: 100, y: 0 },
          prompt: 'Answer: {{Input.output.message}}',
        },
        {
          name: 'OutputNode',
          type: 'output',
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'AgentNode' },
        { from: 'AgentNode', to: 'OutputNode' },
      ],
    });

    modelChat.completeWorkflowPrompt.mockResolvedValue('Hello from agent!');

    const result = await runtimeService.run({
      workflowName: 'Test Workflow',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.response.finalNode).toEqual({
      name: 'OutputNode',
      type: 'output',
    });
    expect(result.response.message).toBe('Hello from agent!');
    expect(result.response.outputs['OutputNode']).toEqual({
      value: 'Hello from agent!',
    });
  });

  it('takes the last ran agent node response when output node value is empty string', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-2',
      name: 'Test Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'AgentNode',
          type: 'agent',
          agentType: 'prompt_agent',
          position: { x: 100, y: 0 },
          prompt: 'Answer: {{Input.output.message}}',
        },
        {
          name: 'OutputNode',
          type: 'output',
          value: '   ',
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'AgentNode' },
        { from: 'AgentNode', to: 'OutputNode' },
      ],
    });

    modelChat.completeWorkflowPrompt.mockResolvedValue(
      'Agent answer with empty output value',
    );

    const result = await runtimeService.run({
      workflowName: 'Test Workflow',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.response.message).toBe(
      'Agent answer with empty output value',
    );
    expect(result.response.outputs['OutputNode']).toEqual({
      value: 'Agent answer with empty output value',
    });
  });

  it('takes the connected incoming node response when multiple nodes exist', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-3',
      name: 'Test Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'AgentA',
          type: 'agent',
          agentType: 'prompt_agent',
          position: { x: 100, y: 0 },
          prompt: 'A',
        },
        {
          name: 'AgentB',
          type: 'agent',
          agentType: 'prompt_agent',
          position: { x: 200, y: 0 },
          prompt: 'B',
        },
        {
          name: 'OutputNode',
          type: 'output',
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'AgentA' },
        { from: 'AgentA', to: 'AgentB' },
        { from: 'AgentB', to: 'OutputNode' },
      ],
    });

    modelChat.completeWorkflowPrompt
      .mockResolvedValueOnce('Agent A output')
      .mockResolvedValueOnce('Agent B final output');

    const result = await runtimeService.run({
      workflowName: 'Test Workflow',
      messages: [{ role: 'user', content: 'Run' }],
    });

    expect(result.response.message).toBe('Agent B final output');
    expect(result.response.outputs['OutputNode']).toEqual({
      value: 'Agent B final output',
    });
  });

  it('uses explicit value when provided in output node', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-4',
      name: 'Test Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'AgentNode',
          type: 'agent',
          agentType: 'prompt_agent',
          position: { x: 100, y: 0 },
          prompt: 'Answer',
        },
        {
          name: 'OutputNode',
          type: 'output',
          value: 'Explicit template: {{AgentNode.output.answer}}',
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'AgentNode' },
        { from: 'AgentNode', to: 'OutputNode' },
      ],
    });

    modelChat.completeWorkflowPrompt.mockResolvedValue('Agent answer');

    const result = await runtimeService.run({
      workflowName: 'Test Workflow',
      messages: [{ role: 'user', content: 'Run' }],
    });

    expect(result.response.message).toBe('Explicit template: Agent answer');
    expect(result.response.outputs['OutputNode']).toEqual({
      value: 'Explicit template: Agent answer',
    });
  });

  it('supports {{last_output}} template reference', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-5',
      name: 'Test Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'AgentNode',
          type: 'agent',
          agentType: 'prompt_agent',
          position: { x: 100, y: 0 },
          prompt: 'Answer',
        },
        {
          name: 'OutputNode',
          type: 'output',
          value: 'Result is {{last_output}}',
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'AgentNode' },
        { from: 'AgentNode', to: 'OutputNode' },
      ],
    });

    modelChat.completeWorkflowPrompt.mockResolvedValue('Agent Result');

    const result = await runtimeService.run({
      workflowName: 'Test Workflow',
      messages: [{ role: 'user', content: 'Run' }],
    });

    expect(result.response.message).toBe('Result is Agent Result');
  });

  it('takes tool results if tool is the node preceding output without value', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-6',
      name: 'Test Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'ToolNode',
          type: 'tool',
          tool: 'knowledge_base_search',
          input: { query: 'test query' },
          position: { x: 100, y: 0 },
        },
        {
          name: 'OutputNode',
          type: 'output',
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'ToolNode' },
        { from: 'ToolNode', to: 'OutputNode' },
      ],
    });

    knowledgeBaseService.search.mockResolvedValue({
      query: 'test query',
      count: 1,
      results: [{ doc_id: 'doc-1', text: 'Some text', score: 0.95 }],
    });

    const result = await runtimeService.run({
      workflowName: 'Test Workflow',
      messages: [{ role: 'user', content: 'Run' }],
    });

    expect(result.response.outputs['OutputNode']).toEqual({
      value: {
        query: 'test query',
        count: 1,
        results: [{ doc_id: 'doc-1', text: 'Some text', score: 0.95 }],
      },
    });
  });

  it('executes sandbox_agent with explicit action and parameters', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-sandbox-1',
      name: 'Sandbox Synthetic Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'GenerateData',
          type: 'agent',
          agentType: 'sandbox_agent',
          action: 'create_synthetic_csv',
          parameters: {
            filename: 'goals.csv',
            template: 'goals_and_milestones',
            row_count: 25,
          },
          position: { x: 150, y: 0 },
        },
        {
          name: 'OutputNode',
          type: 'output',
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'GenerateData' },
        { from: 'GenerateData', to: 'OutputNode' },
      ],
    });

    sandboxService.runAgentAction.mockResolvedValue({
      success: true,
      action: 'create_synthetic_csv',
      summary: "Generated synthetic CSV 'goals.csv' (25 rows, 9 columns)",
      result: {
        filename: 'goals.csv',
        relative_path: 'output/goals.csv',
        row_count: 25,
        column_count: 9,
      },
      files_created: ['output/goals.csv'],
    });

    const result = await runtimeService.run({
      workflowName: 'Sandbox Synthetic Workflow',
      messages: [{ role: 'user', content: 'Create data' }],
    });

    expect(sandboxService.runAgentAction).toHaveBeenCalledWith(
      'create_synthetic_csv',
      {
        filename: 'goals.csv',
        template: 'goals_and_milestones',
        row_count: 25,
      },
    );
    expect(result.response.message).toBe(
      "Generated synthetic CSV 'goals.csv' (25 rows, 9 columns)",
    );
    expect(result.response.outputs['OutputNode']).toEqual({
      value: "Generated synthetic CSV 'goals.csv' (25 rows, 9 columns)",
    });
  });

  it('executes sandbox_agent with explicit Python code', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-sandbox-2',
      name: 'Sandbox Python Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'PyRunner',
          type: 'agent',
          agentType: 'sandbox_agent',
          code: 'print(2 + 2)',
          position: { x: 150, y: 0 },
        },
        {
          name: 'OutputNode',
          type: 'output',
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'PyRunner' },
        { from: 'PyRunner', to: 'OutputNode' },
      ],
    });

    sandboxService.runAgentAction.mockResolvedValue({
      success: true,
      action: 'execute_python',
      summary: 'Python execution succeeded in 12ms.',
      result: {
        success: true,
        exit_code: 0,
        stdout: '4\n',
        stderr: '',
        execution_time_ms: 12.0,
        output_files: [],
      },
      files_created: [],
    });

    const result = await runtimeService.run({
      workflowName: 'Sandbox Python Workflow',
      messages: [{ role: 'user', content: 'Compute' }],
    });

    expect(sandboxService.runAgentAction).toHaveBeenCalledWith(
      'execute_python',
      {
        code: 'print(2 + 2)',
      },
    );
    expect(result.response.message).toBe('4');
  });

  it('executes sandbox_agent with LLM-planned action when prompt is provided', async () => {
    workflowService.findForExecution.mockResolvedValue({
      workflowId: 'wf-sandbox-3',
      name: 'Sandbox AI Workflow',
      version: 1,
      nodes: [
        { name: 'Input', type: 'input', position: { x: 0, y: 0 } },
        {
          name: 'AnalyzerAgent',
          type: 'agent',
          agentType: 'sandbox_agent',
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          prompt: 'Analyze sales data in sales.csv',
          position: { x: 150, y: 0 },
        },
        {
          name: 'OutputNode',
          type: 'output',
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        { from: 'Input', to: 'AnalyzerAgent' },
        { from: 'AnalyzerAgent', to: 'OutputNode' },
      ],
    });

    modelChat.completeWorkflowPrompt.mockResolvedValue(
      JSON.stringify({
        action: 'analyze_csv',
        parameters: { filename: 'sales.csv' },
      }),
    );

    sandboxService.runAgentAction.mockResolvedValue({
      success: true,
      action: 'analyze_csv',
      summary: 'Analyzed sales.csv: 100 rows, 5 columns.',
      result: {
        source: 'sales.csv',
        row_count: 100,
        column_count: 5,
        markdown_report: '# Sales Report\nAll metrics positive.',
      },
      files_created: [],
    });

    const result = await runtimeService.run({
      workflowName: 'Sandbox AI Workflow',
      messages: [{ role: 'user', content: 'Analyze sales' }],
    });

    expect(sandboxService.runAgentAction).toHaveBeenCalledWith('analyze_csv', {
      filename: 'sales.csv',
    });
    expect(result.response.message).toBe(
      '# Sales Report\nAll metrics positive.',
    );
  });
});
