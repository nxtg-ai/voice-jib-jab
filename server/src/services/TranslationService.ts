/**
 * TranslationService — voice-aware translation pipeline.
 *
 * Supports EN↔ES, EN↔FR, EN↔DE translation pairs. Integrates with
 * LanguageDetector for automatic caller language identification.
 *
 * Design:
 *   - TranslationProvider interface enables plug-in of real translation APIs
 *   - StubTranslationProvider is deterministic and used in tests
 *   - TranslationService.runPipeline() handles the full caller↔agent flow
 *   - Module-level singleton exported as `translationService`
 */

import { LanguageDetector, type LanguageDetectionResult } from "./LanguageDetector.js";

// ── Types ──────────────────────────────────────────────────────────────

export type TranslationLanguage = "en" | "es" | "fr" | "de";

/** Supported translation pairs (both directions). */
export const SUPPORTED_PAIRS = [
  ["en", "es"],
  ["en", "fr"],
  ["en", "de"],
] as const;

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  fromLanguage: TranslationLanguage;
  toLanguage: TranslationLanguage;
  /** Provider that performed the translation. "stub" for built-in stub. */
  provider: string;
  /** Measured translation latency in milliseconds. */
  latencyMs: number;
}

export interface PipelineResult {
  callerInput: string;
  /** Detected or assumed caller language. */
  detectedLanguage: TranslationLanguage;
  detectionConfidence: number;
  /** callerInput translated to agentLanguage (or same if same language). */
  agentInput: string;
  /** The agent's response in agentLanguage (provided by caller). */
  agentResponse: string;
  /** agentResponse translated back to callerLanguage. */
  callerResponse: string;
  pipelineLatencyMs: number;
  /** Number of translation operations performed (0, 1, or 2). */
  translationsPerformed: number;
}

// ── Pair support check ────────────────────────────────────────────────

/**
 * Check whether a translation pair is supported.
 *
 * Supports both directions of the defined pairs (en↔es, en↔fr, en↔de).
 * Same-language pairs (e.g. en→en) return true (no-op translation).
 *
 * @param from - Source language code
 * @param to - Target language code
 * @returns true if the pair can be translated
 */
export function isSupportedPair(from: string, to: string): boolean {
  // Same language is always a no-op passthrough — supported
  if (from === to) {
    return true;
  }

  for (const [a, b] of SUPPORTED_PAIRS) {
    if ((from === a && to === b) || (from === b && to === a)) {
      return true;
    }
  }

  return false;
}

// ── TranslationProvider interface ─────────────────────────────────────

/**
 * TranslationProvider — implement to plug in a real translation API.
 *
 * The `translate` method is called only when `from !== to`.
 * Implementations must handle all supported pairs.
 */
export interface TranslationProvider {
  translate(
    text: string,
    from: TranslationLanguage,
    to: TranslationLanguage,
  ): Promise<string>;
  readonly providerName: string;
}

// ── StubTranslationProvider ───────────────────────────────────────────

/**
 * StubTranslationProvider — deterministic stub for testing.
 *
 * Returns "[{FROM}→{TO}] {original_text}" for cross-language translations.
 * When from === to, returns original text unchanged.
 *
 * @example
 *   stub.translate("hello", "en", "es")
 *   // → "[EN→ES] hello"
 */
export class StubTranslationProvider implements TranslationProvider {
  readonly providerName = "stub";

  async translate(
    text: string,
    from: TranslationLanguage,
    to: TranslationLanguage,
  ): Promise<string> {
    if (from === to) {
      return text;
    }
    return `[${from.toUpperCase()}→${to.toUpperCase()}] ${text}`;
  }
}

// ── Helper: cast SupportedLanguage → TranslationLanguage ──────────────

/**
 * Cast a SupportedLanguage (which may include "pt") to TranslationLanguage.
 *
 * Portuguese ("pt") is detected by LanguageDetector but is not a supported
 * translation language. We fall back to "en" for unsupported detections.
 */
function toTranslationLanguage(lang: string): TranslationLanguage {
  const VALID: ReadonlySet<TranslationLanguage> = new Set(["en", "es", "fr", "de"]);
  return VALID.has(lang as TranslationLanguage) ? (lang as TranslationLanguage) : "en";
}

// ── TranslationService ────────────────────────────────────────────────

export class TranslationService {
  private readonly detector = new LanguageDetector();

  constructor(
    private readonly provider: TranslationProvider = new StubTranslationProvider(),
  ) {}

