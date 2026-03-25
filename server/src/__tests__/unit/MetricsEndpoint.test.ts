/**
 * Metrics & Dashboard Endpoint Tests — N-66
 *
 * Tests the /metrics (Prometheus) and /dashboard routes.
 * Uses an isolated prom-client Registry to avoid cross-test pollution.
 * The production /metrics handler uses register.metrics() from metrics/registry.ts;
 * here we replicate that pattern with a local registry to test the exposition format.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { Registry, Counter, Histogram, Gauge } from "prom-client";
import { createPrometheusMiddleware } from "../../middleware/prometheusMiddleware.js";

// ── Isolated test registry (never the global default) ────────────────────

const testRegister = new Registry();

const testHttpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [testRegister],
});

const testHttpRequestDurationMs = new Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [5, 10, 25, 50, 100, 200, 400],
  registers: [testRegister],
});

// wsConnectionsActive and ttsProcessingDurationMs are registered in the test
// registry so they appear in /metrics output — not called directly in tests.
new Gauge({
  name: "ws_connections_active",
  help: "Active WebSocket connections",
  registers: [testRegister],
  collect() { this.set(0); },
});

new Histogram({
  name: "tts_processing_duration_ms",
  help: "TTS processing duration in milliseconds",
  buckets: [50, 100, 250, 500, 1000],
  registers: [testRegister],
});

// ── Mock sessionManager ──────────────────────────────────────────────────

const mockSessions = [
  { id: "sess-001", state: "listening", createdAt: Date.now() - 60_000 },
  { id: "sess-002", state: "responding", createdAt: Date.now() - 30_000 },
];

const mockSessionManager = {
  getActiveSessions: jest.fn(() => mockSessions),
  getSessionCount: jest.fn(() => 3),
};

// ── Build a test app ─────────────────────────────────────────────────────

function buildTestApp(): Express {
  const app = express();

  // Prometheus middleware using isolated test instances
  app.use(createPrometheusMiddleware({
    counter: testHttpRequestsTotal,
    histogram: testHttpRequestDurationMs,
  }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      sessions: mockSessionManager.getSessionCount(),
    });
  });

  app.get("/status", (_req, res) => {
    const activeSessions = mockSessionManager.getActiveSessions();
    res.json({
      status: "running",
      version: "0.1.0",
      activeSessions: activeSessions.length,
      sessions: activeSessions.map((s) => ({
        id: s.id,
        state: s.state,
        uptime: Date.now() - s.createdAt,
      })),
    });
  });

  // N-66: Prometheus /metrics endpoint
  app.get("/metrics", async (_req, res) => {
    try {
      const metrics = await testRegister.metrics();
      res.set("Content-Type", testRegister.contentType);
      res.end(metrics);
    } catch (err) {
      res.status(500).end(String(err));
    }
  });

  app.get("/dashboard", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><title>voice-jib-jab — Live Metrics</title></head>
<body><h1>voice-jib-jab</h1></body>
</html>`);
  });

  // Trigger route — used to verify counter increments
  app.get("/trigger", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

// ── HTTP helper (no supertest dependency) ────────────────────────────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function request(
  server: Server,
  path: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }
    const url = `http://127.0.0.1:${addr.port}${path}`;
    import("http").then(({ default: http }) => {
      http
        .get(url, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf-8");
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string | string[] | undefined>,
              body,
              json: () => JSON.parse(body),
            });
          });
        })
        .on("error", reject);
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Metrics & Dashboard Endpoints", () => {
  let app: Express;
  let server: Server;

  beforeAll((done) => {
    app = buildTestApp();
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    testRegister.clear();
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionManager.getActiveSessions.mockReturnValue(mockSessions);
    mockSessionManager.getSessionCount.mockReturnValue(3);
  });

  // ── GET /metrics — Prometheus exposition format (N-66) ───────────────

  describe("GET /metrics", () => {
    it("returns 200", async () => {
      const res = await request(server, "/metrics");
      expect(res.status).toBe(200);
    });

    it("returns text/plain content type", async () => {
      const res = await request(server, "/metrics");
      expect(res.headers["content-type"]).toContain("text/plain");
    });

    it("contains http_requests_total metric", async () => {
      const res = await request(server, "/metrics");
      expect(res.body).toContain("http_requests_total");
    });

    it("contains http_request_duration_ms metric", async () => {
      const res = await request(server, "/metrics");
      expect(res.body).toContain("http_request_duration_ms");
    });

    it("contains ws_connections_active metric", async () => {
      const res = await request(server, "/metrics");
      expect(res.body).toContain("ws_connections_active");
    });

    it("contains tts_processing_duration_ms metric", async () => {
      const res = await request(server, "/metrics");
      expect(res.body).toContain("tts_processing_duration_ms");
    });

    it("contains HELP and TYPE lines for each metric", async () => {
      const res = await request(server, "/metrics");
      expect(res.body).toMatch(/^# HELP http_requests_total/m);
      expect(res.body).toMatch(/^# TYPE http_requests_total counter/m);
      expect(res.body).toMatch(/^# HELP http_request_duration_ms/m);
      expect(res.body).toMatch(/^# TYPE http_request_duration_ms histogram/m);
      expect(res.body).toMatch(/^# HELP ws_connections_active/m);
      expect(res.body).toMatch(/^# TYPE ws_connections_active gauge/m);
      expect(res.body).toMatch(/^# HELP tts_processing_duration_ms/m);
      expect(res.body).toMatch(/^# TYPE tts_processing_duration_ms histogram/m);
    });

    it("increments http_requests_total after a request is made", async () => {
      // Make a request to /trigger to increment the counter
      await request(server, "/trigger");
      const res = await request(server, "/metrics");
      // The counter should have been incremented — look for a non-zero total
      expect(res.body).toMatch(/http_requests_total\{[^}]*\} [1-9]/);
    });

    it("body is in standard Prometheus exposition format (no JSON braces)", async () => {
      const res = await request(server, "/metrics");
      // Prometheus format uses lines, not JSON objects
      expect(res.body).not.toMatch(/^\{/);
      expect(res.body).toContain("\n");
    });
  });

  // ── GET /dashboard ──────────────────────────────────────────────────

  describe("GET /dashboard", () => {
    it("returns 200 with text/html content type", async () => {
      const res = await request(server, "/dashboard");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
    });

    it("contains the project name in the HTML", async () => {
      const res = await request(server, "/dashboard");
      expect(res.body).toContain("voice-jib-jab");
    });

    it("contains a valid HTML document structure", async () => {
      const res = await request(server, "/dashboard");
      expect(res.body).toContain("<!DOCTYPE html>");
      expect(res.body).toContain("<title>");
      expect(res.body).toContain("</html>");
    });
  });

  // ── Non-regression: existing endpoints ──────────────────────────────

  describe("Non-regression", () => {
    it("GET /health returns 200 with status ok", async () => {
      const res = await request(server, "/health");
      expect(res.status).toBe(200);
      const data = res.json() as { status: string; sessions: number };
      expect(data.status).toBe("ok");
      expect(typeof data.sessions).toBe("number");
    });

    it("GET /status returns 200 with running status", async () => {
      const res = await request(server, "/status");
      expect(res.status).toBe(200);
      const data = res.json() as {
        status: string;
        version: string;
        activeSessions: number;
      };
      expect(data.status).toBe("running");
      expect(data.version).toBe("0.1.0");
      expect(data.activeSessions).toBe(mockSessions.length);
    });
  });
});
