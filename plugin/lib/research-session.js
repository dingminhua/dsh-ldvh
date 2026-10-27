/**
 * dsh-ldvh — Research session runner (minimal research sub-agent orchestration).
 *
 * Implements the mechanical slice of specs/33 §7–§10:
 *
 *  - §5 入口澄清: detect ambiguity in the research question and produce
 *    ≤3 clarification questions (the caller surfaces them to Human;
 *    this module records answers or the degraded "unclarified" state).
 *  - §6 三层收敛: sufficient / no-gain / round-cap three-layer stopping
 *    criteria evaluated after each round.
 *  - §7 三态证据: confirmed / uncertain / gaps evidence-state shaping.
 *  - §8 引用闭环: verbatim-quote citation loop discipline.
 *
 * This module is a pure state machine + validator: it does NOT spawn
 * sub-agents itself (that is the 编排 layer's job per specs/33 §14.3).
 * The caller (main controller or a workflow) drives the rounds and feeds
 * back raw findings; this module validates, classifies into three states,
 * tracks convergence, and produces the final validated evidence bundle
 * ready for the Research writer (research-writer.js).
 */

// 发现单元的解析是正文结构层的东西，由 writer 的单一实现承载（03 §9.2 单一权威：
// 同一「发现单元」判定不得有两份实现）。research-writer 不 import 本模块，
// 故此依赖是单向的，不构成循环。
import { extractFindingUnits } from "./research-writer.js";

// ---------------------------------------------------------------------------
// §5 入口澄清 (clarification)
// ---------------------------------------------------------------------------

/**
 * Analyze the research question for ambiguity.
 * Returns { ok, value: { needsClarification, questions } } — questions is
 * an array of ≤3 structured clarification prompts.
 *
 * This is a heuristic pre-check (the LLM caller may extend it); the
 * returned questions are suggestions the caller can surface to Human.
 */
export function analyzeClarificationNeeds(question, purpose) {
  const questions = [];

  // Ambiguity type 1: multi-meaning technical terms without context
  const multiMeaningTerms = detectMultiMeaningTerms(question);
  if (multiMeaningTerms.length > 0) {
    questions.push({
      focus: "术语消歧",
      question: `调研中出现的「${multiMeaningTerms.join("、")}」具体指哪个含义？不同理解会导致调研范围完全不同。`,
    });
  }

  // Ambiguity type 2: multiple dimensions without priority
  if (/\b和\b|\b与\b|\b及\b|以及|、/.test(question) && !/优先|重点|主要/.test(purpose ?? "")) {
    questions.push({
      focus: "优先级",
      question: `调研问题涉及多个方面，哪个是本次最优先要回答的？`,
    });
  }

  // Ambiguity type 3: time/version/scope not bounded
  if (!/最新|当前|版本|v?\d+\.\d+|20\d\d/.test(question)) {
    questions.push({
      focus: "范围界定",
      question: `调研针对的时间范围或版本范围是什么？（如：最新稳定版、特定版本、过去一年）`,
    });
  }

  return { ok: true, value: { needsClarification: questions.length > 0, questions: questions.slice(0, 3) } };
}

/**
 * Build the clarification_log entry from Human's answers.
 * Returns the structured entry for the Research frontmatter, or a
 * degraded "unclarified" entry if Human declined.
 */
export function buildClarificationLogEntry(question, answer, answeredBy) {
  if (answeredBy === "declined") {
    return {
      question,
      answer: "（未澄清——Human 未响应或拒绝）",
      answered_by: "human",
    };
  }
  return { question, answer, answered_by: answeredBy };
}

function detectMultiMeaningTerms(text) {
  // Minimal heuristic: terms known to have multiple meanings in the
  // LDVH / DSH context that need disambiguation without further context.
  const ambiguous = [];
  const candidates = ["编排", "调研", "记忆", "遵守", "门", "hook", "session", "worker"];
  for (const term of candidates) {
    if (text.includes(term)) ambiguous.push(term);
  }
  return ambiguous;
}

// ---------------------------------------------------------------------------
// §8 三层收敛 (three-layer convergence)
// ---------------------------------------------------------------------------

/**
 * Evaluate the stopping criteria after a research round.
 *
 * @param {object} round — the completed round's findings
 * @param {Array} round.confirmed — confirmed evidence entries **this round**
 * @param {Array} round.gaps — open gaps after this round (cumulative)
 * @param {object} state — cumulative session state
 * @param {Array} state.subQuestions — the research sub-questions
 * @param {number} state.roundNumber — current round (1-based)
 * @param {number} state.maxRounds — round-cap limit
 * @param {number} state.consecutiveNoGainRounds — running no-gain counter
 * @param {Array} [state.cumulativeConfirmed] — confirmed evidence accumulated
 *   across **all** rounds; defaults to `round.confirmed` for single-round callers
 * @returns {object} { stop, reason, newNoGainCount }
 */
