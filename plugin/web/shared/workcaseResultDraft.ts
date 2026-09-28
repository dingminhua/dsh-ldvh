// 「## 结果」节解析：把关闭提案的正文承载转成卡片可呈现的结构。
//
// 依据 `21 §8`：`result` 字段出现 ⇔ `status = closed`。故「待批准关闭」期
// （`status = open`）的**核对结论与建议只在正文「## 结果」节里**，卡片从字段读不到。
// 本模块只做**形态解析**，不做语义判断：
//
//   · 核对状态只认 `21 §8` 登记的三词（达成 / 部分达成 / 未达成）；无法判定时记
//     `null`（呈现为「未记录」），**不猜**、不把同义词静默归一。
//   · 建议只认 `21 §8` 登记的 `- advice:` 段与闭集去向词（接受现状 / 转入 Spark）；
//     去向词不在闭集内记 `null`（呈现为「未归类」）。
//
// 解析依赖书写形态。格式不符时条目落空而不是被猜出来——这是有意的：标准形态由
// `21 §8` 登记，偏离时应暴露而非掩盖。
//
// 曾有一条过渡通道（从 `residual` 条目正文里按「建议…」关键词抽子句），随 2026-09-23
// 把 5 份存量对象的建议回填为 `- advice:` 段而**删除**：该通道实测丢出处 3/8、截断
// 1/8，并误判 1 例（正文含「另立」二字即判为「另立工单」，实际去向是「直接行动」）。
// 规范既已登记唯一承载，认知之外的第二条识别路径只会让「未登记即不可检出」失效。

/**
 * 事后补记声明的识别式（`21 §8`）。
 *
 * 为 2026-09-23 建议段登记前已关闭的对象补写去向时（Human 授权 2026-09-24），
 * 段前须有一行声明「本条为事后补记，非关闭当时的 Gate 2 提请内容」。该声明必须
 * **带上卡面**——否则卡面读者仍会以为这段去向当初被提请过，声明就失去意义。
 *
 * 识别取**固定写法**而非「前面的段落」：实测宽判据会把标题、清单行、正文段落
 * 一律当声明（`8d2ba256` 抓到 `### Gate 2 提请`、`be30b5f7` 抓到清单行）。
 */
const BACKFILL_NOTE = /^\*\*本条为\s*\d{4}-\d{2}-\d{2}\s*事后补记[^*]*\*\*$/

export const WORKCASE_CHECK_STATUSES = ['achieved', 'partial', 'not-achieved'] as const
export type WorkCaseCheckStatus = (typeof WORKCASE_CHECK_STATUSES)[number]

/** `21 §8` 登记的三词 → 内部状态。顺序敏感：先长词后短词（「达成」是「未达成」的子串）。 */
const CHECK_WORDS: readonly (readonly [string, WorkCaseCheckStatus])[] = [
  ['未达成', 'not-achieved'],
  ['部分达成', 'partial'],
  ['达成', 'achieved'],
]

/**
 * 建议去向（`21 §8` 闭集**二词**，按**责任去哪**取值，不按动作内容分）。
 *
 * 2026-09-24 由五词收敛为四词（另立工单／接受现状／转入 Spark／直接行动——
 * 原五词混了两种分类维度，「补录／更正／改进」三者实为同一去向）；
 * **2026-09-28 再由四词收为二词**：四词中「另立工单」与「直接行动」都**不产生
 * 可回指的稳定标识**（前者指向尚不存在的对象、后者根本不应另立对象），
 * 「去向有无归宿」只能靠读散文判断，属零校验地带。收为二词后每个去向都对应
 * 一个可机械核验的不变量（「接受现状」要求非空理由、「转入 Spark」要求在
 * `relations` 中有一条可解析、写入时为 `open` 的 `routed-to`）。
 *
 * **存量对象仍可能写着已撤销的两词**（`§15.3` 存量不溯及）：此处只为它们保留
 * **呈现**能力——记 `null` 会显示成「未归类」，对读者是更差的信息。判不出时
 * 记 `null`，呈现为「未归类」。
 */
