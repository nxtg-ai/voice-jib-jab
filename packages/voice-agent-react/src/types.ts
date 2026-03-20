import type React from "react";

export type {
  ConnectionState,
  PolicyDecision,
  PolicyEvent,
  TranscriptEvent,
  SessionConfig,
} from "../../../sdk/src/types.js";

import type { ConnectionState, TranscriptEvent, PolicyEvent } from "../../../sdk/src/types.js";

export interface VoiceAgentProps {
  wsUrl: string;
  tenantId?: string;
  /** Persona name/id hint (passed as userAgent metadata). */
  persona?: string;
  /** If true, connect immediately on mount. Defaults to false. */
  autoConnect?: boolean;
  onTranscript?: (event: TranscriptEvent) => void;
  onPolicyEvent?: (event: PolicyEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
  onError?: (error: Error) => void;
  /** CSS class for the root element. */
  className?: string;
  /** Render prop area — replaces the default Connect/Disconnect UI. */
  children?: React.ReactNode;
}

export interface UseVoiceAgentOptions {
  wsUrl: string;
  tenantId?: string;
  persona?: string;
  autoConnect?: boolean;
  onTranscript?: (event: TranscriptEvent) => void;
  onPolicyEvent?: (event: PolicyEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
  onError?: (error: Error) => void;
}

export interface UseVoiceAgentReturn {
  state: ConnectionState;
  sessionId: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendAudio: (base64Data: string) => void;
  stopAudio: () => void;
  transcript: TranscriptEvent[];
  lastPolicyEvent: PolicyEvent | null;
  isConnected: boolean;
}
