import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseDocument, KnowledgeBaseDocumentSchema } from './schemas/knowledge-base-document.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: KnowledgeBaseDocument.name, schema: KnowledgeBaseDocumentSchema }])],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
