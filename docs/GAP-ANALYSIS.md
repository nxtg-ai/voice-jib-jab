# Voice Jib-Jab Gap Analysis

**Date:** 2026-01-10 (initial) | **Last Updated:** 2026-03-26
**Compared Against:** `docs/PROJECT-SPEC.md` and `spec-jib-jab.md`

---

## Executive Summary

**All gaps identified in this analysis have been resolved.** As of 2026-03-26, all 4 milestones are shipped, all 66/66 initiatives are complete, and test coverage stands at 97.24% stmt / 92.71% branch (4,998 tests / 153 suites). All 5 UAT bugs were fixed and verified 2026-03-12.

The original gaps were:

1. ~~No cross-session conversation persistence~~ -- **RESOLVED** (ChromaDB persistent memory)
2. ~~No server-side conversation history storage~~ -- **RESOLVED** (AuditTrail + TranscriptStore)
3. ~~Milestone 3 (Control Plane) is NOT implemented~~ -- **RESOLVED** (Lane C shipped)
4. ~~Milestone 4 (RAG Integration) is NOT implemented~~ -- **RESOLVED** (RAG pipeline shipped)

---

## Implementation Status Table

### Milestone 1: Voice Loop MVP

| Feature                    | Status  | Notes                                                        |
| -------------------------- | ------- | ------------------------------------------------------------ |
| Browser mic capture        | ✅ Done | `MicrophoneCapture.ts` - Float32 to PCM16 conversion working |
| Provider adapter connected | ✅ Done | `OpenAIRealtimeAdapter.ts` - Full WebSocket implementation   |
| Streaming audio playback   | ✅ Done | `AudioPlayback.ts` - Web Audio API with queue management     |
| Basic barge-in             | ✅ Done | `user.barge_in` message handling, audio stops immediately    |
| TTFB/Latency metrics       | ✅ Done | `LatencyBudget.ts` - p50/p95/p99 calculations                |

**Milestone 1: COMPLETE** ✅

---

### Milestone 2: Lane Arbitration

| Feature                      | Status  | Notes                                                              |
| ---------------------------- | ------- | ------------------------------------------------------------------ |
| Lane A reflex implementation | ✅ Done | `LaneA.ts` - TTS audio cache, whitelist phrases                    |
| Lane B reasoning wrapper     | ✅ Done | `LaneB.ts` - Wraps OpenAI adapter with first-audio detection       |
| Lane B preemption            | ✅ Done | `LaneArbitrator.ts` - B preempts A on `b_first_audio_ready`        |
| State machine validation     | ✅ Done | States: IDLE, LISTENING, A_PLAYING, B_RESPONDING, B_PLAYING, ENDED |
| No audio overlap             | ✅ Done | Single audio owner enforced via arbitrator                         |

**Milestone 2: COMPLETE** ✅

---

### Milestone 3: Control Plane (Lane C)

| Feature                    | Status     | Notes                                        |
| -------------------------- | ---------- | -------------------------------------------- |
| Transcript collection      | ✅ Done | Persisted via AuditTrail + TranscriptStore |
| PolicyGate stub            | ✅ Done | Full implementation shipped                 |
| Moderator (allow/refuse)   | ✅ Done | Implemented                                |
| ClaimsChecker              | ✅ Done | Implemented                                |
| PIIRedactor                | ✅ Done | Implemented                                |
| OverrideController         | ✅ Done | Implemented                                |
| Audit timeline             | ✅ Done | Persistent audit trail                     |
| AuditTrail module          | ✅ Done | Created and tested                         |
| FallbackPlanner            | ✅ Done | Created and tested                         |
| Policy cancel stops Lane B | ✅ Done | Lane C triggers cancellation               |

**Milestone 3: COMPLETE** ✅

---

### Milestone 4: RAG Integration

| Feature                   | Status     | Notes                                         |
| ------------------------- | ---------- | --------------------------------------------- |
| NextGen AI Knowledge Pack | ✅ Done | Knowledge pack loaded and indexed    |
| Vector store integration  | ✅ Done | ChromaDB integration shipped         |
| Retrieval tool definition | ✅ Done | Tool schemas and implementation done |
| Facts pack injection      | ✅ Done | RAG pipeline operational             |
| retrieve_nxtg_facts tool  | ✅ Done | Implemented                          |
| lookup_disclaimer tool    | ✅ Done | Implemented                          |
| Grounded responses        | ✅ Done | Responses use knowledge pack         |

**Milestone 4: COMPLETE** ✅

---

### Insurance Modules

| Module                | Status     | File Path                                                 |
| --------------------- | ---------- | --------------------------------------------------------- |
| LatencyBudget         | ✅ Done | `/server/src/insurance/LatencyBudget.ts`         |
| PolicyGate            | ✅ Done | Implemented and tested                           |
| AllowedClaimsRegistry | ✅ Done | Data loaded, claims validation operational       |
| AuditTrail            | ✅ Done | Append-only event log with FK integrity          |
| FallbackPlanner       | ✅ Done | Safe fallback strategies implemented             |

---

## Critical Gap: Persistent Memory / Conversation Context

### What the User Reported

> "There is no persistent memory with this voice chat"

### Root Cause Analysis

1. **Within-Session Memory: Works (via OpenAI)**
   - OpenAI Realtime API maintains conversation context during a single WebSocket connection
   - The session includes conversation turns automatically

2. **Cross-Session Memory: Does NOT Work**
   - When WebSocket closes, OpenAI session ends
   - No server-side transcript storage
   - No conversation history database
   - On reconnect, AI has zero memory of previous conversations

