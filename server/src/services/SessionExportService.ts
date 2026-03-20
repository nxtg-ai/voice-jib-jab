/**
 * SessionExportService — assembles a rich structured export for one or more sessions.
 *
 * Pulls data from SessionRecorder (timeline events), VoiceQualityScorer (0-100 score),
 * and RecordingStore (audio availability). Returns structured exports suitable for
 * compliance audit, analytics, and external integration.
 */

import type { SessionRecorder, SessionRecording } from "./SessionRecorder.js";
import type { RecordingStore } from "./RecordingStore.js";
import type { VoiceQualityScorer } from "./VoiceQualityScorer.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TranscriptTurn {
  speaker: "user" | "assistant";
  text: string;
  timestampMs: number;   // ms offset from session start
  isFinal: boolean;
}

export interface PolicyEvent {
  decision: string;       // "allow" | "refuse" | "escalate" | "rewrite" | "cancel_output"
  reasonCodes: string[];
  severity: number;
  timestampMs: number;
}

export interface SentimentSample {
  sentiment: string;      // "positive" | "negative" | "neutral" | "frustrated"
  score?: number;
  timestampMs: number;
}

export interface SessionExport {
  sessionId: string;
  tenantId?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  transcript: TranscriptTurn[];
  policyDecisions: PolicyEvent[];
  sentiment: SentimentSample[];
  qualityScore?: number;       // 0-100 from VoiceQualityScorer
  recordingUrl?: string;       // /recordings/{sessionId} if recording exists
  metadata: {
    turnCount: number;
    userTurnCount: number;
    assistantTurnCount: number;
    topSentiment?: string;
    escalated: boolean;
    exportedAt: string;
  };
}

export interface BulkExportResult {
  exportedAt: string;
  from?: string;
  to?: string;
  tenantId?: string;
  totalSessions: number;
  sessions: SessionExport[];
}

export interface ExportFilters {
  tenantId?: string;
  from?: string;           // ISO date
  to?: string;             // ISO date
  sessionIds?: string[];   // explicit list overrides date range
  limit?: number;          // default 50, max 500
  offset?: number;
}

// ---------------------------------------------------------------------------
// SessionExportService
// ---------------------------------------------------------------------------

export class SessionExportService {
  constructor(
    private readonly recorder: SessionRecorder,
    private readonly recordingStore: RecordingStore,
    private readonly qualityScorer: VoiceQualityScorer,
  ) {}

  /**
   * Export a single session by ID.
   * Returns null if session recording not found.
   */
  async exportSession(sessionId: string): Promise<SessionExport | null> {
    const recording = this.recorder.loadRecording(sessionId);
    if (!recording) {
      return null;
    }

    const transcript = this.buildTranscript(recording);
    const policyDecisions = this.buildPolicyDecisions(recording);
    const sentiment = this.buildSentiment(recording);

    const scorecard = this.qualityScorer.score(sessionId, recording);
    const qualityScore = scorecard.totalScore;

    const hasAudio = this.recordingStore.hasRecording(sessionId);
    const recordingUrl = hasAudio ? `/recordings/${sessionId}` : undefined;

    const userTurns = transcript.filter((t) => t.speaker === "user");
    const assistantTurns = transcript.filter((t) => t.speaker === "assistant");
    const topSentiment = this.computeTopSentiment(sentiment);
    const escalated = policyDecisions.some((pd) => pd.decision === "escalate");

    const result: SessionExport = {
      sessionId,
      startedAt: recording.startedAt,
      transcript,
      policyDecisions,
      sentiment,
      qualityScore,
      metadata: {
        turnCount: transcript.length,
        userTurnCount: userTurns.length,
        assistantTurnCount: assistantTurns.length,
        topSentiment,
        escalated,
        exportedAt: new Date().toISOString(),
      },
    };

    if (recording.tenantId !== null) {
      result.tenantId = recording.tenantId;
    }

    if (recording.endedAt !== null) {
      result.endedAt = recording.endedAt;
    }

    if (recording.durationMs !== null) {
      result.durationMs = recording.durationMs;
    }

    if (recordingUrl !== undefined) {
      result.recordingUrl = recordingUrl;
    }

    return result;
  }

