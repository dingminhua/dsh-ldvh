/**
 * dsh-ldvh — 闲时辅助「经验积累·审核段」的落地侧（specs/11 §10.2，6 项闭集）。
 *
 * ## 本模块是什么、不是什么
 *
 * 本模块是审核段 6 项闭集的**代码形态**：读缓冲 → 查重 → 建 draft 候选 → 精确回读
 * → 结算缓冲条目 → 不足成文则 discarded → 任一校验不可用/未通过即 fail-closed。
 * 它**只**读留观缓冲载体（`observation-buffer.js`）与既有 Pitfall 事实对象，
 * **不**创建 active、**不**升格、**不**废止（11 §10.2「审核段不得做的事」；
 * 23 §16：这三者均属 Human Gate）。
 *
 * ## 「不读实时对话」的机械形态
 *
 * **本模块不接受任何会话正文、消息、思考链或对话历史参数**。它的入口参数只有
 * 载体句柄（`dshHomePath` 路径拼装函数、`factSourceRoot`）与**调用方给出的结构化
 * 提案**（`proposals[]`）。材料只有一条通路进入：缓冲条目本身。这不是一句自律承诺
 * ——是入参闭集：`messages` / `transcript` / `history` 之类的字段在本模块无任何读取点，
 * 传进来也没有任何作用。11 §10.2「不得读实时对话、不得引用缓冲之外的任何材料」
 * 因此成为**结构上不可能违反**的约束，而不仅是运行时纪律。
 *
 * 对应地，11 §12bis「证据不留在缓冲」由本模块机械兜底：候选正文必须**逐字复制**
 * 所用的引证片段与来源标识，不得只写 `buffer:<id>`（见 `verifyEvidenceCopy`）。
 *
 * ## 七段常量为何在这里再声明一次
 *
 * 七段（症状／触发条件／根因／解决／规避／验证／影响与适用范围）取自
 * specs/23 §8 的固定正文 H2 序。**本模块不复制权威定义**——此处是本模块对七段结构
 * 的机械校验形态：审核段需要在**调用 createPitfallObject 之前**就给出可据以修正的
 * 拒绝理由（哪一段为空、哪一段引证不回指），而 `pitfall-writer` 的结构校验只在
 * 写盘路径上跑一次并整体拒绝。两者读的是同一份 23 §8 事实，本模块的常量是它的
 * 只读投影；权威校验仍在 writer 侧（`validatePitfallBodyStructure`）。
 *
 * ## 语义判断与机械校验的分界（23 §6.2 / 11 §18）
 *
 * **查重是 AI 语义判断**（对照 title 与症状／根因语义），规范明确「02 §9.2 不建立
 * 相似度自动裁决」。本模块因此**不自己裁决**：它只校验「查重已执行且对照集覆盖
 * 全部 active 与 draft」这一机械部分（`dedupe.checked` + `dedupe.compared` 覆盖
 * `existingPitfalls` 全部 uid），语义结论由调用方（AI）给出。本模块不声称查重结论
 * 正确，只声称查重**不是**在无对照集的情况下被跳过的。
 *
 * 同理，「某段依据无法回指 evidence 则该段不成立」中的**可写性**判断（材料是否
 * 足够写出某段）属材料筛选语义判断，由调用方以 `proposals[].insufficient` 声明；
 * 本模块机械兜底的是**回指**本身（每段必须逐字含缓冲 evidence 的片段）与 discarded
 * 登记理由也必须带证据。
 *
 * ## 一次运行至多形成 1 条候选（11 §10.2「每次运行上限」）
 *
 * `MAX_CANDIDATES_PER_RUN = 1` 是模块内的硬常量：**没有任何入参可以改写它**。
 * 查重命中的如实登记与 discarded 处置不计入该配额（规范明示）。配额一旦用尽，
 * 本次运行**停止全部动作**（11 §11 水位纪律：遇第一个无剩余配额可处理的合格对象
 * 即停止）；未处理的条目原样留在缓冲里、status 仍为 pending，**不静默移除**。
 *
 * ## fail-closed（11 §12 / §10.2 第 6 项）
 *
 * 校验不可用、未通过或回读不完整 → 返回 `{ok:false}`，由调用方停止该次任务、
 * 保留副作用并如实登记。**不得把部分写入当作完成**：候选已落盘但回读不符时，
 * 失败结果里仍带上 `formed`，因为副作用已经发生且必须如实登记。
 */

