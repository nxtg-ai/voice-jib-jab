/**
 * TenantVectorStoreFactory Unit Tests
 *
 * Verifies the per-tenant ChromaDB vector store factory:
 * - Collection naming conventions (prefix_tenantId)
 * - Store caching and isolation between tenants
 * - Cache management (hasStore, size, clear)
 * - Singleton export
 */

// ── Mock setup (must precede imports) ────────────────────────────────────
const mockUpsert = jest.fn().mockResolvedValue(undefined);
const mockQuery = jest
  .fn()
  .mockResolvedValue({
    ids: [[]],
    documents: [[]],
    metadatas: [[]],
    distances: [[]],
  });
const mockDeleteCollection = jest.fn().mockResolvedValue(undefined);
const mockGetOrCreateCollection = jest
  .fn()
  .mockResolvedValue({ upsert: mockUpsert, query: mockQuery });

jest.mock("chromadb", () => ({
  ChromaClient: jest.fn().mockImplementation(() => ({
    getOrCreateCollection: mockGetOrCreateCollection,
    deleteCollection: mockDeleteCollection,
  })),
}));

// ── Imports ──────────────────────────────────────────────────────────────
import { TenantVectorStoreFactory } from "../../services/TenantVectorStoreFactory.js";
import { ChromaDbVectorStore } from "../../retrieval/ChromaDbVectorStore.js";

// ── Tests ────────────────────────────────────────────────────────────────
describe("TenantVectorStoreFactory", () => {
  let factory: TenantVectorStoreFactory;

  beforeEach(() => {
    jest.clearAllMocks();
    factory = new TenantVectorStoreFactory();
  });

  // ── getCollectionForTenant() ─────────────────────────────────────────

  describe("getCollectionForTenant()", () => {
    it("returns knowledge_{tenantId} with default prefix", () => {
      expect(factory.getCollectionForTenant("acme")).toBe("knowledge_acme");
    });

    it("returns custom_{tenantId} with custom collectionPrefix config", () => {
      const custom = new TenantVectorStoreFactory({
        collectionPrefix: "custom",
      });
      expect(custom.getCollectionForTenant("acme")).toBe("custom_acme");
    });

    it("maps 'default' tenant to knowledge_default", () => {
      expect(factory.getCollectionForTenant("default")).toBe(
        "knowledge_default",
      );
    });

    it("never returns a collection name containing just the prefix", () => {
      const name = factory.getCollectionForTenant("tenant1");
      expect(name).not.toBe("knowledge");
      expect(name).toContain("_");
      expect(name.split("_").length).toBeGreaterThan(1);
    });
  });

  // ── getStoreForTenant() ──────────────────────────────────────────────

  describe("getStoreForTenant()", () => {
    it("returns a ChromaDbVectorStore instance", () => {
      const store = factory.getStoreForTenant("acme");
      expect(store).toBeInstanceOf(ChromaDbVectorStore);
    });

    it("same tenantId returns same instance (cached)", () => {
      const store1 = factory.getStoreForTenant("acme");
      const store2 = factory.getStoreForTenant("acme");
      expect(store1).toBe(store2);
    });

    it("different tenantIds return different instances", () => {
      const store1 = factory.getStoreForTenant("acme");
      const store2 = factory.getStoreForTenant("globex");
      expect(store1).not.toBe(store2);
    });

    it("store collection name matches getCollectionForTenant() result", () => {
      const store = factory.getStoreForTenant("acme");
      expect(store.collectionName).toBe(
        factory.getCollectionForTenant("acme"),
      );
    });
  });

  // ── hasStore() ───────────────────────────────────────────────────────

  describe("hasStore()", () => {
    it("returns false before any store created", () => {
      expect(factory.hasStore("acme")).toBe(false);
    });

    it("returns true after getStoreForTenant() called", () => {
      factory.getStoreForTenant("acme");
      expect(factory.hasStore("acme")).toBe(true);
    });
  });

  // ── size ─────────────────────────────────────────────────────────────

  describe("size", () => {
    it("starts at 0", () => {
      expect(factory.size).toBe(0);
    });

    it("increments per unique tenant", () => {
      factory.getStoreForTenant("acme");
      expect(factory.size).toBe(1);

      factory.getStoreForTenant("globex");
      expect(factory.size).toBe(2);

      // Same tenant again — no increment
      factory.getStoreForTenant("acme");
      expect(factory.size).toBe(2);
    });
  });

  // ── clear() ──────────────────────────────────────────────────────────

  describe("clear()", () => {
    it("clear() with no arg removes all stores", () => {
      factory.getStoreForTenant("acme");
      factory.getStoreForTenant("globex");
      expect(factory.size).toBe(2);

      factory.clear();
      expect(factory.size).toBe(0);
      expect(factory.hasStore("acme")).toBe(false);
      expect(factory.hasStore("globex")).toBe(false);
    });

    it("clear(tenantId) removes only that tenant", () => {
      factory.getStoreForTenant("acme");
      factory.getStoreForTenant("globex");

      factory.clear("acme");

      expect(factory.hasStore("acme")).toBe(false);
      expect(factory.hasStore("globex")).toBe(true);
      expect(factory.size).toBe(1);
    });

    it("after clear, getStoreForTenant returns a new instance", () => {
      const before = factory.getStoreForTenant("acme");
      factory.clear("acme");
      const after = factory.getStoreForTenant("acme");

      expect(before).not.toBe(after);
    });
  });
});

// ── Tenant A/B isolation ────────────────────────────────────────────────

describe("Tenant A/B isolation", () => {
  let factory: TenantVectorStoreFactory;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrCreateCollection.mockResolvedValue({
      upsert: mockUpsert,
      query: mockQuery,
    });
    factory = new TenantVectorStoreFactory();
  });

  it("Tenant A and B get stores with different collection names", () => {
    const storeA = factory.getStoreForTenant("tenant-a");
    const storeB = factory.getStoreForTenant("tenant-b");

    expect(storeA.collectionName).toBe("knowledge_tenant-a");
    expect(storeB.collectionName).toBe("knowledge_tenant-b");
    expect(storeA.collectionName).not.toBe(storeB.collectionName);
  });

  it("indexing to tenant A store and querying tenant B store use separate mock calls", async () => {
    const storeA = factory.getStoreForTenant("tenant-a");
    const storeB = factory.getStoreForTenant("tenant-b");

    await storeA.connect();
    await storeB.connect();

    await storeA.index([
      { id: "a1", text: "tenant A document", metadata: {} },
    ]);
    await storeB.search("query", 5);

    // Both stores issue independent calls to their (mocked) collections
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("tenantVectorStoreFactory singleton is exported and is a TenantVectorStoreFactory instance", async () => {
    const { tenantVectorStoreFactory } = await import(
      "../../services/TenantVectorStoreFactory.js"
    );
    expect(tenantVectorStoreFactory).toBeInstanceOf(TenantVectorStoreFactory);
  });
});
