# Voice Claim Verification Demo — "Faultline for Phone Calls"

## What This Demonstrates

VJJ + Faultline-Pro integration: real-time claim verification during voice calls.
Every caller statement is silently scanned. If verifiable claims are detected,
the agent's next response incorporates the verification verdict.

## Setup (2 minutes)

Set environment variables before starting the server:

```bash
export FAULTLINE_API_URL=http://your-fp-server:3001
export FAULTLINE_API_KEY=fp-your-key
```

Start Faultline-Pro API:

```bash
cd faultline-pro && npm start
```

Start VJJ server:

```bash
cd voice-jib-jab/server && npm run dev
```

If `FAULTLINE_API_KEY` is empty or unset, claim verification is disabled and the
voice pipeline runs normally with no change in behavior.

## Demo Script (60 seconds)

---

**Caller says:** "I heard that the company grew revenue by 40% last quarter."

**VJJ detects:** 1 fact claim (importance: 4). Sends to FP /scan.

**FP returns:** status=contradicted (Q3 growth was 12%, not 40%)

**Agent responds:** "I want to make sure we have accurate information — that 40% figure
doesn't match what we have on record. Our Q3 revenue growth was 12%. Can I help clarify
anything else?"

---

**Caller says:** "I just need to confirm my account was credited $500 last week."

**VJJ detects:** 1 fact claim (importance: 3). Sends to FP /scan.

**FP returns:** status=supported

**Agent responds:** "Yes, I can confirm that transaction — your account was credited $500
on [date]. Is there anything else?"

---

## Why This Matters for Enterprise

- Real-time fact-checking prevents agents from confirming false claims
- Audit trail: every claim verdict logged to session timeline
- Works with existing voice pipeline — zero added latency on the agent's turn (fire-and-forget)
- Pairs with Lane C compliance export (GET /sessions/:id/compliance)

## Configuration

| Variable | Default | Description |
|---|---|---|
| `FAULTLINE_API_URL` | `http://localhost:3001` | Base URL for Faultline-Pro API |
| `FAULTLINE_API_KEY` | _(empty — disabled)_ | API key; leave unset to disable verification |

When verification is disabled (no key), VJJ starts normally and no scan requests
are made. This makes the integration safe to deploy before Faultline-Pro is
provisioned.

## How It Works (Technical)

1. User speech is transcribed by OpenAI Realtime API (Lane B).
2. On each final transcript, VJJ calls `ClaimVerificationService.scan(text)`.
3. The scan runs asynchronously — the agent's current response is never blocked.
4. If the scan returns a result, `laneB.setConversationContext()` injects the
   verdict as a system hint before the next agent turn.
5. The agent naturally incorporates the fact-check context into its next response.
