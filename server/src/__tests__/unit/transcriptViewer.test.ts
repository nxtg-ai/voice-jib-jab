import { transcriptViewerHtml } from "../../api/transcriptViewer.js";

describe("transcriptViewerHtml", () => {
  let html: string;

  beforeAll(() => {
    html = transcriptViewerHtml();
  });

  it("returns a non-empty string", () => {
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(500);
  });

  it("is valid HTML with doctype and closing tag", () => {
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain("</html>");
  });

  it("contains the page title", () => {
    expect(html).toContain("VJJ Transcript Viewer");
  });

  it("contains the transcript viewer heading", () => {
    expect(html).toContain("Transcript Viewer");
  });

  it("includes back link to dashboard", () => {
    expect(html).toContain('href="/dashboard"');
  });

  it("includes compliance export link target", () => {
    expect(html).toContain("/compliance");
  });

  it("fetches session data from /sessions/ API", () => {
    expect(html).toContain("fetch('/sessions/'");
  });

  it("fetches summary from /sessions/ summary endpoint", () => {
    expect(html).toContain("/summary");
  });

  it("renders user bubble for user_transcript events", () => {
    expect(html).toContain("user_transcript");
    expect(html).toContain("bubble-row user");
  });

  it("renders assistant bubble for transcript events", () => {
    expect(html).toContain("bubble-row assistant");
  });

  it("renders policy decision rows with decision classes", () => {
    expect(html).toContain("policy-row");
    expect(html).toContain("policy.decision");
  });

  it("renders sentiment badge classes", () => {
    expect(html).toContain("s-positive");
    expect(html).toContain("s-negative");
    expect(html).toContain("s-frustrated");
    expect(html).toContain("s-neutral");
  });

  it("renders session marker for session.start", () => {
    expect(html).toContain("session.start");
    expect(html).toContain("marker-dot");
    expect(html).toContain("Session started");
  });

  it("renders session marker for session.end", () => {
    expect(html).toContain("session.end");
    expect(html).toContain("Session ended");
  });

  it("renders claims check rows", () => {
    expect(html).toContain("claims.check");
    expect(html).toContain("claim-row");
  });

  it("includes policy icons for all decision types", () => {
    expect(html).toContain("allow");
    expect(html).toContain("refuse");
    expect(html).toContain("escalate");
    expect(html).toContain("rewrite");
    expect(html).toContain("cancel_output");
  });

  it("displays relative timestamps", () => {
    expect(html).toContain("fmtRelMs");
    expect(html).toContain("fmtRelLabel");
  });

  it("has a refresh button", () => {
    expect(html).toContain("refresh-btn");
    expect(html).toContain("Refresh");
  });

  it("has a loading spinner", () => {
    expect(html).toContain("spinner");
    expect(html).toContain("Loading transcript");
  });

  it("has an error message element", () => {
    expect(html).toContain("error-msg");
    expect(html).toContain("Could not load transcript");
  });

  it("extracts sessionId from URL pathname", () => {
    expect(html).toContain("location.pathname");
    expect(html).toContain("sessionId");
  });

  it("includes CSS custom properties for design system", () => {
    expect(html).toContain("--bg:#0a0a0f");
    expect(html).toContain("--blue:#3b82f6");
  });

  it("renders sidebar with session stats card", () => {
    expect(html).toContain("card-stats");
    expect(html).toContain("card-policy");
  });

  it("includes sentiment card", () => {
    expect(html).toContain("card-sentiment");
  });
});
