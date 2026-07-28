import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { CreateUploadDto } from './dto/create-upload.dto';
import { SearchKnowledgeBaseDto } from './dto/search-knowledge-base.dto';
import { StoreDocumentDto } from './dto/store-document.dto';
import { KnowledgeBaseDocument, KnowledgeBaseDocumentDocument } from './schemas/knowledge-base-document.schema';

interface QdrantChunkPoint {
  id: string;
  payload?: {
    text?: string;
    doc_id?: string;
  };
}

interface QdrantScrollResponse {
  result?: {
    points?: QdrantChunkPoint[];
    next_page_offset?: unknown;
  };
}

@Injectable()
export class KnowledgeBaseService {
  private readonly s3: S3Client;

  constructor(
    @InjectModel(KnowledgeBaseDocument.name)
    private readonly documents: Model<KnowledgeBaseDocument>,
    private readonly config: ConfigService,
  ) {
    this.s3 = new S3Client({ region: this.config.get<string>('AWS_REGION') });
  }

  async createUploadUrl(input: CreateUploadDto) {
    const bucket = this.config.get<string>('AWS_S3_KNOWLEDGE_BASE_BUCKET');
    if (!bucket) {
      throw new ServiceUnavailableException('AWS_S3_KNOWLEDGE_BASE_BUCKET is not configured');
    }

    const documentId = randomUUID();
    const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `knowledge-base/${input.ownerId}/${documentId}/${safeFilename}`;
    const document = await this.documents.create({
      documentId,
      ownerId: input.ownerId,
      title: input.title || input.filename,
      originalFilename: input.filename,
      contentType: input.contentType,
      s3Key,
      metadata: input.metadata || {},
    });

    try {
      const uploadUrl = await getSignedUrl(
        this.s3,
        new PutObjectCommand({ Bucket: bucket, Key: s3Key, ContentType: input.contentType }),
        { expiresIn: 300 },
      );
      return {
        document: this.serialize(document),
        // Keep uploadUrl for existing clients, but expose the complete upload
        // contract so frontend code does not navigate to this URL with GET.
        uploadUrl,
        upload: {
          url: uploadUrl,
          method: 'PUT',
          headers: { 'Content-Type': input.contentType },
        },
        expiresInSeconds: 300,
      };
    } catch (error) {
      await this.documents.findByIdAndDelete(document._id);
      throw new ServiceUnavailableException(`Could not create S3 upload URL: ${this.errorMessage(error)}`);
    }
  }

  async markUploaded(documentId: string) {
    return this.updateStatus(documentId, 'uploaded');
  }