export const WORKCASE_ADVICE_KINDS = ['接受现状', '转入 Spark'] as const
export type WorkCaseAdviceKind = (typeof WORKCASE_ADVICE_KINDS)[number]

/**
 * 存量去向词（2026-09-28 前登记的闭集）。
 *
 * 用途仅限**呈现**：既有载体（`§15.3` 存量不溯及）里写着「另立工单」「直接行动」
 * 的建议段仍要显示成其原本的去向，而不是灰掉成「未归类」。它们**不再是闭集取值**
 * ——受控写入侧的 `validateDirectionCompleteness`（`lib/workcase-writer.js`）
 * 只认上面的二词，写新对象时出现这两词一律拒绝。
 */
export const WORKCASE_ADVICE_LEGACY_KINDS = ['另立工单', '直接行动'] as const
export type WorkCaseAdviceLegacyKind = (typeof WORKCASE_ADVICE_LEGACY_KINDS)[number]

/**
 * 呈现层可出现的去向词：当前闭集二词 ∪ 存量两词。
 *
 * 为什么类型要放宽到存量词：`kind` 的用途是决定卡面标记的**颜色与文案**
 * （`workcaseCheckState.ts` 的 `WORKCASE_ADVICE_TAG_CLASS`、`locales.ts` 的
 * `objectList.workcaseAdvice.*`）。存量对象读出来仍是旧词，类型若只容二词，
 * 这里就只能记 `null`，卡面把它们显示成「未归类」——而那两词在当时的词表里
 * 是有明确含义的，降级显示反而是信息损失。
 *
 * **写入门禁不受此类型影响**：受控写入侧 `validateDirectionCompleteness`
 * （`lib/workcase-writer.js`）独立判定，只认 `WORKCASE_ADVICE_KINDS`。
 */
export type WorkCaseAdviceDisplayKind = WorkCaseAdviceKind | WorkCaseAdviceLegacyKind

/** 建议段标记：`- advice:` 或 `- 建议：`（`21 §8`）。 */
const ADVICE_BLOCK = /^(advice|建议)\s*[:：]?$/
/** 建议条目形态：去向词以 `**` 包裹并位于行首，后接 `：`（`21 §8`）。 */
const ADVICE_TITLED = /^\*\*(.+?)\*\*\s*[:：]?\s*([\s\S]*)$/
/**
 * 存量尾注：`出自「…」`（2026-09-28 前的形态，`21 §8` 现已删除该项）。
 *
 * 为什么仍要剥掉：新形态靠**按序配对**与 `result.residual` 对应，尾注不再是任何
 * 字段的来源；但存量载体里它还在，若原样留下就会混进正文一起上卡面，把
 * 「某条残留」这类**元信息**当成去向正文的一部分显示给读者。
 */
const ADVICE_LEGACY_FROM = /出自「([^」]+)」\s*$/

export interface WorkCaseDraftCheck {
  /** 对应 `plan` 的 0-based 下标；-1 表示未能与该结果节条目配对。 */
  planIndex: number
  status: WorkCaseCheckStatus | null
}

export interface WorkCaseDraftAdvice {
  /** 去向词；落在闭集或存量词表之外时为 null（呈现为「未归类」）。 */
  kind: WorkCaseAdviceDisplayKind | null
  text: string
}

export interface WorkCaseResultDraft {
  checks: WorkCaseDraftCheck[]
  advice: WorkCaseDraftAdvice[]
  /**
   * 建议段前的一段独立说明（可选）。目前唯一来源是**事后补记声明**——为
   * 2026-09-23 建议段登记前已关闭的对象补写去向时（Human 授权，2026-09-24），
   * 段前须声明「本条为事后补记，非关闭当时的 Gate 2 提请内容」。
   *
   * 为什么要带上卡面：该声明的用途正是让**读者**知道这段去向不是关闭时的提请输入。
   * 若只留在详情面，卡面读者仍会以为它当初被提请过——声明就失去意义。
   * 形态：`- advice:` 块**之前**、与它空行相隔的一个非 bullet 段落（写作约定）。
   */
  adviceNote: string | null
  /**
   * 残留条目（`21 §8` 的「## 结果」节 `- residual:` 段）。
   *
   * 为什么这里也产出：`status = open` 时 `result` 字段尚不存在（`result` 出现 ⇔
   * `status = closed`），故「待批准关闭」期的残留**只在正文里**——卡面要显示它就只能
   * 解析正文。已关闭期则相反：`result.residual` 字段权威，卡面直读字段、不用本字段。
   * **同一份信息仍只有一处承载**（正文），只是两个期的**权威来源**不同。
   */
  residual: string[]
}

