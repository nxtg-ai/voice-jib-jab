/**
 * AnalyticsService — derives aggregate metrics from session recordings.
 *
 * This service reads from SessionRecorder.listRecordings() and computes
 * per-session and aggregate metrics on demand. It does NOT maintain its
 * own store — everything is derived from the canonical session recordings.
 *
 * Quality score formula (0–100):
 *   - Latency SLA score (30 pts): durationMs < 60s → 30, < 120s → 20, else 10, null → 20
 *   - Policy compliance rate (40 pts): (allow + rewrite) / totalDecisions * 40
 *   - Engagement score (30 pts): min(turnCount / 5, 1) * 30
 */

import type { SessionRecording, RecordingEntry } from "./SessionRecorder.js";

// ── Public types ──────────────────────────────────────────────────────

/** Per-session computed metrics including quality score, compliance rate, and escalation count. */
export interface SessionMetrics {
  sessionId: string;
  tenantId: string | null;
  startedAt: string;
  durationMs: number | null;
  turnCount: number;
  policyDecisions: Record<string, number>;
  totalDecisions: number;
  complianceRate: number;
  escalationCount: number;
  qualityScore: number;
}

/** Session count and average quality score for a single tenant in aggregate breakdown. */
export interface TenantBreakdownEntry {
  sessions: number;
  avgQualityScore: number;
}

/** Counts of sessions by dominant sentiment category. */
export interface SentimentDistribution {
  positive: number;
  neutral: number;
  negative: number;
  frustrated: number;
}

/** Aggregated metrics for a single tenant, used in cross-tenant comparison views. */
export interface TenantComparisonEntry {
  tenantId: string;
  sessions: number;
  avgQualityScore: number;
  avgDurationMs: number | null;
  escalationRate: number;
  avgComplianceRate: number;
}

/** Aggregate analytics across all (or filtered) sessions with breakdowns and trends. */
export interface AggregateMetrics {
  totalSessions: number;
  filteredSessions: number;
  avgDurationMs: number | null;
  avgTurnCount: number;
  avgQualityScore: number;
  totalDecisions: number;
  decisionBreakdown: Record<string, number>;
  avgComplianceRate: number;
  escalationRate: number;
  tenantBreakdown: Record<string, TenantBreakdownEntry>;
  sessions: SessionMetrics[];
  sentimentDistribution: SentimentDistribution;
  callsPerDay: Array<{ date: string; count: number }>;
  topPolicyViolations: Array<{ violation: string; count: number }>;
}

/** Optional filters for narrowing analytics queries by tenant, date range, or pagination. */
export interface AnalyticsFilter {
  tenantId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

// ── Recording shape consumed by this service ─────────────────────────

type RecordingMetadata = Omit<SessionRecording, "timeline">;

interface FullRecording extends RecordingMetadata {
  timeline: RecordingEntry[];
}

interface RecordingSource {
  listRecordings(): RecordingMetadata[];
  listFullRecordings?(): FullRecording[];
}

// ── Quality score helpers ────────────────────────────────────────────

const LATENCY_MAX_POINTS = 30;
const COMPLIANCE_MAX_POINTS = 40;
const ENGAGEMENT_MAX_POINTS = 30;
const ENGAGEMENT_TURN_CAP = 5;
const FAST_SESSION_THRESHOLD_MS = 60_000;
const MODERATE_SESSION_THRESHOLD_MS = 120_000;

function computeLatencyScore(durationMs: number | null): number {
  if (durationMs === null) {
    return 20;
  }
  if (durationMs < FAST_SESSION_THRESHOLD_MS) {
    return LATENCY_MAX_POINTS;
  }
  if (durationMs < MODERATE_SESSION_THRESHOLD_MS) {
    return 20;
  }
  return 10;
}

function computeComplianceRate(policyDecisions: Record<string, number>, totalDecisions: number): number {
  if (totalDecisions === 0) {
    return 1.0;
  }
  const allowCount = policyDecisions.allow ?? 0;
  const rewriteCount = policyDecisions.rewrite ?? 0;
  return (allowCount + rewriteCount) / totalDecisions;
}

function computeEngagementScore(turnCount: number): number {
  return Math.min(turnCount / ENGAGEMENT_TURN_CAP, 1) * ENGAGEMENT_MAX_POINTS;
}

function sumDecisions(policyDecisions: Record<string, number>): number {
  let total = 0;
  for (const count of Object.values(policyDecisions)) {
    total += count;
  }
  return total;
}

// ── AnalyticsService ─────────────────────────────────────────────────

/** Derives aggregate and per-session metrics from session recordings on demand. */
export class AnalyticsService {
  private recorder: RecordingSource;

