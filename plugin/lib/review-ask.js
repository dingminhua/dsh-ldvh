
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

const LEDGER_RELATIVE_PATH = ["ldvh", "review-ask-decisions.json"];

const MAX_ENTRIES = 50;

export const REVIEW_ASK_ROW_SUMMARY = "把关询问 · 待你决定核对做不做、由谁做";

export const REVIEW_ASK_PLACEHOLDER_TASK = "当次任务";

export const REVIEW_ASK_POINTS = Object.freeze({
  PRE_ACTION: "pre-action",
  POST_WORK: "post-work",
  RESEARCH: "research",
});

export const REVIEW_ASK_ANSWERS = Object.freeze({
  REVIEW: "review",
  SELF: "self-review",
  SKIP: "skip",
});

export const CANDIDATE_SUMMARY_MAX_CHARS = 200;

export function validateCandidateSummary(value) {
  if (typeof value !== "string") return { ok: false, reason: "candidate_summary 必须是字符串（行动前那处须交付候选摘要）" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: "candidate_summary 不得为空（没有候选摘要就没有可核对的对象）" };
  if (trimmed.length > CANDIDATE_SUMMARY_MAX_CHARS) {
    return { ok: false, reason: `candidate_summary 去除首尾空白后不得超过 ${CANDIDATE_SUMMARY_MAX_CHARS} 个字符（按字符串长度计，实际 ${trimmed.length} 个字符）；请压缩摘要，不要把完整方案塞进 ask` };
  }
  return { ok: true, value: trimmed };
}

export const REVIEW_ASK_CARRIER = "gate-consult-system-foundation";

export const REVIEW_ASK_CARRIER_ENTRIES = Object.freeze({
  complexTask: "complex-task",
  pointExclusions: "point-exclusions",
});

export function carrierEntrySource(entryKey, carrier = REVIEW_ASK_CARRIER) {
  return `${carrier} 的 ${entryKey} 条目`;
}

export const COMPLEXITY_CRITERIA = Object.freeze([
  {
    key: "structural-change",
    label: "建立或修改结构性事物",
    source: carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.complexTask),
  },
  {
    key: "multi-path-choice",
    label: "存在多个可选路径的选型",
    source: carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.complexTask),
  },
  {
    key: "decision-conflict",
    label: "方向可能与既定决策冲突",
    source: carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.complexTask),
  },
  {
    key: "not-clearly-direct",
    label: "不属于「什么算复杂任务」条目所列的排除清单（方向未定／当次可直接处理的低风险改动／已定决策／系统性阻碍／过程日志与工具输出与单纯执行提醒）",
    source: `${carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.complexTask)}（其排除清单取反）`,
  },
]);

export const GATE_POINT_EXCLUSIONS = Object.freeze([
  {
    key: "pure-research",
    label: "纯调研取证与报告（当次止于取得证据并形成调研结论）",
    carried: "research-system-foundation 的 audit／delivery／escalation 条目所要求的引用闭环核对、交付三道与高风险调研升级的独立视角复核",
    source: `${carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.pointExclusions)}（第 1 类）`,
    notExcluded: "把调研结论落成规则／代码的那一步；在多个调研路线之间选型",
  },
  {
    key: "pure-commit",
    label: "纯受控提交与推送（当次只把已形成的改动按提交契约落盘并推送）",
    carried: "controlled-commit 的 message-diff-match／precheck-when／precheck-result／git-gate／git-gate-scope／stage／create-commit／readback 条目所要求的消息与差异逐条对应、预检与 Git Gate 双入口、提交步骤与回读",
    source: `${carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.pointExclusions)}（第 2 类）`,
    notExcluded: "提交里含本次新做的实质改动；受控提交只覆盖提交缝，推送不在它的机械范围里，故不得声称推送已被机械覆盖",
  },
  {
    key: "pure-controlled-object-op",
    label: "纯 LDVH 受控工具面对既有事实对象的操作（状态转换、补充记录、勘误级更新、受控退休）",
    carried: "fact-model-common 的 fingerprint-baseline／field-channel／read-back-after-write／after-complete 条目所要求的基线指纹、字段通道、写后精确回读与适用完整性审计，加该类型自身要求的建前预检与关口",
    source: `${carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.pointExclusions)}（第 3 类）`,
    notExcluded: "新建事实对象、改变既有对象的决策与适用范围语义（那本属各类型须人决定的事项）",
  },
]);

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function success(value) {
  return { ok: true, value };
}

