/**
 * useVoiceAgent hook tests.
 *
 * VoiceClient is mocked at the module level. Each test drives the hook
 * by invoking the captured callbacks directly, simulating the events that
 * VoiceClient emits in production.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { VoiceClientCallbacks } from "../../../../sdk/src/types.js";
import { useVoiceAgent } from "../useVoiceAgent.js";

// ---------------------------------------------------------------------------
// Mock VoiceClient
// ---------------------------------------------------------------------------

// vi.hoisted() ensures these variables are available before module mocks run.
const {
  mockConnect,
  mockEndSession,
  mockSendAudio,
  mockStopAudio,
  mockCancelAudio,
  MockVoiceClient,
  getCapturedCallbacks,
  resetCapturedCallbacks,
} = vi.hoisted(() => {
  // Holds the callbacks passed to the most recently constructed VoiceClient.
  let capturedCallbacks: VoiceClientCallbacks = {};

  const mockConnect = vi.fn().mockResolvedValue("sess-123");
  const mockEndSession = vi.fn();
  const mockSendAudio = vi.fn();
  const mockStopAudio = vi.fn();
  const mockCancelAudio = vi.fn();

  const MockVoiceClient = vi.fn().mockImplementation(
    (_options: unknown, callbacks: VoiceClientCallbacks) => {
      capturedCallbacks = {};
      Object.assign(capturedCallbacks, callbacks);
      return {
        connect: mockConnect,
        endSession: mockEndSession,
        sendAudio: mockSendAudio,
        stopAudio: mockStopAudio,
        cancelAudio: mockCancelAudio,
      };
    },
  );

  return {
    mockConnect,
    mockEndSession,
    mockSendAudio,
    mockStopAudio,
    mockCancelAudio,
    MockVoiceClient,
    getCapturedCallbacks: () => capturedCallbacks,
    resetCapturedCallbacks: () => {
      capturedCallbacks = {};
    },
  };
});

vi.mock("../../../../sdk/src/VoiceClient.js", () => ({
  VoiceClient: MockVoiceClient,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOptions() {
  return { wsUrl: "wss://localhost:3000" };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetCapturedCallbacks();
  // Default: connect resolves with session ID
  mockConnect.mockResolvedValue("sess-123");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useVoiceAgent", () => {
  // --- Initial state ---

  describe("initial state", () => {
    it('state is "disconnected" on mount', () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));
      expect(result.current.state).toBe("disconnected");
    });

    it("sessionId is null on mount", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));
      expect(result.current.sessionId).toBeNull();
    });

    it("transcript is empty array on mount", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));
      expect(result.current.transcript).toEqual([]);
    });

    it("lastPolicyEvent is null on mount", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));
      expect(result.current.lastPolicyEvent).toBeNull();
    });

    it("isConnected is false on mount", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));
      expect(result.current.isConnected).toBe(false);
    });
  });

  // --- connect() ---

  describe("connect()", () => {
    it('transitions state to "connecting" when connect() is called', async () => {
      // Keep connect pending so we can observe intermediate state.
      let resolveConnect!: (v: string) => void;
      mockConnect.mockReturnValueOnce(
        new Promise<string>((res) => {
          resolveConnect = res;
        }),
      );

      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      // Start connect without awaiting.
      let connectPromise!: Promise<void>;
      act(() => {
        connectPromise = result.current.connect();
      });

      expect(result.current.state).toBe("connecting");

      // Clean up: resolve so no dangling promises.
      await act(async () => {
        resolveConnect("sess-123");
        await connectPromise;
      });
    });

    it("calls client.connect() with tenantId and persona as userAgent", async () => {
      const { result } = renderHook(() =>
        useVoiceAgent({
          wsUrl: "wss://localhost:3000",
          tenantId: "org_acme",
          persona: "Support Agent",
        }),
      );

      await act(async () => {
        await result.current.connect();
      });

      expect(mockConnect).toHaveBeenCalledWith({
        tenantId: "org_acme",
        userAgent: "Support Agent",
      });
    });

    it("calls client.connect() with undefined fields when not provided", async () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      await act(async () => {
        await result.current.connect();
      });

      expect(mockConnect).toHaveBeenCalledWith({
        tenantId: undefined,
        userAgent: undefined,
      });
    });
  });

  // --- onReady callback ---

  describe("onReady / session ready", () => {
    it('state becomes "ready" after onReady fires', () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        getCapturedCallbacks().onReady?.("sess-abc");
      });

      expect(result.current.state).toBe("ready");
    });

    it("sessionId is set after onReady fires", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        getCapturedCallbacks().onReady?.("sess-abc");
      });

      expect(result.current.sessionId).toBe("sess-abc");
    });

    it("isConnected is true after onReady fires", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        getCapturedCallbacks().onReady?.("sess-xyz");
      });

      expect(result.current.isConnected).toBe(true);
    });

    it("calls onStateChange prop with 'ready' when onReady fires", () => {
      const onStateChange = vi.fn();
      renderHook(() => useVoiceAgent({ ...defaultOptions(), onStateChange }));

      act(() => {
        getCapturedCallbacks().onReady?.("sess-1");
      });

      expect(onStateChange).toHaveBeenCalledWith("ready");
    });
  });

  // --- onTranscript callback ---

  describe("onTranscript", () => {
    it("transcript array grows when onTranscript fires", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        getCapturedCallbacks().onTranscript?.({ text: "Hello", isFinal: true, role: "assistant" });
      });

      expect(result.current.transcript).toHaveLength(1);
      expect(result.current.transcript[0]).toEqual({
        text: "Hello",
        isFinal: true,
        role: "assistant",
      });
    });

    it("transcript accumulates across multiple events", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        getCapturedCallbacks().onTranscript?.({ text: "Hi", isFinal: false, role: "user" });
        getCapturedCallbacks().onTranscript?.({ text: "Hello there!", isFinal: true, role: "assistant" });
      });

      expect(result.current.transcript).toHaveLength(2);
    });

    it("calls onTranscript prop when transcript event fires", () => {
      const onTranscript = vi.fn();
      renderHook(() => useVoiceAgent({ ...defaultOptions(), onTranscript }));

      const event = { text: "Test", isFinal: true, role: "user" as const };

      act(() => {
        getCapturedCallbacks().onTranscript?.(event);
      });

      expect(onTranscript).toHaveBeenCalledWith(event);
    });
  });

  // --- onPolicyEvent callback ---

  describe("onPolicyEvent", () => {
    it("lastPolicyEvent is updated when onPolicyEvent fires", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      const event = {
        decision: "rewrite" as const,
        reasonCodes: ["PII_DETECTED"],
        severity: 7,
        safeRewrite: "I can help with that.",
      };

      act(() => {
        getCapturedCallbacks().onPolicyEvent?.(event);
      });

      expect(result.current.lastPolicyEvent).toEqual(event);
    });

    it("calls onPolicyEvent prop when policy event fires", () => {
      const onPolicyEvent = vi.fn();
      renderHook(() => useVoiceAgent({ ...defaultOptions(), onPolicyEvent }));

      const event = {
        decision: "allow" as const,
        reasonCodes: [],
        severity: 0,
      };

      act(() => {
        getCapturedCallbacks().onPolicyEvent?.(event);
      });

      expect(onPolicyEvent).toHaveBeenCalledWith(event);
    });
  });

  // --- onError callback ---

  describe("onError", () => {
    it('state becomes "error" when onError fires', () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        getCapturedCallbacks().onError?.(new Error("WebSocket error"));
      });

      expect(result.current.state).toBe("error");
    });

    it("calls onStateChange prop with 'error' when onError fires", () => {
      const onStateChange = vi.fn();
      renderHook(() => useVoiceAgent({ ...defaultOptions(), onStateChange }));

      act(() => {
        getCapturedCallbacks().onError?.(new Error("Network failure"));
      });

      expect(onStateChange).toHaveBeenCalledWith("error");
    });

    it("calls onError prop with the error when onError fires", () => {
      const onError = vi.fn();
      renderHook(() => useVoiceAgent({ ...defaultOptions(), onError }));

      const err = new Error("Session rejected");

      act(() => {
        getCapturedCallbacks().onError?.(err);
      });

      expect(onError).toHaveBeenCalledWith(err);
    });
  });

  // --- onClose callback ---

  describe("onClose", () => {
    it('state becomes "disconnected" when onClose fires', () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      // Get to ready first.
      act(() => {
        getCapturedCallbacks().onReady?.("sess-1");
      });
      expect(result.current.state).toBe("ready");

      act(() => {
        getCapturedCallbacks().onClose?.();
      });

      expect(result.current.state).toBe("disconnected");
    });

    it("sessionId is cleared when onClose fires", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        getCapturedCallbacks().onReady?.("sess-1");
      });
      expect(result.current.sessionId).toBe("sess-1");

      act(() => {
        getCapturedCallbacks().onClose?.();
      });

      expect(result.current.sessionId).toBeNull();
    });

    it("calls onStateChange prop with 'disconnected' when onClose fires", () => {
      const onStateChange = vi.fn();
      renderHook(() => useVoiceAgent({ ...defaultOptions(), onStateChange }));

      act(() => {
        getCapturedCallbacks().onClose?.();
      });

      expect(onStateChange).toHaveBeenCalledWith("disconnected");
    });
  });

  // --- disconnect() ---

  describe("disconnect()", () => {
    it("calls client.endSession()", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        result.current.disconnect();
      });

      expect(mockEndSession).toHaveBeenCalledOnce();
    });
  });

  // --- sendAudio() ---

  describe("sendAudio()", () => {
    it("proxies base64 data to client.sendAudio()", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        result.current.sendAudio("AQID");
      });

      expect(mockSendAudio).toHaveBeenCalledWith("AQID");
    });
  });

  // --- stopAudio() ---

  describe("stopAudio()", () => {
    it("proxies call to client.stopAudio()", () => {
      const { result } = renderHook(() => useVoiceAgent(defaultOptions()));

      act(() => {
        result.current.stopAudio();
      });

      expect(mockStopAudio).toHaveBeenCalledOnce();
    });
  });

  // --- autoConnect ---

  describe("autoConnect", () => {
    it("calls connect() on mount when autoConnect=true", () => {
      renderHook(() =>
        useVoiceAgent({
          wsUrl: "wss://localhost:3000",
          tenantId: "org_test",
          persona: "Bot",
          autoConnect: true,
        }),
      );

      expect(mockConnect).toHaveBeenCalledOnce();
      expect(mockConnect).toHaveBeenCalledWith({
        tenantId: "org_test",
        userAgent: "Bot",
      });
    });

    it("does NOT call connect() on mount when autoConnect=false", () => {
      renderHook(() =>
        useVoiceAgent({ wsUrl: "wss://localhost:3000", autoConnect: false }),
      );

      expect(mockConnect).not.toHaveBeenCalled();
    });

    it("does NOT call connect() on mount when autoConnect is omitted", () => {
      renderHook(() => useVoiceAgent(defaultOptions()));

      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  // --- Cleanup / unmount ---

  describe("cleanup", () => {
    it("calls client.endSession() on unmount", () => {
      const { unmount } = renderHook(() => useVoiceAgent(defaultOptions()));

      unmount();

      expect(mockEndSession).toHaveBeenCalledOnce();
    });
  });
});
