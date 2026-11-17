/**
 * dsh-ldvh — 当前轮正文累积器（供把关请示读取「行动前」判断依据）.
 *
 * 本模块原是观察区间（水位）切分的一部分；水位载体已按 Human 2026-11-17 决定
 * 删除（specs/11 §11）。此处保留的是它与水位无关的现役用途：把宿主 `session/event`
 * 里每一轮的用户与助手文本累积到有界环形缓冲，供 `triggers.currentTurnText()` 读取
 * 当前轮正文——把关请示的「行动前弱约束判断依据」由该通道取得。
 *
 * 实现逐字承袭原 `friction-window.js` 的 `createWindowAccumulator` 与两个上限常量，
 * 不做行为改动。`windowFrom()`、`firstObservedTurn()` 等接口一并保留（前者仍被
 * currentTurnText 使用）。
 */

/** 每轮保留的文本上限（字符）；超限截断并置 truncated。 */
const MAX_CHARS_PER_TURN = 20000;

/** 环形缓冲保留的最大轮数（只限制内存）。 */
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

        // ── 一轮之内有多条 assistant/message（2026-10-11 修复）────────────
        //
        // 宿主把**每一次** assistant 输出都发成一条 `assistant/message`：一轮里
        // 有多少个 assistant 步骤就有多少条（步与步之间还夹着工具调用）。实测本
        // 会话：**1411 条**分布于 55 轮，单轮最多 147 条。
        //
        // 此处原先直接 `record(turn, { assistant: clipped })`——每条都**覆盖**
        // 前一条，于是整轮只留下**最后一条**。两个后果都实测到过：
        //
        //   ① **丢掉主体内容**：turn 55 有 25 条消息、合计 1531 字可用，最后只
        //      留下 31 字（2%）；全量 1411 条中仅 55 条进过材料（4%）。
        //   ② **被空消息抹掉**：22% 的 assistant/message 是纯工具调用（无 text
        //      块）。轮到这类消息时 `clipped` 为空串，写入即把该轮已累积的
        //      assistant 文本**清空**——turn 55 实际就是这样变空的。
        //
        // 修法是**追加**而非覆盖，并在追加后统一过 `clamp`。语义上这才对应
        // 「本轮的 assistant 正文」：`turn` 是聚合键，不是「唯一一条消息」。
        //
        // **保留哪一段**：`clamp` 截取**开头**，即按发生顺序的**前缀**。这
        // 是有意选择的**确定性**规则——「保留语义上最要紧的一段」需要判断，
        // 而 11 §11 禁止让切分依据落在 AI 判断上。前缀规则另外还与 `clamp` 的
        // 既有语义（`slice(0, max)`）、与材料「照抄原文」的用途一致。
        // 该规则与上限数值无关：上限由 `MAX_CHARS_PER_TURN` 决定（现为 20000），
        // 只有单轮超过它时才真正发生截断并置 `truncated`。
        //
        // 空文本**不得**参与覆盖：它不进 patch，本轮已有内容原样保留。
        const text = textOfBlocks(event?.data?.message?.content);
        const previous = turns.get(turn)?.assistant ?? "";
        const merged = text.length === 0
          ? previous
          : previous.length === 0
            ? text
            // 消息之间以空行相隔（`verifyQuotation` 的 normalize 会把空白折叠成
            // 单个空格，故跨消息引证仍可核对；见 friction-discovery.js）。
            : `${previous}\n\n${text}`;
        const { text: clipped, truncated } = clamp(merged);

        // 用户消息可能已由 turn/start 分支挂上；pendingUser 为 null 时**不得**
        // 用空串覆盖既有内容（实测踩过：那会把已挂上的用户文本抹掉）。
        //
        // 无需「只升不降」的保护：合并后的文本**只增不减**（`previous` 永不被
        // 丢弃），而 `clamp` 是 `slice(0, max)`——长度不降 ⇒ `truncated` 不可能
        // 由 true 翻回 false。曾写过 `|| previous.truncated` 的写法，实测**无法
        // 用任何测试区分**（因为该分支不可达），故删除而不是留一段无测试覆盖的
        // 代码：那种代码只会让人误以为这里有需要防的边界。
        const patch = { assistant: clipped, truncated };
        if (pendingUser !== null) {
          const userPart = clamp(pendingUser);
          patch.user = userPart.text;
          patch.truncated = patch.truncated || userPart.truncated;
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