function readSwitchValue(value) {
  const raw = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  if (raw === undefined || raw === null) return undefined;
  return raw === true;
}

export const REVIEW_ASK_TIMEOUT_OPTIONS = Object.freeze([10, 30, 60]);
export const REVIEW_ASK_TIMEOUT_DEFAULT = 30;

function readTimeoutSeconds(value) {
  const raw = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  const num = typeof raw === "string" ? Number(raw) : raw;
  return REVIEW_ASK_TIMEOUT_OPTIONS.includes(num) ? num : REVIEW_ASK_TIMEOUT_DEFAULT;
}

export function resolveReviewAskSettings(config) {
  const pre = readSwitchValue(config?.preActionReviewAskEnabled);
  const post = readSwitchValue(config?.postWorkReviewAskEnabled);
  const consult = readSwitchValue(config?.researchConsultAskEnabled);
  const silent = readSwitchValue(config?.reviewAskSilentRunEnabled);
  const timeoutEnabled = readSwitchValue(config?.reviewAskTimeoutEnabled);
  return {
    preAction: pre === true,
    postWork: post === true,
    researchConsult: consult === true,
    preActionKnown: pre !== undefined,
    postWorkKnown: post !== undefined,
    researchConsultKnown: consult !== undefined,
    silentRun: silent === true,
    silentRunKnown: silent !== undefined,
    timeoutEnabled: timeoutEnabled === true,
    timeoutSeconds: readTimeoutSeconds(config?.reviewAskTimeoutSeconds),
  };
}

export function reviewAskMode(settings, point) {
  const enabled = askEnabledFor(settings, point);
  if (!enabled) return { mode: "off", point: point ?? null, silentUnknown: false };
  if (settings?.silentRunKnown === false) {
    return { mode: "ask", point, silentUnknown: true };
  }
  if (settings?.silentRun === true) return { mode: "silent", point, silentUnknown: false };
  return { mode: "ask", point, silentUnknown: false };
}

export function silentRunNotice({ point, task } = {}) {
  const what = point === REVIEW_ASK_POINTS.PRE_ACTION ? "行动前审查" : "收口前复核";
  const subject = typeof task === "string" && task.trim().length > 0 ? task.trim() : "当次任务";
  return `【静默执行】${what}：已按设置跳过询问，将按返回的模板安排一次零上下文代理核对（${subject}）。此为执行痕迹，不构成授权凭据，也不代表核对已完成。`;
}


export function askEnabledFor(settings, point) {
  if (point === REVIEW_ASK_POINTS.PRE_ACTION) return settings?.preAction === true;
  if (point === REVIEW_ASK_POINTS.POST_WORK) return settings?.postWork === true;
  return false;
}

export function isReviewAskPoint(point) {
  return point === REVIEW_ASK_POINTS.PRE_ACTION
    || point === REVIEW_ASK_POINTS.POST_WORK
    || point === REVIEW_ASK_POINTS.RESEARCH;
}

