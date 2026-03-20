/**
 * Health Monitor Dashboard HTML Tests
 *
 * Verifies the static HTML string produced by healthMonitorDashboardHtml().
 * All assertions are string/content checks — no browser rendering required.
 */

import { healthMonitorDashboardHtml } from "../../api/healthMonitorDashboard.js";

describe("healthMonitorDashboardHtml", () => {
  let html: string;

  beforeAll(() => {
    html = healthMonitorDashboardHtml();
  });

  it("returns a non-empty string", () => {
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(500);
  });

  it("is valid HTML (starts with <!DOCTYPE html>)", () => {
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it("contains closing </html>", () => {
    expect(html).toContain("</html>");
  });

  it("title contains 'Health Monitor'", () => {
    expect(html).toContain("Health Monitor");
  });

  it("contains 'Back to Dashboard' link to /dashboard", () => {
    expect(html).toContain("Back to Dashboard");
    expect(html).toContain('href="/dashboard"');
  });

  it("contains fetch('/health/subsystems')", () => {
    expect(html).toContain("fetch('/health/subsystems')");
  });

  it("contains all 5 subsystem names (stt, tts, opa, chromadb, database)", () => {
    expect(html).toContain("stt");
    expect(html).toContain("tts");
    expect(html).toContain("opa");
    expect(html).toContain("chromadb");
    expect(html).toContain("database");
  });

  it("contains CSS custom properties (--bg:#0a0a0f)", () => {
    expect(html).toContain("--bg:#0a0a0f");
  });

  it("contains status indicator classes (healthy, unhealthy, unknown)", () => {
    expect(html).toContain("healthy");
    expect(html).toContain("unhealthy");
    expect(html).toContain("unknown");
  });

  it("contains auto-refresh interval logic (setInterval)", () => {
    expect(html).toContain("setInterval");
    expect(html).toContain("10000");
  });

  it("contains 'HEALTHY' text (overall status)", () => {
    expect(html).toContain("HEALTHY");
  });

  it("contains 'Last updated' text", () => {
    expect(html).toContain("Last updated");
  });
});
