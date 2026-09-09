import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MARKER_PREFIX = "# ldvh-native-commit-msg-hook: v1 sha256:";
const VERSION_PREFIX = "# ldvh-hook-bundle-version: ";
const GIT_TIMEOUT_MS = 10000;
export const HOOK_BUNDLE_VERSION = "1.0.0-dev.1";

function cleanGitEnvironment(extra = {}) {
  // Strip AMBIENT Git override variables from the inherited environment
  // first, then apply the caller's explicit overrides on top: a value the
  // caller passes deliberately (e.g. a preflight GIT_INDEX_FILE) must win,
  // while ambient overrides from the surrounding shell never leak through.
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
  if (commonRaw !== commonDir) throw new Error("Git common-dir must not traverse a symbolic link");
  const hookDirectory = join(commonDir, "hooks");
  try {
    const hookStat = await lstat(hookDirectory);
    if (!hookStat.isDirectory() || hookStat.isSymbolicLink()) throw new Error("Git hooks path must be a regular directory");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { projectRoot: root, gitCommonDir: commonDir, hookDirectory, hookPath: join(hookDirectory, "commit-msg") };
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

export function renderHook({ runnerPath, workspaceRoot, bundleVersion = HOOK_BUNDLE_VERSION }) {
  const runner = `'${String(runnerPath).replaceAll("'", "'\\''")}'`;
  const workspace = `'${String(workspaceRoot).replaceAll("'", "'\\''")}'`;
  const body = [
    `${VERSION_PREFIX}${bundleVersion}`,
    "set -eu",
    'if [ "$#" -ne 1 ]; then',
    '  printf "%s\\n" "LDVH Git commit-msg Hook expected one message-file argument" >&2',
    "  exit 1",
    "fi",
    'worktree=$(git rev-parse --show-toplevel) || exit 1',
    'case "$1" in',
    '  /*|[A-Za-z]:\\\\*|//*) message_file=$1 ;;',
    '  *) message_file="$worktree/$1" ;;',
    "esac",
    `set -- git-commit-msg --workspace-root ${workspace} --worktree "$worktree" --message-file "$message_file"`,
    // The preflight passes a synthetic index through LDVH_PREFLIGHT_INDEX so
    // the gate proves its real diff path without touching the worktree's
    // staging state; real commits never set this variable.
    'if [ -n "${LDVH_PREFLIGHT_INDEX:-}" ]; then',
    '  set -- "$@" --index-file "$LDVH_PREFLIGHT_INDEX"',
    "fi",
    `exec node ${runner} "$@"`,
    ""
  ].join("\n");
  return `#!/bin/sh\n${MARKER_PREFIX}${digest(body)}\n${body}`;
}

export async function inspectHook(candidate) {
  let identity;
  try {
    identity = await resolveIdentity(candidate);
  } catch (error) {
    return { state: "unavailable", detail: String(error?.message || error), expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
  }
  let content;
  try {
    content = await readFile(identity.hookPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { ...identity, state: "absent", detail: "Git Hook is not installed", hookBundleVersion: null, expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
    return { ...identity, state: "unavailable", detail: String(error?.message || error), hookBundleVersion: null, expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
  }
  const parsed = parseManagedHook(content);
  if (!parsed.owned) return { ...identity, state: "conflict", detail: "an unmanaged commit-msg Hook already exists", hookBundleVersion: null, expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
  if (!parsed.valid) return { ...identity, state: "conflict", detail: "the LDVH Hook marker digest does not match its body", hookBundleVersion: parsed.version, expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
  return parsed.version === HOOK_BUNDLE_VERSION
    ? { ...identity, state: "managed", detail: "LDVH Git Hook is current", hookBundleVersion: parsed.version, expectedHookBundleVersion: HOOK_BUNDLE_VERSION }
    : { ...identity, state: "outdated", detail: `LDVH Git Hook ${parsed.version ?? "unknown"} requires update`, hookBundleVersion: parsed.version, expectedHookBundleVersion: HOOK_BUNDLE_VERSION };
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

async function invokeHook(path, messageFile, cwd, env = {}) {
  const command = process.platform === "win32" ? "sh" : path;
  const args = process.platform === "win32" ? [path, messageFile] : [messageFile];
  try {
    const result = await execFileAsync(command, args, { cwd, env: cleanGitEnvironment(env), encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: typeof error?.code === "number" ? error.code : 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? String(error?.message || error) };
  }
}

async function preflight(rendered, identity) {
  const tempDir = join(identity.gitCommonDir, `ldvh-preflight-${process.pid}-${Date.now()}`);
  const hook = join(tempDir, "commit-msg");
  const invalid = join(tempDir, "invalid-message");
  const valid = join(tempDir, "valid-message");
  const blobFile = join(tempDir, "preflight-blob");
  const preflightIndex = join(tempDir, "preflight-index");
  try {
    await mkdir(tempDir, { mode: 0o700 });
    await writeFile(hook, rendered, { mode: 0o755 });
    await writeFile(invalid, "bad\n", "utf8");
    await writeFile(valid, "chore(code): preflight\n\n关键变更:\n- add ldvh-preflight synthetic index entry\n\nLDVH-Provider: deepseek-harness\nLDVH-Model: preflight\n", "utf8");
    // A synthetic index keeps the preflight independent of the worktree's
    // transient staging state: the gate proves its real `git diff --cached`
    // path against a known non-empty index instead of requiring the user
    // to have something staged at install/update time. `git diff --cached`
    // compares the index against HEAD, so the synthetic index must be seeded
    // from HEAD first — otherwise a repository with committed history would
    // diff "delete every tracked file" (megabytes) and blow the runner's
    // maxBuffer. On a repository without any commit, read-tree fails and the
    // single-entry index correctly diffs against the empty tree instead.
    // The orphan blob is garbage-collectable and the temp dir is removed in
    // finally.
    await writeFile(blobFile, "ldvh-preflight\n", "utf8");
    const blob = await runGit(identity.projectRoot, ["hash-object", "-w", blobFile]);
    try {
      await runGit(identity.projectRoot, ["read-tree", "HEAD"], { env: { GIT_INDEX_FILE: preflightIndex } });
    } catch {
      /* no HEAD yet (empty repository): start from the empty tree */
    }
    await runGit(identity.projectRoot, ["update-index", "--add", "--cacheinfo", `100644,${blob},ldvh-preflight`], { env: { GIT_INDEX_FILE: preflightIndex } });
    const blocked = await invokeHook(hook, invalid, identity.projectRoot, { LDVH_PREFLIGHT_INDEX: preflightIndex });
    if (blocked.code === 0) throw new Error("Git Hook preflight did not block an invalid message");
    const allowed = await invokeHook(hook, valid, identity.projectRoot, { LDVH_PREFLIGHT_INDEX: preflightIndex });
    if (allowed.code !== 0) throw new Error(`Git Hook preflight rejected a valid message: ${allowed.stderr || allowed.stdout}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function installHook({ projectRoot, runnerPath, workspaceRoot }) {
  const identity = await resolveIdentity(projectRoot);
  const status = await inspectHook(projectRoot);
  if (status.state === "conflict" || status.state === "unavailable") return { ok: false, error: { code: "hook_conflict", message: status.detail, details: status } };
  const rendered = renderHook({ runnerPath, workspaceRoot });
  await preflight(rendered, identity);
  let original = null;
  try { original = await readFile(identity.hookPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  try {
    await atomicReplace(identity.hookPath, rendered, original);
  } catch (error) {
    return { ok: false, error: { code: "hook_install_failed", message: String(error?.message || error), details: identity } };
  }
  const after = await inspectHook(projectRoot);
  return after.state === "managed" ? { ok: true, value: after } : { ok: false, error: { code: "hook_verify_failed", message: after.detail, details: after } };
}

export async function uninstallHook(projectRoot) {
  const status = await inspectHook(projectRoot);
  if (status.state === "absent") return { ok: true, value: status };
  if (!['managed', 'outdated'].includes(status.state)) return { ok: false, error: { code: "hook_conflict", message: status.detail, details: status } };
  const before = await readFile(status.hookPath, "utf8");
  const parsed = parseManagedHook(before);
  if (!parsed.owned || !parsed.valid) return { ok: false, error: { code: "hook_conflict", message: "managed Hook changed before removal", details: status } };
  try {
    await rm(status.hookPath);
  } catch (error) {
    return { ok: false, error: { code: "hook_uninstall_failed", message: String(error?.message || error), details: status } };
  }
  return { ok: true, value: await inspectHook(projectRoot) };
}

export { cleanGitEnvironment, parseManagedHook, resolveIdentity };
