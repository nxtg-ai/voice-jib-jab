/**
 * compareAgentsDashboardHtml Unit Tests
 *
 * Validates that the self-contained HTML page meets structural and functional
 * requirements without a browser (string inspection only).
 */

import { compareAgentsDashboardHtml } from "../../api/compareAgentsDashboard.js";

describe("compareAgentsDashboardHtml()", () => {
  let html: string;

  beforeAll(() => {
    html = compareAgentsDashboardHtml();
  });

  it("returns a non-empty string", () => {
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("is valid HTML with DOCTYPE declaration", () => {
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("title contains 'Compare' or 'Comparison'", () => {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    expect(titleMatch).not.toBeNull();
    expect(titleMatch![1].toLowerCase()).toMatch(/compar/);
  });

  it("contains a back link to /dashboard", () => {
    expect(html).toMatch(/href=["']\/dashboard["']/);
  });

  it("contains a POST /compare-agents fetch call", () => {
    expect(html).toMatch(/fetch\(['"]\/compare-agents['"]/);
    expect(html).toMatch(/method:\s*['"]POST['"]/);
  });

  it("contains 'recommendation' text", () => {
    expect(html.toLowerCase()).toMatch(/recommendation/);
  });

  it("contains CSS custom properties (design tokens)", () => {
    expect(html).toMatch(/--bg:/);
    expect(html).toMatch(/--blue:/);
    expect(html).toMatch(/--surface:/);
  });

  it("contains config A label/ID input fields", () => {
    expect(html).toMatch(/id=["']a-id["']/);
    expect(html).toMatch(/id=["']a-label["']/);
    expect(html).toMatch(/id=["']a-sessions["']/);
  });

  it("contains config B label/ID input fields", () => {
    expect(html).toMatch(/id=["']b-id["']/);
    expect(html).toMatch(/id=["']b-label["']/);
    expect(html).toMatch(/id=["']b-sessions["']/);
  });

  it("contains setInterval or periodic fetch for auto-load", () => {
    const hasSetInterval = html.includes("setInterval");
    const hasRepeatedFetch = (html.match(/fetch\(/g) || []).length >= 2;
    expect(hasSetInterval || hasRepeatedFetch).toBe(true);
  });
});
