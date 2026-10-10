/**
 * dsh-ldvh — 观察区间的机械累积 (specs/04 §8.4「观察范围的切分（水位）」).
 *
 * ## 本模块为何存在（缺陷 D1 的修复）
 *
 * §8.4 水位段的核心禁令是：切分依据**不得**是「AI 认为哪些是新的」——那会退化
 * 为被监督者自行决定监督范围。原实现只做到「调度侧机械算出 `from`/`to` 两个
 * 轮次号」，却把这**两个数字以提示词文本交给子代理**，而子代理看到的是 `fork`
 * 的全量上下文——于是「哪些内容落在区间内」实际仍由模型解释。独立复核
 * （隔离子代理 030117d3）指出该缺陷，并指出**条文侧亦有口子**（§8.4 未要求
 * 执行体的输入被机械切分）。
 *
 * 本模块把切分挪到**调度侧、且基于已发布事件**：
 *
 * - **累积**：监听 `session/event`，把区间内每一轮的**用户与助手文本**摘出来，
 *   存进一个有界的环形缓冲。**不读会话日志、不用任何弃用读取 API**——与
 *   `plugin/lib/child.js` 的既定模式一致（宿主 `snapshotEvents()`/`ownEvents()`/
 *   `eventAt()` 均已弃用，README 明文「禁止新增生产调用」）。
 * - **切分**：按水位给出**区间内的内容本身**（而非坐标），交给子代理。
 * - **核对**：子代理须**逐字引证**它据以判断的原文；落地侧机械核对引证是否真
 *   出现在本次交给它的窗口里。**引证不在窗口内即判定该判断不成立**——这一步把
 *   「哪些算新增」从语义问题变成机械判定，正是 §8.4 要的形态。
 *
 * ## 与参考实现的关系
 *
 * 对照 `dsh-auto-memory`（其触发为「water level ≥ threshold AND idle」，水位语义
 * 是**可机械计算**的上下文占用比）与 `dsh-agent-teams`（按 key 串行化、逐层判
 * 「有没有真活」）：二者共同指向「水位应当是调度侧机械得出的量，而非交给模型解释
 * 的坐标」。本模块即按此形态实现。
 *
 * ## 边界
 *
 * 本模块只做**文本累积与切分**，不做任何判断：某段文本是否构成阻碍仍由子代理由
 * 语义判断得出（§8.4 第 1 项，登记为 gap）。本模块保证的是——**它被要求判断的
 * 材料，确实是区间内的**；以及——**它声称依据的内容，必须真在材料里**。
 */

/**
 * 每轮保留的文本上限（字符）。设上限的理由：窗口最终要进子代理的提示词，
 * 无界会让长会话的提示词爆掉；截断是**有损**的，故须如实登记（`truncated`）。
 */
const MAX_CHARS_PER_TURN = 2000;

/** 环形缓冲保留的最大轮数。只用于限制内存；切分仍以水位为准。 */
const MAX_TURNS_RETAINED = 200;

/** 从内容块数组里摘出纯文本（与 child.js 同口径：只取 type==="text"）。 */
function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block !== null && typeof block === "object" && block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

/**
 * 创建一个窗口累积器。每个 agent 生命周期一个实例（随 `createTurnTriggers`
 * 的 state 存活）。
 *
 * 用法：在 `session/event` 回调里调 `observe(session, event)`；
 * 在检查点调度时调 `windowFrom(watermarkTurn)` 取区间内容。
 */