  constructor(recorder: RecordingSource) {
    this.recorder = recorder;
  }

  /**
   * Compute per-session metrics from a recording metadata object.
   */
  computeSessionMetrics(recording: RecordingMetadata): SessionMetrics {
    const policyDecisions = recording.summary.policyDecisions;
    const totalDecisions = sumDecisions(policyDecisions);
    const complianceRate = computeComplianceRate(policyDecisions, totalDecisions);
    const turnCount = recording.summary.turnCount;

    const latencyScore = computeLatencyScore(recording.durationMs);
    const complianceScore = complianceRate * COMPLIANCE_MAX_POINTS;
    const engagementScore = computeEngagementScore(turnCount);
    const qualityScore = Math.round(latencyScore + complianceScore + engagementScore);

    return {
      sessionId: recording.sessionId,
      tenantId: recording.tenantId,
      startedAt: recording.startedAt,
      durationMs: recording.durationMs,
      turnCount,
      policyDecisions,
      totalDecisions,
      complianceRate,
      escalationCount: policyDecisions.escalate ?? 0,
      qualityScore,
    };
  }

  /**
   * Compute aggregate metrics across all recordings, optionally filtered.
   */
  getAggregateMetrics(filter?: AnalyticsFilter): AggregateMetrics {
    const allRecordings = this.recorder.listRecordings();
    const totalSessions = allRecordings.length;

    // Apply filters
    let filtered = allRecordings;

    if (filter?.tenantId) {
      filtered = filtered.filter((r) => r.tenantId === filter.tenantId);
    }
    if (filter?.fromDate) {
      const from = filter.fromDate;
      filtered = filtered.filter((r) => r.startedAt >= from);
    }
    if (filter?.toDate) {
      const to = filter.toDate;
      filtered = filtered.filter((r) => r.startedAt <= to);
    }

    const filteredSessions = filtered.length;

    // Apply pagination
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    const paginated = filtered.slice(offset, offset + limit);

    // Compute per-session metrics
    const sessionMetrics = paginated.map((r) => this.computeSessionMetrics(r));

    // Compute aggregates from the full filtered set (not paginated)
    const allFilteredMetrics = filtered.map((r) => this.computeSessionMetrics(r));

    // Derive new aggregate fields from filtered recordings
    const sentimentDistribution = this.computeSentimentDistribution(filtered);
    const callsPerDay = this.computeCallsPerDay(filtered);
    const topPolicyViolations = this.computeTopPolicyViolations(filtered);

    return this.buildAggregates(
      totalSessions,
      filteredSessions,
      allFilteredMetrics,
      sessionMetrics,
      sentimentDistribution,
      callsPerDay,
      topPolicyViolations,
    );
  }

  /**
   * Returns calls grouped by ISO date (YYYY-MM-DD), sorted ascending, optionally filtered.
   */
  getCallsPerDay(filter?: AnalyticsFilter): Array<{ date: string; count: number }> {
    const allRecordings = this.recorder.listRecordings();
    let filtered = allRecordings;

    if (filter?.tenantId) {
      filtered = filtered.filter((r) => r.tenantId === filter.tenantId);
    }
    if (filter?.fromDate) {
      const from = filter.fromDate;
      filtered = filtered.filter((r) => r.startedAt >= from);
    }
    if (filter?.toDate) {
      const to = filter.toDate;
      filtered = filtered.filter((r) => r.startedAt <= to);
    }

    return this.computeCallsPerDay(filtered);
  }

