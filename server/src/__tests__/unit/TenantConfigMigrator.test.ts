/**
 * TenantConfigMigrator unit tests
 *
 * All stores and TenantRegistry are fully mocked with jest.fn().
 */

import { TenantConfigMigrator } from "../../services/TenantConfigMigrator.js";
import type { TenantExport } from "../../services/TenantConfigMigrator.js";
import type { TenantRegistry, TenantConfig } from "../../services/TenantRegistry.js";
import type { PersonaStore, PersonaConfig } from "../../services/PersonaStore.js";
import type { KnowledgeBaseStore, KbEntry } from "../../services/KnowledgeBaseStore.js";
import type { PlaybookStore, PlaybookEntry } from "../../services/PlaybookStore.js";
import type { IvrMenuStore, IvrMenu } from "../../services/IvrMenuStore.js";

// ── Mock factories ────────────────────────────────────────────────────

function makeMockRegistry(
  overrides: Partial<Record<keyof TenantRegistry, jest.Mock>> = {},
): jest.Mocked<TenantRegistry> {
  return {
    getTenant: jest.fn(),
    createTenant: jest.fn(),
    updateTenant: jest.fn(),
    deleteTenant: jest.fn(),
    listTenants: jest.fn(),
    load: jest.fn(),
    save: jest.fn(),
    size: 0,
    ...overrides,
  } as unknown as jest.Mocked<TenantRegistry>;
}

