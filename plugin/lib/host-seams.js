
import { REVIEW_ASK_ANSWERS,
  REVIEW_ASK_PLACEHOLDER_TASK,
  REVIEW_ASK_POINTS,
  REVIEW_ASK_TIMEOUT_OPTIONS,
  composeReviewAsk,
  findReviewAskDecision,
  recordReviewAskDecision,
  reviewAskFingerprint,
} from "./review-ask.js";
import { askTextDenial, validateAskText } from "./ask-text-guard.js";
import { composeConsultQuestion } from "./research-consult.js";

const REVIEW_ASK_QUESTION_ID = "ldvh-review-ask";
const REVIEW_ASK_REVIEW_LABEL = "安排代理";
const REVIEW_ASK_SKIP_LABEL = "跳过，直接推进";

const RESEARCH_CONSULT_QUESTION_ID = "ldvh-research-consult";
const RESEARCH_CONSULT_RESEARCH_LABEL = "联网调查";
const RESEARCH_CONSULT_SKIP_LABEL = "先不查";

const CONSENT_QUESTION_ID = "ldvh-registration-consent";
const CONSENT_AFFIRMATIVE_LABEL = "确认";

function selectedLabelOf(entry) {
  if (entry === null || entry === undefined) return null;
  const raw = entry.selected ?? entry.answer ?? null;
  if (Array.isArray(raw)) return raw.length === 1 ? raw[0] : null;
  return raw;
}

function customTextOf(entry) {
  if (entry === null || entry === undefined) return null;
  const raw = entry.custom;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text.length > 0 ? text : null;
}

function composeAskTitle({ head }) {
  const lines = (Array.isArray(head) ? head : [])
    .filter((line) => typeof line === "string" && line.trim().length > 0)
    .map((line) => line.trim());
  return { question: lines.join("\n") };
}



const SPARK_CONSENT_QUESTION_ID = "ldvh-spark-consent";
const SPARK_CONSENT_LABEL = "确认";

const NORM_CONSENT_QUESTION_ID = "ldvh-norm-consent";
const NORM_CONSENT_LABEL = "确认";

const LATEST_JUDGEMENT = new Map();

export function recordJudgementForGuard(cwd, state) {
  if (typeof cwd !== "string" || cwd.length === 0) return;
  if (state === "governed" || state === "not_governed" || state === "unavailable") {
    LATEST_JUDGEMENT.set(cwd, state);
  }
}

export function judgementForGuard(cwd) {
  return LATEST_JUDGEMENT.get(cwd);
}

const OBSERVED_VERSIONS = new Map();

function targetKeyOf(target) {
  if (target === null || target === undefined) return null;
  if (typeof target.targetKey === "string" && target.targetKey.length > 0) return `key:${target.targetKey}`;
  if (typeof target.displayPath === "string" && target.displayPath.length > 0) return `path:${target.displayPath}`;
  return null;
}

export function recordObservation(ctx, { target, version }) {
  const key = targetKeyOf(target);
  if (key === null) return false;
  if (version === undefined || version === null) return false;
  OBSERVED_VERSIONS.set(key, version);
  if (typeof ctx?.emit === "function") {
    try {
      ctx.emit("fs/observed", target, { kind: "present", version }, undefined);
    } catch {
    }
  }
  return true;
}

export function observedVersionFor(target) {
  const key = targetKeyOf(target);
  return key === null ? undefined : OBSERVED_VERSIONS.get(key);
}

export function resetObservations() {
  OBSERVED_VERSIONS.clear();
}

