/**
 * Export API Unit Tests
 *
 * Tests the /export router produced by createExportRouter().
 * SessionExportService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createExportRouter } from "../../api/export.js";
import type { SessionExportService } from "../../services/SessionExportService.js";
import type { SessionExport, BulkExportResult, ExportFilters } from "../../services/SessionExportService.js";

// ── Mock SessionExportService ─────────────────────────────────────────────────

const mockSvc = {
  exportSession: jest.fn<Promise<SessionExport | null>, [string]>(),
  exportBulk: jest.fn<Promise<BulkExportResult>, [ExportFilters]>(),
};

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
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
      headers,
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
  app.use("/export", createExportRouter(mockSvc as unknown as SessionExportService));
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBulkResult(overrides: Partial<BulkExportResult> = {}): BulkExportResult {
  return {
    exportedAt: "2026-03-19T09:00:00.000Z",
    totalSessions: 0,
    sessions: [],
    ...overrides,
  };
}

function makeSessionExport(sessionId = "sess-001"): SessionExport {
  return {
    sessionId,
    startedAt: "2026-03-15T08:00:00.000Z",
    transcript: [],
    policyDecisions: [],
    sentiment: [],
    qualityScore: 85,
    metadata: {
      turnCount: 0,
      userTurnCount: 0,
      assistantTurnCount: 0,
      escalated: false,
      exportedAt: "2026-03-19T09:00:00.000Z",
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Export API", () => {
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

  // ── GET /export/sessions ───────────────────────────────────────────────────

  describe("GET /export/sessions", () => {
    it("returns 200", async () => {
      mockSvc.exportBulk.mockResolvedValue(makeBulkResult());

      const res = await httpRequest(server, "GET", "/export/sessions");

      expect(res.status).toBe(200);
    });

    it("response has exportedAt, totalSessions, and sessions fields", async () => {
      mockSvc.exportBulk.mockResolvedValue(makeBulkResult({ totalSessions: 2, sessions: [makeSessionExport()] }));

      const res = await httpRequest(server, "GET", "/export/sessions");
      const data = res.json() as BulkExportResult;

      expect(typeof data.exportedAt).toBe("string");
      expect(typeof data.totalSessions).toBe("number");
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it("passes tenantId query param to exportBulk", async () => {
      mockSvc.exportBulk.mockResolvedValue(makeBulkResult());

      await httpRequest(server, "GET", "/export/sessions?tenantId=acme");

      expect(mockSvc.exportBulk).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "acme" }),
      );
    });

    it("passes from and to query params to exportBulk", async () => {
      mockSvc.exportBulk.mockResolvedValue(makeBulkResult());

      await httpRequest(
        server,
        "GET",
        "/export/sessions?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z",
      );

      expect(mockSvc.exportBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "2026-03-01T00:00:00.000Z",
          to: "2026-03-31T23:59:59.999Z",
        }),
      );
    });

    it("passes limit and offset to exportBulk", async () => {
      mockSvc.exportBulk.mockResolvedValue(makeBulkResult());

      await httpRequest(server, "GET", "/export/sessions?limit=10&offset=20");

      expect(mockSvc.exportBulk).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });

    it("returns 400 for invalid from date", async () => {
      const res = await httpRequest(server, "GET", "/export/sessions?from=not-a-date");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("from");
      expect(mockSvc.exportBulk).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid to date", async () => {
      const res = await httpRequest(server, "GET", "/export/sessions?to=bad-date");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("to");
      expect(mockSvc.exportBulk).not.toHaveBeenCalled();
    });

    it("returns 400 when limit exceeds 500", async () => {
      const res = await httpRequest(server, "GET", "/export/sessions?limit=501");

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("limit");
      expect(mockSvc.exportBulk).not.toHaveBeenCalled();
    });

    it("parses comma-separated sessionIds correctly", async () => {
      mockSvc.exportBulk.mockResolvedValue(makeBulkResult());

      await httpRequest(server, "GET", "/export/sessions?sessionIds=s1,s2,s3");

      expect(mockSvc.exportBulk).toHaveBeenCalledWith(
        expect.objectContaining({ sessionIds: ["s1", "s2", "s3"] }),
      );
    });

    it("defaults limit to 50 when not specified", async () => {
      mockSvc.exportBulk.mockResolvedValue(makeBulkResult());

      await httpRequest(server, "GET", "/export/sessions");

      expect(mockSvc.exportBulk).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });
  });

    it("treats a non-numeric offset as 0 (isNaN branch at L75)", async () => {
      mockSvc.exportBulk.mockResolvedValue(makeBulkResult());

      await httpRequest(server, "GET", "/export/sessions?offset=abc");

      expect(mockSvc.exportBulk).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0 }),
      );
    });

    it("returns ndjson when Accept header includes application/x-ndjson", async () => {
      const bulkResult = makeBulkResult({
        totalSessions: 1,
        sessions: [makeSessionExport("sess-ndjson")],
      });
      mockSvc.exportBulk.mockResolvedValue(bulkResult);

      const res = await httpRequest(server, "GET", "/export/sessions", {
        accept: "application/x-ndjson",
      });

      expect(res.status).toBe(200);
      const lines = res.body.trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const metadata = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(metadata.exportedAt).toBe(bulkResult.exportedAt);
      expect(metadata.totalSessions).toBe(1);
      const session = JSON.parse(lines[1]) as Record<string, unknown>;
      expect(session.sessionId).toBe("sess-ndjson");
    });

    it("ndjson metadata line includes from and to when present in result (L100-101 cond-expr)", async () => {
      const bulkResult = makeBulkResult({
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-31T23:59:59.999Z",
        sessions: [],
      });
      mockSvc.exportBulk.mockResolvedValue(bulkResult);

      const res = await httpRequest(server, "GET", "/export/sessions", {
        accept: "application/x-ndjson",
      });

      const metadata = JSON.parse(res.body.trim().split("\n")[0]) as Record<string, unknown>;
      expect(metadata.from).toBe("2026-03-01T00:00:00.000Z");
      expect(metadata.to).toBe("2026-03-31T23:59:59.999Z");
    });

    it("ndjson metadata line includes tenantId when present in result (L102 cond-expr)", async () => {
      const bulkResult = makeBulkResult({
        tenantId: "org_acme",
        sessions: [],
      });
      mockSvc.exportBulk.mockResolvedValue(bulkResult);

      const res = await httpRequest(server, "GET", "/export/sessions", {
        accept: "application/x-ndjson",
      });

      const metadata = JSON.parse(res.body.trim().split("\n")[0]) as Record<string, unknown>;
      expect(metadata.tenantId).toBe("org_acme");
    });

    it("ndjson metadata line omits from, to, tenantId when absent in result (false branches of L100-102)", async () => {
      const bulkResult = makeBulkResult({ sessions: [] });
      mockSvc.exportBulk.mockResolvedValue(bulkResult);

      const res = await httpRequest(server, "GET", "/export/sessions", {
        accept: "application/x-ndjson",
      });

      const metadata = JSON.parse(res.body.trim().split("\n")[0]) as Record<string, unknown>;
      expect(metadata.from).toBeUndefined();
      expect(metadata.to).toBeUndefined();
      expect(metadata.tenantId).toBeUndefined();
    });

  // ── GET /export/sessions/:id ───────────────────────────────────────────────

  describe("GET /export/sessions/:id", () => {
    it("returns 200 with SessionExport for existing session", async () => {
      mockSvc.exportSession.mockResolvedValue(makeSessionExport("sess-xyz"));

      const res = await httpRequest(server, "GET", "/export/sessions/sess-xyz");

      expect(res.status).toBe(200);
      const data = res.json() as SessionExport;
      expect(data.sessionId).toBe("sess-xyz");
    });

    it("returns 404 when exportSession returns null", async () => {
      mockSvc.exportSession.mockResolvedValue(null);

      const res = await httpRequest(server, "GET", "/export/sessions/no-such-session");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(typeof data.error).toBe("string");
    });
  });
});
