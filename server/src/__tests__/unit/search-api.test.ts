/**
 * Search API Unit Tests
 *
 * Tests the /search router produced by createSearchRouter().
 * ConversationSearchService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createSearchRouter } from "../../api/search.js";
import type {
  ConversationSearchResult,
  SessionSummary,
} from "../../services/ConversationSearchService.js";
import type { ConversationSearchService } from "../../services/ConversationSearchService.js";

// ── Mock ConversationSearchService ───────────────────────────────────────────

const mockSvc = {
  search: jest.fn<Promise<ConversationSearchResult>, [unknown]>(),
  getSessionSummary: jest.fn<Promise<SessionSummary | null>, [string]>(),
};

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function httpRequest(server: Server, method: string, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {},
    };

    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            body: rawBody,
            json: () => JSON.parse(rawBody),
          });
        });
      });
      req.on("error", reject);
      req.end();
    });
  });
}

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/search", createSearchRouter(mockSvc as unknown as ConversationSearchService));
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EMPTY_RESULT: ConversationSearchResult = {
  total: 0,
  limit: 20,
  offset: 0,
  hits: [],
};

const SAMPLE_HIT = {
  sessionId: "sess-001",
  tenantId: "acme",
  startedAt: "2026-03-10T09:00:00.000Z",
  endedAt: "2026-03-10T09:05:00.000Z",
  speaker: "user" as const,
  text: "I need help with billing",
  timestamp: 1000,
};

const SAMPLE_RESULT: ConversationSearchResult = {
  total: 1,
  limit: 20,
  offset: 0,
  hits: [SAMPLE_HIT],
};

const SAMPLE_SUMMARY: SessionSummary = {
  sessionId: "sess-001",
  tenantId: "acme",
  startedAt: "2026-03-10T09:00:00.000Z",
  endedAt: "2026-03-10T09:05:00.000Z",
  turnCount: 3,
  topSentiment: "neutral",
  policyDecisions: ["allow"],
  transcriptPreview: "I need help with billing",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Search API", () => {
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

  // ── GET /search/conversations ─────────────────────────────────────────────

  describe("GET /search/conversations", () => {
    it("returns 200 with search results", async () => {
      mockSvc.search.mockResolvedValue(SAMPLE_RESULT);

      const res = await httpRequest(server, "GET", "/search/conversations");

      expect(res.status).toBe(200);
    });

    it("response has total, limit, offset, and hits fields", async () => {
      mockSvc.search.mockResolvedValue(SAMPLE_RESULT);

      const res = await httpRequest(server, "GET", "/search/conversations");
      const data = res.json() as ConversationSearchResult;

      expect(typeof data.total).toBe("number");
      expect(typeof data.limit).toBe("number");
      expect(typeof data.offset).toBe("number");
      expect(Array.isArray(data.hits)).toBe(true);
    });

    it("passes keyword query param to search service", async () => {
      mockSvc.search.mockResolvedValue(EMPTY_RESULT);

      await httpRequest(server, "GET", "/search/conversations?keyword=billing");

      expect(mockSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: "billing" }),
      );
    });

    it("passes speaker query param to search service", async () => {
      mockSvc.search.mockResolvedValue(EMPTY_RESULT);

      await httpRequest(server, "GET", "/search/conversations?speaker=user");

      expect(mockSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ speaker: "user" }),
      );
    });

    it("passes tenantId query param to search service", async () => {
      mockSvc.search.mockResolvedValue(EMPTY_RESULT);

      await httpRequest(server, "GET", "/search/conversations?tenantId=acme");

      expect(mockSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "acme" }),
      );
    });

    it("passes from and to query params to search service", async () => {
      mockSvc.search.mockResolvedValue(EMPTY_RESULT);

      await httpRequest(
        server,
        "GET",
        "/search/conversations?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z",
      );

      expect(mockSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "2026-03-01T00:00:00.000Z",
          to: "2026-03-31T23:59:59.999Z",
        }),
      );
    });

    it("returns 400 for an invalid from date", async () => {
      const res = await httpRequest(server, "GET", "/search/conversations?from=not-a-date");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("from");
      expect(mockSvc.search).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid to date", async () => {
      const res = await httpRequest(server, "GET", "/search/conversations?to=bad-date");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("to");
      expect(mockSvc.search).not.toHaveBeenCalled();
    });

    it("returns 400 when limit exceeds 100", async () => {
      const res = await httpRequest(server, "GET", "/search/conversations?limit=150");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("limit");
      expect(mockSvc.search).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid speaker value", async () => {
      const res = await httpRequest(server, "GET", "/search/conversations?speaker=robot");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("speaker");
      expect(mockSvc.search).not.toHaveBeenCalled();
    });

    it("default limit is 20 when not specified", async () => {
      mockSvc.search.mockResolvedValue({ ...EMPTY_RESULT, limit: 20 });

      const res = await httpRequest(server, "GET", "/search/conversations");
      const data = res.json() as ConversationSearchResult;

      expect(data.limit).toBe(20);
    });
  });

  // ── GET /search/conversations/:id/summary ─────────────────────────────────

  describe("GET /search/conversations/:id/summary", () => {
    it("returns 200 with session summary when session exists", async () => {
      mockSvc.getSessionSummary.mockResolvedValue(SAMPLE_SUMMARY);

      const res = await httpRequest(server, "GET", "/search/conversations/sess-001/summary");

      expect(res.status).toBe(200);
      const data = res.json() as SessionSummary;
      expect(data.sessionId).toBe("sess-001");
      expect(data.turnCount).toBe(3);
      expect(data.topSentiment).toBe("neutral");
    });

    it("returns 404 when session not found", async () => {
      mockSvc.getSessionSummary.mockResolvedValue(null);

      const res = await httpRequest(server, "GET", "/search/conversations/no-such-session/summary");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("no-such-session");
    });

    it("calls getSessionSummary with the sessionId from the URL", async () => {
      mockSvc.getSessionSummary.mockResolvedValue(SAMPLE_SUMMARY);

      await httpRequest(server, "GET", "/search/conversations/sess-xyz/summary");

      expect(mockSvc.getSessionSummary).toHaveBeenCalledWith("sess-xyz");
    });
  });
});

// ── Validation and error-path branch coverage ─────────────────────────────────

describe("Search API — validation and error-path branches", () => {
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

  it("returns 400 when limit is NaN (non-numeric string)", async () => {
    const res = await httpRequest(server, "GET", "/search/conversations?limit=abc");

    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("limit");
    expect(mockSvc.search).not.toHaveBeenCalled();
  });

  it("returns 400 when limit is negative", async () => {
    const res = await httpRequest(server, "GET", "/search/conversations?limit=-1");

    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("limit");
    expect(mockSvc.search).not.toHaveBeenCalled();
  });

  it("returns 400 when offset is NaN (non-numeric string)", async () => {
    const res = await httpRequest(server, "GET", "/search/conversations?offset=abc");

    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("offset");
    expect(mockSvc.search).not.toHaveBeenCalled();
  });

  it("returns 400 when offset is negative", async () => {
    const res = await httpRequest(server, "GET", "/search/conversations?offset=-1");

    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("offset");
    expect(mockSvc.search).not.toHaveBeenCalled();
  });

  it("returns 500 when searchService.search() throws", async () => {
    mockSvc.search.mockRejectedValue(new Error("DB error"));

    const res = await httpRequest(server, "GET", "/search/conversations");

    expect(res.status).toBe(500);
    const data = res.json() as { error: string };
    expect(data).toEqual({ error: "Internal server error" });
  });

  it("returns 500 when searchService.getSessionSummary() throws", async () => {
    mockSvc.getSessionSummary.mockRejectedValue(new Error("timeout"));

    const res = await httpRequest(server, "GET", "/search/conversations/sess-001/summary");

    expect(res.status).toBe(500);
    const data = res.json() as { error: string };
    expect(data).toEqual({ error: "Internal server error" });
  });
});