export function evaluateConvergence(round, state) {
  const { confirmed = [], gaps = [] } = round;
  const {
    subQuestions = [],
    roundNumber = 1,
    maxRounds = 4,
    consecutiveNoGainRounds = 0,
    cumulativeConfirmed = confirmed,
  } = state;

  // Layer 1: sufficient — 33 §8.1 第 1 项要求「每个子问题至少有 confirmed 证据
  // 覆盖且无阻塞该子问题结论的 high 优先级缺口」，两项条件同时满足。
  // 覆盖判定是三态（见 subQuestionCoverage）：只有 `covered` 才算满足；
  // `uncovered` 明确不满足；`untagged`（有子问题但无一条带 key）判不了，
  // 一律不判充分——判不了不等于通过。
  //
  // 覆盖必须看**累计**证据，不能看本轮。证据在调研过程中只增不减（§9 三态
  // 入库、§10 引用闭环都以累计库为单位），而「每个子问题至少有一条覆盖」的
  // 主语是整场调研、不是某一轮。旧实现把本轮 confirmed 传给覆盖判定，后果是
  // 多子问题调研永远收敛不了：R1 覆盖 q1、R2 覆盖 q2，R2 只拿 [q2] 去比，
  // q1 依然「未覆盖」，一路走到 round-cap——不是更严格，是判据方向写反了：
  // 轮次进度被当成了证据量。no-gain 层仍然只看本轮（它的语义就是「这一轮有
  // 没有新增」），所以两个输入必须分开：confirmed 管 no-gain，cumulativeConfirmed
  // 管覆盖。
  const highGaps = gaps.filter((g) => g.priority === "high");
  if (confirmed.length > 0 && highGaps.length === 0 && subQuestionCoverage(subQuestions, cumulativeConfirmed) === "covered") {
    return { stop: true, reason: "sufficient", newNoGainCount: 0 };
  }

  // Layer 3: round-cap — hard limit reached (checked before no-gain,
  // because a round with no new findings at the cap should be round-cap,
  // not no-gain)
  if (roundNumber >= maxRounds) {
    return { stop: true, reason: "round-cap", newNoGainCount: 0 };
  }

  // Layer 2: no-gain — zero new confirmed for two consecutive rounds
  if (confirmed.length === 0) {
    const newCount = consecutiveNoGainRounds + 1;
    if (newCount >= 2) {
      return { stop: true, reason: "no-gain", newNoGainCount: newCount };
    }
    return { stop: false, reason: null, newNoGainCount: newCount };
  }

  return { stop: false, reason: null, newNoGainCount: 0 };
}

/**
 * 判定「每个子问题是否都有 confirmed 覆盖」（33 §8.1 第 1 项）。
 *
 * 返回三态而非布尔值，因为这里真的存在**判不了**的情形：
 *
 * - `covered`：每个子问题都有带 key 的 confirmed 覆盖，可以判充分收敛；
 * - `uncovered`：有子问题明确没有覆盖，不充分；
 * - `untagged`：**有子问题但没有任何一条 confirmed 带 sub_question_key**——
 *   此时「覆盖」在字形上无法判定。
 *
 * 旧实现把 `untagged` 一律当 `covered`（注释自认 "lenient"），后果是
 * 「3 个子问题只调研了 1 个、且都没打标签」也会被判 `sufficient` 收敛，
 * 报告由此带上「充分收敛」的结论而三个子问题实际只碰了一个——这是把
 * **判不了**冒充成**通过了**，正是 00 §5.6 据实声明禁止的那件事。
 *
 * 现在的处置：`untagged` 不再返回 true，而是由调用方如实降级——不判充分，
 * 继续按轮次推进（达到上限即 round-cap，并据 §8.3 把未覆盖范围记进 gaps）。
 * 这样既不虚构通过，也不编造失败：报告最终以 round-cap + gap 的形式
 * 如实说出「这些子问题没被逐条覆盖」。
 *
 * @returns {"covered"|"uncovered"|"untagged"}
 */
