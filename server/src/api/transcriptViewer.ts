/**
 * Voice Session Transcript Viewer
 *
 * Self-contained HTML page served at GET /transcripts/:sessionId.
 * Fetches session data from the existing /sessions API and renders:
 *   • Full conversation with user + assistant speech bubbles
 *   • Per-event timestamps (relative to session start)
 *   • Policy decisions inline as coloured banners
 *   • Session-level sentiment summary
 *   • Claims checks and audit events
 *   • Sidebar with session metadata + policy decision breakdown
 *
 * Zero external dependencies — vanilla DOM, CSS Grid, no frameworks.
 */

export function transcriptViewerHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>VJJ Transcript Viewer</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--surface2:#16161f;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--muted2:#94a3b8;
  --blue:#3b82f6;--blue-dim:#1e3a5f;--blue-glow:#3b82f630;
  --green:#22c55e;--green-dim:#14532d;--yellow:#eab308;--yellow-dim:#713f12;
  --red:#ef4444;--red-dim:#7f1d1d;--orange:#f97316;--orange-dim:#7c2d12;
  --purple:#a855f7;--purple-dim:#4a1d96;
  --radius:10px;--radius-sm:6px;
}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}

/* ── Shell ─────────────────────────────────────────────── */
.shell{display:flex;flex-direction:column;min-height:100vh}

/* ── Header ─────────────────────────────────────────────── */
header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;
  padding:.75rem 1.5rem;border-bottom:1px solid var(--border);background:var(--surface);
  position:sticky;top:0;z-index:100}
