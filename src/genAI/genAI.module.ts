import { Module } from '@nestjs/common';
import { SonarModelChat } from './genAI.service';
import { GenAIController } from './genAI.controller';
import { chatAgents } from './agents/agents';
import { SonarApiTools } from './tools/sonarApiTools';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { WorkflowModule } from '../workflows/workflow.module';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@Module({
  imports: [KnowledgeBaseModule, WorkflowModule],
  providers: [
    SonarModelChat,
    chatAgents,
    SonarApiTools,
    WorkflowRuntimeService,
  ],
  controllers: [GenAIController],
})
export class GenAIModule {}
