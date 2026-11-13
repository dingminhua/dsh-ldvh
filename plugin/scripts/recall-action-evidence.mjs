// 召回「行动落实」取证（2026-11-11，goal-a8048268 第 ② 项）
//
// ── 要回答什么 ─────────────────────────────────────────────────────────
//
// 00 §2.6 把双源召回的职责终点写成「**并把识别结果落实为实际改变的行动**」；
// 34 §8.1 第 4 项进一步定死：「识别结果**不改变任何行动要素者，不构成落实**」，
// 并列举了五类可观察形态——改变行动范围、改变执行路径、增加前置条件、停止行动、
// 或把决定提请 Human。
//
// 本脚本从**真实会话日志**里取证：每回合注入的召回块，其后的 AI 行动是否出现
// 上述五类形态之一，且该形态能否**回指到被注入的候选**（34 §8.3 第 3 项
// 「有可回指依据」）。
//
// ── 为什么取证形态而非「判定是否落实」 ─────────────────────────────────
//
// 「这次召回有没有真的改变行动」是**语义判断**，不是机械可判定的：同一句
// 「改用方案 B」既可能是被注入的 ADR 改变的结果，也可能是模型自己想到的。
// 因此本脚本只产出**结构性证据**：
//   · 注入后是否出现工具调用（形态：行动发生）
//   · 工具调用的参数里是否出现被注入候选的**标题词/路径/object_uid**
//     （形态：可回指）
//   · 是否为 Human Gate 类调用（形态：把决定提请 Human）
//
// **命中不等于因果**——参数里出现路径可能只是读了那个文件，不代表该候选改变了
// 决策。结论必须由 AI/Human 语义判读，脚本不越界（34 §14「不证明」列同口径）。
//
// 用法：
//   node plugin/scripts/recall-action-evidence.mjs --limit-sessions 20
//   node plugin/scripts/recall-action-evidence.mjs --json

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { decompressZstdStream } from "../lib/zstd-compat.js";

const SESSIONS_ROOT = join(homedir(), ".dsh", "sessions", "--Users-dmh2002-DshProject-dsh-ldvh--");
const AS_JSON = process.argv.includes("--json");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};
const MAX_SESSIONS = argOf("--limit-sessions", 40);

const INJECTION_MARK = "【双源召回 · 行动前候选】";

/** 从事件取文本正文。 */
function textOf(event) {
  const content = event?.data?.content ?? event?.data?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("");
}

/** 从召回块里抽出被注入的候选标识（标题 + 路径 + object_uid）。 */
function candidatesOf(injectionText) {
  const out = [];
  // 候选行形如：`- [type/status] 标题 — 命中理由（path）`
  for (const line of injectionText.split("\n")) {
    if (!line.startsWith("- [")) continue;
    const m = /^- \[[^\]]+\] (.+?)(?: · |\s—\s)(.*)$/.exec(line);
    const title = (m?.[1] ?? "").trim();
    const pathMatch = /\((ldvh-base\/[^)]+\.md)\)/.exec(line);
    const uidMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(line);
    if (title === "" && pathMatch === null) continue;
    out.push({ title, path: pathMatch?.[1] ?? null, uid: uidMatch?.[1] ?? null });
  }
  // L0 索引段（`· 标题`）——它们是索引不是候选，单列，避免混进候选计数。
  const l0 = [];
  let inL0 = false;
  for (const line of injectionText.split("\n")) {
    if (/^【(决策基线|事实规范|经验)/.test(line)) { inL0 = true; continue; }
    if (line.startsWith("（") || line.startsWith("【")) { inL0 = false; continue; }
    if (inL0 && line.startsWith("· ")) l0.push(line.slice(2));
  }
  return { candidates: out, l0 };
}

/** 提取一个回合内的「行动要素」：工具调用名与参数、是否有 Gate 类动作。 */
function actionsOf(events) {
  const calls = [];
  for (const e of events) {
    if (e.type !== "tool/call") continue;
    const name = e?.data?.name ?? "";
    const args = String(e?.data?.arguments ?? "");
    calls.push({ name, args });
  }
  return calls;
}

