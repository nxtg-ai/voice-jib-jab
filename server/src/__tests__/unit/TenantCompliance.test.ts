/**
 * TenantCompliance Tests
 *
 * Tests the GET /tenants/:tenantId/compliance-report endpoint.
 *
 * Mock strategy: jest.fn() mocks for SessionRecorder.loadRecording and
 * AnalyticsService.getAggregateMetrics — no disk I/O, no external services.
 *
 * Follows the AdminApi.test.ts pattern: standalone Express app with
 * injected mock dependencies, raw http.request helper.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { createTenantComplianceRouter } from "../../api/tenantCompliance.js";
import type { SessionRecording } from "../../services/SessionRecorder.js";
import type { SessionRecorder } from "../../services/SessionRecorder.js";
import type { AnalyticsService, SessionMetrics } from "../../services/AnalyticsService.js";

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
          headers: { "Content-Type": "application/json" },
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
// Test data factories
// ---------------------------------------------------------------------------

function makeSessionMetrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    sessionId: overrides.sessionId ?? "sess-001",
    tenantId: overrides.tenantId ?? "tenant-a",
    startedAt: overrides.startedAt ?? "2026-03-18T10:00:00.000Z",
    durationMs: overrides.durationMs !== undefined ? overrides.durationMs : 45000,
    turnCount: overrides.turnCount ?? 4,
    policyDecisions: overrides.policyDecisions ?? {
      allow: 8,
      refuse: 1,
      escalate: 0,
      rewrite: 1,
      cancel_output: 0,
    },
    totalDecisions: overrides.totalDecisions ?? 10,
    complianceRate: overrides.complianceRate ?? 0.9,
    escalationCount: overrides.escalationCount ?? 0,
    qualityScore: overrides.qualityScore ?? 80,
  };
}

function makeRecording(
  overrides: Partial<SessionRecording> = {},
): SessionRecording {
  return {
    sessionId: overrides.sessionId ?? "sess-001",
    startedAt: overrides.startedAt ?? "2026-03-18T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-18T10:01:00.000Z",
    durationMs: overrides.durationMs !== undefined ? overrides.durationMs : 45000,
    tenantId: overrides.tenantId ?? "tenant-a",
    timeline: overrides.timeline ?? [],
    summary: overrides.summary ?? {
      turnCount: 4,
      policyDecisions: {
        allow: 8,
        refuse: 1,
        escalate: 0,
        rewrite: 1,
        cancel_output: 0,
      },
      audioInputChunks: 100,
      audioOutputChunks: 80,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockRecorder(
  recordings: Map<string, SessionRecording | null>,
): Pick<SessionRecorder, "loadRecording"> {
  return {
    loadRecording: jest.fn((sessionId: string) => recordings.get(sessionId) ?? null),
  };
}

function makeMockAnalytics(sessions: SessionMetrics[]): Pick<AnalyticsService, "getAggregateMetrics"> {
  return {
    getAggregateMetrics: jest.fn(() => ({
      totalSessions: sessions.length,
      filteredSessions: sessions.length,
      avgDurationMs: null,
      avgTurnCount: 0,
      avgQualityScore: 0,
      totalDecisions: 0,
      decisionBreakdown: {},
      avgComplianceRate: 0,
      escalationRate: 0,
      tenantBreakdown: {},
      sessions,
      sentimentDistribution: { positive: 0, neutral: 0, negative: 0, frustrated: 0 },
      callsPerDay: [],
      topPolicyViolations: [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

function buildApp(
  recorder: Pick<SessionRecorder, "loadRecording">,
  analytics: Pick<AnalyticsService, "getAggregateMetrics">,
): { app: Express; server: Server } {
  const app = express();
  app.use(express.json());
  app.use(
    "/tenants",
    createTenantComplianceRouter(
      recorder as SessionRecorder,
      analytics as AnalyticsService,
    ),
  );
  const server = createServer(app);
  return { app, server };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /tenants/:tenantId/compliance-report — validation", () => {
  let server: Server;

  beforeAll((done) => {
    const analytics = makeMockAnalytics([]);
    const recorder = makeMockRecorder(new Map());
    const { server: s } = buildApp(recorder, analytics);
    server = s;
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });

  it("returns 400 for tenantId containing path traversal (../../etc)", async () => {
    const res = await httpGet(server, "/tenants/..%2F..%2Fetc/compliance-report");
    expect(res.status).toBe(400);
  });

  it("returns 400 for tenantId with invalid characters (spaces)", async () => {
    const res = await httpGet(server, "/tenants/tenant%20name/compliance-report");
    expect(res.status).toBe(400);
  });

  it("returns 400 for tenantId with special characters (@)", async () => {
    const res = await httpGet(server, "/tenants/tenant%40name/compliance-report");
    expect(res.status).toBe(400);
  });

  it("returns error JSON body on 400", async () => {
    const res = await httpGet(server, "/tenants/bad%20tenant/compliance-report");
    const body = res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });
});

describe("GET /tenants/:tenantId/compliance-report — 404 when no sessions", () => {
  let server: Server;

  beforeAll((done) => {
    const analytics = makeMockAnalytics([]);
    const recorder = makeMockRecorder(new Map());
    const { server: s } = buildApp(recorder, analytics);
    server = s;
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });

  it("returns 404 when analytics finds no sessions for tenant", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    expect(res.status).toBe(404);
  });

  it("returns error body on 404", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });
});

describe("GET /tenants/:tenantId/compliance-report — summary aggregation", () => {
  let server: Server;

  const sess1 = makeSessionMetrics({ sessionId: "sess-001" });
  const sess2 = makeSessionMetrics({
    sessionId: "sess-002",
    policyDecisions: { allow: 4, refuse: 2, escalate: 1, rewrite: 0, cancel_output: 0 },
    totalDecisions: 7,
    escalationCount: 1,
  });

  const rec1 = makeRecording({ sessionId: "sess-001" });
  const rec2 = makeRecording({
    sessionId: "sess-002",
    summary: {
      turnCount: 3,
      policyDecisions: { allow: 4, refuse: 2, escalate: 1, rewrite: 0, cancel_output: 0 },
      audioInputChunks: 50,
      audioOutputChunks: 40,
    },
  });

  beforeAll((done) => {
    const analytics = makeMockAnalytics([sess1, sess2]);
    const recordings = new Map<string, SessionRecording | null>([
      ["sess-001", rec1],
      ["sess-002", rec2],
    ]);
    const recorder = makeMockRecorder(recordings);
    const { server: s } = buildApp(recorder, analytics);
    server = s;
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });

  it("returns 200", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    expect(res.status).toBe(200);
  });

  it("returns correct summary.totalSessions count", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { summary: { totalSessions: number } };
    expect(body.summary.totalSessions).toBe(2);
  });

  it("returns correct summary.totalPolicyDecisions (sum across all sessions)", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { summary: { totalPolicyDecisions: number } };
    // sess-001: allow=8, refuse=1, escalate=0, rewrite=1, cancel_output=0 = 10
    // sess-002: allow=4, refuse=2, escalate=1, rewrite=0, cancel_output=0 = 7
    expect(body.summary.totalPolicyDecisions).toBe(17);
  });

  it("returns correct summary.complianceRate (allow+rewrite / total * 100)", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { summary: { complianceRate: number } };
    // sess-001: (8+1)/10 = 9; sess-002: (4+0)/7 = 4; total: 13/17 * 100
    const expected = (13 / 17) * 100;
    expect(body.summary.complianceRate).toBeCloseTo(expected, 2);
  });

  it("returns correct summary.totalEscalations", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { summary: { totalEscalations: number } };
    // sess-001: escalate=0, sess-002: escalate=1
    expect(body.summary.totalEscalations).toBe(1);
  });

  it("returns correct summary.totalClaimsChecked (counts claims.check timeline entries)", async () => {
    // Build recordings with claims.check entries in timeline
    const recWithClaims = makeRecording({
      sessionId: "sess-claims",
      timeline: [
        { t_ms: 100, type: "claims.check", payload: { claim: "age", result: "pass" } },
        { t_ms: 200, type: "claims.check", payload: { claim: "region", result: "pass" } },
        { t_ms: 300, type: "policy.decision", payload: { decision: "allow" } },
      ],
    });
    const sessMetric = makeSessionMetrics({ sessionId: "sess-claims" });
    const analytics = makeMockAnalytics([sessMetric]);
    const recordings = new Map<string, SessionRecording | null>([
      ["sess-claims", recWithClaims],
    ]);
    const recorder = makeMockRecorder(recordings);
    const { server: localServer } = buildApp(recorder, analytics);
    await new Promise<void>((resolve) => localServer.listen(0, resolve));

    const res = await httpGet(localServer, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { summary: { totalClaimsChecked: number } };
    expect(body.summary.totalClaimsChecked).toBe(2);

    await new Promise<void>((resolve) => { localServer.close(() => resolve()); });
  });
});

describe("GET /tenants/:tenantId/compliance-report — per-session entries", () => {
  let server: Server;

  const sess1 = makeSessionMetrics({ sessionId: "sess-001" });
  const sess2 = makeSessionMetrics({ sessionId: "sess-002" });
  const rec1 = makeRecording({ sessionId: "sess-001" });
  const rec2 = makeRecording({ sessionId: "sess-002" });

  beforeAll((done) => {
    const analytics = makeMockAnalytics([sess1, sess2]);
    const recordings = new Map<string, SessionRecording | null>([
      ["sess-001", rec1],
      ["sess-002", rec2],
    ]);
    const recorder = makeMockRecorder(recordings);
    const { server: s } = buildApp(recorder, analytics);
    server = s;
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });

  it("sessions array contains one entry per session", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { sessions: unknown[] };
    expect(body.sessions.length).toBe(2);
  });

  it("each session entry has correct sessionId", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { sessions: Array<{ sessionId: string }> };
    const ids = body.sessions.map((s) => s.sessionId);
    expect(ids).toContain("sess-001");
    expect(ids).toContain("sess-002");
  });

  it("returns per-session policyDecisions as array of {decision, count}", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as {
      sessions: Array<{ sessionId: string; policyDecisions: Array<{ decision: string; count: number }> }>;
    };
    const sess = body.sessions.find((s) => s.sessionId === "sess-001")!;
    expect(Array.isArray(sess.policyDecisions)).toBe(true);
    for (const entry of sess.policyDecisions) {
      expect(typeof entry.decision).toBe("string");
      expect(typeof entry.count).toBe("number");
    }
  });

  it("policyDecisions array only includes decisions with non-zero counts", async () => {
    // rec1 has escalate=0, cancel_output=0 — should not appear
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as {
      sessions: Array<{ sessionId: string; policyDecisions: Array<{ decision: string; count: number }> }>;
    };
    const sess = body.sessions.find((s) => s.sessionId === "sess-001")!;
    const zeroDecisions = sess.policyDecisions.filter((d) => d.count === 0);
    expect(zeroDecisions).toHaveLength(0);
  });
});

describe("GET /tenants/:tenantId/compliance-report — complianceRate per session", () => {
  it("complianceRate is 0 when there are no decisions", async () => {
    const noDecRec = makeRecording({
      sessionId: "sess-nodec",
      summary: {
        turnCount: 1,
        policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
      },
    });
    const analytics = makeMockAnalytics([makeSessionMetrics({ sessionId: "sess-nodec", totalDecisions: 0, policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 } })]);
    const recordings = new Map<string, SessionRecording | null>([["sess-nodec", noDecRec]]);
    const recorder = makeMockRecorder(recordings);
    const { server } = buildApp(recorder, analytics);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { sessions: Array<{ complianceRate: number }> };
    expect(body.sessions[0].complianceRate).toBe(0);

    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  it("complianceRate is 100 when all decisions are allow", async () => {
    const allAllowRec = makeRecording({
      sessionId: "sess-allallow",
      summary: {
        turnCount: 2,
        policyDecisions: { allow: 5, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
      },
    });
    const analytics = makeMockAnalytics([makeSessionMetrics({ sessionId: "sess-allallow", totalDecisions: 5, policyDecisions: { allow: 5, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 } })]);
    const recordings = new Map<string, SessionRecording | null>([["sess-allallow", allAllowRec]]);
    const recorder = makeMockRecorder(recordings);
    const { server } = buildApp(recorder, analytics);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { sessions: Array<{ complianceRate: number }> };
    expect(body.sessions[0].complianceRate).toBe(100);

    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  it("complianceRate is correct for mixed allow/refuse/escalate decisions", async () => {
    const mixedRec = makeRecording({
      sessionId: "sess-mixed",
      summary: {
        turnCount: 3,
        policyDecisions: { allow: 3, refuse: 1, escalate: 1, rewrite: 1, cancel_output: 0 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
      },
    });
    const analytics = makeMockAnalytics([makeSessionMetrics({ sessionId: "sess-mixed", totalDecisions: 6, policyDecisions: { allow: 3, refuse: 1, escalate: 1, rewrite: 1, cancel_output: 0 } })]);
    const recordings = new Map<string, SessionRecording | null>([["sess-mixed", mixedRec]]);
    const recorder = makeMockRecorder(recordings);
    const { server } = buildApp(recorder, analytics);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { sessions: Array<{ complianceRate: number }> };
    // (allow=3 + rewrite=1) / 6 * 100 = 66.67
    expect(body.sessions[0].complianceRate).toBeCloseTo((4 / 6) * 100, 2);

    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });
});

describe("GET /tenants/:tenantId/compliance-report — date filtering", () => {
  let server: Server;

  const earlySession = makeSessionMetrics({
    sessionId: "sess-early",
    startedAt: "2026-01-15T10:00:00.000Z",
  });
  const midSession = makeSessionMetrics({
    sessionId: "sess-mid",
    startedAt: "2026-02-20T10:00:00.000Z",
  });
  const lateSession = makeSessionMetrics({
    sessionId: "sess-late",
    startedAt: "2026-03-15T10:00:00.000Z",
  });

  beforeAll((done) => {
    const analytics = makeMockAnalytics([earlySession, midSession, lateSession]);
    const recordings = new Map<string, SessionRecording | null>([
      ["sess-early", makeRecording({ sessionId: "sess-early", startedAt: "2026-01-15T10:00:00.000Z" })],
      ["sess-mid", makeRecording({ sessionId: "sess-mid", startedAt: "2026-02-20T10:00:00.000Z" })],
      ["sess-late", makeRecording({ sessionId: "sess-late", startedAt: "2026-03-15T10:00:00.000Z" })],
    ]);
    const recorder = makeMockRecorder(recordings);
    const { server: s } = buildApp(recorder, analytics);
    server = s;
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });

  it("sessions before `from` are excluded", async () => {
    const res = await httpGet(
      server,
      "/tenants/tenant-a/compliance-report?from=2026-02-01T00:00:00.000Z",
    );
    const body = res.json() as { sessions: Array<{ sessionId: string }> };
    const ids = body.sessions.map((s) => s.sessionId);
    expect(ids).not.toContain("sess-early");
    expect(ids).toContain("sess-mid");
    expect(ids).toContain("sess-late");
  });

  it("sessions after `to` are excluded", async () => {
    const res = await httpGet(
      server,
      "/tenants/tenant-a/compliance-report?to=2026-02-28T23:59:59.999Z",
    );
    const body = res.json() as { sessions: Array<{ sessionId: string }> };
    const ids = body.sessions.map((s) => s.sessionId);
    expect(ids).toContain("sess-early");
    expect(ids).toContain("sess-mid");
    expect(ids).not.toContain("sess-late");
  });

  it("null params (no from/to) include all sessions", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { sessions: Array<{ sessionId: string }> };
    expect(body.sessions.length).toBe(3);
  });

  it("from and to can be combined to isolate a window", async () => {
    const res = await httpGet(
      server,
      "/tenants/tenant-a/compliance-report?from=2026-02-01T00:00:00.000Z&to=2026-02-28T23:59:59.999Z",
    );
    const body = res.json() as { sessions: Array<{ sessionId: string }> };
    expect(body.sessions.length).toBe(1);
    expect(body.sessions[0].sessionId).toBe("sess-mid");
  });

  it("returns 404 when date filter excludes all sessions", async () => {
    const res = await httpGet(
      server,
      "/tenants/tenant-a/compliance-report?from=2030-01-01T00:00:00.000Z",
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /tenants/:tenantId/compliance-report — null recording skipping", () => {
  it("skips sessions where recorder.loadRecording returns null", async () => {
    const sess1 = makeSessionMetrics({ sessionId: "sess-has-rec" });
    const sess2 = makeSessionMetrics({ sessionId: "sess-no-rec" });
    const analytics = makeMockAnalytics([sess1, sess2]);
    // sess-no-rec maps to null
    const recordings = new Map<string, SessionRecording | null>([
      ["sess-has-rec", makeRecording({ sessionId: "sess-has-rec" })],
      ["sess-no-rec", null],
    ]);
    const recorder = makeMockRecorder(recordings);
    const { server } = buildApp(recorder, analytics);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { sessions: Array<{ sessionId: string }> };
    const ids = body.sessions.map((s) => s.sessionId);
    expect(ids).toContain("sess-has-rec");
    expect(ids).not.toContain("sess-no-rec");
    expect(body.sessions.length).toBe(1);

    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });

  it("returns 404 when all sessions have null recordings", async () => {
    const sess1 = makeSessionMetrics({ sessionId: "sess-null-1" });
    const analytics = makeMockAnalytics([sess1]);
    const recordings = new Map<string, SessionRecording | null>([
      ["sess-null-1", null],
    ]);
    const recorder = makeMockRecorder(recordings);
    const { server } = buildApp(recorder, analytics);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    expect(res.status).toBe(404);

    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  });
});

describe("GET /tenants/:tenantId/compliance-report — response shape", () => {
  let server: Server;

  beforeAll((done) => {
    const sess = makeSessionMetrics({ sessionId: "sess-001" });
    const analytics = makeMockAnalytics([sess]);
    const recordings = new Map<string, SessionRecording | null>([
      ["sess-001", makeRecording({ sessionId: "sess-001" })],
    ]);
    const recorder = makeMockRecorder(recordings);
    const { server: s } = buildApp(recorder, analytics);
    server = s;
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });

  it("returns 200 with Content-Type: application/json", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("generatedAt is an ISO string close to now", async () => {
    const before = Date.now();
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const after = Date.now();
    const body = res.json() as { generatedAt: string };
    const generatedMs = new Date(body.generatedAt).getTime();
    expect(generatedMs).toBeGreaterThanOrEqual(before);
    expect(generatedMs).toBeLessThanOrEqual(after + 100);
  });

  it("period.from is null when not provided", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { period: { from: unknown; to: unknown } };
    expect(body.period.from).toBeNull();
  });

  it("period.to is null when not provided", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { period: { from: unknown; to: unknown } };
    expect(body.period.to).toBeNull();
  });

  it("period.from reflects the from query param", async () => {
    const res = await httpGet(
      server,
      "/tenants/tenant-a/compliance-report?from=2026-01-01T00:00:00.000Z",
    );
    const body = res.json() as { period: { from: string } };
    expect(body.period.from).toBe("2026-01-01T00:00:00.000Z");
  });

  it("period.to reflects the to query param", async () => {
    const res = await httpGet(
      server,
      "/tenants/tenant-a/compliance-report?to=2026-12-31T23:59:59.999Z",
    );
    const body = res.json() as { period: { to: string } };
    expect(body.period.to).toBe("2026-12-31T23:59:59.999Z");
  });

  it("response includes tenantId matching the path param", async () => {
    const res = await httpGet(server, "/tenants/tenant-a/compliance-report");
    const body = res.json() as { tenantId: string };
    expect(body.tenantId).toBe("tenant-a");
  });
});
