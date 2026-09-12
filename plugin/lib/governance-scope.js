// LDVH governance-scope resolution for a session working directory.
//
// Authority: specs/07 (registration carrier, schema, three-state judgement,
// fail-closed). This module only implements and consumes: it reuses the
// existing governed-projects.js registration reader (single implementation
// discipline, specs/09 §6) and maps a session cwd onto one of
// governed / not_governed / unavailable.
//
// Judgement chain (07 §5 semantics):
//   registration unreadable/corrupt  -> unavailable (fail-closed: never
//                                       guessed into governed or
//                                       not_governed)
//   cwd inside a registered project's
//   canonical Git root               -> governed (project identity attached)
//   otherwise                        -> not_governed
//
// v4 absorption: the "explicit locator first, no upward traversal" rule from
// v4 code/ldvh/governance/resolver.py is preserved in spirit — we match the
// cwd against registered roots directly and never walk up the filesystem
// looking for a project.

import { realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readGovernedProjectIndex, resolveGitCommonDir } from "./governed-projects.js";

const execFileAsync = promisify(execFile);

function withinRoot(root, candidate) {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith("/") ? root : root + "/");
}

/**
 * Resolve the cwd's own Git common-dir, or null when it is not inside a Git
 * work tree at all (or Git is unavailable). 07 §5.3: a linked worktree is
 * identified deterministically through the common-dir, never through branch,
 * remote or a stored worktree list.
 */
async function commonDirOf(path) {
  try {
    return await resolveGitCommonDir(path);
  } catch {
    return null;
  }
}

/**
 * Resolve the governance state for a session working directory.
 * `dshHomePath` is the DSH user-config root resolver (thunk style, same as
 * the rest of the plugin); `cwd` is the session's absolute working
 * directory. Returns a three-state result with the matched project on
 * governed and a precise reason otherwise.
 *
 * PERFORMANCE: this is the high-frequency entry point (every prompt
 * assembly and every tool call re-judges). It uses the LIGHTWEIGHT
 * registration index (single YAML read + fingerprint, NO per-project git /
 * hook / fact-source inspection) and one realpath of the cwd. A registered
 * project's canonical root is a plain field, not a live inspection, so the
 * whole judgement is one file read + a few string compares (~sub-millisecond
 * when the carrier is unchanged).
 */
export async function resolveGovernanceScope(dshHomePath, cwd) {
  if (typeof dshHomePath !== "function") return { state: "unavailable", detail: "DSH user configuration root is unavailable" };
  if (typeof cwd !== "string" || cwd.length === 0) return { state: "unavailable", detail: "session working directory is unavailable" };
  const registration = await readGovernedProjectIndex(dshHomePath);
  if (!registration.ok) {
    // 07 fail-closed: a broken carrier must not be guessed into either
    // governed or not_governed.
    return { state: "unavailable", detail: `governed-projects registration unavailable: ${registration.error.message}` };
  }
  // Validate the session directory FIRST (fail-closed: an unresolvable cwd
  // is unavailable, never guessed), then short-circuit an empty registration
  // (no project could possibly match — a pure memory answer).
  let realCwd;
  try {
    realCwd = await realpath(cwd);
  } catch (error) {
    return { state: "unavailable", detail: `session working directory cannot be resolved: ${String(error?.message ?? error)}` };
  }
  if (registration.value.projects.length === 0) return { state: "not_governed", detail: "session working directory is not inside a registered governed project" };
  for (const project of registration.value.projects) {
    // canonicalPath is pre-resolved in the index (once per carrier change);
    // null means the registered root vanished and cannot be a match. Only
    // direct containment of the cwd inside the registered root counts; the
    // reverse never does, and no upward traversal is performed (07 §5).
    if (project.canonicalPath === null) continue;
    if (withinRoot(project.canonicalPath, realCwd)) {
      return {
        state: "governed",
        project: { id: project.id, path: project.path, name: project.name ?? null, description: project.description ?? null },
        registrationFingerprint: registration.value.fingerprint
      };
    }
  }
  // 07 §5.3 linked-worktree clause: a linked worktree of a registered project
  // has a toplevel that is NOT the registered root, so the containment check
  // above cannot see it. Identity is then decided by the Git common-dir —
  // exactly one common-dir is shared by a main worktree and all of its linked
  // worktrees. This runs only after every direct containment check missed, so
  // the hot path (cwd inside the registered root) never pays for a subprocess.
  const cwdCommonDir = await commonDirOf(realCwd);
  if (cwdCommonDir !== null) {
    for (const project of registration.value.projects) {
      if (project.canonicalPath === null) continue;
      if (await commonDirOf(project.canonicalPath) === cwdCommonDir) {
        return {
          state: "governed",
          project: { id: project.id, path: project.path, name: project.name ?? null, description: project.description ?? null },
          registrationFingerprint: registration.value.fingerprint
        };
      }
    }
  }
  return { state: "not_governed", detail: "session working directory is not inside a registered governed project" };
}
