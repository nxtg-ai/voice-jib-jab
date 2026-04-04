# Changelog

All notable changes to voice-jib-jab are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## Project Status

**66/66 initiatives SHIPPED** | **4,998 tests** | **97% coverage**

---

## [Unreleased]

---

## Security + Maintenance · 2026-04-03

### Fixed
- Resolved 2 high-severity lodash vulnerabilities (Code Injection via `_.template`, Prototype Pollution via `_.unset`/`_.omit`, range <=4.17.23) — bumped to 4.18.1 via `npm audit fix`
- Removed stale `nxtg-forge/` directory (25MB orphaned forge-plugin clone) that was polluting portfolio pytest health checks — added `pyproject.toml` with `testpaths = ["tests"]` guard

### Stats
- Tests: **4,998** across **153 suites** (unchanged)
- Vulnerabilities: **0** (was: 2 high)

---

## Security · 2026-03-28

### Fixed
- Resolved 5 Dependabot vulnerabilities: `path-to-regexp` ReDoS (critical + high), `picomatch` method injection + ReDoS (2 high), `yaml` stack overflow via OPA-wasm transitive dep (moderate)
- `npm audit` reports 0 vulnerabilities post-fix

---

## N-66 — Prometheus Metrics · OBSERVABILITY · 2026-03-24

### Added
- Prometheus metrics endpoint (`/metrics`) powered by `prom-client`
- Request duration histograms, active connection gauges, error counters

### Stats
- Tests: **4,998** across **153 suites**
- Coverage: **97.24% stmt / 92.71% branch / 96.83% fn / 97.49% lines**

---

## N-63 through N-65 — Production Hardening · OBSERVABILITY · 2026-03-22

### Added
- N-63: Liveness probe, `RequestTracker` drain, Artillery load test suite
- N-64: WebSocket health check, `registerCheck()` API, enhanced `/health` endpoint
- N-65: Graceful WebSocket drain on SIGTERM — notify connected clients, wait, close

---

## N-48 through N-62 — Coverage + Quality Hardening · OBSERVABILITY · 2026-03-21

### Added
- N-48: Property-based testing via `fast-check` — fuzz-tested core parsers and validators
- N-49 through N-62: Branch coverage campaigns across ~50 files

### Changed
- Branch coverage raised from 82% to 92.71%
- Statement coverage raised to 97.24%

---

## N-35 through N-47 — Security Hardening + Middleware · GOVERNANCE · 2026-03-21

### Added
- N-37: Request correlation ID middleware (`X-Request-Id` propagation)
- N-38: Graceful shutdown on SIGTERM/SIGINT with in-flight request draining
- N-39: Auth endpoint rate limiting (brute-force protection)
- N-40: CORS hardening via `ALLOWED_ORIGINS` allowlist
- N-41: Rate limiter configuration constants (centralised tuning)
- N-42: Trust proxy configuration for reverse-proxy deployments
- N-43: Helmet.js security headers on all responses
- N-44: Request body size limit enforced at 256 KB
- N-45: Global JSON error handler (consistent error shape)
- N-46: JSON 404 handler — catch-all for unmatched routes
- N-47: Structured access logger with request metadata

### Fixed
- N-35: IntentClassifier word-boundary bug — prevented partial-match false positives

### Changed
- N-36: Audit events enriched with IP address, HTTP method, and API key ID

---

## N-29 through N-34 — API Key Auth + Access Control · GOVERNANCE · 2026-03-21

### Added
- N-29: API key authentication system (SHA-256 hashed, header-based validation) — **P0**
- N-30: Real-time audit event stream (SSE-based, filterable by event type)
- N-31: API key TTL / expiry with automatic rotation support
- N-32: Session endpoint protection (authenticated sessions only)
- N-33: Analytics and audit endpoint access control (role-gated)
- N-34: Remaining route protection sweep — all public routes locked behind auth

---

## N-26 through N-28 — Enterprise Production Readiness · GOVERNANCE · 2026-03-21

### Added
- N-26: Per-tenant rate limiting and quota enforcement
- N-27: Webhook retry queue with exponential backoff and dead-letter storage
- N-28: Kubernetes readiness probe (`/ready`) with dependency health checks

---

## N-16 through N-25 — Enterprise Feature Stack · EXTENSIBILITY · 2026-03-19

### Added
- N-16: Call routing and queue system with priority-based dispatch
- N-17: Voice agent marketplace — browse, install, and manage agent templates
- N-18: Voice biometrics — caller identification via voiceprint matching
- N-19: Custom TTS voices with A/B testing framework
- N-20: Agent personas — per-tenant personality configuration
- N-21: Voice Agent React SDK published as `@nxtg/voice-agent-react`
- N-22: Conversation flow builder — visual drag-and-drop dialog design
- N-23: Real-time translation pipeline — live multilingual voice support
- N-24: Intent detection — smart caller routing based on utterance classification
- N-25: Voice pipeline profiler — latency breakdown per pipeline stage

---

## N-15 — Quality Hardening · OBSERVABILITY · 2026-03-18

### Added
- CRUCIBLE Gates 1–7 self-audit completed, zero regressions
- Filled hollow test assertions across governance and embedding paths
- Coverage lifted from 90% to 94% (stmt/branch/fn/lines all above floor)

### Stats
- Tests: **2,251** (up from 2,168)
- Coverage: **94%**

---

## N-15 Sprint 2 — Async PolicyCheck Interface · GOVERNANCE · 2026-03-17

