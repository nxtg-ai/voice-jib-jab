/**
 * Tenant Migration API tests
 *
 * Tests the router produced by createTenantMigrationRouter().
 * TenantConfigMigrator is fully mocked with jest.fn().
 *
 * HTTP transport uses the same plain Node http helper as other API tests.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";

import { createTenantMigrationRouter } from "../../api/tenantMigration.js";
import type { TenantExport, ImportResult } from "../../services/TenantConfigMigrator.js";
import type { TenantConfigMigrator } from "../../services/TenantConfigMigrator.js";

// ── Mock migrator ─────────────────────────────────────────────────────

const mockMigrator = {
  exportTenant: jest.fn(),
  importTenant: jest.fn(),
};

// ── HTTP helper ───────────────────────────────────────────────────────

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

    const payload =
      body !== undefined ? JSON.stringify(body) : undefined;

    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }
        : {},
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

// ── App builder ───────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/", createTenantMigrationRouter(mockMigrator as unknown as TenantConfigMigrator));
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = "org_acme";

const EXPORT_PAYLOAD: TenantExport = {
  version: "1.0",
  exportedAt: "2026-03-01T00:00:00.000Z",
  sourceTenantId: TENANT_ID,
  tenant: null,
  personas: [],
  knowledgeItems: [],
  playbooks: [],
  ivrMenus: [],
};

const IMPORT_RESULT: ImportResult = {
  targetTenantId: "org_beta",
  importedAt: "2026-03-19T00:00:00.000Z",
  counts: { personas: 2, knowledgeItems: 3, playbooks: 1, ivrMenus: 1 },
  warnings: [],
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("Tenant Migration API", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildApp());
    server.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /tenants/:id/export ───────────────────────────────────────

  describe("GET /tenants/:tenantId/export", () => {
    it("returns 200 with JSON export payload", async () => {
      mockMigrator.exportTenant.mockResolvedValue(EXPORT_PAYLOAD);

      const res = await httpRequest(server, "GET", `/tenants/${TENANT_ID}/export`);

      expect(res.status).toBe(200);
      const data = res.json() as TenantExport;
      expect(data.version).toBe("1.0");
      expect(data.sourceTenantId).toBe(TENANT_ID);
    });

    it("sets Content-Disposition attachment header with tenant filename", async () => {
      mockMigrator.exportTenant.mockResolvedValue(EXPORT_PAYLOAD);

      const res = await httpRequest(server, "GET", `/tenants/${TENANT_ID}/export`);

      const disposition = res.headers["content-disposition"];
      expect(disposition).toContain("attachment");
      expect(disposition).toContain(`tenant-${TENANT_ID}-export.json`);
    });

    it("calls exportTenant with the tenantId from the URL", async () => {
      mockMigrator.exportTenant.mockResolvedValue(EXPORT_PAYLOAD);

      await httpRequest(server, "GET", `/tenants/${TENANT_ID}/export`);

      expect(mockMigrator.exportTenant).toHaveBeenCalledWith(TENANT_ID);
    });

    it("returns 404 when migrator throws 'Tenant not found'", async () => {
      mockMigrator.exportTenant.mockRejectedValue(
        new Error(`Tenant not found: ${TENANT_ID}`),
      );

      const res = await httpRequest(server, "GET", `/tenants/${TENANT_ID}/export`);

      expect(res.status).toBe(404);
      const data = res.json() as { error: string };
      expect(data.error).toContain("Tenant not found");
    });

    it("returns 500 on unexpected error", async () => {
      mockMigrator.exportTenant.mockRejectedValue(new Error("Disk failure"));

      const res = await httpRequest(server, "GET", `/tenants/${TENANT_ID}/export`);

      expect(res.status).toBe(500);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Internal server error");
    });
  });

  // ── POST /tenants/:id/import ──────────────────────────────────────

  describe("POST /tenants/:tenantId/import", () => {
    it("returns 200 with ImportResult on valid body", async () => {
      mockMigrator.importTenant.mockResolvedValue(IMPORT_RESULT);

      const res = await httpRequest(
        server,
        "POST",
        `/tenants/org_beta/import`,
        EXPORT_PAYLOAD,
      );

      expect(res.status).toBe(200);
      const data = res.json() as ImportResult;
      expect(data.targetTenantId).toBe("org_beta");
      expect(data.counts).toBeDefined();
      expect(data.warnings).toBeDefined();
    });

    it("calls importTenant with targetTenantId from URL param", async () => {
      mockMigrator.importTenant.mockResolvedValue(IMPORT_RESULT);

      await httpRequest(
        server,
        "POST",
        `/tenants/org_beta/import`,
        EXPORT_PAYLOAD,
      );

      expect(mockMigrator.importTenant).toHaveBeenCalledWith(
        expect.any(Object),
        "org_beta",
        expect.any(Object),
      );
    });

    it("passes overwrite=true when query param is set", async () => {
      mockMigrator.importTenant.mockResolvedValue(IMPORT_RESULT);

      await httpRequest(
        server,
        "POST",
        `/tenants/org_beta/import?overwrite=true`,
        EXPORT_PAYLOAD,
      );

      expect(mockMigrator.importTenant).toHaveBeenCalledWith(
        expect.any(Object),
        "org_beta",
        expect.objectContaining({ overwrite: true }),
      );
    });

    it("passes overwrite=false when query param is absent", async () => {
      mockMigrator.importTenant.mockResolvedValue(IMPORT_RESULT);

      await httpRequest(
        server,
        "POST",
        `/tenants/org_beta/import`,
        EXPORT_PAYLOAD,
      );

      expect(mockMigrator.importTenant).toHaveBeenCalledWith(
        expect.any(Object),
        "org_beta",
        expect.objectContaining({ overwrite: false }),
      );
    });

    it("returns 400 for empty body (no JSON)", async () => {
      // Send request with no body — express.json() sets req.body to undefined
      const res = await httpRequest(server, "POST", `/tenants/org_beta/import`);

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBeDefined();
    });

    it("returns 400 when body is missing version", async () => {
      const bad = { sourceTenantId: TENANT_ID, personas: [] };

      const res = await httpRequest(
        server,
        "POST",
        `/tenants/org_beta/import`,
        bad,
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("version");
      expect(mockMigrator.importTenant).not.toHaveBeenCalled();
    });

    it("returns 400 when body is missing sourceTenantId", async () => {
      const bad = { version: "1.0", personas: [] };

      const res = await httpRequest(
        server,
        "POST",
        `/tenants/org_beta/import`,
        bad,
      );

      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toContain("sourceTenantId");
      expect(mockMigrator.importTenant).not.toHaveBeenCalled();
    });

    it("response includes counts field", async () => {
      mockMigrator.importTenant.mockResolvedValue(IMPORT_RESULT);

      const res = await httpRequest(
        server,
        "POST",
        `/tenants/org_beta/import`,
        EXPORT_PAYLOAD,
      );

      const data = res.json() as ImportResult;
      expect(data.counts).toMatchObject({
        personas: expect.any(Number),
        knowledgeItems: expect.any(Number),
        playbooks: expect.any(Number),
        ivrMenus: expect.any(Number),
      });
    });

    it("response includes warnings field", async () => {
      mockMigrator.importTenant.mockResolvedValue(IMPORT_RESULT);

      const res = await httpRequest(
        server,
        "POST",
        `/tenants/org_beta/import`,
        EXPORT_PAYLOAD,
      );

      const data = res.json() as ImportResult;
      expect(Array.isArray(data.warnings)).toBe(true);
    });
  });
});

// ── Error catch branch coverage ────────────────────────────────────────────

describe("GET /tenants/:tenantId/export — error branches", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildApp());
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });
  beforeEach(() => { jest.clearAllMocks(); });

  it("returns 500 when exportTenant throws a non-Error value (String(err) branch, line 41)", async () => {
    // Covers the `err instanceof Error ? ... : String(err)` false branch
    mockMigrator.exportTenant.mockRejectedValue("disk dead");

    const res = await httpRequest(server, "GET", `/tenants/${TENANT_ID}/export`);

    expect(res.status).toBe(500);
    const data = res.json() as { error: string };
    expect(data.error).toBe("Internal server error");
  });
});

describe("POST /tenants/:tenantId/import — body type guard and catch branches", () => {
  let server: Server;

  beforeAll((done) => {
    server = createServer(buildApp());
    server.listen(0, done);
  });

  afterAll((done) => { server.close(done); });
  beforeEach(() => { jest.clearAllMocks(); });

  it("returns 400 when body is null (!body branch, line 65-67)", async () => {
    // express.json() with strict:true never passes null through to the route;
    // we inject null directly via middleware to cover the !body guard.
    const app = express();
    app.use((_req, _res, next) => { _req.body = null; next(); });
    app.use("/", createTenantMigrationRouter(mockMigrator as unknown as TenantConfigMigrator));
    const s = await new Promise<Server>((resolve) => {
      const srv = createServer(app);
      srv.listen(0, "127.0.0.1", () => resolve(srv));
    });
    try {
      const res = await httpRequest(s, "POST", `/tenants/org_beta/import`);
      expect(res.status).toBe(400);
      const data = res.json() as { error: string };
      expect(data.error).toBe("Request body is required");
      expect(mockMigrator.importTenant).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it("returns 400 when importTenant throws 'Unsupported export version' (line 89-93)", async () => {
    mockMigrator.importTenant.mockRejectedValue(
      new Error("Unsupported export version: 9.9"),
    );

    const res = await httpRequest(
      server,
      "POST",
      `/tenants/org_beta/import`,
      EXPORT_PAYLOAD,
    );

    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Unsupported export version");
  });

  it("returns 400 when importTenant throws 'Invalid export' (line 90-93)", async () => {
    mockMigrator.importTenant.mockRejectedValue(
      new Error("Invalid export: schema mismatch"),
    );

    const res = await httpRequest(
      server,
      "POST",
      `/tenants/org_beta/import`,
      EXPORT_PAYLOAD,
    );

    expect(res.status).toBe(400);
    const data = res.json() as { error: string };
    expect(data.error).toContain("Invalid export");
  });

  it("returns 500 when importTenant throws a generic Error (line 96)", async () => {
    mockMigrator.importTenant.mockRejectedValue(new Error("DB connection lost"));

    const res = await httpRequest(
      server,
      "POST",
      `/tenants/org_beta/import`,
      EXPORT_PAYLOAD,
    );

    expect(res.status).toBe(500);
    const data = res.json() as { error: string };
    expect(data.error).toBe("Internal server error");
  });

  it("returns 500 when importTenant throws a non-Error value (String(err) branch, line 86)", async () => {
    // Covers the `err instanceof Error ? ... : String(err)` false branch
    mockMigrator.importTenant.mockRejectedValue("plain rejection");

    const res = await httpRequest(
      server,
      "POST",
      `/tenants/org_beta/import`,
      EXPORT_PAYLOAD,
    );

    expect(res.status).toBe(500);
    const data = res.json() as { error: string };
    expect(data.error).toBe("Internal server error");
  });
});
