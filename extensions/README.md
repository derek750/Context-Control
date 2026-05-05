# Context Control

**Context Control** shows you the full **context window** Claude Code is about to send, as an interactive **bar chart** in the editor. Trim useless sections, edit or delete message parts, and optionally **hold** requests for your approval before they go to Anthropic—so you spend fewer tokens and keep context quality under control.

---

## Quick start

1. **Context Control: Open Panel** (Command Palette) — starts the proxy on **127.0.0.1:8080** by default (**Context Control: Auto start proxy**).
2. Set **`ANTHROPIC_BASE_URL`** to **`http://127.0.0.1:8080`** for the environment where **Claude Code** runs (shell profile, terminal env in your IDE, etc.).

---

## Features

- **Visualize** the context window as sections (system, tools, user, assistant, tool I/O, etc.) with token and cost estimates.
- **Select and remove** sections you do not want to send; **edit** text in an editor when you need to rewrite instead of delete.
- **Choose how requests are sent** (e.g. auto vs ask permission) using the mode controls in the panel, depending on your proxy settings.
- **Stream** the same traffic your tools expect: the proxy keeps **SSE streaming** end-to-end for the main message path.

---

## Commands

| Command | What it does |
|--------|----------------|
| **Context Control: Open Panel** | Opens the Context Control view beside your editor. |
| **Context Control: Restart Backend Proxy** | Stops and restarts the local proxy (for example after changing port or Python). |
| **Context Control: Retry Python Setup** | Clears the bootstrap cache and re-runs Python discovery, venv creation, and dependency install. Use this if the initial setup failed or you changed your Python installation. |

---

## Settings

Search for **Context Control** in **Settings** (`Ctrl+,` / `Cmd+,`).

| Setting | What it does |
|--------|----------------|
| **Context Control: Proxy port** | Port the local proxy listens on (default `8080`). |
| **Context Control: Auto start proxy** | Start the proxy when the panel opens (on by default). |
| **Context Control: Python path** | Full path to a Python 3.10+ executable. When set, the extension uses that interpreter **directly** for the proxy — no managed venv is created and you are responsible for having the backend dependencies installed in that environment. Leave empty (the default) to let the extension manage a dedicated virtual environment automatically. |
| **Context Control: Backend directory** | Advanced: folder that contains `main.py`. Usually left empty so the extension uses the bundled backend or a `backend` folder in an open workspace. |
| **Context Control: Webview dist directory** | Advanced: custom path to the built web UI. Usually left empty. |

---

## More Information

Repository [github.com/derek750/Context-Control](https://github.com/derek750/Context-Control)

---

## License

See [LICENSE](https://github.com/derek750/Context-Control/blob/main/LICENSE)
