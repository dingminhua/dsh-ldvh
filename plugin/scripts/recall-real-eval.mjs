
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

async function runCase(c) {
  const r = await recallForAction({
    action: c.q,
    root: ROOT,
    limit: LIMIT,
    budgetBytes: BUDGET,
    includeSpecs: true,
    excludeTypes: INJECTION_EXCLUDED_TYPES,
  });
  const ok = r.ok === true;
  const specs = ok ? (r.specs ?? []).map((x) => ({ title: x.title, type: x.type ?? "spec" })) : [];
  const facts = ok ? (r.facts ?? []).map((x) => ({ title: x.title, type: x.type })) : [];
  const all = [...specs, ...facts];
  const titles = all.map((x) => x.title);
  const hitOf = (rows, want) => rows.filter((x) => isRealCaseRelated(x.title, want, x.type)).length;
  const relevant = hitOf(all, c.want);
  const relevantFacts = hitOf(facts, c.want);
  const hitAny = c.want.length === 0
    ? titles.length === 0
    : all.some((x) => isRealCaseRelated(x.title, c.want, x.type));
  const perWant = c.want.map((w) => all.some((x) => isRealCaseRelated(x.title, [w], x.type)));
  const objHit = perWant.filter(Boolean).length;
  const hitAll = c.want.length > 0 && objHit === c.want.length;
  const hit = hitAny;
  return { ok, titles, specs, facts, n: titles.length, nSpecs: specs.length, nFacts: facts.length, relevant, relevantFacts, hit, hitAny, hitAll, objHit, objTotal: c.want.length };
}

const rows = [];
for (const c of REAL_CASES) {
  rows.push({ ...c, ...(await runCase(c)) });
}

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
    factPrecision: nFacts === 0 ? 0 : relevantFacts / nFacts,
    annotated: annotated.length,
    hits,
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
