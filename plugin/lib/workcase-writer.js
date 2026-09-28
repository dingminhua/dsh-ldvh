/**
 * dsh-ldvh — WorkCase fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/21 §14 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:   flat single-file carrier
 *              (ldvh-base/workcases/workcase-<uid>.md) with YAML
 *              frontmatter + markdown body. Code assigns object_uid +
 *              created_at and generates the H1 from title; creation
 *              validates the type-specific mechanical checks (closed
 *              sets, plan[].done_criteria non-empty, carrier coherence,
 *              serves ⇔ goal.md SG-n resolution).
 *  - read:     returns frontmatter + body + file-level content
 *              fingerprint (SHA-256).
 *  - approve (Gate 1): draft → open. Human Gate on the flow level; the
 *              writer stamps `gate_1` (approved_at + approver supplied by
 *              the flow, authorization_fingerprint computed BY CODE over
 *              the current plan+scope, scope_snapshot copied from the
 *              current scope) and allocates the first attempt token.
 *  - execute: open-period updates — attempt heartbeat / takeover /
 *              reallocation, body progress, result drafts in the body,
 *              relations changes. plan/scope are frozen by C2: any
 *              substantive change is refused here and must go through
 *              rebatch (21 §10.3).
 *  - close (Gate 2): open → closed. Human Gate on the flow level; the
 *              writer stamps result + outcome, retracts the attempt
 *              token (收口) and validates the criteria_checks ⇔ plan
 *              correspondence.
 *  - rebatch:  open → draft (C2 局部重批). attempt voided, result /
 *              outcome cleared (invariant: result ⇔ closed), gate_1
 *              dropped (draft must not carry it); the prior evidence
 *              snapshot goes into the change_log entry (21 §9.2).
 *  - cancel:   draft → closed with outcome=cancelled (21 §9.2: 计划未
 *              经执行即被取消 — Human Gate on the flow level).
 *  - revise:   draft → draft controlled revision (plan/scope may still
 *              evolve before Gate 1; each revision = exactly one
 *              change_log entry).
 *  - list:     F0/F1 discovery projection (draft+open by default,
 *              21 §13: closed 只在精确引用、证据链反查或历史追溯时展开).
 *
 * Authorization pinning (C2, 21 §10.3): the fingerprint binds
 * gate_1.authorization_fingerprint to the content of plan+scope.
 * While status=open, every writer flow verifies the fingerprint still
 * matches; a mismatch is a C2 invalidation and the only legal path is
 * rebatch, never a silent in-place edit.
 *
 * attempt tokens (21 §10.4): monotonic, at most one active, allocated
 * by Code only. attempt_id derives from the change_log history the
 * writer itself produced (each allocation/void is recorded there), so
 * re-entry after an interruption gets a strictly higher id. The token
 * carries NO authorization — authorization only comes from Gate 1.
 *
 * Known spec tension (recorded, deliberately resolved wide at the
 * mechanical layer): 21 §8 states `gate_1 出现 ⇔ status ∈ {open,
 * closed}` while §9.2 defines a draft → closed(cancelled) path whose
 * closed state carries no Gate 1 approval. The writer enforces
 * gate_1 presence for status=open (per §9.1) and validates shape
 * whenever gate_1 is present, but does not require gate_1 on every
 * closed object — the draft-cancelled path would otherwise be
 * unrepresentable. The tension is left for the 32 号 system spec to
 * close; do not "fix" it silently here.
 *
 * Red lines honoured (21 §19): no urls field, no priority, no
 * process-log fields, no WC-to-WC relations (contributed-to → Pitfall
 * only), no multi-attempt reservation, no requirement-review state.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature, resolveAuthoritativeSessionIdentity } from "./signature-channel.js";
import { h2Titles, countAtxHeadings, sectionContent } from "./markdown-structure.js";
import { readGoalAnchors as readGoalAnchorsFromGoal } from "./goal-writer.js";
import { resolveRefsTargets } from "./spark-writer.js";

// ---------------------------------------------------------------------------
// Constants (specs/21 §7, §8, §9)
// ---------------------------------------------------------------------------

const WORKCASE_TYPE_KEY = "workcase";

/** Directory under the fact-source root that carries WorkCase objects. */
export const WORKCASE_DIRECTORY = "workcases";

/** Status closed set (21 §9): draft → open → closed. */
const STATUSES = new Set(["draft", "open", "closed"]);

/** Outcome closed set (21 §9.3): four terminal values. */
const OUTCOMES = new Set(["completed", "partial", "not-achieved", "cancelled"]);

/** Outcomes that require a non-empty residual[]. */
const RESIDUAL_REQUIRED_OUTCOMES = new Set(["partial", "not-achieved"]);

/** Body H2 sections (21 §8). 摘要/授权范围/计划 always present; 执行 and
 * 结果 are conditional (执行 ⇔ execution has happened i.e. status=open or
 * closed-with-gate_1; 结果 ⇔ closed, optional as a draft while open). */
const BODY_H2_CORE = ["摘要", "授权范围", "计划"];
const BODY_H2_EXECUTION = "执行";
const BODY_H2_RESULT = "结果";

/**
 * 正文 H2 的**取值闭集**（21 §8，Human 裁定 2026-09-22）。
 *
 * 与上面三项常量正交，勿混同：`BODY_H2_CORE` / `_EXECUTION` / `_RESULT` 表达的是
 * 各节的**出现条件**（执行 ⇔ 已发生执行；结果 ⇔ 关闭时必填、开期中可作关闭提案）；
 * 本常量表达的是**允许出现的取值全集**。故本项只拦「清单之外的标题」，已登记标题的
 * 出现条件仍由各自分支给出更具体的拒绝理由（如「draft 不得携带 ## 执行」），不在此
 * 重复拒绝——否则同一次违规会得到两条含义不同的理由。
 *
 * 该闭集是被**裁定**的，不是从旧实现的沉默中推定出来的：旧实现只做「期望节是否出现」
 * 与「次序」两项比对，未登记标题既不参与前者也不参与后者，因而**默认放行**（实测：
 * 正文含额外「## 复核」可落盘成功）。21 §14 原有的「正文不设复核节」是「无须」而非
 * 「不得」，不足以充当机械门禁；本闭集补上该缺口。
 */
const BODY_H2_ALLOWED = [...BODY_H2_CORE, BODY_H2_EXECUTION, BODY_H2_RESULT];

/** Title cap (21 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/**
 * `summary` / `scope` 的结构化书写规则（21 §8 的书写纪律，机械校验）。
 *
 * **为什么需要**：`summary` 与 `scope` 是自由字符串字段，实测 16/16 份对象把它们
 * 写成了单块整段（最长 1123 字符、零换行），而同一份文件的「计划」节 15/16 份
 * 用了列表——差别不在作者，在字段类型：`plan` 是数组（schema 强制逐项），自由
 * 字符串没有任何结构约定。结果是 720 字符的 `scope` 里明明有 5 个编号分点和
 * 「做什么／明确不做什么」两段界线，却全部挤在一个段落里，Human 读不出层次。
 *
 * **规则**（两条，都只约束**书写形态**、不约束内容）：
 *
 * ① `scope` 必有两段**独占一行**的标签：「做什么：」与「明确不做什么：」，各带内容。
 *    21 §8 已要求 `scope`「必须同时回答『做什么』与『明确不做什么』」，但原文只
 *    要求**语义上同时回答**——实测 16/16 份确实都回答了，形态上却都是行内串联
 *    （`做什么：A；B。明确不做什么：C。`）。本项把「同时回答」落成可读的两段。
 *
 * ② 超过阈值的长文本须用**空行分块**，且首块之外的每块首行须是**固定骨架**：
 *    `summary` 只有 `### 标签`（Human 裁定 2026-09-22）；`scope` 另有其语义必需的
 *    `做什么：`／`明确不做什么：` 两个标签行（见下方常量说明）。
 *
 * **阈值以下的短文本豁免**：短文本本就不难读，强制分块是形式主义。阈值取 200
 * 字符——与 `gist` 的 200 字符上限同量级，且实测本仓短对象（42/81/170 字符）
 * 天然落在其下，不需要为其增加书写负担。
 *
 * **为什么用「标签行」而不是固定小节名**：`summary` 的内容成分实测高度可变
 * （现状核实 8/16、边界 4/16、依据 5/16），固定小节名会逼作者为凑格式而造节。
 * 本规则只要求「有骨架、能看出块在讲什么」，不规定块该叫什么——层次由作者定，
 * 可读性由机械保证。
 *
 * **骨架取 H3 而非加粗/冒号（Human 裁定 2026-09-22，实测依据）**：原实现接受三种
 * 标记形式，其理由「三种在本仓并存，强制其一会在无收益处制造改写」**已被推翻**——
 * 三种在呈现层并不等价：`**标签**` 后的单个换行不产生新段落（仍在同一 `<p>` 内，
 * 只是标签被加粗），`标签：` 更是无任何标记。允许三种，等于允许两种读者看不出
 * 层次的写法。收敛为 H3 后，机械判定与视觉层次一一对应。裁决与实测见
 * `SUMMARY_BLOCK_HEAD` 的说明。
 *
 * **阈值与标签形式的取舍边界（如实声明）**：本项校验**形态可达性**，不校验
 * 标签是否名副其实（写 `**现状核实**` 而内容其实是边界，机械无法判定），也不
 * 校验内容是否真的「有层次」——后者属 AI 语义审核与 Human 阅读。与 21 §15.1
 * 既有的 `gist` 完备性条目同形：机械层只到存在性与形态。
 */
const STRUCTURED_TEXT_MIN_CHARS = 200;

/** 「做什么：」/「明确不做什么：」独占一行（允许尾随空白）。 */
const SCOPE_WHAT_LINE = /^做什么[：:]\s*$/;
const SCOPE_NOT_LINE = /^明确不做什么[：:]\s*$/;

/**
 * `summary` 的块首固定骨架：**只有 H3**（21 §8 书写结构，Human 裁定 2026-09-22）。
 *
 * **为什么从「三种任选」收敛到只有 H3——实测三种在呈现层并不等价**（`react-markdown`
 * 渲染实测，用例见 plugin/web）：
 *
 *   `### 标签`   → `<h3>标签</h3><p>正文</p>`：H3 是**块级元素**，标题与正文真实分隔；
 *   `**标签**`   → `<p><strong>标签</strong>\n正文</p>`：单个软换行**不产生新段落**，
 *                  仍在同一个 `<p>` 内（只是把标签加粗）；
 *   `标签：`     → `<p>标签：\n正文</p>`：无任何标记，仅靠一个冒号。
 *
 * 即：三种在机械层看着都能「分块」，在呈现层只有 H3 真分出了层次。**允许三种，等于
 * 允许两种达不到分块效果的写法**——这正是「格式看似有规矩、读起来仍是一整段」的根源。
 * 收敛为 H3 后，机械判定与视觉层次一一对应：机械层说「合规」即读者看到的是分节文本。
 *
 * **块首即该 H3 行**：H3 是标题，整行都是标题文本。故 `### 现状核实` 与
 * `### 现状核实：细节在此` 都构成块首（前者是干净标签，后者把内容吸进了标题）。
 * 二者的差别属**标题文本质量**，机械层不判——与本项既有的边界一致（机械只证明
 * 形态可达性，不证明标签名副其实或内容真的有层次；后者属 AI 语义审核与 Human 阅读）。
 * 需要机械保证的是「块以块级标题开头」，不是「标题写得好」。
 */
const SUMMARY_BLOCK_HEAD = /^###[ \t]+\S/;

/**
 * `scope` 的块首：H3，或该字段语义所必需的**两个标签行**。
 *
 * `scope` 与 `summary` 的差别不是风格，而是语义：`做什么：`／`明确不做什么：` 两段
 * 骨架由 §8 直接登记（「必须同时回答做什么与明确不做什么」），是**字段定义的一部分**，
 * 不能改用 H3 表达——故这两个标签行在本字段内是合法的块首。
 *
 * **但不接受任意 `XX：` 行**：那正是本次从「三种任选」收敛掉的那种宽松——它让
 * 「看起来像标题」的空行都能过，结构依旧不固定。本字段的块首因此是**闭集**：
 * H3，或那两个已登记的标签行，二者之外不构成块首。
 */
const SCOPE_BLOCK_HEADS = new Set(["做什么", "明确不做什么"]);

function isSummaryBlockHead(line) {
  return SUMMARY_BLOCK_HEAD.test(line.trim());
}

function isScopeBlockHead(line) {
  const trimmed = line.trim();
  if (SUMMARY_BLOCK_HEAD.test(trimmed)) return true;
  // 标签行形态：`做什么：` / `明确不做什么:`（冒号全角半角均可，可带尾随空白）。
  const m = /^([^\n：:]+)[：:][ \t]*$/.exec(trimmed);
  return m !== null && SCOPE_BLOCK_HEADS.has(m[1].trim());
}

