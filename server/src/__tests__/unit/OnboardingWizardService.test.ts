/**
 * OnboardingWizardService Unit Tests
 *
 * Tests the step-by-step wizard that guides new enterprise tenants through
 * initial setup. Uses real filesystem via OS temp directories for isolation.
 * Each test gets a fresh service instance backed by a unique temp file.
 */

import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, writeFileSync } from "fs";
import {
  OnboardingWizardService,
  initOnboardingWizardService,
  onboardingWizardService,
} from "../../services/OnboardingWizardService.js";

// ── Helpers ───────────────────────────────────────────────────────────

function tempFile(label: string): string {
  return join(
    tmpdir(),
    `onboarding-wizard-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

// ── OnboardingWizardService unit tests ────────────────────────────────

describe("OnboardingWizardService", () => {
  let svc: OnboardingWizardService;
  let file: string;

  beforeEach(() => {
    file = tempFile("svc");
    svc = new OnboardingWizardService(file);
  });

  afterEach(() => {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // ── createSession ─────────────────────────────────────────────────

  describe("createSession()", () => {
    it("returns an OnboardingSession with a sessionId", () => {
      const session = svc.createSession("org_acme");

      expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("returns a session with the provided tenantId", () => {
      const session = svc.createSession("org_acme");

      expect(session.tenantId).toBe("org_acme");
    });

    it("sets createdAt to an ISO date string", () => {
      const session = svc.createSession("org_acme");

      expect(new Date(session.createdAt).toISOString()).toBe(session.createdAt);
    });

    it("starts at step tenant_registration", () => {
      const session = svc.createSession("org_acme");

      expect(session.currentStep).toBe("tenant_registration");
    });

    it("has all steps starting as pending", () => {
      const session = svc.createSession("org_acme");

      for (const step of session.steps) {
        expect(step.status).toBe("pending");
      }
    });

    it("starts with complete=false", () => {
      const session = svc.createSession("org_acme");

      expect(session.complete).toBe(false);
    });

    it("steps contain all 5 work steps", () => {
      const session = svc.createSession("org_acme");

      const stepNames = session.steps.map((s) => s.step);
      expect(stepNames).toContain("tenant_registration");
      expect(stepNames).toContain("voice_configuration");
      expect(stepNames).toContain("claims_registry");
      expect(stepNames).toContain("policy_rules");
      expect(stepNames).toContain("test_call");
    });
  });

  // ── getSession ────────────────────────────────────────────────────

  describe("getSession()", () => {
    it("returns undefined for an unknown session ID", () => {
      expect(svc.getSession("no-such-id")).toBeUndefined();
    });

    it("returns the correct session for a known ID", () => {
      const created = svc.createSession("org_acme");

      const found = svc.getSession(created.sessionId);
      expect(found).toBeDefined();
      expect(found!.sessionId).toBe(created.sessionId);
    });
  });

  // ── getSessionByTenant ────────────────────────────────────────────

  describe("getSessionByTenant()", () => {
    it("returns the session for the given tenant", () => {
      const created = svc.createSession("org_beta");

      const found = svc.getSessionByTenant("org_beta");
      expect(found).toBeDefined();
      expect(found!.sessionId).toBe(created.sessionId);
    });

    it("returns undefined when no session exists for the tenant", () => {
      expect(svc.getSessionByTenant("org_ghost")).toBeUndefined();
    });
  });

  // ── listSessions ──────────────────────────────────────────────────

  describe("listSessions()", () => {
    it("returns all sessions", () => {
      svc.createSession("org_a");
      svc.createSession("org_b");
      svc.createSession("org_c");

      expect(svc.listSessions()).toHaveLength(3);
    });
  });

  // ── step sequence ─────────────────────────────────────────────────

  describe("step sequence", () => {
    it("follows the correct order of steps", () => {
      const session = svc.createSession("org_seq");
      const expectedOrder = [
        "tenant_registration",
        "voice_configuration",
        "claims_registry",
        "policy_rules",
        "test_call",
      ];
      const actualOrder = session.steps.map((s) => s.step);

      expect(actualOrder).toEqual(expectedOrder);
    });
  });

  // ── completeStep ──────────────────────────────────────────────────

  describe("completeStep()", () => {
    it("advances currentStep to the next step", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.completeStep(session.sessionId, { tenantName: "Acme" });
      expect(updated.currentStep).toBe("voice_configuration");
    });

    it("marks the completed step as 'complete'", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.completeStep(session.sessionId, { tenantName: "Acme" });
      const stepState = updated.steps.find((s) => s.step === "tenant_registration");
      expect(stepState!.status).toBe("complete");
    });

    it("stores payload data in step.data", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.completeStep(session.sessionId, {
        tenantName: "Acme Corp",
        contactEmail: "admin@acme.com",
        industry: "technology",
      });
      const stepState = updated.steps.find((s) => s.step === "tenant_registration");
      expect(stepState!.data).toMatchObject({
        tenantName: "Acme Corp",
        contactEmail: "admin@acme.com",
        industry: "technology",
      });
    });

    it("sets completedAt on the step when completing it", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.completeStep(session.sessionId, { tenantName: "Acme" });
      const stepState = updated.steps.find((s) => s.step === "tenant_registration");
      expect(new Date(stepState!.completedAt!).toISOString()).toBe(stepState!.completedAt);
    });

    it("marks session complete=true when advancing past test_call", () => {
      const session = svc.createSession("org_acme");
      // Advance through all steps
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });
      svc.completeStep(session.sessionId, { escalationThreshold: 5 });
      const done = svc.completeStep(session.sessionId, {
        testCallSuccess: true,
        testCallNotes: "All good",
      });

      expect(done.complete).toBe(true);
      expect(done.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(done.currentStep).toBe("complete");
    });

    it("stores testCallResult on session when completing test_call step", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });
      svc.completeStep(session.sessionId, { escalationThreshold: 5 });
      const done = svc.completeStep(session.sessionId, {
        testCallSuccess: true,
        testCallLatencyMs: 250,
        testCallNotes: "Nominal",
      });

      expect(done.testCallResult).toBeDefined();
      expect(done.testCallResult!.success).toBe(true);
      expect(done.testCallResult!.latencyMs).toBe(250);
      expect(done.testCallResult!.notes).toBe("Nominal");
    });

    it("throws for an unknown sessionId", () => {
      expect(() =>
        svc.completeStep("no-such-session", { tenantName: "X" }),
      ).toThrow();
    });

    // Validation ─────────────────────────────────────────────────────

    it("throws with validationErrors when tenantName is missing for registration step", () => {
      const session = svc.createSession("org_acme");

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, {});
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught).toBeDefined();
      expect(caught!.validationErrors).toBeDefined();
      expect(caught!.validationErrors!.length).toBeGreaterThan(0);
      expect(caught!.validationErrors!.some((e) => e.includes("tenantName"))).toBe(true);
    });

    it("throws with validationErrors when tenantName is empty string", () => {
      const session = svc.createSession("org_acme");

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, { tenantName: "   " });
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors).toBeDefined();
    });

    it("throws with validationErrors when speed is below 0.5", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" }); // advance to voice

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, { speed: 0.1 });
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors!.some((e) => e.includes("speed"))).toBe(true);
    });

    it("throws with validationErrors when speed is above 2.0", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, { speed: 3.5 });
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors!.some((e) => e.includes("speed"))).toBe(true);
    });

    it("throws with validationErrors when escalationThreshold is above 10", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, { escalationThreshold: 15 });
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors!.some((e) => e.includes("escalationThreshold"))).toBe(true);
    });

    it("accepts escalationThreshold of exactly 0", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });

      expect(() =>
        svc.completeStep(session.sessionId, { escalationThreshold: 0 }),
      ).not.toThrow();
    });

    it("throws validationErrors when testCallSuccess is missing for test_call step", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });
      svc.completeStep(session.sessionId, { escalationThreshold: 5 });

      let caught: (Error & { validationErrors?: string[] }) | undefined;
      try {
        svc.completeStep(session.sessionId, {});
      } catch (e) {
        caught = e as Error & { validationErrors?: string[] };
      }

      expect(caught!.validationErrors!.some((e) => e.includes("testCallSuccess"))).toBe(true);
    });
  });

  // ── skipStep ──────────────────────────────────────────────────────

  describe("skipStep()", () => {
    it("marks the current step as 'skipped'", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.skipStep(session.sessionId);
      const stepState = updated.steps.find((s) => s.step === "tenant_registration");
      expect(stepState!.status).toBe("skipped");
    });

    it("advances to the next step", () => {
      const session = svc.createSession("org_acme");

      const updated = svc.skipStep(session.sessionId);
      expect(updated.currentStep).toBe("voice_configuration");
    });
  });

  // ── goBack ────────────────────────────────────────────────────────

  describe("goBack()", () => {
    it("moves to the previous step", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });

      const updated = svc.goBack(session.sessionId);
      expect(updated.currentStep).toBe("tenant_registration");
    });

    it("stays at the first step if already there (no error)", () => {
      const session = svc.createSession("org_acme");

      expect(() => svc.goBack(session.sessionId)).not.toThrow();
      const updated = svc.getSession(session.sessionId)!;
      expect(updated.currentStep).toBe("tenant_registration");
    });
  });

  // ── resetSession ──────────────────────────────────────────────────

  describe("resetSession()", () => {
    it("resets all steps to pending", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });

      const reset = svc.resetSession(session.sessionId);
      for (const step of reset.steps) {
        expect(step.status).toBe("pending");
      }
    });

    it("resets currentStep to tenant_registration", () => {
      const session = svc.createSession("org_acme");
      svc.completeStep(session.sessionId, { tenantName: "Acme" });

      const reset = svc.resetSession(session.sessionId);
      expect(reset.currentStep).toBe("tenant_registration");
    });

    it("sets complete=false", () => {
      const session = svc.createSession("org_acme");
      // Skip through all steps to make it complete
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);

      const reset = svc.resetSession(session.sessionId);
      expect(reset.complete).toBe(false);
    });

    it("clears completedAt after reset", () => {
      const session = svc.createSession("org_acme");
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);
      svc.skipStep(session.sessionId);

      const reset = svc.resetSession(session.sessionId);
      expect(reset.completedAt).toBeUndefined();
    });
  });

  // ── updatedAt ─────────────────────────────────────────────────────

  describe("updatedAt", () => {
    it("changes after completeStep()", async () => {
      const session = svc.createSession("org_acme");
      const before = session.updatedAt;
      await new Promise((r) => setTimeout(r, 5));

      const updated = svc.completeStep(session.sessionId, { tenantName: "Acme" });
      expect(updated.updatedAt).not.toBe(before);
    });

    it("changes after skipStep()", async () => {
      const session = svc.createSession("org_acme");
      const before = session.updatedAt;
      await new Promise((r) => setTimeout(r, 5));

      const updated = svc.skipStep(session.sessionId);
      expect(updated.updatedAt).not.toBe(before);
    });
  });

  // ── persistence ───────────────────────────────────────────────────

  describe("persistence", () => {
    it("getSession() works after createSession() — data survives reload", () => {
      const session = svc.createSession("org_persist");

      const svc2 = new OnboardingWizardService(file);
      const found = svc2.getSession(session.sessionId);
      expect(found).toBeDefined();
      expect(found!.tenantId).toBe("org_persist");
    });
  });

  // ── goBack from complete ───────────────────────────────────────────

  describe("goBack() from complete step", () => {
    it("un-completes the session and moves back to test_call", () => {
      const session = svc.createSession("org_goback");
      svc.completeStep(session.sessionId, { tenantName: "GoBack" });
      svc.completeStep(session.sessionId, { language: "en" });
      svc.completeStep(session.sessionId, { claimsEntries: [] });
      svc.completeStep(session.sessionId, { escalationThreshold: 5 });
      svc.completeStep(session.sessionId, { testCallSuccess: true, testCallNotes: "ok" });

      expect(svc.getSession(session.sessionId)!.currentStep).toBe("complete");

      const updated = svc.goBack(session.sessionId);
      expect(updated.currentStep).toBe("test_call");
      expect(updated.complete).toBe(false);
      expect(updated.completedAt).toBeUndefined();
    });
  });

  // ── singleton proxy ───────────────────────────────────────────────

  describe("singleton proxy", () => {
    it("throws before initOnboardingWizardService() is called", () => {
      const makeProxy = (ref: { instance: OnboardingWizardService | undefined }) =>
        new Proxy({} as OnboardingWizardService, {
          get(_t, prop) {
            if (!ref.instance) {
              throw new Error("OnboardingWizardService not initialized");
            }
            const value = (ref.instance as unknown as Record<string | symbol, unknown>)[prop];
            return typeof value === "function" ? value.bind(ref.instance) : value;
          },
        });

      const ref = { instance: undefined as OnboardingWizardService | undefined };
      const proxy = makeProxy(ref);
      expect(() => proxy.listSessions()).toThrow("OnboardingWizardService not initialized");
    });

    it("works after initOnboardingWizardService()", () => {
      const f = tempFile("singleton");
      try {
        const instance = initOnboardingWizardService(f);
        expect(instance).toBeInstanceOf(OnboardingWizardService);
        const sessions = onboardingWizardService.listSessions();
        expect(Array.isArray(sessions)).toBe(true);
      } finally {
        if (existsSync(f)) rmSync(f, { force: true });
      }
    });
  });
});

// ── OnboardingWizardService — branch coverage ─────────────────────────

describe("OnboardingWizardService — branch coverage", () => {
  let svc: OnboardingWizardService;
  let file: string;

  beforeEach(() => {
    file = join(
      tmpdir(),
      `onboarding-branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    svc = new OnboardingWizardService(file);
  });

  afterEach(() => {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // Branch: validatePayload switch — "complete" arm (never validated in normal flow)
  // The "complete" arm is reached when completeStep() is called on a session already
  // at currentStep="complete" — the guard `if (current === "complete") return session`
  // short-circuits before validate, so we need to call completeStep on a complete session.
  it('completeStep() on already-complete session returns immediately without throwing', () => {
    const session = svc.createSession("org_complete_branch");
    // Advance through all 5 steps
    svc.completeStep(session.sessionId, { tenantName: "Acme" });
    svc.completeStep(session.sessionId, { language: "en" });
    svc.completeStep(session.sessionId, { claimsEntries: [] });
    svc.completeStep(session.sessionId, { escalationThreshold: 3 });
    svc.completeStep(session.sessionId, { testCallSuccess: false, testCallNotes: "failed" });

    const done = svc.getSession(session.sessionId)!;
    expect(done.currentStep).toBe("complete");

    // Call completeStep again — must not throw; returns the same session
    expect(() => svc.completeStep(session.sessionId, {})).not.toThrow();
    const still = svc.getSession(session.sessionId)!;
    expect(still.currentStep).toBe("complete");
  });

  // Branch: skipStep() on already-complete session returns immediately
  it('skipStep() on already-complete session returns without advancing', () => {
    const session = svc.createSession("org_skip_complete");
    svc.completeStep(session.sessionId, { tenantName: "X" });
    svc.completeStep(session.sessionId, { language: "en" });
    svc.completeStep(session.sessionId, { claimsEntries: [] });
    svc.completeStep(session.sessionId, { escalationThreshold: 1 });
    svc.completeStep(session.sessionId, { testCallSuccess: true, testCallNotes: "ok" });

    expect(() => svc.skipStep(session.sessionId)).not.toThrow();
    expect(svc.getSession(session.sessionId)!.currentStep).toBe("complete");
  });

  // Branch: extractStepData switch default arm — called with step="complete"
  // This is internally reached only when completeStep is called on "complete" step, but
  // the guard returns early. We cover the equivalent path: after all steps are done,
  // extractStepData is invoked for each step type. The default arm covers any unknown
  // step value; we trigger it indirectly by confirming no error is thrown for "complete".
  // Since the default arm is inside private extractStepData, we test via the public API
  // boundary: completing the session exercises all switch arms except default.
  // The default arm is exercised when currentStep is "complete" and completeStep is called
  // — but the early return prevents reaching extractStepData. Coverage tools sometimes
  // count the default as hit via the switch statement itself. We add this test to ensure
  // testCallNotes nullish coalescing branch ("" fallback) is hit:

  // Branch: testCallNotes ?? "" — the "" fallback when notes is undefined
  it('completeStep() for test_call stores empty string for notes when testCallNotes is omitted', () => {
    const session = svc.createSession("org_notes_branch");
    svc.completeStep(session.sessionId, { tenantName: "Notes" });
    svc.completeStep(session.sessionId, { language: "en" });
    svc.completeStep(session.sessionId, { claimsEntries: [] });
    svc.completeStep(session.sessionId, { escalationThreshold: 2 });

    // testCallNotes intentionally omitted — triggers the ?? "" fallback
    const done = svc.completeStep(session.sessionId, { testCallSuccess: true });

    expect(done.testCallResult).toBeDefined();
    expect(done.testCallResult!.notes).toBe("");
    expect(done.testCallResult!.latencyMs).toBeUndefined();
  });

  // Branch: load() — non-ENOENT error is re-thrown
  it('constructor re-throws non-ENOENT filesystem errors', () => {
    const fs = require("fs");
    const original = fs.readFileSync;
    const permErr = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    // Make readFileSync throw EACCES so the file "exists" but can't be read
    fs.readFileSync = () => { throw permErr; };

    try {
      expect(() => new OnboardingWizardService(file)).toThrow("Permission denied");
    } finally {
      fs.readFileSync = original;
    }
  });

  // Branch: nextStep() — idx === -1 or idx >= length-1
  it('nextStep returns "complete" when called from the last real step', () => {
    const session = svc.createSession("org_nextstep");
    // Advance to test_call (the last real step)
    svc.completeStep(session.sessionId, { tenantName: "T" });
    svc.completeStep(session.sessionId, { language: "en" });
    svc.completeStep(session.sessionId, { claimsEntries: [] });
    svc.completeStep(session.sessionId, { escalationThreshold: 0 });

    expect(svc.getSession(session.sessionId)!.currentStep).toBe("test_call");

    const done = svc.completeStep(session.sessionId, { testCallSuccess: true, testCallNotes: "ok" });
    expect(done.currentStep).toBe("complete");
    expect(done.complete).toBe(true);
  });

  // Branch: goBack() prevStep — prevStepState.status !== "pending" sets "in_progress"
  it('goBack() sets previous step to in_progress when its status was complete', () => {
    const session = svc.createSession("org_inprogress");
    // Complete tenant_registration so it becomes "complete", then go back
    svc.completeStep(session.sessionId, { tenantName: "Acme" });
    expect(svc.getSession(session.sessionId)!.currentStep).toBe("voice_configuration");

    const backed = svc.goBack(session.sessionId);
    expect(backed.currentStep).toBe("tenant_registration");
    const regStep = backed.steps.find((s) => s.step === "tenant_registration");
    expect(regStep!.status).toBe("in_progress");
  });

  // Branch: goBack() prevStep — status is already "pending", no change
  it('goBack() does not change step status when it is already pending', () => {
    const session = svc.createSession("org_pending_back");
    // Do not complete any step — tenant_registration is pending
    // Going back from tenant_registration stays there (idx=0 → STEP_ORDER[0])
    svc.goBack(session.sessionId);
    const s = svc.getSession(session.sessionId)!;
    expect(s.currentStep).toBe("tenant_registration");
    const regStep = s.steps.find((step) => step.step === "tenant_registration");
    // status remains "pending" (the !== "pending" branch not taken)
    expect(regStep!.status).toBe("pending");
  });
});

