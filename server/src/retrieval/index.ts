/**
 * Retrieval module exports and singleton initialization.
 */

import { RetrievalService } from "./RetrievalService.js";

function getEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

/** Pre-configured retrieval service singleton for RAG queries. */
export const retrievalService = new RetrievalService({
  topK: getEnvNumber("RAG_TOP_K", 5),
  maxTokens: getEnvNumber("RAG_MAX_TOKENS", 600),
  maxBytes: getEnvNumber("RAG_MAX_BYTES", 4000),
});

/** Retrieve relevant knowledge facts for a query from the RAG pipeline. */
export function retrieve_nxtg_facts(query: string, topK?: number) {
  return retrievalService.retrieveFactsPack(query, { topK });
}

/** Look up a specific disclaimer by its identifier. */
export function lookup_disclaimer(disclaimerId: string) {
  return retrievalService.lookupDisclaimer(disclaimerId);
}

/** Core retrieval service with fact-pack and disclaimer queries. */
export { RetrievalService } from "./RetrievalService.js";
/** End-to-end RAG pipeline: embed, search, rerank, and format context. */
export { RAGPipeline } from "./RAGPipeline.js";
/** Structured knowledge pack loaded from YAML/JSON fact files. */
export { KnowledgePack } from "./KnowledgePack.js";
/** ChromaDB-backed vector store for semantic similarity search. */
export { VectorStore } from "./VectorStore.js";
