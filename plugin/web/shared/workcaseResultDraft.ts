// 「## 结果」节解析：把关闭提案的正文承载转成卡片可呈现的结构。
//
// 依据 `21 §8`：`result` 字段出现 ⇔ `status = closed`。故「待批准关闭」期
// （`status = open`）的**核对结论与去向只在正文「## 结果」节里**，卡片从字段读不到。
// 本模块只做**形态解析**，不做语义判断：
//
//   · 核对状态只认 `21 §8` 登记的三词（达成 / 部分达成 / 未达成）；无法判定时记
//     `null`（呈现为「未记录」），**不猜**、不把同义词静默归一。
//   · 去向只认 `21 §8` 登记的去向子项与闭集去向词（接受现状 / 转入 Spark）；
//     去向词不在闭集内记 `null`（呈现为「未归类」）。
//
// **必须能读两种形态**（`21 §15.3`「形态二次修订后的存量口径」）：
//
//   · **合并式**（2026-09-28 二次修订后的新写入，`§8`）——去向**长在每条残留里面**：
//     `- residual:` 之下每条残留条目自带一个更深一层的去向子项。**这是新写入的唯一
//     形态**，也是「待批准关闭」卡「残留（含去向）」一块的数据源。
//   · **分离式**（存量，`§15.3` 存量不溯及）——`- residual:` 段陈述残留、`- advice:`
//     段陈述去向，两者靠位置对齐。实测 17 份 closed 中 16 份为分离式，**不因新形态
//     而变得不可读**，故解析器按实际出现的形态读取。
//
// 这不是「双权威」：同一对象在其载体中只有一种形态（`§15.3` 明文）。「不溯及」在
// 消费侧的必要条件正是「两处都要能解析」——只认一种会让存量对象的去向（或残留）
// 在卡面上静默消失。
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

/** 残留段开启符：`- residual:` / `- 残留责任:`（`21 §8`，冒号可省）。 */
const RESIDUAL_BLOCK = /^(residual|残留责任)\s*[:：]?$/
/** 旧形态的独立建议段开启符（`21 §8` 2026-09-28 二次修订后不再登记，仅存量可读）。 */
const ADVICE_BLOCK = /^(advice|建议)\s*[:：]?$/
/** 去向子项/去向条目形态：去向词以 `**` 包裹并位于行首，后接 `：`（`21 §8`，冒号可省）。 */
const ADVICE_TITLED = /^\*\*(.+?)\*\*\s*[:：]?\s*([\s\S]*)$/
/**
 * 存量尾注：`出自「…」`（2026-09-28 前的分离式形态，`21 §8` 现已声明其**退休**）。
 *
 * 为什么仍要剥掉：合并式靠**主从结构**把去向挂在其残留上，尾注不再是任何字段的
 * 来源；但存量载体里它还在，若原样留下就会混进正文一起上卡面，把「某条残留」这类
 * **元信息**当成去向正文的一部分显示给读者。**这不是新特性**——它只服务存量可读性
 * （`§15.3` 存量不溯及），新写入不再产生它。
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

/**
 * 一条残留条目及其去向子项（`21 §8` 合并式形态）。
 *
 * `directions` 是**该条残留自带**的去向子项（主从关系由形态本身承载，不再是需要核验
 * 的按序配对约定）。长度 > 1 或为 0 都是形态违规——那由写入侧门禁③拒绝（`§15.1`），
 * 呈现层只**如实呈现**它读到的内容，不替作者补齐、也不静默丢弃。
 */
export interface WorkCaseDraftResidualEntry {
  /** 残留正文（逐条忠实，不剥 Markdown——剥离是呈现层的事）。 */
  text: string
  /** 该条残留的去向子项；合并式下恰为 1 条（分离式与旧存量下可为 0 条）。 */
  directions: WorkCaseDraftAdvice[]
}

