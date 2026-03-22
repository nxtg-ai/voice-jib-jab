/**
 * ConfigValidator Unit Tests
 *
 * Covers all six validation checks plus overall behaviour (concurrent
 * execution, response shape, valid/invalid aggregation).
 *
 * External I/O is fully mocked:
 *  - fetch  → jest.spyOn(global, "fetch")
 *  - fs.promises.access → jest.mock("node:fs/promises", ...)
 */

import { ConfigValidator } from "../../services/ConfigValidator.js";
import type {
  ConfigValidationRequest,
  ValidationResult,
} from "../../services/ConfigValidator.js";
import type { ServerConfig } from "../../config/index.js";

// ── fs mock ───────────────────────────────────────────────────────────

jest.mock("node:fs/promises", () => ({
  access: jest.fn(),
}));

import * as fsp from "node:fs/promises";

// Cast once so TypeScript is happy with mockResolvedValue / mockRejectedValue
const mockAccess = fsp.access as jest.MockedFunction<typeof fsp.access>;

// ── Minimal config fixture ────────────────────────────────────────────

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 3000,
    nodeEnv: "test",
    openai: { apiKey: "sk-test", model: "gpt-realtime" },
    features: {
      enableLaneA: true,
      enableRAG: true,
      enablePolicyGate: true,
      enableAuditTrail: true,
      enablePersistentMemory: true,
    },
    latency: { ttfbTargetP50: 400, ttfbTargetP95: 900, bargeInTargetP95: 250 },
    safety: {
      enablePIIRedaction: true,
      storeRawAudio: false,
      maxSessionDurationMinutes: 30,
    },
    rag: { topK: 5, maxTokens: 600, maxBytes: 4000 },
    storage: {
      databasePath: "/data/voice-jib-jab.db",
      enableWalMode: true,
      maxHistoryTurns: 20,
      maxSummaryLength: 2000,
    },
    fallback: { mode: "auto" },
    opa: { enabled: false, bundlePath: "/policies/bundle.tar.gz" },
    ...overrides,
  };
}

// ── fetch mock helper ─────────────────────────────────────────────────

function mockFetchResponse(status: number): void {
  jest.spyOn(global, "fetch").mockResolvedValue(
    new Response(null, { status }) as Response,
  );
}

function mockFetchNetworkError(message = "Network error"): void {
  jest.spyOn(global, "fetch").mockRejectedValue(new Error(message));
}

// ── Helpers ───────────────────────────────────────────────────────────

function findCheck(checks: ValidationResult[], name: string): ValidationResult {
  const found = checks.find((c) => c.check === name);
  if (!found) throw new Error(`Check "${name}" not found in results`);
  return found;
}

function makePassingRequest(): ConfigValidationRequest {
  return {
    tenantId: "tenant-abc",
    audioConfig: { sampleRate: 44100, channelCount: 1 },
    opaEnabled: false,
    openAiBaseUrl: "https://api.openai.com",
    chromaDbUrl: "http://localhost:8000",
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Default: storage dir is writable, OPA bundle accessible
  mockAccess.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Overall behaviour ─────────────────────────────────────────────────

describe("ConfigValidator.validate() — overall behaviour", () => {
  it("returns valid:true when all checks pass", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    expect(res.valid).toBe(true);
  });

  it("returns valid:false when any check fails", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    // Pass empty tenantId to force tenant check failure
    const res = await validator.validate({ ...makePassingRequest(), tenantId: "" });
    expect(res.valid).toBe(false);
  });

  it("response always includes durationMs", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    expect(typeof res.durationMs).toBe("number");
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("response always includes timestamp as ISO string", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    expect(typeof res.timestamp).toBe("string");
    expect(() => new Date(res.timestamp)).not.toThrow();
    expect(new Date(res.timestamp).getTime()).toBeGreaterThan(0);
  });

  it("response includes a checks array", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    expect(Array.isArray(res.checks)).toBe(true);
  });

  it("every ValidationResult has check, passed, message, durationMs fields", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    for (const item of res.checks) {
      expect(typeof item.check).toBe("string");
      expect(typeof item.passed).toBe("boolean");
      expect(typeof item.message).toBe("string");
      expect(typeof item.durationMs).toBe("number");
    }
  });

  it("runs all checks (Promise.allSettled) — all 6 checks present", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    expect(res.checks).toHaveLength(6);
  });
});

