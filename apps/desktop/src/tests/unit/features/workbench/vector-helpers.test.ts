import { describe, expect, it } from "vitest";
import {
  isVectorEngine,
  vectorHelperTemplates,
} from "@/features/workbench/vector-helpers";

describe("vector helper templates", () => {
  it("detects vector database engines", () => {
    expect(isVectorEngine("qdrant")).toBe(true);
    expect(isVectorEngine("milvus")).toBe(true);
    expect(isVectorEngine("pinecone")).toBe(true);
    expect(isVectorEngine("postgres")).toBe(false);
  });

  it("provides search templates for supported vector engines", () => {
    expect(vectorHelperTemplates("qdrant")[0].insertText).toContain(
      "/points/search",
    );
    expect(vectorHelperTemplates("milvus")[0].insertText).toContain("top_k");
    expect(vectorHelperTemplates("pinecone")[0].insertText).toContain("topK");
  });
});
