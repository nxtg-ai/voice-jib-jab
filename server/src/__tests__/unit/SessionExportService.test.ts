/**
 * SessionExportService Unit Tests
 *
 * Mocks SessionRecorder, RecordingStore, and VoiceQualityScorer to exercise
 * purely the assembly and transformation logic of SessionExportService.
 *
 * SessionRecorder API used:
 *   - loadRecording(sessionId) → SessionRecording | null
 *   - listRecordings() → Array<Omit<SessionRecording, "timeline">>
 *
 * VoiceQualityScorer API used:
 *   - score(sessionId, recording) → QualityScorecard (totalScore: number)
 *
 * RecordingStore API used:
 *   - hasRecording(sessionId) → boolean
 */

import { SessionExportService } from "../../services/SessionExportService.js";
import type { SessionRecorder, SessionRecording } from "../../services/SessionRecorder.js";
import type { RecordingStore } from "../../services/RecordingStore.js";
import type { VoiceQualityScorer, QualityScorecard } from "../../services/VoiceQualityScorer.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

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

function userEntry(text: string, t_ms = 0, isFinal = true) {
  return { t_ms, type: "user_transcript", payload: { text, isFinal } };
}

function assistantEntry(text: string, t_ms = 100, isFinal = true) {
  return { t_ms, type: "transcript", payload: { text, isFinal } };
}

function policyEntry(decision: string, reasonCodes: string[], severity: number, t_ms = 50) {
  return {
    t_ms,
    type: "policy.decision",
    payload: { decision, reason_codes: reasonCodes, severity },
  };
}

function sentimentEntry(sentiment: string, score: number, t_ms = 75) {
  return { t_ms, type: "sentiment", payload: { sentiment, score } };
}