/** 空行分块（与 `## 摘要` 等正文节的分块语义一致）。 */
function structuredTextBlocks(text) {
  return text
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * 校验 `scope` 的两个标签段：各须**独占一行**，且标签下到下一个标签（或结尾）
 * 之间须有内容。
 *
 * 注意与「行内写法」的区别：`做什么：A；B。明确不做什么：C。` 是**行内串联**，
 * 两个标签都在，语义也回答了，但读起来仍是一整段——本项正是要把它判为不合规。
 * 故判定用 `^...$`（独占一行），而非「文本含该子串」。
 */
function validateScopeLabelSections(scope, issues) {
  const lines = scope.split("\n").map((line) => line.trim());
  const sections = [
    { name: "做什么", pattern: SCOPE_WHAT_LINE, index: -1 },
    { name: "明确不做什么", pattern: SCOPE_NOT_LINE, index: -1 },
  ];
  for (const section of sections) {
    section.index = lines.findIndex((line) => section.pattern.test(line));
    if (section.index < 0) {
      issues.push(
        `scope: missing a line holding exactly "${section.name}：" (21 §8 — 必须同时回答「做什么」与「明确不做什么」；须各占一行成段，不得行内串联)`,
      );
    }
  }
  for (const section of sections) {
    if (section.index < 0) continue;
    const rest = lines.slice(section.index + 1);
    const nextLabel = rest.findIndex((line) => SCOPE_WHAT_LINE.test(line) || SCOPE_NOT_LINE.test(line));
    const body = (nextLabel < 0 ? rest : rest.slice(0, nextLabel)).join("\n").trim();
    if (body === "") {
      issues.push(`scope: section "${section.name}：" has no content (21 §8 — 标签下须列出该方向的具体范围)`);
    }
  }
}

/**
 * 长文本（> STRUCTURED_TEXT_MIN_CHARS）须空行分块，且**首块之外的每个块**须以固定
 * 骨架开头（`summary` 只有 H3；`scope` 另有其语义必需的标签行，见上方常量说明）。
 *
 * 阈值以下直接放行（短文本豁免）。
 *
 * **首块不要求骨架**（Human 裁定 2026-09-22）：首块是该字段的总述，读者从节点标题
 * 即知它在讲什么，再加一个 H3 只是形式主义；要求骨架的是**后续块**——它们的边界
 * 必须由标题显式给出，否则与首块糊成一片。实测存量 12 份中 6 份的首句本身即以
 * 「：」结尾（如「把复核的独立性…升级为关闭侧硬门禁：」），这类可原位提升为 H3，
 * 无需改写文字。
 */
function validateStructuredText(text, field, issues) {
  if (text.length <= STRUCTURED_TEXT_MIN_CHARS) return;
  const isBlockHead = field === "scope" ? isScopeBlockHead : isSummaryBlockHead;
  const blocks = structuredTextBlocks(text);
  if (blocks.length < 2) {
    issues.push(
      `${field}: ${text.length} chars in a single block — long text must be split by blank lines (21 §8 书写结构：结构固定清晰、有层次)`,
    );
    return;
  }
  for (let i = 1; i < blocks.length; i++) {
    const head = blocks[i].split("\n")[0].trim();
    if (!isBlockHead(head)) {
      issues.push(
        `${field}: block #${i + 1} starts with "${head.slice(0, 30)}" — every block after the first must open with a fixed head (${
          field === "scope" ? "### 标签 或 做什么：/明确不做什么：" : "### 标签"
        }) (21 §8 书写结构)`,
      );
    }
  }
}

/**
 * 结构化书写的**适用范围**——与 §6.1 关口门禁同形：只校验相对基线**新增或改动**
 * 的字段，逐字未改的既有字段放行。
 *
 * 理由（实测，2026-09-20）：存量 16 份对象中 15 份的 `summary` 或 `scope` 超过阈值
 * 且为单块（其中 12 份是 draft/open 活对象）。若对 update 一律校验，则**追加一条
 * `change_log` 都会被拒**——而 `close` 是唯一出口、本类型**无删除操作**（21 §14），
 * 结果是这批工单永久无法关闭。这与 §6.1 引入基线豁免时面对的是同一个死锁：
 * 新规则不应追溯惩罚既有历史。
 *
 * 豁免不构成绕过：
 *   - 字段**被改动**（哪怕只改一字）即重新受检，须同时补齐结构；
 *   - 新建对象（create）无基线，全部受检；
 *   - 比对为精确字符串，不做归一化——归一化会制造「一个空格」式的绕过面。
 *
 * 如实登记边界：基线只覆盖 `summary`/`scope` 两个字段（这两者才是本规则的对象）；
 * 未改动字段的**内容质量**不在本项范围（属 AI 语义审核与 Human 阅读）。
 */
function validateStructuredWriting(frontmatter, issues, baselineSummary, baselineScope) {
  const changed = (current, baseline) => baseline === undefined || current !== baseline;
  if (typeof frontmatter.scope === "string" && changed(frontmatter.scope, baselineScope)) {
    validateScopeLabelSections(frontmatter.scope, issues);
    validateStructuredText(frontmatter.scope, "scope", issues);
  }
  if (typeof frontmatter.summary === "string" && changed(frontmatter.summary, baselineSummary)) {
    validateStructuredText(frontmatter.summary, "summary", issues);
  }
}

/**
 * Relations contract (21 §12, 2026-09-28): contributed-to → Pitfall,
 * routed-to → Spark (残留去向；target must be open at write time).
 */
const ALLOWED_RELATION_KEYS = new Set(["contributed-to", "routed-to"]);
const PITFALL_DIRECTORY = "pitfalls";
const SPARK_DIRECTORY = "sparks";

const OBJECT_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SG_ANCHOR_PATTERN = /^SG-\d+$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/** Frontmatter closed set (21 §8). Anything beyond this is rejected. */
export const VALID_FM_KEYS = new Set([
  "fact_type_key", "object_uid", "title", "status",
  "gist", "serves", "summary", "scope", "plan",
  "gate_1", "attempt", "reviews", "result", "outcome",
  "refs", "relations", "created_at", "change_log",
]);

/**
 * 21 §8: `gist`（要点）的字符上限 —— 给 Human 扫读的一句话要点。
 *
 * 判定单位与 `title` 的同名上限一致（UTF-16 码元，按 `.length`），
 * 与 20 §8 / 23 §8 的 `disposition` 上限同形：上限是**扫读上限**而非表达上限，
 * 超限拒绝写入，不得截断后写入（完整叙述属 summary/正文/change_log）。
 */
export const GIST_MAX_CHARS = 200;

/** 21 §8: `reviews` 单条 `summary` 的字符上限（Human 裁定 2026-09-16）。 */
export const REVIEW_SUMMARY_MAX_CHARS = 600;

/** 21 §8: `reviews` 的条数上限（起草者按 Human「其他按你推荐」授权定为 20，比照 20 §8 evolution）。 */
export const REVIEW_ENTRIES_MAX = 20;

/** 03 §7.2 / 21 §8: bounded ordinary content references. */
export const REFS_ENTRIES_MAX = 10;

// ---------------------------------------------------------------------------
// Small helpers (shared conventions with the pitfall/spark writers)
// ---------------------------------------------------------------------------

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

/**
 * 21 §8「执行」节记账纪律的**前置提示**载荷。
 *
 * 属纯告知：把当前 plan 的权威编号清单随写入响应一并交给调用方，使「计划步骤 N」
 * 的 N 有据可依，而不必回查 frontmatter。**不含任何校验或拒绝规则**——同类机械
 * 校验已被实测证伪（它抓不到纯「步骤 N」形态的原错误，却会拒绝如实引述该编号的
 * 记述，并诱使作者不写编号以规避检查）。
 *
 * 在 approve 与 execute 两处返回：approve 是授权时点、execute 是实际写正文的
 * 时点；跨会话接力时执行者未必持有 approve 的返回值，故两处都要给。
 */
function planStepReference(plan) {
  const list = Array.isArray(plan) ? plan : [];
  return {
    rule: "正文引用计划步骤时使用「计划步骤 N」，N 以本清单为界；非计划步骤的执行事项（复核、补充验证、收尾等）独立描述，不得编入计划序号（21 §8）",
    plan_length: list.length,
    steps: list.map((item, index) => ({ n: index + 1, step: item.step })),
  };
}

// h2Titles / countAtxHeadings / sectionContent 已收敛到 markdown-structure.js
// （单一权威实现）。收敛动因：同一结构判定曾在 6 个 writer 中各自实现且语义
// 分叉——本文件的实现原本跳代码围栏，而其余 5 份不跳，同一仓库内两份语义并存
// （pitfall e8cadde1 的同构复发）。各 writer 不得再各自实现结构解析。

export function workcaseFileName(uid) { return `workcase-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, WORKCASE_DIRECTORY, workcaseFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// `lineWidth: 0` 是跨 writer 的既有约定（ef08d9e，2026-09-06：Human 反馈「YAML
// 折行不可读」后确立，其余 7 个 writer 均如此）。workcase 建立时（2026-09-15）未
// 继承，长中文 summary/scope 被折成 ~80 列 + 2 空格续行——数据无损，但 review 与
// diff 的逐行可读性显著下降。
function buildFileContent(frontmatter, body) {
  const ordered = orderFrontmatterFields(frontmatter);
  return `---\n${stringifyYaml(ordered, { lineWidth: 0 })}---\n\n${body}\n`;
}

/**
 * frontmatter 键序：**本数组必须覆盖 VALID_FM_KEYS 的每个成员**——未列入者会被
 * 下面的兜底循环追加到 `change_log` 之后，其位置即失去定义。
 *
 * 这正是实测缺陷：`gist`（2e11707 引入）与 `reviews` 都进入了闭集却没有进入本
 * 数组，于是落盘位置取决于「何时引入」而非语义归属——实测两份 draft 的 `gist`
 * 都落在 `change_log` 之后。`schema-writer-agreement.test.mjs` 守的是「工具 schema
 * ↔ 闭集」这条缝，不覆盖本数组，故该不同步长期无守卫；现由同文件新增的序数组
 * 完整性用例守住（断言本数组 ⊇ 闭集）。
 *
 * **顺序取「与存量一致 + 语义分块」，不是照抄 §8 表的行序**（如实说明）：§8 表把
 * `status` 排在倒数第 4 位，而存量 16/16 个对象的实际位置都是第 4 位（紧随
 * `title`）。表序是「字段逐条说明」的书写顺序，不是键序约定。故此处保留 `status`
 * 的存量位置，只把两个缺位字段插回语义归属处：`gist` 紧随 `status`（与 `title`
 * 同属 Human 扫读入口），`reviews` 置于 `attempt` 之后、`result` 之前（同属执行期
 * 累计的分组）。
 *
 * 键序本身不是规则：24 号已明示 YAML 映射无序、写入方按任意顺序书写均合规、
 * 读取端不得因顺序校验或拒绝消费。故此处只求「同类型内稳定且可解释」，不构成
 * 对调用方的约束，也不新增任何拒绝路径。
 */
export const FRONTMATTER_FIELD_ORDER = [
  "fact_type_key", "object_uid", "title", "status", "gist",
  "serves", "summary", "scope", "plan",
  "gate_1", "attempt", "reviews", "result", "outcome",
  "refs", "relations", "created_at", "change_log",
];

export function orderFrontmatterFields(frontmatter) {
  const order = FRONTMATTER_FIELD_ORDER;
  const out = {};
  for (const key of order) if (key in frontmatter) out[key] = frontmatter[key];
  for (const key of Object.keys(frontmatter)) if (!order.includes(key)) out[key] = frontmatter[key];
  return out;
}

async function atomicWriteFile(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}

function assertValidUid(objectUid) {
  if (typeof objectUid !== "string" || !OBJECT_UID_PATTERN.test(objectUid)) {
    return failure("workcase/invalid_uid", `object_uid must be a canonical UUIDv4, got ${JSON.stringify(objectUid)}`);
  }
  return null;
}

function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.replace(/\s+$/, "")}\n`;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stableStringify(value) {
  // Deterministic JSON (fixed key order, sorted for nested maps) so the
  // authorization fingerprint only changes with content, not ordering.
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** C2 content fingerprint over the authorized pair: plan + scope (21 §10.1). */
export function computeAuthorizationFingerprint(plan, scope) {
  const canonical = stableStringify({ plan, scope });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Frontmatter validation (specs/21 §8 + §15.1)
// ---------------------------------------------------------------------------

/**
 * 21 §6.1（2026-09-18）：`plan` 只承载本工作包特有的实施工作，不承载 WorkCase
 * 自身的生命周期关口。受控提交、独立复核、主控自查、Gate 批准及其收尾动作由
 * 06 / 02 §15 与本文 §9、§14 承接，不得被写成 plan 的步骤或 done_criteria。
 *
 * 设计理由（见 §6.1）：关口与计划互为前置会形成循环——独立复核须待计划步骤
 * 全部终止后执行，而关闭又须待复核完成；把关口写进 plan 会使该步骤既是「待复核
 * 的对象」又是「复核本身」。
 *
 * v4 的教训（specs/21 前身 §4.3，commit 1e7d9584）：只写条文不管用——v4 补了
 * 明文禁令后 2 天仍出现 item-gate-commit「受控提交」；且 v4 自认「Code 不判断
 * 自然语言是否属于生命周期关口」。故本条**必须**配机械承载，且承载形态必须
 * 窄到不误伤：只匹配**关口动词作谓语**的形态，不匹配「测试/检查」这类可作证据
 * 的技术状态（§6.1 明文保留后者）。
 *
 * 边界（§6.1 末段）：只约束 plan 的内容，不约束正文叙述，不新增状态/字段/阶段；
 * 不得据此增加其它校验。
 */
// 关口形态：谓词性动词 + 其对象。刻意要求**动词+对象**同现，避免把
// 「提交前检查」「复核发现的问题」这类叙述中的名词用法误判为关口步骤。
// 关口形态（§6.1）。刻意的窄化设计——只匹配「**执行**该关口」的谓语形态，
// 不匹配「实现/开发该关口的机制」「调研该关口」这类**本单实施工作**。
//
// 依据（实测，2026-09-18）：宽泛匹配会把「实现提交校验逻辑」「复核模块实现」
// 「调研 Git Gate 现状」误判为关口，那正是 v4 §4.3 的死结（「Code 不判断自然
// 语言是否属于生命周期关口」）。故本条**只认谓语的形态**，不接受名词联想。
//
// 具体地：模式必须体现「对本次工作对象施加关口动作」，因此
//   ① 裸名词（「提交校验」「复核模块」「Git Gate」）不算；
//   ② 有「实现/开发/新增/补/修复/重构/调研/测试」等**建设性动词**在前时不算；
//   ③ 仅当动词是**关口执行本身**（提交/复核/自查/提请/关闭/Gate 批准）时才命中。
const GATE_EXECUTION_VERBS = "(提交|复核|审核|自查|提请|关闭|批准|审批|裁决|终审)";
// 建设性动词前缀：出现即视为「在做这个机制的工作」，而非「在做这个关口」。
const CONSTRUCTION_PREFIX = "(实现|开发|新增|添加|补|补齐|修复|修|重构|改造|调研|研究|设计|测试|验证|登记|记录|落档|梳理|审计|排查|核对现状|落盘|写|编写)";

// ① 受控提交（06 §6.7）——口诀：动词必须是「提交」且不是「提交机制/提交逻辑」。
const GATE_STEP_PATTERNS = [
  // 「受控提交」「本地提交」「隔离提交」作谓语；前置建设性动词时豁免
  new RegExp(`(?<!${CONSTRUCTION_PREFIX})(受控|本地|隔离)\\s*提交`),
  new RegExp(`(?<!${CONSTRUCTION_PREFIX})提交\\s*(并|且|与|和|、|及)\\s*(回读|同步|推送|落档)`),
  // ② Git Gate 作为**动作**（passed/passed 判定作为判据）——排除建设性语境
  new RegExp(`(?<!${CONSTRUCTION_PREFIX})(Git\\s*Gate\\s*(passed|通过)|经\\s*Git\\s*Gate)`),
  // ③ 独立复核 / 主控自查作为**执行**；「完成独立结果复核」命中
  new RegExp(`完成[^，。;；]{0,12}(独立|对抗|就绪)?\\s*(结果)?\\s*复核`),
  new RegExp(`(?<!${CONSTRUCTION_PREFIX})(独立|对抗)\\s*(结果)?\\s*复核(?!\\s*(模块|算法|机制|字段|逻辑|实现|入口|校验))`),
  new RegExp(`完成\\s*独立\\s*(结果)?\\s*审核`),
  /主控\s*自查/,
  // ④ Gate 批准本身作为**执行**（「执行 Gate 2 关闭」「提请 Human 批准」）
  new RegExp(`(执行|进行|完成|发起|提请)\\s*Gate\\s*[12]`, "i"),
  new RegExp(`${GATE_EXECUTION_VERBS}\\s*(Human\\s*)?(批准|审批|裁决|终审)`),
  /(受控|完成)?\s*关闭提案/,
  // ⑤ 三件套的收尾并列形态（v5 现存写法，本身即制度收尾）
  /(验证|跑|过)?\s*三件套/,
];

/** 命中的关口模式（返回描述性标签，供拒绝信息使用）。 */
function detectLifecycleGate(step, doneCriteria) {
  const haystack = `${step ?? ""}\n${doneCriteria ?? ""}`;
  const hits = [];
  for (const pattern of GATE_STEP_PATTERNS) {
    const m = pattern.exec(haystack);
    if (m && m[0].trim().length > 0) hits.push(m[0].trim());
  }
  return [...new Set(hits)];
}

/**
 * 21 §6.1 关口门禁的适用范围判定（2026-09-18，Human 裁定方案 1）。
 *
 * 门禁针对的是「把关口**写成**计划」这一**面向未来**的行为，不是惩罚
 * **已经写在计划里的历史记录**。故只在 plan 相对基线的**新增或改动**项上生效：
 *
 *   - 基线缺失（create / 无既有对象）：全部 plan 项皆为新，全部受检；
 *   - 有基线：仅 `baselinePlan[i]` 不存在（新增项）或内容不等（改动项）时受检；
 *     **逐字未改的既有项放行**。
 *
 * 理由（实测，2026-09-18）：存量 open 工单中 5 个已执行完毕、正待 Gate 2 关闭，
 * 其 plan 末尾的关口步是**已兑现判据的历史记录**。若一律拒绝，则 `close` 写入
 * 也被挡住 —— 而 close 是唯一出口，且 WorkCase 无删除操作（21 §14），会造成真实
 * 死锁。逐字放行使「保留历史原样」与「门禁生效」不再冲突：历史不可改写，未来
 * 不可再写。
 *
 * 注意这不构成豁免：任何**改动**既有项（哪怕只改一字）都会使它重新受检。
 * 同位置的内容比对按 step+done_criteria 的精确字符串，不做归一化——归一化会
 * 制造「一个空格」式的绕过面。
 */
/**
 * 计划项是否相对基线**新增或改动**。
 *
 * 21 §6.1 的适用范围纪律：门禁针对「把关口**写成**计划」这一**面向未来**的行为，
 * 不是惩罚已经写在计划里的历史记录。故只在 plan 相对基线的**新增或改动**项上生效：
 *
 *   - 基线缺失（create / 无既有对象）：全部 plan 项皆为新，全部受检；
 *   - 有基线：仅 `baselinePlan[i]` 不存在（新增项）或内容不等（改动项）时受检；
 *     **逐字未改的既有项放行**。
 *
 * 理由（实测，2026-09-18）：存量 open 工单中 5 个已执行完毕、正待 Gate 2 关闭，
 * 其 plan 末尾的关口步是**已兑现判据的历史记录**。若一律拒绝，则 `close` 写入
 * 也被挡住 —— 而 close 是唯一出口，且 WorkCase 无删除操作（21 §14），会造成真实
 * 死锁。逐字放行使「保留历史原样」与「门禁生效」不再冲突：历史不可改写，未来
 * 不可再写。
 *
 * 注意这不构成豁免：任何**改动**既有项（哪怕只改一字）都会使它重新受检。
 * 同位置的内容比对按 `step`+`done_criteria` 的精确字符串，不做归一化——归一化会
 * 制造「一个空格」式的绕过面。
 */
function planItemNeedsGateCheck(item, baselineItem) {
  if (baselineItem === undefined) return true;                  // 新增项
  return !(item.step === baselineItem.step && item.done_criteria === baselineItem.done_criteria);
}

function validatePlanShape(frontmatter, issues, baselinePlan = null) {
  if (!Array.isArray(frontmatter.plan) || frontmatter.plan.length === 0) {
    issues.push("plan: must be a non-empty array of {step, done_criteria} (21 §8)");
    return;
  }
  const baseline = Array.isArray(baselinePlan) ? baselinePlan : null;
  frontmatter.plan.forEach((item, i) => {
    if (!isPlainObject(item)) {
      issues.push(`plan[${i}]: must be an object of shape {step, done_criteria}`);
      return;
    }
    const extra = Object.keys(item).filter((k) => k !== "step" && k !== "done_criteria");
    if (extra.length > 0) issues.push(`plan[${i}]: unexpected field(s) ${extra.join(", ")} (only step/done_criteria, 21 §8)`);
    if (typeof item.step !== "string" || item.step.trim().length === 0) {
      issues.push(`plan[${i}].step: required non-empty`);
    }
    if (typeof item.done_criteria !== "string" || item.done_criteria.trim().length === 0) {
      issues.push(`plan[${i}].done_criteria: required non-empty and evidence-decidable (21 §6.1/§8)`);
    }
    // 21 §6.1：plan 不得承载生命周期关口（机械门禁，2026-09-18）。
    // 只查 plan 内容；不查正文（§6.1 末段明文）。
    // 只查新增/改动的项；逐字未改的既有项是历史记录，放行（见上方说明）。
    if (!planItemNeedsGateCheck(item, baseline?.[i])) return;
    const gates = detectLifecycleGate(item.step, item.done_criteria);
    if (gates.length > 0) {
      issues.push(
        `plan[${i}]: step/done_criteria reads as a WorkCase lifecycle gate (${gates.join(" / ")}) — `
        + "plan carries only this work package's own implementation work; 受控提交/独立复核/主控自查/Gate 批准 "
        + "are carried by 06, 02 §15 and the status transitions (21 §6.1/§9/§14), NOT by a plan step. "
        + "Remove it from plan: the gate still happens, it just is not a plan step. "
        + "Note 21 §6.1 keeps test/lint/scan RESULTS admissible inside done_criteria and "
        + "result.criteria_checks[].evidence — only the gate-as-a-step is rejected. "
        + "(This check applies to new or modified plan items only; an item left byte-identical "
        + "to the existing object is an unrewritable historical record and passes.)",
      );
    }
  });
}

function validateGate1(frontmatter, issues) {
  const g = frontmatter.gate_1;
  if (!isPlainObject(g)) {
    issues.push("gate_1: must be an object {approved_at, approver, authorization_fingerprint, scope_snapshot} (21 §8)");
    return;
  }
  const extra = Object.keys(g).filter((k) => !["approved_at", "approver", "authorization_fingerprint", "scope_snapshot"].includes(k));
  if (extra.length > 0) issues.push(`gate_1: unexpected field(s) ${extra.join(", ")}`);
  if (typeof g.approved_at !== "string" || !RFC3339_PATTERN.test(g.approved_at)) {
    issues.push("gate_1.approved_at: required RFC3339");
  }
  if (typeof g.approver !== "string" || g.approver.length === 0) {
    issues.push("gate_1.approver: required non-empty (the approving Human identity)");
  }
  if (typeof g.authorization_fingerprint !== "string" || !FINGERPRINT_PATTERN.test(g.authorization_fingerprint)) {
    issues.push("gate_1.authorization_fingerprint: required 64-hex SHA-256 content fingerprint over plan+scope (Code-computed, 21 §10.1)");
  }
  if (typeof g.scope_snapshot !== "string" || g.scope_snapshot.length === 0) {
    issues.push("gate_1.scope_snapshot: required non-empty snapshot of the approved scope (21 §10.1)");
  }
}

function validateAttempt(frontmatter, issues) {
  const a = frontmatter.attempt;
  if (!isPlainObject(a)) {
    issues.push("attempt: must be an object {attempt_id, started_at, controller, heartbeat_at, session_id} (21 §8)");
    return;
  }
  const extra = Object.keys(a).filter((k) => !["attempt_id", "started_at", "controller", "heartbeat_at", "session_id", "session_source"].includes(k));
  if (extra.length > 0) issues.push(`attempt: unexpected field(s) ${extra.join(", ")}`);
  if (!Number.isInteger(a.attempt_id) || a.attempt_id < 1) {
    issues.push("attempt.attempt_id: required positive integer (Code-allocated, monotonic, 21 §10.4)");
  }
  if (typeof a.started_at !== "string" || !RFC3339_PATTERN.test(a.started_at)) {
    issues.push("attempt.started_at: required RFC3339");
  }
  if (typeof a.controller !== "string" || a.controller.length === 0) {
    issues.push("attempt.controller: required non-empty (the current executing controller identity)");
  }
  if (typeof a.heartbeat_at !== "string" || !RFC3339_PATTERN.test(a.heartbeat_at)) {
    issues.push("attempt.heartbeat_at: required RFC3339 (refreshed at execution entry)");
  }
  // `session_id` is Code-managed and OPTIONAL in shape (21 §8): objects created
  // before workcase-2be11478 carry attempts without it, and adding a hard shape
  // requirement would make every existing object fail mechanical checks on
  // read. It is stamped at every approve/execute; the CLOSE gate is what
  // requires it to be present (fail-closed with an actionable reason).
  if (a.session_id !== undefined && (typeof a.session_id !== "string" || a.session_id.length === 0)) {
    issues.push("attempt.session_id: when present must be a non-empty string (Code-managed session identity, workcase-2be11478)");
  }
}

/**
 * 21 §8: `reviews` — 复核节点概要流水。
 *
 * 每项 `{at, provider, model, summary}`；`at`/署名由 Code 托管（此处只校验
 * 形状与存在性），`summary` 非空且 ≤ 600 字符，条数 ≤ 20。
 * 达上限 fail-closed：拒绝写入而非截断或压缩既有条目（防静默丢历史）。
 * 只读复核不产生条目，故本字段缺失是合法状态（条件字段，03 §6.1）。
 */
function validateReviews(frontmatter, issues) {
  const list = frontmatter.reviews;
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    issues.push("reviews: must be an array of {at, provider, model, summary} (21 §8)");
    return;
  }
  if (list.length === 0) {
    issues.push("reviews: must be omitted when there are no review entries — an empty array fabricates a conditional field (03 §6.1)");
    return;
  }
  if (list.length > REVIEW_ENTRIES_MAX) {
    issues.push(`reviews: exceeds the ${REVIEW_ENTRIES_MAX}-entry cap (21 §8); refuse rather than truncate or compress existing entries`);
  }
  list.forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      issues.push(`reviews[${i}]: must be an object {at, provider, model, summary, session_id}`);
      return;
    }
    const extra = Object.keys(entry).filter((k) => !["at", "provider", "model", "summary", "session_id", "session_source", "implementer_session_id", "implementer_session_source"].includes(k));
    if (extra.length > 0) issues.push(`reviews[${i}]: unexpected field(s) ${extra.join(", ")} (only at/provider/model/summary/session_id/session_source/implementer_session_id/implementer_session_source)`);
    if (typeof entry.at !== "string" || !RFC3339_PATTERN.test(entry.at)) {
      issues.push(`reviews[${i}].at: required RFC3339 (Code-managed)`);
    }
    if (typeof entry.provider !== "string" || entry.provider.length === 0) {
      issues.push(`reviews[${i}].provider: required non-empty (Code-managed authoritative signature)`);
    }
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      issues.push(`reviews[${i}].model: required non-empty (Code-managed authoritative signature)`);
    }
    // `session_id` is Code-managed and OPTIONAL in shape (21 §8): entries
    // written before workcase-2be11478 carry no identity, and a hard shape
    // requirement would make existing objects fail mechanical checks on read.
    // The CLOSE gate requires at least ONE entry to carry it (not every entry).
    if (entry.session_id !== undefined && (typeof entry.session_id !== "string" || entry.session_id.length === 0)) {
      issues.push(`reviews[${i}].session_id: when present must be a non-empty string (Code-managed session identity, workcase-2be11478)`);
    }
    if (entry.implementer_session_id !== undefined && (typeof entry.implementer_session_id !== "string" || entry.implementer_session_id.length === 0)) {
      issues.push(`reviews[${i}].implementer_session_id: when present must be a non-empty string (Code-managed; records who was executing when this review was written)`);
    }
    if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
      issues.push(`reviews[${i}].summary: required non-empty (复核节点概要)`);
    } else if (entry.summary.length > REVIEW_SUMMARY_MAX_CHARS) {
      issues.push(`reviews[${i}].summary: ${entry.summary.length} chars exceeds the ${REVIEW_SUMMARY_MAX_CHARS}-char cap (21 §8)`);
    }
  });
}

