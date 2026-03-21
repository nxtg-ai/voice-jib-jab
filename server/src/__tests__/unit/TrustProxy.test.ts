/**
 * Trust Proxy Configuration Tests (N-42)
 *
 * Verifies that TRUST_PROXY env var correctly configures Express trust proxy,
 * causing req.ip to reflect X-Forwarded-For rather than the TCP socket address.
 *
 * This is a P0 correctness requirement for per-IP rate limiting behind K8s ingress.
 */

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import http from "http";

/** Build a minimal Express app with trust proxy configured per env var. */
function makeApp(trustProxyEnv?: string): Express {
  const app = express();

  if (trustProxyEnv !== undefined && trustProxyEnv !== "") {
    const numericProxy = Number(trustProxyEnv);
    app.set(
      "trust proxy",
      Number.isInteger(numericProxy) && numericProxy >= 0
        ? numericProxy
        : trustProxyEnv,
    );
  }

  app.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });

  return app;
}

interface IpResponse {
  ip: string;
}

function startServer(app: Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function getIp(server: Server, xff?: string): Promise<IpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Server not listening"));
    const headers: Record<string, string> = {};
    if (xff) headers["X-Forwarded-For"] = xff;
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path: "/ip", method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString()) as IpResponse));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Trust Proxy configuration (N-42)", () => {
  describe("TRUST_PROXY unset (dev default)", () => {
    let server: Server;
    beforeEach(async () => { server = await startServer(makeApp(undefined)); });
    afterEach(async () => stopServer(server));

    it("req.ip is the direct connection address, ignoring X-Forwarded-For", async () => {
      const { ip } = await getIp(server, "203.0.113.1");
      expect(ip).not.toBe("203.0.113.1");
    });
  });

  describe("TRUST_PROXY=1 (one hop — K8s ingress)", () => {
    let server: Server;
    beforeEach(async () => { server = await startServer(makeApp("1")); });
    afterEach(async () => stopServer(server));

    it("req.ip reflects X-Forwarded-For client IP", async () => {
      const { ip } = await getIp(server, "203.0.113.42");
      expect(ip).toBe("203.0.113.42");
    });

    it("rightmost X-Forwarded-For address is req.ip when one hop is trusted", async () => {
      // trust=1 means only the socket (127.0.0.1) is a trusted proxy.
      // The rightmost XFF entry (10.0.0.1) is the first untrusted → req.ip.
      const { ip } = await getIp(server, "203.0.113.5, 10.0.0.1");
      expect(ip).toBe("10.0.0.1");
    });

    it("no X-Forwarded-For → req.ip is defined and a string", async () => {
      const { ip } = await getIp(server);
      expect(typeof ip).toBe("string");
      expect(ip.length).toBeGreaterThan(0);
    });
  });

  describe("TRUST_PROXY=2 (two hops — Cloudflare + K8s)", () => {
    let server: Server;
    beforeEach(async () => { server = await startServer(makeApp("2")); });
    afterEach(async () => stopServer(server));

    it("trusts two hops — socket + rightmost XFF are trusted, next entry is req.ip", async () => {
      // trust=2: socket (127.0.0.1) = hop 1, 10.0.0.1 = hop 2 (both trusted).
      // 198.51.100.1 is the first untrusted address → req.ip.
      const { ip } = await getIp(server, "203.0.113.99, 198.51.100.1, 10.0.0.1");
      expect(ip).toBe("198.51.100.1");
    });
  });

  describe("TRUST_PROXY=loopback (loopback keyword)", () => {
    let server: Server;
    beforeEach(async () => { server = await startServer(makeApp("loopback")); });
    afterEach(async () => stopServer(server));

    it("trusts loopback addresses as proxy — X-Forwarded-For from loopback client is used", async () => {
      const { ip } = await getIp(server, "203.0.113.7");
      expect(ip).toBe("203.0.113.7");
    });
  });

  describe("TRUST_PROXY empty string (treated as unset)", () => {
    let server: Server;
    beforeEach(async () => { server = await startServer(makeApp("")); });
    afterEach(async () => stopServer(server));

    it("empty string does NOT configure trust proxy — X-Forwarded-For is ignored", async () => {
      const { ip } = await getIp(server, "203.0.113.1");
      expect(ip).not.toBe("203.0.113.1");
    });
  });

  describe("TRUST_PROXY=0 (numeric zero — no hops trusted)", () => {
    let server: Server;
    beforeEach(async () => { server = await startServer(makeApp("0")); });
    afterEach(async () => stopServer(server));

    it("TRUST_PROXY=0 sets trust proxy to 0 — X-Forwarded-For is not trusted", async () => {
      const { ip } = await getIp(server, "203.0.113.1");
      expect(ip).not.toBe("203.0.113.1");
    });
  });
});
