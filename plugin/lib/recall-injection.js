
import {
  BASELINE_YIELD_BELOW_BYTES,
  INJECTION_EXCLUDED_TYPES,
  PITFALL_ON_DEMAND_ENTRYPOINT,
  RECALL_LIMIT_MAX,
  RENDER_FIXED_OVERHEAD_BYTES,
  baselineOnlyForAction,
  recallForAction,
} from "./source-recall.js";

export const RECALL_SUMMARY = "双源召回 · dsh-ldvh · 行动前候选";

export function renderStructuralTag(structural) {
  if (structural === null || typeof structural !== "object") return "";
  const parts = [];
  for (const [key, value] of Object.entries(structural)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") {
      if (value === true) parts.push(`${key}=已批准`);
      continue;
    }
    parts.push(Array.isArray(value) ? `${key}=${value.join("|")}` : `${key}=${value}`);
  }
  return parts.length === 0 ? "" : ` · ${parts.join(" / ")}`;
}


export const MIN_HITS = 1;

export const DECISION_KEYS = Object.freeze([
  "candidateCount",
  "residentIndexPresent",
]);

function residentIndexPresentOf(l0Enumeration) {
  const segmentsShown = Array.isArray(l0Enumeration?.segments)
    && l0Enumeration.segments.some((segment) => segment?.yielded !== true
      && Array.isArray(segment?.lines) && segment.lines.length > 0);
  const pitfallPresent = Number.isInteger(l0Enumeration?.pitfallTotal) && l0Enumeration.pitfallTotal > 0;
  return segmentsShown || pitfallPresent;
}

export function decideInjection(input) {
  const count = Number.isFinite(input?.candidateCount) ? input.candidateCount : 0;
  const residentIndexPresent = input?.residentIndexPresent === true;
  return count >= MIN_HITS || residentIndexPresent;
}

export const RECALL_BYTE_BUDGET = 2400;

export const RUNTIME_CARRIER_INJECTION_MAX = 3;

export const RUNTIME_CARRIER_INJECTION_BYTES = 1400;

export const RUNTIME_CARRIER_INJECTION_HEADER = "运行时机制：";

export const FACT_SECTION_ORDER = Object.freeze([
  "norm", "pitfall", "friction", "report",
]);

export const FACT_SECTION_LABELS = Object.freeze({
  norm: "Norm（事实规范）",
  pitfall: "Pitfall（踩坑经验）",
  friction: "Friction（摩擦账本）",
  report: "报告（调研／总结／审核）",
});

export const QUOTA_BY_TYPE = Object.freeze({
  norm: 1,
  pitfall: 2,
  friction: 1,
  report: 1,
});

export const FACT_QUOTA_TOTAL = 3;


export const DISCIPLINE_LINE_MIN_BYTES = 2000;

export const FALLBACK_LINE_MIN_BYTES = 3600;

export const PITFALL_ON_DEMAND_MIN_BYTES = 2000;

export function renderPitfallOnDemandLine(pitfallTotal) {
  if (!Number.isInteger(pitfallTotal)) return null;
  if (pitfallTotal > 0) {
    return `【经验 · active Pitfall（25 §12 按需索引）】共 ${pitfallTotal} 条，取全量用 ${PITFALL_ON_DEMAND_ENTRYPOINT}。本行只报有与去取之处，不证明适用，也未逐条检查。`;
  }
  return "【经验 · active Pitfall（25 §12 按需索引）】本项目当前无 active 经验（0 条）。";
}

function budgetAllowsOnDemandLine(limitBytes) {
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) return true;
  return limitBytes >= PITFALL_ON_DEMAND_MIN_BYTES;
}

export const BYTES_PER_CHAR_CONSERVATIVE = 2.0;

export const RECALL_RENDER_CHAR_LIMIT = 1600;

export function renderCharLimitFor(budgetBytes) {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) return RECALL_RENDER_CHAR_LIMIT;
  return Math.floor(budgetBytes / BYTES_PER_CHAR_CONSERVATIVE);
}

const WRITE_ACTIONS = Object.freeze([
  "改", "修改", "写入", "写", "新增", "增加", "加", "删除", "删", "移除", "重命名", "改名",
  "创建", "建", "建立", "提交", "commit", "push", "合并", "merge", "回滚", "revert",
  "安装", "卸载", "升级", "配置", "部署", "发布", "迁移", "更新", "修正", "重写", "重构",
  "设置", "调整", "替换", "覆盖", "清空", "落盘", "保存", "生成", "起草", "实现", "修复",
]);

const READ_ACTIONS = Object.freeze([
  "看", "看看", "读", "读一下", "查", "查看", "查询", "列", "列出", "列一下", "找", "找出",
  "搜", "搜索", "检索", "统计", "数一下", "有几", "多少", "是什么", "有哪些",
  "告诉我", "show", "list", "read", "find", "search", "grep", "cat",
]);

export const ENTRY_VERDICTS = Object.freeze(["enter", "exclude", "uncertain"]);

export function classifyEntry(text) {
  if (typeof text !== "string") return "uncertain";
  if (text.trim() === "") return "exclude";
  const normalized = text.toLowerCase();

  const isRead = READ_ACTIONS.some((word) => normalized.includes(word.toLowerCase()));
  const isWrite = WRITE_ACTIONS.some((word) => normalized.includes(word.toLowerCase()));
  if (isWrite) return "enter";
  if (isRead) return "exclude";

  const meaningful = text.replace(/[\s\p{P}\p{S}]/gu, "");
  if (meaningful.length < 3) return "exclude";
  return "uncertain";
}

