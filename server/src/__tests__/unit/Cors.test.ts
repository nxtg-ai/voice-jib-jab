/**
 * CORS Middleware Tests (N-40)
 *
 * Covers wildcard mode, allowlist mode, origin rejection, pre-flight handling,
 * Vary header, and non-browser (no Origin) pass-through.
 */

import { createCorsMiddleware } from "../../middleware/cors.js";
import type { Request, Response, NextFunction } from "express";

// ── Test helpers ──────────────────────────────────────────────────────────

function makeReq(origin?: string, method = "GET"): Request {
  return {
    headers: origin ? { origin } : {},
    method,
  } as unknown as Request;
}

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    header: jest.fn((name: string, value: string) => { headers[name] = value; }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    sendStatus: jest.fn(),
    _headers: headers,
  };
}

// ── Wildcard mode ─────────────────────────────────────────────────────────

describe("createCorsMiddleware — wildcard mode", () => {
  const mw = createCorsMiddleware({ allowedOrigins: "*" });

  it("sets Access-Control-Allow-Origin: * for any origin", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq("https://anywhere.com"), res as unknown as Response, next as NextFunction);
    expect(res.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    expect(next).toHaveBeenCalled();
  });

  it("sets Access-Control-Allow-Origin: * when no origin header", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq(), res as unknown as Response, next as NextFunction);
    expect(res.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    expect(next).toHaveBeenCalled();
  });

  it("defaults to wildcard when ALLOWED_ORIGINS is empty string", () => {
    const mwEmpty = createCorsMiddleware({ allowedOrigins: "" });
    const res = makeRes();
    const next = jest.fn();
    mwEmpty(makeReq("https://example.com"), res as unknown as Response, next as NextFunction);
    expect(res.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
  });

  it("sets Access-Control-Allow-Headers on every request", () => {
    const res = makeRes();
    mw(makeReq("https://x.com"), res as unknown as Response, jest.fn());
    expect(res.header).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      expect.stringContaining("X-API-Key"),
    );
  });

  it("handles OPTIONS pre-flight with 204", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq("https://x.com", "OPTIONS"), res as unknown as Response, next as NextFunction);
    expect(res.sendStatus).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── Allowlist mode ────────────────────────────────────────────────────────

describe("createCorsMiddleware — allowlist mode", () => {
  const mw = createCorsMiddleware({
    allowedOrigins: "https://app.example.com, https://admin.example.com",
  });

  it("reflects the origin when it is in the allowlist", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq("https://app.example.com"), res as unknown as Response, next as NextFunction);
    expect(res.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "https://app.example.com");
    expect(next).toHaveBeenCalled();
  });

  it("reflects the second allowlisted origin correctly", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq("https://admin.example.com"), res as unknown as Response, next as NextFunction);
    expect(res.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "https://admin.example.com");
    expect(next).toHaveBeenCalled();
  });

  it("sets Vary: Origin when reflecting a specific origin", () => {
    const res = makeRes();
    mw(makeReq("https://app.example.com"), res as unknown as Response, jest.fn());
    expect(res.header).toHaveBeenCalledWith("Vary", "Origin");
  });

  it("rejects origin not in the allowlist with 403", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq("https://evil.example.com"), res as unknown as Response, next as NextFunction);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("CORS") }));
    expect(next).not.toHaveBeenCalled();
  });

  it("does NOT set Access-Control-Allow-Origin on rejected request", () => {
    const res = makeRes();
    mw(makeReq("https://evil.example.com"), res as unknown as Response, jest.fn());
    const aaoCalls = (res.header as jest.Mock).mock.calls.filter(
      ([name]: [string]) => name === "Access-Control-Allow-Origin",
    );
    expect(aaoCalls).toHaveLength(0);
  });

  it("passes through requests with no Origin header (server-to-server)", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq(), res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("handles OPTIONS pre-flight for allowed origin with 204", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq("https://app.example.com", "OPTIONS"), res as unknown as Response, next as NextFunction);
    expect(res.sendStatus).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects OPTIONS pre-flight from unlisted origin", () => {
    const res = makeRes();
    const next = jest.fn();
    mw(makeReq("https://evil.example.com", "OPTIONS"), res as unknown as Response, next as NextFunction);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("trims whitespace in allowlist entries", () => {
    const mwSpaces = createCorsMiddleware({ allowedOrigins: "  https://trimmed.example.com  " });
    const res = makeRes();
    const next = jest.fn();
    mwSpaces(makeReq("https://trimmed.example.com"), res as unknown as Response, next as NextFunction);
    expect(res.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "https://trimmed.example.com");
    expect(next).toHaveBeenCalled();
  });

  it("sets Access-Control-Allow-Methods on every request", () => {
    const res = makeRes();
    mw(makeReq("https://app.example.com"), res as unknown as Response, jest.fn());
    expect(res.header).toHaveBeenCalledWith(
      "Access-Control-Allow-Methods",
      expect.stringContaining("DELETE"),
    );
  });
});
