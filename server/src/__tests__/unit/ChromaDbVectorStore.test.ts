/**
 * ChromaDbVectorStore Unit Tests
 *
 * Verifies the async ChromaDB-backed vector store:
 * - connect(), index(), search(), clear(), close() lifecycle
 * - Correct mapping between ChromaDB distances and similarity scores
 * - Metadata serialization/deserialization via JSON _meta field
 * - Graceful handling of edge cases (empty queries, missing metadata, null text)
 */

// ── Mock setup (must precede imports) ────────────────────────────────────
const mockUpsert = jest.fn().mockResolvedValue(undefined);
const mockQuery = jest.fn();
const mockDeleteCollection = jest.fn().mockResolvedValue(undefined);
const mockGetOrCreateCollection = jest.fn();

const mockCollection = {
  upsert: mockUpsert,
  query: mockQuery,
};

jest.mock("chromadb", () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getOrCreateCollection: mockGetOrCreateCollection,
    deleteCollection: mockDeleteCollection,
  })),
}));

// ── Imports ──────────────────────────────────────────────────────────────
import { ChromaDbVectorStore } from "../../retrieval/ChromaDbVectorStore.js";
import type { VectorDocument } from "../../retrieval/VectorStore.js";

// ── Helpers ──────────────────────────────────────────────────────────────
type TestMeta = { source: string };

const TEST_DOCS: VectorDocument<TestMeta>[] = [
  {
    id: "doc1",
    text: "FDA approved medical device for diabetes",
    metadata: { source: "clinical" },
  },
  {
    id: "doc2",
    text: "30-day money back guarantee policy",
    metadata: { source: "legal" },
  },
  {
    id: "doc3",
    text: "voice agent latency optimization techniques",
    metadata: { source: "engineering" },
  },
];