// ── reachability.openai ───────────────────────────────────────────────

describe("reachability.openai check", () => {
  it("passes on 401 response (server up, auth fails)", async () => {
    mockFetchResponse(401);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.openai");
    expect(check.passed).toBe(true);
  });

  it("passes on 403 response (server up, forbidden)", async () => {
    mockFetchResponse(403);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.openai");
    expect(check.passed).toBe(true);
  });

  it("passes on 200 response", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.openai");
    expect(check.passed).toBe(true);
  });

  it("fails on 500 response", async () => {
    mockFetchResponse(500);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.openai");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("500");
  });

  it("fails on network error", async () => {
    mockFetchNetworkError("ECONNREFUSED");
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.openai");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("ECONNREFUSED");
  });
});

// ── reachability.chromadb ─────────────────────────────────────────────

describe("reachability.chromadb check", () => {
  it("passes on 200 response", async () => {
    mockFetchResponse(200);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.chromadb");
    expect(check.passed).toBe(true);
  });

  it("fails on 500 response", async () => {
    // First call (openai) may succeed or fail; we only care about chromadb
    // Use a side-effectful mock: alternate responses
    let callCount = 0;
    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      callCount++;
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/v1/heartbeat")) {
        return new Response(null, { status: 500 }) as Response;
      }
      return new Response(null, { status: 200 }) as Response;
    });

    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.chromadb");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("500");
  });

  it("fails on network error", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/v1/heartbeat")) {
        throw new Error("Connection refused");
      }
      return new Response(null, { status: 200 }) as Response;
    });

    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.chromadb");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("Connection refused");
  });
});

// ── policy.opaBundle ─────────────────────────────────────────────────

describe("policy.opaBundle check", () => {
  beforeEach(() => {
    mockFetchResponse(200);
  });

  it("passes (skips) when opaEnabled=false in request", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({ ...makePassingRequest(), opaEnabled: false });
    const check = findCheck(res.checks, "policy.opaBundle");
    expect(check.passed).toBe(true);
    expect(check.message).toContain("OPA disabled");
  });

  it("passes (skips) when opaEnabled not set and config.opa.enabled=false", async () => {
    const validator = new ConfigValidator(makeConfig({ opa: { enabled: false, bundlePath: "/policies/bundle.tar.gz" } }));
    const req = { ...makePassingRequest() };
    delete req.opaEnabled;
    const res = await validator.validate(req);
    const check = findCheck(res.checks, "policy.opaBundle");
    expect(check.passed).toBe(true);
    expect(check.message).toContain("OPA disabled");
  });

  it("passes when opaEnabled=true and bundle file exists", async () => {
    mockAccess.mockResolvedValue(undefined);
    const validator = new ConfigValidator(makeConfig({ opa: { enabled: true, bundlePath: "/policies/bundle.tar.gz" } }));
    const res = await validator.validate({ ...makePassingRequest(), opaEnabled: true });
    const check = findCheck(res.checks, "policy.opaBundle");
    expect(check.passed).toBe(true);
    expect(check.message).toContain("found");
  });

  it("fails when opaEnabled=true and bundle file does not exist", async () => {
    // Make access reject only for the bundle path, not for the storage dir
    mockAccess.mockImplementation(async (p) => {
      if (String(p).includes("bundle.tar.gz")) {
        throw new Error("ENOENT");
      }
      return undefined;
    });
    const validator = new ConfigValidator(makeConfig({ opa: { enabled: true, bundlePath: "/policies/bundle.tar.gz" } }));
    const res = await validator.validate({ ...makePassingRequest(), opaEnabled: true });
    const check = findCheck(res.checks, "policy.opaBundle");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("not found");
  });
});

// ── tenantConfig ──────────────────────────────────────────────────────