function validateResult(frontmatter, issues) {
  const r = frontmatter.result;
  if (!isPlainObject(r)) {
    issues.push("result: must be an object {criteria_checks[], achieved_scope, residual[]} (21 §8)");
    return;
  }
  const extra = Object.keys(r).filter((k) => !["criteria_checks", "achieved_scope", "residual"].includes(k));
  if (extra.length > 0) issues.push(`result: unexpected field(s) ${extra.join(", ")}`);
  if (typeof r.achieved_scope !== "string" || r.achieved_scope.length === 0) {
    issues.push("result.achieved_scope: required non-empty (已证实范围的核对结论)");
  }
  const isCancelled = frontmatter.outcome === "cancelled";
  if (r.criteria_checks !== undefined) {
    if (!Array.isArray(r.criteria_checks)) {
      issues.push("result.criteria_checks: must be an array");
    } else {
      // 逐条对应 plan[].done_criteria — length must match (21 §8 invariant).
      // cancelled may omit the array entirely (nothing was executed).
      //
      // `plan` 缺失/非数组时**不比长度**：此时没有可比的基准，且类型错误的 plan 由
      // `validatePlanShape` 单独报错（fail closed 仍成立）。原先直接读
      // `frontmatter.plan.length` 会在 plan 缺失时抛 TypeError——机械校验应当
      // **报告**不符合项，而不是崩溃（01 §12.3 第 4 维）。
      if (!isCancelled && Array.isArray(frontmatter.plan) && r.criteria_checks.length !== frontmatter.plan.length) {
        issues.push(`result.criteria_checks: length ${r.criteria_checks.length} must match plan length ${frontmatter.plan.length} (逐条对应, 21 §8)`);
      }
      r.criteria_checks.forEach((c, i) => {
        if (!isPlainObject(c)) {
          issues.push(`result.criteria_checks[${i}]: must be an object {satisfied, evidence}`);
          return;
        }
        const cExtra = Object.keys(c).filter((k) => k !== "satisfied" && k !== "evidence");
        if (cExtra.length > 0) issues.push(`result.criteria_checks[${i}]: unexpected field(s) ${cExtra.join(", ")}`);
        if (typeof c.satisfied !== "boolean") issues.push(`result.criteria_checks[${i}].satisfied: required boolean`);
        if (typeof c.evidence !== "string" || c.evidence.trim().length === 0) {
          issues.push(`result.criteria_checks[${i}].evidence: required non-empty (核对依据)`);
        }
      });
    }
  } else if (!isCancelled) {
    issues.push("result.criteria_checks: required (one entry per plan step) unless outcome=cancelled (21 §9.3)");
  }
  if (r.residual !== undefined) {
    if (!Array.isArray(r.residual)) {
      issues.push("result.residual: must be an array of strings");
    } else {
      if (r.residual.length === 0 && RESIDUAL_REQUIRED_OUTCOMES.has(frontmatter.outcome)) {
        issues.push(`result.residual: must be non-empty when outcome=${frontmatter.outcome} (21 §9.3)`);
      }
      r.residual.forEach((x, i) => {
        if (typeof x !== "string" || x.trim().length === 0) issues.push(`result.residual[${i}]: required non-empty string`);
      });
    }
  } else if (RESIDUAL_REQUIRED_OUTCOMES.has(frontmatter.outcome)) {
    issues.push(`result.residual: required when outcome=${frontmatter.outcome} (21 §9.3)`);
  }
}

/**
 * Mechanical frontmatter validation (21 §8 closed set + field invariants +
 * §15.1 type-specific checks). serves ⇔ goal.md resolution and relations
 * target resolution need the fact-source root and happen in the flows.
 *
 * `baselinePlan`（可选）：既有对象的当前 plan。用于 §6.1 关口门禁的适用范围
 * 判定——只有相对基线**新增或改动**的项受检，逐字未改的既有项是历史记录，
 * 放行（见 validatePlanShape 的说明）。create 与无既有对象时省略（全量受检）。
 *
 * `baselineSummary` / `baselineScope`（可选）：既有对象的当前 `summary` / `scope`。
 * 用于 §8 书写纪律的适用范围判定，同 §6.1 的形态与理由——只有**改动**的字段
 * 受检，逐字未改的既有字段放行（见 validateStructuredWriting）。
 */
