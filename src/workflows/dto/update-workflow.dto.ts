import { IsArray, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { WorkflowEdge, WorkflowNode } from '../workflow.types';

export class UpdateWorkflowDto {
  // The currently loaded version. When present it prevents stale saves.
  @IsOptional()
  version?: number | string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';

  @IsOptional()
  @IsArray()
  nodes?: WorkflowNode[];

  @IsOptional()
  @IsArray()
  edges?: WorkflowEdge[];

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  workflowId?: string;
}
