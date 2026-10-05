import { Injectable } from '@nestjs/common';
import { AGENT_TYPES, TOOL_TYPES } from './workflow.types';

@Injectable()
export class WorkflowRegistryService {
  definitions() {
    return {
      nodeTypes: [
        { type: 'input', label: 'Chat Input', category: 'flow' },
        { type: 'agent', label: 'Agent', category: 'ai' },
        { type: 'tool', label: 'Tool', category: 'tools' },
        { type: 'condition', label: 'Condition', category: 'flow' },
        { type: 'output', label: 'Output', category: 'flow' },
      ],
      agentTypes: [
        {
          type: 'prompt_agent',
          description: 'Runs a configured prompt against the selected model.',
        },
        {
          type: 'function_call_agent',
          description: 'Lets the model select and call approved tool nodes.',
        },
        {
          type: 'sandbox_agent',
          description: 'Reserved for isolated code or task execution.',
        },
      ],
      toolTypes: [
        {
          type: 'knowledge_base_search',
          kind: 'built_in',
          description: 'Search all accessible knowledge-base documents.',
        },
        {
          type: 'knowledge_base_document_search',
          kind: 'built_in',
          description: 'Search one selected knowledge-base document.',
        },
        {
          type: 'rag',
          kind: 'planned',
          description: 'Reserved for the future all-in-one RAG tool.',
        },
        {
          type: 'http',
          kind: 'configured',
          description: 'Call an approved HTTP integration.',
        },
        {
          type: 'mcp',
          kind: 'configured',
          description: 'Call a configured MCP tool during workflow execution.',
        },
      ],
      supportedAgentTypes: AGENT_TYPES,
      supportedToolTypes: TOOL_TYPES,
    };
  }
}
