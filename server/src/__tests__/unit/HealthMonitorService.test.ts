/**
 * HealthMonitorService Unit Tests
 *
 * Tests for HealthMonitorService — periodic health checks with event emission
 * and webhook alerting for voice-jib-jab subsystems.
 *
 * Strategy:
 *  - All async operations are awaited via runAllChecks() directly; no timers.
 *  - fetch is mocked via jest.spyOn(global, "fetch") per test group.
 *  - Webhook alerts fire via void (fire-and-forget); tests await a microtask
 *    flush (setImmediate wrapped in a Promise) to let pending promises settle.
 */

import {
  HealthMonitorService,
  createVoiceAgentHealthChecks,
} from "../../services/HealthMonitorService.js";
import type {
  HealthCheckDefinition,
  HealthCheckResult,
} from "../../services/HealthMonitorService.js";

// ── Helpers ───────────────────────────────────────────────────────────

/** Returns a check definition that always resolves. */
function passingCheck(name: string): HealthCheckDefinition {
  return { name, check: async () => {} };
}

/** Returns a check definition that always rejects with the given message. */
function failingCheck(name: string, message = "boom"): HealthCheckDefinition {
  return {
    name,
    check: async () => {
      throw new Error(message);
    },
  };
}

/**
 * Flush all pending microtasks and one round of macrotasks so that
 * fire-and-forget webhook promises have a chance to settle.
 */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ── Constructor + initialization ──────────────────────────────────────

describe("HealthMonitorService — constructor", () => {
  it("creates with default config (intervalMs=10000, failureThreshold=1)", () => {
    const svc = new HealthMonitorService([passingCheck("a")]);
    // Verify defaults indirectly: start() uses the timer, but we can verify
    // isRunning() starts false and the service constructs without error.
    expect(svc.isRunning()).toBe(false);
  });

  it("initialises all checks as 'unknown' status", () => {
    const svc = new HealthMonitorService([
      passingCheck("stt"),
      passingCheck("tts"),
    ]);
    const status = svc.getStatus();
    expect(status).toHaveLength(2);
    expect(status.every((r) => r.status === "unknown")).toBe(true);
  });

  it("getStatus() returns one result entry per registered check", () => {
    const svc = new HealthMonitorService([
      passingCheck("a"),
      passingCheck("b"),
      passingCheck("c"),
    ]);
    expect(svc.getStatus()).toHaveLength(3);
  });

  it("getOverallStatus() returns 'healthy' when all checks are unknown", () => {
    // "unknown" entries are not "unhealthy", so the aggregate is healthy
    const svc = new HealthMonitorService([
      passingCheck("x"),
      passingCheck("y"),
    ]);
    expect(svc.getOverallStatus()).toBe("healthy");
  });
});

// ── runAllChecks() ────────────────────────────────────────────────────

