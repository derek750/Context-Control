/**
 * Copies ../backend → ./backend for the VSIX (sources + requirements), excluding
 * venv, caches, and secrets. Run `pip install -r requirements.txt` in that folder
 * (or use a venv) before starting uvicorn — see ProxyManager.
 */
import fs from "fs/promises";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, "..");
const src = path.resolve(extRoot, "..", "backend");
const dest = path.join(extRoot, "backend");

try {
  await fs.access(path.join(src, "main.py"));
} catch {
  console.error(
    "bundle-backend: ../backend/main.py not found. Clone the Autonomy repo with the backend/ folder.",
  );
  process.exit(1);
}

function filterCopy(srcPath) {
  const rel = path.relative(src, srcPath);
  if (!rel || rel === ".") return true;
  const base = path.basename(srcPath);
  if (base === ".env" || base === "CLAUDE.md" || base === ".gitignore") {
    return false;
  }
  const segments = rel.split(path.sep);
  if (segments.includes("venv")) return false;
  if (segments.some((s) => s === "__pycache__")) return false;
  if (rel.endsWith(".pyc")) return false;
  return true;
}

await fs.rm(dest, { recursive: true, force: true });
await fs.cp(src, dest, { recursive: true, force: true, filter: filterCopy });

try {
  await fs.access(path.join(dest, "main.py"));
} catch {
  console.error("bundle-backend: copy finished but main.py missing under extensions/backend.");
  process.exit(1);
}

console.log("bundle-backend: synced backend/ → extensions/backend (venv and caches excluded)");
