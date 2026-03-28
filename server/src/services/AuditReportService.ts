/**
 * AuditReportService — generates per-tenant monthly compliance audit reports.
 *
 * Covers all calls, policy decisions, escalations, and quality metrics for
 * a given tenant within a calendar month. Reports are cached in memory and
 * can be rendered as JSON or self-contained HTML (with @media print for
 * browser-native PDF export).
 */

import { v4 as uuidv4 } from "uuid";
import type { SessionRecorder, SessionRecording } from "./SessionRecorder.js";
import type { VoiceQualityScorer } from "./VoiceQualityScorer.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Filter criteria for generating a monthly audit report. */
export interface AuditReportFilters {
  tenantId: string;
  year: number;
  month: number; // 1-12
}

/** Aggregated count and percentage for a single policy decision type. */
export interface PolicyDecisionSummary {
  decision: string;
  count: number;
  pct: number;
}

/** Session count and percentage within a quality score range. */
export interface QualityBand {
  band: "excellent" | "good" | "fair" | "poor"; // 80-100, 60-79, 40-59, 0-39
  count: number;
  pct: number;
}

/** Complete monthly compliance audit report for a tenant. */
export interface AuditReport {
  reportId: string;
  generatedAt: string;
  tenantId: string;
  period: { year: number; month: number; label: string };
  summary: {
    totalSessions: number;
    totalDurationMs: number;
    avgDurationMs: number;
    avgQualityScore: number;
    escalationCount: number;
    escalationRatePct: number;
    refusalCount: number;
    refusalRatePct: number;
  };
  policyDecisions: PolicyDecisionSummary[];
  qualityBands: QualityBand[];
  sentimentBreakdown: Record<string, number>;
  topEscalationReasons: Array<{ reason: string; count: number }>;
  sessionIds: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function classifyBand(score: number): "excellent" | "good" | "fair" | "poor" {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 10000) / 100;
}

function isInMonth(startedAt: string, year: number, month: number): boolean {
  const d = new Date(startedAt);
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
}

// ---------------------------------------------------------------------------
// AuditReportService
// ---------------------------------------------------------------------------

/** Generates and caches per-tenant monthly compliance audit reports. */
export class AuditReportService {
  private cache = new Map<string, AuditReport>();

  constructor(
    private recorder: SessionRecorder,
    private qualityScorer: VoiceQualityScorer,
  ) {}

