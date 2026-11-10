// 「利用有限当前话题」的检索改法——**测量脚本，不是实现改动**
// （2026-11-11，spark-69b1de3f 第 (2) 步）
//
// ── 为什么是脚本而不是改实现 ───────────────────────────────────────────
//
// 把上一条用户消息并入召回查询会改变**注入形式**，按 `10 §9.1` 第 2 项属 Human
// Gate 事项（与预算边界同档）。故本脚本只**测量该改法的效果与代价**，产出可比较
// 的证据供 Human 裁定；它不接线、不影响生产路径，删掉即无痕。
//
// ── 要回答的三个问题 ───────────────────────────────────────────────────
//
// Q1 有效吗：对省略型输入（`ellipsis`／`noise`／`ref`）拼接上文后，注入的无关行
//            是否下降、相关行是否上升？
// Q2 代价多大：对**本来有主题**的输入（`topic`）拼接上文会不会引入污染（把上一
//            个话题的候选带进来，挤掉本回合该有的答案）？
// Q3 拼多长：只拼上一条 vs 拼最近 N 条，效果与代价如何随 N 变化？
//
// ── 口径 ───────────────────────────────────────────────────────────────
//
// 「上文」取自本评测集里**相邻的**真实消息（评测集按会话时间顺序摘录，相邻即
// 真实相邻）。跨会话不成对，故能配对的条数少于集子总条数——这是如实的样本限。
//
// 用法：
//   node plugin/scripts/recall-topic-context-ablation.mjs
//   node plugin/scripts/recall-topic-context-ablation.mjs --json

import { recallForAction, INJECTION_EXCLUDED_TYPES } from "../lib/source-recall.js";
import { REAL_CASES, isRealCaseRelated } from "../test/recall-real-cases.mjs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
// **预算与条数须可配置且与取证脚本同源（pitfall「消融脚本多调用点各自硬编码
// 预算致读数不一」）**：初版把 LIMIT=12、BUDGET=10240 写死，而 recall-real-eval
// 与 recall-action-evidence 都接受命令行覆盖。后果是拿本脚本的读数去和另两个
// 脚本比时会**默认它们用了同一预算**，而实际上任何人改过参数就能让比较失效——
// 且失效不可见：报表里印的仍是写死的那个数。
//
// 现改为三脚本同形：`--limit`／`--budget` 可覆盖，默认值一致，并在输出首行
// 印出实际生效值，使「这些数字是在什么参数下取得的」不依赖读者记忆。
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};
const LIMIT = argOf("--limit", 12);
const BUDGET = argOf("--budget", 10240);
const AS_JSON = process.argv.includes("--json");

/**
 * 构造「本句 + 上文」的查询。
 *
 * **拼接形态是刻意的**：不做「取上文的主题词再拼」那种加工——那会引入本脚本
 * 自己的分词/取词策略，测出来的就不只是「并入上文」这一个变量的效果。
 * 直接原样拼接，与 `recallForAction` 既有的分词口径完全一致。
 */
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

// **配对取自数据里的 `context`，不是按数组下标硬取相邻**（2026-11-11 修）。
//
// 初版按下标取 `REAL_CASES[i-1]`，那是错的：集子按 kind 分段组织，相邻两条
// 常常来自不同会话，硬拼出来的「上文」在真实对话里从未出现——拿它测「并入
// 上文有没有用」，测的是脚本自己的编造。
//
// 现在只用 `context` 字段记载的**真实上文原话**（从同一会话取相邻消息，逐字）。
// 没有 `context` 的条目（topic／noise／ref）不参与对照——它们本来就不该有上文。
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

// ── 汇总：按 kind × depth ─────────────────────────────────────────────
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
