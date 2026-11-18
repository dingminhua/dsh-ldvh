
import { realpath } from "node:fs/promises";
import * as platformPath from "node:path";
import { readGovernedProjectIndex, resolveGitCommonDir } from "./governed-projects.js";

export function withinRoot(root, candidate, pathImpl = platformPath) {
  if (candidate === root) return true;
  const rel = pathImpl.relative(root, candidate);
  if (rel === "") return true;
  if (pathImpl.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${pathImpl.sep}`);
}

async function commonDirOf(path) {
  try {
    return await resolveGitCommonDir(path);
  } catch {
    return null;
  }
}

export async function resolveGovernanceScope(dshHomePath, cwd) {
  if (typeof dshHomePath !== "function") return { state: "unavailable", detail: "DSH user configuration root is unavailable" };
  if (typeof cwd !== "string" || cwd.length === 0) return { state: "unavailable", detail: "session working directory is unavailable" };
  const registration = await readGovernedProjectIndex(dshHomePath);
  if (!registration.ok) {
    return { state: "unavailable", detail: `governed-projects registration unavailable: ${registration.error.message}` };
  }
  let realCwd;
  try {
    realCwd = await realpath(cwd);
  } catch (error) {
    return { state: "unavailable", detail: `session working directory cannot be resolved: ${String(error?.message ?? error)}` };
  }
  if (registration.value.projects.length === 0) return { state: "not_governed", detail: "session working directory is not inside a registered governed project" };
  for (const project of registration.value.projects) {
    if (project.canonicalPath === null) continue;
    if (withinRoot(project.canonicalPath, realCwd)) {
      return {
        state: "governed",
        project: { id: project.id, path: project.path, name: project.name ?? null, description: project.description ?? null },
        registrationFingerprint: registration.value.fingerprint
      };
    }
  }
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
