import type { OutboundMessage } from "./types";

interface VsCodeApi {
  postMessage(msg: OutboundMessage): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

const STUB_STATE_KEY = "contextControl.vscodeStub.state";

function createStubApi(): VsCodeApi {
  return {
    postMessage(msg) {
      // Outside the webview (e.g. plain `vite dev`), surface outbound traffic
      // so the developer can verify shapes.
      console.log("[vscode-stub] postMessage", msg);
    },
    getState<T>() {
      try {
        const raw = sessionStorage.getItem(STUB_STATE_KEY);
        return raw ? (JSON.parse(raw) as T) : undefined;
      } catch {
        return undefined;
      }
    },
    setState<T>(state: T) {
      try {
        sessionStorage.setItem(STUB_STATE_KEY, JSON.stringify(state));
      } catch {
        // sessionStorage may be unavailable; the stub is best-effort.
      }
    },
  };
}

let cached: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (cached) return cached;
  if (typeof window !== "undefined" && typeof window.acquireVsCodeApi === "function") {
    cached = window.acquireVsCodeApi();
  } else {
    cached = createStubApi();
  }
  return cached;
}
