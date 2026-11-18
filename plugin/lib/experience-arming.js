
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";

const ARMING_RELATIVE_PATH = ["ldvh", "experience-arming.json"];

export const DEFAULT_ARM_TTL_MS = 15 * 60 * 1000;
export const MAX_ARM_TTL_MS = 60 * 60 * 1000;

const MAX_ENTRIES = 20;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function ok(value) { return { ok: true, value }; }
function fail(reason, detail) { return { ok: false, reason, ...(detail ? { detail } : {}) }; }

export function createExperienceArming({ dshHomePath, logger = console, now = () => Date.now() }) {
  const entries = new Map();
  let loaded = false;
  let loading = null;
  let writeChain = Promise.resolve();

  function path() {
    return dshHomePath(...ARMING_RELATIVE_PATH);
  }

  function prune() {
    const t = now();
    for (const [id, entry] of entries) {
      if (new Date(entry.expires_at).getTime() <= t) entries.delete(id);
    }
    while (entries.size > MAX_ENTRIES) {
      entries.delete(entries.keys().next().value);
    }
  }

  async function load() {
    if (loaded) return ok({ loaded: true, count: entries.size, source: "cache" });
    if (loading !== null) return loading;
    loading = (async () => {
      try {
        const text = await readFile(path(), "utf8");
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
        for (const entry of list) {
          if (!isNonEmptyString(entry?.arming_id) || !isNonEmptyString(entry?.parent_session_id)) continue;
          entries.set(entry.arming_id, entry);
        }
        prune();
        loaded = true;
        return ok({ loaded: true, count: entries.size, source: "file" });
      } catch (error) {
        loaded = true;
        if (error?.code !== "ENOENT") {
          logger.warn("[dsh-ldvh] experience arming ledger unreadable, treated as empty: %s", String(error?.message ?? error));
        }
        return ok({ loaded: true, count: 0, source: error?.code === "ENOENT" ? "absent" : "unreadable" });
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  async function mergeFromDisk(target) {
    let diskEntries = [];
    try {
      const parsed = JSON.parse(await readFile(target, "utf8"));
      if (Array.isArray(parsed?.entries)) diskEntries = parsed.entries;
    } catch (error) {
      if (error?.code !== "ENOENT" && error instanceof SyntaxError === false) throw error;
      if (error instanceof SyntaxError) {
        logger.warn("[dsh-ldvh] experience arming ledger is not valid JSON, merging as empty: %s", String(error?.message ?? error));
      }
    }
    for (const disk of diskEntries) {
      if (!isNonEmptyString(disk?.arming_id) || !isNonEmptyString(disk?.parent_session_id)) continue;
      const mine = entries.get(disk.arming_id);
      if (mine === undefined) { entries.set(disk.arming_id, disk); continue; }
      if (mine.child_session_id === null && isNonEmptyString(disk.child_session_id)) {
        entries.set(disk.arming_id, {
          ...mine,
          child_session_id: disk.child_session_id,
          consumed_at: disk.consumed_at ?? mine.consumed_at
        });
      }
    }
    prune();
  }

  function persist() {
    writeChain = writeChain.then(async () => {
      const target = path();
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await withFileLock(target, async () => {
        await mergeFromDisk(target);
        const snapshot = JSON.stringify({ version: 1, entries: [...entries.values()] }, null, 2);
        await writeFileAtomic(target, snapshot, { mode: 0o600, dirMode: 0o700 });
      });
    });
    return writeChain;
  }

  async function arm({ parentSessionId, projectPath, projectId, purpose, ttlMs }) {
    if (!isNonEmptyString(parentSessionId)) return fail("parent_session_id_required");
    if (!isNonEmptyString(projectPath)) return fail("project_path_required", "授权必须绑定到父会话判定的受辖项目（审核 B5）");
    if (!isNonEmptyString(purpose)) return fail("purpose_required", "一条没有用途的授权无法被事后读懂，故拒绝");
    const t = now();
    const raw = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, MAX_ARM_TTL_MS) : DEFAULT_ARM_TTL_MS;
    const entry = {
      arming_id: randomUUID(),
      parent_session_id: parentSessionId.trim(),
      child_session_id: null,
      project_path: resolve(projectPath),
      project_id: isNonEmptyString(projectId) ? projectId.trim() : null,
      purpose: purpose.trim(),
      armed_at: new Date(t).toISOString(),
      expires_at: new Date(t + raw).toISOString(),
      consumed_at: null
    };
    await load();
    prune();
    entries.set(entry.arming_id, entry);
    await persist();
    return ok({ arming: entry });
  }

  function bindForChild({ parentSessionId, childSessionId, projectPath }) {
    if (!loaded) return fail("ledger_not_loaded", "授权账尚未读回，按未授权处理（fail-closed）");
    if (!isNonEmptyString(parentSessionId) || !isNonEmptyString(childSessionId)) return fail("session_ids_required");
    prune();
    const wantProject = isNonEmptyString(projectPath) ? resolve(projectPath) : null;
    for (const entry of entries.values()) {
      if (entry.parent_session_id !== parentSessionId.trim()) continue;
      if (entry.child_session_id !== null && entry.child_session_id !== childSessionId) continue;
      if (wantProject !== null && resolve(entry.project_path) !== wantProject) continue;
      const rebinding = entry.child_session_id === childSessionId;
      entry.child_session_id = childSessionId;
      if (entry.consumed_at === null) entry.consumed_at = new Date(now()).toISOString();
      persist().catch((error) => {
        logger.warn("[dsh-ldvh] experience arming bind not persisted for %s: %s", childSessionId, String(error?.message ?? error));
      });
      return ok({ arming: entry, rebinding });
    }
    return fail("no_arming_for_parent");
  }

  function verifyWrite({ childSessionId, projectPath }) {
    if (!loaded) return fail("ledger_not_loaded");
    for (const entry of entries.values()) {
      if (entry.child_session_id !== childSessionId) continue;
      if (new Date(entry.expires_at).getTime() <= now()) {
        prune();
        return fail("arming_expired", "该分身的开工授权已过存活期；需主控重新记一条开工授权，不要重试");
      }
      if (isNonEmptyString(projectPath) && resolve(entry.project_path) !== resolve(projectPath)) {
        return fail("project_mismatch", "分身被授权的项目与本次写入判定的项目不一致（审核 B5）");
      }
      return ok({ arming: entry });
    }
    prune();
    return fail("child_not_armed");
  }

  function list() {
    prune();
    return [...entries.values()];
  }

  return { load, arm, bindForChild, verifyWrite, list, ledgerPath: path };
}
