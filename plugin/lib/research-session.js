
import { extractFindingUnits } from "./report-writer.js";


export function analyzeClarificationNeeds(question, purpose) {
  const questions = [];

  const multiMeaningTerms = detectMultiMeaningTerms(question);
  if (multiMeaningTerms.length > 0) {
    questions.push({
      focus: "术语消歧",
      question: `调研中出现的「${multiMeaningTerms.join("、")}」具体指哪个含义？不同理解会导致调研范围完全不同。`,
    });
  }

  if (/\b和\b|\b与\b|\b及\b|以及|、/.test(question) && !/优先|重点|主要/.test(purpose ?? "")) {
    questions.push({
      focus: "优先级",
      question: `调研问题涉及多个方面，哪个是本次最优先要回答的？`,
    });
  }

  if (!/最新|当前|版本|v?\d+\.\d+|20\d\d/.test(question)) {
    questions.push({
      focus: "范围界定",
      question: `调研针对的时间范围或版本范围是什么？（如：最新稳定版、特定版本、过去一年）`,
    });
  }

  return { ok: true, value: { needsClarification: questions.length > 0, questions: questions.slice(0, 3) } };
}

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
  const ambiguous = [];
  const candidates = ["编排", "调研", "记忆", "遵守", "门", "hook", "session", "worker"];
  for (const term of candidates) {
    if (text.includes(term)) ambiguous.push(term);
  }
  return ambiguous;
}


export function evaluateConvergence(round, state) {
  const { confirmed = [], gaps = [] } = round;
  const {
    subQuestions = [],
    roundNumber = 1,
    maxRounds = 4,
    consecutiveNoGainRounds = 0,
    cumulativeConfirmed = confirmed,
  } = state;

  const highGaps = gaps.filter((g) => g.priority === "high");
  if (confirmed.length > 0 && highGaps.length === 0 && subQuestionCoverage(subQuestions, cumulativeConfirmed) === "covered") {
    return { stop: true, reason: "sufficient", newNoGainCount: 0 };
  }

  if (roundNumber >= maxRounds) {
    return { stop: true, reason: "round-cap", newNoGainCount: 0 };
  }

  if (confirmed.length === 0) {
    const newCount = consecutiveNoGainRounds + 1;
    if (newCount >= 2) {
      return { stop: true, reason: "no-gain", newNoGainCount: newCount };
    }
    return { stop: false, reason: null, newNoGainCount: newCount };
  }

  return { stop: false, reason: null, newNoGainCount: 0 };
}

function subQuestionCoverage(subQuestions, confirmed) {
  if (subQuestions.length === 0) return confirmed.length > 0 ? "covered" : "uncovered";
  const tagged = confirmed.filter((c) => typeof c.sub_question_key === "string" && c.sub_question_key !== "default");
  if (tagged.length === 0) return "untagged";
  const covered = new Set(confirmed.map((c) => c.sub_question_key ?? "default"));
  return subQuestions.every((sq) => covered.has(typeof sq === "string" ? sq : sq.key ?? "default"))
    ? "covered"
    : "uncovered";
}


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



const REF_QUOTE_GAP = /^[\s:：、，,。.\-—*_`"'“”「」()（）]*$/;
const REF_QUOTE_MAX_GAP = 24;

const TRACE_LINE = /^溯源：(.+?)（(.+?)）\s*$/;

function citationRefsIn(text) {
  const out = [];
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const prev = m.index > 0 ? text[m.index - 1] : "";
    if (/[\w$\])}]/.test(prev)) continue;
    out.push({ num: parseInt(m[1], 10), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function auditCitationLoop(body, confirmed) {
  const issues = [];
  const entries = normalizeConfirmedEntries(confirmed);

  const refs = citationRefsIn(body);
  const refNumbers = new Set();
  for (const ref of refs) {
    refNumbers.add(ref.num);
    if (ref.num < 1 || ref.num > entries.length) {
      issues.push(`citation loop: reference [${ref.num}] has no corresponding evidence entry (1–${entries.length})`);
    }
  }

  const anyQuotes = entries.some((c) => c.quotes.length > 0);

  const documentUsesRefs = refNumbers.size > 0;

  if (documentUsesRefs) {
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

        const target = adjacent[0];
        const entry = entries[target.num - 1];
        if (entry) {
          if (!entry.quotes.some((qq) => qq.text.includes(quoteText))) {
            issues.push(`citation loop: ${label} is annotated with [${target.num}] but does not appear in that entry's quote text — 编号与引文不对应`);
            continue;
          }
          const longest = Math.max(...entry.quotes.map((qq) => qq.text.length), 0);
          if (quoteText.length > longest) {
            issues.push(`citation loop: ${label} is longer than the evidence text it cites (${quoteText.length} > ${longest}) — 33 §10.3 第4项禁止长段引用超出证据库条目长度`);
          }
        }
      }
    }
  }

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