function subQuestionCoverage(subQuestions, confirmed) {
  if (subQuestions.length === 0) return confirmed.length > 0 ? "covered" : "uncovered";
  const tagged = confirmed.filter((c) => typeof c.sub_question_key === "string" && c.sub_question_key !== "default");
  if (tagged.length === 0) return "untagged";
  const covered = new Set(confirmed.map((c) => c.sub_question_key ?? "default"));
  return subQuestions.every((sq) => covered.has(typeof sq === "string" ? sq : sq.key ?? "default"))
    ? "covered"
    : "uncovered";
}

// ---------------------------------------------------------------------------
// §9 三态证据 (three-state evidence shaping)
// ---------------------------------------------------------------------------

/**
 * Validate and shape a raw research finding into the three-state structure.
 *
 * @param {object} finding — raw finding from a research sub-agent
 * @param {string} finding.statement — the factual claim
 * @param {string} finding.state — "confirmed" | "uncertain" | "gap"
 * @param {object} [finding.evidence] — for confirmed: { text, anchor, source, confidence }
 * @param {object} [finding.issue] — for uncertain: { issue, reason }
 * @param {object} [finding.gap] — for gaps: { description, priority }
 * @returns {object} { ok, value } — shaped evidence entry, or { ok: false, error }
 */
export function shapeEvidence(finding) {
  if (typeof finding.statement !== "string" || finding.statement.length === 0) {
    return { ok: false, error: { code: "evidence/statement_missing", message: "statement is required" } };
  }

  switch (finding.state) {
    case "confirmed": {
      const { evidence } = finding;
      if (!evidence || typeof evidence.text !== "string" || evidence.text.length === 0) {
        return { ok: false, error: { code: "evidence/quote_missing", message: "confirmed requires a verbatim quote (text)" } };
      }
      if (typeof evidence.source !== "string" || !evidence.source.startsWith("http")) {
        return { ok: false, error: { code: "evidence/source_missing", message: "confirmed requires an HTTP(S) source URL" } };
      }
      if (typeof evidence.anchor !== "string" || evidence.anchor.length === 0) {
        return { ok: false, error: { code: "evidence/anchor_missing", message: "confirmed requires an anchor (locator)" } };
      }
      const confidence = evidence.confidence ?? "medium";
      if (!["high", "medium", "low"].includes(confidence)) {
        return { ok: false, error: { code: "evidence/bad_confidence", message: `confidence must be high/medium/low, got ${confidence}` } };
      }
      return {
        ok: true,
        value: {
          statement: finding.statement,
          confidence,
          quotes: [{ text: evidence.text, anchor: evidence.anchor, source: evidence.source }],
          sub_question_key: finding.sub_question_key ?? "default",
        },
      };
    }
    case "uncertain": {
      // The tool schema (research-tools.js findingSchema) declares `issue`
      // as a nested object { issue, reason }, mirroring the Research
      // frontmatter uncertain entry — read the fields from there, never
      // from the finding top level.
      const payload = finding.issue;
      if (typeof payload !== "object" || payload === null) {
        return { ok: false, error: { code: "evidence/issue_missing", message: 'uncertain requires a nested issue object { issue, reason } under "issue"' } };
      }
      const { issue, reason } = payload;
      if (typeof issue !== "string" || issue.length === 0) {
        return { ok: false, error: { code: "evidence/issue_missing", message: 'uncertain requires a nested issue object { issue, reason } under "issue"' } };
      }
      if (typeof reason !== "string" || reason.length === 0) {
        return { ok: false, error: { code: "evidence/reason_missing", message: "uncertain requires a reason inside the issue object" } };
      }
      return { ok: true, value: { issue, reason } };
    }
    case "gap": {
      // Same contract: `gap` is a nested object { description, priority },
      // mirroring the Research frontmatter gaps entry.
      const payload = finding.gap;
      if (typeof payload !== "object" || payload === null) {
        return { ok: false, error: { code: "evidence/description_missing", message: 'gap requires a nested gap object { description, priority } under "gap"' } };
      }
      const { description, priority } = payload;
      if (typeof description !== "string" || description.length === 0) {
        return { ok: false, error: { code: "evidence/description_missing", message: 'gap requires a nested gap object { description, priority } under "gap"' } };
      }
      const p = priority ?? "medium";
      if (!["high", "medium", "low"].includes(p)) {
        return { ok: false, error: { code: "evidence/bad_priority", message: `priority must be high/medium/low, got ${p}` } };
      }
      // 33 §9.3 / 24 §10: a gap may carry `blocked_scope` describing what the
      // missing information blocks. It was declared in the tool schema, accepted
      // by the writer and then silently dropped here — the caller saw the field
      // in its own input, saw no error, and the evidence bundle lost it. Carry
      // it through when present (absent stays absent: no empty-string default,
      // so the writer's "recorded as empty" vs "not recorded" distinction holds).
      const blockedScope = typeof payload.blocked_scope === "string" && payload.blocked_scope.length > 0
        ? payload.blocked_scope
        : undefined;
      return {
        ok: true,
        value: blockedScope === undefined
          ? { description, priority: p }
          : { description, priority: p, blocked_scope: blockedScope },
      };
    }
    default:
      return { ok: false, error: { code: "evidence/bad_state", message: `state must be confirmed/uncertain/gap, got ${finding.state}` } };
  }
}

