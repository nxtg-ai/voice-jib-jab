/**
 * VoiceQualityScorer Tests
 *
 * Covers: scoring dimensions, grade boundaries, threshold detection,
 * webhook behaviour, and the quality API router.
 */

import { VoiceQualityScorer } from "../../services/VoiceQualityScorer.js";
import type { QualityScorecard } from "../../services/VoiceQualityScorer.js";
import type { SessionRecording } from "../../services/SessionRecorder.js";
import { createQualityRouter } from "../../api/quality.js";
import express, { type Express } from "express";
import { createServer, type Server } from "http";
import type { IncomingMessage } from "http";

// ---------------------------------------------------------------------------
// Helpers — recording factory
// ---------------------------------------------------------------------------

function makeRecording(overrides: Partial<SessionRecording> = {}): SessionRecording {
  const base: SessionRecording = {
    sessionId: "sess-test",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 1000,
    tenantId: null,
    timeline: [],
    summary: {
      turnCount: 5,
      policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
      audioInputChunks: 0,
      audioOutputChunks: 0,
      sentiment: {
        dominantSentiment: "positive",
        averageScore: 0.8,
        escalationTriggered: false,
        readingCount: 5,
      },
    },
  };
  // Deep-merge summary if provided
  if (overrides.summary) {
    return { ...base, ...overrides, summary: { ...base.summary, ...overrides.summary } };
  }
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Helpers — HTTP client (no supertest dependency)
// ---------------------------------------------------------------------------

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
      port: (addr as { port: number }).port,
      path,
      method,
      headers: payload
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        : {},
    };

    const http = require("http") as typeof import("http");
    const req = http.request(options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const bodyStr = Buffer.concat(chunks).toString("utf-8");
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: bodyStr,
          json: () => JSON.parse(bodyStr),
        });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function get(server: Server, path: string): Promise<HttpResponse> {
  return httpRequest(server, "GET", path);
}

function put(server: Server, path: string, body: unknown): Promise<HttpResponse> {
  return httpRequest(server, "PUT", path, body);
}

// ---------------------------------------------------------------------------
// VoiceQualityScorer — score()
// ---------------------------------------------------------------------------

