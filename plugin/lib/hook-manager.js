import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MARKER_PREFIX = "# ldvh-native-commit-msg-hook: v1 sha256:";
const VERSION_PREFIX = "# ldvh-hook-bundle-version: ";
const GIT_TIMEOUT_MS = 10000;

/**
 * Every Git Hook this manager owns, in the order they run during a commit.
 *
 * Why a list and not a single `hookPath`: the manager was written when only
 * commit-msg existed, so "the Hook" was the identity's one hardcoded path
 * (`join(hookDirectory, "commit-msg")`). Adding pre-commit means the same
 * install/inspect/uninstall paths must address TWO files, and the state the
 * rest of the system reads must answer "is this project's gate healthy?",
 * not "what does one arbitrary file look like" — see `inspectHook`'s rollup.
 *
 * `code` is the runner command the rendered Hook invokes, and `argument` says
 * how the Hook receives its parameters: "message-file" for the commit-msg
 * Hook (git passes the message path as $1), null for pre-commit, which git
 * invokes with no arguments at all.
 */
export const MANAGED_HOOKS = Object.freeze([
  Object.freeze({ name: "commit-msg", code: "git-commit-msg", argument: "message-file" }),
  Object.freeze({ name: "pre-commit", code: "git-pre-commit", argument: null })
]);

const DEFAULT_HOOK_NAME = "commit-msg";
// The Hook bundle version is the ONLY propagation channel for a change to the
// Hook body: `inspectHook` compares it against this constant, so an installed
// Hook whose body changes without this value changing stays `managed` forever
// and is never refreshed (the client only offers repair for absent/outdated).
// Bump it whenever `renderHook` changes what it emits — this is this constant's
// job, not a mirror of `package.json.version`.
//
// 1.0.0-dev.3: the bundle now owns TWO Hooks (commit-msg + pre-commit), and the
// commit-msg body is byte-identical to dev.2 apart from the marker's Hook name.
// The bump is still mandatory — without it an installation carrying only
// commit-msg would stay `managed` forever and never receive its pre-commit half.
export const HOOK_BUNDLE_VERSION = "1.0.0-dev.3";

/**
 * Emitted by the Hook itself when it cannot find a node interpreter.
 *
 * Why a shared constant: before this, the Hook called bare `exec node`, so a
 * PATH without node made the shell fail with `exec: node: not found` (exit 127
 * from the shell, normalized to 1 by git). Exit codes therefore carried two
 * unrelated meanings — "the validator rejected this message" and "the validator
 * could not be started" — and `preflight` asserted only `code !== 0`, so it
 * accepted the interpreter failure as proof that blocking works (friction
 * 6cb53179). The marker lets the caller separate the two, since the exit code
 * cannot. Exported so tests assert the same string.
 */
export const INTERPRETER_UNAVAILABLE_PREFIX = "LDVH Git Gate cannot run: no node interpreter found";

/**
 * The commit-msg-era spelling of the marker above. Kept because the message
 * itself names the Hook it belongs to; every new Hook renders its own name
 * into the same sentence so `preflight` can assert the marker it expects.
 */
export const INTERPRETER_UNAVAILABLE_MARKER = `LDVH Git Gate (commit-msg) cannot run: no node interpreter found`;

function interpreterUnavailableMarker(hookName) {
  return hookName === DEFAULT_HOOK_NAME ? INTERPRETER_UNAVAILABLE_MARKER : `LDVH Git Gate (${hookName}) cannot run: no node interpreter found`;
}

/**
 * Interpreter candidates tried in order, as shell words.
 *
 * The absolute path is baked first so a PATH without node still works. It is
 * NOT sufficient on its own: a node upgrade or a relocated install invalidates
 * it, so the PATH names must remain as a fallback — otherwise this fix would
 * trade a partial failure for a harder one.
 */
function defaultInterpreterCandidates() {
  const baked = typeof process.execPath === "string" && process.execPath.length > 0 ? [process.execPath] : [];
  return [...baked, "node", "nodejs"];
}

