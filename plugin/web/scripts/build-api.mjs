import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(webRoot, ".build-api");
const targets = [
  { from: "api", to: "api-js" },
  { from: "shared", to: "shared-js" },
];

function rewriteTsExtensions(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteTsExtensions(full);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const text = readFileSync(full, "utf8");
    let next = text.replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2");
    next = next.replace(/(["'][^"']*)\bshared\/([^"']*\.js["'])/g, "$1shared-js/$2");
    if (next !== text) writeFileSync(full, next);
  }
}

rmSync(stage, { recursive: true, force: true });
const tsc = join(webRoot, "node_modules", ".bin", "tsc");
execFileSync(tsc, ["-p", "tsconfig.api.json"], { cwd: webRoot, stdio: "inherit" });

for (const { from, to } of targets) {
  const src = join(stage, from);
  if (!existsSync(src)) throw new Error(`build-api: 缺少编译产物 ${src}`);
  rewriteTsExtensions(src);
  const dest = join(webRoot, to);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}
rmSync(stage, { recursive: true, force: true });

const server = join(webRoot, "api-js", "server.js");
if (!existsSync(server)) throw new Error(`build-api: 缺少后端入口 ${server}`);
console.log(`build-api: 后端编译产物就绪（${targets.map((t) => t.to).join(", ")}）`);
