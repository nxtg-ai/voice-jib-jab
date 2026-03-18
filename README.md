# Voice Jib-Jab: NextGen AI Voice Orchestrator

A production voice agent runtime focused on eliminating the two things that kill enterprise voice deployments: **bad latency** and **ungoverned output**. Browser-based speech-to-speech assistant with lane-based orchestration, async policy enforcement, and retrieval-augmented generation.

**Status:** 15/15 roadmap initiatives SHIPPED | 2,200+ tests | 91%+ coverage

## Architecture

### Three-Lane System

- **Lane A (Reflex):** Instant backchannel audio and short acknowledgements (<50ms)
- **Lane B (Reasoned):** Streaming intelligent responses with RAG grounding
- **Lane C (Control):** Parallel async policy enforcement — moderation, PII redaction, claims verification, OPA declarative rules, audit trail

### Lane C — Async Governance Pipeline

Lane C runs in parallel with Lane B, never blocking audio. As of N-15 (2026-03-17), the policy check chain is fully async:

- `PolicyCheck.evaluate()` → `Promise<CheckResult>` — enables dense embedding inference without latency penalty
- `OpaClaimsCheck` routes through dense embedding similarity (`AllowedClaimsRegistry.getEmbeddingSimilarityScore()`) when the model is initialized, falling back to TF-IDF at runtime
- `ControlEngine.initialize()` wires both OPA WASM and the dense embedding model at startup

### Tech Stack

**Client:** React 18 + TypeScript + Vite
**Server:** Node.js 20 + TypeScript + Express + WebSocket
**Voice Provider:** OpenAI Realtime API (pluggable)
**Vector Store:** ChromaDB
**Real-time:** WebSocket

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- OpenAI API key

### Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Start development servers
npm run dev
```

This starts:
- Client on http://localhost:5173
- Server on http://localhost:3000

### Project Structure

```
voice-jib-jab/
├── client/           # React browser application
│   └── src/
│       ├── audio/    # Mic capture, playback
│       ├── ui/       # UI components
│       ├── state/    # State management
│       └── events/   # Event handling
├── server/           # Node.js orchestrator
│   └── src/
│       ├── api/      # HTTP endpoints
│       ├── orchestrator/  # Session manager, event bus
│       ├── lanes/    # Lane A, B, C implementations
│       ├── providers/     # Voice provider adapters
│       ├── retrieval/     # RAG and vector store
│       ├── insurance/     # PolicyGate, audit, etc.
│       └── schemas/  # Event schemas
├── knowledge/        # NextGen AI knowledge pack
├── docs/            # Documentation
└── .claude/         # NXTG-Forge configuration
```

## Development

### NXTG-Forge Commands

```bash
/status           # View project state
/enable-forge     # Activate forge orchestrator
/feature "name"   # Add new feature
/report           # View session activity
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Linting

```bash
npm run lint
npm run format
```

## Performance Targets

- **TTFB p50:** <400ms (p95: <900ms)
- **Barge-in stop p95:** <250ms
- **Turn latency p95:** <1200ms

## Quality

| Metric | Value |
|--------|-------|
| Test count | 2,200+ |
| Statement coverage | 91%+ |
| Branch coverage | 81%+ |
| Coverage floor (enforced) | stmt 88 / branch 78 / fn 87 / lines 88 |
| Roadmap initiatives SHIPPED | 15/15 |
| Mutation testing | Stryker baseline established (PolicyGate, AllowedClaimsRegistry, LaneArbitrator) |

## Documentation

- [Project Spec](docs/PROJECT-SPEC.md)
- [Voice UX Principles](.claude/skills/domain/voice-ux.md)
- [Lane System Architecture](.claude/skills/domain/lane-system.md)

## License

MIT
