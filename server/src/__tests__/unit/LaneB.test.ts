/**
 * LaneB Unit Tests
 *
 * Tests the Lane B reasoning engine that wraps the OpenAI Realtime adapter
 * to provide substantive voice responses. Covers disclaimer management,
 * adapter event forwarding, RAG pipeline wiring, and TTFB tracking.
 *
 * All external dependencies (adapter, RAG, retrieval, PII) are mocked.
 */

// ── Mocks (must be before imports for jest hoisting) ────────────────────

const mockAdapter = {
  on: jest.fn(),
  emit: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  sendAudio: jest.fn().mockResolvedValue(undefined),
  commitAudio: jest.fn().mockResolvedValue(true),
  cancel: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockReturnValue(true),
  clearInputBuffer: jest.fn(),
  setVoiceMode: jest.fn(),
  getVoiceMode: jest.fn().mockReturnValue("push-to-talk"),
  setConversationContext: jest.fn(),
  setResponseInstructionsProvider: jest.fn(),
};

jest.mock("../../providers/OpenAIRealtimeAdapter.js", () => ({
  OpenAIRealtimeAdapter: jest.fn(() => mockAdapter),
}));

jest.mock("../../retrieval/DisclaimerLookup.js", () => ({
  formatDisclaimerBlock: jest.fn().mockReturnValue({ text: null, missing: [] }),
}));

jest.mock("../../retrieval/RAGPipeline.js", () => ({
  RAGPipeline: jest.fn().mockImplementation(() => ({
    buildResponseContext: jest.fn().mockReturnValue({ instructions: null }),
  })),
}));

jest.mock("../../retrieval/index.js", () => ({
  retrievalService: {},
}));

jest.mock("../../insurance/policy_gate.js", () => ({
  PIIRedactor: jest.fn().mockImplementation(() => ({
    redactText: jest.fn((text: string) => text),
  })),
}));

import { LaneB, LaneBConfig } from "../../lanes/LaneB.js";
import { formatDisclaimerBlock } from "../../retrieval/DisclaimerLookup.js";

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Capture the event handlers registered by LaneB on the adapter so tests
 * can trigger them directly.
 */
function captureAdapterHandlers(): Record<string, (...args: any[]) => void> {
  const handlers: Record<string, (...args: any[]) => void> = {};
  (mockAdapter.on as jest.Mock).mockImplementation(
    (event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler;
    },
  );
  return handlers;
}

const BASE_CONFIG: LaneBConfig = {
  providerConfig: {
    apiKey: "test-key",
    model: "gpt-4o-realtime-preview-2024-12-17",
  },
};

