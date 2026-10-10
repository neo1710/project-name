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

export interface SkillDefinition {
  id: string;
  name: string;
  category?: string;
  description: string;
  instructions: string;
  parameters_schema?: Record<string, unknown>;
  output_format?: string;
}

export interface ExcelSheetConfig {
  title: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  column_formats?: Record<string, string>;
  summary_row?: Record<string, string>;
  zebra_stripes?: boolean;
}

export interface CreateExcelParams {
  filename: string;
  document_title?: string;
  theme?: 'corporate_blue' | 'emerald' | 'slate' | 'violet' | 'amber' | string;
  sheets: ExcelSheetConfig[];
}

export interface WordKpi {
  metric: string;
  value: string | number;
  subtitle?: string;
}

export interface WordSection {
  heading: string;
  level?: number;
  paragraphs?: string[];
  kpis?: WordKpi[];
  callout?: string;
  bulleted_list?: string[];
  numbered_list?: string[];
  table?: {
    headers: string[];
    rows: Array<Array<string | number>>;
  };
}

export interface CreateWordParams {
  filename: string;
  document_title: string;
  subtitle?: string;
  author?: string;
  theme?: 'corporate_blue' | 'emerald' | 'slate' | 'violet' | 'amber' | string;
  sections: WordSection[];
}

export interface ParsedSseEvent<T = any> {
  event: string;
  data: string;
  parsed?: T;
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

  // ==========================================
  // UNIFIED AGENT RUNNER & CORE ACTIONS
  // ==========================================