export function shouldRecall(text) {
  const verdict = classifyEntry(text);
  return verdict === "enter" || verdict === "uncertain";
}

export function enterFactConsumption(text) {
  return shouldRecall(text);
}

export const HOST_CONTEXT_SOURCE_KINDS = Object.freeze([
  "time-context",
  "runtime-context",
  "skill-catalog",
  "agent-instructions",
  "compact-checkpoint",
]);

export const USER_SOURCE_KIND = "user";

export function isUserInputSource(source) {
  if (source === null || typeof source !== "object") {
    return true;
  }
  const kind = source.kind;
  if (typeof kind !== "string" || kind === "") {
    return true;
  }
  return kind === USER_SOURCE_KIND;
}

export function currentUserText(messages, isOwnMessage) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message === null || typeof message !== "object") continue;
    if (message.role !== "user") continue;
    if (typeof isOwnMessage === "function" && isOwnMessage(message)) continue;
    if (!isUserInputSource(message.source)) continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((part) => part !== null && typeof part === "object" && part.type === "text")
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text !== "") return text;
  }
  return "";
}

function appendRuntimeCarrierIndex(lines, result, limitBytes, charLimit) {
  const candidates = Array.isArray(result?.runtimeCarriers?.candidates)
    ? result.runtimeCarriers.candidates
    : [];
  if (candidates.length === 0) return;
  if (lines.some((line) => line.startsWith("（**本次注入"))) return;
  const total = Number.isInteger(result?.runtimeCarriers?.counts?.hits)
    ? result.runtimeCarriers.counts.hits
    : candidates.length;
  const sectionBudgetBytes = Math.min(
    RUNTIME_CARRIER_INJECTION_BYTES,
    limitBytes === null ? RUNTIME_CARRIER_INJECTION_BYTES : Math.floor(limitBytes / 3),
  );
  const fits = (text) => {
    const probe = [...lines, text].join("\n");
    if (limitBytes !== null && limitBytes > 0 && Buffer.byteLength(probe, "utf8") > limitBytes) return false;
    if (limitBytes !== null && limitBytes > 0 && probe.length > charLimit) return false;
    return true;
  };
  const rows = [];
  for (const carrier of candidates.slice(0, RUNTIME_CARRIER_INJECTION_MAX)) {
    const positioning = typeof carrier.positioning === "string" ? carrier.positioning : "";
    const scope = typeof carrier.scope === "string" ? carrier.scope : "";
    const row = `- 载体条目：${carrier.title}（spec_key=${carrier.specKey}；${carrier.canonicalPath}）— ${positioning}；何时查阅：${scope}`;
    if (Buffer.byteLength(row, "utf8") + 1 > sectionBudgetBytes) break;
    const probe = [...lines, RUNTIME_CARRIER_INJECTION_HEADER, ...rows, row].join("\n");
    const probeBytes = Buffer.byteLength(probe, "utf8") + Buffer.byteLength(RUNTIME_CARRIER_INJECTION_HEADER, "utf8");
    if (limitBytes !== null && limitBytes > 0 && probe.length > charLimit) break;
    if (limitBytes !== null && limitBytes > 0 && probeBytes > limitBytes) break;
    rows.push(row);
  }
  if (rows.length === 0) {
    const compact = `（运行时机制索引让位：${total} 份相关载体，正文按 canonical_path 按需读取。）`;
    if (fits(compact)) lines.push(compact);
    return;
  }
  const omitted = total - rows.length;
  const basis = omitted > 0
    ? `（索引：只给定位，不含条目正文；按词面相关度取前 ${rows.length} 份，共 ${total} 份命中，未列出者不代表不存在；正文按 canonical_path 按需读取。）`
    : "（索引：只给定位，不含条目正文；正文按 canonical_path 按需读取。本段不证明适用。）";
  const header = RUNTIME_CARRIER_INJECTION_HEADER;
  if (!fits([header, ...rows, basis].join("\n"))) {
    const compact = `（运行时机制索引让位：${total} 份相关载体，正文按 canonical_path 按需读取。）`;
    if (rows.length === 1 && fits(compact)) {
      lines.push(compact);
      return;
    }
    rows.pop();
  }
  lines.push(header);
  lines.push(...rows);
  lines.push(basis);
}

export function renderBaselineOnlyRow({ l0Enumeration = null, why, limitBytes = null } = {}) {
  const l0Segments = Array.isArray(l0Enumeration?.segments) ? l0Enumeration.segments : [];
  const lines = [];
  lines.push("【双源召回 · 行动前候选】");
  lines.push(`（本轮无词法候选：${why}。以下只有**经验按需入口**——事实规范的常驻目录**独立成行注入**（标签「事实规范目录」），不在本行内，故本行不重复它。索引只证明「有这些」，不证明适用。）`);
  for (const segment of l0Segments) {
    if (segment?.yielded === true || !Array.isArray(segment?.lines) || segment.lines.length === 0) continue;
    lines.push(...segment.lines);
  }
  const onDemandPitfall = String(renderPitfallOnDemandLine(l0Enumeration?.pitfallTotal) ?? "");
  if (onDemandPitfall !== "" && budgetAllowsOnDemandLine(limitBytes)) {
    lines.push(onDemandPitfall);
  }
  return lines.join("\n");
}