function makeScorecard(totalScore: number): QualityScorecard {
  return {
    sessionId: "sess-001",
    totalScore,
    grade: totalScore >= 90 ? "A" : totalScore >= 80 ? "B" : totalScore >= 70 ? "C" : totalScore >= 60 ? "D" : "F",
    dimensions: {
      policyCompliance: { name: "policyCompliance", score: 20, weight: 20, rationale: "" },
      sentimentTrajectory: { name: "sentimentTrajectory", score: 20, weight: 20, rationale: "" },
      resolutionRate: { name: "resolutionRate", score: 20, weight: 20, rationale: "" },
      responseRelevance: { name: "responseRelevance", score: 20, weight: 20, rationale: "" },
      latencyAdherence: { name: "latencyAdherence", score: 20, weight: 20, rationale: "" },
    },
    thresholdBreached: false,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function buildMockRecorder(recordings: SessionRecording[]): jest.Mocked<Pick<SessionRecorder, "loadRecording" | "listRecordings">> {
  return {
    loadRecording: jest.fn((id: string) => recordings.find((r) => r.sessionId === id) ?? null),
    listRecordings: jest.fn(() => recordings.map(metaOf)),
  };
}

function buildMockRecordingStore(sessionIdsWithAudio: Set<string>): jest.Mocked<Pick<RecordingStore, "hasRecording">> {
  return {
    hasRecording: jest.fn((id: string) => sessionIdsWithAudio.has(id)),
  };
}

function buildMockScorer(totalScore: number): jest.Mocked<Pick<VoiceQualityScorer, "score">> {
  return {
    score: jest.fn((_sessionId: string, _recording: SessionRecording) => makeScorecard(totalScore)),
  };
}

function buildService(
  recordings: SessionRecording[],
  sessionIdsWithAudio: Set<string> = new Set(),
  qualityScore = 85,
): SessionExportService {
  const recorder = buildMockRecorder(recordings);
  const recordingStore = buildMockRecordingStore(sessionIdsWithAudio);
  const qualityScorer = buildMockScorer(qualityScore);
  return new SessionExportService(
    recorder as unknown as SessionRecorder,
    recordingStore as unknown as RecordingStore,
    qualityScorer as unknown as VoiceQualityScorer,
  );
}

// ---------------------------------------------------------------------------
// Tests — exportSession()
// ---------------------------------------------------------------------------

describe("SessionExportService", () => {
  describe("exportSession() — not found", () => {
    it("returns null for unknown session", async () => {
      const svc = buildService([]);
      const result = await svc.exportSession("does-not-exist");
      expect(result).toBeNull();
    });
  });

  describe("exportSession() — session identity", () => {
    it("returns the correct sessionId", async () => {
      const rec = makeRecording({ sessionId: "sess-abc" });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-abc");
      expect(result?.sessionId).toBe("sess-abc");
    });

    it("returns the correct startedAt", async () => {
      const rec = makeRecording({ startedAt: "2026-03-15T08:00:00.000Z" });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.startedAt).toBe("2026-03-15T08:00:00.000Z");
    });

    it("computes durationMs when endedAt is present", async () => {
      const rec = makeRecording({
        startedAt: "2026-03-01T10:00:00.000Z",
        endedAt: "2026-03-01T10:05:00.000Z",
        durationMs: 300000,
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.durationMs).toBe(300000);
    });

    it("omits durationMs when endedAt is null", async () => {
      const rec = makeRecording({ endedAt: null, durationMs: null });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.durationMs).toBeUndefined();
    });
  });

  describe("exportSession() — transcript", () => {
    it("contains user_transcript events where isFinal=true", async () => {
      const rec = makeRecording({
        timeline: [userEntry("hello user", 0, true)],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.transcript).toHaveLength(1);
      expect(result?.transcript[0].speaker).toBe("user");
      expect(result?.transcript[0].text).toBe("hello user");
    });

    it("skips user_transcript events where isFinal=false", async () => {
      const rec = makeRecording({
        timeline: [
          userEntry("partial...", 0, false),
          userEntry("final text", 100, true),
        ],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.transcript).toHaveLength(1);
      expect(result?.transcript[0].text).toBe("final text");
    });

    it("contains transcript (assistant) events where isFinal=true", async () => {
      const rec = makeRecording({
        timeline: [assistantEntry("hello assistant", 200, true)],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.transcript).toHaveLength(1);
      expect(result?.transcript[0].speaker).toBe("assistant");
      expect(result?.transcript[0].text).toBe("hello assistant");
    });

    it("skips transcript (assistant) events where isFinal=false", async () => {
      const rec = makeRecording({
        timeline: [
          assistantEntry("streaming...", 50, false),
          assistantEntry("complete response", 150, true),
        ],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.transcript).toHaveLength(1);
      expect(result?.transcript[0].text).toBe("complete response");
    });

    it("transcript turn has correct speaker, text, and timestampMs", async () => {
      const rec = makeRecording({
        timeline: [userEntry("test input", 1500, true)],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      const turn = result?.transcript[0];
      expect(turn?.speaker).toBe("user");
      expect(turn?.text).toBe("test input");
      expect(turn?.timestampMs).toBe(1500);
      expect(turn?.isFinal).toBe(true);
    });

    it("transcript includes both user and assistant turns", async () => {
      const rec = makeRecording({
        timeline: [
          userEntry("user says", 0),
          assistantEntry("assistant replies", 500),
        ],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.transcript).toHaveLength(2);
      const speakers = result?.transcript.map((t) => t.speaker);
      expect(speakers).toContain("user");
      expect(speakers).toContain("assistant");
    });
  });

  describe("exportSession() — policyDecisions", () => {
    it("builds policyDecisions from policy.decision events", async () => {
      const rec = makeRecording({
        timeline: [policyEntry("allow", ["safe"], 1, 50)],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.policyDecisions).toHaveLength(1);
    });

    it("policyDecisions have decision, reasonCodes, severity, and timestampMs", async () => {
      const rec = makeRecording({
        timeline: [policyEntry("escalate", ["profanity", "threat"], 8, 200)],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      const pd = result?.policyDecisions[0];
      expect(pd?.decision).toBe("escalate");
      expect(pd?.reasonCodes).toEqual(["profanity", "threat"]);
      expect(pd?.severity).toBe(8);
      expect(pd?.timestampMs).toBe(200);
    });
  });

  describe("exportSession() — sentiment", () => {
    it("builds sentiment array from sentiment timeline events", async () => {
      const rec = makeRecording({
        timeline: [sentimentEntry("positive", 0.9, 100)],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.sentiment).toHaveLength(1);
      expect(result?.sentiment[0].sentiment).toBe("positive");
      expect(result?.sentiment[0].score).toBe(0.9);
      expect(result?.sentiment[0].timestampMs).toBe(100);
    });

    it("returns empty sentiment array when no sentiment events exist", async () => {
      const rec = makeRecording({ timeline: [userEntry("hello")] });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.sentiment).toHaveLength(0);
    });
  });

  describe("exportSession() — qualityScore", () => {
    it("sets qualityScore from VoiceQualityScorer.score()", async () => {
      const rec = makeRecording();
      const svc = buildService([rec], new Set(), 72);
      const result = await svc.exportSession("sess-001");
      expect(result?.qualityScore).toBe(72);
    });
  });

  describe("exportSession() — recordingUrl", () => {
    it("sets recordingUrl when hasRecording returns true", async () => {
      const rec = makeRecording();
      const svc = buildService([rec], new Set(["sess-001"]));
      const result = await svc.exportSession("sess-001");
      expect(result?.recordingUrl).toBe("/recordings/sess-001");
    });

    it("omits recordingUrl when hasRecording returns false", async () => {
      const rec = makeRecording();
      const svc = buildService([rec], new Set());
      const result = await svc.exportSession("sess-001");
      expect(result?.recordingUrl).toBeUndefined();
    });
  });

  describe("exportSession() — metadata", () => {
    it("metadata.turnCount equals total transcript turns", async () => {
      const rec = makeRecording({
        timeline: [
          userEntry("a", 0),
          assistantEntry("b", 100),
          userEntry("c", 200),
        ],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.metadata.turnCount).toBe(3);
    });

    it("metadata.userTurnCount counts only user turns", async () => {
      const rec = makeRecording({
        timeline: [
          userEntry("u1", 0),
          userEntry("u2", 100),
          assistantEntry("a1", 200),
        ],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.metadata.userTurnCount).toBe(2);
    });

    it("metadata.assistantTurnCount counts only assistant turns", async () => {
      const rec = makeRecording({
        timeline: [
          userEntry("u1", 0),
          assistantEntry("a1", 100),
          assistantEntry("a2", 200),
        ],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.metadata.assistantTurnCount).toBe(2);
    });

    it("metadata.topSentiment is the most frequent sentiment value", async () => {
      const rec = makeRecording({
        timeline: [
          sentimentEntry("positive", 0.9, 100),
          sentimentEntry("positive", 0.8, 200),
          sentimentEntry("neutral", 0.5, 300),
        ],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.metadata.topSentiment).toBe("positive");
    });

    it("metadata.topSentiment is undefined when no sentiment events exist", async () => {
      const rec = makeRecording({ timeline: [] });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.metadata.topSentiment).toBeUndefined();
    });

    it("metadata.escalated is true when any policyDecision is 'escalate'", async () => {
      const rec = makeRecording({
        timeline: [
          policyEntry("allow", [], 1, 50),
          policyEntry("escalate", ["threat"], 9, 100),
        ],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.metadata.escalated).toBe(true);
    });

    it("metadata.escalated is false when no policyDecision is 'escalate'", async () => {
      const rec = makeRecording({
        timeline: [policyEntry("allow", [], 1, 50)],
      });
      const svc = buildService([rec]);
      const result = await svc.exportSession("sess-001");
      expect(result?.metadata.escalated).toBe(false);
    });

    it("metadata.exportedAt is a present ISO timestamp string", async () => {
      const rec = makeRecording();
      const svc = buildService([rec]);
      const before = Date.now();
      const result = await svc.exportSession("sess-001");
      const after = Date.now();
      const exportedAtMs = new Date(result?.metadata.exportedAt ?? "").getTime();
      expect(exportedAtMs).toBeGreaterThanOrEqual(before);
      expect(exportedAtMs).toBeLessThanOrEqual(after);
    });
  });

  // ── exportBulk() ────────────────────────────────────────────────────────────

  describe("exportBulk()", () => {
    it("returns a BulkExportResult with exportedAt, totalSessions, and sessions", async () => {
      const rec = makeRecording();
      const svc = buildService([rec]);
      const result = await svc.exportBulk({});
      expect(typeof result.exportedAt).toBe("string");
      expect(typeof result.totalSessions).toBe("number");
      expect(Array.isArray(result.sessions)).toBe(true);
    });

    it("handles empty session list gracefully", async () => {
      const svc = buildService([]);
      const result = await svc.exportBulk({});
      expect(result.totalSessions).toBe(0);
      expect(result.sessions).toHaveLength(0);
    });

    it("returns totalSessions count", async () => {
      const recs = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
        makeRecording({ sessionId: "s3" }),
      ];
      const svc = buildService(recs);
      const result = await svc.exportBulk({});
      expect(result.totalSessions).toBe(3);
    });

    it("filters by tenantId", async () => {
      const recs = [
        makeRecording({ sessionId: "s1", tenantId: "org-a" }),
        makeRecording({ sessionId: "s2", tenantId: "org-b" }),
      ];
      const svc = buildService(recs);
      const result = await svc.exportBulk({ tenantId: "org-a" });
      expect(result.totalSessions).toBe(1);
      expect(result.sessions[0].sessionId).toBe("s1");
    });

    it("filters by from date (excludes sessions before from)", async () => {
      const recs = [
        makeRecording({ sessionId: "old", startedAt: "2026-01-01T00:00:00.000Z" }),
        makeRecording({ sessionId: "new", startedAt: "2026-03-15T00:00:00.000Z" }),
      ];
      const svc = buildService(recs);
      const result = await svc.exportBulk({ from: "2026-03-01T00:00:00.000Z" });
      expect(result.totalSessions).toBe(1);
      expect(result.sessions[0].sessionId).toBe("new");
    });

    it("filters by to date (excludes sessions after to)", async () => {
      const recs = [
        makeRecording({ sessionId: "early", startedAt: "2026-01-01T00:00:00.000Z" }),
        makeRecording({ sessionId: "late", startedAt: "2026-03-15T00:00:00.000Z" }),
      ];
      const svc = buildService(recs);
      const result = await svc.exportBulk({ to: "2026-02-01T00:00:00.000Z" });
      expect(result.totalSessions).toBe(1);
      expect(result.sessions[0].sessionId).toBe("early");
    });

    it("applies limit to the number of sessions returned", async () => {
      const recs = Array.from({ length: 10 }, (_, i) =>
        makeRecording({ sessionId: `s${i}` }),
      );
      const svc = buildService(recs);
      const result = await svc.exportBulk({ limit: 3 });
      expect(result.sessions).toHaveLength(3);
      expect(result.totalSessions).toBe(10);
    });

    it("applies offset to skip sessions", async () => {
      const recs = [
        makeRecording({ sessionId: "s0", startedAt: "2026-03-01T10:00:00.000Z" }),
        makeRecording({ sessionId: "s1", startedAt: "2026-03-01T10:01:00.000Z" }),
        makeRecording({ sessionId: "s2", startedAt: "2026-03-01T10:02:00.000Z" }),
      ];
      const svc = buildService(recs);
      const result = await svc.exportBulk({ offset: 1, limit: 1 });
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe("s1");
    });

    it("exports only specified sessionIds when sessionIds filter is provided", async () => {
      const recs = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
        makeRecording({ sessionId: "s3" }),
      ];
      const svc = buildService(recs);
      const result = await svc.exportBulk({ sessionIds: ["s1", "s3"] });
      expect(result.totalSessions).toBe(2);
      const ids = result.sessions.map((s) => s.sessionId);
      expect(ids).toContain("s1");
      expect(ids).toContain("s3");
      expect(ids).not.toContain("s2");
    });
  });
});
