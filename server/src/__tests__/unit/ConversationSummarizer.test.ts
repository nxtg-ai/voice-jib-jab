/**
 * ConversationSummarizer Tests
 *
 * Validates topic extraction, decision/action-item detection, sentiment arc
 * computation, escalation detection, key quote selection, and edge cases.
 */

import { ConversationSummarizer } from "../../services/ConversationSummarizer.js";
import type { TranscriptTurn } from "../../services/ConversationSummarizer.js";

// ── Helpers ─────────────────────────────────────────────────────────

function turn(role: "user" | "assistant", text: string): TranscriptTurn {
  return { role, text };
}

function userTurn(text: string): TranscriptTurn {
  return turn("user", text);
}

function assistantTurn(text: string): TranscriptTurn {
  return turn("assistant", text);
}

// ── Tests ───────────────────────────────────────────────────────────

describe("ConversationSummarizer", () => {
  let summarizer: ConversationSummarizer;

  beforeEach(() => {
    summarizer = new ConversationSummarizer();
  });

  // ── Required fields ─────────────────────────────────────────────

  it("summarize() returns all required fields", () => {
    const result = summarizer.summarize("sess-1", [
      userTurn("Hello there"),
      assistantTurn("Hi, how can I help?"),
    ]);

    expect(result).toHaveProperty("sessionId");
    expect(result).toHaveProperty("generatedAt");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("turnCount");
    expect(result).toHaveProperty("topics");
    expect(result).toHaveProperty("decisions");
    expect(result).toHaveProperty("actionItems");
    expect(result).toHaveProperty("sentimentArc");
    expect(result.sentimentArc).toHaveProperty("opening");
    expect(result.sentimentArc).toHaveProperty("middle");
    expect(result.sentimentArc).toHaveProperty("closing");
    expect(result).toHaveProperty("escalated");
    expect(result).toHaveProperty("keyQuotes");
  });

  // ── Topics ──────────────────────────────────────────────────────

  it("topics: correctly extracts top words from all turns", () => {
    const turns = [
      userTurn("The billing system has a billing error in the billing module"),
      assistantTurn("Let me check the billing system for that billing error"),
    ];

    const result = summarizer.summarize("sess-1", turns);
    expect(result.topics[0]).toBe("billing");
    expect(result.topics.length).toBeLessThanOrEqual(5);
  });

  it("topics: excludes stopwords", () => {
    const turns = [
      userTurn("I really just need to get the account information"),
      assistantTurn("Your account information is ready"),
    ];

    const result = summarizer.summarize("sess-1", turns);

    // "really", "just", "need", "get", "the" are all stopwords
    expect(result.topics).not.toContain("really");
    expect(result.topics).not.toContain("just");
    expect(result.topics).not.toContain("need");
    expect(result.topics).not.toContain("get");
    expect(result.topics).not.toContain("the");
    expect(result.topics).toContain("account");
    expect(result.topics).toContain("information");
  });

  // ── Decisions ───────────────────────────────────────────────────

  it("decisions: extracts sentences with decision language", () => {
    const turns = [
      userTurn("We have decided to upgrade the plan. The weather is nice today."),
      assistantTurn("I confirmed the upgrade is complete. Your balance is zero."),
    ];

    const result = summarizer.summarize("sess-1", turns);

    expect(result.decisions.length).toBe(2);
    expect(result.decisions[0]).toContain("decided");
    expect(result.decisions[1]).toContain("confirmed");
  });

  it("decisions: empty when no decision sentences", () => {
    const turns = [
      userTurn("Hello there."),
      assistantTurn("How can I help you today?"),
    ];

    const result = summarizer.summarize("sess-1", turns);
    expect(result.decisions).toEqual([]);
  });

  // ── Action Items ────────────────────────────────────────────────

  it("actionItems: extracts follow-up sentences", () => {
    const turns = [
      userTurn("Please follow up with the team about the invoice."),
      assistantTurn("I will send you the details by email tomorrow."),
    ];

    const result = summarizer.summarize("sess-1", turns);

    expect(result.actionItems.length).toBeGreaterThanOrEqual(1);
    const allText = result.actionItems.join(" ").toLowerCase();
    expect(allText).toMatch(/follow up|will send/);
  });

  it("actionItems: empty when no action items", () => {
    const turns = [
      userTurn("Thanks for the information."),
      assistantTurn("You are welcome."),
    ];

    const result = summarizer.summarize("sess-1", turns);
    expect(result.actionItems).toEqual([]);
  });

  // ── Sentiment Arc ───────────────────────────────────────────────

  it("sentimentArc: computes from sentimentReadings when provided", () => {
    const turns = [
      userTurn("Hello"),
      userTurn("Okay"),
      userTurn("Thanks"),
    ];

    const readings = [
      { sentiment: "negative", score: -2 },
      { sentiment: "negative", score: -1 },
      { sentiment: "neutral", score: 0 },
      { sentiment: "neutral", score: 0 },
      { sentiment: "positive", score: 3 },
      { sentiment: "positive", score: 4 },
    ];

    const result = summarizer.summarize("sess-1", turns, {
      sentimentReadings: readings,
    });

    expect(result.sentimentArc.opening).toBe("negative");
    expect(result.sentimentArc.middle).toBe("neutral");
    expect(result.sentimentArc.closing).toBe("positive");
  });

  it("sentimentArc: text-based fallback without sentimentReadings", () => {
    const turns = [
      userTurn("This is terrible and bad service"),
      userTurn("Okay things seem fine now"),
      userTurn("Thank you so much, this is great and excellent"),
    ];

    const result = summarizer.summarize("sess-1", turns);

    expect(result.sentimentArc.opening).toBe("negative");
    expect(result.sentimentArc.closing).toBe("positive");
  });

  it("sentimentArc: empty turns produces all neutral", () => {
    const result = summarizer.summarize("sess-1", []);

    expect(result.sentimentArc.opening).toBe("neutral");
    expect(result.sentimentArc.middle).toBe("neutral");
    expect(result.sentimentArc.closing).toBe("neutral");
  });

  // ── Escalation ──────────────────────────────────────────────────

  it("escalated: true when sentiment contains frustrated reading", () => {
    const turns = [userTurn("Hello")];
    const readings = [
      { sentiment: "neutral", score: 0 },
      { sentiment: "frustrated", score: -5 },
    ];

    const result = summarizer.summarize("sess-1", turns, {
      sentimentReadings: readings,
    });

    expect(result.escalated).toBe(true);
  });

  it("escalated: true when user turn text contains 'frustrated'", () => {
    const turns = [
      userTurn("I am really frustrated with this service"),
    ];

    const result = summarizer.summarize("sess-1", turns);
    expect(result.escalated).toBe(true);
  });

  it("escalated: true when user turn text contains 'unacceptable'", () => {
    const turns = [
      userTurn("This level of support is unacceptable"),
    ];

    const result = summarizer.summarize("sess-1", turns);
    expect(result.escalated).toBe(true);
  });

  it("escalated: false for neutral conversation", () => {
    const turns = [
      userTurn("Hello, I have a question about my account"),
      assistantTurn("Sure, I can help with that"),
    ];

    const result = summarizer.summarize("sess-1", turns);
    expect(result.escalated).toBe(false);
  });

  // ── Key Quotes ──────────────────────────────────────────────────

  it("keyQuotes: returns max 3 longest user sentences", () => {
    const turns = [
      userTurn(
        "This is a short sentence that is over twenty chars. " +
        "Here is another longer sentence that should be captured easily. " +
        "And yet another sentence that qualifies as a notable quote. " +
        "The fourth sentence is the longest of them all and should rank first in the results."
      ),
    ];

    const result = summarizer.summarize("sess-1", turns);

    expect(result.keyQuotes.length).toBe(3);
    // Longest should come first
    expect(result.keyQuotes[0].length).toBeGreaterThanOrEqual(
      result.keyQuotes[1].length,
    );
    expect(result.keyQuotes[1].length).toBeGreaterThanOrEqual(
      result.keyQuotes[2].length,
    );
  });

  it("keyQuotes: only includes user role turns", () => {
    const turns = [
      assistantTurn(
        "This is a very long assistant response that should never appear in key quotes at all whatsoever",
      ),
      userTurn("Short user message that is long enough to qualify as a key quote here"),
    ];

    const result = summarizer.summarize("sess-1", turns);

    for (const quote of result.keyQuotes) {
      expect(quote).not.toContain("assistant response");
    }
  });

  // ── Scalar fields ───────────────────────────────────────────────

  it("turnCount: matches turns.length", () => {
    const turns = [
      userTurn("One"),
      assistantTurn("Two"),
      userTurn("Three"),
    ];

    const result = summarizer.summarize("sess-1", turns);
    expect(result.turnCount).toBe(3);
  });

  it("durationMs: passed through from opts", () => {
    const result = summarizer.summarize("sess-1", [userTurn("Hello")], {
      durationMs: 45000,
    });

    expect(result.durationMs).toBe(45000);
  });

  it("durationMs: null when not provided", () => {
    const result = summarizer.summarize("sess-1", [userTurn("Hello")]);
    expect(result.durationMs).toBeNull();
  });

  it("generatedAt: is valid ISO string", () => {
    const result = summarizer.summarize("sess-1", [userTurn("Hello")]);

    const parsed = new Date(result.generatedAt);
    expect(parsed.toISOString()).toBe(result.generatedAt);
  });

  it("sessionId: matches input", () => {
    const result = summarizer.summarize("my-session-42", [userTurn("Hello")]);
    expect(result.sessionId).toBe("my-session-42");
  });

  // ── Edge cases ──────────────────────────────────────────────────

  it("empty turns array: returns valid summary with empty arrays", () => {
    const result = summarizer.summarize("sess-empty", []);

    expect(result.sessionId).toBe("sess-empty");
    expect(result.turnCount).toBe(0);
    expect(result.topics).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.actionItems).toEqual([]);
    expect(result.keyQuotes).toEqual([]);
    expect(result.escalated).toBe(false);
    expect(result.sentimentArc).toEqual({
      opening: "neutral",
      middle: "neutral",
      closing: "neutral",
    });
  });

  it("mixed turns: decisions from assistant turn also included", () => {
    const turns = [
      userTurn("What should we do about the outage?"),
      assistantTurn(
        "I have confirmed the root cause and will apply the fix immediately.",
      ),
    ];

    const result = summarizer.summarize("sess-1", turns);

    const hasAssistantDecision = result.decisions.some(
      (d) => d.toLowerCase().includes("confirmed"),
    );
    expect(hasAssistantDecision).toBe(true);
  });
});