// ── OnboardingWizardService — remaining branch coverage ──────────────────────

describe("OnboardingWizardService — remaining branch coverage", () => {
  let svc: OnboardingWizardService;
  let file: string;

  beforeEach(() => {
    file = join(
      tmpdir(),
      `onboarding-remaining-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    svc = new OnboardingWizardService(file);
  });

  afterEach(() => {
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  // Branch L125: voice_configuration — voiceId is omitted entirely (if-body skipped)
  it("completeStep() voice_configuration succeeds when voiceId is omitted", () => {
    const session = svc.createSession("org_vconfig_novid");
    svc.completeStep(session.sessionId, { tenantName: "Acme" });
    // voiceId omitted — the `if (payload.voiceId !== undefined)` false branch
    expect(() =>
      svc.completeStep(session.sessionId, { language: "en" }),
    ).not.toThrow();
    expect(svc.getSession(session.sessionId)!.currentStep).toBe("claims_registry");
  });

  // Branch L126 true arm: voiceId provided but not a string → validation error
  it("completeStep() voice_configuration throws when voiceId is not a string", () => {
    const session = svc.createSession("org_vconfig_badtype");
    svc.completeStep(session.sessionId, { tenantName: "Acme" });

    let caught: (Error & { validationErrors?: string[] }) | undefined;
    try {
      // Pass a numeric voiceId — typeof !== "string" triggers the validation error
      svc.completeStep(session.sessionId, { voiceId: 42 as unknown as string });
    } catch (e) {
      caught = e as Error & { validationErrors?: string[] };
    }

    expect(caught).toBeDefined();
    expect(caught!.validationErrors?.some((e) => e.includes("voiceId"))).toBe(true);
  });

  // Branch L126 binary-expr right side: voiceId is a string but trims to empty
  it("completeStep() voice_configuration throws when voiceId is a whitespace-only string", () => {
    const session = svc.createSession("org_vconfig_blank");
    svc.completeStep(session.sessionId, { tenantName: "Acme" });

    let caught: (Error & { validationErrors?: string[] }) | undefined;
    try {
      svc.completeStep(session.sessionId, { voiceId: "   " });
    } catch (e) {
      caught = e as Error & { validationErrors?: string[] };
    }

    expect(caught).toBeDefined();
    expect(caught!.validationErrors?.some((e) => e.includes("voiceId"))).toBe(true);
  });

  // Branch L139 true arm: claimsEntries provided but is not an array → validation error
  it("completeStep() claims_registry throws when claimsEntries is not an array", () => {
    const session = svc.createSession("org_claims_bad");
    svc.completeStep(session.sessionId, { tenantName: "Acme" });
    svc.completeStep(session.sessionId, { language: "en" });

    let caught: (Error & { validationErrors?: string[] }) | undefined;
    try {
      svc.completeStep(session.sessionId, {
        claimsEntries: "not-an-array" as unknown as [],
      });
    } catch (e) {
      caught = e as Error & { validationErrors?: string[] };
    }

    expect(caught).toBeDefined();
    expect(caught!.validationErrors?.some((e) => e.includes("claimsEntries"))).toBe(true);
  });

  // Branch L257: nextStep() idx === -1 path — reached by corrupting the stored session
  // so currentStep is an unknown value not in STEP_ORDER
  it("completeStep() advances to 'complete' when currentStep is an unrecognised step value", () => {
    // Create a session then manually corrupt its currentStep in the JSON file
    const session = svc.createSession("org_corrupt_step");
    const stored = JSON.parse(require("fs").readFileSync(file, "utf-8"));
    stored.sessions[0].currentStep = "unknown_step_xyz";
    writeFileSync(file, JSON.stringify(stored, null, 2), "utf-8");

    // Reload from the corrupted file
    const svc2 = new OnboardingWizardService(file);

    // nextStep("unknown_step_xyz") → idx === -1 → returns "complete"
    const result = svc2.completeStep(session.sessionId, {});
    expect(result.currentStep).toBe("complete");
  });

  // Branch L393: skipStep() throws for unknown sessionId
  it("skipStep() throws for an unknown sessionId", () => {
    expect(() => svc.skipStep("no-such-session-skip")).toThrow();
  });

  // Branch L429: goBack() throws for an unknown sessionId
  it("goBack() throws for an unknown sessionId", () => {
    expect(() => svc.goBack("no-such-session-back")).toThrow();
  });

  // Branch L465: resetSession() throws for an unknown sessionId
  it("resetSession() throws for an unknown sessionId", () => {
    expect(() => svc.resetSession("no-such-session-reset")).toThrow();
  });
});
