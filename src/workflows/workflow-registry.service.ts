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
          description:
            'Secure isolated Python code runner, CSV generator, statistical analyser, and query engine.',
          actions: [
            {
              action: 'execute_python',
              description:
                'Execute Python 3.12 scripts with pandas and numpy in an isolated sandbox.',
              parameters: {
                code: 'string (required)',
                timeout_seconds: 'number (optional, default: 30)',
              },
            },
            {
              action: 'create_synthetic_csv',
              description:
                'Generate synthetic datasets (goals_and_milestones, sales_performance, user_analytics, timeseries_metrics, project_tasks).',
              parameters: {
                filename: 'string (required)',
                template:
                  'goals_and_milestones | sales_performance | user_analytics | timeseries_metrics | project_tasks',
                row_count: 'number (optional, default: 50)',
                seed: 'number (optional, default: 42)',
              },
            },
            {
              action: 'analyze_csv',
              description:
                'Statistical column profiling, IQR outlier detection, correlation analysis, and Markdown report.',
              parameters: {
                filename: 'string (optional, in input/ or output/)',
                generate_markdown_report: 'boolean (optional, default: true)',
              },
            },
            {
              action: 'query_csv',
              description:
                'SQL-like filtering, column projection, and sorting on CSV files.',
              parameters: {
                filename: 'string (required)',
                filter_expression: 'string (optional, e.g. progress_pct > 50)',
                columns: 'string[] (optional)',
                sort_by: 'string (optional)',
                ascending: 'boolean (optional, default: true)',
                limit: 'number (optional, default: 50)',
                save_result_to: 'string (optional)',
              },
            },
            {
              action: 'create_csv',
              description: 'Create a CSV file from JSON record arrays.',
              parameters: {
                filename: 'string (required)',
                data: 'object[] (required)',
                delimiter: 'string (optional, default: ,)',
              },
            },
            {
              action: 'list_files',
              description:
                'List all input and output files available in the sandbox workspace.',
              parameters: {},
            },
          ],
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
