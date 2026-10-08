import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AgentActionResponse<T = any> {
  success: boolean;
  action: string;
  summary: string;
  result: T;
  files_created: string[];
}

export interface ExecutePythonResult {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  execution_time_ms: number;
  output_files: string[];
  download_urls?: string[];
  error_message?: string | null;
}

export interface CreateCsvResult {
  success: boolean;
  filename: string;
  relative_path: string;
  absolute_path: string;
  download_url: string;
  row_count: number;
  column_count: number;
  columns: string[];
  file_size_bytes: number;
  preview: Array<Record<string, unknown>>;
  message: string;
}

export interface AnalyzeCsvResult {
  success: boolean;
  source: string;
  row_count: number;
  column_count: number;
  columns: string[];
  memory_usage_bytes: number;
  duplicate_rows_count: number;
  column_profiles: Array<{
    name: string;
    inferred_type: string;
    numerical_stats?: Record<string, unknown>;
    categorical_stats?: Record<string, unknown>;
  }>;
  correlations?: Array<{
    column_x: string;
    column_y: string;
    correlation: number;
  }>;
  quality_issues?: Array<{
    severity: 'info' | 'warning' | 'critical';
    column?: string;
    issue: string;
    detail: string;
  }>;
  markdown_report?: string;
  preview?: Array<Record<string, unknown>>;
}

export interface QueryCsvResult {
  success: boolean;
  total_matching_rows: number;
  returned_rows_count: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  saved_file?: string | null;
  download_url?: string | null;
}

export interface FileItem {
  name: string;
  folder: 'input' | 'output';
  relative_path: string;
  size_bytes: number;
  last_modified: string;
}

export interface FileListResult {
  input_files: FileItem[];
  output_files: FileItem[];
  total_count: number;
}

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);
  private readonly baseUrl: string;

  constructor(private readonly config?: ConfigService) {
    this.baseUrl = (
      this.config?.get<string>('SANDBOX_SERVICE_URL') ||
      process.env.SANDBOX_SERVICE_URL ||
      'http://localhost:8001'
    ).replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async runAgentAction(
    action: string,
    parameters: Record<string, unknown> = {},
  ): Promise<AgentActionResponse> {
    if (!action?.trim()) {
      throw new BadRequestException('action is required for sandbox execution');
    }

    const url = `${this.baseUrl}/agent/run`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.trim(), parameters }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Sandbox action '${action}' failed with status ${response.status}: ${errorText}`,
        );
        throw new BadGatewayException(
          `Sandbox execution failed (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as AgentActionResponse;
    } catch (err: any) {
      if (err instanceof BadGatewayException || err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error(`Failed to connect to Sandbox Service at ${url}`, err);
      throw new BadGatewayException(
        `Sandbox service is unreachable at ${this.baseUrl}. Please verify the sandbox container/service is running.`,
      );
    }
  }

  async executePython(
    code: string,
    timeoutSeconds = 30,
    inputFiles?: Record<string, string>,
    envVars?: Record<string, string>,
  ): Promise<ExecutePythonResult> {
    const res = await this.runAgentAction('execute_python', {
      code,
      timeout_seconds: timeoutSeconds,
      input_files: inputFiles,
      env_vars: envVars,
    });
    return res.result;
  }

  async createSyntheticCsv(params: {
    filename: string;
    template?: string;
    row_count?: number;
    seed?: number;
    custom_columns?: Array<Record<string, unknown>>;
  }): Promise<CreateCsvResult> {
    const res = await this.runAgentAction('create_synthetic_csv', params);
    return res.result;
  }

  async analyzeCsv(params: {
    filename?: string;
    csv_content?: string;
    delimiter?: string;
    top_correlations_count?: number;
    generate_markdown_report?: boolean;
  }): Promise<AnalyzeCsvResult> {
    const res = await this.runAgentAction('analyze_csv', params);
    return res.result;
  }

  async queryCsv(params: {
    filename: string;
    filter_expression?: string;
    columns?: string[];
    sort_by?: string;
    ascending?: boolean;
    limit?: number;
    save_result_to?: string;
  }): Promise<QueryCsvResult> {
    const res = await this.runAgentAction('query_csv', params);
    return res.result;
  }

  async listFiles(): Promise<FileListResult> {
    const res = await this.runAgentAction('list_files', {});
    return res.result;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }
}

