# Knowledge-base frontend API

Base URL while running locally: `http://localhost:3000/knowledge-base`.

The knowledge-base module uses three services:

| Service | Purpose |
| --- | --- |
| MongoDB | Document record, owner, S3 object key, ingestion status, and errors |
| S3 | The original uploaded file |
| Existing embedding API + Qdrant | Text chunks, embeddings, semantic search, and direct chunk retrieval |

The mobile/frontend app must only call this NestJS API. Do not include AWS credentials, MongoDB credentials, Qdrant keys, or the embedding-service URL in frontend code.

## Required environment variables

```env
MONGODB_DATABASE_URI=...
EMBEDDING_API=http://127.0.0.1:8000
AWS_REGION=ap-south-1
AWS_S3_KNOWLEDGE_BASE_BUCKET=your-private-bucket
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Needed by direct GET /documents/:documentId/chunks
QDRANT_URL=...
QDRANT_API_KEY=...
QDRANT_COLLECTION_NAME=documents
```

`EMBEDDING_API_URL` is also accepted as an alias, but `EMBEDDING_API` matches the app's existing configuration.

## Document lifecycle

```text
1. Frontend asks for an upload URL
2. Frontend PUTs the selected file to S3 using that URL
3. Frontend marks the upload complete
4. Text extraction sends plain text to ingest
5. NestJS calls the existing embedding API /store
6. Search returns the most relevant stored chunks
```

The current NestJS endpoint accepts extracted text in step 4. PDF/DOCX extraction is not performed in the browser API. During development, send text from a `.txt`/Markdown source; in production, an S3-event worker should extract PDF/DOCX text and call the same ingest endpoint.

## 1. Create an upload URL

`POST /knowledge-base/documents/upload-url`

```json
{
  "filename": "remote-work-policy.pdf",
  "contentType": "application/pdf",
  "ownerId": "current-user-id",
  "title": "Remote Work Policy",
  "metadata": { "category": "hr" }
}
```

Example response:

```json
{
  "document": {
    "documentId": "1e4a...",
    "ownerId": "current-user-id",
    "title": "Remote Work Policy",
    "originalFilename": "remote-work-policy.pdf",
    "contentType": "application/pdf",
    "s3Key": "knowledge-base/current-user-id/1e4a.../remote-work-policy.pdf",
    "status": "pending_upload",
    "storedChunks": 0,
    "metadata": { "category": "hr" }
  },
  "uploadUrl": "https://...",
  "upload": {
    "url": "https://...",
    "method": "PUT",
    "headers": { "Content-Type": "application/pdf" }
  },
  "expiresInSeconds": 300
}
```

Save `document.documentId`; it is the ID used by every following endpoint. The URL expires in five minutes.

## 2. Upload the file directly to S3

Do not send the file to the NestJS server. Use `upload.url` exactly as returned and make a `PUT` request. Do **not** open this URL in a browser tab or navigate to it: navigation sends `GET`, which causes S3 `SignatureDoesNotMatch` because the URL was signed for `PUT`.

```ts
const createResponse = await fetch(`${API_URL}/knowledge-base/documents/upload-url`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    ownerId: currentUserId,
    title: file.name,
  }),
});

const { document, upload } = await createResponse.json();

const uploadResponse = await fetch(upload.url, {
  method: upload.method, // PUT
  headers: upload.headers,
  body: file,
});

if (!uploadResponse.ok) throw new Error(`S3 upload failed: ${uploadResponse.status}`);

await fetch(`${API_URL}/knowledge-base/documents/${document.documentId}/uploaded`, {
  method: 'POST',
});
```

The `Content-Type` header must match the `contentType` passed when creating the URL. If S3 reports `SignatureDoesNotMatch` and its error shows `CanonicalRequest>GET`, the frontend is using the signed URL as a page/download URL rather than uploading the file with `PUT`.

## 3. Confirm upload

`POST /knowledge-base/documents/:documentId/uploaded`

No body is required. It changes the document status to `uploaded`.

## 4. Ingest text into the existing embeddings API

`POST /knowledge-base/documents/:documentId/ingest`

```json
{
  "text": "Employees may work remotely up to three days per week..."
}
```

Success response:

```json
{
  "document": {
    "documentId": "1e4a...",
    "status": "ready",
    "storedChunks": 4
  },
  "embedding": { "stored_chunks": 4, "doc_id": "1e4a..." }
}
```

This calls your unchanged FastAPI `/store` endpoint with the same `documentId`. If it fails, document status becomes `failed` and the error is saved in MongoDB.

## 5. Search all knowledge-base documents

`POST /knowledge-base/search`

```json
{ "query": "How many remote days are allowed?", "topK": 3 }
```

Result:

```json
{
  "results": [
    {
      "text": "Employees may work remotely up to three days per week...",
      "doc_id": "1e4a...",
      "score": 0.89,
      "document": {
        "documentId": "1e4a...",
        "title": "Remote Work Policy",
        "status": "ready"
      }
    }
  ]
}
```

`topK` is optional and must be between 1 and 20 (default: 3).

## 6. Search within one document

`POST /knowledge-base/documents/:documentId/search`

```json
{ "query": "remote days", "topK": 5 }
```

Only chunks whose Qdrant payload has that `doc_id` are returned.

## 7. Retrieve all stored chunks for a document

`GET /knowledge-base/documents/:documentId/chunks`

```json
{
  "documentId": "1e4a...",
  "chunks": [
    {
      "chunkId": "qdrant-point-id",
      "docId": "1e4a...",
      "text": "Employees may work remotely..."
    }
  ],
  "truncated": false
}
```

This needs `QDRANT_URL` (and `QDRANT_API_KEY` for Qdrant Cloud). The original embedding API does not store `chunk_index`, so this endpoint returns all chunks but cannot promise original-document ordering.

## 8. Get document records

- `GET /knowledge-base/documents` — list all documents.
- `GET /knowledge-base/documents?ownerId=current-user-id` — list one user's documents.
- `GET /knowledge-base/documents/:documentId` — get one document and its ingestion status.

## 9. Delete a document

`DELETE /knowledge-base/documents/:documentId`

Deletes the Qdrant vectors via the existing embedding API, the S3 source file, and its MongoDB record.

## Status values and frontend behavior

| Status | Frontend treatment |
| --- | --- |
| `pending_upload` | Show “waiting for upload” |
| `uploaded` | Show “ready to process” |
| `processing` | Disable search for this document and show progress |
| `ready` | Allow search and display chunk count |
| `failed` | Show document error and provide an ingest retry action |

## Important production change

`ownerId` is currently accepted from the request body/query for easy local testing. Once authentication is connected, derive this value from the logged-in user token on the server and enforce it for every read, search, and delete request.
