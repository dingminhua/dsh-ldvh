
import { open as fsOpen, readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOCK_STALE_MS = 30 * 60 * 1000;

const LOCK_RELATIVE_DIR = ["ldvh", "friction-promotion-locks"];

function lockPath(dshHomePath, projectId) {
  const base = typeof dshHomePath === "function" ? dshHomePath(...LOCK_RELATIVE_DIR) : null;
  if (base === null) return null;
  const safe = String(projectId).replace(/[^A-Za-z0-9._-]/g, "_");
  return join(base, `${safe}.lock`);
}

async function readLock(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { corrupt: true, reason: String(error?.message ?? error) };
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : { corrupt: true, reason: "not an object" };
  } catch {
    return { corrupt: true, reason: "not JSON" };
  }
}

export async function isFrictionPromotionRunning(dshHomePath, projectId) {
  const path = lockPath(dshHomePath, projectId);
  if (path === null) {
    return { busy: true, reason: "no-home-cannot-determine", startedAt: null };
  }
  const lock = await readLock(path);
  if (lock === null) return { busy: false, reason: "idle", startedAt: null };
  if (lock.corrupt === true) {
    return { busy: true, reason: `lock-corrupt:${lock.reason}`, startedAt: null };
  }
  const startedAtMs = Date.parse(String(lock.startedAt ?? ""));
  const age = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : Number.POSITIVE_INFINITY;
  if (age > LOCK_STALE_MS) {
    return { busy: false, reason: "stale-lock", startedAt: lock.startedAt ?? null, holder: lock };
  }
  return { busy: true, reason: "review-in-flight", startedAt: lock.startedAt ?? null, holder: lock };
}

export async function runFrictionPromotionExclusive({ dshHomePath, projectId, sessionId, fn }) {
  const path = lockPath(dshHomePath, projectId);
  if (path === null) {
    return { skipped: true, reason: "no-home-cannot-lock" };
  }
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
  }

  const startedAt = new Date().toISOString();
  const payload = JSON.stringify({ projectId, sessionId: sessionId ?? null, startedAt, pid: process.pid });

  const tryCreate = async () => {
    const handle = await fsOpen(path, "wx");
    try {
      await handle.writeFile(payload, "utf8");
    } finally {
      await handle.close();
    }
  };

  try {
    await tryCreate();
  } catch (error) {
    if (error?.code !== "EEXIST") {
      return { skipped: true, reason: `lock-unavailable:${error?.code ?? "unknown"}` };
    }
    const state = await isFrictionPromotionRunning(dshHomePath, projectId);
    if (state.busy) {
      return { skipped: true, reason: state.reason };
    }
    try {
      await unlink(path);
    } catch (unlinkError) {
      if (unlinkError?.code !== "ENOENT") {
        return { skipped: true, reason: `stale-lock-unlink-failed:${unlinkError?.code ?? "unknown"}` };
      }
    }
    try {
      await tryCreate();
    } catch (retryError) {
      if (retryError?.code === "EEXIST") {
        return { skipped: true, reason: "review-in-flight" };
      }
      return { skipped: true, reason: `lock-unavailable:${retryError?.code ?? "unknown"}` };
    }
  }

  try {
    return { skipped: false, value: await fn() };
  } finally {
    try {
      const current = await readLock(path);
      if (current !== null && current.corrupt !== true && current.startedAt === startedAt) {
        await unlink(path);
      }
    } catch {
    }
  }
}

export function frictionPromotionLockPath(dshHomePath, projectId) {
  return lockPath(dshHomePath, projectId);
}

export const REVIEW_LOCK_STALE_MS = LOCK_STALE_MS;

export async function writeFrictionPromotionLockForTest(dshHomePath, projectId, payload) {
  const path = lockPath(dshHomePath, projectId);
  if (path === null) return null;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload), "utf8");
  return path;
}
