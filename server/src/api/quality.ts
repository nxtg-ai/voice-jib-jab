/**
 * Quality API Router — provides HTTP endpoints for voice session quality scoring.
 *
 * Endpoints:
 *   GET /quality/:sessionId — returns detailed QualityScorecard for a session
 *   PUT /quality/config     — update scorer threshold and webhook URL
 */

import { Router } from "express";
import type { SessionRecorder } from "../services/SessionRecorder.js";
import type { VoiceQualityScorer } from "../services/VoiceQualityScorer.js";

// ── Constants ────────────────────────────────────────────────────────

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ── Router factory ───────────────────────────────────────────────────

/**
 * Create the quality router with injected recorder and scorer dependencies.
 *
 * @param recorder - SessionRecorder instance for loading session recordings
 * @param scorer   - VoiceQualityScorer instance for computing scorecards
 * @returns Express Router with GET /:sessionId and PUT /config endpoints
 */
export function createQualityRouter(
  recorder: SessionRecorder,
  scorer: VoiceQualityScorer,
): Router {
  const router = Router();

  /**
   * GET /quality/:sessionId — return detailed quality scorecard.
   *
   * 400 — invalid session ID format
   * 404 — session recording not found
   * 200 — full QualityScorecard JSON
   */
  router.get("/:sessionId", (req, res) => {
    const { sessionId } = req.params;

    if (!VALID_ID_PATTERN.test(sessionId)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }

    const recording = recorder.loadRecording(sessionId);
    if (!recording) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const scorecard = scorer.score(sessionId, recording);
    res.json(scorecard);
  });

  /**
   * PUT /quality/config — update scorer configuration in place.
   *
   * Body: { qualityThreshold?: number (0-100), webhookUrl?: string }
   * 400 — qualityThreshold not a number, or out of range 0-100
   * 200 — { qualityThreshold, webhookUrl }
   */
  router.put("/config", (req, res) => {
    const { qualityThreshold, webhookUrl } = req.body as {
      qualityThreshold?: unknown;
      webhookUrl?: unknown;
    };

    if (qualityThreshold !== undefined) {
      if (typeof qualityThreshold !== "number") {
        res.status(400).json({ error: "qualityThreshold must be a number" });
        return;
      }
      if (qualityThreshold < 0 || qualityThreshold > 100) {
        res.status(400).json({ error: "qualityThreshold must be between 0 and 100" });
        return;
      }
      scorer.config.qualityThreshold = qualityThreshold;
    }

    if (webhookUrl !== undefined) {
      scorer.config.webhookUrl = webhookUrl as string | undefined;
    }

    res.json({
      qualityThreshold: scorer.config.qualityThreshold,
      webhookUrl: scorer.config.webhookUrl,
    });
  });

  return router;
}
