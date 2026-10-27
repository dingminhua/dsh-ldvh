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
 *
 * IMPLEMENTATION STATUS (2026-10-09, corrected here — the previous
 * wording claimed "every writer flow verifies the fingerprint still
 * matches" and was false): there is **no** content comparison against
 * the STORED gate_1.authorization_fingerprint anywhere in this file.
 * The fingerprint is computed (on `approve` and on an approved
 * adjustment), shape-checked (64-hex), and echoed back on read
 * (`workcase-tools.js` projects it as `gate_1_fingerprint` so a caller
 * can self-check) — never compared. While
 * status=open, the only C2 guard is `assertAuthorizedPairFrozen`,
 * which compares the plan+scope fingerprint *before and after the
 * incoming payload* within a single `execute` call — that blocks an
 * in-place edit, but it never re-validates the authorization against
 * the pinned value.
 *
 * Consequence, stated rather than papered over: a mismatch between the
 * stored fingerprint and the current plan+scope is NOT detected. The
 * closing path and every other flow are unguarded on this point. 21
 * §15.1 declares this gap in as many words; the code now matches that
 * declaration. Closing it needs a stored-vs-current comparison, which
 * requires the 25 §11 `goal-changed 待核对` cascade marker to tell
 * "a legitimate §10.3 case-③ rebatch" from "an abuse of rebatch" —
 * that marker has no implementation. Tracked as
 * `ldvh-base/workcases/workcase-4005b67b-*`; do not "fix" it silently
 * here.
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

/**
 * 正文是否已携带「## 结果」节（21 §8「待批准关闭」期的判据之一）。
 *
 * 与 10 §5 的 `awaiting_gate2` 派生分组同源：`status = open` ∧ 本函数为真 ⇒ 该期。
 * 用于 Gate 2 前置条件之四——关闭提案须**先行落盘**（见 closeWorkcaseObject）。
 *
 * **必须经 `h2Titles` 而非正则扫全文**：该函数按 CommonMark 语义跳过 fenced code
 * block，故正文里作为**字面内容**出现的「## 结果」（如引用写法示例）不被误判为
 * 真实章节。用朴素正则会使「结果节」在示例文本中被凭空认作存在，使本闸静默失效。
 */
export function bodyHasResultSection(body) {
  if (typeof body !== "string" || body.length === 0) return false;
  return h2Titles(body).includes(BODY_H2_RESULT);
}

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
 * 「允许的顺带修缮：」独占一行 —— `scope` 的**第三个可选**标签（21 §8，Human 裁定 2026-09-29）。
 *
 * 语义：该标签之下逐条列出 Human 在 Gate 1 批准的**类别**，执行期落在这些类别内的
 * 顺带修缮可直接做（甲档）；**该标签缺席即不授权任何顺带修缮**（fail-closed）。
 * 它与另两个标签同属字段骨架，故同为 `scope` 的合法块首（见 `SCOPE_BLOCK_HEADS`）。
 */
const SCOPE_CATALOG_LINE = /^允许的顺带修缮[：:]\s*$/;

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
 * H3，或那**三个**已登记的标签行（两必备 + 一可选「允许的顺带修缮：」）。
 */
const SCOPE_BLOCK_HEADS = new Set(["做什么", "明确不做什么", "允许的顺带修缮"]);

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
    { name: "做什么", pattern: SCOPE_WHAT_LINE, index: -1, required: true },
    { name: "明确不做什么", pattern: SCOPE_NOT_LINE, index: -1, required: true },
    // 第三个标签**可选**（21 §8，Human 裁定 2026-09-29）：缺席＝不授权任何顺带修缮
    // （fail-closed），故**缺席不报错**；一旦出现，其下须有非空内容。
    { name: "允许的顺带修缮", pattern: SCOPE_CATALOG_LINE, index: -1, required: false },
  ];
  const isAnyLabel = (line) =>
    SCOPE_WHAT_LINE.test(line) || SCOPE_NOT_LINE.test(line) || SCOPE_CATALOG_LINE.test(line);
  for (const section of sections) {
    section.index = lines.findIndex((line) => section.pattern.test(line));
    if (section.index < 0 && section.required) {
      issues.push(
        `scope: missing a line holding exactly "${section.name}：" (21 §8 — 必须同时回答「做什么」与「明确不做什么」；须各占一行成段，不得行内串联)`,
      );
    }
  }
  for (const section of sections) {
    if (section.index < 0) continue;
    const rest = lines.slice(section.index + 1);
    const nextLabel = rest.findIndex(isAnyLabel);
    const body = (nextLabel < 0 ? rest : rest.slice(0, nextLabel)).join("\n").trim();
    if (body === "") {
      issues.push(
        `scope: section "${section.name}：" has no content (21 §8 — 标签下须列出该方向的具体范围)`,
      );
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
          field === "scope" ? "### 标签 或 做什么：/明确不做什么：/允许的顺带修缮：" : "### 标签"
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
  "gate_1", "attempt", "reviews", "pre_reviews", "result", "outcome",
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

/**
 * 21 §9.2「审核结论与主控判断不一致时的处置」：**同一次审核事项**最多 3 次。
 *
 * 2026-10-27 改口径（Human 决定）：计数单位从「同一候选指纹的条目数」改为
 * 「同一审核事项已用掉的轮次数」（`pre_reviews[].round_index` 的不同值）。
 * 原口径下每轮修订都改 `plan`/`scope`、指纹归零，上限从未触发——实测
 * workcase-996e207a 建前审 6 轮、单指纹最高 2 条。新口径不因修订或
 * `rebatch` 重置；分片并行共享同一 `round_index`，故不占额外轮次。
 */
export const PRE_AUDIT_ENTRIES_PER_MATTER_MAX = 3;

/** 21 §9.2（2026-10-27）：同一审核事项的轮次上限（与上一条同值，语义不同：一条数轮次，一条数条目）。 */
export const PRE_AUDIT_ROUNDS_MAX = 3;

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
  "pre_reviews", "gate_1", "attempt", "reviews", "result", "outcome",
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
// 建前审核的分区（audit partitions）— 21 §9.2/§14/§15.1（增量审核改造）
// ---------------------------------------------------------------------------
//
// 为什么需要分区：改造前覆盖闸要求 `candidate_fingerprint` 等于当前
// `plan`+`scope` 的**整体**指纹，于是「改一个行号」也会让前一次的 pass
// 失效、必须整份重审；同时轮次上限按整体指纹计数，每轮修订都换指纹、
// 计数归零，3 轮上限因此从未生效（实测 workcase-996e207a 建前审 6 轮）。
//
// 分区的口径（Human 决定 2026-10-27）：`plan` 每个步骤一个分区，`scope`
// 每个条目（「做什么」「明确不做什么」「允许的顺带修缮」标签下的每个
// `- ` 项）一个分区。指纹取**内容**的哈希（不含索引），故增删步骤不会
// 让其余分区漂移；未变分区可沿用既有 `pass`，只审改动分区。

const SCOPE_LABEL_PATTERN = /^\s*(做什么|明确不做什么|允许的顺带修缮)\s*[：:]\s*$/;

/**
 * 把 `scope` 文本切成条目级分区。不达标准形态（无标签行或无 `- ` 项）时
 * 整体作为**一个**分区——宁可多审、不可漏审（fail-closed）。
 */
function splitScopePartitions(scope) {
  const text = typeof scope === "string" ? scope : "";
  const out = [];
  const counts = new Map();
  let kind = null;
  let item = null;

  const flush = () => {
    if (item !== null && item.text.trim().length > 0) {
      const nextCount = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, nextCount);
      out.push({ id: `scope:${kind}#${nextCount}`, kind, text: item.text.trim() });
    }
    item = null;
  };

  for (const raw of text.split("\n")) {
    const label = raw.match(SCOPE_LABEL_PATTERN);
    if (label) {
      flush();
      kind = label[1];
      continue;
    }
    const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flush();
      item = { text: bullet[1] };
      continue;
    }
    if (kind !== null && raw.trim().length > 0) {
      item = item === null ? { text: raw.trim() } : { text: `${item.text}\n${raw.trim()}` };
    }
  }
  flush();

  if (out.length === 0) {
    const whole = text.trim();
    if (whole.length > 0) out.push({ id: "scope#1", kind: "scope", text: whole });
  }
  return out;
}

function partitionFingerprint(value) {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

/**
 * 计算候选的审核分区表：`[{id, kind, fingerprint}]`。
 *
 * 指纹只覆盖**内容**（plan 项整体 / scope 条目的类别 + 正文），不覆盖索引，
 * 故「删掉第 2 步」不会使第 3 步的指纹改变——那一步已审过的 `pass` 继续有效。
 */
export function computeAuditPartitions(plan, scope) {
  const partitions = [];
  const planList = Array.isArray(plan) ? plan : [];
  planList.forEach((item, index) => {
    partitions.push({
      id: `plan#${index + 1}`,
      kind: "plan",
      fingerprint: partitionFingerprint(item),
    });
  });
  for (const part of splitScopePartitions(scope)) {
    partitions.push({
      id: part.id,
      kind: part.kind,
      fingerprint: partitionFingerprint({ kind: part.kind, text: part.text }),
    });
  }
  return partitions;
}

/**
 * 覆盖闸的判定：当前每个分区是否都被某条合格（pass + 子代理）条目覆盖。
 *
 * 条目分两种形态：
 *  - **分区形态**（改造后）：读 `covered_partitions[{id, fingerprint}]`，按
 *    指纹匹配——内容未变的分区可跨轮、跨修订沿用既有 `pass`。
 *  - **整体形态**（改造前的存量条目，无 `covered_partitions`）：只有其
 *    `candidate_fingerprint` 等于当前整体指纹时才算覆盖全部分区——即
 *    旧口径，不做过度声称。
 *
 * @returns `{covered: string[], uncovered: string[]}`（id 列表，便于报告）
 */
export function auditCoverageFor(plan, scope, entries) {
  const current = computeAuditPartitions(plan, scope);
  const currentWhole = computeAuthorizationFingerprint(plan, scope);
  const coveredFingerprints = new Set();
  let coveredWhole = false;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isPlainObject(entry)) continue;
    if (entry.verdict !== "pass" || entry.auditor_origin !== "subagent") continue;
    if (Array.isArray(entry.covered_partitions)) {
      for (const part of entry.covered_partitions) {
        if (isPlainObject(part) && typeof part.fingerprint === "string" && FINGERPRINT_PATTERN.test(part.fingerprint)) {
          coveredFingerprints.add(part.fingerprint);
        }
      }
    } else if (entry.candidate_fingerprint === currentWhole) {
      coveredWhole = true;
    }
  }

  if (coveredWhole) {
    return { covered: current.map((p) => p.id), uncovered: [] };
  }
  const covered = [];
  const uncovered = [];
  for (const part of current) {
    (coveredFingerprints.has(part.fingerprint) ? covered : uncovered).push(part.id);
  }
  return { covered, uncovered };
}

// ---------------------------------------------------------------------------
// Frontmatter validation (specs/21 §8 + §15.1)
// ---------------------------------------------------------------------------

/**
 * 21 §6.1（2026-09-18）：`plan` 只承载本工作包特有的实施工作，不承载 WorkCase
 * 自身的生命周期关口。受控提交、独立复核、主控自查、Gate 批准及其收尾动作由
 * 06 / 02 §16 与本文 §9、§14 承接，不得被写成 plan 的步骤或 done_criteria。
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
        + "are carried by 06, 02 §16 and the status transitions (21 §6.1/§9/§14), NOT by a plan step. "
        + "Remove it from plan: the gate still happens, it just is not a plan step. "
        + "Note 21 §6.1 keeps test/lint/scan RESULTS admissible inside done_criteria and "
        + "result.criteria_checks[].evidence — only the gate-as-a-step is rejected. "
        + "(This check applies to new or modified plan items only; an item left byte-identical "
        + "to the existing object is an unrewritable historical record and passes.)",
      );
    }
  });
}

/** `gate_1.amendments`（增量授权流水）的条数上限（21 §8）。 */
const GATE1_AMENDMENTS_MAX = 20;