export interface WorkCaseResultDraft {
  checks: WorkCaseDraftCheck[]
  /**
   * 去向条目（**平铺**，供「只有去向」的呈现面使用）。
   *
   * 来源有两种形态（见文件头）：
   *   · 合并式——各残留条目的去向子项，按残留顺序平铺；
   *   · 分离式（存量）——`- advice:` 段内逐条。
   *
   * **平铺是给「已关闭」卡的**（`10 §5.5`：关闭期去向条**提升为平级行**，因为
   * `21 §8` 要求其正文自足、正是为该期可独立阅读）。需要主从关系时读 `residualEntries`。
   */
  advice: WorkCaseDraftAdvice[]
  /**
   * 建议段前的一段独立说明（可选）。目前唯一来源是**事后补记声明**——为
   * 2026-09-23 建议段登记前已关闭的对象补写去向时（Human 授权，2026-09-24），
   * 段前须声明「本条为事后补记，非关闭当时的 Gate 2 提请内容」。
   *
   * 为什么要带上卡面：该声明的用途正是让**读者**知道这段去向不是关闭时的提请输入。
   * 若只留在详情面，卡面读者仍会以为它当初被提请过——声明就失去意义。
   * 形态：残留段（或存量建议段）**之前**、与它空行相隔的一个非 bullet 段落（写作约定）。
   */
  adviceNote: string | null
  /**
   * 残留条目（`21 §8` 的「## 结果」节 `- residual:` 段）——**逐条原文**。
   *
   * 为什么这里也产出：`status = open` 时 `result` 字段尚不存在（`result` 出现 ⇔
   * `status = closed`），故「待批准关闭」期的残留**只在正文里**——卡面要显示它就只能
   * 解析正文。已关闭期则相反：`result.residual` 字段权威，卡面直读字段、不用本字段。
   * **同一份信息仍只有一处承载**（正文），只是两个期的**权威来源**不同。
   *
   * **该数组是 `residualEntries[].text` 的投影**（同一次解析、同一份数据，不另走一遍
   * 正则），故两者不可能漂移。
   */
  residual: string[]
  /**
   * 残留条目及其去向子项（合并式形态；`21 §8`）。
   *
   * 与 `residual` **同源同序**：`residual[i] === residualEntries[i].text`。
   * 分开给是因为两个消费面需要不同粒度：
   *   · 「待批准关闭」卡要**主从**（去向缩进显示在所属残留之下）；
   *   · 「已关闭」卡的**条件豁免判据**（`10 §5.5`：「该对象每条残留都带有去向子项」）
   *     也读这里——不满足前提者如实保留残留块，不得套用决定 A 使残留静默消失。
   */
  residualEntries: WorkCaseDraftResidualEntry[]
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
 * **去向的两种形态**（见文件头，`21 §8` / `§15.3`）：
 *   · 合并式——`- residual:` 之下每条残留条目自带一个**更深**的去向子项
 *     `- **<去向词>**：<正文>`；子项挂在其所属残留上（主从），同时按残留顺序
 *     **平铺**进 `advice`（关闭期去向条提升为平级行，`10 §5.5`）。
 *   · 分离式（存量）——`- advice:` 段内每条 `- **<去向词>**：<正文>`，按序对应
 *     `result.residual`（第 k 条 ↔ 第 k 项，写法约定）。
 *
 * 去向词落在闭集二词或存量两词之外时记 `kind: null`（呈现为「未归类」）；存量写法
 * 里的 `出自「…」` 尾注会被剥离，不再作为任何字段产出（`21 §8` 已声明其退休，
 * `§15.3` 存量不溯及）。
 *
 * **与写入器同口径**（`lib/workcase-writer.js` 的 `parseResidualSection`）：两处对
 * 同一正文必须给出**相同条数**——否则 `§15.1` 门禁②（残留段条数 = `result.residual`
 * 长度）在呈现层失去意义。已对齐的口径：
 *   · 开启符 `- residual:`／`- 残留责任:`，冒号可省；
 *   · 与开启符**同级或更浅**的 bullet 不属残留段（按零条计）；
 *   · **比残留条目更深**的 bullet 一律计为该残留的去向子项——**判别靠缩进，不靠加粗
 *     形态**：不达 `- **<去向词>**：<正文>` 者照样计入（记 `kind: null`），由门禁⑥
 *     拒绝。这是 `§15.1` 判据边界第三条明文要求的读法（不得丢弃、也不得当成新残留）；
 *   · 与残留条目**同级或更浅**的去向条目不构成该残留的子项（按零条计），此时它自己
 *     成为一条新残留条目；
 *   · **多开启符不累积**：第二个开启符即闭合并跳过（写入器另用 `blocks > 1` 由门禁①
 *     整体拒绝，`§15.1` 明文「不得择一推断条数」）。
 */
export function parseWorkCaseResultDraft(body: unknown, plan: unknown): WorkCaseResultDraft {
  const section = resultSectionOf(body)
  const result: WorkCaseResultDraft = {
    checks: [],
    advice: [],
    residual: [],
    residualEntries: [],
    adviceNote: null,
  }
  if (!section) return result

  const steps: PlanStepLike[] = Array.isArray(plan) ? (plan as PlanStepLike[]) : []
  const stepTexts = steps.map((s) => (typeof s?.step === 'string' ? s.step.trim() : ''))
  const byIndex = new Map<number, WorkCaseCheckStatus | null>()

  let mode: 'checks' | 'residual' | 'advice' | null = null
  let modeIndent = 0
  /** residual 段内：当前所属残留条目的缩进；`null` 表示尚未读到任何条目。 */
  let residualEntryIndent: number | null = null

  /** 去向正文的公共归一：剥存量尾注、判去向词。 */
  const toDirection = (item: string): WorkCaseDraftAdvice => {
    const titled = ADVICE_TITLED.exec(item)
    const kindText = titled ? titled[1].trim() : ''
    let text = titled ? titled[2].trim() : item
    // 存量尾注剥离：只从正文里去掉，不产出任何字段（见 `ADVICE_LEGACY_FROM`）。
    const legacyFrom = ADVICE_LEGACY_FROM.exec(text)
    if (legacyFrom) text = text.slice(0, legacyFrom.index).trim()
    return { kind: adviceKindOf(kindText), text: text || item }
  }

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
      mode = 'checks'; modeIndent = indent; residualEntryIndent = null; continue
    }
    if (RESIDUAL_BLOCK.test(item)) {
      // **残留段不累积**：`mode` 为 'residual' 时遇第二个开启符即闭合（不并入前段）。
      // 与写入器同一状态机；多开启符形态另由写入器门禁①在受控写入层整体拒绝
      //（`21 §8/§15.1`），**且①状态无关**（不只在 closed 生效），故该形态在任何
      // 状态都不能经受控入口落盘。
      if (mode === 'residual') {
        mode = null
        residualEntryIndent = null
        continue
      }
      mode = 'residual'; modeIndent = indent; residualEntryIndent = null; continue
    }
    if (ADVICE_BLOCK.test(item)) {
      // 存量分离式（`§15.3`）：`- advice:` 段独立存在，条目缩进在其下。
      //
      // **不累积**：`mode` 为 'advice' 时遇第二个开启符即闭合（不并入前段）。
      // 注意这不是「只读首段」：`mode` 闭合后**第三个开启符会再次开段**，
      // 故 3 个开启符时读到的是第 1 段与第 3 段的条目（实测 3→2 条）。
      // 写入器用同一状态机（`mode` 闭合后再遇开启符即重开），故两处逐案同数；
      // 而新写入出现该开启符即被拒绝（`21 §8`：不再另设独立的建议段），该形态
      // 在受控写入下不可达——本分支只服务存量载体。
      if (mode === 'advice') {
        mode = null
        continue
      }
      mode = 'advice'; modeIndent = indent; residualEntryIndent = null; continue
    }
    if (/^(achieved_scope|已证实范围)\s*[:：]/.test(item)) { mode = null; continue }

