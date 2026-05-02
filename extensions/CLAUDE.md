# Autonomy VS Code extension (`extensions/`)

VS Code extension that:

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
  - `autonomy.open`
  - `autonomy.restartProxy`
- **Proxy lifecycle**: `src/proxy-manager.ts`
- **Webview panel**: `src/webview-provider.ts`
- **WS bridge**: `src/websocket-client.ts`

## Settings assumptions

The extension reads `autonomy.*` settings (proxy port, auto-start, dev overrides for backend/webview paths).

## Invariants to preserve

- If the panel is disposed, the bridge must detach from the webview to avoid silent message drops on reopen.
- Port/config changes must be reflected consistently across proxy start and WS bridge connection.