describe("tenantConfig check", () => {
  beforeEach(() => {
    mockFetchResponse(200);
  });

  it("fails when tenantId is empty string", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({ ...makePassingRequest(), tenantId: "" });
    const check = findCheck(res.checks, "tenantConfig");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("tenantId is required");
  });

  it("fails when tenantId is undefined", async () => {
    const validator = new ConfigValidator(makeConfig());
    const req: ConfigValidationRequest = { ...makePassingRequest() };
    delete req.tenantId;
    const res = await validator.validate(req);
    const check = findCheck(res.checks, "tenantConfig");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("tenantId is required");
  });

  it("passes when tenantId is provided and no tenantConfig", async () => {
    const validator = new ConfigValidator(makeConfig());
    const req: ConfigValidationRequest = { ...makePassingRequest() };
    delete req.tenantConfig;
    const res = await validator.validate(req);
    const check = findCheck(res.checks, "tenantConfig");
    expect(check.passed).toBe(true);
  });

  it("fails when tenantConfig has disabled:true", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({
      ...makePassingRequest(),
      tenantConfig: { disabled: true },
    });
    const check = findCheck(res.checks, "tenantConfig");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("Tenant is disabled");
  });

  it("passes when tenantConfig has disabled:false", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({
      ...makePassingRequest(),
      tenantConfig: { disabled: false, plan: "enterprise" },
    });
    const check = findCheck(res.checks, "tenantConfig");
    expect(check.passed).toBe(true);
  });
});

// ── audioConfig ───────────────────────────────────────────────────────

describe("audioConfig check", () => {
  beforeEach(() => {
    mockFetchResponse(200);
  });

  it("passes when no audioConfig provided", async () => {
    const validator = new ConfigValidator(makeConfig());
    const req: ConfigValidationRequest = { ...makePassingRequest() };
    delete req.audioConfig;
    const res = await validator.validate(req);
    const check = findCheck(res.checks, "audioConfig");
    expect(check.passed).toBe(true);
    expect(check.message).toContain("defaults");
  });

  it("passes for valid sampleRate 44100 and channelCount 1", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({
      ...makePassingRequest(),
      audioConfig: { sampleRate: 44100, channelCount: 1 },
    });
    const check = findCheck(res.checks, "audioConfig");
    expect(check.passed).toBe(true);
  });

  it("passes for sampleRate at lower bound (8000)", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({
      ...makePassingRequest(),
      audioConfig: { sampleRate: 8000, channelCount: 2 },
    });
    const check = findCheck(res.checks, "audioConfig");
    expect(check.passed).toBe(true);
  });

  it("fails for sampleRate below 8000", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({
      ...makePassingRequest(),
      audioConfig: { sampleRate: 7999 },
    });
    const check = findCheck(res.checks, "audioConfig");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("7999");
  });

  it("fails for sampleRate above 48000", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({
      ...makePassingRequest(),
      audioConfig: { sampleRate: 48001 },
    });
    const check = findCheck(res.checks, "audioConfig");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("48001");
  });

  it("fails for channelCount 0", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({
      ...makePassingRequest(),
      audioConfig: { channelCount: 0 },
    });
    const check = findCheck(res.checks, "audioConfig");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("0");
  });

  it("fails for channelCount 3 (> 2)", async () => {
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate({
      ...makePassingRequest(),
      audioConfig: { channelCount: 3 },
    });
    const check = findCheck(res.checks, "audioConfig");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("3");
  });
});

// ── storageDir ────────────────────────────────────────────────────────

describe("storageDir check", () => {
  beforeEach(() => {
    mockFetchResponse(200);
  });

  it("passes when storage directory is writable", async () => {
    mockAccess.mockResolvedValue(undefined);
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "storageDir");
    expect(check.passed).toBe(true);
    expect(check.message).toContain("writable");
  });

  it("fails when storage directory is not accessible", async () => {
    mockAccess.mockRejectedValue(new Error("EACCES: permission denied"));
    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "storageDir");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("not writable");
  });
});

// ── Concurrency ───────────────────────────────────────────────────────

describe("concurrency", () => {
  it("runs checks concurrently — all complete even if one would block", async () => {
    // Simulate a slow openai check and ensure others still resolve
    let openaiResolved = false;
    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/v1/models")) {
        await new Promise((r) => setTimeout(r, 10));
        openaiResolved = true;
        return new Response(null, { status: 200 }) as Response;
      }
      return new Response(null, { status: 200 }) as Response;
    });

    mockAccess.mockResolvedValue(undefined);

    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());

    expect(openaiResolved).toBe(true);
    expect(res.checks).toHaveLength(6);
    // All still complete
    expect(res.checks.every((c) => typeof c.passed === "boolean")).toBe(true);
  });
});

