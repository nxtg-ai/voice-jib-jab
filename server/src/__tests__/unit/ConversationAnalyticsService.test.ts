/**
 * ConversationAnalyticsService Unit Tests
 *
 * SessionRecorder is fully mocked. Tests exercise topic clustering, FAQ
 * extraction, resolution path mapping, handle time percentiles, and all
 * filter options (tenantId, from/to, maxSessions).
 *
 * SessionRecorder API used:
 *   - listRecordings() → Array<Omit<SessionRecording, "timeline">>
 *   - loadRecording(sessionId) → SessionRecording | null
 */

import {
  ConversationAnalyticsService,
} from "../../services/ConversationAnalyticsService.js";
import type { SessionRecorder, SessionRecording } from "../../services/SessionRecorder.js";

// ── Mock factory helpers ──────────────────────────────────────────────────────

function makeRecording(overrides: Partial<SessionRecording> = {}): SessionRecording {
  return {
    sessionId: "sess-001",
    startedAt: "2026-03-01T10:00:00.000Z",
    endedAt: "2026-03-01T10:05:00.000Z",
    durationMs: 300000,
    tenantId: "tenant-a",
    timeline: [],
    summary: {
      turnCount: 0,
      policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
      audioInputChunks: 0,
      audioOutputChunks: 0,
    },
    ...overrides,
  };
}

type RecordingMeta = Omit<SessionRecording, "timeline">;

function metaOf(r: SessionRecording): RecordingMeta {
  const { timeline: _t, ...meta } = r;
  return meta;
}

function userEntry(text: string, t_ms = 0) {
  return { t_ms, type: "user_transcript" as const, payload: { text, isFinal: true } };
}

function policyEntry(decision: string, t_ms = 50) {
  return { t_ms, type: "policy.decision" as const, payload: { decision } };
}

function endEntry(t_ms = 200) {
  return { t_ms, type: "session.end" as const };
}

// ── Mock SessionRecorder ──────────────────────────────────────────────────────