/** Single-quote a shell word, escaping embedded single quotes. */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

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
  // Git prints forward slashes even on Windows while realpath returns native
  // separators; resolve() normalizes both sides so only a REAL symlink
  // traversal (a genuinely different resolved path) fails this check.
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
  // Each candidate is probed, then used as an argv[0] word — never spliced into
  // an unquoted position (a candidate may contain spaces, e.g. an app bundle
  // path inside /Applications). Every item but the last needs a backslash so the
  // `for ... in` list is one continued logical line; without them the list ends
  // at the first newline and the shell reports a syntax error.
  const probes = interpreterCandidates
    .map((candidate, index) => `${index === interpreterCandidates.length - 1 ? "  " : "    "}${shellQuote(candidate)}${index === interpreterCandidates.length - 1 ? "" : " \\"}`)
    .join("\n");
  // The argument handling differs per Hook and cannot be shared: git hands
  // commit-msg the message path as $1 and calls pre-commit with NO arguments,
  // so the commit-msg body's `[ "$#" -ne 1 ]` guard would reject every
  // pre-commit invocation outright.
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
    // The preflight passes a synthetic index through LDVH_PREFLIGHT_INDEX so
    // the gate proves its real diff path without touching the worktree's
    // staging state; real commits never set this variable.
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
    // Fail CLOSED and say why: the exit code cannot carry this meaning (git
    // normalizes 126/127/1 all to 1), so the distinction has to ride on stderr.
    `  printf "%s\\n" ${shellQuote(interpreterUnavailableMarker(spec.name))} >&2`,
    "  exit 127",
    "fi",
    // ELECTRON_RUN_AS_NODE: when the host is Electron (DSH Desktop), the baked
    // absolute path is the Electron binary. Without this flag it would start as
    // an application instead of an interpreter and exit 0 on the single-instance
    // lock — i.e. the gate would PASS without validating anything (a fail-open).
    // The same hazard is handled this way by web-mount.js. Harmless for plain
    // node, which ignores the variable.
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
  return parsed.version === HOOK_BUNDLE_VERSION
    ? { name: spec.name, hookPath, state: "managed", detail: "LDVH Git Hook is current", hookBundleVersion: parsed.version }
    : { name: spec.name, hookPath, state: "outdated", detail: `LDVH Git Hook ${parsed.version ?? "unknown"} requires update`, hookBundleVersion: parsed.version };
}

/**
 * Severity order used for the rollup: the FIRST state present wins, so the
 * rollup reports the worst thing found rather than the last thing inspected.
 *
 * "managed" is last because it is the only healthy state. `absent` outranks
 * `outdated`: an outdated Hook still blocks (its body runs, just an older
 * version of it), while a missing one means that half of the gate does not
 * exist — reporting `outdated` for a project whose pre-commit is entirely
 * missing would understate the gap. `conflict` stays first for the original
 * reason: a foreign Hook is never overwritten, and the caller must see it
 * before anything proposes a repair.
 */
const HOOK_STATE_SEVERITY = Object.freeze(["conflict", "unavailable", "absent", "outdated", "managed"]);

