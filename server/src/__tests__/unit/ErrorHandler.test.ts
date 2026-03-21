/**
 * Global JSON Error Handler Tests (N-45)
 *
 * Verifies that the jsonErrorHandler middleware converts thrown/next(err) errors
 * to structured JSON responses — no HTML, no stack traces in production.
 */

import express, { type NextFunction } from "express";
import { createServer, type Server } from "http";
import http from "http";
import { jsonErrorHandler } from "../../middleware/errorHandler.js";

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

function makeApp(nodeEnv?: string): express.Express {
  const app = express();
  const originalEnv = process.env.NODE_ENV;

  if (nodeEnv !== undefined) {
    process.env.NODE_ENV = nodeEnv;
  }

  // Route that throws a plain Error (no status)
  app.get("/throw-500", (_req, _res, next: NextFunction) => {
    next(new Error("Something broke internally"));
  });

  // Route that throws an HttpError with explicit status
  app.get("/throw-400", (_req, _res, next: NextFunction) => {
    const err = new Error("Bad input") as Error & { status: number };
    err.status = 400;
    next(err);
  });

  app.get("/throw-404", (_req, _res, next: NextFunction) => {
    const err = new Error("Not found") as Error & { statusCode: number };
    err.statusCode = 404;
    next(err);
  });

  // Route that throws with an invalid status code (should fall back to 500)
  app.get("/throw-invalid-status", (_req, _res, next: NextFunction) => {
    const err = new Error("Bad") as Error & { status: number };
    err.status = 9999;
    next(err);
  });

  // Route that throws an error with no message
  app.get("/throw-no-message", (_req, _res, next: NextFunction) => {
    const err = {} as Error;
    next(err);
  });

  app.use(jsonErrorHandler);

  // Restore env after app construction so tests don't bleed state
  if (nodeEnv !== undefined) {
    process.env.NODE_ENV = originalEnv;
  }

  return app;
}

function startServer(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function get(server: Server, path: string): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Not listening"));
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(raw) as Record<string, unknown>,
            headers: res.headers as Record<string, string | string[] | undefined>,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Global JSON error handler (N-45)", () => {
  describe("production mode (NODE_ENV=production)", () => {
    let server: Server;
    const origEnv = process.env.NODE_ENV;

    beforeAll(async () => {
      process.env.NODE_ENV = "production";
      server = await startServer(makeApp("production"));
    });

    afterAll(async () => {
      process.env.NODE_ENV = origEnv;
      await stopServer(server);
    });

    it("returns HTTP 500 for unhandled Error", async () => {
      const { status } = await get(server, "/throw-500");
      expect(status).toBe(500);
    });

    it("returns JSON body with 'error' key for 500", async () => {
      const { body } = await get(server, "/throw-500");
      expect(typeof body.error).toBe("string");
      expect((body.error as string).length).toBeGreaterThan(0);
    });

    it("does NOT leak the raw error message in production for 5xx", async () => {
      const { body } = await get(server, "/throw-500");
      expect(body.error).not.toContain("Something broke internally");
      expect(body.error).toBe("Internal server error");
    });

    it("returns HTTP 400 when err.status is 400", async () => {
      const { status } = await get(server, "/throw-400");
      expect(status).toBe(400);
    });

    it("includes client error message for 4xx responses", async () => {
      const { body } = await get(server, "/throw-400");
      expect(body.error).toBe("Bad input");
    });

    it("respects err.statusCode as well as err.status", async () => {
      const { status } = await get(server, "/throw-404");
      expect(status).toBe(404);
    });

    it("falls back to 500 for invalid/out-of-range status codes", async () => {
      const { status } = await get(server, "/throw-invalid-status");
      expect(status).toBe(500);
    });

    it("returns JSON content-type", async () => {
      const { headers } = await get(server, "/throw-500");
      expect(headers["content-type"]).toContain("application/json");
    });

    it("handles error with no message without crashing", async () => {
      const { status } = await get(server, "/throw-no-message");
      expect(status).toBe(500);
    });
  });

  describe("development mode (NODE_ENV=development)", () => {
    let server: Server;
    const origEnv = process.env.NODE_ENV;

    beforeAll(async () => {
      process.env.NODE_ENV = "development";
      server = await startServer(makeApp("development"));
    });

    afterAll(async () => {
      process.env.NODE_ENV = origEnv;
      await stopServer(server);
    });

    it("includes the error message in development for 5xx", async () => {
      const { body } = await get(server, "/throw-500");
      expect(body.error).toBe("Something broke internally");
    });

    it("still returns HTTP 500 in development", async () => {
      const { status } = await get(server, "/throw-500");
      expect(status).toBe(500);
    });
  });
});