export function reviewAskFingerprint({ point, task, scope, candidate_summary }) {
  const payload = [
    point === undefined ? "" : String(point),
    task === undefined ? "" : String(task),
    scope === undefined ? "" : String(scope),
    candidate_summary === undefined ? "" : String(candidate_summary),
  ].join("\u0000");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function ledgerPath(dshHomePath) {
  if (typeof dshHomePath !== "function") return null;
  try {
    const resolved = dshHomePath(...LEDGER_RELATIVE_PATH);
    return typeof resolved === "string" && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

async function readAll(dshHomePath) {
  const path = ledgerPath(dshHomePath);
  if (path === null) {
    return failure("review-ask/unavailable", "dshHomePath is not a callable home resolver (cannot locate the review-ask carrier)");
  }
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return success({ decisions: [] });
    return failure("review-ask/unreadable", `cannot read the review-ask carrier: ${String(error?.message ?? error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return failure("review-ask/malformed", `the review-ask carrier is not valid JSON: ${String(error?.message ?? error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return failure("review-ask/malformed", "the review-ask carrier is not a JSON object");
  }
  if (!Array.isArray(parsed.decisions)) {
    return failure("review-ask/malformed", "the review-ask carrier carries no `decisions` array");
  }
  return success(parsed);
}

export async function findReviewAskDecision(dshHomePath, fingerprint) {
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    return failure("review-ask/invalid_key", "fingerprint is required to look up a review-ask decision");
  }
  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  let found = null;
  for (const entry of doc.value.decisions) {
    if (typeof entry !== "object" || entry === null) continue;
    if (entry.fingerprint === fingerprint) found = entry;
  }
  return success(found);
}

const ledgerQueues = new Map();

function serialize(key, task) {
  const previous = ledgerQueues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => {});
  ledgerQueues.set(key, tail);
  tail.then(() => {
    if (ledgerQueues.get(key) === tail) ledgerQueues.delete(key);
  });
  return run;
}

export async function recordReviewAskDecision(dshHomePath, entry = {}) {
  try {
    return await recordReviewAskDecisionInner(dshHomePath, entry);
  } catch (error) {
    return failure("review-ask/unavailable", `review-ask recording threw: ${String(error?.message ?? error)}`);
  }
}

async function recordReviewAskDecisionInner(dshHomePath, entry) {
  const fingerprint = entry?.fingerprint;
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    return failure("review-ask/invalid_entry", "fingerprint is required to record a review-ask decision");
  }
  const answer = entry?.answer;
  if (answer !== REVIEW_ASK_ANSWERS.REVIEW && answer !== REVIEW_ASK_ANSWERS.SELF && answer !== REVIEW_ASK_ANSWERS.SKIP) {
    return failure("review-ask/invalid_entry", `answer must be "${REVIEW_ASK_ANSWERS.REVIEW}", "${REVIEW_ASK_ANSWERS.SELF}" or "${REVIEW_ASK_ANSWERS.SKIP}", got ${JSON.stringify(answer ?? null)}`);
  }
  const point = entry?.point;
  if (!isReviewAskPoint(point)) {
    return failure("review-ask/invalid_entry", `point must be one of "${REVIEW_ASK_POINTS.PRE_ACTION}", "${REVIEW_ASK_POINTS.POST_WORK}", "${REVIEW_ASK_POINTS.RESEARCH}", got ${JSON.stringify(point ?? null)}`);
  }
  const path = ledgerPath(dshHomePath);
  if (path === null) {
    return failure("review-ask/unavailable", "dshHomePath is not a callable home resolver (cannot locate the review-ask carrier)");
  }
  const at = typeof entry.at === "string" && entry.at.length > 0 ? entry.at : new Date().toISOString();
  const record = { fingerprint, point, answer, at };
  if (typeof entry.task === "string" && entry.task.trim().length > 0) {
    const text = entry.task.trim();
    record.task = text.length > 500 ? `${text.slice(0, 500)}…` : text;
  }

  await mkdir(dirname(path), { recursive: true });
  return serialize(path, async () => {
    const doc = await readAll(dshHomePath);
    if (!doc.ok) return doc;
    const decisions = doc.value.decisions.filter((item) => !(typeof item === "object" && item !== null && item.fingerprint === fingerprint));
    decisions.push(record);
    const trimmed = decisions.length > MAX_ENTRIES ? decisions.slice(decisions.length - MAX_ENTRIES) : decisions;
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ decisions: trimmed }, null, 2)}\n`, "utf8");
    await rename(tmp, path);
    return success(record);
  });
}

export function composeReviewAsk({ point, task, candidate_summary } = {}) {
  const isPre = point === REVIEW_ASK_POINTS.PRE_ACTION;
  const what = isPre ? "审查" : "复核";
  const PLACEHOLDER_TASK = "当次任务";
  const rawTask = typeof task === "string" && task.trim().length > 0 ? task.trim() : PLACEHOLDER_TASK;
  const TASK_TITLE_MAX = 60;
  const cutAt = (text, max) => {
    if (text.length <= max) return text;
    let end = max;
    const prev = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
    return text.slice(0, end);
  };
  const taskTitle = rawTask.length > TASK_TITLE_MAX ? `${cutAt(rawTask, TASK_TITLE_MAX)}…` : rawTask;

  const head = `${taskTitle}——这次${what}做不做、由谁做？`;
  if (isPre) {
    const summary = validateCandidateSummary(candidate_summary);
    const summaryText = summary.ok ? summary.value : "（未提供候选摘要）";
    return { question: `${head}\n候选摘要：${summaryText}` };
  }
  return { question: head };
}