// ---------------------------------------------------------------------------
// §10 引用闭环 (citation loop audit)
// ---------------------------------------------------------------------------

/**
 * Audit the citation loop of a research report body against the evidence.
 *
 * specs/33 §10.3 要求程序化审计四项：编号有对应条目 / 引文逐字一致 / 引用紧邻
 * 引文 / 无双倍长引用。审计不通过时报告不得交付。
 *
 * **两套引用体制，必须分别按各自的形态判**（实测依据：仓库 45 份 Research 对象）
 *  - §10.2 内联编号体制：`[声明编号] 逐字引文 + 来源 + 锚点`。实测 0 份对象使用；
 *    正文里出现的 `[0]` `[1]` 全是 `uncertain[0]`、`process.argv[1]` 这类**下标**。
 *  - 24 §8 溯源锚点体制：`关键发现`段每个发现单元末尾一行 `溯源：<ref>（<锚点>）`。
 *    实测 45 份对象全部使用这一套。
 *
 * 由此得出两条不能想当然的口径：
 *  1. `[n]` 必须是**引用编号**才算引用。前面紧跟 ASCII 标识符字符或闭合括号的，
 *     是指标下标，把它当引用会产生「reference [0] has no corresponding evidence
 *     entry」这种纯属误报的结论。
 *  2. `「」` 在真实报告里大量用于**强调**（实测 1793 处，无一处紧邻任何引用标记）。
 *     只有在正文确实启用了 `[n]` 编号体制时，`「」` 才承担「逐字引文」的语义；
 *     否则一律按强调处理，不参与引用审计。把标点当语义会让每份正常报告都报错。
 *
 * 旧实现的两个真缺陷（已修）：
 *  - 每行只 `match(/「([^」]+)」/)` 取**第一个**引文，同行第二个引文从不进扫描；
 *  - 编号与引文**彼此独立**校验（编号查范围、引文查「在不在任一条目里」），
 *    于是「[1] 标的是 A 的引文、引文其实出自 B」可以同时成立而无人发现。
 *    这不是宽松，是把 §10.3 第 2、3 项当成了两条互不相干的检查。
 *
 * @param {string} body — the report markdown body
 * @param {Array} confirmed — the confirmed evidence entries
 * @returns {object} { ok, issues }
 */

