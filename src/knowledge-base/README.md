# Knowledge-base API

This module keeps the existing FastAPI embedding service unchanged. MongoDB stores document ownership and ingestion metadata; the embedding service/Qdrant continues to hold the embedded chunks.

## Flow

1. `POST /knowledge-base/documents/upload-url` creates the MongoDB document record and returns a five-minute S3 `PUT` URL.
2. Upload the file directly to that URL, then call `POST /knowledge-base/documents/:documentId/uploaded`.
3. An S3-event worker (or the caller during development) extracts the source document to text and calls `POST /knowledge-base/documents/:documentId/ingest` with `{"text":"..."}`. This endpoint calls the existing embedding API `/store` with the same `documentId`.
4. Use `POST /knowledge-base/search` for all documents, or `POST /knowledge-base/documents/:documentId/search` to search one document. Both routes return Qdrant chunks plus MongoDB document metadata.

## Direct chunk retrieval

`GET /knowledge-base/documents/:documentId/chunks` reads Qdrant directly and filters points where `payload.doc_id` is the supplied document ID. It uses the `QDRANT_URL`, `QDRANT_API_KEY`, and `QDRANT_COLLECTION_NAME` environment variables and does not require any change to the embedding API.

## Security

The `ownerId` fields are placeholders for your authentication user ID. Before exposing these routes publicly, derive it from the authenticated user rather than accepting it from the request body/query string.