  /**
   * Generate a monthly audit report for a tenant.
   *
   * Loads all recordings for the tenant in the given calendar month,
   * scores each session, computes aggregate stats, and caches the result.
   *
   * @param filters - tenantId, year, month (1-12)
   * @returns Fully populated AuditReport
   */
  async generateReport(filters: AuditReportFilters): Promise<AuditReport> {
    const { tenantId, year, month } = filters;

    // Enumerate all recordings and filter to this tenant + month
    const allRecordings = this.recorder.listRecordings();
    const relevantMeta = allRecordings.filter(
      (r) => r.tenantId === tenantId && isInMonth(r.startedAt, year, month),
    );

    // Load full recordings so we have timelines for escalation reason extraction
    const recordings: SessionRecording[] = [];
    for (const meta of relevantMeta) {
      const full = this.recorder.loadRecording(meta.sessionId);
      if (full !== null) {
        recordings.push(full);
      }
    }

    const totalSessions = recordings.length;
    let totalDurationMs = 0;
    let totalQualityScore = 0;
    let escalationCount = 0;
    let refusalCount = 0;

    const decisionTotals: Record<string, number> = {};
    const qualityBandCounts: Record<"excellent" | "good" | "fair" | "poor", number> = {
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0,
    };
    const sentimentBreakdown: Record<string, number> = {};
    const escalationReasonCounts: Map<string, number> = new Map();
    const sessionIds: string[] = [];

    for (const recording of recordings) {
      sessionIds.push(recording.sessionId);

      // Duration
      totalDurationMs += recording.durationMs ?? 0;

      // Quality score
      const scorecard = this.qualityScorer.score(recording.sessionId, recording);
      totalQualityScore += scorecard.totalScore;

      // Quality band
      const band = classifyBand(scorecard.totalScore);
      qualityBandCounts[band]++;

      // Policy decisions
      for (const [decision, count] of Object.entries(recording.summary.policyDecisions)) {
        decisionTotals[decision] = (decisionTotals[decision] ?? 0) + count;
      }

      // Escalation and refusal counts
      escalationCount += recording.summary.policyDecisions.escalate ?? 0;
      refusalCount += recording.summary.policyDecisions.refuse ?? 0;

      // Sentiment
      const dominant = recording.summary.sentiment?.dominantSentiment;
      if (dominant) {
        sentimentBreakdown[dominant] = (sentimentBreakdown[dominant] ?? 0) + 1;
      }

      // Escalation reasons from timeline
      for (const entry of recording.timeline) {
        if (entry.type !== "policy.decision") continue;
        const payload = entry.payload as Record<string, unknown> | undefined;
        if (!payload) continue;
        const decision = payload.decision as string | undefined;
        if (decision !== "escalate") continue;
        const reason =
          (payload.reasonCode as string | undefined) ??
          (payload.reason as string | undefined) ??
          "unknown";
        escalationReasonCounts.set(reason, (escalationReasonCounts.get(reason) ?? 0) + 1);
      }
    }

    // Build policyDecisions summary
    const totalAllDecisions = Object.values(decisionTotals).reduce((s, c) => s + c, 0);
    const policyDecisions: PolicyDecisionSummary[] = Object.entries(decisionTotals)
      .map(([decision, count]) => ({
        decision,
        count,
        pct: pct(count, totalAllDecisions),
      }))
      .sort((a, b) => b.count - a.count);

    // Build quality bands
    const qualityBands: QualityBand[] = (["excellent", "good", "fair", "poor"] as const).map(
      (band) => ({
        band,
        count: qualityBandCounts[band],
        pct: pct(qualityBandCounts[band], totalSessions),
      }),
    );

    // Top 5 escalation reasons
    const topEscalationReasons = Array.from(escalationReasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const avgDurationMs = totalSessions === 0 ? 0 : totalDurationMs / totalSessions;
    const avgQualityScore = totalSessions === 0 ? 0 : totalQualityScore / totalSessions;
    const escalationRatePct = pct(escalationCount, totalSessions);
    const refusalRatePct = pct(refusalCount, totalSessions);

    const report: AuditReport = {
      reportId: uuidv4(),
      generatedAt: new Date().toISOString(),
      tenantId,
      period: { year, month, label: monthLabel(year, month) },
      summary: {
        totalSessions,
        totalDurationMs,
        avgDurationMs,
        avgQualityScore,
        escalationCount,
        escalationRatePct,
        refusalCount,
        refusalRatePct,
      },
      policyDecisions,
      qualityBands,
      sentimentBreakdown,
      topEscalationReasons,
      sessionIds,
    };

    this.cache.set(report.reportId, report);
    return report;
  }

  /**
   * Render a fully self-contained HTML audit report.
   *
   * Includes electric blue design system, summary stats, policy decision
   * breakdown, quality band chart, sentiment breakdown, escalation reasons,
   * session list, and a print button.
   *
   * @param report - The AuditReport to render
   * @returns Full HTML document string
   */
  generateHtml(report: AuditReport): string {
    const fmt = (n: number, decimals = 1) => n.toFixed(decimals);
    const fmtMs = (ms: number) => `${fmt(ms / 1000)}s`;

    const decisionRows = report.policyDecisions
      .map(
        (d) => `
      <tr>
        <td>${escapeHtml(d.decision)}</td>
        <td class="num">${d.count}</td>
        <td class="num">${fmt(d.pct)}%</td>
        <td class="bar-cell"><div class="bar" style="width:${Math.min(d.pct, 100)}%"></div></td>
      </tr>`,
      )
      .join("");

    const bandColors: Record<string, string> = {
      excellent: "#00d4ff",
      good: "#0096cc",
      fair: "#f59e0b",
      poor: "#ef4444",
    };

    const bandRows = report.qualityBands
      .map(
        (b) => `
      <tr>
        <td><span class="badge" style="background:${bandColors[b.band]}">${b.band}</span></td>
        <td class="num">${b.count}</td>
        <td class="num">${fmt(b.pct)}%</td>
        <td class="bar-cell"><div class="bar" style="width:${Math.min(b.pct, 100)}%;background:${bandColors[b.band]}"></div></td>
      </tr>`,
      )
      .join("");

    const sentimentEntries = Object.entries(report.sentimentBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([label, count]) => `
      <li><span class="sentiment-label">${escapeHtml(label)}</span> <span class="num">${count}</span></li>`,
      )
      .join("");

    const escalationRows = report.topEscalationReasons
      .map(
        (e, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(e.reason)}</td>
        <td class="num">${e.count}</td>
      </tr>`,
      )
      .join("");

    const sessionList = report.sessionIds
      .map((id) => `<li class="session-id">${escapeHtml(id)}</li>`)
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audit Report — ${escapeHtml(report.tenantId)} — ${escapeHtml(report.period.label)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --blue: #00d4ff;
      --blue-dark: #0096cc;
      --bg: #0a0f1e;
      --surface: #111827;
      --surface2: #1e2a3a;
      --text: #e2e8f0;
      --text-muted: #8ba3bc;
      --border: #1e3a5f;
      --danger: #ef4444;
      --warn: #f59e0b;
    }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }
    h1 { font-size: 1.75rem; color: var(--blue); margin-bottom: 0.25rem; }
    h2 { font-size: 1.1rem; color: var(--blue); margin: 2rem 0 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    .header { margin-bottom: 2rem; }
    .header .meta { color: var(--text-muted); font-size: 0.875rem; margin-top: 0.25rem; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
    }
    .stat-card .label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-card .value { font-size: 1.5rem; font-weight: 700; color: var(--blue); margin-top: 0.25rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }
    th {
      background: var(--surface2);
      color: var(--text-muted);
      text-align: left;
      padding: 0.5rem 0.75rem;
      font-weight: 600;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    tr:hover td { background: var(--surface2); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bar-cell { width: 180px; }
    .bar {
      height: 10px;
      background: var(--blue);
      border-radius: 2px;
      min-width: 2px;
    }
    .badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      color: #000;
      text-transform: capitalize;
    }
    .sentiment-label { text-transform: capitalize; color: var(--text-muted); }
    ul.sentiment-list { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; }
    ul.sentiment-list li { background: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; }
    .session-list { list-style: none; font-family: monospace; font-size: 0.75rem; color: var(--text-muted); column-count: 2; column-gap: 1rem; }
    .session-id { padding: 0.1rem 0; }
    .print-btn {
      display: inline-block;
      margin-top: 2rem;
      padding: 0.6rem 1.5rem;
      background: var(--blue);
      color: #000;
      font-weight: 700;
      border: none;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.875rem;
      letter-spacing: 0.025em;
    }
    .print-btn:hover { background: var(--blue-dark); color: #fff; }

    @media print {
      .no-print { display: none !important; }
      body { background: #fff; color: #111; padding: 1cm; }
      :root { --bg: #fff; --surface: #f9fafb; --surface2: #f3f4f6; --text: #111; --text-muted: #6b7280; --border: #e5e7eb; --blue: #0070cc; --blue-dark: #005fa3; }
      h1 { color: var(--blue); }
      h2 { color: var(--blue); }
      .stat-card .value { color: var(--blue); }
      table { page-break-inside: avoid; }
      .bar { background: var(--blue); }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Voice Agent Audit Report</h1>
    <div class="meta">
      Tenant: <strong>${escapeHtml(report.tenantId)}</strong>
      &nbsp;|&nbsp;
      Period: <strong>${escapeHtml(report.period.label)}</strong>
      &nbsp;|&nbsp;
      Generated: ${escapeHtml(report.generatedAt)}
      &nbsp;|&nbsp;
      Report ID: <code>${escapeHtml(report.reportId)}</code>
    </div>
  </div>

  <h2>Summary</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="label">Total Sessions</div>
      <div class="value">${report.summary.totalSessions}</div>
    </div>
    <div class="stat-card">
      <div class="label">Total Duration</div>
      <div class="value">${fmtMs(report.summary.totalDurationMs)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg Duration</div>
      <div class="value">${fmtMs(report.summary.avgDurationMs)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg Quality</div>
      <div class="value">${fmt(report.summary.avgQualityScore)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Escalations</div>
      <div class="value">${report.summary.escalationCount}</div>
    </div>
    <div class="stat-card">
      <div class="label">Escalation Rate</div>
      <div class="value">${fmt(report.summary.escalationRatePct)}%</div>
    </div>
    <div class="stat-card">
      <div class="label">Refusals</div>
      <div class="value">${report.summary.refusalCount}</div>
    </div>
    <div class="stat-card">
      <div class="label">Refusal Rate</div>
      <div class="value">${fmt(report.summary.refusalRatePct)}%</div>
    </div>
  </div>

  <h2>Policy Decision Breakdown</h2>
  ${
    report.policyDecisions.length === 0
      ? '<p style="color:var(--text-muted)">No policy decisions recorded.</p>'
      : `<table>
    <thead>
      <tr><th>Decision</th><th>Count</th><th>%</th><th>Distribution</th></tr>
    </thead>
    <tbody>${decisionRows}</tbody>
  </table>`
  }

  <h2>Quality Band Distribution</h2>
  <table>
    <thead>
      <tr><th>Band</th><th>Sessions</th><th>%</th><th>Distribution</th></tr>
    </thead>
    <tbody>${bandRows}</tbody>
  </table>

  <h2>Sentiment Breakdown</h2>
  ${
    Object.keys(report.sentimentBreakdown).length === 0
      ? '<p style="color:var(--text-muted)">No sentiment data recorded.</p>'
      : `<ul class="sentiment-list">${sentimentEntries}</ul>`
  }

  <h2>Top Escalation Reasons</h2>
  ${
    report.topEscalationReasons.length === 0
      ? '<p style="color:var(--text-muted)">No escalations recorded.</p>'
      : `<table>
    <thead>
      <tr><th>#</th><th>Reason</th><th>Count</th></tr>
    </thead>
    <tbody>${escalationRows}</tbody>
  </table>`
  }

  <h2>Sessions in Period (${report.sessionIds.length})</h2>
  ${
    report.sessionIds.length === 0
      ? '<p style="color:var(--text-muted)">No sessions in this period.</p>'
      : `<ul class="session-list">${sessionList}</ul>`
  }

  <div class="no-print">
    <button class="print-btn" onclick="window.print()">Export PDF</button>
  </div>
</body>
</html>`;
  }

  /**
   * Return all reports that have been generated and cached in this process lifetime.
   *
   * @returns Array of AuditReport objects, most recent first
   */
  listReports(): AuditReport[] {
    return Array.from(this.cache.values()).sort(
      (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );
  }

  /**
   * Retrieve a specific cached report by its reportId.
   *
   * @param reportId - The UUID assigned at report generation
   * @returns AuditReport or undefined if not found
   */
  getReport(reportId: string): AuditReport | undefined {
    return this.cache.get(reportId);
  }
}

// ---------------------------------------------------------------------------
// Internal util
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