  /**
   * Bulk export sessions matching the given filters.
   * When sessionIds is provided, only those sessions are exported (date range ignored).
   * Otherwise sessions are filtered by tenantId and from/to date range.
   */
  async exportBulk(filters: ExportFilters): Promise<BulkExportResult> {
    const limit = Math.min(filters.limit ?? 50, 500);
    const offset = filters.offset ?? 0;

    let sessionIds: string[];

    if (filters.sessionIds && filters.sessionIds.length > 0) {
      sessionIds = filters.sessionIds;
    } else {
      const allMeta = this.recorder.listRecordings();
      const filtered = allMeta.filter((meta) => {
        if (filters.tenantId !== undefined && meta.tenantId !== filters.tenantId) {
          return false;
        }
        if (filters.from !== undefined) {
          const startedAt = new Date(meta.startedAt).getTime();
          const from = new Date(filters.from).getTime();
          if (startedAt < from) {
            return false;
          }
        }
        if (filters.to !== undefined) {
          const startedAt = new Date(meta.startedAt).getTime();
          const to = new Date(filters.to).getTime();
          if (startedAt > to) {
            return false;
          }
        }
        return true;
      });
      sessionIds = filtered.map((meta) => meta.sessionId);
    }

    const paginated = sessionIds.slice(offset, offset + limit);

    const exports = await Promise.all(
      paginated.map((id) => this.exportSession(id)),
    );

    const sessions = exports.filter((e): e is SessionExport => e !== null);

    const result: BulkExportResult = {
      exportedAt: new Date().toISOString(),
      totalSessions: sessionIds.length,
      sessions,
    };

    if (filters.from !== undefined) {
      result.from = filters.from;
    }
    if (filters.to !== undefined) {
      result.to = filters.to;
    }
    if (filters.tenantId !== undefined) {
      result.tenantId = filters.tenantId;
    }

    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Extract final transcript turns from the session timeline.
   * Includes user_transcript events (speaker=user) and transcript events (speaker=assistant).
   * Only isFinal=true entries are included.
   */
  private buildTranscript(recording: SessionRecording): TranscriptTurn[] {
    const turns: TranscriptTurn[] = [];

    for (const entry of recording.timeline) {
      const p = entry.payload as Record<string, unknown> | undefined;
      if (!p?.text || typeof p.text !== "string") {
        continue;
      }

      if (entry.type === "user_transcript" && p.isFinal === true) {
        turns.push({
          speaker: "user",
          text: p.text,
          timestampMs: entry.t_ms,
          isFinal: true,
        });
      } else if (entry.type === "transcript" && p.isFinal === true) {
        turns.push({
          speaker: "assistant",
          text: p.text,
          timestampMs: entry.t_ms,
          isFinal: true,
        });
      }
    }

    return turns;
  }

  /**
   * Extract policy decision events from the session timeline.
   * Maps snake_case reason_codes to camelCase reasonCodes.
   */
  private buildPolicyDecisions(recording: SessionRecording): PolicyEvent[] {
    const decisions: PolicyEvent[] = [];

    for (const entry of recording.timeline) {
      if (entry.type !== "policy.decision") {
        continue;
      }

      const p = entry.payload as Record<string, unknown> | undefined;
      if (!p) {
        continue;
      }

      const decision = typeof p.decision === "string" ? p.decision : "unknown";
      const reasonCodes = Array.isArray(p.reason_codes)
        ? (p.reason_codes as string[])
        : [];
      const severity = typeof p.severity === "number" ? p.severity : 0;

      decisions.push({
        decision,
        reasonCodes,
        severity,
        timestampMs: entry.t_ms,
      });
    }

    return decisions;
  }

  /**
   * Extract sentiment events from the session timeline.
   */
  private buildSentiment(recording: SessionRecording): SentimentSample[] {
    const samples: SentimentSample[] = [];

    for (const entry of recording.timeline) {
      if (entry.type !== "sentiment") {
        continue;
      }

      const p = entry.payload as Record<string, unknown> | undefined;
      if (!p) {
        continue;
      }

      const sentiment = typeof p.sentiment === "string" ? p.sentiment : "neutral";
      const score = typeof p.score === "number" ? p.score : undefined;

      const sample: SentimentSample = {
        sentiment,
        timestampMs: entry.t_ms,
      };

      if (score !== undefined) {
        sample.score = score;
      }

      samples.push(sample);
    }

    return samples;
  }

  /**
   * Compute the most frequently occurring sentiment value from a list of samples.
   * Returns undefined if samples is empty.
   */
  private computeTopSentiment(samples: SentimentSample[]): string | undefined {
    if (samples.length === 0) {
      return undefined;
    }

    const counts = new Map<string, number>();
    for (const sample of samples) {
      counts.set(sample.sentiment, (counts.get(sample.sentiment) ?? 0) + 1);
    }

    let topSentiment: string | undefined;
    let topCount = 0;

    for (const [sentiment, count] of counts) {
      if (count > topCount) {
        topCount = count;
        topSentiment = sentiment;
      }
    }

    return topSentiment;
  }
}
