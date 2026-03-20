/**
 * VoiceAgent component tests.
 *
 * useVoiceAgent is mocked so these tests focus purely on whether
 * VoiceAgent correctly wires the hook and renders the expected markup —
 * not on the hook's internal behaviour (covered in useVoiceAgent.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { VoiceAgent } from "../VoiceAgent.js";

// ---------------------------------------------------------------------------
// Mock useVoiceAgent
// ---------------------------------------------------------------------------

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();

// Default return value — tests override via mockReturnValue as needed.
const defaultHookReturn = {
  state: "disconnected" as const,
  sessionId: null as string | null,
  connect: mockConnect,
  disconnect: mockDisconnect,
  sendAudio: vi.fn(),
  stopAudio: vi.fn(),
  transcript: [],
  lastPolicyEvent: null,
  isConnected: false,
};

let hookReturn = { ...defaultHookReturn };

vi.mock("../useVoiceAgent.js", () => ({
  useVoiceAgent: vi.fn(() => hookReturn),
}));

// We need the mocked module reference to inspect call args.
import { useVoiceAgent } from "../useVoiceAgent.js";
const mockedUseVoiceAgent = vi.mocked(useVoiceAgent);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  hookReturn = { ...defaultHookReturn };
  mockConnect.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function defaultProps() {
  return { wsUrl: "wss://localhost:3000" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VoiceAgent", () => {
  // --- Default render ---

  describe("default render", () => {
    it('renders root div with data-voice-agent-state="disconnected" initially', () => {
      const { container } = render(<VoiceAgent {...defaultProps()} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.dataset.voiceAgentState).toBe("disconnected");
    });

    it('shows "disconnected" status text when disconnected', () => {
      render(<VoiceAgent {...defaultProps()} />);
      expect(screen.getByTestId("voice-agent-status").textContent).toBe("disconnected");
    });

    it('shows "Connect" button when disconnected', () => {
      render(<VoiceAgent {...defaultProps()} />);
      expect(screen.getByTestId("voice-agent-connect")).toBeTruthy();
    });

    it('shows "Disconnect" button when isConnected=true', () => {
      hookReturn = { ...defaultHookReturn, state: "ready", isConnected: true, sessionId: "s1" };
      render(<VoiceAgent {...defaultProps()} />);
      expect(screen.getByTestId("voice-agent-disconnect")).toBeTruthy();
    });

    it('does NOT show "Connect" button when isConnected=true', () => {
      hookReturn = { ...defaultHookReturn, state: "ready", isConnected: true, sessionId: "s1" };
      render(<VoiceAgent {...defaultProps()} />);
      expect(screen.queryByTestId("voice-agent-connect")).toBeNull();
    });

    it('does NOT show "Disconnect" button when disconnected', () => {
      render(<VoiceAgent {...defaultProps()} />);
      expect(screen.queryByTestId("voice-agent-disconnect")).toBeNull();
    });
  });

  // --- Button interactions ---

  describe("button interactions", () => {
    it("clicking Connect calls connect()", () => {
      render(<VoiceAgent {...defaultProps()} />);
      fireEvent.click(screen.getByTestId("voice-agent-connect"));
      expect(mockConnect).toHaveBeenCalledOnce();
    });

    it("clicking Disconnect calls disconnect()", () => {
      hookReturn = { ...defaultHookReturn, state: "ready", isConnected: true, sessionId: "s1" };
      render(<VoiceAgent {...defaultProps()} />);
      fireEvent.click(screen.getByTestId("voice-agent-disconnect"));
      expect(mockDisconnect).toHaveBeenCalledOnce();
    });
  });

  // --- className prop ---

  describe("className prop", () => {
    it("applies className to root div", () => {
      const { container } = render(
        <VoiceAgent {...defaultProps()} className="my-voice-widget" />,
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toBe("my-voice-widget");
    });
  });

  // --- children prop ---

  describe("children prop", () => {
    it("renders children instead of default UI when provided", () => {
      render(
        <VoiceAgent {...defaultProps()}>
          <span data-testid="custom-child">Custom UI</span>
        </VoiceAgent>,
      );
      expect(screen.getByTestId("custom-child").textContent).toBe("Custom UI");
    });

    it("does NOT render default buttons when children are provided", () => {
      render(
        <VoiceAgent {...defaultProps()}>
          <span>Custom</span>
        </VoiceAgent>,
      );
      expect(screen.queryByTestId("voice-agent-connect")).toBeNull();
      expect(screen.queryByTestId("voice-agent-disconnect")).toBeNull();
    });
  });

  // --- data-session-id attribute ---

  describe("data-session-id attribute", () => {
    it('data-session-id is empty string when sessionId is null', () => {
      const { container } = render(<VoiceAgent {...defaultProps()} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.dataset.sessionId).toBe("");
    });

    it("data-session-id reflects sessionId when connected", () => {
      hookReturn = {
        ...defaultHookReturn,
        state: "ready",
        isConnected: true,
        sessionId: "sess-99",
      };
      const { container } = render(<VoiceAgent {...defaultProps()} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.dataset.sessionId).toBe("sess-99");
    });
  });

  // --- Prop forwarding to hook ---

  describe("prop forwarding to hook", () => {
    it("forwards wsUrl to useVoiceAgent", () => {
      render(<VoiceAgent wsUrl="wss://custom.example.com/voice" />);
      expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ wsUrl: "wss://custom.example.com/voice" }),
      );
    });

    it("forwards tenantId to useVoiceAgent", () => {
      render(<VoiceAgent {...defaultProps()} tenantId="org_acme" />);
      expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "org_acme" }),
      );
    });

    it("forwards persona to useVoiceAgent", () => {
      render(<VoiceAgent {...defaultProps()} persona="Professional Support" />);
      expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ persona: "Professional Support" }),
      );
    });

    it("forwards onTranscript prop to useVoiceAgent", () => {
      const onTranscript = vi.fn();
      render(<VoiceAgent {...defaultProps()} onTranscript={onTranscript} />);
      expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ onTranscript }),
      );
    });

    it("forwards onPolicyEvent prop to useVoiceAgent", () => {
      const onPolicyEvent = vi.fn();
      render(<VoiceAgent {...defaultProps()} onPolicyEvent={onPolicyEvent} />);
      expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ onPolicyEvent }),
      );
    });

    it("forwards onStateChange prop to useVoiceAgent", () => {
      const onStateChange = vi.fn();
      render(<VoiceAgent {...defaultProps()} onStateChange={onStateChange} />);
      expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ onStateChange }),
      );
    });

    it("forwards onError prop to useVoiceAgent", () => {
      const onError = vi.fn();
      render(<VoiceAgent {...defaultProps()} onError={onError} />);
      expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ onError }),
      );
    });

    it("defaults autoConnect to false when not provided", () => {
      render(<VoiceAgent {...defaultProps()} />);
      expect(mockedUseVoiceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ autoConnect: false }),
      );
    });
  });
});
