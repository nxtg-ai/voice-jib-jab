/**
 * Webhooks API Tests
 *
 * Tests the /webhooks router produced by createWebhooksRouter().
 * WebhookService is fully mocked with jest.fn().
 *
 * HTTP transport uses a plain Node http helper — no supertest dependency.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { createWebhooksRouter } from "../../api/webhooks.js";

// ── Mock WebhookService ────────────────────────────────────────────────

const mockSvc = {
  createWebhook: jest.fn(),
  getWebhook: jest.fn(),
  listWebhooks: jest.fn(),
  updateWebhook: jest.fn(),
  deleteWebhook: jest.fn(),
  deliver: jest.fn(),
  listDeliveries: jest.fn(),
  getDelivery: jest.fn(),
};

// ── HTTP helper ────────────────────────────────────────────────────────

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

// ── Test app ───────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/webhooks", createWebhooksRouter(mockSvc as never));
  return app;
}

// ── Fixture data ───────────────────────────────────────────────────────

const WEBHOOK_A: Record<string, unknown> = {
  webhookId: "wh-001",
  tenantId: "org_acme",
  url: "https://acme.example.com/events",
  events: ["call_start", "call_end"],
  active: true,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  description: "Main ACME webhook",
};

const WEBHOOK_B: Record<string, unknown> = {
  webhookId: "wh-002",
  tenantId: "org_beta",
  url: "https://beta.example.com/hook",
  events: ["escalation"],
  active: false,
  createdAt: "2026-03-05T08:00:00.000Z",
  updatedAt: "2026-03-05T08:00:00.000Z",
};

const DELIVERY_A: Record<string, unknown> = {
  deliveryId: "del-001",
  webhookId: "wh-001",
  tenantId: "org_acme",
  event: "call_start",
  payload: { event: "call_start", tenantId: "org_acme", timestamp: "2026-03-01T12:00:00.000Z", data: {} },
  attemptedAt: "2026-03-01T12:00:00.000Z",
  statusCode: 200,
  success: true,
  durationMs: 45,
};

// ── Tests ──────────────────────────────────────────────────────────────

describe("Webhooks API", () => {
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

  // ── GET /webhooks ────────────────────────────────────────────────

  describe("GET /webhooks", () => {
    it("returns 200 with array", async () => {
      mockSvc.listWebhooks.mockReturnValue([WEBHOOK_A, WEBHOOK_B]);

      const res = await httpRequest(server, "GET", "/webhooks");

      expect(res.status).toBe(200);
      const data = res.json() as unknown[];
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
    });

    it("passes tenantId query param to listWebhooks", async () => {
      mockSvc.listWebhooks.mockReturnValue([WEBHOOK_A]);

      await httpRequest(server, "GET", "/webhooks?tenantId=org_acme");

      expect(mockSvc.listWebhooks).toHaveBeenCalledWith("org_acme");
    });
  });

  // ── POST /webhooks ───────────────────────────────────────────────

  describe("POST /webhooks", () => {
    it("returns 201 with WebhookConfig", async () => {
      mockSvc.createWebhook.mockReturnValue(WEBHOOK_A);

      const res = await httpRequest(server, "POST", "/webhooks", {
        tenantId: "org_acme",
        url: "https://acme.example.com/events",
        events: ["call_start", "call_end"],
      });

      expect(res.status).toBe(201);
      const data = res.json() as typeof WEBHOOK_A;
      expect(data.webhookId).toBe("wh-001");
      expect(mockSvc.createWebhook).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for missing tenantId", async () => {
      const res = await httpRequest(server, "POST", "/webhooks", {
        url: "https://example.com/hook",
        events: ["call_start"],
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tenantId");
      expect(mockSvc.createWebhook).not.toHaveBeenCalled();
    });

    it("returns 400 for missing url", async () => {
      const res = await httpRequest(server, "POST", "/webhooks", {
        tenantId: "org_acme",
        events: ["call_start"],
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("url");
      expect(mockSvc.createWebhook).not.toHaveBeenCalled();
    });

    it("returns 400 for empty events array", async () => {
      const res = await httpRequest(server, "POST", "/webhooks", {
        tenantId: "org_acme",
        url: "https://example.com/hook",
        events: [],
      });

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("events");
      expect(mockSvc.createWebhook).not.toHaveBeenCalled();
    });
  });

  // ── GET /webhooks/:id ────────────────────────────────────────────

  describe("GET /webhooks/:webhookId", () => {
    it("returns 200 with the webhook", async () => {
      mockSvc.getWebhook.mockReturnValue(WEBHOOK_A);

      const res = await httpRequest(server, "GET", "/webhooks/wh-001");

      expect(res.status).toBe(200);
      const data = res.json() as typeof WEBHOOK_A;
      expect(data.webhookId).toBe("wh-001");
    });

    it("returns 404 when not found", async () => {
      mockSvc.getWebhook.mockReturnValue(undefined);

      const res = await httpRequest(server, "GET", "/webhooks/wh-999");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("wh-999");
    });
  });

  // ── PATCH /webhooks/:id ──────────────────────────────────────────

  describe("PATCH /webhooks/:webhookId", () => {
    it("returns 200 with updated config", async () => {
      const updated = { ...WEBHOOK_A, url: "https://new.example.com/hook" };
      mockSvc.updateWebhook.mockReturnValue(updated);

      const res = await httpRequest(server, "PATCH", "/webhooks/wh-001", {
        url: "https://new.example.com/hook",
      });

      expect(res.status).toBe(200);
      const data = res.json() as typeof updated;
      expect(data.url).toBe("https://new.example.com/hook");
    });

    it("returns 404 when not found", async () => {
      mockSvc.updateWebhook.mockReturnValue(undefined);

      const res = await httpRequest(server, "PATCH", "/webhooks/wh-999", {
        active: false,
      });

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("wh-999");
    });
  });

  // ── DELETE /webhooks/:id ─────────────────────────────────────────

  describe("DELETE /webhooks/:webhookId", () => {
    it("returns 204 on successful deletion", async () => {
      mockSvc.deleteWebhook.mockReturnValue(true);

      const res = await httpRequest(server, "DELETE", "/webhooks/wh-001");

      expect(res.status).toBe(204);
      expect(mockSvc.deleteWebhook).toHaveBeenCalledWith("wh-001");
    });

    it("returns 404 when not found", async () => {
      mockSvc.deleteWebhook.mockReturnValue(false);

      const res = await httpRequest(server, "DELETE", "/webhooks/wh-999");

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("wh-999");
    });
  });

  // ── GET /webhooks/:id/deliveries ─────────────────────────────────

  describe("GET /webhooks/:webhookId/deliveries", () => {
    it("returns 200 with deliveries array", async () => {
      mockSvc.listDeliveries.mockReturnValue([DELIVERY_A]);

      const res = await httpRequest(server, "GET", "/webhooks/wh-001/deliveries");

      expect(res.status).toBe(200);
      const data = res.json() as unknown[];
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(mockSvc.listDeliveries).toHaveBeenCalledWith("wh-001");
    });
  });

  // ── GET /webhooks/deliveries ─────────────────────────────────────

  describe("GET /webhooks/deliveries", () => {
    it("returns 200 with all deliveries", async () => {
      mockSvc.listDeliveries.mockReturnValue([DELIVERY_A]);

      const res = await httpRequest(server, "GET", "/webhooks/deliveries");

      expect(res.status).toBe(200);
      const data = res.json() as unknown[];
      expect(Array.isArray(data)).toBe(true);
    });

    it("passes tenantId filter to listDeliveries", async () => {
      mockSvc.listDeliveries.mockReturnValue([DELIVERY_A]);

      await httpRequest(server, "GET", "/webhooks/deliveries?tenantId=org_acme");

      expect(mockSvc.listDeliveries).toHaveBeenCalledWith(undefined, "org_acme");
    });
  });

  // ── POST /webhooks/test ──────────────────────────────────────────

  describe("POST /webhooks/test", () => {
    it("returns 200 with delivery result", async () => {
      mockSvc.getWebhook.mockReturnValue(WEBHOOK_A);
      mockSvc.deliver.mockResolvedValue([DELIVERY_A]);

      const res = await httpRequest(server, "POST", "/webhooks/test", {
        webhookId: "wh-001",
        event: "call_start",
      });

      expect(res.status).toBe(200);
      const data = res.json() as typeof DELIVERY_A;
      expect(data.deliveryId).toBe("del-001");
    });

    it("returns 404 for unknown webhook", async () => {
      mockSvc.getWebhook.mockReturnValue(undefined);

      const res = await httpRequest(server, "POST", "/webhooks/test", {
        webhookId: "wh-999",
        event: "call_start",
      });

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("wh-999");
    });

    it("defaults testEvent to call_start when event is omitted from body (L82 ?? branch)", async () => {
      mockSvc.getWebhook.mockReturnValue(WEBHOOK_A);
      mockSvc.deliver.mockResolvedValue([DELIVERY_A]);

      const res = await httpRequest(server, "POST", "/webhooks/test", {
        webhookId: "wh-001",
        // no event field
      });

      expect(res.status).toBe(200);
      // deliver was called with "call_start" as the default event
      expect(mockSvc.deliver).toHaveBeenCalledWith(
        expect.any(String),
        "call_start",
        expect.objectContaining({ event: "call_start" }),
      );
    });

    it("falls back to deliveries[0] when no delivery matches webhookId (L107 ?? branch)", async () => {
      mockSvc.getWebhook.mockReturnValue(WEBHOOK_A);
      // Delivery belongs to a different webhookId — thisDelivery will be undefined
      const differentDelivery = { ...DELIVERY_A, deliveryId: "del-fallback", webhookId: "wh-other" };
      mockSvc.deliver.mockResolvedValue([differentDelivery]);

      const res = await httpRequest(server, "POST", "/webhooks/test", {
        webhookId: "wh-001",
        event: "call_start",
      });

      expect(res.status).toBe(200);
      const data = res.json() as typeof differentDelivery;
      // Should return deliveries[0] (del-fallback) since no delivery matched wh-001
      expect(data.deliveryId).toBe("del-fallback");
    });
  });

  // ── PATCH /webhooks/:id — full field coverage ─────────────────────

  describe("PATCH /webhooks/:webhookId — field branches", () => {
    it("passes events array to updateWebhook when provided (L140/L182 cond-expr typed branch)", async () => {
      const updated = { ...WEBHOOK_A, events: ["call_end"] };
      mockSvc.updateWebhook.mockReturnValue(updated);

      const res = await httpRequest(server, "PATCH", "/webhooks/wh-001", {
        events: ["call_end"],
      });

      expect(res.status).toBe(200);
      expect(mockSvc.updateWebhook).toHaveBeenCalledWith(
        "wh-001",
        expect.objectContaining({ events: ["call_end"] }),
      );
    });

    it("passes secret string to updateWebhook when provided (L141/L185 cond-expr typed branch)", async () => {
      const updated = { ...WEBHOOK_A, secret: "new-secret" };
      mockSvc.updateWebhook.mockReturnValue(updated);

      const res = await httpRequest(server, "PATCH", "/webhooks/wh-001", {
        secret: "new-secret",
      });

      expect(res.status).toBe(200);
      expect(mockSvc.updateWebhook).toHaveBeenCalledWith(
        "wh-001",
        expect.objectContaining({ secret: "new-secret" }),
      );
    });

    it("passes description string to updateWebhook when provided (L142/L187 cond-expr typed branch)", async () => {
      const updated = { ...WEBHOOK_A, description: "Updated description" };
      mockSvc.updateWebhook.mockReturnValue(updated);

      const res = await httpRequest(server, "PATCH", "/webhooks/wh-001", {
        description: "Updated description",
      });

      expect(res.status).toBe(200);
      expect(mockSvc.updateWebhook).toHaveBeenCalledWith(
        "wh-001",
        expect.objectContaining({ description: "Updated description" }),
      );
    });

    it("passes url string to updateWebhook when provided (L140 url branch)", async () => {
      const updated = { ...WEBHOOK_A, url: "https://updated.example.com/hook" };
      mockSvc.updateWebhook.mockReturnValue(updated);

      const res = await httpRequest(server, "PATCH", "/webhooks/wh-001", {
        url: "https://updated.example.com/hook",
      });

      expect(res.status).toBe(200);
      expect(mockSvc.updateWebhook).toHaveBeenCalledWith(
        "wh-001",
        expect.objectContaining({ url: "https://updated.example.com/hook" }),
      );
    });
  });
});

// ── POST /webhooks/test — missing webhookId (lines 72-73) ──────────────

describe("POST /webhooks/test — validation", () => {
  let server: Server;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use("/webhooks", createWebhooksRouter(mockSvc as never));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when webhookId is absent from body", async () => {
    const res = await httpRequest(server, "POST", "/webhooks/test", {});

    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toBe("webhookId is required");
    expect(mockSvc.getWebhook).not.toHaveBeenCalled();
  });
});

// ── POST /webhooks/test — deliverDirectly path (lines 100-274) ─────────

describe("POST /webhooks/test — deliverDirectly", () => {
  let server: Server;

  const WEBHOOK_WITH_SECRET: Record<string, unknown> = {
    webhookId: "wh-sec",
    tenantId: "org_acme",
    url: "https://acme.example.com/hook",
    events: ["call_start"],
    active: false,
    secret: "s3cr3t",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
  };

  const WEBHOOK_NO_SECRET: Record<string, unknown> = {
    webhookId: "wh-nosec",
    tenantId: "org_acme",
    url: "https://acme.example.com/hook",
    events: ["call_start"],
    active: false,
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
  };

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use("/webhooks", createWebhooksRouter(mockSvc as never));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls deliverDirectly when deliver() returns empty array and returns a delivery", async () => {
    mockSvc.getWebhook.mockReturnValue(WEBHOOK_NO_SECRET);
    mockSvc.deliver.mockResolvedValue([]);
    jest.spyOn(global, "fetch").mockResolvedValue({ status: 200, ok: true } as Response);

    const res = await httpRequest(server, "POST", "/webhooks/test", {
      webhookId: "wh-nosec",
      event: "call_start",
    });

    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(data.webhookId).toBe("wh-nosec");
    expect(data.success).toBe(true);
    expect(data.statusCode).toBe(200);
    expect(typeof data.deliveryId).toBe("string");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("deliverDirectly — webhook without secret sends no X-Webhook-Signature header", async () => {
    mockSvc.getWebhook.mockReturnValue(WEBHOOK_NO_SECRET);
    mockSvc.deliver.mockResolvedValue([]);
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ status: 200, ok: true } as Response);

    await httpRequest(server, "POST", "/webhooks/test", {
      webhookId: "wh-nosec",
      event: "call_start",
    });

    const [, fetchInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = fetchInit.headers as Record<string, string>;
    expect(headers["X-Webhook-Signature"]).toBeUndefined();
  });

  it("deliverDirectly — webhook with secret adds X-Webhook-Signature header", async () => {
    mockSvc.getWebhook.mockReturnValue(WEBHOOK_WITH_SECRET);
    mockSvc.deliver.mockResolvedValue([]);
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ status: 200, ok: true } as Response);

    await httpRequest(server, "POST", "/webhooks/test", {
      webhookId: "wh-sec",
      event: "call_start",
    });

    const [, fetchInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = fetchInit.headers as Record<string, string>;
    expect(headers["X-Webhook-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("deliverDirectly — 400 response sets success = false", async () => {
    mockSvc.getWebhook.mockReturnValue(WEBHOOK_NO_SECRET);
    mockSvc.deliver.mockResolvedValue([]);
    jest.spyOn(global, "fetch").mockResolvedValue({ status: 400, ok: false } as Response);

    const res = await httpRequest(server, "POST", "/webhooks/test", {
      webhookId: "wh-nosec",
      event: "call_start",
    });

    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(data.success).toBe(false);
    expect(data.statusCode).toBe(400);
    expect(data.error).toBeUndefined();
  });

  it("deliverDirectly — fetch throws Error → error field contains message", async () => {
    mockSvc.getWebhook.mockReturnValue(WEBHOOK_NO_SECRET);
    mockSvc.deliver.mockResolvedValue([]);
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await httpRequest(server, "POST", "/webhooks/test", {
      webhookId: "wh-nosec",
      event: "call_start",
    });

    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(data.success).toBe(false);
    expect(data.statusCode).toBeUndefined();
    expect(data.error).toBe("ECONNREFUSED");
  });

  it("deliverDirectly — fetch throws non-Error value → error field is stringified", async () => {
    mockSvc.getWebhook.mockReturnValue(WEBHOOK_NO_SECRET);
    mockSvc.deliver.mockResolvedValue([]);
    jest.spyOn(global, "fetch").mockRejectedValue("timeout");

    const res = await httpRequest(server, "POST", "/webhooks/test", {
      webhookId: "wh-nosec",
      event: "call_start",
    });

    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(data.success).toBe(false);
    expect(data.error).toBe("timeout");
  });
});