function buildMockRecorder(
  recordings: SessionRecording[],
): jest.Mocked<Pick<SessionRecorder, "listRecordings" | "loadRecording">> {
  return {
    listRecordings: jest.fn(() => recordings.map(metaOf)),
    loadRecording: jest.fn((id: string) => recordings.find((r) => r.sessionId === id) ?? null),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ConversationAnalyticsService", () => {

  // ── generateInsights() — shape ────────────────────────────────────────────

  describe("generateInsights() — response shape", () => {
    it("returns ConversationInsights with generatedAt", async () => {
      const recorder = buildMockRecorder([]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result).toHaveProperty("generatedAt");
      expect(typeof result.generatedAt).toBe("string");
      expect(Date.parse(result.generatedAt)).not.toBeNaN();
    });

    it("sessionCount matches loaded sessions", async () => {
      const recs = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
        makeRecording({ sessionId: "s3" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.sessionCount).toBe(3);
    });

    it("dateRange.from and dateRange.to are populated", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", startedAt: "2026-03-01T09:00:00.000Z" }),
        makeRecording({ sessionId: "s2", startedAt: "2026-03-10T09:00:00.000Z" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.dateRange.to).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("empty session set returns empty clusters, FAQs, paths", async () => {
      const recorder = buildMockRecorder([]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.topicClusters).toHaveLength(0);
      expect(result.frequentQuestions).toHaveLength(0);
      expect(result.resolutionPaths).toHaveLength(0);
    });
  });

  // ── Topic clustering ──────────────────────────────────────────────────────

  describe("topic clustering", () => {
    it("assigns session to 'billing' cluster when user says 'billing'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("I have a billing question")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing).toBeDefined();
      expect(billing!.sessionCount).toBe(1);
    });

    it("assigns session to 'billing' cluster when user says 'invoice'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("can you send me an invoice")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing).toBeDefined();
      expect(billing!.sessionCount).toBe(1);
    });

    it("assigns session to 'technical' cluster when user says 'error'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("I keep getting an error message")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const technical = result.topicClusters.find((c) => c.label === "technical");
      expect(technical).toBeDefined();
      expect(technical!.sessionCount).toBe(1);
    });

    it("assigns session to 'technical' cluster when user says 'problem'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("there is a problem with my service")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const technical = result.topicClusters.find((c) => c.label === "technical");
      expect(technical).toBeDefined();
      expect(technical!.sessionCount).toBe(1);
    });

    it("assigns unmatched session to 'general_inquiry'", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("hello")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const general = result.topicClusters.find((c) => c.label === "general_inquiry");
      expect(general).toBeDefined();
      expect(general!.sessionCount).toBe(1);
    });

    it("topicClusters array always has a general_inquiry entry when sessions exist", async () => {
      const rec = makeRecording({ sessionId: "s1", timeline: [userEntry("hello")] });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const general = result.topicClusters.find((c) => c.label === "general_inquiry");
      expect(general).toBeDefined();
    });

    it("cluster.sessionCount is correct for multiple sessions", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", timeline: [userEntry("billing issue")] }),
        makeRecording({ sessionId: "s2", timeline: [userEntry("billing problem")] }),
        makeRecording({ sessionId: "s3", timeline: [userEntry("hello")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      // "billing" matches "bill" in "billing"
      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.sessionCount).toBe(2);
    });

    it("cluster.avgHandleTimeMs is computed from durationMs", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: 10000, timeline: [userEntry("billing question")] }),
        makeRecording({ sessionId: "s2", durationMs: 20000, timeline: [userEntry("check my bill")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.avgHandleTimeMs).toBe(15000);
    });

    it("cluster.escalationRate is 0 when no sessions have escalations", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [userEntry("billing question")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 2, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.escalationRate).toBe(0);
    });

    it("cluster.escalationRate is 1 when all sessions escalate", async () => {
      const recs = [
        makeRecording({
          sessionId: "s1",
          timeline: [userEntry("billing complaint")],
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 0, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s2",
          timeline: [userEntry("billing dispute")],
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 0, refuse: 0, escalate: 2, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.escalationRate).toBe(1);
    });

    it("cluster.sentimentBreakdown counts dominant sentiments correctly", async () => {
      const recs = [
        makeRecording({
          sessionId: "s1",
          timeline: [userEntry("billing question")],
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
            sentiment: { dominantSentiment: "positive", averageScore: 0.9, escalationTriggered: false, readingCount: 3 },
          },
        }),
        makeRecording({
          sessionId: "s2",
          timeline: [userEntry("bill charge")],
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
            sentiment: { dominantSentiment: "frustrated", averageScore: 0.2, escalationTriggered: true, readingCount: 2 },
          },
        }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.topicClusters.find((c) => c.label === "billing");
      expect(billing?.sentimentBreakdown["positive"]).toBe(1);
      expect(billing?.sentimentBreakdown["frustrated"]).toBe(1);
    });
  });

  // ── FAQ extraction ────────────────────────────────────────────────────────

  describe("frequentQuestions", () => {
    it("groups identical normalized utterances", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", timeline: [userEntry("What is my balance?")] }),
        makeRecording({ sessionId: "s2", timeline: [userEntry("What is my balance?")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.frequentQuestions.length).toBeGreaterThan(0);
      const faq = result.frequentQuestions[0];
      expect(faq.occurrences).toBe(2);
    });

    it("frequentQuestions sorted by occurrences desc", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", timeline: [userEntry("reset password")] }),
        makeRecording({ sessionId: "s2", timeline: [userEntry("reset password")] }),
        makeRecording({ sessionId: "s3", timeline: [userEntry("reset password")] }),
        makeRecording({ sessionId: "s4", timeline: [userEntry("check balance")] }),
        makeRecording({ sessionId: "s5", timeline: [userEntry("check balance")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.frequentQuestions[0].occurrences).toBeGreaterThanOrEqual(
        result.frequentQuestions[1].occurrences,
      );
    });

    it("unique utterance appearing once has occurrences=1 when totalSessions < 10", async () => {
      const rec = makeRecording({ sessionId: "s1", timeline: [userEntry("unique question abc")] });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const faq = result.frequentQuestions.find((q) => q.normalizedText.includes("unique"));
      expect(faq?.occurrences).toBe(1);
    });

    it("same utterance in 3 sessions has occurrences=3", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", timeline: [userEntry("track my order please")] }),
        makeRecording({ sessionId: "s2", timeline: [userEntry("track my order please")] }),
        makeRecording({ sessionId: "s3", timeline: [userEntry("track my order please")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const faq = result.frequentQuestions.find((q) => q.normalizedText.includes("track"));
      expect(faq?.occurrences).toBe(3);
    });
  });

  // ── Resolution paths ──────────────────────────────────────────────────────

  describe("resolutionPaths", () => {
    it("sessions with the same event sequence are grouped together", async () => {
      const makeResolvedRec = (id: string) =>
        makeRecording({
          sessionId: id,
          timeline: [
            userEntry("hello", 0),
            { t_ms: 100, type: "transcript", payload: { text: "hi", isFinal: true } },
            endEntry(200),
          ],
        });

      const recs = [makeResolvedRec("s1"), makeResolvedRec("s2")];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      // Both sessions share the same path, so there should be one path with occurrences=2
      expect(result.resolutionPaths.length).toBeGreaterThan(0);
      expect(result.resolutionPaths[0].occurrences).toBe(2);
    });

    it("outcomeLabel is 'escalated' when escalate is in path", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [
          userEntry("I want to speak to a manager", 0),
          policyEntry("escalate", 50),
          endEntry(200),
        ],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const path = result.resolutionPaths[0];
      expect(path.outcomeLabel).toBe("escalated");
    });

    it("outcomeLabel is 'resolved' when no escalate or refuse in path", async () => {
      const rec = makeRecording({
        sessionId: "s1",
        timeline: [
          userEntry("hello", 0),
          policyEntry("allow", 50),
          endEntry(200),
        ],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const path = result.resolutionPaths[0];
      expect(path.outcomeLabel).toBe("resolved");
    });
  });

  // ── Handle time by topic ──────────────────────────────────────────────────

  describe("handleTimeByTopic", () => {
    it("avgMs is computed correctly per topic", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: 5000, timeline: [userEntry("billing help")] }),
        makeRecording({ sessionId: "s2", durationMs: 7000, timeline: [userEntry("bill payment")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.handleTimeByTopic.find((h) => h.topicLabel === "billing");
      expect(billing?.avgMs).toBe(6000);
    });

    it("sessions with no durationMs are excluded from handle time stats", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: null, timeline: [userEntry("billing question")] }),
        makeRecording({ sessionId: "s2", durationMs: 10000, timeline: [userEntry("billing issue")] }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      const billing = result.handleTimeByTopic.find((h) => h.topicLabel === "billing");
      expect(billing?.sampleCount).toBe(1);
      expect(billing?.avgMs).toBe(10000);
    });
  });

  // ── Overall stats ─────────────────────────────────────────────────────────

  describe("overallStats", () => {
    it("avgHandleTimeMs is computed across all sessions with duration", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: 10000 }),
        makeRecording({ sessionId: "s2", durationMs: 20000 }),
        makeRecording({ sessionId: "s3", durationMs: null }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.overallStats.avgHandleTimeMs).toBe(15000);
    });

    it("p50HandleTimeMs is correct (median of durations)", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", durationMs: 10000 }),
        makeRecording({ sessionId: "s2", durationMs: 20000 }),
        makeRecording({ sessionId: "s3", durationMs: 30000 }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      // floor(3 * 0.5) = floor(1.5) = 1 → sorted[1] = 20000
      expect(result.overallStats.p50HandleTimeMs).toBe(20000);
    });

    it("p95HandleTimeMs is correct for sample set", async () => {
      // 20 values: 1000-20000 in steps of 1000
      const recs = Array.from({ length: 20 }, (_, i) =>
        makeRecording({ sessionId: `s${i}`, durationMs: (i + 1) * 1000 }),
      );
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      // floor(20 * 0.95) = floor(19) = 19 → sorted[19] = 20000
      expect(result.overallStats.p95HandleTimeMs).toBe(20000);
    });

    it("overallEscalationRate is computed correctly", async () => {
      const recs = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 0, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s2",
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
        makeRecording({
          sessionId: "s3",
          summary: {
            turnCount: 1,
            policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 0,
            audioOutputChunks: 0,
          },
        }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(result.overallStats.overallEscalationRate).toBeCloseTo(1 / 3);
    });

    it("overallResolutionRate + overallEscalationRate = 1", async () => {
      const recs = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights();

      expect(
        result.overallStats.overallResolutionRate + result.overallStats.overallEscalationRate,
      ).toBeCloseTo(1);
    });
  });

  // ── Filter options ────────────────────────────────────────────────────────

  describe("filter options", () => {
    it("tenantId filter: only sessions for that tenant", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", tenantId: "acme" }),
        makeRecording({ sessionId: "s2", tenantId: "acme" }),
        makeRecording({ sessionId: "s3", tenantId: "other" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights({ tenantId: "acme" });

      expect(result.sessionCount).toBe(2);
    });

    it("from date filter excludes sessions before that date", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", startedAt: "2026-01-01T10:00:00.000Z" }),
        makeRecording({ sessionId: "s2", startedAt: "2026-03-15T10:00:00.000Z" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights({ from: "2026-03-01T00:00:00.000Z" });

      expect(result.sessionCount).toBe(1);
    });

    it("to date filter excludes sessions after that date", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", startedAt: "2026-01-01T10:00:00.000Z" }),
        makeRecording({ sessionId: "s2", startedAt: "2026-03-15T10:00:00.000Z" }),
      ];
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights({ to: "2026-02-01T00:00:00.000Z" });

      expect(result.sessionCount).toBe(1);
    });

    it("maxSessions cap is respected", async () => {
      const recs = Array.from({ length: 10 }, (_, i) =>
        makeRecording({ sessionId: `s${i}` }),
      );
      const recorder = buildMockRecorder(recs);
      const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

      const result = await svc.generateInsights({ maxSessions: 3 });

      expect(result.sessionCount).toBeLessThanOrEqual(3);
    });
  });
});

