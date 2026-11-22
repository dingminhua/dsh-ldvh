
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const REQUIRED_SECTIONS = Object.freeze([
  { key: "effective", label: "生效规则" },
  { key: "applicable", label: "适用规则" },
  { key: "allowed", label: "行动允许" },
  { key: "unverified", label: "未验证范围" },
]);

export const CONDITIONAL_SECTIONS = Object.freeze([
  { key: "fastPath", label: "快通道声明" },
  { key: "escalation", label: "升级记录" },
]);

export const RECALLED_LABEL = "已召回";

const RECALLED_SUB_LABELS = Object.freeze(["Pitfall"]);

export const RECORD_HEADER = "[预检落实记录]";

function fail(code, message, extra = {}) {
  return { ok: false, error: { code, message }, ...extra };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export const RECALL_MARKS = Object.freeze(["未触发", "未遍历", "未声明"]);

function normalizeRecalled(value, tier) {
  const blank = (reason) => ({
    pitfall: "未声明",
    declared: false,
    reason,
  });
  if (value === undefined || value === null) {
    return blank("调用方未给出「已召回」区；按 03 §7.2 不得以「未触发」冒充，故如实留「未声明」");
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return blank("「已召回」为空串，等同于未给出");
    return { pitfall: text, declared: false };
  }
  if (Array.isArray(value)) {
    const text = value.filter((item) => isNonEmptyString(item)).map((item) => item.trim()).join("；");
    if (text === "") return blank("「已召回」为空数组，等同于未给出");
    return { pitfall: text, declared: false };
  }
  if (typeof value === "object") {
    const level = (raw) => {
      if (isNonEmptyString(raw)) return raw.trim();
      return "未声明";
    };
    const pitfall = level(value.pitfall);
    const fastPath = tier === "快通道";
    const warns = [];
    if (fastPath && pitfall === "未声明") {
      warns.push("快通道下的「已召回」区须逐项标明「未触发」或「未遍历」，不得留「未声明」（03 §7.2 末句）");
    }
    return { pitfall, declared: true, fastPathWarnings: warns };
  }
  return blank(`「已召回」的形态无法识别（${typeof value}）`);
}

function checkRecallMarkSwap(recalled) {
  const offenders = [];
  for (const level of RECALLED_SUB_LABELS) {
    const text = String(recalled[level.toLowerCase()] ?? "");
    if (/未遍历/.test(text) && /已核对|已检查|已遍历/.test(text)) {
      offenders.push({ level, text });
    }
  }
  return offenders;
}

export function renderPrecheckRecord(fields = {}) {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return fail("invalid_request", "fields must be a plain object");
  }
  const missing = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!isNonEmptyString(fields[section.key])) missing.push(section.label);
  }
  if (missing.length > 0) {
    return fail(
      "record/section_missing",
      `预检落实记录缺必需段：${missing.join("、")}（03 §7.2；34 §17 第 2 项禁止以空句凑段）`,
      { missing },
    );
  }

  const recalled = normalizeRecalled(fields.recalled, fields.tier);
  const swapped = checkRecallMarkSwap(recalled);
  if (swapped.length > 0) {
    return fail(
      "record/recall_mark_swapped",
      `03 §7.2 末句：不得把「未遍历」写成已核对；违规级别：${swapped.map((s) => s.level).join("、")}`,
      { offenders: swapped },
    );
  }
  const lines = [RECORD_HEADER, ""];
  const present = new Set();

  for (const key of ["effective", "applicable", "allowed"]) {
    const section = REQUIRED_SECTIONS.find((item) => item.key === key);
    lines.push(`- ${section.label}：${fields[key].trim()}`);
    present.add(section.label);
  }
  lines.push(`- ${RECALLED_LABEL}：`);
  for (const sub of RECALLED_SUB_LABELS) {
    lines.push(`  - ${sub}：${recalled[sub.toLowerCase()]}`);
  }
  present.add(RECALLED_LABEL);

  lines.push(`- 未验证范围：${fields.unverified.trim()}`);
  present.add("未验证范围");

  for (const section of CONDITIONAL_SECTIONS) {
    if (!isNonEmptyString(fields[section.key])) continue;
    lines.push(`- ${section.label}：${fields[section.key].trim()}`);
    present.add(section.label);
  }

  const ritual = detectRitualRecord(fields);
  return {
    ok: true,
    text: `${lines.join("\n")}\n`,
    sections: [...present],
    ritualSuspected: ritual.ok === true && ritual.ritualSuspected === true,
    ritualNotice: ritual.ok === true ? ritual.notice : null,
    fastPathWarnings: recalled.fastPathWarnings ?? [],
    recallDeclarationGap: recalled.declared === false ? (recalled.reason ?? null) : null,
  };
}

export function checkRecordShape(text) {
  if (!isNonEmptyString(text)) {
    return fail("invalid_request", "text must be a non-empty string");
  }
  if (!text.startsWith(RECORD_HEADER)) {
    return fail("record/header_missing", `记录须以 ${RECORD_HEADER} 起首（03 §7.2）`);
  }
  const present = [];
  const missing = [];
  for (const label of [...REQUIRED_SECTIONS.map((item) => item.label), RECALLED_LABEL]) {
    if (new RegExp(`^\\s*(?:- )?${label}：`, "m").test(text)) present.push(label);
    else missing.push(label);
  }
  return { ok: true, complete: missing.length === 0, present, missing };
}

