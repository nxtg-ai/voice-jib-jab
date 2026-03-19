/**
 * SentimentAnalyzer Tests
 *
 * Validates keyword-based sentiment classification: scoring, label assignment,
 * confidence values, keyword extraction, and edge cases.
 */

import { SentimentAnalyzer } from "../../services/SentimentAnalyzer.js";

describe("SentimentAnalyzer", () => {
  let analyzer: SentimentAnalyzer;

  beforeEach(() => {
    analyzer = new SentimentAnalyzer();
  });

  // ── Positive classification ───────────────────────────────────────

  it("classifies 'thank you so much' as positive", () => {
    const result = analyzer.analyze("thank you so much, really appreciate it");
    expect(result.sentiment).toBe("positive");
    expect(result.score).toBeGreaterThan(0);
  });

  it("classifies 'this is great, I appreciate your help' as positive", () => {
    const result = analyzer.analyze("this is great, I appreciate your help");
    expect(result.sentiment).toBe("positive");
    expect(result.keywords).toContain("great");
    expect(result.keywords).toContain("appreciate");
  });

  // ── Neutral classification ────────────────────────────────────────

  it("classifies 'okay' as neutral", () => {
    const result = analyzer.analyze("okay");
    expect(result.sentiment).toBe("neutral");
  });

  it("classifies 'hello' as neutral", () => {
    const result = analyzer.analyze("hello");
    expect(result.sentiment).toBe("neutral");
  });

  it("classifies 'yes please' as neutral", () => {
    const result = analyzer.analyze("yes please");
    expect(result.sentiment).toBe("neutral");
  });

  // ── Negative classification ───────────────────────────────────────

  it("classifies 'this is bad, it doesn't work' as negative", () => {
    const result = analyzer.analyze("this is bad, it doesn't work");
    expect(result.sentiment).toBe("negative");
    expect(result.score).toBeLessThan(0);
  });

  it("classifies 'I'm very disappointed, this is wrong' as negative", () => {
    const result = analyzer.analyze("I'm very disappointed, this is wrong");
    expect(result.sentiment).toBe("negative");
  });

  // ── Frustrated classification ─────────────────────────────────────

  it("classifies 'this is absolutely terrible and unacceptable' as frustrated", () => {
    const result = analyzer.analyze("this is absolutely terrible and unacceptable");
    expect(result.sentiment).toBe("frustrated");
    expect(result.score).toBeLessThanOrEqual(-5);
  });

  it("classifies 'I'm so frustrated, this is ridiculous' as frustrated", () => {
    const result = analyzer.analyze("I'm so frustrated, this is ridiculous");
    expect(result.sentiment).toBe("frustrated");
    expect(result.keywords).toContain("frustrat");
    expect(result.keywords).toContain("ridiculous");
  });

  // ── Mixed signals ────────────────────────────────────────────────

  it("resolves mixed signals by dominant score direction", () => {
    const result = analyzer.analyze("bad but thank you");
    // "bad" = -1, "thank" = +2 => score = +1, which is neutral (< 3)
    // The point is the score resolves in a direction, not an error
    expect(["positive", "neutral"]).toContain(result.sentiment);
    expect(result.keywords).toContain("bad");
    expect(result.keywords).toContain("thank");
  });

  // ── Keywords extraction ──────────────────────────────────────────

  it("includes matched keywords in the result", () => {
    const result = analyzer.analyze("this is great and wonderful");
    expect(result.keywords).toContain("great");
    expect(result.keywords).toContain("wonderful");
  });

  // ── Confidence ───────────────────────────────────────────────────

  it("returns positive confidence > 0 for positive results", () => {
    const result = analyzer.analyze("thank you, that is great");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns positive confidence > 0 for frustrated results", () => {
    const result = analyzer.analyze("this is absolutely terrible and unacceptable");
    expect(result.confidence).toBeGreaterThan(0);
  });

  // ── Edge cases ───────────────────────────────────────────────────

  it("returns neutral with score 0 for empty string", () => {
    const result = analyzer.analyze("");
    expect(result.sentiment).toBe("neutral");
    expect(result.score).toBe(0);
  });

  it("treats a single intensifier alone as neutral", () => {
    const result = analyzer.analyze("very");
    expect(result.sentiment).toBe("neutral");
    expect(result.score).toBe(0);
  });

  it("classifies 'not working at all, this is bad' as negative", () => {
    const result = analyzer.analyze("not working at all, this is bad");
    expect(result.sentiment).toBe("negative");
    expect(result.keywords).toContain("not working");
  });

  it("matches 'doesn't work' as negative", () => {
    const result = analyzer.analyze("this doesn't work");
    expect(result.keywords).toContain("doesn't work");
    expect(result.score).toBeLessThan(0);
  });

  it("handles uppercase text by lowercasing", () => {
    const result = analyzer.analyze("THIS IS TERRIBLE");
    expect(result.keywords).toContain("terrible");
    expect(result.score).toBeLessThan(0);
  });

  it("produces high confidence for very strong frustrated messages", () => {
    const result = analyzer.analyze(
      "this is absolutely terrible, awful, horrible, ridiculous and unacceptable",
    );
    expect(result.sentiment).toBe("frustrated");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("returns all required fields on SentimentResult", () => {
    const result = analyzer.analyze("hello world");
    expect(result).toHaveProperty("sentiment");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("keywords");
    expect(typeof result.sentiment).toBe("string");
    expect(typeof result.score).toBe("number");
    expect(typeof result.confidence).toBe("number");
    expect(Array.isArray(result.keywords)).toBe(true);
  });
});