export function validateWorkcaseFrontmatter(frontmatter, baselinePlan = null, baselineSummary, baselineScope) {
  const issues = [];

  for (const key of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(key)) {
      issues.push(`frontmatter: unknown field "${key}" — closed set is ${[...VALID_FM_KEYS].join("/")} (21 §8); unknown fields never enter the canonical object (03 §6.1)`);
    }
  }

  if (frontmatter.fact_type_key !== WORKCASE_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${WORKCASE_TYPE_KEY}", got ${JSON.stringify(frontmatter.fact_type_key)}`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.trim().length === 0) {
    issues.push("title: required non-empty");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} 字 (21 §8), got ${frontmatter.title.length}`);
  }
  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")} (21 §9)`);
  }
  if (typeof frontmatter.summary !== "string" || frontmatter.summary.trim().length === 0) {
    issues.push("summary: required non-empty (21 §8 — 使未读原计划的后续执行者可独立执行)");
  }
  // 21 §8: `gist` 按状态分层必填 —— draft/open 必填且 ≤ 200 字符；
  // closed 条件（终态只读、无受控入口可补写，缺失合法，见 §8 分层必填的理由）。
  // 该分层不是豁免：新建对象在 draft 期即必填，随对象延续到 closed。
  if (frontmatter.gist !== undefined) {
    if (typeof frontmatter.gist !== "string" || frontmatter.gist.trim().length === 0) {
      issues.push("gist: must be a non-empty string (21 §8 — 给 Human 扫读的一句话要点)");
    } else if (frontmatter.gist.length > GIST_MAX_CHARS) {
      issues.push(`gist: ${frontmatter.gist.length} chars exceeds the ${GIST_MAX_CHARS}-char cap (21 §8 扫读上限); 完整叙述属 summary/正文，不得截断后写入`);
    }
  } else if (frontmatter.status === "draft" || frontmatter.status === "open") {
    issues.push(`gist: required when status=${frontmatter.status} (21 §8 — draft/open 必填；closed 时条件，终态只读无入口可补写)`);
  }
  if (typeof frontmatter.scope !== "string" || frontmatter.scope.trim().length === 0) {
    issues.push("scope: required non-empty (21 §8 — 授权范围与边界, 越权拒绝的比对基准)");
  }
  // 21 §8 书写纪律（结构化）：scope 的两个标签须各占一行成段；长文本须分块且有
  // 层次标记。**适用范围同 §6.1 关口门禁**——只有**新增或改动**的字段受检，
  // 逐字未改的既有字段放行（见 validateStructuredWriting 的说明）。
  validateStructuredWriting(frontmatter, issues, baselineSummary, baselineScope);
  validatePlanShape(frontmatter, issues, baselinePlan);

  if (frontmatter.serves !== undefined) {
    if (typeof frontmatter.serves !== "string" || !SG_ANCHOR_PATTERN.test(frontmatter.serves)) {
      issues.push(`serves: must match SG-n (e.g. SG-3), got ${JSON.stringify(frontmatter.serves)}`);
    }
  }

  // ---- Field invariants (21 §8) ----
  const status = frontmatter.status;
  // gate_1 出现 ⇒ status ≠ draft；status=open ⇒ gate_1 必填 (§9.1)
  if (frontmatter.gate_1 !== undefined) {
    if (status === "draft") {
      issues.push("gate_1: must not be present while status=draft (21 §9.1)");
    } else {
      validateGate1(frontmatter, issues);
    }
  } else if (status === "open") {
    issues.push("gate_1: required when status=open (21 §9.1)");
  }
  // attempt 出现 ⇔ status=open (§8)；closed 时 attempt 已收口 (§9.1)
  if (frontmatter.attempt !== undefined) {
    if (status !== "open") {
      issues.push(`attempt: may appear only while status=open (21 §8 出现 ⇔ open), got status=${JSON.stringify(status)}`);
    } else {
      validateAttempt(frontmatter, issues);
    }
  } else if (status === "open") {
    issues.push("attempt: required when status=open (21 §9.1)");
  }
  // reviews（21 §8）：条件字段，draft 期不得出现（复核只在执行期发生）；
  // open/closed 均可携带。**重批回退时不保留**——旧复核针对旧 plan/scope，重批使
  // 授权失效，故 rebatchWorkcaseObject 显式 `delete next.reviews`，并把作废要点记入
  // change_log（21 §9.2，2026-09-17 修订：原文「不在清空之列、保留原值」与本节
  // 「draft 不得携带 reviews」不可调和，已改为「作废 + 要点留痕」）。
  if (frontmatter.reviews !== undefined) {
    if (status === "draft") {
      issues.push("reviews: must not be present while status=draft — 复核 occurs during execution, not before Gate 1 (21 §8/§9.1)");
    } else {
      validateReviews(frontmatter, issues);
    }
  }
  // result/outcome 出现 ⇔ status=closed (§8)
  if (frontmatter.result !== undefined || frontmatter.outcome !== undefined) {
    if (status !== "closed") {
      issues.push(`result/outcome: may appear only when status=closed (21 §8), got status=${JSON.stringify(status)}`);
    }
  }
  if (status === "closed") {
    if (typeof frontmatter.outcome !== "string" || !OUTCOMES.has(frontmatter.outcome)) {
      issues.push(`outcome: required one of ${[...OUTCOMES].join("/")} when status=closed (21 §8)`);
    }
    if (frontmatter.result === undefined) {
      issues.push("result: required when status=closed (21 §9.1)");
    }
  }
  if (frontmatter.outcome !== undefined && OUTCOMES.has(frontmatter.outcome)) {
    if (frontmatter.result !== undefined) validateResult(frontmatter, issues);
    if (frontmatter.outcome === "completed" && Array.isArray(frontmatter.result?.criteria_checks)) {
      const unmet = frontmatter.result.criteria_checks.filter((c) => isPlainObject(c) && c.satisfied !== true);
      if (unmet.length > 0) {
        issues.push(`outcome=completed requires every criteria_checks entry satisfied, found ${unmet.length} unmet (21 §9.3/§15.1)`);
      }
    }
  }

  // refs: ordinary content associations, not lifecycle relations (03 §7.2 / 21 §8).
  // The field is conditional: omit it when there is no association; an empty
  // array would fabricate a conditional field. Target existence/readability and
  // same-project membership are checked in each write flow before the file is
  // written, so malformed or unresolved refs are zero-write rejections.
  if (frontmatter.refs !== undefined) {
    if (!Array.isArray(frontmatter.refs) || frontmatter.refs.length === 0) {
      issues.push(`refs: must be a non-empty array of {object_uid}, or omitted when there is no association (03 §6.1)`);
    } else {
      if (frontmatter.refs.length > REFS_ENTRIES_MAX) {
        issues.push(`refs: exceeds the ${REFS_ENTRIES_MAX}-entry cap (21 §8)`);
      }
      const seen = new Set();
      for (const entry of frontmatter.refs) {
        if (!isPlainObject(entry)) {
          issues.push("refs[]: members must be objects of shape {object_uid}");
          continue;
        }
        const extra = Object.keys(entry).filter((key) => key !== "object_uid");
        if (extra.length > 0) {
          issues.push(`refs[]: entry carries fields beyond object_uid (${extra.join(", ")}) — 03 §7.2`);
        }
        const target = entry.object_uid;
        if (typeof target !== "string" || !OBJECT_UID_PATTERN.test(target)) {
          issues.push(`refs[].object_uid: must be a canonical UUIDv4, got ${JSON.stringify(target)}`);
          continue;
        }
        if (seen.has(target.toLowerCase())) {
          issues.push(`refs[]: duplicate target ${target} (03 §7.2 invariant 3)`);
        }
        seen.add(target.toLowerCase());
      }
    }
  }

  // relations: contributed-to → Pitfall, routed-to → Spark (21 §12, 2026-09-28)
  if (frontmatter.relations !== undefined) {
    if (!Array.isArray(frontmatter.relations) || frontmatter.relations.length === 0) {
      issues.push("relations: must be a non-empty array of {relation_key: contributed-to|routed-to, target: {object_uid}} — omit when there is none (03 §6.1)");
    } else {
      // 去重口径（21 §15.1「关系闭集」条，2026-09-28 登记）：判定键是
      // `relation_key::target`（大小写不敏感），**不是** target 单独一项。两处含义：
      //
      //   ① 跨 relation key 的同目标**不是**重复——`routed-to → X` 与
      //      `contributed-to → X` 是两条指向不同事实类型的关系，各自独立成立
      //      （03 §7.2 不变量 3：同义重复的判定权在定义该关系的类型来源）；
      //   ② `routed-to` 的同键同目标**允许重复**——每条「转入 Spark」建议须有
      //      **恰一条**对应关系（§8/§15.1 去向完整性），故两条残留都转入同一
      //      Spark 时必然要求两条同 uid 的边。这是「按条对应」的承载，不是同义重复。
      //      `contributed-to` 无此逐条对应义务，同键同目标仍是同义重复，一律拒绝。
      const seen = new Set();
      for (const entry of frontmatter.relations) {
        if (!isPlainObject(entry)) { issues.push("relations[]: members must be objects"); continue; }
        if (!ALLOWED_RELATION_KEYS.has(entry.relation_key)) {
          issues.push(`relations[].relation_key: must be "contributed-to" or "routed-to" (21 §12 关系闭集), got ${JSON.stringify(entry.relation_key)} — fail closed`);
        }
        const target = entry.target?.object_uid;
        if (typeof target !== "string" || !OBJECT_UID_PATTERN.test(target)) {
          issues.push(`relations[].target.object_uid: must be a canonical UUIDv4 (target of ${entry.relation_key === "routed-to" ? "routed-to → Spark" : "contributed-to → Pitfall"}, 21 §12), got ${JSON.stringify(target)}`);
        } else {
          const dedupe = `${entry.relation_key}::${target.toLowerCase()}`;
          if (entry.relation_key !== "routed-to" && seen.has(dedupe)) {
            issues.push(`relations[]: duplicate relation ${entry.relation_key} → ${target} (21 §15.1; 03 §7.2 invariant 3)`);
          }
          seen.add(dedupe);
        }
      }
    }
  }

  if (typeof frontmatter.created_at !== "string" || !RFC3339_PATTERN.test(frontmatter.created_at)) {
    issues.push("created_at: required RFC3339 (Code-assigned; AI must not fill it, 21 §7)");
  }
  if (!Array.isArray(frontmatter.change_log) || frontmatter.change_log.length === 0) {
    issues.push("change_log: required array (create writes the first entry)");
  } else {
    frontmatter.change_log.forEach((e, i) => {
      if (!isPlainObject(e) || typeof e.summary !== "string" || e.summary.length === 0) {
        issues.push(`change_log[${i}]: required {at, summary} with non-empty summary`);
      }
    });
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Body validation + carrier coherence (21 §8 正文承载)
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {boolean} opts.hasExecution — status=open, or closed with gate_1
 *   (i.e. execution actually happened). draft never carries 执行.
 * @param {boolean} opts.requireResult — status=closed requires 结果;
 *   open may carry it as a Gate 2 draft (21 §8 条件出现), draft may not.
 * @param {string|null} opts.outcome — frontmatter outcome; `cancelled` additionally
 *   requires the 结果 section to carry a cancellation record (21 §8/§15.1).
 */
export function validateWorkcaseBodyStructure(body, title, opts) {
  const issues = [];
  const { hasExecution, requireResult, outcome: frontmatterOutcome = null } = opts;
  // 执行/结果 are conditional (21 §8):
  //   - 执行 appears iff execution happened (status=open, or closed with gate_1);
  //   - 结果 is REQUIRED when closed, but MAY appear while open as the Gate 2
  //     draft — the very shape the v5 three-state view reads as `awaiting_gate2`
  //     (deriveWorkCaseV5View). Treating 结果 as expected-only-when-closed made
  //     that state unreachable (Friction bf73fad4).
  const expected = [...BODY_H2_CORE];
  if (hasExecution) expected.push(BODY_H2_EXECUTION);
  expected.push(BODY_H2_RESULT);

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty.trimEnd().replace(/^ {0,3}/, "").replace(/(?<=^#+)[ \t]+/, " ") !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 21 §8)`);
  }
  const h1Count = countAtxHeadings(body, 1);
  if (h1Count !== 1) {
    issues.push(`body: expected exactly 1 H1 heading, found ${h1Count} (21 §8: 正文自 H2 起)`);
  }

  const h2 = h2Titles(body);
  // H2 数值闭集（21 §8）：清单之外不得出现任何 H2。
  //
  // 只拦「未登记」的标题；已登记标题的出现条件由下方各自分支负责，故不在此重复。
  // `h2Titles` 按 CommonMark 语义跳过 fenced code block，故正文里作为**字面内容**
  // 出现的 `## xxx`（示例、模板、被引用的规范片段）不会误伤；`###` 亦不计入 H2，
  // 故 §8 书写结构的 `### 标签` 分块标记不受影响。
  for (const title of h2) {
    if (!BODY_H2_ALLOWED.includes(title)) {
      issues.push(`body: unexpected H2 section "## ${title}" — the H2 set is closed (21 §8: ${BODY_H2_ALLOWED.join(" / ")}); 未登记的标题不属于任何字段的正文承载`);
    }
  }
  // 执行 requires that execution actually happened (status=open, or closed with
  // gate_1) — a pure draft never carries it.
  if (!hasExecution && h2.includes(BODY_H2_EXECUTION)) {
    issues.push(`body: "## 执行" must not be present before Gate 1 (draft carries no execution, 21 §8)`);
  }
  // 结果 is NOT gated on execution: 21 §9.2 defines a legal `draft → closed
  // (outcome=cancelled)` transition in which `result` records the cancellation
  // reason and the range that never happened — so a draft being closed DOES
  // carry 结果. Both open (Gate 2 draft) and that closed path may therefore
  // present 结果.
  //
  // 反向仍被禁止：**既不处于执行期、也不在关闭**的 draft 不得携带 结果。
  // 该情形恰好等价于 `!hasExecution && !requireResult`（见四个状态的穷举：
  // draft 未关闭 / open / closed-with-gate_1 / draft→closed-cancelled）。
  //
  // 此前本项**没有任何守卫**：旧注释声称「已由 requireResult 与调用方的状态配对
  // 拦住」，但 requireResult 在 draft 未关闭时为 false，而调用方的状态配对只覆盖
  // frontmatter 的 `result` 字段，不覆盖正文的 `## 结果` 节——实测一个未关闭的
  // draft 携带「## 结果」可以通过创建（注释描述的保护并不存在）。现补上该守卫。
  if (!hasExecution && !requireResult && h2.includes(BODY_H2_RESULT)) {
    issues.push(`body: "## 结果" must not be present for a draft that is neither executing nor closing (21 §8/§9.1 — 结果 is the carrier of the closure proposal; a bare draft has no result to record)`);
  }
  if (requireResult && !h2.includes(BODY_H2_RESULT)) {
    issues.push(`body: "## 结果" required when status=closed (21 §8)`);
  }
  // Order check over the sections that ACTUALLY appear: the present set must be
  // a prefix-preserving subsequence of [core..., 执行, 结果]. 结果 may legitimately
  // be absent while open (Gate 2 draft not yet written) — comparing against the
  // full expected list unconditionally is what broke awaiting_gate2.
  const present = expected.filter((t) => h2.includes(t));
  const filtered = h2.filter((t) => expected.includes(t));
  if (filtered.length !== present.length) {
    issues.push(`body: expected H2 sections (${present.join(" / ")}), found ${filtered.join(" / ") || "none"}`);
  } else {
    for (let i = 0; i < present.length; i++) {
      if (filtered[i] !== present[i]) {
        issues.push(`body: H2 #${i + 1} expected "${present[i]}", found "${filtered[i]}"`);
      }
    }
  }
  // Non-empty core sections
  for (const sec of BODY_H2_CORE) {
    const content = sectionContent(body, sec);
    if (content === null || content.length === 0) issues.push(`body: section "${sec}" is missing or empty`);
  }
  if (hasExecution) {
    const content = sectionContent(body, BODY_H2_EXECUTION);
    if (content === null || content.length === 0) issues.push(`body: section "${BODY_H2_EXECUTION}" is missing or empty`);
  }
  if (h2.includes(BODY_H2_RESULT)) {
    const content = sectionContent(body, BODY_H2_RESULT);
    if (content === null || content.length === 0) issues.push(`body: section "${BODY_H2_RESULT}" is present but empty`);
  }
  // 取消记录完备性（21 §8 / §15.1，Human 2026-09-24）：`outcome = cancelled` 时，
  // 「## 结果」节须含均非空的「理由」与「未发生的范围」两行。
  //
  // 该要求的**依据是规范原文而非本实现**：§9.2 状态转换表已写「`result` 记录取消理由
  // 与未发生的范围」，§9.3 outcome 四值表已写「记录取消理由与实际未发生的范围」——
  // 但此前**没有任何机械锚点**（`validateResult` 只要求 `achieved_scope` 非空，故
  // 「本工单取消」四字同样通过写入）。本条只把既有要求接到机械层，不新增义务。
  //
  // 注意判据取 **outcome 值**而非 action：`cancel`（draft→closed）会置 cancelled，
  // 而 `close` 的 outcome 来自调用方，同样可为 cancelled（§9.3 四值之一）。
  if (frontmatterOutcome === "cancelled") {
    const content = sectionContent(body, BODY_H2_RESULT) ?? "";
    const record = parseCancellationRecord(content);
    if (record === null) {
      issues.push(`body: "## 结果" must carry a cancellation record (- cancellation: with 理由 / 未发生的范围) when outcome=cancelled (21 §8/§9.2/§9.3)`);
    } else {
      if (record.reason.length === 0) {
        issues.push(`body: cancellation record "**理由**：" must be non-empty when outcome=cancelled (21 §9.2 — 记录取消理由)`);
      }
      if (record.unstartedScope.length === 0) {
        issues.push(`body: cancellation record "**未发生的范围**：" must be non-empty when outcome=cancelled (21 §9.2 — 记录未发生的范围)`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * 解析「## 结果」节里的取消记录（21 §8）。与呈现层
 * `plugin/web/shared/workcaseResultDraft.ts` 的 `parseWorkCaseCancellation`
 * **同形态**——两棵树互不 import（`lib` 与 `web` 独立，见 `markdown-structure.js`
 * 的同类先例），故此处保留一份实现；形态由 §8 单点登记，两处都只实现它。
 *
 * 任一行缺失或为空时对应字段记空串（不猜、不填占位），调用方据此判定「不完整」。
 * 无 `- cancellation:` 段时返回 null（非取消对象）。
 */
function parseCancellationRecord(resultSection) {
  const LABELS = ["理由", "未发生的范围"];
  const block = /^(cancellation|取消记录)\s*[:：]?$/;
  const line = /^\*\*(.+?)\*\*\s*[:：]\s*([\s\S]*)$/;
  const found = {};
  let seen = false;
  let mode = false;
  let modeIndent = 0;
  for (const rawLine of String(resultSection).split("\n")) {
    const bullet = /^(\s*)-\s+(.*)$/.exec(rawLine);
    if (!bullet) continue;
    const indent = bullet[1].length;
    const item = bullet[2].trim();
    if (!mode) {
      if (block.test(item)) { mode = true; modeIndent = indent; seen = true; }
      continue;
    }
    if (indent <= modeIndent && !line.test(item)) { mode = false; continue; }
    const m = line.exec(item);
    if (!m) continue;
    const label = m[1].trim();
    if (LABELS.includes(label) && found[label] === undefined) found[label] = m[2].trim();
  }
  if (!seen) return null;
  return { reason: found["理由"] ?? "", unstartedScope: found["未发生的范围"] ?? "" };
}

// ---------------------------------------------------------------------------
// 去向完整性（21 §8 / §15.1 / §16，2026-09-28）
// ---------------------------------------------------------------------------

/**
 * 去向词闭集（`21 §8`，Human 裁决 2026-09-28：由四词收为二词）。
 * 二词按**责任去哪**分：接受现状＝明确不跟踪、就此了结（须给非空理由）；
 * 转入 Spark＝转为 Spark 悬置议题待裁（须有对应 `routed-to`）。
 */
const DIRECTION_KINDS = new Set(["接受现状", "转入 Spark"]);
/** 残留段开启符（`21 §8`）：`- residual:` / `- 残留责任:`，冒号可省。 */
const RESIDUAL_BLOCK = /^(residual|残留责任)\s*[:：]?$/;
/**
 * 旧形态的**独立建议段**开启符（`- advice:` / `- 建议:`）。
 *
 * `21 §8`（2026-09-28 二次修订）已把去向改为**长在每条残留里面**的去向子项，
 * 并明文「**不再另设独立的建议段**」。故本式在新形态下**不是**一个可识别的段
 * ——它的出现即形态错误，由 `validateDirectionCompleteness` 拒绝并给出可操作文案。
 */
const ADVICE_BLOCK = /^(advice|建议)\s*[:：]?$/;
/** 去向子项形态（`21 §8`）：去向词以 `**` 包裹并位于行首，后接 `：`（冒号可省）。 */
const ADVICE_TITLED = /^\*\*(.+?)\*\*\s*[:：]?\s*([\s\S]*)$/;
/**
 * 存量尾注 `出自「…」`（2026-09-28 前的分离式形态，`§15.3` 存量不溯及）。
 *
 * **该尾注已退休**（`§8`「为什么合并为一段」）：它存在的前提是两段分离、需人工
 * 回指，合并为「残留 + 去向子项」后该前提消失。此处保留剥离**只**为存量载体
 * ——存量正文里还写着它，若不剥离就会把「某条残留」这类元信息当成去向正文。
 * 它不是新特性，也不产出任何字段。
 */
const ADVICE_LEGACY_FROM = /出自「([^」]+)」\s*$/;

/**
 * 解析「## 结果」节的**残留段及其去向子项**（`21 §8`，2026-09-28 二次修订后的
 * 登记形态）。与呈现层 `plugin/web/shared/workcaseResultDraft.ts` 的
 * `parseWorkCaseResultDraft` **同形态**——两棵树互不 import（`lib` 与 `web` 独立，
 * 见 `markdown-structure.js` 的同类先例），故此处保留一份实现；形态由 `§8` 单点
 * 登记，两处都只实现它。**两处必须逐案同数**（`§15.1` 的条数门禁若在两处给出不同
 * 结论即失去意义），故「多开启符不累积」等口径两处一致。
 *
 * 登记形态（`§8`）：
 *
 * ```
 * - residual:
 *   - <残留正文：还剩什么>
 *     - **<去向词>**：<打算怎么办>
 * ```
 *
 * 语义（与 `§15.1`「去向完整性」的三条判据边界逐字对应）：
 *   - 残留段由 `- residual:`（或 `- 残留责任:`）开启，**与开启符同级或更浅**的
 *     下一个 bullet 收束（同取消记录的收束规则）。故与开启符同级或更浅的条目
 *     **不属于残留段**（按零条计，`§15.1` 判据边界第一条）；
 *   - 残留条目须比开启符**更深**；**比残留条目更深**的 bullet 一律计为该残留的
 *     **去向子项**——即使它不达 `- **<去向词>**：<正文>` 形态（此时 `kind` 记
 *     `null`，由门禁⑥拒绝，**不静默丢弃**、也不当作新残留条目）。这是 `§15.1`
 *     判据边界第三条明文要求的读法；
 *   - 去向子项**不累积到别的残留**：它只挂在其上方的**最近一条**残留条目上；
 *   - 与残留条目**同级或更浅**的去向条目不构成该残留的子项（按零条计），此时它
 *     自己成为一条新残留条目——条数因此变化，由门禁②或③判出（`§15.1` 判据边界
 *     第一、二条）；
 *   - **段不累积**：一个开启符进入残留段，下一个开启符（任意缩进）即闭合并计数，
 *     其后条目不再计入**该段**；`blocks` 报告整节开启符总数，故 `blocks > 1` 时由
 *     硬门禁①整体拒绝（规范上没有任何一段是权威，条数不具定义——不是「取哪一段」
 *     的分歧，`§15.1` 已登记「不得择一推断条数」）。
 *     该口径必须与呈现层解析器逐字一致。
 *   - `adviceBlocks` 另计**旧形态独立建议段**的开启符总数（与残留段解析无关）：
 *     `§8` 已明文「不再另设独立的建议段」，故它 > 0 时由调用方拒绝。
 *
 * **为什么导出**：它是「两处同口径」里**写入侧的那一份**——呈现层在
 * `plugin/web/shared/workcaseResultDraft.ts` 里有一份对应实现（两棵树互不 import）。
 * `§15.1` 门禁②（条数 = `result.residual` 长度）只在两处给出**相同条数**时才有意义，
 * 故跨树的一致性守卫（`plugin/web/tests/api/workcase-direction-parity-contract.test.ts`）
 * 需要**直接量到**本函数的输出，而不是从 `validateDirectionCompleteness` 的失败文案里
 * 反推条数——反推会在「解析静默少读一条、而门禁恰好未触发」时与呈现层给出同一错值，
 * 使守卫失去判别力。导出只为此，它不是新的受控入口，也不改变任何写入行为。
 */
export function parseResidualSection(resultSection) {
  const entries = [];
  let seen = false;
  let blocks = 0;
  let adviceBlocks = 0;
  let mode = false;
  let modeIndent = 0;
  let entryIndent = null;
  for (const rawLine of String(resultSection).split("\n")) {
    const bullet = /^(\s*)-\s+(.*)$/.exec(rawLine);
    if (!bullet) continue;
    const indent = bullet[1].length;
    const item = bullet[2].trim();
    const opener = RESIDUAL_BLOCK.test(item);
    // 旧形态的独立建议段开启符：**与残留段归属无关**地计数——「不再另设独立的
    // 建议段」是形态前提（§8），不是「段内还是段外」的归属问题。
    if (ADVICE_BLOCK.test(item)) adviceBlocks += 1;
    if (!mode) {
      if (opener) { mode = true; modeIndent = indent; entryIndent = null; seen = true; blocks += 1; }
      continue;
    }
    if (opener || indent <= modeIndent) {
      if (opener) blocks += 1;
      mode = false;
      continue;
    }
    if (entryIndent === null || indent <= entryIndent) {
      entryIndent = indent;
      entries.push({ text: item, directions: [] });
      continue;
    }
    // 比残留条目更深 → 该残留的去向子项（不达形态者也计，由门禁⑥拒绝）。
    const last = entries[entries.length - 1];
    const titled = ADVICE_TITLED.exec(item);
    const kindText = titled ? titled[1].trim() : "";
    let text = titled ? titled[2].trim() : item;
    const fromMatch = ADVICE_LEGACY_FROM.exec(text);
    if (fromMatch) text = text.slice(0, fromMatch.index).trim();
    last.directions.push({ kind: DIRECTION_KINDS.has(kindText) ? kindText : null, kindText, text });
  }
  return { present: seen, blocks, adviceBlocks, entries };
}

/**
 * 去向完整性（`21 §8` 字段间不变量 / `§15.1` / `§16`）。**分档**：结构硬门禁 +
 * 写法约定 + 语义软约束。
 *
 * **形态前提（2026-09-28 二次修订）**：去向不再是独立的一段，而是**长在每条残留
 * 里面**——正文「## 结果」节的 `- residual:` 段下，每条残留条目自带一个去向子项
 * （`§8`）。故本项的数对象由「建议段 vs `result.residual`」两个集合改为「残留段
 * 条目 ↔ 去向子项」的**主从结构**。以下六组编号与 `§8`「综上，本条中的机械门禁共
 * 六条」及 `§15.1`「硬门禁（机械执行，写入一律拒绝）」**逐字一致**：
 *
 *   ① 残留段**恰好一处**——整节出现两处及以上 `- residual:`／`- 残留责任:` 开启符
 *      者一律拒绝（多段形态下没有任何一段是权威、条数不具定义，且会使门禁②随读取
 *      方不同而给出不同结论）。**本项状态无关**；
 *   ② 残留段条目数 = `result.residual` 长度；`residual` 为空时不得有残留段；
 *   ③ **每条残留恰有一个去向子项**——子项须比该残留条目**更深**（登记形态为再缩进
 *      2 个空格）且形如 `- **<去向词>**：<正文>`；缺子项、或多于一个子项者一律拒绝；
 *   ④ `residual` 每出现一条「转入 Spark」，`relations` 中须恰有一条对应的
 *      `routed-to`（**条数一致**）；
 *   ⑤ 每条「接受现状」的去向正文非空（去空白后长度 > 0）；
 *   ⑥ 每条去向词落在闭集二词内（不达形态者按零条计，不静默丢弃）。
 *
 * **① 与 ②–⑥ 的适用面不同（必须合读，`§15.1` 首段）**：②–⑥ 只在 `status = closed`
 * 且 `outcome ≠ cancelled` 时判定，而 **① 状态无关**——凡「## 结果」节出现残留段即
 * 适用。理由：残留段正是**开放期**写入的承载（`§8`），若 ① 随状态一起缺省，多段正文
 * 可在 `open` 期经受控入口落盘，而两处解析器都只读一段 ⇒ 第二段条目「正文里有、
 * 卡面不可见」，直到关闭才被拦。
 *
 * **旧形态的独立建议段（`§8` 形态前提，不在六组门禁之列）**：`§8` 明文「不再另设
 * 独立的建议段」。故正文出现 `- advice:`／`- 建议:` 开启符时拒绝并给出可操作文案
 * （把每条去向移到其所属残留之下、作为更深一层的子项）。该项与 ① 同为**状态无关**
 * ——形态前提不因对象尚未关闭而失效。
 *
 * 写法约定（本项**不**判定，如实登记、非机械门禁）：**顺序对应**——去向子项只写去向
 * 词与正文，**不携带**目标 Spark 的标识，故「第 k 条「转入 Spark」↔ `relations` 中第
 * k 条 `routed-to`」在机械上不可核验（实测：把 `relations` 数组顺序对调仍全部通过）。
 * 「第 k 条去向 ↔ 第 k 条残留」**已不属本项**：合并为「残留 + 去向子项」后该对应由
 * 结构承载，不再是写法约定（`§8`/`§15.1`）。
 *
 * 软约束（本节不判定，归 AI 语义审核与 Human 阅读）：去向**选择**是否恰当、理由是
 * 否成立、是否构成实质挂起、**去向正文是否自足**、目标 Spark 语义上是否真的容纳该
 * 残留。
 *
 * **适用范围（存量不溯及的口径，`§15.1`/`§15.3`）**：基线**已是 closed** 的写入
 * （`correct`）只有在**改动了「## 结果」节**时才受本项约束——存量 closed 对象是
 * **分离式**（`- residual:` 陈述残留、`- advice:` 陈述去向），按当时四词书写、且
 * **从无** `routed-to`（实测 17 份 closed 中有 6 份**去向条数**少于 `residual` 长度（旧形态为「建议段」；新形态下建议段已不合法，见下方形态前提），
 * 另 1 份含「转入 Spark」却无 `routed-to`），若对 `correct` 无条件套用，这些对象的
 * **任何**更正（含与去向无关的事实更正）都会被拒，与 `§15.3` 的存量不溯及直接冲突。
 * 豁免基准是**「## 结果」节逐字未改**（非「解析出的条目列表深等」——条目级比较只覆盖
 * `- ` 条目，会放过改写尾注、加缩进续行、加整段散文、改缩进四类正文编辑，2026-09-28
 * 更正）；`baselineBody` 缺失时**按已改动处理**（fail closed：未知不等于未改动）。
 * **该判定发生在其后所有门禁之前**（`§16` 验证表：「存量豁免见 §15.3——基线为
 * `closed` 且「## 结果」节逐字未改时整体放行」）。
 *
 * **存量普查的实测口径（2026-09-28，走真实校验器而非正则）**：closed 17 份，
 * `result.residual` 共 78 条，建议段共 56 条；条数不符 **6** 份
 * （`workcase-18fcee2c` 6:3、`workcase-1c6afa19` 4:2、`workcase-364df30e` 8:3、
 * `workcase-4af2b871` 10:8、`workcase-8d2ba256` 8:5、`workcase-99957f65` 8:1）；
 * 含「转入 Spark」而无 `routed-to` 恰 1 份（`workcase-8f4742f5`）。那 6 份的 22 条
 * 残留**当年就没有去向**，且补写即属编造（`§15.3`），故呈现层另有**条件豁免**
 * （10 §5.5：不满足「每条残留都带有去向子项」者如实保留残留块）。
 *
 * **本项在存量改写通道上的已知限制（如实登记）**：`correct` 不接收 frontmatter，
 * 且 closed 对象无 `execute` 通道，故存量去向里的「转入 Spark」条目**无法**在改写时
 * 补齐 `routed-to`——存量改写只有三种可行写法：写成「接受现状」（含非空理由）并如实
 * 说明原意向、保持「## 结果」节逐字不动、或由 Human 另行决定处置。本项不代替该决定。
 */
export function validateDirectionCompleteness(frontmatter, body, baseline = null, baselineBody = null) {
  const issues = [];
  const isClosed = frontmatter.status === "closed";
  const isCancelled = frontmatter.outcome === "cancelled";

  const residual = Array.isArray(frontmatter.result?.residual) ? frontmatter.result.residual : [];
  const section = parseResidualSection(sectionContent(body, BODY_H2_RESULT) ?? "");
  const relations = Array.isArray(frontmatter.relations) ? frontmatter.relations : [];
  const routedTo = relations.filter((entry) => entry?.relation_key === "routed-to");
  const directions = section.entries.flatMap((entry, entryIndex) =>
    entry.directions.map((direction) => ({ ...direction, entryIndex })));

  // 存量豁免（§15.3 存量不溯及）的**实际基准是「## 结果」节整体逐字未改**，
  // 不是「解析出的条目列表深等」。2026-09-28 更正：早前的条目级比较只覆盖
  // `- ` 条目，正文内在条目之外的任何编辑（改写尾注、加缩进续行、加整段散文、
  // 改缩进）都能在新门禁下自由通过，实测四类逃逸全部被放行——那是登记为
  // 「窄豁免」、实际却是「结果节正文自由编辑通道」的防自欺缺口（01 §12.3 第 6 维）。
  // 逐字比较整节后，任何改动该节的写入都受检（fail closed），未触碰该节的更正照常放行。
  // `baselineBody` 缺失时**按已改动处理**（未知不等于未改动）。
  //
  // **本判定必须先于其后所有门禁**（§16 验证表）：存量分离式对象不满足新形态，
  // 若先跑 ① 或「不再另设独立建议段」再判豁免，存量对象**不触碰「## 结果」节**的
  // `correct` 会被误拒——那正是 §15.3 要避免的（存量不溯及）。
  if (baseline && baseline.status === "closed" && typeof baselineBody === "string") {
    const baselineResult = sectionContent(baselineBody, BODY_H2_RESULT);
    const currentResult = sectionContent(body, BODY_H2_RESULT);
    if (baselineResult !== null && currentResult !== null && baselineResult === currentResult) {
      return { ok: true, issues };
    }
  }

  // ① 残留段恰好一处——**状态无关**：残留段本身正是开放期写入的承载（§8），
  // 若本项随「仅 closed 判定」一起缺省，多段正文可在 open 期经受控入口落盘，
  // 而两处解析器都只读一段 → 第 2 段条目「正文里有、卡面不可见」，直到关闭才被拦。
  // 故本项在闭合前先判；②–⑥ 仍只在 closed 且非 cancelled 时判定。
  if (section.blocks > 1) {
    issues.push(`direction completeness: 门禁① "## 结果" 残留段 must appear exactly once — found ${section.blocks} residual section openers (- residual: / - 残留责任:) (21 §8/§15.1 硬门禁①，状态无关); no section is authoritative when several are present, so the entry count is not well-defined and 门禁② would differ by reader — 不得择一推断条数，须按不符报告 — fail closed`);
  }

  // 旧形态的独立建议段（§8 形态前提：「不再另设独立的建议段」）——同为**状态无关**。
  // 该项**不在 §15.1 六组硬门禁之列**，如实按形态前提报告，不冒充门禁编号。
  if (section.adviceBlocks > 0) {
    issues.push(`direction completeness: "## 结果" 不得另设独立的建议段 — found ${section.adviceBlocks} advice section opener(s) (- advice: / - 建议:); 21 §8 (2026-09-28 二次修订) 已把去向改为长在每条残留里面的**去向子项**，独立建议段不再是登记形态。可操作处置：删去该段，把每条去向移到其所属残留条目之下、作为**更深一层**的子项，形如 "- residual:" / "  - <残留正文>" / "    - **<去向词>**：<正文>"; 该项与门禁①同为状态无关，不因对象尚未关闭而放行 — fail closed`);
  }

  if (!isClosed || isCancelled) return { ok: issues.length === 0, issues };

  // ② 残留段条目数 = result.residual 长度（residual 为空时不得有残留段）。
  // 「开启符或归属失败 → 按零条计 → 条数不符」（§15.1 判据边界第一条）即由此判出。
  if (residual.length === 0) {
    if (section.present) {
      issues.push(`direction completeness: 门禁② "## 结果" 残留段 must not exist when result.residual is empty (21 §8 字段间不变量/§15.1 硬门禁②) — got ${section.entries.length} residual entr${section.entries.length === 1 ? "y" : "ies"}`);
    }
  } else if (section.entries.length !== residual.length) {
    issues.push(`direction completeness: 门禁② "## 结果" 残留段 must carry exactly ${residual.length} entr${residual.length === 1 ? "y" : "ies"} — one per result.residual item (21 §8/§15.1 硬门禁②); got ${section.entries.length}. 残留条目须比开启符更深（登记形态为缩进 2 个空格）；与开启符同级或更浅的 bullet 不属残留段、按零条计`);
  }

  // ③ 每条残留恰有一个去向子项（子项须比该残留条目更深）。失败文案指向
  // 「残留 N 条但去向子项 M 条」（§15.1 判据边界第二条）。
  section.entries.forEach((entry, i) => {
    if (entry.directions.length !== 1) {
      issues.push(`direction completeness: 门禁③ each residual entry must carry exactly one direction sub-item — 残留 ${section.entries.length} 条但去向子项 ${directions.length} 条；第 ${i + 1} 条残留有 ${entry.directions.length} 个去向子项（须恰为 1，且子项须比该残留条目更深，形如 "- **<去向词>**：<正文>"） (21 §8/§15.1 硬门禁③). 本条与门禁②的失败码不同：条数相符而某条残留缺子项时，拒绝发生在③`);
    }
  });

  // ④ residual 每出现一条「转入 Spark」，relations 中须恰有一条对应的 routed-to。
  const transfers = directions.filter((direction) => direction.kind === "转入 Spark");
  if (transfers.length !== routedTo.length) {
    issues.push(`direction completeness: 门禁④ 去向子项 carries ${transfers.length} 「转入 Spark」 entr${transfers.length === 1 ? "y" : "ies"} but relations carries ${routedTo.length} routed-to — 条数须一致 (21 §8/§12/§15.1 硬门禁④)；routed-to 只能在 status = open 期经 execute 写入（§14 CREATE-FIRST 次序）`);
  }

  directions.forEach((direction, i) => {
    if (direction.kind === null) {
      // ⑥ 去向词落闭集二词内；不达登记形态者**按零条计但不静默丢弃**，在此拒绝
      //（§15.1 判据边界第三条：读者不得据此推断出「条数不符」的失败码归因）。
      issues.push(`direction completeness: 门禁⑥ 残留[${direction.entryIndex + 1}] 去向子项[${i}] 去向词 ${JSON.stringify(direction.kindText.length > 0 ? direction.kindText : direction.text.slice(0, 40))} is not one of the closed set 接受现状/转入 Spark, and the entry does not match the registered form "- **<去向词>**：<正文>" (21 §8/§15.1 硬门禁⑥) — fail closed`);
    } else if (direction.kind === "接受现状" && direction.text.length === 0) {
      // ⑤ 每条「接受现状」的去向正文非空（去空白后长度 > 0）。
      issues.push(`direction completeness: 门禁⑤ 残留[${direction.entryIndex + 1}] 去向子项[${i}] 「接受现状」 must carry a non-empty reason — 明确不跟踪须说明为什么不继续跟踪 (21 §8/§15.1 硬门禁⑤)`);
    }
  });

  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (21 §8 不变量 / §15.1 / §16 载体内聚): frontmatter is the
 * single authoritative text, and the body only expands it. Mechanical scope is
 * exactly two things, as registered in four places (§8 字段间不变量、§14 创建
 * 机械校验、§15.1 类型特有验证、§16 验证表):
 *
 *   ① `summary` / `scope` appear verbatim in their body sections (摘要 / 授权范围);
 *   ② `plan[].step` appears in order in the 计划 section, so the body plan cannot
 *      drift from the authoritative array.
 *
 * 比对为精确字符串，不做归一化（§15.1）。
 *
 * **本项不含 `plan[].done_criteria`（如实登记边界）**：§8 的「## 计划 ← 步骤 +
 * 逐条完成判据」是对该节**内容**的描述，而其机械子句只登记了「各 `step` 按数组序
 * 出现」；判据的可判定性由 §16 明确登记为 **AI 语义审核 + Human 确认**（非机械）。
 * 故判据是否进入正文、是否可被证据判定，不由本函数校验。
 *
 * 本会话曾一度在此处增加「判据须逐字进入正文」的机械校验，并为其引入 §6.1 式的
 * 基线豁免以避开存量死锁；经对照新登记的规范文本，该项**无任何登记**且与 §16 的
 * 验证入口分配冲突，已移除。（旁证：登记范围内存量对象 16/16 无条件通过，无需任何
 * 豁免；而多出的那一项需要专门引入豁免才不死锁——「需要豁免」本身即说明它超出了
 * 登记范围。）
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const pairs = [
    ["summary", "摘要"],
    ["scope", "授权范围"],
  ];
  for (const [field, section] of pairs) {
    const text = typeof frontmatter[field] === "string" ? frontmatter[field].trim() : "";
    if (text.length === 0) continue;
    const content = sectionContent(body, section);
    if (content === null) continue;
    if (!content.includes(text)) {
      issues.push(`carrier coherence: frontmatter ${field} must appear verbatim in "## ${section}" (03 §6.1 单一权威)`);
    }
  }
  const planContent = sectionContent(body, "计划");
  if (planContent !== null && Array.isArray(frontmatter.plan)) {
    let cursor = -1;
    frontmatter.plan.forEach((item, i) => {
      if (typeof item?.step !== "string" || item.step.length === 0) return;
      const idx = planContent.indexOf(item.step, cursor + 1);
      if (idx === -1) {
        issues.push(`carrier coherence: plan[${i}].step not found (in order) in "## 计划" — the body plan may not drift from the authoritative array`);
      } else {
        cursor = idx;
      }
    });
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// attempt allocation (21 §10.4: Code-allocated, monotonic)
// ---------------------------------------------------------------------------

/**
 * Derive the next attempt_id from the change_log history the writer itself
 * produced (every allocation/void is recorded as "attempt <n>") plus the
 * current active attempt. Purely mechanical; never reused.
 */
export function nextAttemptId(frontmatter) {
  let max = 0;
  if (Number.isInteger(frontmatter.attempt?.attempt_id)) max = Math.max(max, frontmatter.attempt.attempt_id);
  for (const entry of frontmatter.change_log ?? []) {
    if (typeof entry?.summary !== "string") continue;
    for (const m of entry.summary.matchAll(/attempt (\d+)/g)) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2)
// ---------------------------------------------------------------------------

export async function readWorkcaseObject(args) {
  const { factSourceRoot, objectUid } = args;
  const uidCheck = assertValidUid(objectUid);
  if (uidCheck) return uidCheck;
  let content;
  try {
    content = await readFile(objectFilePath(factSourceRoot, objectUid), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return failure("workcase/object_not_found", `cannot read object file: ${error.message}`);
    }
    return failure("workcase/object_unreadable", `cannot read object file: ${error.message}`);
  }
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("workcase/carrier_invalid", "no YAML frontmatter block");
  }
  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("workcase/carrier_invalid", `frontmatter parse error: ${error.message}`);
  }
  const body = content.slice(fmMatch[0].length).replace(/^\s+/, "");
  const fmCheck = validateWorkcaseFrontmatter(frontmatter);
  return success({
    frontmatter,
    body,
    mechanical_issues: fmCheck.ok ? [] : fmCheck.issues,
    fingerprint: fileFingerprint(content),
    file: objectFilePath(factSourceRoot, objectUid),
  });
}

// ---------------------------------------------------------------------------
// Shared write path: validate + atomic write + read-back
// ---------------------------------------------------------------------------

/**
 * 全部 9 个 action 的唯一落盘汇聚点。
 *
 * `baseline`（可选）：**落盘前读到的既有对象**，供两项「适用范围」判定：
 *
 *   - §6.1 关口门禁：`baseline.plan` 判定 plan 项「新增/改动」与否；
 *   - §8 书写纪律：`baseline.summary` / `baseline.scope` 判定该字段是否被改动。
 *
 * create 不传（全部为新）；其余 action 一律传实际读到的对象——这是 CAS 之外的
 * 第二道「不能靠改写既有内容绕过」的保障：baseline 来自读到的对象，而非调用方
 * payload。
 *
 * 载体内聚（§8/§15.1/§16）**不消费 baseline**：其登记范围（summary/scope 逐字 +
 * plan[].step 按序）对存量对象本就 16/16 无条件通过，无需适用范围限制。
 */
async function writeValidated(factSourceRoot, frontmatter, body, baseline = null, baselineBody = null) {
  // 机械校验走**单一编排**（runMechanicalChecks）——与 create 的预检同一函数集，
  // 见该函数说明。此处不再内联复写三件套。
  const check = runMechanicalChecks(frontmatter, body, baseline, baselineBody);
  if (!check.ok) {
    return failure(check.code, check.message, { issues: check.issues });
  }
  const typeDir = join(factSourceRoot, WORKCASE_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, frontmatter.object_uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);
  // 写后精确回读 (03 §9)
  const readBack = await readWorkcaseObject({ factSourceRoot, objectUid: frontmatter.object_uid });
  if (!readBack.ok) {
    return failure("workcase/read_back_failed", readBack.error.message);
  }
  return success({
    object_uid: frontmatter.object_uid,
    file: filePath,
    fingerprint: readBack.value.fingerprint,
    read_back: "ok",
  });
}

async function resolveServes(factSourceRoot, serves) {
  if (serves === undefined) return null;
  const goal = await readGoalAnchorsFromGoal({ factSourceRoot });
  if (!goal.ok) {
    return failure("workcase/serves_unresolvable", `serves declared (${serves}) but goal.md is not readable: ${goal.error?.message ?? "unknown"} (21 §10.1: Gate 1 无法受理 without an anchor — fail closed)`);
  }
  if (!goal.value.anchors.includes(serves)) {
    return failure("workcase/serves_unresolvable", `serves ${serves} does not match any SG-n in goal.md 子目标 (available: ${goal.value.anchors.join(", ") || "none"})`);
  }
  return null;
}

/**
 * 关系目标解析（21 §12，2026-09-28 起按 relation key 分派）：
 *
 *   - `contributed-to` → 同项目 **Pitfall** 对象（载体文件存在即可，不校验状态）；
 *   - `routed-to` → 同项目 **Spark** 对象，且其 `status` 在**写入时**必须为 `open`
 *     （`implemented`/`discarded` 的 Spark 已不再承载议题，不能作为残留去向）。
 *
 * 失败一律零写入（调用方在落盘前返回 failure），不静默丢弃该关系。
 */
async function resolveRelationsTargets(factSourceRoot, relations) {
  if (!Array.isArray(relations) || relations.length === 0) return null;
  const missing = [];
  const notOpen = [];
  for (const entry of relations) {
    const target = entry?.target?.object_uid;
    if (typeof target !== "string") continue;
    if (entry?.relation_key === "routed-to") {
      let content;
      try {
        content = await readFile(join(factSourceRoot, SPARK_DIRECTORY, `spark-${target}.md`), "utf8");
      } catch {
        missing.push(target);
        continue;
      }
      const status = readFrontmatterField(content, "status");
      if (status !== "open") notOpen.push(`${target} (status=${status ?? "unreadable"})`);
    } else {
      try {
        await readFile(join(factSourceRoot, PITFALL_DIRECTORY, `pitfall-${target}.md`), "utf8");
      } catch {
        missing.push(target);
      }
    }
  }
  if (missing.length > 0) {
    return failure("workcase/relations_unresolvable", `relations target(s) not found as same-project objects: ${missing.join(", ")} (21 §12: contributed-to → Pitfall, routed-to → Spark)`, { missing });
  }
  if (notOpen.length > 0) {
    return failure("workcase/relations_unresolvable", `routed-to target(s) are not open Spark objects: ${notOpen.join(", ")} (21 §12: the target Spark must be open at write time — 残留去向只能指向仍在承载议题的 Spark)`, { notOpen });
  }
  return null;
}

/**
 * 从载体全文取单一 frontmatter 标量（仅用于关系目标的状态判定）。
 * 解析失败时返回 `undefined`，由调用方按 fail-closed 处理（不得解释为 open）。
 */
function readFrontmatterField(content, key) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return undefined;
  try {
    const fm = parseYaml(fmMatch[1]);
    return fm?.[key];
  } catch {
    return undefined;
  }
}

function stripCallerOnlyFields(draft) {
  const { change_summary: _s, ...rest } = draft ?? {};
  return rest;
}

// ---------------------------------------------------------------------------
// create — draft (21 §14 C1 提案对象模式; 初态 draft)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// create 候选的**单一评估实现**（请假前预检与正式写入共用）
//
// 为什么必须共用而不是两处各写一遍（本节的直接理由）：`09 §5` 要求同一判定
// 不在多处各自实现。此前 create 的机械校验只存在于写入路径内，任何「提请前
// 先检查一遍」的尝试都只能由调用方**复现装配与校验**（`assembleBody` 当时未
// 导出，复现是唯一选择）——而复现出来的检查与真正落盘的检查是**两个实现**，
// 它们可以同时「通过」，却对同一份候选给出不同结论。
//
// 故此处把「从调用方 payload 到可校验的规范化载体」整条链抽成一个入口，
// 两条路径都调它：预检只取 issues 与指纹，写入再取 frontmatter/body 落盘。
// 「预检通过」因此**在机械上**等价于「同一实现认为该候选可写入」的前半段，
// 而不是另一套规则的结论。
// ---------------------------------------------------------------------------

/**
 * `create` 候选的确定性内容指纹（覆盖**调用方提供的全部候选内容**）。
 *
 * 覆盖范围是刻意的：`object_uid` / `created_at` 由 Code 生成，调用方无从在提请时
 * 提供，若把它们并入指纹，则「提请时的指纹」永远无法与「写入时的指纹」相等，比对
 * 就成了空话。故指纹取**调用方能控制、且在提请与写入之间必须保持不变**的全部内容。
 *
 * **`change_summary` 必须在内**（2026-09-26 实现侧对抗审核 F1 修正，实测反例）：
 * 此前本函数对 `frontmatter_draft` 先做 `stripCallerOnlyFields`（剥离
 * `change_summary`），理由是它「不是类型字段，只流入 change_log」。但该值**由调用方
 * 提供、且会逐字落盘**到 `change_log[0].summary`——它既是候选内容，又在提请后决定
 * 了对象里的一句话。实测：预检候选甲（`change_summary: "记录 A"`）取得指纹后，把值
 * 换成「记录 B」并携带同一指纹调用创建，**写入被接受**，落盘为「记录 B」。即
 * 「提请与写入之间内容变化一律拒绝」当时并不成立，而候选文本已如此承诺。
 *
 * 修正取**收敛实现**而非放宽文本：既然该值会落盘，它就属于候选内容，须受同一
 * 一致性约束。指纹因此直接覆盖调用方传入的原始 draft，不再剥离任何字段。
 *
 * 该指纹**不是授权凭据**：它只证明「两次调用提交的是同一份候选内容」，不证明
 * 内容恰当、不证明 Human 同意、也不构成 Gate 1 的任何部分。
 */
export function computeCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown) {
  const candidate = {
    frontmatter_draft: frontmatterDraft ?? null,
    body_markdown: typeof bodyMarkdown === "string" ? bodyMarkdown : null,
  };
  return createHash("sha256").update(stableStringify(candidate), "utf8").digest("hex");
}

/**
 * 评估一份 create 候选：规范化装配 + 全部机械校验，返回可直接落盘的
 * `frontmatter`/`body`，或**与写入路径逐条相同**的失败。
 *
 * `signature` 为 null 时不写 `change_log`（预检路径）——`change_log` 的署名由
 * Code 盖戳、AI 不可自填，预检没有也不需要它；而校验器对 `change_log` 的要求
 * 是「非空数组且每项 {at, summary}」，故预检补一个占位条目后校验，结论与写入
 * 一致（差异只在该字段的取值，而该字段不在候选指纹内且不由调用方控制）。
 */
async function evaluateCreateCandidate({ factSourceRoot, frontmatterDraft, bodyMarkdown, signature = null }) {
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (starting with '## 摘要'; the H1 is generated from title)");
  }

  const now = new Date().toISOString();
  const frontmatter = { ...stripCallerOnlyFields(frontmatterDraft) };
  // 21 §9: create always initialises as draft — Gate 1 is the only way to open.
  if (frontmatter.status !== undefined && frontmatter.status !== "draft") {
    return failure("workcase/initial_state_violation", `create must initialise as status=draft; got ${JSON.stringify(frontmatter.status)} (21 §9)`);
  }
  frontmatter.status = "draft";
  // Gate/attempt/result/outcome never exist at creation (they attach to the
  // respective transitions, which create never performs).
  if (frontmatter.gate_1 !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry gate_1 (only Gate 1 approval stamps it, 21 §14)");
  if (frontmatter.attempt !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry attempt (only approve allocates it, 21 §10.4)");
  if (frontmatter.result !== undefined || frontmatter.outcome !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry result/outcome (only Gate 2 closure stamps them, 21 §14)");

  // `fact_type_key` / `created_at` 是校验器**必需**字段（实测：缺任一项即
  // frontmatter_invalid），故两条路径都必须写——它们由 Code 生成，不属候选内容，
  // 也不在候选指纹覆盖范围内。
  frontmatter.fact_type_key = WORKCASE_TYPE_KEY;
  frontmatter.created_at = now;
  // `object_uid` 则**只在写入路径生成**：校验器不要求它（§8 只登记其存在时的
  // 形状），而预检是只读的——该字段是「Code 生成的唯一身份」（03 §6.1），只在
  // 落盘时才有对象可指。实测依据（2026-09-26）：此前两条路径共用本函数，预检也
  // 会调用 randomUUID() 并丢弃结果，不落盘也不返回，但候选文本所称「不生成对象
  // 标识」在严格读法下与实现不符。本改动消除该不一致，而非放宽文本。
  if (signature !== null) frontmatter.object_uid = randomUUID();
  frontmatter.change_log = [{
    at: now,
    ...(signature ?? {}),
    summary: frontmatterDraft?.change_summary ?? "受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）",
  }];

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  // Shape/body/coherence checks must run before target resolution: malformed
  // refs are a frontmatter rejection, while a well-formed but missing target
  // is the distinct zero-write refs_target_unresolvable case.
  const checks = validateCreateCandidate(frontmatter, body);
  if (!checks.ok) return failure(checks.code, checks.message, { issues: checks.issues });

  const servesCheck = await resolveServes(factSourceRoot, frontmatter.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, frontmatter.relations);
  if (relCheck) return relCheck;
  const refsCheck = await resolveRefsTargets(factSourceRoot, frontmatter.refs);
  if (!refsCheck.ok) {
    return failure("workcase/refs_target_unresolvable", refsCheck.reason, { missing: refsCheck.missing });
  }

  return success({ frontmatter, body });
}

/**
 * 机械校验的**单一编排**（预检与写入共用，2026-09-26 F2 修正）。
 *
 * 此前预检走 `validateCreateCandidate`（写死 create 的 opts），而写入走
 * `writeValidated` 内联的同一三件套——两处代码在做同一件事。当下参数恰好等价
 * （create 恒为 `hasExecution=false`/`requireResult=false`/`outcome=null`/
 * `baseline=null`），故结论一致；但**两份编排**意味着将来改动其一即出现
 * 「预检说可以、写入说不行」的分流，而那恰是本改动要消灭的形态。
 *
 * `baseline` 非空时（update 类动作）沿用既有适用范围语义：只校验相对基线新增或
 * 改动的字段，逐字未改的既有字段放行（见 §15.1 书写结构的适用范围说明）。
 *
 * `baselineBody` 只服务第四组（去向完整性）的**存量不溯及**判定：该组需要比对
 * 「建议段是否被改动」，而建议段在正文里，故仅有 baseline frontmatter 不够。
 * 缺失时按「已改动」处理（fail closed）——未知不等于未改动。见
 * `validateDirectionCompleteness` 的说明。
 */
function runMechanicalChecks(frontmatter, body, baseline = null, baselineBody = null) {
  const fmCheck = validateWorkcaseFrontmatter(
    frontmatter,
    baseline?.plan ?? null,
    baseline?.summary,
    baseline?.scope,
  );
  if (!fmCheck.ok) {
    return { ok: false, code: "workcase/frontmatter_invalid", message: "frontmatter failed mechanical checks", issues: fmCheck.issues };
  }
  const hasExecution = frontmatter.status === "open" || (frontmatter.status === "closed" && frontmatter.gate_1 !== undefined);
  const requireResult = frontmatter.status === "closed";
  const bodyCheck = validateWorkcaseBodyStructure(body, frontmatter.title, { hasExecution, requireResult, outcome: frontmatter.outcome ?? null });
  if (!bodyCheck.ok) {
    return { ok: false, code: "workcase/body_invalid", message: "body failed structure checks", issues: bodyCheck.issues };
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return { ok: false, code: "workcase/coherence_invalid", message: "carrier coherence failed", issues: coherenceCheck.issues };
  }
  const directionCheck = validateDirectionCompleteness(frontmatter, body, baseline, baselineBody);
  if (!directionCheck.ok) {
    return { ok: false, code: "workcase/direction_incomplete", message: "残留去向 failed completeness checks", issues: directionCheck.issues };
  }
  return { ok: true };
}

/**
 * The three mechanical check groups shared by the precheck and the write path,
 * in the SAME order and with the SAME codes the write path has always used.
 */
function validateCreateCandidate(frontmatter, body) {
  return runMechanicalChecks(frontmatter, body, null);
}

/**
 * 只读预检入口：对 create 候选执行与写入**同一实现**的机械校验，不落盘。
 *
 * 返回 `mechanical_outcome` 三值（与 `06 §6.4` 的 precheck-git-commit 同形）：
 * `passed` / `failed` / `unverifiable`。同时返回**候选内容指纹**，供写入侧比对
 * 「提请时的候选」与「写入时的候选」是否为同一份内容。
 *
 * **不由本函数证明的事，一律不得据其声称**：
 *   - 不证明内容恰当、范围合适或 Human 会同意——那是 Gate 1 与 Human 判断；
 *   - 不构成授权凭据，也不是 Human 确认的替代物；
 *   - `passed` 只说明「按已封闭定义的机械规则，该候选可写入」，不说明它应当被写入。
 */
export async function precheckWorkcaseCreate({ factSourceRoot, frontmatterDraft, bodyMarkdown }) {
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return success({
      mechanical_outcome: "unverifiable",
      candidate_fingerprint: null,
      issues: ["body_markdown is required (starting with '## 摘要'; the H1 is generated from title)"],
      issue_groups: [],
    });
  }
  const evaluated = await evaluateCreateCandidate({ factSourceRoot, frontmatterDraft, bodyMarkdown, signature: null });
  const candidateFingerprint = computeCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
  if (!evaluated.ok) {
    const code = evaluated.error.code;
    const issues = evaluated.error.details?.issues;
    // `invalid_request` / `initial_state_violation` / `serves_unresolvable` /
    // `relations_unresolvable` are not "the candidate has a fixable formatting
    // defect" but "the check could not be completed" or "a precondition outside
    // the candidate is unmet" — reported as their own code, never folded into a
    // generic failed, so the caller cannot read a blocked environment as a
    // formatting hint.
    return success({
      mechanical_outcome: code === "invalid_request" ? "unverifiable" : "failed",
      candidate_fingerprint: candidateFingerprint,
      error_code: code,
      error_message: evaluated.error.message,
      issues: Array.isArray(issues) ? issues : [],
      issue_groups: Array.isArray(issues) ? [{ code, issues }] : [],
    });
  }
  return success({
    mechanical_outcome: "passed",
    candidate_fingerprint: candidateFingerprint,
    issues: [],
    issue_groups: [],
    object_uid: null, // 预检不生成对象标识——该字段是「Code 生成的唯一身份」（03 §6.1），只在落盘时才有对象可指
  });
}

export async function createWorkcaseObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null, expectedCandidateFingerprint = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  // 提请与写入之间候选内容必须保持一致：调用方若在提请时记录了候选指纹，
  // 则此处比对；不一致即拒绝写入。理由不是形式主义——提请（及其审查）针对的
  // 是**那份**内容，此处若静默接受另一份，则 Human 之所见与所落不是同一物。
  if (expectedCandidateFingerprint !== null) {
    if (typeof expectedCandidateFingerprint !== "string" || !FINGERPRINT_PATTERN.test(expectedCandidateFingerprint)) {
      return failure("workcase/candidate_fingerprint_invalid", "expectedCandidateFingerprint must be a 64-hex SHA-256 from the precheck result (21 §14 create)");
    }
    const actual = computeCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
    if (actual !== expectedCandidateFingerprint) {
      return failure(
        "workcase/candidate_changed",
        `the candidate content changed between precheck and write (precheck ${expectedCandidateFingerprint.slice(0, 8)}…, now ${actual.slice(0, 8)}…); `
        + "the precheck verdict applies to the content that was checked, not to this one — re-run the precheck on the current content, then retry (21 §14 create)",
        { expected: expectedCandidateFingerprint, actual },
      );
    }
  }

  const evaluated = await evaluateCreateCandidate({ factSourceRoot, frontmatterDraft, bodyMarkdown, signature: sig.signature });
  if (!evaluated.ok) return evaluated;
  return writeValidated(factSourceRoot, evaluated.value.frontmatter, evaluated.value.body);
}

// ---------------------------------------------------------------------------
// CAS update primitive (03 §9.5) — shared by every transition flow
// ---------------------------------------------------------------------------

async function loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint) {
  if (typeof expectedFingerprint !== "string" || !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    return failure("invalid_request", "expectedFingerprint is required for CAS (64-hex SHA-256 from your last precise read)");
  }
  const current = await readWorkcaseObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("workcase/cas_conflict", `fingerprint mismatch — the object changed since your last read (expected ${expectedFingerprint.slice(0, 8)}…, found ${current.value.fingerprint.slice(0, 8)}…); re-read and retry (03 §9.5 CAS)`);
  }
  return current;
}

/**
 * 只接受**宿主执行上下文**来源的会话身份（source="host"）。
 *
 * 独立对抗复核实测（2026-09-19）：shell 通道逐字采信 `DSH_SESSION_JSONL` /
 * `DSH_HOME`+`DSH_SESSION_ID`，而两者对调用者（AI 的一次 bash 调用）可设置——
 * 一行环境变量即可铸出任意身份的**真品牌**载体。故 shell 来源身份**可被实施者伪造**，
 * 不能作为独立性判据；本函数把「不可信来源」解析为 null，使各写入路径按缺身份
 * fail-closed，而不是接受一个可被伪造的基准。
 */
function hostSessionIdentity(carrier) {
  const identity = resolveAuthoritativeSessionIdentity(carrier);
  if (identity === null || identity.source !== "host") return null;
  return identity;
}

/** 当前实施者会话身份（落盘 attempt 的 Code 托管字段，含来源）。取不到返回 null。 */
function implementerSessionOf(frontmatter) {
  const value = frontmatter?.attempt?.session_id;
  if (typeof value !== "string" || value.length === 0) return null;
  const source = frontmatter?.attempt?.session_source;
  return { sessionId: value, source: typeof source === "string" && source.length > 0 ? source : null };
}

function appendChangeLog(frontmatter, sig, summary) {
  frontmatter.change_log = [
    ...(frontmatter.change_log ?? []),
    { at: new Date().toISOString(), ...sig.signature, summary },
  ];
}

/**
 * 21 §8：`reviews` 的 `at`、署名与 `session_id` 由 Code 托管，**AI 不得自填**。
 *
 * `validateReviews` 要求每项 `{at, provider, model, summary}` 三项非空，但在此之
 * 前没有任何写路径为其盖戳——调用方被迫自填 at/provider/model，与 §8 的「AI 不得
 * 自填」直接冲突（三重矛盾：规范说 Code 管、schema 标 Code-managed、实现却要求
 * 调用方传值）。本函数补上缺失的盖戳路径，与 `appendChangeLog` 同一纪律：
 * `at` 取 Code 时钟、`provider`/`model` 取权威会话记录（`sig.signature`）、
 * `session_id` 取会话身份（`identity`，workcase-2be11478 计划步骤 2）。
 *
 * 只接受调用方提供的 `summary`；其余四项一律覆盖，调用方传什么都会被丢弃
 * （防自欺：署名与身份不可由被署名的一方提供）。
 *
 * **身份按索引继承，不得被后续写入抹掉**（本单自审发现并修正）：若基线对象在同一
 * 索引上已有 Code 盖戳的 `session_id`，则该身份**原样保留**，不被当前调用方的身份
 * 覆盖。理由：复核会话记录的身份正是关闭门禁所依赖的证据；实施者在复核之后做一次
 * 普通心跳（execute heartbeat）若把所有条目重盖成自己的身份，会把独立复核的证据
 * 抹掉——门禁随之 fail-closed，机制沦为不可用。被继承的身份来自**落盘对象**
 * （baselineReviews），不是调用方 payload，故不可据此伪造。
 *
 * **既有条目的 `at` 与署名同样按索引继承，不得被后续写入改写**（2026-09-23 实测
 * 发现并修正）：本函数原先把**所有**条目的 `at` 刷成当前时刻、`provider`/`model`
 * 取当前写入者的路由。实测后果是**署名被篡改**——对 4 份「待批准关闭」对象各做一次
 * 与复核无关的 `execute` 心跳（内容为结果节补 `- advice:` 段），它们 2026-09-22 由
 * `workbuddy`/`deepseek-v4.1-flash` 记录的独立复核条目，落盘后变成
 * `deepseek-official`/`deepseek-flash`：复核者被换成了后来做心跳的那一方。
 * `session_id` 早前已按索引继承（见上），`at`/署名是同一条记录的另一半，没有理由
 * 只保一半。原注释接受「`at` 刷成同一时刻」的理由是「不引入无法验证的时序推断」，
 * 而**逐字继承**既有值不需要任何推断。故三者一并按索引继承，只有**本次新写入的
 * 条目**才取 Code 时钟与当前权威路由。
 *
 * 传入非数组（含 undefined）时原样返回，不虚构字段（03 §6.1）。
 */
function stampReviewEntries(reviews, sig, identity = null, baselineReviews = null, implementer = null) {
  const implementerSessionId = implementer === null ? null : implementer.sessionId;
  const implementerSource = implementer === null ? null : implementer.source;
  const sessionSource = identity === null ? null : identity.source;
  if (!Array.isArray(reviews)) return reviews;
  const at = new Date().toISOString();
  const sessionId = identity === null ? null : identity.sessionId;
  const baseline = Array.isArray(baselineReviews) ? baselineReviews : [];
  return reviews.map((entry, index) => {
    const stored = baseline[index];
    const isExistingEntry = isPlainObject(stored);
    // 既有条目的记录时刻与署名是历史事实：逐字继承，仅缺失时回落到当前值。
    const storedAt = isExistingEntry && typeof stored.at === "string" && stored.at.length > 0 ? stored.at : null;
    const storedProvider = isExistingEntry && typeof stored.provider === "string" && stored.provider.length > 0 ? stored.provider : null;
    const storedModel = isExistingEntry && typeof stored.model === "string" && stored.model.length > 0 ? stored.model : null;
    const storedSessionId = isExistingEntry && typeof stored.session_id === "string" && stored.session_id.length > 0
      ? stored.session_id
      : null;
    // 身份**不作继承性补齐**——与下方 `session_source` 同纪律（2026-09-27 修正）。
    //
    // 原实现取 `storedSessionId ?? sessionId`，即把一条**身份缺席**的存量条目盖上
    // 「本次写入会话记录」的身份。该身份是假的：条目的 `at`/署名仍是历史值（逐字继承），
    // 记录者另有其人，而新盖的身份还会随每次宿主写入继续漂移。缺失就是缺失——关闭门禁
    // 要求两端身份俱为 "host"，缺失即不计入（fail-closed），与「未知不等于独立」同纪律。
    //
    // 实测（workcase-364df30e，2026-09-27）：一次携带既有 `reviews` 的心跳，把其
    // 2026-09-22（provider workbuddy）的条目盖成了本次心跳会话的身份。
    const effectiveSessionId = isExistingEntry ? storedSessionId : sessionId;
    // 记录「写这条时谁是实施者」——这是独立性判据的真正基准（见 close 门禁说明）。
    // 同样按索引继承：已记录条目的当时基准不得被后续 attempt 轮换改写，否则
    // 「先自查、再 takeover、然后关闭」就能把自查当成独立证据（独立复核实测发现，
    // 2026-09-19）。
    const storedImplementer = isPlainObject(stored) && typeof stored.implementer_session_id === "string"
      && stored.implementer_session_id.length > 0
      ? stored.implementer_session_id
      : null;
    const effectiveImplementer = storedImplementer ?? implementerSessionId;
    // 来源**不作继承性补齐**（本单实测发现并修正，2026-09-19）：
    // 若对既有条目用当前写入者的来源去填补它缺失的来源，则任何一条**没有来源**的
    // 旧条目（或经旧路径写入、或直接改文件注入的条目）都会被随后一次宿主写入「洗白」
    // 成 source="host"，从而计入独立性判据——这正是「shell 身份可伪造」那个缺口
    // 换了一道后门回来（实测：注入一条无来源条目 → 攻击者做一次宿主写入 → 该条目
    // 变成 session_source="host" 并被门禁采纳）。
    //
    // 故来源只对**本次新写入的条目**盖戳；既有条目一律保留它当初被记录的原值，
    // 缺失就是缺失（判据要求两端来源俱为 "host"，缺失即不计入，fail-closed）。
    const storedSource = isExistingEntry && typeof stored.session_source === "string" ? stored.session_source : null;
    const effectiveSource = isExistingEntry ? storedSource : sessionSource;
    const storedImplSource = isExistingEntry && typeof stored.implementer_session_source === "string"
      ? stored.implementer_session_source
      : null;
    const effectiveImplSource = isExistingEntry ? storedImplSource : implementerSource;
    return {
      at: storedAt ?? at,
      provider: storedProvider ?? sig.signature.provider,
      model: storedModel ?? sig.signature.model,
      // Code-managed session identity (workcase-2be11478 计划步骤 2): the caller
      // cannot supply or override it. When the identity is unavailable the key is
      // OMITTED rather than fabricated — the close gate then fails closed.
      ...(effectiveSessionId === null ? {} : { session_id: effectiveSessionId }),
      // 来源仅在**已知**时写出：缺失就让它缺失（写入 null 会看起来像「记录过、值不明」，
      // 而真实语义是「这条记录发生在来源字段存在之前」——省略比 null 更准确）。
      ...(effectiveSource === null || effectiveSource === undefined ? {} : { session_source: effectiveSource }),
      ...(effectiveImplementer === null ? {} : { implementer_session_id: effectiveImplementer }),
      ...(effectiveImplSource === null || effectiveImplSource === undefined ? {} : { implementer_session_source: effectiveImplSource }),
      summary: isPlainObject(entry) && typeof entry.summary === "string" ? entry.summary : "",
    };
  });
}

/**
 * 复核条目一旦被 Code 盖戳了会话身份，即是**历史记录**：其它会话不得改写其概要。
 *
 * 为什么必需（本单自审发现并修正）：`stampReviewEntries` 的身份按索引继承，故若
 * 允许调用方在保留索引的同时把概要换成自己的自查文本，实施者就能把独立会话
 * （S2）的真实复核条目**改造**成自己的内容而仍然携带 S2 的身份——关闭门禁会被
 * 这样「借壳」通过。这与本单 scope (D) 列明的「复用旧条目」伪装路径同类，必须以
 * 同一门禁拒绝。
 *
 * 判据故意取「概要逐字相同」这一机械可比项：内容语义是否正确仍归 AI/Human
 * （02 §15），本函数只保证「谁记的、记了什么」不被他人改写。
 */
function assertReviewHistoryNotRewritten(beforeReviews, afterReviews, issuesRef) {
  const before = Array.isArray(beforeReviews) ? beforeReviews : [];
  const after = Array.isArray(afterReviews) ? afterReviews : [];
  // 条目数减少即拒绝（2026-09-27 补）。原实现只逐条比对**同索引**概要，对「整条消失」
  // 完全不敏感：调用方漏传 `reviews` 时既有流水被静默丢弃而守卫放行（实测
  // workcase-364df30e 的 2026-09-22 条目就是这样消失的）。
  //
  // 为什么不是「允许减少」：21 §8 的 `reviews` 是复核流水，作废只走 `rebatch`
  // （§9.2，且不经本守卫）；本守卫的两个调用点（execute / record_review）都不存在
  // 合法的减少路径，故一律视为历史丢弃。
  if (after.length < before.length) {
    const dropped = before.length - after.length;
    issuesRef.push(
      `reviews: this write would drop ${dropped} of ${before.length} recorded `
      + `${dropped === 1 ? "entry" : "entries"} (before ${before.length}, after ${after.length}) — `
      + "21 §8 treats reviews as a review ledger: existing entries are historical facts and may not be "
      + "silently discarded. Carry the on-disk `reviews` array verbatim (the writer inherits it when the "
      + "payload omits it), or use the append-only channel (record_review) to add a conclusion. `rebatch` "
      + "is the only path that voids reviews, and it does so explicitly (§9.2) — not through this guard.",
    );
  }
  after.forEach((entry, index) => {
    const stored = before[index];
    if (!isPlainObject(stored)) return;
    const storedSessionId = typeof stored.session_id === "string" && stored.session_id.length > 0 ? stored.session_id : null;
    if (storedSessionId === null) return;
    const incomingSummary = isPlainObject(entry) && typeof entry.summary === "string" ? entry.summary : "";
    const storedSummary = typeof stored.summary === "string" ? stored.summary : "";
    if (incomingSummary !== storedSummary) {
      issuesRef.push(
        `reviews[${index}]: this entry was recorded by session ${storedSessionId} and its summary may not be `
        + "rewritten by another session (workcase-2be11478). A recorded review is a historical fact: to change "
        + "what a review concluded, record a NEW entry instead of editing this one. Rewriting it would let a "
        + "different session keep another session's identity while substituting its own content.",
      );
    }
  });
}

/** C2 guard: while open, plan and scope are frozen (21 §10.3). */
function assertAuthorizedPairFrozen(before, after, issuesRef) {
  const fpBefore = computeAuthorizationFingerprint(before.plan, before.scope);
  const fpAfter = computeAuthorizationFingerprint(after.plan, after.scope);
  if (fpBefore !== fpAfter) {
    issuesRef.push("plan/scope are frozen while status=open — the C2 authorization fingerprint no longer matches; the only legal path is rebatch (open → draft, 局部重批), never an in-place edit (21 §10.3)");
  }
}

// ---------------------------------------------------------------------------
// approve — Gate 1: draft → open (21 §14, §10.1)
// ---------------------------------------------------------------------------

export async function approveWorkcaseObject(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, approver, controller, changeSummary, sessionSignature = null, sessionIdentity = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof approver !== "string" || approver.length === 0) {
    return failure("invalid_request", "approver is required (the approving Human identity, 21 §10.1)");
  }
  if (typeof controller !== "string" || controller.length === 0) {
    return failure("invalid_request", "controller is required (the current executing controller identity, 21 §10.4)");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (one-line semantic summary for the change_log entry)");
  }
  // 会话身份（workcase-2be11478 计划步骤 2）：只能来自 Code 托管的品牌载体。
  // 非品牌载体（AI 自填的字符串/普通对象）解析为 null —— 此时仍允许批准，但
  // attempt.session_id 缺席会使关闭门禁 fail-closed（不静默放行）。
  const identity = hostSessionIdentity(sessionIdentity);
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `Gate 1 approval requires status=draft, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }

  const now = new Date().toISOString();
  const next = structuredClone(fm);
  next.status = "open";
  next.gate_1 = {
    approved_at: now,
    approver,
    authorization_fingerprint: computeAuthorizationFingerprint(fm.plan, fm.scope),
    scope_snapshot: fm.scope,
  };
  const attemptId = nextAttemptId(fm);
  next.attempt = {
    attempt_id: attemptId,
    started_at: now,
    controller,
    heartbeat_at: now,
    // Code-managed: the implementing session's authoritative identity. This is
    // the baseline the close gate compares a reviewer against. `session_source`
    // records provenance — only "host" (host execution context) is admissible
    // as evidence; "shell" is forgeable via env and never counts.
    ...(identity === null ? {} : { session_id: identity.sessionId, session_source: identity.source }),
  };
  appendChangeLog(next, sig, `${changeSummary} [gate_1 approved by ${approver}; attempt ${attemptId} allocated to ${controller}]`);

  // Body: ensure the 执行 section exists (writer-stamped entry line).
  let body = current.value.body;
  if (!h2Titles(body).includes(BODY_H2_EXECUTION)) {
    body = `${body.replace(/\s+$/, "")}\n\n## 执行\n\n- attempt ${attemptId} started at ${now} (controller: ${controller})；Gate 1 授权范围见 gate_1.scope_snapshot。\n`;
  } else {
    const content = sectionContent(body, BODY_H2_EXECUTION) ?? "";
    body = replaceSection(body, BODY_H2_EXECUTION, `${content}\n- attempt ${attemptId} started at ${now} (controller: ${controller})；Gate 1 授权范围见 gate_1.scope_snapshot。`);
  }
  const written = await writeValidated(factSourceRoot, next, body, fm, current.value.body);
  // 21 §8「执行」节记账纪律的前置提示：授权是执行期写正文的**最早**时点，此处把当前
  // plan 的权威编号清单直接交给调用方，使「计划步骤 N」的 N 有据可依，不必回查
  // frontmatter。属**前置告知**，不含任何校验或拒绝规则——同类机械校验已被实测证伪
  // （它抓不到纯「步骤 N」形态的原错误，却会拒绝如实引述该编号的记述）。此处只把
  // 事实摆在写入之前。
  if (!written.ok) return written;
  return success({
    ...written.value,
    plan_step_reference: planStepReference(next.plan),
  });
}

function replaceSection(body, h2Title, newContent) {
  const re = new RegExp(`(^|\\n)(## ${h2Title}\\n)([\\s\\S]*?)(?=\\n## |\\s*$)`, "m");
  return body.replace(re, `$1$2\n${newContent}\n`);
}

// ---------------------------------------------------------------------------
// execute — open-period update (21 §14 执行期更新)
// ---------------------------------------------------------------------------

/**
 * Open-period controlled update. Allowed payloads: body progress (incl.
 * result drafts in the body), relations, summary refresh; attempt
 * operations: heartbeat (default) | takeover (new controller, new
 * attempt id) | reallocate (void + new id, 冷恢复 path).
 * plan/scope frozen by C2 — substantive change must go through rebatch.
 */
export async function executeWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary,
    attemptOperation = "heartbeat", newController = null,
    sessionSignature = null, sessionIdentity = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body starting with '## 摘要')");
  }
  if (!["heartbeat", "takeover", "reallocate"].includes(attemptOperation)) {
    return failure("invalid_request", `attemptOperation must be heartbeat|takeover|reallocate, got ${JSON.stringify(attemptOperation)}`);
  }
  // 会话身份（workcase-2be11478 计划步骤 2/4）：品牌载体，AI 不可自填。
  // 复核会话经 execute 落盘其结论时，其身份即由此进入 reviews[].session_id ——
  // 这正是「独立会话记录复核」的机械证据来源。
  const identity = hostSessionIdentity(sessionIdentity);
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `execute updates require status=open, got ${JSON.stringify(fm.status)} (21 §14)`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  // Code-managed fields: identity, gate, attempt, change_log never come
  // from the caller payload.
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "open";
  next.gate_1 = fm.gate_1;
  next.change_log = fm.change_log;
  // 21 §8：`reviews` 每项的 `at`、署名与 `session_id` 同样由 Code 托管——AI 只提供
  // `summary`。与 change_log 的 `appendChangeLog(fm, sig, …)` 同一纪律（署名与身份
  // 来自权威会话记录，不可由调用方填写）。见下方 stampReviewEntries 的说明。
  // baseline 取自**落盘对象**（fm.reviews），不是调用方 payload——故已记录的身份
  // 不可被本次调用的身份覆盖（防实施者在复核后抹掉独立复核的证据）。
  // 21 §8：`reviews` 是复核流水，既有条目不得因调用方漏传而消失（2026-09-27 修正）。
  //
  // `next` 是调用方 payload 的克隆，除 Code 托管字段外一律以 payload 为准；而 `reviews`
  // 不在 Code 托管重写之列，故调用方漏传一步即把对象既有的复核流水整段覆盖为空。
  // 实测（workcase-364df30e）：一次未携带 `reviews` 的心跳之后，其 2026-09-22 的复核
  // 条目被静默移除，`change_log` 记 `reviews entries: 1`。
  //
  // 故 payload 未携带时以**落盘对象**为基线继承；payload 携带时按索引与落盘值比对
  // （见 assertReviewHistoryNotRewritten）。
  const reviewsIncoming = Array.isArray(next.reviews) ? next.reviews : fm.reviews;
  next.reviews = stampReviewEntries(reviewsIncoming, sig, identity, fm.reviews, implementerSessionOf(fm));

  // 已盖戳身份的复核条目是历史记录：不得由其它会话改写其概要（防「借壳」——保留
  // 独立会话的身份却换成自己的内容，从而骗过关闭门禁）。
  const reviewHistoryIssues = [];
  assertReviewHistoryNotRewritten(fm.reviews, next.reviews, reviewHistoryIssues);
  if (reviewHistoryIssues.length > 0) {
    return failure("workcase/review_history_rewritten", reviewHistoryIssues[0]);
  }

  // C2 guard (21 §10.3): plan/scope frozen while open.
  const c2Issues = [];
  assertAuthorizedPairFrozen(fm, next, c2Issues);
  if (c2Issues.length > 0) {
    return failure("workcase/c2_fingerprint_invalidated", c2Issues[0]);
  }
  // attempt is Code-managed here.
  const now = new Date().toISOString();
  let attemptNote;
  if (attemptOperation === "heartbeat") {
    // Heartbeat preserves the attempt's own identity: the attempt belongs to the
    // implementer, and a REVIEWER session records its conclusion through
    // `record_review` (which never touches `attempt`) — so a heartbeat must not
    // overwrite the implementing baseline, or the close gate would end up
    // comparing the reviewer against itself.
    //
    // EXCEPTION — legacy backfill: an attempt allocated before this anchor
    // existed carries no session_id, and without a way to fill it such an object
    // could never be closed (the gate fails closed with
    // `review_independence_unverifiable`). Since heartbeats during execution are
    // issued by the executing session, backfilling the missing baseline from the
    // current session is exactly what the field means. If a reviewer wrongly
    // performs this backfill, the direction is still safe: the gate then sees
    // implementer == reviewer and refuses to close (fail-closed), rather than
    // accepting a self-check.
    const hasBaseline = typeof fm.attempt?.session_id === "string" && fm.attempt.session_id.length > 0;
    const baseline = hasBaseline
      ? fm.attempt.session_id
      : (identity === null ? null : identity.sessionId);
    // 存量补齐：本锚点之前建立的 attempt 有 session_id 却无 session_source，而关闭
    // 门禁要求条目两端来源俱为 "host"，故这类对象无法产生「可比对」条目、关不掉。
    //
    // 补齐**只由该身份本人**触发：仅当调用方（宿主来源、故不可伪造）所带的 id 正是
    // 所记录的实施者时，用其自身来源补上。
    //
    // **诚实边界**：这是身份的**自证**，不是对「当初那次写入本身来自宿主路径」的证明
    // —— 存量值的原始来源在写入时未被记录，无法事后追溯。它成立的依据是：主张该 id 的
    // 会话确实就是该会话，且它此刻的宿主来源不可伪造。若需一个**无此含糊**的基线，正确
    // 做法是换一次 attempt（takeover/reallocate），由新执行者写入带来源的完整基线。
    const storedSource = typeof fm.attempt?.session_source === "string" ? fm.attempt.session_source : null;
    const baselineSource = hasBaseline
      ? (storedSource ?? (identity !== null && identity.sessionId === fm.attempt.session_id ? identity.source : null))
      : (identity === null ? null : identity.source);
    next.attempt = {
      ...fm.attempt,
      heartbeat_at: now,
      ...(baseline === null ? {} : { session_id: baseline }),
      ...(baselineSource === null ? {} : { session_source: baselineSource }),
    };
    attemptNote = `attempt ${fm.attempt.attempt_id} heartbeat refreshed`;
  } else {
    const controller = typeof newController === "string" && newController.length > 0 ? newController : fm.attempt.controller;
    const newId = nextAttemptId(fm);
    // A new attempt means a new executing session (21 §10.4: takeover 换执行者,
    // reallocate 冷恢复后重新分配). The independence baseline moves with it: the
    // new attempt's session_id is the CURRENT session's identity. When the
    // identity is unavailable the key is omitted — the close gate then fails
    // closed rather than comparing future reviewers against a stale baseline.
    next.attempt = {
      attempt_id: newId,
      started_at: now,
      controller,
      heartbeat_at: now,
      ...(identity === null ? {} : { session_id: identity.sessionId, session_source: identity.source }),
    };
    attemptNote = attemptOperation === "takeover"
      ? `attempt ${fm.attempt.attempt_id} taken over → attempt ${newId} (controller: ${controller})`
      : `attempt ${fm.attempt.attempt_id} voided → attempt ${newId} reallocated (controller: ${controller})`;
  }
  appendChangeLog(next, sig, `${changeSummary} [${attemptNote}]`);

  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;
  const refsCheck = await resolveRefsTargets(factSourceRoot, next.refs);
  if (!refsCheck.ok) {
    return failure("workcase/refs_target_unresolvable", refsCheck.reason, { missing: refsCheck.missing });
  }

  const body = assembleBody(next.title, bodyMarkdownAfter);
  // 跨会话接力时执行者未必持有 approve 的返回值，故 execute 亦带前置提示（纯告知）。
  const written = await writeValidated(factSourceRoot, next, body, fm, current.value.body);
  if (!written.ok) return written;
  return success({ ...written.value, plan_step_reference: planStepReference(next.plan) });
}

