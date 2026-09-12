import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { HOOK_BUNDLE_VERSION, inspectHook, installHook, uninstallHook as removeManagedHook } from "./hook-manager.js";

const execFileAsync = promisify(execFile);
const REGISTRATION_RELATIVE_PATH = ["ldvh", "governed-projects.yaml"];
// v5 事实类型目录（03 §6.1 类型短名的复数形态）。20/21/22/23/24/25/26/27 各自落盘：
// sparks(20) workcases(21) adrs(22) pitfalls(23) researches(24) frictions(26) norms(27)。
// 25 Goal 为单例，落 ldvh-base/goal.md，不占目录。
// 注：frictions 与 norms 曾漏于本清单（friction-writer.js 会写 frictions/，27 号定义 norms/），
// 已按类型短名复数惯例补齐。
const FACT_DIRECTORIES = ["sparks", "workcases", "adrs", "pitfalls", "researches", "frictions", "norms"];

/**
 * 07 §5.4 precondition vocabulary. The registration entries are enabled only
 * after 08 has verified cross-workspace write permission and the carrier has
 * been confirmed by a Human Gate; while any precondition is unmet the entry
 * must report `unavailable` with the precise reason from this closed set and
 * must not be presented as executable.
 */
export const REGISTRATION_UNAVAILABLE_CODES = Object.freeze({
  USER_CONFIG_ROOT_UNAVAILABLE: "user_config_root_unavailable",
  CARRIER_UNAVAILABLE: "registration_carrier_unavailable",
  PERMISSION_UNVERIFIED: "registration_permission_unverified",
  ACCESS_DENIED: "registration_access_denied",
  SCHEMA_INVALID: "registration_schema_invalid"
});

function unavailable(code, message, details = {}) {
  return { ok: false, unavailable: true, error: { code, message, details } };
}

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

function registrationPath(dshHomePath) {
  return dshHomePath(...REGISTRATION_RELATIVE_PATH);
}

function fingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function emptyDocument() {
  return {
    schema_version: 1,
    governance_instance_name: "DSH Project LDVH Governance",
    product_description: "LDVH governed projects for this DSH user configuration.",
    projects: [],
    default_project_id: ""
  };
}

function validateDocument(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("registration root must be a mapping");
  if (value.schema_version !== 1) throw new Error("schema_version must be 1");
  if (typeof value.governance_instance_name !== "string" || value.governance_instance_name.trim().length === 0) throw new Error("governance_instance_name must be non-empty");
  if (typeof value.product_description !== "string" || value.product_description.trim().length === 0) throw new Error("product_description must be non-empty");
  if (!Array.isArray(value.projects)) throw new Error("projects must be an array");
  if (typeof value.default_project_id !== "string") throw new Error("default_project_id must be a string");
  const ids = new Set();
  const paths = new Set();
  const projects = value.projects.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`projects[${index}] must be a mapping`);
    if (typeof entry.id !== "string" || entry.id.trim().length === 0) throw new Error(`projects[${index}].id must be non-empty`);
    if (typeof entry.path !== "string" || entry.path.trim().length === 0) throw new Error(`projects[${index}].path must be non-empty`);
    if (ids.has(entry.id)) throw new Error(`duplicate project id: ${entry.id}`);
    if (paths.has(entry.path)) throw new Error(`duplicate project path: ${entry.path}`);
    ids.add(entry.id);
    paths.add(entry.path);
    const projected = { id: entry.id, path: entry.path };
    if (entry.name !== void 0) {
      if (typeof entry.name !== "string" || entry.name.trim().length === 0) throw new Error(`projects[${index}].name must be non-empty when present`);
      projected.name = entry.name;
    }
    if (entry.description !== void 0) {
      if (typeof entry.description !== "string" || entry.description.trim().length === 0) throw new Error(`projects[${index}].description must be non-empty when present`);
      projected.description = entry.description;
    }
    return projected;
  });
  if (projects.length === 0 && value.default_project_id !== "") throw new Error("default_project_id must be empty when projects is empty");
  if (projects.length > 0 && !ids.has(value.default_project_id)) throw new Error("default_project_id must identify one registered project");
  return {
    schema_version: 1,
    governance_instance_name: value.governance_instance_name,
    product_description: value.product_description,
    projects,
    default_project_id: value.default_project_id
  };
}

async function readRegistration(dshHomePath) {
  const path = registrationPath(dshHomePath);
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { path, exists: false, document: emptyDocument(), fingerprint: null };
    throw error;
  }
  return { path, exists: true, document: validateDocument(parseYaml(content)), fingerprint: fingerprint(content) };
}

