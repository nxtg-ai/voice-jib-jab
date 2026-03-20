/**
 * Voice Agent End-to-End Integration Tests
 *
 * Spins up a real HTTP server with VoiceWebSocketServer plus a mock OpenAI
 * Realtime WS server. Connects test clients via real WebSocket, exercises
 * the full message protocol, and asserts on server responses.
 *
 * Startup approach: direct VoiceWebSocketServer instantiation on an express
 * HTTP server (same pattern as tests/load/advanced-load-test.ts). The config
 * module is mocked so feature flags are controlled. OPENAI_REALTIME_URL is
 * set in process.env before the adapter creates its WebSocket.
 *
 * Client design: each test client buffers ALL incoming messages from the
 * moment the connection opens so no message can be missed due to listener
 * race conditions between waitForOpen() and waitForMessage().
 *
 * Oracle types: behavioural (message type assertions) + state (payload fields).
 */

// ── Unmock ws — this integration test needs the REAL ws library ──────────────
// The src/__mocks__/ws.ts manual mock only has a WebSocket client mock;
// we need real WebSocketServer for the mock OpenAI server and real WebSocket
// for test client connections. jest.unmock() is hoisted above imports.
jest.unmock("ws");

// ── Config mock (hoisted before any server imports) ──────────────────────────

jest.mock("../../config/index.js", () => ({
  config: {
    port: 3099,
    nodeEnv: "test",
    openai: {
      apiKey: "test-key",
      model: "gpt-4o-realtime-preview",
    },
    features: {
      enableLaneA: false,
      enableRAG: false,
      enablePolicyGate: false,
      enableAuditTrail: false,
      enablePersistentMemory: false,
    },
    latency: {
      ttfbTargetP50: 400,
      ttfbTargetP95: 900,
      bargeInTargetP95: 250,
    },
    safety: {
      enablePIIRedaction: false,
      storeRawAudio: false,
      maxSessionDurationMinutes: 30,
    },
    rag: { topK: 5, maxTokens: 600, maxBytes: 4000 },
    storage: {
      databasePath: "/tmp/voice-e2e-test.db",
      enableWalMode: false,
      maxHistoryTurns: 100,
      maxSummaryLength: 500,
    },
    fallback: { mode: "auto" },
    opa: { enabled: false, bundlePath: "" },
  },
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "net";
import { VoiceWebSocketServer } from "../../api/websocket.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedMessage {
  type: string;
  [key: string]: unknown;
}

// ── Buffered WS client ────────────────────────────────────────────────────────

/**
 * A thin wrapper around WebSocket that buffers all messages from the moment
 * the connection opens. This eliminates listener-registration race conditions
 * where a message arrives between waitForOpen() resolving and the next
 * waitForMessage() attaching its listener.
 */
class BufferedWsClient {
  private ws: WebSocket;
  private buffer: ParsedMessage[] = [];
  private waiters: Array<{
    predicate: (m: ParsedMessage) => boolean;
    resolve: (m: ParsedMessage) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data) => {
      let msg: ParsedMessage;
      try {
        msg = JSON.parse(data.toString()) as ParsedMessage;
      } catch {
        return;
      }
      // Satisfy pending waiters first
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i];
        if (waiter.predicate(msg)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(i, 1);
          waiter.resolve(msg);
          return;
        }
      }
      // No waiter matched — buffer the message
      this.buffer.push(msg);
    });
  }

  /** Wait until the connection is open (or fail with timeout). */
  async open(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error("WS open timeout")), timeoutMs);
      this.ws.once("open", () => { clearTimeout(timer); resolve(); });
      this.ws.once("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }

  /**
   * Return the first buffered message matching the predicate, or wait for
   * the next incoming message that satisfies it.
   */
  waitFor(
    predicate: (m: ParsedMessage) => boolean,
    timeoutMs = 8000,
  ): Promise<ParsedMessage> {
    // Check buffer first
    const idx = this.buffer.findIndex(predicate);
    if (idx !== -1) {
      return Promise.resolve(this.buffer.splice(idx, 1)[0]);
    }
    // Register a waiter
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`waitFor timeout (${timeoutMs}ms) — no matching message received`)),
        timeoutMs,
      );
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  /** Send a JSON-serializable message. */
  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Send a raw string without JSON serialisation (used to test malformed input). */
  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  /** Close the connection and wait for it to reach CLOSED state. */
  close(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error("WS close timeout")), timeoutMs);
      this.ws.once("close", () => { clearTimeout(timer); resolve(); });
      this.ws.close();
    });
  }

  /** Whether any buffered or incoming message of this type exists. */
  hasBuffered(type: string): boolean {
    return this.buffer.some((m) => m.type === type);
  }

  get readyState(): number {
    return this.ws.readyState;
  }
}