function makeMockPersonaStore(
  overrides: Partial<Record<keyof PersonaStore, jest.Mock>> = {},
): jest.Mocked<PersonaStore> {
  return {
    listPersonas: jest.fn(),
    createPersona: jest.fn(),
    getPersona: jest.fn(),
    updatePersona: jest.fn(),
    deletePersona: jest.fn(),
    getTenantPersona: jest.fn(),
    assignPersonaToTenant: jest.fn(),
    unassignPersonaFromTenant: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<PersonaStore>;
}

function makeMockKbStore(
  overrides: Partial<Record<keyof KnowledgeBaseStore, jest.Mock>> = {},
): jest.Mocked<KnowledgeBaseStore> {
  return {
    listEntries: jest.fn(),
    addEntry: jest.fn(),
    getEntry: jest.fn(),
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
    search: jest.fn(),
    clearTenant: jest.fn(),
    incrementHit: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<KnowledgeBaseStore>;
}

function makeMockPlaybookStore(
  overrides: Partial<Record<keyof PlaybookStore, jest.Mock>> = {},
): jest.Mocked<PlaybookStore> {
  return {
    listEntries: jest.fn(),
    createEntry: jest.fn(),
    getEntry: jest.fn(),
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
    suggestEntries: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<PlaybookStore>;
}

function makeMockIvrStore(
  overrides: Partial<Record<keyof IvrMenuStore, jest.Mock>> = {},
): jest.Mocked<IvrMenuStore> {
  return {
    listMenus: jest.fn(),
    createMenu: jest.fn(),
    getMenu: jest.fn(),
    updateMenu: jest.fn(),
    deleteMenu: jest.fn(),
    processInput: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<IvrMenuStore>;
}

// ── Fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = "org_acme";
const TARGET_ID = "org_beta";

const TENANT_CONFIG: TenantConfig = {
  tenantId: TENANT_ID,
  name: "ACME Corp",
  createdAt: "2026-01-01T00:00:00.000Z",
  policyLevel: "standard",
  claimsThreshold: 0.5,
  claims: [],
  disallowedPatterns: [],
};

const CUSTOM_PERSONA: PersonaConfig = {
  personaId: "persona-abc",
  name: "ACME Agent",
  tone: "formal",
  vocabularyLevel: "standard",
  responseLengthPreference: "standard",
  description: "ACME-specific agent",
  systemPromptSnippet: "You are an ACME agent.",
  isBuiltIn: false,
  tenantId: TENANT_ID,
  createdAt: "2026-02-01T00:00:00.000Z",
};

const BUILTIN_PERSONA: PersonaConfig = {
  personaId: "persona_professional_support",
  name: "Professional Support",
  tone: "formal",
  vocabularyLevel: "standard",
  responseLengthPreference: "standard",
  description: "Built-in",
  systemPromptSnippet: "Built-in snippet",
  isBuiltIn: true,
  tenantId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const KB_ITEM: KbEntry = {
  id: "kb-001",
  tenantId: TENANT_ID,
  question: "How do I reset?",
  answer: "Click Settings > Reset",
  tags: ["reset"],
  source: "manual",
  hitCount: 0,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

const PLAYBOOK: PlaybookEntry = {
  entryId: "pb-001",
  name: "Welcome Script",
  scenario: "greeting",
  script: "Welcome to ACME.",
  keywords: ["welcome", "hello"],
  tenantId: TENANT_ID,
  enabled: true,
  createdAt: "2026-02-01T00:00:00.000Z",
};

const IVR_MENU: IvrMenu = {
  menuId: "ivr-001",
  name: "Main Menu",
  tenantId: TENANT_ID,
  rootNodeId: "node-root",
  nodes: {
    "node-root": {
      nodeId: "node-root",
      type: "menu",
      prompt: "Press 1 for support",
      tenantId: TENANT_ID,
    },
  },
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

// ── Helpers ───────────────────────────────────────────────────────────

function buildMigrator(
  opts: {
    tenantConfig?: TenantConfig | null;
    personas?: PersonaConfig[];
    kbItems?: KbEntry[];
    playbooks?: PlaybookEntry[];
    ivrMenus?: IvrMenu[];
  } = {},
): {
  migrator: TenantConfigMigrator;
  registry: jest.Mocked<TenantRegistry>;
  personaStore: jest.Mocked<PersonaStore>;
  kbStore: jest.Mocked<KnowledgeBaseStore>;
  playbookStore: jest.Mocked<PlaybookStore>;
  ivrStore: jest.Mocked<IvrMenuStore>;
} {
  const tenantConfig = opts.tenantConfig !== undefined ? opts.tenantConfig : TENANT_CONFIG;
  const personas = opts.personas ?? [BUILTIN_PERSONA, CUSTOM_PERSONA];
  const kbItems = opts.kbItems ?? [KB_ITEM];
  const playbooks = opts.playbooks ?? [PLAYBOOK];
  const ivrMenus = opts.ivrMenus ?? [IVR_MENU];

  const registry = makeMockRegistry();
  registry.getTenant.mockReturnValue(tenantConfig);

  const personaStore = makeMockPersonaStore();
  personaStore.listPersonas.mockReturnValue(personas);
  personaStore.createPersona.mockImplementation((data) => ({
    ...data,
    personaId: "new-persona-id",
    isBuiltIn: false,
    createdAt: new Date().toISOString(),
  }));

  const kbStore = makeMockKbStore();
  kbStore.listEntries.mockReturnValue(kbItems);
  kbStore.addEntry.mockImplementation((opts) => ({
    ...opts,
    id: "new-kb-id",
    hitCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: opts.tags ?? [],
    source: opts.source ?? "manual",
  }));

  const playbookStore = makeMockPlaybookStore();
  playbookStore.listEntries.mockReturnValue(playbooks);
  playbookStore.createEntry.mockImplementation((opts) => ({
    ...opts,
    entryId: "new-pb-id",
    enabled: opts.enabled ?? true,
    createdAt: new Date().toISOString(),
  }));

  const ivrStore = makeMockIvrStore();
  ivrStore.listMenus.mockReturnValue(ivrMenus);
  ivrStore.createMenu.mockImplementation((opts) => ({
    ...opts,
    menuId: "new-ivr-id",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const migrator = new TenantConfigMigrator(
    registry,
    personaStore,
    kbStore,
    playbookStore,
    ivrStore,
  );

  return { migrator, registry, personaStore, kbStore, playbookStore, ivrStore };
}

// ── exportTenant tests ────────────────────────────────────────────────

describe("TenantConfigMigrator.exportTenant", () => {
  it("returns version '1.0'", async () => {
    const { migrator } = buildMigrator();
    const result = await migrator.exportTenant(TENANT_ID);
    expect(result.version).toBe("1.0");
  });

  it("includes sourceTenantId matching the requested tenant", async () => {
    const { migrator } = buildMigrator();
    const result = await migrator.exportTenant(TENANT_ID);
    expect(result.sourceTenantId).toBe(TENANT_ID);
  });

  it("includes exportedAt as an ISO timestamp", async () => {
    const { migrator } = buildMigrator();
    const before = Date.now();
    const result = await migrator.exportTenant(TENANT_ID);
    const after = Date.now();
    const ts = new Date(result.exportedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("calls getTenant on the registry", async () => {
    const { migrator, registry } = buildMigrator();
    await migrator.exportTenant(TENANT_ID);
    expect(registry.getTenant).toHaveBeenCalledWith(TENANT_ID);
  });

  it("calls listPersonas with tenantId", async () => {
    const { migrator, personaStore } = buildMigrator();
    await migrator.exportTenant(TENANT_ID);
    expect(personaStore.listPersonas).toHaveBeenCalledWith(TENANT_ID);
  });

  it("calls listEntries on kbStore with tenantId", async () => {
    const { migrator, kbStore } = buildMigrator();
    await migrator.exportTenant(TENANT_ID);
    expect(kbStore.listEntries).toHaveBeenCalledWith(TENANT_ID);
  });

  it("calls listEntries on playbookStore with tenantId filter", async () => {
    const { migrator, playbookStore } = buildMigrator();
    await migrator.exportTenant(TENANT_ID);
    expect(playbookStore.listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  it("calls listMenus on ivrStore with tenantId filter", async () => {
    const { migrator, ivrStore } = buildMigrator();
    await migrator.exportTenant(TENANT_ID);
    expect(ivrStore.listMenus).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  it("throws 'Tenant not found' when tenant does not exist", async () => {
    const { migrator } = buildMigrator({ tenantConfig: null });
    await expect(migrator.exportTenant("missing_tenant")).rejects.toThrow(
      "Tenant not found: missing_tenant",
    );
  });

  it("includes only custom non-built-in personas owned by the tenant", async () => {
    const { migrator } = buildMigrator({
      personas: [BUILTIN_PERSONA, CUSTOM_PERSONA],
    });
    const result = await migrator.exportTenant(TENANT_ID);
    expect(result.personas).toHaveLength(1);
    expect(result.personas[0].personaId).toBe("persona-abc");
  });

  it("includes knowledge items from the store", async () => {
    const { migrator } = buildMigrator({ kbItems: [KB_ITEM] });
    const result = await migrator.exportTenant(TENANT_ID);
    expect(result.knowledgeItems).toHaveLength(1);
    expect(result.knowledgeItems[0].id).toBe("kb-001");
  });

  it("includes only tenant-owned playbooks (excludes global null-tenant entries)", async () => {
    const globalPlaybook: PlaybookEntry = {
      ...PLAYBOOK,
      entryId: "pb-global",
      tenantId: null,
    };
    const { migrator } = buildMigrator({ playbooks: [PLAYBOOK, globalPlaybook] });
    const result = await migrator.exportTenant(TENANT_ID);
    expect(result.playbooks).toHaveLength(1);
    expect(result.playbooks[0].entryId).toBe("pb-001");
  });

  it("includes IVR menus from the store", async () => {
    const { migrator } = buildMigrator({ ivrMenus: [IVR_MENU] });
    const result = await migrator.exportTenant(TENANT_ID);
    expect(result.ivrMenus).toHaveLength(1);
    expect(result.ivrMenus[0].menuId).toBe("ivr-001");
  });

  it("includes tenant registration info", async () => {
    const { migrator } = buildMigrator();
    const result = await migrator.exportTenant(TENANT_ID);
    expect(result.tenant).toMatchObject({ tenantId: TENANT_ID });
  });
});

// ── importTenant tests ────────────────────────────────────────────────

describe("TenantConfigMigrator.importTenant", () => {
  function buildExport(overrides: Partial<TenantExport> = {}): TenantExport {
    return {
      version: "1.0",
      exportedAt: "2026-03-01T00:00:00.000Z",
      sourceTenantId: TENANT_ID,
      tenant: TENANT_CONFIG,
      personas: [CUSTOM_PERSONA],
      knowledgeItems: [KB_ITEM],
      playbooks: [PLAYBOOK],
      ivrMenus: [IVR_MENU],
      ...overrides,
    };
  }

  it("throws on wrong version field", async () => {
    const { migrator } = buildMigrator();
    const bad = { ...buildExport(), version: "2.0" } as unknown as TenantExport;
    await expect(migrator.importTenant(bad, TARGET_ID)).rejects.toThrow(
      "Unsupported export version",
    );
  });

  it("throws when version field is missing", async () => {
    const { migrator } = buildMigrator();
    const bad = { ...buildExport() } as Record<string, unknown>;
    delete bad["version"];
    await expect(
      migrator.importTenant(bad as unknown as TenantExport, TARGET_ID),
    ).rejects.toThrow();
  });

  it("throws when sourceTenantId is missing", async () => {
    const { migrator } = buildMigrator();
    const bad = { ...buildExport(), sourceTenantId: "" };
    await expect(migrator.importTenant(bad, TARGET_ID)).rejects.toThrow(
      "Invalid export: missing sourceTenantId",
    );
  });

  it("imports personas remapped to targetTenantId", async () => {
    const { migrator, personaStore } = buildMigrator({
      personas: [],
    });
    // Target has no personas yet
    personaStore.listPersonas.mockReturnValue([]);

    await migrator.importTenant(buildExport(), TARGET_ID);

    expect(personaStore.createPersona).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TARGET_ID }),
    );
  });

  it("imports knowledge items remapped to targetTenantId", async () => {
    const { migrator, kbStore } = buildMigrator({ kbItems: [] });
    kbStore.listEntries.mockReturnValue([]);

    await migrator.importTenant(buildExport(), TARGET_ID);

    expect(kbStore.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TARGET_ID }),
    );
  });

  it("imports playbooks remapped to targetTenantId", async () => {
    const { migrator, playbookStore } = buildMigrator({ playbooks: [] });
    playbookStore.listEntries.mockReturnValue([]);

    await migrator.importTenant(buildExport(), TARGET_ID);

    expect(playbookStore.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TARGET_ID }),
    );
  });

  it("imports IVR menus remapped to targetTenantId", async () => {
    const { migrator, ivrStore } = buildMigrator({ ivrMenus: [] });
    ivrStore.listMenus.mockReturnValue([]);

    await migrator.importTenant(buildExport(), TARGET_ID);

    expect(ivrStore.createMenu).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TARGET_ID }),
    );
  });

  it("returns correct counts of imported items", async () => {
    const { migrator, personaStore, kbStore, playbookStore, ivrStore } =
      buildMigrator();
    // Target is empty — nothing to conflict with
    personaStore.listPersonas.mockReturnValue([]);
    kbStore.listEntries.mockReturnValue([]);
    playbookStore.listEntries.mockReturnValue([]);
    ivrStore.listMenus.mockReturnValue([]);

    const result = await migrator.importTenant(buildExport(), TARGET_ID);

    expect(result.counts.personas).toBe(1);
    expect(result.counts.knowledgeItems).toBe(1);
    expect(result.counts.playbooks).toBe(1);
    expect(result.counts.ivrMenus).toBe(1);
  });

  it("skips conflicting items and adds warnings when overwrite=false", async () => {
    const { migrator, personaStore, kbStore, playbookStore, ivrStore } =
      buildMigrator();
    // The conflict check compares against items already in the TARGET tenant.
    // We must return items with tenantId === TARGET_ID and matching IDs so the
    // Set lookup produces a hit.
    const targetPersona: PersonaConfig = { ...CUSTOM_PERSONA, tenantId: TARGET_ID };
    const targetKbItem: KbEntry = { ...KB_ITEM, tenantId: TARGET_ID };
    const targetPlaybook: PlaybookEntry = { ...PLAYBOOK, tenantId: TARGET_ID };
    const targetIvrMenu: IvrMenu = { ...IVR_MENU, tenantId: TARGET_ID };

    personaStore.listPersonas.mockReturnValue([targetPersona]);
    kbStore.listEntries.mockReturnValue([targetKbItem]);
    playbookStore.listEntries.mockReturnValue([targetPlaybook]);
    ivrStore.listMenus.mockReturnValue([targetIvrMenu]);

    const result = await migrator.importTenant(buildExport(), TARGET_ID, {
      overwrite: false,
    });

    expect(result.counts.personas).toBe(0);
    expect(result.counts.knowledgeItems).toBe(0);
    expect(result.counts.playbooks).toBe(0);
    expect(result.counts.ivrMenus).toBe(0);
    expect(result.warnings).toHaveLength(
      // 4 resource conflicts + 1 tenant already exists
      5,
    );
    expect(result.warnings.some((w) => w.includes("skipped"))).toBe(true);
  });

  it("overwrites existing items when overwrite=true", async () => {
    const { migrator, personaStore, kbStore, playbookStore, ivrStore } =
      buildMigrator();
    // Return same IDs — but overwrite should still call create
    personaStore.listPersonas.mockReturnValue([CUSTOM_PERSONA]);
    kbStore.listEntries.mockReturnValue([KB_ITEM]);
    playbookStore.listEntries.mockReturnValue([PLAYBOOK]);
    ivrStore.listMenus.mockReturnValue([IVR_MENU]);

    const result = await migrator.importTenant(buildExport(), TARGET_ID, {
      overwrite: true,
    });

    expect(result.counts.personas).toBe(1);
    expect(result.counts.knowledgeItems).toBe(1);
    expect(result.counts.playbooks).toBe(1);
    expect(result.counts.ivrMenus).toBe(1);
  });

  it("returns importedAt as an ISO timestamp", async () => {
    const { migrator, personaStore, kbStore, playbookStore, ivrStore } =
      buildMigrator();
    personaStore.listPersonas.mockReturnValue([]);
    kbStore.listEntries.mockReturnValue([]);
    playbookStore.listEntries.mockReturnValue([]);
    ivrStore.listMenus.mockReturnValue([]);

    const before = Date.now();
    const result = await migrator.importTenant(buildExport(), TARGET_ID);
    const after = Date.now();

    const ts = new Date(result.importedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("returns targetTenantId in the result", async () => {
    const { migrator, personaStore, kbStore, playbookStore, ivrStore } =
      buildMigrator();
    personaStore.listPersonas.mockReturnValue([]);
    kbStore.listEntries.mockReturnValue([]);
    playbookStore.listEntries.mockReturnValue([]);
    ivrStore.listMenus.mockReturnValue([]);

    const result = await migrator.importTenant(buildExport(), TARGET_ID);
    expect(result.targetTenantId).toBe(TARGET_ID);
  });

  it("handles empty collections gracefully with counts = 0", async () => {
    const { migrator, personaStore, kbStore, playbookStore, ivrStore } =
      buildMigrator();
    personaStore.listPersonas.mockReturnValue([]);
    kbStore.listEntries.mockReturnValue([]);
    playbookStore.listEntries.mockReturnValue([]);
    ivrStore.listMenus.mockReturnValue([]);

    const result = await migrator.importTenant(
      buildExport({
        personas: [],
        knowledgeItems: [],
        playbooks: [],
        ivrMenus: [],
      }),
      TARGET_ID,
    );

    expect(result.counts.personas).toBe(0);
    expect(result.counts.knowledgeItems).toBe(0);
    expect(result.counts.playbooks).toBe(0);
    expect(result.counts.ivrMenus).toBe(0);
  });

  it("records warning and skips when tenant already exists at target", async () => {
    const { migrator, registry, personaStore, kbStore, playbookStore, ivrStore } =
      buildMigrator();
    // Target tenant already exists
    registry.getTenant.mockReturnValue(TENANT_CONFIG);
    personaStore.listPersonas.mockReturnValue([]);
    kbStore.listEntries.mockReturnValue([]);
    playbookStore.listEntries.mockReturnValue([]);
    ivrStore.listMenus.mockReturnValue([]);

    const result = await migrator.importTenant(buildExport(), TARGET_ID);

    expect(result.warnings.some((w) => w.includes("tenant registration skipped"))).toBe(true);
    expect(registry.createTenant).not.toHaveBeenCalled();
  });

  it("handles store errors during import gracefully (records warning, partial import)", async () => {
    const { migrator, personaStore, kbStore, playbookStore, ivrStore } =
      buildMigrator();
    personaStore.listPersonas.mockReturnValue([]);
    kbStore.listEntries.mockReturnValue([]);
    playbookStore.listEntries.mockReturnValue([]);
    ivrStore.listMenus.mockReturnValue([]);

    // Make KB store throw on addEntry
    kbStore.addEntry.mockImplementation(() => {
      throw new Error("Disk full");
    });

    const result = await migrator.importTenant(buildExport(), TARGET_ID);

    // KB item failed, others succeed
    expect(result.counts.knowledgeItems).toBe(0);
    expect(result.warnings.some((w) => w.includes("import failed"))).toBe(true);
    // Personas, playbooks, IVR should still have been attempted
    expect(result.counts.personas).toBe(1);
    expect(result.counts.playbooks).toBe(1);
    expect(result.counts.ivrMenus).toBe(1);
  });
});
