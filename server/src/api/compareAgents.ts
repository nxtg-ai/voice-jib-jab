/**
 * Compare Agents API Router — HTTP endpoints for agent configuration comparison.
 *
 * Routes:
 *   POST /compare-agents         — run a comparison; body: { configA, configB }
 *   GET  /compare-agents/reports — list all generated reports
 *   GET  /compare-agents/dashboard — self-contained HTML comparison dashboard
 */

import { Router } from "express";
import type { AgentComparisonService, ComparisonConfig } from "../services/AgentComparisonService.js";
import { compareAgentsDashboardHtml } from "./compareAgentsDashboard.js";

/**
 * Create the compare-agents router with an injected AgentComparisonService.
 *
 * @param service - AgentComparisonService instance
 * @returns Express Router
 */
export function createCompareAgentsRouter(service: AgentComparisonService): Router {
  const router = Router();

  /**
   * POST /compare-agents
   *
   * Body: { configA: ComparisonConfig, configB: ComparisonConfig }
   *
   * 400 — missing configA or configB, or either has empty sessionIds
   * 200 — ComparisonReport JSON
   */
  router.post("/", async (req, res) => {
    const { configA, configB } = req.body as { configA?: ComparisonConfig; configB?: ComparisonConfig };

    if (!configA || typeof configA !== "object") {
      res.status(400).json({ error: "configA is required" });
      return;
    }

    if (!configB || typeof configB !== "object") {
      res.status(400).json({ error: "configB is required" });
      return;
    }

    if (!Array.isArray(configA.sessionIds) || configA.sessionIds.length === 0) {
      res.status(400).json({ error: "configA.sessionIds must be a non-empty array" });
      return;
    }

    if (!Array.isArray(configB.sessionIds) || configB.sessionIds.length === 0) {
      res.status(400).json({ error: "configB.sessionIds must be a non-empty array" });
      return;
    }

    const report = await service.compareConfigs(configA, configB);
    res.json(report);
  });

  /**
   * GET /compare-agents/reports
   *
   * 200 — array of all ComparisonReport objects (oldest first)
   */
  router.get("/reports", (_req, res) => {
    res.json(service.listReports());
  });

  /**
   * GET /compare-agents/dashboard
   *
   * 200 — self-contained HTML page
   */
  router.get("/dashboard", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(compareAgentsDashboardHtml());
  });

  return router;
}
