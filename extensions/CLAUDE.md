# Autonomy VS Code extension (`extensions/`)

VS Code extension that:

- Runs **Python bootstrap** before starting the proxy when no `autonomy.pythonPath` override is set (managed venv + `pip install -r` from the resolved backend folder).
- Starts/stops the backend proxy (optionally, via settings).
- Hosts the webview panel (serves `frontend/dist/` or bundled assets).
- Bridges backend WebSocket events into the webview.

## Commands (dev)

```bash
cd extensions
npm install
npm run compile   # one-shot build
npm run watch     # incremental rebuild
```

Then open the `extensions/` folder in VS Code and press **F5** to launch an Extension Development Host.

## Entry points

- **Activation**: `src/extension.ts`
  - `autonomy.open` (runs bootstrap when auto-starting the proxy)
  - `autonomy.restartProxy`
  - `autonomy.retryPythonSetup` (force re-bootstrap: cache bypass + full pip)
- **Python bootstrap**: `src/python-bootstrap.ts` — discovery, version gate, venv under `globalStorageUri`, pip install, `globalState` cache keyed by `requirements.txt` hash
- **Backend path**: `src/backend-path.ts` — shared `resolveBackendDir` (setting → workspace `backend/` → bundled `extensionPath/backend`)
- **Proxy lifecycle**: `src/proxy-manager.ts` — `start(port, python?)` uses bootstrap’s interpreter when passed
- **Webview panel**: `src/webview-provider.ts`
- **WS bridge**: `src/websocket-client.ts`

## Settings assumptions

The extension reads `autonomy.*` settings (proxy port, auto-start, optional `pythonPath` override, dev overrides for backend/webview paths). If `pythonPath` is set, bootstrap only validates that interpreter and **does not** create the managed venv (user supplies deps).

## Design reference

- [`docs/PYTHON_BOOTSTRAP.md`](docs/PYTHON_BOOTSTRAP.md)

## Invariants to preserve

- If the panel is disposed, the bridge must detach from the webview to avoid silent message drops on reopen.
- Port/config changes must be reflected consistently across proxy start and WS bridge connection.

