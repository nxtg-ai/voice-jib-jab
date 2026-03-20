/**
 * PersonaStore — JSON-persisted agent personality profiles.
 *
 * A persona defines the tone, vocabulary level, and response style for a
 * voice agent. Five built-in personas are hardcoded; user-created personas
 * are persisted to disk alongside tenant-to-persona assignments.
 *
 * Usage:
 *   const store = initPersonaStore("/path/to/personas.json");
 *   const persona = store.getPersona("persona_professional_support");
 *   store.assignPersonaToTenant("tenant_abc", "persona_friendly_helper");
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────

export type PersonaTone = "formal" | "casual" | "empathetic";
export type VocabularyLevel = "simple" | "standard" | "technical";
export type ResponseLengthPreference = "brief" | "standard" | "detailed";

export interface PersonaConfig {
  personaId: string;
  name: string;
  tone: PersonaTone;
  vocabularyLevel: VocabularyLevel;
  responseLengthPreference: ResponseLengthPreference;
  description: string;
  systemPromptSnippet: string;
  isBuiltIn: boolean;
  tenantId: string | null;
  createdAt: string;
}

// ── Built-in personas (never persisted, always present) ────────────────

const BUILT_IN_PERSONAS: PersonaConfig[] = [
  {
    personaId: "persona_professional_support",
    name: "Professional Support",
    tone: "formal",
    vocabularyLevel: "standard",
    responseLengthPreference: "standard",
    description: "A formal, solution-focused support agent for professional environments.",
    systemPromptSnippet:
      "You are a professional support agent. Maintain a formal, courteous tone. Be concise and solution-focused.",
    isBuiltIn: true,
    tenantId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    personaId: "persona_friendly_helper",
    name: "Friendly Helper",
    tone: "casual",
    vocabularyLevel: "simple",
    responseLengthPreference: "standard",
    description: "A warm, approachable helper that puts customers at ease.",
    systemPromptSnippet:
      "You are a friendly, approachable helper. Use warm, casual language. Make customers feel at ease.",
    isBuiltIn: true,
    tenantId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    personaId: "persona_technical_expert",
    name: "Technical Expert",
    tone: "formal",
    vocabularyLevel: "technical",
    responseLengthPreference: "detailed",
    description: "A precise technical expert providing detailed, accurate guidance.",
    systemPromptSnippet:
      "You are a technical expert. Use precise terminology. Provide detailed, accurate technical guidance.",
    isBuiltIn: true,
    tenantId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    personaId: "persona_warm_receptionist",
    name: "Warm Receptionist",
    tone: "empathetic",
    vocabularyLevel: "simple",
    responseLengthPreference: "brief",
    description: "An empathetic receptionist that greets callers with genuine care.",
    systemPromptSnippet:
      "You are a warm, empathetic receptionist. Greet callers with genuine care. Keep responses brief and welcoming.",
    isBuiltIn: true,
    tenantId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    personaId: "persona_compliance_officer",
    name: "Compliance Officer",
    tone: "formal",
    vocabularyLevel: "standard",
    responseLengthPreference: "detailed",
    description: "A compliance officer that adheres strictly to regulatory language.",
    systemPromptSnippet:
      "You are a compliance officer. Adhere strictly to regulatory language. Document all key points clearly.",
    isBuiltIn: true,
    tenantId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

// ── Disk schema ────────────────────────────────────────────────────────

interface PersistedData {
  personas: PersonaConfig[];
  tenantAssignments: Record<string, string>;
}

// ── PersonaStore ───────────────────────────────────────────────────────

export class PersonaStore {
  /** User-created personas only (built-ins are never stored here). */
  private customPersonas: Map<string, PersonaConfig> = new Map();
  /** tenantId → personaId */
  private tenantAssignments: Map<string, string> = new Map();
  private storageFile: string;

  constructor(storageFile: string) {
    this.storageFile = storageFile;
    this.loadFromDisk();
  }

  // ── Private persistence helpers ────────────────────────────────────

  private loadFromDisk(): void {
    if (!existsSync(this.storageFile)) {
      return;
    }

    try {
      const raw = readFileSync(this.storageFile, "utf-8");
      const data = JSON.parse(raw) as PersistedData;

      for (const persona of data.personas ?? []) {
        this.customPersonas.set(persona.personaId, persona);
      }

      for (const [tenantId, personaId] of Object.entries(data.tenantAssignments ?? {})) {
        this.tenantAssignments.set(tenantId, personaId);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  private saveToDisk(): void {
    const dir = dirname(this.storageFile);
    mkdirSync(dir, { recursive: true });

    const data: PersistedData = {
      personas: Array.from(this.customPersonas.values()),
      tenantAssignments: Object.fromEntries(this.tenantAssignments),
    };

    writeFileSync(this.storageFile, JSON.stringify(data, null, 2), "utf-8");
  }

  // ── Private lookup helpers ─────────────────────────────────────────

  private findBuiltIn(personaId: string): PersonaConfig | undefined {
    return BUILT_IN_PERSONAS.find((p) => p.personaId === personaId);
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Get a single persona by id (searches built-ins then custom). */
  getPersona(personaId: string): PersonaConfig | undefined {
    return this.findBuiltIn(personaId) ?? this.customPersonas.get(personaId);
  }

  /**
   * List personas.
   *
   * When tenantId is provided, returns all built-ins plus custom personas
   * that belong to that tenant (tenantId matches) or are global (null).
   * When tenantId is omitted, returns all built-ins plus all custom personas.
   */
  listPersonas(tenantId?: string): PersonaConfig[] {
    const custom = Array.from(this.customPersonas.values());

    const filteredCustom =
      tenantId !== undefined
        ? custom.filter((p) => p.tenantId === tenantId || p.tenantId === null)
        : custom;

    return [...BUILT_IN_PERSONAS, ...filteredCustom];
  }

  /**
   * Create a new custom persona. isBuiltIn is always false.
   * Persists immediately.
   */
  createPersona(
    data: Omit<PersonaConfig, "personaId" | "createdAt" | "isBuiltIn">,
  ): PersonaConfig {
    const persona: PersonaConfig = {
      ...data,
      personaId: randomUUID(),
      isBuiltIn: false,
      createdAt: new Date().toISOString(),
    };

    this.customPersonas.set(persona.personaId, persona);
    this.saveToDisk();
    return persona;
  }

  /**
   * Update a custom persona. Returns undefined if not found or if the
   * persona is a built-in (built-ins are immutable).
   */
  updatePersona(
    personaId: string,
    updates: Partial<Omit<PersonaConfig, "personaId" | "createdAt" | "isBuiltIn">>,
  ): PersonaConfig | undefined {
    // Reject built-in updates
    if (this.findBuiltIn(personaId)) {
      return undefined;
    }

    const existing = this.customPersonas.get(personaId);
    if (!existing) {
      return undefined;
    }

    const updated: PersonaConfig = {
      ...existing,
      ...updates,
      personaId,
      createdAt: existing.createdAt,
      isBuiltIn: false,
    };

    this.customPersonas.set(personaId, updated);
    this.saveToDisk();
    return updated;
  }

  /**
   * Delete a custom persona. Returns false if not found or if the persona
   * is a built-in (built-ins cannot be deleted).
   */
  deletePersona(personaId: string): boolean {
    if (this.findBuiltIn(personaId)) {
      return false;
    }

    if (!this.customPersonas.has(personaId)) {
      return false;
    }

    this.customPersonas.delete(personaId);
    this.saveToDisk();
    return true;
  }

  /**
   * Get the assigned persona for a tenant.
   * Returns undefined if no assignment exists or assigned personaId is not found.
   */
  getTenantPersona(tenantId: string): PersonaConfig | undefined {
    const personaId = this.tenantAssignments.get(tenantId);
    if (!personaId) {
      return undefined;
    }
    return this.getPersona(personaId);
  }

  /**
   * Assign a persona to a tenant.
   * Returns false if personaId does not exist.
   * Persists immediately.
   */
  assignPersonaToTenant(tenantId: string, personaId: string): boolean {
    if (!this.getPersona(personaId)) {
      return false;
    }

    this.tenantAssignments.set(tenantId, personaId);
    this.saveToDisk();
    return true;
  }

  /** Remove the persona assignment for a tenant. Persists immediately. */
  unassignPersonaFromTenant(tenantId: string): void {
    this.tenantAssignments.delete(tenantId);
    this.saveToDisk();
  }
}

// ── Module-level singleton ─────────────────────────────────────────────

let _store: PersonaStore | undefined;

/** Module-level singleton. Access after calling initPersonaStore(). */
export const personaStore: PersonaStore = new Proxy(
  {} as PersonaStore,
  {
    get(_target, prop) {
      if (!_store) {
        throw new Error(
          "PersonaStore not initialized. Call initPersonaStore() first.",
        );
      }
      const value = (_store as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(_store);
      }
      return value;
    },
  },
);

/** Initialize the module-level singleton with a storage file path. */
export function initPersonaStore(storageFile: string): PersonaStore {
  _store = new PersonaStore(storageFile);
  return _store;
}
