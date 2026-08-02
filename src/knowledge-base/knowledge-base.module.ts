import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseDocument, KnowledgeBaseDocumentSchema } from './schemas/knowledge-base-document.schema';
import { KnowledgeBaseFolder, KnowledgeBaseFolderSchema } from './schemas/knowledge-base-folder.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KnowledgeBaseDocument.name, schema: KnowledgeBaseDocumentSchema },
      { name: KnowledgeBaseFolder.name, schema: KnowledgeBaseFolderSchema },
    ]),
  ],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
