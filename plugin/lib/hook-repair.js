import { readGovernedProjects } from "./governed-projects.js";
import { installHook } from "./hook-manager.js";

const REPAIRABLE = Object.freeze(["absent", "outdated"]);

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