export function recordFingerprint(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function buildHandover(fields = {}) {
  const rendered = renderPrecheckRecord(fields);
  if (!rendered.ok) return rendered;
  return {
    ok: true,
    text: rendered.text,
    fingerprint: recordFingerprint(rendered.text),
    shape: checkRecordShape(rendered.text),
    sections: rendered.sections,
    carrier: carrierStatus(),
  };
}

export function carrierStatus() {
  return {
    persisted: false,
    carriedBy: "handover-text",
    envelope: {
      specRef: "ldvh-root 的 handback 条目",
      built: false,
      disclosure: "Output Envelope 机器承载未建（交还须同时给出人可读正文与机器可读结果；承载未建时如实披露，不声明已建成）",
    },
  };
}

export const FINDING_STATES = Object.freeze(["落实", "已识别未落实", "未识别"]);

export const APPLICATION_CRITERIA = Object.freeze([
  { key: "hasTarget", label: "有指向", question: "对应到当次行动的哪个具体要素（范围／路径／前置条件／是否继续／是否提请）" },
  { key: "hasChange", label: "有改变", question: "该要素与「未识别到该项时」有何不同（须可被指出，不是「确认无需改变」）" },
  { key: "hasTraceableBasis", label: "有可回指依据", question: "改变的理由如何回到该识别结果本身（不是事后归因）" },
]);

const MERGED_COMPLIANCE_TERMS = Object.freeze(["已遵守", "已检查", "已确认", "没问题", "符合要求"]);

const DESCRIPTIVE_FIELD_BANNED_TERMS = Object.freeze(["已遵守", "符合要求", "没问题"]);

export function evaluateApplication(finding = {}) {
  if (!isNonEmptyString(finding.statement)) {
    return fail("invalid_request", "each finding needs a statement (the constraint that was identified)");
  }
  const merged = MERGED_COMPLIANCE_TERMS.find((term) => String(finding.hasChange ?? "").includes(term));
  if (merged !== undefined) {
    return fail(
      "application/merged_compliance_claim",
      `第②项写成了「${merged}」：§8.3 禁止以「已遵守」类措辞代替可指出的改变；若确属「确认无需改变」，须走 actionUnchangedByDesign + noChangeRationale 显式形态`,
    );
  }

  const byDesign = finding.actionUnchangedByDesign === true;
  if (byDesign && !isNonEmptyString(finding.noChangeRationale)) {
    return fail(
      "application/no_change_rationale_missing",
      "声明「确认约束后决定不需要改变行动」时须说明为何该约束不要求改变（§8.3 末段），不得只写结论",
    );
  }

  const missing = APPLICATION_CRITERIA
    .filter((criterion) => !isNonEmptyString(finding[criterion.key]))
    .map((criterion) => criterion.label);

  const unresolved = byDesign
    ? missing.filter((label) => label !== "有改变")
    : missing;

  if (unresolved.length > 0) {
    return {
      ok: true,
      statement: finding.statement,
      state: "已识别未落实",
      unresolvedCriteria: unresolved,
      reason: `缺 ${unresolved.join("、")}；按 §8.3「三项中任一不成立」处理为已识别未落实`,
      claimsCompliance: false,
    };
  }

  return {
    ok: true,
    statement: finding.statement,
    state: "落实",
    unresolvedCriteria: [],
    unchangedByDesign: byDesign,
    claimsCompliance: false,
  };
}

export function summarizeApplications(findings = []) {
  if (!Array.isArray(findings)) {
    return fail("invalid_request", "findings must be an array");
  }
  const settled = [];
  const unsettled = [];
  for (const finding of findings) {
    const verdict = evaluateApplication(finding);
    if (verdict.ok !== true) return verdict;
    (verdict.state === "落实" ? settled : unsettled).push(verdict);
  }
  return {
    ok: true,
    落实: settled,
    已识别未落实: unsettled,
    claimsCompliance: false,
    mergedConclusionForbidden: true,
  };
}

export function checkFindingStates(findings) {
  if (!Array.isArray(findings)) {
    return fail("invalid_request", "findings must be an array");
  }
  const invalid = findings
    .map((finding, index) => ({ index, state: finding?.state }))
    .filter(({ state }) => !FINDING_STATES.includes(state));
  if (invalid.length > 0) {
    return fail(
      "findings/state_invalid",
      `逐项结论须落在 34 §12 的三态内（${FINDING_STATES.join(" / ")}），不得合并为「已遵守」`,
      { invalid },
    );
  }
  return {
    ok: true,
    counts: {
      落实: findings.filter((f) => f.state === "落实").length,
      已识别未落实: findings.filter((f) => f.state === "已识别未落实").length,
      未识别: findings.filter((f) => f.state === "未识别").length,
    },
    claimsCompliance: false,
  };
}


export const REUSE_CONDITIONS = Object.freeze([
  {
    key: "sameScope",
    label: "同一会话的连续行动步骤中，Human 目标、工作对象和当前行动范围未发生实质变化或超出上次覆盖范围",
    mechanical: false,
  },
  {
    key: "sourcesUnchanged",
    label: "上次记录后，当前 Working Tree 中作为预检依据的规则源和事实载体没有发生变更",
    mechanical: true,
  },
  {
    key: "noNewSignal",
    label: "未出现新的召回触发、风险升级、能力缺口或 Human Gate 信号",
    mechanical: false,
  },
]);

export function evaluateReuse(input = {}) {
  const failed = [];
  const unverifiable = [];

  if (!isNonEmptyString(input.sessionId)) {
    return fail("invalid_request", "sessionId is required to judge 03 §7.3 condition 1");
  }

  if (!isNonEmptyString(input.recordSessionId) || input.recordSessionId !== input.sessionId) {
    failed.push({
      condition: "sameScope",
      reason: `既有记录不属于当前会话（记录=${input.recordSessionId ?? "未知"}，当前=${input.sessionId}）；跨会话不得直接复用`,
    });
  } else if (input.sameScope !== true) {
    failed.push({
      condition: "sameScope",
      reason: "调用方未确认目标、工作对象与行动范围未实质变化（03 §7.3 第 1 条，语义判断不由机械判定）",
    });
  }

  const carriers = Array.isArray(input.carriers) ? input.carriers : [];
  if (carriers.length === 0) {
    unverifiable.push({
      condition: "sourcesUnchanged",
      reason: "未提供任何作为预检依据的载体指纹；该项按未核验处理，不默认通过（也不得据此要求全量扫描，03 §7.3 末句）",
    });
  } else {
    for (const carrier of carriers) {
      const path = carrier?.path;
      if (!isNonEmptyString(path)) {
        unverifiable.push({ condition: "sourcesUnchanged", reason: "载体条目缺 path，无法比对" });
        continue;
      }
      if (!isNonEmptyString(carrier.baseline)) {
        unverifiable.push({
          condition: "sourcesUnchanged",
          reason: `${path}：未记录基线指纹，无法证明未变更`,
        });
        continue;
      }
      if (carrier.current === null || carrier.current === undefined) {
        failed.push({ condition: "sourcesUnchanged", reason: `${path}：载体当前不可读` });
        continue;
      }
      if (carrier.current !== carrier.baseline) {
        failed.push({
          condition: "sourcesUnchanged",
          reason: `${path}：内容指纹已变更（基线 ${String(carrier.baseline).slice(0, 12)}… → 当前 ${String(carrier.current).slice(0, 12)}…）`,
        });
      }
    }
  }

  if (input.noNewSignal !== true) {
    failed.push({
      condition: "noNewSignal",
      reason: "调用方未确认未出现新的召回触发、风险升级、能力缺口或 Human Gate 信号（03 §7.3 第 3 条）",
    });
  }

  return {
    ok: true,
    reusable: failed.length === 0 && unverifiable.length === 0,
    failed,
    unverifiable,
    requiredAction: failed.length === 0 && unverifiable.length === 0
      ? null
      : "重新执行受影响部分的预检并形成新的预检落实记录（03 §7.3 末段）；不得以「无法证明没有变化」为由全量重扫",
  };
}

export async function fingerprintCarriers(root, carriers) {
  if (!isNonEmptyString(root)) {
    return fail("invalid_request", "root is required to resolve carrier paths");
  }
  if (!Array.isArray(carriers)) {
    return fail("invalid_request", "carriers must be an array of path strings or {path, baseline} objects");
  }
  const out = [];
  for (const entry of carriers) {
    const path = typeof entry === "string" ? entry : entry?.path;
    if (!isNonEmptyString(path)) {
      return fail("invalid_request", "every carrier entry needs a path");
    }
    const baseline = typeof entry === "object" && entry !== null ? (entry.baseline ?? null) : null;
    let current = null;
    try {
      const text = await readFile(join(root, path), "utf8");
      current = recordFingerprint(text);
    } catch {
      current = null;
    }
    out.push({ path, baseline, current });
  }
  return { ok: true, carriers: out };
}


export const DEVIATION_FORMS = Object.freeze([
  "未识别偏离",
  "已识别未落实偏离",
  "判断错误偏离",
  "来源本身冲突",
]);

export const DEVIATION_FIELDS = Object.freeze([
  { key: "form", label: "偏离形态" },
  { key: "affectedScope", label: "受影响范围" },
  { key: "sideEffects", label: "已发生的副作用" },
  { key: "pendingChecks", label: "待核对项" },
]);

export function evaluateDeviation(input = {}) {
  const missing = DEVIATION_FIELDS
    .filter((field) => !isNonEmptyString(input[field.key]))
    .map((field) => field.label);
  if (missing.length > 0) {
    return fail(
      "deviation/fields_missing",
      `偏离登记缺 §9.2 要求的项：${missing.join("、")}`,
      { missing },
    );
  }
  if (!DEVIATION_FORMS.includes(input.form)) {
    return fail(
      "deviation/form_invalid",
      `偏离形态须落在 34 §9.1 的闭集内（${DEVIATION_FORMS.join(" / ")}）`,
      { allowed: [...DEVIATION_FORMS] },
    );
  }
  const discovered = Date.parse(input.discoveredAt ?? "");
  const registered = Date.parse(input.registeredAt ?? "");
  const returned = Date.parse(input.returnedAt ?? "");
  if (Number.isNaN(discovered) || Number.isNaN(registered)) {
    return fail("deviation/timestamp_invalid", "discoveredAt 与 registeredAt 须为可解析的时间");
  }
  if (!Number.isNaN(returned) && registered > returned) {
    return fail("deviation/registered_after_return", "登记时刻晚于交还时刻：§9.2 要求发现时立即登记");
  }
  const lateRegistration = registered > discovered;
  return {
    ok: true,
    form: input.form,
    registeredBeforeReturn: Number.isNaN(returned) ? null : registered <= returned,
    lateRegistration,
    retroactiveReliefGranted: false,
  };
}

export function checkRetroactiveCoverage(input = {}) {
  const action = Date.parse(input.actionAt ?? "");
  const backfilled = Date.parse(input.backfilledAt ?? "");
  const declared = input.coversDeviations;
  if (Number.isNaN(action)) {
    return fail("invalid_request", "actionAt must be a parseable timestamp");
  }
  if (Number.isNaN(backfilled)) {
    return { ok: true, backfilled: false, retroactive: false, acceptable: true };
  }
  const retroactive = backfilled > action;
  if (retroactive && declared === false) {
    return fail(
      "record/retroactive_coverage",
      "补做识别（backfilledAt 晚于 actionAt）却声明未覆盖偏离：34 §9.3 禁止以补做识别覆盖已发生的偏离",
    );
  }
  return {
    ok: true,
    backfilled: true,
    retroactive,
    acceptable: !retroactive || declared === true,
    provesOnlyAfterBackfill: retroactive,
  };
}


export const RISK_TIERS = Object.freeze(["快通道", "标准路径", "加固路径"]);

export const STAGE_MINIMUM_TIER = Object.freeze({
  纯读取: "快通道",
  来源检索: "快通道",
  三段判断: "标准路径",
  约束落实判定: "标准路径",
  偏离判定: "标准路径",
  涉及授权边界的判断: "标准路径",
});

const AUTHORIZATION_STAGE = "涉及授权边界的判断";

export function checkRiskRouting(input = {}) {
  const stage = input.stage;
  const tier = input.tier;
  if (!isNonEmptyString(stage) || !Object.hasOwn(STAGE_MINIMUM_TIER, stage)) {
    return fail(
      "routing/stage_unknown",
      `环节须为 34 §11 声明的环节之一（${Object.keys(STAGE_MINIMUM_TIER).join(" / ")}）`,
      { allowed: Object.keys(STAGE_MINIMUM_TIER) },
    );
  }
  if (!RISK_TIERS.includes(tier)) {
    return fail(
      "routing/tier_invalid",
      `风险层须落在 03 §6.1 的三层内（${RISK_TIERS.join(" / ")}）；34 §17 第 4 项禁增设中间层`,
      { allowed: [...RISK_TIERS] },
    );
  }
  const minimum = STAGE_MINIMUM_TIER[stage];
  const rank = (value) => RISK_TIERS.indexOf(value);
  const involvesAuthorization = input.involvesAuthorization === true;

  if (involvesAuthorization && tier === "快通道") {
    return {
      ok: true,
      allowed: false,
      stage,
      tier,
      minimumTier: AUTHORIZATION_STAGE,
      reason: "34 §11：任何涉及授权边界的判断不得产自快通道（与环节表独立）",
    };
  }
  if (rank(tier) < rank(minimum)) {
    return {
      ok: true,
      allowed: false,
      stage,
      tier,
      minimumTier: minimum,
      reason: `34 §11：${stage} 必须 ${minimum} 以上，声明的 ${tier} 不足`,
    };
  }
  return { ok: true, allowed: true, stage, tier, minimumTier: minimum, reason: null };
}

export const FAST_PATH_REQUIREMENTS = Object.freeze([
  { key: "applicability", label: "适用条件" },
  { key: "exclusions", label: "排除条件" },
  { key: "minimumCoverage", label: "最低预检覆盖" },
  { key: "escalationTriggers", label: "升级触发" },
  { key: "declarationForm", label: "声明方式" },
]);

export function checkFastPathDeclaration(declaration = {}) {
  const missing = FAST_PATH_REQUIREMENTS
    .filter((requirement) => !isNonEmptyString(declaration[requirement.key]))
    .map((requirement) => requirement.label);
  if (missing.length > 0) {
    return fail(
      "fastpath/declaration_incomplete",
      `快通道声明缺 03 §6.2 要求的要素：${missing.join("、")}`,
      { missing },
    );
  }
  if (declaration.waivesThreeWayJudgement === true) {
    return fail(
      "fastpath/waives_three_way",
      "03 §6.2 第 3 项：快通道仍必须完成生效/适用/行动允许三段判断，不得声明免除",
    );
  }
  return { ok: true, complete: true, tiers: [...RISK_TIERS], waivesThreeWay: false };
}


export const ENTRY_SIGNALS = Object.freeze([
  "即将执行会产生副作用或改变状态的动作",
  "既有规则、事实、决定或授权发生变化",
  "上一轮交还声明了未验证范围，而本次行动落在该范围之内",
  "执行中发现实际影响超出事先假设的范围",
]);

export const EXCLUDED_ACTION_KINDS = Object.freeze(["纯读取", "纯查询"]);

export function checkEntry(input = {}) {
  const kind = input.actionKind;
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const unknownSignals = signals.filter((signal) => !ENTRY_SIGNALS.includes(signal));
  if (unknownSignals.length > 0) {
    return fail(
      "entry/signal_unknown",
      `进入信号须为 34 §6 列出的四种之一；未知项：${unknownSignals.join("、")}`,
      { allowed: [...ENTRY_SIGNALS] },
    );
  }
  if (EXCLUDED_ACTION_KINDS.includes(kind)) {
    return { ok: true, entered: false, undetermined: false, reason: `34 §6 排除条件：${kind}动作不进入本系统` };
  }
  if (input.applicabilityUndetermined === true) {
    return {
      ok: true,
      entered: null,
      undetermined: true,
      mustRegisterAsUnverified: true,
      reason: "34 §6 不确定处理：适用性无法判定时不得按「无约束」处理，须登记为未验证范围",
      mustStop: input.mayChangePermission !== false,
    };
  }
  if (signals.length === 0) {
    return {
      ok: true,
      entered: false,
      undetermined: false,
      reason: "未命中 34 §6 的任一进入信号；注意这表示当次不进入，不表示适用性已被否证",
    };
  }
  return { ok: true, entered: true, undetermined: false, signals, reason: null };
}

export const FAILURE_ROUTES = Object.freeze([
  "识别失败",
  "三段判断任一项不成立",
  "落实未发生",
  "偏离已发生",
]);

export function routeFailure(input = {}) {
  const route = input.route;
  if (!FAILURE_ROUTES.includes(route)) {
    return fail(
      "failure/route_unknown",
      `失败去向须为 34 §8 列出的四条之一（${FAILURE_ROUTES.join(" / ")}）`,
      { allowed: [...FAILURE_ROUTES] },
    );
  }
  const actions = {
    识别失败: "按 03 §6.3 升级并按 00 §4.7 暂停；不得以「已尽力检索」代替识别结论",
    三段判断任一项不成立: "按性质分流：生效不成立补来源／适用不成立缩小范围／行动允许不成立停止",
    落实未发生: "视为未落实，不得以记录齐全替代；按 §8.3 判定后停止或重做",
    偏离已发生: "进入 §9 偏离处置（形态须落在 §9.1 闭集内）",
  };
  return {
    ok: true,
    route,
    action: actions[route],
    mustStop: true,
    partialDeliveryForbidden: true,
    mustCarryResidualToHandover: true,
  };
}


export function checkTransverseMerge(input = {}) {
  if (!isNonEmptyString(input.systemKey)) {
    return fail("invalid_request", "systemKey is required (which business system this action runs inside)");
  }
  const hasRuleCompliance = input.ruleComplianceExecuted === true;
  const hasSystemSpecific = input.systemSpecificExecuted === true;
  const missing = [];
  if (!hasRuleCompliance) missing.push("本系统的适用识别与预检");
  if (!hasSystemSpecific) missing.push(`${input.systemKey} 的专属预检`);
  if (missing.length > 0) {
    return {
      ok: true,
      passed: false,
      missing,
      stopCondition: "34 §16.1 第 6 项",
      reason: `横切合并且不替代：缺 ${missing.join("、")}；34 §11 双向都不免除`,
    };
  }
  return {
    ok: true,
    passed: true,
    missing: [],
    proves: "两套预检并存的事实；不证明任一套正确",
  };
}


const GAP_SUBSTITUTE_TERMS = Object.freeze(["已尽力", "尽力了", "已充分检索", "已全面检索", "应该没有遗漏"]);

export const GAP_FIELDS = Object.freeze([
  { key: "source", label: "未识别的来源", verbatim: false },
  { key: "scope", label: "影响的范围", verbatim: false },
  { key: "state", label: "缺口状态", verbatim: false },
]);

export function checkGapRegistration(gaps) {
  if (!Array.isArray(gaps)) {
    return fail("invalid_request", "gaps must be an array (empty array = no gaps, which is a claim to be judged semantically)");
  }
  const rejected = [];
  const incomplete = [];
  for (const [index, gap] of gaps.entries()) {
    const note = String(gap?.note ?? gap?.reason ?? gap?.description ?? "");
    const substitute = GAP_SUBSTITUTE_TERMS.find((term) => note.includes(term));
    if (substitute !== undefined) {
      rejected.push({ index, term: substitute });
      continue;
    }
    const missing = GAP_FIELDS
      .filter((field) => !isNonEmptyString(gap?.[field.key]))
      .map((field) => field.label);
    if (missing.length > 0) incomplete.push({ index, missing });
  }
  if (rejected.length > 0) {
    return fail(
      "gap/substitute_claim",
      `34 §14 禁止以「${rejected.map((item) => item.term).join("」「")}」替代缺口登记；须补齐来源、影响范围与状态`,
      { rejected },
    );
  }
  if (incomplete.length > 0) {
    return fail(
      "gap/incomplete",
      `缺口登记缺项：${incomplete.map((item) => `#${item.index} 缺 ${item.missing.join("、")}`).join("；")}`,
      { incomplete },
    );
  }
  return {
    ok: true,
    count: gaps.length,
    proves: "缺口是否被如实列出；不证明缺口已闭合",
    closesGaps: false,
  };
}


export const THREE_WAY_ITEMS = Object.freeze([
  { key: "effective", label: "生效" },
  { key: "applicable", label: "适用" },
  { key: "allowed", label: "行动允许" },
]);

export const RETURN_ITEMS = Object.freeze([
  { key: "identification", label: "当次识别的来源范围与识别结论", required: true, shape: "string" },
  { key: "threeWayJudgement", label: "三段判断的结果", required: true, shape: "object" },
  { key: "application", label: "约束落实的具体形态", required: true, shape: "object" },
  { key: "recalled", label: "已召回与未触发的类型", required: true, shape: "string" },
  { key: "verified", label: "已验证范围", required: true, shape: "string" },
  { key: "unverified", label: "未验证范围", required: true, shape: "string" },
  { key: "residualRisk", label: "残留风险", required: true, shape: "string" },
  { key: "deviations", label: "偏离情况", required: false, shape: "array" },
  { key: "humanDecisions", label: "待 Human 决定事项", required: true, shape: "string" },
  { key: "madeHumanDecisions", label: "已作出的 Human 决定与授权边界", required: true, shape: "string" },
  { key: "continuation", label: "继续入口", required: true, shape: "string" },
]);

function presentByShape(value, shape) {
  if (shape === "string") return isNonEmptyString(value);
  if (shape === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (shape === "array") return Array.isArray(value);
  return false;
}

export const COMPLIANCE_BUCKET_LABELS = Object.freeze(["已落实", "已识别未落实"]);

export function assembleReturn(input = {}) {
  if (isNonEmptyString(input.threeWayJudgement)) {
    return fail(
      "return/three_way_not_itemized",
      "三段判断须逐项给出（生效／适用／行动允许），不得以一句概括替代（34 §12「逐项」）",
      { required: THREE_WAY_ITEMS.map((item) => item.label) },
    );
  }

  const missing = RETURN_ITEMS
    .filter((item) => item.required && !presentByShape(input[item.key], item.shape))
    .map((item) => item.label);

  const threeWay = input.threeWayJudgement ?? {};
  const threeWayMissing = THREE_WAY_ITEMS
    .filter((item) => !isNonEmptyString(threeWay[item.key]))
    .map((item) => item.label);
  if (threeWayMissing.length > 0 && !missing.includes("三段判断的结果")) {
    missing.push(`三段判断的结果（缺 ${threeWayMissing.join("、")}）`);
  }

  const application = input.application;
  const hasBuckets = application !== null
    && typeof application === "object"
    && Array.isArray(application.落实)
    && Array.isArray(application.已识别未落实);
  if (!hasBuckets && !missing.includes("约束落实的具体形态")) {
    missing.push(
      "约束落实的具体形态（须按 §8.3 逐项给出，并分列「已落实」与「已识别未落实」；合并为一句即不成立）",
    );
  }

  if (missing.length > 0) {
    return fail("return/items_missing", `34 §12 交还缺项：${missing.join("；")}`, { missing });
  }

  const deviations = Array.isArray(input.deviations) ? input.deviations : [];
  const deviationResults = [];
  for (const deviation of deviations) {
    const verdict = evaluateDeviation(deviation);
    if (verdict.ok !== true) return verdict;
    deviationResults.push(verdict);
  }

  const conclusionHaystack = [input.identification, threeWay.effective, threeWay.applicable, threeWay.allowed]
    .filter((value) => typeof value === "string")
    .join("\n");
  const merged = MERGED_COMPLIANCE_TERMS.find((term) => conclusionHaystack.includes(term));
  if (merged !== undefined) {
    return fail(
      "return/merged_conclusion",
      `交还结论出现「${merged}」：34 §12 要求显式区分「已落实」与「已识别未落实」，不得合并为「已遵守」`,
    );
  }
  const descriptiveHaystack = [
    input.verified,
    input.unverified,
    input.residualRisk,
    input.madeHumanDecisions,
    input.humanDecisions,
    input.continuation,
    input.recalled,
  ]
    .filter((value) => typeof value === "string")
    .join("\n");
  const mergedDescriptive = DESCRIPTIVE_FIELD_BANNED_TERMS.find((term) => descriptiveHaystack.includes(term));
  if (mergedDescriptive !== undefined) {
    return fail(
      "return/merged_conclusion",
      `交还描述字段出现「${mergedDescriptive}」：该词是无条件合规主张，34 §12 禁止以合并式结论替代两类分列`,
    );
  }

  const lines = [
    "## 交还（34 §12）",
    "",
    `- 当次识别的来源范围与识别结论：${input.identification.trim()}`,
    "- 三段判断的结果：",
    ...THREE_WAY_ITEMS.map((item) => `  - ${item.label}：${threeWay[item.key].trim()}`),
    "- 约束落实的具体形态：",
    `  - ${COMPLIANCE_BUCKET_LABELS[0]}：${application.落实.length} 项`,
    `  - ${COMPLIANCE_BUCKET_LABELS[1]}：${application.已识别未落实.length} 项`,
    `- 已召回与未触发的类型：${input.recalled.trim()}`,
    `- 已验证范围：${input.verified.trim()}`,
    `- 未验证范围：${input.unverified.trim()}`,
    `- 残留风险：${input.residualRisk.trim()}`,
    `- 偏离情况：${deviations.length === 0 ? "无（本节按 34 §9.2 为空；空白不代替登记）" : `${deviations.length} 项，均已按 §9.2 登记`}`,
    `- 待 Human 决定事项：${input.humanDecisions.trim()}`,
    `- 已作出的 Human 决定与授权边界：${input.madeHumanDecisions.trim()}`,
    `- 继续入口：${input.continuation.trim()}`,
  ];

  return {
    ok: true,
    text: `${lines.join("\n")}\n`,
    complete: true,
    deviations: deviationResults,
    buckets: { 已落实: application.落实.length, 已识别未落实: application.已识别未落实.length },
    claimsCompliance: false,
    distinctionEnforced: true,
  };
}


export const CONFLICT_TIERS = Object.freeze([
  { level: 1, source: "00 根规范", self: false },
  { level: 2, source: "01–19 基础规范", self: false },
  { level: 3, source: "20–29 事实类型规范", self: false },
  { level: 4, source: "30–39 业务系统规范", self: false },
  { level: 5, source: "项目事实源中的事实与决定", self: false },
]);

export const SELF_TIER_SEGMENT = "30–39 业务系统规范";

export function routeConflict(input = {}) {
  const levels = [input.levelA, input.levelB];
  for (const level of levels) {
    if (!Number.isInteger(level) || !CONFLICT_TIERS.some((tier) => tier.level === level)) {
      return fail(
        "conflict/level_invalid",
        `层级须为 34 §7.5 表内的一至五级；收到 ${JSON.stringify(level)}`,
        { allowed: CONFLICT_TIERS.map((tier) => tier.level) },
      );
    }
  }
  if (input.involvesThisSpec === true) {
    return {
      ok: true,
      escalateTo: "Human",
      reason: "34 §7.5：本规范自身不在层级表内（不自指），故不得按级处置，须按 §7 交还 Human",
      autoResolved: false,
      picks: null,
    };
  }
  if (levels.includes(1) && input.touchesRootDecisionList === true) {
    return {
      ok: true,
      escalateTo: "Human",
      reason: "34 §7.5 第 1 级：冲突涉及 00 §3.2 根决定清单所列事项时一律提请 Human",
      autoResolved: false,
      picks: null,
    };
  }
  return {
    ok: true,
    escalateTo: "Human",
    reason: "34 §7.5：层级只表示向谁提请，冲突须提请 Human，不得自行取舍",
    autoResolved: false,
    picks: null,
    levelsAreScores: false,
  };
}


export function parseRecord(text) {
  if (!isNonEmptyString(text)) {
    return fail("invalid_request", "text must be a non-empty string");
  }
  if (!text.startsWith(RECORD_HEADER)) {
    return fail("record/header_missing", `记录须以 ${RECORD_HEADER} 起首（03 §7.2）`);
  }
  const lines = text.split("\n");
  const out = { recalled: {} };
  const found = [];
  const labelToKey = new Map([
    ...REQUIRED_SECTIONS.map((section) => [section.label, section.key]),
    ...CONDITIONAL_SECTIONS.map((section) => [section.label, section.key]),
  ]);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (new RegExp(`^- ${RECALLED_LABEL}：\\s*$`).test(line)) {
      found.push(RECALLED_LABEL);
      for (let inner = index + 1; inner < lines.length; inner += 1) {
        const match = /^\s+- (Pitfall)：(.*)$/.exec(lines[inner]);
        if (match === null) break;
        out.recalled[match[1].toLowerCase()] = match[2].trim();
        index = inner;
      }
      continue;
    }
    const match = /^- ([^：]+)：(.*)$/.exec(line);
    if (match === null) continue;
    const key = labelToKey.get(match[1].trim());
    if (key === undefined) continue;
    out[key] = match[2].trim();
    found.push(match[1].trim());
  }

  const missing = REQUIRED_SECTIONS
    .map((section) => section.label)
    .filter((label) => !found.includes(label));
  if (!found.includes(RECALLED_LABEL)) missing.push(RECALLED_LABEL);

  return {
    ok: true,
    fields: out,
    complete: missing.length === 0,
    missing,
    present: found,
    proves: "记录可被解析回结构化字段；不证明其取值正确或识别充分",
  };
}

export function roundTripRecord(fields) {
  const rendered = renderPrecheckRecord(fields);
  if (rendered.ok !== true) return rendered;
  const parsed = parseRecord(rendered.text);
  if (parsed.ok !== true) return parsed;
  const original = {
    effective: fields.effective.trim(),
    applicable: fields.applicable.trim(),
    allowed: fields.allowed.trim(),
    unverified: fields.unverified.trim(),
  };
  const diffs = Object.entries(original)
    .filter(([key, value]) => parsed.fields[key] !== value)
    .map(([key, rendered_]) => ({ key, rendered: rendered_, parsed: parsed.fields[key] }));
  return { ok: true, roundTripStable: diffs.length === 0, diffs, parsed };
}


const EMPTY_CONTENT_TERMS = Object.freeze([
  "无", "没有", "不存在", "不适用", "略", "同上", "见前", "无需", "n/a", "-", "—",
]);

export function detectRitualRecord(fields = {}) {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return fail("invalid_request", "fields must be a plain object");
  }
  const suspect = [];
  const check = (label, value) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    const stripped = text.replace(/[。，、；：！？\s]/g, "");
    const lowered = stripped.toLowerCase();
    const isBare = EMPTY_CONTENT_TERMS.some((term) => term.toLowerCase() === lowered);
    const isTiny = stripped.length <= 2 && EMPTY_CONTENT_TERMS.some((term) => lowered.includes(term.toLowerCase()));
    if (isBare || isTiny) suspect.push({ section: label, value: text });
  };
  for (const section of REQUIRED_SECTIONS) check(section.label, fields[section.key]);
  check("未验证范围", fields.unverified);
  const recalled = fields.recalled;
  if (recalled !== null && typeof recalled === "object" && !Array.isArray(recalled)) {
    const pitfall = String(recalled.pitfall ?? "").trim();
    if (pitfall === "未声明") {
      suspect.push({ section: RECALLED_LABEL, value: "召回区为「未声明」" });
    }
  }
  return {
    ok: true,
    suspect,
    ritualSuspected: suspect.length > 0,
    judged: false,
    notice:
      suspect.length === 0
        ? null
        : `34 §17 第 2 项：以下段落无实质内容，请确认它们是「如实写无」还是「凑段」：${suspect.map((item) => item.section).join("、")}`,
  };
}


