import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type KnowledgeBaseFolderDocument = HydratedDocument<KnowledgeBaseFolder>;

@Schema({ collection: 'knowledge_base_folders', timestamps: true })
export class KnowledgeBaseFolder {
  @Prop({ required: true, unique: true, index: true })
  folderId: string;

  @Prop({ required: true, index: true })
  ownerId: string;

  @Prop({ required: true })
  name: string;
}

export const KnowledgeBaseFolderSchema = SchemaFactory.createForClass(KnowledgeBaseFolder);
