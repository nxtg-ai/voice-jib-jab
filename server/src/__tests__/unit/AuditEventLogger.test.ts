/**
 * AuditEventLogger Tests
 *
 * Covers AuditEventLogger service and createAuditEventsRouter.
 * HTTP transport uses a plain Node http helper (no supertest dependency).
 * File isolation via OS temp dirs.
 */

import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { AuditEventLogger } from "../../services/AuditEventLogger.js";
import { createAuditEventsRouter } from "../../api/auditEvents.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "vjj-audit-"));
  return join(dir, "audit.jsonl");
}

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
  headers: Record<string, string | string[] | undefined>;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Not listening"));
    import("http").then(({ default: http }) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: addr.port, path, method },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf-8");
            resolve({
              status: res.statusCode ?? 0,
              body: rawBody,
              json: () => JSON.parse(rawBody),
              headers: res.headers as Record<string, string | string[] | undefined>,
            });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

function buildApp(logger: AuditEventLogger): { app: Express; server: Server } {
  const app = express();
  app.use(express.json());
  app.use("/audit", createAuditEventsRouter(logger));
  const server = createServer(app);
  return { app, server };
}

function startServer(server: Server): Promise<void> {
  return new Promise((r) => server.listen(0, "127.0.0.1", r));
}

function stopServer(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

// ── AuditEventLogger unit tests ───────────────────────────────────────────

describe("AuditEventLogger", () => {
  let logger: AuditEventLogger;
  let filePath: string;

  beforeEach(() => {
    filePath = makeTmpFile();
    logger = new AuditEventLogger(filePath);
  });

  describe("log()", () => {
    it("returns event with generated eventId (24 hex chars)", () => {
      const ev = logger.log({ type: "session_started", detail: {} });
      expect(ev.eventId).toMatch(/^[0-9a-f]{24}$/);
    });

    it("returns event with ISO timestamp", () => {
      const ev = logger.log({ type: "session_started", detail: {} });
      expect(() => new Date(ev.timestamp)).not.toThrow();
      expect(new Date(ev.timestamp).toISOString()).toBe(ev.timestamp);
    });

    it("appends to JSONL file (one JSON object per line)", () => {
      logger.log({ type: "session_started", detail: {} });
      logger.log({ type: "session_ended", detail: {} });
      const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });

    it("returns event with tenantId and sessionId when provided", () => {
      const ev = logger.log({ type: "policy_decision", tenantId: "acme", sessionId: "sess1", detail: { decision: "allow" } });
      expect(ev.tenantId).toBe("acme");
      expect(ev.sessionId).toBe("sess1");
    });

    it("emits 'event' on internal emitter", () => {
      const received: unknown[] = [];
      logger.on("event", (ev) => { received.push(ev); });
      logger.log({ type: "session_started", detail: {} });
      expect(received).toHaveLength(1);
    });

    it("adds to ring buffer", () => {
      logger.log({ type: "session_started", detail: {} });
      expect(logger.getRecent(10)).toHaveLength(1);
    });

    it("eventId is unique across multiple calls", () => {
      const a = logger.log({ type: "session_started", detail: {} });
      const b = logger.log({ type: "session_ended", detail: {} });
      expect(a.eventId).not.toBe(b.eventId);
    });
  });

  describe("ring buffer capping", () => {
    it("caps buffer at 500 entries", () => {
      for (let i = 0; i < 510; i++) {
        logger.log({ type: "session_started", detail: { i } });
      }
      expect(logger.getRecent(1000)).toHaveLength(500);
    });

    it("evicts oldest entry when cap exceeded", () => {
      logger.log({ type: "api_key_created", detail: { marker: "first" } });
      for (let i = 0; i < 500; i++) {
        logger.log({ type: "session_started", detail: {} });
      }
      const all = logger.getRecent(500);
      expect(all.every((e) => e.detail.marker !== "first")).toBe(true);
    });
  });

  describe("query()", () => {
    beforeEach(() => {
      logger.log({ type: "session_started", tenantId: "acme", detail: {} });
      logger.log({ type: "policy_decision", tenantId: "acme", detail: {} });
      logger.log({ type: "session_started", tenantId: "beta", detail: {} });
    });

    it("returns all events when no filters", () => {
      expect(logger.query()).toHaveLength(3);
    });

    it("filters by tenantId", () => {
      const results = logger.query({ tenantId: "acme" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.tenantId === "acme")).toBe(true);
    });

    it("filters by type", () => {
      const results = logger.query({ type: "session_started" });
      expect(results).toHaveLength(2);
    });

    it("filters by type returning only matching", () => {
      const results = logger.query({ type: "policy_decision" });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("policy_decision");
    });

    it("respects limit", () => {
      const results = logger.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("limit=1 returns most recent event", () => {
      const results = logger.query({ limit: 1 });
      expect(results[0].tenantId).toBe("beta");
    });

    it("combines tenantId + type filters", () => {
      const results = logger.query({ tenantId: "acme", type: "policy_decision" });
      expect(results).toHaveLength(1);
    });

    it("from timestamp in the future excludes all current events", () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(logger.query({ from: future })).toHaveLength(0);
    });

    it("to timestamp in the past excludes all current events", () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      expect(logger.query({ to: past })).toHaveLength(0);
    });
  });

  describe("getRecent()", () => {
    it("returns empty array for n=0", () => {
      logger.log({ type: "session_started", detail: {} });
      expect(logger.getRecent(0)).toEqual([]);
    });

    it("returns last n events in order", () => {
      logger.log({ type: "session_started", detail: { i: 1 } });
      logger.log({ type: "session_ended", detail: { i: 2 } });
      logger.log({ type: "policy_decision", detail: { i: 3 } });
      const recent = logger.getRecent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].detail.i).toBe(2);
      expect(recent[1].detail.i).toBe(3);
    });

    it("returns all events when n > buffer size", () => {
      logger.log({ type: "session_started", detail: {} });
      expect(logger.getRecent(100)).toHaveLength(1);
    });
  });

  describe("on() / off()", () => {
    it("listener receives events after on()", () => {
      const received: unknown[] = [];
      logger.on("event", (ev) => { received.push(ev); });
      logger.log({ type: "session_started", detail: {} });
      expect(received).toHaveLength(1);
    });

    it("listener no longer receives events after off()", () => {
      const received: unknown[] = [];
      const handler = (ev: unknown) => { received.push(ev); };
      logger.on("event", handler as Parameters<typeof logger.on>[1]);
      logger.log({ type: "session_started", detail: {} });
      logger.off("event", handler as Parameters<typeof logger.off>[1]);
      logger.log({ type: "session_ended", detail: {} });
      expect(received).toHaveLength(1);
    });
  });

  describe("persistence", () => {
    it("loads events from JSONL file on construction", () => {
      logger.log({ type: "session_started", tenantId: "acme", detail: {} });
      logger.log({ type: "session_ended", tenantId: "acme", detail: {} });
      const logger2 = new AuditEventLogger(filePath);
      expect(logger2.getRecent(100)).toHaveLength(2);
    });

    it("handles missing file gracefully", () => {
      const logger2 = new AuditEventLogger("/tmp/nonexistent-audit-vjj.jsonl");
      expect(logger2.getRecent(10)).toEqual([]);
    });

    it("handles corrupt JSONL lines gracefully (skips bad lines)", () => {
      writeFileSync(filePath, 'bad json\n{"eventId":"abc","timestamp":"2026-01-01T00:00:00.000Z","type":"session_started","detail":{}}\n');
      const logger2 = new AuditEventLogger(filePath);
      expect(logger2.getRecent(10)).toHaveLength(1);
    });
  });
});

