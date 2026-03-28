# Voice Jib-Jab Architecture Documentation

**Project**: Voice Jib-Jab - Enterprise Voice AI Platform
**Last Updated**: 2026-03-26
**Status**: Production-Ready (66/66 initiatives shipped)

## Overview

Voice Jib-Jab is a real-time voice AI platform built on OpenAI's Realtime API with a lane-based orchestration architecture. It achieves sub-400ms time-to-first-byte through intelligent preemption and state machine coordination.

## Architecture Documents

### Core Architecture

#### [Buffer Synchronization](./buffer-synchronization.md)
**Priority**: Critical (Production Blocker - RESOLVED)
**Status**: Implemented

Fixed critical race condition in OpenAI Realtime API integration. Implemented confirmation-based protocol with 3-layer guard system to eliminate `input_audio_buffer_commit_empty` errors.

**Key Features**:
- Confirmation protocol: Defer `response.create` until `buffer.committed`
- 3-layer guards: 100ms minimum duration, 50ms safety window, VAD confirmation
- Semantic duration calculation: Convert bytes → milliseconds
- Error recovery: Boolean return value propagation

**Impact**: Eliminated 100% of buffer commit errors

---

#### [State Machine Resilience](./state-machine-resilience.md)
**Priority**: Critical (Production Stability)
**Status**: Implemented

Enhanced LaneArbitrator state machine to handle all possible state transitions gracefully. Implemented comprehensive 4-case handler and error recovery mechanisms.

**Key Features**:
- 4-case comprehensive handler for all `response.done` scenarios
- Response in-progress guard to prevent overlapping cycles
- Error recovery via `resetResponseInProgress()`
- Defensive reset for unexpected states

**Impact**: 100% state transition coverage, zero unexpected warnings

---

### System Components

#### Lane-Based Orchestration

**Architecture Pattern**: Three-lane system with state machine arbitration

```
┌─────────────────────────────────────────────────────────┐
│                    Lane Architecture                     │
└─────────────────────────────────────────────────────────┘

┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Lane A     │   │   Lane B     │   │   Lane C     │
│   (Reflex)   │   │  (Reasoning) │   │  (Control)   │
└──────────────┘   └──────────────┘   └──────────────┘
      │                    │                    │
  Filler sounds     OpenAI GPT-4o         OPA WASM
  < 50ms            < 400ms TTFB          < 1ms eval
      │                    │                    │
      └────────────┬───────┴────────────────────┘
                   │
           ┌──────▼──────┐
           │     Lane     │
           │  Arbitrator  │
           └─────────────┘
```

**Components**:
1. **Lane A (Reflex)**: Immediate natural filler sounds (< 50ms)
2. **Lane B (Reasoning)**: OpenAI Realtime API responses (< 400ms TTFB)
3. **Lane C (Control)**: OPA WASM policy engine, moderation, audit trail, claims verification
4. **LaneArbitrator**: State machine orchestrating audio ownership

**Preemption Logic**:
- Lane A starts if Lane B not ready within 100ms
- Lane B preempts Lane A immediately when first audio arrives
- 10ms transition gap to prevent audio clicks

---

#### WebSocket Communication

**Protocol**: Custom protocol over WebSocket for bidirectional audio streaming

**Client → Server Messages**:
- `audio.chunk`: PCM16 audio data (24kHz, mono)
- `audio.commit`: Finalize current utterance
- `audio.cancel`: Cancel current response (barge-in)
- `settings.update`: Change voice mode, model, etc.

**Server → Client Messages**:
- `audio.chunk`: Response audio from OpenAI
- `transcript.delta`: Partial transcription
- `transcript.done`: Complete transcription
- `commit.skipped`: Commit guard rejected (buffer too small)
- `session.ready`: Connection established

---

#### OpenAI Realtime Adapter

**File**: `server/src/providers/OpenAIRealtimeAdapter.ts`

**Responsibilities**:
- Manage WebSocket connection to OpenAI Realtime API
- Track buffer state (local vs remote synchronization)
- Implement guard clauses for commit safety
- Handle confirmation protocol
- Forward audio/transcript events

**Critical Features**:
- `BufferState` tracking: `localBytes`, `lastAppendTime`, `speechDetected`, `pendingCommit`
- `getBufferDurationMs()`: Semantic duration calculation
- `commitAudio()`: 3-layer guard system with confirmation
- Error recovery: Graceful degradation on failures

---

## System Flow Diagrams

### Happy Path: User Utterance → AI Response

