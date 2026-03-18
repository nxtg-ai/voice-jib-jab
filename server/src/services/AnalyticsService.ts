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

import type { SessionRecording } from "./SessionRecorder.js";

// ── Public types ──────────────────────────────────────────────────────

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

export interface TenantBreakdownEntry {
  sessions: number;
  avgQualityScore: number;
}

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
}

export interface AnalyticsFilter {
  tenantId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

// ── Recording shape consumed by this service ─────────────────────────

type RecordingMetadata = Omit<SessionRecording, "timeline">;

interface RecordingSource {
  listRecordings(): RecordingMetadata[];
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

    return this.buildAggregates(totalSessions, filteredSessions, allFilteredMetrics, sessionMetrics);
  }

  private buildAggregates(
    totalSessions: number,
    filteredSessions: number,
    allMetrics: SessionMetrics[],
    paginatedMetrics: SessionMetrics[],
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
    };
  }
}