function statusOf(text: string): WorkCaseCheckStatus | null {
  for (const [word, status] of CHECK_WORDS) {
    if (text.includes(word)) return status
  }
  return null
}

function adviceKindOf(word: string): WorkCaseAdviceDisplayKind | null {
  for (const kind of WORKCASE_ADVICE_KINDS) {
    if (word === kind) return kind
  }
  // 存量词（2026-09-28 前登记的闭集）：只为呈现，不作为写入侧认可的去向。
  for (const kind of WORKCASE_ADVICE_LEGACY_KINDS) {
    if (word === kind) return kind
  }
  return null
}

/**
 * 取正文里的「## 结果」节原文（不含标题行）。
 *
 * 与 `bodyHasResultSection` 同一 ATX 语义：忽略代码围栏内的行、容许 ≤3 空格缩进。
 * 找不到时返回空串。
 */
export function resultSectionOf(body: unknown): string {
  if (typeof body !== 'string' || body.length === 0) return ''
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  let inFence = false
  let fenceMarker = ''
  let collecting = false
  for (const line of lines) {
    const fence = /^ {0,3}(```|~~~)/.exec(line)
    if (fence) {
      const marker = fence[1]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      if (collecting) out.push(line)
      continue
    }
    if (!inFence && /^ {0,3}##\s+\S/.test(line)) {
      // 任何 H2 都是节的边界：进入「结果」或离开它
      if (/^ {0,3}##\s+结果\s*$/.test(line)) {
        collecting = true
        continue
      }
      if (collecting) break
    }
    if (collecting) out.push(line)
  }
  return out.join('\n').trim()
}

/**
 * 取正文里指定 H2 节的原文（不含标题行）。与 `resultSectionOf` **同一 ATX 语义**：
 * 忽略代码围栏内的行、容许 ≤3 空格缩进、任何其它 H2 即节的边界。
 *
 * 为什么需要通用版（Human 裁定 2026-09-24，详情页统一）：`21 §8` 的正文 H2 闭集是
 * `摘要 / 授权范围 / 计划 / 执行 / 结果`，其中**「执行」与「结果」两节没有对应的
 * frontmatter 字段承载**——只能从正文读。详情页按固定序列呈现时，这两节须各占一个
 * 节点（`docs/01 §1.10` 内容结构第 5 条：「正文完整渲染、不截断」）。
 *
 * 另三节（摘要 / 授权范围 / 计划）**不另设正文节点**：它们与 `summary` / `scope` /
 * `plan` 三个字段节点内容重复（`21 §8` 的「载体内聚」要求字段值在正文逐字出现），
 * 重复呈现无增益。
 */
export function h2SectionOf(body: unknown, heading: string): string {
  if (typeof body !== 'string' || body.length === 0) return ''
  if (typeof heading !== 'string' || heading.length === 0) return ''
  const target = new RegExp(`^ {0,3}##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  let inFence = false
  let fenceMarker = ''
  let collecting = false
  for (const line of lines) {
    const fence = /^ {0,3}(```|~~~)/.exec(line)
    if (fence) {
      const marker = fence[1]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      if (collecting) out.push(line)
      continue
    }
    if (!inFence && /^ {0,3}##\s+\S/.test(line)) {
      if (target.test(line)) {
        collecting = true
        continue
      }
      if (collecting) break
    }
    if (collecting) out.push(line)
  }
  return out.join('\n').trim()
}

interface PlanStepLike {
  step?: unknown
}

/**
 * 解析「## 结果」节为卡片可呈现的草稿。
 *
 * 配对方式（三种实测形态，均按 `plan` 下标对齐）：
 *   ① `- 步骤 N 判据「…」：<词>——证据：…`  → 按 N
 *   ② `- 步骤 N–M：<词>——证据：…`          → 按区间 N..M
 *   ③ `- <名称>：<词>——证据：…`            → 按 `plan[i].step` 逐字/前缀匹配
 * 配对不上的步不产出条目（调用方按「无对应条目」呈现）。
 *
 * 建议段（`21 §8`）：`- advice:` 之下每条 `- **<去向词>**：<正文>`，**按序**
 * 对应 `result.residual`（第 k 条 ↔ 第 k 项）。去向词落在闭集二词或存量两词之外
 * 时记 `kind: null`（呈现为「未归类」）；存量写法里的 `出自「…」` 尾注会被剥离，
 * 不再作为任何字段产出（`21 §8` 已删该项，`§15.3` 存量不溯及）。
 */
export function parseWorkCaseResultDraft(body: unknown, plan: unknown): WorkCaseResultDraft {
  const section = resultSectionOf(body)
  const result: WorkCaseResultDraft = { checks: [], advice: [], residual: [], adviceNote: null }
  if (!section) return result

  const steps: PlanStepLike[] = Array.isArray(plan) ? (plan as PlanStepLike[]) : []
  const stepTexts = steps.map((s) => (typeof s?.step === 'string' ? s.step.trim() : ''))
  const byIndex = new Map<number, WorkCaseCheckStatus | null>()

  let mode: 'checks' | 'residual' | 'advice' | null = null
  let modeIndent = 0

  for (const rawLine of section.split('\n')) {
    const bullet = /^(\s*)-\s+(.*)$/.exec(rawLine)
    if (!bullet) {
      // 非 bullet 行：只有**明确的事后补记声明**才记录（见 `adviceNote` 注释）。
      //
      // 为什么不用「建议段前的段落」这种宽判据：实测它会把任何前文都当声明——
      // `8d2ba256` 抓到的是 `### Gate 2 提请`（标题）、`be30b5f7` 抓到的是
      // `1. workcase tab …`（清单行）、`af430278` 抓到的是正文段落。那会把噪音
      // 送上卡面。声明是本仓登记的固定写法，故按写法精确匹配。
      const t = rawLine.trim()
      if (result.adviceNote === null && BACKFILL_NOTE.test(t)) result.adviceNote = t
      continue
    }
    const indent = bullet[1].length
    const item = bullet[2].trim()

    // ── 块切换 ──
    if (/^criteria_checks\s*:?$/.test(item) || /^判据逐条核对\s*[:：]?$/.test(item)) {
      mode = 'checks'; modeIndent = indent; continue
    }
    if (/^residual\s*:?$/.test(item) || /^残留责任\s*[:：]?$/.test(item)) {
      mode = 'residual'; modeIndent = indent; continue
    }
    if (ADVICE_BLOCK.test(item)) {
      // **建议段不累积**：`mode` 为 'advice' 时遇第二个开启符即闭合（不并入前段）。
      // 注意这不是「只读首段」：`mode` 闭合后**第三个开启符会再次开段**，
      // 故 3 个开启符时读到的是第 1 段与第 3 段的条目（实测 3→2 条）。
      // 写入器用同一状态机（`mode` 闭合后再遇开启符即重开），故两处逐案同数；
      // 而 `blocks > 1` 时写入器整体拒绝（`21 §8/§15.1` 硬门禁⑤），该形态不可达。
      //
      // 为什么要与写入器逐字一致（2026-09-28 更正）：此前本解析器**无条件切换段**且
      // 不清空 `result.advice`，多个建议段会被**累积**读取；而受控写入器对同一正文
      // 只读一段。同一正文在两处给出不同条数，使「条数 = `result.residual` 长度」
      // 这一硬门禁在呈现层失去意义。现两处同口径；多开启符形态另由写入器硬门禁⑤
      // 在受控写入层整体拒绝（`21 §8/§15.1`），**且⑤状态无关**（不只在 closed 生效），
      // 故该形态在任何状态都不能经受控入口落盘（2026-09-28 更正：此前⑤随 closed 缺省，
      // open 期可落盘多段正文，第 2 段条目会「正文里有、卡面不可见」）。
      if (mode === 'advice') {
        mode = null
        continue
      }
      mode = 'advice'; modeIndent = indent; continue
    }
    if (/^(achieved_scope|已证实范围)\s*[:：]/.test(item)) { mode = null; continue }

    const isTopLevel = indent <= modeIndent

    // ── `- advice:` 段内 ──
    if (mode === 'advice') {
      // 同级或更浅的 bullet 结束本段——与 `residual` 段同一收束规则（见下方
      // `mode === 'residual'` 分支的同款注释）。
      //
      // 为什么必须收束（实测 2026-09-27，workcase-63700bd2）：`21 §10.2` 要求
      // Gate 2 提请除「剩余责任的去向」（**逐条**，落在建议段）之外，还给出
      // 「关闭后的后续方向」（**整单一条**，与前者**不同层**，且明写「呈现层
      // 不单独读取」）。后者是正文里的**另一个顶层 bullet**（缩进 0），而建议
      // 段条目缩进 2。缺少本收束时它被吞入 advice，产出 `kind: null` 的伪条目
      // ——卡面因此多出一条空分类的「去向」，且违反 §10.2 的分层。
      if (indent <= modeIndent) {
        mode = null
        continue
      }
      const titled = ADVICE_TITLED.exec(item)
      const kindText = titled ? titled[1].trim() : ''
      let body = titled ? titled[2].trim() : item
      // 存量尾注剥离：只从正文里去掉，不产出任何字段（见 `ADVICE_LEGACY_FROM`）。
      const legacyFrom = ADVICE_LEGACY_FROM.exec(body)
      if (legacyFrom) body = body.slice(0, legacyFrom.index).trim()
      result.advice.push({ kind: adviceKindOf(kindText), text: body || item })
      continue
    }

    // ── 顶层「步骤 …」形态（含 ①②）──
    if (mode === null || isTopLevel) {
      const range = /^步骤\s*(\d+)\s*[–\-~]\s*(\d+)\s*[:：]\s*(.+)$/s.exec(item)
      if (range) {
        const a = Number(range[1]); const b = Number(range[2]); const st = statusOf(range[3])
        for (let n = a; n <= b; n += 1) if (!byIndex.has(n - 1)) byIndex.set(n - 1, st)
        continue
      }
      const single = /^步骤\s*(\d+)\s*[:：]\s*(.+)$/s.exec(item)
      if (single) {
        const i = Number(single[1]) - 1
        if (!byIndex.has(i)) byIndex.set(i, statusOf(single[2]))
        continue
      }
    }

    // ── checks 段内 ──
    if (mode === 'checks') {
      const crit = /^步骤\s*(\d+)\s*判据「.*?」\s*[:：]\s*(.+)$/s.exec(item)
      if (crit) {
        const i = Number(crit[1]) - 1
        if (!byIndex.has(i)) byIndex.set(i, statusOf(crit[2]))
        continue
      }
      // ③ 名称形态：按 plan.step 匹配（取最长命中，避免短名误配）
      const named = /^(.*?)\s*[:：]\s*(.+)$/s.exec(item)
      if (named && stepTexts.length > 0) {
        const name = named[1].trim()
        let best = -1
        for (let i = 0; i < stepTexts.length; i += 1) {
          const st = stepTexts[i]
          if (!st) continue
          if (st === name || st.startsWith(name) || name.startsWith(st)) {
            if (best === -1 || st.length > stepTexts[best].length) best = i
          }
        }
        if (best >= 0 && !byIndex.has(best)) byIndex.set(best, statusOf(named[2]))
      }
      continue
    }

    // ── residual 段内 ──
    //
    // 本段此前**不产出条目**（只识别、不抽取）。原因：本模块原只服务「待批准关闭」卡，
    // 而那张卡当时不显示残留，抽出来也没有消费者。`21 §8` 另规定本段不得再写
    // 「建议…」子句（建议只有一处承载），故不抽建议是对的——但**残留条目本身**一直
    // 是该期的真实信息，只是没有呈现出口。
    //
    // 2026-09-24 补抽取：卡面新增残留块（Human 裁定），而该期残留无字段承载、
    // 只能来自正文。抽取**逐条忠实**——不去标记、不截断、不合并，Markdown 剥离由
    // 呈现层负责（此时尚未剥离，与其它段一致）。
    if (mode === 'residual') {
      // 同级或更浅的 bullet 结束本段（如后续的 `- advice:`）——与取消记录解析器同一收束规则。
      // 实测真实数据：段标记 `- residual:` 缩进 0、条目缩进 2，故 `indent <= modeIndent`
      // 的 bullet 必属下一段，不得吞入。
      if (indent <= modeIndent) {
        mode = null
        continue
      }
      result.residual.push(item)
      continue
    }
  }

  result.checks = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([planIndex, status]) => ({ planIndex, status }))

  return result
}

// ---------------------------------------------------------------------------
// 取消记录（`21 §8`，仅 `outcome = cancelled`）
// ---------------------------------------------------------------------------

/**
 * 取消记录的两行（`21 §8`）：`- cancellation:` 之下 `**理由**：…` 与
 * `**未发生的范围**：…`。
 *
 * 两行**均必填且非空**——`21 §9.2`/`§9.3` 已明文要求「记录取消理由与未发生的范围」，
 * 本节只是给该要求一个可机械识别的形态（`§15.1` 取消记录完备性）。
 *
 * 为什么单列承载而不再借用 `achieved_scope`（实测理由）：本仓唯一一份 cancelled
 * 对象（`workcase-af430278`）把两件事合并写进了 `achieved_scope`——一个语义为
 * 「已证实范围」（做成了什么）的字段里装着「未发生的范围」，而取消恰恰意味着什么都
 * 没做。它靠作者自觉使用行内标签才可读；机械层对该字段只校验非空，故「本工单取消」
 * 四字同样通过。呈现层因此取不到取消理由，卡面只能整段不显示。
 */
export const WORKCASE_CANCELLATION_LABELS = ['理由', '未发生的范围'] as const
export type WorkCaseCancellationLabel = (typeof WORKCASE_CANCELLATION_LABELS)[number]

export interface WorkCaseCancellationRecord {
  reason: string
  unstartedScope: string
}

/** 取消记录段的分块标记：`- cancellation:`（`21 §8`）。 */
const CANCELLATION_BLOCK = /^(cancellation|取消记录)\s*[:：]?$/
/** 取消记录的行形态：`**<标签>**：<内容>`（`21 §8`）。 */
const CANCELLATION_LINE = /^\*\*(.+?)\*\*\s*[:：]\s*([\s\S]*)$/

/**
 * 解析正文「## 结果」节的取消记录。
 *
 * 任一行缺失或为空时，对应字段记空串（**不猜、不填占位**）——调用方据此判定
 * 「记录不完整」，而不是把一个残缺记录当成完整记录呈现。
 * 非取消对象（无 `- cancellation:` 段）返回 `null`。
 */
export function parseWorkCaseCancellation(body: unknown): WorkCaseCancellationRecord | null {
  const section = resultSectionOf(body)
  if (!section) return null

  let seen = false
  const found: Partial<Record<WorkCaseCancellationLabel, string>> = {}
  let mode = false
  let modeIndent = 0

  for (const rawLine of section.split('\n')) {
    const bullet = /^(\s*)-\s+(.*)$/.exec(rawLine)
    if (!bullet) continue
    const indent = bullet[1].length
    const item = bullet[2].trim()

    if (!mode) {
      if (CANCELLATION_BLOCK.test(item)) {
        mode = true
        modeIndent = indent
        seen = true
      }
      continue
    }
    // 段内：同级或更浅的其它 bullet 结束本段（如后续的 `- residual:`）
    if (indent <= modeIndent && !CANCELLATION_LINE.test(item)) {
      mode = false
      continue
    }
    const line = CANCELLATION_LINE.exec(item)
    if (!line) continue
    const label = line[1].trim()
    if ((WORKCASE_CANCELLATION_LABELS as readonly string[]).includes(label)) {
      const key = label as WorkCaseCancellationLabel
      if (found[key] === undefined) found[key] = line[2].trim()
    }
  }

  if (!seen) return null
  return { reason: found['理由'] ?? '', unstartedScope: found['未发生的范围'] ?? '' }
}