    const isTopLevel = indent <= modeIndent

    // ── `- advice:` 段内（存量分离式）──
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
      result.advice.push(toDirection(item))
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

    // ── residual 段内（合并式：残留条目 + 其去向子项）──
    //
    // 本段此前**不产出条目**（只识别、不抽取）。原因：本模块原只服务「待批准关闭」卡，
    // 而那张卡当时不显示残留，抽出来也没有消费者。`21 §8` 另规定本段不得再写
    // 「建议…」子句（建议只有一处承载），故不抽建议是对的——但**残留条目本身**一直
    // 是该期的真实信息，只是没有呈现出口。
    //
    // 2026-09-24 补抽取：卡面新增残留块（Human 裁定），而该期残留无字段承载、
    // 只能来自正文。抽取**逐条忠实**——不去标记、不截断、不合并，Markdown 剥离由
    // 呈现层负责（此时尚未剥离，与其它段一致）。
    //
    // 2026-09-28 二次修订：去向**长在残留里面**，故本段同时产出主从结构
    //（`residualEntries`）与平铺去向（`advice`，供关闭期「去向」一块使用）。
    if (mode === 'residual') {
      // 同级或更浅的 bullet 结束本段（如后续的 `- advice:`）——与取消记录解析器同一
      // 收束规则。实测真实数据：段标记 `- residual:` 缩进 0、条目缩进 2，故
      // `indent <= modeIndent` 的 bullet 必属下一段，不得吞入。
      if (indent <= modeIndent) {
        mode = null
        residualEntryIndent = null
        continue
      }
      // 比残留条目更深 → 该残留的**去向子项**（判别靠缩进，不靠加粗形态；不达
      // `- **<去向词>**：<正文>` 者照样计入，记 `kind: null`——`§15.1` 判据边界第三条）。
      if (residualEntryIndent !== null && indent > residualEntryIndent) {
        const last = result.residualEntries[result.residualEntries.length - 1]
        const direction = toDirection(item)
        last.directions.push(direction)
        // 平铺视图（关闭期去向条提升为平级行，`10 §5.5`）与主从视图同源。
        result.advice.push(direction)
        continue
      }
      // 与开启符更深、与残留条目同级或更浅 → 新的一条残留条目。
      residualEntryIndent = indent
      result.residualEntries.push({ text: item, directions: [] })
      continue
    }
  }

  result.checks = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([planIndex, status]) => ({ planIndex, status }))

  // `residual` 是 `residualEntries[].text` 的**投影**（同一次解析的同一份数据），
  // 故两者不可能漂移——不另走一遍正则。
  result.residual = result.residualEntries.map((entry) => entry.text)

  return result
}

