/**
 * Health Monitor Dashboard
 *
 * Serves a self-contained HTML page at GET /health/dashboard.
 * Polls /health/subsystems every 10 s and renders:
 *   • Overall status badge — HEALTHY / DEGRADED / DOWN
 *   • Per-subsystem cards — STT, TTS, OPA, ChromaDB, Database
 *     each showing status dot, latency, last checked, error (if any),
 *     and consecutive failure count (if > 0)
 *   • Last updated counter
 *
 * Zero external JS/CSS dependencies.  All rendering is vanilla DOM + CSS.
 */

export function healthMonitorDashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>VJJ Health Monitor</title>
<style>
/* ── Reset & tokens ─────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#13131a;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1d4ed8;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;
  --radius:10px;--gap:1rem;
}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}

/* ── Layout ────────────────────────────────────────────── */
.shell{display:flex;flex-direction:column;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;
  padding:.75rem 1.5rem;border-bottom:1px solid var(--border);background:var(--surface);
  position:sticky;top:0;z-index:100}
.logo{font-weight:700;font-size:1rem;color:var(--blue);letter-spacing:-.01em}
.logo span{color:var(--muted);font-weight:400}
.header-right{display:flex;align-items:center;gap:1rem}
.back-link{font-size:.78rem;color:var(--blue);text-decoration:none;
  padding:.3rem .7rem;border:1px solid var(--blue-dim);border-radius:6px;
  transition:background .15s}
.back-link:hover{background:#1d4ed822}
.ts{font-size:.75rem;color:var(--muted)}

main{flex:1;padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:1.5rem;
  max-width:1000px;margin:0 auto;width:100%}

/* ── Overall badge ─────────────────────────────────────── */
.overall-wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem}
.overall-badge{display:inline-flex;align-items:center;gap:.6rem;
  font-size:1.5rem;font-weight:800;letter-spacing:.04em;
  padding:.5rem 1.25rem;border-radius:var(--radius);border:2px solid currentColor}
