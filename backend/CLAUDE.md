# Context Control backend (`backend/`)

FastAPI proxy that sits between Claude Code and Anthropic:

- Accepts Claude Code traffic (notably `POST /v1/messages`).
- Builds a **sectioned, token-counted** view of the request for the UI.
- Optionally **holds** requests until approved.
- Forwards upstream and **streams SSE** back to the caller.
- Publishes request snapshots + events over **WebSocket** (`/ws`).

## Entry points

- **App**: `main.py` (`app = FastAPI(lifespan=...)`)
- **WebSocket**: `@app.websocket("/ws")` → `ws_manager.receive_loop(...)`
- **Intercepted route**: `@app.post("/v1/messages")` → `interceptor.handle(request)`
- **Catch-all passthrough**: `forwarder.passthrough(...)` for other paths

## Run

```bash
cd backend
source venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8080 --reload
```

The VS Code extension resolves this folder (or a bundled copy under `extensions/backend`) and uses `requirements.txt` for its **managed** Python environment when the user has not set `contextControl.pythonPath`.

## Configuration

- `.env.example` provides defaults.
- Common vars:
  - `ANTHROPIC_UPSTREAM_URL` (default `https://api.anthropic.com`)
  - `LOG_LEVEL` (default `INFO`)

## “Don’t break” invariants

- **Streaming**: `/v1/messages` must remain a streaming SSE response (no buffering).
- **Approval correctness**: held request resolution must be idempotent and keyed by `requestId`.
- **Panel reopen**: snapshot-on-connect must include enough state to surface pending approvals.
- **Canonical edits**: when committing deletions/edits immediately (non-held), ordering and tool-call/tool-output pairing must remain valid.

## Where to look when changing behavior

- **Gating / modes**: `gating.py`
- **Held requests / history**: `interceptor.py`
- **Forwarding + SSE plumbing**: `forwarder.py`
- **Canonical conversation edits**: `conversation_state.py`

