
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const RUNLOG_RELATIVE_PATH = ["ldvh", "idle-checkpoint-runs.json"];

const MAX_ENTRIES = 50;

function runLogPath(dshHomePath) {
  if (typeof dshHomePath !== "function") return null;
  try {
    const resolved = dshHomePath(...RUNLOG_RELATIVE_PATH);
    return typeof resolved === "string" && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

const runLogQueues = new Map();

function serialize(key, operation) {
  const previous = runLogQueues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  runLogQueues.set(key, tail);
  return previous
    .then(operation)
    .finally(() => {
      release();
      if (runLogQueues.get(key) === tail) runLogQueues.delete(key);
    });
}

async function readAll(dshHomePath) {
  const path = runLogPath(dshHomePath);
  if (path === null) {
    return failure("runlog/unavailable", "dshHomePath is not a callable home resolver (cannot locate the run-log carrier)");
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return failure("runlog/carrier_malformed", "the run-log carrier is not a JSON object");
    }
    if (!Array.isArray(parsed.runs)) {
      return failure("runlog/carrier_malformed", "the run-log carrier carries no `runs` array");
    }
    return success(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return success({ runs: [] });
    return failure("runlog/unreadable", `cannot read the run-log carrier: ${String(error?.message ?? error)}`);
  }
}

export async function recordRun(dshHomePath, entry = {}) {
  try {
    return await recordRunInner(dshHomePath, entry);
  } catch (error) {
    return failure("runlog/unavailable", `run-log recording threw: ${String(error?.message ?? error)}`);
  }
}

async function recordRunInner(dshHomePath, entry = {}) {
  const at = typeof entry.at === "string" && entry.at.length > 0 ? entry.at : new Date().toISOString();
  const record = { ...entry, at };
  if (typeof record.note === "string" && record.note.length > 300) {
    record.note = `${record.note.slice(0, 300)}…`;
  }

  const path = runLogPath(dshHomePath);
  if (path === null) {
    return failure("runlog/unavailable", "dshHomePath is not a callable home resolver (cannot locate the run-log carrier)");
  }

  return serialize(path, async () => {
    const doc = await readAll(dshHomePath);
    if (!doc.ok) return doc;
    const runs = [...doc.value.runs, record].slice(-MAX_ENTRIES);
    const temp = `${path}.tmp-${randomUUID()}`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, JSON.stringify({ runs }, null, 2), "utf8");
      await rename(temp, path);
    } catch (error) {
      return failure("runlog/unavailable", `cannot write the run-log carrier: ${String(error?.message ?? error)}`);
    }
    return success({ recorded: record, size: runs.length });
  });
}

export async function readRuns(dshHomePath, { limit, latest = false } = {}) {
  try {
    return await readRunsInner(dshHomePath, { limit, latest });
  } catch (error) {
    return failure("runlog/unavailable", `run-log read threw: ${String(error?.message ?? error)}`);
  }
}

async function readRunsInner(dshHomePath, { limit, latest = false } = {}) {
  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  const runs = doc.value.runs;
  if (latest) return success({ total: runs.length, run: runs.length > 0 ? runs[runs.length - 1] : null });
  const n = Number.isInteger(limit) && limit > 0 ? limit : runs.length;
  return success({ total: runs.length, runs: runs.slice(-n) });
}

export { RUNLOG_RELATIVE_PATH, MAX_ENTRIES };
