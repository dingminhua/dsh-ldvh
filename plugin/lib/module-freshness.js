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
 * 进程启动时刻（毫秒时间戳）——**取两个来源中更晚的那个，并优先信任 `timeOrigin`**。
 *
 * ## 为什么不再只用 `Date.now() - process.uptime()`
 *
 * 原实现只用 uptime 反推。跨平台上这是可用的，但 2026-11-15 实测出一次**真实的
 * 误报**：宿主进程 `ps` 显示启动于 04:49:34，而该函数反推出 03:26:42——**早了 83
 * 分钟**，且该值在用户重启前后**完全相同**（同一份估算被两次读出）。后果不是
 * 「读数略偏」，而是方向性的：`mtime > startMs` 的判据会把**重启后刚加载的新模块**
 * 全部判成陈旧，于是 `ldvh_inspect_loaded_modules` 每次重启都报 stale，而这个工具的
 * 全部意义就是回答「我改的代码进运行实例了吗」——它一旦恒报陈旧，就再也回答不了，
 * 并会把人引向「重启没生效」这一错误结论（本次即由此误判，已由 `ps` 与「新会话 →
 * 新进程」两路反证推翻）。
 *
 * ## 判据
 *
 * `performance.timeOrigin` 是运行时**权威**的进程起始时刻（Node ≥ 16 与 Electron
 * 各进程均提供，无平台依赖，精度到亚毫秒）。`now - uptime` 只在它缺失时作兜底。
 * 两者都可用时取**较晚**者：估算若偏早，最多把新模块误判成陈旧（本函数的失效方向），
 * 取较晚值即把该误判面压到最小；而偏晚则可能漏报陈旧，属本函数已声明的边界
 * （「mtime 未变检不出」同一类），且 `stale` 为空本就不等于一致。
 *
 * @param {{nowMs?: number, uptimeSec?: number, timeOriginMs?: number|null}} [clock]
 *   注入用；生产不传。
 * @returns {number} 毫秒时间戳。
 */
export function processStartMs({ nowMs = Date.now(), uptimeSec = process.uptime(), timeOriginMs } = {}) {
  const origin = timeOriginMs === undefined ? defaultTimeOrigin() : timeOriginMs;
  const fromUptime = nowMs - uptimeSec * 1000;
  if (typeof origin !== "number" || !Number.isFinite(origin)) return fromUptime;
  // 取较晚者：估算偏早是本函数唯一会制造**假陈旧**的方向，故不让偏早的估算胜出。
  return Math.max(origin, fromUptime);
}

/**
 * `performance.timeOrigin`，读不到时返回 null（不抛）。
 *
 * 单独抽出来便于测试注入：直接 `import { performance }` 在个别受限运行时里可能
 * 不存在，故用可选链并兜底。
 */
function defaultTimeOrigin() {
  try {
    const origin = globalThis.performance?.timeOrigin;
    return typeof origin === "number" && Number.isFinite(origin) ? origin : null;
  } catch {
    return null;
  }
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
 * `plugin/lib` 下全部模块。
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
 * 或改写预检 `verdict`（本模块 scope 第三条边界）。
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