// ---------------------------------------------------------------------------
// recordReview — the narrow identity-channel write (workcase-2be11478 计划步骤 4)
// ---------------------------------------------------------------------------

/**
 * 复核结论回传通道：把**一条**复核结论追加为该工单的 `reviews` 条目。
 *
 * 为什么单列一个窄函数而不是复用 `executeWorkcaseObject`：`execute` 接受整个
 * `frontmatterAfter`，等于把工单的普通写能力交给调用方。隔离执行体（子代理会话）
 * 只需要「记录我复核过了、结论是什么」这一件事——授予它 `execute` 会顺带给出改写
 * 摘要、范围、计划的能力，远超其职责。本函数只做追加，其余字段一律取自落盘对象，
 * 从而满足本单 scope (C) 的「该通道不因此赋予其其它受控写能力」。
 *
 * 调用方只能提供 `summary`（复核结论概要，≤600 字符，含 02 §15 七要素）。`at`、
 * `provider`/`model`、`session_id` 全部由 Code 盖戳——其中 `session_id` 取自**调用
 * 会话自己的**权威身份，故记录者无法声称自己是别的会话；实施者若自行调用本函数，
 * 得到的条目携带实施者身份，关闭门禁照样拒绝（这正是本机制抗伪造的落点）。
 *
 * `attempt` 一概不动：复核不是执行，不改 attempt 的所有权与身份基线。
 */
