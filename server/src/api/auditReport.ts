/**
 * Audit Report Router — per-tenant monthly compliance report endpoints.
 *
 * Routes:
 *   GET /audit/report     — generate (or return) a report for a tenant/month
 *   GET /audit/reports    — list cached reports as JSON
 *   GET /audit/dashboard  — HTML form for interactive report generation
 *
 * Format query parameter:
 *   ?format=html  (default) — returns text/html
 *   ?format=json            — returns application/json AuditReport
 *   ?format=pdf             — returns same HTML with Content-Type: application/pdf
 *                             and Content-Disposition: inline; filename="..."
 */

import { Router } from "express";
import type { AuditReportService } from "../services/AuditReportService.js";

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create the audit report router.
 *
 * @param service - AuditReportService instance to delegate to
 * @returns Express Router mounted at /audit
 */
export function createAuditReportRouter(service: AuditReportService): Router {
  const router = Router();

  // ── GET /audit/report ───────────────────────────────────────────────────

  router.get("/report", async (req, res) => {
    const { tenantId, year: yearRaw, month: monthRaw, format = "html" } = req.query as Record<string, string | undefined>;

    // Validate required params
    if (!tenantId) {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }

    if (yearRaw === undefined || yearRaw === null || yearRaw === "") {
      res.status(400).json({ error: "year is required" });
      return;
    }

    if (monthRaw === undefined || monthRaw === null || monthRaw === "") {
      res.status(400).json({ error: "month is required" });
      return;
    }

    const year = Number(yearRaw);
    const month = Number(monthRaw);

    if (!Number.isInteger(year) || isNaN(year)) {
      res.status(400).json({ error: "year must be a valid integer" });
      return;
    }

    if (!Number.isInteger(month) || isNaN(month)) {
      res.status(400).json({ error: "month must be a valid integer" });
      return;
    }

    if (month < 1 || month > 12) {
      res.status(400).json({ error: "month must be between 1 and 12" });
      return;
    }

    try {
      const report = await service.generateReport({ tenantId, year, month });

      if (format === "json") {
        res.json(report);
        return;
      }

      const html = service.generateHtml(report);

      if (format === "pdf") {
        const filename = `audit-${tenantId}-${year}-${String(month).padStart(2, "0")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.send(html);
        return;
      }

      // Default: HTML
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.status(500).json({ error: message });
    }
  });

  // ── GET /audit/reports ──────────────────────────────────────────────────

  router.get("/reports", (_req, res) => {
    res.json(service.listReports());
  });

  // ── GET /audit/dashboard ────────────────────────────────────────────────

  router.get("/dashboard", (_req, res) => {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audit Report Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --blue: #00d4ff;
      --blue-dark: #0096cc;
      --bg: #0a0f1e;
      --surface: #111827;
      --surface2: #1e2a3a;
      --text: #e2e8f0;
      --text-muted: #8ba3bc;
      --border: #1e3a5f;
    }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 0.75rem; padding: 2rem; width: 100%; max-width: 480px; }
    h1 { font-size: 1.5rem; color: var(--blue); margin-bottom: 0.25rem; }
    p.sub { color: var(--text-muted); font-size: 0.875rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; margin-top: 1rem; }
    input, select {
      width: 100%; padding: 0.6rem 0.75rem;
      background: var(--surface2); color: var(--text);
      border: 1px solid var(--border); border-radius: 0.375rem;
      font-size: 0.875rem;
    }
    input:focus, select:focus { outline: 2px solid var(--blue); }
    .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; flex-wrap: wrap; }
    button {
      flex: 1; padding: 0.65rem 1rem;
      border: none; border-radius: 0.375rem;
      font-size: 0.875rem; font-weight: 600; cursor: pointer;
    }
    .btn-html { background: var(--blue); color: #000; }
    .btn-json { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
    .btn-pdf  { background: #1e3a5f; color: var(--blue); border: 1px solid var(--border); }
    button:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Audit Report Dashboard</h1>
    <p class="sub">Generate a per-tenant monthly compliance report.</p>
    <form id="form">
      <label for="tenantId">Tenant ID</label>
      <input id="tenantId" name="tenantId" type="text" placeholder="e.g. acme-corp" required>

      <label for="year">Year</label>
      <input id="year" name="year" type="number" value="${currentYear}" min="2020" max="2099" required>

      <label for="month">Month</label>
      <select id="month" name="month">
        ${Array.from({ length: 12 }, (_, i) => {
          const m = i + 1;
          const sel = m === currentMonth ? ' selected' : '';
          const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
          return `<option value="${m}"${sel}>${names[i]}</option>`;
        }).join("")}
      </select>

      <div class="actions">
        <button type="button" class="btn-html" onclick="navigate('html')">View HTML</button>
        <button type="button" class="btn-json" onclick="navigate('json')">Download JSON</button>
        <button type="button" class="btn-pdf"  onclick="navigate('pdf')">Export PDF</button>
      </div>
    </form>
  </div>
  <script>
    function navigate(format) {
      const tenantId = document.getElementById('tenantId').value.trim();
      const year = document.getElementById('year').value;
      const month = document.getElementById('month').value;
      if (!tenantId) { alert('Please enter a Tenant ID'); return; }
      const url = '/audit/report?tenantId=' + encodeURIComponent(tenantId) + '&year=' + year + '&month=' + month + '&format=' + format;
      window.open(url, '_blank');
    }
  </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  return router;
}
