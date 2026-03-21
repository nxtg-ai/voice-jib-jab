/**
 * VoiceTrigger Tests
 *
 * Tests the VoiceTriggerService and /voice/* HTTP endpoints.
 * Follows the AdminApi.test.ts pattern: builds a standalone Express app
 * with injected dependencies to avoid importing index.ts (startup side effects).
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { VoiceTriggerService } from "../../services/VoiceTriggerService.js";
import { createVoiceRouter } from "../../api/voice.js";
import type { TriggerRecord } from "../../services/VoiceTriggerService.js";

// ── HTTP helpers (same pattern as AdminApi.test.ts) ────────────────────

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

    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload
          ? { "Content-Length": Buffer.byteLength(payload).toString() }
          : {}),
      },
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

// ── Test setup helpers ─────────────────────────────────────────────────

function makeConfigStore(sipTrunk: string | null = null) {
  return { get: () => ({ sipTrunk }) };
}

function buildTestApp(triggerService: VoiceTriggerService): Express {
  const app = express();
  app.use(express.json());
  app.use("/voice", createVoiceRouter(triggerService, "http://localhost:3000"));
  return app;
}

// ── Unit Tests: VoiceTriggerService ────────────────────────────────────

describe("VoiceTriggerService", () => {
  let service: VoiceTriggerService;

  beforeEach(() => {
    service = new VoiceTriggerService(
      "http://localhost:3000",
      makeConfigStore(null),
    );
  });

  it("createTrigger returns record with triggerId, sessionId, tenantId, status", () => {
    const record = service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });

    expect(record.triggerId).toBeDefined();
    expect(record.sessionId).toBeDefined();
    expect(record.tenantId).toBe("t1");
    expect(record.status).toBeDefined();
    expect(record.createdAt).toBeDefined();
  });

  it('status is "pending_ws" when no SIP trunk configured', () => {
    const record = service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });

    expect(record.status).toBe("pending_ws");
  });

  it('status is "pending_ws" when SIP trunk set but no phoneNumber', () => {
    const sipService = new VoiceTriggerService(
      "http://localhost:3000",
      makeConfigStore("sip.provider.com"),
    );

    const record = sipService.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });

    expect(record.status).toBe("pending_ws");
  });

  it('status is "pending_sip" when sipTrunk is set AND phoneNumber provided', () => {
    const sipService = new VoiceTriggerService(
      "http://localhost:3000",
      makeConfigStore("sip.provider.com"),
    );

    const record = sipService.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
      phoneNumber: "+15551234567",
    });

    expect(record.status).toBe("pending_sip");
  });

  it("wsUrl contains sessionId for pending_ws", () => {
    const record = service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });

    expect(record.wsUrl).toContain(record.sessionId);
    expect(record.wsUrl).toMatch(/^ws:\/\//);
  });

  it("wsUrl is null for pending_sip", () => {
    const sipService = new VoiceTriggerService(
      "http://localhost:3000",
      makeConfigStore("sip.provider.com"),
    );

    const record = sipService.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
      phoneNumber: "+15551234567",
    });

    expect(record.wsUrl).toBeNull();
  });

  it("getTrigger returns null for unknown ID", () => {
    expect(service.getTrigger("nonexistent-id")).toBeNull();
  });

  it("getTriggerBySession returns correct record", () => {
    const record = service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });

    const found = service.getTriggerBySession(record.sessionId);
    expect(found).not.toBeNull();
    expect(found!.triggerId).toBe(record.triggerId);
  });

  it("listTriggers returns all triggers", () => {
    service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb1",
    });
    service.createTrigger({
      tenantId: "t2",
      callbackUrl: "https://example.com/cb2",
    });

    const list = service.listTriggers();
    expect(list).toHaveLength(2);
  });

  it('activateTrigger sets status to "active"', () => {
    const record = service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });

    service.activateTrigger(record.sessionId);
    const updated = service.getTrigger(record.triggerId);
    expect(updated!.status).toBe("active");
  });

  it('completeTrigger sets status to "completed"', () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(
      async () => new Response("OK", { status: 200 }),
    ) as unknown as typeof fetch;

    try {
      const record = service.createTrigger({
        tenantId: "t1",
        callbackUrl: "https://example.com/cb",
      });

      service.completeTrigger(record.sessionId, {
        status: "completed",
        durationMs: 5000,
        transcript: [],
        policyDecisions: [],
      });

      const updated = service.getTrigger(record.triggerId);
      expect(updated!.status).toBe("completed");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("completeTrigger fires callback (mock fetch, verify called with correct URL + payload)", async () => {
    const fetchCalls: Array<{ url: string; options: RequestInit }> = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: string | URL | Request, options?: RequestInit) => {
      fetchCalls.push({ url: url as string, options: options! });
      return new Response("OK", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const record = service.createTrigger({
        tenantId: "t1",
        callbackUrl: "https://example.com/cb",
        metadata: { key: "value" },
      });

      service.completeTrigger(record.sessionId, {
        status: "completed",
        durationMs: 3000,
        transcript: [{ role: "user", text: "hello" }],
        policyDecisions: [],
      });

      // Allow the fire-and-forget promise to settle
      await new Promise((r) => setTimeout(r, 50));

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe("https://example.com/cb");

      const body = JSON.parse(fetchCalls[0].options.body as string);
      expect(body.triggerId).toBe(record.triggerId);
      expect(body.sessionId).toBe(record.sessionId);
      expect(body.tenantId).toBe("t1");
      expect(body.metadata).toEqual({ key: "value" });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("completeTrigger is fire-and-forget -- returns void synchronously", () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(
      async () => new Response("OK", { status: 200 }),
    ) as unknown as typeof fetch;

    try {
      const record = service.createTrigger({
        tenantId: "t1",
        callbackUrl: "https://example.com/cb",
      });

      // Should return void (undefined), not a Promise
      const result = service.completeTrigger(record.sessionId, {
        status: "completed",
        durationMs: null,
        transcript: [],
        policyDecisions: [],
      });

      expect(result).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("callback failure (fetch throws) does NOT propagate error", async () => {
    const originalFetch = global.fetch;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = jest.fn(async () => {
      throw new Error("Network failure");
    }) as unknown as typeof fetch;

    try {
      const record = service.createTrigger({
        tenantId: "t1",
        callbackUrl: "https://example.com/cb",
      });

      // Should not throw
      expect(() =>
        service.completeTrigger(record.sessionId, {
          status: "completed",
          durationMs: null,
          transcript: [],
          policyDecisions: [],
        }),
      ).not.toThrow();

      // Allow promise to settle
      await new Promise((r) => setTimeout(r, 50));

      expect(warnSpy).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      warnSpy.mockRestore();
    }
  });

  it("sendCallback includes triggerId, sessionId, tenantId in payload", async () => {
    const fetchCalls: Array<{ body: string }> = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      fetchCalls.push({ body: options?.body as string });
      return new Response("OK", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const record = service.createTrigger({
        tenantId: "tenant-abc",
        callbackUrl: "https://example.com/hook",
      });

      service.completeTrigger(record.sessionId, {
        status: "completed",
        durationMs: 1000,
        transcript: [],
        policyDecisions: [],
      });

      await new Promise((r) => setTimeout(r, 50));

      const body = JSON.parse(fetchCalls[0].body);
      expect(body.triggerId).toBe(record.triggerId);
      expect(body.sessionId).toBe(record.sessionId);
      expect(body.tenantId).toBe("tenant-abc");
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── Branch coverage: guard paths (lines 105-128, 157-158) ─────────────

  it("activateTrigger with unknown sessionId is a no-op (guard: !triggerId)", () => {
    // No trigger was created — pendingBySession has no entry for this ID
    expect(() => service.activateTrigger("unknown-session-id")).not.toThrow();
    expect(service.listTriggers()).toHaveLength(0);
  });

  it("completeTrigger with unknown sessionId is a no-op (guard: !triggerId)", () => {
    expect(() =>
      service.completeTrigger("unknown-session-id", {
        status: "completed",
        durationMs: null,
        transcript: [],
        policyDecisions: [],
      }),
    ).not.toThrow();
    expect(service.listTriggers()).toHaveLength(0);
  });

  it("getTriggerBySession with unknown sessionId returns null (guard: !triggerId)", () => {
    expect(service.getTriggerBySession("unknown-session-id")).toBeNull();
  });

  it("getTriggerBySession returns null when trigger deleted from map (guard: ?? null)", () => {
    // Exercise the `this.triggers.get(triggerId) ?? null` fallback on line 158.
    // We expose this by directly manipulating the internal map via a cast — the
    // only way to hit this branch without internal mutation API.
    const record = service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });
    // Remove from triggers map but leave pendingBySession intact
    (service as unknown as { triggers: Map<string, TriggerRecord> }).triggers.delete(
      record.triggerId,
    );
    expect(service.getTriggerBySession(record.sessionId)).toBeNull();
  });

  it("activateTrigger with stale sessionId (trigger deleted) is a no-op (guard: !record)", () => {
    const record = service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });
    (service as unknown as { triggers: Map<string, TriggerRecord> }).triggers.delete(
      record.triggerId,
    );
    expect(() => service.activateTrigger(record.sessionId)).not.toThrow();
  });

  it("completeTrigger with stale sessionId (trigger deleted) is a no-op (guard: !record)", () => {
    const record = service.createTrigger({
      tenantId: "t1",
      callbackUrl: "https://example.com/cb",
    });
    (service as unknown as { triggers: Map<string, TriggerRecord> }).triggers.delete(
      record.triggerId,
    );
    expect(() =>
      service.completeTrigger(record.sessionId, {
        status: "completed",
        durationMs: null,
        transcript: [],
        policyDecisions: [],
      }),
    ).not.toThrow();
  });

  it("sendCallback POSTs with Content-Type: application/json", async () => {
    const fetchCalls: Array<{ headers: Record<string, string> }> = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      fetchCalls.push({
        headers: options?.headers as Record<string, string>,
      });
      return new Response("OK", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const record = service.createTrigger({
        tenantId: "t1",
        callbackUrl: "https://example.com/cb",
      });

      service.completeTrigger(record.sessionId, {
        status: "completed",
        durationMs: null,
        transcript: [],
        policyDecisions: [],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(fetchCalls[0].headers["Content-Type"]).toBe("application/json");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── Integration Tests: Voice API Endpoints ─────────────────────────────

describe("Voice API Endpoints", () => {
  let server: Server;
  let triggerService: VoiceTriggerService;

  beforeAll((done) => {
    triggerService = new VoiceTriggerService(
      "http://localhost:3000",
      makeConfigStore(null),
    );
    const app = buildTestApp(triggerService);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  describe("POST /voice/trigger", () => {
    it("returns 202 with triggerId/sessionId/status", async () => {
      const res = await httpRequest(server, "POST", "/voice/trigger", {
        tenantId: "org_test",
        callbackUrl: "https://example.com/webhook",
      });

      expect(res.status).toBe(202);
      const data = res.json() as Record<string, unknown>;
      expect(data.triggerId).toBeDefined();
      expect(data.sessionId).toBeDefined();
      expect(data.status).toBe("pending_ws");
      expect(data.wsUrl).toBeDefined();
      expect(data.createdAt).toBeDefined();
    });

    it("returns 400 when tenantId missing", async () => {
      const res = await httpRequest(server, "POST", "/voice/trigger", {
        callbackUrl: "https://example.com/webhook",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tenantId");
    });

    it("returns 400 when callbackUrl missing", async () => {
      const res = await httpRequest(server, "POST", "/voice/trigger", {
        tenantId: "org_test",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("callbackUrl");
    });

    it("returns 400 when callbackUrl is invalid URL", async () => {
      const res = await httpRequest(server, "POST", "/voice/trigger", {
        tenantId: "org_test",
        callbackUrl: "not-a-valid-url",
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("callbackUrl");
    });
  });

  describe("GET /voice/triggers", () => {
    it("returns 200 with array", async () => {
      // Create a trigger first
      await httpRequest(server, "POST", "/voice/trigger", {
        tenantId: "org_list",
        callbackUrl: "https://example.com/webhook",
      });

      const res = await httpRequest(server, "GET", "/voice/triggers");

      expect(res.status).toBe(200);
      const data = res.json() as { triggers: TriggerRecord[]; count: number };
      expect(Array.isArray(data.triggers)).toBe(true);
      expect(data.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /voice/triggers/:id", () => {
    it("returns 200 for known trigger", async () => {
      const createRes = await httpRequest(server, "POST", "/voice/trigger", {
        tenantId: "org_get",
        callbackUrl: "https://example.com/webhook",
      });
      const { triggerId } = createRes.json() as { triggerId: string };

      const res = await httpRequest(
        server,
        "GET",
        `/voice/triggers/${triggerId}`,
      );

      expect(res.status).toBe(200);
      const data = res.json() as TriggerRecord;
      expect(data.triggerId).toBe(triggerId);
    });

    it("returns 404 for unknown trigger", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/voice/triggers/nonexistent-id",
      );

      expect(res.status).toBe(404);
    });
  });

  describe("POST /voice/triggers/:id/complete", () => {
    it("returns 200 on successful completion", async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn(
        async () => new Response("OK", { status: 200 }),
      ) as unknown as typeof fetch;

      try {
        const createRes = await httpRequest(server, "POST", "/voice/trigger", {
          tenantId: "org_complete",
          callbackUrl: "https://example.com/webhook",
        });
        const { triggerId } = createRes.json() as { triggerId: string };

        const res = await httpRequest(
          server,
          "POST",
          `/voice/triggers/${triggerId}/complete`,
          { transcript: [], policyDecisions: [], durationMs: 5000 },
        );

        expect(res.status).toBe(200);
        const data = res.json() as { status: string; triggerId: string };
        expect(data.status).toBe("completed");
        expect(data.triggerId).toBe(triggerId);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("returns 404 for unknown trigger", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/voice/triggers/nonexistent-id/complete",
        {},
      );

      expect(res.status).toBe(404);
    });
  });
});
