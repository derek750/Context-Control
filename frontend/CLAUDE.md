# Autonomy frontend (`frontend/`)

React + TypeScript + Vite app used as the **VS Code webview UI**.

Two modes of use:

- **Extension webview**: build to `frontend/dist/` and let the extension serve it (or the extension’s bundled `dist` from `npm run bundle-all`). Python/bootstrap is handled in the extension, not here.
- **Standalone dev**: run Vite dev server, typically with the mock harness; run the backend yourself for a live API.

## Commands

```bash
cd frontend
npm install
npm run dev     # Vite dev server (use ?mock=1 for mock harness)
npm run build   # produces dist/ (used by the extension)
```

## Entry points

- **App**: `src/App.tsx` (state machine + keyboard shortcuts + wiring)
- **Boot**: `src/main.tsx`
- **Types**: `src/types.ts`
- **VS Code bridge**: `src/vscode-api.ts`
- **Mock harness**: `src/mock/harness.ts` (activated via `?mock=1`)

## Data flow (high level)

- The extension connects the webview to the backend via its own bridge and posts messages to the webview.
- `useWebSocket` manages message handling and sends control messages (approve, mode change, commit edits).
- App state tracks:
  - current request + optional pending queue
  - removed section indices
  - edited section content

## Invariants to preserve

- **Filter out auxiliary requests** (tiny non-tool requests) so they don’t overwrite the main chart.
- **Tool call/output pairing**: deletion logic must avoid leaving “orphaned” tool outputs.
- **Non-held edits** should commit immediately when appropriate (to keep canonical state consistent).

