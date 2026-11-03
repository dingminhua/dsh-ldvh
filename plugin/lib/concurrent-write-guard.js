// 共享工作树上的「在途改动」判定（friction-68e6f33e / friction-451c4a7d 的处置）
//
// ## 要解决的问题
//
// 本仓 dev 是**多代理共享的同一工作树**：主控、并行会话、用户本人都会在同一个
// checkout 上编辑同一批源码，且改动在提交前一直停留在工作树里。任何工具若假定
// 「这份文件从我开始运行起只由我改动」，它的复位与还原就会静默吃掉别人的改动。
//
// 实测过的两种形态：
//
// 1. 脚本启动时读快照，每轮「复位」写回快照 ⇒ 运行期间他人的改动被抹掉，
//    且无任何提示（`specs/06` 意义上的静默有损处理）；
// 2. 结束时按快照无条件还原 ⇒ 整个运行期间的他人改动被一并回滚。
//
// 两者的共同前提是「我是这份文件唯一的写者」——一个在共享工作树上不成立的假定。
//
// ## 判据：内容比对，不是「脏/不脏」
//
// 只回答一件事：**磁盘上现在这一版，还是不是我上次写下的那一版？**
//
//   - 是（或我从未写过）⇒ 我拥有这次写入权，可以改；
//   - 否 ⇒ 有人在我运行期间改过它，我**不覆盖、不裁决**，如实记为不可用。
//
// 为什么不问 `git status`：脏不脏是**仓库级**事实，回答不了「谁改了这份文件」。
// 一个未跟踪的旁支载体也会让仓库变脏，却与本文件无关；反过来，他人对我这份文件
// 的改动在 `git status` 里与「我自己刚写的」完全同形，无法区分。内容比对是
// 文件级、精确、无需外部进程的判据。
//
// ## 不做什么（如实登记边界）
//
// - **不消除竞态**：读与写之间仍有一个窗口，只是从「整轮运行」缩到一次 writeFile。
//   要真正消除需文件锁，那是另一层机制，本模块不声称提供。
// - **不检测「他人的改动让某条变异碰巧被抓住」**：那种情形下变异仍然有效，只是
//   归因不再唯一，属运行环境事实，机械层不判。
// - **不判断谁的改动「更重要」**：只判定归属，不排序、不合并、不择一保留。

/**
 * 判定一次写入是否仍属于本进程。
 *
 * @param {object} input
 * @param {string|null} input.currentContent 磁盘上此刻的内容（`null` 表示文件不存在）
 * @param {string|null} [input.lastWrittenContent] 本进程上次写下的内容；`null`/`undefined`
 *   表示「尚未写过」——首次接触不构成冲突（此刻磁盘上的内容就是基线，可能带着他人
 *   未提交的改动，那正是运行前的真实状态）。
 * @returns {{ok: true, ownsWrite: true} | {ok: false, code: string, reason: string}}
 *   `ok: true` 只表示「可以写」，**不**表示「文件没被别人改过」——首次接触时后者
 *   无从知晓，也不影响判定。
 */
export function decideMutationWrite({ currentContent, lastWrittenContent = null } = {}) {
  const current = typeof currentContent === "string" ? currentContent : null;
  const last = typeof lastWrittenContent === "string" ? lastWrittenContent : null;

  // 首次接触：没有「我上次写下的」可比，故不构成冲突。
  if (last === null) return { ok: true, ownsWrite: true };

  // 文件在我们写过之后消失了：不是他人改写，但也绝不写回（凭空重建一份
  // 别人刚删掉的文件，同样是覆盖别人的决定）。
  if (current === null) {
    return {
      ok: false,
      code: "concurrent-write/gone",
      reason: "the file disappeared after this process wrote it — refusing to recreate a file someone else removed",
    };
  }

  if (current !== last) {
    return {
      ok: false,
      code: "concurrent-write/detected",
      reason: "the file was modified after this process wrote it — refusing to overwrite another writer's in-flight change",
    };
  }

  return { ok: true, ownsWrite: true };
}

/**
 * 还原判定的**同一条判据**，单独具名以便调用点读起来就是它的语义。
 *
 * 与 `decideMutationWrite` 是同一函数的别名，不复制实现——两份实现在这里正是
 * 缺陷来源：写入侧与还原侧的口径一旦分叉，其中一侧就会静默覆盖他人改动。
 *
 * @type {typeof decideMutationWrite}
 */
export const decideMutationRestore = decideMutationWrite;
