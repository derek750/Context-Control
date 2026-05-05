import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Resolve the backend directory (the folder containing `main.py`).
 *
 * Priority:
 *  1. `contextControl.backendDir` setting — if it exists and contains `main.py`.
 *  2. `<workspace>/backend` — if present and contains `main.py`.
 *  3. `<extensionPath>/backend` — the copy bundled into the VSIX.
 *
 * Throws if none of the candidates contain `main.py`.
 */
export function resolveBackendDir(
  cfg: vscode.WorkspaceConfiguration,
  extensionPath: string,
): string {
  const configured = cfg.get<string>("backendDir")?.trim() ?? "";
  if (configured && fs.existsSync(path.join(configured, "main.py"))) {
    return configured;
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspace) {
    const inRepo = path.join(workspace, "backend");
    if (fs.existsSync(path.join(inRepo, "main.py"))) {
      return inRepo;
    }
  }

  const bundled = path.join(extensionPath, "backend");
  if (fs.existsSync(path.join(bundled, "main.py"))) {
    return bundled;
  }

  throw new Error(
    "Context Control: could not find the FastAPI backend (main.py). " +
      "Open this repository as a workspace, set `contextControl.backendDir`, " +
      "or install an extension build that bundles `backend/`. " +
      "If using the bundled backend, run `pip install -r requirements.txt` in that folder (see Output).",
  );
}
