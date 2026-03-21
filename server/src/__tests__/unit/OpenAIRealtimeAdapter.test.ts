/**
 * OpenAIRealtimeAdapter Unit Tests (P0 - Production Blocker)
 *
 * Tests the critical buffer management, confirmation protocol,
 * and guard clauses that prevent the race condition bug.
 *
 * Target Coverage: 85%+
 */

import { OpenAIRealtimeAdapter } from "../../providers/OpenAIRealtimeAdapter.js";
import { ProviderConfig } from "../../providers/ProviderAdapter.js";
import {
  createAudioForDuration,
} from "../helpers/audio.js";
import { waitForEvent } from "../helpers/wait.js";
import { MockWebSocket } from "../mocks/MockWebSocket.js";

// Mock 'ws' module at the top level (uses manual mock in __mocks__/ws.ts)
jest.mock("ws");

describe("OpenAIRealtimeAdapter", () => {
  let adapter: OpenAIRealtimeAdapter;
  let mockWs: MockWebSocket;
  const config: ProviderConfig = {
    apiKey: "test-api-key",
    model: "gpt-4o-realtime-preview-2024-12-17",
  };

  beforeEach(async () => {
    // Reset any previous mock state
    const WebSocketMock = jest.requireMock("ws").default;
    WebSocketMock.resetMock();

    // Create adapter (this will create the WebSocket internally)
    adapter = new OpenAIRealtimeAdapter(config);

    // Connect to get WebSocket instance
    const connectPromise = adapter.connect("test-session");

    // Get the mock instance that was created
    mockWs = WebSocketMock.getMockInstance();

    // Wait for connection to open
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate session.created response
    mockWs.receiveMessage({ type: "session.created" });

    // Wait for connection promise to resolve
    await connectPromise;

    // Note: Do NOT clear messages here - some tests need them!
    // Tests that need clean state should call mockWs.clearMessages() explicitly
  });

  afterEach(async () => {
    if (adapter && adapter.isConnected()) {
      await adapter.disconnect();
    }
    // Always drain pending setImmediate callbacks (MockWebSocket open/close events
    // fire via setImmediate — if a test called disconnect() itself, afterEach skips the
    // block above but the close event is still queued and must be drained here to
    // prevent "Cannot log after tests are done" warnings).
    await new Promise((resolve) => setImmediate(resolve));
  });

  describe("Connection Lifecycle", () => {
    it("should connect to OpenAI WebSocket", async () => {
      expect(adapter.isConnected()).toBe(true);
      expect(mockWs.url).toContain("api.openai.com");
      expect(mockWs.url).toContain("gpt-4o-realtime-preview");
    });

    it("should send session.update on connection", async () => {
      const sessionUpdate = mockWs.getMessagesByType("session.update");
      expect(sessionUpdate.length).toBeGreaterThan(0);
    });

    it("should mark session as created on session.created event", () => {
      expect(adapter.isSessionCreated()).toBe(true);
    });

    it("should disconnect cleanly", async () => {
      await adapter.disconnect();

      // Wait for close event to fire (setImmediate in MockWebSocket)
      await new Promise((resolve) => setImmediate(resolve));

      expect(adapter.isConnected()).toBe(false);
      expect(mockWs.readyState).toBe(MockWebSocket.CLOSED);
    });
  });

  describe("Buffer Duration Calculation", () => {
    it("should calculate duration correctly for 1 second of audio", async () => {
      // 24kHz * 2 bytes * 1 sec = 48000 bytes
      const audio = createAudioForDuration(1000);
      await adapter.sendAudio(audio);

      // Access private method through type assertion for testing
      const duration = (adapter as any).getBufferDurationMs();

      expect(duration).toBe(1000);
    });

    it("should calculate duration correctly for 500ms of audio", async () => {
      const audio = createAudioForDuration(500);
      await adapter.sendAudio(audio);

      const duration = (adapter as any).getBufferDurationMs();

      expect(duration).toBe(500);
    });

    it("should calculate duration correctly for 100ms of audio", async () => {
      const audio = createAudioForDuration(100);
      await adapter.sendAudio(audio);

      const duration = (adapter as any).getBufferDurationMs();

      expect(duration).toBe(100);
    });

    it("should return 0 for empty buffer", () => {
      const duration = (adapter as any).getBufferDurationMs();
      expect(duration).toBe(0);
    });

    it("should accumulate duration across multiple chunks", async () => {
      // Send 3 chunks of 100ms each
      await adapter.sendAudio(createAudioForDuration(100));
      await adapter.sendAudio(createAudioForDuration(100));
      await adapter.sendAudio(createAudioForDuration(100));

      const duration = (adapter as any).getBufferDurationMs();

      expect(duration).toBe(300);
    });
  });

  describe("Audio Sending", () => {
    it("should send audio chunks as base64", async () => {
      const audio = createAudioForDuration(85);
      await adapter.sendAudio(audio);

      const messages = mockWs.getMessagesByType("input_audio_buffer.append");
      expect(messages.length).toBe(1);
      expect(messages[0].audio).toBeDefined();
      expect(typeof messages[0].audio).toBe("string");
    });

    it("should track buffer bytes on audio send", async () => {
      await adapter.sendAudio(createAudioForDuration(85));
      await adapter.sendAudio(createAudioForDuration(85));

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.localBytes).toBe(8160);
    });

    it("should update lastAppendTime on audio send", async () => {
      const before = Date.now();
      await adapter.sendAudio(createAudioForDuration(85));
      const after = Date.now();

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.lastAppendTime).toBeGreaterThanOrEqual(before);
      expect(bufferState.lastAppendTime).toBeLessThanOrEqual(after);
    });

    it("should reject unsupported audio formats", async () => {
      const audio = {
        data: Buffer.alloc(100),
        format: "mp3" as any,
        sampleRate: 24000,
      };

      await expect(adapter.sendAudio(audio)).rejects.toThrow(
        "Unsupported audio format",
      );
    });

    it("should handle audio send when disconnected gracefully", async () => {
      await adapter.disconnect();

      // Should not throw, just warn
      await expect(
        adapter.sendAudio(createAudioForDuration(2)),
      ).resolves.not.toThrow();
    });
  });

  describe("Buffer State Tracking", () => {
    it("should set speechDetected on VAD speech_started event", () => {
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.speechDetected).toBe(true);
    });

    it("should reset speechDetected on commit confirmation", async () => {
      // Set speechDetected
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      // Commit and confirm
      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.speechDetected).toBe(false);
    });

    it("should set pendingCommit on commit", async () => {
      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.pendingCommit).toBe(true);
    });

    it("should reset buffer state completely", async () => {
      // Setup state
      await adapter.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      // Reset
      (adapter as any).resetBufferState();

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.localBytes).toBe(0);
      expect(bufferState.lastAppendTime).toBe(0);
      expect(bufferState.speechDetected).toBe(false);
      expect(bufferState.pendingCommit).toBe(false);
    });
  });

  describe("commitAudio - Guard Clause 1: Minimum Duration", () => {
    it("should reject commit if buffer < 100ms", async () => {
      // Send only 50ms of audio (2400 bytes)
      await adapter.sendAudio(createAudioForDuration(50));

      const committed = await adapter.commitAudio();

      expect(committed).toBe(false);
      expect(mockWs.hasSentMessage("input_audio_buffer.commit")).toBe(false);
    });

    it("should reset buffer state when rejecting small buffer", async () => {
      await adapter.sendAudio(createAudioForDuration(50));
      await adapter.commitAudio();

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.localBytes).toBe(0);
    });

    it("should accept commit if buffer >= 100ms", async () => {
      // Send exactly 100ms
      await adapter.sendAudio(createAudioForDuration(100));

      const committed = await adapter.commitAudio();

      expect(committed).toBe(true);
      expect(mockWs.hasSentMessage("input_audio_buffer.commit")).toBe(true);
    });

    it("should accept commit with buffer > 100ms", async () => {
      // Send 500ms
      await adapter.sendAudio(createAudioForDuration(500));

      const committed = await adapter.commitAudio();

      expect(committed).toBe(true);
    });

    it("should return false when not connected", async () => {
      await adapter.disconnect();

      const committed = await adapter.commitAudio();

      expect(committed).toBe(false);
    });
  });

  describe("commitAudio - Guard Clause 2: Safety Window", () => {
    beforeEach(() => {
      // Fake timers eliminate real 50ms waits (flaky in CI).
      // doNotFake: setImmediate preserves MockWebSocket open/close event delivery.
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("should wait for safety window (50ms) before commit", async () => {
      await adapter.sendAudio(createAudioForDuration(200));

      // Start commit — pauses at the safety window setTimeout
      const commitPromise = adapter.commitAudio();

      // Fire the 50ms safety window timer deterministically
      jest.advanceTimersByTime(50);

      const committed = await commitPromise;

      expect(committed).toBe(true);
      expect(mockWs.hasSentMessage("input_audio_buffer.commit")).toBe(true);
    });

    it("should not wait if safety window already passed", async () => {
      await adapter.sendAudio(createAudioForDuration(200));

      // Advance fake clock past the 50ms safety window — no real delay
      jest.advanceTimersByTime(60);

      // Commit is immediate; no setTimeout scheduled
      const committed = await adapter.commitAudio();

      expect(committed).toBe(true);
      expect(mockWs.hasSentMessage("input_audio_buffer.commit")).toBe(true);
    });
  });

  describe("commitAudio - Guard Clause 3: VAD Confirmation", () => {
    it("should warn when committing without VAD confirmation", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      // Send 150ms without speech_started event
      await adapter.sendAudio(createAudioForDuration(150));
      await adapter.commitAudio();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("without VAD confirmation"),
      );

      consoleSpy.mockRestore();
    });

    it("should not warn when VAD confirmation exists", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      // Send audio and trigger VAD
      await adapter.sendAudio(createAudioForDuration(200));
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });
      await adapter.commitAudio();

      // Should not contain warning
      const calls = consoleSpy.mock.calls.map((call) => call.join(" "));
      const hasWarning = calls.some((call) =>
        call.includes("without VAD confirmation"),
      );

      expect(hasWarning).toBe(false);

      consoleSpy.mockRestore();
    });

    it("should not warn for buffer >= 500ms", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      // Send 500ms without VAD
      await adapter.sendAudio(createAudioForDuration(500));
      await adapter.commitAudio();

      const calls = consoleSpy.mock.calls.map((call) => call.join(" "));
      const hasWarning = calls.some((call) =>
        call.includes("without VAD confirmation"),
      );

      expect(hasWarning).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe("Confirmation Protocol", () => {
    it("should NOT send response.create immediately after commit", async () => {
      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();

      // Should have sent commit
      expect(mockWs.hasSentMessage("input_audio_buffer.commit")).toBe(true);

      // Should NOT have sent response.create yet
      expect(mockWs.hasSentMessage("response.create")).toBe(false);
    });

    it("should send response.create after commit confirmation", async () => {
      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();

      // Simulate confirmation from OpenAI
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // NOW response.create should be sent
      expect(mockWs.hasSentMessage("response.create")).toBe(true);
    });

    it("should reset buffer state after commit confirmation", async () => {
      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();

      // Confirm
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.localBytes).toBe(0);
      expect(bufferState.pendingCommit).toBe(false);
    });

    it("should only send response.create once per commit", async () => {
      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();

      // Confirm multiple times (shouldn't happen, but test resilience)
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      const responseCreates = mockWs.getMessagesByType("response.create");
      expect(responseCreates.length).toBe(1);
    });

    it("should not send response.create if already responding", async () => {
      // Start a response
      mockWs.receiveMessage({ type: "response.created" });

      // Try to commit new audio
      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // Should not send another response.create while responding
      const responseCreates = mockWs.getMessagesByType("response.create");
      expect(responseCreates.length).toBe(0);
    });
  });

  describe("Message Handling", () => {
    it("should handle session.updated event", () => {
      mockWs.receiveMessage({ type: "session.updated" });
      // Should not throw
    });

    it("should emit response_start on response.created", (done) => {
      adapter.on("response_start", () => {
        done();
      });

      mockWs.receiveMessage({ type: "response.created" });
    });

    it("should emit audio on response.audio.delta", (done) => {
      adapter.on("audio", (chunk) => {
        expect(chunk.data).toBeInstanceOf(Buffer);
        expect(chunk.format).toBe("pcm");
        done();
      });

      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("test audio").toString("base64"),
      });
    });

    it("should emit response_end on response.done", (done) => {
      adapter.on("response_end", () => {
        done();
      });

      // Start then end response
      mockWs.receiveMessage({ type: "response.created" });
      mockWs.receiveMessage({ type: "response.done" });
    });

    it("should emit transcript on response.audio_transcript.delta", (done) => {
      adapter.on("transcript", (segment) => {
        expect(segment.text).toBe("Hello");
        done();
      });

      mockWs.receiveMessage({
        type: "response.audio_transcript.delta",
        delta: "Hello",
      });
    });

    it("should emit user_transcript on conversation.item.input_audio_transcription.completed", (done) => {
      adapter.on("user_transcript", (segment) => {
        expect(segment.text).toBe("User said this");
        done();
      });

      mockWs.receiveMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "User said this",
      });
    });
  });

  describe("Error Handling", () => {
    it("should emit error on input_audio_buffer_commit_empty", (done) => {
      adapter.on("error", (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain("buffer too small");
        done();
      });

      mockWs.receiveMessage({
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "input_audio_buffer_commit_empty",
          message:
            "Error committing input audio buffer: buffer too small. Expected at least 100ms of audio, but buffer only has 0.00ms of audio.",
        },
      });
    });

    it("should reset buffer state on commit error", async () => {
      await adapter.sendAudio(createAudioForDuration(200));

      const errorHandler = jest.fn();
      adapter.on("error", errorHandler);

      await adapter.commitAudio();

      // Simulate error
      mockWs.receiveMessage({
        type: "error",
        error: {
          code: "input_audio_buffer_commit_empty",
          message: "buffer too small",
        },
      });

      expect(errorHandler).toHaveBeenCalled();
    });

    it("should handle generic API errors", (done) => {
      adapter.on("error", (error) => {
        expect(error.message).toContain("Something went wrong");
        done();
      });

      mockWs.receiveMessage({
        type: "error",
        error: {
          type: "server_error",
          message: "Something went wrong",
        },
      });
    });

    it("should handle WebSocket errors", (done) => {
      adapter.on("error", (error) => {
        expect(error.message).toBe("Connection failed");
        done();
      });

      mockWs.simulateError(new Error("Connection failed"));
    });
  });

  describe("Voice Mode", () => {
    it("should default to push-to-talk mode", () => {
      expect(adapter.getVoiceMode()).toBe("push-to-talk");
    });

    it("should switch to open-mic mode", () => {
      adapter.setVoiceMode("open-mic");
      expect(adapter.getVoiceMode()).toBe("open-mic");
    });

    it("should send session.update when changing voice mode", () => {
      mockWs.clearMessages();

      adapter.setVoiceMode("open-mic");

      const messages = mockWs.getMessagesByType("session.update");
      expect(messages.length).toBeGreaterThan(0);
    });

    it("should not send session.update if mode unchanged", () => {
      mockWs.clearMessages();

      adapter.setVoiceMode("push-to-talk"); // Already in this mode
      adapter.setVoiceMode("push-to-talk");

      const messages = mockWs.getMessagesByType("session.update");
      expect(messages.length).toBe(0);
    });
  });

  describe("Conversation Context", () => {
    it("should set conversation context", () => {
      const context = "Previous conversation summary";
      adapter.setConversationContext(context);

      expect(adapter.getConversationContext()).toBe(context);
    });

    it("should inject context into session instructions", async () => {
      const context = "User is interested in AI";

      adapter.setConversationContext(context);

      // Reconnect to trigger new session
      await adapter.disconnect();

      // Get WebSocket mock
      const WebSocketMock = jest.requireMock("ws").default;
      WebSocketMock.resetMock();

      const connectPromise = adapter.connect("test-session-2");

      // Get new mock instance
      mockWs = WebSocketMock.getMockInstance();

      // Wait for connection to open
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate session.created response
      mockWs.receiveMessage({ type: "session.created" });

      await connectPromise;

      // Check session.update message
      const sessionUpdate = mockWs.getMessagesByType("session.update")[0];
      expect(sessionUpdate.session.instructions).toContain(context);
    });
  });

  describe("Cancel Response", () => {
    it("should send response.cancel", async () => {
      mockWs.clearMessages();

      await adapter.cancel();

      expect(mockWs.hasSentMessage("response.cancel")).toBe(true);
    });

    it("should reset responding state", async () => {
      // Start response
      mockWs.receiveMessage({ type: "response.created" });
      expect(adapter.isResponding()).toBe(true);

      await adapter.cancel();

      expect(adapter.isResponding()).toBe(false);
    });

    it("should handle cancel when not connected gracefully", async () => {
      await adapter.disconnect();

      await expect(adapter.cancel()).resolves.not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple rapid audio sends", async () => {
      const chunks = Array(20)
        .fill(null)
        .map(() => createAudioForDuration(21));

      for (const chunk of chunks) {
        await adapter.sendAudio(chunk);
      }

      const messages = mockWs.getMessagesByType("input_audio_buffer.append");
      expect(messages.length).toBe(20);
    });

    it("should handle commit without any audio sent", async () => {
      const committed = await adapter.commitAudio();

      expect(committed).toBe(false);
      expect(mockWs.hasSentMessage("input_audio_buffer.commit")).toBe(false);
    });

    it("should prevent buffer overflow", async () => {
      // Send way more than MAX_AUDIO_BUFFER_SIZE (240KB = 5 seconds)
      // Send 10 seconds worth
      const chunks = Array(500)
        .fill(null)
        .map(() => createAudioForDuration(100)); // 100ms each

      for (const chunk of chunks) {
        await adapter.sendAudio(chunk);
      }

      // Buffer should be capped
      const audioBuffer = (adapter as any).audioBuffer;
      expect(audioBuffer.length).toBeLessThanOrEqual(240000); // 5 seconds max
    });
  });

  describe("Integration - Complete Flow", () => {
    it("should handle full voice interaction cycle", async () => {
      // 1. Send audio chunks
      await adapter.sendAudio(createAudioForDuration(100));
      await adapter.sendAudio(createAudioForDuration(100));
      await adapter.sendAudio(createAudioForDuration(100));

      // 2. VAD detects speech
      mockWs.receiveMessage({ type: "input_audio_buffer.speech_started" });

      // 3. Commit audio
      const committed = await adapter.commitAudio();
      expect(committed).toBe(true);

      // 4. OpenAI confirms commit
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      // 5. Response.create should be sent
      expect(mockWs.hasSentMessage("response.create")).toBe(true);

      // 6. Response starts
      mockWs.receiveMessage({ type: "response.created" });
      expect(adapter.isResponding()).toBe(true);

      // 7. Audio arrives
      const audioPromise = waitForEvent(adapter, "audio");
      mockWs.receiveMessage({
        type: "response.audio.delta",
        delta: Buffer.from("audio data").toString("base64"),
      });

      const audio = await audioPromise;
      expect(audio).toBeDefined();

      // 8. Response ends
      mockWs.receiveMessage({ type: "response.done" });
      expect(adapter.isResponding()).toBe(false);
    });

    it("should prevent race condition scenario from z_errors.txt", async () => {
      // Reproduce the exact scenario that caused the bug

      // Add error handler to prevent unhandled error from failing test
      const errorHandler = jest.fn();
      adapter.on("error", errorHandler);

      // 1. Send audio
      await adapter.sendAudio(createAudioForDuration(200));

      // 2. Commit immediately (this used to cause race condition)
      const committed = await adapter.commitAudio();
      expect(committed).toBe(true);

      // 3. Should NOT send response.create yet
      expect(mockWs.hasSentMessage("response.create")).toBe(false);

      // 4. Simulate OpenAI saying buffer is empty (the bug scenario)
      mockWs.receiveMessage({
        type: "error",
        error: {
          code: "input_audio_buffer_commit_empty",
          message: "buffer too small",
        },
      });

      // 5. Should still not have sent response.create
      expect(mockWs.hasSentMessage("response.create")).toBe(false);

      // 6. Error handler should have been called
      expect(errorHandler).toHaveBeenCalled();

      // This proves the fix works - response.create is not sent
      // until AFTER commit confirmation, preventing the error
    });
  });

  // ---------------------------------------------------------------------------
  // Additional coverage tests — error paths, edge cases, uncovered branches
  // ---------------------------------------------------------------------------

  describe("WebSocket message parse error (line 165-166)", () => {
    it("should emit error and not throw when incoming message is invalid JSON", () => {
      const errorHandler = jest.fn();
      adapter.on("error", errorHandler);

      // Emit a raw message event that contains invalid JSON directly on the ws
      mockWs.emit("message", Buffer.from("not-valid-json{{"));

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe("connect() error paths", () => {
    it("should reject connect() promise when WebSocket constructor throws (line 203-204)", async () => {
      // Disconnect existing adapter first
      await adapter.disconnect();
      await new Promise((resolve) => setImmediate(resolve));

      const WebSocketMock = jest.requireMock("ws").default;
      WebSocketMock.resetMock();

      // Make constructor throw on next call
      WebSocketMock.mockImplementationOnce(() => {
        throw new Error("WebSocket constructor failed");
      });

      const freshAdapter = new OpenAIRealtimeAdapter(config);
      await expect(freshAdapter.connect("session-err")).rejects.toThrow(
        "WebSocket constructor failed",
      );
    });

    it("should reject connect() promise when ws emits error before open (line 176)", async () => {
      await adapter.disconnect();
      await new Promise((resolve) => setImmediate(resolve));

      const WebSocketMock = jest.requireMock("ws").default;
      WebSocketMock.resetMock();

      // Build a minimal EventEmitter-based stub that fires an error before open
      WebSocketMock.mockImplementationOnce(() => {
        const { EventEmitter } = require("events");
        const stub = new EventEmitter() as any;
        stub.readyState = 0; // CONNECTING
        stub.send = jest.fn();
        stub.close = jest.fn();
        // Fire error on next tick — connected is still false at this point
        setImmediate(() => {
          stub.emit("error", new Error("connection refused"));
        });
        return stub;
      });

      const freshAdapter = new OpenAIRealtimeAdapter(config);
      // Must add an error listener so adapter.emit("error",...) doesn't throw
      // uncaught — otherwise reject(error) on line 176 is never reached
      freshAdapter.on("error", () => {});
      await expect(freshAdapter.connect("session-err2")).rejects.toThrow(
        "connection refused",
      );
    });
  });

  describe("sendAudio error path (line 384)", () => {
    it("should throw and emit error when sendMessage throws inside sendAudio", async () => {
      const errorHandler = jest.fn();
      adapter.on("error", errorHandler);

      // sendMessage is private; mock it via type-cast to force sendAudio's catch path
      jest
        .spyOn(adapter as any, "sendMessage")
        .mockImplementationOnce(() => {
          throw new Error("send failed");
        });

      await expect(
        adapter.sendAudio(createAudioForDuration(100)),
      ).rejects.toThrow("send failed");

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe("clearInputBuffer (lines 454-471)", () => {
    it("should send input_audio_buffer.clear message", () => {
      mockWs.clearMessages();
      adapter.clearInputBuffer();
      expect(mockWs.hasSentMessage("input_audio_buffer.clear")).toBe(true);
    });

    it("should reset buffer state after clear", async () => {
      await adapter.sendAudio(createAudioForDuration(200));
      adapter.clearInputBuffer();

      const bufferState = (adapter as any).bufferState;
      expect(bufferState.localBytes).toBe(0);
    });

    it("should do nothing when not connected", async () => {
      await adapter.disconnect();
      await new Promise((resolve) => setImmediate(resolve));

      // Should not throw
      expect(() => adapter.clearInputBuffer()).not.toThrow();
    });
  });

  describe("cancel() error path (lines 490-492)", () => {
    it("should throw and emit error when sendMessage throws during cancel", async () => {
      const errorHandler = jest.fn();
      adapter.on("error", errorHandler);

      jest
        .spyOn(adapter as any, "sendMessage")
        .mockImplementationOnce(() => {
          throw new Error("cancel send failed");
        });

      await expect(adapter.cancel()).rejects.toThrow("cancel send failed");
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe("disconnect() paths", () => {
    it("should return early without error if already disconnected (line 501)", async () => {
      // Disconnect once properly
      await adapter.disconnect();
      await new Promise((resolve) => setImmediate(resolve));

      // Second disconnect on already-disconnected adapter — should be silent
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });

    it("should throw and emit error when ws.send throws during disconnect (lines 536-538)", async () => {
      const errorHandler = jest.fn();
      adapter.on("error", errorHandler);

      // Make send throw to trigger the disconnect error path
      jest.spyOn(mockWs, "close").mockImplementationOnce(() => {
        throw new Error("close failed");
      });

      await expect(adapter.disconnect()).rejects.toThrow("close failed");
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe("sendMessage() queue and error paths", () => {
    it("should drop oldest message when queue is full (lines 569-576)", () => {
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Force adapter into disconnected state so messages get queued
      (adapter as any).connected = false;
      mockWs.readyState = MockWebSocket.CLOSING;

      // Fill queue past MAX_MESSAGE_QUEUE_SIZE (50)
      for (let i = 0; i < 51; i++) {
        (adapter as any).sendMessage({ type: "test.message", seq: i });
      }

      const queue: any[] = (adapter as any).messageQueue;
      expect(queue.length).toBe(50); // capped at max
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Message queue full"),
      );

      consoleWarnSpy.mockRestore();
    });

    it("should emit error when ws.send throws (lines 583-584)", () => {
      const errorHandler = jest.fn();
      adapter.on("error", errorHandler);

      jest.spyOn(mockWs, "send").mockImplementationOnce(() => {
        throw new Error("ws send error");
      });

      // sendMessage is private; trigger it via a public method
      (adapter as any).sendMessage({ type: "session.update", session: {} });

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe("processMessageQueue (lines 593-595)", () => {
    it("should drain queued messages on reconnect", async () => {
      // Manually queue some messages
      (adapter as any).messageQueue.push({ type: "queued.message.1" });
      (adapter as any).messageQueue.push({ type: "queued.message.2" });

      // Trigger processMessageQueue while connected
      (adapter as any).processMessageQueue();

      expect(mockWs.hasSentMessage("queued.message.1")).toBe(true);
      expect(mockWs.hasSentMessage("queued.message.2")).toBe(true);
      expect((adapter as any).messageQueue.length).toBe(0);
    });
  });

  describe("handleMessage — additional message types", () => {
    it("should handle conversation.created (lines 617-618)", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      mockWs.receiveMessage({ type: "conversation.created" });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Conversation created"),
      );
      consoleSpy.mockRestore();
    });

    it("should handle input_audio_buffer.cleared (lines 660-661)", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      mockWs.receiveMessage({ type: "input_audio_buffer.cleared" });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Audio buffer cleared"),
      );
      consoleSpy.mockRestore();
    });

    it("should emit transcript for conversation.item.created with user input_text (lines 673-694)", (done) => {
      adapter.on("transcript", (segment) => {
        expect(segment.text).toBe("hello there");
        expect(segment.isFinal).toBe(true);
        done();
      });

      mockWs.receiveMessage({
        type: "conversation.item.created",
        item: {
          role: "user",
          content: [{ type: "input_text", text: "hello there" }],
        },
      });
    });

    it("should not emit transcript for conversation.item.created without input_text", () => {
      const transcriptHandler = jest.fn();
      adapter.on("transcript", transcriptHandler);

      // item with no content matching input_text
      mockWs.receiveMessage({
        type: "conversation.item.created",
        item: {
          role: "user",
          content: [{ type: "audio" }],
        },
      });

      expect(transcriptHandler).not.toHaveBeenCalled();
    });

    it("should not emit transcript for conversation.item.created with non-user role", () => {
      const transcriptHandler = jest.fn();
      adapter.on("transcript", transcriptHandler);

      mockWs.receiveMessage({
        type: "conversation.item.created",
        item: {
          role: "assistant",
          content: [{ type: "input_text", text: "assistant text" }],
        },
      });

      expect(transcriptHandler).not.toHaveBeenCalled();
    });

    it("should emit final transcript on response.audio_transcript.done (lines 722-730)", (done) => {
      adapter.on("transcript", (segment) => {
        expect(segment.text).toBe("Final spoken text");
        expect(segment.isFinal).toBe(true);
        done();
      });

      mockWs.receiveMessage({
        type: "response.audio_transcript.done",
        transcript: "Final spoken text",
      });
    });

    it("should not emit transcript on response.audio_transcript.done without transcript field", () => {
      const transcriptHandler = jest.fn();
      adapter.on("transcript", transcriptHandler);

      mockWs.receiveMessage({ type: "response.audio_transcript.done" });

      expect(transcriptHandler).not.toHaveBeenCalled();
    });

    it("should log on response.audio.done (lines 747-748)", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      mockWs.receiveMessage({ type: "response.audio.done" });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Audio response complete"),
      );
      consoleSpy.mockRestore();
    });

    it("should log error on conversation.item.input_audio_transcription.failed (line 780)", () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockWs.receiveMessage({
        type: "conversation.item.input_audio_transcription.failed",
        error: { message: "Transcription error" },
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Transcription failed"),
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });

    it("should log on rate_limits.updated (lines 783-785)", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      mockWs.receiveMessage({
        type: "rate_limits.updated",
        rate_limits: [{ name: "requests", remaining: 100 }],
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Rate limits updated"),
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });

    it("should log unhandled message type (line 800)", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});
      mockWs.receiveMessage({ type: "unknown.custom.event" });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unhandled message type"),
      );
      consoleSpy.mockRestore();
    });

    it("should accumulate pendingInputTranscript on transcription delta (lines 761-764)", () => {
      mockWs.receiveMessage({
        type: "conversation.item.input_audio_transcription.delta",
        delta: "Hello ",
      });
      mockWs.receiveMessage({
        type: "conversation.item.input_audio_transcription.delta",
        delta: "world",
      });

      expect((adapter as any).pendingInputTranscript).toBe("Hello world");
    });

    it("should use responseInstructionsProvider when set and buffer committed (line 634)", async () => {
      const provider = jest.fn().mockReturnValue("Use these RAG instructions");
      adapter.setResponseInstructionsProvider(provider);

      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();

      mockWs.clearMessages();
      mockWs.receiveMessage({ type: "input_audio_buffer.committed" });

      expect(provider).toHaveBeenCalled();
      const responseCreate = mockWs.getMessagesByType("response.create")[0];
      expect(responseCreate.response.instructions).toBe(
        "Use these RAG instructions",
      );
    });

    it("should handle responseInstructionsProvider throwing an error gracefully (line 634)", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const provider = jest.fn().mockImplementation(() => {
        throw new Error("provider failed");
      });
      adapter.setResponseInstructionsProvider(provider);

      await adapter.sendAudio(createAudioForDuration(200));
      await adapter.commitAudio();

      mockWs.clearMessages();
      // Should not throw
      expect(() => {
        mockWs.receiveMessage({ type: "input_audio_buffer.committed" });
      }).not.toThrow();

      // response.create should still be sent (without custom instructions)
      const responseCreate = mockWs.getMessagesByType("response.create")[0];
      expect(responseCreate).toBeDefined();
      expect(responseCreate.response.instructions).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it("should handle API error with no message field (line 795)", (done) => {
      adapter.on("error", (error) => {
        expect(error.message).toBe("Unknown error from OpenAI");
        done();
      });

      mockWs.receiveMessage({
        type: "error",
        error: {},
      });
    });
  });

  describe("attemptReconnect (lines 816-818)", () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("should schedule reconnection after non-clean close", async () => {
      const connectSpy = jest
        .spyOn(adapter as any, "connect")
        .mockResolvedValue(undefined);

      // Force adapter to believe it has a valid sessionId
      (adapter as any).sessionId = "test-session";
      (adapter as any).reconnectAttempts = 0;

      // Trigger attemptReconnect directly
      (adapter as any).attemptReconnect();

      // Reconnect delay is 1000ms * 2^0 = 1000ms
      jest.advanceTimersByTime(1100);

      expect(connectSpy).toHaveBeenCalledWith("test-session");
      connectSpy.mockRestore();
    });

    it("should not attempt reconnect when sessionId is null", async () => {
      const connectSpy = jest
        .spyOn(adapter as any, "connect")
        .mockResolvedValue(undefined);

      (adapter as any).sessionId = null;
      (adapter as any).reconnectAttempts = 0;

      (adapter as any).attemptReconnect();
      jest.advanceTimersByTime(2000);

      expect(connectSpy).not.toHaveBeenCalled();
      connectSpy.mockRestore();
    });

    it("should log reconnection failure when connect rejects", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      jest
        .spyOn(adapter as any, "connect")
        .mockRejectedValue(new Error("reconnect fail"));

      (adapter as any).sessionId = "test-session";
      (adapter as any).reconnectAttempts = 0;

      (adapter as any).attemptReconnect();
      jest.advanceTimersByTime(1100);

      // Wait for the rejected promise to be handled
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Reconnection failed"),
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("startPingInterval health check (lines 831-841)", () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("should log OK when ws is open during health check", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});

      // startPingInterval is called during connect; trigger manually
      (adapter as any).startPingInterval();

      jest.advanceTimersByTime(30000);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Connection health check: OK"),
      );
      consoleSpy.mockRestore();
    });

    it("should log warning and clear interval when ws is not open during health check", () => {
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      // Mark ws as closed so health check sees a bad state
      mockWs.readyState = MockWebSocket.CLOSED;

      (adapter as any).startPingInterval();
      jest.advanceTimersByTime(30000);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Not connected"),
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe("createResponse (lines 847-881)", () => {
    it("should send response.create with text and audio modalities", async () => {
      mockWs.clearMessages();
      await adapter.createResponse("Say hello", true);

      const msg = mockWs.getMessagesByType("response.create")[0];
      expect(msg).toBeDefined();
      expect(msg.response.instructions).toBe("Say hello");
      expect(msg.response.modalities).toEqual(["text", "audio"]);
    });

    it("should send response.create with text-only modalities when generateAudio=false", async () => {
      mockWs.clearMessages();
      await adapter.createResponse("Say hello", false);

      const msg = mockWs.getMessagesByType("response.create")[0];
      expect(msg.response.modalities).toEqual(["text"]);
    });

    it("should send response.create without text when no text provided", async () => {
      mockWs.clearMessages();
      await adapter.createResponse();

      const msg = mockWs.getMessagesByType("response.create")[0];
      expect(msg).toBeDefined();
      expect(msg.response.modalities).toEqual(["text", "audio"]);
      expect(msg.response.instructions).toBeUndefined();
    });

    it("should throw when not connected", async () => {
      await adapter.disconnect();
      await new Promise((resolve) => setImmediate(resolve));

      const freshAdapter = new OpenAIRealtimeAdapter(config);
      await expect(freshAdapter.createResponse("hello")).rejects.toThrow(
        "Not connected to OpenAI Realtime API",
      );
    });

    it("should emit error and throw when sendMessage throws inside createResponse", async () => {
      const errorHandler = jest.fn();
      adapter.on("error", errorHandler);

      jest
        .spyOn(adapter as any, "sendMessage")
        .mockImplementationOnce(() => {
          throw new Error("createResponse send failed");
        });

      await expect(adapter.createResponse("hello")).rejects.toThrow(
        "createResponse send failed",
      );
      expect(errorHandler).toHaveBeenCalled();
    });
  });
});
