# Autonomy

**Autonomy** shows you the full **context window** Claude Code is about to send, as an interactive **bar chart** in the editor. Trim useless sections, edit or delete message parts, and optionally **hold** requests for your approval before they go to Anthropic—so you spend fewer tokens and keep context quality under control.

---

## Getting started

1. **Install** this extension from the Marketplace.
2. **Python 3.12+** must be available on your system. The extension ships the proxy **source** and a `requirements.txt`, but you need to **install those dependencies** into an environment you control (for example: create a venv, then `pip install -r` on that file in the extension’s `backend` folder, or use a global install). Set **Autonomy: Python path** to the `python` you used if it is not picked up automatically.
3. In any terminal where you run **Claude Code**, point it at the local proxy (default port **8080**):

   ```bash
   export ANTHROPIC_BASE_URL=http://127.0.0.1:8080
   ```

   On Windows (cmd): `set ANTHROPIC_BASE_URL=http://127.0.0.1:8080`

4. Open the **Autonomy** panel: **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Autonomy: Open Panel**. The proxy usually starts by itself; if something fails, check **View → Output** and select **Autonomy** in the dropdown.

---

## What you can do

- **Visualize** each request as sections (system, tools, user, assistant, tool I/O, etc.) with token and cost estimates.
- **Select and remove** sections you do not want to send; **edit** text in an editor when you need to rewrite instead of delete.
- **Choose how requests are sent** (e.g. auto vs ask permission) using the mode controls in the panel, depending on your proxy settings.
- **Stream** the same traffic your tools expect: the proxy keeps **SSE streaming** end-to-end for the main message path.

---

## Commands

| Command | What it does |
|--------|----------------|
| **Autonomy: Open Panel** | Opens the Autonomy view beside your editor. |
| **Autonomy: Restart Backend Proxy** | Stops and restarts the local proxy (for example after changing port or Python). |

---

## Settings

Search for **Autonomy** in **Settings** (`Ctrl+,` / `Cmd+,`).

| Setting | What it does |
|--------|----------------|
| **Autonomy: Proxy port** | Port the local proxy listens on (default `8080`). |
| **Autonomy: Auto start proxy** | Start the proxy when the panel opens (on by default). |
| **Autonomy: Python path** | Full path to the Python executable that runs the proxy. Leave empty to use a `venv` next to the backend, if present, or `python3` / `python` on your `PATH`. |
| **Autonomy: Backend directory** | Advanced: folder that contains `main.py`. Usually left empty so the extension uses the bundled backend or a `backend` folder in an open workspace. |
| **Autonomy: Webview dist directory** | Advanced: custom path to the built web UI. Usually left empty. |

---

## Troubleshooting

- **Panel is blank or says the webview is missing** — Use a current build of the extension from the Marketplace, or the full [Autonomy](https://github.com/derek750/Autonomy) repo with the frontend built; see the repository README.
- **Proxy will not start** — Open **Output → Autonomy**. Typical causes: Python or packages missing (install from `requirements.txt` for the backend you use), or the port already in use (change **Autonomy: Proxy port**).
- **Claude Code does not use the proxy** — Ensure `ANTHROPIC_BASE_URL` is set in the **same** environment where you launch `claude`.

---

## More information

- **Repository & local development:** [github.com/derek750/Autonomy](https://github.com/derek750/Autonomy)

---

## License

MIT
