import * as vscode from "vscode";
import { execFile } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Minimum Python version required to run the Autonomy backend.
const MIN_VERSION: [number, number] = [3, 10];

// globalState keys
const KEY_VENV_ROOT = "autonomy.venvRoot";
const KEY_BASE_PYTHON = "autonomy.basePython";
const KEY_REQ_HASH = "autonomy.requirementsHash";

export type EnsureError =
  | "PYTHON_NOT_FOUND"
  | "PYTHON_VERSION_TOO_OLD"
  | "VENV_CREATE_FAILED"
  | "PIP_FAILED"
  | "REQUIREMENTS_MISSING";

export type EnsureResult =
  | { ok: true; pythonExec: string; venvRoot: string | null }
  | { ok: false; reason: EnsureError; detail?: string };

/**
 * Ensure a Python environment with the backend dependencies installed is ready.
 *
 * When `autonomy.pythonPath` is set the user owns their interpreter — we only
 * validate existence + version and return that path directly (no managed venv).
 *
 * When it is empty we run full discovery → version gate → managed venv
 * (under `context.globalStorageUri`) → `pip install -r requirements.txt`.
 *
 * Results are cached in `globalState`; the pip install is skipped on subsequent
 * calls when the venv is intact and `requirements.txt` has not changed.
 *
 * @param force - when true, bypass the cache and redo install regardless.
 */
