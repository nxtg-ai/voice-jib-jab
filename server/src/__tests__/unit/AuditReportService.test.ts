/**
 * AuditReportService Unit Tests
 *
 * Mock strategy: jest.fn() mocks for SessionRecorder.listRecordings and
 * loadRecording, and VoiceQualityScorer.score. No disk I/O.
 */

import { AuditReportService } from "../../services/AuditReportService.js";
import type { SessionRecorder, SessionRecording } from "../../services/SessionRecorder.js";
import type { VoiceQualityScorer, QualityScorecard } from "../../services/VoiceQualityScorer.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRecording(overrides: Partial<SessionRecording> = {}): SessionRecording {
  return {
    sessionId: overrides.sessionId ?? "sess-001",
    startedAt: overrides.startedAt ?? "2026-03-15T10:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-03-15T10:01:00.000Z",
    durationMs: overrides.durationMs !== undefined ? overrides.durationMs : 60_000,
    tenantId: overrides.tenantId ?? "tenant-a",
    timeline: overrides.timeline ?? [],
    summary: overrides.summary ?? {
      turnCount: 5,
      policyDecisions: { allow: 8, refuse: 1, escalate: 0, rewrite: 1, cancel_output: 0 },
      audioInputChunks: 100,
      audioOutputChunks: 80,
    },
  };
}

function makeScorecard(sessionId: string, totalScore: number): QualityScorecard {
  const grade =
    totalScore >= 90 ? "A" : totalScore >= 80 ? "B" : totalScore >= 70 ? "C" : totalScore >= 60 ? "D" : "F";
  return {
    sessionId,
    totalScore,
    grade,
    dimensions: {
      policyCompliance: { name: "policyCompliance", score: totalScore / 5, weight: 20, rationale: "" },
      sentimentTrajectory: { name: "sentimentTrajectory", score: totalScore / 5, weight: 20, rationale: "" },
      resolutionRate: { name: "resolutionRate", score: totalScore / 5, weight: 20, rationale: "" },
      responseRelevance: { name: "responseRelevance", score: totalScore / 5, weight: 20, rationale: "" },
      latencyAdherence: { name: "latencyAdherence", score: totalScore / 5, weight: 20, rationale: "" },
    },
    thresholdBreached: totalScore < 70,
    computedAt: new Date().toISOString(),
  };
}

function makeMockRecorder(
  recordings: SessionRecording[],
): Pick<SessionRecorder, "listRecordings" | "loadRecording"> {
  const metaList = recordings.map(({ timeline: _t, ...meta }) => meta);
  return {
    listRecordings: jest.fn(() => metaList),
    loadRecording: jest.fn((sessionId: string) => recordings.find((r) => r.sessionId === sessionId) ?? null),
  };
}

function makeMockScorer(
  scoreMap: Map<string, number>,
): Pick<VoiceQualityScorer, "score"> {
  return {
    score: jest.fn((sessionId: string, _recording: SessionRecording) => {
      const s = scoreMap.get(sessionId) ?? 75;
      return makeScorecard(sessionId, s);
    }),
  };
}

