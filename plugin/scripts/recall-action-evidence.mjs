
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { decompressZstdStream } from "../lib/zstd-compat.js";

const workspaceKey = process.cwd()
  .replace(/^[/\\]+/, "")
  .replace(/:/g, "")
  .replace(/[/\\]+/g, "-");
const SESSIONS_ROOT = join(homedir(), ".dsh", "sessions", `--${workspaceKey}--`);
const AS_JSON = process.argv.includes("--json");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};
const MAX_SESSIONS = argOf("--limit-sessions", 40);

const INJECTION_MARK = "【双源召回 · 行动前候选】";

function textOf(event) {
  const content = event?.data?.content ?? event?.data?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("");
}

function candidatesOf(injectionText) {
  const out = [];
  for (const line of injectionText.split("\n")) {
    if (!line.startsWith("- [")) continue;
    const m = /^- \[[^\]]+\] (.+?)(?: · |\s—\s)(.*)$/.exec(line);
    const title = (m?.[1] ?? "").trim();
    const pathMatch = /\((ldvh-base\/[^)]+\.md)\)/.exec(line);
    const uidMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(line);
    if (title === "" && pathMatch === null) continue;
    out.push({ title, path: pathMatch?.[1] ?? null, uid: uidMatch?.[1] ?? null });
  }
  const l0 = [];
  let inL0 = false;
  for (const line of injectionText.split("\n")) {
    if (/^【(决策基线|事实规范|经验)/.test(line)) { inL0 = true; continue; }
    if (line.startsWith("（") || line.startsWith("【")) { inL0 = false; continue; }
    if (inL0 && line.startsWith("· ")) l0.push(line.slice(2));
  }
  return { candidates: out, l0 };
}

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

const WEAK_TITLE_PREFIXES = [
  "dsh-ui", "Spark ", "Human ", "只推 dev", "插件 lib", "Git Ga", "retire",
  "事实对象正", "本地开发工", "调研系统的",
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

const REF_KIND_BY_TOOL = new Map([
  ["ldvh_spark_write", "write"],
  ["ldvh_pitfall_write", "write"],
  ["ldvh_friction_write", "write"], ["ldvh_norm_write", "write"],
  ["ldvh_devlog_write", "write"],
  ["ldvh_pending_queue_resolve", "write"], ["edit", "write"],
  ["ask_user_question", "write"], ["update_goal", "write"],
  ["read", "read"], ["bash", "read"], ["grep", "read"],
  ["ldvh_norm_read", "read"],
  ["ldvh_spark_read", "read"],
  ["subagent", "relay"], ["structured_output", "relay"], ["compress", "relay"],
]);
const kindOf = (tool) => REF_KIND_BY_TOOL.get(tool) ?? "relay";

let allDirs;
try {
  allDirs = await readdir(SESSIONS_ROOT);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  allDirs = [];
}
const turns = [];
let scannedSessions = 0;

let unreadableSessions = 0;
let unparsableLines = 0;
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
  const rawLines = text.split("\n").filter(Boolean);
  const events = [];
  for (const l of rawLines) {
    try {
      events.push(JSON.parse(l));
    } catch {
      unparsableLines += 1;
    }
  }
  const hasRealInjection = events.some(
    (e) => e.type === "user/message" && textOf(e).includes(INJECTION_MARK),
  );
  if (!hasRealInjection) continue;
  scannedSessions += 1;

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
    actedWithoutMention: turn.events.some((e) => e.type === "tool/call") && mentioned.length === 0,
  });
}

const turnsWithReasoning = judged.filter((r) => r.reasoningChars > 0).length;
const turnsMentioned = judged.filter((r) => r.mentioned > 0).length;
const actedNoMention = judged.filter((r) => r.actedWithoutMention).length;
const withInjection = rows.length;
const withAction = rows.filter((r) => r.toolCalls > 0).length;
const withRef = rows.filter((r) => r.referenced > 0).length;
const withGate = rows.filter((r) => r.gateCalls.length > 0).length;
const totalCandidates = rows.reduce((a, r) => a + r.candidates, 0);
const totalRefs = rows.reduce((a, r) => a + r.referenced, 0);
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