function createLaneB(config: LaneBConfig = BASE_CONFIG): {
  lane: LaneB;
  handlers: Record<string, (...args: any[]) => void>;
} {
  const handlers = captureAdapterHandlers();
  const lane = new LaneB("test-session-001", config);
  return { lane, handlers };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("LaneB", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    mockAdapter.connect.mockResolvedValue(undefined);
    mockAdapter.disconnect.mockResolvedValue(undefined);
    mockAdapter.sendAudio.mockResolvedValue(undefined);
    mockAdapter.commitAudio.mockResolvedValue(true);
    mockAdapter.cancel.mockResolvedValue(undefined);
    mockAdapter.isConnected.mockReturnValue(true);
    mockAdapter.getVoiceMode.mockReturnValue("push-to-talk");
    (formatDisclaimerBlock as jest.Mock).mockReturnValue({
      text: null,
      missing: [],
    });
  });

  // ── Constructor ──────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should create a LaneB instance", () => {
      const { lane } = createLaneB();
      expect(lane).toBeInstanceOf(LaneB);
    });

    it("should register event handlers on the adapter", () => {
      createLaneB();
      expect(mockAdapter.on).toHaveBeenCalledWith(
        "audio",
        expect.any(Function),
      );
      expect(mockAdapter.on).toHaveBeenCalledWith(
        "transcript",
        expect.any(Function),
      );
      expect(mockAdapter.on).toHaveBeenCalledWith(
        "response_start",
        expect.any(Function),
      );
      expect(mockAdapter.on).toHaveBeenCalledWith(
        "response_end",
        expect.any(Function),
      );
    });

    it("should enable RAG pipeline when rag.enabled is true", () => {
      const { RAGPipeline } = jest.requireMock(
        "../../retrieval/RAGPipeline.js",
      );
      createLaneB({
        ...BASE_CONFIG,
        rag: { enabled: true, topK: 3 },
      });
      expect(RAGPipeline).toHaveBeenCalled();
    });

    it("should not create RAG pipeline when rag is not configured", () => {
      const { RAGPipeline } = jest.requireMock(
        "../../retrieval/RAGPipeline.js",
      );
      RAGPipeline.mockClear();
      createLaneB(BASE_CONFIG);
      expect(RAGPipeline).not.toHaveBeenCalled();
    });
  });

  // ── getConversationContext (line 92) ─────────────────────────────────

  describe("getConversationContext()", () => {
    it("should return null initially", () => {
      const { lane } = createLaneB();
      expect(lane.getConversationContext()).toBeNull();
    });

    it("should return the context after setConversationContext is called (line 92)", () => {
      const { lane } = createLaneB();
      lane.setConversationContext("Previous session data here.");
      expect(lane.getConversationContext()).toBe("Previous session data here.");
    });
  });

  // ── clearRequiredDisclaimers / getRequiredDisclaimers (lines 108-115) ─

  describe("disclaimer management", () => {
    it("clearRequiredDisclaimers() should empty the disclaimer list (line 108)", () => {
      const { lane } = createLaneB();
      lane.setRequiredDisclaimers(["D001", "D002"]);
      lane.clearRequiredDisclaimers();
      expect(lane.getRequiredDisclaimers()).toEqual([]);
    });

    it("getRequiredDisclaimers() should return a copy of the current IDs (lines 113-115)", () => {
      const { lane } = createLaneB();
      lane.setRequiredDisclaimers(["D001", "D002"]);
      const result = lane.getRequiredDisclaimers();
      expect(result).toEqual(["D001", "D002"]);
    });

    it("getRequiredDisclaimers() should return an independent copy", () => {
      const { lane } = createLaneB();
      lane.setRequiredDisclaimers(["D001"]);
      const copy = lane.getRequiredDisclaimers();
      copy.push("D999"); // mutate the returned copy
      expect(lane.getRequiredDisclaimers()).toEqual(["D001"]); // original unchanged
    });

    it("setRequiredDisclaimers() should deduplicate IDs", () => {
      const { lane } = createLaneB();
      lane.setRequiredDisclaimers(["D001", "D001", "D002"]);
      expect(lane.getRequiredDisclaimers()).toEqual(["D001", "D002"]);
    });
  });

  // ── user_transcript event forwarding (line 149) ──────────────────────

  describe("user_transcript forwarding (line 149)", () => {
    it("should forward user_transcript events from adapter", () => {
      const { lane, handlers } = createLaneB();
      const segment = {
        text: "Hello there",
        confidence: 0.95,
        isFinal: true,
        timestamp: Date.now(),
      };

      const listener = jest.fn();
      lane.on("user_transcript", listener);

      handlers["user_transcript"](segment);

      expect(listener).toHaveBeenCalledWith(segment);
    });
  });

  // ── speech_stopped event forwarding (line 182) ───────────────────────

  describe("speech_stopped forwarding (line 182)", () => {
    it("should forward speech_stopped events from adapter", () => {
      const { lane, handlers } = createLaneB();

      const listener = jest.fn();
      lane.on("speech_stopped", listener);

      handlers["speech_stopped"]();

      expect(listener).toHaveBeenCalled();
    });

    it("should also forward speech_started events", () => {
      const { lane, handlers } = createLaneB();

      const listener = jest.fn();
      lane.on("speech_started", listener);

      handlers["speech_started"]();

      expect(listener).toHaveBeenCalled();
    });
  });

  // ── clearInputBuffer (line 233) ──────────────────────────────────────

  describe("clearInputBuffer() (line 233)", () => {
    it("should delegate to adapter.clearInputBuffer", () => {
      const { lane } = createLaneB();
      lane.clearInputBuffer();
      expect(mockAdapter.clearInputBuffer).toHaveBeenCalled();
    });
  });

  // ── getTTFB (lines 275-282) ──────────────────────────────────────────

  describe("getTTFB() (lines 275-282)", () => {
    it("should return null when no response has started", () => {
      const { lane } = createLaneB();
      expect(lane.getTTFB()).toBeNull();
    });

    it("should return null when response started but first audio not yet emitted", () => {
      const { lane, handlers } = createLaneB();

      // Trigger response_start to set responseStartTime
      handlers["response_start"]();

      // firstAudioTime is still null → getTTFB returns null
      expect(lane.getTTFB()).toBeNull();
    });

    it("should return the TTFB latency after first audio is emitted", () => {
      const { lane, handlers } = createLaneB();

      // Start a response
      handlers["response_start"]();

      // Simulate first audio arriving while responding
      const audioChunk = {
        data: Buffer.alloc(100),
        format: "pcm" as const,
        sampleRate: 24000,
      };
      handlers["audio"](audioChunk);

      const ttfb = lane.getTTFB();
      expect(ttfb).not.toBeNull();
      expect(typeof ttfb).toBe("number");
      expect(ttfb).toBeGreaterThanOrEqual(0);
    });
  });

  // ── applyDisclaimersToTranscript (lines 324-345) ─────────────────────

  describe("applyDisclaimersToTranscript() via transcript event (lines 324-345)", () => {
    it("should pass through non-final transcript segments unchanged", () => {
      const { lane, handlers } = createLaneB();
      lane.setRequiredDisclaimers(["D001"]);

      // Start responding so isResponding is true
      handlers["response_start"]();

      const segment = {
        text: "partial",
        confidence: 0.8,
        isFinal: false,
        timestamp: Date.now(),
      };

      const listener = jest.fn();
      lane.on("transcript", listener);

      handlers["transcript"](segment);

      expect(listener).toHaveBeenCalledWith(segment);
      expect(formatDisclaimerBlock).not.toHaveBeenCalled();
    });

    it("should pass through final segments when not responding", () => {
      const { lane, handlers } = createLaneB();
      lane.setRequiredDisclaimers(["D001"]);

      // Do NOT trigger response_start — isResponding stays false
      const segment = {
        text: "final text",
        confidence: 1.0,
        isFinal: true,
        timestamp: Date.now(),
      };

      const listener = jest.fn();
      lane.on("transcript", listener);

      handlers["transcript"](segment);

      expect(listener).toHaveBeenCalledWith(segment);
      expect(formatDisclaimerBlock).not.toHaveBeenCalled();
    });

    it("should pass through final segments with no required disclaimers", () => {
      const { lane, handlers } = createLaneB();

      handlers["response_start"]();

      const segment = {
        text: "final answer",
        confidence: 1.0,
        isFinal: true,
        timestamp: Date.now(),
      };

      const listener = jest.fn();
      lane.on("transcript", listener);

      handlers["transcript"](segment);

      expect(listener).toHaveBeenCalledWith(segment);
      expect(formatDisclaimerBlock).not.toHaveBeenCalled();
    });

    it("should append disclaimer text to final segment when responding with pending disclaimers (lines 328-348)", () => {
      (formatDisclaimerBlock as jest.Mock).mockReturnValue({
        text: "Important disclaimer text.",
        missing: [],
      });

      const { lane, handlers } = createLaneB();
      lane.setRequiredDisclaimers(["D001"]);

      handlers["response_start"]();

      const segment = {
        text: "Here is your answer.",
        confidence: 1.0,
        isFinal: true,
        timestamp: 1234567890,
      };

      const listener = jest.fn();
      lane.on("transcript", listener);

      handlers["transcript"](segment);

      expect(formatDisclaimerBlock).toHaveBeenCalledWith(["D001"]);
      expect(listener).toHaveBeenCalledWith({
        text: "Here is your answer.\n\nImportant disclaimer text.",
        confidence: 1.0,
        isFinal: true,
        timestamp: 1234567890,
      });
      // Disclaimers should be consumed after use
      expect(lane.getRequiredDisclaimers()).toEqual([]);
    });

    it("should consume disclaimers even when formatDisclaimerBlock returns no text (missing IDs)", () => {
      (formatDisclaimerBlock as jest.Mock).mockReturnValue({
        text: null,
        missing: ["D999"],
      });

      const { lane, handlers } = createLaneB();
      lane.setRequiredDisclaimers(["D999"]);

      handlers["response_start"]();

      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      const segment = {
        text: "Answer.",
        confidence: 1.0,
        isFinal: true,
        timestamp: Date.now(),
      };

      const listener = jest.fn();
      lane.on("transcript", listener);

      handlers["transcript"](segment);

      // Original segment returned unchanged when disclaimerText is null
      expect(listener).toHaveBeenCalledWith(segment);
      // Missing disclaimer IDs should be warned
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("D999"),
      );
      // Disclaimers consumed regardless
      expect(lane.getRequiredDisclaimers()).toEqual([]);

      warnSpy.mockRestore();
    });
  });

  // ── connect / disconnect ──────────────────────────────────────────────

  describe("connect() and disconnect()", () => {
    it("should delegate connect to adapter", async () => {
      const { lane } = createLaneB();
      await lane.connect();
      expect(mockAdapter.connect).toHaveBeenCalledWith("test-session-001");
    });

    it("should inject conversation context before connecting if set", async () => {
      const { lane } = createLaneB();
      lane.setConversationContext("Prior context data.");
      await lane.connect();
      expect(mockAdapter.setConversationContext).toHaveBeenCalledWith(
        "Prior context data.",
      );
    });

    it("should delegate disconnect to adapter", async () => {
      const { lane } = createLaneB();
      await lane.disconnect();
      expect(mockAdapter.disconnect).toHaveBeenCalled();
    });
  });

  // ── cancel ────────────────────────────────────────────────────────────

  describe("cancel()", () => {
    it("should cancel adapter and reset responding state", async () => {
      const { lane, handlers } = createLaneB();

      handlers["response_start"]();
      expect(lane.getIsResponding()).toBe(true);

      await lane.cancel();

      expect(mockAdapter.cancel).toHaveBeenCalled();
      expect(lane.getIsResponding()).toBe(false);
      expect(lane.hasFirstAudioEmitted()).toBe(false);
      expect(lane.getRequiredDisclaimers()).toEqual([]);
    });
  });

  // ── first_audio_ready event ──────────────────────────────────────────

  describe("first_audio_ready event", () => {
    it("should emit first_audio_ready with latencyMs on first audio chunk while responding", () => {
      const { lane, handlers } = createLaneB();

      handlers["response_start"]();

      const firstAudioListener = jest.fn();
      lane.on("first_audio_ready", firstAudioListener);

      const chunk = {
        data: Buffer.alloc(100),
        format: "pcm" as const,
        sampleRate: 24000,
      };
      handlers["audio"](chunk);

      expect(firstAudioListener).toHaveBeenCalledWith(
        expect.objectContaining({ latencyMs: expect.any(Number) }),
      );
      expect(lane.hasFirstAudioEmitted()).toBe(true);
    });

    it("should not re-emit first_audio_ready on subsequent audio chunks", () => {
      const { lane, handlers } = createLaneB();

      handlers["response_start"]();

      const firstAudioListener = jest.fn();
      lane.on("first_audio_ready", firstAudioListener);

      const chunk = {
        data: Buffer.alloc(100),
        format: "pcm" as const,
        sampleRate: 24000,
      };
      handlers["audio"](chunk);
      handlers["audio"](chunk);
      handlers["audio"](chunk);

      expect(firstAudioListener).toHaveBeenCalledTimes(1);
    });

    it("should not emit first_audio_ready when not responding", () => {
      const { lane, handlers } = createLaneB();
      // Do NOT call response_start — isResponding stays false

      const firstAudioListener = jest.fn();
      lane.on("first_audio_ready", firstAudioListener);

      const chunk = {
        data: Buffer.alloc(100),
        format: "pcm" as const,
        sampleRate: 24000,
      };
      handlers["audio"](chunk);

      expect(firstAudioListener).not.toHaveBeenCalled();
    });
  });

  // ── response_end lifecycle ────────────────────────────────────────────

  describe("response_end lifecycle", () => {
    it("should reset responding state and clear disclaimers on response_end", () => {
      const { lane, handlers } = createLaneB();

      handlers["response_start"]();
      lane.setRequiredDisclaimers(["D001"]);

      handlers["response_end"]();

      expect(lane.getIsResponding()).toBe(false);
      expect(lane.hasFirstAudioEmitted()).toBe(false);
      expect(lane.getRequiredDisclaimers()).toEqual([]);
    });

    it("should emit response_end event", () => {
      const { lane, handlers } = createLaneB();

      const listener = jest.fn();
      lane.on("response_end", listener);

      handlers["response_start"]();
      handlers["response_end"]();

      expect(listener).toHaveBeenCalled();
    });
  });

  // ── error forwarding ──────────────────────────────────────────────────

  describe("error forwarding", () => {
    it("should forward error events from adapter", () => {
      const { lane, handlers } = createLaneB();

      const errorListener = jest.fn();
      lane.on("error", errorListener);

      const err = new Error("adapter failure");
      handlers["error"](err);

      expect(errorListener).toHaveBeenCalledWith(err);
    });
  });

  // ── voice mode ────────────────────────────────────────────────────────

  describe("voice mode", () => {
    it("setVoiceMode() should delegate to adapter", () => {
      const { lane } = createLaneB();
      lane.setVoiceMode("open-mic");
      expect(mockAdapter.setVoiceMode).toHaveBeenCalledWith("open-mic");
    });

    it("getVoiceMode() should delegate to adapter", () => {
      const { lane } = createLaneB();
      expect(lane.getVoiceMode()).toBe("push-to-talk");
    });
  });

  // ── getAdapter ────────────────────────────────────────────────────────

  describe("getAdapter()", () => {
    it("should return the underlying adapter instance", () => {
      const { lane } = createLaneB();
      expect(lane.getAdapter()).toBe(mockAdapter);
    });
  });
});