export const HUMAN_GATE_ITEMS = Object.freeze([
  { key: "sourceConflict", label: "两个以上来源给出互斥要求，需在来源之间取舍" },
  { key: "sourceDefect", label: "识别发现既有规则、事实或决定本身存在缺口，而修复须修改规范源或根决定" },
  { key: "scopeEscalation", label: "偏离的影响范围已超出当次行动，需决定是否暂停更大范围" },
  { key: "acceptIncomplete", label: "是否接受「识别不完整但已声明缺口」的行动继续" },
  { key: "recallBudgetScope", label: "是否提高召回的字节预算常量（含提高已登记档位集合的上限档）或扩大召回的类型范围" },
]);

export function checkHumanGate(items = []) {
  if (!Array.isArray(items)) {
    return fail("invalid_request", "items must be an array (each item names a pending decision)");
  }
  const allowed = new Set(HUMAN_GATE_ITEMS.map((item) => item.key));
  const unknown = items.filter((item) => !allowed.has(item));
  if (unknown.length > 0) {
    return fail(
      "gate/item_unknown",
      `待决事项须落在 34 §15.1 的五项内；未知项：${unknown.join("、")}`,
      { allowed: [...allowed] },
    );
  }
  const triggered = HUMAN_GATE_ITEMS.filter((item) => items.includes(item.key));
  return {
    ok: true,
    requiresHuman: triggered.length > 0,
    triggered: triggered.map((item) => item.key),
    labels: triggered.map((item) => item.label),
    fastPathAllowed: triggered.length === 0,
    approvalDoesNotGrantIdentification: true,
    approvalDoesNotGrantCompliance: true,
  };
}