/**
 * 判断一次工具调用是否回指到某个候选。
 *
 * **标题比对的误判边界（2026-11-11 实测后收紧）**：初版按前 6 字子串比对，
 * 与评测集同口径。实测 252 次回指里 **116 次**落在 `dsh-ui`、`Spark `、
 * `Human `、`只推 dev`、`插件 lib`、`Git Ga` 这类**通用前缀**上——它们是标题的
 * 开头，却不是该标题的识别特征：`Spark ` 开头的对象有十几个，命中它几乎不
 * 携带信息。若不收紧，「回指率」会被这些弱匹配抬虚。
 *
 * 收紧规则：标题匹配仅在**前 6 字里非通用字符 ≥ 4** 时成立；通用前缀与单字
 * 命中一律不算。uid 与路径是精确标识，不受此限。
 */
const WEAK_TITLE_PREFIXES = [
  "dsh-ui", "Spark ", "Human ", "只推 dev", "插件 lib", "Git Ga", "retire",
  "ADR/Fr", "事实对象正", "本地开发工", "调研系统的",
];
const isWeakTitlePrefix = (prefix) =>
  WEAK_TITLE_PREFIXES.some((w) => prefix.startsWith(w.slice(0, prefix.length)));

function references(call, candidate) {
  const hay = call.args;
  const hits = [];
  if (candidate.path && hay.includes(candidate.path)) hits.push("路径");
  if (candidate.uid && hay.includes(candidate.uid)) hits.push("uid");
  if (candidate.title && candidate.title.length >= 6) {
    const prefix = candidate.title.slice(0, 6);
    if (!isWeakTitlePrefix(prefix) && hay.includes(prefix)) hits.push("标题");
  }
  return hits;
}

const GATE_TOOLS = new Set([
  "ask_user_question", "update_goal", "create_goal",
  "ldvh_pending_queue_resolve",
]);

/**
 * **回指的证据强度分档**（2026-11-11 补，据实声明）。
 *
 * 实测回指按工具分布：bash 87、structured_output 22、
 * ldvh_spark_write 21、subagent 15…若一律记作「落实」，会把「读了一下那个文件」
 * 与「据此改写了对象」混为一谈——前者只证明该候选进入了视野，后者才接近
 * 34 §8.3 的「有改变」。
 *
 * 三档：
 *   · `write`  —— 受控写入/审批类：参数里带候选标识，说明该候选参与了要落盘的
 *                 内容或要提请的决定。最接近「改变行动要素」，但仍不证明因果关系。
 *   · `read`   —— 读取/检索类：只证明按该标识取过材料（F3 精读），是落实的
 *                 **前置**而非落实本身。
 *   · `relay`  —— 转述类（subagent/structured_output/compress）：把候选写进派发
 *                 上下文，只证明它被传下去，不证明被采纳。
 */
const REF_KIND_BY_TOOL = new Map([
  ["ldvh_spark_write", "write"],
  ["ldvh_adr_write", "write"], ["ldvh_pitfall_write", "write"],
  ["ldvh_friction_write", "write"], ["ldvh_norm_write", "write"],
  ["ldvh_devlog_write", "write"],
  ["ldvh_pending_queue_resolve", "write"], ["edit", "write"],
  ["ask_user_question", "write"], ["update_goal", "write"],
  ["read", "read"], ["bash", "read"], ["grep", "read"],
  ["ldvh_norm_read", "read"],
  ["ldvh_spark_read", "read"], ["ldvh_adr_read", "read"],
  ["subagent", "relay"], ["structured_output", "relay"], ["compress", "relay"],
]);
const kindOf = (tool) => REF_KIND_BY_TOOL.get(tool) ?? "relay";

// **不按字母序截断**（2026-11-11 修）：初版 `.slice(0, MAX_SESSIONS)` 取字母序
// 前 N 个目录，实测 628 个目录里含注入的有 192 个分散全表，截断后只剩 9 个——
// 样本被目录命名顺序决定，而不是被「有没有注入」决定。现改为先筛后截。
const allDirs = await readdir(SESSIONS_ROOT);
const turns = [];
let scannedSessions = 0;

