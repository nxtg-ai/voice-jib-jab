/**
 * Health Monitor API
 *
 * GET /health/subsystems — returns all subsystem statuses and overall health
 */

import { Router } from "express";
import type { HealthMonitorService } from "../services/HealthMonitorService.js";

// ── Router factory ────────────────────────────────────────────────

/**
 * Create an Express router for the health monitor endpoints.
 *
 * @param monitor - The HealthMonitorService instance to query
 * @returns Configured Express Router
 */
export function createHealthRouter(monitor: HealthMonitorService): Router {
  const router = Router();

  // ── GET /health/subsystems ────────────────────────────────────

  /**
   * Return overall system status and the status of all subsystems.
   *
   * Response body:
   *   overall    — "healthy" | "degraded" | "down"
   *   subsystems — array of SubsystemStatus objects
   *   checkedAt  — ISO timestamp of when this response was generated
   */
  router.get("/subsystems", (_req, res) => {
    res.json({
      overall: monitor.getOverallStatus(),
      subsystems: monitor.getStatus(),
      checkedAt: new Date().toISOString(),
    });
  });

  return router;
}
