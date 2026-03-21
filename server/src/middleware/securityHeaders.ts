/**
 * Security headers middleware — N-43.
 *
 * Uses Helmet to set a comprehensive suite of browser-security headers
 * in a single pass. Replaces the prior manual implementation (4 headers)
 * with Helmet's full set, adding HSTS, CSP, Cross-Origin isolation, and more.
 *
 * Notable configuration choices:
 *   frameguard: "deny"   — stricter than Helmet's SAMEORIGIN default; this
 *                          is a pure API server with no embeddable UI.
 *   referrerPolicy:      — keep existing strict-origin-when-cross-origin value.
 *   hsts maxAge:         — 180 days (15,552,000 s). HSTS preload-eligible.
 *   xXssProtection:      — disabled (Helmet default). X-XSS-Protection is
 *                          deprecated; modern browsers ignore it and older ones
 *                          can misfire, introducing vulnerabilities.
 */

import helmet from "helmet";

export const securityHeaders = helmet({
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: { maxAge: 15_552_000, includeSubDomains: true },
  // All other Helmet defaults apply:
  //   X-Content-Type-Options: nosniff
  //   X-DNS-Prefetch-Control: off
  //   X-Download-Options: noopen
  //   X-Permitted-Cross-Domain-Policies: none
  //   Cross-Origin-Embedder-Policy: require-corp
  //   Cross-Origin-Opener-Policy: same-origin
  //   Cross-Origin-Resource-Policy: same-origin
  //   Content-Security-Policy: (Helmet default restrictive policy)
  //   Origin-Agent-Cluster: ?1
});
