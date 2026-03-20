/**
 * Compare Agents Dashboard — self-contained HTML page for side-by-side
 * agent configuration comparison.
 *
 * Electric blue design system (CSS vars shared with monitoringDashboard).
 * Zero external dependencies.
 */

export function compareAgentsDashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>VJJ — Compare Agent Configurations</title>
<style>
/* ── Reset & tokens ─────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1d4ed8;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;
  --purple:#a855f7;
  --radius:10px;--gap:1rem;
}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}

/* ── Layout ─────────────────────────────────────────────── */
.shell{display:flex;flex-direction:column;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;
  padding:.75rem 1.5rem;border-bottom:1px solid var(--border);background:var(--surface);
  position:sticky;top:0;z-index:100}
.logo{font-weight:700;font-size:1rem;color:var(--blue);letter-spacing:-.01em}
.logo span{color:var(--muted);font-weight:400}
.back-link{font-size:.8rem;color:var(--blue);text-decoration:none;opacity:.8}
.back-link:hover{opacity:1;text-decoration:underline}
main{flex:1;padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:1.5rem;max-width:1200px;margin:0 auto;width:100%}

/* ── Cards ──────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.1rem 1.25rem}
.card-title{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);margin-bottom:.85rem}

/* ── Form ───────────────────────────────────────────────── */
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
@media(max-width:700px){.form-grid{grid-template-columns:1fr}}
.field{display:flex;flex-direction:column;gap:.35rem}
label{font-size:.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
input,textarea{background:#0d0d14;border:1px solid var(--border);border-radius:6px;
  color:var(--text);padding:.5rem .75rem;font-size:.85rem;font-family:inherit;outline:none;width:100%;
  transition:border-color .15s}
input:focus,textarea:focus{border-color:var(--blue)}
textarea{min-height:64px;resize:vertical;font-family:monospace}
.btn{display:inline-flex;align-items:center;gap:.4rem;background:var(--blue-dim);color:#fff;
  border:none;border-radius:6px;padding:.55rem 1.2rem;font-size:.85rem;font-weight:600;
  cursor:pointer;transition:background .15s}
.btn:hover{background:var(--blue)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-sm{padding:.35rem .8rem;font-size:.78rem}

/* ── Recommendation badge ───────────────────────────────── */
.rec-wrap{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem}
.rec-badge{display:inline-flex;align-items:center;gap:.4rem;border-radius:9999px;
  padding:.35rem 1rem;font-size:.85rem;font-weight:700;letter-spacing:.02em}
.rec-a{background:#14532d33;color:var(--green);border:1px solid #22c55e44}
.rec-b{background:#14532d33;color:var(--green);border:1px solid #22c55e44}
.rec-tie{background:#78350f33;color:var(--yellow);border:1px solid #eab30844}
.rec-insufficient{background:#1e1e2e;color:var(--muted);border:1px solid var(--border)}
.rec-none{background:#1e1e2e;color:var(--muted);border:1px solid var(--border)}
.reasoning{font-size:.82rem;color:var(--muted);font-style:italic;max-width:600px}

/* ── Comparison table ───────────────────────────────────── */
.cmp-table{width:100%;border-collapse:collapse}
.cmp-table th{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);padding:.5rem .75rem;border-bottom:1px solid var(--border);text-align:left}
.cmp-table td{padding:.55rem .75rem;border-bottom:1px solid #16161f;font-size:.85rem;vertical-align:middle}
.cmp-table tr:last-child td{border-bottom:none}
.cmp-table .metric-name{color:var(--muted);font-size:.78rem}
.winner-check{color:var(--green);margin-left:.35rem;font-size:.95rem}

/* ── Bar chart ──────────────────────────────────────────── */
.bar-track{background:#1e1e2e;border-radius:9999px;height:8px;min-width:60px;overflow:hidden;display:inline-block;width:120px;vertical-align:middle}
.bar-fill{height:100%;border-radius:9999px;transition:width .5s ease}
.bar-val{display:inline-block;margin-left:.4rem;font-size:.78rem;color:var(--muted);vertical-align:middle}

/* ── Two-col results ────────────────────────────────────── */
.row2{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}
@media(max-width:700px){.row2{grid-template-columns:1fr}}

/* ── Sentiment breakdown ────────────────────────────────── */
.sent-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}
.sent-label{font-size:.75rem;color:var(--muted);min-width:80px}
.sent-bar{flex:1;height:6px;background:#1e1e2e;border-radius:9999px;overflow:hidden}
.sent-bar-fill{height:100%;border-radius:9999px}
.sent-val{font-size:.72rem;color:var(--muted);min-width:28px;text-align:right}

/* ── Status / error ─────────────────────────────────────── */
.status{font-size:.8rem;color:var(--muted);margin-top:.5rem}
.error{color:var(--red)}
#results{display:none}

footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}
</style>
</head>
<body>
<div class="shell">

<!-- ── Header ─────────────────────────────────────────────────────── -->
<header>
  <div class="logo">Voice Jib-Jab <span>/ Compare Agents</span></div>
  <a class="back-link" href="/dashboard">&larr; Back to Dashboard</a>
</header>

<main>

<!-- ── Run comparison form ─────────────────────────────────────────── -->
<div class="card">
  <div class="card-title">Run Comparison</div>
  <form id="compare-form" autocomplete="off">
    <div class="form-grid">
      <div>
        <div class="card-title" style="margin-bottom:.6rem">Config A</div>
        <div class="field" style="margin-bottom:.65rem">
          <label for="a-id">Config ID</label>
          <input id="a-id" name="aId" placeholder="e.g. gpt-4o-mini" required/>
        </div>
        <div class="field" style="margin-bottom:.65rem">
          <label for="a-label">Label</label>
          <input id="a-label" name="aLabel" placeholder="e.g. GPT-4o Mini" required/>
        </div>
        <div class="field">
          <label for="a-sessions">Session IDs (comma-separated)</label>
          <textarea id="a-sessions" name="aSessions" placeholder="sess-001, sess-002, sess-003" required></textarea>
        </div>
      </div>
      <div>
        <div class="card-title" style="margin-bottom:.6rem">Config B</div>
        <div class="field" style="margin-bottom:.65rem">
          <label for="b-id">Config ID</label>
          <input id="b-id" name="bId" placeholder="e.g. gpt-4o" required/>
        </div>
        <div class="field" style="margin-bottom:.65rem">
          <label for="b-label">Label</label>
          <input id="b-label" name="bLabel" placeholder="e.g. GPT-4o Full" required/>
        </div>
        <div class="field">
          <label for="b-sessions">Session IDs (comma-separated)</label>
          <textarea id="b-sessions" name="bSessions" placeholder="sess-004, sess-005, sess-006" required></textarea>
        </div>
      </div>
    </div>
    <div style="margin-top:1rem;display:flex;align-items:center;gap:1rem">
      <button class="btn" type="submit" id="run-btn">Run Comparison</button>
      <div class="status" id="status"></div>
    </div>
  </form>
</div>

<!-- ── Results ─────────────────────────────────────────────────────── -->
<div id="results">

  <!-- Recommendation -->
  <div class="card">
    <div class="card-title">Recommendation</div>
    <div class="rec-wrap">
      <div id="rec-badge" class="rec-badge rec-none">—</div>
      <div class="reasoning" id="reasoning"></div>
    </div>
    <div style="font-size:.72rem;color:var(--muted)" id="report-meta"></div>
  </div>

  <!-- Metric comparison table -->
  <div class="card">
    <div class="card-title">Metric Comparison</div>
    <table class="cmp-table" id="metric-table">
      <thead>
        <tr>
          <th style="min-width:130px">Metric</th>
          <th id="th-a">Config A</th>
          <th id="th-b">Config B</th>
        </tr>
      </thead>
      <tbody id="metric-body"></tbody>
    </table>
  </div>

  <!-- Quality score bars -->
  <div class="row2">
    <div class="card">
      <div class="card-title" id="sent-title-a">Sentiment — Config A</div>
      <div id="sent-bars-a"></div>
    </div>
    <div class="card">
      <div class="card-title" id="sent-title-b">Sentiment — Config B</div>
      <div id="sent-bars-b"></div>
    </div>
  </div>

</div><!-- #results -->

</main>

<footer>Voice Jib-Jab &mdash; Agent Comparison &mdash; <a href="/dashboard" style="color:var(--blue);text-decoration:none">/dashboard</a></footer>
</div>

<script>
'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────
function qs(id){ return document.getElementById(id); }

function parseSessions(raw){
  return raw.split(',').map(s=>s.trim()).filter(Boolean);
}

function fmtMs(ms){
  if(ms===0) return '—';
  if(ms<1000) return ms.toFixed(0)+'ms';
  return (ms/1000).toFixed(1)+'s';
}

function fmtPct(v){ return v.toFixed(1)+'%'; }
function fmtNum(v){ return v.toFixed(1); }

// ── Recommendation badge ─────────────────────────────────────────────────
function renderRecommendation(report){
  const badge = qs('rec-badge');
  const rec = report.recommendation;

  badge.className = 'rec-badge';
  if(rec === 'A'){
    badge.classList.add('rec-a');
    badge.textContent = 'Config A wins — ' + report.configA.label;
  } else if(rec === 'B'){
    badge.classList.add('rec-b');
    badge.textContent = 'Config B wins — ' + report.configB.label;
  } else if(rec === 'tie'){
    badge.classList.add('rec-tie');
    badge.textContent = 'Tie';
  } else if(rec === 'insufficient_data'){
    badge.classList.add('rec-insufficient');
    badge.textContent = 'Insufficient Data';
  } else {
    badge.classList.add('rec-none');
    badge.textContent = rec;
  }

  qs('reasoning').textContent = report.reasoning;
  qs('report-meta').textContent = 'Report ID: ' + report.reportId + ' · Generated: ' + new Date(report.generatedAt).toLocaleString();
}

// ── Bar helper ────────────────────────────────────────────────────────────
function bar(pct, color){
  color = color || 'var(--blue)';
  return '<div class="bar-track"><div class="bar-fill" style="width:'+Math.min(pct,100)+'%;background:'+color+'"></div></div>';
}

// ── Metric table ─────────────────────────────────────────────────────────
function check(winner, side){
  return winner === side ? '<span class="winner-check">&#10003;</span>' : '';
}

function renderMetricTable(report){
  const a = report.configA;
  const b = report.configB;
  const w = report.metricWinners;

  qs('th-a').textContent = a.label;
  qs('th-b').textContent = b.label;

  const maxQ = Math.max(a.avgQualityScore, b.avgQualityScore, 1);
  const maxLat = Math.max(a.p50LatencyMs, b.p50LatencyMs, 1);
  const maxEsc = Math.max(a.escalationRatePct, b.escalationRatePct, 1);

  const rows = [
    {
      name: 'Quality Score (avg)',
      aVal: fmtNum(a.avgQualityScore),
      bVal: fmtNum(b.avgQualityScore),
      aBar: bar(a.avgQualityScore/maxQ*100, 'var(--green)'),
      bBar: bar(b.avgQualityScore/maxQ*100, 'var(--green)'),
      winner: w.quality,
    },
    {
      name: 'Latency P50',
      aVal: fmtMs(a.p50LatencyMs),
      bVal: fmtMs(b.p50LatencyMs),
      aBar: bar(a.p50LatencyMs/maxLat*100, 'var(--blue)'),
      bBar: bar(b.p50LatencyMs/maxLat*100, 'var(--blue)'),
      winner: w.latency,
    },
    {
      name: 'Latency P95',
      aVal: fmtMs(a.p95LatencyMs),
      bVal: fmtMs(b.p95LatencyMs),
      aBar: null,
      bBar: null,
      winner: null,
    },
    {
      name: 'Escalation Rate',
      aVal: fmtPct(a.escalationRatePct),
      bVal: fmtPct(b.escalationRatePct),
      aBar: bar(a.escalationRatePct/maxEsc*100, 'var(--red)'),
      bBar: bar(b.escalationRatePct/maxEsc*100, 'var(--red)'),
      winner: w.escalation,
    },
    {
      name: 'Top Sentiment',
      aVal: a.topSentiment,
      bVal: b.topSentiment,
      aBar: null,
      bBar: null,
      winner: w.sentiment,
    },
    {
      name: 'Avg Turn Count',
      aVal: fmtNum(a.avgTurnCount),
      bVal: fmtNum(b.avgTurnCount),
      aBar: null,
      bBar: null,
      winner: null,
    },
    {
      name: 'Sessions',
      aVal: a.sessionCount,
      bVal: b.sessionCount,
      aBar: null,
      bBar: null,
      winner: null,
    },
  ];

  qs('metric-body').innerHTML = rows.map(r=>'<tr>'+
    '<td class="metric-name">'+r.name+'</td>'+
    '<td>'+(r.aBar||'')+' <span class="bar-val">'+r.aVal+'</span>'+(r.winner?check(r.winner,'A'):'')+'</td>'+
    '<td>'+(r.bBar||'')+' <span class="bar-val">'+r.bVal+'</span>'+(r.winner?check(r.winner,'B'):'')+'</td>'+
  '</tr>').join('');
}

// ── Sentiment bars ────────────────────────────────────────────────────────
const SENT_COLORS = {
  positive: 'var(--green)',
  neutral:  'var(--blue)',
  negative: 'var(--red)',
  frustrated: 'var(--orange)',
};

function renderSentimentBars(config, containerId, titleId){
  qs(titleId).textContent = 'Sentiment — ' + config.label;
  const bd = config.sentimentBreakdown || {};
  const total = Object.values(bd).reduce((s,v)=>s+v, 0) || 1;
  const sentiments = ['positive','neutral','negative','frustrated'];
  const wrap = qs(containerId);
  const lines = sentiments.map(s=>{
    const count = bd[s]||0;
    const pct = count/total*100;
    const color = SENT_COLORS[s]||'var(--blue)';
    return '<div class="sent-row">'+
      '<div class="sent-label">'+s+'</div>'+
      '<div class="sent-bar"><div class="sent-bar-fill" style="width:'+pct.toFixed(1)+'%;background:'+color+'"></div></div>'+
      '<div class="sent-val">'+count+'</div>'+
    '</div>';
  });
  wrap.innerHTML = lines.join('')||'<div style="color:var(--muted);font-size:.8rem">No sentiment data</div>';
}

// ── Render full report ────────────────────────────────────────────────────
function renderReport(report){
  renderRecommendation(report);
  renderMetricTable(report);
  renderSentimentBars(report.configA, 'sent-bars-a', 'sent-title-a');
  renderSentimentBars(report.configB, 'sent-bars-b', 'sent-title-b');
  qs('results').style.display = 'block';
}

// ── Form submit ───────────────────────────────────────────────────────────
qs('compare-form').addEventListener('submit', async function(e){
  e.preventDefault();
  const btn = qs('run-btn');
  const status = qs('status');

  btn.disabled = true;
  status.textContent = 'Running comparison…';
  status.className = 'status';

  const body = {
    configA: {
      configId: qs('a-id').value.trim(),
      label:    qs('a-label').value.trim(),
      sessionIds: parseSessions(qs('a-sessions').value),
    },
    configB: {
      configId: qs('b-id').value.trim(),
      label:    qs('b-label').value.trim(),
      sessionIds: parseSessions(qs('b-sessions').value),
    },
  };

  try {
    const res = await fetch('/compare-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if(!res.ok){
      status.textContent = 'Error: ' + (data.error || res.statusText);
      status.className = 'status error';
      return;
    }

    renderReport(data);
    status.textContent = 'Done.';
    status.className = 'status';
  } catch(err){
    status.textContent = 'Network error: ' + err.message;
    status.className = 'status error';
  } finally {
    btn.disabled = false;
  }
});

// ── Auto-load most recent report on page open ─────────────────────────────
async function loadMostRecent(){
  try {
    const res = await fetch('/compare-agents/reports');
    if(!res.ok) return;
    const reports = await res.json();
    if(Array.isArray(reports) && reports.length > 0){
      const latest = reports[reports.length - 1];
      renderReport(latest);
    }
  } catch(_){}
}

loadMostRecent();
setInterval(loadMostRecent, 30000);
</script>
</body>
</html>`;
}
