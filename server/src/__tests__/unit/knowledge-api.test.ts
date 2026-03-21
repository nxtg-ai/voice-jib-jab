/**
 * Knowledge Base API tests
 *
 * Tests the router produced by createKnowledgeRouter().
 * KnowledgeBaseStore is fully mocked with jest.fn().
 *
 * HTTP transport uses the plain Node http helper shared across API test files.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createKnowledgeRouter } from "../../api/knowledge.js";
import type { KnowledgeBaseStore } from "../../services/KnowledgeBaseStore.js";
import type { KbEntry } from "../../services/KnowledgeBaseStore.js";

// ── Mock store ────────────────────────────────────────────────────────

const mockStore = {
  listEntries: jest.fn(),
  addEntry: jest.fn(),
  search: jest.fn(),
  incrementHit: jest.fn(),
  getEntry: jest.fn(),
  updateEntry: jest.fn(),
  deleteEntry: jest.fn(),
  clearTenant: jest.fn(),
};

// ── HTTP helper ───────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const payload =
      body !== undefined ? JSON.stringify(body) : undefined;

    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }
        : {},
    };

    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: rawBody,
            json: () => JSON.parse(rawBody),
          });
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ── App builder ───────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/tenants", createKnowledgeRouter(mockStore as unknown as KnowledgeBaseStore));
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = "org_acme";
const ENTRY_ID = "entry-123";

function makeEntry(overrides: Partial<KbEntry> = {}): KbEntry {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    question: "How do I reset my password?",
    answer: "Click Settings then Reset.",
    tags: ["auth", "password"],
    source: "manual",
    hitCount: 0,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Knowledge Base API", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildApp());
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Middleware: tenantId validation ───────────────────────────────

  describe("tenantId middleware", () => {
    it("passes valid alphanumeric tenantId through to the route", async () => {
      mockStore.listEntries.mockReturnValue([]);

      const res = await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb`);

      expect(res.status).toBe(200);
    });

    it("passes tenantId with underscores and hyphens through", async () => {
      mockStore.listEntries.mockReturnValue([]);

      const res = await httpRequest(server, "GET", `/tenants/org_acme-prod/kb`);

      expect(res.status).toBe(200);
    });

    it("returns 400 for tenantId with spaces", async () => {
      const res = await httpRequest(server, "GET", `/tenants/org%20acme/kb`);

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Invalid tenantId format");
    });

    it("returns 400 for tenantId with special chars (@)", async () => {
      const res = await httpRequest(server, "GET", `/tenants/org@acme/kb`);

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Invalid tenantId format");
    });
  });

  // ── GET /:tenantId/kb ─────────────────────────────────────────────

  describe("GET /tenants/:tenantId/kb", () => {
    it("returns 200 with entries array and count", async () => {
      const entries = [makeEntry()];
      mockStore.listEntries.mockReturnValue(entries);

      const res = await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb`);

      expect(res.status).toBe(200);
      const data = res.json() as { tenantId: string; entries: KbEntry[]; count: number };
      expect(data.tenantId).toBe(TENANT_ID);
      expect(data.entries).toHaveLength(1);
      expect(data.count).toBe(1);
    });

    it("passes tag query param to listEntries", async () => {
      mockStore.listEntries.mockReturnValue([]);

      await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb?tag=auth`);

      expect(mockStore.listEntries).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ tag: "auth" }),
      );
    });

    it("passes source=manual to listEntries", async () => {
      mockStore.listEntries.mockReturnValue([]);

      await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb?source=manual`);

      expect(mockStore.listEntries).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ source: "manual" }),
      );
    });

    it("passes source=extracted to listEntries", async () => {
      mockStore.listEntries.mockReturnValue([]);

      await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb?source=extracted`);

      expect(mockStore.listEntries).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ source: "extracted" }),
      );
    });

    it("passes source=undefined when source value is invalid", async () => {
      mockStore.listEntries.mockReturnValue([]);

      await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb?source=other`);

      expect(mockStore.listEntries).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ source: undefined }),
      );
    });

    it("passes both tag and source as undefined when no query params", async () => {
      mockStore.listEntries.mockReturnValue([]);

      await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb`);

      expect(mockStore.listEntries).toHaveBeenCalledWith(
        TENANT_ID,
        { tag: undefined, source: undefined },
      );
    });
  });

  // ── POST /:tenantId/kb ────────────────────────────────────────────

  describe("POST /tenants/:tenantId/kb", () => {
    it("returns 400 when question is missing", async () => {
      const res = await httpRequest(
        server,
        "POST",
        `/tenants/${TENANT_ID}/kb`,
        { answer: "Some answer" },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("question");
      expect(mockStore.addEntry).not.toHaveBeenCalled();
    });

    it("returns 400 when question is not a string", async () => {
      const res = await httpRequest(
        server,
        "POST",
        `/tenants/${TENANT_ID}/kb`,
        { question: 42, answer: "Some answer" },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("question");
    });

    it("returns 400 when answer is missing", async () => {
      const res = await httpRequest(
        server,
        "POST",
        `/tenants/${TENANT_ID}/kb`,
        { question: "What is this?" },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("answer");
      expect(mockStore.addEntry).not.toHaveBeenCalled();
    });

    it("returns 400 when answer is not a string", async () => {
      const res = await httpRequest(
        server,
        "POST",
        `/tenants/${TENANT_ID}/kb`,
        { question: "What is this?", answer: true },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("answer");
    });

    it("returns 400 when tags is not an array", async () => {
      const res = await httpRequest(
        server,
        "POST",
        `/tenants/${TENANT_ID}/kb`,
        { question: "What?", answer: "This.", tags: "not-array" },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tags");
    });

    it("returns 400 when tags is array of non-strings", async () => {
      const res = await httpRequest(
        server,
        "POST",
        `/tenants/${TENANT_ID}/kb`,
        { question: "What?", answer: "This.", tags: [1, 2, 3] },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tags");
    });

    it("returns 201 with created entry when tags is omitted", async () => {
      const entry = makeEntry({ tags: [] });
      mockStore.addEntry.mockReturnValue(entry);

      const res = await httpRequest(
        server,
        "POST",
        `/tenants/${TENANT_ID}/kb`,
        { question: "How do I reset?", answer: "Click Settings." },
      );

      expect(res.status).toBe(201);
      expect(mockStore.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          question: "How do I reset?",
          answer: "Click Settings.",
          tags: undefined,
        }),
      );
    });

    it("returns 201 with created entry when valid body with tags provided", async () => {
      const entry = makeEntry();
      mockStore.addEntry.mockReturnValue(entry);

      const res = await httpRequest(
        server,
        "POST",
        `/tenants/${TENANT_ID}/kb`,
        { question: "How do I reset?", answer: "Click Settings.", tags: ["auth"] },
      );

      expect(res.status).toBe(201);
      const data = res.json() as KbEntry;
      expect(data.id).toBe(ENTRY_ID);
    });
  });

  // ── GET /:tenantId/kb/search ──────────────────────────────────────

  describe("GET /tenants/:tenantId/kb/search", () => {
    it("returns results and increments hit count for each result", async () => {
      const entries = [makeEntry({ id: "e1" }), makeEntry({ id: "e2" })];
      mockStore.search.mockReturnValue(entries);

      const res = await httpRequest(
        server,
        "GET",
        `/tenants/${TENANT_ID}/kb/search?q=reset+password`,
      );

      expect(res.status).toBe(200);
      const data = res.json() as { results: KbEntry[]; count: number };
      expect(data.results).toHaveLength(2);
      expect(data.count).toBe(2);
      expect(mockStore.incrementHit).toHaveBeenCalledTimes(2);
      expect(mockStore.incrementHit).toHaveBeenCalledWith("e1");
      expect(mockStore.incrementHit).toHaveBeenCalledWith("e2");
    });

    it("does not call incrementHit when results are empty", async () => {
      mockStore.search.mockReturnValue([]);

      const res = await httpRequest(
        server,
        "GET",
        `/tenants/${TENANT_ID}/kb/search?q=nomatch`,
      );

      expect(res.status).toBe(200);
      const data = res.json() as { count: number };
      expect(data.count).toBe(0);
      expect(mockStore.incrementHit).not.toHaveBeenCalled();
    });

    it("uses empty string as query when q param is absent", async () => {
      mockStore.search.mockReturnValue([]);

      await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb/search`);

      expect(mockStore.search).toHaveBeenCalledWith(TENANT_ID, "");
    });

    it("passes query string q to store.search", async () => {
      mockStore.search.mockReturnValue([]);

      await httpRequest(server, "GET", `/tenants/${TENANT_ID}/kb/search?q=password`);

      expect(mockStore.search).toHaveBeenCalledWith(TENANT_ID, "password");
    });
  });

  // ── GET /:tenantId/kb/:entryId ────────────────────────────────────

  describe("GET /tenants/:tenantId/kb/:entryId", () => {
    it("returns 400 for invalid entryId format", async () => {
      const res = await httpRequest(
        server,
        "GET",
        `/tenants/${TENANT_ID}/kb/bad%20id`,
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Invalid entryId format");
    });

    it("returns 404 when entry is not found (getEntry returns null/undefined)", async () => {
      mockStore.getEntry.mockReturnValue(null);

      const res = await httpRequest(
        server,
        "GET",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
      );

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Entry not found");
    });

    it("returns 404 when entry belongs to a different tenant", async () => {
      mockStore.getEntry.mockReturnValue(makeEntry({ tenantId: "org_other" }));

      const res = await httpRequest(
        server,
        "GET",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
      );

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Entry not found");
    });

    it("returns 200 with entry when found for correct tenant", async () => {
      const entry = makeEntry();
      mockStore.getEntry.mockReturnValue(entry);

      const res = await httpRequest(
        server,
        "GET",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
      );

      expect(res.status).toBe(200);
      const data = res.json() as KbEntry;
      expect(data.id).toBe(ENTRY_ID);
      expect(data.tenantId).toBe(TENANT_ID);
    });
  });

  // ── PUT /:tenantId/kb/:entryId ────────────────────────────────────

  describe("PUT /tenants/:tenantId/kb/:entryId", () => {
    it("returns 400 for invalid entryId format", async () => {
      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/bad%20id`,
        { question: "Updated?" },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Invalid entryId format");
    });

    it("returns 400 when all fields are undefined (empty body)", async () => {
      mockStore.getEntry.mockReturnValue(makeEntry());

      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        {},
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("At least one");
    });

    it("returns 400 when question is wrong type (not a string)", async () => {
      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        { question: 123 },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("question");
    });

    it("returns 400 when answer is wrong type (not a string)", async () => {
      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        { answer: false },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("answer");
    });

    it("returns 400 when tags is invalid", async () => {
      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        { tags: "not-an-array" },
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tags");
    });

    it("returns 404 when entry is not found before updating", async () => {
      mockStore.getEntry.mockReturnValue(null);

      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        { question: "Updated question?" },
      );

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Entry not found");
      expect(mockStore.updateEntry).not.toHaveBeenCalled();
    });

    it("returns 404 when entry belongs to different tenant before updating", async () => {
      mockStore.getEntry.mockReturnValue(makeEntry({ tenantId: "org_other" }));

      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        { question: "Updated question?" },
      );

      expect(res.status).toBe(404);
      expect(mockStore.updateEntry).not.toHaveBeenCalled();
    });

    it("returns 404 when updateEntry returns null (concurrent delete)", async () => {
      mockStore.getEntry.mockReturnValue(makeEntry());
      mockStore.updateEntry.mockReturnValue(null);

      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        { question: "Updated question?" },
      );

      expect(res.status).toBe(404);
    });

    it("returns 200 with updated entry on success", async () => {
      const updated = makeEntry({ question: "Updated question?" });
      mockStore.getEntry.mockReturnValue(makeEntry());
      mockStore.updateEntry.mockReturnValue(updated);

      const res = await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        { question: "Updated question?" },
      );

      expect(res.status).toBe(200);
      const data = res.json() as KbEntry;
      expect(data.question).toBe("Updated question?");
    });

    it("passes only defined fields in the patch to updateEntry", async () => {
      const updated = makeEntry({ answer: "New answer." });
      mockStore.getEntry.mockReturnValue(makeEntry());
      mockStore.updateEntry.mockReturnValue(updated);

      await httpRequest(
        server,
        "PUT",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
        { answer: "New answer." },
      );

      expect(mockStore.updateEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        { answer: "New answer." },
      );
    });
  });

  // ── DELETE /:tenantId/kb/:entryId ─────────────────────────────────

  describe("DELETE /tenants/:tenantId/kb/:entryId", () => {
    it("returns 400 for invalid entryId format", async () => {
      const res = await httpRequest(
        server,
        "DELETE",
        `/tenants/${TENANT_ID}/kb/bad%20id`,
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Invalid entryId format");
    });

    it("returns 404 when entry is not found", async () => {
      mockStore.getEntry.mockReturnValue(null);

      const res = await httpRequest(
        server,
        "DELETE",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
      );

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Entry not found");
      expect(mockStore.deleteEntry).not.toHaveBeenCalled();
    });

    it("returns 404 when entry belongs to different tenant", async () => {
      mockStore.getEntry.mockReturnValue(makeEntry({ tenantId: "org_other" }));

      const res = await httpRequest(
        server,
        "DELETE",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
      );

      expect(res.status).toBe(404);
      expect(mockStore.deleteEntry).not.toHaveBeenCalled();
    });

    it("returns 204 and calls deleteEntry on success", async () => {
      mockStore.getEntry.mockReturnValue(makeEntry());

      const res = await httpRequest(
        server,
        "DELETE",
        `/tenants/${TENANT_ID}/kb/${ENTRY_ID}`,
      );

      expect(res.status).toBe(204);
      expect(mockStore.deleteEntry).toHaveBeenCalledWith(ENTRY_ID);
    });
  });

  // ── DELETE /:tenantId/kb ──────────────────────────────────────────

  describe("DELETE /tenants/:tenantId/kb", () => {
    it("returns 204 and calls clearTenant", async () => {
      const res = await httpRequest(
        server,
        "DELETE",
        `/tenants/${TENANT_ID}/kb`,
      );

      expect(res.status).toBe(204);
      expect(mockStore.clearTenant).toHaveBeenCalledWith(TENANT_ID);
    });

    it("always returns 204 regardless of tenant contents", async () => {
      // clearTenant is fire-and-forget — no entries needed
      const res = await httpRequest(
        server,
        "DELETE",
        `/tenants/org_empty/kb`,
      );

      expect(res.status).toBe(204);
      expect(mockStore.clearTenant).toHaveBeenCalledWith("org_empty");
    });
  });
});
