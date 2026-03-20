/**
 * FlowBuilder Tests
 *
 * Covers FlowStore, FlowEngine, and the flows HTTP API.
 * Follows the ConversationMemory.test.ts pattern: standalone Express app
 * with injected dependencies, raw HTTP via node:http.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { FlowStore, initFlowStore, flowStore } from "../../services/FlowStore.js";
import { FlowEngine } from "../../services/FlowEngine.js";
import { createFlowsRouter } from "../../api/flows.js";
import type { ConversationFlow } from "../../services/FlowStore.js";

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
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {}),
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

// ── Fixtures ───────────────────────────────────────────────────────────

function tempFile(label: string): string {
  return join(
    tmpdir(),
    `flow-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

function tempDir(label: string): string {
  return join(
    tmpdir(),
    `flow-test-dir-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

/** Minimal valid flow data for tests. */
function makeFlowData(overrides: Partial<Omit<ConversationFlow, "flowId" | "createdAt" | "updatedAt">> = {}): Omit<ConversationFlow, "flowId" | "createdAt" | "updatedAt"> {
  return {
    name: "Test Flow",
    description: "A simple test flow",
    tenantId: null,
    entryNodeId: "node-1",
    nodes: [
      {
        nodeId: "node-1",
        type: "greeting",
        prompt: "Hello, how can I help?",
        transitions: [
          { condition: "billing", nextNodeId: "node-2" },
        ],
      },
      {
        nodeId: "node-2",
        type: "response",
        prompt: "Let me help with billing.",
        transitions: [],
      },
    ],
    ...overrides,
  };
}

function buildTestApp(store: FlowStore, engine: FlowEngine): Express {
  const app = express();
  app.use(express.json());
  app.use("/flows", createFlowsRouter(store, engine));
  return app;
}

// ── FlowStore unit tests ───────────────────────────────────────────────