async function git(worktree, args) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of Object.keys(env)) if (key === "GIT_CONFIG_COUNT" || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_") || ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"].includes(key)) delete env[key];
  try {
    const result = await execFileAsync("git", ["-C", worktree, ...args], { env, encoding: "utf8", timeout: 10000 });
    return result.stdout.trim();
  } catch (error) {
    const detail = String(error?.stderr || error?.stdout || error?.message || error).trim();
    throw new Error(detail || "Git inspection failed");
  }
}

export async function resolveGitRoot(candidate) {
  if (typeof candidate !== "string" || candidate.trim().length === 0 || !isAbsolute(candidate)) throw new Error("project path must be a non-empty absolute path");
  const requested = await realpath(candidate);
  const stat = await lstat(requested);
  if (!stat.isDirectory()) throw new Error("project path must be a directory");
  const root = await git(requested, ["rev-parse", "--show-toplevel"]);
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== requested) throw new Error("selected directory must be the Git root, not a subdirectory");
  const bare = await git(requested, ["rev-parse", "--is-bare-repository"]);
  if (bare === "true") throw new Error("bare Git repositories cannot be governed projects");
  const common = await git(requested, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const commonDir = await realpath(common);
  return { projectRoot: canonicalRoot, gitCommonDir: commonDir };
}

/**
 * Resolve the Git common-dir for an arbitrary path inside a work tree.
 * Authority: 07 §5.3 — linked worktrees are identified deterministically
 * through the common-dir (`git rev-parse --git-common-dir`), never through
 * branch, remote or a stored worktree list. A main worktree and every one of
 * its linked worktrees share exactly one common-dir, while their toplevels
 * differ; that is what makes the containment check below work for a linked
 * worktree whose toplevel is NOT the registered root.
 *
 * Throws when the path is not inside a work tree (not a repository) or Git
 * is unavailable — callers treat that as "no common-dir", not as a match.
 */
export async function resolveGitCommonDir(candidate) {
  if (typeof candidate !== "string" || candidate.trim().length === 0 || !isAbsolute(candidate)) throw new Error("path must be a non-empty absolute path");
  const requested = await realpath(candidate);
  const common = await git(requested, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return realpath(common);
}

async function factSourceStatus(projectRoot) {
  const root = join(projectRoot, "ldvh-base");
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { state: "conflict", detail: "ldvh-base exists but is not a regular directory" };
    const missing = [];
    for (const name of FACT_DIRECTORIES) {
      try {
        const child = await lstat(join(root, name));
        if (!child.isDirectory() || child.isSymbolicLink()) missing.push(name);
      } catch (error) {
        if (error?.code === "ENOENT") missing.push(name);
        else throw error;
      }
    }
    return missing.length === 0 ? { state: "ready", detail: "ldvh-base is initialized" } : { state: "incomplete", detail: `missing fact directories: ${missing.join(", ")}` };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "absent", detail: "ldvh-base is not initialized" };
    return { state: "unavailable", detail: String(error?.message || error) };
  }
}

export async function inspectCandidate(candidate) {
  try {
    const identity = await resolveGitRoot(candidate);
    return success({ ...identity, factSource: await factSourceStatus(identity.projectRoot), hook: await inspectHook(identity.projectRoot) });
  } catch (error) {
    return failure("candidate_invalid", String(error?.message || error));
  }
}

export async function readGovernedProjects(dshHomePath) {
  try {
    const registration = await readRegistration(dshHomePath);
    const projects = [];
    for (const project of registration.document.projects) {
      const inspected = await inspectCandidate(project.path);
      projects.push({ ...project, status: inspected.ok ? inspected.value : { error: inspected.error } });
    }
    return success({ initialized: registration.exists, projects, defaultProjectId: registration.document.default_project_id, fingerprint: registration.fingerprint });
  } catch (error) {
    return failure("registration_unavailable", String(error?.message || error));
  }
}

/**
 * LIGHTWEIGHT registration index for the high-frequency governance-scope
 * entry point (specs/07 judgement runs on every prompt assembly and every
 * tool call; specs/08 §6.2 rate discipline). Unlike readGovernedProjects it
 * performs NO per-project inspection — no git subprocess, no hook check, no
 * fact-source stat — only the single YAML registration read, parse and
 * fingerprint. Result projects carry plain registration fields (id, path,
 * name, description) with status left undefined when no inspection data
 * exists (the scope judge must not treat missing status as a failure).
 *
 * NO CACHING (Human gate 2026-09-03): every call reads and parses the
 * registration carrier from disk. The earlier mtime cache was removed because
 * 07 §5.3 forbids "using cache to backfill a judgement" — the authority for
 * every judgement must be the current file content, not a memo. The cost of
 * a single YAML read + parse is microseconds; the former 104 ms bottleneck
 * was a git-inspection subprocess that has already been removed, so no cache
 * is needed for speed either. Canonical project roots are still pre-resolved
 * once per call (per-carrier-change realpath), because that is part of the
 * judgement semantics, not a cache.
 */
