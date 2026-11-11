// 真实任务召回评测（2026-11-11，spark-69b1de3f 第 (1) 步的执行体）
//
// 用法：
//   node plugin/scripts/recall-real-eval.mjs              # 跑默认档
//   node plugin/scripts/recall-real-eval.mjs --limit 12 --budget 10240
//   node plugin/scripts/recall-real-eval.mjs --json       # 机器可读
//
// ── 它测什么 ───────────────────────────────────────────────────────────
//
// 用**真实用户原话**（见 `test/recall-real-cases.mjs` 的来源说明）跑一次注入
// 路径召回，按 kind 分别报：
//   · 精确率 = 返回行里属于标注答案的占比（衡量「有没有凑数」）
//   · 主题命中 = 标注了应得答案的题里，答案是否出现（衡量「漏没漏」）
//   · 净行数 = 不该召回的题（ellipsis/noise/ref）实际注入了几行
//
// ── 它不测什么（必须与指标一起读） ──────────────────────────────────────
//
// 不测真实流量下的召回率：本集只有本项目 48 个主控会话，不等于全部使用场景。
// 不测「AI 拿到候选后是否据此行动」：那属消费侧（34 §8.1 第 2 项）。
// 因此本脚本的输出是**候选质量读数**，不是「召回有没有用」的结论。

import { recallForAction, INJECTION_EXCLUDED_TYPES } from "../lib/source-recall.js";
import { REAL_CASES, isRealCaseRelated, REAL_CASE_KINDS } from "../test/recall-real-cases.mjs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function argOf(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const LIMIT = argOf("--limit", 12);
const BUDGET = argOf("--budget", 10240);
const AS_JSON = process.argv.includes("--json");

/** 跑一条用例。 */
async function runCase(c) {
  const r = await recallForAction({
    action: c.q,
    root: ROOT,
    limit: LIMIT,
    budgetBytes: BUDGET,
    includeSpecs: true,
    // 与注入路径同参（否则测的是另一条路径，见 recall-quality 的既有教训）。
    excludeTypes: INJECTION_EXCLUDED_TYPES,
  });
  const ok = r.ok === true;
  // **必须同时保留 type**（2026-11-11 修）：`want` 里有一类标注写的是**类型名**
  // （`ADR-决策`／`Pitfall-踩坑经验`），只有候选自己的 `type` 字段能对上。
  // 初版只取标题，导致这类标注永远匹配不上，**事实侧精确率恒接近 0**——
  // 读数看似「注入的全是无关经验」，实际是判据与期望不同构导致的恒定假。
  const specs = ok ? (r.specs ?? []).map((x) => ({ title: x.title, type: x.type ?? "spec" })) : [];
  const facts = ok ? (r.facts ?? []).map((x) => ({ title: x.title, type: x.type })) : [];
  const all = [...specs, ...facts];
  const titles = all.map((x) => x.title);
  const hitOf = (rows, want) => rows.filter((x) => isRealCaseRelated(x.title, want, x.type)).length;
  const relevant = hitOf(all, c.want);
  const relevantFacts = hitOf(facts, c.want);
  // ── 三种命中口径必须并列（2026-11-11 独立复核后补）──────────────────
  //
  // 复核实测同一批 topic 用例：any-of 下 10/10、all-of 下 5/10、对象级 12/17。
  // 只报 any-of 会让人以为「有主题的不漏」，而对象级说明有 5 个应得对象根本
  // 没进注入面。三者各有用途，**并列披露**才不误导：
  //   hitAny  —— 命中任一答案即记（宽松，看「有没有进展」）
  //   hitAll  —— 全部答案都在才记（严格，看「完整度」）
  //   objHit/objTotal —— 按对象逐个记（唯一能答「该看到的看到几成」）
  const hitAny = c.want.length === 0
    ? titles.length === 0
    : all.some((x) => isRealCaseRelated(x.title, c.want, x.type));
  const perWant = c.want.map((w) => all.some((x) => isRealCaseRelated(x.title, [w], x.type)));
  const objHit = perWant.filter(Boolean).length;
  const hitAll = c.want.length > 0 && objHit === c.want.length;
  const hit = hitAny;
  // **两侧分开计数**：规范源条目数与事实源条目数差一个量级，混算会把
  // 「事实侧一条没中」稀释成「整体精确率还行」。读者要能看出是哪一侧在凑数。
  return { ok, titles, specs, facts, n: titles.length, nSpecs: specs.length, nFacts: facts.length, relevant, relevantFacts, hit, hitAny, hitAll, objHit, objTotal: c.want.length };
}

