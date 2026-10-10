import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { SonarModelChat } from './genAI.service';
import { chat } from './dto/chatDto';
import { ragStore } from './dto/ragDto';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { SandboxService } from './sandbox.service';

@Controller('genAI')
export class GenAIController {
  constructor(
    private readonly sonarModelChat: SonarModelChat,
    private readonly workflowRuntime: WorkflowRuntimeService,
    private readonly sandbox: SandboxService,
  ) {}

  @Post('chat')
  async chat(@Body() body: chat, @Res() res: any) {
    if (body.workflowName) {
      if (body.stream) {
        return this.workflowRuntime.runStream(body, res);
      }
      const data = await this.workflowRuntime.run(body);
      return res.json(data);
    }

    // Streaming responses must be handled manually
    if (body.stream) {
      return this.sonarModelChat.chatStream(body, res);
    }

    // Normal JSON response (NestJS handles it automatically)
    const data = await this.sonarModelChat.chat(body);
    return res.json(data);
  }

  /** Live model catalogue for the model-selection UI. */
  @Get('models')
  async models() {
    return this.sonarModelChat.listModels();
  }

  @Post('ragStore')
  async ragStore(@Body() body: ragStore) {
    return this.sonarModelChat.ragStore(body);
  }

  // ==========================================
  // SANDBOX STREAMING PROXIES
  // ==========================================

  @Post('sandbox/execute/stream')
  async streamPythonExecute(@Body() body: any, @Res() res: any) {
    return this.sandbox.proxyStream('/execute/stream', body, res);
  }

  @Post('sandbox/agent/run/stream')
  async streamAgentRun(@Body() body: any, @Res() res: any) {
    return this.sandbox.proxyStream('/agent/run/stream', body, res);
  }

  @Post('sandbox/skills/run/stream')
  async streamSkillRun(@Body() body: any, @Res() res: any) {
    return this.sandbox.proxyStream('/skills/run/stream', body, res);
  }

  // ==========================================
  // SANDBOX EXECUTION & AGENT ACTIONS
  // ==========================================

  @Post('sandbox/execute')
  async executePython(@Body() body: any) {
    return this.sandbox.executePython(
      body.code,
      body.timeout_seconds ?? body.timeoutSeconds ?? 30,
      body.input_files ?? body.inputFiles,
      body.env_vars ?? body.envVars,
    );
  }

  @Post('sandbox/agent/run')
  async runAgentAction(@Body() body: any, @Res() res: any) {
    if (body.stream) {
      return this.sandbox.proxyStream('/agent/run/stream', body, res);
    }
    const result = await this.sandbox.runAgentAction(
      body.action,
      body.parameters || {},
    );
    return res.json(result);
  }

  // ==========================================
  // INSTRUCTIONAL SKILLS ENGINE (/skills)
  // ==========================================

  @Get('sandbox/skills')
  async listSkills() {
    return this.sandbox.listSkills();
  }

  @Get('sandbox/skills/:skillId')
  async getSkill(@Param('skillId') skillId: string) {
    return this.sandbox.getSkill(skillId);
  }

  @Post('sandbox/skills')
  async registerSkill(@Body() body: any) {
    return this.sandbox.registerSkill(body);
  }

  @Delete('sandbox/skills/:skillId')
  async deleteSkill(@Param('skillId') skillId: string) {
    return this.sandbox.deleteSkill(skillId);
  }

  @Post('sandbox/skills/run')
  async runSkill(@Body() body: any, @Res() res: any) {
    if (body.stream) {
      return this.sandbox.proxyStream('/skills/run/stream', body, res);
    }
    const result = await this.sandbox.runSkill(
      body.skill_id || body.skillId,
      body.parameters || {},
    );
    return res.json(result);
  }

  // ==========================================
  // EXCEL PROCESSING TOOLS (/excel)
  // ==========================================

  @Post('sandbox/excel/create')
  async createExcel(@Body() body: any) {
    return this.sandbox.createExcel(body);
  }

  @Post('sandbox/excel/inspect')
  async inspectExcel(@Body() body: any) {
    return this.sandbox.inspectExcel(body);
  }

  @Post('sandbox/excel/analyze')
  async analyzeExcel(@Body() body: any) {
    return this.sandbox.analyzeExcel(body);
  }

  @Post('sandbox/excel/convert-to-csv')
  async convertExcelToCsv(@Body() body: any) {
    return this.sandbox.convertExcelToCsv(body);
  }

  // ==========================================
  // WORD PROCESSING TOOLS (/word)
  // ==========================================

  @Post('sandbox/word/create')
  async createWord(@Body() body: any) {
    return this.sandbox.createWord(body);
  }

  @Post('sandbox/word/inspect')
  async inspectWord(@Body() body: any) {
    return this.sandbox.inspectWord(body);
  }

  @Post('sandbox/word/read')
  async readWord(@Body() body: any) {
    return this.sandbox.readWord(body);
  }

  @Post('sandbox/word/extract-tables')
  async extractWordTables(@Body() body: any) {
    return this.sandbox.extractWordTables(body);
  }

  // ==========================================
  // FILE MANAGEMENT
  // ==========================================

  @Get('sandbox/files')
  async listFiles() {
    return this.sandbox.listFiles();
  }

  @Get('sandbox/files/raw/:folder/:filename')
  async getRawFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
  ) {
    return this.sandbox.getFileRaw(folder, filename);
  }
}