.overall-badge.healthy{color:var(--green);background:#14532d22}
.overall-badge.degraded{color:var(--yellow);background:#78350f22}
.overall-badge.down{color:var(--red);background:#7f1d1d22}
.overall-badge.unknown{color:var(--muted);background:#1e1e2e}
.overall-dot{width:14px;height:14px;border-radius:50%;background:currentColor;flex-shrink:0}
.overall-badge.healthy .overall-dot{box-shadow:0 0 10px var(--green)}
.overall-badge.degraded .overall-dot{box-shadow:0 0 10px var(--yellow);animation:pulse 1.5s infinite}
.overall-badge.down .overall-dot{box-shadow:0 0 10px var(--red);animation:pulse 1s infinite}

.last-updated{font-size:.78rem;color:var(--muted)}
.last-updated strong{color:var(--text)}

/* ── Subsystem grid ────────────────────────────────────── */
.subsystem-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--gap)}

/* ── Subsystem card ────────────────────────────────────── */
.ss-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:1.1rem 1.25rem;display:flex;flex-direction:column;gap:.55rem;
  transition:border-color .3s}
.ss-card.healthy{border-left:3px solid var(--green)}
.ss-card.unhealthy{border-left:3px solid var(--red)}
.ss-card.unknown{border-left:3px solid var(--muted)}

.ss-header{display:flex;align-items:center;gap:.6rem}
.ss-dot{font-size:1.4rem;line-height:1;flex-shrink:0}
.ss-dot.healthy{color:var(--green)}
.ss-dot.unhealthy{color:var(--red)}
.ss-dot.unknown{color:var(--muted)}

.ss-name{font-weight:700;font-size:.95rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text)}
.ss-status-text{margin-left:auto;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  padding:.18rem .55rem;border-radius:9999px}
.ss-status-text.healthy{background:#14532d33;color:var(--green)}
.ss-status-text.unhealthy{background:#7f1d1d33;color:var(--red)}
.ss-status-text.unknown{background:#1e1e2e;color:var(--muted)}

.ss-meta{display:flex;flex-direction:column;gap:.25rem;padding-top:.25rem;border-top:1px solid var(--border)}
.ss-row{display:flex;justify-content:space-between;align-items:baseline;font-size:.8rem}
.ss-row .label{color:var(--muted)}
.ss-row .value{color:var(--text);font-weight:500}
.ss-row .value.latency{color:var(--blue)}
.ss-error{font-size:.78rem;color:var(--red);background:#7f1d1d22;
  border:1px solid #7f1d1d55;border-radius:6px;padding:.35rem .6rem;
  word-break:break-word}
.ss-failures{font-size:.75rem;color:var(--yellow);font-weight:600}

/* ── Error banner ──────────────────────────────────────── */
.fetch-error{background:#7f1d1d22;border:1px solid #7f1d1d55;border-radius:var(--radius);
  padding:.9rem 1.1rem;color:var(--red);font-size:.85rem;display:none}
.fetch-error.visible{display:block}

/* ── Section label ──────────────────────────────────────── */
.section-label{font-size:.7rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted)}

@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}
</style>
</head>
<body>
<div class="shell">

<!-- ── Header ──────────────────────────────────────────────────── -->
<header>
  <div class="logo">Voice Jib-Jab <span>/ Health Monitor</span></div>
  <div class="header-right">
    <a class="back-link" href="/dashboard">Back to Dashboard</a>
    <div class="ts" id="ts">--:--:--</div>
  </div>
</header>

<main>

<!-- ── Overall status ───────────────────────────────────────────── -->
<div class="overall-wrap">
  <div class="overall-badge unknown" id="overall-badge">
    <div class="overall-dot"></div>
    <span id="overall-text">UNKNOWN</span>
  </div>
  <div class="last-updated">Last updated: <strong id="last-updated-val">never</strong></div>
</div>

<!-- ── Fetch error banner ────────────────────────────────────────── -->
<div class="fetch-error" id="fetch-error">Unable to fetch status — check server connectivity</div>

<!-- ── Subsystem cards ───────────────────────────────────────────── -->
<div>
  <div class="section-label" style="margin-bottom:.75rem">Subsystems</div>
  <div class="subsystem-grid" id="subsystem-grid">
    <!-- populated by JS -->
  </div>
</div>

</main>

<footer>Voice Jib-Jab &mdash; auto-refresh every 10 s &mdash; <a href="/health/subsystems" style="color:var(--blue);text-decoration:none">/health/subsystems</a></footer>
</div>

<script>
'use strict';

// ── Overall status labels ─────────────────────────────────────────
const OVERALL_LABELS = { healthy: 'HEALTHY', degraded: 'DEGRADED', down: 'DOWN', unknown: 'UNKNOWN' };

// ── Subsystem display names ────────────────────────────────────────
const DISPLAY_NAMES = {
  stt:      'STT',
  tts:      'TTS',
  opa:      'OPA',
  chromadb: 'ChromaDB',
  database: 'Database',
};

const SUBSYSTEM_ORDER = ['stt', 'tts', 'opa', 'chromadb', 'database'];

// ── Helpers ──────────────────────────────────────────────────────
function qs(id){ return document.getElementById(id); }

/**
 * Format an ISO timestamp as a relative time string (e.g. "3s ago", "2m ago").
 *
 * @param {string} iso - ISO date string
 * @returns {string}
 */
function relTime(iso){
  if(!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffS = Math.floor(diffMs / 1000);
  if(diffS < 5)   return 'just now';
  if(diffS < 60)  return diffS + 's ago';
  if(diffS < 3600) return Math.floor(diffS / 60) + 'm ago';
  return Math.floor(diffS / 3600) + 'h ago';
}

// ── Render overall badge ─────────────────────────────────────────
function renderOverall(overall){
  const badge = qs('overall-badge');
  const text  = qs('overall-text');
  badge.className = 'overall-badge ' + (overall || 'unknown');
  text.textContent = OVERALL_LABELS[overall] || OVERALL_LABELS.unknown;
}

// ── Render subsystem cards ───────────────────────────────────────
function renderSubsystems(subsystems){
  const grid = qs('subsystem-grid');

  // Build a map for quick lookup
  const map = {};
  (subsystems || []).forEach(function(s){ map[s.name] = s; });

  // Render in a fixed order so layout is stable
  const cards = SUBSYSTEM_ORDER.map(function(name){
    const s = map[name];
    if(!s){
      return '<div class="ss-card unknown">' +
        '<div class="ss-header">' +
          '<div class="ss-dot unknown">●</div>' +
          '<div class="ss-name">' + (DISPLAY_NAMES[name] || name) + '</div>' +
          '<span class="ss-status-text unknown">unknown</span>' +
        '</div>' +
        '<div class="ss-meta">' +
          '<div class="ss-row"><span class="label">Latency</span><span class="value">—</span></div>' +
          '<div class="ss-row"><span class="label">Last checked</span><span class="value">never</span></div>' +
        '</div>' +
      '</div>';
    }

    const statusClass = s.status || 'unknown';
    const displayName = DISPLAY_NAMES[s.name] || s.name;
    const latency = (typeof s.latencyMs === 'number') ? s.latencyMs + 'ms' : '—';

    let errorHtml = '';
    if(s.status === 'unhealthy' && s.error){
      errorHtml = '<div class="ss-error">Error: ' + escHtml(s.error) + '</div>';
    }

    let failuresHtml = '';
    if(typeof s.consecutiveFailures === 'number' && s.consecutiveFailures > 0){
      failuresHtml = '<div class="ss-failures">&#x26A0; ' + s.consecutiveFailures + ' consecutive failure' +
        (s.consecutiveFailures === 1 ? '' : 's') + '</div>';
    }

    return '<div class="ss-card ' + statusClass + '">' +
      '<div class="ss-header">' +
        '<div class="ss-dot ' + statusClass + '">●</div>' +
        '<div class="ss-name">' + displayName + '</div>' +
        '<span class="ss-status-text ' + statusClass + '">' + statusClass + '</span>' +
      '</div>' +
      '<div class="ss-meta">' +
        '<div class="ss-row"><span class="label">Latency</span><span class="value latency">' + latency + '</span></div>' +
        '<div class="ss-row"><span class="label">Last checked</span><span class="value">' + relTime(s.checkedAt) + '</span></div>' +
      '</div>' +
      errorHtml +
      failuresHtml +
    '</div>';
  });

  grid.innerHTML = cards.join('');
}

// ── Escape HTML to prevent XSS in error messages ─────────────────
function escHtml(str){
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Update "last updated" display ────────────────────────────────
var lastSuccessAt = null;
var updateTimer   = null;

function tickLastUpdated(){
  if(!lastSuccessAt){ return; }
  qs('last-updated-val').textContent = relTime(lastSuccessAt);
}

// ── Main fetch + render ──────────────────────────────────────────
async function refresh(){
  try {
    const res  = await fetch('/health/subsystems');
    const data = await res.json();

    renderOverall(data.overall);
    renderSubsystems(data.subsystems);

    lastSuccessAt = new Date().toISOString();
    qs('last-updated-val').textContent = 'just now';
    qs('ts').textContent = new Date().toTimeString().slice(0,8);
    qs('fetch-error').classList.remove('visible');
  } catch(e){
    qs('fetch-error').classList.add('visible');
    console.warn('[VJJ Health] fetch error', e);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────
refresh();
setInterval(refresh, 10000);
setInterval(tickLastUpdated, 5000);
</script>
</body>
</html>`;
}