// ── Branch coverage ────────────────────────────────────────────────────────────

describe("ConversationAnalyticsService — branch coverage", () => {

  // ── computeDateRange: empty recordings with explicit from/to ──────────────

  it("dateRange uses from/to fallback strings when no sessions match filter", async () => {
    const recs = [
      makeRecording({ sessionId: "s1", tenantId: "other" }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    // tenantId filter leaves 0 recordings; from/to should appear in dateRange
    const result = await svc.generateInsights({
      tenantId: "nobody",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.000Z",
    });

    expect(result.dateRange.from).toBe("2026-01-01T00:00:00.000Z");
    expect(result.dateRange.to).toBe("2026-12-31T23:59:59.000Z");
  });

  it("dateRange falls back to current ISO string when no sessions and no from/to", async () => {
    const recorder = buildMockRecorder([]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    // Both from and to should be valid ISO strings (the ?? new Date() branch)
    expect(Date.parse(result.dateRange.from)).not.toBeNaN();
    expect(Date.parse(result.dateRange.to)).not.toBeNaN();
  });

  // ── overallStats: all sessions have null durationMs → zeroed percentiles ──

  it("overallStats are all zero when every session has null durationMs", async () => {
    const recs = [
      makeRecording({ sessionId: "s1", durationMs: null }),
      makeRecording({ sessionId: "s2", durationMs: null }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    expect(result.overallStats.avgHandleTimeMs).toBe(0);
    expect(result.overallStats.p50HandleTimeMs).toBe(0);
    expect(result.overallStats.p95HandleTimeMs).toBe(0);
  });

  // ── overallStats: policyDecisions.escalate uses ?? 0 fallback ─────────────

  it("overallEscalationRate handles missing escalate key via ?? 0 default", async () => {
    // summary.policyDecisions has all fields as required by the type, but test
    // the computation path where escalate is explicitly 0 across all sessions
    const recs = [
      makeRecording({
        sessionId: "s1",
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    expect(result.overallStats.overallEscalationRate).toBe(0);
    expect(result.overallStats.overallResolutionRate).toBe(1);
  });

  // ── totalUserTurns: sessions with non-final user_transcript entries ────────

  it("totalUserTurns counts only isFinal=true user_transcript entries", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      timeline: [
        { t_ms: 0, type: "user_transcript" as const, payload: { text: "hel", isFinal: false } },
        { t_ms: 100, type: "user_transcript" as const, payload: { text: "hello", isFinal: true } },
        { t_ms: 200, type: "user_transcript" as const, payload: { text: "wor", isFinal: false } },
        { t_ms: 300, type: "user_transcript" as const, payload: { text: "world", isFinal: true } },
      ],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    expect(result.overallStats.totalUserTurns).toBe(2);
  });

  // ── topic cluster: all sessions have null durationMs → avgHandleTimeMs=0 ──

  it("cluster.avgHandleTimeMs is 0 when all sessions in cluster have null durationMs", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      durationMs: null,
      timeline: [userEntry("billing question")],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const billing = result.topicClusters.find((c) => c.label === "billing");
    expect(billing?.avgHandleTimeMs).toBe(0);
  });

  // ── topic cluster: no sentiment on any session → empty sentimentBreakdown ──

  it("cluster.sentimentBreakdown is empty when no sessions have sentiment data", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      timeline: [userEntry("billing question")],
      // summary has no sentiment field (default makeRecording omits it)
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const billing = result.topicClusters.find((c) => c.label === "billing");
    expect(billing?.sentimentBreakdown).toEqual({});
  });

  // ── frequentQuestions: FAQ threshold=2 filters single-occurrence entries ───

  it("frequentQuestions excludes utterances with occurrences < 2 when totalSessions >= 10", async () => {
    // 10 sessions: 9 say "hello" (unique each normalized form), 1 says unique phrase
    // Use 10 sessions with 9 different questions + 1 repeated to hit threshold=2
    const recs = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeRecording({ sessionId: `s${i}`, timeline: [userEntry(`question number ${i}`)] }),
      ),
      makeRecording({ sessionId: "s9", timeline: [userEntry("shared question")] }),
      makeRecording({ sessionId: "s10", timeline: [userEntry("shared question")] }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    // "shared question" appears twice → included; individual questions appear once → excluded
    const shared = result.frequentQuestions.find((q) => q.normalizedText.includes("shared"));
    expect(shared).toBeDefined();
    expect(shared!.occurrences).toBe(2);

    // Single-occurrence utterances should be filtered out when totalSessions >= 10
    const uniqueQ = result.frequentQuestions.find((q) => q.normalizedText.includes("question number 0"));
    expect(uniqueQ).toBeUndefined();
  });

  // ── frequentQuestions: all-stop-word text normalizes to empty → skipped ────

  it("frequentQuestions skips user_transcript entries whose normalized form is empty (all stop words)", async () => {
    // "the is a" consists entirely of stop words → normalizeText returns ""
    const recs = [
      makeRecording({ sessionId: "s1", timeline: [userEntry("the is a")] }),
      makeRecording({ sessionId: "s2", timeline: [userEntry("the is a")] }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    // The all-stop-word utterance should not appear in FAQs at all
    expect(result.frequentQuestions).toHaveLength(0);
  });

  // ── frequentQuestions: empty raw text is skipped ──────────────────────────

  it("frequentQuestions skips user_transcript entries with empty text", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      timeline: [
        { t_ms: 0, type: "user_transcript" as const, payload: { text: "", isFinal: true } },
        userEntry("valid question"),
      ],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    // Empty entry should not appear; valid question appears once with occurrences=1
    const emptyEntry = result.frequentQuestions.find((q) => q.normalizedText === "");
    expect(emptyEntry).toBeUndefined();
  });

  // ── frequentQuestions: null-only durationMs → avgHandleTimeMs=0 ───────────

  it("FAQ avgHandleTimeMs is 0 when all matching sessions have null durationMs", async () => {
    const recs = [
      makeRecording({ sessionId: "s1", durationMs: null, timeline: [userEntry("refund please")] }),
      makeRecording({ sessionId: "s2", durationMs: null, timeline: [userEntry("refund please")] }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const faq = result.frequentQuestions.find((q) => q.normalizedText.includes("refund"));
    expect(faq).toBeDefined();
    expect(faq!.avgHandleTimeMs).toBe(0);
  });

  // ── frequentQuestions: existing group accumulates durationMs and escalate ──

  it("FAQ occurrences and escalationRate aggregate across multiple sessions", async () => {
    // s1 creates the group (no escalation), s2 updates the existing group (with escalation)
    // This exercises the `existing.escalateCount++` path in the existing-group branch
    const recs = [
      makeRecording({
        sessionId: "s1",
        durationMs: 10000,
        timeline: [userEntry("cancel subscription")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      }),
      makeRecording({
        sessionId: "s2",
        durationMs: 20000,
        timeline: [userEntry("cancel subscription")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 0, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const faq = result.frequentQuestions.find((q) => q.normalizedText.includes("cancel"));
    expect(faq).toBeDefined();
    expect(faq!.occurrences).toBe(2);
    expect(faq!.avgHandleTimeMs).toBe(15000);
    expect(faq!.escalationRate).toBe(0.5);
  });

  // ── FAQ escalation in existing group when null durationMs ─────────────────

  it("FAQ existing group: null durationMs is not pushed to durationsMs", async () => {
    const recs = [
      makeRecording({
        sessionId: "s1",
        durationMs: 10000,
        timeline: [userEntry("password reset")],
      }),
      makeRecording({
        sessionId: "s2",
        durationMs: null,
        timeline: [userEntry("password reset")],
      }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const faq = result.frequentQuestions.find((q) => q.normalizedText.includes("password"));
    expect(faq).toBeDefined();
    // Only s1's durationMs counts → avg = 10000
    expect(faq!.avgHandleTimeMs).toBe(10000);
  });

  // ── resolution paths: null durationMs → avgHandleTimeMs=0 ────────────────

  it("resolutionPath avgHandleTimeMs is 0 when sessions have null durationMs", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      durationMs: null,
      timeline: [userEntry("hello", 0), endEntry(200)],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    expect(result.resolutionPaths.length).toBeGreaterThan(0);
    expect(result.resolutionPaths[0].avgHandleTimeMs).toBe(0);
  });

  // ── resolution paths: existing group accumulates durationMs ──────────────

  it("resolutionPath existing group: null durationMs not pushed, non-null pushed", async () => {
    const makePathRec = (id: string, dur: number | null) =>
      makeRecording({
        sessionId: id,
        durationMs: dur,
        timeline: [userEntry("hello", 0), endEntry(200)],
      });

    const recs = [makePathRec("s1", 5000), makePathRec("s2", null), makePathRec("s3", 15000)];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const path = result.resolutionPaths[0];
    expect(path.occurrences).toBe(3);
    // avg of 5000 and 15000 (null excluded) = 10000
    expect(path.avgHandleTimeMs).toBe(10000);
  });

  // ── buildPathSteps: transcript.final entry with isFinal=true → "agent" ────

  it("buildPathSteps includes transcript.final entries as agent steps", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      timeline: [
        userEntry("hello", 0),
        { t_ms: 50, type: "transcript.final" as const, payload: { text: "hi there", isFinal: true } },
        endEntry(200),
      ],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const path = result.resolutionPaths[0];
    expect(path.steps).toContain("agent");
  });

  // ── buildPathSteps: transcript with isFinal=false does NOT add agent step ─

  it("buildPathSteps skips transcript entries where isFinal is false", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      timeline: [
        userEntry("hello", 0),
        { t_ms: 50, type: "transcript" as const, payload: { text: "hi", isFinal: false } },
        { t_ms: 100, type: "transcript" as const, payload: { text: "hi there", isFinal: true } },
        endEntry(200),
      ],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const path = result.resolutionPaths[0];
    // Only one "agent" step (the isFinal=true one), not two
    const agentSteps = path.steps.filter((s) => s === "agent");
    expect(agentSteps).toHaveLength(1);
  });

  // ── buildPathSteps: steps.length >= 10 causes early exit ─────────────────

  it("buildPathSteps caps at 10 steps when timeline is longer", async () => {
    // 15 user_transcript entries with isFinal=true
    const timeline = Array.from({ length: 15 }, (_, i) =>
      userEntry(`turn ${i}`, i * 100),
    );
    const rec = makeRecording({ sessionId: "s1", timeline });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const path = result.resolutionPaths[0];
    expect(path.steps.length).toBeLessThanOrEqual(10);
  });

  // ── buildPathSteps: policy.decision with no decision key → "policy:unknown"

  it("buildPathSteps uses 'policy:unknown' when policy.decision entry lacks decision payload", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      timeline: [
        userEntry("help", 0),
        { t_ms: 50, type: "policy.decision" as const, payload: {} },
        endEntry(200),
      ],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const path = result.resolutionPaths[0];
    expect(path.steps).toContain("policy:unknown");
  });

  // ── classifyOutcome: "refused" outcome label ──────────────────────────────

  it("outcomeLabel is 'refused' when refuse is in path but not escalate", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      timeline: [
        userEntry("do something bad", 0),
        policyEntry("refuse", 50),
        endEntry(200),
      ],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const path = result.resolutionPaths[0];
    expect(path.outcomeLabel).toBe("refused");
  });

  // ── handleTimeByTopic: multiple sessions in same topic accumulate ─────────

  it("handleTimeByTopic.p50Ms and p95Ms are computed for multi-session topics", async () => {
    const recs = [
      makeRecording({ sessionId: "s1", durationMs: 5000, timeline: [userEntry("account login help")] }),
      makeRecording({ sessionId: "s2", durationMs: 10000, timeline: [userEntry("reset my account password")] }),
      makeRecording({ sessionId: "s3", durationMs: 15000, timeline: [userEntry("account username access")] }),
    ];
    const recorder = buildMockRecorder(recs);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    const account = result.handleTimeByTopic.find((h) => h.topicLabel === "account");
    expect(account).toBeDefined();
    expect(account!.sampleCount).toBe(3);
    expect(account!.p50Ms).toBe(10000);
    expect(account!.avgMs).toBe(10000);
  });

  // ── extractUserText: payload.text is undefined → falls back to "" ─────────

  it("extractUserText handles user_transcript entry where payload.text is undefined", async () => {
    const rec = makeRecording({
      sessionId: "s1",
      timeline: [
        { t_ms: 0, type: "user_transcript" as const, payload: { isFinal: true } as Record<string, unknown> },
      ],
    });
    const recorder = buildMockRecorder([rec]);
    const svc = new ConversationAnalyticsService(recorder as unknown as SessionRecorder);

    // Should not throw; session should be classified as general_inquiry
    const result = await svc.generateInsights();

    const general = result.topicClusters.find((c) => c.label === "general_inquiry");
    expect(general).toBeDefined();
  });

  // ── generateInsights: loadRecording returning null is handled ─────────────

  it("sessions where loadRecording returns null are excluded from analysis", async () => {
    const rec = makeRecording({ sessionId: "s1" });
    const mockRecorder = {
      listRecordings: jest.fn(() => [metaOf(rec)]),
      loadRecording: jest.fn((_id: string) => null),
    };
    const svc = new ConversationAnalyticsService(mockRecorder as unknown as SessionRecorder);

    const result = await svc.generateInsights();

    expect(result.sessionCount).toBe(0);
  });
});