export const NON_EQUIVALENCES = Object.freeze([
  {
    left: "识别",
    doesNotImply: "落实",
    specRef: "rule-compliance-verification 的 implementation-criteria 条目",
    note: "识别到约束不等于行动因此改变；落实须满足有指向／有改变／有可回指依据三项",
  },
  {
    left: "落实",
    doesNotImply: "授权",
    specRef: "ldvh-root 的 decisions-are-human 条目",
    note: "行动已按约束改变，不等于该行动已被授权；授权只来自 Human 决定与各授权程序",
  },
  {
    left: "预检记录完成",
    doesNotImply: "行动完成",
    specRef: "rule-compliance-verification 的 record 条目",
    note: "记录是判断的承载，不是判断本身，更不是行动本身",
  },
  {
    left: "已识别",
    doesNotImply: "已允许",
    specRef: "rule-compliance-recall 的 what-it-is 条目",
    note: "这条边界在任何验证结论上均不得被跨越",
  },
  {
    left: "补做识别",
    doesNotImply: "从未偏离",
    specRef: "rule-compliance-verification 的 deviation-register 条目",
    note: "补做只能证明补齐后的状态，其前一段的偏离须如实保留",
  },
  {
    left: "已落实",
    doesNotImply: "已完成",
    specRef: "rule-compliance-recall 的 what-it-is 条目",
    note: "落实指约束改变了行动，完成指行动本身达成",
  },
]);