function buildService(
  recordings: SessionRecording[],
  scoreMap: Map<string, number> = new Map(),
): AuditReportService {
  return new AuditReportService(
    makeMockRecorder(recordings) as unknown as SessionRecorder,
    makeMockScorer(scoreMap) as unknown as VoiceQualityScorer,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditReportService", () => {
  describe("generateReport()", () => {
    it("returns AuditReport with a valid UUID reportId", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.reportId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("returns AuditReport with an ISO generatedAt timestamp", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
    });

    it("formats period.label as 'March 2026'", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.period.label).toBe("March 2026");
    });

    it("formats period.label correctly for other months", async () => {
      const svc = buildService([makeRecording({ startedAt: "2026-01-05T09:00:00.000Z" })]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 1 });

      expect(report.period.label).toBe("January 2026");
    });

    it("counts totalSessions correctly", async () => {
      const recordings = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
        makeRecording({ sessionId: "s3" }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.summary.totalSessions).toBe(3);
    });

    it("counts escalationCount from policy decisions", async () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 0, escalate: 2, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
        makeRecording({
          sessionId: "s2",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 4, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.summary.escalationCount).toBe(3);
    });

    it("computes escalationRatePct as percentage of sessions with escalations / total sessions", async () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 0, escalate: 1, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
        makeRecording({
          sessionId: "s2",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 8, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      // 1 escalation across 2 sessions = 50% rate (count/total)
      expect(report.summary.escalationRatePct).toBe(50);
    });

    it("counts refusalCount from policy decisions", async () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 2, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.summary.refusalCount).toBe(2);
    });

    it("averages quality scores correctly", async () => {
      const recordings = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
      ];
      const scoreMap = new Map([["s1", 80], ["s2", 60]]);
      const svc = buildService(recordings, scoreMap);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.summary.avgQualityScore).toBe(70);
    });

    it("policyDecisions includes all decision types with correct counts", async () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 4,
            policyDecisions: { allow: 6, refuse: 2, escalate: 1, rewrite: 1, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const allow = report.policyDecisions.find((d) => d.decision === "allow");
      const refuse = report.policyDecisions.find((d) => d.decision === "refuse");
      const escalate = report.policyDecisions.find((d) => d.decision === "escalate");

      expect(allow?.count).toBe(6);
      expect(refuse?.count).toBe(2);
      expect(escalate?.count).toBe(1);
    });

    it("policyDecisions pcts sum to approximately 100", async () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 4,
            policyDecisions: { allow: 5, refuse: 2, escalate: 1, rewrite: 2, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
        }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const total = report.policyDecisions.reduce((s, d) => s + d.pct, 0);
      // Allow for floating point rounding (each pct rounded to 2dp)
      expect(total).toBeCloseTo(100, 0);
    });

    it("scores 85 → excellent band", async () => {
      const recordings = [makeRecording({ sessionId: "s1" })];
      const svc = buildService(recordings, new Map([["s1", 85]]));
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const excellent = report.qualityBands.find((b) => b.band === "excellent");
      expect(excellent?.count).toBe(1);
    });

    it("scores 65 → good band", async () => {
      const recordings = [makeRecording({ sessionId: "s1" })];
      const svc = buildService(recordings, new Map([["s1", 65]]));
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const good = report.qualityBands.find((b) => b.band === "good");
      expect(good?.count).toBe(1);
    });

    it("scores 45 → fair band", async () => {
      const recordings = [makeRecording({ sessionId: "s1" })];
      const svc = buildService(recordings, new Map([["s1", 45]]));
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const fair = report.qualityBands.find((b) => b.band === "fair");
      expect(fair?.count).toBe(1);
    });

    it("scores 25 → poor band", async () => {
      const recordings = [makeRecording({ sessionId: "s1" })];
      const svc = buildService(recordings, new Map([["s1", 25]]));
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const poor = report.qualityBands.find((b) => b.band === "poor");
      expect(poor?.count).toBe(1);
    });

    it("qualityBands pcts sum to approximately 100", async () => {
      const recordings = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
        makeRecording({ sessionId: "s3" }),
        makeRecording({ sessionId: "s4" }),
      ];
      const scoreMap = new Map([["s1", 85], ["s2", 65], ["s3", 45], ["s4", 25]]);
      const svc = buildService(recordings, scoreMap);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const total = report.qualityBands.reduce((s, b) => s + b.pct, 0);
      expect(total).toBeCloseTo(100, 0);
    });

    it("sentimentBreakdown keys match session sentiments", async () => {
      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 5, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
            sentiment: { dominantSentiment: "positive", averageScore: 0.8, escalationTriggered: false, readingCount: 3 },
          },
        }),
        makeRecording({
          sessionId: "s2",
          summary: {
            turnCount: 2,
            policyDecisions: { allow: 5, refuse: 0, escalate: 0, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
            sentiment: { dominantSentiment: "neutral", averageScore: 0.5, escalationTriggered: false, readingCount: 2 },
          },
        }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.sentimentBreakdown.positive).toBe(1);
      expect(report.sentimentBreakdown.neutral).toBe(1);
    });

    it("topEscalationReasons returns top 5 by frequency from timeline reasonCodes", async () => {
      const makeEscalateEntry = (reasonCode: string) => ({
        t_ms: 1000,
        type: "policy.decision",
        payload: { decision: "escalate", reasonCode },
      });

      const recordings = [
        makeRecording({
          sessionId: "s1",
          summary: {
            turnCount: 3,
            policyDecisions: { allow: 2, refuse: 0, escalate: 6, rewrite: 0, cancel_output: 0 },
            audioInputChunks: 10,
            audioOutputChunks: 10,
          },
          timeline: [
            makeEscalateEntry("rage"),
            makeEscalateEntry("rage"),
            makeEscalateEntry("rage"),
            makeEscalateEntry("billing"),
            makeEscalateEntry("billing"),
            makeEscalateEntry("legal"),
            makeEscalateEntry("complaint"),
            makeEscalateEntry("complaint"),
            // 6th reason to ensure only top 5 returned
            makeEscalateEntry("refund"),
            makeEscalateEntry("other"),
          ],
        }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.topEscalationReasons).toHaveLength(5);
      expect(report.topEscalationReasons[0].reason).toBe("rage");
      expect(report.topEscalationReasons[0].count).toBe(3);
    });

    it("sessionIds list contains all session IDs in period", async () => {
      const recordings = [
        makeRecording({ sessionId: "s1" }),
        makeRecording({ sessionId: "s2" }),
        makeRecording({ sessionId: "s3" }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.sessionIds).toContain("s1");
      expect(report.sessionIds).toContain("s2");
      expect(report.sessionIds).toContain("s3");
      expect(report.sessionIds).toHaveLength(3);
    });

    it("excludes sessions outside the requested month", async () => {
      const recordings = [
        makeRecording({ sessionId: "s-march", startedAt: "2026-03-15T10:00:00.000Z" }),
        makeRecording({ sessionId: "s-april", startedAt: "2026-04-01T10:00:00.000Z" }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.sessionIds).toContain("s-march");
      expect(report.sessionIds).not.toContain("s-april");
      expect(report.summary.totalSessions).toBe(1);
    });

    it("excludes sessions outside the requested year", async () => {
      const recordings = [
        makeRecording({ sessionId: "s-2026", startedAt: "2026-03-15T10:00:00.000Z" }),
        makeRecording({ sessionId: "s-2025", startedAt: "2025-03-15T10:00:00.000Z" }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.sessionIds).toContain("s-2026");
      expect(report.sessionIds).not.toContain("s-2025");
    });

    it("excludes sessions for different tenants", async () => {
      const recordings = [
        makeRecording({ sessionId: "s-a", tenantId: "tenant-a" }),
        makeRecording({ sessionId: "s-b", tenantId: "tenant-b" }),
      ];
      const svc = buildService(recordings);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.sessionIds).toContain("s-a");
      expect(report.sessionIds).not.toContain("s-b");
    });
  });

  // ── generateHtml() ───────────────────────────────────────────────────────

  describe("generateHtml()", () => {
    it("returns a non-empty string", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(report.reportId.length).toBeGreaterThan(0);
      const html = svc.generateHtml(report);
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains the tenant ID", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "acme-corp", year: 2026, month: 3 });

      const html = svc.generateHtml(report);
      expect(html).toContain("acme-corp");
    });

    it("contains the period label", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const html = svc.generateHtml(report);
      expect(html).toContain("March 2026");
    });

    it("contains Export PDF button text", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const html = svc.generateHtml(report);
      expect(html).toMatch(/Export PDF|window\.print/);
    });

    it("contains @media print CSS block", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const html = svc.generateHtml(report);
      expect(html).toContain("@media print");
    });
  });

  // ── listReports() / getReport() ──────────────────────────────────────────

  describe("listReports()", () => {
    it("returns empty array initially", () => {
      const svc = buildService([]);
      expect(svc.listReports()).toHaveLength(0);
    });

    it("returns report after generateReport()", async () => {
      const svc = buildService([makeRecording()]);
      await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      expect(svc.listReports()).toHaveLength(1);
    });

    it("returns multiple reports in descending generatedAt order", async () => {
      const svc = buildService([makeRecording()]);
      await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });
      await svc.generateReport({ tenantId: "tenant-b", year: 2026, month: 2 });

      const reports = svc.listReports();
      expect(reports).toHaveLength(2);
      // Most recent first
      const first = new Date(reports[0].generatedAt).getTime();
      const second = new Date(reports[1].generatedAt).getTime();
      expect(first).toBeGreaterThanOrEqual(second);
    });
  });

  describe("getReport()", () => {
    it("returns undefined for unknown reportId", () => {
      const svc = buildService([]);
      expect(svc.getReport("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    });

    it("returns the correct report by reportId", async () => {
      const svc = buildService([makeRecording()]);
      const report = await svc.generateReport({ tenantId: "tenant-a", year: 2026, month: 3 });

      const fetched = svc.getReport(report.reportId);
      expect(fetched).toBeDefined();
      expect(fetched?.reportId).toBe(report.reportId);
      expect(fetched?.tenantId).toBe("tenant-a");
    });
  });
});
