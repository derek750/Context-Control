# Autonomy (repo)

This repo contains **three coupled parts**:

- **`backend/`**: FastAPI proxy on `localhost:8080` that intercepts `POST /v1/messages`, classifies/token-counts sections, optionally holds requests for approval, forwards to Anthropic, and streams SSE back to the caller. It also publishes request snapshots over WebSocket.
- **`frontend/`**: React + Vite webview UI. `frontend/dist/` is what the extension serves.
- **`extensions/`**: VS Code extension that launches the backend, hosts the webview, and bridges WebSocket messages to the panel. On **Open Panel** with auto-start (default), it runs **Python bootstrap** first (unless `autonomy.pythonPath` is set): discover Python ≥ 3.10, create a managed venv under extension global storage, `pip install -r` the resolved backend’s `requirements.txt`, then spawn uvicorn with that interpreter.

## Quick start (local dev)

- **Backend**:
  - `cd backend && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8080 --reload`
- **Frontend (hot reload, mock mode)**:
  - `cd frontend && npm run dev` then open `http://localhost:5173?mock=1`
- **Frontend (for extension webview)**:
  - `cd frontend && npm run build` (produces `dist/`)
- **Extension**:
  - `cd extensions && npm run watch`
  - Open `extensions/` in VS Code and press **F5** (Extension Development Host)

## Key invariants (don’t break these)

- **SSE streaming must remain streaming** end-to-end for `/v1/messages`.
- **WebSocket snapshot on connect** is required so reopening the panel can still approve a held request.
- **Auxiliary Claude Code calls** should not overwrite the main “chart” UI (frontend filters these).

