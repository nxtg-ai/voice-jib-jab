/**
 * Regression Fixtures — Known-good voice session scenarios for policy decision consistency.
 *
 * Each fixture specifies a single evaluation context and the expected policy decision
 * from the ControlEngine (via makeSimpleEngine — no OPA, role-guarded ClaimsChecker).
 *
 * Decision mapping for the SimpleEngine pipeline (PIIRedactor -> Moderator -> ClaimsChecker):
 *   - Exact claim match (assistant role) -> allow
 *   - Disallowed pattern match (assistant role) -> rewrite (ClaimsChecker, severity 3)
 *   - SELF_HARM pattern match (any role) -> escalate (Moderator, severity 5)
 *   - User role with no moderation match -> allow (ClaimsChecker role-guard bypass)
 *
 * Usage:
 *   import { REGRESSION_FIXTURES } from "./regressionFixtures.js";
 */

import {
  TENANT_DEMO_ALPHA,
  TENANT_DEMO_BETA,
  ALPHA_CLAIMS,
  BETA_CLAIMS,
  ESCALATION_TEXT,
} from "./demoFixtures.js";

// ── Fixture interface ──────────────────────────────────────────────────

export interface RegressionFixture {
  /** Unique regression fixture ID (e.g. "REG-001") */
  id: string;
  /** Human-readable description of the scenario */
  description: string;
  /** Tenant context for claims registry selection */
  tenantId: string;
  /** Role determines whether ClaimsChecker evaluates text (assistant) or bypasses (user) */
  role: "user" | "assistant";
  /** Text to evaluate through the policy pipeline */
  inputText: string;
  /** Expected top-level policy decision from ControlEngine.evaluate() */
  expectedDecision: "allow" | "refuse" | "escalate" | "rewrite";
  /** Optional substring match on reason codes array */
  expectedReasonCodeContains?: string;
  /** Classification tags for filtering and reporting */
  tags: string[];
}

// ── Regression fixtures ────────────────────────────────────────────────

export const REGRESSION_FIXTURES: RegressionFixture[] = [
  {
    id: "REG-001",
    description: "Alpha tenant: exact FDA claim text -> allow",
    tenantId: TENANT_DEMO_ALPHA,
    role: "assistant",
    inputText: ALPHA_CLAIMS[0].text,
    expectedDecision: "allow",
    tags: ["medical", "allow", "strict-tenant"],
  },
  {
    id: "REG-002",
    description: "Alpha tenant: 'guarantees a cure' disallowed pattern -> rewrite",
    tenantId: TENANT_DEMO_ALPHA,
    role: "assistant",
    inputText: "This device guarantees a cure for all conditions.",
    expectedDecision: "rewrite",
    expectedReasonCodeContains: "CLAIMS_DISALLOWED",
    tags: ["medical", "rewrite", "disallowed-pattern"],
  },
  {
    id: "REG-003",
    description: "Alpha tenant: SELF_HARM text -> escalate",
    tenantId: TENANT_DEMO_ALPHA,
    role: "user",
    inputText: ESCALATION_TEXT,
    expectedDecision: "escalate",
    expectedReasonCodeContains: "SELF_HARM",
    tags: ["escalation", "moderation"],
  },
  {
    id: "REG-004",
    description: "Beta tenant: exact FDIC insured claim -> allow",
    tenantId: TENANT_DEMO_BETA,
    role: "assistant",
    inputText: BETA_CLAIMS[1].text,
    expectedDecision: "allow",
    tags: ["fintech", "allow", "permissive-tenant"],
  },
  {
    id: "REG-005",
    description: "Beta tenant: 'Guaranteed 40% annual returns' disallowed pattern -> rewrite",
    tenantId: TENANT_DEMO_BETA,
    role: "assistant",
    inputText: "Guaranteed 40% annual guaranteed returns on your investment.",
    expectedDecision: "rewrite",
    expectedReasonCodeContains: "CLAIMS_DISALLOWED",
    tags: ["fintech", "rewrite", "disallowed-pattern"],
  },
  {
    id: "REG-006",
    description: "Alpha tenant: neutral user message -> allow (role bypass)",
    tenantId: TENANT_DEMO_ALPHA,
    role: "user",
    inputText: "Thank you for the information, that was very helpful.",
    expectedDecision: "allow",
    tags: ["neutral", "user-role-bypass"],
  },
  {
    id: "REG-007",
    description: "Alpha tenant: exact CE-marked claim -> allow",
    tenantId: TENANT_DEMO_ALPHA,
    role: "assistant",
    inputText: ALPHA_CLAIMS[2].text,
    expectedDecision: "allow",
    tags: ["medical", "allow"],
  },
  {
    id: "REG-008",
    description: "Beta tenant: exact SEC-regulated claim -> allow",
    tenantId: TENANT_DEMO_BETA,
    role: "assistant",
    inputText: BETA_CLAIMS[2].text,
    expectedDecision: "allow",
    tags: ["fintech", "allow"],
  },
  {
    id: "REG-009",
    description: "Alpha tenant: '100% effective' disallowed pattern -> rewrite",
    tenantId: TENANT_DEMO_ALPHA,
    role: "assistant",
    inputText: "Our product is 100% effective with no side effects.",
    expectedDecision: "rewrite",
    expectedReasonCodeContains: "CLAIMS_DISALLOWED",
    tags: ["medical", "rewrite"],
  },
  {
    id: "REG-010",
    description: "Beta tenant: 'risk-free investment' disallowed pattern -> rewrite",
    tenantId: TENANT_DEMO_BETA,
    role: "assistant",
    inputText: "This is a risk-free investment opportunity you cannot miss.",
    expectedDecision: "rewrite",
    expectedReasonCodeContains: "CLAIMS_DISALLOWED",
    tags: ["fintech", "rewrite"],
  },
];
