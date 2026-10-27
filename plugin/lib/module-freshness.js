// 宿主进程内的模块陈旧检测（friction-fbd65401）。
//
// ## 为什么需要它
//
// LDVH 插件以**长驻宿主进程**运行，ESM 模块在首次 import 时被缓存，此后进程内
// 的代码就是**那一刻**的版本。而本仓的主干工作循环恰恰是「就地改 `plugin/lib/*.js`
// → 立刻用同一会话的 precheck 验证」——此时 precheck 跑的是**改动前的旧代码**，
// 却以 `failed` 的形态回报（09 §5.4 的三值语义里，`failed` 意为「确认未通过」）。
//
// 实测（账目 `fbd65401`）：同一候选，宿主内 precheck 连续两次报 `failed`，而
// `node plugin/lib/git-gate-runner.js`（每次新起进程、读到新代码）报 `passed`。
// 危害不是「结论错」本身，而是**错的方向会诱导人去改候选去迎合**——本次即先误判
// 为检查范围过宽，据此收窄了范围。
//
// ## 判据
//
// 唯一的确定性事实是：**进程启动时刻**早于**模块文件的最后修改时刻**时，进程内
// 持有的那份代码必然不是磁盘上的现行版本。故比较二者即可，不需要读模块内容、
// 不需要版本号、不需要任何启发式。
//
// 三个边界（如实声明，不得读作更强的保证）：
//   * 只覆盖「文件 mtime 晚于进程启动」这一种陈旧形态。文件被改而 mtime 未变
//     （如某些检出/回滚路径）时检测不到——这属不可判定，本模块不声称覆盖。
//   * 不判断**陈旧的方向**：不知道旧代码是更宽还是更严，故只能报「不可判定」，
//     不得据此把 `failed` 改判为 `passed`。
//   * 模块文件读不到时**不判陈旧**（不可读 ≠ 陈旧），而是把它记进 `unreadable`
//     由调用方如实披露——把「读不到」当「陈旧」会在每次正常提交时报错。
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 进程启动时刻（毫秒时间戳）。
 *
 * 用 `Date.now() - uptime` 反推，而不是读 `/proc` 或 `ps`——后者在 Windows 与
 * 沙箱里不可用，而 `process.uptime()` 是跨平台的。
 *
 * @param {{nowMs?: number, uptimeSec?: number}} [clock] 注入用；生产不传。
 * @returns {number} 毫秒时间戳。
 */
export function processStartMs({ nowMs = Date.now(), uptimeSec = process.uptime() } = {}) {
  return nowMs - uptimeSec * 1000;
}

/**
 * 比对一组模块文件的 mtime 与进程启动时刻，返回其中**必然陈旧**者。
 *
 * @param {object} input
 * @param {string[]} input.files 待检查的绝对路径。
 * @param {number} input.startMs 进程启动时刻（见 {@link processStartMs}）。
 * @param {(file: string) => number|null} input.statMtimeMs 取 mtime 的毫秒值；
 *   读不到时返回 null（调用方把它记进 `unreadable`，不当作陈旧）。
 * @returns {{stale: Array<{file: string, mtime_ms: number}>, unreadable: string[], checked: number}}
 */
export function detectStaleModules({ files, startMs, statMtimeMs }) {
  const stale = [];
  const unreadable = [];
  for (const file of files) {
    const mtime = statMtimeMs(file);
    if (mtime === null) {
      unreadable.push(file);
      continue;
    }
    // 严格大于：文件与进程启动在同一毫秒时无法区分先后，按「未陈旧」处理——
    // 宁可漏报一次（下一次提交即会命中），不可在正常提交上误报。
    if (mtime > startMs) stale.push({ file, mtime_ms: Math.round(mtime) });
  }
  return { stale, unreadable, checked: files.length };
}

/** 默认的 mtime 读取器：读不到一律 null（不抛）。 */
export function statMtimeOrNull(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * 受检查的模块集合：precheck 结论由这些文件里的代码决定。
 *
 * 只列**判定逻辑本体**，不列本模块自身（本模块陈旧时其判据仍成立：它比的是
 * 「文件 mtime vs 进程启动」，这个逻辑不随版本变化）。`git-gate-runner.js` 不列：
 * Git Gate 每次新起进程，天然不受陈旧影响（09 §5.5）。
 */
export const VALIDATOR_MODULE_FILES = Object.freeze([
  fileURLToPath(new URL("./commit-validation.js", import.meta.url)),
  fileURLToPath(new URL("./ldvh-tools.js", import.meta.url)),
]);

/**
 * 生产入口：检查 validator 模块是否陈旧于当前进程。
 *
 * @param {{files?: string[], clock?: object, statMtimeMs?: (f: string) => number|null}} [options]
 * @returns {{stale: Array<{file: string, mtime_ms: number}>, unreadable: string[], checked: number, start_ms: number}}
 */
export function detectStaleValidatorModules({ files = VALIDATOR_MODULE_FILES, clock, statMtimeMs = statMtimeOrNull } = {}) {
  const startMs = processStartMs(clock);
  return { ...detectStaleModules({ files, startMs, statMtimeMs }), start_ms: Math.round(startMs) };
}