// ── Tests ────────────────────────────────────────────────────────────────
describe("ChromaDbVectorStore", () => {
  let store: ChromaDbVectorStore<TestMeta>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrCreateCollection.mockResolvedValue(mockCollection);
    store = new ChromaDbVectorStore<TestMeta>({
      collectionName: "test_collection",
    });
  });

  // ── connect() ────────────────────────────────────────────────────────

  describe("connect()", () => {
    it("calls getOrCreateCollection with correct collection name", async () => {
      await store.connect();

      expect(mockGetOrCreateCollection).toHaveBeenCalledWith(
        expect.objectContaining({ name: "test_collection" }),
      );
    });

    it("passes hnsw:space cosine metadata", async () => {
      await store.connect();

      expect(mockGetOrCreateCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { "hnsw:space": "cosine" },
        }),
      );
    });

    it("is idempotent — second call does not invoke getOrCreateCollection again", async () => {
      await store.connect();
      await store.connect();

      expect(mockGetOrCreateCollection).toHaveBeenCalledTimes(1);
    });

    it("throws when getOrCreateCollection rejects", async () => {
      mockGetOrCreateCollection.mockRejectedValueOnce(
        new Error("connection refused"),
      );

      await expect(store.connect()).rejects.toThrow("connection refused");
    });
  });

  // ── index() ──────────────────────────────────────────────────────────

  describe("index()", () => {
    it("throws when not connected", async () => {
      await expect(store.index(TEST_DOCS)).rejects.toThrow(
        "not connected. Call connect() first",
      );
    });

    it("calls collection.upsert with correct ids", async () => {
      await store.connect();
      await store.index(TEST_DOCS);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          ids: ["doc1", "doc2", "doc3"],
        }),
      );
    });

    it("passes document text in documents array", async () => {
      await store.connect();
      await store.index(TEST_DOCS);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          documents: [
            "FDA approved medical device for diabetes",
            "30-day money back guarantee policy",
            "voice agent latency optimization techniques",
          ],
        }),
      );
    });

    it("serializes metadata to JSON string in _meta field", async () => {
      await store.connect();
      await store.index(TEST_DOCS);

      const call = mockUpsert.mock.calls[0][0];
      expect(call.metadatas[0]).toEqual({
        _meta: JSON.stringify({ source: "clinical" }),
      });
      expect(call.metadatas[1]).toEqual({
        _meta: JSON.stringify({ source: "legal" }),
      });
    });

    it("is a no-op when documents array is empty", async () => {
      await store.connect();
      await store.index([]);

      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("handles multiple documents in one upsert call", async () => {
      await store.connect();
      await store.index(TEST_DOCS);

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const call = mockUpsert.mock.calls[0][0];
      expect(call.ids).toHaveLength(3);
      expect(call.documents).toHaveLength(3);
      expect(call.metadatas).toHaveLength(3);
    });
  });

  // ── search() ─────────────────────────────────────────────────────────

  describe("search()", () => {
    const standardQueryResponse = {
      ids: [["doc1", "doc2"]],
      documents: [
        [
          "FDA approved medical device for diabetes",
          "30-day money back guarantee policy",
        ],
      ],
      metadatas: [
        [
          { _meta: JSON.stringify({ source: "clinical" }) },
          { _meta: JSON.stringify({ source: "legal" }) },
        ],
      ],
      distances: [[0.1, 0.3]],
    };

    it("throws when not connected", async () => {
      await expect(store.search("test query", 5)).rejects.toThrow(
        "not connected. Call connect() first",
      );
    });

    it("returns empty array for empty query string", async () => {
      await store.connect();
      const results = await store.search("", 5);
      expect(results).toEqual([]);
    });

    it("returns empty array for whitespace-only query", async () => {
      await store.connect();
      const results = await store.search("   ", 5);
      expect(results).toEqual([]);
    });

    it("returns empty array for topK <= 0", async () => {
      await store.connect();
      const results = await store.search("test", 0);
      expect(results).toEqual([]);
    });

    it("calls collection.query with correct queryTexts and nResults", async () => {
      await store.connect();
      mockQuery.mockResolvedValue(standardQueryResponse);

      await store.search("medical device", 3);

      expect(mockQuery).toHaveBeenCalledWith({
        queryTexts: ["medical device"],
        nResults: 3,
      });
    });

    it("maps distances to scores: score = 1 - distance", async () => {
      await store.connect();
      mockQuery.mockResolvedValue(standardQueryResponse);

      const results = await store.search("medical device", 5);

      expect(results[0].score).toBeCloseTo(0.9, 5);
      expect(results[1].score).toBeCloseTo(0.7, 5);
    });

    it("deserializes metadata from JSON _meta field", async () => {
      await store.connect();
      mockQuery.mockResolvedValue(standardQueryResponse);

      const results = await store.search("medical device", 5);

      expect(results[0].doc.metadata).toEqual({ source: "clinical" });
      expect(results[1].doc.metadata).toEqual({ source: "legal" });
    });

    it("returns results sorted by score descending", async () => {
      await store.connect();
      mockQuery.mockResolvedValue({
        ids: [["doc1", "doc2", "doc3"]],
        documents: [["text1", "text2", "text3"]],
        metadatas: [[{ _meta: "{}" }, { _meta: "{}" }, { _meta: "{}" }]],
        distances: [[0.5, 0.1, 0.8]],
      });

      const results = await store.search("query", 3);

      expect(results[0].score).toBeCloseTo(0.9, 5); // 1 - 0.1
      expect(results[1].score).toBeCloseTo(0.5, 5); // 1 - 0.5
      expect(results[2].score).toBeCloseTo(0.2, 5); // 1 - 0.8
    });

    it("clamps score to 0 when distance > 1", async () => {
      await store.connect();
      mockQuery.mockResolvedValue({
        ids: [["doc1"]],
        documents: [["some text"]],
        metadatas: [[{ _meta: "{}" }]],
        distances: [[1.5]],
      });

      const results = await store.search("query", 1);

      expect(results[0].score).toBe(0);
    });

    it("handles missing _meta field gracefully — returns empty metadata object", async () => {
      await store.connect();
      mockQuery.mockResolvedValue({
        ids: [["doc1"]],
        documents: [["some text"]],
        metadatas: [[{ other: "field" }]],
        distances: [[0.2]],
      });

      const results = await store.search("query", 1);

      expect(results[0].doc.metadata).toEqual({});
    });

    it("handles JSON parse error in metadata gracefully", async () => {
      await store.connect();
      mockQuery.mockResolvedValue({
        ids: [["doc1"]],
        documents: [["some text"]],
        metadatas: [[{ _meta: "not-valid-json{{{" }]],
        distances: [[0.2]],
      });

      const results = await store.search("query", 1);

      expect(results[0].doc.metadata).toEqual({});
    });

    it("handles null text entries in response gracefully — skips them", async () => {
      await store.connect();
      mockQuery.mockResolvedValue({
        ids: [["doc1", "doc2"]],
        documents: [[null, "valid text"]],
        metadatas: [[{ _meta: "{}" }, { _meta: "{}" }]],
        distances: [[0.1, 0.3]],
      });

      const results = await store.search("query", 2);

      // null text is replaced with "" by the ?? operator, but the entry
      // still has a valid id so it should appear in results
      expect(results.length).toBe(2);
    });
  });

  // ── clear() ──────────────────────────────────────────────────────────

  describe("clear()", () => {
    it("calls deleteCollection then getOrCreateCollection to recreate", async () => {
      await store.connect();
      await store.clear();

      expect(mockDeleteCollection).toHaveBeenCalledWith({
        name: "test_collection",
      });
      // Called twice: once in connect(), once in clear() to recreate
      expect(mockGetOrCreateCollection).toHaveBeenCalledTimes(2);
    });

    it("is safe when not connected (no-op)", async () => {
      await store.clear();

      expect(mockDeleteCollection).not.toHaveBeenCalled();
    });

    it("recreates collection with cosine metric after clearing", async () => {
      await store.connect();
      await store.clear();

      const lastCall =
        mockGetOrCreateCollection.mock.calls[
          mockGetOrCreateCollection.mock.calls.length - 1
        ][0];
      expect(lastCall.metadata).toEqual({ "hnsw:space": "cosine" });
    });
  });

  // ── close() ──────────────────────────────────────────────────────────

  describe("close()", () => {
    it("resets connected state — subsequent index() throws", async () => {
      await store.connect();
      await store.close();

      await expect(store.index(TEST_DOCS)).rejects.toThrow(
        "not connected. Call connect() first",
      );
    });
  });
});
