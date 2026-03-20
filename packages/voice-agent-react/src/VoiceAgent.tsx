import React from "react";
import { useVoiceAgent } from "./useVoiceAgent.js";
import type { VoiceAgentProps } from "./types.js";

/**
 * VoiceAgent — embeds a voice-jib-jab agent in any React app.
 *
 * Renders a minimal Connect/Disconnect UI by default. Pass `children`
 * to render fully custom controls while still receiving hook state via
 * the `onStateChange`, `onTranscript`, and `onPolicyEvent` props.
 *
 * @example
 * ```tsx
 * <VoiceAgent
 *   wsUrl="wss://api.example.com/voice"
 *   tenantId="org_acme"
 *   persona="Professional Support"
 *   onTranscript={(t) => console.log(t.text)}
 *   onPolicyEvent={(e) => console.log(e.decision)}
 * />
 * ```
 */
export function VoiceAgent({
  wsUrl,
  tenantId,
  persona,
  autoConnect = false,
  onTranscript,
  onPolicyEvent,
  onStateChange,
  onError,
  className,
  children,
}: VoiceAgentProps): React.ReactElement {
  const { state, sessionId, connect, disconnect, isConnected } = useVoiceAgent({
    wsUrl,
    tenantId,
    persona,
    autoConnect,
    onTranscript,
    onPolicyEvent,
    onStateChange,
    onError,
  });

  return (
    <div
      className={className}
      data-voice-agent-state={state}
      data-session-id={sessionId ?? ""}
    >
      {children ?? (
        <div>
          <span data-testid="voice-agent-status">{state}</span>
          {!isConnected ? (
            <button onClick={() => void connect()} data-testid="voice-agent-connect">
              Connect
            </button>
          ) : (
            <button onClick={disconnect} data-testid="voice-agent-disconnect">
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}
