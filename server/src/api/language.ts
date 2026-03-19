/**
 * Language API Router
 *
 * GET /language/detect?text=<text>    — detect language from text sample
 * GET /language/templates             — list templates grouped by language
 */

import { Router } from "express";
import { LanguageDetector, type SupportedLanguage } from "../services/LanguageDetector.js";
import type { AgentTemplateStore } from "../services/AgentTemplateStore.js";

// ── Language → template ID mapping ────────────────────────────────────

const LANGUAGE_TEMPLATE_MAP: Record<SupportedLanguage, string> = {
  en: "builtin-customer-support",
  es: "builtin-support-es",
  fr: "builtin-support-fr",
  de: "builtin-support-de",
  pt: "builtin-customer-support",
};

// ── Router factory ─────────────────────────────────────────────────────

/**
 * Create the language detection and routing API router.
 *
 * @param store - The AgentTemplateStore instance for template lookups.
 * @returns Express Router mounted at /language.
 */
export function createLanguageRouter(store: AgentTemplateStore): Router {
  const router = Router();
  const detector = new LanguageDetector();

  /**
   * GET /language/detect?text=<text>
   *
   * Detect the language of the provided text sample.
   * Returns language, confidence, fallback flag, and the recommended templateId.
   */
  router.get("/detect", (req, res) => {
    const text = req.query.text;

    if (typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text query parameter is required" });
      return;
    }

    const result = detector.detect(text);
    const templateId = LANGUAGE_TEMPLATE_MAP[result.language] ?? "builtin-customer-support";

    res.json({
      language: result.language,
      confidence: result.confidence,
      fallback: result.fallback,
      templateId,
    });
  });

  /**
   * GET /language/templates
   *
   * List all templates grouped by detected language from their greeting.
   * Returns an object keyed by ISO 639-1 language code.
   */
  router.get("/templates", (_req, res) => {
    const all = store.listTemplates();

    const grouped: Record<string, typeof all> = {};

    for (const template of all) {
      const detection = detector.detect(template.greeting);
      const lang = detection.language;

      if (!grouped[lang]) {
        grouped[lang] = [];
      }
      grouped[lang].push(template);
    }

    res.json(grouped);
  });

  return router;
}
