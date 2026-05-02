import { useEffect, useMemo, useRef } from "react";
import { getVsCodeApi } from "../vscode-api";
import type {
  EditedSection,
  InboundMessage,
  Mode,
  NewRequest,
  Snapshot,
  TimeoutWarning,
} from "../types";

interface Handlers {
  onNewRequest: (msg: NewRequest) => void;
  onSnapshot?: (msg: Snapshot) => void;
  onTimeoutWarning?: (msg: TimeoutWarning) => void;
}

export function useWebSocket(handlers: Handlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as InboundMessage | undefined;
      if (!data || typeof data !== "object" || !("type" in data)) return;
      switch (data.type) {
        case "new_request":
          handlersRef.current.onNewRequest(data);
          break;
        case "snapshot":
          handlersRef.current.onSnapshot?.(data);
          break;
        case "timeout_warning":
          handlersRef.current.onTimeoutWarning?.(data);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return useMemo(() => {
    const api = getVsCodeApi();
    return {
      sendApprove(requestId: string) {
        api.postMessage({ type: "approve", requestId });
      },
      sendApproveModified(
        requestId: string,
        removedIndices: number[],
        editedSections: EditedSection[],
      ) {
        api.postMessage({
          type: "approve_modified",
          requestId,
          removedIndices,
          editedSections,
        });
      },
      sendModeChange(mode: Mode) {
        api.postMessage({ type: "mode_change", mode });
      },
      sendPauseToggle(paused: boolean) {
        api.postMessage({ type: "pause_toggle", paused });
      },
      sendCommitEditsNow(
        requestId: string,
        removedIndices: number[],
        editedSections: EditedSection[],
      ) {
        api.postMessage({
          type: "commit_edits_now",
          requestId,
          removedIndices,
          editedSections,
        });
      },
    };
  }, []);
}

export type WebSocketSenders = ReturnType<typeof useWebSocket>;
