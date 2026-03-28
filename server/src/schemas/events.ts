/**
 * Canonical event schema for Voice Jib-Jab orchestrator
 */

/** Sources that can emit events in the orchestrator pipeline. */
export type EventSource =
  | "client"
  | "orchestrator"
  | "laneA"
  | "laneB"
  | "laneC"
  | "provider"
  | "retriever";

/** Base fields shared by all events in the orchestrator event stream. */
export interface BaseEvent {
  event_id: string;
  session_id: string;
  t_ms: number;
  source: EventSource;
  type: string;
  payload: unknown;
}

// Transcript Events
/** Data carried by transcript.delta and transcript.final events — includes recognized text and timing. */
export interface TranscriptDeltaPayload {
  text: string;
  confidence: number;
  is_final: boolean;
  span_ms: { start: number; end: number };
}

/** Partial or final speech-to-text transcript from the voice provider. */
export interface TranscriptEvent extends BaseEvent {
  type: "transcript.delta" | "transcript.final";
  payload: TranscriptDeltaPayload;
}

// Policy Events
/** Lane C policy evaluation outcome — whether audio is allowed, rewritten, blocked, or escalated. */
export type PolicyDecision =
  | "allow"
  | "rewrite"
  | "refuse"
  | "escalate"
  | "cancel_output";

/** Strategy the orchestrator uses when Lane B output is refused or cancelled by policy. */
export type FallbackMode =
  | "auto"
  | "ask_clarifying_question"
  | "refuse_politely"
  | "switch_to_text_summary"
  | "escalate_to_human"
  | "offer_email_or_link";

/** Data carried by policy.decision events — includes the ruling, reason codes, and optional rewrite text. */
export interface PolicyDecisionPayload {
  decision: PolicyDecision;
  reason_codes: string[];
  safe_rewrite?: string;
  required_disclaimer_id?: string;
  fallback_mode?: FallbackMode;
  severity: number;
}

/** Fired by Lane C after async policy enforcement completes on a piece of content. */
export interface PolicyEvent extends BaseEvent {
  type: "policy.decision";
  source: "laneC";
  payload: PolicyDecisionPayload;
}

// Lane Arbitration Events
/** Active audio lane — which lane currently owns playback output. */
export type Lane = "none" | "A" | "B" | "fallback";
/** Reason the orchestrator triggered a lane ownership transition. */
export type LaneTransitionCause =
  | "b_first_audio_ready"
  | "policy_cancel"
  | "user_barge_in"
  | "response_done"
  | "user_speech_ended";

/** Data carried by lane.owner_changed events — the previous lane, new lane, and trigger cause. */
export interface LaneOwnerChangePayload {
  from: Lane;
  to: Lane;
  cause: LaneTransitionCause;
}

/** Data carried by lane.b_ready events — latency from request to first audio chunk. */
export interface LaneBReadyPayload {
  latency_ms: number;
}

/** Data carried by lane.a_reflex events — the backchannel utterance to play. */
export interface LaneAReflexPayload {
  utterance: string;
}

/** Fired when the orchestrator hands playback ownership from one lane to another. */
export interface LaneOwnerChangedEvent extends BaseEvent {
  type: "lane.owner_changed";
  source: "orchestrator";
  payload: LaneOwnerChangePayload;
}

/** Fired when Lane B has its first audio chunk ready for playback. */
export interface LaneBReadyEvent extends BaseEvent {
  type: "lane.b_ready";
  source: "laneB";
  payload: LaneBReadyPayload;
}

/** Fired when Lane A emits an instant backchannel sound (sub-50ms acknowledgement). */
export interface LaneAReflexEvent extends BaseEvent {
  type: "lane.a_reflex";
  source: "laneA";
  payload: LaneAReflexPayload;
}

/** @deprecated Legacy alias for LaneOwnerChangedEvent — use LaneOwnerChangedEvent directly. */
export type LaneEvent = LaneOwnerChangedEvent;

// Audio Events
/** Raw audio data carried by audio.chunk events — supports PCM and Opus formats. */
export interface AudioChunkPayload {
  chunk?: Buffer;
  data?: Buffer;
  format?: "pcm" | "opus";
  sample_rate?: number;
  sampleRate?: number;
  lane?: Lane;
  size?: number;
}

/** Audio lifecycle event — marks the start, streaming chunks, or end of an audio segment. */
export interface AudioEvent extends BaseEvent {
  type: "audio.chunk" | "audio.start" | "audio.end";
  payload: AudioChunkPayload | { lane?: Lane };
}

// Response Metadata Events
/** Timing and mode data for a Lane B response — emitted at response start and end. */
export interface ResponseMetadataPayload {
  phase: "start" | "end";
  ttfb_ms?: number;
  total_ms?: number;
  voice_mode?: "push-to-talk" | "open-mic";
}

/** Fired by Lane B at the start and end of an OpenAI Realtime API response cycle. */
export interface ResponseMetadataEvent extends BaseEvent {
  type: "response.metadata";
  source: "laneB";
  payload: ResponseMetadataPayload;
}

// Tool Events
/** Data carried by tool.call events — the tool name, arguments, and correlation ID. */
export interface ToolCallPayload {
  tool_name: string;
  args: Record<string, unknown>;
  call_id: string;
}