/**
 * Inspect ONE project's Hooks and roll them up into a single status.
 *
 * The returned object keeps its pre-pre-commit shape (`state`, `detail`,
 * `hookBundleVersion`, `expectedHookBundleVersion`, and the identity fields)
 * because every consumer — the CLI list, the installation transaction, the
 * Host API JSON — asks the same question: "is this project's gate healthy?".
 * None of them ever needed to know WHICH Hook a state described, so the
 * rollup answers the question they actually ask instead of widening the
 * contract and leaving two representations of the same fact. Per-Hook detail
 * rides in `hooks[]` for diagnosis.
 *
 * `hookPath` remains the commit-msg path so old readers keep resolving it;
 * `hooks[].hookPath` carries the path for each individual Hook.
 */
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
  // A healthy rollup is the common case and every existing reader asserts this
  // exact string, so the single-Hook wording is preserved verbatim. Anything
  // else names the offending Hook(s): a bare "not installed" must not leave
  // the reader guessing which half of the gate is gone.
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
  // Git for Windows ships sh.exe but does NOT put it on PATH (only cmd/ is);
  // real Git hook execution uses Git's own sh regardless of PATH, so only the
  // Node-side preflight needs this resolution. Derive candidates from the
  // resolvable git executable, then fall back to PATH lookup.
  const candidates = [];
  try {
    const execPath = (await execFileAsync("git", ["--exec-path"], { encoding: "utf8", timeout: GIT_TIMEOUT_MS })).stdout.trim();
    if (execPath) {
      const gitRoot = resolve(execPath, "..", "..", "..");
      candidates.push(join(gitRoot, "bin", "sh.exe"), join(gitRoot, "usr", "bin", "sh.exe"));
    }
  } catch {
    /* git resolution failed; fall through to the PATH candidates */
  }
  candidates.push("sh.exe", "sh");
  for (const command of candidates) {
    try {
      await execFileAsync(command, ["-c", "exit 0"], { encoding: "utf8", timeout: GIT_TIMEOUT_MS });
      cachedShCommand = command;
      return cachedShCommand;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("no sh executable found for the Git Hook preflight (Git for Windows installs one)");
}

async function invokeHook(path, args, cwd, env = {}) {
  // git invokes pre-commit with no arguments; commit-msg gets the message
  // path. The array form keeps that difference explicit instead of relying on
  // the caller passing undefined.
  const command = process.platform === "win32" ? await resolveShCommand() : path;
  const argv = process.platform === "win32" ? [path, ...args] : args;
  try {
    const result = await execFileAsync(command, argv, { cwd, env: cleanGitEnvironment(env), encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: typeof error?.code === "number" ? error.code : 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? String(error?.message || error) };
  }
}

/**
 * Build the synthetic Index the preflight runs against.
 *
 * Shared by both Hooks because the reason is the same for both: it keeps the
 * preflight independent of the worktree's transient staging state, so the gate
 * proves its real `git diff --cached` path without requiring the user to have
 * something staged at install/update time. Seeded from HEAD because
 * `git diff --cached` compares the index against HEAD — without the read-tree
 * a repository with history would diff "delete every tracked file" (megabytes)
 * and blow the runner's maxBuffer. The orphan blob is garbage-collectable and
 * the temp dir is removed by the caller's finally.
 */
async function seedPreflightIndex(identity, tempDir) {
  const blobFile = join(tempDir, "preflight-blob");
  const preflightIndex = join(tempDir, "preflight-index");
  await writeFile(blobFile, "ldvh-preflight\n", "utf8");
  const blob = await runGit(identity.projectRoot, ["hash-object", "-w", blobFile]);
  try {
    await runGit(identity.projectRoot, ["read-tree", "HEAD"], { env: { GIT_INDEX_FILE: preflightIndex } });
  } catch {
    /* no HEAD yet (empty repository): start from the empty tree */
  }
  await runGit(identity.projectRoot, ["update-index", "--add", "--cacheinfo", `100644,${blob},ldvh-preflight`], { env: { GIT_INDEX_FILE: preflightIndex } });
  return preflightIndex;
}

/**
 * Prove a rendered Hook actually blocks before it is installed.
 *
 * The two Hooks prove different things, because they receive different input:
 *   - commit-msg: an invalid and a valid message, asserting "blocks the bad,
 *     lets the good through";
 *   - pre-commit: no message exists to vary, so it asserts the two things that
 *     must hold for the Hook to be load-bearing at all — it RUNS to completion
 *     (a synthetic valid Index, exit 0) and it REFUSES an empty Index (exit
 *     non-zero). The second is what distinguishes a working gate from a script
 *     that silently exits 0.
 *
 * Both share the same fail-closed subtlety (friction 6cb53179): a nonzero exit
 * is NOT proof of blocking, because the Hook also exits nonzero when it cannot
 * start the validator. The interpreter marker is the only reliable signal, so
 * each Hook asserts the marker that carries ITS OWN name.
 */
async function preflight(rendered, identity, spec, workspaceRoot) {
  const tempDir = join(identity.gitCommonDir, `ldvh-preflight-${process.pid}-${Date.now()}`);
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
      await writeFile(valid, "chore(code): 预检\n\n关键变更:\n- add ldvh-preflight synthetic index entry\n\nLDVH-Provider: deepseek-harness\nLDVH-Model: preflight\n", "utf8");
      const blocked = await invokeHook(hook, [invalid], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: preflightIndex });
      if (blocked.code === 0) throw new Error("Git Hook preflight did not block an invalid message");
      if (blocked.stderr.includes(marker)) throw new Error(`Git Hook preflight could not start the validator: ${blocked.stderr.trim()}`);
      const allowed = await invokeHook(hook, [valid], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: preflightIndex });
      if (allowed.code !== 0) throw new Error(`Git Hook preflight rejected a valid message: ${allowed.stderr || allowed.stdout}`);
      return;
    }
    // pre-commit: a Hook that cannot even run is the fail-open this branch
    // exists to catch, so an empty Index must be refused.
    const emptyIndex = join(tempDir, "empty-index");
    await runGit(identity.projectRoot, ["read-tree", "--empty"], { env: { GIT_INDEX_FILE: emptyIndex } });
    const refused = await invokeHook(hook, [], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: emptyIndex });
    if (refused.stderr.includes(marker)) throw new Error(`Git Hook preflight could not start the validator: ${refused.stderr.trim()}`);
    if (refused.code === 0) throw new Error("Git Hook preflight did not block an empty Index");
    const accepted = await invokeHook(hook, [], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: preflightIndex });
    if (accepted.stderr.includes(marker)) throw new Error(`Git Hook preflight could not start the validator: ${accepted.stderr.trim()}`);
    if (accepted.code !== 0) throw new Error(`Git Hook preflight rejected a valid Index: ${accepted.stderr || accepted.stdout}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readOriginal(path) {
  try { return await readFile(path); } catch (error) { if (error?.code !== "ENOENT") throw error; return null; }
}

/**
 * Install every managed Hook that is missing or outdated.
 *
 * Refuses wholesale on conflict/unavailable. The refusal is all-or-nothing on
 * purpose: a foreign pre-commit belongs to the user, and half-installing the
 * bundle would leave the project with a commit-msg that runs newer code than
 * its pre-commit — two Hook bodies from two different bundle versions.
 *
 * Failure during the multi-file write rolls back the files this call already
 * replaced, restoring their previous bytes, so a mid-install error (a Hook
 * that raced, a permission problem, a failing preflight) never leaves an
 * unknown mix behind. `rewritten` counts how many Hook files actually changed,
 * which is what "was there anything to repair?" really means — the old code
 * inferred it from the pre-install state and so could not tell "already
 * current" from "repaired".
 */
export async function installHook({ projectRoot, runnerPath, workspaceRoot }) {
  const identity = await resolveIdentity(projectRoot);
  const status = await inspectHook(projectRoot);
  if (status.state === "conflict" || status.state === "unavailable") return { ok: false, error: { code: "hook_conflict", message: status.detail, details: status } };
  // Render + prove EVERY Hook before touching the disk: a preflight failure on
  // the second Hook must not leave the first one already replaced.
  const plans = [];
  for (const spec of MANAGED_HOOKS) {
    const current = status.hooks.find((hook) => hook.name === spec.name);
    if (current.state === "managed") continue;
    const rendered = renderHook({ runnerPath, workspaceRoot, hookName: spec.name });
    // The preflight tells the Hook which workspace's lint to enforce. It is
    // NOT the install caller's `workspaceRoot`: that is the governed project
    // being hooked, whose lint surface is unrelated to this plugin's. The lint
    // configuration that must pass belongs to the tree the RUNNER lives in,
    // so it is derived from runnerPath — the only argument that is guaranteed
    // to name this plugin's own checkout (link installs, self-governing repos
    // and test fixtures all differ in projectRoot, and a fixture has no
    // node_modules at all).
    await preflight(rendered, identity, spec, dirname(dirname(resolve(runnerPath))));
    plans.push({ spec, rendered, original: await readOriginal(identity.hookPaths[spec.name]) });
  }
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

/**
 * Remove every managed Hook. Absent ones are skipped rather than reported.
 *
 * A conflict on ANY Hook aborts the whole removal before any file is touched:
 * deleting the commit-msg of a project whose pre-commit belongs to someone
 * else would leave a half-managed state that the next install then refuses to
 * repair (it sees the same conflict).
 */
export async function uninstallHook(projectRoot) {
  const status = await inspectHook(projectRoot);
  if (status.state === "absent") return { ok: true, value: status };
  if (!['managed', 'outdated'].includes(status.state)) return { ok: false, error: { code: "hook_conflict", message: status.detail, details: status } };
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