export async function readGovernedProjectIndex(dshHomePath) {
  const path = registrationPath(dshHomePath);
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return success({ initialized: false, projects: [], defaultProjectId: "", fingerprint: null });
    }
    return failure("registration_unavailable", String(error?.message || error));
  }
  try {
    const registration = await readRegistration(dshHomePath);
    // Pre-resolve each registered project's canonical root ONCE per call
    // (install-time paths are already canonical; this also absorbs a
    // hand-edited alias like /var vs /private/var on macOS). The judgement
    // hot path then does zero fs calls per project — a pure string compare.
    const projects = [];
    for (const project of registration.document.projects) {
      let canonicalPath = null;
      try {
        canonicalPath = await realpath(project.path);
      } catch {
        canonicalPath = null; // registered root vanished: carried as non-matchable
      }
      projects.push({ ...project, canonicalPath });
    }
    return success({
      initialized: registration.exists,
      projects,
      defaultProjectId: registration.document.default_project_id,
      fingerprint: registration.fingerprint
    });
  } catch (error) {
    return failure("registration_unavailable", String(error?.message || error));
  }
}

export async function initializeFactSource(projectRoot) {
  const root = join(projectRoot, "ldvh-base");
  await mkdir(root, { recursive: true });
  for (const name of FACT_DIRECTORIES) await mkdir(join(root, name), { recursive: true });
  return factSourceStatus(projectRoot);
}

export async function ensureRegistrationCarrier(dshHomePath) {
  const filename = registrationPath(dshHomePath);
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  return withFileLock(filename, async () => {
    const current = await readRegistration(dshHomePath);
    if (current.exists) return { created: false, fingerprint: current.fingerprint };
    const content = stringifyYaml(emptyDocument());
    await writeFileAtomic(filename, content, { mode: 0o600, dirMode: 0o700 });
    return { created: true, fingerprint: fingerprint(content) };
  });
}

export async function registerProject(dshHomePath, input) {
  const identity = await resolveGitRoot(input.path);
  const filename = registrationPath(dshHomePath);
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  return withFileLock(filename, async () => {
    const current = await readRegistration(dshHomePath);
    if (input.expectedFingerprint !== void 0 && input.expectedFingerprint !== current.fingerprint) return failure("conflict", "governed projects changed; refresh before retrying");
    const same = current.document.projects.find((entry) => entry.id === input.id && entry.path === identity.projectRoot);
    if (same !== void 0) return success(current);
    if (current.document.projects.some((entry) => entry.id === input.id || entry.path === identity.projectRoot)) return failure("conflict", "project id or path is already registered to another entry");
    const next = validateDocument({
      ...current.document,
      projects: [...current.document.projects, { id: input.id, path: identity.projectRoot, ...(input.name ? { name: input.name } : {}), ...(input.description ? { description: input.description } : {}) }],
      default_project_id: current.document.projects.length === 0 ? input.id : current.document.default_project_id
    });
    await writeFileAtomic(filename, stringifyYaml(next), { mode: 0o600, dirMode: 0o700 });
    return success(await readRegistration(dshHomePath));
  });
}