/** Data carried by tool.result events — the return value or error for a prior tool call. */
export interface ToolResultPayload {
  call_id: string;
  result: unknown;
  error?: string;
}

/** Tool invocation or result — fired when Lane B calls a function tool or receives its output. */
export interface ToolEvent extends BaseEvent {
  type: "tool.call" | "tool.result";
  payload: ToolCallPayload | ToolResultPayload;
}

// RAG Events
/** Data carried by rag.query events — the search text and result limit sent to ChromaDB. */
export interface RAGQueryPayload {
  query: string;
  top_k: number;
}

/** Data carried by rag.result events — retrieved facts, citations, and required disclaimers. */
export interface RAGResultPayload {
  topic: string;
  facts: Array<{
    id: string;
    text: string;
    source: string;
    timestamp: string;
  }>;
  disclaimers: string[];
  citations?: Array<{
    id: string;
    source: string;
    timestamp: string;
    text?: string;
  }>;
}

/** Knowledge retrieval event — query sent to ChromaDB or result returned from the retriever. */
export interface RAGEvent extends BaseEvent {
  type: "rag.query" | "rag.result";
  source: "laneB" | "retriever";
  payload: RAGQueryPayload | RAGResultPayload;
}

// Fallback Events (Orchestrator)
/** Data carried by fallback events — the chosen recovery strategy and its completion status. */
export interface FallbackEventPayload {
  mode: FallbackMode;
  decision?: PolicyDecision;
  reason_codes?: string[];
  utterance?: string;
  output?: "audio" | "text";
  status?: "started" | "completed";
  reason?: "done" | "stopped";
}

/** Fired when the orchestrator activates or completes a fallback recovery after a policy refusal. */
export interface FallbackEvent extends BaseEvent {
  type: "fallback.started" | "fallback.completed";
  source: "orchestrator";
  payload: FallbackEventPayload;
}

// Session Events
/** Session lifecycle event — marks the start, end, or error of a voice session. */
export interface SessionEvent extends BaseEvent {
  type: "session.start" | "session.end" | "session.error";
  source: "orchestrator";
  payload: Record<string, unknown>;
}

// User Events (barge-in, transcripts from speech recognition)
/** Data carried by user transcript events — recognized speech text with confidence score. */
export interface UserTranscriptPayload {
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

/** Client-side speech recognition result — partial or final transcript from the user's microphone. */
export interface UserTranscriptEvent extends BaseEvent {
  type: "transcript" | "user_transcript";
  payload: UserTranscriptPayload;
}

/** Fired when the user interrupts agent playback by speaking — triggers lane transition. */
export interface UserBargeInEvent extends BaseEvent {
  type: "user.barge_in";
  source: "client";
  payload: Record<string, unknown>;
}

// Control / Audit Events (Lane C)
/** Full audit record for a single Lane C policy evaluation — logged for compliance. */
export interface ControlAuditPayload {
  evaluationId: string;
  role: "user" | "assistant";
  textSnippet: string;
  decision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  checksRun: string[];
  durationMs: number;
}

/** Fired by Lane C after every policy evaluation for audit trail and compliance logging. */
export interface ControlAuditEvent extends BaseEvent {
  type: "control.audit";
  source: "laneC";
  payload: ControlAuditPayload;
}

// Control / Override Events (Lane C)
/** Data carried by control.override events — records when severity exceeds the cancel threshold. */
export interface ControlOverridePayload {
  evaluationId: string;
  originalDecision: PolicyDecision;
  effectiveDecision: PolicyDecision;
  reasonCodes: string[];
  severity: number;
  cancelThreshold: number;
}

/** Fired when Lane C overrides a prior decision due to escalated severity or threshold breach. */
export interface ControlOverrideEvent extends BaseEvent {
  type: "control.override";
  source: "laneC";
  payload: ControlOverridePayload;
}

// Control / Metrics Events (Lane C)
/** Aggregated Lane C evaluation statistics — decision counts and latency percentiles. */
export interface ControlMetricsPayload {
  evaluationCount: number;
  allowCount: number;
  rewriteCount: number;
  refuseCount: number;
  escalateCount: number;
  cancelCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

/** Orchestrator state-machine transition audit — logs arbitrator state or owner changes. */
export interface ArbitratorAuditEvent extends BaseEvent {
  type: "arbitration.state.transition" | "arbitration.owner.transition";
  source: "orchestrator";
  payload: {
    from: string;
    to: string;
    trigger: string;
  };
}

/** Periodic summary of Lane C governance activity — emitted for dashboards and alerting. */
export interface ControlMetricsEvent extends BaseEvent {
  type: "control.metrics";
  source: "laneC";
  payload: ControlMetricsPayload;
}

/** Discriminated union of every event type in the orchestrator pipeline. */
export type Event =
  | TranscriptEvent
  | PolicyEvent
  | LaneOwnerChangedEvent
  | LaneBReadyEvent
  | LaneAReflexEvent
  | AudioEvent
  | ResponseMetadataEvent
  | ToolEvent
  | RAGEvent
  | SessionEvent
  | UserTranscriptEvent
  | UserBargeInEvent
  | ControlAuditEvent
  | ControlOverrideEvent
  | ControlMetricsEvent
  | FallbackEvent
  | ArbitratorAuditEvent;
