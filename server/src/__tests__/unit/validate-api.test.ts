/**
 * Validate API Tests
 *
 * Tests the POST /validate router produced by createValidateRouter().
 * ConfigValidator is mocked as a plain object so the route handler's HTTP
 * contract can be verified independently of the validator's logic.
 *
 * HTTP transport uses the same Node http helper pattern used in health-api.test.ts.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createValidateRouter } from "../../api/validate.js";
import type { ConfigValidationResponse } from "../../services/ConfigValidator.js";

// ── HTTP helper ───────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function httpPostRaw(
  server: Server,
  path: string,
  rawPayload: string,
  contentType: string,
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
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "Content-Length": Buffer.byteLength(rawPayload),
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
            body: rawBody,
            json: () => JSON.parse(rawBody),
          });
        });
      });
      req.on("error", reject);
      req.write(rawPayload);
      req.end();
    });
  });
}

function httpPost(
  server: Server,
  path: string,
  body: unknown,
): Promise<HttpResponse> {
  return httpPostRaw(server, path, JSON.stringify(body), "application/json");
}

// ── Mock ConfigValidator ──────────────────────────────────────────────

const PASSING_RESPONSE: ConfigValidationResponse = {
  valid: true,
  checks: [
    { check: "reachability.openai",  passed: true,  message: "OK", durationMs: 12 },
    { check: "reachability.chromadb",passed: true,  message: "OK", durationMs: 8  },
    { check: "policy.opaBundle",     passed: true,  message: "OPA disabled, skipping", durationMs: 0 },
    { check: "tenantConfig",         passed: true,  message: "Tenant valid", durationMs: 1 },
    { check: "audioConfig",          passed: true,  message: "Audio config is valid", durationMs: 0 },
    { check: "storageDir",           passed: true,  message: "Writable", durationMs: 2 },
  ],
  durationMs: 25,
  timestamp: "2026-03-19T00:00:00.000Z",
};

const FAILING_RESPONSE: ConfigValidationResponse = {
  ...PASSING_RESPONSE,
  valid: false,
  checks: [
    ...PASSING_RESPONSE.checks.slice(0, 3),
    { check: "tenantConfig", passed: false, message: "tenantId is required", durationMs: 1 },
    ...PASSING_RESPONSE.checks.slice(4),
  ],
};

const mockValidator = {
  validate: jest.fn<Promise<ConfigValidationResponse>, [unknown]>(),
};

// ── Test app ──────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/validate", createValidateRouter(mockValidator as never));
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Validate API", () => {
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
    mockValidator.validate.mockResolvedValue(PASSING_RESPONSE);
  });

  // ── Happy path ────────────────────────────────────────────────────

  it("POST /validate returns 200", async () => {
    const res = await httpPost(server, "/validate", { tenantId: "abc" });
    expect(res.status).toBe(200);
  });

  it("response body has valid, checks, durationMs, timestamp fields", async () => {
    const res = await httpPost(server, "/validate", { tenantId: "abc" });
    const data = res.json() as Record<string, unknown>;
    expect(typeof data.valid).toBe("boolean");
    expect(Array.isArray(data.checks)).toBe(true);
    expect(typeof data.durationMs).toBe("number");
    expect(typeof data.timestamp).toBe("string");
  });

  it("ConfigValidator.validate is called with the request body", async () => {
    const body = { tenantId: "tenant-xyz", opaEnabled: false };
    await httpPost(server, "/validate", body);
    expect(mockValidator.validate).toHaveBeenCalledTimes(1);
    expect(mockValidator.validate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-xyz", opaEnabled: false }),
    );
  });

  it("returns valid:true when validator returns valid:true", async () => {
    mockValidator.validate.mockResolvedValue(PASSING_RESPONSE);
    const res = await httpPost(server, "/validate", {});
    const data = res.json() as ConfigValidationResponse;
    expect(data.valid).toBe(true);
  });

  it("returns 200 even when validator returns valid:false", async () => {
    mockValidator.validate.mockResolvedValue(FAILING_RESPONSE);
    const res = await httpPost(server, "/validate", { tenantId: "" });
    expect(res.status).toBe(200);
  });

  it("returns valid:false in body when validator returns valid:false", async () => {
    mockValidator.validate.mockResolvedValue(FAILING_RESPONSE);
    const res = await httpPost(server, "/validate", { tenantId: "" });
    const data = res.json() as ConfigValidationResponse;
    expect(data.valid).toBe(false);
  });

  it("checks array is forwarded from the validator response", async () => {
    const res = await httpPost(server, "/validate", {});
    const data = res.json() as ConfigValidationResponse;
    expect(data.checks).toHaveLength(PASSING_RESPONSE.checks.length);
    expect(data.checks[0].check).toBe("reachability.openai");
  });

  // ── Empty body ────────────────────────────────────────────────────

  it("returns 200 for empty JSON object body {}", async () => {
    const res = await httpPost(server, "/validate", {});
    expect(res.status).toBe(200);
  });

  // ── Malformed body ────────────────────────────────────────────────

  it("returns 400 for a non-object body (JSON array)", async () => {
    // Send a JSON array — valid JSON, but not an object
    const res = await httpPost(server, "/validate", [1, 2, 3]);
    expect(res.status).toBe(400);
  });

  it("400 response includes an error field", async () => {
    const res = await httpPost(server, "/validate", [1, 2, 3]);
    const data = res.json() as { error: string };
    expect(typeof data.error).toBe("string");
  });

  it("validate is NOT called when body is malformed", async () => {
    await httpPost(server, "/validate", [1, 2, 3]);
    expect(mockValidator.validate).not.toHaveBeenCalled();
  });

  // ── Error catch branches (lines 42-45) ────────────────────────────

  it("returns 500 when validator.validate rejects with an Error instance", async () => {
    mockValidator.validate.mockRejectedValue(new Error("validator exploded"));
    const res = await httpPost(server, "/validate", {});
    expect(res.status).toBe(500);
    const data = res.json() as { error: string };
    expect(data.error).toBe("validator exploded");
  });

  it("returns 500 when validator.validate rejects with a non-Error value", async () => {
    // Covers the `String(err)` branch of `err instanceof Error ? ... : String(err)`
    mockValidator.validate.mockRejectedValue("plain string rejection");
    const res = await httpPost(server, "/validate", {});
    expect(res.status).toBe(500);
    const data = res.json() as { error: string };
    expect(data.error).toBe("plain string rejection");
  });
});
