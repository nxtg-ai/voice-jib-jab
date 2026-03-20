/**
 * auditReport-api Unit Tests
 *
 * Tests for GET /audit/report, GET /audit/reports, GET /audit/dashboard.
 *
 * Mock strategy: jest.fn() mock for AuditReportService — no disk I/O,
 * no actual report generation. Uses raw http.request helper (same pattern
 * as TenantCompliance.test.ts) for a standalone Express server.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { createAuditReportRouter } from "../../api/auditReport.js";
import type { AuditReportService, AuditReport } from "../../services/AuditReportService.js";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpGet(server: Server, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    import("http").then(({ default: http }) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path,
          method: "GET",
        },
        (res) => {
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
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SAMPLE_REPORT: AuditReport = {
  reportId: "aaaaaaaa-0000-4000-8000-000000000001",
  generatedAt: "2026-03-20T12:00:00.000Z",
  tenantId: "acme",
  period: { year: 2026, month: 3, label: "March 2026" },
  summary: {
    totalSessions: 5,
    totalDurationMs: 300_000,
    avgDurationMs: 60_000,
    avgQualityScore: 78.5,
    escalationCount: 1,
    escalationRatePct: 20,
    refusalCount: 2,
    refusalRatePct: 40,
  },
  policyDecisions: [{ decision: "allow", count: 40, pct: 80 }],
  qualityBands: [
    { band: "excellent", count: 3, pct: 60 },
    { band: "good", count: 2, pct: 40 },
    { band: "fair", count: 0, pct: 0 },
    { band: "poor", count: 0, pct: 0 },
  ],
  sentimentBreakdown: { positive: 4, neutral: 1 },
  topEscalationReasons: [{ reason: "billing", count: 1 }],
  sessionIds: ["s1", "s2", "s3", "s4", "s5"],
};

// ---------------------------------------------------------------------------
// Mock service factory
// ---------------------------------------------------------------------------

function makeMockService(
  report: AuditReport = SAMPLE_REPORT,
): Pick<AuditReportService, "generateReport" | "generateHtml" | "listReports" | "getReport"> {
  return {
    generateReport: jest.fn(async () => report),
    generateHtml: jest.fn((_r: AuditReport) => `<html><body>Audit Report for ${_r.tenantId} ${_r.period.label}<button onclick="window.print()">Export PDF</button></body></html>`),
    listReports: jest.fn(() => [report]),
    getReport: jest.fn((id: string) => (id === report.reportId ? report : undefined)),
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function buildApp(
  service: Pick<AuditReportService, "generateReport" | "generateHtml" | "listReports" | "getReport">,
): { app: Express; server: Server } {
  const app = express();
  app.use(express.json());
  app.use("/audit", createAuditReportRouter(service as AuditReportService));

  const server = createServer(app);
  server.listen(0);
  return { app, server };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auditReport API", () => {
  let server: Server;
  let mockService: ReturnType<typeof makeMockService>;

  beforeEach(() => {
    mockService = makeMockService();
    ({ server } = buildApp(mockService));
  });

  afterEach((done) => {
    server.close(done);
  });

  // ── GET /audit/report — happy paths ──────────────────────────────────────

  it("GET /audit/report?tenantId=x&year=2026&month=3 returns 200 HTML", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&year=2026&month=3");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });

  it("GET /audit/report?format=json returns 200 with AuditReport JSON", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&year=2026&month=3&format=json");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = res.json() as AuditReport;
    expect(body.tenantId).toBe("acme");
    expect(body.reportId).toBeDefined();
  });

  it("GET /audit/report?format=pdf returns Content-Type application/pdf", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&year=2026&month=3&format=pdf");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  it("GET /audit/report?format=pdf has Content-Disposition with .pdf filename", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&year=2026&month=3&format=pdf");

    const disposition = res.headers["content-disposition"] as string;
    expect(disposition).toMatch(/\.pdf/);
    expect(disposition).toMatch(/inline/);
  });

  // ── Validation errors ────────────────────────────────────────────────────

  it("returns 400 for missing tenantId", async () => {
    const res = await httpGet(server, "/audit/report?year=2026&month=3");

    expect(res.status).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/tenantId/i);
  });

  it("returns 400 for missing year", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&month=3");

    expect(res.status).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/year/i);
  });

  it("returns 400 for missing month", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&year=2026");

    expect(res.status).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/month/i);
  });

  it("returns 400 for month > 12", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&year=2026&month=13");

    expect(res.status).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/month/i);
  });

  it("returns 400 for month < 1", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&year=2026&month=0");

    expect(res.status).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/month/i);
  });

  it("returns 400 for non-numeric year", async () => {
    const res = await httpGet(server, "/audit/report?tenantId=acme&year=notanumber&month=3");

    expect(res.status).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/year/i);
  });

  // ── GET /audit/reports ───────────────────────────────────────────────────

  it("GET /audit/reports returns 200 with array", async () => {
    const res = await httpGet(server, "/audit/reports");

    expect(res.status).toBe(200);
    const body = res.json() as AuditReport[];
    expect(Array.isArray(body)).toBe(true);
  });

  // ── GET /audit/dashboard ─────────────────────────────────────────────────

  it("GET /audit/dashboard returns 200 HTML", async () => {
    const res = await httpGet(server, "/audit/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("<html");
  });
});
