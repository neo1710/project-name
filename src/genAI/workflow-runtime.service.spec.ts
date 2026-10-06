import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { WorkflowService } from '../workflows/workflow.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { SonarModelChat } from './genAI.service';

describe('WorkflowRuntimeService', () => {
  let runtimeService: WorkflowRuntimeService;
  let workflowService: { findForExecution: jest.Mock };
  let knowledgeBaseService: { search: jest.Mock };
  let modelChat: { completeWorkflowPrompt: jest.Mock };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRuntimeService,
        { provide: WorkflowService, useValue: workflowService },
        { provide: KnowledgeBaseService, useValue: knowledgeBaseService },
        { provide: SonarModelChat, useValue: modelChat },
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

    modelChat.completeWorkflowPrompt.mockResolvedValue('Agent answer with empty output value');

    const result = await runtimeService.run({
      workflowName: 'Test Workflow',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.response.message).toBe('Agent answer with empty output value');
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
});

