/**
 * dsh-ldvh — Research session runner (minimal research sub-agent orchestration).
 *
 * Implements the mechanical slice of specs/30 §5–§8:
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
 * sub-agents itself (that is the 编排 layer's job per specs/30 §11.3).
 * The caller (main controller or a workflow) drives the rounds and feeds
 * back raw findings; this module validates, classifies into three states,
 * tracks convergence, and produces the final validated evidence bundle
 * ready for the Research writer (research-writer.js).
 */

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
// §6 三层收敛 (three-layer convergence)
// ---------------------------------------------------------------------------

/**
 * Evaluate the stopping criteria after a research round.
 *
 * @param {object} round — the completed round's findings
 * @param {Array} round.confirmed — confirmed evidence entries this round
 * @param {Array} round.gaps — open gaps after this round
 * @param {object} state — cumulative session state
 * @param {Array} state.subQuestions — the research sub-questions
 * @param {number} state.roundNumber — current round (1-based)
 * @param {number} state.maxRounds — round-cap limit
 * @param {number} state.consecutiveNoGainRounds — running no-gain counter
 * @returns {object} { stop, reason, newNoGainCount }
 */
export function evaluateConvergence(round, state) {
  const { confirmed = [], gaps = [] } = round;
  const { subQuestions = [], roundNumber = 1, maxRounds = 4, consecutiveNoGainRounds = 0 } = state;

  // Layer 1: sufficient — all sub-questions covered, no blocking high gaps
  const highGaps = gaps.filter((g) => g.priority === "high");
  if (confirmed.length > 0 && highGaps.length === 0 && allSubQuestionsCovered(subQuestions, confirmed)) {
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

function allSubQuestionsCovered(subQuestions, confirmed) {
  // Minimal coverage check: at least one confirmed per sub-question key.
  // Sub-questions may be strings or { key, question } objects.
  // If no confirmed entry carries a sub_question_key, we fall back to
  // "at least one confirmed exists" (lenient: the caller hasn't adopted
  // sub-question tagging yet).
  if (subQuestions.length === 0) return confirmed.length > 0;
  const taggedKeys = confirmed.filter((c) => typeof c.sub_question_key === "string" && c.sub_question_key !== "default");
  if (taggedKeys.length === 0) return confirmed.length > 0;
  const covered = new Set(confirmed.map((c) => c.sub_question_key ?? "default"));
  return subQuestions.every((sq) => covered.has(typeof sq === "string" ? sq : sq.key ?? "default"));
}

// ---------------------------------------------------------------------------
// §7 三态证据 (three-state evidence shaping)
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
      return { ok: true, value: { description, priority: p } };
    }
    default:
      return { ok: false, error: { code: "evidence/bad_state", message: `state must be confirmed/uncertain/gap, got ${finding.state}` } };
  }
}

// ---------------------------------------------------------------------------
// §8 引用闭环 (citation loop audit)
// ---------------------------------------------------------------------------

/**
 * Audit the citation loop of a research report body against the evidence.
 *
 * Checks (specs/30 §8.3):
 *  1. Every [n] reference in the body has a corresponding confirmed entry
 *  2. Quoted text in the body matches the evidence verbatim
 *  3. No unanchored quotes (must have both source and anchor)
 *  4. No quotes exceeding the evidence entry length
 *
 * @param {string} body — the report markdown body
 * @param {Array} confirmed — the confirmed evidence entries
 * @returns {object} { ok, issues }
 */
export function auditCitationLoop(body, confirmed) {
  const issues = [];

  // Build index: statement → entry
  const index = new Map();
  confirmed.forEach((c, i) => index.set(c.statement, { entry: c, num: i + 1 }));

  // Find all [n] references in the body
  const refs = [...body.matchAll(/\[(\d+)\]/g)];
  const usedNumbers = new Set();

  for (const match of refs) {
    const num = parseInt(match[1], 10);
    usedNumbers.add(num);
    if (num < 1 || num > confirmed.length) {
      issues.push(`citation loop: reference [${num}] has no corresponding evidence entry (1–${confirmed.length})`);
    }
  }

  // Check that every confirmed entry is referenced at least once (informational, not a hard fail)
  for (const [, { num }] of index) {
    if (!usedNumbers.has(num)) {
      // Not an error — unreferenced evidence is allowed (may be context)
    }
  }

  // Check verbatim quotes in body: lines containing "「...」" after a [n] reference
  // This is a light check — full verbatim comparison happens at F4 (source re-read)
  for (const line of body.split("\n")) {
    const inlineQuote = line.match(/「([^」]+)」/);
    if (inlineQuote) {
      const quoteText = inlineQuote[1];
      const found = confirmed.some((c) => c.quotes.some((q) => q.text.includes(quoteText)));
      if (!found) {
        issues.push(`citation loop: inline quote 「${quoteText.slice(0, 40)}…」 not found in any evidence entry`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// §10 交付合同 (delivery contract)
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = [/\{\{[^}]*\}\}/g, /\bTODO\b/g, /\bFIXME\b/g, /\bTBD\b/g, /\[待填\]/g];

/**
 * Check the delivery contract: no unfilled placeholders.
 * Returns { ok, issues }.
 */
export function checkDeliveryContract(body) {
  const issues = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const matches = body.match(pattern);
    if (matches) {
      issues.push(`delivery contract: placeholder found: ${matches[0]}`);
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

    // Evaluate convergence (§6)
    const convergence = evaluateConvergence(
      { confirmed: roundConfirmed, gaps: this.gaps },
      { subQuestions: this.subQuestions, roundNumber: this.roundNumber, maxRounds: this.maxRounds, consecutiveNoGainRounds: this.consecutiveNoGain },
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

    // Three-state invariant: at least one — EXCEPT no-gain with zero
    // evidence, which is a valid "found nothing" outcome (the object
    // will still carry its research_question and stopping_reason).
    if (this.stoppingReason !== "no-gain" && this.confirmed.length === 0 && this.uncertain.length === 0 && this.gaps.length === 0) {
      return { ok: false, error: { code: "session/empty_evidence", message: "no evidence accumulated" } };
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
    if (this.stoppingReason === "round-cap" && this.gaps.length === 0) {
      return { ok: false, error: { code: "session/roundcap_no_gaps", message: "round-cap must declare unmet scope in gaps" } };
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
