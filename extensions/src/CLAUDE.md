# Extension internals (`extensions/src/`)

## Files and responsibilities

- **`extension.ts`**: registers commands, wires configuration, creates the panel, connects the WS bridge. Before `ProxyManager.start`, calls `ensureReady` from **`python-bootstrap.ts`** (unless bootstrap fails — then no proxy start). **`contextControl.retryPythonSetup`** calls `ensureReady(..., force=true)`.
- **`python-bootstrap.ts`**: `ensureReady` — if `contextControl.pythonPath` is set, validate path + min version (3.10) and return it; else discover base Python, create/reuse venv under `context.globalStorageUri/context-control-venv/<hash>`, run `pip install -r <backendDir>/requirements.txt`, cache by requirements SHA-256 in `globalState`.
- **`backend-path.ts`**: `resolveBackendDir` — same resolution rules as the proxy (must stay in sync with `proxy-manager` usage).
- **`proxy-manager.ts`**: spawns/stops `uvicorn` with optional explicit Python from bootstrap (`start(port, python?)`); if omitted, legacy venv-next-to-backend / PATH fallback for dev.
- **`webview-provider.ts`**: constructs the webview HTML, serves the built frontend (`dist/`) and assets, handles CSP/nonces.
- **`websocket-client.ts`**: connects to backend `/ws`, relays messages to the webview, relays UI control messages back to the backend.

## Common pitfalls

- Webview messaging is lossy if you post into a disposed panel; always detach on dispose and reattach on reopen.
- Keep the backend port consistent between proxy spawn and WS connection.
- Bootstrap is **lazy**: it runs when opening the panel (with auto-start), restarting the proxy, or **Retry Python Setup** — not on bare `activate`.