const rows = [];
for (const c of REAL_CASES) {
  rows.push({ ...c, ...(await runCase(c)) });
}

// ── 汇总（按 kind 分组；混算总数会掩盖结构差异）──────────────────────────
const byKind = {};
for (const kind of REAL_CASE_KINDS) {
  const group = rows.filter((r) => r.kind === kind);
  if (group.length === 0) continue;
  const n = group.reduce((a, r) => a + r.n, 0);
  const relevant = group.reduce((a, r) => a + r.relevant, 0);
  const nSpecs = group.reduce((a, r) => a + r.nSpecs, 0);
  const nFacts = group.reduce((a, r) => a + r.nFacts, 0);
  const relevantFacts = group.reduce((a, r) => a + r.relevantFacts, 0);
  const annotated = group.filter((r) => r.want.length > 0);
  const hits = annotated.filter((r) => r.hit).length;
  byKind[kind] = {
    cases: group.length,
    lines: n,
    relevant,
    precision: n === 0 ? 0 : relevant / n,
    specLines: nSpecs,
    factLines: nFacts,
    // 事实侧精确率单列：这是「有没有拿无关经验凑数」的直接读数。
    factPrecision: nFacts === 0 ? 0 : relevantFacts / nFacts,
    annotated: annotated.length,
    hits,
    // 不该召回的题里，实际注入的行数（越小越干净）
    strayLines: group.filter((r) => r.want.length === 0).reduce((a, r) => a + r.n, 0),
  };
}

const totalLines = rows.reduce((a, r) => a + r.n, 0);
const totalRelevant = rows.reduce((a, r) => a + r.relevant, 0);
const annotatedAll = rows.filter((r) => r.want.length > 0);
const summary = {
  limit: LIMIT,
  budget: BUDGET,
  cases: rows.length,
  lines: totalLines,
  relevant: totalRelevant,
  precision: totalLines === 0 ? 0 : totalRelevant / totalLines,
  annotated: annotatedAll.length,
  // 三种口径并列（2026-11-11 独立复核后补）——
  // 只报 hits 会掩盖「命中了但漏了别的对象」这一缺口。
  hits: annotatedAll.filter((r) => r.hitAny).length,
  hitsAll: annotatedAll.filter((r) => r.hitAll).length,
  objHit: annotatedAll.reduce((a, r) => a + r.objHit, 0),
  objTotal: annotatedAll.reduce((a, r) => a + r.objTotal, 0),
  byKind,
};

if (AS_JSON) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`真实任务召回评测（limit=${LIMIT}、budget=${BUDGET}、用例 ${rows.length} 条）`);
  console.log("");
  // **命中口径须并列**：any-of 宽松、all-of 严格、对象级最接近「看到几成」。
  // 只印一个数会让人把宽口径当成结论（独立复核 2026-11-11 指出的缺陷）。
  console.log(
    `命中口径：` +
    `any-of ${summary.hits}/${summary.annotated}（有进展即记）  ` +
    `all-of ${summary.hitsAll}/${summary.annotated}（全部答案都在才记）  ` +
    `对象级 ${summary.objHit}/${summary.objTotal}（${((summary.objHit / Math.max(1, summary.objTotal)) * 100).toFixed(1)}%）`,
  );
  console.log("");
  console.log("按类别：");
  for (const [kind, s] of Object.entries(byKind)) {
    const hitPart = s.annotated > 0 ? `主题命中 ${s.hits}/${s.annotated}` : "无标注答案";
    console.log(
      `  ${kind.padEnd(9)} 用例 ${String(s.cases).padStart(2)}  `
      + `行 ${String(s.lines).padStart(3)}（规范 ${String(s.specLines).padStart(3)}/事实 ${String(s.factLines).padStart(2)}）  `
      + `相关 ${String(s.relevant).padStart(2)}  精确率 ${pct(s.precision).padStart(6)}  `
      + `事实侧 ${pct(s.factPrecision).padStart(6)}  ${hitPart}`
      + (s.strayLines > 0 ? `  不该召回却注入 ${s.strayLines} 行` : ""),
    );
  }
  console.log("");
  console.log(`合计：${summary.relevant}/${summary.lines} = ${pct(summary.precision)}；`
    + `主题命中 ${summary.hits}/${summary.annotated}`);
  console.log("");
  console.log("逐条（✘ = 未命中标注答案；· = 无标注答案、注入行数供参考）：");
  for (const r of rows) {
    const mark = r.want.length === 0 ? "·" : r.hit ? "✔" : "✘";
    console.log(`  ${mark} [${r.kind}] ${r.q.slice(0, 34).padEnd(36)} ${r.relevant}/${r.n}`);
  }
}
