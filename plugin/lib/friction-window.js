/**
 * dsh-ldvh — 观察区间的机械累积 (specs/11 §11「观察范围的切分（水位）」).
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
 *
 * **2026-10-30 由 2000 提到 20000（Human 决定）**：2000 会砍掉大量材料。当时
 * 对 45 个根会话、557 个轮次的实测（按 `renderWindowText` 的交付口径）显示单轮
 * P50 为 3278 字、最大 15772 字，78% 的轮次超过 2000；按会话统计材料被砍
 * 26%–50%（最大会话交付材料 364006 字中被砍掉 133713 字）。**该次统计当时得出
 * 「提到 20000 后与完全删除上限逐字节相同、残余损失 0」——这个结论后来被推翻，
 * 不要再引用它**（见下段）。
 *
 * **2026-11-02 重测推翻了「零损失」**：语料变为 645 会话 / 1331 轮后，单轮 P50
 * 降到 2226、P95 为 7727、**最大升到 28048**；有 2 个轮次超过 20000（28048 与
 * 20425 字），上限 20000 下**仍被砍掉 8473 字、残余损失 0.21%**，不是 0。相对
 * 上限 2000 时的 36.9% 损失，20000 把损失压到 0.21%——**这是取 20000 的真实理由
 * （两个数量级的差别），而不是「等价于全文」**。规范的完整对照表见
 * `specs/11-宿主辅助任务规范.md` §7.1（三次统计并列，各标时点与语料）。
 *
 * 为什么保留上限而不删除：单轮上限只约束单轮、不约束材料总量，删除它并不能
 * 让材料「更完整地」进入提示词，只是把失败面从「截断并如实标记」移到「整次
 * 运行失败」。20000 把损失压到 0.21% 量级，同时为超出该范围的极端单轮保留
 * 兜底，且超出时仍以 `truncated` 如实标记（§11 有损处理须如实标记）。
 */
const MAX_CHARS_PER_TURN = 20000;

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

/**
 * 引证比对的**归一化口径**（单一来源；`verifyQuotation` 与各落地校验共用）。
 *
 * ## 为什么不止折叠空白（friction-37458a09）
 *
 * 原实现只做 `\s+ → 空格`，其余一字不差。该口径把两类**形状差异**当成内容差异：
 *
 * - **Markdown 装饰**：材料里的 `**加粗**`、`` `行内代码` ``、`~~删除~~` 是排版
 *   标记；执行体照语义摘引时剥掉它们，文字一个不差，却在字符串比对里被判
 *   「不在材料中」。实测该类被拒是闲时辅助一段时期内的主要失败源。
 * - **空白码位**：全角空格 `U+3000`、不换行空格 `U+00A0`、零宽字符与 `\r\n`
 *   都不在 `\s` 的部分语义里（JS 的 `\s` 其实含 `\u00a0`/`\u3000`，但**不含**
 *   零宽 `\u200b`–`\u200d`/`\ufeff`，也不做 `\r\n` 归一）。同一段原文经不同渲染
 *   路径会带不同空白码位，判据不该因此翻脸。
 *
 * ## 放宽的是形状，不是内容
 *
 * 归一化之后仍是**连续子串包含**：文字、顺序、标点必须连续全等出现。不做模糊
 * 匹配、不做相似度、不排序、不切词——那会把「引证是否来自本次材料」这道是非题
 * 退回语义判断，正是 11 §11 明禁的形态。
 *
 * **代价（如实登记）**：剥除装饰标记后，只差一个 `**` 的两段文本被视为同一段。
 * 这是有意的——两者指向材料中的同一处原文，装饰不是内容。反向的风险（把真正
 * 的差异放过）不成立：内容字面仍须连续全等。
 */
