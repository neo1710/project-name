export const AGENT_TYPES = [
  'prompt_agent',
  'function_call_agent',
  'sandbox_agent',
] as const;

export const TOOL_TYPES = [
  'knowledge_base_search',
  'knowledge_base_document_search',
  'rag',
  'http',
  'mcp',
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];
export type ToolType = (typeof TOOL_TYPES)[number];
export type WorkflowNodeType =
  | 'input'
  | 'agent'
  | 'tool'
  | 'condition'
  | 'output';

export interface NodePosition {
  x: number;
  y: number;
}

export interface WorkflowNode {
  name: string;
  type: WorkflowNodeType;
  position: NodePosition;
  agentType?: AgentType | string;
  provider?: 'groq' | 'mistral';
  model?: string;
  prompt?: string;
  tool?: ToolType | string;
  input?: Record<string, unknown>;
  tools?: string[];
  settings?: Record<string, unknown>;
  expression?: string;
  value?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  when?: string;
}

export interface WorkflowPayload {
  name: string;
  description?: string;
  version?: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