```
┌──────────────────────────────────────────────────────────────┐
│ 1. User Speaking                                             │
└──────────────────────────────────────────────────────────────┘
    Client captures audio (48kHz) → Resample to 24kHz
                  ↓
    Send via WebSocket: audio.chunk (every 100ms)
                  ↓
    Server forwards to OpenAI: input_audio_buffer.append
                  ↓
    OpenAI VAD detects speech: input_audio_buffer.speech_started
                  ↓
              speechDetected = true

┌──────────────────────────────────────────────────────────────┐
│ 2. User Finishes Speaking                                    │
└──────────────────────────────────────────────────────────────┘
    User releases button → Client sends: audio.commit
                  ↓
    Arbitrator: LISTENING → B_RESPONDING
                  ↓
    Server calls commitAudio():
      - Guard 1: Duration ≥ 100ms? ✅
      - Guard 2: Wait 50ms safety window ✅
      - Guard 3: VAD confirmed? ✅
      - Send: input_audio_buffer.commit
      - pendingCommit = true
                  ↓
    OpenAI confirms: input_audio_buffer.committed
                  ↓
    NOW send: response.create
                  ↓
    OpenAI starts generating response...

┌──────────────────────────────────────────────────────────────┐
│ 3. AI Response Generation                                    │
└──────────────────────────────────────────────────────────────┘
    OpenAI: response.audio_transcript.delta (text streaming)
                  ↓
    OpenAI: response.audio.delta (first audio chunk!)
                  ↓
    LaneB: first_audio_ready event
                  ↓
    Arbitrator: B_RESPONDING → B_PLAYING
                  ↓
    Forward audio chunks to client
                  ↓
    Client plays audio through speakers
                  ↓
    OpenAI: response.audio_transcript.done
                  ↓
    OpenAI: response.done
                  ↓
    Arbitrator: B_PLAYING → LISTENING (ready for next utterance)
```

### Edge Case: Commit Failure → Error Recovery

```
┌──────────────────────────────────────────────────────────────┐
│ User speaks < 100ms (too short)                              │
└──────────────────────────────────────────────────────────────┘
    Client sends: audio.commit (47ms of audio)
                  ↓
    Arbitrator: LISTENING → B_RESPONDING
                  ↓
    Server calls commitAudio():
      - Guard 1: 47ms < 100ms ❌ REJECT
      - resetBufferState()
      - return false
                  ↓
    WebSocket handler sees false:
      - arbitrator.resetResponseInProgress()
      - Send to client: commit.skipped
                  ↓
    Arbitrator: B_RESPONDING → LISTENING (error recovery)
                  ↓
    Client ready for next utterance (no error modal)
```

---

## Key Metrics & Performance

### Target Performance (Production)

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| TTFB (Lane B) | < 400ms | ~200ms p50 | ✅ |
| Lane A Latency | < 100ms | ~50ms | ✅ |
| Error Rate | < 0.5% | ~0% | ✅ |
| Buffer Commit Success | > 99% | 100% | ✅ |
| WebSocket Uptime | > 99.9% | 99.9%+ | ✅ |
| Concurrent Sessions | 100+ | 200 tested | ✅ |

### Quality Gates

| Gate | Status | Details |
|------|--------|---------|
| Test Coverage (97%+) | ✅ PASSED | 4,998 tests, 153 suites |
| Statement Coverage | ✅ 97.24% | Floor: 88% |
| Branch Coverage | ✅ 92.71% | Floor: 78% |
| Function Coverage | ✅ 96.83% | Floor: 87% |
| Line Coverage | ✅ 97.49% | Floor: 88% |
| Performance Tests | ✅ PASSED | 200 concurrent, p95 126ms |
| Security Audit | ✅ PASSED | 0 production vulnerabilities |
| Load Testing | ✅ PASSED | 200 sessions, sub-SLA latency |

---

## Technical Stack

### Client
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 5
- **Styling**: Tailwind CSS 3.4 (utility-first)
- **Audio**: Web Audio API + MediaRecorder
- **State**: React Context + Custom Hooks

### Server
- **Runtime**: Node.js 18+ (LTS)
- **Language**: TypeScript 5
- **Framework**: Express 4
- **WebSocket**: ws library
- **Audio Processing**: Buffer resampling (48kHz → 24kHz)

### External Services
- **Voice AI**: OpenAI Realtime API (gpt-4o-realtime-preview)
- **Audio Format**: PCM16, 24kHz, mono
- **Transport**: WebSocket (bidirectional streaming)

---

## Design System

### Color Palette (Enterprise Blue)

```
Primary: Electric Blue #4A6CF7
  - 50:  #EEF2FF
  - 500: #4A6CF7 (Brand)
  - 900: #1E3A8A

Surface: Slate
  - 50:  #F8FAFC (Light mode background)
  - 900: #0F172A (Dark mode background)

Accent: Purple #9333EA (Gradients only)
Success: Green #10B981
Warning: Amber #F59E0B
Error: Red #EF4444
```

### Typography

- **Headings**: Inter (sans-serif)
- **Body**: Inter (sans-serif)
- **Code**: JetBrains Mono (monospace)

### Component Library

- Navigation (enterprise navbar)
- VoiceInterface (hold-to-talk button)
- PerformanceShowcase (metrics dashboard)
- TrustSignals (client logos, certifications)
- DebugOverlay (development only)

---

## Security Considerations

### Authentication (Future)
- **Method**: OAuth 2.0 with JWT
- **Providers**: Google, Microsoft, GitHub
- **Session**: HTTP-only cookies, 7-day expiry

### API Security
- **Rate Limiting**: 100 requests/minute per IP
- **CORS**: Whitelist production domains only
- **Headers**: X-Frame-Options, CSP, HSTS

