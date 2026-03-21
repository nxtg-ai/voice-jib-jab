/**
 * Access Logger Middleware Tests (N-47)
 *
 * Verifies that createAccessLogger() emits one JSON line per completed request,
 * with correct fields, and correctly skips the /health route.
 */

import express from "express";
import { createServer, type Server } from "http";
import http from "http";
import { createAccessLogger } from "../../middleware/accessLogger.js";
import { requestIdMiddleware } from "../../middleware/requestId.js";

interface LogEntry {
  ts: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId?: string;
}

function makeApp(lines: string[]): express.Express {
  const app = express();
  app.use(requestIdMiddleware); // needed so requestId is on req
  app.use(
    createAccessLogger({
      write: (line) => lines.push(line.trim()),
    }),
  );
  app.get("/hello", (_req, res) => res.json({ ok: true }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/error-route", (_req, _res, next) => {
    const err = new Error("boom") as Error & { status: number };
    err.status = 500;
    next(err);
  });
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.status ?? 500).json({ error: err.message });
    },
  );
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

function get(server: Server, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Not listening"));
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method: "GET", headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Access logger middleware (N-47)", () => {
  let server: Server;
  let lines: string[];

  beforeEach(async () => {
    lines = [];
    server = await startServer(makeApp(lines));
  });

  afterEach(async () => stopServer(server));

  it("emits one log line per request", async () => {
    await get(server, "/hello");
    expect(lines).toHaveLength(1);
  });

  it("log line is valid JSON", async () => {
    await get(server, "/hello");
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });

  it("log entry contains method, path, status, ms, ts fields", async () => {
    await get(server, "/hello");
    const entry = JSON.parse(lines[0]!) as LogEntry;
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/hello");
    expect(entry.status).toBe(200);
    expect(typeof entry.ms).toBe("number");
    expect(entry.ms).toBeGreaterThanOrEqual(0);
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts).getTime()).not.toBeNaN();
  });

  it("log entry includes requestId when X-Request-ID header is present", async () => {
    await get(server, "/hello", { "X-Request-ID": "test-req-abc" });
    const entry = JSON.parse(lines[0]!) as LogEntry;
    expect(entry.requestId).toBe("test-req-abc");
  });

  it("log entry has a generated requestId when no header sent", async () => {
    await get(server, "/hello");
    const entry = JSON.parse(lines[0]!) as LogEntry;
    // requestIdMiddleware generates a UUID when no header present
    expect(typeof entry.requestId).toBe("string");
    expect(entry.requestId!.length).toBeGreaterThan(0);
  });

  it("skips /health by default (no log line emitted)", async () => {
    await get(server, "/health");
    expect(lines).toHaveLength(0);
  });

  it("logs /health when custom skip returns false", async () => {
    const customLines: string[] = [];
    const app = express();
    app.use(createAccessLogger({ skip: () => false, write: (l) => customLines.push(l.trim()) }));
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
    const s = await startServer(app);
    await get(s, "/health");
    await stopServer(s);
    expect(customLines).toHaveLength(1);
  });

  it("logs 404 responses", async () => {
    await get(server, "/unknown-path");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as LogEntry;
    expect(entry.status).toBe(404);
  });

  it("logs 500 error responses", async () => {
    await get(server, "/error-route");
    const entry = JSON.parse(lines[0]!) as LogEntry;
    expect(entry.status).toBe(500);
  });

  it("emits separate lines for multiple sequential requests", async () => {
    await get(server, "/hello");
    await get(server, "/hello");
    await get(server, "/hello");
    expect(lines).toHaveLength(3);
  });

  it("each log line ends with a newline when written", async () => {
    const rawLines: string[] = [];
    const app2 = express();
    app2.use(createAccessLogger({ write: (l) => rawLines.push(l) }));
    app2.get("/x", (_req, res) => res.json({}));
    const s = await startServer(app2);
    await get(s, "/x");
    await stopServer(s);
    expect(rawLines[0]).toMatch(/\n$/);
  });
});
