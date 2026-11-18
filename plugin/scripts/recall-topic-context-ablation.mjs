
import { recallForAction, INJECTION_EXCLUDED_TYPES } from "../lib/source-recall.js";
import { REAL_CASES, isRealCaseRelated } from "../test/recall-real-cases.mjs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};
const LIMIT = argOf("--limit", 12);
const BUDGET = argOf("--budget", 10240);
const AS_JSON = process.argv.includes("--json");

function compose(prev, cur, depth) {
  const ctx = depth <= 0 ? [] : prev.slice(-depth);
  return [...ctx, cur].join(" ");
}

async function measure(action) {
  const r = await recallForAction({
    action,
    root: ROOT,
    limit: LIMIT,
    budgetBytes: BUDGET,
    includeSpecs: true,
    excludeTypes: INJECTION_EXCLUDED_TYPES,
  });
  const ok = r.ok === true;
  const facts = ok ? (r.facts ?? []).map((x) => x.title) : [];
  const specs = ok ? (r.specs ?? []).map((x) => x.title) : [];
  return { lines: facts.length + specs.length, factLines: facts.length, titles: [...specs, ...facts] };
}

const pairs = REAL_CASES
  .filter((c) => typeof c.context === "string" && c.context.trim() !== "")
  .map((cur) => ({ cur, prev: [cur.context] }));

const DEPTHS = [0, 1];
const results = [];

for (const { cur, prev } of pairs) {
  const row = { q: cur.q, kind: cur.kind, want: cur.want, context: cur.context, variants: {} };
  for (const depth of DEPTHS) {
    const action = compose(prev, cur.q, depth);
    const m = await measure(action);
    const relevant = m.titles.filter((t) => isRealCaseRelated(t, cur.want)).length;
    row.variants[depth] = { ...m, relevant };
  }
  results.push(row);
}

const summary = {};
for (const kind of ["ellipsis"]) {
  const group = results.filter((r) => r.kind === kind);
  if (group.length === 0) continue;
  summary[kind] = {};
  for (const depth of DEPTHS) {
    const lines = group.reduce((a, r) => a + r.variants[depth].lines, 0);
    const factLines = group.reduce((a, r) => a + r.variants[depth].factLines, 0);
    const relevant = group.reduce((a, r) => a + r.variants[depth].relevant, 0);
    const annotated = group.filter((r) => r.want.length > 0);
    const hits = annotated.filter((r) => r.variants[depth].relevant > 0).length;
    summary[kind][depth] = {
      cases: group.length,
      lines,
      factLines,
      relevant,
      annotated: annotated.length,
      hits,
    };
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ summary, results }, null, 2));
} else {
  console.log("「并入上文」改法对照（测量脚本，不改生产路径）");
  console.log(`参数：limit=${LIMIT}、budget=${BUDGET}（与 recall-real-eval／recall-action-evidence 同形可覆盖）`);
  console.log(`有真实上文的条目 ${results.length} 条`);
  console.log("");
  console.log("按类别比较（depth=0 单句 / depth=1 拼接真实上文）：");
  for (const [kind, d] of Object.entries(summary)) {
    const a = d[0];
    const b = d[1];
    const deltaLines = b.lines - a.lines;
    const deltaRel = b.relevant - a.relevant;
    console.log(
      `  ${kind.padEnd(9)} 用例 ${String(a.cases).padStart(2)}  `
      + `行 ${String(a.lines).padStart(3)}→${String(b.lines).padStart(3)} (${deltaLines >= 0 ? "+" : ""}${deltaLines})  `
      + `相关 ${String(a.relevant).padStart(2)}→${String(b.relevant).padStart(2)} (${deltaRel >= 0 ? "+" : ""}${deltaRel})  `
      + `命中 ${a.hits}/${a.annotated}→${b.hits}/${b.annotated}`,
    );
  }
  console.log("");
  console.log("逐条（只列有标注答案的条目，相关行数 d0→d1）：");
  for (const r of results.filter((x) => x.want.length > 0)) {
    const a = r.variants[0];
    const b = r.variants[1];
    const mark = b.relevant > a.relevant ? "↑" : b.relevant < a.relevant ? "↓" : "=";
    console.log(`  ${mark} ${r.q.slice(0, 24).padEnd(26)} ${a.relevant}→${b.relevant}`
      + `  行 ${a.lines}→${b.lines}`);
  }
  console.log("");
  console.log("判读要点（写在脚本里，避免读数被单独引用时脱离上下文）：");
  console.log("  · 只有「相关行」增加才算收益；总行数增加不算——注入更多无关行");
  console.log("    只是把噪声换了个位置。");
  console.log("  · 行数上限固定，故相关行增加必然挤压别处；本表只测省略型一侧，");
  console.log("    topic 侧的代价须在 recall-real-eval 上另测（不在本脚本范围）。");
  console.log("  · 标注为空的两条（上文本身无主题）不参与命中率分母，但计入行数。");
}
