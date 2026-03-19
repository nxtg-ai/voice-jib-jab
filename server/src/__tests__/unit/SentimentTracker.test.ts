/**
 * SentimentTracker Tests
 *
 * Validates per-session sentiment tracking: reading storage, escalation detection,
 * dominant sentiment calculation, averages, summaries, and session isolation.
 */

import { SentimentTracker } from "../../services/SentimentTracker.js";
import type { SentimentResult } from "../../services/SentimentAnalyzer.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeResult(
  sentiment: SentimentResult["sentiment"],
  score: number,
): SentimentResult {
  return { sentiment, score, confidence: 0.8, keywords: [] };
}

describe("SentimentTracker", () => {
  let tracker: SentimentTracker;

  beforeEach(() => {
    tracker = new SentimentTracker();
  });

  // ── addReading / turnIndex ────────────────────────────────────────

  it("stores a reading and increments turnIndex", () => {
    tracker.addReading("s1", makeResult("positive", 4));
    tracker.addReading("s1", makeResult("neutral", 0));

    const readings = tracker.getReadings("s1");
    expect(readings).toHaveLength(2);
    expect(readings[0].turnIndex).toBe(0);
    expect(readings[1].turnIndex).toBe(1);
  });

  // ── getReadings ──────────────────────────────────────────────────

  it("returns a copy — mutation does not affect internal state", () => {
    tracker.addReading("s1", makeResult("positive", 3));
    const copy = tracker.getReadings("s1");
    copy.push({
      timestamp: new Date().toISOString(),
      sentiment: "negative",
      score: -2,
      turnIndex: 99,
    });

    expect(tracker.getReadings("s1")).toHaveLength(1);
  });

  it("returns [] for unknown sessionId", () => {
    expect(tracker.getReadings("unknown")).toEqual([]);
  });

  // ── shouldEscalate ───────────────────────────────────────────────

  it("returns false with only 1 frustrated reading", () => {
    tracker.addReading("s1", makeResult("frustrated", -6));
    expect(tracker.shouldEscalate("s1")).toBe(false);
  });

  it("returns true with 2+ consecutive frustrated readings at end", () => {
    tracker.addReading("s1", makeResult("neutral", 0));
    tracker.addReading("s1", makeResult("frustrated", -6));
    tracker.addReading("s1", makeResult("frustrated", -7));
    expect(tracker.shouldEscalate("s1")).toBe(true);
  });

  it("returns false when last reading is not frustrated even if prior ones are", () => {
    tracker.addReading("s1", makeResult("frustrated", -6));
    tracker.addReading("s1", makeResult("frustrated", -7));
    tracker.addReading("s1", makeResult("neutral", 0));
    expect(tracker.shouldEscalate("s1")).toBe(false);
  });

  it("returns false for empty session", () => {
    expect(tracker.shouldEscalate("empty")).toBe(false);
  });

  // ── getDominantSentiment ─────────────────────────────────────────

  it("returns the most frequent label", () => {
    tracker.addReading("s1", makeResult("positive", 4));
    tracker.addReading("s1", makeResult("positive", 3));
    tracker.addReading("s1", makeResult("negative", -2));
    expect(tracker.getDominantSentiment("s1")).toBe("positive");
  });

  it("breaks ties in favor of frustrated over negative", () => {
    tracker.addReading("s1", makeResult("frustrated", -6));
    tracker.addReading("s1", makeResult("negative", -2));
    expect(tracker.getDominantSentiment("s1")).toBe("frustrated");
  });

  it("returns 'neutral' for empty session", () => {
    expect(tracker.getDominantSentiment("empty")).toBe("neutral");
  });

  // ── getAverageScore ──────────────────────────────────────────────

  it("computes correct average score", () => {
    tracker.addReading("s1", makeResult("positive", 4));
    tracker.addReading("s1", makeResult("negative", -2));
    expect(tracker.getAverageScore("s1")).toBe(1);
  });

  it("returns 0 for empty session", () => {
    expect(tracker.getAverageScore("empty")).toBe(0);
  });

  // ── getSummary ───────────────────────────────────────────────────

  it("populates all fields correctly and reflects shouldEscalate", () => {
    tracker.addReading("s1", makeResult("frustrated", -6));
    tracker.addReading("s1", makeResult("frustrated", -7));

    const summary = tracker.getSummary("s1");
    expect(summary.sessionId).toBe("s1");
    expect(summary.readingCount).toBe(2);
    expect(summary.dominantSentiment).toBe("frustrated");
    expect(summary.averageScore).toBe(-6.5);
    expect(summary.escalationTriggered).toBe(true);
    expect(summary.trajectory).toHaveLength(2);
  });

  // ── clearSession ─────────────────────────────────────────────────

  it("removes all readings for a session", () => {
    tracker.addReading("s1", makeResult("positive", 3));
    tracker.clearSession("s1");
    expect(tracker.getReadings("s1")).toEqual([]);
  });

  // ── Session isolation ────────────────────────────────────────────

  it("keeps sessions independent", () => {
    tracker.addReading("a", makeResult("positive", 5));
    tracker.addReading("b", makeResult("negative", -3));

    expect(tracker.getReadings("a")).toHaveLength(1);
    expect(tracker.getReadings("a")[0].sentiment).toBe("positive");
    expect(tracker.getReadings("b")).toHaveLength(1);
    expect(tracker.getReadings("b")[0].sentiment).toBe("negative");
  });
});