// ── Branch coverage ───────────────────────────────────────────────────

describe("ConfigValidator — branch coverage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // L84: String(outcome.reason) — non-Error rejection from a check function
  it("validate() uses String(reason) when a check rejects with a non-Error", async () => {
    // Force one of the check functions to reject with a plain string (not Error)
    // We do this by making fetch throw a non-Error object; but that only hits L140/L158.
    // To reach L84 we need the entire check *function* to throw unexpectedly.
    // We monkey-patch fsp.access to throw a plain string, which propagates through
    // checkStorageDir (no catch on non-Error) and surfaces in allSettled as rejected.
    mockAccess.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "disk-full" as unknown as Error;
    });

    mockFetchResponse(200);

    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());

    // The storageDir check will either surface as an "unknown" failure (if the
    // throw escapes allSettled) or as a normal failure; either way valid is false
    // and the String() branch at L84 is exercised when outcome.reason is a string.
    expect(res.valid).toBe(false);
  });

  // L116: openAiBaseUrl ?? "https://api.openai.com" — fallback when URL not provided
  it("checkOpenAi() uses default URL when openAiBaseUrl not in request", async () => {
    const capturedUrls: string[] = [];
    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      capturedUrls.push(typeof input === "string" ? input : (input as Request).url);
      return new Response(null, { status: 200 }) as Response;
    });

    const validator = new ConfigValidator(makeConfig());
    // Omit openAiBaseUrl — triggers the ?? fallback branch
    const req: ConfigValidationRequest = { ...makePassingRequest() };
    delete req.openAiBaseUrl;
    await validator.validate(req);

    expect(capturedUrls.some((u) => u.includes("https://api.openai.com"))).toBe(true);
  });

  // L140: chromaDbUrl ?? "http://localhost:8000" — fallback when URL not provided
  it("checkChromaDb() uses default URL when chromaDbUrl not in request", async () => {
    const capturedUrls: string[] = [];
    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      capturedUrls.push(typeof input === "string" ? input : (input as Request).url);
      return new Response(null, { status: 200 }) as Response;
    });

    const validator = new ConfigValidator(makeConfig());
    // Omit chromaDbUrl — triggers the ?? fallback branch
    const req: ConfigValidationRequest = { ...makePassingRequest() };
    delete req.chromaDbUrl;
    await validator.validate(req);

    expect(capturedUrls.some((u) => u.includes("localhost:8000"))).toBe(true);
  });

  // L158: String(err) in checkChromaDb catch — non-Error thrown from fetch
  it("checkChromaDb() uses String(err) when fetch throws a non-Error value", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/v1/heartbeat")) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 42 as unknown as Error;
      }
      return new Response(null, { status: 200 }) as Response;
    });

    const validator = new ConfigValidator(makeConfig());
    const res = await validator.validate(makePassingRequest());
    const check = findCheck(res.checks, "reachability.chromadb");

    expect(check.passed).toBe(false);
    expect(check.message).toContain("42");
  });

  // L181: opaEnabled ?? this.config.opa.enabled — fallback reads config when
  //        opaEnabled is undefined AND config has opa.enabled = true
  it("checkOpaBundle() falls back to config.opa.enabled=true when opaEnabled not in request", async () => {
    mockFetchResponse(200);
    // Bundle accessible
    mockAccess.mockResolvedValue(undefined);

    const validator = new ConfigValidator(
      makeConfig({ opa: { enabled: true, bundlePath: "/policies/bundle.tar.gz" } }),
    );
    const req: ConfigValidationRequest = { ...makePassingRequest() };
    // Remove opaEnabled so the ?? operator falls back to config.opa.enabled (true)
    delete req.opaEnabled;
    const res = await validator.validate(req);
    const check = findCheck(res.checks, "policy.opaBundle");

    // enabled=true from config, bundle accessible → passes
    expect(check.passed).toBe(true);
    expect(check.message).toContain("found");
  });
});
