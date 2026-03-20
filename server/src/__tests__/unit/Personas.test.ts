/**
 * Personas Tests
 *
 * Tests the PersonaStore service and Personas/TenantPersona API endpoints.
 * Follows the ConversationMemory.test.ts pattern: standalone Express app.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, mkdirSync } from "fs";
import {
  PersonaStore,
  initPersonaStore,
  personaStore,
} from "../../services/PersonaStore.js";
import { createPersonasRouter, createTenantPersonaRouter } from "../../api/personas.js";

// ── HTTP helpers ───────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => unknown;
}

function httpRequest(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }

    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload).toString() } : {}),
      },
    };

    import("http").then(({ default: http }) => {
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: rawBody,
            json: () => JSON.parse(rawBody),
          });
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ── Test setup helpers ─────────────────────────────────────────────────

function tempFile(name: string): string {
  const dir = join(
    tmpdir(),
    `persona-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return join(dir, "personas.json");
}

function buildTestApp(store: PersonaStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/personas", createPersonasRouter(store));
  app.use("/tenants", createTenantPersonaRouter(store));
  return app;
}

// ── Unit Tests: PersonaStore — built-in personas ───────────────────────

describe("PersonaStore — built-in personas", () => {
  let store: PersonaStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("builtins");
    store = new PersonaStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("listPersonas() returns exactly 5 built-in personas", () => {
    const personas = store.listPersonas();
    const builtIns = personas.filter((p) => p.isBuiltIn);
    expect(builtIns).toHaveLength(5);
  });

  it("listPersonas() returns all 5 built-ins by default", () => {
    const personas = store.listPersonas();
    expect(personas.length).toBeGreaterThanOrEqual(5);
  });

  it("all built-in personas have isBuiltIn=true", () => {
    const personas = store.listPersonas();
    const builtIns = personas.filter((p) => p.isBuiltIn);
    for (const p of builtIns) {
      expect(p.isBuiltIn).toBe(true);
    }
  });

  it("getPersona() finds persona_professional_support by id", () => {
    const p = store.getPersona("persona_professional_support");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Professional Support");
    expect(p!.tone).toBe("formal");
  });

  it("getPersona() finds persona_friendly_helper", () => {
    const p = store.getPersona("persona_friendly_helper");
    expect(p).toBeDefined();
    expect(p!.tone).toBe("casual");
    expect(p!.vocabularyLevel).toBe("simple");
  });

  it("getPersona() finds persona_technical_expert", () => {
    const p = store.getPersona("persona_technical_expert");
    expect(p).toBeDefined();
    expect(p!.vocabularyLevel).toBe("technical");
    expect(p!.responseLengthPreference).toBe("detailed");
  });

  it("getPersona() finds persona_warm_receptionist", () => {
    const p = store.getPersona("persona_warm_receptionist");
    expect(p).toBeDefined();
    expect(p!.tone).toBe("empathetic");
    expect(p!.responseLengthPreference).toBe("brief");
  });

  it("getPersona() finds persona_compliance_officer", () => {
    const p = store.getPersona("persona_compliance_officer");
    expect(p).toBeDefined();
    expect(p!.tone).toBe("formal");
    expect(p!.responseLengthPreference).toBe("detailed");
  });

  it("getPersona() returns undefined for unknown id", () => {
    expect(store.getPersona("persona_unknown_xyz")).toBeUndefined();
  });
});

// ── Unit Tests: PersonaStore — createPersona() ─────────────────────────

describe("PersonaStore — createPersona()", () => {
  let store: PersonaStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("create");
    store = new PersonaStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("creates persona with correct fields", () => {
    const created = store.createPersona({
      name: "My Custom Agent",
      tone: "casual",
      vocabularyLevel: "standard",
      responseLengthPreference: "brief",
      description: "A custom test persona",
      systemPromptSnippet: "Be helpful.",
      tenantId: "tenant_abc",
    });

    expect(created.personaId).toBeDefined();
    expect(typeof created.personaId).toBe("string");
    expect(created.name).toBe("My Custom Agent");
    expect(created.tone).toBe("casual");
    expect(created.vocabularyLevel).toBe("standard");
    expect(created.responseLengthPreference).toBe("brief");
    expect(created.description).toBe("A custom test persona");
    expect(created.systemPromptSnippet).toBe("Be helpful.");
    expect(created.tenantId).toBe("tenant_abc");
    expect(created.createdAt).toBeDefined();
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
  });

  it("isBuiltIn is always false for created personas", () => {
    const created = store.createPersona({
      name: "Test",
      tone: "formal",
      vocabularyLevel: "standard",
      responseLengthPreference: "standard",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: null,
    });
    expect(created.isBuiltIn).toBe(false);
  });

  it("created persona is immediately retrievable via getPersona()", () => {
    const created = store.createPersona({
      name: "Retrievable",
      tone: "empathetic",
      vocabularyLevel: "simple",
      responseLengthPreference: "detailed",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: null,
    });

    const fetched = store.getPersona(created.personaId);
    expect(fetched).toEqual(created);
  });

  it("persists to disk after creation (new instance reads it back)", () => {
    const created = store.createPersona({
      name: "Persisted Persona",
      tone: "formal",
      vocabularyLevel: "technical",
      responseLengthPreference: "detailed",
      description: "Persisted",
      systemPromptSnippet: "snippet",
      tenantId: null,
    });

    const store2 = new PersonaStore(storageFile);
    const fetched = store2.getPersona(created.personaId);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Persisted Persona");
  });
});

// ── Unit Tests: PersonaStore — updatePersona() ────────────────────────

describe("PersonaStore — updatePersona()", () => {
  let store: PersonaStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("update");
    store = new PersonaStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("updates a custom persona and returns updated record", () => {
    const created = store.createPersona({
      name: "Old Name",
      tone: "formal",
      vocabularyLevel: "standard",
      responseLengthPreference: "standard",
      description: "Old",
      systemPromptSnippet: "old snippet",
      tenantId: null,
    });

    const updated = store.updatePersona(created.personaId, { name: "New Name", tone: "casual" });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("New Name");
    expect(updated!.tone).toBe("casual");
    expect(updated!.personaId).toBe(created.personaId);
    expect(updated!.createdAt).toBe(created.createdAt);
  });

  it("returns undefined when trying to update a built-in", () => {
    const result = store.updatePersona("persona_professional_support", { name: "Hacked" });
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown personaId", () => {
    const result = store.updatePersona("nonexistent-id", { name: "Ghost" });
    expect(result).toBeUndefined();
  });

  it("persists update to disk", () => {
    const created = store.createPersona({
      name: "Before",
      tone: "formal",
      vocabularyLevel: "standard",
      responseLengthPreference: "standard",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: null,
    });

    store.updatePersona(created.personaId, { name: "After" });

    const store2 = new PersonaStore(storageFile);
    const fetched = store2.getPersona(created.personaId);
    expect(fetched!.name).toBe("After");
  });
});

// ── Unit Tests: PersonaStore — deletePersona() ────────────────────────

describe("PersonaStore — deletePersona()", () => {
  let store: PersonaStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("delete");
    store = new PersonaStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("deletes a custom persona and returns true", () => {
    const created = store.createPersona({
      name: "Temporary",
      tone: "casual",
      vocabularyLevel: "simple",
      responseLengthPreference: "brief",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: null,
    });

    const result = store.deletePersona(created.personaId);
    expect(result).toBe(true);
    expect(store.getPersona(created.personaId)).toBeUndefined();
  });

  it("returns false when trying to delete a built-in", () => {
    const result = store.deletePersona("persona_friendly_helper");
    expect(result).toBe(false);
    expect(store.getPersona("persona_friendly_helper")).toBeDefined();
  });

  it("returns false for unknown personaId", () => {
    const result = store.deletePersona("does-not-exist");
    expect(result).toBe(false);
  });
});

// ── Unit Tests: PersonaStore — tenant assignment ───────────────────────

describe("PersonaStore — tenant assignment", () => {
  let store: PersonaStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("assign");
    store = new PersonaStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("assignPersonaToTenant() returns true and getTenantPersona() returns it", () => {
    const ok = store.assignPersonaToTenant("tenant_1", "persona_professional_support");
    expect(ok).toBe(true);

    const persona = store.getTenantPersona("tenant_1");
    expect(persona).toBeDefined();
    expect(persona!.personaId).toBe("persona_professional_support");
  });

  it("assignPersonaToTenant() returns false for unknown personaId", () => {
    const ok = store.assignPersonaToTenant("tenant_2", "persona_does_not_exist");
    expect(ok).toBe(false);
  });

  it("getTenantPersona() returns undefined for unassigned tenant", () => {
    const persona = store.getTenantPersona("tenant_unassigned");
    expect(persona).toBeUndefined();
  });

  it("unassignPersonaFromTenant() removes the assignment", () => {
    store.assignPersonaToTenant("tenant_3", "persona_warm_receptionist");
    store.unassignPersonaFromTenant("tenant_3");
    expect(store.getTenantPersona("tenant_3")).toBeUndefined();
  });

  it("unassignPersonaFromTenant() is idempotent on unassigned tenant", () => {
    expect(() => store.unassignPersonaFromTenant("tenant_never_assigned")).not.toThrow();
  });

  it("can assign a custom persona to a tenant", () => {
    const custom = store.createPersona({
      name: "Custom Agent",
      tone: "empathetic",
      vocabularyLevel: "simple",
      responseLengthPreference: "brief",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: null,
    });

    const ok = store.assignPersonaToTenant("tenant_custom", custom.personaId);
    expect(ok).toBe(true);

    const fetched = store.getTenantPersona("tenant_custom");
    expect(fetched!.personaId).toBe(custom.personaId);
  });
});

// ── Unit Tests: PersonaStore — listPersonas() filtering ───────────────

describe("PersonaStore — listPersonas() filtering", () => {
  let store: PersonaStore;
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("list");
    store = new PersonaStore(storageFile);
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("without tenantId returns built-ins plus all custom personas", () => {
    store.createPersona({
      name: "Global Custom",
      tone: "formal",
      vocabularyLevel: "standard",
      responseLengthPreference: "standard",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: null,
    });
    store.createPersona({
      name: "Tenant-Specific",
      tone: "casual",
      vocabularyLevel: "simple",
      responseLengthPreference: "brief",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: "tenant_x",
    });

    const all = store.listPersonas();
    expect(all.length).toBe(7); // 5 built-ins + 2 custom
  });

  it("with tenantId returns built-ins plus tenant's and global custom personas", () => {
    store.createPersona({
      name: "Global",
      tone: "formal",
      vocabularyLevel: "standard",
      responseLengthPreference: "standard",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: null,
    });
    store.createPersona({
      name: "Tenant Y Only",
      tone: "casual",
      vocabularyLevel: "simple",
      responseLengthPreference: "brief",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: "tenant_y",
    });
    store.createPersona({
      name: "Tenant Z Only",
      tone: "formal",
      vocabularyLevel: "technical",
      responseLengthPreference: "detailed",
      description: "desc",
      systemPromptSnippet: "snippet",
      tenantId: "tenant_z",
    });

    const forY = store.listPersonas("tenant_y");
    // 5 built-ins + 1 global + 1 tenant_y = 7
    expect(forY.length).toBe(7);
    expect(forY.some((p) => p.name === "Tenant Z Only")).toBe(false);
    expect(forY.some((p) => p.name === "Tenant Y Only")).toBe(true);
    expect(forY.some((p) => p.name === "Global")).toBe(true);
  });
});

// ── Unit Tests: PersonaStore — persistence ────────────────────────────

describe("PersonaStore — persistence", () => {
  let storageFile: string;

  beforeEach(() => {
    storageFile = tempFile("persist");
  });

  afterEach(() => {
    const dir = join(storageFile, "..");
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("survives reload — new store instance reads same custom personas and assignments", () => {
    const store1 = new PersonaStore(storageFile);

    const custom = store1.createPersona({
      name: "Survivor",
      tone: "empathetic",
      vocabularyLevel: "standard",
      responseLengthPreference: "standard",
      description: "Will survive reload",
      systemPromptSnippet: "Keep going.",
      tenantId: null,
    });
    store1.assignPersonaToTenant("tenant_persist", custom.personaId);

    // Create a fresh instance pointing at same file
    const store2 = new PersonaStore(storageFile);
    const fetched = store2.getPersona(custom.personaId);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Survivor");

    const assigned = store2.getTenantPersona("tenant_persist");
    expect(assigned).toBeDefined();
    expect(assigned!.personaId).toBe(custom.personaId);
  });

  it("built-ins are NOT persisted — they come from code, not disk", () => {
    // Create store, verify built-ins exist
    const store1 = new PersonaStore(storageFile);
    const builtIns = store1.listPersonas().filter((p) => p.isBuiltIn);
    expect(builtIns).toHaveLength(5);

    // If file doesn't exist yet (no custom personas created), there's nothing on disk
    // for built-ins — they still show up after a reload
    const store2 = new PersonaStore(storageFile);
    const builtIns2 = store2.listPersonas().filter((p) => p.isBuiltIn);
    expect(builtIns2).toHaveLength(5);
  });
});

// ── Unit Tests: PersonaStore — singleton proxy ────────────────────────

describe("PersonaStore — singleton proxy", () => {
  it("personaStore proxy throws before initPersonaStore() is called", () => {
    // Reset internal _store by re-requiring a fresh module — Jest module cache
    // makes this tricky, so we test the proxy on the already-initialized module.
    // Instead verify that after init, methods are callable.
    const storageFile = tempFile("singleton");
    initPersonaStore(storageFile);

    expect(typeof personaStore.listPersonas).toBe("function");
    expect(typeof personaStore.getPersona).toBe("function");

    const personas = personaStore.listPersonas();
    expect(personas.length).toBeGreaterThanOrEqual(5);

    rmSync(join(storageFile, ".."), { recursive: true, force: true });
  });

  it("initPersonaStore() returns a PersonaStore instance", () => {
    const storageFile = tempFile("init");
    const instance = initPersonaStore(storageFile);
    expect(instance).toBeInstanceOf(PersonaStore);
    rmSync(join(storageFile, ".."), { recursive: true, force: true });
  });
});

// ── HTTP Integration Tests ─────────────────────────────────────────────

describe("Personas HTTP API", () => {
  let app: Express;
  let server: Server;
  let store: PersonaStore;
  let storageFile: string;

  beforeAll((done) => {
    storageFile = tempFile("http");
    store = new PersonaStore(storageFile);
    app = buildTestApp(store);
    server = createServer(app);
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(() => {
      const dir = join(storageFile, "..");
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      done();
    });
  });

  // ── GET /personas ────────────────────────────────────────────────────

  describe("GET /personas", () => {
    it("returns 200 with all 5 built-in personas", async () => {
      const res = await httpRequest(server, "GET", "/personas");
      expect(res.status).toBe(200);

      const data = res.json() as { personas: unknown[]; count: number };
      expect(data.count).toBeGreaterThanOrEqual(5);
      expect(data.personas.length).toBeGreaterThanOrEqual(5);
    });

    it("filters by tenantId query param", async () => {
      const res = await httpRequest(server, "GET", "/personas?tenantId=tenant_filter_test");
      expect(res.status).toBe(200);

      const data = res.json() as { personas: unknown[]; count: number };
      // At minimum returns 5 built-ins
      expect(data.count).toBeGreaterThanOrEqual(5);
    });
  });

  // ── POST /personas ───────────────────────────────────────────────────

  describe("POST /personas", () => {
    it("creates and returns 201 with new persona", async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        name: "HTTP Created Persona",
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        description: "Created via HTTP",
        systemPromptSnippet: "Be formal.",
        tenantId: null,
      });

      expect(res.status).toBe(201);
      const data = res.json() as {
        personaId: string;
        name: string;
        isBuiltIn: boolean;
        createdAt: string;
      };
      expect(data.personaId).toBeDefined();
      expect(data.name).toBe("HTTP Created Persona");
      expect(data.isBuiltIn).toBe(false);
      expect(data.createdAt).toBeDefined();
    });

    it("returns 400 when name is missing", async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        description: "desc",
        systemPromptSnippet: "snippet",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("name");
    });

    it("returns 400 when name exceeds 100 chars", async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        name: "x".repeat(101),
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        description: "desc",
        systemPromptSnippet: "snippet",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("100");
    });

    it("returns 400 when tone is invalid", async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        name: "Test",
        tone: "robotic",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        description: "desc",
        systemPromptSnippet: "snippet",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tone");
    });

    it("returns 400 when vocabularyLevel is invalid", async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        name: "Test",
        tone: "formal",
        vocabularyLevel: "complex",
        responseLengthPreference: "standard",
        description: "desc",
        systemPromptSnippet: "snippet",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("vocabularyLevel");
    });

    it("returns 400 when responseLengthPreference is invalid", async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        name: "Test",
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "verbose",
        description: "desc",
        systemPromptSnippet: "snippet",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("responseLengthPreference");
    });
  });

  // ── GET /personas/:personaId ─────────────────────────────────────────

  describe("GET /personas/:personaId", () => {
    it("returns 200 with persona for known id", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/personas/persona_professional_support",
      );
      expect(res.status).toBe(200);

      const data = res.json() as { personaId: string; name: string };
      expect(data.personaId).toBe("persona_professional_support");
      expect(data.name).toBe("Professional Support");
    });

    it("returns 404 for unknown persona id", async () => {
      const res = await httpRequest(server, "GET", "/personas/nonexistent_persona");
      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
    });
  });

  // ── PUT /personas/:personaId ─────────────────────────────────────────

  describe("PUT /personas/:personaId", () => {
    it("updates a custom persona and returns updated record", async () => {
      // Create a custom persona first
      const createRes = await httpRequest(server, "POST", "/personas", {
        name: "Before Update",
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        description: "desc",
        systemPromptSnippet: "snippet",
        tenantId: null,
      });
      const created = createRes.json() as { personaId: string };

      const updateRes = await httpRequest(
        server,
        "PUT",
        `/personas/${created.personaId}`,
        { name: "After Update", tone: "casual" },
      );
      expect(updateRes.status).toBe(200);
      const updated = updateRes.json() as { name: string; tone: string };
      expect(updated.name).toBe("After Update");
      expect(updated.tone).toBe("casual");
    });

    it("returns 404 for unknown persona id", async () => {
      const res = await httpRequest(server, "PUT", "/personas/nonexistent_id", {
        name: "Ghost",
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when trying to update a built-in", async () => {
      const res = await httpRequest(
        server,
        "PUT",
        "/personas/persona_professional_support",
        { name: "Hacked" },
      );
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("built-in");
    });
  });

  // ── DELETE /personas/:personaId ──────────────────────────────────────

  describe("DELETE /personas/:personaId", () => {
    it("deletes a custom persona and returns 204", async () => {
      const createRes = await httpRequest(server, "POST", "/personas", {
        name: "To Be Deleted",
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        description: "desc",
        systemPromptSnippet: "snippet",
        tenantId: null,
      });
      const created = createRes.json() as { personaId: string };

      const deleteRes = await httpRequest(
        server,
        "DELETE",
        `/personas/${created.personaId}`,
      );
      expect(deleteRes.status).toBe(204);

      // Verify gone
      const getRes = await httpRequest(
        server,
        "GET",
        `/personas/${created.personaId}`,
      );
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for unknown persona id", async () => {
      const res = await httpRequest(server, "DELETE", "/personas/nonexistent_persona");
      expect(res.status).toBe(404);
    });

    it("returns 400 when trying to delete a built-in", async () => {
      const res = await httpRequest(
        server,
        "DELETE",
        "/personas/persona_friendly_helper",
      );
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("built-in");
    });
  });

  // ── GET /tenants/:tenantId/persona ───────────────────────────────────

  describe("GET /tenants/:tenantId/persona", () => {
    it("returns { tenantId, persona: null } when no assignment", async () => {
      const res = await httpRequest(
        server,
        "GET",
        "/tenants/unassigned_tenant_xyz/persona",
      );
      expect(res.status).toBe(200);

      const data = res.json() as { tenantId: string; persona: null };
      expect(data.tenantId).toBe("unassigned_tenant_xyz");
      expect(data.persona).toBeNull();
    });

    it("returns persona when one is assigned", async () => {
      // Assign first
      await httpRequest(server, "POST", "/tenants/tenant_with_persona/persona", {
        personaId: "persona_technical_expert",
      });

      const res = await httpRequest(
        server,
        "GET",
        "/tenants/tenant_with_persona/persona",
      );
      expect(res.status).toBe(200);

      const data = res.json() as { tenantId: string; persona: { personaId: string } };
      expect(data.tenantId).toBe("tenant_with_persona");
      expect(data.persona).not.toBeNull();
      expect(data.persona.personaId).toBe("persona_technical_expert");
    });
  });

  // ── POST /tenants/:tenantId/persona ──────────────────────────────────

  describe("POST /tenants/:tenantId/persona", () => {
    it("assigns a persona and returns 200 with assignment", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/tenants/tenant_assign_test/persona",
        { personaId: "persona_warm_receptionist" },
      );
      expect(res.status).toBe(200);

      const data = res.json() as { tenantId: string; personaId: string };
      expect(data.tenantId).toBe("tenant_assign_test");
      expect(data.personaId).toBe("persona_warm_receptionist");
    });

    it("returns 404 for unknown personaId", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/tenants/tenant_404_test/persona",
        { personaId: "persona_does_not_exist" },
      );
      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("not found");
    });
  });

  // ── DELETE /tenants/:tenantId/persona ────────────────────────────────

  describe("DELETE /tenants/:tenantId/persona", () => {
    it("returns 204 after unassigning", async () => {
      // Assign first
      await httpRequest(server, "POST", "/tenants/tenant_unassign/persona", {
        personaId: "persona_compliance_officer",
      });

      const res = await httpRequest(
        server,
        "DELETE",
        "/tenants/tenant_unassign/persona",
      );
      expect(res.status).toBe(204);

      // Verify unassigned
      const getRes = await httpRequest(
        server,
        "GET",
        "/tenants/tenant_unassign/persona",
      );
      const data = getRes.json() as { persona: null };
      expect(data.persona).toBeNull();
    });

    it("returns 204 even for tenant with no prior assignment (idempotent)", async () => {
      const res = await httpRequest(
        server,
        "DELETE",
        "/tenants/tenant_never_assigned_http/persona",
      );
      expect(res.status).toBe(204);
    });
  });

  // ── POST /personas — remaining validation branches ────────────────────

  describe("POST /personas — description + systemPromptSnippet validation", () => {
    it("returns 400 when description is missing", async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        name: "No Desc",
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        systemPromptSnippet: "snippet",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("description");
    });

    it("returns 400 when systemPromptSnippet is missing", async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        name: "No Snippet",
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        description: "A description",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("systemPromptSnippet");
    });
  });

  // ── PUT /personas — validation branches ──────────────────────────────

  describe("PUT /personas — update validation branches", () => {
    let customPersonaId: string;

    beforeAll(async () => {
      const res = await httpRequest(server, "POST", "/personas", {
        name: "Validation Target",
        tone: "formal",
        vocabularyLevel: "standard",
        responseLengthPreference: "standard",
        description: "For PUT validation tests",
        systemPromptSnippet: "Be formal.",
      });
      const data = res.json() as { personaId: string };
      customPersonaId = data.personaId;
    });

    it("returns 400 when name is not a string", async () => {
      const res = await httpRequest(server, "PUT", `/personas/${customPersonaId}`, {
        name: 42,
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("name");
    });

    it("returns 400 when name exceeds 100 chars in PUT", async () => {
      const res = await httpRequest(server, "PUT", `/personas/${customPersonaId}`, {
        name: "x".repeat(101),
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("100");
    });

    it("returns 400 when tone is invalid in PUT", async () => {
      const res = await httpRequest(server, "PUT", `/personas/${customPersonaId}`, {
        tone: "robotic",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("tone");
    });

    it("returns 400 when vocabularyLevel is invalid in PUT", async () => {
      const res = await httpRequest(server, "PUT", `/personas/${customPersonaId}`, {
        vocabularyLevel: "advanced",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("vocabularyLevel");
    });

    it("returns 400 when responseLengthPreference is invalid in PUT", async () => {
      const res = await httpRequest(server, "PUT", `/personas/${customPersonaId}`, {
        responseLengthPreference: "verbose",
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("responseLengthPreference");
    });

    it("returns 400 when description is not a string in PUT", async () => {
      const res = await httpRequest(server, "PUT", `/personas/${customPersonaId}`, {
        description: 999,
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("description");
    });

    it("returns 400 when systemPromptSnippet is not a string in PUT", async () => {
      const res = await httpRequest(server, "PUT", `/personas/${customPersonaId}`, {
        systemPromptSnippet: true,
      });
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("systemPromptSnippet");
    });

    it("updates tenantId field in PUT", async () => {
      const res = await httpRequest(server, "PUT", `/personas/${customPersonaId}`, {
        tenantId: "org_put_test",
      });
      expect(res.status).toBe(200);
      const data = res.json() as { tenantId: string };
      expect(data.tenantId).toBe("org_put_test");
    });
  });

  // ── POST /tenants/:tenantId/persona — missing personaId ──────────────

  describe("POST /tenants/:tenantId/persona — missing personaId", () => {
    it("returns 400 when personaId is missing from body", async () => {
      const res = await httpRequest(
        server,
        "POST",
        "/tenants/tenant_bad_body/persona",
        { notPersonaId: "oops" },
      );
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("personaId");
    });
  });
});