export async function recordWorkcaseReview(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint, summary,
    changeSummary = null, sessionSignature = null, sessionIdentity = null,
    reviewerNote = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof summary !== "string" || summary.trim().length === 0) {
    return failure("invalid_request", "summary is required (the review conclusion, ≤600 chars, carrying the 02 §15 seven elements)");
  }
  if (summary.length > REVIEW_SUMMARY_MAX_CHARS) {
    return failure("invalid_request", `summary: ${summary.length} chars exceeds the ${REVIEW_SUMMARY_MAX_CHARS}-char cap (21 §8)`);
  }
  // 身份不可得即拒绝：本通道的**全部价值**在于「谁记的」由 Code 证明。若允许无身份
  // 写入，等于给出一个可被实施者冒用的通道，比没有通道更危险。
  const identity = hostSessionIdentity(sessionIdentity);
  if (identity !== null && identity.source === "shell") {
    // shell 来源身份取自环境变量 + 日志文件，而两者对调用者可设置 → 可伪造。
    // 接受它等于把门禁的判据交给被判方（独立对抗复核实测：一行 DSH_SESSION_JSONL
    // 即可铸出任意身份）。故复核身份只接受宿主执行上下文（source="host"）。
    return failure(
      "workcase/review_identity_untrusted",
      "refusing to record a review with a shell-sourced session identity: that channel reads "
      + "DSH_SESSION_JSONL / DSH_HOME+DSH_SESSION_ID, and BOTH are settable by the caller (a single bash "
      + "invocation can mint any identity) — so it cannot evidence independence (workcase-2be11478, "
      + "independent adversarial review 2026-09-19). Record the review through the governed tool surface "
      + "of a session whose identity comes from the host execution context (ldvh_workcase_write "
      + "action=record_review), which stamps source=\"host\".",
    );
  }
  if (identity === null) {
    return failure(
      "workcase/review_identity_unavailable",
      "refusing to record a review without the caller's authoritative session identity: the identity must come "
      + "from the DSH session record via the branded carrier (workcase-2be11478). Resolve it with "
      + "shellAuthoritativeSessionIdentity() from a DSH shell, or sessionIdentityFor() from the tools layer. "
      + "An unsigned-identity review would be indistinguishable from a self-check recorded by the implementer.",
    );
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure(
      "workcase/transition_invalid",
      `review recording requires status=open, got ${JSON.stringify(fm.status)} (21 §9.2: reviews 属执行期受控更新；draft 不得携带 reviews，closed 为终态)`,
    );
  }
  const existing = Array.isArray(fm.reviews) ? fm.reviews : [];
  if (existing.length >= REVIEW_ENTRIES_MAX) {
    return failure(
      "workcase/review_entries_exhausted",
      `reviews already holds ${existing.length} entries (cap ${REVIEW_ENTRIES_MAX}, 21 §8): refuses to truncate or compress `
      + "existing entries. Report to Human — this object needs a decision (rebatch or close), not a dropped history.",
    );
  }

  const next = structuredClone(fm);
  // 只追加，不触碰：plan/scope/gate_1/attempt/result/outcome 全部沿用落盘对象。
  next.reviews = stampReviewEntries([...existing, { summary }], sig, identity, fm.reviews, implementerSessionOf(fm));
  const historyIssues = [];
  assertReviewHistoryNotRewritten(fm.reviews, next.reviews, historyIssues);
  if (historyIssues.length > 0) {
    return failure("workcase/review_history_rewritten", historyIssues[0]);
  }
  appendChangeLog(
    next, sig,
    (typeof changeSummary === "string" && changeSummary.length > 0 ? changeSummary : "记录一条复核结论")
      + ` [review recorded by session ${identity.sessionId}; reviews entries: ${fm.reviews === undefined ? 1 : existing.length + 1}`
      + `${typeof reviewerNote === "string" && reviewerNote.length > 0 ? `; ${reviewerNote}` : ""}]`,
  );

  const body = assembleBody(next.title, current.value.body.replace(/^#\s+.*\n+/, ""));
  const written = await writeValidated(factSourceRoot, next, body, fm, current.value.body);
  if (!written.ok) return written;
  return success({ ...written.value, review_session_id: identity.sessionId });
}

// ---------------------------------------------------------------------------
// close — Gate 2: open → closed (21 §14, §10.2)
// ---------------------------------------------------------------------------

export async function closeWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    outcome, result, changeSummary, bodyMarkdownAfter, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body including the 结果 section)");
  }
  if (!OUTCOMES.has(outcome)) {
    return failure("invalid_request", `outcome must be one of ${[...OUTCOMES].join("/")} (21 §9.3)`);
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `Gate 2 closure requires status=open, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }
  // Gate 2 前置条件（21 §9.1/§8/§14，Human 裁定 2026-09-17）：关闭前须已存在至少一条
  // `reviews`（独立复核记录）。WorkCase 准入（§6 对象边界）已排除「当次行动可直接处理
  // 的低风险改动」，故凡进入 WorkCase 者独立复核为必经环节，**不设低风险豁免**。
  //
  // 缺失时一律拒绝关闭——不得以正文自述或对话声明替代；无法执行独立复核时按 §18
  // 停止条件处置（保持 open 并交还 Human），不得以 partial/cancelled 等终态掩盖。
  //
  // 注意隐含前置：`reviews` 只能在 status=open 时经 execute 落盘（close 不接受
  // frontmatterAfter，stampReviewEntries 的唯一调用点在 executeWorkcaseObject），
  // 故关闭时无法补写——复核须在执行期完成。
  if (!Array.isArray(fm.reviews) || fm.reviews.length === 0) {
    return failure(
      "workcase/review_required",
      "Gate 2 closure requires at least one reviews entry (independent review) before closing "
      + "(21 §9.1/§8/§14, Human 裁定 2026-09-17). reviews is absent or empty — record the independent "
      + "review via execute (status=open) first; if an independent review cannot be performed, do NOT "
      + "close: hold the workcase open and hand back to Human (21 §18). "
      + "The 结果 body section or a conversational statement does not substitute for a reviews entry.",
    );
  }

  // Gate 2 前置条件之二（21 §14，Human 裁定 2026-09-19 / workcase-2be11478）：
  // 至少一条 reviews 必须由**独立于实施者的会话**记录，低风险工单不豁免。
  //
  // 判据是会话身份（attempt.session_id vs reviews[].session_id，两者均由 Code 从
  // DSH 会话记录取得并盖戳），**不是** provider/model 署名——署名取自会话路由值，
  // 同 provider/model 的两个不同会话会盖出完全相同的署名（实测：workcase-4005b67b
  // 与 workcase-2be11478 的署名同为 workbuddy/deepseek-v4.1-flash），故署名无法
  // 区分复核者与实施者。
  //
  // 三条 fail-closed 路径，各有可操作的原因（不静默放行、不猜）：
  //   (a) attempt.session_id 缺失/不可得 → 无法建立比对基准；
  //   (b) 无任何 reviews 条目携带 session_id → 无候选复核会话；
  //   (c) 全部候选的 session_id 与实施会话相同 → 同一会话自评，冒充独立复核。
  //
  // 诚实边界：这只能证明「记录该结论的会话 ≠ 记录该实施尝试的会话」，**不证明**
  // 视角实质独立、内容正确或结论成立（02 §15 语义判断仍归 AI/Human）；同一主控
  // 编排出的隔离子会话在机械上满足本判据，这不是缺陷而是本判据被明确声明的范围。
  // 判据（独立复核发现后收紧，2026-09-19）：每一条 reviews 都要与**它自己写入时的**
  // 实施者身份比对，而不是与「当前」attempt 比对。
  //
  // 为什么必须按条目判：门禁原先只比对当前 attempt，而 reviews 跨 attempt 保留
  // （身份按索引继承，见 stampReviewEntries）。于是「实施者写一条自查 → takeover 把
  // attempt 换成另一会话 → 关闭」就能让自查被当成独立证据——独立对抗复核实测复现
  // （`probe-attempt-rot`：close ok=true）。故每条记录在写入时被盖上一个
  // `implementer_session_id`（当时的实施者，Code 托管），关闭时逐条比对两者是否不同。
  //
  // 三条 fail-closed 路径（不静默放行、不猜）：
  //   (a) 无任何条目携带可比对的双方身份 → 无从建立独立性；
  //   (b) 所有可比对条目都是「记录者 == 当时的实施者」→ 全部是同会话自评；
  //   (c) 身份不可读（attempt 或条目缺身份）不视为独立。
  // 只有两端身份**都来自宿主执行上下文**（source === "host"）才构成判据：
  // shell 来源可被一行环境变量伪造（独立对抗复核实测），故不计入。
  const comparable = (fm.reviews ?? []).filter((entry) => (
    isPlainObject(entry)
    && typeof entry.session_id === "string" && entry.session_id.length > 0
    && entry.session_source === "host"
    && typeof entry.implementer_session_id === "string" && entry.implementer_session_id.length > 0
    && entry.implementer_session_source === "host"
  ));
  if (comparable.length === 0) {
    return failure(
      "workcase/review_independence_unverifiable",
      "Gate 2 closure requires a mechanical independent-review check, but no reviews entry carries BOTH "
      + "the reviewer's session identity and the implementer identity in force when it was written "
      + "(workcase-2be11478, Human 裁定 2026-09-19). Entries written before the anchor existed have no "
      + "identity, and an unknown must not be treated as independent. Record a fresh review via "
      + "record_review (status=open) so the entry is stamped with the reviewer's authoritative session "
      + "identity and the then-current implementer, then close. If no independent session can review, do "
      + "NOT close — hold open and hand back to Human (21 §18).",
    );
  }
  const independentEntries = comparable.filter((entry) => entry.session_id !== entry.implementer_session_id);
  if (independentEntries.length === 0) {
    const selfSession = comparable[0].session_id;
    return failure(
      "workcase/review_independence_missing",
      "Gate 2 closure requires at least one reviews entry recorded by a session OTHER than the one "
      + `executing the work at the time it was recorded: every comparable entry was written by its own `
      + `implementer (session_id "${selfSession}" == implementer_session_id). A self-check is a legitimate `
      + `主控自查 but it is NOT an independent review and must not be recorded as one (02 §15: the three `
      + `review forms are not interchangeable). Note that rotating the attempt (takeover/reallocate) does `
      + `NOT turn an earlier self-check into an independent review — each entry is judged against the `
      + `implementer in force when it was written. Have a session other than the implementer's record the `
      + `review (a delegated subagent session or another governed root session both satisfy this; 32 §12: `
      + `独立子代理为默认优先形态), then close. If no independent session can review, do NOT close — `
      + `hold open and hand back to Human (21 §18).`,
    );
  }

  const next = structuredClone(fm);
  next.status = "closed";
  next.outcome = outcome;
  next.result = stripCallerOnlyFields(result);
  // attempt 收口: the token is retracted; its history stays in change_log.
  const closedAttempt = fm.attempt?.attempt_id;
  delete next.attempt;
  appendChangeLog(next, sig, `${changeSummary} [gate_2 closed with outcome=${outcome}; attempt ${closedAttempt ?? "none"} retracted]`);

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body, fm, current.value.body);
}

