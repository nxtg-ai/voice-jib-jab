import type { Request, Response, NextFunction } from "express";
import type { ApiKeyStore } from "../services/ApiKeyStore.js";
import type { AuditEventLogger } from "../services/AuditEventLogger.js";

export function createApiKeyMiddleware(
  store: ApiKeyStore,
  enabled: boolean,
  auditLogger?: AuditEventLogger,
): (req: Request, res: Response, next: NextFunction) => void {
  return function requireApiKey(req: Request, res: Response, next: NextFunction): void {
    if (!enabled) {
      next();
      return;
    }
    const rawKey = req.headers["x-api-key"];
    if (!rawKey || typeof rawKey !== "string") {
      auditLogger?.log({ type: "api_key_rejected", detail: { reason: "missing_header", path: req.path } });
      res.status(401).json({ error: "Missing X-API-Key header" });
      return;
    }
    const record = store.verifyKey(rawKey);
    if (!record) {
      auditLogger?.log({ type: "api_key_rejected", detail: { reason: "invalid_key", path: req.path } });
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    store.touchKey(record.keyId);
    auditLogger?.log({ type: "api_key_used", tenantId: record.tenantId, detail: { keyId: record.keyId, path: req.path } });
    (req as Request & { apiKeyTenantId: string }).apiKeyTenantId = record.tenantId;
    next();
  };
}
