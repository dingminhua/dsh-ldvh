// dsh-ldvh — 称呼机械前置器（保证面，非 04 §6.3 阻断面）
//
// Authority: specs/27 §6.1（2026-11-16 收紧判据的「保证面」类别，待 Human 决定 R2
// 落盘）、ldvh-base/norms/norm-67137333《AI 与 Human 的协作约定》第 1 条。
//
// ## 它保证什么、不保证什么（如实声明）
//
// **保证**：受辖根会话的每个回合，最终 assistant 消息（落盘、历史、replay）以
// 「你好，老丁」起首——通过改写**首个 text 块的 `block-end`** 实现。
//
// **为什么不注入合成 delta 就够**（审查 BLOCKER-1，实测复现）：宿主
// `BlockAssembler` 一旦见过 `block-end` 就用它携带的整块文本，累加的 delta 不参与
// 最终消息组装——只注 delta 会出现「流式界面短暂显示称呼、落盘消息没有称呼、日志
// 却写着已注入」的空转形态。故本模块**同时**：① 在判定需要前置时先发出合成
// text-delta（流式界面与最终消息一致）；② 在该块的 `block-end` 上把 `block.text`
// 改写为「称呼＋全文」（组装器一致）。
//
// **不保证（fail-open，逐条登记）**：
//   - 前置器自身抛错 ⇒ 放行原流（保障层不得把会话搞死，与召回行同纪律）；
//   - 流在判定前被 abort ⇒ 已缓冲文本原样转发，不注入半截；
//   - 无可见文本的回合（纯工具调用）⇒ 不适用；
//   - 子代理会话 ⇒ 不适用（`sessionScopes` 只登记根会话，child.js 不发布）；
//   - 非本规范所在项目的受辖会话 ⇒ 不适用（Norm 明写各项目自建方向）；
//   - 它是**改写输出**，不是拒绝/暂停/退回 ⇒ 按 04 §6.3 不计入「覆盖」，属保证面。
//
// ## 回合内去重（审查 MAJOR-6）
//
// 一个用户回合有多个 step、每个 step 一次 `llm/stream`。按 sessionId 记「本回合已
// 保证」，在 `agent/inbox/inserted`（新用户消息进入 inbox）时重置。

import { GREETING_TEXT } from "./greeting-text.js";

/** 保证面登记 ID（27 §6.1 `保证面：pre-injector:<name>` 的 name 解析面）。 */
export const GREETING_PREFIX_ENFORCER_ID = "greeting-prefix";

/** 判定窗口：累积首段达到该长度仍不以称呼起首即判定需要前置。 */
const DECIDE_AFTER_CHARS = GREETING_TEXT.length + 4;

/**
 * 创建前置器状态与挂载函数。
 *
 * @param {object} deps
 * @param {{get: (id: string) => any}} deps.sessionScopes sessionId → 管辖 scope
 * @param {(projectPath: string) => Promise<boolean>} deps.projectCarriesNorm
 *   该受辖项目的事实源是否承载 active 的 ai-human-collaboration 方向规范
 * @param {object} [deps.logger]
 * @returns {{install: (ctx: any) => (() => void), snapshot: () => object}}
 */