import {
  readBufferEntries,
  settleBufferEntry,
  BUFFER_REQUIRED_FIELDS,
} from "./observation-buffer.js";
import {
  createPitfallObject,
  readPitfallObject,
  listPitfallObjects,
} from "./pitfall-writer.js";
import { h2Titles, sectionContent } from "./markdown-structure.js";

// ---------------------------------------------------------------------------
// 常量（23 §8 的只读投影，见上方「七段常量为何在这里再声明一次」）
// ---------------------------------------------------------------------------

/** 23 §8 固定七段（正文固定 H2 序，无「证据」段——urls 为空时不出现）。 */
export const REVIEW_REQUIRED_BODY_SECTIONS = Object.freeze([
  "症状",
  "触发条件",
  "根因",
  "解决",
  "规避",
  "验证",
  "影响与适用范围",
]);

/**
 * 11 §12bis：症状／触发条件／验证三段是引证复制的主承重段
 * （「主要是症状/触发条件/验证三段」），故对这三段执行逐字复制核对。
 */
export const EVIDENCE_COPY_REQUIRED_SECTIONS = Object.freeze(["症状", "触发条件", "验证"]);

/**
 * 「逐字复制」的最小逐字长度判据。
 *
 * 取 8：短于它的公共子串在中日文正文里几乎必然是巧合（「不能」「同一个」一类），
 * 长于它则会把**真的逐字引证**也误判掉——引证片段常是一句错误信息或一行命令输出，
 * 10–40 字是常态。本判据只判定「是否共有一段逐字连续片段」，不判定引证是否切题
 * （切题是 §18 表里明写「不证明」的部分）。
 */
export const MIN_VERBATIM_FRAGMENT_LENGTH = 8;

/** 11 §10.2「每次运行至多形成 1 条候选」——固定不可调。 */
export const MAX_CANDIDATES_PER_RUN = 1;

/**
 * 23 §9 / 11 §18：以占位符或「待查明」冒充正文者拒绝创建。
 * 命中即拒绝，不做「清洗后放行」——清洗会把「承认没查明」变成「看起来填过了」。
 */
const PLACEHOLDER_PATTERNS = [
  /待查明/, /待补充/, /待确认/, /待定/, /待观察/, /暂缺/, /占位/,
  /\bTBD\b/i, /\bTODO\b/i, /\bFIXME\b/i, /\bN\/A\b/i, /\bXXX\b/,
  /\bunknown\b/i, /\bplaceholder\b/i,
];

/** 来源标识的机械形态：会话标识 / 文件:行 / 命令与输出引文（11 §12bis evidence 定义）。 */
const SOURCE_REFERENCE_PATTERNS = [
  /(?:会话|session)\s*[:：#]?\s*[A-Za-z0-9_-]{6,}/i, // 会话 id + 位置
  /[\w./\\-]+\.(?:md|txt|log|json|jsonl|mjs|cjs|js|ts|yaml|yml)(?::|：)\d+/, // 文件:行
  /(?:^|\n)\s*[$#>]\s+\S.*/m, // 命令与其输出引文
];

// ---------------------------------------------------------------------------
// 结果助手
// ---------------------------------------------------------------------------

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, ...details } };
}

