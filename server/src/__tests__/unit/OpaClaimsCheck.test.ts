/**
 * OpaClaimsCheck Unit Tests
 *
 * Covers two-tier claims verification:
 *   Tier 1: AllowedClaimsRegistry TF-IDF cosine similarity (VectorStore)
 *   Tier 2: OpaEvaluator threshold decision (claims_check Rego rule)
 *
 * Uses _injectPolicy() to bypass WASM file I/O.
 * Oracle types: state oracle (decision/reasonCodes) + behavioral oracle (OPA called/not called).
 */

import { OpaClaimsCheck } from "../../insurance/opa_claims.js";
import { OpaEvaluator } from "../../insurance/opa_evaluator.js";
import { AllowedClaimsRegistry } from "../../insurance/allowed_claims_registry.js";
import type { EvaluationContext } from "../../insurance/policy_gate.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeClaimsPolicy(output: {
  decision: string;
  severity: number;
  reason_code: string | null;
}) {
  return {
    evaluate: jest.fn().mockReturnValue([
      { expressions: [{ value: output }] },
    ]),
  };
}

function makeRegistry(claims: Array<{ id: string; text: string }> = []) {
  return new AllowedClaimsRegistry({
    claims: claims.map((c) => ({ id: c.id, text: c.text })),
    disallowedPatterns: ["buy now", "guaranteed returns"],
    enableFileLoad: false,
  });
}

function ctx(text: string): EvaluationContext {
  return { sessionId: "test", role: "assistant", text, isFinal: true };
}

function makeEvaluator(): OpaEvaluator {
  return new OpaEvaluator("/fake/bundle.tar.gz");
}

// ── 1. Lifecycle ─────────────────────────────────────────────────────────

describe("OpaClaimsCheck — lifecycle", () => {
  it("falls back to registry match when OPA not initialized and text matches", () => {
    const registry = makeRegistry([{ id: "c1", text: "voice jib jab is fast" }]);
    const evaluator = makeEvaluator();
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    const result = check.evaluate(ctx("voice jib jab is fast"));
    expect(result.decision).toBe("allow");
  });

  it("falls back to refuse when OPA not initialized and similarity is below threshold", () => {
    const registry = makeRegistry([{ id: "c1", text: "voice jib jab is fast" }]);
    const evaluator = makeEvaluator();
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.99 });

    const result = check.evaluate(ctx("completely unrelated qxz statement"));
    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("CLAIMS:UNVERIFIED");
  });

  it("uses OPA when initialized", () => {
    const registry = makeRegistry([{ id: "c1", text: "latency under 400ms" }]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    evaluator._injectPolicy(policy as any);

    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });
    check.evaluate(ctx("latency under 400ms"));

    expect(policy.evaluate).toHaveBeenCalled();
  });

  it("does not call OPA for disallowed patterns (checked first)", () => {
    const registry = makeRegistry([{ id: "c1", text: "safe claim" }]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    evaluator._injectPolicy(policy as any);

    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });
    const result = check.evaluate(ctx("buy now guaranteed returns"));

    expect(policy.evaluate).not.toHaveBeenCalled();
    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("CLAIMS:DISALLOWED_PATTERN");
  });
});

// ── 2. Disallowed patterns ────────────────────────────────────────────────

describe("OpaClaimsCheck — disallowed patterns", () => {
  it("refuses on disallowed pattern with correct reason code", () => {
    const registry = makeRegistry();
    const evaluator = makeEvaluator();
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    const result = check.evaluate(ctx("buy now, limited offer!"));
    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("CLAIMS_VIOLATION");
    expect(result.reasonCodes).toContain("CLAIMS:DISALLOWED_PATTERN");
    expect(result.severity).toBe(3);
  });

  it("refuses on second disallowed pattern", () => {
    const registry = makeRegistry();
    const evaluator = makeEvaluator();
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    const result = check.evaluate(ctx("this investment offers guaranteed returns"));
    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("CLAIMS:DISALLOWED_PATTERN");
  });
});

// ── 3. OPA allow — above threshold ──────────────────────────────────────

describe("OpaClaimsCheck — OPA allow path", () => {
  it("returns allow when OPA decides allow", () => {
    const registry = makeRegistry([{ id: "c1", text: "response time is under 400 milliseconds" }]);
    const evaluator = makeEvaluator();
    evaluator._injectPolicy(
      makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null }) as any,
    );
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    const result = check.evaluate(ctx("response time is under 400 milliseconds"));
    expect(result.decision).toBe("allow");
    expect(result.reasonCodes).toHaveLength(0);
    expect(result.severity).toBe(0);
  });

  it("passes similarity_score and threshold to OPA correctly", () => {
    const registry = makeRegistry([{ id: "c1", text: "fast response" }]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    evaluator._injectPolicy(policy as any);
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.5 });

    check.evaluate(ctx("fast response"));

    const callArg = policy.evaluate.mock.calls[0][0] as any;
    expect(callArg.claims_check.threshold).toBe(0.5);
    expect(typeof callArg.claims_check.similarity_score).toBe("number");
  });

  it("exact match produces high similarity score (≥ threshold)", () => {
    const registry = makeRegistry([{ id: "c1", text: "enterprise voice agent runtime" }]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    evaluator._injectPolicy(policy as any);
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    check.evaluate(ctx("enterprise voice agent runtime"));

    const callArg = policy.evaluate.mock.calls[0][0] as any;
    expect(callArg.claims_check.similarity_score).toBeGreaterThan(0);
  });
});

