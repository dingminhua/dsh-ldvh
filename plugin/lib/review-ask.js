
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

const LEDGER_RELATIVE_PATH = ["ldvh", "review-ask-decisions.json"];

const MAX_ENTRIES = 50;

export const REVIEW_ASK_ROW_SUMMARY = "把关询问 · 待你决定是否安排代理";

export const REVIEW_ASK_PLACEHOLDER_TASK = "当次任务";

export const REVIEW_ASK_POINTS = Object.freeze({
  PRE_ACTION: "pre-action",
  POST_WORK: "post-work",
  RESEARCH: "research",
});

export const REVIEW_ASK_ANSWERS = Object.freeze({
  REVIEW: "review",
  SKIP: "skip",
});

export const COMPLEXITY_CRITERIA = Object.freeze([
  {
    key: "structural-change",
    label: "建立或修改结构性事物",
    source: "specs/04 §6.1",
  },
  {
    key: "multi-path-choice",
    label: "存在多个可选路径的选型",
    source: "specs/04 §6.1",
  },
  {
    key: "decision-conflict",
    label: "方向可能与既定决策冲突",
    source: "specs/04 §6.1",
  },
  {
    key: "not-clearly-direct",
    label: "不属于 04 §6.1 的排除清单（方向未定／当次可直接处理的低风险改动／已定决策／系统性阻碍／过程日志与工具输出与单纯执行提醒）",
    source: "specs/04 §6.1 排除清单取反",
  },
]);

export const GATE_POINT_EXCLUSIONS = Object.freeze([
  {
    key: "pure-research",
    label: "纯调研取证与报告（当次止于取得证据并形成调研结论）",
    carried: "33 §10.3 引用闭环程序化审计、§14 交付合同、§16.3 高风险调研升级的独立视角复核",
    source: "specs/32 §4.2 第 1 项",
    notExcluded: "把调研结论落成规范／代码的那一步；在多个调研路线之间选型",
  },
  {
    key: "pure-commit",
    label: "纯受控提交与推送（当次只把已形成的改动按提交契约落盘并推送）",
    carried: "09 §5.1–§5.5 message 与 diff 逐条对应、precheck 与 Git Gate 双入口、§5.7 提交步骤与回读",
    source: "specs/32 §4.2 第 2 项",
    notExcluded: "提交里含本次新做的实质改动；据 09 §5.6 第 6 项，v5 不定义 push 的机械校验，故不得声称推送已被机械覆盖",
  },
  {
    key: "pure-controlled-object-op",
    label: "纯 LDVH 受控工具面对既有事实对象的操作（状态转换、补充记录、勘误级更新、受控退休）",
    carried: "02 §10.4/§10.5/§10.7 CAS 指纹、写后精确回读与适用完整性审计，加该类型规范自身的建前预检与关口",
    source: "specs/32 §4.2 第 3 项",
    notExcluded: "新建事实对象、改变既有对象的决策与适用范围语义（那本属各类型的 Human Gate）",
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

export function resolveReviewAskSettings(config) {
  const pre = readSwitchValue(config?.preActionReviewAskEnabled);
  const post = readSwitchValue(config?.postWorkReviewAskEnabled);
  const silent = readSwitchValue(config?.reviewAskSilentRunEnabled);
  return {
    preAction: pre === true,
    postWork: post === true,
    preActionKnown: pre !== undefined,
    postWorkKnown: post !== undefined,
    silentRun: silent === true,
    silentRunKnown: silent !== undefined,
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

export function reviewAskFingerprint({ point, task, scope }) {
  const payload = [
    point === undefined ? "" : String(point),
    task === undefined ? "" : String(task),
    scope === undefined ? "" : String(scope),
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
  if (answer !== REVIEW_ASK_ANSWERS.REVIEW && answer !== REVIEW_ASK_ANSWERS.SKIP) {
    return failure("review-ask/invalid_entry", `answer must be "${REVIEW_ASK_ANSWERS.REVIEW}" or "${REVIEW_ASK_ANSWERS.SKIP}", got ${JSON.stringify(answer ?? null)}`);
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

export function composeReviewAsk({ point, task } = {}) {
  const isPre = point === REVIEW_ASK_POINTS.PRE_ACTION;
  const what = isPre ? "代理审查" : "代理复核";
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

  const head = `${taskTitle}——要不要安排${what}？`;

  return { question: head };
}