3. **Missing Components for Memory:**

   | Component              | Purpose                       | Status     |
   | ---------------------- | ----------------------------- | ---------- |
   | Transcript persistence | Store user/assistant text     | ❌ Missing |
   | Session history DB     | PostgreSQL/SQLite for history | ❌ Missing |
   | Context injection      | Add history to system prompt  | ❌ Missing |
   | Summary generation     | Compress old conversations    | ❌ Missing |

### Evidence from Code

```typescript
// SessionManager.ts - Session data is in-memory only
private sessions: Map<string, Session>;  // Lost on server restart

// EventBus.ts - Events are emitted but never persisted
emit(event: Event): void {
  this.emitter.emit(event.type, event);  // No storage
}

// websocket.ts - Transcripts forwarded to client, not stored
laneB.on("transcript", (segment) => {
  this.sendToClient(ws, { type: "transcript", ... });  // Gone after send
});
```

---

## Priority Ranking for Missing Features

### Priority 1: Critical (Blocks User Experience)

| Feature                          | Impact                              | Effort |
| -------------------------------- | ----------------------------------- | ------ |
| Conversation History Persistence | User expects memory across sessions | Medium |
| Transcript Storage (AuditTrail)  | Required for history + compliance   | Medium |
| Context Injection on Reconnect   | Resume conversations naturally      | Low    |

### Priority 2: High (Core Spec Compliance)

| Feature         | Impact                                | Effort |
| --------------- | ------------------------------------- | ------ |
| RAG Integration | Grounded responses, knowledge queries | High   |
| PolicyGate      | Safety controls                       | Medium |
| FallbackPlanner | Graceful error handling               | Low    |

### Priority 3: Medium (Production Readiness)

| Feature                      | Impact                  | Effort |
| ---------------------------- | ----------------------- | ------ |
| PIIRedactor                  | Privacy compliance      | Medium |
| ClaimsChecker                | Prevent false claims    | Medium |
| AllowedClaimsRegistry loader | Use existing data files | Low    |

### Priority 4: Low (Nice to Have)

| Feature                      | Impact                | Effort    |
| ---------------------------- | --------------------- | --------- |
| Full observability dashboard | Metrics visualization | High      |
| Multi-agent workflows        | Future feature        | Very High |

---

## Files/Modules That Need Work

### New Files Required

```
/server/src/
  ├── insurance/
  │   ├── PolicyGate.ts         # Decision engine
  │   ├── AuditTrail.ts         # Append-only event log
  │   ├── FallbackPlanner.ts    # Safe fallback strategies
  │   └── index.ts              # Module exports
  ├── lanes/
  │   └── LaneC.ts              # Control engine
  ├── retrieval/
  │   ├── VectorStore.ts        # ChromaDB/Pinecone client
  │   ├── KnowledgePack.ts      # Load and query facts
  │   └── RAGPipeline.ts        # Orchestrate retrieval
  └── storage/
      ├── TranscriptStore.ts    # Persist transcripts
      ├── SessionHistory.ts     # Cross-session memory
      └── Database.ts           # SQLite/PostgreSQL adapter
```

### Existing Files Needing Modification

| File                         | Changes Needed                              |
| ---------------------------- | ------------------------------------------- |
| `websocket.ts`               | Add Lane C integration, persist transcripts |
| `LaneB.ts`                   | Add RAG injection before responses          |
| `SessionManager.ts` (server) | Add history retrieval on session create     |
| `OpenAIRealtimeAdapter.ts`   | Add context injection to system prompt      |
| `config/index.ts`            | Add database config, RAG settings           |

---

## Recommendations for Next Steps

### Immediate: Fix "No Memory" Issue

1. **Create `/server/src/storage/TranscriptStore.ts`**
   - SQLite for simplicity (file-based, no setup)
   - Store: session_id, timestamp, role (user/assistant), text

2. **Create `/server/src/storage/SessionHistory.ts`**
   - Track user identity (via client fingerprint or token)
   - Retrieve last N turns on session start

3. **Modify `OpenAIRealtimeAdapter.createSession()`**
   - Inject conversation summary into `instructions` field
   - Example: "Previous conversation summary: [User asked about X, you explained Y]"

### Short-term: Milestone 3 Implementation

1. Create `LaneC.ts` - Control engine skeleton
2. Create `AuditTrail.ts` - JSONL file append for now
3. Wire transcript events to AuditTrail
4. Implement basic PolicyGate (pattern matching)

### Medium-term: Milestone 4 Implementation

1. Set up ChromaDB locally (Docker)
2. Create `VectorStore.ts` adapter
3. Index knowledge pack on startup
4. Add `retrieve_nxtg_facts` tool to OpenAI session
5. Inject RAG results into Lane B prompts

---

## Architecture Diagram: Current vs. Spec

### Current State

```
Client ──WebSocket──> Orchestrator ──> OpenAI Realtime
                           │
                      EventBus (in-memory)
                           │
                    Lane A ─── Lane B
                         (No Lane C)
                         (No Storage)
                         (No RAG)
```

### Target State (Per Spec)

```
Client ──WebSocket──> Orchestrator ──> OpenAI Realtime
                           │
                      EventBus ──> AuditTrail (persistent)
                           │
    Lane A ─── Lane B ─── Lane C (PolicyGate, Claims, PII)
                 │
           RAG Pipeline ──> VectorStore ──> Knowledge Pack
```

---

## Conclusion

**All gaps have been closed.** As of 2026-03-26, the project is production-ready with all 4 milestones shipped, all insurance modules implemented, and all 5 UAT bugs resolved. Test coverage is at 97.24% stmt / 92.71% branch across 4,998 tests / 153 suites. 66/66 initiatives complete.

This document is retained for historical reference.