// ---------------------------------------------------------------------------
// 「已关闭」期：决定 A 的条件豁免判据（`21 §8`/`§10.2`/`§15.3`，`10 §5.5`）
// ---------------------------------------------------------------------------

/**
 * 决定 A 的**条件豁免判据**（`10 §5.5`「条件豁免」段 / `21 §15.3`）。
 *
 * `10 §5.5` 规定关闭后卡面与详情**只呈现去向、不再呈现残留**（决定 A），但 A 的
 * 适用以两个前提为限：① 该对象采用**合并式**形态（每条残留自带去向子项）；
 * ② 去向正文满足 `21 §8` 的自足要求。**不满足者不得套用 A**。
 *
 * 为什么必须豁免：存量分离式对象不受新形态约束（`21 §15.3`），其中实测 6 份的建议段
 * 条数**少于** `result.residual` 长度（缺口 3／2／5／2／3／7 条、合计 22 条）——这些
 * 残留**当年就没有去向**，且补写即属编造。若一律按 A 隐藏残留，那 22 条残留会从卡面
 * **静默消失**，而「不完整比不呈现更危险，因为它不像缺失」。
 *
 * **本函数只实现前提 ①（结构面），不实现前提 ②（语义面）**——`10 §5.5` 经 2026-09-28
 * 独立对抗复核后更正：两个前提的**判据强度不同，不得混同**。前提 ① 是**结构判据**，
 * 机械可判（「该对象**每条残留都带有去向子项**」——`entries` 非空且每条的 `directions`
 * 都非空）；前提 ②「去向正文**自足**」是**语义判据**，`21 §8` 与 `§15.1` 软约束均明确
 * 归 AI 语义审核与 Human 阅读，**机械层不判定**。
 *
 * **故不得据本函数声称「A 的适用条件已获机械保障」**——那会把语义前提偷换为结构前提
 *（`10 §5.5` 明文：该法在复核中被判为不成立，已更正）。且前提 ② 目前**零样本**：实测
 * 17 份 closed 的 56 条去向条目**全部**带 `出自「…」` 尾注，新形态下的自足去向正文
 * **从无一份实例**（`21 §15.2` 已登记该缺口）。
 *
 * **与 `21 §15.1` 门禁③ 的关系：同源但不等价**——门禁③ 要求「**恰有**一个」，多于一个
 * 即拒；本判据问的是「**都带有**」，只处理有无、不处理重复。另：存量对象的可收窄性
 * **不适用** `21 §15.1` 门禁整体（`§15.3` 存量豁免使该门禁对存量不生效），故本判据对
 * 存量只是**呈现选择**，不是门禁③的结果。
 *
 * **本函数是卡面与详情两处的唯一判据来源**（`10 §5.5`「判据与卡面同源…不得两处各写
 * 一套」）——两个呈现面都调用它，不得各自重写。
 *
 * @param entries 合并式解析出的残留条目及其去向子项（`parseWorkCaseResultDraft`）。
 */
export function workCaseClosureNarrowsResidual(
  entries: WorkCaseDraftResidualEntry[] | undefined,
): boolean {
  if (!Array.isArray(entries) || entries.length === 0) return false
  return entries.every((entry) => Array.isArray(entry?.directions) && entry.directions.length > 0)
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
