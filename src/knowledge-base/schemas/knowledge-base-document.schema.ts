import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type KnowledgeBaseDocumentDocument = HydratedDocument<KnowledgeBaseDocument>;

@Schema({ collection: 'knowledge_base_documents', timestamps: true })
export class KnowledgeBaseDocument {
  @Prop({ required: true, unique: true, index: true })
  documentId: string;

  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  originalFilename: string;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  s3Key: string;

  @Prop({ index: true })
  folderId?: string;

  @Prop({ enum: ['pending_upload', 'uploaded', 'processing', 'ready', 'failed'], default: 'pending_upload', index: true })
  status: string;

  @Prop({ default: 0 })
  storedChunks: number;

  @Prop()
  error?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const KnowledgeBaseDocumentSchema = SchemaFactory.createForClass(KnowledgeBaseDocument);