export function createGreetingEnforcer({ sessionScopes, projectCarriesNorm, logger = null } = {}) {
  const stats = { mounted: false, streamsSeen: 0, injected: 0, skipped: {} };
  const noteSkip = (reason) => { stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1; };
  // sessionId → 本回合是否已保证（注入或已见称呼）
  const turnDone = new Map();

  function install(ctx) {
    const stops = [];
    // 回合边界：新用户消息进入 inbox ⇒ 重置该会话的回合标记。
    stops.push(ctx.on("agent/inbox/inserted", (payload) => {
      const sessionId = payload?.agent?.session?.header?.id;
      if (typeof sessionId === "string") turnDone.delete(sessionId);
    }));

    stops.push(ctx.on("llm/stream", function streamGuard(options, next) {
      return wrapStream(this, options, next);
    }));
    stats.mounted = true;
    return () => { for (const stop of stops) { try { stop(); } catch { /* already removed */ } } stats.mounted = false; };

    async function* wrapStream(runtime, options, next) {
      stats.streamsSeen += 1;
      const sessionId = options?.sessionId;
      // 作用域四关：会话已知 / governed / 项目承载该规范 / 本回合未保证。
      if (typeof sessionId !== "string") { noteSkip("no-session-id"); yield* await next(); return; }
      const scope = sessionScopes?.get(sessionId);
      if (scope?.state !== "governed") { noteSkip("not-governed"); yield* await next(); return; }
      const projectPath = scope?.project?.path;
      if (typeof projectPath !== "string" || !(await projectCarriesNorm(projectPath))) {
        noteSkip("project-lacks-norm"); yield* await next(); return;
      }
      if (turnDone.get(sessionId) === true) { noteSkip("turn-already-assured"); yield* await next(); return; }
      if (options?.purpose !== undefined && options?.purpose !== null) { noteSkip("aux-purpose"); yield* await next(); return; }

      let upstream;
      try { upstream = await next(); } catch (error) { noteSkip("upstream-threw"); throw error; }

      let textIndex = null;        // 首个 text 块的 index
      let acc = "";                // 该块累积文本
      let decided = false;         // 已判定
      let injecting = false;       // 判定为需要前置
      let blockEndRewritten = false;
      const buffered = [];         // 判定前暂存的该块 chunk

      const flushBuffered = function* () {
        for (const chunk of buffered) yield chunk;
        buffered.length = 0;
      };
      const beginInjection = function* () {
        decided = true; injecting = true;
        turnDone.set(sessionId, true);
        stats.injected += 1;
        logger?.info?.(`ldvh: greeting pre-injected (session ${sessionId.slice(0, 8)}…)`);
        // 次序：先放行缓冲里的 block-start，再发合成 delta，再放其余缓冲——
        // delta 早于 block-start 会让宿主 BlockAssembler 见到无主 delta。
        if (buffered.length > 0 && buffered[0].type === "block-start") yield buffered.shift();
        yield { type: "text-delta", index: textIndex, text: `${GREETING_TEXT}\n\n` };
        yield* flushBuffered();
      };

      try {
        for await (const chunk of upstream) {
          // 判定后：注入块的 block-end 仍须改写（否则组装器用整块文本吃掉称呼），
          // 其余 chunk 一律透传。
          if (decided) {
            if (injecting && !blockEndRewritten && chunk?.type === "block-end" && chunk.index === textIndex) {
              blockEndRewritten = true;
              yield { ...chunk, block: { ...chunk.block, text: `${GREETING_TEXT}\n\n${chunk.block?.text ?? acc}` } };
              continue;
            }
            yield chunk;
            continue;
          }
          if (chunk?.type === "block-start" && chunk.blockType === "text" && textIndex === null) {
            textIndex = chunk.index;
            buffered.push(chunk);
            continue;
          }
          if (textIndex !== null && chunk?.index === textIndex) {
            if (chunk.type === "text-delta") {
              acc += chunk.text ?? "";
              buffered.push(chunk);
              if (acc.trimStart().startsWith(GREETING_TEXT)) {
                decided = true;
                turnDone.set(sessionId, true);
                yield* flushBuffered();
                continue;
              }
              if (acc.length >= DECIDE_AFTER_CHARS || acc.includes("\n")) {
                yield* beginInjection();
              }
              continue;
            }
            if (chunk.type === "block-end") {
              // 块短于判定窗口：以累积文本在此判定（否则短块永不判定）。
              if (acc.trimStart().startsWith(GREETING_TEXT)) {
                decided = true;
                turnDone.set(sessionId, true);
                yield* flushBuffered();
                yield chunk;
                continue;
              }
              yield* beginInjection();
              yield { ...chunk, block: { ...chunk.block, text: `${GREETING_TEXT}\n\n${chunk.block?.text ?? acc}` } };
              blockEndRewritten = true;
              continue;
            }
          }
          yield chunk;
        }
      } catch (error) {
        // fail-open：判定前的缓冲原样转发（不注入半截），错误照抛。
        if (!decided) yield* flushBuffered();
        throw error;
      }
      // 流在判定前结束（abort／短流无 block-end）：缓冲原样转发，不注入。
      if (!decided) yield* flushBuffered();
    }

  }

  return {
    install,
    snapshot: () => ({ mounted: stats.mounted, ...stats, greeting: GREETING_TEXT }),
  };
}