export function renderRecallRow(result) {
  const specs = Array.isArray(result?.specs) ? result.specs : [];
  const facts = Array.isArray(result?.facts) ? result.facts : [];
  const scopeExcludedInfo = result?.uncheckedRange?.scopeExcluded;
  const scopeExcludedTypes =
    scopeExcludedInfo && Array.isArray(scopeExcludedInfo.types) ? scopeExcludedInfo.types : [];
  const lines = [];
  lines.push("【双源召回 · 行动前候选】");
  const USAGE_HINT = "用法（34 §8.2）：逐条判适用；改变须写明依据来自哪一条，确认不改变须说明为何";
  lines.push("以下由确定性匹配取得，是**候选**不是结论：命中不等于适用（02 §9.2／34 §13）；**未命中也不代表无相关**；**常驻列出者同样不证明适用**。是否适用须自行判断。");
  const usageLine = `（${USAGE_HINT}）`;
  const usageIndex = usageLine === "" ? -1 : lines.push(usageLine) - 1;
  let usageYielded = false;
  let specGuideLine = null;
  if (facts.length > 0 && result?.limitations?.lexicalOnly === true) {
    const blameLine = "（**能力边界**：字面词法匹配，换个说法就会漏——尤其症状与机制表述常不重合，**未命中不代表没有同类教训**，查故障时请自行按机制检索。）";
    const fallbackLine = "（**取不到不等于没有**：事实侧按类型枚举用 ldvh_pitfall_list／ldvh_norm_list 等、精读用对应 ldvh_*_read；**规范侧用 ldvh_read_specification_candidates／ldvh_read_specification_content**；按字面搜载体可用 grep。本行只给路径，不承诺命中。）";
    const hasFallbackRoom = !(typeof result?.budget?.limitBytes === "number"
      && result.budget.limitBytes > 0
      && result.budget.limitBytes < FALLBACK_LINE_MIN_BYTES);
    lines.push(blameLine);
    if (hasFallbackRoom) lines.push(fallbackLine);
  }
  const budgetLimit =
    typeof result?.budget?.limitBytes === "number" ? result.budget.limitBytes : null;
  const l0Enumeration = result?.l0Enumeration ?? null;
  const l0YieldedSegments = Array.isArray(l0Enumeration?.segments)
    ? l0Enumeration.segments.filter((segment) => segment?.yielded === true && Number.isInteger(segment?.total) && segment.total > 0)
    : [];
  const l0Verbose = budgetLimit === null || budgetLimit >= 1600;
  const l0YieldHint = l0Verbose
    ? l0YieldedSegments
      .map((segment) => `${segment.type === "norm" ? "事实规范" : segment.type === "pitfall" ? "经验" : segment.type} ${segment.total} 条`)
      .join("、")
    : "事实规范与经验 L0";
  const yieldHintOf = ({ l0 }) => {
    if (!l0) return "";
    const parts = [l0Verbose ? `${l0YieldHint}未展开` : l0YieldHint];
    const basis = "23 §10／25 §12";
    const entries = l0Verbose ? "，ldvh_norm_list／ldvh_pitfall_list" : "";
    return `；${parts.join("、")}（${basis}${entries}）`;
  };
  let yieldNoteEmitted = false;
  const compactYieldSuffix = yieldHintOf({ l0: l0YieldedSegments.length > 0 });
  const withYieldNote = (text) => {
    if (l0YieldedSegments.length === 0 || yieldNoteEmitted) return text;
    yieldNoteEmitted = true;
    const suffix = yieldHintOf({ l0: true });
    return text.endsWith("）") ? `${text.slice(0, -1)}${suffix}）` : `${text}${suffix}`;
  };
  for (const segment of Array.isArray(l0Enumeration?.segments) ? l0Enumeration.segments : []) {
    if (segment?.yielded === true || !Array.isArray(segment?.lines) || segment.lines.length === 0) continue;
    lines.push(...segment.lines);
  }
  const onDemandLine = renderPitfallOnDemandLine(l0Enumeration?.pitfallTotal);
  if (onDemandLine !== null && budgetAllowsOnDemandLine(result?.budget?.limitBytes ?? null)) {
    lines.push(onDemandLine);
  }
  if (l0Enumeration?.sourceUnreadable === true) {
    lines.push("（事实规范与经验两段的常驻索引未取得——事实源不可读，**不表示本项目没有这两类对象**（34 §12）。）");
  }
  if (specs.length > 0) {
    const sourceView = result?.sourceView;
    if (sourceView?.specsAreProjectAuthored === false) {
      const tierLabel =
        sourceView.specs?.tier === "source-repo" ? "插件源仓库" :
        sourceView.specs?.tier === "package" ? "插件包内副本" : "外部来源";
      lines.push(
        `规范源（语料来自**${tierLabel}**，非本项目自著；其成员条件核对归源仓库。` +
          `下列相对路径在本项目根下**读不到**，须用绝对路径读取）：`,
      );
    } else {
      lines.push("规范源：");
    }
    const fullGuide =
      "（spec_key 是 L4 全文入口，未定位章节；需 L3 时先调 ldvh_read_specification_candidates(layer=L2) " +
      "取 section_outline 的逐字 H2/H3，原样作 heading_path 调 ldvh_read_specification_content——勿猜标题。）";
    const compactGuide = "（spec_key 为 L4 入口；需 L3 章节先取 L2 的 section_outline 逐字标题作 heading_path，勿猜标题。）";
    const guideBudget = typeof result?.budget?.limitBytes === "number" && result.budget.limitBytes > 0
      ? result.budget.limitBytes
      : null;
    const guideWouldOverflow = (candidate) => {
      if (guideBudget === null) return false;
      return Buffer.byteLength([...lines, candidate].join("\n"), "utf8") + 300 > guideBudget;
    };
    specGuideLine = guideWouldOverflow(fullGuide) ? compactGuide : fullGuide;
    lines.push(specGuideLine);
    const preferAbsolute = result?.sourceView?.specsAreProjectAuthored === false;
    for (const spec of specs) {
      const shown = preferAbsolute && typeof spec.absolutePath === "string" ? spec.absolutePath : spec.path;
      const stable = typeof spec.specKey === "string" && spec.specKey !== ""
        ? `；spec_key=${spec.specKey}（L4 全文入口）`
        : "；无稳定 spec_key（只能按路径读取）";
      lines.push(`- ${spec.title} — ${spec.hitReason}（${shown}${stable}）`);
    }
  }
  if (facts.length > 0) {
    const labelOf = (type) => FACT_SECTION_LABELS[type] ?? (type === "" ? "未标注类型" : type);
    const sectionOf = new Map();
    for (const fact of facts) {
      const type = typeof fact?.type === "string" ? fact.type : "";
      if (!sectionOf.has(type)) sectionOf.set(type, []);
      sectionOf.get(type).push(fact);
    }
    const orderedTypes = [
      ...FACT_SECTION_ORDER.filter((type) => sectionOf.has(type)),
      ...[...sectionOf.keys()].filter((type) => !FACT_SECTION_ORDER.includes(type)),
    ];
    const singleSection = orderedTypes.length === 1;
    for (const type of orderedTypes) {
      lines.push(singleSection ? "事实源：" : `事实源 · ${labelOf(type)}：`);
      for (const fact of sectionOf.get(type)) {
        const status = typeof fact.status === "string" && fact.status !== "" ? `/${fact.status}` : "";
        const excerpt = typeof fact.excerpt === "string" && fact.excerpt !== "" ? `\n  ↳ ${fact.excerpt}` : "";
        const structural = renderStructuralTag(fact.structural);
        const stableUid = typeof fact.objectUid === "string" && fact.objectUid !== ""
          ? ` · uid=${fact.objectUid}`
          : " · uid=缺失（该载体未声明 object_uid）";
        lines.push(
          `- [${fact.type}${status}] ${fact.title}${structural} — ${fact.hitReason}（${fact.path}）${stableUid}${excerpt}`,
        );
      }
    }
    const droppedByQuota = result?.sectioning?.droppedByQuota ?? [];
    const droppedByTotal = result?.sectioning?.droppedByTotal ?? [];
    const unassignedByType = result?.sectioning?.unassignedByType ?? [];
    const unassignedTotal = result?.sectioning?.unassigned ?? 0;
    if (droppedByQuota.length > 0 || droppedByTotal.length > 0 || unassignedTotal > 0) {
      const describe = (list) => list
        .map((entry) => `${entry.type} ${entry.count}`)
        .join("、");
      const parts = [];
      if (droppedByTotal.length > 0) parts.push(`总名额 ${result?.sectioning?.total ?? "?"} 条裁去 ${describe(droppedByTotal)}`);
      if (droppedByQuota.length > 0) parts.push(`类型名额裁去 ${describe(droppedByQuota)}`);
      if (unassignedTotal > 0 && unassignedByType.length > 0) {
        parts.push(
          `另有 ${unassignedTotal} 条无分节认领（${describe(unassignedByType)}，`
          + "调大 limit 也取不到，须另行主动查询）",
        );
      }
      lines.push(
        `（分节名额省略：${parts.join("；")}。次序为交付组织，非相关性排序；被省略者仍可另行查询。）`,
      );
    }
  }
  const relationExpansions = Array.isArray(result?.relationExpansions) ? result.relationExpansions : [];
  if (relationExpansions.length > 0) {
    lines.push("关系展开（精确引用派生；不占候选名额）：");
    for (const item of relationExpansions) {
      const target = item.resolved === false
        ? `${item.ref}（未解析${typeof item.unresolvedReason === "string" ? `：${item.unresolvedReason}` : ""}）`
        : `[${item.type}] ${item.title}（${item.path}）`;
      lines.push(`- ${item.hitReason} → ${target}`);
    }
  }

  if (specs.length === 0 && facts.length === 0
    && (result?.runtimeCarriers?.candidates?.length ?? 0) === 0) {
    const scopeHint = scopeExcludedTypes.length > 0
      ? `本路径不扫描 ${scopeExcludedTypes.join("、")}，扩大检索也取不到它们——须另行查询（见下一行的入口）。`
      : "必要时请自行扩大检索。";
    lines.push(`本次未命中候选。这不证明「无相关约束」——确定性匹配会漏（换个说法就漏）。${scopeHint}`);
  }
  const droppedTotal =
    (result?.unchecked?.specs?.length ?? 0) + (result?.unchecked?.facts?.length ?? 0);
  if (
    result?.partial === true &&
    droppedTotal > 0 &&
    result?.overBudget !== true &&
    result?.truncated !== true
  ) {
    const names = [
      ...(result.unchecked.specs ?? []).map((s) => `规范「${s.title}」`),
      ...(result.unchecked.facts ?? []).map((f) => `事实「${f.title}」`),
    ].slice(0, 3);
    lines.push(
      `（本次为 **partial**：另有 ${droppedTotal} 条候选未列出（${names.join("、")}${droppedTotal > 3 ? " 等" : ""}）。` +
        `未列出只表示排得靠后，**不代表不相关**——需要时请调大 limit 或缩小动作范围。）`,
    );
  }
  if (result?.truncated === true) {
    const usedBytes = result.budget?.usedBytes ?? 0;
    const limitBytes = result.budget?.limitBytes ?? 0;
    const remaining = limitBytes - RENDER_FIXED_OVERHEAD_BYTES - usedBytes;
    const estimateLineBytes = (item) => {
      const title = typeof item?.title === "string" ? item.title : "";
      const reason = typeof item?.hitReason === "string" ? item.hitReason : "";
      const path = typeof item?.path === "string" ? item.path : "";
      const excerpt = typeof item?.excerpt === "string" ? item.excerpt : "";
      const stable = typeof item?.objectUid === "string" && item.objectUid !== ""
        ? ` · uid=${item.objectUid}`
        : (typeof item?.specKey === "string" && item.specKey !== "" ? ` · key=${item.specKey}` : "");
      return Buffer.byteLength(`${title}${reason}${path}${excerpt}${stable}`, "utf8") + 8;
    };
    const nextDropped = result.unchecked?.specs?.[0] ?? result.unchecked?.facts?.[0];
    const nextSize = nextDropped === undefined ? 0 : estimateLineBytes(nextDropped);
    const oneSourceEmpty =
      ((result.counts?.factHits ?? 0) > 0 && (result.counts?.factsReturned ?? 0) === 0) ||
      ((result.counts?.specHits ?? 0) > 0 && (result.counts?.specsReturned ?? 0) === 0);
    const blockedByBudget =
      result.overBudget === true ||
      (oneSourceEmpty && (result.counts?.specHits ?? 0) > 0) ||
      remaining < Math.max(nextSize, 200);
    if (result.overBudget === true) {
      if (compactYieldSuffix !== "") {
        yieldNoteEmitted = true;
        lines.push(`（预算极小（上限 ${limitBytes} 字节）：保底首项（候选行 ${usedBytes} 字节）${compactYieldSuffix}。未列出不代表不存在。）`);
      } else {
        lines.push(`（预算极小（上限 ${limitBytes} 字节）已超额，仅保底首项（候选行 ${usedBytes} 字节）。**未列出的部分不代表不存在**，需要时请扩大检索。）`);
      }
    } else if (blockedByBudget) {
      if (compactYieldSuffix !== "") {
        yieldNoteEmitted = true;
        lines.push(`（受预算限制已裁剪：上限 ${limitBytes} 字节、数据层估算用 ${usedBytes} 字节${compactYieldSuffix}。未列出不代表不存在。）`);
      } else {
        lines.push(`（受预算限制已裁剪：上限 ${limitBytes} 字节，数据层估算用 ${usedBytes} 字节。未列出的部分不代表不存在。）`);
      }
    } else {
      const specHitsN = result.counts?.specHits ?? 0;
      const factHitsN = result.counts?.factHits ?? 0;
      const specShownN = result.specs?.length ?? 0;
      const factShownN = result.facts?.length ?? 0;
      const limitN = result.budget?.limit;
      const atCeiling = Number.isInteger(limitN) && limitN >= RECALL_LIMIT_MAX;
      const moreHint = atCeiling
        ? `每侧 ${RECALL_LIMIT_MAX} 已是本实现的条数上限（RECALL_LIMIT_MAX），要更全请缩小动作范围或分次查询。`
        : `调大 limit 可看到更多（当前每侧 ${limitN ?? "?"}）。`;
      lines.push(withYieldNote(
        `（受条数上限（每侧 limit=${limitN ?? "?"}）限制：规范源命中 ${specHitsN} 条、列出 ${specShownN} 条；`
        + `事实源命中 ${factHitsN} 条、列出 ${factShownN} 条。数据层预算尚有余量（候选行估算 ${usedBytes}/${limitBytes} 字节）。`
        + `未返回的部分不代表不存在；${moreHint}）`,
      ));
    }
  }
  const scopeExcluded = scopeExcludedInfo;
  if (scopeExcluded && Array.isArray(scopeExcluded.types) && scopeExcluded.types.length > 0) {
    const entryByType = scopeExcluded.entryByType ?? {};
    const entries = scopeExcluded.types
      .map((type) => entryByType[type])
      .filter((name) => typeof name === "string" && name !== "");
    const fullLine = entries.length > 0
      ? `（不含 ${scopeExcluded.types.join("、")}；查 ${[...new Set(entries)].join("、")}）`
      : `（不含 ${scopeExcluded.types.join("、")}；须另行查询）`;
    const compactLine = entries.length > 0
      ? `（不含 ${scopeExcluded.types.join("/")}；ldvh_*_list）`
      : `（不含 ${scopeExcluded.types.join("/")}；须另行查询）`;
    const FIXED_TAIL_RESERVE_BYTES = 300;
    const budgetForScope = typeof result?.budget?.limitBytes === "number" && result.budget.limitBytes > 0
      ? result.budget.limitBytes
      : null;
    const wouldOverflow = (candidate) => {
      if (budgetForScope === null) return false;
      const probe = [...lines, candidate].join("\n");
      return Buffer.byteLength(probe, "utf8") + FIXED_TAIL_RESERVE_BYTES > budgetForScope;
    };
    lines.push(wouldOverflow(fullLine) ? compactLine : fullLine);
  }
  const completenessAtDataLayer = result?.recallCompleteness;
  const completeness = completenessAtDataLayer;
  if (completeness === "partial" || completeness === "unavailable") {
    const notRead = Array.isArray(result?.uncheckedRange?.sourceNotRead)
      ? result.uncheckedRange.sourceNotRead
      : [];
    const ur = result?.uncheckedRange;
    const filterParts = [];
    if (Array.isArray(ur?.excludedByTypeFilter) && ur.excludedByTypeFilter.length > 0) {
      filterParts.push(`${ur.excludedByTypeFilter.length} 条被类型过滤`);
    }
    if (Array.isArray(ur?.excludedByStatus) && ur.excludedByStatus.length > 0) {
      filterParts.push(`${ur.excludedByStatus.length} 条被状态过滤`);
    }
    if (Array.isArray(ur?.excludedByTypeWhitelist) && ur.excludedByTypeWhitelist.length > 0) {
      filterParts.push(`${ur.excludedByTypeWhitelist.length} 条未登记类型不参与`);
    }
    const filteredNote = filterParts.length > 0 ? `；另 ${filterParts.join("、")}` : "";
    const cbLimitBytes = typeof result?.budget?.limitBytes === "number" ? result.budget.limitBytes : null;
    const tightBudget = cbLimitBytes !== null && cbLimitBytes > 0 && cbLimitBytes <= 1200;
    const completenessTail = completeness === "unavailable"
      ? "**「未命中」不构成「无相关」的证据**（34 §12），不得据此按零命中路径继续（§16.1 第 7 项）。"
      : tightBudget
        ? "未列出的不代表不存在（34 §12）。"
        : "未取得的部分不代表不存在；「未命中」不构成「无相关」的证据（34 §12）。";
    lines.push(withYieldNote(
      `（本次召回完整度：**${completeness}**${notRead.length > 0 ? `；未读取的源：${notRead.join("；")}` : ""}${filteredNote}。` +
        completenessTail +
        "）",
    ));
  }
  const limitBytes = typeof result?.budget?.limitBytes === "number" ? result.budget.limitBytes : null;
  const NOTE_RESERVE_CHARS = 120;
  const NOTE_RESERVE_BYTES = 280;
  const charLimit = renderCharLimitFor(limitBytes);
  const trimmed = [...lines];
  const joined = () => trimmed.join("\n");
  const overChars = () => joined().length > charLimit - NOTE_RESERVE_CHARS;
  const overBytes = () =>
    limitBytes !== null && limitBytes > 0 &&
    Buffer.byteLength(joined(), "utf8") + NOTE_RESERVE_BYTES > limitBytes;
  let droppedByRender = 0;
  let charTriggered = false;
  let byteTriggered = false;
  const findDeletable = () => {
    const factIdx = [];
    for (let i = 0; i < trimmed.length; i += 1) {
      if (trimmed[i].startsWith("- [")) factIdx.push(i);
    }
    const protectedIdx = factIdx.length === 1 ? factIdx[0] : -1;
    for (let i = trimmed.length - 1; i >= 0; i -= 1) {
      if (i === protectedIdx) continue;
      if (trimmed[i].startsWith("- ")) return i;
    }
    return protectedIdx;
  };
  while (overChars() || overBytes()) {
    if (overChars()) charTriggered = true;
    if (overBytes()) byteTriggered = true;
    const idx = findDeletable();
    if (idx === -1) break;
    trimmed.splice(idx, 1);
    droppedByRender += 1;
  }
  const renderedFactRows = () => trimmed.filter((line) => line.startsWith("- [")).length;
  if (renderedFactRows() === 0) {
    const quotaLine = trimmed.findIndex((line) => line.startsWith("（分节名额省略："));
    if (quotaLine !== -1) trimmed.splice(quotaLine, 1);
  }
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    if (!/^(?:事实源(?: · .+)?|规范源(?:（.*）)?|运行时机制：)$/.test(trimmed[i])) continue;
    let hasCandidateBelow = false;
    for (let j = i + 1; j < trimmed.length; j += 1) {
      if (trimmed[j].startsWith("- ")) { hasCandidateBelow = true; break; }
      if (!trimmed[j].startsWith("（")) break;
    }
    if (hasCandidateBelow) continue;
    trimmed.splice(i, 1);
  }
  if (usageIndex !== -1) {
    const overNow = () => limitBytes !== null && limitBytes > 0
      && Buffer.byteLength(trimmed.join("\n"), "utf8") + NOTE_RESERVE_BYTES > limitBytes;
    const candidateCount = () => trimmed.filter((line) => line.startsWith("- ")).length;
    if (candidateCount() === 0) {
      const at = trimmed.indexOf(usageLine);
      if (at !== -1) trimmed.splice(at, 1);
      const guideAt = specGuideLine === null ? -1 : trimmed.indexOf(specGuideLine);
      if (guideAt !== -1) trimmed.splice(guideAt, 1);
    } else {
      while (overNow() && candidateCount() > 1) {
        const idx = findDeletable();
        if (idx === -1) break;
        trimmed.splice(idx, 1);
        droppedByRender += 1;
        byteTriggered = true;
      }
      if (overNow()) {
        const at = trimmed.indexOf(usageLine);
        if (at !== -1) trimmed.splice(at, 1);
        const guideAt = specGuideLine === null ? -1 : trimmed.indexOf(specGuideLine);
        if (guideAt !== -1) trimmed.splice(guideAt, 1);
        usageYielded = true;
      }
    }
  }
  if (droppedByRender > 0 || usageYielded) {
    const reasons = [];
    if (charTriggered) reasons.push(`字符上限 ${charLimit}`);
    if (byteTriggered) reasons.push(`字节预算 ${limitBytes}，含披露行预留 ${NOTE_RESERVE_BYTES} 字节`);
    const finalCount = trimmed.filter((l) => l.startsWith("- ")).length;
    const renderDowngraded = droppedByRender > 0 && completenessAtDataLayer === "complete";
    const usageYieldNote = usageYielded
      ? "；**用法行已让位**（让到只剩一条候选仍放不下），本次未给出消费方法——须自行按 34 §8.2 判断"
      : "";
    const downgradeSuffix = renderDowngraded ? "；因此本次召回完整度按 **partial** 记（数据层未裁，渲染层未全部交付）" : "";
    const fullNote =
      `（**渲染层按硬约束（${reasons.join("／")}）裁去 ${droppedByRender} 条候选**；` +
      `现列出 ${finalCount} 条（渲染层自己的口径）${downgradeSuffix}${usageYieldNote}。` +
      `未列出的不代表不存在，需更多请缩小动作范围。）`;
    const compactReasons = [];
    if (charTriggered) compactReasons.push(`字符上限 ${renderCharLimitFor(limitBytes)}`);
    if (byteTriggered) compactReasons.push(`字节预算 ${limitBytes}`);
    const compactNote =
      `（渲染层按硬约束（${compactReasons.join("／")}）裁去 ${droppedByRender} 条候选，` +
      `现列出 ${finalCount} 条${renderDowngraded ? "，完整度按 partial 记" : ""}`
      + `${usageYielded ? "；用法行已让位，须自行按 34 §8.2 判断" : ""}；未列出的不代表不存在。）`;
    trimmed.push(fullNote);
    if (limitBytes !== null && limitBytes > 0 && Buffer.byteLength(trimmed.join("\n"), "utf8") > limitBytes) {
      trimmed[trimmed.length - 1] = compactNote;
    }
  }
  if (limitBytes !== null && limitBytes > 0) {
    const bytesNow = () => Buffer.byteLength(trimmed.join("\n"), "utf8");
    const yieldL0Segment = (headerPrefix) => {
      const startIdx = trimmed.findIndex((l) => l.startsWith(headerPrefix));
      if (startIdx === -1) return null;
      let endIdx = startIdx + 1;
      while (endIdx < trimmed.length
        && (trimmed[endIdx].startsWith("· ") || trimmed[endIdx].startsWith("  ↳ "))) endIdx += 1;
      if (endIdx < trimmed.length && trimmed[endIdx].startsWith("（本档预算仅容")) endIdx += 1;
      else if (endIdx < trimmed.length && trimmed[endIdx].startsWith("（索引")) endIdx += 1;
      while (endIdx < trimmed.length && trimmed[endIdx].startsWith("（事实规范另有")) endIdx += 1;
      const removed = endIdx - startIdx;
      trimmed.splice(startIdx, removed);
      return { startIdx, removed };
    };
    const l0TotalOf = (type) => {
      const segment = Array.isArray(l0Enumeration?.segments)
        ? l0Enumeration.segments.find((entry) => entry?.type === type)
        : null;
      return Number.isInteger(segment?.total) ? segment.total : 0;
    };
    for (const [prefix, type, label, entry] of [
      ["【经验 · active Pitfall", "pitfall", "经验", "ldvh_pitfall_list"],
      ["【事实规范 · active Norm", "norm", "事实规范", "ldvh_norm_list"],
    ]) {
      if (bytesNow() <= limitBytes) break;
      const at = yieldL0Segment(prefix);
      if (at === null) continue;
      const total = l0TotalOf(type);
      trimmed.splice(
        at.startIdx,
        0,
        `（${label} 常驻索引未展开：${total > 0 ? `${total} 条` : "本类"}，本次因字节预算 ${limitBytes} 不足未列出；用 ${entry} 取全量。）`,
      );
    }
    const finalBytes = bytesNow();
    if (finalBytes > limitBytes && limitBytes >= BASELINE_YIELD_BELOW_BYTES) {
      trimmed.push(
        `（**本次注入 ${finalBytes} 字节，超出预算 ${limitBytes} 共 ${finalBytes - limitBytes} 字节**：` +
          `固定声明与三态披露为 34 §12 披露底线不予裁剪，已让出决策基线段仍不足；` +
          `请提高预算（属 Human 决定事项）或缩短单条标题。）`,
      );
    }
  }
  appendRuntimeCarrierIndex(trimmed, result, limitBytes, charLimit);
  return trimmed.join("\n");
}