export async function installProject(dshHomePath, input, runtime) {
  const candidate = await inspectCandidate(input.path);
  if (!candidate.ok) return candidate;
  const before = candidate.value;
  const factBefore = before.factSource;
  const hookBefore = before.hook;
  if (hookBefore.state === "conflict" || hookBefore.state === "unavailable") return failure("hook_conflict", hookBefore.detail, before);
  let factCreated = false;
  let hookInstalled = false;
  try {
    if (factBefore.state === "absent" || factBefore.state === "incomplete") {
      const factAfter = await initializeFactSource(before.projectRoot);
      if (factAfter.state !== "ready") throw new Error(factAfter.detail);
      factCreated = factBefore.state === "absent";
    } else if (factBefore.state !== "ready") throw new Error(factBefore.detail);
    const hookResult = await installHook({ projectRoot: before.projectRoot, runnerPath: runtime.runnerPath, workspaceRoot: runtime.workspaceRoot });
    if (!hookResult.ok) throw new Error(hookResult.error.message);
    hookInstalled = hookBefore.state !== "managed";
    const registered = await registerProject(dshHomePath, input);
    if (!registered.ok) throw new Error(registered.error.message);
    return success({ registration: registered.value, status: (await inspectCandidate(before.projectRoot)).value });
  } catch (error) {
    const rollback = [];
    if (hookInstalled) {
      const removed = await removeManagedHook(before.projectRoot);
      if (!removed.ok) rollback.push(removed.error.message);
    }
    if (factCreated) {
      const { readdir, rm } = await import("node:fs/promises");
      const root = join(before.projectRoot, "ldvh-base");
      try {
        const entries = await readdir(root, { recursive: true });
        if (entries.every((entry) => FACT_DIRECTORIES.includes(entry))) await rm(root, { recursive: true, force: true });
        else rollback.push("new ldvh-base contains unexpected content and was preserved");
      } catch (rollbackError) { rollback.push(String(rollbackError?.message || rollbackError)); }
    }
    return failure("installation_failed", String(error?.message || error), { rollback });
  }
}

export async function uninstallHook(candidate) {
  return removeManagedHook(candidate);
}

export async function unregisterProject(dshHomePath, input) {
  const identity = await resolveGitRoot(input.path);
  const removedHook = await removeManagedHook(identity.projectRoot);
  if (!removedHook.ok) return removedHook;
  const filename = registrationPath(dshHomePath);
  return withFileLock(filename, async () => {
    const current = await readRegistration(dshHomePath);
    if (input.expectedFingerprint !== void 0 && input.expectedFingerprint !== current.fingerprint) return failure("conflict", "governed projects changed; refresh before retrying");
    const removed = current.document.projects.find((entry) => entry.id === input.id && entry.path === identity.projectRoot);
    if (removed === void 0) return failure("not_registered", "project is not registered with the supplied id and path");
    const projects = current.document.projects.filter((entry) => entry !== removed);
    const requestedDefault = input.nextDefaultProjectId;
    let defaultProjectId = current.document.default_project_id;
    if (defaultProjectId === input.id) {
      if (projects.length === 0) defaultProjectId = "";
      else if (typeof requestedDefault === "string" && projects.some((entry) => entry.id === requestedDefault)) defaultProjectId = requestedDefault;
      else return failure("default_required", "removing the default project requires nextDefaultProjectId");
    }
    const next = validateDocument({ ...current.document, projects, default_project_id: defaultProjectId });
    await writeFileAtomic(filename, stringifyYaml(next), { mode: 0o600, dirMode: 0o700 });
    return success({ registration: await readRegistration(dshHomePath), hook: removedHook.value, factSourcePreserved: join(identity.projectRoot, "ldvh-base") });
  });
}

/**
 * Evaluate the 07 §5.4 preconditions for the AI registration entry.
 * Preconditions are checked in the spec's reported order; the first unmet one
 * decides the reported code. This never writes anything.
 *
 * The carrier is owned by this plugin's install transaction and is created on
 * startup (ensureRegistrationCarrier), so a missing carrier directory is a
 * real precondition failure, not something this entry silently creates.
 */