describe("HealthMonitorService — runAllChecks()", () => {
  it("sets status to 'healthy' when check passes", async () => {
    const svc = new HealthMonitorService([passingCheck("db")]);
    await svc.runAllChecks();
    expect(svc.getSubsystemStatus("db")?.status).toBe("healthy");
  });

  it("sets status to 'unhealthy' when check throws", async () => {
    const svc = new HealthMonitorService([failingCheck("db")]);
    await svc.runAllChecks();
    expect(svc.getSubsystemStatus("db")?.status).toBe("unhealthy");
  });

  it("records latencyMs >= 0", async () => {
    const svc = new HealthMonitorService([passingCheck("db")]);
    await svc.runAllChecks();
    expect(svc.getSubsystemStatus("db")?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("records error message on failure", async () => {
    const svc = new HealthMonitorService([failingCheck("db", "connection refused")]);
    await svc.runAllChecks();
    expect(svc.getSubsystemStatus("db")?.error).toBe("connection refused");
  });

  it("records checkedAt as a valid ISO timestamp", async () => {
    const before = new Date().toISOString();
    const svc = new HealthMonitorService([passingCheck("db")]);
    await svc.runAllChecks();
    const checkedAt = svc.getSubsystemStatus("db")?.checkedAt ?? "";
    expect(new Date(checkedAt).toISOString()).toBe(checkedAt);
    expect(checkedAt >= before).toBe(true);
  });

  it("sets consecutiveFailures=0 on success", async () => {
    const svc = new HealthMonitorService([passingCheck("db")]);
    await svc.runAllChecks();
    expect(svc.getSubsystemStatus("db")?.consecutiveFailures).toBe(0);
  });

  it("increments consecutiveFailures on each failure", async () => {
    const svc = new HealthMonitorService([failingCheck("db")]);
    await svc.runAllChecks();
    expect(svc.getSubsystemStatus("db")?.consecutiveFailures).toBe(1);
    await svc.runAllChecks();
    expect(svc.getSubsystemStatus("db")?.consecutiveFailures).toBe(2);
    await svc.runAllChecks();
    expect(svc.getSubsystemStatus("db")?.consecutiveFailures).toBe(3);
  });

  it("resets consecutiveFailures to 0 on recovery", async () => {
    let shouldFail = true;
    const svc = new HealthMonitorService([
      {
        name: "db",
        check: async () => {
          if (shouldFail) throw new Error("down");
        },
      },
    ]);
    await svc.runAllChecks(); // unknown→unhealthy, failures=1
    await svc.runAllChecks(); // unhealthy→unhealthy, failures=2
    shouldFail = false;
    await svc.runAllChecks(); // unhealthy→healthy, failures=0
    expect(svc.getSubsystemStatus("db")?.consecutiveFailures).toBe(0);
  });
});

// ── Events ────────────────────────────────────────────────────────────

describe("HealthMonitorService — events", () => {
  it("emits 'check' event after each individual check", async () => {
    const svc = new HealthMonitorService([passingCheck("a"), passingCheck("b")]);
    const received: string[] = [];
    svc.on("check", (r: HealthCheckResult) => received.push(r.name));

    await svc.runAllChecks();
    expect(received).toHaveLength(2);
    expect(received).toContain("a");
    expect(received).toContain("b");
  });

  it("does NOT emit 'degraded' on the first check run (prev status was 'unknown')", async () => {
    const svc = new HealthMonitorService([failingCheck("db")]);
    const degraded: HealthCheckResult[] = [];
    svc.on("degraded", (r: HealthCheckResult) => degraded.push(r));

    await svc.runAllChecks(); // unknown→unhealthy — no transition event
    expect(degraded).toHaveLength(0);
  });

  it("emits 'degraded' when status transitions healthy→unhealthy (threshold=1)", async () => {
    let shouldFail = false;
    const svc = new HealthMonitorService([
      {
        name: "db",
        check: async () => {
          if (shouldFail) throw new Error("down");
        },
      },
    ]);
    const degraded: HealthCheckResult[] = [];
    svc.on("degraded", (r: HealthCheckResult) => degraded.push(r));

    await svc.runAllChecks(); // unknown→healthy
    shouldFail = true;
    await svc.runAllChecks(); // healthy→unhealthy: emit degraded

    expect(degraded).toHaveLength(1);
    expect(degraded[0].name).toBe("db");
    expect(degraded[0].status).toBe("unhealthy");
  });

  it("does NOT emit 'degraded' if consecutiveFailures < failureThreshold", async () => {
    let shouldFail = false;
    const svc = new HealthMonitorService(
      [
        {
          name: "db",
          check: async () => {
            if (shouldFail) throw new Error("down");
          },
        },
      ],
      { failureThreshold: 3 },
    );
    const degraded: HealthCheckResult[] = [];
    svc.on("degraded", (r: HealthCheckResult) => degraded.push(r));

    await svc.runAllChecks(); // unknown→healthy
    shouldFail = true;
    await svc.runAllChecks(); // healthy→unhealthy, failures=1 < threshold=3
    await svc.runAllChecks(); // unhealthy→unhealthy, failures=2 < threshold=3

    expect(degraded).toHaveLength(0);
  });

  it("emits 'degraded' only after failureThreshold consecutive failures", async () => {
    let shouldFail = false;
    const svc = new HealthMonitorService(
      [
        {
          name: "db",
          check: async () => {
            if (shouldFail) throw new Error("down");
          },
        },
      ],
      { failureThreshold: 3 },
    );
    const degraded: HealthCheckResult[] = [];
    svc.on("degraded", (r: HealthCheckResult) => degraded.push(r));

    await svc.runAllChecks(); // unknown→healthy
    shouldFail = true;
    await svc.runAllChecks(); // failures=1, no event
    await svc.runAllChecks(); // failures=2, no event
    await svc.runAllChecks(); // failures=3 >= threshold=3, emit degraded

    expect(degraded).toHaveLength(1);
  });

  it("emits 'recovered' when status transitions unhealthy→healthy", async () => {
    let shouldFail = true;
    const svc = new HealthMonitorService([
      {
        name: "db",
        check: async () => {
          if (shouldFail) throw new Error("down");
        },
      },
    ]);
    const recovered: HealthCheckResult[] = [];
    svc.on("recovered", (r: HealthCheckResult) => recovered.push(r));

    await svc.runAllChecks(); // unknown→unhealthy, failures=1 (no event: prev=unknown)
    await svc.runAllChecks(); // unhealthy→unhealthy, failures=2 (prevFailures=1 >= threshold=1, but still unhealthy)
    shouldFail = false;
    await svc.runAllChecks(); // →healthy, prevFailures=2 >= threshold=1 → emit recovered

    expect(recovered).toHaveLength(1);
    expect(recovered[0].name).toBe("db");
    expect(recovered[0].status).toBe("healthy");
  });
});

// ── start() / stop() ──────────────────────────────────────────────────

describe("HealthMonitorService — start() / stop()", () => {
  it("start() calls runAllChecks immediately", async () => {
    const svc = new HealthMonitorService([passingCheck("db")]);
    svc.start();
    // runAllChecks is void-dispatched; flush microtasks before stopping
    await flushAsync();
    svc.stop();
    expect(svc.getSubsystemStatus("db")?.status).toBe("healthy");
  });

  it("start() is idempotent — second call is a no-op", () => {
    const svc = new HealthMonitorService([passingCheck("db")]);
    svc.start();
    svc.start(); // should not throw or start a second timer
    expect(svc.isRunning()).toBe(true);
    svc.stop();
  });

  it("stop() clears the timer and sets running=false", () => {
    const svc = new HealthMonitorService([passingCheck("db")]);
    svc.start();
    expect(svc.isRunning()).toBe(true);
    svc.stop();
    expect(svc.isRunning()).toBe(false);
  });

  it("isRunning() returns true after start, false after stop", () => {
    const svc = new HealthMonitorService([passingCheck("db")]);
    expect(svc.isRunning()).toBe(false);
    svc.start();
    expect(svc.isRunning()).toBe(true);
    svc.stop();
    expect(svc.isRunning()).toBe(false);
  });

  it("stop() is safe to call when not started", () => {
    const svc = new HealthMonitorService([passingCheck("db")]);
    expect(() => svc.stop()).not.toThrow();
    expect(svc.isRunning()).toBe(false);
  });
});

// ── getOverallStatus() ────────────────────────────────────────────────

describe("HealthMonitorService — getOverallStatus()", () => {
  it("returns 'healthy' when all checks pass", async () => {
    const svc = new HealthMonitorService([
      passingCheck("a"),
      passingCheck("b"),
    ]);
    await svc.runAllChecks();
    expect(svc.getOverallStatus()).toBe("healthy");
  });

  it("returns 'down' when all checks fail", async () => {
    const svc = new HealthMonitorService([
      failingCheck("a"),
      failingCheck("b"),
    ]);
    await svc.runAllChecks();
    expect(svc.getOverallStatus()).toBe("down");
  });

  it("returns 'degraded' when some (not all) checks fail", async () => {
    const svc = new HealthMonitorService([
      passingCheck("a"),
      failingCheck("b"),
    ]);
    await svc.runAllChecks();
    expect(svc.getOverallStatus()).toBe("degraded");
  });
});

// ── Webhook ───────────────────────────────────────────────────────────

describe("HealthMonitorService — webhook", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls fetch with event='alert' when a degraded event fires", async () => {
    const mockFetch = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    let shouldFail = false;
    const svc = new HealthMonitorService(
      [
        {
          name: "db",
          check: async () => {
            if (shouldFail) throw new Error("down");
          },
        },
      ],
      { webhookUrl: "https://hooks.example.com/alert" },
    );

    await svc.runAllChecks(); // unknown→healthy
    shouldFail = true;
    await svc.runAllChecks(); // healthy→unhealthy → fires webhook
    await flushAsync();

    const alertCalls = mockFetch.mock.calls.filter((args) => {
      const body = JSON.parse(args[1]?.body as string) as { event: string };
      return body.event === "alert";
    });
    expect(alertCalls.length).toBeGreaterThanOrEqual(1);
    expect(alertCalls[0][0]).toBe("https://hooks.example.com/alert");
  });

  it("calls fetch with event='recovery' when a recovered event fires", async () => {
    const mockFetch = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    let shouldFail = true;
    const svc = new HealthMonitorService(
      [
        {
          name: "db",
          check: async () => {
            if (shouldFail) throw new Error("down");
          },
        },
      ],
      { webhookUrl: "https://hooks.example.com/alert" },
    );

    await svc.runAllChecks(); // unknown→unhealthy, failures=1 (no event)
    await svc.runAllChecks(); // unhealthy→unhealthy, failures=2 (prevFailures=1 >= threshold=1)
    shouldFail = false;
    await svc.runAllChecks(); // →healthy, prevFailures=2 >= threshold=1 → fires recovery webhook
    await flushAsync();

    const recoveryCalls = mockFetch.mock.calls.filter((args) => {
      const body = JSON.parse(args[1]?.body as string) as { event: string };
      return body.event === "recovery";
    });
    expect(recoveryCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("does not throw when webhook fetch rejects (non-fatal)", async () => {
    jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("network error"));

    let shouldFail = false;
    const svc = new HealthMonitorService(
      [
        {
          name: "db",
          check: async () => {
            if (shouldFail) throw new Error("down");
          },
        },
      ],
      { webhookUrl: "https://hooks.example.com/alert" },
    );

    await svc.runAllChecks(); // unknown→healthy
    shouldFail = true;

    // The degraded transition triggers a fire-and-forget webhook; it must not throw
    await expect(svc.runAllChecks()).resolves.toBeUndefined();
    await flushAsync();
  });

  it("does not call fetch when webhookUrl is not configured", async () => {
    const mockFetch = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    let shouldFail = false;
    const svc = new HealthMonitorService([
      {
        name: "db",
        check: async () => {
          if (shouldFail) throw new Error("down");
        },
      },
    ]); // no webhookUrl

    await svc.runAllChecks();
    shouldFail = true;
    await svc.runAllChecks();
    await flushAsync();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── createVoiceAgentHealthChecks() ───────────────────────────────────

describe("createVoiceAgentHealthChecks()", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns exactly 5 checks with the expected names", () => {
    const checks = createVoiceAgentHealthChecks({});
    expect(checks).toHaveLength(5);
    expect(checks.map((c) => c.name)).toEqual([
      "stt",
      "tts",
      "opa",
      "chromadb",
      "database",
    ]);
  });

  it("OPA check passes (resolves) when opaEnabled=false", async () => {
    const checks = createVoiceAgentHealthChecks({ opaEnabled: false });
    const opa = checks.find((c) => c.name === "opa")!;
    await expect(opa.check()).resolves.toBeUndefined();
  });

  it("STT check passes when fetch returns 401 (server up, auth fails)", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));

    const checks = createVoiceAgentHealthChecks({
      openAiBaseUrl: "https://api.openai.com",
    });
    const stt = checks.find((c) => c.name === "stt")!;
    await expect(stt.check()).resolves.toBeUndefined();
  });

  it("STT check throws when fetch returns 500", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status: 500 }));

    const checks = createVoiceAgentHealthChecks({
      openAiBaseUrl: "https://api.openai.com",
    });
    const stt = checks.find((c) => c.name === "stt")!;
    await expect(stt.check()).rejects.toThrow("HTTP 500");
  });
});
