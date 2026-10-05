import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowController } from './workflow.controller';
import { WorkflowRegistryService } from './workflow-registry.service';
import { Workflow, WorkflowSchema } from './schemas/workflow.schema';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workflow.name, schema: WorkflowSchema },
    ]),
  ],
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowRegistryService],
  exports: [WorkflowService, WorkflowRegistryService],
})
export class WorkflowModule {}