// **失败不得静默折算（pitfall「测量脚本把失败静默折算成零命中」）**。
// 初版在解压失败与单行 JSON 解析失败处都 `continue`，后果有三：
//   ① 读不到的会话不进分母 → 「读失败」被算成「没有注入」，回车率虚高；
//   ② 单行解析失败被丢弃 → 该行若正是注入事件，这个回合凭空消失，
//      分母少一个而分子不变，**读数偏向「没有落实」**；
//   ③ 全程零告警 → 调用者无从知道测量不完整。
// 现改为逐项计数并在输出里如实披露；不改变计算口径，只让缺口可见。
let unreadableSessions = 0;
let unparsableLines = 0;
// **两类「读不到」必须分开**（2026-11-11 复核）：
//   · `ENOENT`——该目录根本没有会话日志文件（子代理目录、空目录）。这不是失败，
//     是目录清单里混入了非会话条目；把它报成「不可读」会让读者误以为数据损坏。
//   · 其余（解压/编码错误）——**真失败**，它的静默丢弃才是 pitfall 所指的缺陷。
let absentSessions = 0;

for (const dir of allDirs) {
  if (scannedSessions >= MAX_SESSIONS) break;
  let text;
  try {
    text = (await decompressZstdStream(await readFile(join(SESSIONS_ROOT, dir, "session.v4.jsonl.zstd")))).toString("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") absentSessions += 1;
    else unreadableSessions += 1;
    continue;
  }
  if (!text.includes(INJECTION_MARK)) continue;
  scannedSessions += 1;
  const rawLines = text.split("\n").filter(Boolean);
  const events = [];
  for (const l of rawLines) {
    try {
      events.push(JSON.parse(l));
    } catch {
      unparsableLines += 1;
    }
  }

  // **分组口径（2026-11-11 修）**：召回块是**单独一条 `user/message` 事件**，
  // 不拼在用户提问里。初版按「含注入的 user/message 起一个新回合」分组，结果
  // 注入事件自己成为回合、紧随其后的 AI 行动全落到下一个回合被丢弃——实测
  // 7 个回合 0 次工具调用，纯属口径错误，不是「没有行动」的证据。
  //
  // 正确口径：注入事件之后的**所有事件**都属于本回合，直到出现下一条
  // **不含注入的** user/message（那才是下一个真实提问）。
  // 更精确的口径（2026-11-11 第二次修）：两次注入之间还夹着 `Time sampled…`、
  // 后台通知等**系统注入的 user/message**——它们不是「下一个真实提问」，按初版
  // 口径会把回合提前切断（实测单会话 90 次注入只切出 1 个回合）。
  //
  // 现在的边界只有一个：**下一次注入**，或**真正的用户文本**（排除已知系统块）。
  // 两者任一出现即结束当前回合。宁可把回合切长，也不要把 AI 的后续行动丢掉。
  const SYSTEM_INJECTION = /^(Time sampled|Current runtime context|<system-reminder>|【双源召回|【LDVH 管辖判定】|background job |Agent [0-9a-f]|Background subagent |\[model changed|\[dsh-|The working directory)/;
  let current = null;
  for (const e of events) {
    if (e.type === "user/message") {
      const t = textOf(e);
      if (t.includes(INJECTION_MARK)) {
        if (current !== null) turns.push(current);
        current = { session: dir, injection: t, events: [] };
        continue;
      }
      // 真正的用户提问才结束回合；系统注入块继续留在本回合内。
      if (current !== null && !SYSTEM_INJECTION.test(t)) {
        turns.push(current);
        current = null;
      }
      continue;
    }
    if (current !== null) current.events.push(e);
  }
  if (current !== null) turns.push(current);
}

// ── 逐回合计算 ────────────────────────────────────────────────────────
const rows = [];
for (const turn of turns) {
  const { candidates, l0 } = candidatesOf(turn.injection);
  const calls = actionsOf(turn.events);
  const refs = [];
  for (const c of candidates) {
    for (const call of calls) {
      const hit = references(call, c);
      if (hit.length > 0) refs.push({ title: c.title, tool: call.name, fields: hit });
    }
  }
  const gateCalls = calls.filter((c) => GATE_TOOLS.has(c.name));
  const lastAssistant = [...turn.events].reverse()
    .find((e) => e.type === "assistant/message");
  rows.push({
    session: turn.session,
    candidates: candidates.length,
    l0: l0.length,
    toolCalls: calls.length,
    referenced: refs.length,
    refs,
    gateCalls: gateCalls.map((c) => c.name),
    replyChars: textOf(lastAssistant).length,
  });
}

const judged = [];
for (const turn of turns) {
  const { candidates } = candidatesOf(turn.injection);
  const reasoning = reasoningOf(turn.events);
  const mentioned = [];
  for (const c of candidates) {
    if (c.uid && reasoning.includes(c.uid)) { mentioned.push({ title: c.title, how: "uid" }); continue; }
    if (c.title && c.title.length >= 6) {
      const prefix = c.title.slice(0, 6);
      if (!isWeakTitlePrefix(prefix) && reasoning.includes(prefix)) mentioned.push({ title: c.title, how: "标题" });
    }
  }
  judged.push({
    session: turn.session,
    candidates: candidates.length,
    reasoningChars: reasoning.length,
    mentioned: mentioned.length,
    mentions: mentioned,
    // 「判断发生但没提候选」——这是最值得看的一档：AI 动了手，却没引用材料
    actedWithoutMention: turn.events.some((e) => e.type === "tool/call") && mentioned.length === 0,
  });
}

const turnsWithReasoning = judged.filter((r) => r.reasoningChars > 0).length;
const turnsMentioned = judged.filter((r) => r.mentioned > 0).length;
const actedNoMention = judged.filter((r) => r.actedWithoutMention).length;
// ── 汇总 ──────────────────────────────────────────────────────────────
const withInjection = rows.length;
const withAction = rows.filter((r) => r.toolCalls > 0).length;
const withRef = rows.filter((r) => r.referenced > 0).length;
const withGate = rows.filter((r) => r.gateCalls.length > 0).length;
const totalCandidates = rows.reduce((a, r) => a + r.candidates, 0);
const totalRefs = rows.reduce((a, r) => a + r.referenced, 0);
// **按证据强度分档**：write 档才是接近「改变行动要素」的那一档。
const refsByKind = { write: 0, read: 0, relay: 0 };
const turnsByStrongestKind = { write: 0, read: 0, relay: 0, none: 0 };
for (const r of rows) {
  const kinds = new Set(r.refs.map((ref) => kindOf(ref.tool)));
  for (const ref of r.refs) refsByKind[kindOf(ref.tool)] += 1;
  if (kinds.has("write")) turnsByStrongestKind.write += 1;
  else if (kinds.has("read")) turnsByStrongestKind.read += 1;
  else if (kinds.has("relay")) turnsByStrongestKind.relay += 1;
  else turnsByStrongestKind.none += 1;
}
const summary = {
  sessionsWithInjection: scannedSessions,
  // **完整性缺口**（pitfall「测量脚本把失败静默折算成零命中」）：
  // 这两项非零即说明本次读数不完整，须在引用读数时一并声明。
  unreadableSessions,
  unparsableLines,
  absentSessions,
  turnsWithInjection: withInjection,
  turnsWithAction: withAction,
  turnsWithReferencedCandidate: withRef,
  turnsWithGateCall: withGate,
  candidatesInjected: totalCandidates,
  candidateReferences: totalRefs,
  refsByKind,
  turnsByStrongestKind,
  // ③ 材料进入判断的位置
  turnsWithReasoning,
  turnsMentionedCandidate: turnsMentioned,
  turnsActedWithoutMention: actedNoMention,
};

if (AS_JSON) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  const pct = (a, b) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`);
  console.log("召回「行动落实」取证（真实会话日志）");
  console.log(`扫描 ${scannedSessions} 个含注入的会话，共 ${withInjection} 个注入回合`);
  console.log(`目录清单：${absentSessions} 个目录无会话日志（子代理/空目录，非失败）`);
  if (unreadableSessions > 0 || unparsableLines > 0) {
    console.log(`⚠ 真实测量缺口：${unreadableSessions} 个会话读失败、${unparsableLines} 行不可解析`);
    console.log("  这些会话未计入分母——「读不到」不等于「没有注入」，引用读数须一并声明。");
  } else {
    console.log("测量完整性：无非 ENOENT 读取失败、无不可解析行。");
  }
  console.log("");
  console.log(`  注入后发生工具调用：${withAction}/${withInjection}（${pct(withAction, withInjection)}）`);
  console.log(`  调用参数回指到候选：${withRef}/${withInjection}（${pct(withRef, withInjection)}）  ${totalRefs} 次回指 / ${totalCandidates} 条候选`);
  console.log(`  出现 Gate 类动作：  ${withGate}/${withInjection}（${pct(withGate, withInjection)}）`);
  console.log("");
  console.log("  回指的证据强度（按最强行分类，不是按次数）：");
  console.log(`    write 档（受控写入/审批承载了该候选）：${turnsByStrongestKind.write} 回合`);
  console.log(`    read  档（按该标识精读了材料）：      ${turnsByStrongestKind.read} 回合`);
  console.log(`    relay 档（把候选转述进派发上下文）：  ${turnsByStrongestKind.relay} 回合`);
  console.log(`    无回指：                            ${turnsByStrongestKind.none} 回合`);
  console.log("");
  console.log("");
  console.log("③ 材料进入判断的位置（候选是否出现在 AI 的 reasoning 中）：");
  console.log(`  有 reasoning 的回合：${turnsWithReasoning}/${withInjection}`);
  console.log(`  reasoning 提及候选： ${turnsMentioned}/${withInjection}（${pct(turnsMentioned, withInjection)}）`);
  console.log(`  动手但未提及候选：  ${actedNoMention}/${withInjection}（${pct(actedNoMention, withInjection)}）`);
  console.log("  后一档是「行动发生了、材料没进判断」——34 §8.3「有指向」在这一档不成立。");
  console.log("");
  console.log("**边界**：回指只证明「该候选的标识出现在行动参数里」，不证明它改变了决策——");
  console.log("同一份路径可能只是被读取，而非被采纳。因果判断属 AI/Human 语义核对，本脚本不越界。");
  console.log("");
  const sample = rows.filter((r) => r.refs.length > 0).slice(0, 8);
  if (sample.length > 0) {
    console.log("回指样本（前 8 条）：");
    for (const r of sample) {
      console.log(`  ${r.session.slice(0, 16)}  候选 ${r.candidates}  调用 ${r.toolCalls}  回指 ${r.referenced}`);
      for (const ref of r.refs.slice(0, 2)) {
        console.log(`    ← 「${ref.title.slice(0, 30)}」经 ${ref.tool}（${ref.fields.join("/")}）`);
      }
    }
  }
}

// ── ③ 材料进入判断的位置（2026-11-11 补）──────────────────────────────
//
// 34 §8.1 的三段顺序是「识别先于判断，判断先于动作」。本项要回答的是：
// 被注入的候选，有没有真的进入 AI 的**判断过程**（reasoning／工具选择理由），
// 还是只出现在上下文里、AI 根本没提它。
//
// 这不是「有没有改变行动」的替代——两者是不同的失败：
//   · 候选没进 reasoning：**材料没被看见或没被采纳**（§8.3「有指向」就不成立）
//   · 进了 reasoning 但没改行动：识别了但未落实（§8.3 三项中的「有改变」缺失）
//
// 判据同样只到「提及」为止：reasoning 里出现候选标题的前 6 字（弱前缀除外）
// 或 uid，记为「提及」。是否据其判断仍属语义核对。

/** 抽取一个回合里的 reasoning 文本。 */
function reasoningOf(events) {
  const parts = [];
  for (const e of events) {
    if (e.type !== "assistant/message") continue;
    const content = e?.data?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "reasoning" && typeof part.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n");
}