/** 引用编号与其引文之间允许出现的连接字符（§10.2 的 `[n] 逐字引文` 形态）。 */
const REF_QUOTE_GAP = /^[\s:：、，,。.\-—*_`"'“”「」()（）]*$/;
/** 连接段最大长度：超过就不算「紧邻」，而是另起一句话。 */
const REF_QUOTE_MAX_GAP = 24;

/** 24 §8 的溯源锚点行。 */
const TRACE_LINE = /^溯源：(.+?)（(.+?)）\s*$/;

/**
 * 取出 text 中的**引用编号**（排除 `uncertain[0]` 这类标识符下标）。
 * @returns {Array<{num:number,start:number,end:number}>}
 */
function citationRefsIn(text) {
  const out = [];
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const prev = m.index > 0 ? text[m.index - 1] : "";
    // 前一个字符是 ASCII 标识符字符或闭合括号 → 是指标下标，不是引用编号。
    if (/[\w$\])}]/.test(prev)) continue;
    out.push({ num: parseInt(m[1], 10), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function auditCitationLoop(body, confirmed) {
  const issues = [];
  const entries = normalizeConfirmedEntries(confirmed);

  // ---- 体制一：§10.2 内联编号 ----
  const refs = citationRefsIn(body);
  const refNumbers = new Set();
  for (const ref of refs) {
    refNumbers.add(ref.num);
    if (ref.num < 1 || ref.num > entries.length) {
      issues.push(`citation loop: reference [${ref.num}] has no corresponding evidence entry (1–${entries.length})`);
    }
  }

  // 没有任何一条 confirmed 条目带逐字摘录时，「找不到」是**无法核验**而非**写错**。
  // 审计仍然不通过（门不能对不可核验的输入放行），但结论必须说出真实原因。
  const anyQuotes = entries.some((c) => c.quotes.length > 0);

  // 正文是否真的启用了 `[n]` 编号体制 —— 决定 `「」` 是引文还是强调。
  const documentUsesRefs = refNumbers.size > 0;

  if (documentUsesRefs) {
    // 逐行、逐引文扫描（§10.3 第 2 项：每一处引文都要核，不是每行第一处）。
    for (const line of body.split("\n")) {
      const quotes = [...line.matchAll(/「([^」]+)」/g)];
      if (quotes.length === 0) continue;
      const refsOnLine = citationRefsIn(line);

      for (const q of quotes) {
        const quoteText = q[1];
        const label = `inline quote 「${quoteText.slice(0, 40)}${quoteText.length > 40 ? "…" : ""}」`;

        if (!anyQuotes) {
          issues.push(`citation loop: ${label} cannot be checked — no confirmed entry carries quote evidence (pass the finalize bundle entries, not bare statements)`);
          continue;
        }

        const owner = entries.find((c) => c.quotes.some((qq) => qq.text.includes(quoteText)));
        if (!owner) {
          issues.push(`citation loop: ${label} not found in any evidence entry`);
        }

        // (b) 紧邻的引用编号（§10.3 第 3 项 / §10.2 格式）
        const adjacent = refsOnLine
          .map((r) => {
            if (r.end <= q.index) {
              const gap = line.slice(r.end, q.index);
              return REF_QUOTE_GAP.test(gap) && gap.length <= REF_QUOTE_MAX_GAP ? { ...r, direction: "before" } : null;
            }
            if (r.start >= q.index + q[0].length) {
              const gap = line.slice(q.index + q[0].length, r.start);
              return REF_QUOTE_GAP.test(gap) && gap.length <= REF_QUOTE_MAX_GAP ? { ...r, direction: "after" } : null;
            }
            return null;
          })
          .filter(Boolean);

        if (adjacent.length === 0) {
          issues.push(`citation loop: ${label} has no adjacent [n] reference — 33 §10.3 第3项要求引用位置紧邻引文，§10.2 的格式是「[声明编号] 逐字引文 + 来源 + 锚点」`);
          continue;
        }

        // (c) 归属一致：引文必须出自它**所紧邻的那一个**编号对应的条目
        const target = adjacent[0];
        const entry = entries[target.num - 1];
        if (entry) {
          if (!entry.quotes.some((qq) => qq.text.includes(quoteText))) {
            issues.push(`citation loop: ${label} is annotated with [${target.num}] but does not appear in that entry's quote text — 编号与引文不对应`);
            continue;
          }
          // (d) 不得超出条目长度（§10.3 第 4 项）
          const longest = Math.max(...entry.quotes.map((qq) => qq.text.length), 0);
          if (quoteText.length > longest) {
            issues.push(`citation loop: ${label} is longer than the evidence text it cites (${quoteText.length} > ${longest}) — 33 §10.3 第4项禁止长段引用超出证据库条目长度`);
          }
        }
      }
    }
  }

  // ---- 体制二：24 §8 溯源锚点 ----
  // 每个发现单元末尾的 `溯源：<ref>（<锚点>）` 就是该单元的引用声明。§10.2 的
  // 「禁止引用未进入证据库的内容」在这一体制下等价于：溯源 ref 必须是证据库里
  // 真实出现过的来源。证据库没有来源信息时判不了，如实不判（不得因此放行成
  // 「通过」以外的结论）。
  const knownSources = new Set();
  for (const c of entries) for (const q of c.quotes) if (typeof q.source === "string") knownSources.add(q.source);
  if (knownSources.size > 0) {
    for (const line of body.split("\n")) {
      const m = line.match(TRACE_LINE);
      if (!m) continue;
      const ref = m[1].trim();
      if (!knownSources.has(ref)) {
        issues.push(`citation loop: 溯源 ref "${ref.slice(0, 60)}" does not resolve to any evidence entry source — 33 §10.2 禁止引用未进入证据库的内容`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Accept both shapes the two callers legitimately hold.
 *
 * The tool schema declares `confirmed` as `string[]` (the statements a caller
 * copies out of the finalize bundle), while `finalize()` itself hands back the
 * full evidence entries (`{ statement, quotes[], confidence, sub_question_key }`)
 * and the internal round loop works on those. Reading `.quotes` straight off a
 * string threw `TypeError: Cannot read properties of undefined (reading 'some')`
 * and the descriptor's catch turned it into an `execution_error` envelope — i.e.
 * the citation gate was unusable through its own declared contract.
 *
 * Normalising instead of narrowing the schema is deliberate: the statement-only
 * form is the one an AI can produce from a report without re-plumbing the
 * session, and it still supports checks (1) and (3) below. Quote matching simply
 * degrades to "no evidence can vouch for this quote" — reported, never silently
 * passed.
 */
function normalizeConfirmedEntries(confirmed) {
  if (!Array.isArray(confirmed)) return [];
  return confirmed
    .map((entry) => {
      if (typeof entry === "string") {
        return { statement: entry, quotes: [] };
      }
      if (entry === null || typeof entry !== "object") return null;
      const statement = typeof entry.statement === "string" ? entry.statement : "";
      const quotes = Array.isArray(entry.quotes)
        ? entry.quotes.filter((q) => q !== null && typeof q === "object" && typeof q.text === "string")
        : [];
      return { ...entry, statement, quotes };
    })
    .filter((entry) => entry !== null);
}

// ---------------------------------------------------------------------------
// §13 交付合同 (delivery contract)
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = [/\{\{[^}]*\}\}/g, /\bTODO\b/g, /\bFIXME\b/g, /\bTBD\b/g, /\[待填\]/g];

/**
 * 机器可识别的 `UNVERIFIED` 标注标记（33 §13.2）。
 *
 * 规范原文：「无法挂载 confirmed 证据的声明须标注 `UNVERIFIED`，并说明其优先级
 * 与缺口编号」。三项都是**标注本身的形状**，可以机械判定：
 *   1. 标注存在；
 *   2. 标注同时说明了优先级（high/medium/low 或 高/中/低）；
 *   3. 标注同时给出缺口编号（`缺口编号 G1` 一类，或 `gap-2` / `[G3]`）。
 *
 * 机械判不了的是「这个优先级对不对」「这个缺口编号是否真在 gaps 里」——需要读
 * gaps 语义，属 AI 语义审核范围（§14 效力边界）。但「根本没写」与「写了但指向
 * 别处」是两件事：前者是漏检，后者才是语义问题。旧实现两项都不查，只要出现
 * `UNVERIFIED` 六个字母就放行。
 */
const UNVERIFIED_MARKER = /\bUNVERIFIED\b/;
/** UNVERIFIED 标注的说明窗：标注之后这么多个字符内须看到优先级与缺口编号。 */
const UNVERIFIED_ANNOTATION_WINDOW = 160;
const PRIORITY_TOKEN = /\b(?:high|medium|low)\b|高优先|中优先|低优先|优先级\s*[:：]?\s*(?:高|中|低)/i;
const GAP_ID_TOKEN = /缺口\s*(?:编号)?\s*[:：#]?\s*(?:[A-Za-z][-_ ]?\d+|\d+|[一二三四五六七八九十]+)|\bgaps?[-_ ]?\d+|\bG\d+\b|\bg-\d+\b/i;

/**
 * Check the delivery contract (33 §13).
 *
 * 规范 §13 的交付表列了三项判据：「无占位符；每项声明挂 evidence；无 UNVERIFIED
 * 未标注」。旧实现只做了第一项——函数名与注释都只说 placeholder，而工具把这一个
 * 结果当作整个交付合同结论返回 `ok: true`，于是**「每项声明挂证据」这项从未被检查
 * 过**：一份通篇没有引文、也没有任何 UNVERIFIED 标注的报告会拿到「交付合同通过」。
 *
 * 现在三项都查，且逐项如实归入 issues。第 2、3 项的机械口径是**发现单元**层面
 * （24 §8 不变量 2 已要求每单元有 溯源：行）：
 *   - 每项声明挂 evidence → 每个发现单元必须有溯源锚点（无锚点 = 证据悬空）；
 *   - 无 UNVERIFIED 未标注 → 无锚点的单元必须带 UNVERIFIED 标记，否则是
 *     「挂不上证据却当成已证实」。
 *   - 标注本身须带优先级与缺口编号（§13.2 原文的后半句）。只有 `UNVERIFIED`
 *     六个字母、不说明优先级与缺口编号的，仍是一条不合格标注——规范说的是
 *     「并说明其优先级与缺口编号」，不是「出现这个词」。
 *
 * 判不了的部分如实不判：优先级取值是否恰当、缺口编号是否指向真实 gap、正文里
 * 是否存在 H3 之外的自由段落声明——这些不是字形可判的，留给 AI 语义审核。
 *
 * @returns {{ok: boolean, issues: string[]}}
 */
export function checkDeliveryContract(body) {
  const issues = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = body.match(pattern);
    if (matches) {
      issues.push(`delivery contract: placeholder found: ${matches[0]}`);
    }
  }

  // §13.2 第 1、2 句：每项声明挂 evidence；挂不上的须标注 UNVERIFIED。
  // extractFindingUnits 的成员形态是 { title, content, traceRef, traceAnchor, hasTrace }
  // （正文结构解析的唯一实现在 research-writer.js）。
  for (const unit of extractFindingUnits(body)) {
    if (unit.hasTrace) continue;
    const text = `${unit.title}\n${unit.content ?? ""}`;
    const marker = text.match(UNVERIFIED_MARKER);
    if (!marker) {
      issues.push(
        `delivery contract: finding unit "${unit.title.slice(0, 40)}..." 挂不上证据却未标注 UNVERIFIED`
          + `（33 §13.2：每项声明须挂 confirmed 证据，否则须标注 UNVERIFIED 并说明优先级与缺口编号）`,
      );
      continue;
    }
    // §13.2 后半句：标注须说明优先级与缺口编号。
    const annotation = text.slice(marker.index, marker.index + UNVERIFIED_ANNOTATION_WINDOW);
    const missing = [];
    if (!PRIORITY_TOKEN.test(annotation)) missing.push("优先级（high/medium/low 或 高/中/低）");
    if (!GAP_ID_TOKEN.test(annotation)) missing.push("缺口编号");
    if (missing.length > 0) {
      issues.push(
        `delivery contract: finding unit "${unit.title.slice(0, 40)}..." 的 UNVERIFIED 标注缺 ${missing.join("、")}`
          + `（33 §13.2 要求标注「并说明其优先级与缺口编号」，仅有标记不算合格标注）`,
      );
    }
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Session driver (aggregates rounds → final evidence bundle)
// ---------------------------------------------------------------------------

/**
 * ResearchSession — drives the three-layer convergence loop.
 *
 * The caller creates a session, feeds rounds into it, and calls
 * finalize() when converged to get the evidence bundle ready for
 * research-writer.js.
 */
export class ResearchSession {
  constructor({ question, purpose, subQuestions = [], maxRounds = 4, clarificationLog = [] }) {
    this.question = question;
    this.purpose = purpose;
    this.subQuestions = subQuestions;
    this.maxRounds = maxRounds;
    this.clarificationLog = clarificationLog;
    this.roundNumber = 0;
    this.consecutiveNoGain = 0;
    this.confirmed = [];
    this.uncertain = [];
    this.gaps = [];
    this.stoppingReason = null;
    this.urls = new Map(); // ref → url entry
  }

  /**
   * Register a source URL for the citation loop.
   */
  registerSource(ref, title, summary) {
    if (typeof ref !== "string" || !ref.startsWith("http")) {
      return { ok: false, error: { code: "source/invalid", message: "ref must be an HTTP(S) URL" } };
    }
    if (this.urls.has(ref)) {
      return { ok: true, value: this.urls.get(ref) }; // idempotent
    }
    // Normalize to lossless-JSON-safe strings: undefined summary/title
    // values would break the harness tool-output round-trip at finalize.
    const entry = {
      ref,
      title: typeof title === "string" && title.length > 0 ? title : ref,
      summary: typeof summary === "string" ? summary : "",
    };
    this.urls.set(ref, entry);
    return { ok: true, value: entry };
  }

  /**
   * Submit a round of findings.
   * Each finding is shaped via shapeEvidence, then the convergence
   * criteria are evaluated.
   *
   * @param {Array} rawFindings — array of raw finding objects
   * @returns {object} { stop, reason, accepted, rejected }
   */
  submitRound(rawFindings) {
    this.roundNumber += 1;
    const accepted = [];
    const rejected = [];
    const roundConfirmed = [];

    for (const raw of rawFindings) {
      const shaped = shapeEvidence(raw);
      if (shaped.ok) {
        accepted.push(shaped.value);
        if (raw.state === "confirmed") {
          roundConfirmed.push(shaped.value);
          this.confirmed.push(shaped.value);
          // Auto-register source if not yet registered (summary is filled
          // by the caller via registerSource; auto-registration carries
          // an empty summary — the entry stays lossless-JSON-safe).
          if (raw.evidence?.source) {
            this.registerSource(raw.evidence.source, raw.evidence.source_title ?? raw.evidence.source, "");
          }
        } else if (raw.state === "uncertain") {
          this.uncertain.push(shaped.value);
        } else if (raw.state === "gap") {
          this.gaps.push(shaped.value);
        }
      } else {
        rejected.push({ finding: raw, error: shaped.error });
      }
    }

    // Evaluate convergence (§8).
    // `confirmed` 是本轮（供 no-gain 层判「这一轮有没有新增」），
    // `cumulativeConfirmed` 是累计库（供 sufficient 层判子问题覆盖）——
    // 两者语义不同，不能互相顶替，见 evaluateConvergence 的注释。
    const convergence = evaluateConvergence(
      { confirmed: roundConfirmed, gaps: this.gaps },
      {
        subQuestions: this.subQuestions,
        roundNumber: this.roundNumber,
        maxRounds: this.maxRounds,
        consecutiveNoGainRounds: this.consecutiveNoGain,
        cumulativeConfirmed: this.confirmed,
      },
    );
    this.consecutiveNoGain = convergence.newNoGainCount;

    if (convergence.stop) {
      this.stoppingReason = convergence.reason;
    }

    return { stop: convergence.stop, reason: convergence.reason, accepted, rejected };
  }

  /**
   * Finalize the session into an evidence bundle ready for the writer.
   * Validates the complete three-state + citation loop before returning.
   */
  finalize() {
    if (this.stoppingReason === null) {
      return { ok: false, error: { code: "session/not_converged", message: "session has not converged — keep submitting rounds or check maxRounds" } };
    }

    // Three-state invariant (24 §8 invariant 1): at least one of
    // confirmed/uncertain/gaps must be present — with NO exception.
    //
    // This previously carved out "no-gain with zero evidence" as a valid
    // "found nothing" outcome, but such a bundle can never become an object:
    // 24 §8 also requires a non-empty `urls` array (external evidence), and
    // the writer rejects both an empty three-state and empty urls. So finalize
    // handed back a bundle that the only consumer must refuse — the caller
    // learned about the contradiction only at write time, as a frontmatter
    // error that reads like its own mistake. Refuse here instead, and name the
    // remedy (record the residue as a gap; a research with no source at all is
    // not an external-object research, see 24 §6 condition 1).
    if (this.confirmed.length === 0 && this.uncertain.length === 0 && this.gaps.length === 0) {
      return { ok: false, error: { code: "session/empty_evidence", message: "no evidence accumulated — 24 §8 requires at least one of confirmed/uncertain/gaps; record the uncovered scope as a gap (33 §9.3) before finalizing" } };
    }
    if (this.urls.size === 0) {
      return { ok: false, error: { code: "session/no_source", message: "no source registered — 24 §8 requires urls to be non-empty (a Research object is evidence about an external object); register at least one HTTP(S) source before finalizing" } };
    }

    // Citation loop: every confirmed has quotes with source ∈ urls
    for (const c of this.confirmed) {
      for (const q of c.quotes) {
        if (!this.urls.has(q.source)) {
          return { ok: false, error: { code: "session/source_not_registered", message: `quote source ${q.source} not registered in session urls` } };
        }
      }
    }

    // stopping consistency (24 §8 invariant 3)
    if (this.stoppingReason === "sufficient" && this.confirmed.length === 0) {
      return { ok: false, error: { code: "session/sufficient_empty", message: "sufficient requires non-empty confirmed" } };
    }
    if (this.stoppingReason === "sufficient" && this.gaps.some((g) => g.priority === "high")) {
      return { ok: false, error: { code: "session/sufficient_high_gap", message: "sufficient must not have an open high-priority gap" } };
    }
    // round-cap: 24 §8 invariant 3 allows the uncovered scope to be declared in
    // `gaps` **or** in the body's 后续分流 section. At finalize time no body
    // exists yet (the report is composed after this bundle), so a hard failure
    // here would force a synthetic gap entry for a residue the author intends to
    // declare in 后续分流 — inventing structured evidence to satisfy a check.
    // The check therefore runs where the body is available (research-writer.js).

    return {
      ok: true,
      value: {
        research_question: this.question,
        research_purpose: this.purpose,
        stopping_reason: this.stoppingReason,
        confirmed: this.confirmed,
        uncertain: this.uncertain,
        gaps: this.gaps,
        clarification_log: this.clarificationLog,
        urls: [...this.urls.values()],
        rounds_used: this.roundNumber,
      },
    };
  }
}
