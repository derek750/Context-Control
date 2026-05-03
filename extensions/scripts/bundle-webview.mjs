/**
 * Copies ../frontend/dist → ./dist so the packaged VSIX includes the built webview.
 * Invoked by vscode:prepublish before `vsce package`.
 */
import fs from "fs/promises";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, "..");
const src = path.resolve(extRoot, "..", "frontend", "dist");
const dest = path.join(extRoot, "dist");

try {
  await fs.access(path.join(src, "index.html"));
} catch {
  console.error(
    "bundle-webview: ../frontend/dist not found. Run:\n  cd ../frontend && npm install && npm run build",
  );
  process.exit(1);
}

await fs.rm(dest, { recursive: true, force: true });
await fs.cp(src, dest, { recursive: true });
console.log("bundle-webview: synced frontend/dist → extensions/dist");