describe("FlowStore — createFlow()", () => {
  let store: FlowStore;
  let file: string;

  beforeEach(() => {
    file = tempFile("create");
    store = new FlowStore(file);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("returns flow with generated flowId", () => {
    const flow = store.createFlow(makeFlowData());
    expect(typeof flow.flowId).toBe("string");
    expect(flow.flowId.length).toBeGreaterThan(0);
  });

  it("returns flow with createdAt ISO string", () => {
    const flow = store.createFlow(makeFlowData());
    expect(new Date(flow.createdAt).toISOString()).toBe(flow.createdAt);
  });

  it("returns flow with updatedAt ISO string equal to createdAt on creation", () => {
    const flow = store.createFlow(makeFlowData());
    expect(new Date(flow.updatedAt).toISOString()).toBe(flow.updatedAt);
    // createdAt and updatedAt should be equal (same instant)
    expect(flow.updatedAt).toBe(flow.createdAt);
  });

  it("sets provided fields correctly", () => {
    const data = makeFlowData({ name: "My Flow", tenantId: "org_x" });
    const flow = store.createFlow(data);
    expect(flow.name).toBe("My Flow");
    expect(flow.tenantId).toBe("org_x");
    expect(flow.entryNodeId).toBe("node-1");
    expect(flow.nodes).toHaveLength(2);
  });
});

describe("FlowStore — getFlow()", () => {
  let store: FlowStore;
  let file: string;

  beforeEach(() => {
    file = tempFile("get");
    store = new FlowStore(file);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("returns undefined for unknown flowId", () => {
    expect(store.getFlow("nonexistent")).toBeUndefined();
  });

  it("returns the flow after creating it", () => {
    const created = store.createFlow(makeFlowData());
    const found = store.getFlow(created.flowId);
    expect(found).toBeDefined();
    expect(found!.flowId).toBe(created.flowId);
  });
});

describe("FlowStore — listFlows()", () => {
  let store: FlowStore;
  let file: string;

  beforeEach(() => {
    file = tempFile("list");
    store = new FlowStore(file);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("returns all flows when tenantId not provided", () => {
    store.createFlow(makeFlowData({ tenantId: "org_a" }));
    store.createFlow(makeFlowData({ tenantId: "org_b" }));
    store.createFlow(makeFlowData({ tenantId: null }));
    expect(store.listFlows()).toHaveLength(3);
  });

  it("returns matching tenant + global (null) when tenantId provided", () => {
    store.createFlow(makeFlowData({ tenantId: "org_a" }));
    store.createFlow(makeFlowData({ tenantId: "org_b" }));
    store.createFlow(makeFlowData({ tenantId: null }));

    const results = store.listFlows("org_a");
    expect(results).toHaveLength(2); // org_a + global
    const tenants = results.map((f) => f.tenantId);
    expect(tenants).toContain("org_a");
    expect(tenants).toContain(null);
    expect(tenants).not.toContain("org_b");
  });

  it("returns empty array when no flows exist", () => {
    expect(store.listFlows()).toHaveLength(0);
  });
});

describe("FlowStore — updateFlow()", () => {
  let store: FlowStore;
  let file: string;

  beforeEach(() => {
    file = tempFile("update");
    store = new FlowStore(file);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("returns undefined for unknown flowId", () => {
    expect(store.updateFlow("nonexistent", { name: "New Name" })).toBeUndefined();
  });

  it("merges provided fields", () => {
    const flow = store.createFlow(makeFlowData({ name: "Original" }));
    const updated = store.updateFlow(flow.flowId, { name: "Renamed" });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Renamed");
    expect(updated!.description).toBe(flow.description);
  });

  it("updates updatedAt to a later or equal timestamp", () => {
    const flow = store.createFlow(makeFlowData());
    const before = new Date(flow.createdAt).getTime();
    const updated = store.updateFlow(flow.flowId, { name: "New" });
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("preserves createdAt unchanged", () => {
    const flow = store.createFlow(makeFlowData());
    const updated = store.updateFlow(flow.flowId, { name: "New" });
    expect(updated!.createdAt).toBe(flow.createdAt);
  });
});

describe("FlowStore — deleteFlow()", () => {
  let store: FlowStore;
  let file: string;

  beforeEach(() => {
    file = tempFile("delete");
    store = new FlowStore(file);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("returns false for unknown flowId", () => {
    expect(store.deleteFlow("nonexistent")).toBe(false);
  });

  it("removes the flow and returns true", () => {
    const flow = store.createFlow(makeFlowData());
    expect(store.deleteFlow(flow.flowId)).toBe(true);
    expect(store.getFlow(flow.flowId)).toBeUndefined();
  });

  it("does not affect other flows", () => {
    const f1 = store.createFlow(makeFlowData({ name: "Keep" }));
    const f2 = store.createFlow(makeFlowData({ name: "Delete" }));
    store.deleteFlow(f2.flowId);
    expect(store.getFlow(f1.flowId)).toBeDefined();
  });
});

describe("FlowStore — persistence", () => {
  let file: string;

  beforeEach(() => {
    file = tempFile("persist");
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("data survives creating a new FlowStore instance pointing at same file", () => {
    const store1 = new FlowStore(file);
    const created = store1.createFlow(makeFlowData({ name: "Persisted Flow" }));

    const store2 = new FlowStore(file);
    const found = store2.getFlow(created.flowId);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Persisted Flow");
  });

  it("starts empty when file does not exist (ENOENT is not an error)", () => {
    const store = new FlowStore(join(tmpdir(), `no-such-file-${Date.now()}.json`));
    expect(store.listFlows()).toHaveLength(0);
  });

  it("throws on non-ENOENT read errors", () => {
    const dir = tempDir("bad-json");
    mkdirSync(dir, { recursive: true });
    const badFile = join(dir, "flows.json");
    writeFileSync(badFile, "NOT_VALID_JSON");

    expect(() => new FlowStore(badFile)).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("FlowStore — singleton proxy", () => {
  it("initFlowStore wires the proxy so methods are callable", () => {
    const file = tempFile("singleton");
    try {
      const store = initFlowStore(file);
      expect(typeof flowStore.listFlows).toBe("function");
      const flows = flowStore.listFlows();
      expect(Array.isArray(flows)).toBe(true);
      // The instance returned should equal a direct call
      const flow = store.createFlow(makeFlowData());
      expect(flowStore.getFlow(flow.flowId)).toBeDefined();
    } finally {
      if (existsSync(file)) rmSync(file);
    }
  });
});

// ── FlowEngine unit tests ──────────────────────────────────────────────

describe("FlowEngine — startSession()", () => {
  let store: FlowStore;
  let engine: FlowEngine;
  let file: string;

  beforeEach(() => {
    file = tempFile("engine-start");
    store = new FlowStore(file);
    engine = new FlowEngine(store);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("returns entry node prompt and session token", () => {
    const flow = store.createFlow(makeFlowData());
    const { result } = engine.startSession(flow.flowId);
    expect(result.sessionToken).toBeDefined();
    expect(result.prompt).toBe("Hello, how can I help?");
    expect(result.ended).toBe(false);
    expect(result.matchedCondition).toBeNull();
  });

  it("records session in getSession()", () => {
    const flow = store.createFlow(makeFlowData());
    const { result } = engine.startSession(flow.flowId);
    const session = engine.getSession(result.sessionToken);
    expect(session).toBeDefined();
    expect(session!.flowId).toBe(flow.flowId);
    expect(session!.currentNodeId).toBe("node-1");
    expect(session!.history).toEqual(["node-1"]);
  });

  it("throws for unknown flowId", () => {
    expect(() => engine.startSession("nonexistent")).toThrow("Flow not found");
  });

  it("marks session ended when entry node is type end", () => {
    const endFlow = store.createFlow({
      ...makeFlowData(),
      entryNodeId: "end-node",
      nodes: [{ nodeId: "end-node", type: "end", prompt: "Goodbye.", transitions: [] }],
    });
    const { result } = engine.startSession(endFlow.flowId);
    expect(result.ended).toBe(true);
  });
});

describe("FlowEngine — advance()", () => {
  let store: FlowStore;
  let engine: FlowEngine;
  let file: string;

  beforeEach(() => {
    file = tempFile("engine-advance");
    store = new FlowStore(file);
    engine = new FlowEngine(store);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("matches transition by case-insensitive substring", () => {
    const flow = store.createFlow(makeFlowData());
    const { result: start } = engine.startSession(flow.flowId);

    const step = engine.advance(start.sessionToken, "I have a BILLING question");
    expect(step.matchedCondition).toBe("billing");
    expect(step.currentNode.nodeId).toBe("node-2");
    expect(step.prompt).toBe("Let me help with billing.");
  });

  it("returns same node when no condition matches", () => {
    const flow = store.createFlow(makeFlowData());
    const { result: start } = engine.startSession(flow.flowId);

    const step = engine.advance(start.sessionToken, "something unrelated");
    expect(step.matchedCondition).toBeNull();
    expect(step.currentNode.nodeId).toBe("node-1");
    expect(step.ended).toBe(false);
  });

  it("marks session ended when reaching an end node", () => {
    const flow = store.createFlow({
      ...makeFlowData(),
      nodes: [
        {
          nodeId: "node-1",
          type: "greeting",
          prompt: "Hello",
          transitions: [{ condition: "bye", nextNodeId: "node-end" }],
        },
        { nodeId: "node-end", type: "end", prompt: "Goodbye!", transitions: [] },
      ],
    });
    const { result: start } = engine.startSession(flow.flowId);
    const step = engine.advance(start.sessionToken, "bye");
    expect(step.ended).toBe(true);
    expect(step.currentNode.type).toBe("end");

    const session = engine.getSession(start.sessionToken);
    expect(session!.ended).toBe(true);
  });

  it("throws for unknown sessionToken", () => {
    expect(() => engine.advance("unknown-token", "hello")).toThrow("Session not found");
  });

  it("matches first transition when multiple conditions could match", () => {
    const flow = store.createFlow({
      ...makeFlowData(),
      nodes: [
        {
          nodeId: "node-1",
          type: "routing",
          prompt: "Route me",
          transitions: [
            { condition: "billing", nextNodeId: "node-2" },
            { condition: "bill", nextNodeId: "node-3" },
          ],
        },
        { nodeId: "node-2", type: "response", prompt: "Billing dept.", transitions: [] },
        { nodeId: "node-3", type: "response", prompt: "Bill dept.", transitions: [] },
      ],
    });
    const { result: start } = engine.startSession(flow.flowId);
    const step = engine.advance(start.sessionToken, "I have a billing issue");
    // "billing" is first transition — should win
    expect(step.matchedCondition).toBe("billing");
    expect(step.currentNode.nodeId).toBe("node-2");
  });
});

describe("FlowEngine — getSession() / endSession() / listActiveSessions()", () => {
  let store: FlowStore;
  let engine: FlowEngine;
  let file: string;

  beforeEach(() => {
    file = tempFile("engine-sessions");
    store = new FlowStore(file);
    engine = new FlowEngine(store);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("getSession() returns undefined for unknown token", () => {
    expect(engine.getSession("no-such-token")).toBeUndefined();
  });

  it("getSession() returns state for known token", () => {
    const flow = store.createFlow(makeFlowData());
    const { result } = engine.startSession(flow.flowId);
    const session = engine.getSession(result.sessionToken);
    expect(session).toBeDefined();
    expect(session!.sessionToken).toBe(result.sessionToken);
  });

  it("endSession() marks session as ended", () => {
    const flow = store.createFlow(makeFlowData());
    const { result } = engine.startSession(flow.flowId);
    engine.endSession(result.sessionToken);
    expect(engine.getSession(result.sessionToken)!.ended).toBe(true);
  });

  it("endSession() is a no-op for unknown token (no throw)", () => {
    expect(() => engine.endSession("no-such-token")).not.toThrow();
  });

  it("listActiveSessions() returns only non-ended sessions", () => {
    const flow = store.createFlow(makeFlowData());
    const { result: s1 } = engine.startSession(flow.flowId);
    const { result: s2 } = engine.startSession(flow.flowId);

    engine.endSession(s2.sessionToken);

    const active = engine.listActiveSessions();
    const tokens = active.map((s) => s.sessionToken);
    expect(tokens).toContain(s1.sessionToken);
    expect(tokens).not.toContain(s2.sessionToken);
  });
});

// ── HTTP API tests ─────────────────────────────────────────────────────

describe("Flows HTTP API", () => {
  let app: Express;
  let server: Server;
  let store: FlowStore;
  let engine: FlowEngine;
  let file: string;

  beforeAll((done) => {
    file = tempFile("http-api");
    store = new FlowStore(file);
    engine = new FlowEngine(store);
    app = buildTestApp(store, engine);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(file)) rmSync(file);
      done();
    });
  });

  // ── GET /flows ──────────────────────────────────────────────────────

  describe("GET /flows", () => {
    it("returns 200 with empty array initially", async () => {
      // Use isolated store for this check
      const isoFile = tempFile("list-empty");
      const isoStore = new FlowStore(isoFile);
      const isoEngine = new FlowEngine(isoStore);
      const isoApp = buildTestApp(isoStore, isoEngine);
      const isoServer = createServer(isoApp);
      await new Promise<void>((r) => isoServer.listen(0, r));

      try {
        const res = await httpRequest(isoServer, "GET", "/flows");
        expect(res.status).toBe(200);
        const data = res.json() as { flows: unknown[]; count: number };
        expect(data.flows).toEqual([]);
        expect(data.count).toBe(0);
      } finally {
        await new Promise<void>((r) => isoServer.close(() => r()));
        if (existsSync(isoFile)) rmSync(isoFile);
      }
    });
  });

  // ── POST /flows ─────────────────────────────────────────────────────

  describe("POST /flows", () => {
    it("creates and returns 201 with flow shape", async () => {
      const res = await httpRequest(server, "POST", "/flows", makeFlowData({ name: "HTTP Created" }));
      expect(res.status).toBe(201);
      const data = res.json() as ConversationFlow;
      expect(data.flowId).toBeDefined();
      expect(data.name).toBe("HTTP Created");
      expect(data.createdAt).toBeDefined();
      expect(data.updatedAt).toBeDefined();
    });

    it("returns 400 when name is missing", async () => {
      const body = { ...makeFlowData() };
      const { name: _n, ...rest } = body as Record<string, unknown>;
      const res = await httpRequest(server, "POST", "/flows", rest);
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toMatch(/name/i);
    });

    it("returns 400 when name exceeds 100 chars", async () => {
      const res = await httpRequest(server, "POST", "/flows", {
        ...makeFlowData(),
        name: "x".repeat(101),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when nodes is missing", async () => {
      const body = { ...makeFlowData() } as Record<string, unknown>;
      delete body.nodes;
      const res = await httpRequest(server, "POST", "/flows", body);
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toMatch(/nodes/i);
    });

    it("returns 400 when nodes is empty array", async () => {
      const res = await httpRequest(server, "POST", "/flows", {
        ...makeFlowData(),
        nodes: [],
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when entryNodeId is missing", async () => {
      const body = { ...makeFlowData() } as Record<string, unknown>;
      delete body.entryNodeId;
      const res = await httpRequest(server, "POST", "/flows", body);
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toMatch(/entryNodeId/i);
    });

    it("returns 400 when entryNodeId does not reference existing node", async () => {
      const res = await httpRequest(server, "POST", "/flows", {
        ...makeFlowData(),
        entryNodeId: "nonexistent-node",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toMatch(/entryNodeId/i);
    });

    it("returns 400 when a node has invalid type", async () => {
      const data = makeFlowData() as Record<string, unknown>;
      data.nodes = [
        { nodeId: "node-1", type: "invalid_type", prompt: "Hello", transitions: [] },
      ];
      data.entryNodeId = "node-1";
      const res = await httpRequest(server, "POST", "/flows", data);
      expect(res.status).toBe(400);
    });
  });

  // ── GET /flows/:flowId ─────────────────────────────────────────────

  describe("GET /flows/:flowId", () => {
    it("returns the flow", async () => {
      const created = store.createFlow(makeFlowData({ name: "Get Me" }));
      const res = await httpRequest(server, "GET", `/flows/${created.flowId}`);
      expect(res.status).toBe(200);
      const data = res.json() as ConversationFlow;
      expect(data.flowId).toBe(created.flowId);
    });

    it("returns 404 for unknown flowId", async () => {
      const res = await httpRequest(server, "GET", "/flows/nonexistent-id");
      expect(res.status).toBe(404);
    });
  });

  // ── PUT /flows/:flowId ─────────────────────────────────────────────

  describe("PUT /flows/:flowId", () => {
    it("updates the flow and returns updated shape", async () => {
      const created = store.createFlow(makeFlowData({ name: "Before" }));
      const res = await httpRequest(server, "PUT", `/flows/${created.flowId}`, {
        name: "After",
      });
      expect(res.status).toBe(200);
      const data = res.json() as ConversationFlow;
      expect(data.name).toBe("After");
      expect(data.flowId).toBe(created.flowId);
    });

    it("returns 404 for unknown flowId", async () => {
      const res = await httpRequest(server, "PUT", "/flows/no-such-flow", {
        name: "Irrelevant",
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when entryNodeId does not reference existing node", async () => {
      const created = store.createFlow(makeFlowData());
      const res = await httpRequest(server, "PUT", `/flows/${created.flowId}`, {
        entryNodeId: "ghost-node",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /flows/:flowId ─────────────────────────────────────────

  describe("DELETE /flows/:flowId", () => {
    it("deletes the flow and returns 204", async () => {
      const created = store.createFlow(makeFlowData({ name: "To Delete" }));
      const res = await httpRequest(server, "DELETE", `/flows/${created.flowId}`);
      expect(res.status).toBe(204);
      expect(store.getFlow(created.flowId)).toBeUndefined();
    });

    it("returns 404 for unknown flowId", async () => {
      const res = await httpRequest(server, "DELETE", "/flows/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ── POST /flows/:flowId/start ─────────────────────────────────────

  describe("POST /flows/:flowId/start", () => {
    it("starts a session and returns FlowStepResult with sessionToken", async () => {
      const flow = store.createFlow(makeFlowData());
      const res = await httpRequest(server, "POST", `/flows/${flow.flowId}/start`, {});
      expect(res.status).toBe(201);
      const data = res.json() as { sessionToken: string; prompt: string; ended: boolean };
      expect(data.sessionToken).toBeDefined();
      expect(data.prompt).toBe("Hello, how can I help?");
      expect(data.ended).toBe(false);
    });

    it("returns 404 for unknown flowId", async () => {
      const res = await httpRequest(server, "POST", "/flows/no-such/start", {});
      expect(res.status).toBe(404);
    });
  });

  // ── POST /flows/sessions/:token/advance ───────────────────────────

  describe("POST /flows/sessions/:token/advance", () => {
    it("advances session with matching input and returns next node", async () => {
      const flow = store.createFlow(makeFlowData());
      const startRes = await httpRequest(server, "POST", `/flows/${flow.flowId}/start`, {});
      const startData = startRes.json() as { sessionToken: string };

      const advRes = await httpRequest(
        server,
        "POST",
        `/flows/sessions/${startData.sessionToken}/advance`,
        { userInput: "I need help with billing" },
      );
      expect(advRes.status).toBe(200);
      const advData = advRes.json() as { matchedCondition: string; ended: boolean; prompt: string };
      expect(advData.matchedCondition).toBe("billing");
      expect(advData.prompt).toBe("Let me help with billing.");
    });

    it("stays on same node when no condition matches", async () => {
      const flow = store.createFlow(makeFlowData());
      const startRes = await httpRequest(server, "POST", `/flows/${flow.flowId}/start`, {});
      const startData = startRes.json() as { sessionToken: string; prompt: string };

      const advRes = await httpRequest(
        server,
        "POST",
        `/flows/sessions/${startData.sessionToken}/advance`,
        { userInput: "I am confused" },
      );
      expect(advRes.status).toBe(200);
      const advData = advRes.json() as { matchedCondition: string | null; prompt: string };
      expect(advData.matchedCondition).toBeNull();
      expect(advData.prompt).toBe(startData.prompt);
    });

    it("returns 404 for unknown session token", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/flows/sessions/unknown-token/advance",
        { userInput: "hello" },
      );
      expect(res.status).toBe(404);
    });

    it("returns 400 when userInput is missing", async () => {
      const flow = store.createFlow(makeFlowData());
      const startRes = await httpRequest(server, "POST", `/flows/${flow.flowId}/start`, {});
      const startData = startRes.json() as { sessionToken: string };

      const res = await httpRequest(
        server,
        "POST",
        `/flows/sessions/${startData.sessionToken}/advance`,
        {},
      );
      expect(res.status).toBe(400);
    });
  });

  // ── GET /flows/sessions/:token ────────────────────────────────────

  describe("GET /flows/sessions/:token", () => {
    it("returns session state", async () => {
      const flow = store.createFlow(makeFlowData());
      const startRes = await httpRequest(server, "POST", `/flows/${flow.flowId}/start`, {});
      const startData = startRes.json() as { sessionToken: string };

      const res = await httpRequest(server, "GET", `/flows/sessions/${startData.sessionToken}`);
      expect(res.status).toBe(200);
      const data = res.json() as { sessionToken: string; flowId: string; ended: boolean };
      expect(data.sessionToken).toBe(startData.sessionToken);
      expect(data.flowId).toBe(flow.flowId);
      expect(data.ended).toBe(false);
    });

    it("returns 404 for unknown token", async () => {
      const res = await httpRequest(server, "GET", "/flows/sessions/no-such-token");
      expect(res.status).toBe(404);
    });
  });
});

// ── FlowEngine — branch coverage ──────────────────────────────────────

describe("FlowEngine — branch coverage", () => {
  let store: FlowStore;
  let engine: FlowEngine;
  let file: string;

  beforeEach(() => {
    file = tempFile("engine-branch");
    store = new FlowStore(file);
    engine = new FlowEngine(store);
  });

  afterEach(() => {
    if (existsSync(file)) rmSync(file);
  });

  it("startSession() throws when entry node is missing from flow", () => {
    // Create a flow with a dangling entryNodeId
    const flow = store.createFlow({
      name: "Broken",
      description: "",
      tenantId: null,
      entryNodeId: "ghost-node",
      nodes: [{ nodeId: "real-node", type: "greeting", prompt: "Hi", transitions: [] }],
    });
    // Force the entryNodeId to reference a missing node by updating after creation
    store.updateFlow(flow.flowId, { entryNodeId: "ghost-node" });
    expect(() => engine.startSession(flow.flowId)).toThrow(/Entry node/);
  });

  it("advance() returns ended state without moving when session is already ended", () => {
    const endFlow = store.createFlow({
      name: "End Flow",
      description: "",
      tenantId: null,
      entryNodeId: "end-node",
      nodes: [{ nodeId: "end-node", type: "end", prompt: "Goodbye", transitions: [] }],
    });
    const { result } = engine.startSession(endFlow.flowId);
    expect(result.ended).toBe(true);

    // Advance on already-ended session — should return same ended node
    const step2 = engine.advance(result.sessionToken, "any input");
    expect(step2.ended).toBe(true);
    expect(step2.matchedCondition).toBeNull();
  });

  it("advance() throws when flow is deleted mid-session", () => {
    const flow = store.createFlow(makeFlowData());
    const { result } = engine.startSession(flow.flowId);
    store.deleteFlow(flow.flowId);
    expect(() => engine.advance(result.sessionToken, "billing")).toThrow(/Flow not found/);
  });

  it("advance() throws when transition target node is missing from flow", () => {
    const badTransitionFlow = store.createFlow({
      name: "Bad Transition Flow",
      description: "",
      tenantId: null,
      entryNodeId: "node-a",
      nodes: [
        {
          nodeId: "node-a",
          type: "greeting",
          prompt: "Hello",
          transitions: [{ condition: "go", nextNodeId: "ghost-target" }],
        },
      ],
    });
    const { result } = engine.startSession(badTransitionFlow.flowId);
    expect(() => engine.advance(result.sessionToken, "go")).toThrow(/not found/);
  });
});

// ── Flows HTTP API — branch coverage ──────────────────────────────────

describe("Flows HTTP API — branch coverage", () => {
  let app: Express;
  let server: Server;
  let store: FlowStore;
  let engine: FlowEngine;
  let file: string;
  let createdFlowId: string;

  beforeAll((done) => {
    file = tempFile("http-branch");
    store = new FlowStore(file);
    engine = new FlowEngine(store);
    app = buildTestApp(store, engine);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      if (existsSync(file)) rmSync(file);
      done();
    });
  });

  beforeAll(async () => {
    // Create a reusable flow
    const res = await new Promise<{ flowId: string }>((resolve) => {
      const flow = store.createFlow(makeFlowData());
      createdFlowId = flow.flowId;
      resolve(flow);
    });
    createdFlowId = res.flowId;
  });

  it("POST /flows returns 400 for duplicate nodeIds", async () => {
    const res = await httpRequest(server, "POST", "/flows", {
      name: "Duplicate Nodes",
      entryNodeId: "n1",
      nodes: [
        { nodeId: "n1", type: "greeting", prompt: "Hi", transitions: [] },
        { nodeId: "n1", type: "response", prompt: "Dup", transitions: [] },
      ],
    });
    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("unique");
  });

  it("PUT /flows/:flowId returns 400 when name is not a string", async () => {
    const res = await httpRequest(server, "PUT", `/flows/${createdFlowId}`, { name: 42 });
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toContain("name");
  });

  it("PUT /flows/:flowId returns 400 when name exceeds 100 chars", async () => {
    const res = await httpRequest(server, "PUT", `/flows/${createdFlowId}`, {
      name: "x".repeat(101),
    });
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toContain("100");
  });

  it("PUT /flows/:flowId returns 400 when description is not a string", async () => {
    const res = await httpRequest(server, "PUT", `/flows/${createdFlowId}`, {
      description: 999,
    });
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toContain("description");
  });

  it("PUT /flows/:flowId updates tenantId to null when non-string provided", async () => {
    const res = await httpRequest(server, "PUT", `/flows/${createdFlowId}`, {
      tenantId: 123,
    });
    expect(res.status).toBe(200);
    const data = res.json() as { tenantId: null };
    expect(data.tenantId).toBeNull();
  });

  it("PUT /flows/:flowId returns 400 when nodes is empty array", async () => {
    const res = await httpRequest(server, "PUT", `/flows/${createdFlowId}`, { nodes: [] });
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toContain("non-empty");
  });

  it("PUT /flows/:flowId returns 400 when a node in nodes is invalid", async () => {
    const res = await httpRequest(server, "PUT", `/flows/${createdFlowId}`, {
      nodes: [{ nodeId: "x", type: "INVALID_TYPE", prompt: "Hi", transitions: [] }],
    });
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toContain("Invalid node");
  });

  it("PUT /flows/:flowId returns 400 when entryNodeId is not a string", async () => {
    const res = await httpRequest(server, "PUT", `/flows/${createdFlowId}`, {
      entryNodeId: 99,
    });
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toContain("entryNodeId");
  });

  it("PUT /flows/:flowId returns 400 when entryNodeId references missing node", async () => {
    const res = await httpRequest(server, "PUT", `/flows/${createdFlowId}`, {
      entryNodeId: "does-not-exist",
    });
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toContain("entryNodeId");
  });

  it("POST /flows/:flowId/start returns 404 for unknown flowId", async () => {
    const res = await httpRequest(server, "POST", "/flows/no-such-flow/start", {});
    expect(res.status).toBe(404);
    expect((res.json() as { error: string }).error).toContain("not found");
  });

  it("POST /flows/sessions/:token/advance returns 400 when userInput missing", async () => {
    // Start a real session first
    const flow = store.createFlow(makeFlowData());
    const { result } = engine.startSession(flow.flowId);
    const res = await httpRequest(
      server,
      "POST",
      `/flows/sessions/${result.sessionToken}/advance`,
      { notUserInput: "oops" },
    );
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toContain("userInput");
  });
});
