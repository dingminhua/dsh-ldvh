import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { access, chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MARKER_PREFIX = "# ldvh-native-commit-msg-hook: v1 sha256:";
const VERSION_PREFIX = "# ldvh-hook-bundle-version: ";
const GIT_TIMEOUT_MS = 10000;

export const MANAGED_HOOKS = Object.freeze([
  Object.freeze({ name: "commit-msg", code: "git-commit-msg", argument: "message-file" }),
  Object.freeze({ name: "pre-commit", code: "git-pre-commit", argument: null })
]);

const DEFAULT_HOOK_NAME = "commit-msg";
export const HOOK_BUNDLE_VERSION = "1.0.0-dev.3";

export const INTERPRETER_UNAVAILABLE_PREFIX = "LDVH Git Gate cannot run: no node interpreter found";

export const INTERPRETER_UNAVAILABLE_MARKER = `LDVH Git Gate (commit-msg) cannot run: no node interpreter found`;

function interpreterUnavailableMarker(hookName) {
  return hookName === DEFAULT_HOOK_NAME ? INTERPRETER_UNAVAILABLE_MARKER : `LDVH Git Gate (${hookName}) cannot run: no node interpreter found`;
}

function defaultInterpreterCandidates() {
  const baked = typeof process.execPath === "string" && process.execPath.length > 0 ? [process.execPath] : [];
  return [...baked, "node", "nodejs"];
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function cleanGitEnvironment(extra = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of Object.keys(env)) {
    if (["GIT_COMMON_DIR", "GIT_CONFIG_COUNT", "GIT_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_WORK_TREE"].includes(key) || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key];
  }
  return { ...env, ...extra };
}

async function runGit(worktree, args, options = {}) {
  try {
    const result = await execFileAsync("git", ["-C", worktree, ...args], {
      encoding: "utf8",
      timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
      env: cleanGitEnvironment(options.env),
      maxBuffer: 1024 * 1024
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(String(error?.stderr || error?.stdout || error?.message || error).trim() || "Git command failed");
  }
}

async function resolveIdentity(candidate) {
  if (typeof candidate !== "string" || candidate.trim().length === 0 || !isAbsolute(candidate)) throw new Error("project path must be a non-empty absolute path");
  const requested = await realpath(candidate);
  const stat = await lstat(requested);
  if (!stat.isDirectory()) throw new Error("project path must be a directory");
  const root = await realpath(await runGit(requested, ["rev-parse", "--show-toplevel"]));
  if (root !== requested) throw new Error("selected directory must be the Git root, not a subdirectory");
  if (await runGit(root, ["rev-parse", "--is-bare-repository"]) === "true") throw new Error("bare Git repositories cannot be governed projects");
  const commonRaw = await runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const commonDir = await realpath(commonRaw);
  if (resolve(commonRaw) !== commonDir) throw new Error("Git common-dir must not traverse a symbolic link");
  const hookDirectory = join(commonDir, "hooks");
  try {
    const hookStat = await lstat(hookDirectory);
    if (!hookStat.isDirectory() || hookStat.isSymbolicLink()) throw new Error("Git hooks path must be a regular directory");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { projectRoot: root, gitCommonDir: commonDir, hookDirectory, hookPath: join(hookDirectory, "commit-msg"), hookPaths: Object.fromEntries(MANAGED_HOOKS.map((hook) => [hook.name, join(hookDirectory, hook.name)])) };
}

function digest(body) {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function parseManagedHook(content) {
  if (!content.startsWith("#!/bin/sh\n")) return { owned: false, valid: false, version: null };
  const firstNewline = content.indexOf("\n");
  const secondNewline = content.indexOf("\n", firstNewline + 1);
  if (secondNewline === -1) return { owned: false, valid: false, version: null };
  const marker = content.slice(firstNewline + 1, secondNewline);
  if (!marker.startsWith(MARKER_PREFIX)) return { owned: false, valid: false, version: null };
  const claimed = marker.slice(MARKER_PREFIX.length);
  const body = content.slice(secondNewline + 1);
  const actual = digest(body);
  const valid = claimed.length === actual.length && timingSafeEqual(Buffer.from(claimed), Buffer.from(actual));
  const version = body.match(/^# ldvh-hook-bundle-version: (.+)$/m)?.[1] ?? null;
  return { owned: true, valid, version, body };
}

export function renderHook({ runnerPath, workspaceRoot, bundleVersion = HOOK_BUNDLE_VERSION, interpreterCandidates = defaultInterpreterCandidates(), hookName = DEFAULT_HOOK_NAME }) {
  const spec = MANAGED_HOOKS.find((hook) => hook.name === hookName);
  if (spec === undefined) throw new Error(`unmanaged Git Hook: ${hookName}`);
  const runner = shellQuote(runnerPath);
  const workspace = shellQuote(workspaceRoot);
  const probes = interpreterCandidates
    .map((candidate, index) => `${index === interpreterCandidates.length - 1 ? "  " : "    "}${shellQuote(candidate)}${index === interpreterCandidates.length - 1 ? "" : " \\"}`)
    .join("\n");
  const argumentLines = spec.argument === "message-file"
    ? [
        'if [ "$#" -ne 1 ]; then',
        '  printf "%s\\n" "LDVH Git commit-msg Hook expected one message-file argument" >&2',
        "  exit 1",
        "fi",
        'worktree=$(git rev-parse --show-toplevel) || exit 1',
        'case "$1" in',
        '  /*|[A-Za-z]:\\\\*|//*) message_file=$1 ;;',
        '  *) message_file="$worktree/$1" ;;',
        "esac",
        `set -- ${spec.code} --workspace-root ${workspace} --worktree "$worktree" --message-file "$message_file"`
      ]
    : [
        'worktree=$(git rev-parse --show-toplevel) || exit 1',
        `set -- ${spec.code} --workspace-root ${workspace} --worktree "$worktree"`
      ];
  const body = [
    `${VERSION_PREFIX}${bundleVersion}`,
    "set -eu",
    ...argumentLines,
    'if [ -n "${LDVH_PREFLIGHT_INDEX:-}" ]; then',
    '  set -- "$@" --index-file "$LDVH_PREFLIGHT_INDEX"',
    "fi",
    "node_bin=",
    "for candidate in \\",
    probes,
    "do",
    '  if command -v "$candidate" >/dev/null 2>&1; then node_bin=$candidate; break; fi',
    "done",
    'if [ -z "$node_bin" ]; then',
    `  printf "%s\\n" ${shellQuote(interpreterUnavailableMarker(spec.name))} >&2`,
    "  exit 127",
    "fi",
    'ELECTRON_RUN_AS_NODE=1 exec "$node_bin" ' + `${runner} "$@"`,
    ""
  ].join("\n");
  return `#!/bin/sh\n${MARKER_PREFIX}${digest(body)}\n${body}`;
}

async function inspectOneHook(identity, spec) {
  const hookPath = identity.hookPaths[spec.name];
  let content;
  try {
    content = await readFile(hookPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { name: spec.name, hookPath, state: "absent", detail: "Git Hook is not installed", hookBundleVersion: null };
    return { name: spec.name, hookPath, state: "unavailable", detail: String(error?.message || error), hookBundleVersion: null };
  }
  const parsed = parseManagedHook(content);
  if (!parsed.owned) return { name: spec.name, hookPath, state: "conflict", detail: `an unmanaged ${spec.name} Hook already exists`, hookBundleVersion: null };
  if (!parsed.valid) return { name: spec.name, hookPath, state: "conflict", detail: "the LDVH Hook marker digest does not match its body", hookBundleVersion: parsed.version };
  if (!(await isExecutable(hookPath))) {
    return { name: spec.name, hookPath, state: "outdated", detail: "LDVH Git Hook is not executable (git will ignore it)", hookBundleVersion: parsed.version };
  }
  return parsed.version === HOOK_BUNDLE_VERSION
    ? { name: spec.name, hookPath, state: "managed", detail: "LDVH Git Hook is current", hookBundleVersion: parsed.version }
    : { name: spec.name, hookPath, state: "outdated", detail: `LDVH Git Hook ${parsed.version ?? "unknown"} requires update`, hookBundleVersion: parsed.version };
}

async function isExecutable(hookPath) {
  try {
    await access(hookPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const HOOK_STATE_SEVERITY = Object.freeze(["conflict", "unavailable", "absent", "outdated", "managed"]);

export async function inspectHook(candidate, { hookName } = {}) {
  let identity;
  try {
    identity = await resolveIdentity(candidate);
  } catch (error) {
    return { state: "unavailable", detail: String(error?.message || error), expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
  }
  if (hookName !== undefined) {
    const spec = MANAGED_HOOKS.find((hook) => hook.name === hookName);
    if (spec === undefined) return { ...identity, state: "unavailable", detail: `unmanaged Git Hook: ${hookName}`, hookBundleVersion: null, expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
    const single = await inspectOneHook(identity, spec);
    return { ...identity, ...single, expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
  }
  const hooks = [];
  for (const spec of MANAGED_HOOKS) hooks.push(await inspectOneHook(identity, spec));
  const worst = HOOK_STATE_SEVERITY.find((state) => hooks.some((hook) => hook.state === state)) ?? "unavailable";
  return {
    ...identity,
    state: worst,
    detail: rollupDetail(worst, hooks),
    hookBundleVersion: hooks.find((hook) => hook.state === worst)?.hookBundleVersion ?? null,
    expectedHookBundleVersion: HOOK_BUNDLE_VERSION,
    hooks
  };
}

function rollupDetail(worst, hooks) {
  const offenders = hooks.filter((hook) => hook.state === worst);
  if (offenders.length === 1) return offenders[0].detail;
  if (worst === "managed") return "LDVH Git Hook is current";
  return offenders.map((hook) => `${hook.name}: ${hook.detail}`).join("; ");
}

async function atomicReplace(path, content, expected) {
  await mkdir(dirname(path), { recursive: true });
  let current = null;
  try { current = await readFile(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (expected === null ? current !== null : current === null || !current.equals(expected)) throw new Error("Git Hook changed during installation");
  const temp = join(dirname(path), `.ldvh-${basename(path)}-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temp, content, { flag: "wx", mode: 0o755 });
    await chmod(temp, 0o755);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

let cachedShCommand;

async function resolveShCommand() {
  if (cachedShCommand) return cachedShCommand;
  const candidates = [];
  try {
    const execPath = (await execFileAsync("git", ["--exec-path"], { encoding: "utf8", timeout: GIT_TIMEOUT_MS })).stdout.trim();
    if (execPath) {
      const gitRoot = resolve(execPath, "..", "..", "..");
      candidates.push(join(gitRoot, "bin", "sh.exe"), join(gitRoot, "usr", "bin", "sh.exe"));
    }
  } catch {
  }
  candidates.push("sh.exe", "sh");
  for (const command of candidates) {
    try {
      await execFileAsync(command, ["-c", "exit 0"], { encoding: "utf8", timeout: GIT_TIMEOUT_MS });
      cachedShCommand = command;
      return cachedShCommand;
    } catch {
    }
  }
  throw new Error("no sh executable found for the Git Hook preflight (Git for Windows installs one)");
}

async function invokeHook(path, args, cwd, env = {}) {
  const command = process.platform === "win32" ? await resolveShCommand() : path;
  const argv = process.platform === "win32" ? [path, ...args] : args;
  try {
    const result = await execFileAsync(command, argv, { cwd, env: cleanGitEnvironment(env), encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: typeof error?.code === "number" ? error.code : 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? String(error?.message || error) };
  }
}

const PREFLIGHT_PATH = "ldvh-base/preflight-probe.md";

async function seedPreflightIndex(identity, tempDir) {
  const blobFile = join(tempDir, "preflight-blob");
  const preflightIndex = join(tempDir, "preflight-index");
  await writeFile(blobFile, "ldvh-preflight\n", "utf8");
  const blob = await runGit(identity.projectRoot, ["hash-object", "-w", blobFile]);
  try {
    await runGit(identity.projectRoot, ["read-tree", "HEAD"], { env: { GIT_INDEX_FILE: preflightIndex } });
  } catch {
  }
  await runGit(identity.projectRoot, ["update-index", "--add", "--cacheinfo", `100644,${blob},${PREFLIGHT_PATH}`], { env: { GIT_INDEX_FILE: preflightIndex } });
  return preflightIndex;
}

async function seedPreflightRoute(tempDir) {
  const home = join(tempDir, "route-home");
  const sessionId = "ldvh-preflight";
  const dir = join(home, "sessions", "preflight", sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "session.v3.jsonl"), [
    JSON.stringify({ type: "session", id: sessionId }),
    JSON.stringify({ type: "model/selection", data: { provider: "deepseek-harness", model: "preflight" } }),
  ].join("\n"), "utf8");
  return { DSH_HOME: home, DSH_SESSION_ID: sessionId };
}

async function preflight(rendered, identity, spec, workspaceRoot) {
  const tempDir = join(identity.gitCommonDir, `ldvh-preflight-${process.pid}-${randomUUID().slice(0, 8)}`);
  const hook = join(tempDir, spec.name);
  const marker = interpreterUnavailableMarker(spec.name);
  try {
    await mkdir(tempDir, { mode: 0o700 });
    await writeFile(hook, rendered, { mode: 0o755 });
    const preflightIndex = await seedPreflightIndex(identity, tempDir);
    const hookEnv = { LDVH_WORKSPACE_ROOT: workspaceRoot };
    if (spec.argument === "message-file") {
      const invalid = join(tempDir, "invalid-message");
      const valid = join(tempDir, "valid-message");
      await writeFile(invalid, "bad\n", "utf8");
      await writeFile(valid, `chore(code): 预检\n\n关键变更:\n- add ${PREFLIGHT_PATH} synthetic index entry\n\nLDVH-Provider: deepseek-harness\nLDVH-Model: preflight\n`, "utf8");
      Object.assign(hookEnv, await seedPreflightRoute(tempDir));
      const blocked = invokeHook(hook, [invalid], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: preflightIndex });
      const allowed = invokeHook(hook, [valid], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: preflightIndex });
      const [blockedResult, allowedResult] = await Promise.all([blocked, allowed]);
      if (blockedResult.code === 0) throw new Error("Git Hook preflight did not block an invalid message");
      if (blockedResult.stderr.includes(marker)) throw new Error(`Git Hook preflight could not start the validator: ${blockedResult.stderr.trim()}`);
      if (allowedResult.code !== 0) throw new Error(`Git Hook preflight rejected a valid message: ${allowedResult.stderr || allowedResult.stdout}`);
      return;
    }
    const emptyIndex = join(tempDir, "empty-index");
    await runGit(identity.projectRoot, ["read-tree", "--empty"], { env: { GIT_INDEX_FILE: emptyIndex } });
    const refused = invokeHook(hook, [], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: emptyIndex });
    const accepted = invokeHook(hook, [], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: preflightIndex });
    const [refusedResult, acceptedResult] = await Promise.all([refused, accepted]);
    if (refusedResult.stderr.includes(marker)) throw new Error(`Git Hook preflight could not start the validator: ${refusedResult.stderr.trim()}`);
    if (refusedResult.code === 0) throw new Error("Git Hook preflight did not block an empty Index");
    if (acceptedResult.stderr.includes(marker)) throw new Error(`Git Hook preflight could not start the validator: ${acceptedResult.stderr.trim()}`);
    if (acceptedResult.code !== 0) throw new Error(`Git Hook preflight rejected a valid Index: ${acceptedResult.stderr || acceptedResult.stdout}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readOriginal(path) {
  try { return await readFile(path); } catch (error) { if (error?.code !== "ENOENT") throw error; return null; }
}

export async function installHook({ projectRoot, runnerPath, workspaceRoot }) {
  const identity = await resolveIdentity(projectRoot);
  const status = await inspectHook(projectRoot);
  if (status.state === "conflict" || status.state === "unavailable") return { ok: false, error: { code: "hook_conflict", message: status.detail, details: status } };
  const pending = [];
  for (const spec of MANAGED_HOOKS) {
    const current = status.hooks.find((hook) => hook.name === spec.name);
    if (current.state === "managed") continue;
    const rendered = renderHook({ runnerPath, workspaceRoot, hookName: spec.name });
    pending.push({ spec, rendered, original: readOriginal(identity.hookPaths[spec.name]) });
  }
  const originals = await Promise.all(pending.map((entry) => entry.original));
  await Promise.all(pending.map((entry) => preflight(entry.rendered, identity, entry.spec, dirname(dirname(resolve(runnerPath))))));
  const plans = pending.map((entry, index) => ({ spec: entry.spec, rendered: entry.rendered, original: originals[index] }));
  const replaced = [];
  try {
    for (const plan of plans) {
      const hookPath = identity.hookPaths[plan.spec.name];
      await atomicReplace(hookPath, plan.rendered, plan.original);
      replaced.push({ hookPath, original: plan.original });
    }
  } catch (error) {
    const rollback = [];
    for (const entry of replaced.reverse()) {
      try {
        if (entry.original === null) await rm(entry.hookPath, { force: true });
        else await atomicReplace(entry.hookPath, entry.original, await readOriginal(entry.hookPath));
      } catch (rollbackError) {
        rollback.push(`${entry.hookPath}: ${String(rollbackError?.message || rollbackError)}`);
      }
    }
    return { ok: false, error: { code: "hook_install_failed", message: String(error?.message || error), details: { identity, rollback, rewritten: replaced.length } } };
  }
  const after = await inspectHook(projectRoot);
  return after.state === "managed"
    ? { ok: true, value: { ...after, rewritten: replaced.length } }
    : { ok: false, error: { code: "hook_verify_failed", message: after.detail, details: after } };
}

export async function uninstallHook(projectRoot) {
  const status = await inspectHook(projectRoot);
  if (status.hooks.every((hook) => hook.state === "absent")) return { ok: true, value: status };
  const removable = [];
  for (const hook of status.hooks) {
    if (hook.state === "absent") continue;
    if (!["managed", "outdated"].includes(hook.state)) return { ok: false, error: { code: "hook_conflict", message: `${hook.name}: ${hook.detail}`, details: status } };
    let before;
    try { before = await readFile(hook.hookPath, "utf8"); } catch (error) { return { ok: false, error: { code: "hook_uninstall_failed", message: String(error?.message || error), details: status } }; }
    const parsed = parseManagedHook(before);
    if (!parsed.owned || !parsed.valid) return { ok: false, error: { code: "hook_conflict", message: `managed ${hook.name} Hook changed before removal`, details: status } };
    removable.push(hook);
  }
  for (const hook of removable) {
    try {
      await rm(hook.hookPath);
    } catch (error) {
      return { ok: false, error: { code: "hook_uninstall_failed", message: String(error?.message || error), details: { status, removed: removable.length } } };
    }
  }
  return { ok: true, value: await inspectHook(projectRoot) };
}

export { cleanGitEnvironment, parseManagedHook, resolveIdentity, resolveShCommand };