const EQUIVALENCE_PATTERNS = Object.freeze([
  { pattern: /已识别\s*(?:即|=|＝|就是)\s*已允许/, left: "已识别", right: "已允许" },
  { pattern: /已落实\s*(?:即|=|＝|就是)\s*已完成/, left: "已落实", right: "已完成" },
  { pattern: /补做识别\s*(?:即|=|＝|就是)\s*从未偏离/, left: "补做识别", right: "从未偏离" },
  { pattern: /识别\s*(?:即|=|＝|就是)\s*落实/, left: "识别", right: "落实" },
  { pattern: /落实\s*(?:即|=|＝|就是)\s*授权/, left: "落实", right: "授权" },
  { pattern: /预检(?:记录)?完成\s*(?:即|=|＝|就是)\s*行动完成/, left: "预检记录完成", right: "行动完成" },
]);

export function checkConceptBoundaries(text) {
  if (!isNonEmptyString(text)) {
    return fail("invalid_request", "text must be a non-empty string");
  }
  const violations = [];
  for (const { pattern, left, right } of EQUIVALENCE_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) {
      const entry = NON_EQUIVALENCES.find((item) => item.left === left && item.doesNotImply === right);
      violations.push({
        left,
        right,
        matched: match[0],
        specRef: entry?.specRef ?? "rule-compliance-recall 的 what-it-is 条目",
        note: entry?.note ?? null,
      });
    }
  }
  return {
    ok: true,
    clean: violations.length === 0,
    violations,
    proves: "未出现把两个概念写成等式的措辞；不证明文中未隐含该结论",
    nonEquivalences: NON_EQUIVALENCES.length,
  };
}


