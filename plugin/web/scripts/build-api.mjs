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
const tsc = join(webRoot, "node_modules", "typescript", "bin", "tsc");
execFileSync(process.execPath, [tsc, "-p", "tsconfig.api.json"], { cwd: webRoot, stdio: "inherit" });

for (const { from, to } of targets) {
  const src = join(stage, from);
  if (!existsSync(src)) throw new Error(`build-api: 缺少编译产物 ${src}`);
  rewriteTsExtensions(src);
  const dest = join(webRoot, to);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}
rmSync(stage, { recursive: true, force: true });

function assertRewritten(dir, label) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      assertRewritten(full, label);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const text = readFileSync(full, "utf8");
    if (/\.ts["']/.test(text) || /shared\/[A-Za-z0-9_-]+\.js["']/.test(text)) {
      throw new Error(`build-api: ${label}/${entry.name} 仍有未改写的 .ts 或 shared/ 引用`);
    }
  }
}
for (const { to } of targets) assertRewritten(join(webRoot, to), to);

const server = join(webRoot, "api-js", "server.js");
if (!existsSync(server)) throw new Error(`build-api: 缺少后端入口 ${server}`);
console.log(`build-api: 后端编译产物就绪（${targets.map((t) => t.to).join(", ")}）`);
