import { useState, useCallback, useRef, useEffect } from "react";
import { VoiceClient } from "../../../sdk/src/VoiceClient.js";
import type { UseVoiceAgentOptions, UseVoiceAgentReturn } from "./types.js";
import type { ConnectionState, TranscriptEvent, PolicyEvent } from "../../../sdk/src/types.js";

/**
 * useVoiceAgent — React hook that manages a VoiceClient instance.
 *
 * Creates the client once on mount and tears it down on unmount.
 * Callbacks in `options` are always read from the latest ref so they
 * never go stale without triggering a reconnect.
 *
 * @example
 * ```ts
 * const { state, connect, disconnect, transcript } = useVoiceAgent({
 *   wsUrl: "wss://api.example.com/voice",
 *   tenantId: "org_acme",
 *   onTranscript: (t) => console.log(t.text),
 * });
 * ```
 */
export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [lastPolicyEvent, setLastPolicyEvent] = useState<PolicyEvent | null>(null);

  const clientRef = useRef<VoiceClient | null>(null);

  // Keep latest options in a ref so callbacks always have up-to-date closures
  // without forcing the client to be recreated.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Create client once on mount, tear down on unmount.
  useEffect(() => {
    const client = new VoiceClient(
      { url: options.wsUrl, autoReconnect: false },
      {
        onReady: (sid) => {
          setSessionId(sid);
          setState("ready");
          optionsRef.current.onStateChange?.("ready");
        },
        onTranscript: (event) => {
          setTranscript((prev) => [...prev, event]);
          optionsRef.current.onTranscript?.(event);
        },
        onPolicyEvent: (event) => {
          setLastPolicyEvent(event);
          optionsRef.current.onPolicyEvent?.(event);
        },
        onError: (error) => {
          setState("error");
          optionsRef.current.onStateChange?.("error");
          optionsRef.current.onError?.(error);
        },
        onClose: () => {
          setSessionId(null);
          setState("disconnected");
          optionsRef.current.onStateChange?.("disconnected");
        },
      },
    );

    clientRef.current = client;

    if (options.autoConnect) {
      void client.connect({
        tenantId: options.tenantId,
        userAgent: options.persona,
      });
    }

    return () => {
      client.endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — client is created once

  const connect = useCallback(async () => {
    if (!clientRef.current) return;
    setState("connecting");
    optionsRef.current.onStateChange?.("connecting");
    await clientRef.current.connect({
      tenantId: optionsRef.current.tenantId,
      userAgent: optionsRef.current.persona,
    });
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.endSession();
  }, []);

  const sendAudio = useCallback((base64Data: string) => {
    clientRef.current?.sendAudio(base64Data);
  }, []);

  const stopAudio = useCallback(() => {
    clientRef.current?.stopAudio();
  }, []);

  return {
    state,
    sessionId,
    connect,
    disconnect,
    sendAudio,
    stopAudio,
    transcript,
    lastPolicyEvent,
    isConnected: state === "ready",
  };
}