export const HANDOVER_LAYERS = Object.freeze([
  { key: "flow", label: "流程完成层", meaning: "系统流程按定义执行完毕，未触发停止条件" },
  { key: "verified", label: "验证通过层", meaning: "流程完成层成立，且系统定义的验证入口全部通过" },
  { key: "carried", label: "交还承接层", meaning: "验证通过层成立，且结果、已验证与未验证范围、残留风险与待决事项已交还" },
]);

export function declareHandoverLayer(input = {}) {
  const flow = input.flowComplete === true;
  const verified = input.verificationPassed === true;
  const carried = input.handoverCarried === true;
  const insufficient = input.coverageInsufficient === true;

  if (verified && !flow) {
    return fail(
      "handover/layer_skipped",
      "03 §5.5：验证通过层以流程完成层成立为前提，不得跳层声明",
    );
  }
  if (carried && !verified) {
    return fail(
      "handover/layer_skipped",
      "03 §5.5：交还承接层以验证通过层成立为前提，不得跳层声明",
    );
  }

  const ceiling = insufficient ? "flow" : (carried ? "carried" : (verified ? "verified" : "flow"));
  const reachedIndex = HANDOVER_LAYERS.findIndex((layer) => layer.key === ceiling);

  return {
    ok: true,
    reached: HANDOVER_LAYERS[reachedIndex].label,
    status: verified && !insufficient ? (carried ? "carried" : "verified") : "partial/unverified",
    layers: HANDOVER_LAYERS.slice(0, reachedIndex + 1).map((layer) => layer.label),
    provesValue: false,
    staticExistenceSuffices: false,
  };
}