export async function evaluateRegistrationEntry(dshHomePath) {
  if (typeof dshHomePath !== "function") {
    return unavailable(REGISTRATION_UNAVAILABLE_CODES.USER_CONFIG_ROOT_UNAVAILABLE, "DSH user configuration root is unavailable");
  }
  let root;
  try {
    root = dirname(registrationPath(dshHomePath));
  } catch (error) {
    return unavailable(REGISTRATION_UNAVAILABLE_CODES.USER_CONFIG_ROOT_UNAVAILABLE, `DSH user configuration root is unavailable: ${String(error?.message || error)}`);
  }
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch (error) {
    return unavailable(REGISTRATION_UNAVAILABLE_CODES.CARRIER_UNAVAILABLE, `registration carrier directory is unavailable: ${String(error?.message || error)}`, { path: root });
  }
  if (!rootStat.isDirectory()) {
    return unavailable(REGISTRATION_UNAVAILABLE_CODES.CARRIER_UNAVAILABLE, "registration carrier path exists but is not a directory", { path: root });
  }
  // 07 §5.6: Unix directory/files are 0700/0600. A carrier whose mode grants
  // group/other access is out of contract and the entry must not silently
  // "fix" it; the caller sees the precise reason instead.
  if (process.platform === "win32") {
    // 07 §5.6 Windows clause: inherit the DSH user-config ACL, never fake POSIX
    // mode; when the ACL cannot be verified the high-risk write must
    // fail-closed. This implementation has no ACL verifier, so the honest
    // outcome is `registration_permission_unverified` — NOT a silent pass.
    // Reporting success here would be exactly the "claim protection the seam
    // did not deliver" failure 08 §6 forbids.
    return unavailable(
      REGISTRATION_UNAVAILABLE_CODES.PERMISSION_UNVERIFIED,
      "registration carrier ACL cannot be verified on this platform (07 §5.6: high-risk writes fail closed)",
      { path: root, platform: process.platform }
    );
  }
  {
    const writable = (rootStat.mode & 0o700) === 0o700;
    const overShared = (rootStat.mode & 0o077) !== 0;
    if (!writable) {
      return unavailable(REGISTRATION_UNAVAILABLE_CODES.ACCESS_DENIED, "registration carrier directory is not writable by the current user", { path: root, mode: rootStat.mode & 0o777 });
    }
    if (overShared) {
      return unavailable(REGISTRATION_UNAVAILABLE_CODES.PERMISSION_UNVERIFIED, "registration carrier directory permission is wider than 0700 (07 §5.6)", { path: root, mode: rootStat.mode & 0o777 });
    }
  }
  try {
    const current = await readRegistration(dshHomePath);
    if (current.exists && current.document === void 0) {
      return unavailable(REGISTRATION_UNAVAILABLE_CODES.SCHEMA_INVALID, "registration carrier does not satisfy the v5 schema (07 §5.2)");
    }
    return { ok: true, value: { carrier: current.path, exists: current.exists, fingerprint: current.fingerprint } };
  } catch (error) {
    return unavailable(REGISTRATION_UNAVAILABLE_CODES.SCHEMA_INVALID, `registration carrier is not parseable or violates the schema: ${String(error?.message || error)}`);
  }
}

/**
 * 07 §5.4 AI entry: register the current project as LDVH-governed.
 *
 * Contract (this is the "AI 入口" clause, not the install flow):
 *  1. the current project must not already be in the list — the entry first
 *     reads the carrier and refuses to write a duplicate (no repeat write);
 *  2. the entry only proceeds when every 07 §5.4 precondition holds;
 *  3. the write is atomic and conflict-rejecting (07 §5.6), then read back.
 *
 * Unlike installProject this entry deliberately does NOT initialize a fact
 * source or install a Git hook: 07 §5.4 governs registration only, and the
 * hook/fact-source lifecycle belongs to the install transaction.
 */
export async function registerProjectFromEntry(dshHomePath, input) {
  const preconditions = await evaluateRegistrationEntry(dshHomePath);
  if (!preconditions.ok) return preconditions;
  if (typeof input?.id !== "string" || input.id.trim().length === 0) return failure("invalid_input", "id must be a non-empty string");
  let identity;
  try {
    identity = await resolveGitRoot(input.path);
  } catch (error) {
    return failure("candidate_invalid", String(error?.message || error));
  }
  const filename = registrationPath(dshHomePath);
  return withFileLock(filename, async () => {
    const current = await readRegistration(dshHomePath);
    if (input.expectedFingerprint !== void 0 && input.expectedFingerprint !== current.fingerprint) {
      return failure("conflict", "governed projects changed; refresh before retrying");
    }
    // 07 §5.4 step 1: confirm the current project is not already listed.
    if (current.document.projects.some((entry) => entry.path === identity.projectRoot)) {
      return success({ changed: false, reason: "already_registered", registration: { path: filename, fingerprint: current.fingerprint } });
    }
    if (current.document.projects.some((entry) => entry.id === input.id)) {
      return failure("conflict", "project id is already registered to another entry");
    }
    const next = validateDocument({
      ...current.document,
      projects: [...current.document.projects, { id: input.id, path: identity.projectRoot, ...(input.name ? { name: input.name } : {}), ...(input.description ? { description: input.description } : {}) }],
      default_project_id: current.document.projects.length === 0 ? input.id : current.document.default_project_id
    });
    await writeFileAtomic(filename, stringifyYaml(next), { mode: 0o600, dirMode: 0o700 });
    // 07 §5.6: re-read and re-parse after the atomic replace.
    const readBack = await readRegistration(dshHomePath);
    return success({
      changed: true,
      project: { id: input.id, path: identity.projectRoot, gitCommonDir: identity.gitCommonDir },
      registration: { path: filename, fingerprint: readBack.fingerprint }
    });
  });
}

export { HOOK_BUNDLE_VERSION };