export async function ensureReady(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  backendDir: string,
  force = false,
): Promise<EnsureResult> {
  const cfg = vscode.workspace.getConfiguration("autonomy");
  const manualPath = cfg.get<string>("pythonPath")?.trim() ?? "";

  // ── Explicit override path ────────────────────────────────────────────────
  if (manualPath) {
    return handleManualPath(manualPath, output);
  }

  // ── Managed bootstrap path ────────────────────────────────────────────────
  const requirementsTxt = path.join(backendDir, "requirements.txt");
  if (!fs.existsSync(requirementsTxt)) {
    return { ok: false, reason: "REQUIREMENTS_MISSING", detail: requirementsTxt };
  }

  const reqHash = hashFile(requirementsTxt);

  // Fast path: already set up and requirements unchanged
  if (!force) {
    const cached = await tryFastPath(context, reqHash, output);
    if (cached) return cached;
  }

  // Discover base interpreter
  output.appendLine("[bootstrap] discovering Python interpreter…");
  const base = await discoverBaseInterpreter(output);
  if (!base) {
    return {
      ok: false,
      reason: "PYTHON_NOT_FOUND",
      detail: installGuide(),
    };
  }

  // Version gate
  const versionOk = await meetsMinimum(base, MIN_VERSION, output);
  if (!versionOk) {
    return {
      ok: false,
      reason: "PYTHON_VERSION_TOO_OLD",
      detail: `Found ${base} but it is below ${MIN_VERSION.join(".")}. ${installGuide()}`,
    };
  }

  // Venv under globalStorage, keyed by base interpreter hash so mixing bases
  // is safe (each unique base gets its own subdirectory).
  const venvRoot = path.join(
    context.globalStorageUri.fsPath,
    "autonomy-venv",
    shortHash(base),
  );
  fs.mkdirSync(venvRoot, { recursive: true });

  output.appendLine(`[bootstrap] creating venv at ${venvRoot}…`);
  const createResult = await createVenv(base, venvRoot, output);
  if (!createResult.ok) return createResult;

  const venvPython = venvExecutable(venvRoot);

  // pip install
  output.appendLine(`[bootstrap] installing dependencies from ${requirementsTxt}…`);
  const pipResult = await runPip(
    venvPython,
    requirementsTxt,
    output,
    context.globalStorageUri.fsPath,
  );
  if (!pipResult.ok) return pipResult;

  // Persist cache
  context.globalState.update(KEY_VENV_ROOT, venvRoot);
  context.globalState.update(KEY_BASE_PYTHON, base);
  context.globalState.update(KEY_REQ_HASH, reqHash);

  output.appendLine(`[bootstrap] ready. Using ${venvPython}`);
  return { ok: true, pythonExec: venvPython, venvRoot };
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

async function handleManualPath(
  manualPath: string,
  output: vscode.OutputChannel,
): Promise<EnsureResult> {
  output.appendLine(`[bootstrap] using configured pythonPath: ${manualPath}`);
  if (!fs.existsSync(manualPath)) {
    return {
      ok: false,
      reason: "PYTHON_NOT_FOUND",
      detail: `autonomy.pythonPath is set to "${manualPath}" but that file does not exist.`,
    };
  }
  const versionOk = await meetsMinimum(manualPath, MIN_VERSION, output);
  if (!versionOk) {
    return {
      ok: false,
      reason: "PYTHON_VERSION_TOO_OLD",
      detail: `Configured pythonPath "${manualPath}" is below ${MIN_VERSION.join(".")}. ${installGuide()}`,
    };
  }
  return { ok: true, pythonExec: manualPath, venvRoot: null };
}

async function tryFastPath(
  context: vscode.ExtensionContext,
  reqHash: string,
  output: vscode.OutputChannel,
): Promise<EnsureResult | null> {
  const cachedVenv = context.globalState.get<string>(KEY_VENV_ROOT);
  const cachedHash = context.globalState.get<string>(KEY_REQ_HASH);
  if (!cachedVenv || cachedHash !== reqHash) return null;

  const pythonExec = venvExecutable(cachedVenv);
  if (!fs.existsSync(pythonExec)) return null;
  if (!(await venvHasUsablePip(pythonExec))) {
    output.appendLine("[bootstrap] cached venv has no pip; will rebuild.");
    return null;
  }

  // Quick sanity: verify uvicorn is importable
  try {
    await execFileAsync(pythonExec, ["-c", "import uvicorn"], { timeout: 8000 });
    output.appendLine(`[bootstrap] fast path OK. Using ${pythonExec}`);
    return { ok: true, pythonExec, venvRoot: cachedVenv };
  } catch {
    output.appendLine("[bootstrap] fast path sanity check failed; will reinstall.");
    return null;
  }
}

async function discoverBaseInterpreter(
  output: vscode.OutputChannel,
): Promise<string | null> {
  const candidates = await buildCandidates(output);
  for (const c of candidates) {
    if (await isExecutable(c, output)) return c;
  }
  return null;
}

async function buildCandidates(output: vscode.OutputChannel): Promise<string[]> {
  const results: string[] = [];

  // 1. On Unix, try explicit `python3.N` before the Python extension and bare
  // `python3`. The extension's "active" interpreter is often Homebrew's `python3`
  // (e.g. 3.14) with broken ensurepip; `python3.13` is typically fine when both exist.
  if (process.platform !== "win32") {
    for (const minor of [13, 12, 11, 10]) {
      results.push(`python3.${minor}`);
    }
  }

  // 2. Microsoft Python extension (after versioned shims on Unix)
  const fromPyExt = await tryPythonExtensionInterpreter(output);
  if (fromPyExt) results.push(fromPyExt);

  // 3. Remaining PATH candidates
  if (process.platform === "win32") {
    results.push("py", "python3", "python");
  } else {
    results.push("python3", "python");
  }

  return [...new Set(results)];
}

async function tryPythonExtensionInterpreter(
  output: vscode.OutputChannel,
): Promise<string | null> {
  try {
    const ext = vscode.extensions.getExtension("ms-python.python");
    if (!ext) return null;
    if (!ext.isActive) await ext.activate();
    // Try the current API surface first
    const api = ext.exports as Record<string, unknown> | undefined;
    if (!api) return null;

    // Newer Python extension exposes environments API
    const environments = api["environments"] as
      | { getActiveEnvironmentPath?: (scope?: unknown) => Promise<{ path: string }> }
      | undefined;
    const uri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const envPath = await environments?.getActiveEnvironmentPath?.(uri);
    if (envPath?.path && fs.existsSync(envPath.path)) return envPath.path;

    // Older fallback via settings
    const fromSettings = vscode.workspace
      .getConfiguration("python")
      .get<string>("defaultInterpreterPath")
      ?.trim();
    if (fromSettings && fs.existsSync(fromSettings)) return fromSettings;
  } catch (e) {
    output.appendLine(`[bootstrap] Python extension probe failed (non-fatal): ${e}`);
  }
  return null;
}

async function isExecutable(
  candidate: string,
  output: vscode.OutputChannel,
): Promise<boolean> {
  try {
    // On Windows "py" needs special args to avoid opening the store
    const args =
      process.platform === "win32" && candidate === "py"
        ? ["-3", "-c", "pass"]
        : ["-c", "pass"];
    await execFileAsync(candidate, args, { timeout: 8000 });
    return true;
  } catch {
    output.appendLine(`[bootstrap] candidate not usable: ${candidate}`);
    return false;
  }
}

async function meetsMinimum(
  python: string,
  min: [number, number],
  output: vscode.OutputChannel,
): Promise<boolean> {
  try {
    const args =
      process.platform === "win32" && python === "py"
        ? ["-3", "-c", "import sys; v=sys.version_info; print(f'{v.major}.{v.minor}.{v.micro}')"]
        : ["-c", "import sys; v=sys.version_info; print(f'{v.major}.{v.minor}.{v.micro}')"];
    const { stdout } = await execFileAsync(python, args, { timeout: 8000 });
    const version = stdout.trim();
    const [maj, minPart] = version.split(".").map(Number);
    const ok = maj > min[0] || (maj === min[0] && minPart >= min[1]);
    output.appendLine(`[bootstrap] ${python} → ${version} (${ok ? "ok" : "too old"})`);
    return ok;
  } catch (e) {
    output.appendLine(`[bootstrap] version check failed for ${python}: ${e}`);
    return false;
  }
}

async function venvHasUsablePip(venvPython: string): Promise<boolean> {
  try {
    await execFileAsync(venvPython, ["-m", "pip", "--version"], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function removeManagedVenvTree(venvRoot: string, output: vscode.OutputChannel): void {
  output.appendLine(`[bootstrap] removing broken or incomplete venv at ${venvRoot}…`);
  try {
    fs.rmSync(venvRoot, { recursive: true, force: true });
  } catch (e) {
    output.appendLine(`[bootstrap] could not remove venv dir: ${e}`);
  }
}

async function createVenv(
  basePython: string,
  venvRoot: string,
  output: vscode.OutputChannel,
): Promise<EnsureResult> {
  const cfgPath = path.join(venvRoot, "pyvenv.cfg");
  if (fs.existsSync(cfgPath)) {
    const py = venvExecutable(venvRoot);
    if (await venvHasUsablePip(py)) {
      output.appendLine("[bootstrap] venv already exists, skipping creation.");
      return { ok: true, pythonExec: py, venvRoot };
    }
    removeManagedVenvTree(venvRoot, output);
    fs.mkdirSync(venvRoot, { recursive: true });
  }
  try {
    const args =
      process.platform === "win32" && basePython === "py"
        ? ["-3", "-m", "venv", venvRoot]
        : ["-m", "venv", venvRoot];
    await execFileAsync(basePython, args, { timeout: 60_000 });
    return { ok: true, pythonExec: venvExecutable(venvRoot), venvRoot };
  } catch (e) {
    const hint =
      process.platform === "darwin"
        ? " Try setting Autonomy › Python: Path to a stable interpreter (e.g. /opt/homebrew/bin/python3.13)."
        : " Try setting Autonomy › Python: Path to Python 3.10–3.13 from python.org or your package manager.";
    output.appendLine(
      `[bootstrap] venv creation failed (often ensurepip).${hint} Full error: ${e}`,
    );
    return {
      ok: false,
      reason: "VENV_CREATE_FAILED",
      detail: `Could not create venv at ${venvRoot}: ${e}.${hint}`,
    };
  }
}

async function runPip(
  venvPython: string,
  requirementsTxt: string,
  output: vscode.OutputChannel,
  _globalStoragePath: string,
): Promise<EnsureResult> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Autonomy: installing Python dependencies…",
      cancellable: false,
    },
    async () => {
      try {
        // Upgrade pip first (best-effort; ignore failures)
        try {
          await execFileAsync(
            venvPython,
            ["-m", "pip", "install", "--upgrade", "pip"],
            { timeout: 60_000 },
          );
        } catch (e) {
          output.appendLine(`[bootstrap] pip upgrade skipped: ${e}`);
        }

        const { stdout, stderr } = await execFileAsync(
          venvPython,
          ["-m", "pip", "install", "-r", requirementsTxt],
          { timeout: 120_000 },
        );
        if (stdout) output.append(`[bootstrap/pip] ${stdout}`);
        if (stderr) output.append(`[bootstrap/pip] ${stderr}`);
        return { ok: true as const, pythonExec: venvPython, venvRoot: path.dirname(path.dirname(venvPython)) };
      } catch (e) {
        const msg = String(e);
        let detail = msg;
        if (/SSL|certificate/i.test(msg)) {
          detail = `SSL error during pip install. If you are behind a corporate proxy, try setting a trusted host in pip.ini or contact your IT team. Details: ${msg}`;
        } else if (/EACCES|permission/i.test(msg)) {
          detail = `Permission error during pip install. Check write access to the extension's global storage directory. Details: ${msg}`;
        } else if (/ENOTFOUND|getaddrinfo|network/i.test(msg)) {
          detail = `Network error during pip install. Are you offline or behind a firewall blocking PyPI? Details: ${msg}`;
        }
        output.appendLine(`[bootstrap/pip] FAILED: ${detail}`);
        return { ok: false as const, reason: "PIP_FAILED" as const, detail };
      }
    },
  );
}

function venvExecutable(venvRoot: string): string {
  return process.platform === "win32"
    ? path.join(venvRoot, "Scripts", "python.exe")
    : path.join(venvRoot, "bin", "python3");
}

function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function shortHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function installGuide(): string {
  switch (process.platform) {
    case "darwin":
      return "Install Python 3.12+ via https://www.python.org/downloads/ or `brew install python`.";
    case "win32":
      return "Install Python 3.12+ from https://www.python.org/downloads/ and ensure it is added to PATH.";
    default:
      return "Install Python 3.12+ via your package manager (e.g. `apt install python3.12`) or https://www.python.org/downloads/.";
  }
}