const PLACEHOLDER_PATTERNS = [/\{\{[^}]*\}\}/g, /\bTODO\b/g, /\bFIXME\b/g, /\bTBD\b/g, /\[待填\]/g];

const UNVERIFIED_MARKER = /\bUNVERIFIED\b/;
const UNVERIFIED_ANNOTATION_WINDOW = 160;
const PRIORITY_TOKEN = /\b(?:high|medium|low)\b|高优先|中优先|低优先|优先级\s*[:：]?\s*(?:高|中|低)/i;
const GAP_ID_TOKEN = /缺口\s*(?:编号)?\s*[:：#]?\s*(?:[A-Za-z][-_ ]?\d+|\d+|[一二三四五六七八九十]+)|\bgaps?[-_ ]?\d+|\bG\d+\b|\bg-\d+\b/i;

export function checkDeliveryContract(body) {
  const issues = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = body.match(pattern);
    if (matches) {
      issues.push(`delivery contract: placeholder found: ${matches[0]}`);
    }
  }

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
    this.urls = new Map();
  }

  registerSource(ref, title, summary) {
    if (typeof ref !== "string" || !ref.startsWith("http")) {
      return { ok: false, error: { code: "source/invalid", message: "ref must be an HTTP(S) URL" } };
    }
    if (this.urls.has(ref)) {
      return { ok: true, value: this.urls.get(ref) };
    }
    const entry = {
      ref,
      title: typeof title === "string" && title.length > 0 ? title : ref,
      summary: typeof summary === "string" ? summary : "",
    };
    this.urls.set(ref, entry);
    return { ok: true, value: entry };
  }

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

  finalize() {
    if (this.stoppingReason === null) {
      return { ok: false, error: { code: "session/not_converged", message: "session has not converged — keep submitting rounds or check maxRounds" } };
    }

    if (this.confirmed.length === 0 && this.uncertain.length === 0 && this.gaps.length === 0) {
      return { ok: false, error: { code: "session/empty_evidence", message: "no evidence accumulated — 24 §8 requires at least one of confirmed/uncertain/gaps; record the uncovered scope as a gap (33 §9.3) before finalizing" } };
    }
    if (this.urls.size === 0) {
      return { ok: false, error: { code: "session/no_source", message: "no source registered — 24 §8 requires urls to be non-empty (a Research object is evidence about an external object); register at least one HTTP(S) source before finalizing" } };
    }

    for (const c of this.confirmed) {
      for (const q of c.quotes) {
        if (!this.urls.has(q.source)) {
          return { ok: false, error: { code: "session/source_not_registered", message: `quote source ${q.source} not registered in session urls` } };
        }
      }
    }

    if (this.stoppingReason === "sufficient" && this.confirmed.length === 0) {
      return { ok: false, error: { code: "session/sufficient_empty", message: "sufficient requires non-empty confirmed" } };
    }
    if (this.stoppingReason === "sufficient" && this.gaps.some((g) => g.priority === "high")) {
      return { ok: false, error: { code: "session/sufficient_high_gap", message: "sufficient must not have an open high-priority gap" } };
    }

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