  async ingest(documentId: string, input: StoreDocumentDto) {
    const document = await this.findDocument(documentId);
    await this.documents.updateOne({ documentId }, { status: 'processing', error: undefined });

    try {
      const response = await this.embeddingRequest('/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: input.text, doc_id: document.documentId }),
      });
      const result = await response.json() as { stored_chunks?: number; doc_id?: string };
      if (!response.ok) throw new Error(JSON.stringify(result));

      const updated = await this.documents.findOneAndUpdate(
        { documentId },
        { status: 'ready', storedChunks: result.stored_chunks || 0, error: undefined },
        { new: true },
      );
      return { document: this.serialize(updated!), embedding: result };
    } catch (error) {
      await this.documents.updateOne({ documentId }, { status: 'failed', error: this.errorMessage(error) });
      throw new BadGatewayException(`Embedding ingestion failed: ${this.errorMessage(error)}`);
    }
  }

  async search(input: SearchKnowledgeBaseDto, documentId?: string) {
    if (documentId) await this.findDocument(documentId);
    const params = new URLSearchParams({ query: input.query, top_k: String(input.topK || 3) });
    if (documentId) params.set('doc_id', documentId);
    const response = await this.embeddingRequest(`/search?${params.toString()}`, { method: 'POST' });
    const payload = await response.json() as { results?: Array<{ doc_id: string; text: string; score: number }> };
    if (!response.ok) throw new BadGatewayException(`Embedding search failed: ${JSON.stringify(payload)}`);

    const ids = [...new Set((payload.results || []).map((item) => item.doc_id))];
    const docs = await this.documents.find({ documentId: { $in: ids } }).lean();
    const byId = new Map(docs.map((doc) => [doc.documentId, doc]));
    return {
      results: (payload.results || []).map((item) => ({
        ...item,
        document: byId.has(item.doc_id) ? this.serialize(byId.get(item.doc_id)!) : null,
      })),
    };
  }

  async getDocument(documentId: string) {
    return this.serialize(await this.findDocument(documentId));
  }

  async listDocuments(ownerId?: string) {
    const filter = ownerId ? { ownerId } : {};
    const docs = await this.documents.find(filter).sort({ createdAt: -1 }).lean();
    return docs.map((document) => this.serialize(document));
  }

  async getStoredChunks(documentId: string) {
    await this.findDocument(documentId);
    const qdrantUrl = this.config.get<string>('QDRANT_URL');
    if (!qdrantUrl) throw new ServiceUnavailableException('QDRANT_URL is not configured');

    const collection = this.config.get<string>('QDRANT_COLLECTION_NAME') || 'documents';
    const apiKey = this.config.get<string>('QDRANT_API_KEY');
    const response = await fetch(`${qdrantUrl.replace(/\/$/, '')}/collections/${encodeURIComponent(collection)}/points/scroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        filter: {
          must: [{ key: 'doc_id', match: { value: documentId } }],
        },
        with_payload: true,
        with_vector: false,
        limit: 1_000,
      }),
    });
    const payload = (await response.json()) as QdrantScrollResponse;
    if (!response.ok) throw new BadGatewayException(`Qdrant chunk retrieval failed: ${JSON.stringify(payload)}`);
    return {
      documentId,
      chunks: (payload.result?.points || []).map((point) => ({
        chunkId: point.id,
        text: point.payload?.text,
        docId: point.payload?.doc_id,
      })),
      truncated: Boolean(payload.result?.next_page_offset),
    };
  }

  async remove(documentId: string) {
    const document = await this.findDocument(documentId);
    const response = await this.embeddingRequest(`/delete/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
    if (!response.ok) throw new BadGatewayException('Could not delete vectors from the embedding API');

    const bucket = this.config.get<string>('AWS_S3_KNOWLEDGE_BASE_BUCKET');
    if (bucket) {
      try {
        await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: document.s3Key }));
      } catch (error) {
        throw new BadGatewayException(`Vectors were deleted, but the S3 source could not be deleted: ${this.errorMessage(error)}`);
      }
    }
    await this.documents.deleteOne({ documentId });
    return { documentId, deleted: true };
  }

  private async findDocument(documentId: string): Promise<KnowledgeBaseDocumentDocument> {
    const document = await this.documents.findOne({ documentId });
    if (!document) throw new NotFoundException(`Knowledge-base document ${documentId} was not found`);
    return document;
  }

  private async updateStatus(documentId: string, status: string) {
    const document = await this.documents.findOneAndUpdate({ documentId }, { status }, { new: true });
    if (!document) throw new NotFoundException(`Knowledge-base document ${documentId} was not found`);
    return this.serialize(document);
  }

  private async embeddingRequest(path: string, init: RequestInit): Promise<Response> {
    // EMBEDDING_API is the variable already used by the existing GenAI module.
    // EMBEDDING_API_URL remains supported for a clearer knowledge-base-specific name.
    const baseUrl = this.config.get<string>('EMBEDDING_API_URL') || this.config.get<string>('EMBEDDING_API');
    if (!baseUrl) throw new ServiceUnavailableException('EMBEDDING_API or EMBEDDING_API_URL is not configured');
    try {
      return await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, init);
    } catch (error) {
      throw new BadGatewayException(`Embedding API is unavailable: ${this.errorMessage(error)}`);
    }
  }

  private serialize(document: KnowledgeBaseDocument | Record<string, any>) {
    const value = typeof (document as any).toObject === 'function' ? (document as any).toObject() : document;
    const { _id, __v, ...rest } = value;
    return rest;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