### Data Privacy
- **Audio**: Never stored permanently (ephemeral processing only)
- **Transcripts**: Logged for debugging (7-day retention)
- **PII**: No personal data collected (GDPR compliant)

---

## Monitoring & Observability

### Error Tracking
- **Service**: Sentry
- **Coverage**: Client + Server
- **Sample Rate**: 10% of transactions
- **Replay**: 10% of sessions (100% on error)

### Performance Monitoring
- **Metrics**: CloudWatch (AWS)
- **Custom Metrics**:
  - TTFB (Lane B)
  - Concurrent sessions
  - Buffer commit success rate
  - WebSocket connection duration

### Alerting
- **High Error Rate**: > 5% for 10 minutes
- **High Latency**: TTFB > 500ms for 10 minutes
- **Service Down**: Health check fails 3 consecutive times

---

## Development Workflow

### Local Development

```bash
# Install dependencies
npm install

# Start dev servers (both client and server)
npm run dev

# Run tests
npm test

# Run linter
npm run lint

# Type check
npm run type-check
```

### Testing Strategy

**Testing Pyramid**:
- **70% Unit Tests**: Individual functions, guards, calculations
- **20% Integration Tests**: Multi-component flows, WebSocket communication
- **10% E2E Tests**: Full user journeys, cross-browser compatibility

**Priority**:
1. **P0 (Critical)**: OpenAIRealtimeAdapter, LaneArbitrator (0% → 85%)
2. **P1 (High)**: WebSocket handlers, voice pipeline integration
3. **P2 (Medium)**: UI components, state management

### Git Workflow

**Branches**:
- `main`: Production-ready code
- `develop`: Integration branch
- `feature/*`: Feature branches
- `hotfix/*`: Emergency fixes

**Commit Convention**:
```
feat: Add new feature
fix: Bug fix
docs: Documentation update
refactor: Code refactoring
test: Add tests
chore: Build/tooling changes
```

---

## Deployment

See **[Production Deployment Guide](../PRODUCTION-DEPLOYMENT.md)** for full instructions.

**Quick Start**:
```bash
# Build Docker images
docker-compose build

# Deploy to AWS ECS
aws ecs update-service --cluster voice-jib-jab --service voice-jib-jab-service --force-new-deployment

# Deploy client to S3 + CloudFront
cd client && npm run build && aws s3 sync dist/ s3://voice-jib-jab-client/
```

---

## Troubleshooting

### Common Issues

**Issue**: `input_audio_buffer_commit_empty` error
**Status**: ✅ RESOLVED (see [Buffer Synchronization](./buffer-synchronization.md))
**Solution**: Implemented confirmation protocol with 50ms safety window

**Issue**: "Unexpected B done in LISTENING" warning
**Status**: ✅ RESOLVED (see [State Machine Resilience](./state-machine-resilience.md))
**Solution**: Added 4-case comprehensive handler

**Issue**: WebSocket disconnects randomly
**Status**: 🔄 MONITORING
**Solution**: Implement heartbeat pings every 30s, reconnect with exponential backoff

**Issue**: High latency (> 500ms TTFB)
**Status**: 🔍 INVESTIGATING
**Solution**: Profile OpenAI API calls, check network latency, optimize audio encoding

---

## Future Enhancements

### Phase 1: Production Readiness
- [x] Buffer synchronization fix
- [x] State machine resilience
- [x] Enterprise UI transformation
- [x] QA Sentinel assessment
- [x] Complete test coverage (85%)
- [x] Performance testing
- [x] Security audit

### Phase 2: Advanced Features
- [x] Control Plane (PolicyGate, audit trail)
- [x] RAG Integration (ChromaDB knowledge retrieval)
- [x] Multi-language support
- [x] Custom voice models
- [x] Analytics dashboard

### Phase 3: Scale & Optimize
- [ ] Multi-region deployment
- [ ] Edge computing (reduce latency)
- [x] A/B testing framework
- [ ] Cost optimization (caching, batching)

---

## References

### Internal Documentation
- [Project Spec](../PROJECT-SPEC.md)
- [QA Assessment](../qa/production-readiness-assessment.md)
- [Deployment Guide](../PRODUCTION-DEPLOYMENT.md)

### External Resources
- [OpenAI Realtime API Docs](https://platform.openai.com/docs/guides/realtime)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
- [PCM Audio Format](https://en.wikipedia.org/wiki/Pulse-code_modulation)

### Agent Documentation
- [NXTG-Forge System](../../.claude/forge/AUTO-SETUP.md)
- [Architecture Skills](../../.claude/skills/architecture.md)
- [QA Sentinel](../../.claude/skills/agents/qa-sentinel.md)

---

## Contact & Support

**Project Owner**: @axw
**Agent Team**: nxtg-master-architect, nxtg-design-vanguard, qa-sentinel
**Repository**: https://github.com/yourusername/voice-jib-jab
**Documentation**: https://docs.yourdomain.com

---

**Last Updated**: 2026-03-26
**Document Version**: 2.0.0
**Review Schedule**: Quarterly