export function createWindowAccumulator({ maxCharsPerTurn = MAX_CHARS_PER_TURN, maxTurns = MAX_TURNS_RETAINED } = {}) {
  /** turn 号 → { turn, user, assistant, truncated }（插入序即发生序）。 */
  const turns = new Map();
  let pendingUser = null;
  /**
   * 本累积器**实际看到过**的最小轮次（缺陷 D6 的修复）。
   *
   * 为什么必须记：累积器随进程存活，而水位**跨进程持久化**。宿主重启后，累积器
   * 从空开始，而水位仍是从前那次运行的值——于是水位要求覆盖的区间里，有一段
   * （`水位+1 .. 首见轮次-1`）**本进程从未观察过**。若不标记它，`windowFrom`
   * 会返回一段看似完整的窗口，该次运行若报 `no-discovery`，水位便推进越过那段，
   * **那段内容即永久不会被观察**（宿主只发布事件、不回放；本模块按 §8.4 纪律
   * 不读会话日志）。
   */
  let firstObservedTurn = null;

  function record(turn, patch) {
    const existing = turns.get(turn) ?? { turn, user: "", assistant: "", truncated: false };
    const merged = { ...existing, ...patch };
    turns.set(turn, merged);
    if (firstObservedTurn === null || turn < firstObservedTurn) firstObservedTurn = turn;
    // 简单容量控制：超过上限即丢最旧的。注意 `firstObservedTurn` **不随之回退**
    // ——它记的是「本进程见过的最小轮次」这一事实，丢了缓冲也不改变该事实。
    while (turns.size > maxTurns) {
      const oldest = turns.keys().next().value;
      turns.delete(oldest);
    }
  }

  function clamp(text) {
    if (typeof text !== "string") return { text: "", truncated: false };
    if (text.length <= maxCharsPerTurn) return { text, truncated: false };
    return { text: text.slice(0, maxCharsPerTurn), truncated: true };
  }

  return {
    /**
     * 消费一个已发布事件。只认 `session/event` 的三种：`user/message`、
     * `assistant/message`、`turn/end`（后者用于清掉挂起的用户消息）。
     */
    observe(session, event, expectedSession) {
      if (expectedSession !== undefined && session !== expectedSession) return;
      const type = event?.type;
      const turn = event?.data?.turn;

      if (type === "user/message") {
        // user/message 的载荷是消息体本身（无 turn 字段），故挂在**下一个**
        // 有 turn 的事件上。这是宿主的形状，不是我们的取舍。
        pendingUser = textOfBlocks(event?.data?.content);
        return;
      }

      if (type === "assistant/message") {
        if (turn === undefined || turn === null) return;
        const text = textOfBlocks(event?.data?.message?.content);
        const { text: clipped, truncated } = clamp(text);
        // 用户消息可能已由 turn/start 分支挂上；pendingUser 为 null 时**不得**
        // 用空串覆盖既有内容（实测踩过：那会把已挂上的用户文本抹掉）。
        const patch = { assistant: clipped, truncated };
        if (pendingUser !== null) {
          const userPart = clamp(pendingUser);
          patch.user = userPart.text;
          patch.truncated = truncated || userPart.truncated;
          pendingUser = null;
        }
        record(turn, patch);
        return;
      }

      if (type === "turn/start") {
        if (turn === undefined || turn === null) return;
        // 开轮时若还有未挂上的用户消息，先归到本轮（有些路径 user/message 在
        // turn/start 之后才发布，故 assistant/message 分支也会再挂一次）。
        if (pendingUser !== null) {
          const { text: clipped, truncated } = clamp(pendingUser);
          record(turn, { user: clipped, truncated });
          pendingUser = null;
        }
        return;
      }

      // turn/end 不清理——内容要留给后续的窗口切分（水位推进前都要可读）。
    },

    /**
     * 取「水位之后」的区间内容（§8.4：自上次成功运行以来新增的内容）。
     *
     * `afterTurn` 为 `null` 表示首次运行——区间覆盖全部已有内容（否则历史上的
     * 反复阻碍永远发现不了）。
     *
     * 返回 `{ items: [{turn, user, assistant, truncated}], truncated: boolean }`。
     * **只返回调度侧真正累积到的内容**——这是本模块存在的意义：区间内容不再由
     * 子代理自行划定。
     */
    windowFrom(afterTurn) {
      const floor = Number.isInteger(afterTurn) ? afterTurn : -1;
      const items = [...turns.values()]
        .filter((entry) => entry.turn > floor)
        .sort((a, b) => a.turn - b.turn);

      // 缺陷 D6：窗口起点与「本进程实际见过的最小轮次」之间的缺口。
      // 首次运行（floor = -1）时无缺口可言——那正是「覆盖全部既有内容」的语义。
      // 有缺口即如实标记，**不得**让调用方以为区间已完整覆盖。
      //
      // **复核发现②的修复**：`firstObservedTurn === null`（本进程从未见过任何
      // 事件——刚装载、或事件流未达）**本身就是最严重的缺口**。早先的写法要求
      // `firstObservedTurn !== null` 才判缺口，于是这种情形下 `unobserved` 为
      // null，空窗口被当成「区间已完整覆盖且无发现」，`no-discovery` 照常推进
      // 水位——整段内容永不再被观察。此时缺口区间为 **开到区间终点**（未知上界）。
      //
      // **复核发现③的修复**：环形缓冲淘汰最旧轮次后，`items` 的起点会晚于
      // `floor`，窗口静默不完整。故缺口判定以「本次返回的最小轮次」为准，而不是
      // 只看 `firstObservedTurn`。
      const gapStart = floor >= 0 ? floor + 1 : null;
      let unobserved = null;
      if (gapStart !== null) {
        if (firstObservedTurn === null) {
          // 本进程什么都没看到：从区间起点到未知上界全属未观察。
          unobserved = { from: gapStart, to: null };
        } else if (gapStart < firstObservedTurn) {
          unobserved = { from: gapStart, to: firstObservedTurn - 1 };
        }
      }
      // ③ 缓冲淘汰造成的缺口：本次 items 的最小轮次若晚于区间起点（而首见轮次
      //    本应更早），则 items 与 floor 之间也有一段未含在窗口里。
      //    （`firstObservedTurn` 已被淘汰覆盖时，items 起点即最小可得轮次。）
      if (gapStart !== null && items.length > 0 && unobserved === null) {
        const lowestInItems = items[0].turn;
        if (gapStart < lowestInItems) unobserved = { from: gapStart, to: lowestInItems - 1 };
      }

      return {
        items,
        truncated: items.some((entry) => entry.truncated === true),
        // 本进程未观察到的轮次区间（null = 无缺口）。
        unobserved,
      };
    },

    /** 本进程实际观察到的最小轮次（诊断；缺口判定用）。 */
    firstObservedTurn() {
      return firstObservedTurn;
    },

    /** 缓冲里已知的最大轮次（用于诊断；不参与切分判定）。 */
    highestTurn() {
      let max = null;
      for (const turn of turns.keys()) if (max === null || turn > max) max = turn;
      return max;
    },

    /** 清空（会话切换等场景）。 */
    reset() {
      turns.clear();
      pendingUser = null;
      firstObservedTurn = null;
    },

    /** 诊断快照。 */
    snapshot() {
      return { turns: turns.size, pendingUser: pendingUser !== null, firstObservedTurn };
    },
  };
}

