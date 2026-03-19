/**
 * LanguageDetector — lightweight language detection from transcript text.
 *
 * Detects language from a short text sample (5-30 words) using Unicode
 * script analysis and common word frequency matching. No external deps.
 *
 * Supported languages (ISO 639-1 codes):
 *   en, es, fr, de, pt
 *
 * Fallback: "en" if confidence < threshold or language unsupported.
 */

export type SupportedLanguage = "en" | "es" | "fr" | "de" | "pt";

export interface LanguageDetectionResult {
  language: SupportedLanguage;
  confidence: number; // 0.0 – 1.0
  fallback: boolean;  // true if we fell back to "en"
}

// ── High-frequency word lists per language ────────────────────────────

const WORD_LISTS: Record<SupportedLanguage, ReadonlySet<string>> = {
  es: new Set([
    "el", "la", "de", "que", "en", "y", "es", "por", "los", "se",
    "del", "las", "un", "con", "una", "para", "como", "pero", "más", "hay",
  ]),
  fr: new Set([
    "le", "la", "de", "et", "en", "est", "les", "des", "que", "un",
    "une", "pas", "je", "vous", "nous", "il", "qui", "sur", "au", "avec",
  ]),
  de: new Set([
    "der", "die", "das", "und", "ist", "ich", "ein", "nicht", "sie", "es",
    "den", "zu", "mit", "auf", "dem", "für", "im", "an", "auch", "von",
  ]),
  pt: new Set([
    "de", "a", "o", "que", "e", "do", "da", "em", "um", "para",
    "com", "uma", "os", "no", "se", "na", "por", "mais", "as", "dos",
  ]),
  en: new Set([
    "the", "is", "are", "was", "were", "have", "has", "had", "will", "would",
    "can", "could", "should", "this", "that", "with", "from", "they", "what", "how",
  ]),
};

// ── Unicode script detection regexes ─────────────────────────────────

/** Matches characters outside the Latin/common Unicode block (CJK, Arabic, Cyrillic, etc.) */
const NON_LATIN_SCRIPT_RE = /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

// ── LanguageDetector ──────────────────────────────────────────────────

export class LanguageDetector {
  private static readonly CONFIDENCE_THRESHOLD = 0.1;

  /**
   * Detect the language of the provided text sample.
   *
   * @param text - A short text sample (ideally 5-30 words).
   * @returns LanguageDetectionResult with language, confidence, and fallback flag.
   */
  detect(text: string): LanguageDetectionResult {
    // Step 1: Check for unsupported Unicode scripts
    if (NON_LATIN_SCRIPT_RE.test(text)) {
      return { language: "en", confidence: 0.5, fallback: true };
    }

    // Step 2: Normalize — lowercase, remove punctuation, split to words
    const normalized = text.toLowerCase().replace(/[^\p{L}\s]/gu, "");
    const words = normalized.split(/\s+/).filter((w) => w.length > 0);

    if (words.length === 0) {
      return { language: "en", confidence: 0.5, fallback: true };
    }

    // Step 3: Score each language by word match ratio
    const scores: Record<SupportedLanguage, number> = {
      en: 0, es: 0, fr: 0, de: 0, pt: 0,
    };

    const totalWords = words.length;
    for (const [lang, wordSet] of Object.entries(WORD_LISTS) as [SupportedLanguage, ReadonlySet<string>][]) {
      let matches = 0;
      for (const word of words) {
        if (wordSet.has(word)) {
          matches++;
        }
      }
      scores[lang] = matches / totalWords;
    }

    // Step 4: Find winner
    let winner: SupportedLanguage = "en";
    let winnerScore = 0;
    for (const [lang, score] of Object.entries(scores) as [SupportedLanguage, number][]) {
      if (score > winnerScore) {
        winnerScore = score;
        winner = lang;
      }
    }

    // Step 5: Fallback if score below threshold
    if (winnerScore < LanguageDetector.CONFIDENCE_THRESHOLD) {
      return { language: "en", confidence: 0.5, fallback: true };
    }

    // Step 6: Compute confidence as winner_score / sum_of_all_scores
    const totalScore = Object.values(scores).reduce((sum, s) => sum + s, 0);
    const confidence = totalScore > 0 ? Math.min(winnerScore / totalScore, 1.0) : 0.5;

    return { language: winner, confidence, fallback: false };
  }
}
