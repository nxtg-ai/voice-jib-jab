import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export interface ApiKeyRecord {
  keyId: string;
  tenantId: string;
  description: string;
  keyHash: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string; // ISO timestamp; absent means no expiry
}

export interface CreateApiKeyResult {
  keyId: string;
  rawKey: string;
  tenantId: string;
  description: string;
  createdAt: string;
  expiresAt?: string;
}

export class ApiKeyStore {
  private keys: ApiKeyRecord[] = [];
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8"));
      this.keys = Array.isArray(data.keys) ? data.keys : [];
    } catch {
      this.keys = [];
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify({ keys: this.keys }, null, 2), "utf8");
  }

  private hashKey(rawKey: string): string {
    return createHash("sha256").update(rawKey).digest("hex");
  }

  createKey(tenantId: string, description: string, ttlDays?: number): CreateApiKeyResult {
    const keyId = randomBytes(16).toString("hex");
    const rawKey = `vjj_${randomBytes(32).toString("hex")}`;
    const createdAt = new Date().toISOString();
    const expiresAt =
      ttlDays !== undefined && ttlDays > 0
        ? new Date(Date.now() + ttlDays * 86_400_000).toISOString()
        : undefined;
    const record: ApiKeyRecord = {
      keyId,
      tenantId,
      description,
      keyHash: this.hashKey(rawKey),
      createdAt,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
    this.keys.push(record);
    this.save();
    return { keyId, rawKey, tenantId, description, createdAt, expiresAt };
  }

  listKeys(tenantId: string): Omit<ApiKeyRecord, "keyHash">[] {
    return this.keys
      .filter((k) => k.tenantId === tenantId)
      .map(({ keyHash: _h, ...rest }) => rest);
  }

  revokeKey(keyId: string): boolean {
    const before = this.keys.length;
    this.keys = this.keys.filter((k) => k.keyId !== keyId);
    if (this.keys.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  verifyKey(rawKey: string): ApiKeyRecord | null {
    const h = this.hashKey(rawKey);
    const record = this.keys.find((k) => k.keyHash === h) ?? null;
    if (!record) return null;
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return null;
    return record;
  }

  isExpired(keyId: string): boolean {
    const record = this.keys.find((k) => k.keyId === keyId);
    if (!record || !record.expiresAt) return false;
    return new Date(record.expiresAt).getTime() < Date.now();
  }

  /** Returns the key record (without keyHash) by keyId, or null if not found. */
  findRecord(keyId: string): Omit<ApiKeyRecord, "keyHash"> | null {
    const record = this.keys.find((k) => k.keyId === keyId);
    if (!record) return null;
    const { keyHash: _h, ...rest } = record;
    return rest;
  }

  /**
   * Finds a key record by raw key that exists but has passed its expiry.
   * Used by middleware to distinguish "expired" from "invalid" rejection reason.
   */
  findExpiredRecord(rawKey: string): Omit<ApiKeyRecord, "keyHash"> | null {
    const h = this.hashKey(rawKey);
    const record = this.keys.find((k) => k.keyHash === h);
    if (!record || !record.expiresAt) return null;
    if (new Date(record.expiresAt).getTime() >= Date.now()) return null;
    const { keyHash: _h, ...rest } = record;
    return rest;
  }

  touchKey(keyId: string): void {
    const rec = this.keys.find((k) => k.keyId === keyId);
    if (rec) {
      rec.lastUsedAt = new Date().toISOString();
      this.save();
    }
  }
}
