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
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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

/**
 * `plugin/lib` 下全部模块（workcase-e487cdf4）。
 *
 * 与 {@link VALIDATOR_MODULE_FILES} 的关系：后者是**precheck 专用子集**（只有那两个
 * 文件的旧代码会改变 precheck 结论）；本集合是**全量**——`plugin/lib` 里任何模块比
 * 进程新，都意味着运行实例的某部分行为与磁盘不一致。二者判据同一（都是文件 mtime
 * 对进程启动时刻），区别只在受检范围，故共用 {@link detectStaleModules}，不另立判据。
 *
 * 为什么需要全量：precheck 之外还有九十余个模块（工具注册、各类写入器、召回、投影），
 * 它们的陈旧此前无人可见——改完某个写入器后工具面仍跑旧逻辑，而没有任何地方提示。
 *
 * 排除项只有本模块自身：它陈旧时其判据仍成立（比的是「文件 mtime 对进程启动」，
 * 这个逻辑不随版本变化），把它算进去会在每次改本文件后自我误报。
 *
 * 该集合运行时枚举、**不写死清单**——写死会在新增模块时静默漏检，而那正是本单要
 * 消除的失败形态。
 *
 * @param {string} [libraryDir] 省略时取本模块所在目录。
 * @returns {string[]} 绝对路径清单（已排除本模块）。
 */
export function listLibraryModuleFiles(libraryDir) {
  const self = fileURLToPath(import.meta.url);
  // `new URL(".", ...)` 的 fileURLToPath 带尾斜杠，直接拼会产出 `lib//x.js`；
  // 用 dirname(自身路径) 与 join 保证与 `self` 同一规范化形态，排除才可比。
  const dir = libraryDir ?? dirname(self);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(dir, name))
    .filter((file) => file !== self);
}

/**
 * 全量检测：`plugin/lib` 下哪些模块比本进程新。
 *
 * 与 {@link detectStaleValidatorModules} 同形返回，便于调用方统一处理；差别只在
 * 受检集合。**结论只用于如实报告**：本函数不参与任何判定语义，不得据以拒绝写入
 * 或改写预检 `verdict`（workcase-e487cdf4 的 scope 第三条边界）。
 *
 * @param {{libraryDir?: string, clock?: object, statMtimeMs?: (f: string) => number|null}} [options]
 */
export function detectStaleLibraryModules({ libraryDir, clock, statMtimeMs = statMtimeOrNull } = {}) {
  const files = listLibraryModuleFiles(libraryDir);
  const startMs = processStartMs(clock);
  return {
    ...detectStaleModules({ files, startMs, statMtimeMs }),
    start_ms: Math.round(startMs),
    library_dir: libraryDir ?? dirname(fileURLToPath(import.meta.url)),
  };
}
