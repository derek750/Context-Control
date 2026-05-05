import * as vscode from "vscode";
import { ProxyManager } from "./proxy-manager";
import { WebviewProvider } from "./webview-provider";
import { WebSocketBridge } from "./websocket-client";
import { ensureReady } from "./python-bootstrap";
import { resolveBackendDir } from "./backend-path";

let proxyManager: ProxyManager | null = null;
let bridge: WebSocketBridge | null = null;
let provider: WebviewProvider | null = null;
let output: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("Context Control");
  context.subscriptions.push(output);

  proxyManager = new ProxyManager(output, context);
  provider = new WebviewProvider(context);

  const openCmd = vscode.commands.registerCommand("contextControl.open", async () => {
    const cfg = vscode.workspace.getConfiguration("contextControl");
    const port = cfg.get<number>("proxyPort", 8080);
    const autoStart = cfg.get<boolean>("autoStartProxy", true);

    if (autoStart && proxyManager && !proxyManager.running) {
      const python = await runBootstrap(context);
      if (python === null) return; // bootstrap failed; error already shown

      try {
        await proxyManager.start(port, python);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Context Control: failed to start proxy — ${(err as Error).message}. ` +
            `You can disable auto-start in Settings and run uvicorn yourself.`,
        );
      }
    }

    const panel = provider!.show();

    if (!bridge) {
      bridge = new WebSocketBridge(port, output);
      context.subscriptions.push(bridge);
    }
    bridge.attachWebview(panel.webview);
    panel.onDidDispose(() => {
      output.appendLine("[context-control] panel closed");
      bridge?.detachWebview();
    });
  });

  const restartCmd = vscode.commands.registerCommand(
    "contextControl.restartProxy",
    async () => {
      if (!proxyManager) return;
      const port = vscode.workspace
        .getConfiguration("contextControl")
        .get<number>("proxyPort", 8080);
      await proxyManager.stop();
      const python = await runBootstrap(context);
      if (python === null) return;
      await proxyManager.start(port, python);
      vscode.window.showInformationMessage("Context Control: proxy restarted.");
    },
  );

  const retrySetupCmd = vscode.commands.registerCommand(
    "contextControl.retryPythonSetup",
    async () => {
      output.show(true);
      output.appendLine("[bootstrap] Retrying Python setup (cache cleared)…");
      const cfg = vscode.workspace.getConfiguration("contextControl");
      let backendDir: string;
      try {
        backendDir = resolveBackendDir(cfg, context.extensionPath);
      } catch (err) {
        vscode.window.showErrorMessage(`Context Control: ${(err as Error).message}`);
        return;
      }
      const result = await ensureReady(context, output, backendDir, true);
      if (result.ok) {
        vscode.window.showInformationMessage(
          `Context Control: Python environment ready (${result.pythonExec}).`,
        );
      } else {
        vscode.window.showErrorMessage(
          `Context Control: Python setup failed — ${result.reason}. ${result.detail ?? ""}`.trim(),
        );
      }
    },
  );

  context.subscriptions.push(openCmd, restartCmd, retrySetupCmd);

  // Disposables run in reverse registration order when the window closes. Register
  // this last so it runs first: stop WS reconnect, close webview, SIGTERM uvicorn.
  context.subscriptions.push(
    new vscode.Disposable(() => {
      output?.appendLine("[context-control] shutting down (subscription dispose)");
      bridge?.dispose();
      provider?.dispose();
      proxyManager?.disposeSync();
    }),
  );
}

/** Full async teardown when the extension host calls `deactivate`. */
async function shutdownExtensionHostResources(reason: string): Promise<void> {
  output?.appendLine(`[context-control] shutting down (${reason})`);
  bridge?.dispose();
  provider?.dispose();
  await proxyManager?.stop();
  bridge = null;
  provider = null;
  proxyManager = null;
}

export async function deactivate() {
  await shutdownExtensionHostResources("deactivate");
}

/**
 * Run PythonBootstrap and surface a friendly error if it fails.
 * Returns the resolved Python executable, or `null` on failure.
 */
async function runBootstrap(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration("contextControl");
  let backendDir: string;
  try {
    backendDir = resolveBackendDir(cfg, context.extensionPath);
  } catch (err) {
    vscode.window.showErrorMessage(`Context Control: ${(err as Error).message}`);
    return null;
  }

  output.show(false); // reveal without stealing focus
  const result = await ensureReady(context, output, backendDir);
  if (result.ok) return result.pythonExec;

  const retryAction = "Retry setup";
  const settingsAction = "Open Settings";
  const choice = await vscode.window.showErrorMessage(
    `Context Control: Python setup failed — ${result.reason}. ${result.detail ?? ""}`.trim(),
    retryAction,
    settingsAction,
  );
  if (choice === retryAction) {
    const retry = await ensureReady(context, output, backendDir, true);
    if (retry.ok) return retry.pythonExec;
    vscode.window.showErrorMessage(
      `Context Control: retry failed. See Output → Context Control for details.`,
    );
  } else if (choice === settingsAction) {
    vscode.commands.executeCommand("workbench.action.openSettings", "contextControl.pythonPath");
  }
  return null;
}