export async function buildRecallInjection({ userText, projectRoot, budgetBytes, limit } = {}) {
  if (typeof projectRoot !== "string" || projectRoot === "") {
    return { inject: false, reason: "no-project" };
  }
  if (typeof userText !== "string" || userText.trim() === "") {
    return { inject: false, reason: "no-user-text" };
  }
  if (!shouldRecall(userText)) {
    return baselineOnlyInjection({
      projectRoot,
      cause: "excluded-by-34-6",
      why: "本回合判为纯读取／纯查询，按 34 §6 不进入词法候选召回",
      limitBytes: Number.isInteger(budgetBytes) ? budgetBytes : RECALL_BYTE_BUDGET,
    });
  }
  const totalQuota = Number.isInteger(limit) && limit > 0 ? limit : FACT_QUOTA_TOTAL;
  let result;
  try {
    result = await recallForAction({
      action: userText,
      root: projectRoot,
      excludeTypes: INJECTION_EXCLUDED_TYPES,
      limit: totalQuota,
      factSelection: {
        order: FACT_SECTION_ORDER,
        quotaByType: QUOTA_BY_TYPE,
        total: totalQuota,
      },
      budgetBytes: Number.isInteger(budgetBytes) ? budgetBytes : RECALL_BYTE_BUDGET,
    });
  } catch (error) {
    return { inject: false, reason: `recall-failed:${error instanceof Error ? error.message : String(error)}` };
  }
  if (result?.ok !== true) {
    const code = result?.error?.code;
    if (code === "recall/no_tokens") {
      return baselineOnlyInjection({
        projectRoot,
        cause: "recall/no_tokens",
        why: "本回合切不出可匹配的主题词，按 34 §6 不进入词法候选召回",
        limitBytes: Number.isInteger(budgetBytes) ? budgetBytes : RECALL_BYTE_BUDGET,
      });
    }
    return { inject: false, reason: `recall-unavailable:${code ?? "unknown"}` };
  }
  const total = (result.specs?.length ?? 0) + (result.facts?.length ?? 0)
    + (result.runtimeCarriers?.candidates?.length ?? 0);
  const residentIndexHasContent = residentIndexPresentOf(result?.l0Enumeration);
  if (!decideInjection({
    candidateCount: total,
    residentIndexPresent: residentIndexHasContent,
  })) {
    return { inject: false, reason: "no-hits" };
  }
  const text = renderRecallRow(result);
  const renderChars = text.length;
  const droppedMatch = /裁去 (\d+) 条候选/.exec(text);
  const renderTruncated = droppedMatch !== null;
  result.render = {
    chars: renderChars,
    limitChars: renderCharLimitFor(result?.budget?.limitBytes ?? null),
    truncated: renderTruncated,
    droppedCandidates: renderTruncated ? Number(droppedMatch[1]) : 0,
    note: renderTruncated
      ? "渲染文本触硬约束（字符上限／字节预算）已按行裁去部分候选行；固定声明与披露行未裁；候选数据本身未因此减少，调大 limit 未必能显示更多，需先缩短标题/命中理由或提高上限（后者属 Human 决定事项，10:261）"
      : "渲染文本未触硬约束",
  };
  result.render = {
    ...result.render,
    usagePresent: text.includes("用法（34 §8.2）"),
  };
  const renderDowngraded = renderTruncated && result.recallCompleteness === "complete";
  if (renderDowngraded) {
    result.recallCompleteness = "partial";
    result.render.completenessDowngraded = true;
  }
  return { inject: true, text, digest: text, result };
}

