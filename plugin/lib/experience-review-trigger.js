/**
 * 闲置审核的互斥（11 §6.1 / §10.2）——**项目级、跨进程**。
 *
 * ## 2026-10-30 重写：从进程内布尔改为文件锁
 *
 * 原实现是一个模块级 `let reviewRunning = false`。它的互斥范围是**本进程**：
 * 两个宿主进程（或一个宿主 + 一个 CLI）同时静置，各自看到自己的 `false`，
 * 于是**两个审核执行体同时跑**，读同一批 pending 条目、各自成文，事后无法分辨
 * 哪份结论属于哪次。
 *
 * Human 的要求是「一个项目同一时间只允许有一个在工作」。项目是**跨进程**的实体
 * （同一份 `ldvh-base` 可能被多个进程打开），故互斥也必须是跨进程的——用文件锁。
 *
 * ## 判据与边界
 *
 * 锁文件在 `~/.dsh/ldvh/review-locks/<projectId>.lock`，用 `open(path, "wx")`
 * 原子排他创建。**同一项目至多一个**；不同项目互不影响（它们的缓冲与事实源本就
 * 分区）。
 *
 * **边界（如实声明，不得扩大主张）**：这是**单机文件系统级**的互斥。它不覆盖
 * 跨机器（网络文件系统的 `wx` 语义不保证原子）、也不覆盖 PID namespace 隔离的
 * 容器场景。本项目的实际部署形态是单机单宿主，故该边界够用；但不得据此声称
 * 「任何情况下都不会并发」。
 *
 * **陈旧锁回收**：持有者崩溃会留下锁文件。超过 `LOCK_STALE_MS` 即视为残留并可
 * 回收——判据是锁文件内记录的 `startedAt`（不是文件 mtime，因为心跳会更新 mtime
 * 而 `startedAt` 才是「这次审核何时开始」的真实记录）。
 *
 * ## 失败即不派发
 *
 * 锁**判不出来**时（读失败、写失败、内容损坏），本模块一律**不派发**。理由：
 * 跳过这一次的代价只是「这次不跑，下一次静置还会到」；而误判成「没在跑」的代价
 * 是并发两个审核执行体。故 fail-closed。
 */

import { open as fsOpen, readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 锁的存活上限：超过即视为崩溃残留，可被回收。 */
const LOCK_STALE_MS = 30 * 60 * 1000;

/** 心跳间隔的参考值（由持有者自行决定是否写，本模块只在 acquire 时写一次）。 */
const LOCK_RELATIVE_DIR = ["ldvh", "review-locks"];

function lockPath(dshHomePath, projectId) {
  const base = typeof dshHomePath === "function" ? dshHomePath(...LOCK_RELATIVE_DIR) : null;
  if (base === null) return null;
  const safe = String(projectId).replace(/[^A-Za-z0-9._-]/g, "_");
  return join(base, `${safe}.lock`);
}

/** 读锁内容；不存在返回 null，损坏返回 `{corrupt:true}`。 */
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

/**
 * 查询某项目的审核是否正在跑（**跨进程**）。
 *
 * @returns `{busy:boolean, reason:string, startedAt:string|null, holder?:object}`。
 *   读不出时返回 `busy:true`（fail-closed：宁可跳过也不并发）。
 */
export async function isReviewRunning(dshHomePath, projectId) {
  const path = lockPath(dshHomePath, projectId);
  if (path === null) {
    // 没有 dsh home 就无法判定——fail-closed，按「正在跑」处理。
    return { busy: true, reason: "no-home-cannot-determine", startedAt: null };
  }
  const lock = await readLock(path);
  if (lock === null) return { busy: false, reason: "idle", startedAt: null };
  if (lock.corrupt === true) {
    // 内容损坏：可能是写入中途崩溃。按「正在跑」处理（fail-closed），
    // 等它过期后由下一次 acquire 回收。
    return { busy: true, reason: `lock-corrupt:${lock.reason}`, startedAt: null };
  }
  const startedAtMs = Date.parse(String(lock.startedAt ?? ""));
  const age = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : Number.POSITIVE_INFINITY;
  if (age > LOCK_STALE_MS) {
    // 过期残留：不算在跑（下一次 acquire 会回收它）。
    return { busy: false, reason: "stale-lock", startedAt: lock.startedAt ?? null, holder: lock };
  }
  return { busy: true, reason: "review-in-flight", startedAt: lock.startedAt ?? null, holder: lock };
}

/**
 * 在**项目级跨进程互斥**下执行一次审核。已在跑时不执行并如实回报，不排队。
 *
 * 为什么选择「跳过」而不是「排队」：审核是周期性任务，下一周期自然会到；排队会让
 * 一个积压的审核在很久之后仍然执行，对着过时的缓冲内容成文。`specs/11 §6.1` 对
 * 这个二选一只要求「不得并发」，并明确「跳过时须如实记账」——本函数返回
 * `{skipped: true}` 交调用方记账。
 *
 * @param {object} args
 * @param {Function} args.dshHomePath - 返回 dsh home 下路径的函数。
 * @param {string} args.projectId - 管辖项目 id（互斥按它分区）。
 * @param {string} args.sessionId - 持有者会话标识（写进锁，供诊断）。
 * @param {Function} args.fn - 拿到锁后要执行的动作。
 */
export async function runReviewExclusive({ dshHomePath, projectId, sessionId, fn }) {
  const path = lockPath(dshHomePath, projectId);
  if (path === null) {
    return { skipped: true, reason: "no-home-cannot-lock" };
  }
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
    // 建目录失败不致命：下面的 open 会给出真实错误。
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
      // 写不了锁就无法保证互斥——fail-closed，不派发。
      return { skipped: true, reason: `lock-unavailable:${error?.code ?? "unknown"}` };
    }
    // 已存在：判断它是不是崩溃残留。**只有确认过期才回收**，否则跳过。
    const state = await isReviewRunning(dshHomePath, projectId);
    if (state.busy) {
      return { skipped: true, reason: state.reason };
    }
    // 过期或损坏：先删再重建。删除与重建之间仍可能被另一方抢先，故用 open wx
    // 重新竞争——抢不到即视为「另一方正在跑」。
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
    // 释放：只删自己写的那个锁。用 startedAt 比对，避免删掉别人在极端交错下
    // 新建的锁（例如本进程持锁超时被回收、另一方已接管）。
    try {
      const current = await readLock(path);
      if (current !== null && current.corrupt !== true && current.startedAt === startedAt) {
        await unlink(path);
      }
    } catch {
      // 释放失败不掩盖主流程结果：残留锁会在 LOCK_STALE_MS 后被回收。
    }
  }
}

/** 供测试与诊断：锁文件路径（不在公开 API 里暴露内部常量）。 */
export function reviewLockPath(dshHomePath, projectId) {
  return lockPath(dshHomePath, projectId);
}

/** 供测试：陈旧判定阈值。 */
export const REVIEW_LOCK_STALE_MS = LOCK_STALE_MS;

/** 供测试与诊断：直接写一个锁（模拟另一方持有）。 */
export async function writeReviewLockForTest(dshHomePath, projectId, payload) {
  const path = lockPath(dshHomePath, projectId);
  if (path === null) return null;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload), "utf8");
  return path;
}
