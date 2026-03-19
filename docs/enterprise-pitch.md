# voice-jib-jab — Enterprise Pitch

> **"The governance layer every enterprise voice deployment is missing."**

---

## The Problem

Enterprise voice AI deployments fail in two ways:

1. **Latency** — agents that hesitate sound broken. Every 100ms of added latency destroys the illusion of a real conversation.
2. **Ungoverned output** — agents that say the wrong thing create legal liability, reputational damage, and compliance violations.

Every existing voice AI platform solves one or the other. VJJ solves both.

---

## What We Ship

### 3-Lane Architecture — Sub-400ms Latency with Full Governance

```
Lane A  ──  Reflex acknowledgements ("I see...", "Got it...")   <50ms
Lane B  ──  LLM reasoning (OpenAI Realtime)                     <400ms
Lane C  ──  Policy governance (OPA + embedding similarity)      parallel
```

Lane C runs in parallel — it **never** adds to call latency. Governance is free.

### Key Capabilities

| Capability | Details |
|-----------|---------|
| **Real-time claim verification** | Every caller statement scanned by Faultline-Pro. False claims flagged before agent confirms them. |
| **Policy enforcement** | OPA-based rules engine. Hard-cancel audio mid-stream if policy violated. |
| **Sentiment-triggered escalation** | Frustrated trajectory detected → auto-escalate to human + create support ticket. |
| **Supervisor whisper mode** | Live coaching without caller hearing. Supervisors observe real-time transcript + sentiment. |
| **Multi-tenant isolation** | Full data isolation per tenant. Each tenant has own knowledge base, claims registry, routing rules. |
| **EU AI Act compliance export** | `GET /sessions/:id/compliance` returns Article 13 audit package. Machine-readable. |
| **Voice agent marketplace** | Pre-built personas (Customer Support, Sales, Tech Support, Receptionist). Install and customize. |
| **Call routing + queue** | Rule-based routing: language, topic, caller type, time-of-day, concurrency caps. |

---

## Three Demo Scenarios

### 1. Customer Support — Warranty Claims
`npm run demo:support`

A caller disputes product specs. VJJ verifies claims against Faultline-Pro in real-time. False specs flagged before the agent confirms them. Escalation triggered if caller becomes frustrated.

**What you'll see**: Lane C intercepts a false warranty claim. Agent responds with accurate information. Sentiment tracker fires escalation warning at turn 8.

### 2. Compliance Hotline — Regulatory Questions
`npm run demo:compliance`

An employee calls with a legally incorrect compliance question. VJJ flags the misinformation before it can be confirmed. High moderation sensitivity catches regulatory misstatements.

**What you'll see**: FP scan returns `contradicted` on a GDPR claim. Agent corrects the record and logs the interaction for compliance audit.

### 3. Sales Qualification — Product Claims
`npm run demo:sales`

A prospect repeats a competitor's misinformation about your product specs. VJJ catches it in real-time. Sales agent stays on accurate footing without hesitation.

**What you'll see**: Claim verification injects correction context into agent response. Low moderation sensitivity keeps the conversation flowing naturally.

---

## Pricing

| Tier | Price | Included |
|------|-------|---------|
| **Starter** | $99/seat/month | 1 tenant, 3 templates, basic compliance export |
| **Professional** | $299/seat/month | 10 tenants, full marketplace, supervisor mode, FP integration |
| **Enterprise** | Custom | Unlimited tenants, SLA, on-prem deployment, custom templates |

Volume discounts at 50+ seats.

---

## Deployment Options

### Cloud (managed)
- Hosted on customer's cloud account (AWS/GCP/Azure)
- VJJ server + ChromaDB + Faultline-Pro stack
- Setup time: 2 hours

### On-Premises
- Full Docker Compose stack
- Air-gapped option available (local LLM via Kokoro TTS + local OPA)
- Setup time: 1 day with support

### Hybrid
- VJJ on-prem, Faultline-Pro cloud
- Best for regulated industries with data residency requirements

---

## Integration Points

- **Telephony**: SIP/WebRTC ingress (BYOC — bring your own carrier)
- **CRM**: Webhook on session end → Salesforce / HubSpot / Zendesk
- **Ticketing**: Auto-create GitHub / Linear / Jira issues on escalation (MCP-based, pluggable)
- **SIEM**: Compliance JSON export → Splunk / Datadog / ELK
- **Identity**: API key auth today; OAuth/SAML roadmap Q2

---

## Why Now

- EU AI Act enforcement begins **August 2026** — compliance export is a requirement, not a nice-to-have
- OpenAI Realtime API now GA — enterprise voice AI is entering mainstream adoption
- First-mover advantage: no other voice runtime offers governance + claim verification in a single stack

---

## Contact

Add to `## Team Questions` in NEXUS or reach Asif directly.