function success(value) {
  return { ok: true, value };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * fail-closed 结果的统一形状：`fail_closed` 是 §12ter.2 结果契约里的第五个字段，
 * 失败时它必须带着**精确原因**而不是一个布尔。故失败路径一律带
 * `{ fail_closed: { code, message, stage, ... }, ...已发生的结算 }`。
 */
function failClosed(code, message, { stage, formed = null, duplicate = null, discarded = [], remaining_pending = null } = {}) {
  return failure(code, message, {
    stage,
    partial: { formed, duplicate, discarded, remaining_pending },
    fail_closed: { code, message, stage },
  });
}

// ---------------------------------------------------------------------------
// 纯校验：正文结构 / 占位符 / 逐字引证复制
// ---------------------------------------------------------------------------

/**
 * 是否存在长度 ≥ minLength 的**公共连续片段**（子串，区分大小写）。
 *
 * 用滚动窗口 + Set 而非动态规划：evidence 上限 4000 字（§12bis 实现侧上限），
 * 而 DP 是 O(n·m)，七段各跑一次在长引证下不可接受。窗口法只需「有没有」这一位
 * 答案——诊断信息里报的是「哪一段缺回指」，不是最长公共子串的长度。
 */
function sharesVerbatimFragment(needle, haystack, minLength) {
  if (typeof needle !== "string" || typeof haystack !== "string") return false;
  if (needle.length < minLength || haystack.length < minLength) return false;
  const windows = new Set();
  for (let i = 0; i + minLength <= haystack.length; i += 1) windows.add(haystack.slice(i, i + minLength));
  for (let i = 0; i + minLength <= needle.length; i += 1) {
    if (windows.has(needle.slice(i, i + minLength))) return true;
  }
  return false;
}

function findPlaceholder(text) {
  if (typeof text !== "string") return null;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * 11 §12bis「证据不留在缓冲」的机械校验（= 11 §18「经验候选的七段完整」行的一半）。
 *
 * 逐条规则：
 * 1. 七段每段非空（23 §9.1 / §18）；
 * 2. 七段每段不含占位符；
 * 3. **七段每段逐段可回指**：每段正文与条目 `evidence` 存在 ≥ MIN_VERBATIM_FRAGMENT_LENGTH
 *    的公共连续片段（§10.2 第 3 项「某段依据若无法回指到某条 evidence，该段不成立」）；
 * 4. 症状／触发条件／验证三段必须满足更严的「引证复制」形态——含该段所属的逐字引证，
 *    且**不得**只以 `buffer:<id>` 作为依据出现（12bis：只写 buffer:<id> 则权威对象的
 *    证据链依赖一个明确可淘汰的非权威载体）；
 * 5. 来源标识须被复制进正文：evidence 里若解析得出来源引用（会话 id / 文件:行 /
 *    命令引文），正文至少须逐字含其中一条；解析不出时，退回「正文须含 ≥ 24 字的
 *    逐字片段」——即要求连引证连来源一起整段搬过来。
 *
 * **本函数不判定引证是否切题**：11 §18 对该行明写「不证明七段内容据实」，切题性
 * 是 AI 语义审核的职责，不在本模块的机械射程内。
 *
 * @returns {{ok: boolean, issues: string[]}}
 */
export function verifyEvidenceCopy(bodyMarkdown, entry) {
  const issues = [];
  const evidence = isNonEmptyString(entry?.evidence) ? entry.evidence : "";

  if (!isNonEmptyString(bodyMarkdown)) {
    return { ok: false, issues: ["body: bodyMarkdown is required (23 §8: the seven sections are mandatory for a draft)"] };
  }

  const titles = h2Titles(bodyMarkdown);
  if (titles.length !== REVIEW_REQUIRED_BODY_SECTIONS.length
    || titles.some((t, i) => t !== REVIEW_REQUIRED_BODY_SECTIONS[i])) {
    issues.push(
      `body: expected ${REVIEW_REQUIRED_BODY_SECTIONS.length} H2 sections (${REVIEW_REQUIRED_BODY_SECTIONS.join(" / ")}), found ${titles.length} (${titles.join(" / ")})`,
    );
    // 结构不对时逐段校验无意义（sectionContent 会取到错位的段），到此为止。
    return { ok: false, issues };
  }

  if (evidence.length === 0) {
    issues.push("entry: evidence is empty — without a verbatim quotation there is nothing for any section to point back to (11 §12bis)");
  }

  const sectionTexts = new Map();
  for (const title of REVIEW_REQUIRED_BODY_SECTIONS) {
    const content = sectionContent(bodyMarkdown, title) ?? "";
    sectionTexts.set(title, content);

    if (content.trim().length === 0) {
      issues.push(`body: section "${title}" is empty (23 §9.1: the seven sections must all be non-empty for a draft)`);
      continue;
    }
    const placeholder = findPlaceholder(content);
    if (placeholder !== null) {
      issues.push(`body: section "${title}" carries the placeholder ${JSON.stringify(placeholder)} (23 §9 / 11 §18: a draft may not pass a placeholder off as content)`);
    }
    if (evidence.length > 0 && !sharesVerbatimFragment(content, evidence, MIN_VERBATIM_FRAGMENT_LENGTH)) {
      issues.push(
        `body: section "${title}" cannot be pointed back to the entry evidence — no ≥${MIN_VERBATIM_FRAGMENT_LENGTH}-character verbatim fragment of the evidence appears in it (11 §10.2 item 3: a section whose basis cannot be traced to a buffer entry's evidence does not hold, so the candidate does not hold)`,
      );
    }
  }

  // 11 §12bis：不得只写 buffer:<id>。凡出现该形态的段，必须同时含逐字引证。
  for (const title of EVIDENCE_COPY_REQUIRED_SECTIONS) {
    const content = sectionTexts.get(title) ?? "";
    if (content.trim().length === 0) continue;
    const onlyBufferRef = /buffer:[0-9a-zA-Z._:-]+/.test(content)
      && !sharesVerbatimFragment(content, evidence, MIN_VERBATIM_FRAGMENT_LENGTH);
    if (onlyBufferRef) {
      issues.push(
        `body: section "${title}" cites the buffer entry by id (buffer:<id>) without copying the verbatim quotation — the authoritative object's evidence chain would then depend on an explicitly evictable non-authoritative carrier (11 §12bis 证据不留在缓冲)`,
      );
    }
  }

  // 来源标识复制：evidence 里解析得出来源引用时，正文须逐字含其中一条。
  if (evidence.length > 0) {
    const references = extractSourceReferences(evidence);
    if (references.length > 0) {
      const copied = references.some((ref) => bodyMarkdown.includes(ref));
      if (!copied) {
        issues.push(
          `body: no source reference from the entry evidence was copied into the body (found ${references.slice(0, 3).map((r) => JSON.stringify(r)).join(", ")} in the evidence; 11 §12bis requires the quotation AND its source identifier to be copied)`,
        );
      }
    } else if (!sharesVerbatimFragment(bodyMarkdown, evidence, Math.max(MIN_VERBATIM_FRAGMENT_LENGTH * 3, 24))) {
      issues.push(
        `body: the entry evidence carries no parsable source reference and the body shares only a short fragment with it — copy the quotation together with its source citation (11 §12bis)`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

/** 从 evidence 中解析来源引用（会话 id / 文件:行 / 命令引文）。 */
function extractSourceReferences(evidence) {
  const found = [];
  for (const pattern of SOURCE_REFERENCE_PATTERNS) {
    const matches = evidence.match(pattern);
    if (!matches) continue;
    for (const raw of matches) {
      const ref = typeof raw === "string" ? raw.trim() : "";
      // 去掉命令引文前面的换行/提示符残留，保留命令本身。
      const cleaned = ref.replace(/^\s*[$#>]\s+/, "$ ").trim();
      if (cleaned.length > 0 && !found.includes(cleaned)) found.push(cleaned);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 查重对照集（23 §6.2：active 与 draft 都必须在对照范围内）
// ---------------------------------------------------------------------------

/**
 * 收集查重所需的确定性输入：既有 **active 与 draft** Pitfall 的 title 与
 * 症状／根因正文（23 §6.2；23 §12：discarded 不入普通候选，故不在对照集内）。
 *
 * 本函数**不做**语义裁决——它只把 AI 比对需要的材料取全并如实标出取不全的行。
 */
export async function collectExistingPitfalls({ factSourceRoot, limit = 200 } = {}) {
  if (!isNonEmptyString(factSourceRoot)) {
    return failure("observation_review/invalid_request", "factSourceRoot is required");
  }
  const listed = await listPitfallObjects({ factSourceRoot, statusFilter: ["active", "draft"], limit });
  if (!listed.ok) {
    return failure(
      listed.error?.code ?? "observation_review/list_failed",
      `cannot enumerate existing Pitfall objects for dedup (23 §6.2): ${listed.error?.message ?? "unknown"}`,
      { cause: listed.error },
    );
  }
  const items = [];
  for (const item of listed.value.items) {
    const read = await readPitfallObject({ factSourceRoot, objectUid: item.object_uid });
    const readable = read.ok && typeof read.value.body === "string";
    items.push({
      object_uid: item.object_uid,
      status: item.status,
      title: item.title ?? "",
      scope: item.scope ?? "",
      symptoms: readable ? (sectionContent(read.value.body, "症状") ?? "").trim() : "",
      root_cause: readable ? (sectionContent(read.value.body, "根因") ?? "").trim() : "",
      // comparable=false：正文取不全的既有对象**不得**被当作已比对过——那会让
      // 「对照集覆盖全部 active 与 draft」变成一句不成立的断言。
      comparable: readable,
    });
  }
  return success({ items, truncated: !listed.value.complete, invalid: listed.value.invalid });
}

/**
 * 机械侧只校验「查重已执行且对照集覆盖全部 active 与 draft」（23 §6.2 + 11 §18
 * 「经验候选的查重已执行」行）。语义结论由调用方给出。
 */
function verifyDedupeRecord(proposal, existingPitfalls) {
  const issues = [];
  const dedupe = proposal?.dedupe;
  if (!isPlainObject(dedupe)) {
    issues.push("dedupe: the proposal carries no dedup record (23 §6.2: the dedup conclusion must be recorded in the creation proposal)");
    return { ok: false, issues };
  }
  if (dedupe.checked !== true) {
    issues.push("dedupe: checked must be true — a creation proposal may not assert a candidate without recording the dedup comparison (23 §6.2)");
  }
  if (!Array.isArray(dedupe.compared)) {
    issues.push("dedupe: compared must be an array of the object_uids that were compared (23 §6.2: both active AND draft are in scope)");
  } else {
    const expected = existingPitfalls.map((p) => p.object_uid);
    const compared = new Set(dedupe.compared);
    const missing = expected.filter((uid) => !compared.has(uid));
    if (missing.length > 0) {
      issues.push(
        `dedupe: the comparison set does not cover every active/draft Pitfall — missing ${missing.length} object_uid(s) (23 §6.2: a draft Pitfall is in scope too, otherwise the same mechanism can be written twice as two candidates)`,
      );
    }
  }
  if (dedupe.conclusion !== "new" && dedupe.conclusion !== "duplicate") {
    issues.push(`dedupe: conclusion must be "new" or "duplicate"; got ${JSON.stringify(dedupe.conclusion)}`);
  }
  if (dedupe.conclusion === "duplicate") {
    if (!isNonEmptyString(dedupe.duplicate_of)) {
      issues.push("dedupe: conclusion=duplicate requires duplicate_of = the object_uid of the existing object (11 §10.2 item 4: the entry is settled consumed pointing at the existing object)");
    } else if (existingPitfalls.length > 0 && !existingPitfalls.some((p) => p.object_uid === dedupe.duplicate_of)) {
      issues.push(`dedupe: duplicate_of ${JSON.stringify(dedupe.duplicate_of)} is not among the compared active/draft objects`);
    }
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 缓冲条目校验（11 §18「留观缓冲条目的写入合法」行的读取侧复核）
// ---------------------------------------------------------------------------

function verifyEntryCarriage(entry) {
  const issues = [];
  const missing = BUFFER_REQUIRED_FIELDS.filter((field) => !(field in entry));
  if (missing.length > 0) {
    issues.push(`entry ${entry?.id}: missing closed-set field(s) ${missing.join(", ")} (11 §12bis)`);
  }
  if (entry?.status !== "pending") {
    issues.push(`entry ${entry?.id}: status must be pending for the review pass (got ${JSON.stringify(entry?.status)})`);
  }
  if (!isNonEmptyString(entry?.evidence)) {
    issues.push(`entry ${entry?.id}: evidence must be a verbatim quotation with its source reference (11 §12bis)`);
  }
  if (!isNonEmptyString(entry?.phenomenon)) {
    issues.push(`entry ${entry?.id}: phenomenon is required (11 §12bis)`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 审核段主入口
// ---------------------------------------------------------------------------

/**
 * 执行一次审核段运行（11 §10.2 六项闭集）。
 *
 * ## 入参闭集（这就是「不读实时对话」的机械形态）
 *
 * 只接受载体句柄与调用方给出的结构化提案。**没有任何会话正文/消息/历史参数**——
 * 材料只有一条通路进来：留观缓冲条目。见模块注释。
 *
 * @param {object} args
 * @param {(...segments:string[])=>string} args.dshHomePath - `observation-buffer.js` 的路径拼装函数。
 * @param {string} args.factSourceRoot - 受管辖事实源根（Pitfall 目录在其下）。
 * @param {string|null} [args.entryId] - §12ter.1 的可选参数：指定优先处理的缓冲条目。
 * @param {object[]} [args.existingPitfalls] - 查重对照集（`collectExistingPitfalls` 的 items）。
 * @param {object[]} [args.proposals] - 调用方（AI）逐条给出的结构化提案。
 * @param {object} [args.proposal] - 单条提案的便捷写法，等价于 `proposals:[proposal]`。
 * @param {*} [args.sessionSignature] - 品牌化署名载体（03 §6.1：change_log 由 Code 签名）。
 * @param {Date|number|string} [args.now]
 * @returns {Promise<{ok:true,value:{formed:null|{entry_id:string,object_uid:string,file:string},duplicate:null|{entry_id:string,object_uid:string},discarded:string[],remaining_pending:number,fail_closed:null}}|{ok:false,error:object}>}
 */
export async function reviewPendingEntries({
  dshHomePath,
  factSourceRoot,
  entryId = null,
  existingPitfalls = null,
  proposals = null,
  proposal = null,
  sessionSignature = null,
  now = new Date(),
  capacity,
} = {}) {
  if (typeof dshHomePath !== "function") {
    return failure("observation_review/invalid_request", "dshHomePath must be the path-joining function of observation-buffer.js");
  }
  if (!isNonEmptyString(factSourceRoot)) {
    return failure("observation_review/invalid_request", "factSourceRoot is required (the draft candidate is a fact object, 11 §10.2 item 3)");
  }
  if (entryId !== null && entryId !== undefined && !isNonEmptyString(entryId)) {
    return failure("observation_review/invalid_request", "entry_id must be a non-empty string when given (§12ter.1: optional buffer entry identifier)");
  }

  const allProposals = [];
  if (proposal !== null && proposal !== undefined) allProposals.push(proposal);
  if (Array.isArray(proposals)) allProposals.push(...proposals);
  else if (proposals !== null && proposals !== undefined) {
    return failure("observation_review/invalid_request", "proposals must be an array when given");
  }
  const proposalsByEntry = new Map();
  for (const item of allProposals) {
    if (!isPlainObject(item)) return failure("observation_review/invalid_request", "each proposal must be an object");
    if (!isNonEmptyString(item.entry_id)) {
      return failure("observation_review/invalid_request", "each proposal must name the buffer entry it reviews (entry_id) — a proposal may not be matched by guessing");
    }
    if (proposalsByEntry.has(item.entry_id)) {
      return failure("observation_review/invalid_request", `entry ${item.entry_id} carries more than one proposal — one pass forms at most one candidate per entry (11 §10.2)`);
    }
    proposalsByEntry.set(item.entry_id, item);
  }

  // ── 第 1 项：读 status=pending 的缓冲条目（只读缓冲，不读实时对话）─────────
  const read = await readBufferEntries(dshHomePath, { status: "pending", now, capacity });
  if (!read.ok) {
    // §12ter.1 共同前提：缓冲不可读时按 §12 fail-closed，不得降级为内存或日志。
    return failClosed(
      read.error?.code ?? "observation_review/buffer_unreadable",
      `the observation buffer could not be read (11 §12ter.1 / §12bis item 4: fail-closed, never degrade to memory or a log): ${read.error?.message ?? "unknown"}`,
      { stage: "read-pending" },
    );
  }
  if (!read.value.complete) {
    // 回读不完整 → §10.2 第 6 项 fail-closed；不得返回成功形状。
    const detail = read.value.invalid.map((i) => `line ${i.line}: ${i.reason}`).join("; ");
    return failClosed(
      "observation_review/buffer_read_incomplete",
      `the observation buffer read back incompletely (${read.value.invalid.length} defect line(s) — ${detail}); 11 §10.2 item 6 / §12: stop this run, keep the side effects and register them honestly (see also 11 §18: 缓冲条目不可写／不可回读)`,
      { stage: "read-pending" },
    );
  }

  let pending = read.value.items;
  if (entryId !== null && entryId !== undefined) {
    const target = pending.find((item) => item.id === entryId);
    if (!target) {
      return failure(
        "observation_review/entry_not_found",
        `no pending buffer entry with id ${JSON.stringify(entryId)} (pending entries: ${pending.length})`,
      );
    }
    pending = [target];
  }

  const state = {
    formed: null,
    duplicate: null,
    discarded: [],
    candidates: 0,
  };
  const existing = Array.isArray(existingPitfalls) ? existingPitfalls : [];

  // ── 第 2–5 项：逐条处理。配额用尽即停止全部动作（11 §11 水位纪律）────────
  for (const entry of pending) {
    if (state.candidates >= MAX_CANDIDATES_PER_RUN) break;

    const carriage = verifyEntryCarriage(entry);
    if (!carriage.ok) {
      return failClosed(
        "observation_review/entry_carriage_invalid",
        `the buffer entry does not satisfy the §12bis field closed set: ${carriage.issues.join("; ")} (11 §10.2 item 6 / §18 留观缓冲条目的写入合法)`,
        { stage: "verify-entry", ...stateSnapshot(state, null) },
      );
    }

    const proposal = proposalsByEntry.get(entry.id) ?? null;
    if (proposal === null) {
      // 没有提案就没有可据以成文的材料判据：既不建候选、也不把这条判为 discarded
      // （「不构成候选」是材料判断，不得由缺省代替）。条目原样留在缓冲里等下次运行。
      break;
    }

    // ── 第 5 项：条目不足以成文 → discarded（不是否决经验）────────────────
    if (proposal.insufficient !== undefined && proposal.insufficient !== null) {
      const reason = proposal.insufficient?.reason;
      if (!isNonEmptyString(reason)) {
        return failClosed(
          "observation_review/discard_reason_missing",
          `proposal for entry ${entry.id} declares the entry insufficient but gives no reason; 11 §10.2 item 5 requires an honest registration — a discard is not a rejection of the experience`,
          { stage: "verify-insufficient", ...stateSnapshot(state, null) },
        );
      }
      if (!sharesVerbatimFragment(reason, entry.evidence, MIN_VERBATIM_FRAGMENT_LENGTH)) {
        return failClosed(
          "observation_review/discard_reason_untraced",
          `proposal for entry ${entry.id} discards it with a reason that shares no ≥${MIN_VERBATIM_FRAGMENT_LENGTH}-character verbatim fragment of the entry evidence — the discard itself must be traceable to the entry (11 §10.2 item 1: a section that cannot be written does not constitute a candidate, it must not be written into existence)`,
          { stage: "verify-insufficient", ...stateSnapshot(state, null) },
        );
      }
      const settled = await settleBufferEntry(dshHomePath, entry.id, { status: "discarded", now, capacity });
      if (!settled.ok) {
        return failClosed(
          settled.error?.code ?? "observation_review/settle_failed",
          `cannot settle entry ${entry.id} as discarded: ${settled.error?.message ?? "unknown"} (11 §12ter.2: fail-closed, never a success shape)`,
          { stage: "settle-discarded", ...stateSnapshot(state, null) },
        );
      }
      state.discarded.push(entry.id);
      continue;
    }

    // ── 第 2 项：查重已执行且对照集覆盖 active 与 draft（23 §6.2）────────────
    const dedupe = verifyDedupeRecord(proposal, existing);
    if (!dedupe.ok) {
      return failClosed(
        "observation_review/dedup_not_recorded",
        `the dedup record for entry ${entry.id} does not satisfy 23 §6.2 / 11 §18: ${dedupe.issues.join("; ")}`,
        { stage: "verify-dedup", ...stateSnapshot(state, null) },
      );
    }
    if (proposal.dedupe.conclusion === "duplicate") {
      // 第 4 项后半：查重命中同样置 consumed 并指向既有对象；不新建。
      const settled = await settleBufferEntry(dshHomePath, entry.id, {
        status: "consumed",
        consumedBy: proposal.dedupe.duplicate_of,
        now,
        capacity,
      });
      if (!settled.ok) {
        return failClosed(
          settled.error?.code ?? "observation_review/settle_failed",
          `cannot settle entry ${entry.id} as consumed pointing at ${proposal.dedupe.duplicate_of}: ${settled.error?.message ?? "unknown"} (11 §12ter.2: fail-closed, never a success shape)`,
          { stage: "settle-duplicate", ...stateSnapshot(state, null) },
        );
      }
      state.duplicate = { entry_id: entry.id, object_uid: proposal.dedupe.duplicate_of };
      continue;
    }

    // ── 第 3 项：创建 draft 候选（七段齐备 + 逐字引证复制）────────────────
    if (!isNonEmptyString(proposal.title)) {
      return failClosed(
        "observation_review/proposal_incomplete",
        `proposal for entry ${entry.id} has no title (23 §8: title is required, ≤ 30 characters)`,
        { stage: "verify-proposal", ...stateSnapshot(state, null) },
      );
    }
    if (!isNonEmptyString(proposal.scope)) {
      return failClosed(
        "observation_review/proposal_incomplete",
        `proposal for entry ${entry.id} has no scope (23 §8: scope is required and must appear verbatim in the 影响与适用范围 section)`,
        { stage: "verify-proposal", ...stateSnapshot(state, null) },
      );
    }
    if (sessionSignature === null || sessionSignature === undefined) {
      // 03 §6.1 / 09：change_log 必须由 Code 签名，缺载体即拒绝并交 Human 处置。
      return failClosed(
        "observation_review/signature_unavailable",
        `entry ${entry.id}: the authoritative session signature is unavailable; 11 §12ter.1 — the signature is not carried by parameters and an unsigned change_log entry must not be written (03 §6.1). REPORT TO HUMAN; this run is refused (11 §12)`,
        { stage: "signature", ...stateSnapshot(state, null) },
      );
    }

    const bodyCheck = verifyEvidenceCopy(proposal.body, entry);
    if (!bodyCheck.ok) {
      return failClosed(
        "observation_review/body_invalid",
        `entry ${entry.id}: the candidate body was refused before creation (11 §12bis 证据不留在缓冲 / 11 §18 经验候选的七段完整: 拒绝创建): ${bodyCheck.issues.join("; ")}`,
        { stage: "verify-body", ...stateSnapshot(state, null) },
      );
    }

    const created = await createPitfallObject({
      factSourceRoot,
      // 机械通道初态只能是 draft（11 §10.2 第 3 项 / 23 §13）；创建与入档是同一
      // 决定的 Human 入口在此处不可达，故此处不存在任何 active 分支。
      frontmatterDraft: {
        title: proposal.title,
        scope: proposal.scope,
        status: "draft",
        ...(Array.isArray(proposal.urls) && proposal.urls.length > 0 ? { urls: proposal.urls } : {}),
        change_summary: `闲时辅助经验积累·审核段据缓冲条目 ${entry.id} 形成候选（11 §10.2 第 3 项）`,
      },
      bodyMarkdown: proposal.body,
      sessionSignature,
    });
    if (!created.ok) {
      return failClosed(
        created.error?.code ?? "observation_review/create_failed",
        `entry ${entry.id}: creating the draft candidate failed (11 §10.2 item 6): ${created.error?.message ?? "unknown"}`,
        { stage: "create", ...stateSnapshot(state, null) },
      );
    }
    state.candidates += 1;
    state.formed = {
      entry_id: entry.id,
      object_uid: created.value.object_uid,
      file: created.value.file,
    };

    // ── 第 4 项前半：写后精确回读（含状态、字段闭集与正文结构）────────────
    const readBack = await readPitfallObject({ factSourceRoot, objectUid: created.value.object_uid });
    if (!readBack.ok || readBack.value.fingerprint !== created.value.fingerprint
      || readBack.value.frontmatter?.status !== "draft" || readBack.value.body_valid !== true) {
      const detail = !readBack.ok
        ? readBack.error?.message ?? "unknown"
        : `fingerprint ${readBack.value.fingerprint === created.value.fingerprint ? "matches" : "mismatch"}, status ${JSON.stringify(readBack.value.frontmatter?.status)}, body_valid ${JSON.stringify(readBack.value.body_valid)}`;
      // 不得把部分写入当作完成：候选已落盘，故 formed 仍如实带出。
      return failClosed(
        "observation_review/read_back_failed",
        `entry ${entry.id}: the draft candidate was created but did not read back completely (${detail}); 11 §10.2 item 6 / §12 — stop this run, keep the side effect and register it honestly`,
        { stage: "read-back", ...stateSnapshot(state, entry.id) },
      );
    }

    // ── 第 4 项后半：条目置 consumed + consumed_by = draft uid ─────────────
    const settled = await settleBufferEntry(dshHomePath, entry.id, {
      status: "consumed",
      consumedBy: created.value.object_uid,
      now,
      capacity,
    });
    if (!settled.ok) {
      return failClosed(
        settled.error?.code ?? "observation_review/settle_failed",
        `entry ${entry.id}: the candidate ${created.value.object_uid} exists but the entry could not be settled as consumed (${settled.error?.message ?? "unknown"}); 11 §12ter.2 — fail-closed, never a success shape`,
        { stage: "settle-consumed", ...stateSnapshot(state, entry.id) },
      );
    }
  }

  // ── remaining_pending：未处理且仍为 pending 的条目数（重读，不靠本地计数）──
  const after = await readBufferEntries(dshHomePath, { status: "pending", now, capacity });
  if (!after.ok) {
    return failClosed(
      after.error?.code ?? "observation_review/buffer_unreadable",
      `the pending entry count could not be re-read after the run: ${after.error?.message ?? "unknown"} (11 §12: fail-closed rather than report an unverified number)`,
      { stage: "recount-pending", ...stateSnapshot(state, null) },
    );
  }

  return success({
    formed: state.formed,
    duplicate: state.duplicate,
    discarded: state.discarded,
    remaining_pending: after.value.items.length,
    fail_closed: null,
  });
}

/** fail-closed 结果里如实带上「已经发生的结算」。 */
function stateSnapshot(state, entryId) {
  const snapshot = {
    formed: state.formed,
    duplicate: state.duplicate,
    discarded: [...state.discarded],
    remaining_pending: null,
  };
  if (entryId !== null) {
    snapshot.partial_entry = entryId;
  }
  return snapshot;
}