  /**
   * Returns per-tenant comparison metrics across all sessions.
   */
  getTenantComparison(): TenantComparisonEntry[] {
    const allRecordings = this.recorder.listRecordings();
    const allMetrics = allRecordings.map((r) => this.computeSessionMetrics(r));

    // Group by tenantId
    const groups = new Map<
      string,
      {
        metrics: SessionMetrics[];
      }
    >();

    for (const m of allMetrics) {
      const key = m.tenantId ?? "unknown";
      const group = groups.get(key);
      if (group) {
        group.metrics.push(m);
      } else {
        groups.set(key, { metrics: [m] });
      }
    }

    const result: TenantComparisonEntry[] = [];
    for (const [tenantId, group] of groups) {
      const { metrics } = group;
      const sessions = metrics.length;

      const avgQualityScore =
        Math.round((metrics.reduce((sum, m) => sum + m.qualityScore, 0) / sessions) * 100) / 100;

      const durationsWithValues = metrics
        .map((m) => m.durationMs)
        .filter((d): d is number => d !== null);
      const avgDurationMs =
        durationsWithValues.length > 0
          ? durationsWithValues.reduce((a, b) => a + b, 0) / durationsWithValues.length
          : null;

      const totalDecisions = metrics.reduce((sum, m) => sum + m.totalDecisions, 0);
      const totalEscalations = metrics.reduce((sum, m) => sum + m.escalationCount, 0);
      const escalationRate = totalDecisions > 0 ? totalEscalations / totalDecisions : 0;

      const avgComplianceRate =
        metrics.reduce((sum, m) => sum + m.complianceRate, 0) / sessions;

      result.push({
        tenantId,
        sessions,
        avgQualityScore,
        avgDurationMs,
        escalationRate,
        avgComplianceRate,
      });
    }

    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Aggregate sentiment distribution from recordings that have sentiment data.
   * Recordings without a dominantSentiment are excluded from counts.
   */
  private computeSentimentDistribution(
    recordings: RecordingMetadata[],
  ): SentimentDistribution {
    const dist: SentimentDistribution = { positive: 0, neutral: 0, negative: 0, frustrated: 0 };
    const distMap = dist as unknown as Record<string, number>;
    for (const r of recordings) {
      const dominant = r.summary.sentiment?.dominantSentiment;
      if (!dominant) {
        continue;
      }
      if (dominant in distMap) {
        distMap[dominant]++;
      }
    }
    return dist;
  }

  /**
   * Group recordings by ISO date (YYYY-MM-DD), sorted ascending.
   */
  private computeCallsPerDay(
    recordings: RecordingMetadata[],
  ): Array<{ date: string; count: number }> {
    const dayCounts = new Map<string, number>();
    for (const r of recordings) {
      const date = r.startedAt.slice(0, 10);
      dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);
    }
    return Array.from(dayCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Collect all policy.decision timeline entries where decision is "refuse" or
   * "escalate", group by reason (falling back to decision), return top 5 by count.
   *
   * Requires full recordings with timeline. Falls back to an empty array when
   * the recorder does not implement listFullRecordings().
   */
  private computeTopPolicyViolations(
    filteredMeta: RecordingMetadata[],
  ): Array<{ violation: string; count: number }> {
    if (!this.recorder.listFullRecordings) {
      // Recorder does not expose timelines — derive from policyDecisions summary
      return this.computeTopViolationsFromSummary(filteredMeta);
    }

    const fullRecordings = this.recorder.listFullRecordings();
    const filteredIds = new Set(filteredMeta.map((r) => r.sessionId));
    const relevantRecordings = fullRecordings.filter((r) => filteredIds.has(r.sessionId));

    const violationCounts = new Map<string, number>();
    for (const recording of relevantRecordings) {
      for (const entry of recording.timeline) {
        if (entry.type !== "policy.decision") {
          continue;
        }
        const payload = entry.payload as Record<string, unknown> | undefined;
        if (!payload) {
          continue;
        }
        const decision = payload.decision as string | undefined;
        if (decision !== "refuse" && decision !== "escalate") {
          continue;
        }
        const violation =
          (payload.reason as string | undefined) ?? decision;
        violationCounts.set(violation, (violationCounts.get(violation) ?? 0) + 1);
      }
    }

    return Array.from(violationCounts.entries())
      .map(([violation, count]) => ({ violation, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Fallback for topPolicyViolations when timeline is not available.
   * Uses the policyDecisions summary to count refuse and escalate totals.
   */
  private computeTopViolationsFromSummary(
    recordings: RecordingMetadata[],
  ): Array<{ violation: string; count: number }> {
    let refuseTotal = 0;
    let escalateTotal = 0;
    for (const r of recordings) {
      refuseTotal += r.summary.policyDecisions.refuse ?? 0;
      escalateTotal += r.summary.policyDecisions.escalate ?? 0;
    }
    const result: Array<{ violation: string; count: number }> = [];
    if (refuseTotal > 0) {
      result.push({ violation: "refuse", count: refuseTotal });
    }
    if (escalateTotal > 0) {
      result.push({ violation: "escalate", count: escalateTotal });
    }
    return result.sort((a, b) => b.count - a.count).slice(0, 5);
  }

  private buildAggregates(
    totalSessions: number,
    filteredSessions: number,
    allMetrics: SessionMetrics[],
    paginatedMetrics: SessionMetrics[],
    sentimentDistribution: SentimentDistribution,
    callsPerDay: Array<{ date: string; count: number }>,
    topPolicyViolations: Array<{ violation: string; count: number }>,
  ): AggregateMetrics {
    if (allMetrics.length === 0) {
      return {
        totalSessions,
        filteredSessions: 0,
        avgDurationMs: null,
        avgTurnCount: 0,
        avgQualityScore: 0,
        totalDecisions: 0,
        decisionBreakdown: {},
        avgComplianceRate: 0,
        escalationRate: 0,
        tenantBreakdown: {},
        sessions: paginatedMetrics,
        sentimentDistribution,
        callsPerDay,
        topPolicyViolations,
      };
    }

    // Average duration (skip nulls)
    const durationsWithValues = allMetrics
      .map((m) => m.durationMs)
      .filter((d): d is number => d !== null);
    const avgDurationMs =
      durationsWithValues.length > 0
        ? durationsWithValues.reduce((a, b) => a + b, 0) / durationsWithValues.length
        : null;

    // Average turn count
    const avgTurnCount =
      allMetrics.reduce((sum, m) => sum + m.turnCount, 0) / allMetrics.length;

    // Average quality score
    const avgQualityScore =
      allMetrics.reduce((sum, m) => sum + m.qualityScore, 0) / allMetrics.length;

    // Decision breakdown summed across all sessions
    const decisionBreakdown: Record<string, number> = {};
    let totalDecisions = 0;
    for (const m of allMetrics) {
      for (const [key, count] of Object.entries(m.policyDecisions)) {
        decisionBreakdown[key] = (decisionBreakdown[key] ?? 0) + count;
      }
      totalDecisions += m.totalDecisions;
    }

    // Average compliance rate
    const avgComplianceRate =
      allMetrics.reduce((sum, m) => sum + m.complianceRate, 0) / allMetrics.length;

    // Escalation rate
    const totalEscalations = allMetrics.reduce((sum, m) => sum + m.escalationCount, 0);
    const escalationRate = totalDecisions > 0 ? totalEscalations / totalDecisions : 0;

    // Tenant breakdown
    const tenantGroups = new Map<string, { scores: number[]; count: number }>();
    for (const m of allMetrics) {
      const key = m.tenantId ?? "unknown";
      const group = tenantGroups.get(key);
      if (group) {
        group.count++;
        group.scores.push(m.qualityScore);
      } else {
        tenantGroups.set(key, { count: 1, scores: [m.qualityScore] });
      }
    }

    const tenantBreakdown: Record<string, TenantBreakdownEntry> = {};
    for (const [tenantId, group] of tenantGroups) {
      const avg = group.scores.reduce((a, b) => a + b, 0) / group.scores.length;
      tenantBreakdown[tenantId] = {
        sessions: group.count,
        avgQualityScore: Math.round(avg * 100) / 100,
      };
    }

    return {
      totalSessions,
      filteredSessions,
      avgDurationMs,
      avgTurnCount,
      avgQualityScore,
      totalDecisions,
      decisionBreakdown,
      avgComplianceRate,
      escalationRate,
      tenantBreakdown,
      sessions: paginatedMetrics,
      sentimentDistribution,
      callsPerDay,
      topPolicyViolations,
    };
  }
}