// ── Audio helpers ─────────────────────────────────────────────────────────────

/**
 * Generate a base64-encoded PCM16 sine wave chunk whose RMS exceeds the
 * MIN_AUDIO_RMS=200 threshold enforced in the audio.chunk handler.
 * Amplitude 8000 at 1 kHz for 100ms @ 24 kHz = 2400 samples = 4800 bytes.
 */
function generateLoudAudio(): string {
  const sampleRate = 24000;
  const durationMs = 100;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const buf = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(8000 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate));
    buf.writeInt16LE(sample, i * 2);
  }
  return buf.toString("base64");
}

const LOUD_AUDIO = generateLoudAudio();

// ── Server lifecycle ──────────────────────────────────────────────────────────

let mockOpenAI: { close: () => Promise<void> };
let voiceServer: { port: number; close: () => Promise<void> };

/**
 * Start a minimal mock OpenAI Realtime WS server.
 * Immediately sends session.created on each incoming connection, then
 * silently accepts all further messages.
 */
async function startMockOpenAI(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    ws.send(
      JSON.stringify({
        type: "session.created",
        session: {
          id: `mock-${Date.now()}`,
          model: "gpt-4o-realtime-preview",
          modalities: ["text", "audio"],
          voice: "alloy",
        },
      }),
    );
    ws.on("message", () => {});
  });

  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address() as AddressInfo;
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res) => wss.close(() => httpServer.close(() => res()))),
      });
    });
  });
}

/**
 * Start the voice-jib-jab server on a random port.
 * Instantiates VoiceWebSocketServer directly; does NOT import index.ts.
 */
async function startVoiceServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  const httpServer = createServer(app);
  new VoiceWebSocketServer(httpServer);

  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address() as AddressInfo;
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res) => httpServer.close(() => res())),
      });
    });
  });
}

// ── Suite setup / teardown ────────────────────────────────────────────────────

beforeAll(async () => {
  const mock = await startMockOpenAI();
  mockOpenAI = mock;

  // Point the OpenAI adapter at our mock BEFORE the voice server creates any
  // sessions (the env var is read lazily in OpenAIRealtimeAdapter.connect()).
  process.env.OPENAI_REALTIME_URL = `ws://127.0.0.1:${mock.port}`;
  process.env.OPENAI_API_KEY = "test-key";

  voiceServer = await startVoiceServer();
}, 15000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 150));
  await voiceServer?.close();
  await mockOpenAI?.close();
  delete process.env.OPENAI_REALTIME_URL;
  delete process.env.OPENAI_API_KEY;
}, 20000);

// ── Convenience factory ───────────────────────────────────────────────────────

