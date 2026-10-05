import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { WorkflowEdge, WorkflowNode } from '../workflow.types';

export class CreateWorkflowDto {
  // Temporary until Auth0 is connected. It will then come from the access token.
  @IsString()
  @IsNotEmpty()
  ownerId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  version?: number;

  @IsOptional()
  @IsArray()
  nodes?: WorkflowNode[];

  @IsOptional()
  @IsArray()
  edges?: WorkflowEdge[];

  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';
}
