# Extension internals (`extensions/src/`)

## Files and responsibilities

- **`extension.ts`**: registers commands, wires configuration, creates the panel, and connects the WS bridge.
- **`proxy-manager.ts`**: spawns/stops `uvicorn` (or the bundled backend) and reports logs to the `Autonomy` output channel.
- **`webview-provider.ts`**: constructs the webview HTML, serves the built frontend (`dist/`) and assets, handles CSP/nonces.
- **`websocket-client.ts`**: connects to backend `/ws`, relays messages to the webview, relays UI control messages back to the backend.

## Common pitfalls

- Webview messaging is lossy if you post into a disposed panel; always detach on dispose and reattach on reopen.
- Keep the backend port consistent between proxy spawn and WS connection.

