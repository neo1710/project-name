import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CreateUploadDto } from './dto/create-upload.dto';
import { CreateFolderDto } from './dto/create-folder.dto';
import { SearchKnowledgeBaseDto } from './dto/search-knowledge-base.dto';
import { StoreDocumentDto } from './dto/store-document.dto';
import { KnowledgeBaseService } from './knowledge-base.service';

@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBase: KnowledgeBaseService) {}

  @Post('documents/upload-url')
  createUploadUrl(@Body() body: CreateUploadDto) {
    return this.knowledgeBase.createUploadUrl(body);
  }

  @Post('folders')
  createFolder(@Body() body: CreateFolderDto) {
    return this.knowledgeBase.createFolder(body);
  }

  @Post('folders/:folderId/documents/upload-url')
  createFolderUploadUrl(@Param('folderId') folderId: string, @Body() body: CreateUploadDto) {
    return this.knowledgeBase.createUploadUrl(body, folderId);
  }

  @Post('documents/:documentId/uploaded')
  markUploaded(@Param('documentId') documentId: string) {
    return this.knowledgeBase.markUploaded(documentId);
  }

  @Post('documents/:documentId/ingest')
  ingest(@Param('documentId') documentId: string, @Body() body: StoreDocumentDto) {
    return this.knowledgeBase.ingest(documentId, body);
  }

  @Post('search')
  search(@Body() body: SearchKnowledgeBaseDto) {
    return this.knowledgeBase.search(body);
  }

  @Post('documents/:documentId/search')
  searchDocument(@Param('documentId') documentId: string, @Body() body: SearchKnowledgeBaseDto) {
    return this.knowledgeBase.search(body, documentId);
  }

  @Get('documents')
  listDocuments(@Query('ownerId') ownerId?: string) {
    return this.knowledgeBase.listDocuments(ownerId);
  }

  @Get('documents/:documentId')
  getDocument(@Param('documentId') documentId: string) {
    return this.knowledgeBase.getDocument(documentId);
  }

  @Get('documents/:documentId/download-url')
  createDownloadUrl(@Param('documentId') documentId: string) {
    return this.knowledgeBase.createDownloadUrl(documentId);
  }

  @Get('documents/:documentId/chunks')
  getStoredChunks(@Param('documentId') documentId: string) {
    return this.knowledgeBase.getStoredChunks(documentId);
  }

  @Delete('documents/:documentId')
  remove(@Param('documentId') documentId: string) {
    return this.knowledgeBase.remove(documentId);
  }
}
