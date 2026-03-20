/**
 * ConversationSearchService Unit Tests
 *
 * SessionRecorder is mocked to return controlled fixture data so tests
 * exercise only the search/filter/aggregation logic of ConversationSearchService.
 *
 * SessionRecorder API used:
 *   - listRecordings() → Array<Omit<SessionRecording, "timeline">>
 *   - loadRecording(sessionId) → SessionRecording | null
 */

import {
  ConversationSearchService,
} from "../../services/ConversationSearchService.js";
import type {
  TranscriptHit,
  SessionSummary,
} from "../../services/ConversationSearchService.js";
import type { SessionRecorder, SessionRecording } from "../../services/SessionRecorder.js";

// ---------------------------------------------------------------------------
// Mock factory helpers
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

function userEntry(text: string, t_ms = 0) {
  return { t_ms, type: "user_transcript", payload: { text, isFinal: true } };
}

function assistantEntry(text: string, t_ms = 100) {
  return { t_ms, type: "transcript", payload: { text, isFinal: true } };
}

// ---------------------------------------------------------------------------
// Mock SessionRecorder
// ---------------------------------------------------------------------------

function buildMockRecorder(recordings: SessionRecording[]): jest.Mocked<Pick<SessionRecorder, "listRecordings" | "loadRecording">> {
  return {
    listRecordings: jest.fn(() => recordings.map(metaOf)),
    loadRecording: jest.fn((id: string) => recordings.find((r) => r.sessionId === id) ?? null),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConversationSearchService", () => {
  // ── search() — basic ─────────────────────────────────────────────────────

  describe("search() — empty state", () => {
    it("returns empty result when there are no sessions", async () => {
      const recorder = buildMockRecorder([]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({});

      expect(result.total).toBe(0);
      expect(result.hits).toHaveLength(0);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });
  });

  describe("search() — no filters", () => {
    it("returns all transcript hits when no filters applied", async () => {
      const rec = makeRecording({
        timeline: [
          userEntry("Hello there", 0),
          assistantEntry("Hi, how can I help?", 200),
        ],
        summary: {
          turnCount: 2,
          policyDecisions: { allow: 1, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({});

      expect(result.total).toBe(2);
      expect(result.hits).toHaveLength(2);
    });

    it("skips timeline entries without text payload", async () => {
      const rec = makeRecording({
        timeline: [
          { t_ms: 0, type: "user_transcript", payload: { isFinal: true } },
          userEntry("actual text", 100),
          { t_ms: 200, type: "session.start" },
        ],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({});

      expect(result.total).toBe(1);
      expect(result.hits[0].text).toBe("actual text");
    });
  });

  // ── search() — keyword filter ─────────────────────────────────────────────

  describe("search() — keyword filter", () => {
    it("matches keyword case-insensitively", async () => {
      const rec = makeRecording({
        timeline: [
          userEntry("I need help with BILLING please", 0),
          userEntry("something unrelated", 100),
        ],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ keyword: "billing" });

      expect(result.total).toBe(1);
      expect(result.hits[0].text).toContain("BILLING");
      expect(result.hits[0].matchedKeyword).toBe("billing");
    });

    it("returns no hits when keyword not found", async () => {
      const rec = makeRecording({
        timeline: [userEntry("hello world")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ keyword: "refund" });

      expect(result.total).toBe(0);
      expect(result.hits).toHaveLength(0);
    });

    it("does not set matchedKeyword when no keyword filter", async () => {
      const rec = makeRecording({
        timeline: [userEntry("hello")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({});

      expect(result.hits[0].matchedKeyword).toBeUndefined();
    });
  });

  // ── search() — speaker filter ─────────────────────────────────────────────

  describe("search() — speaker filter", () => {
    let rec: SessionRecording;

    beforeEach(() => {
      rec = makeRecording({
        timeline: [
          userEntry("user says this", 0),
          assistantEntry("assistant replies", 100),
        ],
      });
    });

    it("filters to only user transcript events when speaker=user", async () => {
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ speaker: "user" });

      expect(result.total).toBe(1);
      expect(result.hits[0].speaker).toBe("user");
      expect(result.hits[0].text).toBe("user says this");
    });

    it("filters to only assistant transcript events when speaker=assistant", async () => {
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ speaker: "assistant" });

      expect(result.total).toBe(1);
      expect(result.hits[0].speaker).toBe("assistant");
      expect(result.hits[0].text).toBe("assistant replies");
    });

    it("returns both user and assistant hits when speaker=both", async () => {
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ speaker: "both" });

      expect(result.total).toBe(2);
      const speakers = result.hits.map((h) => h.speaker);
      expect(speakers).toContain("user");
      expect(speakers).toContain("assistant");
    });

    it("includes transcript.final events as assistant", async () => {
      const recFinal = makeRecording({
        timeline: [
          { t_ms: 0, type: "transcript.final", payload: { text: "final reply", isFinal: true } },
        ],
      });
      const recorder = buildMockRecorder([recFinal]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ speaker: "assistant" });

      expect(result.total).toBe(1);
      expect(result.hits[0].speaker).toBe("assistant");
    });
  });

  // ── search() — tenantId filter ────────────────────────────────────────────

  describe("search() — tenantId filter", () => {
    it("only returns hits from sessions matching tenantId", async () => {
      const recA = makeRecording({ sessionId: "sess-a", tenantId: "org-a", timeline: [userEntry("from a")] });
      const recB = makeRecording({ sessionId: "sess-b", tenantId: "org-b", timeline: [userEntry("from b")] });
      const recorder = buildMockRecorder([recA, recB]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ tenantId: "org-a" });

      expect(result.total).toBe(1);
      expect(result.hits[0].sessionId).toBe("sess-a");
      expect(result.hits[0].tenantId).toBe("org-a");
    });

    it("returns no hits when tenantId does not match any session", async () => {
      const rec = makeRecording({ tenantId: "org-a", timeline: [userEntry("hello")] });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ tenantId: "org-z" });

      expect(result.total).toBe(0);
    });
  });

  // ── search() — date range filters ─────────────────────────────────────────

  describe("search() — from/to date filters", () => {
    it("excludes sessions that started before 'from'", async () => {
      const old = makeRecording({ sessionId: "old", startedAt: "2026-01-01T00:00:00.000Z", timeline: [userEntry("old")] });
      const recent = makeRecording({ sessionId: "recent", startedAt: "2026-03-15T00:00:00.000Z", timeline: [userEntry("recent")] });
      const recorder = buildMockRecorder([old, recent]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ from: "2026-03-01T00:00:00.000Z" });

      expect(result.total).toBe(1);
      expect(result.hits[0].sessionId).toBe("recent");
    });

    it("excludes sessions that started after 'to'", async () => {
      const early = makeRecording({ sessionId: "early", startedAt: "2026-01-01T00:00:00.000Z", timeline: [userEntry("early")] });
      const late = makeRecording({ sessionId: "late", startedAt: "2026-03-15T00:00:00.000Z", timeline: [userEntry("late")] });
      const recorder = buildMockRecorder([early, late]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ to: "2026-02-01T00:00:00.000Z" });

      expect(result.total).toBe(1);
      expect(result.hits[0].sessionId).toBe("early");
    });

    it("includes sessions within the from/to range (inclusive)", async () => {
      const inRange = makeRecording({
        sessionId: "in",
        startedAt: "2026-03-10T12:00:00.000Z",
        timeline: [userEntry("in range")],
      });
      const outRange = makeRecording({
        sessionId: "out",
        startedAt: "2026-03-20T12:00:00.000Z",
        timeline: [userEntry("out of range")],
      });
      const recorder = buildMockRecorder([inRange, outRange]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-15T00:00:00.000Z",
      });

      expect(result.total).toBe(1);
      expect(result.hits[0].sessionId).toBe("in");
    });
  });

  // ── search() — sentiment filter ───────────────────────────────────────────

  describe("search() — sentiment filter", () => {
    it("only returns hits from sessions whose dominantSentiment matches", async () => {
      const happy = makeRecording({
        sessionId: "happy",
        timeline: [userEntry("great service")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "positive", averageScore: 0.9, escalationTriggered: false, readingCount: 3 },
        },
      });
      const frustrated = makeRecording({
        sessionId: "frustrated",
        timeline: [userEntry("terrible experience")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "frustrated", averageScore: 0.2, escalationTriggered: true, readingCount: 5 },
        },
      });
      const recorder = buildMockRecorder([happy, frustrated]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ sentiment: "positive" });

      expect(result.total).toBe(1);
      expect(result.hits[0].sessionId).toBe("happy");
    });

    it("excludes sessions with no sentiment data when sentiment filter is set", async () => {
      const noSentiment = makeRecording({
        timeline: [userEntry("hello")],
      });
      const recorder = buildMockRecorder([noSentiment]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ sentiment: "positive" });

      expect(result.total).toBe(0);
    });
  });

  // ── search() — policyDecision filter ─────────────────────────────────────

  describe("search() — policyDecision filter", () => {
    it("only returns hits from sessions that have at least one of the matching decision", async () => {
      const escalated = makeRecording({
        sessionId: "escalated",
        timeline: [userEntry("I want to speak to a manager")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 0, refuse: 0, escalate: 2, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });
      const allowed = makeRecording({
        sessionId: "allowed",
        timeline: [userEntry("just a normal question")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 3, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });
      const recorder = buildMockRecorder([escalated, allowed]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ policyDecision: "escalate" });

      expect(result.total).toBe(1);
      expect(result.hits[0].sessionId).toBe("escalated");
    });
  });

  // ── search() — pagination ─────────────────────────────────────────────────

  describe("search() — limit and offset", () => {
    function makeSession(id: string, texts: string[]): SessionRecording {
      return makeRecording({
        sessionId: id,
        timeline: texts.map((t, i) => userEntry(t, i * 100)),
      });
    }

    it("defaults to limit 20 when none specified", async () => {
      const rec = makeSession("s", Array.from({ length: 25 }, (_, i) => `text ${i}`));
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({});

      expect(result.limit).toBe(20);
      expect(result.hits).toHaveLength(20);
      expect(result.total).toBe(25);
    });

    it("applies offset correctly", async () => {
      const rec = makeSession("s", ["first", "second", "third", "fourth", "fifth"]);
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ limit: 2, offset: 2 });

      expect(result.hits).toHaveLength(2);
      expect(result.hits[0].text).toBe("third");
      expect(result.hits[1].text).toBe("fourth");
      expect(result.total).toBe(5);
    });

    it("caps limit at 100", async () => {
      const rec = makeSession("s", Array.from({ length: 150 }, (_, i) => `text ${i}`));
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ limit: 200 });

      expect(result.limit).toBe(100);
      expect(result.hits).toHaveLength(100);
    });

    it("returns total count before applying limit/offset", async () => {
      const rec = makeSession("s", ["a", "b", "c", "d", "e"]);
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({ limit: 2, offset: 0 });

      expect(result.total).toBe(5);
      expect(result.hits).toHaveLength(2);
    });
  });

  // ── search() — hit shape ──────────────────────────────────────────────────

  describe("search() — hit field correctness", () => {
    it("hits have correct sessionId, speaker, text, and timestamp fields", async () => {
      const rec = makeRecording({
        sessionId: "sess-xyz",
        startedAt: "2026-03-10T09:00:00.000Z",
        endedAt: "2026-03-10T09:10:00.000Z",
        tenantId: "acme",
        timeline: [
          userEntry("hello", 1500),
        ],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({});
      const hit = result.hits[0] as TranscriptHit;

      expect(hit.sessionId).toBe("sess-xyz");
      expect(hit.tenantId).toBe("acme");
      expect(hit.startedAt).toBe("2026-03-10T09:00:00.000Z");
      expect(hit.endedAt).toBe("2026-03-10T09:10:00.000Z");
      expect(hit.speaker).toBe("user");
      expect(hit.text).toBe("hello");
      expect(hit.timestamp).toBe(1500);
    });

    it("hit sentiment is populated from session dominant sentiment", async () => {
      const rec = makeRecording({
        timeline: [userEntry("great!")],
        summary: {
          turnCount: 1,
          policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "positive", averageScore: 0.9, escalationTriggered: false, readingCount: 1 },
        },
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const result = await svc.search({});

      expect(result.hits[0].sentiment).toBe("positive");
    });
  });

  // ── getSessionSummary() ───────────────────────────────────────────────────

  describe("getSessionSummary()", () => {
    it("returns null for an unknown session", async () => {
      const recorder = buildMockRecorder([]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const summary = await svc.getSessionSummary("nonexistent");

      expect(summary).toBeNull();
    });

    it("returns correct turnCount from summary", async () => {
      const rec = makeRecording({
        summary: {
          turnCount: 7,
          policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const summary = await svc.getSessionSummary("sess-001") as SessionSummary;

      expect(summary.turnCount).toBe(7);
    });

    it("returns transcriptPreview from first user utterance (max 200 chars)", async () => {
      const longText = "A".repeat(300);
      const rec = makeRecording({
        timeline: [
          userEntry(longText, 0),
          userEntry("second utterance", 100),
        ],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const summary = await svc.getSessionSummary("sess-001") as SessionSummary;

      expect(summary.transcriptPreview).toHaveLength(200);
      expect(summary.transcriptPreview).toBe("A".repeat(200));
    });

    it("sets transcriptPreview to empty string when no user utterances exist", async () => {
      const rec = makeRecording({
        timeline: [assistantEntry("hello")],
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const summary = await svc.getSessionSummary("sess-001") as SessionSummary;

      expect(summary.transcriptPreview).toBe("");
    });

    it("returns unique policy decisions that appeared (count > 0)", async () => {
      const rec = makeRecording({
        summary: {
          turnCount: 3,
          policyDecisions: { allow: 2, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
        },
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const summary = await svc.getSessionSummary("sess-001") as SessionSummary;

      expect(summary.policyDecisions).toHaveLength(2);
      expect(summary.policyDecisions).toContain("allow");
      expect(summary.policyDecisions).toContain("escalate");
      expect(summary.policyDecisions).not.toContain("refuse");
    });

    it("returns topSentiment from summary dominant sentiment", async () => {
      const rec = makeRecording({
        summary: {
          turnCount: 4,
          policyDecisions: { allow: 0, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
          audioInputChunks: 0,
          audioOutputChunks: 0,
          sentiment: { dominantSentiment: "neutral", averageScore: 0.5, escalationTriggered: false, readingCount: 4 },
        },
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const summary = await svc.getSessionSummary("sess-001") as SessionSummary;

      expect(summary.topSentiment).toBe("neutral");
    });

    it("returns undefined topSentiment when no sentiment data exists", async () => {
      const rec = makeRecording();
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const summary = await svc.getSessionSummary("sess-001") as SessionSummary;

      expect(summary.topSentiment).toBeUndefined();
    });

    it("returns all session metadata fields correctly", async () => {
      const rec = makeRecording({
        sessionId: "sess-abc",
        tenantId: "org-x",
        startedAt: "2026-03-15T08:00:00.000Z",
        endedAt: "2026-03-15T08:08:00.000Z",
      });
      const recorder = buildMockRecorder([rec]);
      const svc = new ConversationSearchService(recorder as unknown as SessionRecorder);

      const summary = await svc.getSessionSummary("sess-abc") as SessionSummary;

      expect(summary.sessionId).toBe("sess-abc");
      expect(summary.tenantId).toBe("org-x");
      expect(summary.startedAt).toBe("2026-03-15T08:00:00.000Z");
      expect(summary.endedAt).toBe("2026-03-15T08:08:00.000Z");
    });
  });
});
