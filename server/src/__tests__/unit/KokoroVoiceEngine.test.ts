/**
 * KokoroVoiceEngine Unit Tests
 *
 * Tests the Kokoro TTS engine that synthesizes speech via a local
 * HTTP server. Global fetch is fully mocked so no real HTTP calls
 * are made.
 */

import { KokoroVoiceEngine } from "../../services/KokoroVoiceEngine.js";

// ── Mock setup ────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ── Helpers ───────────────────────────────────────────────────────────

function mockOkResponse(data: ArrayBuffer): Partial<Response> {
  return {
    ok: true,
    status: 200,
    arrayBuffer: jest.fn().mockResolvedValue(data),
  };
}

function mockErrorResponse(status: number): Partial<Response> {
  return {
    ok: false,
    status,
    arrayBuffer: jest.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("KokoroVoiceEngine", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Suppress console output during tests
    jest.spyOn(console, "log").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Constructor / Config ──────────────────────────────────────────

  describe("constructor", () => {
    it("uses default config values", async () => {
      mockFetch.mockResolvedValue(mockOkResponse(new ArrayBuffer(100)));

      const engine = new KokoroVoiceEngine();
      await engine.synthesize("Hello");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8880/v1/audio/speech",
        expect.objectContaining({
          method: "POST",
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.voice).toBe("af_bella");
    });

    it("accepts partial config overrides", async () => {
      mockFetch.mockResolvedValue(mockOkResponse(new ArrayBuffer(100)));

      const engine = new KokoroVoiceEngine({
        baseUrl: "http://custom:9999",
        defaultVoice: "bf_emma",
      });
      await engine.synthesize("Test");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://custom:9999/v1/audio/speech",
        expect.anything(),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.voice).toBe("bf_emma");
    });
  });

  // ── synthesize ────────────────────────────────────────────────────

  describe("synthesize()", () => {
    it("calls POST /v1/audio/speech with correct body", async () => {
      mockFetch.mockResolvedValue(mockOkResponse(new ArrayBuffer(200)));

      const engine = new KokoroVoiceEngine();
      await engine.synthesize("Hello world");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:8880/v1/audio/speech");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(opts.body);
      expect(body).toEqual({
        model: "kokoro",
        voice: "af_bella",
        input: "Hello world",
        response_format: "wav",
        speed: 1.0,
      });
    });

    it("returns Buffer of audio data", async () => {
      const audioData = new ArrayBuffer(4800);
      mockFetch.mockResolvedValue(mockOkResponse(audioData));

      const engine = new KokoroVoiceEngine();
      const result = await engine.synthesize("Test");

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(4800);
    });

    it("uses defaultVoice when no voiceId in options", async () => {
      mockFetch.mockResolvedValue(mockOkResponse(new ArrayBuffer(100)));

      const engine = new KokoroVoiceEngine({ defaultVoice: "af_sarah" });
      await engine.synthesize("Test", {});

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.voice).toBe("af_sarah");
    });

    it("uses options.voiceId when provided", async () => {
      mockFetch.mockResolvedValue(mockOkResponse(new ArrayBuffer(100)));

      const engine = new KokoroVoiceEngine({ defaultVoice: "af_bella" });
      await engine.synthesize("Test", { voiceId: "bm_george" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.voice).toBe("bm_george");
    });

    it("includes speed in request body when provided", async () => {
      mockFetch.mockResolvedValue(mockOkResponse(new ArrayBuffer(100)));

      const engine = new KokoroVoiceEngine();
      await engine.synthesize("Fast", { speed: 1.5 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.speed).toBe(1.5);
    });

    it("throws on non-200 response", async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500));

      const engine = new KokoroVoiceEngine();

      await expect(engine.synthesize("Fail")).rejects.toThrow(
        "Kokoro TTS failed: HTTP 500",
      );
    });

    it("throws timeout error when AbortController fires", async () => {
      // Mock fetch to return a promise that never resolves, then abort
      mockFetch.mockImplementation(
        (_url: string, opts: { signal: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener("abort", () => {
              const err = new DOMException("The operation was aborted.", "AbortError");
              reject(err);
            });
          });
        },
      );

      const engine = new KokoroVoiceEngine({ timeoutMs: 50 });

      await expect(engine.synthesize("Slow")).rejects.toThrow("Kokoro TTS timeout");
    });

    it("still calls API with empty text (no local guard)", async () => {
      mockFetch.mockResolvedValue(mockOkResponse(new ArrayBuffer(0)));

      const engine = new KokoroVoiceEngine();
      const result = await engine.synthesize("");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toBe("");
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  // ── isAvailable ───────────────────────────────────────────────────

  describe("isAvailable()", () => {
    it("returns true when GET /health returns 200", async () => {
      mockFetch.mockResolvedValue({ status: 200 });

      const engine = new KokoroVoiceEngine();
      const result = await engine.isAvailable();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("http://localhost:8880/health");
    });

    it("returns false when GET /health returns 503", async () => {
      mockFetch.mockResolvedValue({ status: 503 });

      const engine = new KokoroVoiceEngine();
      const result = await engine.isAvailable();

      expect(result).toBe(false);
    });

    it("returns false when fetch throws (connection refused)", async () => {
      mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));

      const engine = new KokoroVoiceEngine();
      const result = await engine.isAvailable();

      expect(result).toBe(false);
    });
  });
});