export const STOP_CONDITIONS = Object.freeze([
  { key: "identificationFailed", label: "识别失败" },
  { key: "conflictIrreconcilable", label: "约束冲突无法调和" },
  { key: "uncertaintyMayChangePermission", label: "不确定项可能改变行动是否被允许" },
]);

export function checkExit(input = {}) {
  const threeWayDone = input.threeWayJudgementComplete === true;
  const recordGenerated = input.recordGenerated === true;
  const stops = STOP_CONDITIONS.filter((c) => input[c.key] === true);
  const zeroHitExit = input.zeroHitExit === true;
  const recallCompleteness = typeof input.recallCompleteness === "string" ? input.recallCompleteness : null;

  if (stops.length > 0) {
    return {
      ok: true,
      mayExit: false,
      mustStopAndHandover: true,
      stoppedBy: stops.map((c) => c.label),
      reason: "34 §6：出现停止情形时不退出而是停止交还（§12、§16）",
      ownershipUnchanged: true,
    };
  }
  if (recallCompleteness === "unavailable") {
    return {
      ok: true,
      mayExit: false,
      mustStopAndHandover: true,
      stoppedBy: [],
      reason: "34 §6／§12／§16.1 第 7 项：召回 unavailable（至少一源不可读且未取得任何候选）时「未命中」不构成「无相关」的证据，任何退出都属零命中退出路径，须停止交还",
      ownershipUnchanged: true,
    };
  }
  const zeroHitInferred =
    zeroHitExit || (typeof input.recallReturnedCount === "number" && input.recallReturnedCount === 0);
  if (zeroHitInferred && recallCompleteness !== "complete") {
    const incomplete = recallCompleteness === "partial" || recallCompleteness === "unavailable";
    return {
      ok: true,
      mayExit: false,
      mustStopAndHandover: incomplete,
      stoppedBy: [],
      reason: incomplete
        ? `34 §6／§16.1 第 7 项：召回未完成（${recallCompleteness}）时「未命中」不构成「无相关」的证据，不得走零命中退出路径；按 03 §8.1 缩小范围继续或停止交还`
        : "34 §6：零命中退出路径须如实提供 recallCompleteness=complete；未提供时不得视同完整（fail-closed）",
      ownershipUnchanged: true,
    };
  }
  if (!threeWayDone || !recordGenerated) {
    const missing = [];
    if (!threeWayDone) missing.push("三段判断完成");
    if (!recordGenerated) missing.push("生成预检落实记录");
    return {
      ok: true,
      mayExit: false,
      mustStopAndHandover: false,
      stoppedBy: [],
      missing,
      reason: `34 §6：退出以「${missing.join(" 且 ")}」为前提，条件未齐不得退出`,
      ownershipUnchanged: true,
    };
  }
  return {
    ok: true,
    mayExit: true,
    mustStopAndHandover: false,
    stoppedBy: [],
    reason: "三段判断完成且记录已生成，可退出并转由行动本身承接",
    ownershipUnchanged: true,
  };
}

