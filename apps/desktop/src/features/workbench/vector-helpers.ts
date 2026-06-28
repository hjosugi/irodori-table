import type { DbEngine } from "@/generated/irodori-api";

export type VectorHelperTemplate = {
  id: string;
  label: string;
  detail: string;
  insertText: string;
};

export function isVectorEngine(engine: DbEngine) {
  return engine === "qdrant" || engine === "milvus" || engine === "pinecone";
}

export function vectorHelperTemplates(
  engine: DbEngine,
): VectorHelperTemplate[] {
  switch (engine) {
    case "qdrant":
      return [
        {
          id: "qdrant-search",
          label: "Top K search",
          detail: "Qdrant /points/search request",
          insertText: `POST /collections/{collection}/points/search
{
  "vector": [0.1, 0.2, 0.3],
  "limit": 10,
  "with_payload": true,
  "with_vector": false
}`,
        },
        {
          id: "qdrant-collections",
          label: "Collections",
          detail: "List collections",
          insertText: "GET /collections",
        },
        {
          id: "qdrant-upsert",
          label: "Upsert vectors",
          detail: "Insert or replace points",
          insertText: `PUT /collections/{collection}/points
{
  "points": [
    {
      "id": "doc-1",
      "vector": [0.1, 0.2, 0.3],
      "payload": { "title": "Example" }
    }
  ]
}`,
        },
      ];
    case "milvus":
      return [
        {
          id: "milvus-search",
          label: "Top K search",
          detail: "Milvus vector search shape",
          insertText: `-- Milvus vector search
collection: documents
vector_field: embedding
metric_type: COSINE
top_k: 10
vector: [0.1, 0.2, 0.3]
output_fields: ["id", "title"]`,
        },
        {
          id: "milvus-describe",
          label: "Describe collection",
          detail: "Inspect fields and indexes",
          insertText: "DESCRIBE COLLECTION documents;",
        },
        {
          id: "milvus-index",
          label: "Index hint",
          detail: "Common HNSW/COSINE index options",
          insertText: `-- Milvus HNSW index options
field: embedding
index_type: HNSW
metric_type: COSINE
params: { "M": 16, "efConstruction": 200 }`,
        },
      ];
    case "pinecone":
      return [
        {
          id: "pinecone-query",
          label: "Top K search",
          detail: "Pinecone query request",
          insertText: `POST /query
{
  "namespace": "",
  "topK": 10,
  "vector": [0.1, 0.2, 0.3],
  "includeMetadata": true,
  "includeValues": false
}`,
        },
        {
          id: "pinecone-stats",
          label: "Index stats",
          detail: "Describe index statistics",
          insertText: "POST /describe_index_stats\n{}",
        },
        {
          id: "pinecone-upsert",
          label: "Upsert vectors",
          detail: "Insert vectors with metadata",
          insertText: `POST /vectors/upsert
{
  "namespace": "",
  "vectors": [
    {
      "id": "doc-1",
      "values": [0.1, 0.2, 0.3],
      "metadata": { "title": "Example" }
    }
  ]
}`,
        },
      ];
    default:
      return [];
  }
}