export function normalizeQuotationText(value) {
  return String(value ?? "")
    // 零宽与 BOM：不可见，却会让 includes 失配。
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    // 所有空白折叠成单空格（显式列出全角与 NBSP，不依赖 `\s` 的实现细节）。
    .replace(/[ \t\f\v\u00a0\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    // Markdown 装饰：只剥**成对记号**，不动普通标点，避免把两段不同文本并成一段。
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/~~/g, "")
    .replace(/`/g, "")
    .trim();
}

/**
 * 机械核对：子代理的逐字引证是否真出现在本次交给它的窗口里（D1 的核心）。
 *
 * 判据是**归一化后的子串包含**（口径见 `normalizeQuotationText`）——只做形状
 * 归一（空白与 Markdown 装饰），不做模糊匹配、不做相似度：本函数要回答的是
 * 「这句话是否确实来自我给它看过的材料」，那是一个可机械判定的是非题。
 * 相似度会把它又变回语义判断。
 *
 * ## 失败消息必须能区分两种「引文不在材料里」（2026-11-03）
 *
 * 判据本身没变（仍是归一化后的连续子串包含）。变的是**失败时的可诊断性**：
 *
 * 材料按**轮**施加 20000 字符上限（`specs/11` §7.1，Human 决定 2026-11-02），
 * 超出部分被 `clamp` 切掉并置 `truncated`。于是「引文不在材料里」有两种成因，
 * 处置完全不同：
 *
 *   - **引错了地方**（引了工具输出、更早轮次、自己的知识）→ 执行体该改；
 *   - **引文落在被切掉的尾部** → 材料本身不完整，执行体**没有错**，是本次交付
 *     范围不足以支持判断（`specs/11` §10「有损处理须如实标记」的如实面）。
 *
 * 此前两者产生**逐字相同**的失败消息，且消息里只留引文前 80 字、不说明被截过。
 * 实测待处置队列 18 条 `quote_not_in_window` 因此至今无从归因——而「是哪种」
 * 恰恰决定该不该把它算作机制缺陷。故本函数接收窗口的截断事实并在消息里点名，
 * 引文显示也标注原长，使记录本身足以回答这个问题。
 *
 * 返回 `{ ok: true }` 或 `{ ok: false, error }`。
 *
 * @param {{minChars?: number, truncated?: boolean}} [options]
 *   `truncated` 是**窗口级**截断事实（`windowFrom` 的 `truncated`）——为 true 表示
 *   本次材料被单轮上限切过，故「不在材料里」未必等于「不在原文里」。
 */
export function verifyQuotation(quote, windowText, { minChars = 8, truncated = false } = {}) {
  const normalize = normalizeQuotationText;
  const q = normalize(quote);

  // 引文在消息里的显示：截到 80 字时**必须标注原长**，否则读者无法分辨
  // 「原引文就这么长」与「显示被截断」——那正是本条要消灭的歧义。
  const shown = q.length > 80
    ? `${JSON.stringify(q.slice(0, 80))}（显示前 80 字，原长 ${q.length} 字）`
    : JSON.stringify(q);

  if (q.length === 0) {
    return { ok: false, error: { code: "discovery/quote_missing", message: "the verdict carries no verbatim quote, so the landing side cannot tell whether it derives from this run's window" } };
  }
  if (q.length < minChars) {
    return {
      ok: false,
      error: {
        code: "discovery/quote_too_short",
        message: `the quote is ${q.length} chars, below the ${minChars}-char floor — too short to establish that it came from this run's window (11 §11 水位段：切分依据不得由 AI 判断). Quote: ${shown}. 注意：该长度下限是**实现侧护栏**（防止极短引证无法在材料中定位跨度），不是规范 11 §11 的规定——规范只要求引证「在交付材料内」；若认为下限过严，须按规范修订流程处理，不得在本层私自调低。`,
      },
    };
  }
  if (!normalize(windowText).includes(q)) {
    // 两种成因的区分就落在这两句上：截断过的窗口**不得**写成「引了窗口外的材料」
    // 这一种结论，否则等于把「材料不全」记成「执行体出错」。
    const why = truncated
      ? "the quote is not present in the material actually delivered — 注意：本次材料因单轮上限被**截断**过（specs/11 §7.1），故该引文可能落在被切掉的尾部，此时执行体并未引错，而是本次交付范围不足以支持该判断；两种成因在本次记录里无法再细分（原文尾部未留存），须按「材料不全」而非「引证失实」对待"
      : "the quote is not present in this run's window — the verdict cites material outside the observation window, so it cannot be counted as a new observation (11 §11 水位段)";
    return {
      ok: false,
      error: {
        code: "discovery/quote_not_in_window",
        message: `${why}. Quote: ${shown}`,
      },
    };
  }
  return { ok: true, value: { quote: q } };
}

/** 观察材料的边界标记（**单一来源**）。 */
export const WINDOW_OPEN = "<<<WINDOW-BEGIN>>>";
export const WINDOW_CLOSE = "<<<WINDOW-END>>>";

/**
 * 把窗口条目渲染成**交付给执行体的材料文本**——**单一来源**。
 *
 * ## 为什么必须抽成一个函数（2026-10-11 修复）
 *
 * 本文件的 `windowFrom()` 给出条目，而**材料文本**此前在**两处各自拼装**：
 *   - `friction-subagent-contract.js` 的 `buildDiscoveryPrompt`（拼进提示词）
 *   - `friction-discovery-provider.js` 的 `createDiscoveryProvider`（拼给核对用）
 *
 * 两处必须逐字一致——因为核对是 `windowText.includes(quote)` 的**字符串比对**，
 * 而引证来自提示词里那一份。任何一处漂移（多一个空行、少一个前缀）都会使
 * **所有引证无故被拒**，且失败形态与「执行体引错地方」**无从区分**——正是 D5
 * 那类「两处各写一套」的缺陷。故此处收敛为单一实现，两处都调它。
 *
 * 边界标记也由此统一：标记必须出现在**提示词那一份**（执行体照着找边界），
 * 也必须出现在**核对那一份**吗——**不必须，且刻意不加**：核对只需判断引文是否
 * 在**材料正文**里，而正文在标记之间；若把标记也纳入被核对的文本，执行体引
 * 标记本身（无意义）反而会通过核对。故本函数渲染**含标记的完整交付文本**，
 * 并另导出 `windowBody()` 供核对方使用。
 */
export function renderWindowText(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const body = items
    .map((entry) => {
      const parts = [`[turn ${entry.turn}]`];
      if (entry.user) parts.push(`user: ${entry.user}`);
      if (entry.assistant) parts.push(`assistant: ${entry.assistant}`);
      return parts.join("\n");
    })
    .join("\n\n");
  return [WINDOW_OPEN, body, WINDOW_CLOSE].join("\n");
}

/**
 * **被核对的正文**（不含边界标记）——供 `verifyQuotation` 使用。
 *
 * 与 `renderWindowText` 同源：直接取渲染结果去掉首尾标记行，故不存在第二套
 * 拼装逻辑。空窗口返回空串（核对侧据此判定「材料为空」这一特例）。
 */
export function windowBody(items) {
  const full = renderWindowText(items);
  if (full === "") return "";
  return full
    .split("\n")
    .filter((line) => line !== WINDOW_OPEN && line !== WINDOW_CLOSE)
    .join("\n");
}

export { MAX_CHARS_PER_TURN, MAX_TURNS_RETAINED };