async function baselineOnlyInjection({ projectRoot, why, cause, limitBytes = null }) {
  let baseline;
  try {
    baseline = await baselineOnlyForAction({ root: projectRoot, budgetBytes: limitBytes });
  } catch (error) {
    return { inject: false, reason: `recall-failed:${error instanceof Error ? error.message : String(error)}` };
  }
  const l0 = baseline?.l0Enumeration ?? null;
  const l0Shown = Array.isArray(l0?.segments)
    ? l0.segments.some((segment) => segment?.yielded !== true && Array.isArray(segment?.lines) && segment.lines.length > 0)
    : false;
  const pitfallTotal = l0?.pitfallTotal;
  const hasPitfall = Number.isInteger(pitfallTotal) && pitfallTotal > 0;
  const hasContent = l0Shown || hasPitfall;
  if (!hasContent) return { inject: false, reason: "no-hits" };
  const text = renderBaselineOnlyRow({ l0Enumeration: l0, why, limitBytes });
  const bytes = Buffer.byteLength(text, "utf8");
  const overBudget = typeof limitBytes === "number" && limitBytes > 0 && bytes > limitBytes;
  const result = {
    ok: true,
    l0Enumeration: l0,
    specs: [],
    facts: [],
    provesApplicability: false,
    baselineOnly: true,
    baselineOnlyCause: cause ?? null,
    baselineOnlyReason: why,
    budget: { limitBytes, usedBytes: 0, limit: 0 },
    gaps: [
      ...(baseline?.gaps ?? []),
      `本轮未做词法候选召回（${why}）；事实规范与经验的常驻索引不受该条件影响（23 §10、23 §12）。`,
    ],
  };
  result.render = {
    chars: text.length,
    limitChars: renderCharLimitFor(limitBytes),
    truncated: false,
    droppedCandidates: 0,
    note: overBudget
      ? "常驻索引行超出当次字节预算（常驻索引属 23 §10／25 §12 披露，不裁剪，如实带出）"
      : "渲染文本未触硬约束",
  };
  return { inject: true, text, digest: text, result };
}