// ── createAuditEventsRouter() ─────────────────────────────────────────────

describe("createAuditEventsRouter()", () => {
  let logger: AuditEventLogger;
  let server: Server;

  beforeEach(async () => {
    logger = new AuditEventLogger(makeTmpFile());
    ({ server } = buildApp(logger));
    await startServer(server);
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe("GET /audit/events", () => {
    it("returns empty array when no events", async () => {
      const res = await httpRequest(server, "GET", "/audit/events");
      expect(res.status).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("returns logged events", async () => {
      logger.log({ type: "session_started", detail: {} });
      logger.log({ type: "session_ended", detail: {} });
      const res = await httpRequest(server, "GET", "/audit/events");
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });

    it("filters by tenantId query param", async () => {
      logger.log({ type: "session_started", tenantId: "acme", detail: {} });
      logger.log({ type: "session_started", tenantId: "beta", detail: {} });
      const res = await httpRequest(server, "GET", "/audit/events?tenantId=acme");
      const body = res.json() as unknown[];
      expect(body).toHaveLength(1);
    });

    it("filters by type query param", async () => {
      logger.log({ type: "session_started", detail: {} });
      logger.log({ type: "policy_decision", detail: {} });
      const res = await httpRequest(server, "GET", "/audit/events?type=session_started");
      const body = res.json() as unknown[];
      expect(body).toHaveLength(1);
    });

    it("respects limit query param", async () => {
      for (let i = 0; i < 5; i++) logger.log({ type: "session_started", detail: { i } });
      const res = await httpRequest(server, "GET", "/audit/events?limit=3");
      const body = res.json() as unknown[];
      expect(body).toHaveLength(3);
    });
  });

  describe("GET /events — non-string filter params (branch coverage)", () => {
    beforeEach(() => {
      logger.log({ type: "session_started", tenantId: "org_a", detail: {} });
      logger.log({ type: "session_ended", tenantId: "org_b", detail: {} });
    });

    it("tenantId repeated as array — no filter applied, returns all events", async () => {
      // Express sets req.query.tenantId to string[] when param is repeated,
      // so typeof tenantId === "string" is false → branch skipped
      const res = await httpRequest(server, "GET", "/audit/events?tenantId[]=org_a&tenantId[]=org_b");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });

    it("type repeated as array — no filter applied, returns all events", async () => {
      // Same pattern for type param
      const res = await httpRequest(server, "GET", "/audit/events?type[]=audit.session.start&type[]=other");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });

    it("limit=abc (NaN) — no limit applied, returns all events", async () => {
      // parseInt("abc") === NaN → isNaN check fails → limit branch skipped
      const res = await httpRequest(server, "GET", "/audit/events?limit=abc");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });

    it("limit=-5 (negative) — no limit applied, returns all events", async () => {
      // n > 0 check fails for negative values → limit branch skipped
      const res = await httpRequest(server, "GET", "/audit/events?limit=-5");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });

    it("limit=0 (zero) — no limit applied, returns all events", async () => {
      // n > 0 check fails for zero → limit branch skipped
      const res = await httpRequest(server, "GET", "/audit/events?limit=0");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });
  });

  describe("GET /audit/events — from/to non-string params (branch coverage)", () => {
    beforeEach(() => {
      logger.log({ type: "session_started", tenantId: "acme", detail: {} });
      logger.log({ type: "session_ended", tenantId: "acme", detail: {} });
    });

    it("from repeated as array — branch skipped, returns all events", async () => {
      // Express sets req.query.from to string[] when param is repeated;
      // typeof from === "string" is false → L37 if-branch not taken
      const res = await httpRequest(server, "GET", "/audit/events?from[]=2026-01-01&from[]=2026-02-01");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });

    it("to repeated as array — branch skipped, returns all events", async () => {
      // Express sets req.query.to to string[] when param is repeated;
      // typeof to === "string" is false → L38 if-branch not taken
      const res = await httpRequest(server, "GET", "/audit/events?to[]=2026-12-31&to[]=2027-01-01");
      expect(res.status).toBe(200);
      const body = res.json() as unknown[];
      expect(body).toHaveLength(2);
    });
  });

  describe("GET /audit/events/stream", () => {
    it("returns 200 with text/event-stream content-type", async () => {
      // Use raw http to GET the SSE endpoint and immediately destroy
      const addr = server.address() as { port: number };
      await new Promise<void>((resolve, reject) => {
        import("http").then(({ default: http }) => {
          const req = http.request(
            { hostname: "127.0.0.1", port: addr.port, path: "/audit/events/stream", method: "GET" },
            (res) => {
              expect(res.statusCode).toBe(200);
              expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
              req.destroy();
              resolve();
            },
          );
          req.on("error", (e) => {
            // Ignore socket destroyed error (from req.destroy())
            if ((e as NodeJS.ErrnoException).code === "ECONNRESET") { resolve(); return; }
            reject(e);
          });
          req.end();
        });
      });
    });

    it("sends catch-up events as SSE data lines", async () => {
      logger.log({ type: "session_started", detail: {} });
      const addr = server.address() as { port: number };
      const received: string[] = [];
      await new Promise<void>((resolve, reject) => {
        import("http").then(({ default: http }) => {
          const req = http.request(
            { hostname: "127.0.0.1", port: addr.port, path: "/audit/events/stream", method: "GET" },
            (res) => {
              res.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf8");
                received.push(text);
                req.destroy();
                resolve();
              });
              res.on("error", (e) => {
                if ((e as NodeJS.ErrnoException).code === "ECONNRESET") { resolve(); return; }
                reject(e);
              });
            },
          );
          req.on("error", (e) => {
            if ((e as NodeJS.ErrnoException).code === "ECONNRESET") { resolve(); return; }
            reject(e);
          });
          req.end();
        });
      });
      const combined = received.join("");
      expect(combined).toContain("data:");
      expect(combined).toContain("session_started");
    });
  });
});
