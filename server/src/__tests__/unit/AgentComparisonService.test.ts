/**
 * AgentComparisonService Unit Tests
 *
 * Mocks SessionRecorder and VoiceQualityScorer to test comparison logic
 * in isolation.
 */

import {
  AgentComparisonService,
  type ComparisonConfig,
} from "../../services/AgentComparisonService.js";
import type { SessionRecorder } from "../../services/SessionRecorder.js";
import type { VoiceQualityScorer } from "../../services/VoiceQualityScorer.js";
import type { SessionRecording } from "../../services/SessionRecorder.js";
import type { QualityScorecard } from "../../services/VoiceQualityScorer.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRecording(overrides: Partial<SessionRecording> = {}): SessionRecording {
  return {
    sessionId: "sess-default",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 2000,
    tenantId: "acme",
    timeline: [],
    summary: {
      turnCount: 5,
      policyDecisions: { allow: 4, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
      audioInputChunks: 0,
      audioOutputChunks: 0,
      sentiment: {
        dominantSentiment: "positive",
        averageScore: 0.8,
        escalationTriggered: false,
        readingCount: 5,
      },
    },
    ...overrides,
  };
}

function makeScorecard(sessionId: string, totalScore: number): QualityScorecard {
  return {
    sessionId,
    totalScore,
    grade: totalScore >= 90 ? "A" : totalScore >= 80 ? "B" : totalScore >= 70 ? "C" : totalScore >= 60 ? "D" : "F",
    dimensions: {
      policyCompliance: { name: "policyCompliance", score: 20, weight: 20, rationale: "" },
      sentimentTrajectory: { name: "sentimentTrajectory", score: 20, weight: 20, rationale: "" },
      resolutionRate: { name: "resolutionRate", score: 20, weight: 20, rationale: "" },
      responseRelevance: { name: "responseRelevance", score: 20, weight: 20, rationale: "" },
      latencyAdherence: { name: "latencyAdherence", score: totalScore - 80, weight: 20, rationale: "" },
    },
    thresholdBreached: totalScore < 70,
    computedAt: new Date().toISOString(),
  };
}

function makeMocks() {
  const recorder = {
    loadRecording: jest.fn(),
  } as unknown as jest.Mocked<SessionRecorder>;

  const qualityScorer = {
    score: jest.fn(),
  } as unknown as jest.Mocked<VoiceQualityScorer>;

  return { recorder, qualityScorer };
}

