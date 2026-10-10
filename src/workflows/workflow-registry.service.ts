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
            {
              action: 'create_excel',
              description:
                'Create styled multi-sheet Excel file (.xlsx) with themes (corporate_blue, emerald, slate, violet, amber), column formatting, and automated formulas.',
              parameters: {
                filename: 'string (required)',
                document_title: 'string (optional)',
                theme:
                  'corporate_blue | emerald | slate | violet | amber (optional, default: corporate_blue)',
                sheets: 'array of sheet definitions (required)',
              },
            },
            {
              action: 'inspect_excel',
              description:
                'Inspect sheet names, dimensions, column names, and row previews of an Excel file.',
              parameters: {
                filename: 'string (required)',
              },
            },
            {
              action: 'analyze_excel',
              description:
                'Statistical column profiling and IQR anomaly detection on an Excel sheet.',
              parameters: {
                filename: 'string (required)',
                sheet_name: 'string (optional)',
              },
            },
            {
              action: 'convert_excel_to_csv',
              description:
                'Extract a specific sheet from an Excel file and save it as a clean CSV.',
              parameters: {
                filename: 'string (required)',
                sheet_name: 'string (optional)',
                output_csv_filename: 'string (optional)',
              },
            },
            {
              action: 'create_word',
              description:
                'Create executive Microsoft Word document (.docx) with KPI cards, callout boxes, bulleted/numbered lists, and tables.',
              parameters: {
                filename: 'string (required)',
                document_title: 'string (required)',
                subtitle: 'string (optional)',
                author: 'string (optional)',
                theme:
                  'corporate_blue | emerald | slate | violet | amber (optional, default: corporate_blue)',
                sections: 'array of section definitions (required)',
              },
            },
            {
              action: 'inspect_word',
              description:
                'Extract headings, paragraph count, word count, and table structure from a Word document.',
              parameters: {
                filename: 'string (required)',
              },
            },
            {
              action: 'read_word',
              description:
                'Extract full text and embedded tables from a Word document formatted as clean Markdown.',
              parameters: {
                filename: 'string (required)',
              },
            },
            {
              action: 'extract_word_tables',
              description:
                'Extract all embedded tables from a Word document into structured JSON arrays.',
              parameters: {
                filename: 'string (required)',
              },
            },
            {
              action: 'run_skill',
              description:
                'Execute built-in or custom instructional skills (excel_kpi_dashboard, word_executive_report, word_goal_action_plan, excel_financial_tracker, data_clean_and_profile, custom_instruction_execution).',
              parameters: {
                skill_id: 'string (required)',
                parameters: 'object (optional)',
              },
            },
            {
              action: 'list_skills',
              description:
                'List all available instructional skills (built-in and custom).',
              parameters: {},
            },
            {
              action: 'get_skill',
              description:
                'Retrieve schema and instructions for a specific skill.',
              parameters: {
                skill_id: 'string (required)',
              },
            },
            {
              action: 'read_file_raw',
              description:
                'Extract text/markdown from .docx, .xlsx, .csv, or .txt files.',
              parameters: {
                folder: 'input | output (required)',
                filename: 'string (required)',
              },
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