  async runAgentAction(
    action: string,
    parameters: Record<string, unknown> = {},
  ): Promise<AgentActionResponse> {
    if (!action?.trim()) {
      throw new BadRequestException('action is required for sandbox execution');
    }

    const trimmedAction = action.trim();

    // Route specific actions to dedicated endpoints if desired, while defaulting to /agent/run
    const url = `${this.baseUrl}/agent/run`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: trimmedAction, parameters }),
      });

      if (!response.ok) {
        // Fallback for special actions if /agent/run returns 404 or 400
        if (trimmedAction === 'run_skill') {
          const skillId = (parameters.skill_id as string) || 'custom_instruction_execution';
          return await this.runSkill(skillId, (parameters.parameters || parameters) as Record<string, unknown>);
        }
        if (trimmedAction === 'create_excel') {
          const res = await this.createExcel(parameters);
          return {
            success: true,
            action: trimmedAction,
            summary: res.message || `Created Excel file '${res.filename || parameters.filename}'`,
            result: res,
            files_created: res.relative_path ? [res.relative_path] : [],
          };
        }
        if (trimmedAction === 'create_word') {
          const res = await this.createWord(parameters);
          return {
            success: true,
            action: trimmedAction,
            summary: res.message || `Created Word document '${res.filename || parameters.filename}'`,
            result: res,
            files_created: res.relative_path ? [res.relative_path] : [],
          };
        }

        const errorText = await response.text();
        this.logger.error(
          `Sandbox action '${trimmedAction}' failed with status ${response.status}: ${errorText}`,
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

  // ==========================================
  // REAL-TIME STREAMING ENDPOINTS (SSE)
  // ==========================================

  /**
   * Starts Python code execution stream via POST /execute/stream
   */
  async streamPythonExecution(params: {
    code: string;
    timeout_seconds?: number;
    input_files?: Record<string, string>;
  }): Promise<Response> {
    const url = `${this.baseUrl}/execute/stream`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(
          `Sandbox execute stream failed (${response.status}): ${errorText}`,
        );
      }
      return response;
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sandbox service unreachable at ${url}: ${err.message}`,
      );
    }
  }

  /**
   * Streams unified agent action execution via POST /agent/run/stream
   */
  async streamAgentAction(
    action: string,
    parameters: Record<string, unknown> = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}/agent/run/stream`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.trim(), parameters }),
      });
      if (!response.ok) {
        // Fallback to /agent/run with stream: true
        const fallbackRes = await fetch(`${this.baseUrl}/agent/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action.trim(), parameters, stream: true }),
        });
        if (fallbackRes.ok) return fallbackRes;

        const errorText = await response.text();
        throw new BadGatewayException(
          `Sandbox agent stream failed (${response.status}): ${errorText}`,
        );
      }
      return response;
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sandbox service unreachable at ${url}: ${err.message}`,
      );
    }
  }

  /**
   * Streams skill execution via POST /skills/run/stream
   */
  async streamSkill(
    skillId: string,
    parameters: Record<string, unknown> = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}/skills/run/stream`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_id: skillId, parameters }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(
          `Sandbox skills stream failed (${response.status}): ${errorText}`,
        );
      }
      return response;
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(
        `Sandbox service unreachable at ${url}: ${err.message}`,
      );
    }
  }

  /**
   * Proxies an SSE stream directly from sandbox-service to an Express response.
   */
  async proxyStream(
    targetPath: string,
    payload: unknown,
    clientRes: any,
  ): Promise<void> {
    clientRes.setHeader('Content-Type', 'text/event-stream');
    clientRes.setHeader('Cache-Control', 'no-cache');
    clientRes.setHeader('Connection', 'keep-alive');
    clientRes.flushHeaders?.();

    const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    const url = `${this.baseUrl}${normalizedPath}`;

    try {
      const sandboxRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!sandboxRes.body || !sandboxRes.ok) {
        const errText = await sandboxRes.text().catch(() => '');
        clientRes.write(
          `event: error\ndata: ${JSON.stringify({
            status: sandboxRes.status,
            message: errText || 'Sandbox service streaming error',
          })}\n\n`,
        );
        clientRes.end();
        return;
      }

      const reader = sandboxRes.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          clientRes.write(value);
          clientRes.flush?.();
        }
      } finally {
        reader.releaseLock();
        clientRes.end();
      }
    } catch (err: any) {
      this.logger.error(`Error proxying sandbox stream from ${url}`, err);
      clientRes.write(
        `event: error\ndata: ${JSON.stringify({
          error: err.message || 'Stream proxying failed',
        })}\n\n`,
      );
      clientRes.end();
    }
  }

  /**
   * Robust SSE parser generator for reading Server-Sent Events from a Response.
   */
  async *parseSseStream(response: Response): AsyncGenerator<ParsedSseEvent> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const trimmedPart = part.trim();
          if (!trimmedPart) continue;

          let eventType = 'message';
          const dataLines: string[] = [];

          const lines = trimmedPart.split(/\r?\n/);
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith(':')) {
              // Comment / keep-alive comment
              continue;
            }
            if (trimmedLine.startsWith('event:')) {
              eventType = trimmedLine.slice(6).trim();
            } else if (trimmedLine.startsWith('data:')) {
              dataLines.push(trimmedLine.slice(5).trim());
            }
          }

          if (dataLines.length > 0 || eventType !== 'message') {
            const dataStr = dataLines.join('\n');
            let parsed: any;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              parsed = dataStr;
            }
            yield { event: eventType, data: dataStr, parsed };
          }
        }
      }

      // Flush remaining buffer if it has event/data
      if (buffer.trim()) {
        const lines = buffer.trim().split(/\r?\n/);
        let eventType = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith(':')) continue;
          if (trimmedLine.startsWith('event:')) {
            eventType = trimmedLine.slice(6).trim();
          } else if (trimmedLine.startsWith('data:')) {
            dataLines.push(trimmedLine.slice(5).trim());
          }
        }
        if (dataLines.length > 0 || eventType !== 'message') {
          const dataStr = dataLines.join('\n');
          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            parsed = dataStr;
          }
          yield { event: eventType, data: dataStr, parsed };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ==========================================
  // INSTRUCTIONAL SKILLS ENGINE API (/skills)
  // ==========================================

  async listSkills(): Promise<SkillDefinition[]> {
    const url = `${this.baseUrl}/skills`;
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        throw new BadGatewayException(`Failed to list skills (${response.status})`);
      }
      return (await response.json()) as SkillDefinition[];
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Failed to connect to skills engine: ${err.message}`);
    }
  }

  async getSkill(skillId: string): Promise<SkillDefinition> {
    const url = `${this.baseUrl}/skills/${encodeURIComponent(skillId)}`;
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        throw new BadGatewayException(`Failed to get skill '${skillId}' (${response.status})`);
      }
      return (await response.json()) as SkillDefinition;
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Failed to fetch skill: ${err.message}`);
    }
  }

  async registerSkill(skill: SkillDefinition): Promise<SkillDefinition> {
    const url = `${this.baseUrl}/skills`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skill),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to register skill (${response.status}): ${errorText}`);
      }
      return (await response.json()) as SkillDefinition;
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Failed to register skill: ${err.message}`);
    }
  }

  async deleteSkill(skillId: string): Promise<{ success: boolean; message: string }> {
    const url = `${this.baseUrl}/skills/${encodeURIComponent(skillId)}`;
    try {
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to delete skill (${response.status}): ${errorText}`);
      }
      return (await response.json()) as { success: boolean; message: string };
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Failed to delete skill: ${err.message}`);
    }
  }

  async runSkill(
    skillId: string,
    parameters: Record<string, unknown> = {},
  ): Promise<AgentActionResponse> {
    const url = `${this.baseUrl}/skills/run`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_id: skillId, parameters }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to execute skill (${response.status}): ${errorText}`);
      }
      return (await response.json()) as AgentActionResponse;
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Failed to run skill: ${err.message}`);
    }
  }

  // ==========================================
  // EXCEL TOOLS API REFERENCE (/excel)
  // ==========================================

  async createExcel(params: CreateExcelParams | Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/excel/create`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to create Excel file (${response.status}): ${errorText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Excel create failed: ${err.message}`);
    }
  }

  async inspectExcel(params: { filename?: string; file_content_base64?: string } | Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/excel/inspect`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to inspect Excel file (${response.status}): ${errorText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Excel inspect failed: ${err.message}`);
    }
  }

  async analyzeExcel(params: { filename?: string; sheet_name?: string } | Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/excel/analyze`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to analyze Excel file (${response.status}): ${errorText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Excel analyze failed: ${err.message}`);
    }
  }

  async convertExcelToCsv(params: {
    filename: string;
    sheet_name?: string;
    output_csv_filename?: string;
  } | Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/excel/convert-to-csv`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to convert Excel to CSV (${response.status}): ${errorText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Excel convert-to-csv failed: ${err.message}`);
    }
  }

  // ==========================================
  // WORD TOOLS API REFERENCE (/word)
  // ==========================================

  async createWord(params: CreateWordParams | Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/word/create`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to create Word document (${response.status}): ${errorText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Word create failed: ${err.message}`);
    }
  }

  async inspectWord(params: { filename?: string } | Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/word/inspect`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to inspect Word document (${response.status}): ${errorText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Word inspect failed: ${err.message}`);
    }
  }

  async readWord(params: { filename?: string } | Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/word/read`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to read Word document (${response.status}): ${errorText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Word read failed: ${err.message}`);
    }
  }

  async extractWordTables(params: { filename?: string } | Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}/word/extract-tables`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to extract Word tables (${response.status}): ${errorText}`);
      }
      return await response.json();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Word extract tables failed: ${err.message}`);
    }
  }

  // ==========================================
  // FILE MANAGEMENT UPDATES
  // ==========================================

  async getFileRaw(folder: string, filename: string): Promise<any> {
    const url = `${this.baseUrl}/files/raw/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        const errorText = await response.text();
        throw new BadGatewayException(`Failed to get raw file content (${response.status}): ${errorText}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    } catch (err: any) {
      if (err instanceof BadGatewayException) throw err;
      throw new BadGatewayException(`Get raw file failed: ${err.message}`);
    }
  }

  getFileDownloadUrl(folder: string, filename: string): string {
    return `${this.baseUrl}/files/download/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;
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