// ---------------------------------------------------------------------------
// rebatch — open → draft (C2 局部重批, 21 §9.2/§10.3/§14)
// ---------------------------------------------------------------------------

export async function rebatchWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (must carry 重批原因 + 当时已完成的 criteria_checks 快照结论, 21 §9.2)");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the revised draft body: 摘要/授权范围/计划)");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `rebatch requires status=open (C2 invalidation happens while executing), got ${JSON.stringify(fm.status)} (21 §10.3)`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "draft";
  // §9.2: attempt 作废（不续跑）；result/outcome 一并清空；gate_1 回落（draft
  // 不得携带）——已取得的核对证据写入 change_log 语义摘要（调用方职责）。
  const voidedAttempt = fm.attempt?.attempt_id;
  delete next.attempt;
  delete next.result;
  delete next.outcome;
  delete next.gate_1;
  // Code 托管字段锁定（03 §9.5 / 21 §8）：`change_log` 是「每次实际修改恰好一条」的
  // 权威流水，只能由 Code 追加。`next` 来自调用方 payload，故必须显式回落为
  // `fm.change_log`——否则调用方可在 `frontmatter_after` 里注入伪造条目，把对象的
  // 全部审计历史整体替换（起草者实测：传一条伪造条目即清空 2 条真实历史）。
  // `execute`/`revise`/`cancel` 均已如此锁定，`rebatch` 此前漏做。
  next.change_log = fm.change_log;
  // `reviews` 处置（21 §9.2/§176）：重批使 `plan`/`scope` 实质变化，旧复核针对的是
  // **旧授权范围**，故不得延续为当前授权下的复核记录。但 21:176 又要求「不丢历史」。
  // 二者以 §9.2 对 `criteria_checks` 的既有处置范式调和：**作废字段值 + 要点入
  // change_log**（复核概要的条目数/署名/时间以语义摘要形式留痕），既守住
  // 「draft 不得携带 reviews」的既有不变量（writer:472），又不丢历史。
  const voidedReviews = Array.isArray(fm.reviews) ? fm.reviews.length : 0;
  delete next.reviews;
  appendChangeLog(
    next,
    sig,
    `${changeSummary} [C2 局部重批 open→draft; attempt ${voidedAttempt ?? "none"} voided, gate_1 dropped`
    + `${voidedReviews > 0 ? `, ${voidedReviews} 条 reviews 随授权失效作废（旧复核针对旧 plan/scope；概要要点见本条语义摘要）` : ""}`
    + ` — 重新组织后重走 Gate 1]`,
  );

  const servesCheck = await resolveServes(factSourceRoot, next.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;
  const refsCheck = await resolveRefsTargets(factSourceRoot, next.refs);
  if (!refsCheck.ok) {
    return failure("workcase/refs_target_unresolvable", refsCheck.reason, { missing: refsCheck.missing });
  }

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body, fm, current.value.body);
}

