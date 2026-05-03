<p align="center">
  <img width=350px, src="./assets/Autonomy.png"/>
  <h1 align="center">Autonomy</h1>
</p>

**Autonomy** is a VS Code extension that works with Claude Code. It intercepts every message allowing you to visualize the full context window as an interactive bar chart, delete or edit individual message sections, and optionally hold requests for your approval before they reach Anthropic.

---

## How it works

```
Claude Code  →  localhost:8080 (FastAPI proxy)  →  api.anthropic.com
                        ↕ WebSocket
               VS Code Extension (Autonomy panel)
```

The proxy sits between Claude Code and Anthropic. Every request is classified into typed sections (system prompt, tool definitions, conversation turns, tool calls/outputs, images, thinking blocks), token-counted, and streamed to the VS Code webview over WebSocket. You can delete or edit sections before they are forwarded.

---

## Prerequisites


| Requirement | Version               |
| ----------- | --------------------- |
| Node.js     | 18+ (LTS recommended) |
| Python      | 3.12 or 3.13          |
| VS Code     | 1.85+                 |


---

## Run Locally

### 1. Clone the repo

```bash
git clone <repo-url>
cd <repo-directory>
```

### 2. Install backend dependencies

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Copy the example env file (defaults work out of the box):

```bash
cp .env.example .env
```

```
ANTHROPIC_UPSTREAM_URL=https://api.anthropic.com
PROXY_PORT=8080
```

### 3. Install frontend

```bash
cd ../frontend
npm install
npm run build
```

This produces `frontend/dist/` which the extension serves as a webview.

### 4. Install extension deps + build

```bash
cd ../extensions
npm install
npm run compile
```

### 5. Run the extension

Open the extension for development, then start it with the debugger:

1. Open the `extensions/` folder in VS Code:
  ```bash
   code extensions/
  ```
2. Press **F5** (or go to **Run → Start Debugging**).
  This launches an **Extension Development Host** — a second VS Code window with Autonomy loaded.

### 6. Open the Autonomy panel

In the VS Code window that has Autonomy running:

- Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
- Run `**Autonomy: Open Panel`**

The panel opens beside your editor and (by default) the proxy starts automatically on port 8080.

> If the extension can’t auto-detect your workspace layout, set absolute paths in VS Code settings — see [Extension settings](#extension-settings) below.

### 7. Point Claude Code at the proxy

In every terminal where you run Claude Code, set:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
claude
```

Or add it to your shell profile (`~/.zshrc` / `~/.bashrc`) so it's always active:

```bash
echo 'export ANTHROPIC_BASE_URL=http://localhost:8080' >> ~/.zshrc
source ~/.zshrc
```

---

## Install from the Visual Studio Marketplace

Once the extension is published, install it from the **Extensions** view (`Cmd+Shift+X` / `Ctrl+Shift+X`) using the name shown on the [Marketplace](https://marketplace.visualstudio.com/vscode) listing. Then open `**Autonomy: Open Panel`** and point Claude Code at `http://localhost:8080` as in the steps above.

## Extension settings

All settings live under `**autonomy.***` in VS Code settings (`Cmd+,`):


| Setting                   | Default  | Description                                                     |
| ------------------------- | -------- | --------------------------------------------------------------- |
| `autonomy.proxyPort`      | `8080`   | Port the FastAPI proxy listens on                               |
| `autonomy.autoStartProxy` | `true`   | Auto-start the proxy when the panel opens                       |
| `autonomy.backendDir`     | *(auto)* | Absolute path to `backend/` — leave blank to auto-detect        |
| `autonomy.pythonPath`     | *(auto)* | Python interpreter path — defaults to `backend/venv/bin/python` |
| `autonomy.webviewDistDir` | *(auto)* | Path to built React app — defaults to `frontend/dist`           |


---

## Project structure

```
Autonomy/
├── backend/          FastAPI proxy — intercepts, classifies, gates requests
│   ├── main.py       App entry point + WebSocket endpoint
│   ├── interceptor.py  POST /v1/messages handler
│   ├── classifier.py   Section classification
│   └── gating.py       Hold/approve/cancel state machine
├── frontend/         React + Vite webview
│   └── src/
│       ├── App.tsx         Root component
│       ├── components/     BarChart, EditorPanel, StatusBar, …
│       └── hooks/          useWebSocket, useSelection, useUndo
└── extensions/       VS Code extension
    └── src/
        ├── extension.ts        Activation + commands
        ├── proxy-manager.ts    Spawns/kills uvicorn
        ├── webview-provider.ts Serves frontend/dist in a panel
        └── websocket-client.ts Bridges extension ↔ proxy
```

---

## Tech stack

**Backend** — Python 3.12, FastAPI, uvicorn, httpx, tiktoken, websockets, pydantic  
**Frontend** — React 19, TypeScript, Vite, Monaco Editor, Recharts, Motion  
**Extension** — VS Code Extension API, TypeScript, ws