function createClient(): BufferedWsClient {
  return new BufferedWsClient(`ws://127.0.0.1:${voiceServer.port}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Voice agent end-to-end integration", () => {
  const TEST_TIMEOUT = 12000;

  // ── 1. Happy path — connect and start session ─────────────────────────────

  it(
    "happy path: connect, receive session.ready, send session.start, receive provider.ready",
    async () => {
      const client = createClient();
      await client.open();

      // Server sends session.ready immediately on connection
      const ready = await client.waitFor((m) => m.type === "session.ready");
      expect(ready.type).toBe("session.ready");
      expect(typeof ready.sessionId).toBe("string");
      expect((ready.sessionId as string).length).toBeGreaterThan(0);

      // Start a session — server connects to mock OpenAI then sends provider.ready
      client.send({ type: "session.start" });
      const providerReady = await client.waitFor((m) => m.type === "provider.ready");
      expect(providerReady.type).toBe("provider.ready");

      await client.close();
    },
    TEST_TIMEOUT,
  );

  // ── 2. Session start with tenantId ───────────────────────────────────────

  it(
    "session.start with tenantId completes successfully with no error message",
    async () => {
      const client = createClient();
      await client.open();
      await client.waitFor((m) => m.type === "session.ready");

      // Track error messages while waiting for provider.ready
      const errorMessages: ParsedMessage[] = [];
      // We'll check the buffer after provider.ready arrives

      client.send({ type: "session.start", tenantId: "tenant-1" });
      const providerReady = await client.waitFor((m) => m.type === "provider.ready");
      expect(providerReady.type).toBe("provider.ready");

      // Short wait to let any async error messages arrive
      await new Promise((r) => setTimeout(r, 200));
      expect(client.hasBuffered("error")).toBe(false);
      void errorMessages; // suppress unused warning

      await client.close();
    },
    TEST_TIMEOUT,
  );

  // ── 3. Audio chunk forwarded ─────────────────────────────────────────────

  it(
    "a loud audio.chunk sent after session.start is accepted without error",
    async () => {
      const client = createClient();
      await client.open();
      await client.waitFor((m) => m.type === "session.ready");

      client.send({ type: "session.start" });
      await client.waitFor((m) => m.type === "provider.ready");

      // Send one PCM16 chunk above MIN_AUDIO_RMS=200
      client.send({ type: "audio.chunk", data: LOUD_AUDIO, format: "pcm", sampleRate: 24000 });

      // Allow async processing to complete
      await new Promise((r) => setTimeout(r, 300));

      // No error should have been buffered
      expect(client.hasBuffered("error")).toBe(false);

      await client.close();
    },
    TEST_TIMEOUT,
  );

  // ── 4. Multiple audio chunks ─────────────────────────────────────────────

  it(
    "five consecutive audio.chunk messages are all accepted without error",
    async () => {
      const client = createClient();
      await client.open();
      await client.waitFor((m) => m.type === "session.ready");

      client.send({ type: "session.start" });
      await client.waitFor((m) => m.type === "provider.ready");

      for (let i = 0; i < 5; i++) {
        client.send({ type: "audio.chunk", data: LOUD_AUDIO, format: "pcm", sampleRate: 24000 });
      }

      await new Promise((r) => setTimeout(r, 400));
      expect(client.hasBuffered("error")).toBe(false);

      await client.close();
    },
    TEST_TIMEOUT,
  );

  // ── 5. session.end closes connection ────────────────────────────────────

  it(
    "session.end causes the server to close the WebSocket gracefully",
    async () => {
      const client = createClient();
      await client.open();
      await client.waitFor((m) => m.type === "session.ready");

      client.send({ type: "session.start" });
      await client.waitFor((m) => m.type === "provider.ready");

      client.send({ type: "session.end" });

      // Server calls ws.close() — the underlying socket should reach CLOSED
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("close timeout")), 6000);
        // Poll readyState since the BufferedWsClient.close() would try to call
        // ws.close() again — instead we wait on the underlying raw event
        const interval = setInterval(() => {
          if (client.readyState === WebSocket.CLOSED) {
            clearTimeout(timer);
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });

      expect(client.readyState).toBe(WebSocket.CLOSED);
    },
    TEST_TIMEOUT,
  );

  // ── 6. Unknown message type ──────────────────────────────────────────────

  it(
    "unknown message type does not crash the server — subsequent connections succeed",
    async () => {
      const client = createClient();
      await client.open();
      await client.waitFor((m) => m.type === "session.ready");

      client.send({ type: "unknown_type", payload: "anything" });
      await new Promise((r) => setTimeout(r, 200));

      // Server must still be alive — a new connection should get session.ready
      const client2 = createClient();
      await client2.open();
      const ready2 = await client2.waitFor((m) => m.type === "session.ready");
      expect(ready2.type).toBe("session.ready");

      await client.close();
      await client2.close();
    },
    TEST_TIMEOUT,
  );

  // ── 7. Malformed JSON ────────────────────────────────────────────────────

  it(
    "malformed JSON is handled gracefully — server stays alive and accepts new connections",
    async () => {
      // Use a BufferedWsClient but send raw (non-JSON) bytes by reaching
      // the internal WebSocket. We expose a helper on the class for this.
      const client = createClient();
      await client.open();
      await client.waitFor((m) => m.type === "session.ready");

      // Send a raw non-JSON string — the server wraps JSON.parse in try/catch
      client.sendRaw("not json {{{{");

      await new Promise((r) => setTimeout(r, 300));

      // Server must still be alive — a new connection should receive session.ready
      const client2 = createClient();
      await client2.open();
      const ready2 = await client2.waitFor((m) => m.type === "session.ready");
      expect(ready2.type).toBe("session.ready");

      await client.close();
      await client2.close();
    },
    TEST_TIMEOUT,
  );

  // ── 8. Multiple concurrent sessions ─────────────────────────────────────

  it(
    "three concurrent WS connections can all start sessions independently",
    async () => {
      // Open 3 connections simultaneously
      const clients = [createClient(), createClient(), createClient()];
      await Promise.all(clients.map((c) => c.open()));

      // All three receive session.ready
      const readyMessages = await Promise.all(
        clients.map((c) => c.waitFor((m) => m.type === "session.ready")),
      );
      expect(readyMessages).toHaveLength(3);
      for (const msg of readyMessages) {
        expect(msg.type).toBe("session.ready");
        expect(typeof msg.sessionId).toBe("string");
      }

      // Start sessions on all three concurrently
      for (const c of clients) {
        c.send({ type: "session.start" });
      }

      // All three receive provider.ready
      const providerReadyMessages = await Promise.all(
        clients.map((c) => c.waitFor((m) => m.type === "provider.ready")),
      );
      expect(providerReadyMessages).toHaveLength(3);
      for (const msg of providerReadyMessages) {
        expect(msg.type).toBe("provider.ready");
      }

      await Promise.all(clients.map((c) => c.close()));
    },
    TEST_TIMEOUT,
  );

  // ── 9. Unique session IDs ────────────────────────────────────────────────

  it(
    "session.ready contains a non-empty sessionId that is unique per connection",
    async () => {
      const c1 = createClient();
      const c2 = createClient();
      await Promise.all([c1.open(), c2.open()]);

      const [r1, r2] = await Promise.all([
        c1.waitFor((m) => m.type === "session.ready"),
        c2.waitFor((m) => m.type === "session.ready"),
      ]);

      expect(typeof r1.sessionId).toBe("string");
      expect(typeof r2.sessionId).toBe("string");
      expect((r1.sessionId as string).length).toBeGreaterThan(0);
      expect((r2.sessionId as string).length).toBeGreaterThan(0);
      // Each connection gets a distinct session ID
      expect(r1.sessionId).not.toBe(r2.sessionId);

      await Promise.all([c1.close(), c2.close()]);
    },
    TEST_TIMEOUT,
  );

  // ── 10. Health endpoint reachable during active session ──────────────────

  it(
    "GET /health returns {status:'ok'} while a WebSocket session is active",
    async () => {
      const client = createClient();
      await client.open();
      await client.waitFor((m) => m.type === "session.ready");

      client.send({ type: "session.start" });
      await client.waitFor((m) => m.type === "provider.ready");

      // HTTP health check while the WS session is live
      const response = await fetch(`http://127.0.0.1:${voiceServer.port}/health`);
      expect(response.ok).toBe(true);

      const body = await response.json() as Record<string, unknown>;
      expect(body.status).toBe("ok");

      await client.close();
    },
    TEST_TIMEOUT,
  );
});
