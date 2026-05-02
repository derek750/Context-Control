# Autonomy webview UI (`frontend/src/`)

This folder is the webview client code rendered inside VS Code.

## Key modules

- **`App.tsx`**: main reducer/state machine and UX behaviors (selection, undo, editor open/close, approve flows).
- **`components/`**:
  - `BarChart`: section visualization + interaction affordances
  - `EditorPanel`: Monaco-backed editing of a section
  - `StatusBar`: mode/pause/send/undo and totals
- **`hooks/`**:
  - `useWebSocket`: inbound messages + outbound control messages
  - `useSelection`: selection + mark-for-delete behavior
  - `useUndo`: undo snapshots for deletions/edits
- **`types.ts`**: section + message shapes shared across the app
- **`mock/`**: local harness for UI development without a live backend

## Behavioral constraints

- Treat **top-level** vs **tool-chain continuation** requests differently:
  - continuations should preserve in-flight edits
  - top-level prompts should reset selection/undo/edits
- When not held, committing edits should keep the backend’s canonical state aligned with the UI.

