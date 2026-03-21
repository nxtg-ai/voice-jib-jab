/**
 * RemainingRoutesAuth Tests (N-34)
 *
 * Spot-checks that the N-34 guard extension protects the remaining
 * enterprise routes: /templates, /language, /ivr, /quality, /playbooks,
 * /voiceprints, /personas, /flows, /translation, /intents, /abtests,
 * /validate, /search, /sla, /kb-search, /training, /compare-agents,
 * /compliance-dashboard, /onboarding, /capacity, /skills, /agent-versions,
 * /routing, /supervisor, /voice, /voices.
 *
 * Uses the same minimal-express-app pattern as SessionsAuth.test.ts and
 * AnalyticsAuditAuth.test.ts — no full server import required.
 */

import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync } from "fs";
import express from "express";
import { createServer, type Server } from "http";
import { ApiKeyStore } from "../../services/ApiKeyStore.js";
import { createApiKeyMiddleware } from "../../middleware/apiKeyAuth.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "vjj-remaining-"));
  return join(dir, "keys.json");
}

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

/** The full N-34 guard path list (mirrors index.ts). */
const GUARDED_PATHS = [
  "/admin", "/tenants", "/webhooks", "/sessions",
  "/analytics", "/audit", "/recordings", "/export",
  "/templates", "/language", "/ivr", "/quality", "/playbooks",
  "/voiceprints", "/personas", "/flows", "/translation", "/intents",
  "/abtests", "/validate", "/search", "/sla", "/kb-search", "/training",
  "/compare-agents", "/compliance-dashboard", "/onboarding",
  "/capacity", "/skills", "/agent-versions", "/routing", "/supervisor",
  "/voice", "/voices",
];

/** Builds a minimal guarded app with a stub GET on every path. */
function buildGuardedApp(store: ApiKeyStore, enabled: boolean): Server {
  const app = express();
  app.use(express.json());
  const requireApiKey = createApiKeyMiddleware(store, enabled);
  app.use(GUARDED_PATHS, requireApiKey);
  for (const p of GUARDED_PATHS) {
    app.get(`${p}/*`, (_req, res) => res.json({ ok: true }));
    app.get(p, (_req, res) => res.json({ ok: true }));
  }
  return createServer(app);
}

function startServer(server: Server): Promise<void> {
  return new Promise((r) => server.listen(0, "127.0.0.1", r));
}

function stopServer(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("N-34: Remaining enterprise route protection", () => {
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

    it("GET /templates returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/templates");
      expect(res.status).toBe(401);
    });

    it("GET /ivr returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/ivr");
      expect(res.status).toBe(401);
    });

    it("GET /quality returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/quality");
      expect(res.status).toBe(401);
    });

    it("GET /voiceprints returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/voiceprints");
      expect(res.status).toBe(401);
    });

    it("GET /compliance-dashboard returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/compliance-dashboard");
      expect(res.status).toBe(401);
    });

    it("GET /training returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/training");
      expect(res.status).toBe(401);
    });

    it("GET /compare-agents returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/compare-agents");
      expect(res.status).toBe(401);
    });

    it("GET /agent-versions returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/agent-versions");
      expect(res.status).toBe(401);
    });

    it("GET /voices returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/voices");
      expect(res.status).toBe(401);
    });

    it("GET /skills returns 401 without key", async () => {
      const res = await httpRequest(server, "GET", "/skills");
      expect(res.status).toBe(401);
    });

    it("GET /templates returns 200 with valid key", async () => {
      const created = store.createKey("acme", "test");
      const res = await httpRequest(server, "GET", "/templates", {
        "x-api-key": created.rawKey,
      });
      expect(res.status).toBe(200);
    });

    it("GET /voiceprints returns 200 with valid key", async () => {
      const created = store.createKey("acme", "test");
      const res = await httpRequest(server, "GET", "/voiceprints", {
        "x-api-key": created.rawKey,
      });
      expect(res.status).toBe(200);
    });

    it("all N-34 paths return 401 without key", async () => {
      const n34Paths = [
        "/templates", "/language", "/ivr", "/quality", "/playbooks",
        "/voiceprints", "/personas", "/flows", "/translation", "/intents",
        "/abtests", "/validate", "/search", "/sla", "/kb-search", "/training",
        "/compare-agents", "/compliance-dashboard", "/onboarding",
        "/capacity", "/skills", "/agent-versions", "/routing", "/supervisor",
        "/voice", "/voices",
      ];
      for (const p of n34Paths) {
        const res = await httpRequest(server, "GET", p);
        expect(res.status).toBe(401);
      }
    });
  });

  describe("auth disabled", () => {
    beforeEach(async () => {
      store = new ApiKeyStore(makeTmpFile());
      server = buildGuardedApp(store, false);
      await startServer(server);
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it("GET /templates returns 200 without key when auth disabled", async () => {
      const res = await httpRequest(server, "GET", "/templates");
      expect(res.status).toBe(200);
    });

    it("GET /voiceprints returns 200 without key when auth disabled", async () => {
      const res = await httpRequest(server, "GET", "/voiceprints");
      expect(res.status).toBe(200);
    });

    it("GET /compliance-dashboard returns 200 without key when auth disabled", async () => {
      const res = await httpRequest(server, "GET", "/compliance-dashboard");
      expect(res.status).toBe(200);
    });
  });
});
