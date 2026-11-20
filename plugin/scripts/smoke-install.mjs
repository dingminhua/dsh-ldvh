import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function run(cmd, args, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} 失败（exit ${r.status}）:\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  }
  return (r.stdout ?? "") + (r.stderr ?? "");
}

export function isIgnoredBuildsError(output) {
  return /ERR_PNPM_IGNORED_BUILDS|Ignored build scripts/i.test(output);
}

export function resolveTarball(explicit, packageRoot, list = readdirSync) {
  if (explicit) return resolve(explicit);
  const candidates = list(packageRoot).filter((f) => /^dsh-ldvh-.*\.tgz$/.test(f));
  if (candidates.length !== 1) {
    throw new Error(`未显式指定 tarball，且 plugin/ 下匹配到 ${candidates.length} 个 dsh-ldvh-*.tgz（须恰好 1 个）`);
  }
  return join(packageRoot, candidates[0]);
}

export async function pollHealth(port, { tries = 40, intervalMs = 250, fetchImpl = fetch, sleep = null } = {}) {
  const url = `http://127.0.0.1:${port}/api/health`;
  const pause = sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(1000) });
      if (res.status === 200) return true;
    } catch {
    }
    await pause(intervalMs);
  }
  return false;
}

export function classifyChildExit(exitedEarly, exitCode) {
  if (exitedEarly || exitCode !== null) return "early-exit";
  return "running";
}

export async function main(options = {}) {
  const {
    argv = process.argv,
    packageRoot = PACKAGE_ROOT,
    pnpmCmdString = process.env.SMOKE_PNPM ?? "pnpm",
    fetchImpl = fetch,
  } = options;
  const tarball = resolveTarball(argv[2], packageRoot);
  const [pnpm, ...pnpmPrefix] = pnpmCmdString.split(/\s+/);
  const workspace = mkdtempSync(join(tmpdir(), "ldvh-smoke-"));
  const port = options.port ?? (34100 + Math.floor(Math.random() * 500));
  let child = null;
  try {
    writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - '.'\n");
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "ldvh-smoke", private: true }));
    const installOut = run(pnpm, [...pnpmPrefix, "add", resolve(tarball)], workspace, { ELECTRON_RUN_AS_NODE: "1" });
    if (isIgnoredBuildsError(installOut)) {
      throw new Error(`安装被构建脚本审批门拒绝:\n${installOut}`);
    }
    const server = join(workspace, "node_modules", "dsh-ldvh", "web", "api-js", "server.js");
    child = spawn(process.execPath, [server], {
      cwd: join(workspace, "node_modules", "dsh-ldvh", "web"),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port) },
      stdio: "ignore",
    });
    let exitedEarly = false;
    child.once("exit", () => { exitedEarly = true; });
    const ready = await pollHealth(port, { fetchImpl });
    if (classifyChildExit(exitedEarly, child.exitCode) === "early-exit") {
      throw new Error("web-api 子进程启动即退出");
    }
    if (!ready) throw new Error(`web-api 子进程在 ${port} 端口未在时限内就绪`);
    console.log(`smoke-install: 安装成功且 web-api health 200（端口 ${port}）`);
    return { ok: true, port };
  } finally {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    rmSync(workspace, { recursive: true, force: true });
  }
}

const self = resolve(fileURLToPath(import.meta.url));
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === self) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