.logo{font-weight:700;font-size:1rem;color:var(--blue);letter-spacing:-.01em;white-space:nowrap}
.logo span{color:var(--muted);font-weight:400}
.header-meta{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
.session-id{font-family:'JetBrains Mono',monospace,ui-monospace;font-size:.75rem;
  background:var(--surface2);border:1px solid var(--border);padding:.2rem .6rem;border-radius:var(--radius-sm);
  color:var(--muted2);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.back-link{font-size:.78rem;color:var(--blue);text-decoration:none;padding:.2rem .6rem;
  border:1px solid var(--blue-dim);border-radius:var(--radius-sm);transition:background .15s}
.back-link:hover{background:var(--blue-glow)}

/* ── Session info bar ─────────────────────────────────────── */
.info-bar{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;
  padding:.6rem 1.5rem;background:var(--surface);border-bottom:1px solid var(--border);font-size:.78rem;color:var(--muted)}
.info-item{display:flex;align-items:center;gap:.35rem}
.info-item strong{color:var(--text)}
.sentiment-badge{padding:.15rem .5rem;border-radius:99px;font-size:.72rem;font-weight:600;white-space:nowrap}
.s-positive{background:var(--green-dim);color:var(--green)}
.s-neutral{background:#1e3a5f;color:#60a5fa}
.s-negative{background:var(--red-dim);color:var(--red)}
.s-frustrated{background:var(--orange-dim);color:var(--orange)}
.export-link{margin-left:auto;font-size:.75rem;color:var(--blue);text-decoration:none;
  border:1px solid var(--blue-dim);padding:.2rem .6rem;border-radius:var(--radius-sm);transition:background .15s;white-space:nowrap}
.export-link:hover{background:var(--blue-glow)}

/* ── Main content ─────────────────────────────────────────── */
.main{display:grid;grid-template-columns:1fr 300px;gap:0;flex:1;min-height:0}
@media(max-width:768px){.main{grid-template-columns:1fr}}

/* ── Timeline ─────────────────────────────────────────────── */
.timeline{padding:1.5rem;overflow-y:auto;display:flex;flex-direction:column;gap:.75rem;border-right:1px solid var(--border)}
.tl-empty{color:var(--muted);text-align:center;padding:3rem 1rem;font-size:.9rem}

/* speech bubbles */
.bubble-row{display:flex;gap:.75rem;align-items:flex-start;max-width:680px}
.bubble-row.user{align-self:flex-start}
.bubble-row.assistant{align-self:flex-end;flex-direction:row-reverse}
.avatar{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1rem;margin-top:2px}
.avatar.user{background:#1e293b;border:1px solid var(--border)}
.avatar.assistant{background:var(--blue-dim);border:1px solid var(--blue)}
.bubble{max-width:520px}
.bubble-header{display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem;font-size:.72rem}
.bubble-row.user .bubble-header{color:var(--muted)}
.bubble-row.assistant .bubble-header{justify-content:flex-end;color:#60a5fa}
.role-label{font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:.68rem}
.ts-label{color:var(--muted);font-size:.68rem}
.bubble-body{padding:.65rem .9rem;border-radius:var(--radius);font-size:.88rem;line-height:1.55}
.bubble-row.user .bubble-body{background:var(--surface2);border:1px solid var(--border);border-top-left-radius:2px}
.bubble-row.assistant .bubble-body{background:var(--blue-dim);border:1px solid #1e40af;border-top-right-radius:2px;color:#dbeafe}
.bubble-row.assistant .bubble-body .bubble-text{text-align:left}

/* policy inline banners */
.policy-row{display:flex;align-items:center;gap:.6rem;padding:.45rem .9rem;border-radius:var(--radius-sm);
  font-size:.78rem;border-left:3px solid;margin:0 .25rem}
.policy-row.allow{background:#052e16;border-color:var(--green);color:var(--green)}
.policy-row.refuse{background:#450a0a;border-color:var(--red);color:#fca5a5}
.policy-row.escalate{background:#431407;border-color:var(--orange);color:#fdba74}
.policy-row.rewrite{background:#422006;border-color:var(--yellow);color:#fde68a}
.policy-row.cancel_output{background:#450a0a;border-color:var(--red);color:#fca5a5}
.policy-row.unknown{background:#1e1b4b;border-color:var(--purple);color:#c4b5fd}
.policy-icon{font-size:1rem;flex-shrink:0}
.policy-label{font-weight:600;flex-shrink:0}
.policy-reason{color:inherit;opacity:.8;font-size:.75rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.policy-ts{margin-left:auto;font-size:.68rem;opacity:.6;white-space:nowrap;padding-left:.5rem}

/* claims checks */
.claim-row{display:flex;align-items:center;gap:.5rem;padding:.3rem .8rem;
  background:#0f172a;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:.75rem;color:var(--muted2)}
.claim-pass{color:var(--green)}
.claim-fail{color:var(--red)}

/* session markers */
.marker{display:flex;align-items:center;gap:.75rem;padding:.2rem 0;font-size:.72rem;color:var(--muted)}
.marker::before,.marker::after{content:'';flex:1;height:1px;background:var(--border)}
.marker-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.marker-dot.start{background:var(--green);box-shadow:0 0 6px var(--green)}
.marker-dot.end{background:var(--muted)}
.marker-text{white-space:nowrap}

/* ── Sidebar ──────────────────────────────────────────────── */
.sidebar{padding:1rem;overflow-y:auto;background:var(--surface);display:flex;flex-direction:column;gap:1rem}
@media(max-width:768px){.sidebar{border-top:1px solid var(--border)}}
.card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:.9rem;display:flex;flex-direction:column;gap:.55rem}
.card-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.1rem}
.stat-row{display:flex;justify-content:space-between;align-items:center;font-size:.82rem}
.stat-key{color:var(--muted)}
.stat-val{color:var(--text);font-weight:500}
.policy-summary-row{display:flex;align-items:center;justify-content:space-between;padding:.3rem .5rem;
  border-radius:var(--radius-sm);font-size:.78rem}
.ps-allow{background:#052e16;color:var(--green)}
.ps-refuse{background:#450a0a;color:#fca5a5}
.ps-escalate{background:#431407;color:#fdba74}
.ps-rewrite{background:#422006;color:#fde68a}
.ps-cancel_output{background:#450a0a;color:#fca5a5}
.ps-count{font-weight:700;font-size:.9rem}
.turn-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:.3rem}
.td-user{background:#334155}
.td-assistant{background:var(--blue)}
.refresh-btn{width:100%;padding:.45rem;background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-sm);color:var(--muted);font-size:.78rem;cursor:pointer;transition:border-color .15s}
.refresh-btn:hover{border-color:var(--blue);color:var(--blue)}

/* ── Loading / error states ───────────────────────────────── */
#loading{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:1rem;height:50vh;color:var(--muted)}
.spinner{width:32px;height:32px;border:2px solid var(--border);border-top-color:var(--blue);
  border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#error-msg{color:var(--red);text-align:center;padding:2rem;font-size:.88rem}
.hidden{display:none!important}
</style>
</head>
<body>
<div class="shell">
  <header>
    <div class="logo">VJJ <span>/ Transcript Viewer</span></div>
    <div class="header-meta">
      <span class="session-id" id="hdr-session-id">Loading…</span>
      <a href="/dashboard" class="back-link">← Dashboard</a>
    </div>
  </header>

  <div class="info-bar" id="info-bar">
    <div class="info-item">⏱ <strong id="ib-duration">—</strong></div>
    <div class="info-item">🏢 Tenant: <strong id="ib-tenant">—</strong></div>
    <div class="info-item">🕐 <strong id="ib-started">—</strong></div>
    <div class="info-item">💬 <strong id="ib-turns">—</strong> turns</div>
    <span id="ib-sentiment" class="sentiment-badge" style="display:none"></span>
    <a id="ib-export" href="#" class="export-link hidden" target="_blank">⬇ Compliance export</a>
  </div>

  <div id="loading"><div class="spinner"></div><span>Loading transcript…</span></div>
  <div id="error-msg" class="hidden"></div>

  <div class="main hidden" id="main">
    <div class="timeline" id="timeline"></div>
    <aside class="sidebar" id="sidebar">
      <div class="card" id="card-stats">
        <div class="card-title">Session</div>
        <div class="stat-row"><span class="stat-key">Session ID</span><span class="stat-val" id="s-id" style="font-family:monospace;font-size:.72rem">—</span></div>
        <div class="stat-row"><span class="stat-key">Duration</span><span class="stat-val" id="s-dur">—</span></div>
        <div class="stat-row"><span class="stat-key">Tenant</span><span class="stat-val" id="s-tenant">—</span></div>
        <div class="stat-row"><span class="stat-key">Started</span><span class="stat-val" id="s-start">—</span></div>
        <div class="stat-row"><span class="stat-key">Ended</span><span class="stat-val" id="s-end">—</span></div>
        <div class="stat-row"><span class="stat-key">User turns</span><span class="stat-val" id="s-user-turns">—</span></div>
        <div class="stat-row"><span class="stat-key">Assistant turns</span><span class="stat-val" id="s-asst-turns">—</span></div>
      </div>
      <div class="card" id="card-policy">
        <div class="card-title">Policy Decisions</div>
        <div id="policy-breakdown">—</div>
      </div>
      <div class="card" id="card-sentiment" style="display:none">
        <div class="card-title">Sentiment</div>
        <div class="stat-row"><span class="stat-key">Dominant</span><span class="stat-val" id="sent-dominant">—</span></div>
        <div class="stat-row"><span class="stat-key">Avg score</span><span class="stat-val" id="sent-score">—</span></div>
      </div>
      <button class="refresh-btn" onclick="load()">↺ Refresh</button>
    </aside>
  </div>
</div>

<script>
const sessionId = location.pathname.split('/').filter(Boolean).pop();

// ── Formatting helpers ─────────────────────────────────────────────────

function fmtRelMs(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return h + 'h ' + String(m % 60).padStart(2,'0') + 'm ' + String(s % 60).padStart(2,'0') + 's';
  if (m > 0) return m + 'm ' + String(s % 60).padStart(2,'0') + 's';
  return (ms / 1000).toFixed(1) + 's';
}

function fmtDuration(ms) {
  if (!ms) return '—';
  return fmtRelMs(ms);
}

function fmtTs(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, {dateStyle:'medium',timeStyle:'medium'}); }
  catch { return iso; }
}

function fmtRelLabel(relMs) {
  return '+' + fmtRelMs(relMs);
}

function sentimentClass(s) {
  const map = {positive:'s-positive',neutral:'s-neutral',negative:'s-negative',frustrated:'s-frustrated'};
  return map[s] || 's-neutral';
}

function sentimentEmoji(s) {
  const map = {positive:'😊',neutral:'😐',negative:'😞',frustrated:'😤'};
  return (map[s] || '●') + ' ' + (s || 'neutral');
}

function policyIcon(d) {
  const map = {allow:'✅',refuse:'🚫',escalate:'🔺',rewrite:'✏️',cancel_output:'⛔',unknown:'❓'};
  return map[d] || map.unknown;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Timeline renderers ─────────────────────────────────────────────────

function renderMarker(text, relMs, kind) {
  return '<div class="marker"><span class="marker-dot ' + kind + '"></span>'
    + '<span class="marker-text">' + esc(text) + ' — ' + esc(fmtRelLabel(relMs)) + '</span></div>';
}

function renderUserBubble(entry, relMs) {
  const text = (entry.payload && entry.payload.text) ? esc(entry.payload.text) : '<em style="opacity:.5">—</em>';
  return '<div class="bubble-row user">'
    + '<div class="avatar user">🎤</div>'
    + '<div class="bubble">'
    + '<div class="bubble-header"><span class="role-label">User</span><span class="ts-label">' + esc(fmtRelLabel(relMs)) + '</span></div>'
    + '<div class="bubble-body"><div class="bubble-text">' + text + '</div></div>'
    + '</div></div>';
}

function renderAssistantBubble(entry, relMs) {
  const text = (entry.payload && entry.payload.text) ? esc(entry.payload.text) : '<em style="opacity:.5">—</em>';
  return '<div class="bubble-row assistant">'
    + '<div class="avatar assistant">🤖</div>'
    + '<div class="bubble">'
    + '<div class="bubble-header"><span class="ts-label">' + esc(fmtRelLabel(relMs)) + '</span><span class="role-label">Assistant</span></div>'
    + '<div class="bubble-body"><div class="bubble-text">' + text + '</div></div>'
    + '</div></div>';
}

function renderPolicyRow(entry, relMs) {
  const d = (entry.payload && entry.payload.decision) ? String(entry.payload.decision) : 'unknown';
  const reason = (entry.payload && entry.payload.reason) ? String(entry.payload.reason) : '';
  const claim  = (entry.payload && entry.payload.claim)  ? String(entry.payload.claim)  : '';
  const detail = reason || claim || '';
  return '<div class="policy-row ' + esc(d) + '">'
    + '<span class="policy-icon">' + policyIcon(d) + '</span>'
    + '<span class="policy-label">Policy: ' + esc(d) + '</span>'
    + (detail ? '<span class="policy-reason">' + esc(detail) + '</span>' : '')
    + '<span class="policy-ts">' + esc(fmtRelLabel(relMs)) + '</span>'
    + '</div>';
}

function renderClaimRow(entry, relMs) {
  const claim  = (entry.payload && entry.payload.claim)  ? String(entry.payload.claim)  : '?';
  const result = (entry.payload && entry.payload.result) ? String(entry.payload.result) : 'unknown';
  const ok = result === 'allowed' || result === 'pass';
  return '<div class="claim-row">'
    + '<span>' + (ok ? '✔' : '✗') + '</span>'
    + '<span class="' + (ok ? 'claim-pass' : 'claim-fail') + '">Claim: ' + esc(claim) + ' → ' + esc(result) + '</span>'
    + '<span style="margin-left:auto;font-size:.68rem;opacity:.5">' + esc(fmtRelLabel(relMs)) + '</span>'
    + '</div>';
}

function renderAuditRow(entry, relMs) {
  const msg = (entry.payload && entry.payload.message) ? String(entry.payload.message)
            : (entry.payload && entry.payload.event)   ? String(entry.payload.event)
            : entry.type;
  return '<div class="claim-row">'
    + '<span>📋</span><span>' + esc(msg) + '</span>'
    + '<span style="margin-left:auto;font-size:.68rem;opacity:.5">' + esc(fmtRelLabel(relMs)) + '</span>'
    + '</div>';
}

// ── Main render ────────────────────────────────────────────────────────

function renderTimeline(timeline) {
  if (!timeline || timeline.length === 0) {
    return '<div class="tl-empty">No timeline events recorded for this session.</div>';
  }

  const sorted = [...timeline].sort((a, b) => a.t_ms - b.t_ms);
  const origin = sorted[0].t_ms;
  let html = '';
  let userTurns = 0, asstTurns = 0;
  const policyCounts = {};

  for (const entry of sorted) {
    const relMs = entry.t_ms - origin;
    const p = entry.payload || {};

    if (entry.type === 'session.start') {
      html += renderMarker('Session started', relMs, 'start');
    } else if (entry.type === 'session.end') {
      html += renderMarker('Session ended', relMs, 'end');
    } else if (entry.type === 'user_transcript' && p.isFinal) {
      userTurns++;
      html += renderUserBubble(entry, relMs);
    } else if (entry.type === 'transcript' && p.isFinal) {
      asstTurns++;
      html += renderAssistantBubble(entry, relMs);
    } else if (entry.type === 'policy.decision') {
      const d = String(p.decision || 'unknown');
      policyCounts[d] = (policyCounts[d] || 0) + 1;
      html += renderPolicyRow(entry, relMs);
    } else if (entry.type === 'claims.check') {
      html += renderClaimRow(entry, relMs);
    } else if (entry.type === 'control.audit' || entry.type === 'control.override') {
      html += renderAuditRow(entry, relMs);
    }
    // skip audio.chunk, transcript.final (final is a repeat), session metadata events
  }

  return { html, userTurns, asstTurns, policyCounts };
}

// ── Sidebar renders ────────────────────────────────────────────────────

function renderPolicyBreakdown(policyCounts) {
  const entries = Object.entries(policyCounts);
  if (entries.length === 0) return '<span style="color:var(--muted);font-size:.8rem">No policy events</span>';
  const total = entries.reduce((s, [,n]) => s + n, 0);
  return entries.map(([d, n]) =>
    '<div class="policy-summary-row ps-' + d + '">'
    + '<span>' + policyIcon(d) + ' ' + d + '</span>'
    + '<span class="ps-count">' + n + '</span>'
    + '</div>'
  ).join('') + '<div style="font-size:.72rem;color:var(--muted);margin-top:.35rem">' + total + ' total decision(s)</div>';
}

// ── Data fetch + render ────────────────────────────────────────────────

async function load() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('main').classList.add('hidden');
  document.getElementById('error-msg').classList.add('hidden');

  try {
    const [sessRes, summaryRes] = await Promise.all([
      fetch('/sessions/' + sessionId),
      fetch('/sessions/' + sessionId + '/summary').catch(() => null),
    ]);

    if (!sessRes.ok) {
      const err = await sessRes.json().catch(() => ({}));
      throw new Error(err.error || ('HTTP ' + sessRes.status));
    }

    const session  = await sessRes.json();
    const summary  = summaryRes && summaryRes.ok ? await summaryRes.json().catch(() => null) : null;

    // ── Header
    document.getElementById('hdr-session-id').textContent = session.sessionId || sessionId;
    document.title = 'Transcript — ' + (session.sessionId || sessionId).slice(0, 8) + '…';

    // ── Info bar
    document.getElementById('ib-duration').textContent = fmtDuration(session.durationMs);
    document.getElementById('ib-tenant').textContent   = session.tenantId || '(none)';
    document.getElementById('ib-started').textContent  = fmtTs(session.startedAt);

    const turnCount = session.summary && session.summary.turnCount != null
      ? session.summary.turnCount
      : (summary && summary.summary && summary.summary.turnCount) || '?';
    document.getElementById('ib-turns').textContent = turnCount;

    const dominantSentiment = session.summary && session.summary.sentiment
      ? session.summary.sentiment.dominantSentiment
      : null;
    if (dominantSentiment) {
      const badge = document.getElementById('ib-sentiment');
      badge.textContent = sentimentEmoji(dominantSentiment);
      badge.className = 'sentiment-badge ' + sentimentClass(dominantSentiment);
      badge.style.display = '';
    }

    const exportLink = document.getElementById('ib-export');
    exportLink.href = '/sessions/' + sessionId + '/compliance';
    exportLink.classList.remove('hidden');

    // ── Sidebar stats
    document.getElementById('s-id').textContent     = session.sessionId || sessionId;
    document.getElementById('s-dur').textContent    = fmtDuration(session.durationMs);
    document.getElementById('s-tenant').textContent = session.tenantId || '(none)';
    document.getElementById('s-start').textContent  = fmtTs(session.startedAt);
    document.getElementById('s-end').textContent    = fmtTs(session.endedAt);

    // ── Timeline
    const tl = session.timeline || [];
    const result = renderTimeline(tl);
    let tlHtml, userTurns, asstTurns, policyCounts;
    if (typeof result === 'object' && result !== null && result.html !== undefined) {
      ({ html: tlHtml, userTurns, asstTurns, policyCounts } = result);
    } else {
      tlHtml = String(result);
      userTurns = 0; asstTurns = 0; policyCounts = {};
    }

    document.getElementById('timeline').innerHTML = tlHtml;
    document.getElementById('s-user-turns').textContent = userTurns;
    document.getElementById('s-asst-turns').textContent = asstTurns;
    document.getElementById('policy-breakdown').innerHTML = renderPolicyBreakdown(policyCounts || {});

    // ── Sentiment card
    const sent = session.summary && session.summary.sentiment;
    if (sent) {
      document.getElementById('sent-dominant').textContent = sentimentEmoji(sent.dominantSentiment);
      document.getElementById('sent-score').textContent    = typeof sent.averageScore === 'number'
        ? sent.averageScore.toFixed(2) : '—';
      document.getElementById('card-sentiment').style.display = '';
    }

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('main').classList.remove('hidden');

  } catch (e) {
    document.getElementById('loading').classList.add('hidden');
    const errEl = document.getElementById('error-msg');
    errEl.textContent = '⚠ Could not load transcript: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

load();
</script>
</body>
</html>`;
}