// Default 3-session setup: config A = sessions [a1, a2, a3], config B = [b1, b2, b3]
function setup3vs3(
  recorder: jest.Mocked<SessionRecorder>,
  qualityScorer: jest.Mocked<VoiceQualityScorer>,
  opts: {
    aScores?: number[];
    bScores?: number[];
    aDurations?: number[];
    bDurations?: number[];
    aEscalations?: boolean[];
    bEscalations?: boolean[];
    aSentiments?: string[];
    bSentiments?: string[];
  } = {},
) {
  const aScores = opts.aScores ?? [85, 85, 85];
  const bScores = opts.bScores ?? [70, 70, 70];
  const aDurations = opts.aDurations ?? [1000, 1200, 1100];
  const bDurations = opts.bDurations ?? [2000, 2200, 2100];
  const aEscalations = opts.aEscalations ?? [false, false, false];
  const bEscalations = opts.bEscalations ?? [false, false, false];
  const aSentiments = opts.aSentiments ?? ["positive", "positive", "positive"];
  const bSentiments = opts.bSentiments ?? ["neutral", "neutral", "neutral"];

  const aSessions = ["a1", "a2", "a3"];
  const bSessions = ["b1", "b2", "b3"];

  recorder.loadRecording.mockImplementation((sessionId) => {
    const idx = aSessions.indexOf(sessionId);
    if (idx !== -1) {
      return makeRecording({
        sessionId,
        durationMs: aDurations[idx],
        summary: {
          turnCount: 5,
          policyDecisions: {
            allow: 4, refuse: 0,
            escalate: aEscalations[idx] ? 1 : 0,
            rewrite: 0, cancel_output: 0,
          },
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: {
            dominantSentiment: aSentiments[idx],
            averageScore: 0.7,
            escalationTriggered: false,
            readingCount: 3,
          },
        },
      });
    }
    const bidx = bSessions.indexOf(sessionId);
    if (bidx !== -1) {
      return makeRecording({
        sessionId,
        durationMs: bDurations[bidx],
        summary: {
          turnCount: 5,
          policyDecisions: {
            allow: 4, refuse: 0,
            escalate: bEscalations[bidx] ? 1 : 0,
            rewrite: 0, cancel_output: 0,
          },
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: {
            dominantSentiment: bSentiments[bidx],
            averageScore: 0.5,
            escalationTriggered: false,
            readingCount: 3,
          },
        },
      });
    }
    return null;
  });

  qualityScorer.score.mockImplementation((sessionId, _recording) => {
    const aidx = aSessions.indexOf(sessionId);
    if (aidx !== -1) return makeScorecard(sessionId, aScores[aidx]);
    const bidx = bSessions.indexOf(sessionId);
    if (bidx !== -1) return makeScorecard(sessionId, bScores[bidx]);
    return makeScorecard(sessionId, 50);
  });

  const configA: ComparisonConfig = {
    configId: "config-a",
    label: "Config A",
    sessionIds: aSessions,
  };
  const configB: ComparisonConfig = {
    configId: "config-b",
    label: "Config B",
    sessionIds: bSessions,
  };

  return { configA, configB };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("AgentComparisonService", () => {
  let svc: AgentComparisonService;
  let recorder: jest.Mocked<SessionRecorder>;
  let qualityScorer: jest.Mocked<VoiceQualityScorer>;

  beforeEach(() => {
    const mocks = makeMocks();
    recorder = mocks.recorder;
    qualityScorer = mocks.qualityScorer;
    svc = new AgentComparisonService(recorder, qualityScorer);
  });

  // ── compareConfigs basic shape ──────────────────────────────────────

  it("returns a ComparisonReport with reportId and generatedAt", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    const report = await svc.compareConfigs(configA, configB);

    expect(report.reportId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
  });

  it("report has configA and configB fields", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    const report = await svc.compareConfigs(configA, configB);

    expect(report.configA).toBeDefined();
    expect(report.configB).toBeDefined();
    expect(report.configA.configId).toBe("config-a");
    expect(report.configB.configId).toBe("config-b");
  });

  it("report has recommendation, metricWinners, reasoning", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    const report = await svc.compareConfigs(configA, configB);

    expect(report.recommendation).toBeDefined();
    expect(report.metricWinners).toBeDefined();
    expect(typeof report.reasoning).toBe("string");
  });

  // ── sessionCount ────────────────────────────────────────────────────

  it("configA.sessionCount matches loaded sessions", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    const report = await svc.compareConfigs(configA, configB);

    expect(report.configA.sessionCount).toBe(3);
  });

  it("configB.sessionCount matches loaded sessions", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    const report = await svc.compareConfigs(configA, configB);

    expect(report.configB.sessionCount).toBe(3);
  });

  // ── avgQualityScore ─────────────────────────────────────────────────

  it("avgQualityScore is averaged across sessions", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aScores: [80, 90, 100],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.configA.avgQualityScore).toBeCloseTo(90, 5);
  });

  // ── p50LatencyMs ────────────────────────────────────────────────────

  it("p50LatencyMs is the 50th percentile of session durations", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aDurations: [1000, 2000, 3000],
    });
    const report = await svc.compareConfigs(configA, configB);

    // sorted = [1000, 2000, 3000], p50 = idx ceil(0.5*3)-1 = idx 1 = 2000
    expect(report.configA.p50LatencyMs).toBe(2000);
  });

  // ── escalationRatePct ───────────────────────────────────────────────

  it("escalationRatePct is 0 when no sessions escalate", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aEscalations: [false, false, false],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.configA.escalationRatePct).toBe(0);
  });

  it("escalationRatePct is 100 when all sessions escalate", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aEscalations: [true, true, true],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.configA.escalationRatePct).toBeCloseTo(100, 5);
  });

  it("escalationRatePct is 50 when half of sessions escalate", async () => {
    // 3 sessions: a1 escalates, a2 does not, a3 does not — but that's 33%
    // Use 2 sessions for clean 50%
    recorder.loadRecording.mockImplementation((id) => {
      if (id === "x1") return makeRecording({ sessionId: "x1", durationMs: 1000, summary: { turnCount: 3, policyDecisions: { allow: 3, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
      if (id === "x2") return makeRecording({ sessionId: "x2", durationMs: 1000, summary: { turnCount: 3, policyDecisions: { allow: 4, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
      if (id === "y1") return makeRecording({ sessionId: "y1", durationMs: 1000, summary: { turnCount: 3, policyDecisions: { allow: 4, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
      if (id === "y2") return makeRecording({ sessionId: "y2", durationMs: 1000, summary: { turnCount: 3, policyDecisions: { allow: 4, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 }, audioInputChunks: 0, audioOutputChunks: 0 } });
      return null;
    });
    qualityScorer.score.mockReturnValue(makeScorecard("any", 80));

    const configA: ComparisonConfig = { configId: "x", label: "X", sessionIds: ["x1", "x2"] };
    const configB: ComparisonConfig = { configId: "y", label: "Y", sessionIds: ["y1", "y2"] };
    const report = await svc.compareConfigs(configA, configB);

    expect(report.configA.escalationRatePct).toBe(50);
  });

  // ── topSentiment ────────────────────────────────────────────────────

  it("topSentiment is the most frequent dominant sentiment", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aSentiments: ["positive", "positive", "neutral"],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.configA.topSentiment).toBe("positive");
  });

  // ── recommendation: insufficient_data ───────────────────────────────

  it("recommendation is insufficient_data when configA has < 2 sessions", async () => {
    recorder.loadRecording.mockImplementation((id) => {
      if (id === "solo") return makeRecording({ sessionId: "solo" });
      if (id === "b1") return makeRecording({ sessionId: "b1" });
      if (id === "b2") return makeRecording({ sessionId: "b2" });
      return null;
    });
    qualityScorer.score.mockReturnValue(makeScorecard("any", 80));

    const configA: ComparisonConfig = { configId: "a", label: "A", sessionIds: ["solo"] };
    const configB: ComparisonConfig = { configId: "b", label: "B", sessionIds: ["b1", "b2"] };
    const report = await svc.compareConfigs(configA, configB);

    expect(report.recommendation).toBe("insufficient_data");
  });

  it("recommendation is insufficient_data when configB has < 2 sessions", async () => {
    recorder.loadRecording.mockImplementation((id) => {
      if (id === "a1" || id === "a2") return makeRecording({ sessionId: id });
      if (id === "solo") return makeRecording({ sessionId: "solo" });
      return null;
    });
    qualityScorer.score.mockReturnValue(makeScorecard("any", 80));

    const configA: ComparisonConfig = { configId: "a", label: "A", sessionIds: ["a1", "a2"] };
    const configB: ComparisonConfig = { configId: "b", label: "B", sessionIds: ["solo"] };
    const report = await svc.compareConfigs(configA, configB);

    expect(report.recommendation).toBe("insufficient_data");
  });

  // ── recommendation: A wins ──────────────────────────────────────────

  it("recommendation is A when A wins >= 3 metrics", async () => {
    // A: high quality, low latency, low escalation, better sentiment
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aScores: [95, 95, 95],
      bScores: [60, 60, 60],
      aDurations: [500, 500, 500],
      bDurations: [3000, 3000, 3000],
      aEscalations: [false, false, false],
      bEscalations: [true, true, true],
      aSentiments: ["positive", "positive", "positive"],
      bSentiments: ["negative", "negative", "negative"],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.recommendation).toBe("A");
  });

  // ── recommendation: B wins ──────────────────────────────────────────

  it("recommendation is B when B wins >= 3 metrics", async () => {
    // B: high quality, low latency, low escalation, better sentiment
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aScores: [60, 60, 60],
      bScores: [95, 95, 95],
      aDurations: [3000, 3000, 3000],
      bDurations: [500, 500, 500],
      aEscalations: [true, true, true],
      bEscalations: [false, false, false],
      aSentiments: ["negative", "negative", "negative"],
      bSentiments: ["positive", "positive", "positive"],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.recommendation).toBe("B");
  });

  // ── recommendation: tie ─────────────────────────────────────────────

  it("recommendation is tie when wins are split evenly", async () => {
    // A wins quality + latency; B wins escalation + sentiment => 2-2 tie
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aScores: [90, 90, 90],   // A wins quality
      bScores: [70, 70, 70],
      aDurations: [500, 500, 500],   // A wins latency
      bDurations: [2000, 2000, 2000],
      aEscalations: [true, true, true],   // B wins escalation
      bEscalations: [false, false, false],
      aSentiments: ["negative", "negative", "negative"],  // B wins sentiment
      bSentiments: ["positive", "positive", "positive"],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.recommendation).toBe("tie");
  });

  // ── metricWinners ───────────────────────────────────────────────────

  it("metricWinners.quality is A when A has higher avgQualityScore", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aScores: [90, 90, 90],
      bScores: [70, 70, 70],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.metricWinners.quality).toBe("A");
  });

  it("metricWinners.latency is A when A has lower p50LatencyMs", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aDurations: [500, 600, 550],
      bDurations: [2000, 2100, 1900],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.metricWinners.latency).toBe("A");
  });

  it("metricWinners.escalation is A when A has lower escalation rate", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aEscalations: [false, false, false],
      bEscalations: [true, true, true],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.metricWinners.escalation).toBe("A");
  });

  it("metricWinners.sentiment is B when B has better sentiment", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer, {
      aSentiments: ["negative", "negative", "negative"],
      bSentiments: ["positive", "positive", "positive"],
    });
    const report = await svc.compareConfigs(configA, configB);

    expect(report.metricWinners.sentiment).toBe("B");
  });

  // ── reasoning ───────────────────────────────────────────────────────

  it("reasoning is a non-empty string", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    const report = await svc.compareConfigs(configA, configB);

    expect(report.reasoning.length).toBeGreaterThan(0);
  });

  // ── listReports ─────────────────────────────────────────────────────

  it("listReports returns all generated reports", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    await svc.compareConfigs(configA, configB);
    await svc.compareConfigs(configA, configB);

    expect(svc.listReports()).toHaveLength(2);
  });

  it("listReports returns a copy (mutation does not affect internal state)", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    await svc.compareConfigs(configA, configB);

    const list = svc.listReports();
    list.splice(0, 1); // mutate returned array

    expect(svc.listReports()).toHaveLength(1);
  });

  // ── getRecentReport ─────────────────────────────────────────────────

  it("getRecentReport returns undefined when no match", async () => {
    const result = await svc.getRecentReport("no-such-a", "no-such-b");
    expect(result).toBeUndefined();
  });

  it("getRecentReport returns the most recent matching report", async () => {
    const { configA, configB } = setup3vs3(recorder, qualityScorer);
    await svc.compareConfigs(configA, configB);
    const second = await svc.compareConfigs(configA, configB);

    const found = await svc.getRecentReport("config-a", "config-b");
    expect(found).toBeDefined();
    expect(found!.reportId).toBe(second.reportId);
  });

  // ── graceful handling ────────────────────────────────────────────────

  it("handles sessions with missing recordings gracefully (no crash)", async () => {
    recorder.loadRecording.mockReturnValue(null); // all sessions return null

    const configA: ComparisonConfig = { configId: "a", label: "A", sessionIds: ["x1", "x2"] };
    const configB: ComparisonConfig = { configId: "b", label: "B", sessionIds: ["y1", "y2"] };

    await expect(svc.compareConfigs(configA, configB)).resolves.toBeDefined();
  });

  it("empty sessionIds handled gracefully (no crash)", async () => {
    const configA: ComparisonConfig = { configId: "a", label: "A", sessionIds: [] };
    const configB: ComparisonConfig = { configId: "b", label: "B", sessionIds: [] };

    const report = await svc.compareConfigs(configA, configB);
    expect(report.recommendation).toBe("insufficient_data");
  });

  it("sessions without sentiment data are handled gracefully", async () => {
    recorder.loadRecording.mockImplementation((id) =>
      makeRecording({
        sessionId: id,
        summary: {
          turnCount: 3,
          policyDecisions: { allow: 3, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
          // No sentiment field
        },
      }),
    );
    qualityScorer.score.mockReturnValue(makeScorecard("any", 80));

    const configA: ComparisonConfig = { configId: "a", label: "A", sessionIds: ["a1", "a2"] };
    const configB: ComparisonConfig = { configId: "b", label: "B", sessionIds: ["b1", "b2"] };

    const report = await svc.compareConfigs(configA, configB);
    expect(report.configA.topSentiment).toBe("unknown");
  });
});