  /**
   * Detect the language of the provided text.
   *
   * Delegates to LanguageDetector. Returns LanguageDetectionResult with
   * `language`, `confidence`, and `fallback` fields.
   *
   * @param text - Text sample to detect language from
   * @returns LanguageDetectionResult from LanguageDetector
   */
  detectLanguage(text: string): LanguageDetectionResult {
    return this.detector.detect(text);
  }

  /**
   * Translate text from one language to another.
   *
   * Measures actual latency using Date.now() timing around the provider call.
   * When from === to, returns the original text with latencyMs = 0 (no provider call).
   * Throws if the language pair is not supported.
   *
   * @param text - Text to translate
   * @param from - Source language
   * @param to - Target language
   * @returns TranslationResult with translated text and metadata
   * @throws Error if the pair is not supported
   */
  async translate(
    text: string,
    from: TranslationLanguage,
    to: TranslationLanguage,
  ): Promise<TranslationResult> {
    if (!isSupportedPair(from, to)) {
      throw new Error(`Unsupported translation pair: ${from}→${to}`);
    }

    // Same language — passthrough with zero latency
    if (from === to) {
      return {
        originalText: text,
        translatedText: text,
        fromLanguage: from,
        toLanguage: to,
        provider: this.provider.providerName,
        latencyMs: 0,
      };
    }

    const start = Date.now();
    const translatedText = await this.provider.translate(text, from, to);
    const latencyMs = Date.now() - start;

    return {
      originalText: text,
      translatedText,
      fromLanguage: from,
      toLanguage: to,
      provider: this.provider.providerName,
      latencyMs,
    };
  }

  /**
   * Full translation pipeline for a caller↔agent exchange.
   *
   * Steps:
   *   1. If callerLanguage is not provided, detect it from callerText
   *   2. If callerLanguage !== agentLanguage, translate callerText → agentLanguage
   *   3. Translate agentResponse → callerLanguage (if different)
   *
   * Language detection result with confidence < threshold (or "pt") falls back
   * to "en". This means a Portuguese speaker gets an English response — acceptable
   * until PT is added to the supported pairs.
   *
   * @param callerText - The caller's input text
   * @param agentResponse - The agent's response (in agentLanguage)
   * @param agentLanguage - Language the agent operates in (default: "en")
   * @param callerLanguage - Caller's language (if known; detected from callerText if omitted)
   * @returns PipelineResult with all translations and metadata
   */
  async runPipeline(
    callerText: string,
    agentResponse: string,
    agentLanguage: TranslationLanguage = "en",
    callerLanguage?: TranslationLanguage,
  ): Promise<PipelineResult> {
    const pipelineStart = Date.now();

    // Step 1: Resolve caller language
    let detectedLanguage: TranslationLanguage;
    let detectionConfidence: number;

    if (callerLanguage !== undefined) {
      detectedLanguage = callerLanguage;
      detectionConfidence = 1.0;
    } else {
      const detection = this.detector.detect(callerText);
      detectedLanguage = toTranslationLanguage(detection.language);
      detectionConfidence = detection.confidence;
    }

    let translationsPerformed = 0;
    let agentInput = callerText;
    let callerResponse = agentResponse;

    // Step 2: Translate caller text → agent language (if needed)
    if (detectedLanguage !== agentLanguage) {
      if (isSupportedPair(detectedLanguage, agentLanguage)) {
        const result = await this.translate(callerText, detectedLanguage, agentLanguage);
        agentInput = result.translatedText;
        translationsPerformed++;
      }
      // If pair is not supported, pass through as-is (fallback to "en" already applied above)
    }

    // Step 3: Translate agent response → caller language (if needed)
    if (agentLanguage !== detectedLanguage) {
      if (isSupportedPair(agentLanguage, detectedLanguage)) {
        const result = await this.translate(agentResponse, agentLanguage, detectedLanguage);
        callerResponse = result.translatedText;
        translationsPerformed++;
      }
    }

    const pipelineLatencyMs = Date.now() - pipelineStart;

    return {
      callerInput: callerText,
      detectedLanguage,
      detectionConfidence,
      agentInput,
      agentResponse,
      callerResponse,
      pipelineLatencyMs,
      translationsPerformed,
    };
  }
}

// ── Module-level singleton ─────────────────────────────────────────────

/**
 * Module-level singleton TranslationService using the StubTranslationProvider.
 *
 * TranslationService is stateless — create a new instance directly
 * (no proxy pattern required unlike PlaybookStore).
 */
export const translationService = new TranslationService();
