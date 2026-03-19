import {
  DEMO_SCENARIOS,
  getDemoScenario,
  listDemoScenarios,
  type DemoScenario,
} from "../../demo/fixtures.js";

const BUILTIN_TEMPLATE_IDS = new Set([
  "builtin-customer-support",
  "builtin-sales",
  "builtin-tech-support",
  "builtin-receptionist",
]);

describe("DemoFixtures", () => {
  describe("listDemoScenarios()", () => {
    it("returns exactly 3 scenarios", () => {
      expect(listDemoScenarios()).toHaveLength(3);
    });

    it("all scenario ids are unique", () => {
      const ids = listDemoScenarios().map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("no two scenarios share the same templateId", () => {
      const templateIds = listDemoScenarios().map((s) => s.templateId);
      expect(new Set(templateIds).size).toBe(templateIds.length);
    });

    it("scenario greetings are distinct from each other", () => {
      const greetings = listDemoScenarios().map((s) => s.greeting);
      expect(new Set(greetings).size).toBe(greetings.length);
    });
  });

  describe("per-scenario field validation", () => {
    const scenarios = listDemoScenarios();

    it.each(scenarios)("$id has a non-empty id", (s: DemoScenario) => {
      expect(s.id).toBeTruthy();
    });

    it.each(scenarios)("$id has a non-empty name", (s: DemoScenario) => {
      expect(s.name).toBeTruthy();
    });

    it.each(scenarios)("$id has a non-empty description", (s: DemoScenario) => {
      expect(s.description).toBeTruthy();
    });

    it.each(scenarios)("$id has a non-empty templateId", (s: DemoScenario) => {
      expect(s.templateId).toBeTruthy();
    });

    it.each(scenarios)("$id has a non-empty greeting", (s: DemoScenario) => {
      expect(s.greeting).toBeTruthy();
    });

    it.each(scenarios)("$id templateId is one of the 4 built-in template IDs", (s: DemoScenario) => {
      expect(BUILTIN_TEMPLATE_IDS.has(s.templateId)).toBe(true);
    });

    it.each(scenarios)("$id has at least 3 sampleUtterances", (s: DemoScenario) => {
      expect(s.sampleUtterances.length).toBeGreaterThanOrEqual(3);
    });

    it.each(scenarios)("$id has at least 3 sampleClaims", (s: DemoScenario) => {
      expect(s.sampleClaims.length).toBeGreaterThanOrEqual(3);
    });

    it.each(scenarios)("$id sampleUtterances length matches sampleClaims length", (s: DemoScenario) => {
      expect(s.sampleUtterances.length).toBe(s.sampleClaims.length);
    });

    it.each(scenarios)("$id has at least 1 pitchPoints entry", (s: DemoScenario) => {
      expect(s.pitchPoints.length).toBeGreaterThanOrEqual(1);
    });

    it.each(scenarios)("$id has at least 1 expectedPolicyTriggers entry", (s: DemoScenario) => {
      expect(s.expectedPolicyTriggers.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getDemoScenario()", () => {
    it("returns the support scenario for id 'support'", () => {
      const s = getDemoScenario("support");
      expect(s.id).toBe("support");
      expect(s).toBe(DEMO_SCENARIOS.support);
    });

    it("returns the compliance scenario for id 'compliance'", () => {
      const s = getDemoScenario("compliance");
      expect(s.id).toBe("compliance");
      expect(s).toBe(DEMO_SCENARIOS.compliance);
    });

    it("returns the sales scenario for id 'sales'", () => {
      const s = getDemoScenario("sales");
      expect(s.id).toBe("sales");
      expect(s).toBe(DEMO_SCENARIOS.sales);
    });
  });

  describe("DEMO_SCENARIOS record", () => {
    it("support scenario uses builtin-customer-support template", () => {
      expect(DEMO_SCENARIOS.support.templateId).toBe("builtin-customer-support");
    });

    it("compliance scenario uses builtin-tech-support template", () => {
      expect(DEMO_SCENARIOS.compliance.templateId).toBe("builtin-tech-support");
    });

    it("sales scenario uses builtin-sales template", () => {
      expect(DEMO_SCENARIOS.sales.templateId).toBe("builtin-sales");
    });
  });
});