### Added
- `PolicyCheck` interface converted to async (returns `Promise<PolicyResult>`)
- Dense embedding path wired into `OpaClaimsCheck` — similarity scores now fed into OPA decisions at runtime
- `getEmbeddingSimilarityScore` integrated end-to-end with policy evaluation pipeline

### Stats
- Tests: **2,168**

---

## N-15 Sprint 1 — Dense Embedding Similarity · GOVERNANCE · 2026-03-14

### Added
- `getEmbeddingSimilarityScore` function using `@xenova/transformers` (all-MiniLM-L6-v2)
- Cosine similarity scoring for claims against the `AllowedClaimsRegistry`
- Unit test suite covering embedding generation and similarity thresholds

---

## N-14 — Lane C v2: Semantic Governance · GOVERNANCE · 2026-03-07

### Added
- OPA Rego policy engine replacing the stub `PolicyGate` — hard-cancel decisions now evaluated server-side
- `VectorStore` with TF-IDF similarity for knowledge-grounded policy queries
- `AllowedClaimsRegistry` — curated allowlist with similarity-threshold enforcement
- `ModeratorCheck` OPA phase (Phase 2): content moderation via Rego rules
- CI Gate Protocol adopted: full test suite required before every push

### Changed
- `OpaClaimsCheck` replaces the empty `claims_check` stub
- Lane C control plane now runs synchronous Rego evaluation on every turn

---

## N-10 — Production Readiness QA · OBSERVABILITY · 2026-02-28

### Added
- Load test baseline: 200 concurrent sessions, p95 TTFB **126ms** (SLA target met)
- Security audit completed: 0 production vulnerabilities, secrets clean
- UAT bugs #1 (audio feedback loop) and #5 (audit trail FK race) verified fixed
- `RUNBOOK.md` and demo guide shipped
- Coverage floor CI gate (`coverageThreshold` in jest.config.js: stmt 88, branch 78, fn 87, lines 88)

### Stats
- Tests: **1,028**

---

## N-09 — Unit Test Coverage 14%→85% · OBSERVABILITY · 2026-02

### Added
- 11 new test suites covering previously untested server paths
- `websocket.ts` brought from 0% to 97% coverage
- CI GitHub Actions test gate (ADR-008 compliance) wired to main branch

### Changed
- Server statement coverage: 38% → 85%+
- Branches cleared 70% CI gate

### Stats
- Tests: **1,028** (up from ~713 at N-07 CI clearance; 14% baseline at initiative start)

---

## N-08 — Knowledge Pack Retrieval · GROUNDING · 2026-02

### Added
- `KnowledgePackService` — loads and indexes domain knowledge packs at startup
- Retrieval tool wired into Lane B: relevant facts injected into assistant context before each turn
- Disclaimer lookup tool for regulated-content guardrails
- Citation metadata attached to assistant responses for compliance trails

---

## N-07 — Lane C Control Plane v1 · GOVERNANCE · 2026-02

### Added
- Content moderation engine: 7-category pattern matching (replaces empty stub)
- `ControlEngine` scaffold with hard-cancel and fallback trigger support
- `AuditTrail` event logging for every Lane C decision
- `PIIRedactor` and `FallbackPlanner` stubs integrated into the control plane lifecycle
- 3 resource leak fixes and 2 reliability hardening patches in Lane C

### Stats
- Tests: **713** (at time of CI clearance)

---

## N-06 — Enterprise UI Transformation · INTERACTION · 2026-01

### Added
- Full UI redesign: electric blue design system (Tailwind-first)
- Talk/Stop toggle with real-time session state indicators
- End Call button wired to server-side session teardown
- Lane status display (A/B/C activity visible during conversation)

---

## N-05 — Persistent Memory (ChromaDB) · GROUNDING · 2026-01

### Added
- ChromaDB vector store for cross-session conversation memory
- Automatic embedding and retrieval of prior conversation context on session start
- Memory injection into Lane B system prompt

---

## N-04 — State Machine Resilience · RESPONSIVENESS · 2026-01

### Added
- Explicit session state machine (IDLE → CONNECTING → ACTIVE → STOPPING)
- Buffer and queue safeguards to prevent TTFB drift under load
- TTS phrase sync aligned to state transitions

---

## N-03 — Audio Buffer Race Fix · RESPONSIVENESS · 2026-01

### Added
- Audio commit issued when user releases Talk button (prevents dropped utterance)
- Lazy microphone initialization — no permission prompt until first interaction
- OpenAI Realtime API race condition eliminated on rapid connect/disconnect

---

## N-02 — Lane Arbitration System · INTERACTION · 2026-01

### Added
- 3-Lane arbitration: Lane A (reflex acknowledgements), Lane B (reasoning), Lane C (policy/governance)
- Barge-in support via server-side VAD — Lane B cancels cleanly when user interrupts
- Lane overlap prevention: natural reflex sounds replace awkward silence
- `feat-002` Lane Arbitration specification and architecture checkpoint committed

---

## N-01 — Voice Loop MVP · RESPONSIVENESS · 2026-01

### Added
- OpenAI Realtime API integration over WebSocket (Mic → WebSocket → OpenAI → playback)
- `response.create` trigger with full test suite
- Server-side session management and connection stability improvements
- Environment variable loading from project root
- Quick start guide for voice conversation testing

### Stats
- Initial working voice loop established; sub-400ms p50 TTFB target set