const LAZY_RECHECK_TERMS = Object.freeze([
  "上次已确认", "上次已检查", "之前已确认", "此前已确认", "沿用上次", "同上次", "上次预检过",
]);

export function checkReuseBasis(input = {}) {
  if (!isNonEmptyString(input.recordSessionId) || !isNonEmptyString(input.sessionId)) {
    return fail("invalid_request", "recordSessionId and sessionId are required");
  }
  const basis = isNonEmptyString(input.basis) ? input.basis.trim() : "";
  if (input.recordSessionId !== input.sessionId) {
    return {
      ok: true,
      reusable: false,
      failed: ["跨会话：§6 明文作用范围限于当次行动，不延续到后续行动"],
      lazyClaim: null,
    };
  }
  const haystack = `${basis} ${input.note ?? ""}`;
  const lazy = LAZY_RECHECK_TERMS.find((term) => haystack.includes(term));
  if (lazy !== undefined) {
    return {
      ok: true,
      reusable: false,
      failed: [`34 §6：不得以「${lazy}」代替本次判断`],
      lazyClaim: lazy,
    };
  }
  if (basis === "") {
    return {
      ok: true,
      reusable: false,
      failed: ["34 §6：复用须有可回指的依据，未给出即不得复用"],
      lazyClaim: null,
    };
  }
  return { ok: true, reusable: true, failed: [], lazyClaim: null, basis };
}


export const STOP_RULES = Object.freeze([
  { index: 1, key: "applicabilityUndetermined", specRef: "rule-compliance-verification 的 stop 条目（第 1 条）" },
  { index: 2, key: "claimsComplianceWithoutChange", specRef: "rule-compliance-verification 的 stop 条目（第 2 条）" },
  { index: 3, key: "subsequentActionBuildsOnDeviation", specRef: "rule-compliance-verification 的 stop 条目（第 3 条）" },
  { index: 4, key: "choseOneAndExecuted", specRef: "rule-compliance-verification 的 stop 条目（第 4 条）" },
  { index: 5, key: "backfillCoversGap", specRef: "rule-compliance-verification 的 stop 条目（第 5 条）" },
  { index: 6, key: "transverseMutualExemption", specRef: "rule-compliance-verification 的 stop 条目（第 6 条）" },
]);

export function checkStopConditions(input = {}) {
  const triggered = STOP_RULES.filter((rule) => input[rule.key] === true);
  return {
    ok: true,
    mustSuspend: triggered.length > 0,
    triggered: triggered.map((rule) => rule.index),
    details: triggered.map((rule) => ({ index: rule.index, specRef: rule.specRef })),
    all: STOP_RULES.map((rule) => ({ index: rule.index, specRef: rule.specRef })),
    minimumScopeOnly: true,
    provesOnlySuspension: true,
  };
}


export const SUSPENSION_ALLOWED_ACTIONS = Object.freeze([
  { key: "redoAffectedIdentification", label: "补做受影响的识别" },
  { key: "completeSourceReading", label: "补齐来源读取" },
  { key: "registerGapsAndDeviations", label: "登记缺口与偏离" },
  { key: "narrowActionScope", label: "缩小行动范围到已识别部分可支持的范围" },
]);

export function checkSuspensionAction(input = {}) {
  const forbidden = [];
  if (input.continueAffectedAction === true) forbidden.push("继续执行受影响行动");
  if (input.expandDeclaredScope === true) forbidden.push("扩大声明范围");
  if (forbidden.length > 0) {
    return {
      ok: true,
      allowed: false,
      forbidden,
      reason: `34 §16.2：暂停期间不得${forbidden.join("，也不得")}`,
    };
  }
  const action = input.action;
  const matched = SUSPENSION_ALLOWED_ACTIONS.find((a) => a.key === action);
  if (matched === undefined) {
    return {
      ok: true,
      allowed: false,
      forbidden: [],
      reason: `34 §16.2：暂停期间只允许四种动作（${SUSPENSION_ALLOWED_ACTIONS.map((a) => a.label).join("／")}），收到的动作不在其内`,
      allowedActions: SUSPENSION_ALLOWED_ACTIONS.map((a) => a.key),
    };
  }
  return { ok: true, allowed: true, forbidden: [], matched: matched.label, reason: null };
}

export function checkRecovery(input = {}) {
  if (!isNonEmptyString(input.triggerReason)) {
    return fail(
      "recovery/reason_missing",
      "34 §16.3：恢复须与触发原因对应，未给原因即不得恢复",
    );
  }
  if (input.retriggered === true) {
    return {
      ok: true,
      recovered: false,
      requiresHumanGate: true,
      reason: "34 §16.3：同一停止条件恢复后再次触发，按 00 §4.7 进入 Human Gate",
      retroactiveReliefForbidden: true,
    };
  }
  return {
    ok: true,
    recovered: true,
    requiresHumanGate: false,
    reason: "触发原因已给出，且未再次触发；恢复只覆盖当前识别依据支持的范围",
    retroactiveReliefForbidden: true,
  };
}

export { join };