export function createHostSeams() {
  const consumed = Object.create(null);
  const mark = (key, detail) => { consumed[key] = { consumed: true, ...detail }; };
  let questionContext = null;
  let questionGeneration = 0;
  let usedQuestionService = null;

  function currentUserQuestions() {
    try {
      const service = questionContext?.get("userQuestions");
      const usable = typeof service?.ask === "function" || typeof service?.askTimed === "function";
      return usable ? service : null;
    } catch {
      return null;
    }
  }

  function questionServiceIdentity(service) {
    try {
      const original = service?.[Symbol.for("cordis.original")] ?? service;
      return original !== null && (typeof original === "object" || typeof original === "function") ? original : null;
    } catch {
      return null;
    }
  }

  function installToolsGuard(ctx, { dshHomePath } = {}) {
    const tools = ctx.get("tools");
    if (tools === undefined || typeof tools.guard !== "function") {
      return { consumed: false, detail: "ctx.tools.guard is unavailable in this composition" };
    }
    const dispose = tools.guard((execution) => {
      const name = execution?.name;
      if (typeof name !== "string") return;
      if (name === "ask_user_question") {
        const cwd = execution?.agent?.session?.header?.cwd;
        if (typeof cwd === "string" && cwd.length > 0 && LATEST_JUDGEMENT.get(cwd) === "not_governed") {
          return;
        }
        return askTextDenial(execution.arguments);
      }
      if (!name.startsWith("ldvh_")) return;
      if (!WRITE_SHAPED_OPERATIONS.has(name)) return;
      const cwd = execution?.agent?.session?.header?.cwd;
      if (typeof cwd !== "string" || cwd.length === 0) return;
      const judgement = LATEST_JUDGEMENT.get(cwd);
      if (judgement === "unavailable") {
        return `LDVH governance state is unavailable for ${cwd}: write-shaped LDVH operations are refused (07 §7 / 08 §6 fail-closed)`;
      }
    });
    mark("ctx.tools.guard", { detail: "monotonic guard over write-shaped ldvh_ tools (deny by returning a reason string)" });
    return { consumed: true, dispose };
  }

  function installInvariants(ctx, { dshHomePath }) {
    const invariants = ctx.get("invariants");
    if (invariants === undefined || typeof invariants.register !== "function") {
      return { consumed: false, detail: "ctx.invariants.register is unavailable in this composition" };
    }
    const dispose = invariants.register("dsh-ldvh", async (_ictx, fail) => {
      const { evaluateRegistrationEntry } = await import("./governed-projects.js");
      const result = await evaluateRegistrationEntry(dshHomePath);
      if (result.ok) return;
      if (result.error.code === "registration_schema_invalid") {
        fail(`${result.error.code}: ${result.error.message}`);
      }
    });
    mark("ctx.invariants.register", { detail: "install-time assertion: registration carrier satisfies the v5 schema" });
    return { consumed: true, dispose };
  }

  function installFsObservation(ctx) {
    if (typeof ctx.on !== "function") {
      return { consumed: false, detail: "event listening (ctx.on) is unavailable in this composition" };
    }
    const disposers = [];
    disposers.push(ctx.on("fs/observed", (target, observation) => {
      seams.observations += 1;
      const key = targetKeyOf(target);
      if (key === null) return;
      if (observation?.kind === "present") OBSERVED_VERSIONS.set(key, observation.version);
      else if (observation?.kind === "absent") OBSERVED_VERSIONS.delete(key);
    }));
    const writeIntent = (target, actor, next) => {
      const key = targetKeyOf(target);
      if (key === null) return next();
      const version = OBSERVED_VERSIONS.get(key);
      if (version === undefined) return next();
      return { kind: "replaceIfVersion", version };
    };
    disposers.push(ctx.on("fs/write-intent", writeIntent));
    disposers.push(ctx.on("fs/edit-intent", writeIntent));
    const fs = typeof ctx.get === "function" ? ctx.get("fs") : undefined;
    seams.fs = fs ?? null;
    mark("fs/observed", {
      detail: fs === undefined
        ? "listeners mounted, but the fs service is unavailable so LDVH cannot obtain a real version — observations cannot be recorded"
        : "read half binds the fs service (real FsVersion via stat) and records observations; write half mounts fs/write-intent + fs/edit-intent version guards",
      ...(fs === undefined ? { consumed: false, partial: true } : {})
    });
    return {
      consumed: fs !== undefined,
      ...(fs === undefined ? { partial: true } : {}),
      dispose: () => { for (const d of disposers) { try { d(); } catch {   } } }
    };
  }

  function installUserQuestions(ctx) {
    const userQuestions = ctx.get("userQuestions");
    const usable = userQuestions !== undefined
      && (typeof userQuestions.ask === "function" || typeof userQuestions.askTimed === "function");
    if (!usable) {
      return { consumed: false, detail: "ctx.userQuestions.ask / askTimed is unavailable in this composition" };
    }
    return { consumed: false, available: true, detail: "userQuestions service is available; actual use is tracked when a request is sent" };
  }

  async function requestRegistrationConsent({ action, projectId, projectPath, agent, signal }) {
    const ask = seams.ask;
    if (typeof ask !== "function") {
      return { granted: false, reason: "no human-answerer entry is available; 07 §5.6 requires explicit intent, so consent cannot be assumed" };
    }
    const verb = action === "unregister" ? "取消登记" : "登记为 LDVH 管辖项目";
    try {
      const answer = await ask({
        questions: [{
          id: CONSENT_QUESTION_ID,
          header: "LDVH 管辖登记",
          question: `是否确认将项目 ${projectId ?? ""}（${projectPath}）${verb}？（07 §5.6：登记或取消仅由 Human 明确意图触发）`,
          options: [
            { label: CONSENT_AFFIRMATIVE_LABEL, description: "执行本次登记变更" },
            { label: "取消", description: "不执行，保持现状" }
          ]
        }],
        ...(signal === undefined ? {} : { signal })
      }, agent);
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === CONSENT_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      const customNote = customTextOf(entry);
      const granted = selected === CONSENT_AFFIRMATIVE_LABEL;
      return granted
        ? { granted: true, answer: selected, ...(customNote === null ? {} : { custom_note: customNote }) }
        : { granted: false, ...(customNote === null ? {} : { custom_note: customNote }), reason: `human did not affirmatively confirm (answer: ${JSON.stringify(selected ?? null)})${customNote === null ? "" : `；Human 另写了自由文本（见 custom_note），不作为授权` }` };
    } catch (error) {
      return { granted: false, reason: `consent request failed: ${String(error?.message ?? error)}` };
    }
  }

  async function requestSparkConsent({ action, objectTitle, summary, agent, signal }) {
    const ask = seams.ask;
    if (typeof ask !== "function") {
      return { granted: false, reason: "no human-answerer entry is available; 22 §16 requires an explicit Human confirmation, so consent cannot be assumed" };
    }
    const verb = action === "terminal" ? "转入终态" : "创建";
    const report = typeof summary === "string" && summary.trim().length > 0
      ? summary.trim()
      : null;
    if (report === null) {
      return { granted: false, reason: "22 §16 requires the 呈报内容 (the elements the Human judges) to be presented before the question; none was supplied, so no question was asked" };
    }
    const head = [`Spark ${verb}确认（22 §16）`];
    if (typeof objectTitle === "string" && objectTitle.trim().length > 0) head.push(`对象：${objectTitle.trim()}`);
    const composed = composeAskTitle({ head });
    try {
      const answer = await ask({
        questions: [{
          id: SPARK_CONSENT_QUESTION_ID,
          header: "Spark 授权",
          question: composed.question,
          options: [
            { label: SPARK_CONSENT_LABEL, description: `确认${verb}该 Spark 对象` },
            { label: "取消", description: "不执行本次写入，保持现状" }
          ]
        }],
        ...(signal === undefined ? {} : { signal })
      }, agent);
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === SPARK_CONSENT_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      const customNote = customTextOf(entry);
      if (selected === SPARK_CONSENT_LABEL) return { granted: true, answer: selected, ...(customNote === null ? {} : { custom_note: customNote }) };
      return { granted: false, ...(customNote === null ? {} : { custom_note: customNote }), reason: `human did not confirm the Spark ${verb} (answer: ${JSON.stringify(selected ?? null)})${customNote === null ? "" : `；Human 另写了自由文本（见 custom_note），不作为授权` }` };
    } catch (error) {
      return { granted: false, reason: `spark consent request failed: ${String(error?.message ?? error)}` };
    }
  }

  async function requestNormConsent({ action, objectTitle, summary, agent, signal }) {
    const ask = seams.ask;
    if (typeof ask !== "function") {
      return { granted: false, reason: "no human-answerer entry is available; 23 §15 requires an explicit Human confirmation, so consent cannot be assumed" };
    }
    const verb = action === "retire" ? "转入终态" : "创建";
    const report = typeof summary === "string" && summary.trim().length > 0
      ? summary.trim()
      : null;
    if (report === null) {
      return { granted: false, reason: "23 §15 requires the 呈报内容 (the elements the Human judges) to be presented before the question; none was supplied, so no question was asked" };
    }
    const head = [`Norm ${verb}确认（23 §15）`];
    if (typeof objectTitle === "string" && objectTitle.trim().length > 0) head.push(`对象：${objectTitle.trim()}`);
    const composed = composeAskTitle({ head });
    try {
      const answer = await ask({
        questions: [{
          id: NORM_CONSENT_QUESTION_ID,
          header: "Norm 授权",
          question: composed.question,
          options: [
            { label: NORM_CONSENT_LABEL, description: `确认${verb}该 Norm 对象` },
            { label: "取消", description: "不执行本次写入，保持现状" }
          ]
        }],
        ...(signal === undefined ? {} : { signal })
      }, agent);
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === NORM_CONSENT_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      const customNote = customTextOf(entry);
      if (selected === NORM_CONSENT_LABEL) return { granted: true, answer: selected, ...(customNote === null ? {} : { custom_note: customNote }) };
      return { granted: false, ...(customNote === null ? {} : { custom_note: customNote }), reason: `human did not confirm the Norm ${verb} (answer: ${JSON.stringify(selected ?? null)})${customNote === null ? "" : `；Human 另写了自由文本（见 custom_note），不作为授权` }` };
    } catch (error) {
      return { granted: false, reason: `norm consent request failed: ${String(error?.message ?? error)}` };
    }
  }

  function reviewAskScopeKey(agent) {
    const header = agent?.session?.header;
    if (header === undefined || header === null) return { scope: undefined, sessionIdentified: false };
    const parts = [];
    const id = header.sessionId ?? header.id ?? agent?.session?.id;
    const sessionIdentified = typeof id === "string" && id.length > 0;
    if (sessionIdentified) parts.push(`session:${id}`);
    const cwd = header.cwd;
    if (typeof cwd === "string" && cwd.length > 0) parts.push(`cwd:${cwd}`);
    return { scope: parts.length === 0 ? undefined : parts.join("|"), sessionIdentified };
  }

  async function requestReviewAsk({ point, task, enabled, agent, signal, callId, timeoutEnabled, timeoutSeconds }) {
    if (enabled !== true) {
      return { decision: null, asked: false, reason: "the review-ask switch is off for this point — no prompt is issued (2026-11-13 Human decision: 打开才有)" };
    }
    const ask = seams.ask;
    const timed = seams.askTimed;
    const useTimed = timeoutEnabled === true
      && typeof timed === "function"
      && typeof callId === "string" && callId.length > 0
      && REVIEW_ASK_TIMEOUT_OPTIONS.includes(timeoutSeconds);
    if (!useTimed && typeof ask !== "function") {
      return { decision: null, asked: false, reason: "no human-answerer entry is available; the review-ask cannot be issued, so no decision is assumed" };
    }
    const scopeInfo = reviewAskScopeKey(agent);
    const scopeKey = scopeInfo.scope;
    const fingerprint = reviewAskFingerprint({ point, task, scope: scopeKey });
    const reuseAllowed = scopeInfo.sessionIdentified;
    const prior = await findReviewAskDecision(seams.dshHomePath, fingerprint);
    if (!prior.ok) {
      return { decision: null, asked: false, reason: `${prior.error.code}: ${prior.error.message}`, fingerprint };
    }
    if (prior.value !== null) {
      const priorTask = prior.value.task;
      const priorIsPlaceholder = typeof priorTask === "string" && priorTask.trim() === REVIEW_ASK_PLACEHOLDER_TASK;
      const reusable =
        reuseAllowed
        && typeof priorTask === "string"
        && priorTask.trim().length > 0
        && !priorIsPlaceholder;
      if (reusable) {
        return {
          decision: prior.value.answer,
          asked: false,
          reused: true,
          fingerprint,
          reason: `reused the recorded answer from ${prior.value.at} (same content fingerprint — not asked again)`,
        };
      }
    }
    const composed = composeReviewAsk({ point, task });
    const request = {
      questions: [{
        id: REVIEW_ASK_QUESTION_ID,
        header: point === REVIEW_ASK_POINTS.PRE_ACTION ? "审查" : "复核",
        question: composed.question,
        options: [
          {
            label: REVIEW_ASK_REVIEW_LABEL,
            description: point === REVIEW_ASK_POINTS.PRE_ACTION
              ? "派独立子代理先对这个方案挑错，结论回来后再动手"
              : "派独立子代理逐条核对这次已做的工作，结论回来后再收口",
          },
          { label: REVIEW_ASK_SKIP_LABEL, description: "本次不做独立把关，主控自查仍在" }
        ]
      }],
      ...(signal === undefined ? {} : { signal })
    };
    try {
      let answer;
      let timedOut = false;
      if (useTimed) {
        const result = await timed(request, callId, timeoutSeconds * 1000, agent);
        if (result !== null && typeof result === "object" && result.pending === true) {
          timedOut = true;
          answer = null;
        } else {
          answer = result;
        }
      } else {
        answer = await ask(request, agent);
      }
      if (timedOut) {
        return {
          decision: null,
          asked: true,
          fingerprint,
          timed_out: true,
          timeout_seconds: timeoutSeconds,
          reason: `倒计时 ${timeoutSeconds}s 到点未取得答复，按「未取得答复按既有路径继续」处理（载体：gate-consult-system-foundation 的 answer-means 条目；留痕见其 trace-record 条目）；未取得答复不是答复，不写入答复留痕，不记成 skip 或 review。下次同内容仍会问。`,
        };
      }
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === REVIEW_ASK_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      const customNote = customTextOf(entry);
      if (selected !== REVIEW_ASK_REVIEW_LABEL && selected !== REVIEW_ASK_SKIP_LABEL) {
        const shape = customNote !== null
          ? `free-text answer submitted (no option selected): ${JSON.stringify(customNote)}`
          : `skipped / no option chosen (answer: ${JSON.stringify(selected ?? null)})`;
        return {
          decision: null,
          asked: true,
          fingerprint,
          ...(customNote === null ? {} : { custom_note: customNote }),
          reason: `human did not choose an option — ${shape} — 未决策不是答复，下次仍会问；自由文本作为补充信息回传，不冒充 review/skip`,
        };
      }
      const decision = selected === REVIEW_ASK_REVIEW_LABEL ? REVIEW_ASK_ANSWERS.REVIEW : REVIEW_ASK_ANSWERS.SKIP;
      const recorded = await recordReviewAskDecision(seams.dshHomePath, {
        fingerprint,
        point,
        answer: decision,
        task: typeof task === "string" && task.trim() === REVIEW_ASK_PLACEHOLDER_TASK ? null : (task ?? null),
      });
      if (!recorded.ok) {
        return { decision, asked: true, fingerprint, ...(customNote === null ? {} : { custom_note: customNote }), recordError: `${recorded.error.code}: ${recorded.error.message}` };
      }
      return { decision, asked: true, fingerprint, ...(customNote === null ? {} : { custom_note: customNote }), at: recorded.value.at };
    } catch (error) {
      return { decision: null, asked: true, fingerprint, reason: `review-ask request failed: ${String(error?.message ?? error)}` };
    }
  }


  async function requestResearchConsult({ need, scope, keywords, internalGap, agent, signal } = {}) {
    const ask = seams.ask;
    if (typeof ask !== "function") {
      return { decision: null, asked: false, reason: "no human-answerer entry is available; the research consult cannot be issued, so no decision is assumed" };
    }
    const scopeInfo = reviewAskScopeKey(agent);
    const scopeKey = scopeInfo.scope;
    const fingerprintTask = [need, scope, ...(Array.isArray(keywords) ? keywords : [])]
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim())
      .join(" | ");
    const fingerprint = reviewAskFingerprint({ point: REVIEW_ASK_POINTS.RESEARCH, task: fingerprintTask, scope: scopeKey });
    const prior = await findReviewAskDecision(seams.dshHomePath, fingerprint);
    if (!prior.ok) {
      return { decision: null, asked: false, reason: `${prior.error.code}: ${prior.error.message}`, fingerprint };
    }
    if (prior.value !== null) {
      const priorTask = prior.value.task;
      const priorIsPlaceholder = typeof priorTask === "string" && priorTask.trim() === REVIEW_ASK_PLACEHOLDER_TASK;
      const reusable =
        scopeInfo.sessionIdentified
        && typeof priorTask === "string"
        && priorTask.trim().length > 0
        && !priorIsPlaceholder;
      if (reusable) {
        return {
          decision: prior.value.answer === REVIEW_ASK_ANSWERS.REVIEW ? "research" : "skip",
          asked: false,
          reused: true,
          fingerprint,
          reason: `reused the recorded answer from ${prior.value.at} (same content fingerprint — not asked again)`,
        };
      }
    }
    const composed = composeConsultQuestion({ need, scope });
    const request = {
      questions: [{
        id: RESEARCH_CONSULT_QUESTION_ID,
        header: "联网调查",
        question: composed.question,
        options: [
          { label: RESEARCH_CONSULT_RESEARCH_LABEL, description: "开一次联网取证：派零上下文调研子代理走 33 号调研会话" },
          { label: RESEARCH_CONSULT_SKIP_LABEL, description: "本次不联网，按既有路径继续" }
        ]
      }],
      ...(signal === undefined ? {} : { signal })
    };
    try {
      const answer = await ask(request, agent);
      const answers = Array.isArray(answer?.answers) ? answer.answers : [];
      const entry = answers.find((a) => a?.id === RESEARCH_CONSULT_QUESTION_ID) ?? null;
      const selected = selectedLabelOf(entry);
      const customNote = customTextOf(entry);
      if (selected !== RESEARCH_CONSULT_RESEARCH_LABEL && selected !== RESEARCH_CONSULT_SKIP_LABEL) {
        const shape = customNote !== null
          ? `free-text answer submitted (no option selected): ${JSON.stringify(customNote)}`
          : `skipped / no option chosen (answer: ${JSON.stringify(selected ?? null)})`;
        return {
          decision: null,
          asked: true,
          fingerprint,
          ...(customNote === null ? {} : { custom_note: customNote }),
          reason: `human did not choose an option — ${shape} — 未决策不是答复，下次仍会问；自由文本作为补充信息回传，不冒充安排／不安排`,
        };
      }
      const decision = selected === RESEARCH_CONSULT_RESEARCH_LABEL ? "research" : "skip";
      const recorded = await recordReviewAskDecision(seams.dshHomePath, {
        fingerprint,
        point: REVIEW_ASK_POINTS.RESEARCH,
        answer: decision === "research" ? REVIEW_ASK_ANSWERS.REVIEW : REVIEW_ASK_ANSWERS.SKIP,
        task: typeof fingerprintTask === "string" && fingerprintTask.trim() === REVIEW_ASK_PLACEHOLDER_TASK ? null : fingerprintTask,
      });
      if (!recorded.ok) {
        return { decision, asked: true, fingerprint, ...(customNote === null ? {} : { custom_note: customNote }), recordError: `${recorded.error.code}: ${recorded.error.message}` };
      }
      return { decision, asked: true, fingerprint, ...(customNote === null ? {} : { custom_note: customNote }), at: recorded.value.at };
    } catch (error) {
      return { decision: null, asked: true, fingerprint, reason: `research consult request failed: ${String(error?.message ?? error)}` };
    }
  }


  const seams = {
    observations: 0,
    consumed,
    get ask() {
      const service = currentUserQuestions();
      if (service === null || typeof service.ask !== "function") return null;
      return (request, agent) => {
        const textCheck = validateAskText(request);
        if (!textCheck.ok) {
          throw new Error(`LDVH ask-text guard (service seam) refused the request: ${textCheck.reason}`);
        }
        const result = service.ask(agent === undefined ? request : { ...request, agent });
        try {
          const identity = questionServiceIdentity(service);
          usedQuestionService = identity === null ? null : new WeakRef(identity);
        } catch {
          usedQuestionService = null;
        }
        return result;
      };
    },
    get askTimed() {
      const service = currentUserQuestions();
      if (service === null || typeof service.askTimed !== "function") return null;
      return (request, callId, timeoutMs, agent) => {
        const textCheck = validateAskText(request);
        if (!textCheck.ok) {
          throw new Error(`LDVH ask-text guard (timed service seam) refused the request: ${textCheck.reason}`);
        }
        const result = service.askTimed(
          { ...request, ...(agent === undefined ? {} : { agent }) },
          callId,
          timeoutMs,
        );
        try {
          const identity = questionServiceIdentity(service);
          usedQuestionService = identity === null ? null : new WeakRef(identity);
        } catch {
          usedQuestionService = null;
        }
        return result;
      };
    },
    get humanGateAvailable() { return currentUserQuestions() !== null; },
    dshHomePath: null,
    fs: null,
    requestRegistrationConsent,
    requestSparkConsent,
    requestNormConsent,
    requestReviewAsk,
    requestResearchConsult,
    async observePath(path, { cwd, signal } = {}) {
      const fs = seams.fs;
      if (fs === null || typeof fs.resolve !== "function" || typeof fs.stat !== "function") {
        return { observed: false, reason: "the fs service is unavailable, so no authoritative version can be obtained" };
      }
      try {
        const target = await fs.resolve(path, { ...(cwd === undefined ? {} : { cwd }), ...(signal === undefined ? {} : { signal }) });
        const info = await fs.stat(target, signal);
        if (info === undefined) {
          OBSERVED_VERSIONS.delete(targetKeyOf(target));
          return { observed: true, kind: "absent", target };
        }
        OBSERVED_VERSIONS.set(targetKeyOf(target), info.version);
        if (typeof seams.emitter?.emit === "function") {
          try { seams.emitter.emit("fs/observed", target, { kind: "present", version: info.version }, undefined); } catch {   }
        }
        return { observed: true, kind: "present", version: info.version, target };
      } catch (error) {
        return { observed: false, reason: String(error?.message ?? error) };
      }
    },
    install(ctx, { dshHomePath } = {}) {
      const disposers = [];
      const results = {};
      for (const [key, installer] of Object.entries({
        "ctx.tools.guard": () => installToolsGuard(ctx),
        "ctx.invariants.register": () => installInvariants(ctx, { dshHomePath }),
        "fs/observed": () => installFsObservation(ctx),
        "ctx.userQuestions.ask": () => installUserQuestions(ctx)
      })) {
        let outcome;
        try {
          outcome = installer();
        } catch (error) {
          outcome = { consumed: false, detail: String(error?.message ?? error) };
        }
        results[key] = outcome;
        if (typeof outcome.dispose === "function") disposers.push(outcome.dispose);
      }
      const questionEpoch = ++questionGeneration;
      questionContext = ctx;
      usedQuestionService = null;
      seams.dshHomePath = typeof dshHomePath === "function" ? dshHomePath : null;
      seams.emitter = ctx;
      return {
        results,
        dispose() {
          if (questionEpoch === questionGeneration) {
            questionContext = null;
            usedQuestionService = null;
            delete consumed["ctx.userQuestions.ask"];
          }
          for (const dispose of disposers) {
            try { dispose(); } catch {   }
          }
        }
      };
    },
    snapshot() {
      const all = ["ctx.tools.register", "ctx.tools.guard", "ctx.invariants.register", "fs/observed", "ctx.userQuestions.ask"];
      return all.map((key) => {
        if (key === "ctx.userQuestions.ask") {
          const service = currentUserQuestions();
          const identity = service === null ? null : questionServiceIdentity(service);
          const used = identity !== null && usedQuestionService?.deref() === identity;
          return {
            seam: key,
            state: service === null ? "absent" : (used ? "consumed" : "available"),
            consumed: used,
            detail: service === null
              ? "the userQuestions service is unavailable; new requests fail closed"
              : (used
                  ? "a request was sent through the current userQuestions service; a Human answer is not guaranteed"
                  : "the current userQuestions service is available but has not been used")
          };
        }
        if (key === "ctx.tools.register") {
          return { seam: key, state: "consumed", consumed: true, detail: "LDVH operations registered through ctx.tools.register" };
        }
        const entry = consumed[key];
        if (entry === undefined) return { seam: key, state: "absent", consumed: false, detail: "not consumed in this composition" };
        const state = entry.consumed === true ? "consumed" : (entry.available === true ? "available" : (entry.partial === true ? "partial" : "absent"));
        return { seam: key, state, consumed: entry.consumed === true, detail: entry.detail };
      });
    }
  };
  return seams;
}

const WRITE_SHAPED_OPERATIONS = new Set([
  "ldvh_register_governed_project",
  "ldvh_unregister_governed_project"
]);

export function registerWriteShapedTool(toolName) {
  if (typeof toolName === "string" && toolName.startsWith("ldvh_")) WRITE_SHAPED_OPERATIONS.add(toolName);
}

export function writeShapedTools() {
  return [...WRITE_SHAPED_OPERATIONS].sort();
}
