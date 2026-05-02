import * as vscode from "vscode";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";

export class ProxyManager {
  private proc: ChildProcessWithoutNullStreams | null = null;

  constructor(private readonly output: vscode.OutputChannel) {}

  get running(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  async start(port: number): Promise<void> {
    if (this.running) return;

    const cfg = vscode.workspace.getConfiguration("autonomy");
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) {
      throw new Error("Autonomy needs an open workspace folder.");
    }

    const backendDir =
      cfg.get<string>("backendDir") || path.join(workspace, "backend");
    if (!fs.existsSync(path.join(backendDir, "main.py"))) {
      throw new Error(`backend/main.py not found in ${backendDir}.`);
    }

    const configured = cfg.get<string>("pythonPath")?.trim() ?? "";
    const python = configured || resolveVenvPython(backendDir);

    this.output.appendLine(
      `[proxy] starting: ${python} -m uvicorn main:app --port ${port} (cwd=${backendDir})`,
    );

    this.proc = spawn(
      python,
      ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(port)],
      { cwd: backendDir },
    );

    this.proc.stdout.on("data", (b: Buffer) => this.output.append(`[proxy] ${b}`));
    this.proc.stderr.on("data", (b: Buffer) => this.output.append(`[proxy] ${b}`));
    this.proc.on("error", (err: NodeJS.ErrnoException) => {
      this.output.appendLine(`[proxy] spawn failed: ${err.message}`);
    });
    this.proc.on("exit", (code, signal) => {
      this.output.appendLine(`[proxy] exited code=${code} signal=${signal}`);
      this.proc = null;
    });

    await waitForPort("127.0.0.1", port, 15000).catch((err) => {
      this.stop();
      throw new Error(
        `Proxy did not become ready on port ${port}: ${(err as Error).message}. ` +
          `Check the Autonomy output channel for uvicorn logs.`,
      );
    });

    this.output.appendLine(`[proxy] ready on 127.0.0.1:${port}`);
  }

  async stop(): Promise<void> {
    const p = this.proc;
    if (!p) return;
    this.proc = null;
    p.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {}
        resolve();
      }, 2000);
      p.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

/** Prefer `pyvenv.cfg` `executable=` — matches the interpreter that owns site-packages.
 * `venv/bin/python` is sometimes a broken symlink (wrong Python → uvicorn missing). */
function readPyvenvExecutable(backendDir: string): string | null {
  const cfgPath = path.join(backendDir, "venv", "pyvenv.cfg");
  if (!fs.existsSync(cfgPath)) {
    return null;
  }
  try {
    const text = fs.readFileSync(cfgPath, "utf8");
    const match = text.match(/^\s*executable\s*=\s*(.+)$/m);
    if (!match) {
      return null;
    }
    const exe = match[1].trim();
    return fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

function resolveVenvPython(backendDir: string): string {
  const fromCfg = readPyvenvExecutable(backendDir);
  if (fromCfg) {
    return fromCfg;
  }
  const win = process.platform === "win32";
  const candidates = win
    ? [
        path.join(backendDir, "venv", "Scripts", "python.exe"),
        path.join(backendDir, "venv", "Scripts", "python3.exe"),
      ]
    : [
        path.join(backendDir, "venv", "bin", "python3"),
        path.join(backendDir, "venv", "bin", "python"),
      ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return win ? "python" : "python3";
}

function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.createConnection({ host, port });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) {
          reject(new Error("timeout"));
        } else {
          setTimeout(tryOnce, 200);
        }
      });
    };
    tryOnce();
  });
}