/**
 * 机械核对：子代理的逐字引证是否真出现在本次交给它的窗口里（D1 的核心）。
 *
 * 判据是**规范化后的子串包含**——只做空白归一（折叠连续空白、去首尾），不做
 * 模糊匹配、不做相似度：本函数要回答的是「这句话是否确实来自我给它看过的材料」，
 * 那是一个可机械判定的是非题。相似度会把它又变回语义判断。
 *
 * 返回 `{ ok: true }` 或 `{ ok: false, error }`。
 */
export function verifyQuotation(quote, windowText, { minChars = 8 } = {}) {
  const normalize = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const q = normalize(quote);

  if (q.length === 0) {
    return { ok: false, error: { code: "discovery/quote_missing", message: "the verdict carries no verbatim quote, so the landing side cannot tell whether it derives from this run's window" } };
  }
  if (q.length < minChars) {
    return {
      ok: false,
      error: {
        code: "discovery/quote_too_short",
        message: `the quote is ${q.length} chars, below the ${minChars}-char floor — too short to establish that it came from this run's window (04 §8.4 水位段：切分依据不得由 AI 判断)`,
      },
    };
  }
  if (!normalize(windowText).includes(q)) {
    return {
      ok: false,
      error: {
        code: "discovery/quote_not_in_window",
        message: `the quote is not present in this run's window — the verdict cites material outside the observation window, so it cannot be counted as a new observation (04 §8.4 水位段). Quote: ${JSON.stringify(q.slice(0, 80))}`,
      },
    };
  }
  return { ok: true, value: { quote: q } };
}

export { MAX_CHARS_PER_TURN, MAX_TURNS_RETAINED };