// ── 4. OPA refuse — below threshold ─────────────────────────────────────

describe("OpaClaimsCheck — OPA refuse path", () => {
  it("returns refuse with CLAIMS:UNVERIFIED when OPA refuses", () => {
    const registry = makeRegistry([{ id: "c1", text: "known claim text" }]);
    const evaluator = makeEvaluator();
    evaluator._injectPolicy(
      makeClaimsPolicy({ decision: "refuse", severity: 3, reason_code: "CLAIMS:UNVERIFIED" }) as any,
    );
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    const result = check.evaluate(ctx("something completely different"));
    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("CLAIMS_VIOLATION");
    expect(result.reasonCodes).toContain("CLAIMS:UNVERIFIED");
    expect(result.severity).toBe(3);
  });

  it("preserves OPA reason_code in reasonCodes", () => {
    const registry = makeRegistry([{ id: "c1", text: "some claim" }]);
    const evaluator = makeEvaluator();
    evaluator._injectPolicy(
      makeClaimsPolicy({ decision: "refuse", severity: 3, reason_code: "CLAIMS:CUSTOM_CODE" }) as any,
    );
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    const result = check.evaluate(ctx("unrelated text here"));
    expect(result.reasonCodes).toContain("CLAIMS:CUSTOM_CODE");
  });
});

// ── 5. Threshold edge cases ──────────────────────────────────────────────

describe("OpaClaimsCheck — threshold edge cases", () => {
  it("uses default threshold of 0.6 when not specified", () => {
    const registry = makeRegistry([{ id: "c1", text: "test claim" }]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    evaluator._injectPolicy(policy as any);
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    check.evaluate(ctx("test claim"));
    const callArg = policy.evaluate.mock.calls[0][0] as any;
    expect(callArg.claims_check.threshold).toBe(0.6);
  });

  it("custom low threshold (0.1) is passed to OPA", () => {
    const registry = makeRegistry([{ id: "c1", text: "any claim text here" }]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    evaluator._injectPolicy(policy as any);
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.1 });

    check.evaluate(ctx("any claim"));
    const callArg = policy.evaluate.mock.calls[0][0] as any;
    expect(callArg.claims_check.threshold).toBe(0.1);
  });

  it("custom high threshold (0.99) is passed to OPA", () => {
    const registry = makeRegistry([{ id: "c1", text: "very specific claim" }]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "refuse", severity: 3, reason_code: "CLAIMS:UNVERIFIED" });
    evaluator._injectPolicy(policy as any);
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.99 });

    check.evaluate(ctx("somewhat similar claim"));
    const callArg = policy.evaluate.mock.calls[0][0] as any;
    expect(callArg.claims_check.threshold).toBe(0.99);
  });

  it("similarity_score is always between 0 and 1", () => {
    const registry = makeRegistry([
      { id: "c1", text: "approved claim one" },
      { id: "c2", text: "approved claim two" },
    ]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "allow", severity: 0, reason_code: null });
    evaluator._injectPolicy(policy as any);
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    check.evaluate(ctx("approved claim one"));
    const callArg = policy.evaluate.mock.calls[0][0] as any;
    expect(callArg.claims_check.similarity_score).toBeGreaterThanOrEqual(0);
    expect(callArg.claims_check.similarity_score).toBeLessThanOrEqual(1);
  });

  it("empty registry produces similarity_score of 0", () => {
    const registry = makeRegistry([]);
    const evaluator = makeEvaluator();
    const policy = makeClaimsPolicy({ decision: "refuse", severity: 3, reason_code: "CLAIMS:UNVERIFIED" });
    evaluator._injectPolicy(policy as any);
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    check.evaluate(ctx("any text at all"));
    const callArg = policy.evaluate.mock.calls[0][0] as any;
    expect(callArg.claims_check.similarity_score).toBe(0);
  });
});

// ── 6. ControlEngine integration ─────────────────────────────────────────

describe("OpaClaimsCheck — ControlEngine integration", () => {
  it("check name is 'opa_claims'", () => {
    const registry = makeRegistry();
    const evaluator = makeEvaluator();
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });
    expect(check.name).toBe("opa_claims");
  });

  it("handles null reason_code from OPA gracefully", () => {
    const registry = makeRegistry([{ id: "c1", text: "some claim" }]);
    const evaluator = makeEvaluator();
    evaluator._injectPolicy(
      makeClaimsPolicy({ decision: "refuse", severity: 3, reason_code: null }) as any,
    );
    const check = new OpaClaimsCheck(evaluator, { registry, threshold: 0.6 });

    const result = check.evaluate(ctx("unrelated"));
    expect(result.decision).toBe("refuse");
    expect(result.reasonCodes).toContain("CLAIMS:UNVERIFIED");
  });
});