describe("VoiceQualityScorer.score()", () => {
  let scorer: VoiceQualityScorer;

  beforeEach(() => {
    scorer = new VoiceQualityScorer({ qualityThreshold: 70 });
  });

  // ── Overall score ─────────────────────────────────────────────────

  it("returns totalScore 100 for an all-perfect session", () => {
    // policyCompliance=20 (all allow), sentimentTrajectory=20 (positive),
    // resolutionRate=20 (0 escalations), responseRelevance=20 (5 turns),
    // latencyAdherence=20 (1000ms / 5 turns = 200ms avg < 400ms)
    const recording = makeRecording({ durationMs: 1000 });
    const result = scorer.score("sess-1", recording);
    expect(result.totalScore).toBe(100);
  });

  it("returns worst-case totalScore of 4 for a near-all-zero session", () => {
    // policyCompliance=0 (all refuse/escalate/cancel), sentimentTrajectory=0 (frustrated),
    // resolutionRate=0 (3+ escalations), responseRelevance=0 (0 turns),
    // latencyAdherence=4 (5000ms / 1 effective turn = 5000ms → >=1200ms)
    const recording = makeRecording({
      durationMs: 5000,
      summary: {
        turnCount: 0,
        policyDecisions: { allow: 0, refuse: 5, escalate: 3, rewrite: 0, cancel_output: 2 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
        sentiment: {
          dominantSentiment: "frustrated",
          averageScore: 0,
          escalationTriggered: true,
          readingCount: 1,
        },
      },
    });
    const result = scorer.score("sess-zero", recording);
    expect(result.totalScore).toBe(4);
  });

  it("includes sessionId in result", () => {
    const result = scorer.score("my-session-id", makeRecording());
    expect(result.sessionId).toBe("my-session-id");
  });

  it("includes computedAt as ISO string", () => {
    const result = scorer.score("sess-1", makeRecording());
    expect(typeof result.computedAt).toBe("string");
    expect(new Date(result.computedAt).toISOString()).toBe(result.computedAt);
  });

  // ── policyCompliance ─────────────────────────────────────────────

  it("policyCompliance: 0 decisions → score 20", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
      },
    });
    const result = scorer.score("s", recording);
    expect(result.dimensions.policyCompliance.score).toBe(20);
    expect(result.dimensions.policyCompliance.rationale).toBe("0/0 decisions compliant");
  });

  it("policyCompliance: all allow → score 20", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 8, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
      },
    });
    expect(scorer.score("s", recording).dimensions.policyCompliance.score).toBe(20);
  });

  it("policyCompliance: all rewrite → score 20", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 4, cancel_output: 0 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
      },
    });
    expect(scorer.score("s", recording).dimensions.policyCompliance.score).toBe(20);
  });

  it("policyCompliance: 5 allow / 5 refuse → score 10 and correct rationale", () => {
    // compliant=5, total=10 → 50% → score=10
    const recording = makeRecording({
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 5, refuse: 5, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
      },
    });
    const result = scorer.score("s", recording);
    expect(result.dimensions.policyCompliance.score).toBe(10);
    expect(result.dimensions.policyCompliance.rationale).toBe("5/10 decisions compliant");
  });

  it("policyCompliance: all refuse → score 0", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 0, refuse: 10, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0,
        audioOutputChunks: 0,
      },
    });
    expect(scorer.score("s", recording).dimensions.policyCompliance.score).toBe(0);
  });

  // ── sentimentTrajectory ──────────────────────────────────────────

  it("sentimentTrajectory: positive → 20", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "positive", averageScore: 0.9, escalationTriggered: false, readingCount: 3 },
      },
    });
    expect(scorer.score("s", recording).dimensions.sentimentTrajectory.score).toBe(20);
  });

  it("sentimentTrajectory: neutral → 15", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "neutral", averageScore: 0.5, escalationTriggered: false, readingCount: 3 },
      },
    });
    expect(scorer.score("s", recording).dimensions.sentimentTrajectory.score).toBe(15);
  });

  it("sentimentTrajectory: negative → 8", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "negative", averageScore: 0.2, escalationTriggered: false, readingCount: 3 },
      },
    });
    expect(scorer.score("s", recording).dimensions.sentimentTrajectory.score).toBe(8);
  });

  it("sentimentTrajectory: frustrated → 0", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "frustrated", averageScore: 0, escalationTriggered: true, readingCount: 2 },
      },
    });
    expect(scorer.score("s", recording).dimensions.sentimentTrajectory.score).toBe(0);
  });

  it("sentimentTrajectory: undefined sentiment → 10, rationale shows unknown", () => {
    const recording = makeRecording();
    // Explicitly remove the sentiment field to test the undefined branch
    delete recording.summary.sentiment;
    const dim = scorer.score("s", recording).dimensions.sentimentTrajectory;
    expect(dim.score).toBe(10);
    expect(dim.rationale).toBe("Dominant sentiment: unknown");
  });

  // ── resolutionRate ───────────────────────────────────────────────

  it("resolutionRate: 0 escalations → 20 with correct rationale", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5, policyDecisions: { allow: 5, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
      },
    });
    const dim = scorer.score("s", recording).dimensions.resolutionRate;
    expect(dim.score).toBe(20);
    expect(dim.rationale).toBe("0 escalation(s) detected");
  });

  it("resolutionRate: 1 escalation → 12", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5, policyDecisions: { allow: 5, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
      },
    });
    expect(scorer.score("s", recording).dimensions.resolutionRate.score).toBe(12);
  });

  it("resolutionRate: 2 escalations → 6", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5, policyDecisions: { allow: 3, refuse: 0, escalate: 2, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
      },
    });
    expect(scorer.score("s", recording).dimensions.resolutionRate.score).toBe(6);
  });

  it("resolutionRate: 3+ escalations → 0", () => {
    const recording = makeRecording({
      summary: {
        turnCount: 5, policyDecisions: { allow: 1, refuse: 0, escalate: 4, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
      },
    });
    expect(scorer.score("s", recording).dimensions.resolutionRate.score).toBe(0);
  });

  // ── responseRelevance ────────────────────────────────────────────

  it("responseRelevance: 5+ turns → 20", () => {
    const recording = makeRecording({ summary: { turnCount: 5, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
    expect(scorer.score("s", recording).dimensions.responseRelevance.score).toBe(20);
  });

  it("responseRelevance: 7 turns → 20", () => {
    const recording = makeRecording({ summary: { turnCount: 7, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
    expect(scorer.score("s", recording).dimensions.responseRelevance.score).toBe(20);
  });

  it("responseRelevance: 4 turns → 15", () => {
    const recording = makeRecording({ summary: { turnCount: 4, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
    expect(scorer.score("s", recording).dimensions.responseRelevance.score).toBe(15);
  });

  it("responseRelevance: 3 turns → 15", () => {
    const recording = makeRecording({ summary: { turnCount: 3, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
    expect(scorer.score("s", recording).dimensions.responseRelevance.score).toBe(15);
  });

  it("responseRelevance: 2 turns → 10", () => {
    const recording = makeRecording({ summary: { turnCount: 2, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
    expect(scorer.score("s", recording).dimensions.responseRelevance.score).toBe(10);
  });

  it("responseRelevance: 1 turn → 5 with correct rationale", () => {
    const recording = makeRecording({ summary: { turnCount: 1, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
    const dim = scorer.score("s", recording).dimensions.responseRelevance;
    expect(dim.score).toBe(5);
    expect(dim.rationale).toBe("1 conversation turns");
  });

  it("responseRelevance: 0 turns → 0", () => {
    const recording = makeRecording({ summary: { turnCount: 0, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
    expect(scorer.score("s", recording).dimensions.responseRelevance.score).toBe(0);
  });

  // ── latencyAdherence ─────────────────────────────────────────────

  it("latencyAdherence: avg < 400ms → 20", () => {
    // 5 turns, 1500ms total → 300ms avg
    const recording = makeRecording({
      durationMs: 1500,
      summary: { turnCount: 5, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 },
    });
    expect(scorer.score("s", recording).dimensions.latencyAdherence.score).toBe(20);
  });

  it("latencyAdherence: avg < 600ms → 16", () => {
    // 1 turn, 500ms → 500ms avg
    const recording = makeRecording({
      durationMs: 500,
      summary: { turnCount: 1, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 },
    });
    expect(scorer.score("s", recording).dimensions.latencyAdherence.score).toBe(16);
  });

  it("latencyAdherence: avg < 800ms → 12", () => {
    // 1 turn, 700ms → 700ms avg
    const recording = makeRecording({
      durationMs: 700,
      summary: { turnCount: 1, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 },
    });
    expect(scorer.score("s", recording).dimensions.latencyAdherence.score).toBe(12);
  });

  it("latencyAdherence: avg < 1200ms → 8", () => {
    // 1 turn, 1000ms → 1000ms avg
    const recording = makeRecording({
      durationMs: 1000,
      summary: { turnCount: 1, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 },
    });
    expect(scorer.score("s", recording).dimensions.latencyAdherence.score).toBe(8);
  });

  it("latencyAdherence: avg >= 1200ms → 4", () => {
    // 1 turn, 2000ms → 2000ms avg
    const recording = makeRecording({
      durationMs: 2000,
      summary: { turnCount: 1, policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 },
    });
    expect(scorer.score("s", recording).dimensions.latencyAdherence.score).toBe(4);
  });

  // ── Grade boundaries ─────────────────────────────────────────────

  it("grade: totalScore 100 → A", () => {
    // policyCompliance=20, sentiment=20 (positive), resolution=20 (0 escal),
    // relevance=20 (5 turns), latency=20 (200ms avg) = 100
    const recording = makeRecording({ durationMs: 1000 });
    expect(scorer.score("s", recording).grade).toBe("A");
  });

  it("grade: totalScore 80-89 → B", () => {
    // compliance=20 (all allow), neutral=15, 0 escal=20, 5turns=20, 700ms avg=12: 20+15+20+20+12=87 → B
    // 5 turns, 3500ms total → 700ms avg → <800ms → 12pts
    const recording = makeRecording({
      durationMs: 3500,
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 10, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "neutral", averageScore: 0.5, escalationTriggered: false, readingCount: 3 },
      },
    });
    const result = scorer.score("s", recording);
    expect(result.totalScore).toBe(87);
    expect(result.grade).toBe("B");
  });

  it("grade: totalScore 70-79 → C", () => {
    // allow=8, refuse=2, escalate=2, total=12 → compliant=8 → round(8/12*20)=13
    // neutral(15) + 2 escal(6) + 5 turns(20) + 200ms latency(20): 13+15+6+20+20=74 → C
    const recording = makeRecording({
      durationMs: 1000,
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 8, refuse: 2, escalate: 2, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "neutral", averageScore: 0.5, escalationTriggered: false, readingCount: 3 },
      },
    });
    const result = scorer.score("s", recording);
    expect(result.totalScore).toBe(74);
    expect(result.grade).toBe("C");
  });

  it("grade: totalScore 60-69 → D", () => {
    // allow=3, refuse=9, escalate=1, total=13 → compliant=3 → round(3/13*20)=round(4.6)=5
    // negative(8) + 1 escal(12): 5+8+12+20+20=65 → D
    const recording = makeRecording({
      durationMs: 1000,
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 3, refuse: 9, escalate: 1, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "negative", averageScore: 0.2, escalationTriggered: false, readingCount: 3 },
      },
    });
    const result = scorer.score("s", recording);
    expect(result.totalScore).toBe(65);
    expect(result.grade).toBe("D");
  });

  it("grade: totalScore < 60 → F", () => {
    // frustrated(0) + 3 escal(0) + all refuse/cancel(0 compliance) + 0 turns(0) + 5000ms avg(4) = 4
    const recording = makeRecording({
      durationMs: 5000,
      summary: {
        turnCount: 0,
        policyDecisions: { allow: 0, refuse: 5, escalate: 3, rewrite: 0, cancel_output: 2 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "frustrated", averageScore: 0, escalationTriggered: true, readingCount: 1 },
      },
    });
    expect(scorer.score("s", recording).grade).toBe("F");
  });

  // ── thresholdBreached ────────────────────────────────────────────

  it("thresholdBreached: true when totalScore < qualityThreshold", () => {
    const strictScorer = new VoiceQualityScorer({ qualityThreshold: 90 });
    // Score ~71 (neutral+2escal+50% compliance)
    const recording = makeRecording({
      durationMs: 1000,
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 5, refuse: 5, escalate: 2, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "neutral", averageScore: 0.5, escalationTriggered: false, readingCount: 3 },
      },
    });
    expect(strictScorer.score("s", recording).thresholdBreached).toBe(true);
  });

  it("thresholdBreached: false when totalScore >= qualityThreshold", () => {
    const recording = makeRecording({ durationMs: 1000 }); // scores 100
    expect(scorer.score("s", recording).thresholdBreached).toBe(false);
  });

  it("thresholdBreached: false when totalScore equals qualityThreshold", () => {
    // Score exactly 74 (allow=8,refuse=2,escalate=2,neutral,5turns,200ms),
    // set threshold to 74 → not breached (74 >= 74)
    const boundaryScorer = new VoiceQualityScorer({ qualityThreshold: 74 });
    const recording = makeRecording({
      durationMs: 1000,
      summary: {
        turnCount: 5,
        policyDecisions: { allow: 8, refuse: 2, escalate: 2, rewrite: 0, cancel_output: 0 },
        audioInputChunks: 0, audioOutputChunks: 0,
        sentiment: { dominantSentiment: "neutral", averageScore: 0.5, escalationTriggered: false, readingCount: 3 },
      },
    });
    const result = boundaryScorer.score("s", recording);
    expect(result.totalScore).toBe(74);
    expect(result.thresholdBreached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VoiceQualityScorer — notifyWebhook()
// ---------------------------------------------------------------------------

describe("VoiceQualityScorer.notifyWebhook()", () => {
  const baseScorecard: QualityScorecard = {
    sessionId: "s1",
    totalScore: 50,
    grade: "F",
    dimensions: {
      policyCompliance:    { name: "policyCompliance",    score: 10, weight: 20, rationale: "5/10 decisions compliant" },
      sentimentTrajectory: { name: "sentimentTrajectory", score: 10, weight: 20, rationale: "Dominant sentiment: neutral" },
      resolutionRate:      { name: "resolutionRate",      score: 12, weight: 20, rationale: "1 escalation(s) detected" },
      responseRelevance:   { name: "responseRelevance",   score: 8,  weight: 20, rationale: "2 conversation turns" },
      latencyAdherence:    { name: "latencyAdherence",    score: 10, weight: 20, rationale: "Avg turn latency: 500ms" },
    },
    thresholdBreached: true,
    computedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does NOT call fetch when no webhookUrl configured", async () => {
    const scorer = new VoiceQualityScorer({ qualityThreshold: 70 });
    await scorer.notifyWebhook({ ...baseScorecard, thresholdBreached: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when thresholdBreached is false", async () => {
    const scorer = new VoiceQualityScorer({ qualityThreshold: 70, webhookUrl: "https://example.com/hook" });
    await scorer.notifyWebhook({ ...baseScorecard, thresholdBreached: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("calls fetch with correct URL and body when thresholdBreached=true and webhookUrl set", async () => {
    const scorer = new VoiceQualityScorer({
      qualityThreshold: 70,
      webhookUrl: "https://example.com/hook",
    });
    await scorer.notifyWebhook(baseScorecard);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scorecard: baseScorecard }),
      }),
    );
  });

  it("swallows fetch errors and does not throw", async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network failure"));
    const scorer = new VoiceQualityScorer({
      qualityThreshold: 70,
      webhookUrl: "https://example.com/hook",
    });
    await expect(scorer.notifyWebhook(baseScorecard)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Quality Router
// ---------------------------------------------------------------------------

describe("Quality Router", () => {
  let app: Express;
  let server: Server;
  let scorer: VoiceQualityScorer;

  const recordings = new Map<string, SessionRecording>();

  beforeAll((done) => {
    recordings.clear();

    const mockRecorder = {
      loadRecording: (id: string) => recordings.get(id) ?? null,
    } as unknown as import("../../services/SessionRecorder.js").SessionRecorder;

    scorer = new VoiceQualityScorer({ qualityThreshold: 70 });
    app = express();
    app.use(express.json());
    app.use("/quality", createQualityRouter(mockRecorder, scorer));
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    recordings.clear();
    scorer.config = { qualityThreshold: 70 };
  });

  it("GET /:sessionId — 404 on missing session", async () => {
    const res = await get(server, "/quality/missing-session");
    expect(res.status).toBe(404);
    expect((res.json() as Record<string, unknown>).error).toBe("Session not found");
  });

  it("GET /:sessionId — 400 on invalid session ID format", async () => {
    const res = await get(server, "/quality/bad..id");
    expect(res.status).toBe(400);
    expect((res.json() as Record<string, unknown>).error).toBe("Invalid session ID");
  });

  it("GET /:sessionId — returns scorecard on valid session", async () => {
    const recording = makeRecording({ sessionId: "valid-sess", durationMs: 1000 });
    recordings.set("valid-sess", recording);

    const res = await get(server, "/quality/valid-sess");
    expect(res.status).toBe(200);
    const body = res.json() as QualityScorecard;
    expect(body.sessionId).toBe("valid-sess");
    expect(typeof body.totalScore).toBe("number");
    expect(["A", "B", "C", "D", "F"]).toContain(body.grade);
  });

  it("GET /:sessionId — calls scorer.score() with the recording", async () => {
    const recording = makeRecording({ sessionId: "sess-spy", durationMs: 1000 });
    recordings.set("sess-spy", recording);

    const scoreSpy = jest.spyOn(scorer, "score");
    await get(server, "/quality/sess-spy");
    expect(scoreSpy).toHaveBeenCalledWith("sess-spy", recording);
    scoreSpy.mockRestore();
  });

  it("PUT /config — updates qualityThreshold", async () => {
    const res = await put(server, "/quality/config", { qualityThreshold: 85 });
    expect(res.status).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.qualityThreshold).toBe(85);
    expect(scorer.config.qualityThreshold).toBe(85);
  });

  it("PUT /config — rejects threshold > 100", async () => {
    const res = await put(server, "/quality/config", { qualityThreshold: 105 });
    expect(res.status).toBe(400);
  });

  it("PUT /config — rejects non-number threshold", async () => {
    const res = await put(server, "/quality/config", { qualityThreshold: "high" });
    expect(res.status).toBe(400);
  });

  it("PUT /config — updates webhookUrl", async () => {
    const res = await put(server, "/quality/config", { webhookUrl: "https://hooks.example.com/quality" });
    expect(res.status).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.webhookUrl).toBe("https://hooks.example.com/quality");
    expect(scorer.config.webhookUrl).toBe("https://hooks.example.com/quality");
  });
});
