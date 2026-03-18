/**
 * Analytics API Router — provides HTTP endpoints for querying session
 * analytics and aggregate metrics.
 *
 * Endpoints:
 *   GET /analytics/sessions       — list sessions with aggregate metrics (filterable)
 *   GET /analytics/sessions/:id   — get metrics for a single session
 *   GET /analytics/summary        — aggregate metrics across all sessions
 */

import { Router } from "express";
import type { AnalyticsService, AnalyticsFilter } from "../services/AnalyticsService.js";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// ── Router factory ───────────────────────────────────────────────────

interface AnalyticsRouterDeps {
  analyticsService: AnalyticsService;
  loadRecording?: (sessionId: string) => unknown | null;
}

export function createAnalyticsRouter(
  analyticsService: AnalyticsService,
  loadRecording?: (sessionId: string) => unknown | null,
): Router {
  const router = Router();
  const deps: AnalyticsRouterDeps = { analyticsService, loadRecording };

  /**
   * GET /sessions — list sessions with aggregate metrics.
   * Query params: tenantId, from, to, limit, offset
   */
  router.get("/sessions", (req, res) => {
    const filter: AnalyticsFilter = {};

    if (typeof req.query.tenantId === "string" && req.query.tenantId) {
      filter.tenantId = req.query.tenantId;
    }
    if (typeof req.query.from === "string" && req.query.from) {
      filter.fromDate = req.query.from;
    }
    if (typeof req.query.to === "string" && req.query.to) {
      filter.toDate = req.query.to;
    }

    const rawLimit = parseInt(req.query.limit as string, 10);
    filter.limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const rawOffset = parseInt(req.query.offset as string, 10);
    filter.offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const metrics = deps.analyticsService.getAggregateMetrics(filter);

    res.json({
      filter: {
        tenantId: filter.tenantId ?? null,
        from: filter.fromDate ?? null,
        to: filter.toDate ?? null,
        limit: filter.limit,
        offset: filter.offset,
      },
      metrics,
    });
  });

  /**
   * GET /sessions/:id — get metrics for a single session.
   */
  router.get("/sessions/:id", (req, res) => {
    const sessionId = req.params.id;

    // Try to find the session in the recordings list
    const allMetrics = deps.analyticsService.getAggregateMetrics({ limit: 10000 });
    const session = allMetrics.sessions.find((s) => s.sessionId === sessionId);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(session);
  });

  /**
   * GET /summary — aggregate metrics across all sessions (no filter).
   */
  router.get("/summary", (_req, res) => {
    const metrics = deps.analyticsService.getAggregateMetrics();
    res.json(metrics);
  });

  return router;
}
