import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function processStartMs({ nowMs = Date.now(), uptimeSec = process.uptime(), timeOriginMs } = {}) {
  const origin = timeOriginMs === undefined ? defaultTimeOrigin() : timeOriginMs;
  const fromUptime = nowMs - uptimeSec * 1000;
  if (typeof origin !== "number" || !Number.isFinite(origin)) return fromUptime;
  return Math.max(origin, fromUptime);
}

function defaultTimeOrigin() {
  try {
    const origin = globalThis.performance?.timeOrigin;
    return typeof origin === "number" && Number.isFinite(origin) ? origin : null;
  } catch {
    return null;
  }
}

export function detectStaleModules({ files, startMs, statMtimeMs }) {
  const stale = [];
  const unreadable = [];
  for (const file of files) {
    const mtime = statMtimeMs(file);
    if (mtime === null) {
      unreadable.push(file);
      continue;
    }
    if (mtime > startMs) stale.push({ file, mtime_ms: Math.round(mtime) });
  }
  return { stale, unreadable, checked: files.length };
}

export function statMtimeOrNull(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

export const VALIDATOR_MODULE_FILES = Object.freeze([
  fileURLToPath(new URL("./commit-validation.js", import.meta.url)),
  fileURLToPath(new URL("./ldvh-tools.js", import.meta.url)),
  fileURLToPath(new URL("./spec-registry.js", import.meta.url)),
]);

export function detectStaleValidatorModules({ files = VALIDATOR_MODULE_FILES, clock, statMtimeMs = statMtimeOrNull } = {}) {
  const startMs = processStartMs(clock);
  return { ...detectStaleModules({ files, startMs, statMtimeMs }), start_ms: Math.round(startMs) };
}

export function listLibraryModuleFiles(libraryDir) {
  const self = fileURLToPath(import.meta.url);
  const dir = libraryDir ?? dirname(self);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(dir, name))
    .filter((file) => file !== self);
}

export function detectStaleLibraryModules({ libraryDir, clock, statMtimeMs = statMtimeOrNull } = {}) {
  const files = listLibraryModuleFiles(libraryDir);
  const startMs = processStartMs(clock);
  return {
    ...detectStaleModules({ files, startMs, statMtimeMs }),
    start_ms: Math.round(startMs),
    library_dir: libraryDir ?? dirname(fileURLToPath(import.meta.url)),
  };
}
