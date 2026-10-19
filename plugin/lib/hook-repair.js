/**
 * Startup Hook repair: keep every governed project's Git Hooks in lockstep with
 * the bundle this plugin ships.
 *
 * WHY this lives at plugin load rather than only in the install transaction:
 * `installProject` installs the Hooks once, when the project is registered.
 * Everything after that — a bundle version bump, a new Hook in the bundle, a
 * `git init` that recreated `.git/hooks`, a bundle upgrade that changed the
 * runner path — changes what the project SHOULD have without touching the
 * registration. Without a startup check, a project registered two releases ago
 * keeps running its old Hook body forever, and the gate silently judges by
 * rules nobody currently maintains. Measured instance: 1.0.0-dev.2 shipped only
 * commit-msg, so every registered project lacked the pre-commit half entirely.
 *
 * WHAT is mechanical vs. what is not (Human decision, m01853):
 *   - absent / outdated → repaired automatically. These are states LDVH itself
 *     produced or owns; repairing them restores what the registration already
 *     promised, so no fresh consent is needed.
 *   - conflict         → reported, never touched. The Hook on disk belongs to
 *     someone else. Overwriting it would destroy a foreign gate, and LVH has no
 *     standing to decide that another tool's Hook is expendable.
 *   - unavailable      → reported, never touched. Not a repository (or no Git
 *     at all): installing a Hook there would create files in a directory the
 *     user never put under governance.
 *
 * FAILURE DISCIPLINE: this runs during plugin load, so it must never throw and
 * never block startup. A repair that fails leaves the project exactly as it was
 * and is reported in the returned summary; the user-visible surface (governed
 * project list, `hook` field) still shows the real state either way.
 */
import { readGovernedProjects } from "./governed-projects.js";
import { installHook } from "./hook-manager.js";

/** States this repair may change on its own (see the module comment). */
const REPAIRABLE = Object.freeze(["absent", "outdated"]);

/**
 * Repair every governed project whose Hooks are absent or outdated.
 *
 * @returns {Promise<{checked: number, repaired: string[], skipped: Array<{projectRoot: string, state: string, detail: string}>, failed: Array<{projectRoot: string, detail: string}>}>}
 *   Never throws: a registration that cannot be read yields `checked: 0` and a
 *   `failed` entry, because "could not check" must be visible rather than look
 *   like "nothing to repair".
 */
export async function repairHooksOnStartup({ dshHomePath, runnerPath, workspaceRoot, logger } = {}) {
  const summary = { checked: 0, repaired: [], skipped: [], failed: [] };
  let projects;
  try {
    const registration = await readGovernedProjects(dshHomePath);
    if (!registration.ok) {
      summary.failed.push({ projectRoot: null, detail: registration.error?.message ?? "registration unavailable" });
      return summary;
    }
    projects = registration.value.projects;
  } catch (error) {
    summary.failed.push({ projectRoot: null, detail: String(error?.message ?? error) });
    return summary;
  }

  for (const project of projects) {
    const status = project.status;
    // A project whose inspection failed has no Hook verdict to act on. Record
    // it: silently skipping is how a broken repository would go unnoticed.
    if (status?.error !== undefined) {
      summary.failed.push({ projectRoot: project.path ?? null, detail: status.error?.message ?? "inspection failed" });
      continue;
    }
    const hook = status?.hook;
    if (hook === undefined) continue;
    summary.checked += 1;
    if (hook.state === "managed") continue;
    if (!REPAIRABLE.includes(hook.state)) {
      summary.skipped.push({ projectRoot: status.projectRoot, state: hook.state, detail: hook.detail });
      continue;
    }
    try {
      const repaired = await installHook({ projectRoot: status.projectRoot, runnerPath, workspaceRoot });
      if (repaired.ok) {
        summary.repaired.push(status.projectRoot);
        logger?.info?.("[dsh-ldvh] repaired Git Hooks in %s (was %s)", status.projectRoot, hook.state);
      } else {
        summary.failed.push({ projectRoot: status.projectRoot, detail: repaired.error?.message ?? "install failed" });
        logger?.warn?.("[dsh-ldvh] Git Hook repair failed in %s: %s", status.projectRoot, repaired.error?.message ?? "install failed");
      }
    } catch (error) {
      summary.failed.push({ projectRoot: status.projectRoot, detail: String(error?.message ?? error) });
      logger?.warn?.("[dsh-ldvh] Git Hook repair threw in %s: %s", status.projectRoot, String(error?.message ?? error));
    }
  }

  for (const skip of summary.skipped) {
    logger?.warn?.("[dsh-ldvh] Git Hook not repaired in %s (%s): %s", skip.projectRoot, skip.state, skip.detail);
  }
  return summary;
}
