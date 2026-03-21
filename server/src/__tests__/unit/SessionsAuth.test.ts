/**
 * SessionsAuth Tests (N-32)
 *
 * Verifies that the API key guard is applied to /sessions routes.
 * Tests are written against a minimal express app that reproduces the
 * auth middleware + sessions router stack from index.ts, without importing
 * the full server. SessionRecorder is mocked to return empty data.
 */

import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync } from "fs";
import express from "express";
import { createServer, type Server } from "http";
import { ApiKeyStore } from "../../services/ApiKeyStore.js";
import { createApiKeyMiddleware } from "../../middleware/apiKeyAuth.js";
import { createSessionsRouter } from "../../api/sessions.js";
import { createProfilerRouter } from "../../api/profiler.js";
import { pipelineProfiler } from "../../services/PipelineProfiler.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "vjj-sessauth-"));
  return join(dir, "keys.json");
}

/** Minimal SessionRecorder stub — returns empty lists for all calls. */
const mockRecorder = {
  listRecordings: () => [],
  getRecording: () => undefined,
  startRecording: () => {},
  stopRecording: () => {},
  appendEvent: () => {},
} as unknown as import("../../services/SessionRecorder.js").SessionRecorder;

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Not listening"));
    import("http").then(({ default: http }) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: addr.port, path, method, headers: headers ?? {} },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf-8");
            resolve({ status: res.statusCode ?? 0, body: rawBody, json: () => JSON.parse(rawBody) });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  });
}

function buildGuardedApp(store: ApiKeyStore, enabled: boolean): Server {
  const app = express();
  app.use(express.json());
  const requireApiKey = createApiKeyMiddleware(store, enabled);
  app.use(["/sessions"], requireApiKey);
  app.use("/sessions", createSessionsRouter(mockRecorder));
  app.use("/sessions", createProfilerRouter(pipelineProfiler));
  return createServer(app);
}

function startServer(server: Server): Promise<void> {
  return new Promise((r) => server.listen(0, "127.0.0.1", r));
}

function stopServer(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("N-32: Session endpoint protection", () => {
  let store: ApiKeyStore;
  let server: Server;

  describe("auth enabled", () => {
    beforeEach(async () => {
      store = new ApiKeyStore(makeTmpFile());
      server = buildGuardedApp(store, true);
      await startServer(server);
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it("GET /sessions returns 401 without X-API-Key", async () => {
      const res = await httpRequest(server, "GET", "/sessions");
      expect(res.status).toBe(401);
    });

    it("GET /sessions/:id returns 401 without X-API-Key", async () => {
      const res = await httpRequest(server, "GET", "/sessions/sess-abc");
      expect(res.status).toBe(401);
    });

    it("GET /sessions/:id/summary returns 401 without X-API-Key", async () => {
      const res = await httpRequest(server, "GET", "/sessions/sess-abc/summary");
      expect(res.status).toBe(401);
    });

    it("GET /sessions/:id/replay returns 401 without X-API-Key", async () => {
      const res = await httpRequest(server, "GET", "/sessions/sess-abc/replay");
      expect(res.status).toBe(401);
    });

    it("GET /sessions/:id/profile returns 401 without X-API-Key", async () => {
      const res = await httpRequest(server, "GET", "/sessions/sess-abc/profile");
      expect(res.status).toBe(401);
    });

    it("GET /sessions returns 200 with valid X-API-Key", async () => {
      const created = store.createKey("acme", "test");
      const res = await httpRequest(server, "GET", "/sessions", { "x-api-key": created.rawKey });
      expect(res.status).toBe(200);
    });

    it("GET /sessions returns 401 with expired key", async () => {
      const created = store.createKey("acme", "test", 30);
      // Force expiry
      (store as unknown as { keys: Array<{ keyId: string; expiresAt: string }> }).keys.find(
        (k) => k.keyId === created.keyId,
      )!.expiresAt = new Date(Date.now() - 1000).toISOString();
      const res = await httpRequest(server, "GET", "/sessions", { "x-api-key": created.rawKey });
      expect(res.status).toBe(401);
      const body = res.json() as { error: string };
      expect(body.error).toContain("expired");
    });

    it("error response body has 'error' field", async () => {
      const res = await httpRequest(server, "GET", "/sessions");
      const body = res.json() as { error: string };
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    });
  });

  describe("auth disabled (API_KEY_AUTH_ENABLED=false)", () => {
    beforeEach(async () => {
      store = new ApiKeyStore(makeTmpFile());
      server = buildGuardedApp(store, false);
      await startServer(server);
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it("GET /sessions returns 200 without any key when auth disabled", async () => {
      const res = await httpRequest(server, "GET", "/sessions");
      expect(res.status).toBe(200);
    });
  });
});
