# Autonomy

**Autonomy** shows you the full **context window** Claude Code is about to send, as an interactive **bar chart** in the editor. Trim useless sections, edit or delete message parts, and optionally **hold** requests for your approval before they go to Anthropic—so you spend fewer tokens and keep context quality under control.

---

## Getting started

1. **Install** this extension from the Marketplace.
2. **Python 3.10+** must be available on your system. When you open the Autonomy panel for the first time the extension will automatically locate Python, create a dedicated virtual environment (in VS Code's extension storage folder), and install the required packages from `requirements.txt`. This one-time setup takes around 30 seconds and requires a network connection to PyPI. You can watch the progress in **View → Output → Autonomy**.
3. In any terminal where you run **Claude Code**, point it at the local proxy (default port **8080**):

   ```bash
   export ANTHROPIC_BASE_URL=http://127.0.0.1:8080
   ```

   On Windows (cmd): `set ANTHROPIC_BASE_URL=http://127.0.0.1:8080`

4. Open the **Autonomy** panel: **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Autonomy: Open Panel**. The proxy starts automatically; if something goes wrong, a notification will guide you and you can check the full log in **View → Output → Autonomy**.

---

## Features

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
| **Autonomy: Retry Python Setup** | Clears the bootstrap cache and re-runs Python discovery, venv creation, and dependency install. Use this if the initial setup failed or you changed your Python installation. |

---

## Settings

Search for **Autonomy** in **Settings** (`Ctrl+,` / `Cmd+,`).

| Setting | What it does |
|--------|----------------|
| **Autonomy: Proxy port** | Port the local proxy listens on (default `8080`). |
| **Autonomy: Auto start proxy** | Start the proxy when the panel opens (on by default). |
| **Autonomy: Python path** | Full path to a Python 3.10+ executable. When set, the extension uses that interpreter **directly** for the proxy — no managed venv is created and you are responsible for having the backend dependencies installed in that environment. Leave empty (the default) to let the extension manage a dedicated virtual environment automatically. |
| **Autonomy: Backend directory** | Advanced: folder that contains `main.py`. Usually left empty so the extension uses the bundled backend or a `backend` folder in an open workspace. |
| **Autonomy: Webview dist directory** | Advanced: custom path to the built web UI. Usually left empty. |

---

## Troubleshooting

- **Python setup fails on first run** — Open **Output → Autonomy** for the full log. Common causes: Python not on `PATH` (set **Autonomy: Python path** to the full path of your interpreter), version too old (3.10+ required, 3.12 recommended), or a network issue blocking PyPI. Run **Autonomy: Retry Python Setup** after fixing the underlying issue.
- **Panel is blank or says the webview is missing** — Use a current build of the extension from the Marketplace, or the full [Autonomy](https://github.com/derek750/Autonomy) repo with the frontend built; see the repository README.
- **Proxy will not start** — Open **Output → Autonomy**. If Python setup succeeded but uvicorn fails, the port may already be in use (change **Autonomy: Proxy port**) or the backend directory could not be found (set **Autonomy: Backend directory**).
- **Claude Code does not use the proxy** — Ensure `ANTHROPIC_BASE_URL` is set in the **same** environment where you launch `claude`.
- **Using an existing environment** — Set **Autonomy: Python path** to the Python inside a venv you manage (e.g. `~/myenv/bin/python3`). The extension will skip venv creation and trust that all packages are already installed.

---

## More information

- **Repository & local development:** [github.com/derek750/Autonomy](https://github.com/derek750/Autonomy)

---

## License

MIT