/** 申请项 step/done_criteria 的单字段长度上限（21 §14；复核 F-7）。 */
const ADJUSTMENT_ITEM_MAX_CHARS = 2000;

function validateGate1(frontmatter, issues) {
  const g = frontmatter.gate_1;
  if (!isPlainObject(g)) {
    issues.push("gate_1: must be an object {approved_at, approver, authorization_fingerprint, scope_snapshot} (21 §8)");
    return;
  }
  const extra = Object.keys(g).filter((k) => !["approved_at", "approver", "authorization_fingerprint", "scope_snapshot", "amendments"].includes(k));
  if (extra.length > 0) issues.push(`gate_1: unexpected field(s) ${extra.join(", ")}`);
  // 21 §8／§14：`amendments` —— **增量授权**流水（乙档「增量审批」的承载）。
  // 每条 = 一次申请（items + rationale）＋ 可选的 Human 决定（decision）。
  // **待批 = 末项无 `decision`**（呈现层的机械判据即此，见 10 §5.5）。
  if (g.amendments !== undefined) {
    if (!Array.isArray(g.amendments)) {
      issues.push("gate_1.amendments: must be an array (21 §8)");
    } else if (g.amendments.length > GATE1_AMENDMENTS_MAX) {
      issues.push(`gate_1.amendments: ${g.amendments.length} entries exceeds the cap ${GATE1_AMENDMENTS_MAX} (21 §8) — this object needs a decision, not an unbounded amendment log`);
    } else {
      const firstUndecided = g.amendments.findIndex((a) => isPlainObject(a) && a.decision === undefined);
      if (firstUndecided >= 0 && firstUndecided !== g.amendments.length - 1) {
        issues.push("gate_1.amendments: an undecided entry must be the LAST one — 待批的判据是「末项无 decision」(10 §5.5)，其后再出现已决定条目会让两处判据给出相反结论");
      }
      g.amendments.forEach((a, i) => {
        if (!isPlainObject(a)) { issues.push(`gate_1.amendments[${i}]: must be an object`); return; }
        const extraA = Object.keys(a).filter((k) => !["requested_at", "items", "rationale", "decision"].includes(k));
        if (extraA.length > 0) issues.push(`gate_1.amendments[${i}]: unexpected field(s) ${extraA.join(", ")}`);
        if (typeof a.requested_at !== "string" || !RFC3339_PATTERN.test(a.requested_at)) {
          issues.push(`gate_1.amendments[${i}].requested_at: required RFC3339`);
        }
        if (!Array.isArray(a.items) || a.items.length === 0) {
          issues.push(`gate_1.amendments[${i}].items: must be a non-empty array of {step, done_criteria} (21 §14 — 申请必须写明要追加什么)`);
        } else {
          a.items.forEach((it, k) => {
            if (!isPlainObject(it) || typeof it.step !== "string" || it.step.trim().length === 0
              || typeof it.done_criteria !== "string" || it.done_criteria.trim().length === 0) {
              issues.push(`gate_1.amendments[${i}].items[${k}]: must be {step, done_criteria}, both non-empty (21 §8)`);
            }
          });
        }
        if (typeof a.rationale !== "string" || a.rationale.trim().length === 0) {
          issues.push(`gate_1.amendments[${i}].rationale: required non-empty (21 §14 — 申请须说明"不做它，已批判据就达不成")`);
        }
        if (a.decision !== undefined) {
          if (!isPlainObject(a.decision)) { issues.push(`gate_1.amendments[${i}].decision: must be an object`); return; }
          const extraD = Object.keys(a.decision).filter((k) => !["kind", "by", "at", "resulting_fingerprint", "session_id", "session_source"].includes(k));
          if (extraD.length > 0) issues.push(`gate_1.amendments[${i}].decision: unexpected field(s) ${extraD.join(", ")}`);
          if (a.decision.kind !== "approved" && a.decision.kind !== "rejected") {
            issues.push(`gate_1.amendments[${i}].decision.kind: must be "approved" | "rejected" (21 §14)`);
          }
          if (typeof a.decision.by !== "string" || a.decision.by.trim().length === 0) {
            issues.push(`gate_1.amendments[${i}].decision.by: required non-empty (the deciding Human identity, 21 §14)`);
          }
          if (typeof a.decision.at !== "string" || !RFC3339_PATTERN.test(a.decision.at)) {
            issues.push(`gate_1.amendments[${i}].decision.at: required RFC3339 (Code-stamped)`);
          }
          if (a.decision.kind === "approved" && (typeof a.decision.resulting_fingerprint !== "string" || a.decision.resulting_fingerprint.length === 0)) {
            issues.push(`gate_1.amendments[${i}].decision.resulting_fingerprint: required when approved (21 §14 — 批准后重算并留痕授权指纹)`);
          }
        }
      });
    }
  }
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
    const extra = Object.keys(entry).filter((k) => !["at", "provider", "model", "summary", "session_id", "session_source", "implementer_session_id", "implementer_session_source", "reviewer_origin"].includes(k));
    if (extra.length > 0) issues.push(`reviews[${i}]: unexpected field(s) ${extra.join(", ")} (only at/provider/model/summary/session_id/session_source/implementer_session_id/implementer_session_source/reviewer_origin)`);
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

/**
 * 21 §8：`pre_reviews`（**审核轴**的节点概要流水；2026-10-16 建立）。
 *
 * 与 `validateReviews` 形态对称、语义分立。两处关键差异：
 *   ① 形状必填项不同——本类型以 `candidate_fingerprint`（64-hex）替代复核轴的
 *      `implementer_*` 比对基准：审核轴的对象是**候选内容**，不是某次执行。
 *   ② `verdict` 是闭集，且覆盖闸只认 `pass`——故形状校验必须拒绝未知值，
 *      否则一个拼错的 verdict 会静默地永远无法满足覆盖闸（fail closed）。
 */
function validatePreReviews(frontmatter, issues) {
  const list = frontmatter.pre_reviews;
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    issues.push("pre_reviews: must be an array of {at, provider, model, summary, session_id, candidate_fingerprint, verdict} (21 §8)");
    return;
  }
  if (list.length === 0) {
    issues.push("pre_reviews: must be omitted when there are no audit entries — an empty array fabricates a conditional field (03 §6.1)");
    return;
  }
  if (list.length > REVIEW_ENTRIES_MAX) {
    issues.push(`pre_reviews: exceeds the ${REVIEW_ENTRIES_MAX}-entry cap (21 §8); refuse rather than truncate or compress existing entries`);
  }
  list.forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      issues.push(`pre_reviews[${i}]: must be an object {at, provider, model, summary, session_id, candidate_fingerprint, verdict} (21 §8)`);
      return;
    }
    const extra = Object.keys(entry).filter((k) => !["at", "provider", "model", "summary", "session_id", "session_source", "auditor_origin", "candidate_fingerprint", "covered_partitions", "round_index", "verdict"].includes(k));
    if (extra.length > 0) issues.push(`pre_reviews[${i}]: unexpected field(s) ${extra.join(", ")} (only at/provider/model/summary/session_id/session_source/auditor_origin/candidate_fingerprint/covered_partitions/round_index/verdict)`);
    if (typeof entry.at !== "string" || !RFC3339_PATTERN.test(entry.at)) {
      issues.push(`pre_reviews[${i}].at: required RFC3339 (Code-managed)`);
    }
    if (typeof entry.provider !== "string" || entry.provider.length === 0) {
      issues.push(`pre_reviews[${i}].provider: required non-empty (Code-managed authoritative signature)`);
    }
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      issues.push(`pre_reviews[${i}].model: required non-empty (Code-managed authoritative signature)`);
    }
    if (entry.session_id !== undefined && (typeof entry.session_id !== "string" || entry.session_id.length === 0)) {
      issues.push(`pre_reviews[${i}].session_id: when present must be a non-empty string (Code-managed session identity, 21 §14)`);
    }
    // `candidate_fingerprint` 是覆盖闸的判据本体：形状必须可校验，否则
    // 比对退化为字符串相等而无法发现「写进去的是别的东西」。
    if (typeof entry.candidate_fingerprint !== "string" || !FINGERPRINT_PATTERN.test(entry.candidate_fingerprint)) {
      issues.push(`pre_reviews[${i}].candidate_fingerprint: required 64-hex SHA-256 over the candidate's plan+scope (Code-computed, 21 §8)`);
    }
    // `round_index`（2026-10-27 增量审核）：同一审核事项的第几轮。分片并行时
    // 同一轮的多个分片共享同一个值，故轮次上限按**不同值**计数，而不是按条目数
    // ——这正是「分片不占轮次」的机械落点（21 §9.2）。
    if (entry.round_index !== undefined && (!Number.isInteger(entry.round_index) || entry.round_index < 1)) {
      issues.push(`pre_reviews[${i}].round_index: when present must be a positive integer (Code-assigned; 21 §9.2)`);
    }
    // `covered_partitions`（2026-10-27 增量审核）：该次审核覆盖的分区及其
    // 内容指纹。缺省即整体形态（存量条目），不强制补写。
    if (entry.covered_partitions !== undefined) {
      if (!Array.isArray(entry.covered_partitions) || entry.covered_partitions.length === 0) {
        issues.push(`pre_reviews[${i}].covered_partitions: when present must be a non-empty array of {id, fingerprint} (21 §8)`);
      } else {
        entry.covered_partitions.forEach((part, j) => {
          if (!isPlainObject(part) || typeof part.id !== "string" || part.id.length === 0) {
            issues.push(`pre_reviews[${i}].covered_partitions[${j}]: must be {id: non-empty string, fingerprint: 64-hex} (21 §8)`);
            return;
          }
          if (typeof part.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(part.fingerprint)) {
            issues.push(`pre_reviews[${i}].covered_partitions[${j}].fingerprint: required 64-hex SHA-256 of the partition content (Code-computed, 21 §8)`);
          }
        });
      }
    }
    if (entry.verdict !== "pass" && entry.verdict !== "needs_revision") {
      issues.push(`pre_reviews[${i}].verdict: must be "pass" or "needs_revision" (21 §8 闭集; the Gate 1 coverage gate accepts only "pass")`);
    }
    if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
      issues.push(`pre_reviews[${i}].summary: required non-empty (三维结论概要)`);
    } else if (entry.summary.length > REVIEW_SUMMARY_MAX_CHARS) {
      issues.push(`pre_reviews[${i}].summary: ${entry.summary.length} chars exceeds the ${REVIEW_SUMMARY_MAX_CHARS}-char cap (21 §8)`);
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
  // pre_reviews（**审核轴**，2026-10-16 建立）：draft 期可行（Gate 1 提请前须至少
  // 一条覆盖当前候选）；open/closed 期保留为历史。与 `reviews` 相反——后者在 draft
  // 期**不得**出现。两轴的生命周期位置不同，故此处不能与上一条合并判断。
  if (frontmatter.pre_reviews !== undefined) {
    // 上限门禁在写入侧（recordWorkcaseAudit）逐次拒绝，此处只做形状校验——
    // 同一判据两处实现必然分歧（09 §5 一致性纪律），故不重复计数。
    validatePreReviews(frontmatter, issues);
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
 * **从无** `routed-to`（实测 18 份 closed 中有 5 份**去向条数**少于 `residual` 长度（旧形态为「建议段」；新形态下建议段已不合法，见下方形态前提），
 * 另 1 份含「转入 Spark」却无 `routed-to`），若对 `correct` 无条件套用，这些对象的
 * **任何**更正（含与去向无关的事实更正）都会被拒，与 `§15.3` 的存量不溯及直接冲突。
 * 豁免基准是**「## 结果」节逐字未改**（非「解析出的条目列表深等」——条目级比较只覆盖
 * `- ` 条目，会放过改写尾注、加缩进续行、加整段散文、改缩进四类正文编辑，2026-09-28
 * 更正）；`baselineBody` 缺失时**按已改动处理**（fail closed：未知不等于未改动）。
 * **该判定发生在其后所有门禁之前**（`§16` 验证表：「存量豁免见 §15.3——基线为
 * `closed` 且「## 结果」节逐字未改时整体放行」）。
 *
 * **存量普查的实测口径（2026-09-30 按权威普查更正，走真实校验器而非正则）**：closed 18 份，
 * `result.residual` 共 79 条，去向条目共 56 条；**去向条数**少于 `residual` 长度的 **5** 份
 * （`workcase-1c6afa19` 4:2、`workcase-364df30e` 8:3、`workcase-4af2b871` 10:8、
 * `workcase-8d2ba256` 8:5、`workcase-99957f65` 8:1，缺口 2／5／2／3／7 合计 19 条）；
 * 另 2 份「## 结果」节**无残留段**、去向无处挂靠（`workcase-18fcee2c`、`workcase-be30b5f7`）；
 * 含「转入 Spark」而无 `routed-to` 恰 1 份（`workcase-8f4742f5`）。这些残留条目
 * **当年就没有去向**，且补写即属编造（`§15.3`）。**注**：条件豁免段已于 2026-09-29 由 Human
 * 裁定删除（10 §5.5），此处保留其历史存在只为解释本函数的判据沿革，**不再是现行规则**。
 *
 * **本项在存量改写通道上的已知限制（如实登记）**：`correct` 不接收 frontmatter，
 * 且 closed 对象无 `execute` 通道，故存量去向里的「转入 Spark」条目**无法**在改写时
 * 补齐 `routed-to`——存量改写只有三种可行写法：写成「接受现状」（含非空理由）并如实
 * 说明原意向、保持「## 结果」节逐字不动、或由 Human 另行决定处置。本项不代替该决定。
 */
/** 核对条目登记形态（`21 §190`，Human 决定 2026-10-15）：`- 计划步骤 N：<词>——证据：…`。 */
const CHECKLIST_ENTRY_TITLED = /^计划步骤\s*(\d+)\s*(?:判据「.*?」|[（(][^）)]*[）)])?\s*[:：]\s*(.+)$/s;
/** 区间形态：`- 计划步骤 N–M：<词>——证据：…`（逐条核对的区间简写，`21 §190`）。 */
const CHECKLIST_ENTRY_RANGE = /^计划步骤\s*(\d+)\s*[–\-~]\s*(\d+)\s*[:：]\s*(.+)$/s;
/**
 * 核对段**结论词**闭集（`21 §190` 三词）。顺序敏感：先长词后短词
 * （「达成」是「未达成」的子串，先判短词会把「未达成」误归一为「达成」）。
 */
const CHECKLIST_CONCLUSION_WORDS = ["部分达成", "未达成", "达成"];
/**
 * 段头（`21 §190`）：`### 逐条判据核对`；另接受既有的 bullet 形式（存量口径见 §15.3）。
 * 该 H3 是段的起界——段外的同形文字不计入核对。
 */
const CHECKLIST_SECTION_HEADING = /^ {0,3}###\s+逐条判据核对\s*$/;
const CHECKLIST_SECTION_OPENER = /^(criteria_checks|判据逐条核对)\s*[:：]?$/;

/**
 * 解析「## 结果」节的**逐条判据核对**段（`21 §190` 登记形态）。
 *
 * 与呈现层 `plugin/web/shared/workcaseResultDraft.ts` 的 `parseWorkCaseResultDraft`
 * **同形态**（两棵树互不 import，同 `parseResidualSection` 的先例）：形态由 `§190`
 * 单点登记，两处都只实现它。
 *
 * 为什么写入侧需要它：核对的登记形态是呈现层读取「待批准关闭」期核对的**唯一入口**，
 * 形态不合则卡面渲染出**空块且无任何报错**——实测 `workcase-562f75c1` 因前缀写作
 * 「计划步骤 1（…）」而使 6 条核对解析为 0 条。该失败必须由写入侧拦下，不得依赖
 * Human 阅读发现（Human 决定 2026-10-15：形态不合即拒绝落盘）。
 *
 * 返回 `{ entries, unshapedLines }`：
 *   - `entries`——形态合格的条目（含其 `N` 与结论词）；
 *   - `unshapedLines`——段**内**、看起来在写核对（含闭集结论词）但**前缀不符**登记
 *     形态的行。它使门禁能**区分**「没写核对段」与「写了但形态不合」——后者才是要拒的。
 *
 * **边界如实声明**：本函数只判**形态**（段头、前缀、`N` 是否落在 `plan` 界内、结论词
 * 是否在闭集内、证据是否非空），**不判**证据是否成立、判据是否真被覆盖——后者归 AI
 * 语义审核与 Human 阅读（`§16` 口径不变）。
 *
 * @param {string} resultSection 「## 结果」节的正文（不含该 H2 行本身）
 * @param {number} planLength 当前 `plan` 长度（`N` 的界，`§178`）
 */
export function parseChecklistSection(resultSection, planLength) {
  const entries = [];
  const unshapedLines = [];
  const lines = String(resultSection ?? "").split("\n");
  let inFence = false;
  let fenceMarker = "";
  const bound = Number.isFinite(planLength) && planLength > 0 ? planLength : 0;

  for (const rawLine of lines) {
    const fence = /^ {0,3}(```|~~~)/.exec(rawLine);
    if (fence) {
      const marker = fence[1];
      if (!inFence) { inFence = true; fenceMarker = marker; }
      else if (marker === fenceMarker) { inFence = false; fenceMarker = ""; }
      continue;
    }
    if (inFence) continue;

    // **段头不是判据**（`§190`）：呈现层在「## 结果」节内逐条扫描登记形态的条目，
    // 不要求 `### 逐条判据核对` 存在（既存载体两种写法都有）。故本解析器同样**不据段头
    // 设门**——否则会出现「卡面能渲染、写入却拒绝」的新错配，正是本项要消除的缺陷形态。
    // 段头行与开启符行只作跳过处理，不改变扫描范围。
    if (CHECKLIST_SECTION_HEADING.test(rawLine)) continue;

    const bullet = /^(\s*)-\s+(.*)$/.exec(rawLine);
    if (!bullet) continue;
    const item = bullet[2].trim();

    // 开启符（`- criteria_checks:` / `- 判据逐条核对:`）本身不是核对条目，跳过。
    if (CHECKLIST_SECTION_OPENER.test(item)) continue;

    const range = CHECKLIST_ENTRY_RANGE.exec(item);
    if (range) {
      entries.push({ from: Number(range[1]), to: Number(range[2]), text: range[3] });
      continue;
    }
    const titled = CHECKLIST_ENTRY_TITLED.exec(item);
    if (titled) {
      entries.push({ from: Number(titled[1]), to: Number(titled[1]), text: titled[2] });
      continue;
    }
    // 形态不合但**看起来在写核对条目**——记下，供门禁区分「没写核对」与「写歪了」。
    //
    // **判据必须收敛到「像一条核对条目」，不能只看「含结论词」**：结果节的散文里出现
    // 「达成」二字极常见（如「逐条核对：两步判据均达成。」「未达成的原因见下」），
    // 把它们一律当不符形态会**误拒合规载体**——实测该过度判据使 13 个既有用例变红。
    //
    // 收敛后的判据（两条任一）：
    //   ① 以「(计划)步骤 N」开头 —— 这是**已登记的旧形态**，属明确要拦的写法；
    //   ② 形如 `<标题>：<词>`（`：` 前后都有内容，且冒号前是简短标题而非整句）——
    //      即「本该用登记前缀、却写成了别的标题」。冒号前含句末标点或过长者判为散文。
    const looksLikeEntry =
      /^(?:计划)?步骤\s*\d/.test(item)
      || (() => {
        const colon = item.search(/[:：]/);
        if (colon <= 0) return false;
        const head = item.slice(0, colon).trim();
        // 标题须短且不含句末标点——否则是散文（如「逐条核对：两步判据均达成。」）。
        if (head.length > 24) return false;
        if (/[。；;]/.test(head)) return false;
        // 且冒号后须**紧跟闭集结论词**（允许 `**达成**` 这样的强调包裹）。
        const tail = item.slice(colon + 1).replace(/^[\s*]*/, "");
        return CHECKLIST_CONCLUSION_WORDS.some((word) => tail.startsWith(word) || tail.startsWith(`**${word}`));
      })();
    if (looksLikeEntry) {
      unshapedLines.push(item);
    }
  }

  // `N` 的界（`§178`）：落在界外的条目单列为越界，由门禁报告，不静默丢弃。
  const outOfRange = entries.filter((entry) => bound > 0 && (entry.from < 1 || entry.to > bound));

  return { entries, unshapedLines, outOfRange, bound };
}

/**
 * 核对段形态门禁（`21 §190`，Human 决定 2026-10-15「形态不合即拒绝落盘」）。
 *
 * **只在「## 结果」节存在且写有核对内容时判定**——没有结果节（draft/executing 早期）
 * 或没有核对段的载体不受本项约束（不是缺陷，是当期还没有内容）。
 *
 * **存量豁免**（`§15.3` 存量不溯及）：与 `validateDirectionCompleteness` 同基准——
 * `baseline` 为 `closed` 且「## 结果」节**整体逐字未改**时整体放行；`baselineBody`
 * 缺失时按**已改动**处理（fail closed：未知不等于未改动）。
 *
 * **与 §180 的边界**：本条只管「结果」节核对**条目**的形态，扫描范围限于该段之内；
 * 不扫描正文其它位置对编号的自由引用——§180 的禁令对编号引用继续有效。
 */
export function validateChecklistForm(frontmatter, body, baseline = null, baselineBody = null) {
  const issues = [];
  const resultSection = sectionContent(body, BODY_H2_RESULT);
  if (resultSection === null) return { ok: true, issues };

  // 存量豁免：基线为 closed 且结果节逐字未改 → 整体放行（与去向门禁同一基准）。
  if (baseline && baseline.status === "closed" && typeof baselineBody === "string") {
    const baselineResult = sectionContent(baselineBody, BODY_H2_RESULT);
    if (baselineResult !== null && baselineResult === resultSection) {
      return { ok: true, issues };
    }
  }

  const plan = Array.isArray(frontmatter.plan) ? frontmatter.plan : [];
  const parsed = parseChecklistSection(resultSection, plan.length);

  // ① 段内出现「看起来是核对、但前缀不符登记形态」的行——**这是本项要拦的主形态**。
  //    给出可操作文案：登记形态是 `- 计划步骤 N：<词>——证据：…`。
  if (parsed.unshapedLines.length > 0) {
    issues.push(
      `checklist form: "## 结果" 逐条判据核对段的条目必须使用登记形态 — found ${parsed.unshapedLines.length} 行含闭集结论词但不符形态。`
      + ` 21 §190 (2026-10-15) 登记的形态是 "- 计划步骤 N：<词>——证据：…"（N 以当前 plan 为界；`
      + ` 括号简述与判据引文可跟在 N 之后，但前缀必须是「计划步骤 N」——「步骤 N」不再是合法前缀）。`
      + ` 可操作处置：把每条改写成 "- 计划步骤 N：<达成|部分达成|未达成>——证据：…"。`
      + ` 不符行示例：${parsed.unshapedLines.slice(0, 3).map((line) => `"${line.slice(0, 60)}"`).join(" / ")}`
      + ` — fail closed (21 §190；呈现层读不出则卡面渲染为空块且无报错，故须在写入侧拦下)`,
    );
  }

  // ② `N` 越界（`§178`：N 以当前 plan 数组为界）。
  if (parsed.outOfRange.length > 0) {
    const nums = parsed.outOfRange
      .map((entry) => (entry.from === entry.to ? `${entry.from}` : `${entry.from}–${entry.to}`));
    issues.push(
      `checklist form: "## 结果" 核对条目的 N 越出当前 plan 界 — found N=${nums.join(", ")}，plan 长度 ${plan.length} (21 §178：N 以当前 plan 数组为界)。`
      + ` 可操作处置：按当前 plan 重编 N，或（若步骤已被 C2 局部重批增删）改以叙述形式引用旧序号（21 §8 历史记述处置）— fail closed`,
    );
  }

  // ③ 写有核对条目但证据为空（`§190`：`——证据：` 后须有内容）。
  for (const entry of parsed.entries) {
    const word = CHECKLIST_CONCLUSION_WORDS.find((candidate) => entry.text.includes(candidate));
    if (!word) continue; // 结论词不在闭集内另由 §190 词表覆盖（呈现层归一为 null，不在此重复判定）
    const evidenceAt = entry.text.indexOf("证据");
    const evidence = evidenceAt >= 0 ? entry.text.slice(evidenceAt).replace(/^证据\s*[:：]?/, "").trim() : "";
    if (evidence.length === 0) {
      issues.push(
        `checklist form: "## 结果" 核对条目缺少证据 — N=${entry.from} 的「——证据：」后为空 (21 §190)。`
        + ` 可操作处置：补写该条判据的可回读依据 — fail closed`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

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

/**
 * The Code-stamped suffix `approveWorkcaseObject` appends, as a *whole bracketed
 * tail*. Matching the whole tail — not a bare substring — is what keeps a
 * caller's free-form `changeSummary` from tripping the gate: `changeSummary` is
 * caller-filled prose, so a draft revised with the wording "gate_1 approved by"
 * anywhere in its text must still be cancellable (independent review,
 * workcase-4005b67b, found this over-strict edge and it is now covered by a
 * regression test). `approve` stamps the bracket as the final segment, always
 * and unconditionally.
 */
const GATE1_APPROVAL_STAMP = /\[gate_1 approved by .*; attempt \d+ allocated to .*\]$/;

/**
 * Evidence that this object was ever granted Gate 1 authorization, derived from
 * the Code-stamped `change_log` (21 §10.4). Returns a short human-readable
 * locator, or null when no approval is on record.
 *
 * Why this shape (workcase-4005b67b, plan step 2): `close` is guarded by the E4
 * review gate but `cancel` (draft→closed) was not, and `rebatch` explicitly
 * `delete`s both `gate_1` and `reviews` — so an authorized, already-executed
 * workcase could be driven open→rebatch→cancel straight into a `closed` record
 * that never passed an independent review, violating 21:169 (`closed` ⇒
 * `reviews` required). `gate_1` itself cannot serve as the predicate: after
 * rebatch the field is gone while the authorization history is not.
 *
 * Every mutating path resets `next.change_log` back to the on-disk array before
 * appending (`execute`/`revise`/`rebatch` explicitly; the rest clone the on-disk
 * frontmatter), so a caller cannot inject or launder the entry through
 * `frontmatter_after`.
 *
 * **Declared limits of this text predicate** (independent review, verified by
 * attack): it proves only "this writer recorded an approval". Editing the
 * carrier file directly to blank the history defeats it — that layer is 09 code
 * review and 06 controlled commit, the same boundary 21 §14 declares for the
 * session-identity brand. A caller who *crafts* a `revise` `changeSummary`
 * ending in the exact stamp shape can still spoof it; narrowing that further
 * would need a non-text carrier, which this workcase's scope forbids adding.
 */
export function gate1ApprovalEvidence(frontmatter) {
  for (const entry of frontmatter?.change_log ?? []) {
    if (typeof entry?.summary !== "string") continue;
    if (GATE1_APPROVAL_STAMP.test(entry.summary)) {
      const at = typeof entry.at === "string" ? entry.at : "unknown-time";
      return `change_log entry at ${at}`;
    }
  }
  return null;
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
  // `mechanical_issues` 在此处**不被消费**（2026-10-09 明确记录，见
  // `ldvh-base/workcases/workcase-81c37ef0-*` 的 (C) 判定）——理由与未覆盖范围：
  //
  //   · **不是遗漏**。回读 issues 非空的前提是「落盘序列化后的内容与内存中已通过
  //     校验的对象不一致」，即 `buildFileContent` 的 YAML round-trip 有损；而
  //     `runMechanicalChecks` 已在上方对同一组内容跑完一套**涵盖**该回读所复算全部校验的检查（它含载体内聚与各门禁，是 `validateWorkcaseFrontmatter` 的超集），web 侧
  //     （`plugin/web/api/services/facts.ts`）也独立复算并投影 `structured_text_issues`。
  //   · **fail-closed 在此处是错的形态**。此刻文件**已经落盘**，返回 failure 不能回退
  //     已写入的字节——只会得到「对象已变、工具报失败」的不可解释状态。有意义的
  //     fail-closed 必须是**落盘前**对序列化结果做内存 round-trip 再校验一次。
  //   · **未覆盖范围**。该机制当前**不存在**，故本路径不声称「写入结果必符合机械
  //     校验」；一旦将来 `buildFileContent` 出现有损序列化，测试（多处断言回读
  //     `mechanical_issues.length === 0`）会先于本注释失效而变红。补齐它是新增机制，
  //     不在本单范围。
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

/**
 * **审核轴的写权限隔离**（2026-10-16 建立，承独立复核 F1/F2）。
 *
 * ## 为什么必须「结构性剥离」而不是「形状校验」
 *
 * `pre_reviews` 承载的是「建前独立审核已经做过」这一断言。该断言的价值完全取决于
 * **主控不能自己写它**——否则门禁读的是主控手里的文本，闸与被判方在同一信任域内。
 *
 * 实测失效（独立复核复现，2026-10-16）：`revise` 把调用方 `frontmatterAfter` 整体
 * 作为 `next`，`pre_reviews` 不在其托管字段重设清单里，于是**一次 revise 就能自造
 * 一条 verdict=pass、指纹正确的审核条目**，随后 approve 的两道闸全部放行：
 *
 *     approve without audit       → 拒绝（闸生效）
 *     revise forging pre_reviews  → 成功（旁路）
 *     approve after forged audit  → 放行（闸失效）
 *
 * 同一路径还能把子代理如实记下的 `needs_revision` **改写成 pass**。
 *
 * 形状校验挡不住：伪造的条目在形状上与真条目**完全一样**（这正是它能过闸的原因）。
 * 故处置只能是 `gate_1`/`attempt` 已用的做法——**不读调用方提供的该字段**，
 * 一律回落为落盘值。`record_audit` 由此成为该字段的**唯一写路径**。
 *
 * ## 为什么回落而非拒绝
 *
 * 本类型无删除操作（21 §14），且 `execute`/`revise` 的调用方普遍是「读出整个对象、
 * 改一处、整体写回」的形态——他们**会**在 payload 里带上 `pre_reviews`（那是读出来的
 * 原件，不是伪造）。若对这些一律拒绝，等于让所有整对象写回都失败。回落为落盘值
 * 既保住唯一写路径，又不误伤正常调用。
 *
 * 但「回落」不等于「静默」：调用方**改动过**该字段时，说明要么误操作、要么在尝试
 * 伪造——两者都必须报告，故返回 `attempted` 供调用方如实登记。
 *
 * @returns `fields`：已把 `pre_reviews` 替换为落盘值（落盘不存在则删除）；
 *   `attempted`：调用方提交的该字段与落盘不等。
 */
/**
 * 02 §10.5：「局部补丁可以是调用方降低表达摩擦的请求形态……必须把它绑定当前对象
 * 指纹，**在内存中形成完整目标 after**」。本函数就是那一步：把 payload 里缺省
 * （键不存在或值为 `undefined`）的字段补成落盘值，形成完整的 after。
 *
 * 为什么必须归一化 `undefined`：`structuredClone` 会保留键、只是值为 undefined；
 * 而「省略」与「显式给 undefined」在调用方看来是同一件事（工具参数里没填）。
 * 若不归一，after 里 `plan: undefined` 与 before 的 `plan: {...}` 指纹不同，
 * C2 守卫会把它读成「试图改冻结字段」而拒绝一次完全合法的正文更新。
 *
 * 只补**缺省**的键；显式给了值的字段原样保留——所以「真的想改 plan」仍然会被
 * C2 守卫拦下（那才是它该拦的）。
 */
function inheritOmittedFields(candidate, storedFrontmatter) {
  const supplied = candidate !== null && typeof candidate === "object" ? candidate : {};
  const after = {};
  // 先落盘值打底，再以调用方提供的值覆盖：缺省即继承。
  for (const [key, value] of Object.entries(storedFrontmatter ?? {})) after[key] = value;
  for (const [key, value] of Object.entries(supplied)) {
    if (value === undefined) continue; // 显式 undefined 等价于省略
    after[key] = value;
  }
  return after;
}

function guardAuditField(candidate, storedFrontmatter) {
  const fields = structuredClone(stripCallerOnlyFields(inheritOmittedFields(candidate, storedFrontmatter)));
  const stored = storedFrontmatter?.pre_reviews;
  const submitted = fields.pre_reviews;
  // 规范化序列化比较：同一份内容换键序不应算「改动」。
  const attempted = stableStringify(submitted ?? null) !== stableStringify(stored ?? null);
  if (stored === undefined) {
    delete fields.pre_reviews;
  } else {
    fields.pre_reviews = structuredClone(stored);
  }
  return { fields, attempted };
}

/** `guardAuditField` 的报告语：改动了该字段时如实说明已回滚（不静默吞掉）。 */
function auditFieldGuardNote(attempted) {
  return attempted
    ? "；调用方提交的 pre_reviews 与落盘不一致，已回落为落盘值（审核轴唯一写路径是 record_audit，21 §14）"
    : "";
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
  // 审核轴写权限隔离（承独立复核 F1，2026-10-16）：`pre_reviews` 的**唯一写路径**是
  // `record_audit`。创建时就允许携带它，等于让「审核已做过」这一断言在建单瞬间即可
  // 由主控自造——实测原实现正是如此：create 携带一条 verdict=pass 且指纹正确的条目
  // 即落盘成功，approve 的两道闸随后全部放行，record_audit 通道被整条跳过。
  //
  // 此处取**拒绝**而非「回落删除」：与上面三条同形（都是「该状态本不该有」），
  // 且创建时不存在「读出整个对象再写回」的正常形态，调用方带它就是错的。
  // 写入期的回落（guardAuditField）针对的是整对象写回的既有形态，两者场景不同。
  if (frontmatter.pre_reviews !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry pre_reviews (只有建前审核的 record_audit 通道可写该字段，21 §14)");

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
  const checklistCheck = validateChecklistForm(frontmatter, body, baseline, baselineBody);
  if (!checklistCheck.ok) {
    return { ok: false, code: "workcase/checklist_form_invalid", message: "逐条判据核对 failed form checks", issues: checklistCheck.issues };
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
 * 独立审核实测（2026-09-19）：shell 通道逐字采信 `DSH_SESSION_JSONL` /
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
  const reviewerOrigin = identity === null ? null : (identity.origin ?? null);
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
    // 复核者来源形态（Human 决定 2026-10-09；04 §7.3 承载形式唯一化为受管辖隔离子代理）。
    // Code 托管：只对本次新写入的条目盖戳，既有条目按索引继承其原值（缺失即缺失）。
    // 这是关闭侧「该条来自子代理」的机械凭据——`session_id` 本身无法区分子代理与另一
    // 受管辖根会话，两者都是 host 来源的会话标识。
    const storedReviewerOrigin = isExistingEntry && typeof stored.reviewer_origin === "string"
      ? stored.reviewer_origin
      : null;
    const effectiveReviewerOrigin = isExistingEntry ? storedReviewerOrigin : reviewerOrigin;
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
      // 复核者是否为受管辖隔离子代理（04 §7.3 唯一承载形式）；非子代理或未知时不写出该键。
      ...(effectiveReviewerOrigin === null || effectiveReviewerOrigin === undefined ? {} : { reviewer_origin: effectiveReviewerOrigin }),
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
 * （02 §16），本函数只保证「谁记的、记了什么」不被他人改写。
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

  // -------------------------------------------------------------------------
  // Gate 1 前置·建前独立审核的两道机械门禁（21 §14 / §15.1，2026-10-16 建立）
  //
  // 规范背景：21 §14 要求 Gate 1 前必经一次建前独立审核。修订前该结论只是
  //   「提请要素」（gate1_request 第五要素），不落对象字段、不做指纹绑定 ——
  //   故「审没审」「审的是哪一版」都不可机械核验，一条审过又改的候选可直接进
  //   Gate 1（实测：workcase-c36b0208 的审核裁决为「建议修订，3 项必改」，
  //   而该候选随后仍以 draft 进 Gate 1 —— 因为判据只作用于提请那一刻）。
  //
  // 两道闸的**判据一概读 pre_reviews 字段**，不解析提请文本（21 §14 结论承载条
  //   定「以 pre_reviews 为唯一权威」）。二者与关闭侧 `result_proposal_required`
  //   （本文件 :3180 起，Human 裁定 2026-10-14）**同构**：那道闸证明「结果节不是
  //   与关闭同批写入」，这两道闸证明「审核印记不是与批准同批写入」「存在一条针对
  //   当前内容的通过结论」。
  //
  // ## 保证边界（不得作过度声明，21 §15.1/§16 已登记）
  //   本组只证明两个**形式事实**：
  //     ① 上一次落盘的 draft 已带 pre_reviews（⇒ 审核印记非与批准同批写入）；
  //     ② 存在一条其 candidate_fingerprint 等于当前 plan+scope 指纹且 verdict=pass
  //        的条目（⇒ 存在针对**当前**内容的通过结论，故「审完又改」不会沿用旧结论）。
  //   **不证明**审核实际执行过、视角实质独立、三维覆盖充分、结论正确或方案可行 ——
  //   那属 Human 批准时阅读把关（同关闭侧身份门禁的分工口径）。
  //   本闸的作用是让**流程不可被静默合并**，而非让「审核」不可伪造；后者需 Human
  //   侧凭证，进程内做不到（同 :3180 关闭闸的边界声明）。
  const priorPreReviews = Array.isArray(fm.pre_reviews) ? fm.pre_reviews : [];
  if (priorPreReviews.length === 0) {
    return failure(
      "workcase/pre_gate1_audit_proposal_required",
      "Gate 1 approval refused: 上一次落盘的 draft **尚无 `pre_reviews` 条目**——建前独立审核须先行落盘，"
      + "不得与批准同批写入（21 §14 Gate 1 前置·时序闸；同构于关闭侧「关闭提案须先行落盘」）。"
      + "正确次序：先派受管辖隔离子代理做建前独立审核，完成后经 action=record_audit 以 "
      + "`auditor_child_agent_id` 回传其结论（对象即在 Web 上呈现为「待建前审核」，`status` 保持 draft），"
      + "再 action=approve 提请 Human 批准。本次调用把两者合并，会使 Gate 1 的授权在没有独立审核落点的"
      + "情况下生效（21 §9.1：Gate 1 是 Human Gate，其前置把关须可回读）。",
    );
  }
  // 承载形式门禁（承独立复核 G1，2026-10-16）：与关闭侧的 `review_form_not_subagent`
  // **同规格对齐**。上面的指纹+verdict 判据只证明「有一条针对当前内容的通过结论」，
  // 但它**无法区分**该结论由受管辖隔离子代理产出、还是由实施者自己的 root 会话自记。
  //
  // 实测失效（独立复核复现，2026-10-16）：
  //   G1a 自审 audit(origin=null) 落盘  → ALLOWED
  //   G1c approve 放行                  → ALLOWED
  // 即实施者根本不派生审核体，用自己会话经 record_audit 记一条 pass 即可过闸。
  // 关闭侧早已为此另立一道 `reviewer_origin === "subagent"` 判据（见 :3611），
  // 审核侧此前**漏掉了对称的那一道**。
  //
  // 分档如实登记（同关闭侧口径）：本检查只对**带该键**的条目生效；会话身份、结论文本
  // 的不可自证性仍由 `record_audit` 的唯一回传通道（宿主子代理登记表 + 逐字子串）承担；
  // 越过受控工具面直调 writer 可伪造 `auditor_origin`——该层防护属 09 代码评审与 06
  // 受控提交（同 §14 既有声明）。
  // 覆盖闸（2026-10-27 改为**分区覆盖**）：当前候选的每个分区都须被某条合格
  // 条目覆盖——内容未变的分区可跨轮、跨修订沿用既有 `pass`（这正是「只审修改」
  // 的机械落点），而不是要求一条整体指纹 `pass` 把每一版内容都重审一遍。
  // 整体形态的存量条目仍认（其 `candidate_fingerprint` 等于当前整体指纹时覆盖
  // 全部分区），故改造不使已落盘的历史审核失效。
  const auditCoverage = auditCoverageFor(fm.plan, fm.scope, priorPreReviews);
  if (auditCoverage.uncovered.length > 0) {
    return failure(
      "workcase/pre_gate1_audit_not_covering_candidate",
      "Gate 1 approval refused: 当前候选仍有未被 `pass` 覆盖的审核分区——"
      + `未覆盖的 ${auditCoverage.uncovered.length} 个分区：${auditCoverage.uncovered.join(", ")}`
      + "（21 §14 Gate 1 前置·覆盖闸；2026-10-27 分区口径）。"
      + "该字段现有 " + String(priorPreReviews.length) + " 条，但未覆盖上述分区——"
      + "最可能的原因是这些分区在审核之后被改动（审完又改），或从未被审过。"
      + "正确处置：只对**未覆盖分区**做增量建前独立审核（可拆多片并行，各片经 action=record_audit "
      + "携带 `covered_partitions` 落盘），未变分区无须重审。"
      + "注意「同一次审核事项最多 3 次」按轮次计（`round_index`），不因修订重置（21 §9.2）。",
    );
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

  // 已进入「待批准关闭」期的工单，execute **不得再改正文**（21 §8，2026-10-19）。
  //
  // 这道闸补的是 `result_proposal_required` 的对称面。那道闸只保证「关闭提案先落盘
  // 过一次」，于是存在一条合法却使提案失真的路径：execute 写结果节 → close 被某项前置
  // 拒绝 → **AI 再 execute 一次改写结果节** → close 通过。此时 Human 从未决策，而被
  // 搁置待批的那份提案已经被换成另一份——「先提案、后关闭」在机械上成立，在语义上
  // 落空（判定权的载体被替换）。
  //
  // 判据**只认基线**：上一次落盘的正文已含「## 结果」节即视为已进入该期。故
  // ① 进入该期的那一次 execute（基线尚无结果节）照常放行；
  // ② 其余心跳、进度更新仍可经 `attempt_operation` 通道进行——本闸拦的是**正文改写**，
  //    不是「整单冻结」（复核、增量申请、决定、重批各有自己的窄通道）。
  // 结论必须改时，走 Human 决定的 `rebatch`（C2 局部重批），不是原地重写。
  if (bodyHasResultSection(current.value.body ?? "") && bodyHasResultSection(bodyMarkdownAfter)) {
    const priorSection = (sectionContent(current.value.body ?? "", BODY_H2_RESULT) ?? "").trim();
    const nextSection = (sectionContent(bodyMarkdownAfter, BODY_H2_RESULT) ?? "").trim();
    if (priorSection !== nextSection) {
      return failure(
        "workcase/result_proposal_frozen",
        "execute refused: 工单已处于「待批准关闭」期（上一次落盘的正文已含「## 结果」节），"
        + "该节的结论不得在等待 Human 判定期间被改写——否则被搁置待批的那份提案会被换成另一份，"
        + "「先提案、后关闭」在机械上成立而语义落空（21 §8）。"
        + "等待期内的合法动作：Human 作出判定后 action=close；或用 action=rebatch 走 C2 局部重批"
        + "（Human 决定，重走 Gate 1）。来源节逐字相同的正文更新（如执行流水的追加）不受本闸限制。",
      );
    }
  }

  // 审核轴写权限隔离（承独立复核 F1/F2）：pre_reviews 一律回落为落盘值，
  // 使 record_audit 成为该字段的唯一写路径。见 guardAuditField 的注释。
  const auditGuard = guardAuditField(frontmatterAfter, fm);
  const next = auditGuard.fields;
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
  appendChangeLog(next, sig, `${changeSummary} [${attemptNote}]${auditFieldGuardNote(auditGuard.attempted)}`);

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
  // 本次写入是否**首次**把「## 结果」节带进正文——即本次调用是否就是提交关闭提案
  // （21 §8「待批准关闭」期的进入动作）。判据与呈现层 `awaiting_gate2` 同源：
  // 写入侧同函数 `bodyHasResultSection`，基线是**上一次落盘**的正文（不是调用方 payload，
  // 故不可由调用方自证「上次已有」）。调用方据此决定宿主目标该武装（仍在推进）还是
  // 暂停（已交还 Human）——这是 `GOAL_WRITE_POINTS` 两点的唯一分歧点。
  return success({
    ...written.value,
    plan_step_reference: planStepReference(next.plan),
    result_proposal: {
      has_result_section: bodyHasResultSection(body),
      entered_awaiting_gate2: !bodyHasResultSection(current.value.body) && bodyHasResultSection(body),
    },
  });
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
 * 调用方只能提供 `summary`（复核结论概要，≤600 字符，含 02 §16 七要素）。`at`、
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
    return failure("invalid_request", "summary is required (the review conclusion, ≤600 chars, carrying the 02 §16 seven elements)");
  }
  if (summary.length > REVIEW_SUMMARY_MAX_CHARS) {
    return failure("invalid_request", `summary: ${summary.length} chars exceeds the ${REVIEW_SUMMARY_MAX_CHARS}-char cap (21 §8)`);
  }
  // 身份不可得即拒绝：本通道的**全部价值**在于「谁记的」由 Code 证明。若允许无身份
  // 写入，等于给出一个可被实施者冒用的通道，比没有通道更危险。
  const identity = hostSessionIdentity(sessionIdentity);
  if (identity !== null && identity.source === "shell") {
    // shell 来源身份取自环境变量 + 日志文件，而两者对调用者可设置 → 可伪造。
    // 接受它等于把门禁的判据交给被判方（独立审核实测：一行 DSH_SESSION_JSONL
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
// 建前审核记录 — 审核轴（21 §14「建前审核记录」，2026-10-16 建立）
// ---------------------------------------------------------------------------

/**
 * 审核轴的**唯一回传通道**：只追加一条 `pre_reviews` 条目，不授予任何其它写能力。
 *
 * 与 `recordWorkcaseReview`（复核轴）**形态同构、语义分立**：
 *   - 复核轴核对**已发生的工作与结果**（关闭端）；本轴对**尚未取得效力的候选**
 *     主动找错（Gate 1 前）。两轴对象、时点、主体皆不同，互不替代
 *     （01 §5 第 12 项）。
 *   - 身份与结论的**不可自证性**要求与复核轴完全相同：若本通道允许调用方自填
 *     身份或自由改写结论，则「AI 自写一段审核结论」即可满足 Gate 1 的覆盖闸，
 *     闸门形同虚设。故身份取自宿主子代理登记表（Code 亲观测），`summary` 须为
 *     子代理捕获结论的**逐字子串**（防父会话代述）。
 *
 * ## 与 `recordWorkcaseReview` 的唯一实质差异
 *   状态约束相反：本通道**只对 `status = draft` 开放**（审核轴的对象是尚未取得
 *   效力的候选）；复核轴只对 `open` 开放。`open` 期已获授权，其把关归复核轴。
 *
 * ## 上限门禁（21 §9.2「审核结论与主控判断不一致时的处置」）
 *   本事项（`candidate_fingerprint` 相同）条目数达 3 时**拒绝第 4 条**，转为提请
 *   Human 裁决，对象保持 `draft`。计数以 `candidate_fingerprint` 为界——指纹一变
 *   即为新事项，计数归零。这使 21 §14 末句此前无载体的再验纪律获得机械执行。
 */
export async function recordWorkcaseAudit(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint, summary, verdict,
    changeSummary = null, sessionSignature = null, sessionIdentity = null,
    auditorNote = null,
    coveredPartitionIds = null,
    roundIndex = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof summary !== "string" || summary.trim().length === 0) {
    return failure("invalid_request", "summary is required (the audit conclusion, ≤600 chars, carrying the three dimensions 对象恰当性／方案可行性／scope 清晰度, each with 符合/不符＋证据)");
  }
  if (summary.length > REVIEW_SUMMARY_MAX_CHARS) {
    return failure("invalid_request", `summary: ${summary.length} chars exceeds the ${REVIEW_SUMMARY_MAX_CHARS}-char cap (21 §8)`);
  }
  // verdict 是审核结论的机械落点（覆盖闸只认 pass）：闭集校验，未知值 fail closed。
  if (verdict !== "pass" && verdict !== "needs_revision") {
    return failure("invalid_request", `verdict must be "pass" or "needs_revision" (21 §8 pre_reviews.verdict 闭集), got ${JSON.stringify(verdict)}`);
  }
  // 身份不可得即拒绝 —— 与 recordWorkcaseReview 同一理由：本通道的价值全在
  // 「谁记的」由 Code 证明；允许无身份写入等于给出一条可被实施者冒用的通道。
  const identity = hostSessionIdentity(sessionIdentity);
  if (identity !== null && identity.source === "shell") {
    return failure(
      "workcase/audit_identity_untrusted",
      "refusing to record an audit with a shell-sourced session identity: that channel reads "
      + "DSH_SESSION_JSONL / DSH_HOME+DSH_SESSION_ID, and BOTH are settable by the caller (a single bash "
      + "invocation can mint any identity) — so it cannot evidence an independent audit "
      + "(同 record_review 的 workcase-2be11478 教训，21 §14). Record the audit through the governed tool "
      + "surface of a session whose identity comes from the host execution context "
      + "(ldvh_workcase_write action=record_audit), which stamps source=\"host\".",
    );
  }
  if (identity === null) {
    return failure(
      "workcase/audit_identity_unavailable",
      "refusing to record an audit without the caller's authoritative session identity: the identity must come "
      + "from the DSH session record via the branded carrier (21 §14). An unsigned-identity audit would be "
      + "indistinguishable from an audit the implementer wrote for itself — which is exactly what the coverage "
      + "gate is supposed to prevent.",
    );
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure(
      "workcase/transition_invalid",
      `audit recording requires status=draft, got ${JSON.stringify(fm.status)} (21 §9.2: 审核轴的对象是尚未取得效力的候选；`
      + "open 期已获授权，其把关归复核轴 record_review；closed 为终态)",
    );
  }

  // 候选指纹由 Code 计算（与 gate_1.authorization_fingerprint 同源函数）——
  // 调用方不可自填，否则「审的是哪一版」的判据交给被判方。
  const candidateFingerprint = computeAuthorizationFingerprint(fm.plan, fm.scope);
  const existing = Array.isArray(fm.pre_reviews) ? fm.pre_reviews : [];

  // ---- 分区覆盖（2026-10-27 增量审核）------------------------------------
  // 调用方声明本次审了哪些分区；省略即覆盖全部分区——缺省行为与改造前一致
  // （整份审），故旧调用不因新增能力而改变语义。分区指纹由 Code 按**当前**
  // 候选内容计算，调用方只给 id，不能自填指纹。
  const allPartitions = computeAuditPartitions(fm.plan, fm.scope);
  let coveredPartitions;
  if (Array.isArray(coveredPartitionIds) && coveredPartitionIds.length > 0) {
    const byId = new Map(allPartitions.map((part) => [part.id, part]));
    const unknown = coveredPartitionIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      return failure(
        "invalid_request",
        `covered_partitions: unknown partition id(s) ${unknown.map((id) => JSON.stringify(id)).join(", ")} — `
        + `当前候选的审核分区为 ${allPartitions.map((part) => part.id).join(", ") || "(none)"}`
        + "（21 §9.2 分区口径：`plan` 每步骤 + `scope` 每条目）。分区随内容变化；请按当前分区重取后再声明覆盖范围。",
      );
    }
    coveredPartitions = allPartitions
      .filter((part) => coveredPartitionIds.includes(part.id))
      .map((part) => ({ id: part.id, fingerprint: part.fingerprint }));
  } else if (Array.isArray(coveredPartitionIds)) {
    return failure(
      "invalid_request",
      "covered_partitions: when supplied it must be a non-empty array of partition ids "
      + "(omit the field to cover every current partition — the pre-2026-10-27 whole-candidate semantics)",
    );
  } else {
    coveredPartitions = allPartitions.map((part) => ({ id: part.id, fingerprint: part.fingerprint }));
  }

  // ---- 轮次分配与上限（21 §9.2，2026-10-27 口径）------------------------
  // 轮次数以 `round_index` 的**不同值**为准：修订换指纹不再重置计数，分片并行
  // 共享同一 `round_index` 故不占额外轮次。旧条目无该字段者按出现顺序各占一轮
  // （legacy 兼容——不使存量对象凭空获得额度，也不使它们被追溯拒绝）。
  const legacyCount = existing.filter((entry) => isPlainObject(entry) && !Number.isInteger(entry.round_index)).length;
  const seenRounds = existing
    .filter((entry) => isPlainObject(entry) && Number.isInteger(entry.round_index))
    .map((entry) => entry.round_index);
  const usedRounds = new Set([
    ...seenRounds,
    ...Array.from({ length: legacyCount }, (_, i) => i + 1),
  ]);
  const maxRound = usedRounds.size === 0 ? 0 : Math.max(...usedRounds);

  let assignedRound;
  if (roundIndex === null || roundIndex === undefined) {
    assignedRound = maxRound + 1;
  } else if (!Number.isInteger(roundIndex) || roundIndex < 1) {
    return failure("invalid_request", "round_index: when supplied must be a positive integer (1-based; 21 §9.2)");
  } else if (roundIndex > maxRound + 1) {
    return failure(
      "invalid_request",
      `round_index ${roundIndex} skips ahead of the next available round ${maxRound + 1} — rounds are allocated consecutively (21 §9.2)`,
    );
  } else {
    assignedRound = roundIndex;
  }
  const isNewRound = !usedRounds.has(assignedRound);
  const roundsAfter = isNewRound ? usedRounds.size + 1 : usedRounds.size;
  if (isNewRound && roundsAfter > PRE_AUDIT_ROUNDS_MAX) {
    return failure(
      "workcase/pre_gate1_audit_round_cap",
      `建前审核已就本审核事项用掉 ${usedRounds.size} 轮（上限 ${PRE_AUDIT_ROUNDS_MAX}），本次将开启第 ${assignedRound} 轮 —— `
      + "拒绝（21 §9.2「同一次审核事项最多 3 次」；2026-10-27 口径：按轮次计，不因修订或 rebatch 重置）。"
      + "分片并行不占额外轮次（同一轮共享 `round_index`）。对象保持 `draft`，"
      + "**停止自动循环并提请 Human 裁决**（改方案收敛、改对象承载或放弃建单）。",
    );
  }
  if (existing.length >= REVIEW_ENTRIES_MAX) {
    return failure(
      "workcase/pre_reviews_entries_exhausted",
      `pre_reviews already holds ${existing.length} entries (cap ${REVIEW_ENTRIES_MAX}, 21 §8): refuses to truncate or compress `
      + "existing entries. Report to Human — this object needs a decision, not a dropped history.",
    );
  }

  const next = structuredClone(fm);
  // 只追加，不触碰：plan/scope/gate_1/attempt/result/outcome 全部沿用落盘对象。
  const now = new Date().toISOString();
  next.pre_reviews = [...existing, {
    at: now,
    provider: sig.signature.provider ?? null,
    model: sig.signature.model ?? null,
    summary,
    session_id: identity.sessionId,
    session_source: identity.source,
    auditor_origin: identity.origin ?? null,
    candidate_fingerprint: candidateFingerprint,
    covered_partitions: coveredPartitions,
    round_index: assignedRound,
    verdict,
  }];
  appendChangeLog(
    next, sig,
    (typeof changeSummary === "string" && changeSummary.length > 0 ? changeSummary : "记录一条建前审核结论")
      + ` [pre-gate1 audit recorded by session ${identity.sessionId}; verdict: ${verdict}; `
      + `round: ${assignedRound}/${PRE_AUDIT_ROUNDS_MAX}; `
      + `covered: ${coveredPartitions.length}/${allPartitions.length} partition(s); `
      + `candidate_fingerprint: ${candidateFingerprint.slice(0, 12)}…; pre_reviews entries: ${existing.length + 1}`
      + `${typeof auditorNote === "string" && auditorNote.length > 0 ? `; ${auditorNote}` : ""}]`,
  );

  const body = assembleBody(next.title, current.value.body.replace(/^#\s+.*\n+/, ""));
  const written = await writeValidated(factSourceRoot, next, body, fm, current.value.body);
  if (!written.ok) return written;
  return success({
    ...written.value,
    audit_session_id: identity.sessionId,
    candidate_fingerprint: candidateFingerprint,
    covered_partitions: coveredPartitions,
    round_index: assignedRound,
    verdict,
  });
}

// ---------------------------------------------------------------------------
// 增量审批 — 执行期新增范围的受控通道（21 §14「增量审批」；乙档）
// ---------------------------------------------------------------------------

/**
 * 「增量审批」的**申请**通道：把一份拟追加的事项登记为 `gate_1.amendments` 的**待批**条目。
 *
 * 依据 21 §8 的「执行期新发现的四档处置」乙档与 §14「增量审批」：执行中发现
 * 「未碰禁区、不在「允许的顺带修缮」目录内、但不做它已批 `done_criteria` 就达不成」
 * 的事项时，AI 只能**申请**，不能自行扩权。
 *
 * **本函数只写申请，不产生任何可执行权限**：它不触碰 `plan`／`scope`，也不改
 * `authorization_fingerprint`。真正的门在 `decideWorkcaseAdjustment`（Human 决定）。
 * 这样"AI 滥发申请"的最坏后果只是多一条待办——而不是一次越权。
 *
 * 调用方只提供 `items`（拟追加的步骤与判据）与 `rationale`（为什么必需）。
 * `requested_at` 由 Code 盖戳（AI 不得自填），其余字段一律取自落盘对象。
 * **不提供范围改写**：`scope` 的任何改动都构成 §10.3 的失效事由、走 C2 局部重批
 * （2026-09-30 独立审核 F-2 后删除了 `scope_additions`）。
 */
export async function requestWorkcaseAdjustment(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, items, rationale, changeSummary = null, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (!Array.isArray(items) || items.length === 0) {
    return failure("invalid_request", "items is required: a non-empty array of {step, done_criteria} (21 §14 — 申请必须写明要追加什么)");
  }
  for (const [i, it] of items.entries()) {
    if (!isPlainObject(it) || typeof it.step !== "string" || it.step.trim().length === 0
      || typeof it.done_criteria !== "string" || it.done_criteria.trim().length === 0) {
      return failure("invalid_request", `items[${i}]: must be {step, done_criteria}, both non-empty (21 §8)`);
    }
  }
  if (typeof rationale !== "string" || rationale.trim().length === 0) {
    return failure("invalid_request", "rationale is required: 说明「不做它，已批的 done_criteria 就达不成」（21 §14 乙档的定义要件）");
  }
  // 申请项的**内容下限**（2026-09-30 独立审核 F-7）：此前只校验"非空字符串"，
  // 于是与已批步骤**逐字重复**的申请也能被批准、落盘出两条全同项（`criteria_checks`
  // 按索引对照的语义随之退化），且超长文本无上限。此处只设**可机械判定**的两条：
  // 长度上限、与既有 plan 步骤逐字重复即拒。至于"是否恰是所需"仍属 AI/Human 判断。
  for (const [i, it] of items.entries()) {
    if (it.step.length > ADJUSTMENT_ITEM_MAX_CHARS || it.done_criteria.length > ADJUSTMENT_ITEM_MAX_CHARS) {
      return failure(
        "invalid_request",
        `items[${i}]: step/done_criteria 超过 ${ADJUSTMENT_ITEM_MAX_CHARS} 字符——申请是"一条待批事项"，不是承载长文的字段（21 §14）`,
      );
    }
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `增量审批的申请要求 status=open（执行期通道），got ${JSON.stringify(fm.status)} (21 §14)`);
  }
  const gate1 = isPlainObject(fm.gate_1) ? fm.gate_1 : null;
  if (gate1 === null) {
    return failure("workcase/gate1_missing", "增量审批要求 gate_1 存在（它承载 amendments 流水），落盘对象无 gate_1 (21 §8)");
  }
  // 与**既有 plan 步骤**逐字重复的申请：批准只会落盘两条全同项，无增益（F-7）。
  const existingSteps = new Set((Array.isArray(fm.plan) ? fm.plan : []).map((p) => `${p.step}\u0000${p.done_criteria}`));
  for (const [i, it] of items.entries()) {
    if (existingSteps.has(`${it.step}\u0000${it.done_criteria}`)) {
      return failure(
        "invalid_request",
        "items[" + i + "]: 与既有 plan 步骤逐字重复——批准后会落盘两条全同项，criteria_checks 按索引对照的语义随之退化（21 §14）",
      );
    }
  }
  const existing = Array.isArray(gate1.amendments) ? gate1.amendments : [];
  if (existing.some((a) => isPlainObject(a) && a.decision === undefined)) {
    return failure(
      "workcase/adjustment_already_pending",
      "已存在一条**待批**的增量申请：同一时刻至多一条待批（否则 Human 面对的是一串互不知情的待办，"
      + "而「待批」这一判据也不再唯一）。先由 Human 对既有那条作出决定（21 §14）。",
    );
  }
  if (existing.length >= GATE1_AMENDMENTS_MAX) {
    return failure("workcase/adjustment_entries_exhausted", `gate_1.amendments 已达上限 ${GATE1_AMENDMENTS_MAX} 条（21 §8）：本对象需要一次决定（重批或关闭），而不是无限续申请`);
  }

  const next = structuredClone(fm);
  // 乙档**只追加 `plan`**：`scope` 的任何改写都构成 §10.3 的失效事由、走 C2 局部重批，
  // 不在这条通道里。2026-09-30 独立审核 F-2 后删除 `scope_additions`——它曾是纯文本追加，
  // 实测可把「明确不做什么」的禁令逐字追加成授权项，或再加一个「允许的顺带修缮：」标签改写目录。
  const entry = { requested_at: new Date().toISOString(), items, rationale };
  next.gate_1 = { ...gate1, amendments: [...existing, entry] };
  appendChangeLog(
    next, sig,
    (typeof changeSummary === "string" && changeSummary.length > 0 ? changeSummary : "登记一条增量审批申请（待批）")
      + ` [adjustment requested; amendments: ${existing.length + 1}; pending]`,
  );
  const body = assembleBody(next.title, current.value.body.replace(/^#\s+.*\n+/, ""));
  const written = await writeValidated(factSourceRoot, next, body, fm, current.value.body);
  if (!written.ok) return written;
  return success({ ...written.value, adjustment_pending: true });
}

/**
 * 「增量审批」的**决定**通道：Human 对待批申请作出批准或拒绝。
 *
 * **批准**的落盘效果（21 §14）：把申请项**追加进 `plan`**（调用方须同时给出
 * `bodyMarkdownAfter`——**不含 H1**，与 `execute`/`close` 等同形，使新步骤同步出现在
 * 正文「## 计划」节，以过载体内聚校验）、**`scope` 一概不动**、
 * **重算 `authorization_fingerprint`** 并写回 `gate_1`，同时在该 amendment 的 `decision`
 * 上留下决定与**新的指纹**。
 *
 * **不重置对象**：`attempt` 与 `reviews` 一概不动（这正是本通道与「局部重批」的根本差别）。
 * **拒绝**只落 `decision`，不动 `plan`／`scope`；该事项的归宿按 §8 丁档处理（关闭时落去向）。
 *
 * **`humanAuthorization` 必填**（与 `correct` 同规格）：本通道在执行期实时扩大授权，
 * 故须把 Human 的授权记录摆出来并写进 `change_log`。它**不证明** Human 真的批过——
 * 机械层能做的是"让没有转述的批准不可发生"，这一点已如实登记（21 §14）。
 *
 * `decision.at` 由 Code 盖戳；`by` 由调用方提供（**自报**，同 `gate_1.approver` 的形态）——
 * "谁批的"可核痕迹是 Code 从宿主上下文取得的 `decision.session_id`／`session_source`
 * （2026-09-30 独立审核 F-1：本通道作用于执行中的 open 对象并实时扩大授权，
 * 故必须留下可核身份；机械层不证明 `by` 为真，规范已如实声明该边界）。
 */
export async function decideWorkcaseAdjustment(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, decision, by, bodyMarkdownAfter = null, changeSummary = null, sessionSignature = null, sessionIdentity = null, humanAuthorization = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (decision !== "approved" && decision !== "rejected") {
    return failure("invalid_request", 'decision must be "approved" | "rejected" (21 §14)');
  }
  if (typeof by !== "string" || by.trim().length === 0) {
    return failure("invalid_request", "by is required: the deciding Human identity (同 gate_1.approver 的形态，21 §14)");
  }
  // **Human 授权记录必填**（与 `correctWorkcaseObject` 的 `humanAuthorization` 同规格，fail-closed）：
  // 本通道是**执行期实时扩大授权**，而 `by` 是自报字符串——故要求调用方把 Human 的授权
  // （谁／何时／覆盖什么）摆出来，并写进 `change_log`。它**不证明** Human 真的批过，
  // 但让「没有转述的批准」在机械上不可发生：AI 若要自批，就得**编造一段 Human 的话**，
  // 而那是可在会话记录里审计的（2026-09-30 Human 裁定，见 21 §14）。
  if (typeof humanAuthorization !== "string" || humanAuthorization.trim().length === 0) {
    return failure(
      "invalid_request",
      "humanAuthorization is required for 增量审批的决定 — 本通道在执行期实时扩大授权，故须给出 Human 的授权记录（谁／何时／覆盖什么），缺之 fail-closed（与 correct 同规格；21 §14）",
    );
  }
  // 决定者**会话身份**（Code 托管；与 `approve` 同形——不传不拒，但缺失即"谁批的"无可核）。
  // 2026-09-30 独立审核 F-1：`by` 是调用方字符串，属**自报**；本通道又直接作用于执行中的
  // `open` 对象并**实时扩大授权**，故必须给"谁批的"留下一个可核的身份痕迹，而不是只有自报姓名。
  const deciderIdentity = hostSessionIdentity(sessionIdentity);
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `增量审批的决定要求 status=open，got ${JSON.stringify(fm.status)} (21 §14)`);
  }
  const gate1 = isPlainObject(fm.gate_1) ? fm.gate_1 : null;
  const amendments = gate1 && Array.isArray(gate1.amendments) ? gate1.amendments : [];
  const pendingIndex = amendments.findIndex((a) => isPlainObject(a) && a.decision === undefined);
  if (gate1 === null || pendingIndex < 0) {
    return failure("workcase/no_pending_adjustment", "没有待批的增量申请可供决定（21 §14）");
  }
  // 前态与后态同口径（2026-09-30 独立审核 F-6）：「待批」的判据是**末项无 `decision`**（10 §5.5）。
  // 若待批条目不在末位（仅 out-of-band 可达），**不得**静默按"首个无 decision"处理——那会让
  // 机械层（末位）与决定路径（findIndex）对同一对象给出相反解释。一律拒绝并报告。
  if (pendingIndex !== amendments.length - 1) {
    return failure(
      "workcase/adjustment_not_last",
      `待批条目不在末位（索引 ${pendingIndex} / 共 ${amendments.length} 条）：本类型以「末项无 decision」为待批判据（10 §5.5），`
      + "非末位待批属形态异常，拒绝决定并报告——不得静默按「首个无 decision」处理。",
    );
  }
  const pending = amendments[pendingIndex];
  const now = new Date().toISOString();

  if (decision === "rejected") {
    const next = structuredClone(fm);
    const nextAmendments = structuredClone(amendments);
    nextAmendments[pendingIndex] = {
      ...nextAmendments[pendingIndex],
      decision: {
        kind: "rejected", by, at: now,
        ...(deciderIdentity === null ? {} : { session_id: deciderIdentity.sessionId, session_source: deciderIdentity.source }),
      },
    };
    next.gate_1 = { ...gate1, amendments: nextAmendments };
    appendChangeLog(
      next, sig,
      (typeof changeSummary === "string" && changeSummary.length > 0 ? changeSummary : "增量审批：Human 拒绝该申请")
        + `；经 Human 授权：${humanAuthorization.trim()}`
        + ` [adjustment rejected by ${by}; plan/scope unchanged]`,
    );
    const body = assembleBody(next.title, current.value.body.replace(/^#\s+.*\n+/, ""));
    const written = await writeValidated(factSourceRoot, next, body, fm, current.value.body);
    if (!written.ok) return written;
    return success({ ...written.value, adjustment_decision: "rejected", decider_identity: deciderIdentity === null ? "unavailable" : deciderIdentity.sessionId });
  }

  // ---- 批准 ----
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.trim().length === 0) {
    return failure(
      "invalid_request",
      "批准必须同时给出 bodyMarkdownAfter（**不含 H1**——本入口与 execute/close 等同形，正文由 assembleBody 补 H1）：新增的 plan 步骤须同步出现在正文「## 计划」节（载体内聚，21 §16）——只改字段会让字段与正文不一致，写入会被拒",
    );
  }
  const next = structuredClone(fm);
  next.plan = [...(Array.isArray(fm.plan) ? fm.plan : []), ...pending.items.map((it) => ({ step: it.step, done_criteria: it.done_criteria }))];
  // `scope` 一概不动：改范围只走 C2 局部重批（Human 重新批准边界）。
  const resultFingerprint = computeAuthorizationFingerprint(next.plan, next.scope);
  const nextAmendments = structuredClone(amendments);
  nextAmendments[pendingIndex] = {
    ...nextAmendments[pendingIndex],
    decision: {
      kind: "approved", by, at: now, resulting_fingerprint: resultFingerprint,
      ...(deciderIdentity === null ? {} : { session_id: deciderIdentity.sessionId, session_source: deciderIdentity.source }),
    },
  };
  next.gate_1 = { ...gate1, amendments: nextAmendments, authorization_fingerprint: resultFingerprint };
  appendChangeLog(
    next, sig,
    (typeof changeSummary === "string" && changeSummary.length > 0 ? changeSummary : "增量审批：Human 批准，追加计划步骤并重算授权指纹")
      + `；经 Human 授权：${humanAuthorization.trim()}`
      + ` [adjustment approved by ${by}; plan +${pending.items.length}; authorization_fingerprint recomputed; attempt/reviews preserved]`,
  );
  const body = assembleBody(next.title, bodyMarkdownAfter.replace(/^#\s+.*\n+/, ""));
  const written = await writeValidated(factSourceRoot, next, body, fm, current.value.body);
  if (!written.ok) return written;
  return success({
    ...written.value,
    adjustment_decision: "approved",
    authorization_fingerprint: resultFingerprint,
    // F-4：身份不可得时**显式**报出（而不是静默省略）——调用方与后续读者据此知道
    // "这一条决定没有可核的决定者会话痕迹"。
    decider_identity: deciderIdentity === null ? "unavailable" : deciderIdentity.sessionId,
  });
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

  // Gate 2 前置条件之三（21 §14 增量审批，Human 裁定 2026-09-30）：
  // **存在待批的增量申请时不得关闭**。
  //
  // 为什么要这道闸：丙档（阻断型）允许"先做、后追认"，其风险不在"先做"，而在
  // **"先做的那件事还没被追认，工单就关掉了"**——未获追认的工作会静默变成"已完成"。
  // 有了这道闸，增量处置**不可能绕过 Human 决定而离开对象**：要么追认，要么被拒后
  // 落去向（§8 丁档）。
  //
  // 判据与呈现层同源：`gate_1.amendments` 的**末项无 `decision`** 即待批（10 §5.5）。
  // 不得以正文自述或"口头已同意"替代。
  const closeGateAmendments = isPlainObject(fm.gate_1) && Array.isArray(fm.gate_1.amendments)
    ? fm.gate_1.amendments
    : [];
  const pendingAmendmentIndex = closeGateAmendments.findIndex((a) => isPlainObject(a) && a.decision === undefined);
  if (pendingAmendmentIndex >= 0) {
    const pending = closeGateAmendments[pendingAmendmentIndex];
    const itemCount = Array.isArray(pending.items) ? pending.items.length : 0;
    return failure(
      "workcase/adjustment_pending",
      `Gate 2 closure refused: 存在**待批**的增量申请（第 ${pendingAmendmentIndex + 1} 项，${itemCount} 条事项）——`
      + "不得带着未获决定的增量关闭（21 §14 增量审批，Human 裁定 2026-09-30）。"
      + "先由 Human 对该申请作出决定（ldvh_workcase_write action=decide_adjustment，须给 human_authorization），"
      + "或将其事项按 §8 丁档落成残留去向；不得以正文自述替代。",
    );
  }

  // Gate 2 前置条件之四（21 §8「待批准关闭」期，Human 裁定 2026-10-14）：
  // **关闭提案须已先行落盘**——不得把「写结果节」与「关闭」压进同一次调用。
  //
  // ## 为什么需要这道闸（实测教训）
  //
  // 21 §9.1 明写 Gate 2 是 **Human Gate**；§8 又定义了「待批准关闭」期，其判据是
  // **`status = open` ∧ 正文含「## 结果」节**（与 10 §5 的 `awaiting_gate2` 派生
  // 分组同源，机械可判）。两段合读，关闭的正确形态是**两步**：
  //   ① AI 把逐条判据核对 + 残留 + 去向写进正文（经 `execute`，status 保持 `open`）
  //      → 工单进入「待批准关闭」期，**交还 Human**；
  //   ② Human 判定后，才由 Human 侧发起的 `close` 翻转终态。
  //
  // **闸前的实际失效**：本闸存在之前，`close` 接受「结果节首次出现」与「状态翻转」
  // 在同一次调用里完成——AI 只需一次工具调用即可把对象从 `open` 直接推到 `closed`，
  // 其间**没有任何 Human 决定的落点**。实测发生（workcase-88f3e568）：AI 记录独立
  // 复核后 3 分 42 秒即自行关闭，`outcome=completed` 被当成既成事实——**判定权被
  // 执行者自行行使**（00 §4 Human 决定权）。机械层当时未拦，因为既有的三条前置
  // 条件（reviews 非空／复核独立／无待批增量）**都只校验内容是否齐备，不校验
  // 「谁在何时发起关闭」**——而"须经 Human 批准"是语义要求，需要一个机械落点。
  //
  // ## 判据为什么是「上一步的正文」
  //
  // 「Human 是否真的批准过」在进程内**不可机械判定**（工具面无法证明调用者是 Human；
  // 同 §9.2 对身份来源可信边界的声明）。故本闸不经由"批准凭证"做事后判定，而是
  // **强制走完两步**：要求**上一次落盘的 `open` 对象**已携带同一个结果节。这使
  // 「先提案、后关闭」在机械上不可跳过——执行者至少须先落一次**可见的**关闭提案，
  // 该提案在 Web 上呈现为 `awaiting_gate2`、呈现在卡面与收件箱里供 Human 分诊。
  //
  // **本闸的保证边界（不得作过度声明）**：它证明「结果节不是与关闭同批写入的」，
  // **不证明** Human 看过、批准过或介入过。两次调用之间无最小间隔、无 Human 签名，
  // 故一个决定无视流程的调用者仍可连调两次 `execute`+`close`。本闸的作用是让
  // **流程不可被静默合并**（提案必须落盘一次、在 Human 可及的界面上出现过），
  // 而不是让批准不可伪造——后者需 Human 侧凭证，进程内做不到。
  const priorBody = current.value.body ?? "";
  if (!bodyHasResultSection(priorBody)) {
    return failure(
      "workcase/result_proposal_required",
      "Gate 2 closure refused: 上一次落盘的正文**尚无「## 结果」节**——关闭提案须先行落盘，"
      + "不得与关闭同批写入（21 §8「待批准关闭」期：status=open ∧ 正文含结果节）。"
      + "正确次序：先用 action=execute 把「## 结果」节（逐条判据核对 + 残留段与去向子项）写入正文"
      + "（status 保持 open，工单随之为「待批准关闭」），交还 Human 判定；"
      + "经 Human 批准后才 action=close 翻转终态。"
      + "本次调用把两者合并，会使 outcome 判定在无 Human 决定落点的情况下生效（21 §9.1 Gate 2 是 Human Gate）。",
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
  // 视角实质独立、内容正确或结论成立（02 §16 语义判断仍归 AI/Human）；同一主控
  // 编排出的隔离子会话在机械上满足本判据，这不是缺陷而是本判据被明确声明的范围。
  // 判据（独立复核发现后收紧，2026-09-19）：每一条 reviews 都要与**它自己写入时的**
  // 实施者身份比对，而不是与「当前」attempt 比对。
  //
  // 为什么必须按条目判：门禁原先只比对当前 attempt，而 reviews 跨 attempt 保留
  // （身份按索引继承，见 stampReviewEntries）。于是「实施者写一条自查 → takeover 把
  // attempt 换成另一会话 → 关闭」就能让自查被当成独立证据——独立审核实测复现
  // （`probe-attempt-rot`：close ok=true）。故每条记录在写入时被盖上一个
  // `implementer_session_id`（当时的实施者，Code 托管），关闭时逐条比对两者是否不同。
  //
  // 三条 fail-closed 路径（不静默放行、不猜）：
  //   (a) 无任何条目携带可比对的双方身份 → 无从建立独立性；
  //   (b) 所有可比对条目都是「记录者 == 当时的实施者」→ 全部是同会话自评；
  //   (c) 身份不可读（attempt 或条目缺身份）不视为独立。
  // 只有两端身份**都来自宿主执行上下文**（source === "host"）才构成判据：
  // shell 来源可被一行环境变量伪造（独立审核实测），故不计入。
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
      + `主控自查 but it is NOT an independent review and must not be recorded as one (02 §16: the three `
      + `review forms are not interchangeable). Note that rotating the attempt (takeover/reallocate) does `
      + `NOT turn an earlier self-check into an independent review — each entry is judged against the `
      + `implementer in force when it was written. Have an ISOLATED SUBAGENT session record the review and relay it `
      + `back with reviewer_child_agent_id — that is now the ONLY accepted carrying form (04 §7.3, Human 决定 `
      + `2026-10-09); recording your own session's review is 主控自查, not 独立复核. The subagent must be spawned `
      + `asynchronously so its agent_id can be relayed. Then close. If no such subagent can be spawned, do NOT close `
      + `— hold open and hand back to Human (00 §5.7, 21 §18).`,
    );
  }

  // Gate 2 承载形式前置（Human 决定 2026-10-09；04 §7.3 独立复核唯一形式）：
  // 上面的身份判据只证明「记录该复核的会话 ≠ 实施会话」，**无法**区分受管辖隔离子代理
  // 与另一受管辖根会话——两者都是 host 来源的会话标识。故另立一道判据：计入独立性
  // 判据的条目还须带 `reviewer_origin === "subagent"`（Code 依会话记录托管）。
  //
  // 分档如实登记（勿读作全量强制）：
  //   · 本检查只对**带该键**的条目生效；存量 closed 对象无此键、不再重开，不受影响。
  //   · 带 `reviewer_origin` 但值非 subagent 的条目不计入独立判据（形如 root-session）。
  //   · 经 shell 直调 writer 写入的条目可能不带该键——该层防护属 09 质量链的代码评审
  //     与受控提交（篡改实现需在 diff 中可见），同 §8 身份边界的既有声明。
  const subagentEntries = (fm.reviews ?? []).filter((entry) => (
    isPlainObject(entry) && entry.reviewer_origin === "subagent"
  ));
  if (subagentEntries.length === 0) {
    return failure(
      "workcase/review_form_not_subagent",
      "Gate 2 closure requires the independent review to be carried by an ISOLATED SUBAGENT (04 §7.3, Human 决定 "
      + "2026-10-09): no reviews entry carries `reviewer_origin: subagent`. Entries recorded by another governed "
      + "root session share the same `session_id !== implementer_session_id` shape but do NOT satisfy the context-"
      + "isolation requirement, so they are not independent review. Spawn an isolated subagent asynchronously (so its "
      + "agent_id is retained), then record it via `record_review` with `reviewer_child_agent_id`. If no subagent "
      + "can be spawned, or its agent_id cannot be relayed, do NOT close — hold open and hand back to Human "
      + "(00 §5.7, 21 §18).",
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
  const closed = await writeValidated(factSourceRoot, next, body, fm, current.value.body);
  if (!closed.ok) return closed;
  // 关闭意味着「待批准关闭」期结束（21 §8）：目标侧据此把暂停解除并收口。
  // 只回传**状态事实**，不改目标——目标同步是调用方（受控工具面）的机械副作用，
  // 分层与本文件其余部分一致（writer 不认识宿主目标）。
  return success({ ...closed.value, gate_2: { awaiting_gate2_closed: bodyHasResultSection(current.value.body ?? "") } });
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

  // 审核轴写权限隔离（承独立复核 F1/F2）：pre_reviews 一律回落为落盘值，
  // 使 record_audit 成为该字段的唯一写路径。见 guardAuditField 的注释。
  const auditGuard = guardAuditField(frontmatterAfter, fm);
  const next = auditGuard.fields;
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
  // `pre_reviews` 处置（2026-10-27 改口径；原为「随重批清零」）：
  //
  // 重批后**保留**审核流水，理由有三：
  //   ① 分区覆盖的判定是按**内容指纹**匹配的（`auditCoverageFor`），旧条目
  //      覆盖的旧分区指纹与当前候选天然失配——旧审核不会被误用为「当前内容
  //      已审」，清不清零不影响覆盖闸的正确性；
  //   ② 轮次上限按 `round_index` 跨重批累计（21 §9.2，2026-10-27）——清零会
  //      把计数一起丢掉，使「rebatch 后再审 3 轮」成为绕过上限的新路径；
  //   ③ 「该次审核确实发生过」是历史事实，保留流水比压缩成一句摘要更可回读。
  //
  // 未变分区因此可沿用重批前的 `pass`——这正是增量审核的语义：重批只作废
  // **受影响范围**的授权与覆盖，不要求把未改动部分重审一遍。
  const retainedPreReviews = Array.isArray(fm.pre_reviews) ? fm.pre_reviews.length : 0;
  appendChangeLog(
    next,
    sig,
    `${changeSummary} [C2 局部重批 open→draft; attempt ${voidedAttempt ?? "none"} voided, gate_1 dropped`
    + `${voidedReviews > 0 ? `, ${voidedReviews} 条 reviews 随授权失效作废（旧复核针对旧 plan/scope；概要要点见本条语义摘要）` : ""}`
    + `${retainedPreReviews > 0 ? `, ${retainedPreReviews} 条 pre_reviews 保留为历史（分区指纹按内容匹配，未变分区沿用既有 pass；轮次跨重批累计，21 §9.2 2026-10-27）` : ""}`
    + ` — 重新组织后重走 Gate 1]`
    + auditFieldGuardNote(auditGuard.attempted),
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
  const priorApproval = gate1ApprovalEvidence(fm);
  if (priorApproval !== null) {
    return failure(
      "workcase/transition_invalid",
      `cancel (draft→closed) is refused: this object holds evidence of a prior Gate 1 approval (${priorApproval}), so closing it through the cancel path would bypass Gate 2 (21 §9.2/§10). Close it through Gate 2 (close) instead`,
    );
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

  // 审核轴写权限隔离（承独立复核 F1/F2）：pre_reviews 一律回落为落盘值，
  // 使 record_audit 成为该字段的唯一写路径。见 guardAuditField 的注释。
  const auditGuard = guardAuditField(frontmatterAfter, fm);
  const next = auditGuard.fields;
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "draft";
  next.change_log = fm.change_log;
  appendChangeLog(next, sig, changeSummary + auditFieldGuardNote(auditGuard.attempted));

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
      // 02 §8 / §9 F1：F1 卡片须自证类型（同 spark 列表，此前三处一并漏掉）。
      fact_type_key: typeof frontmatter.fact_type_key === "string" ? frontmatter.fact_type_key : WORKCASE_TYPE_KEY,
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
