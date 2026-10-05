import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { WorkflowEdge, WorkflowNode } from '../workflow.types';

export type WorkflowDocument = HydratedDocument<Workflow>;

@Schema({ collection: 'workflows', timestamps: true })
export class Workflow {
  @Prop({ required: true, unique: true, index: true })
  workflowId: string;

  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ enum: ['draft', 'published'], default: 'draft', index: true })
  status: 'draft' | 'published';

  @Prop({ default: 1 })
  version: number;

  @Prop({ type: [Object], required: true })
  nodes: WorkflowNode[];

  @Prop({ type: [Object], required: true })
  edges: WorkflowEdge[];
}

export const WorkflowSchema = SchemaFactory.createForClass(Workflow);
WorkflowSchema.index({ ownerId: 1, updatedAt: -1 });
