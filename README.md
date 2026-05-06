<p align="center">
  <img width=120px, src="./assets/Logo.png"/>
</p>

<h1 align="center">Context Control</h1>

<p align="center">
  <strong>Power over your prompt</strong>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT">
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  </a>
</p>

---

**[Context Control](https://marketplace.visualstudio.com/items?itemName=derek750.context-control)** is a VS Code extension that works with Claude Code. It intercepts every message allowing you to visualize the full context window of a conversation as an interactive bar chart, delete or edit individual message sections, and optionally hold requests for your approval before they reach Anthropic.

In Claude Code, each prompt includes previous messages and replies, forming the context window. As sessions grow, this window can become bloated with redundant or low-value context, increasing token usage and affecting response quality. Context Control intercepts the context before it is sent, letting developers trim, rewrite, or remove unnecessary context—reducing token waste, preventing bad context from compounding, and improving model performance.

## Demo

[Demo video](https://youtu.be/2YekO5pI1ZI)

## How it works

```
Claude Code  →  localhost:8080 (FastAPI proxy)  →  api.anthropic.com
                        ↕ WebSocket
               VS Code Extension (Context Control panel)
```

The proxy sits between Claude Code and Anthropic. Every request is classified into typed sections (system prompt, tool definitions, conversation turns, tool calls/outputs, images, thinking blocks), token-counted, and streamed to the VS Code webview over WebSocket. You can delete or edit sections before they are forwarded.

---

## Install

**[Get Context Control from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=derek750.context-control)**

Or install from the command line:

```bash
code --install-extension derek750.context-control
```

---

## Prerequisites


| Requirement | Version               |
| ----------- | --------------------- |
| Node.js     | 18+ (LTS recommended) |
| Python      | 3.12 or 3.13          |
| VS Code     | 1.85+                 |


---

## Run locally

### 1. Clone the repo and install Node dependencies

```bash
git clone <repo-url>
cd <repo-directory>
cd frontend && npm install
cd ../extensions && npm install
```

### 2. Build and package

```bash
cd extensions
npx @vscode/vsce package
```

This writes `context-control-*.vsix` in `extensions/`.

### 3. Install the extension

```bash
code --install-extension ./context-control-*.vsix
```

### 4. Open the Context Control panel

Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) → **Context Control: Open Panel**. The proxy listens on port **8080** by default. On first open the extension discovers Python, creates a managed environment, and installs packages from PyPI (see **View → Output → Context Control**).

### 5. Point Claude Code at the proxy

In every terminal where you run Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8080
claude
```

Optional — persist in your shell profile:

```bash
echo 'export ANTHROPIC_BASE_URL=http://127.0.0.1:8080' >> ~/.zshrc
source ~/.zshrc
```

Ports and advanced overrides are under [Extension settings](#extension-settings).

---

## Extension settings

All settings live under `**contextControl.***` in VS Code settings (`Cmd+,`):


| Setting                        | Default  | Description                                                     |
| ------------------------------ | -------- | --------------------------------------------------------------- |
| `contextControl.proxyPort`      | `8080`   | Port the FastAPI proxy listens on                               |
| `contextControl.autoStartProxy` | `true`   | Auto-start the proxy when the panel opens                       |
| `contextControl.backendDir`     | *(auto)* | Absolute path to `backend/` — leave blank to auto-detect        |
| `contextControl.pythonPath`     | *(auto)* | Python interpreter path — defaults to `backend/venv/bin/python` |
| `contextControl.webviewDistDir` | *(auto)* | Path to built React app — defaults to `frontend/dist`           |


---

## Project structure

```
Context Control/
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