// ---------------------------------------------------------------------------
// cancel — draft → closed, outcome=cancelled (21 §9.2)
// ---------------------------------------------------------------------------

export async function cancelWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    result, changeSummary, bodyMarkdownAfter, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body including the 结果 section with the cancellation record)");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `cancel (draft→closed) requires status=draft; an approved workcase must go through Gate 2 instead, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }

  const next = structuredClone(fm);
  next.status = "closed";
  next.outcome = "cancelled";
  next.result = stripCallerOnlyFields(result);
  appendChangeLog(next, sig, `${changeSummary} [cancelled before execution; no Gate 1 approval existed]`);

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body, fm, current.value.body);
}

// ---------------------------------------------------------------------------
// revise — draft → draft controlled revision (03 §9.5, 21 §14)
// ---------------------------------------------------------------------------

export async function reviseWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `revise requires status=draft (pre-Gate-1 evolution); once open, substantive change goes through rebatch, got ${JSON.stringify(fm.status)}`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "draft";
  next.change_log = fm.change_log;
  appendChangeLog(next, sig, changeSummary);

  const servesCheck = await resolveServes(factSourceRoot, next.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;
  const refsCheck = await resolveRefsTargets(factSourceRoot, next.refs);
  if (!refsCheck.ok) {
    return failure("workcase/refs_target_unresolvable", refsCheck.reason, { missing: refsCheck.missing });
  }

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body, fm, current.value.body);
}

// ---------------------------------------------------------------------------
// 终态事实更正 (21 §9.2 / 03 §9.5 / 03 §10) — closed 记录的受控内容更正
// ---------------------------------------------------------------------------

/**
 * 终态事实更正入口：让 **closed** 记录的正文缺陷可被受控修正。
 *
 * 存在理由 —— 21 §9.2 的原文承诺此前没有实现承接：原文
 *   「终态不直接重开：closed 后不得回到 draft 或 open…**若原终态记录本身错误，
 *     按事实更正规则修正，不把更正伪装成领域状态转换**（与 20 §9.2 同纪律）」
 * 而六个转换入口各有前置状态校验（approve 需 draft、execute 需 open、close 需 open、
 * rebatch 需 open、cancel 需 draft、revise 需 draft），closed 对象**没有任何合法写
 * 路径**：记录缺陷只能停在原地，或被迫走「重开 / 伪造状态转换」这类 21 §9.2 末尾
 * 明确列为禁止项的路子。首例受害者 workcase-d5273e1c：建议段写成 `### 建议` H3
 * 形态，呈现层只认登记引导词（`- advice:`），于是 3 条去向不投影，使语料守卫
 * workcase-projection-fidelity 永久红——对象已 closed，无法自愈。
 *
 * 与 03 §10 对齐（「普通内容更新、事实更正、关系变更、状态转换…是不同动作」）：
 * 更正**不复用**任何转换入口，也**不接受** `frontmatter_after`。终态判定与授权快照
 * （status / outcome / result / gate_1 / attempt / plan / scope / serves / relations /
 * refs / reviews）一律逐字继承**落盘对象**——这一点由「结构上根本不读调用方
 * frontmatter」机械保证，而不是靠写入后比对断言（断言可被将来改动绕过，结构不会）。
 * 可变动的只有正文，以及 Code 追加的**恰好一条** change_log 条目。
 *
 * 权限与纪律（沿用既有口径，不新造特权）：更正与其它受控更新**同权限**——必须携带
 * Human 明确授权的记录（`humanAuthorization`，非空），缺授权即 fail-closed；并与
 * 「同纪律」一致（03 §9.5：完整 after 内容、指纹 CAS、恰好一条 change_log）。
 *
 * 范围边界（如实声明）：**仅正文**。记录级字段（plan / scope / reviews 等）的更正
 * 不在本入口范围——它们与授权指纹、关闭门禁证据同源，放开即等于把「终态判定能否被
 * 改写」重新打开；若将来出现该类缺陷，须另立入口并单独设计字段级冻结判据。
 */
export async function correctWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    bodyMarkdownAfter, changeSummary, humanAuthorization,
    sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("workcase/change_summary_required", "changeSummary is required — 03 §9.5 requires exactly one change_log entry per write");
  }
  if (typeof humanAuthorization !== "string" || humanAuthorization.trim().length === 0) {
    return failure("invalid_request", "humanAuthorization is required for a terminal fact correction — 更正与其它受控更新同权限（Human 确认；20 §9.2 / 23 §9.3 / 26 §9）；无授权记录的更正请求 fail-closed");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body starting with '## 摘要')");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "closed") {
    return failure(
      "workcase/correction_requires_closed",
      `terminal fact correction applies to a CLOSED record only (21 §9.2: 终态记录本身错误时按事实更正规则修正); got status=${JSON.stringify(fm.status)} — a draft/open object changes through approve/execute/rebatch/cancel/revise, and routing a content update through this entry would be exactly the 「把更正伪装成状态转换」 inversion the spec forbids`,
    );
  }
  // 终态记录的逐字继承：`next` 是落盘 frontmatter 的克隆，调用方无法触及任何字段。
  const next = structuredClone(fm);
  // 无写入判定按**装载后的正文**比对：读路径返回的正文含 H1（调用方按 21 §8
  // 只传 H2 起的部分），且 buildFileContent 落盘时正文末尾恒有一个换行，
  // 故读回的正文比 assembleBody 的产物多一个尾换行——直接比对字符串会把每次
  // 调用都当成「有改动」，于是这里比对的是**去掉尾随空白**的正文。
  const trimEnd = (text) => text.replace(/\s+$/, "");
  const body = assembleBody(next.title, bodyMarkdownAfter);
  if (trimEnd(body) === trimEnd(current.value.body)) {
    return failure("invalid_request", "the supplied body assembles to the stored body (trailing blank lines aside) — a no-op write would append a change_log entry claiming a correction that did not happen (03 §9.5 的「恰好一条 change_log」指一次真实写入)");
  }
  // 变更摘要沿用仓内已登记的措辞（workcase-18fcee2c 的三条事实更正条目），
  // 便于读者与呈现层把它识别为「非状态转换」的更正，而非一次阶段推进。
  appendChangeLog(
    next,
    sig,
    `事实更正（非状态转换）——${changeSummary}。终态判定未变：status/outcome/result/gate_1/attempt/plan/scope/reviews 逐字继承落盘对象（本入口不接收 frontmatter，故改动在结构上不可能），仅正文重写。依 21 §9.2「若原终态记录本身错误，按事实更正规则修正，不把更正伪装成领域状态转换」与 03 §9.5，经 Human 授权：${humanAuthorization.trim()}`,
  );
  return writeValidated(factSourceRoot, next, body, fm, current.value.body);
}

// ---------------------------------------------------------------------------
// list — F0/F1 discovery (21 §13)
// ---------------------------------------------------------------------------

export async function listWorkcaseObjects(args) {
  const { factSourceRoot, includeClosed = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }
  const typeDir = join(factSourceRoot, WORKCASE_DIRECTORY);
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return success({ items: [], total: 0, complete: true, invalid: [] });
    return failure("workcase/directory_unavailable", `cannot read workcases directory: ${error.message}`);
  }

  const invalid = [];
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const nameMatch = entry.name.match(/^workcase-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i);
    if (!nameMatch) continue;
    const uid = nameMatch[1].toLowerCase();
    let content;
    try {
      content = await readFile(join(typeDir, entry.name), "utf8");
    } catch (error) {
      invalid.push({ file: entry.name, reason: `unreadable: ${error.message}` });
      continue;
    }
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) { invalid.push({ file: entry.name, reason: "no YAML frontmatter block" }); continue; }
    let frontmatter;
    try {
      frontmatter = parseYaml(fmMatch[1]);
    } catch (error) {
      invalid.push({ file: entry.name, reason: `frontmatter parse error: ${error.message}` });
      continue;
    }
    const status = frontmatter.status;
    if (!STATUSES.has(status)) {
      invalid.push({ file: entry.name, reason: `status ${JSON.stringify(status)} outside the closed set` });
      continue;
    }
    // F1 default candidates: draft + open (21 §13: closed 只在精确引用、
    // 证据链反查或历史追溯时展开).
    if (!includeClosed && status === "closed") continue;
    items.push({
      object_uid: uid,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      serves: typeof frontmatter.serves === "string" ? frontmatter.serves : undefined,
      outcome: status === "closed" && typeof frontmatter.outcome === "string" ? frontmatter.outcome : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  return success({ items: complete ? items : items.slice(0, limit), total: items.length, complete, invalid });
}
