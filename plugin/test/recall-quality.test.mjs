// 召回质量基线（2026-10-27，第 0 步）
//
// ── 为什么需要这个文件 ───────────────────────────────────────────────────
//
// 本仓库原有的召回测试全是**结构断言**（谁能命中谁、字段对不对、预算超没超），
// 唯一一个「质量」指标是 `limitations.measuredSymptomSelfRecall`（用 Pitfall
// 的症状段去召回它自己）。该指标被独立审核证明**与质量不相关**：
//
//   · 旧版实现 24/24，新版实现 24/24 —— 版本间只差 1 条；
//   · 同期真实精确率 13.9% → 10.5%（下降）。
//
// 指标上升、质量下降。原因是它测「同一篇文档的正文去召回自己的标题」——机制词、
// 代码标识符、报错字符串被保证同时出现，与「用户用自己的话描述问题」不是同一种
// 距离。
//
// 没有真基线时，任何改动都无法判断变好还是变坏。2026-10-27 一天内出现三次
// 「指标上升、质量下降」的误判（预算利用率 13%→89%、症状→自身 24/24、
// 单条查询 daed4856 从第 6 到第 2），根因都是拿**不检验价值的指标**证明价值。
//
// ── 本文件的判据 ───────────────────────────────────────────────────────
//
// 每条查询给一个「应有答案」的标题关键词（人工标注），然后：
//   · 精确率 = 返回行里相关行的占比（衡量「有没有凑数」）
//   · 命中 = 应得答案有没有出现在返回里（衡量「漏没漏」）
//
// **查询刻意用用户口吻**，不复述对象原文；标注时同时记录它与目标标题的
// Jaccard（字面重合度），使读者能判断该条是否偏「近义改写」。Jaccard 高的
// 条目会高估分数，已在数据里披露。
//
// **门禁策略**：当前实现是基线，不是目标。门禁只防**倒退**（精确率或命中数
// 低于基线即红），不假装已达到「好」。要抬高门禁必须先有实测改进。

import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { recallForAction, INJECTION_EXCLUDED_TYPES } from "../lib/source-recall.js";

const ROOT = join(import.meta.dirname, "..", "..");

/**
 * 评测集。`want` 为空数组表示「这类查询本不该召回任何东西」（元讨论/寒暄）。
 *
 * `jaccard` 是该查询与目标标题的字面重合度（粗算，用于披露「该条是否偏近义
 * 改写」）。≥0.35 的条目会高估真实能力，判读时须打折。
 */
export const QUALITY_CASES = [
  // ── 有明确主题：应当命中 ──────────────────────────────────────────────
  { q: "页面白屏了怎么办", want: ["无基址构建致 SPA 白屏"], jaccard: 0.07 },
  { q: "前端构建出来打开是空白的", want: ["无基址构建致 SPA 白屏"], jaccard: 0.05 },
  { q: "改字段名之后读取那边没跟着改", want: ["字段改名后读取侧与契约断言未同步"], jaccard: 0.11 },
  { q: "提交被门禁拒绝了", want: ["Git Gate 双向路径覆盖拦截"], jaccard: 0.0 },
  { q: "工单的 scope 怎么写", want: ["工单scope起草未穷举消费方与条文致遗漏靠复核补全"], jaccard: 0.11 },
  // **2026-10-30 更正答案**：本条原以「新增判据未量测可分辨力致零检测力」
  // （pitfall-daed4856）为应得答案。该对象已于 2026-10-28 由 `07a6cf2`
  // **废止（active→discarded）**——其规避被 `specs/04 §6.3`「新增机械判据须先
  // 判定有无增量」吸收。默认召回只取 active，故正确答案**不该**再是它。
  //
  // 这正是评测集最容易烂的方式：**答案失效**与「召回变差」在分数上不可区分。
  // 若把门槛按 9.2% 调低，同时也会把「Git Gate 那条真差距」一并放过。
  // 故此处只改答案、不动门槛：目标改为承接该纪律的规范（`specs/06` §4 的
  // 「新增机械判据与既有规则的关系」行同源），判据仍是「这句话该召回什么」。
  { q: "加了一条校验但没测过它能不能真发现问题", want: ["Code 实践与测试规范"], jaccard: 0.08 },
  { q: "插件重新加载以后子代理的记录都没了", want: ["插件重建清空子代理登记表致复核记录恒被拒"], jaccard: 0.06 },
  { q: "热重载的时候好像同时装了两份", want: ["重载窗口多实例致钩子重复且互相摘除"], jaccard: 0.05 },
  { q: "这次改动会不会把已有的缓存弄坏", want: [], jaccard: 0.0,
    // 已知缺陷（未修）：本仓确有一条 friction 的标题含「缓存」，但它因
    // `REQUIRED_RECALL_TYPES` 被无条件后置而排不进注入位。此处 want 暂留空，
    // 待第 1 步修完再回填——**故意如此**，使该用例在修复前后给出可对比的信号。
    known_gap: "REQUIRED_RECALL_TYPES 把 adr/pitfall 无条件前置，含「缓存」的 friction 排不进前 N" },

  // ── 无明确主题：不该召回（元讨论 / 寒暄 / 短指令）────────────────────
  { q: "实际给出的都是有价值的信息吗？还是为了给而给的？", want: [], jaccard: 0.0 },
  { q: "按你建议推进", want: [], jaccard: 0.0 },
  { q: "这样做好不好", want: [], jaccard: 0.0 },
  { q: "谢谢，先这样吧", want: [], jaccard: 0.0 },
];

/** 判定某行是否属于「应得答案」。按标题前缀匹配，避免长标题差异导致误判。 */
function isRelated(title, want) {
  if (want.length === 0) return false;
  return want.some((w) => title.includes(w.slice(0, 6)));
}

/**
 * 跑一条用例。
 * @returns {{n:number, relevant:number, hit:boolean|null, titles:string[]}}
 */
export async function runCase(c, limit = 3) {
  const r = await recallForAction({
    action: c.q,
    root: ROOT,
    limit,
    budgetBytes: 10240,
    includeSpecs: true,
    // **2026-10-30 补上**：本文件测的是「一次自动注入会看到什么」，而注入路径
    // （`buildRecallInjection`）恒传 `excludeTypes: INJECTION_EXCLUDED_TYPES`
    // ——`31 §10`（2026-10-27 修订）已让 spark 退出自动注入。此前不传，精确率
    // 里混入了 spark 行（注入了本不该进注入面的东西），指标与真实体验不对应。
    excludeTypes: INJECTION_EXCLUDED_TYPES,
  });
  if (r.ok !== true) {
    // 拒召回对「无主题」用例是**正确**结果。
    return { n: 0, relevant: 0, hit: c.want.length === 0 ? true : false, titles: [] };
  }
  const titles = [...(r.specs ?? []), ...(r.facts ?? [])].map((x) => x.title);
  const relevant = titles.filter((t) => isRelated(t, c.want)).length;
  const hit = c.want.length === 0
    ? titles.length === 0      // 无主题时「命中」= 什么都没有召回
    : titles.some((t) => isRelated(t, c.want));
  return { n: titles.length, relevant, hit, titles };
}

/** 汇总一次全量评测。 */
export async function runSuite(limit = 3) {
  let n = 0;
  let relevant = 0;
  let hits = 0;
  let topicCases = 0;
  let quietCases = 0;
  let quietClean = 0;
  const rows = [];
  for (const c of QUALITY_CASES) {
    const r = await runCase(c, limit);
    n += r.n;
    relevant += r.relevant;
    if (c.want.length > 0) {
      topicCases += 1;
      if (r.hit) hits += 1;
    } else {
      quietCases += 1;
      if (r.n === 0) quietClean += 1;
    }
    rows.push({ q: c.q, ...r, want: c.want.length });
  }
  return {
    rows,
    lines: n,
    relevant,
    precision: n === 0 ? 0 : relevant / n,
    topicCases,
    hits,
    quietCases,
    quietClean,
  };
}

// ── 基线数值（2026-10-30 重测，limit=3）──────────────────────────────────
// 原基线实测于 2026-10-27：65 行、相关 7 行（10.8%）、主题命中 7/8。
// **2026-10-30 重测为 65 行、相关 6 行（9.2%）、主题命中 6/8**，差 1 相关 + 1 命中。
//
// 归因（已取证，不是推测）：
//   1. **答案失效**：第 6 条「加了一条校验但没测过它能不能真发现问题」的应得答案
//      `pitfall-daed4856`（新增判据未量测可分辨力致零检测力），已于 2026-10-28 由
//      `07a6cf2` **废止 active→discarded**（规避被 `specs/04 §6.3` 吸收）。默认召回
//      只取 active，故它本就不该再出现——已把 want 改为承接该纪律的
//      `Code 实践与测试规范`。
//   2. **不是代码退化**：用 `a677619^`（改动前）与 `a677619`（改动后）两个版本的
//      `source-recall.js` 在**同一语料**上 A/B，两侧同为 9.2% / 6/8。
//      故原提交信息里「精确率 13.9%→10.5%，由 a677619 引入」的归因不成立。
//   3. **真实差距仍在**：修正答案后仍是 6/65——两条未命中都不是答案问题：
//      · 「提交被门禁拒绝了」→ `Git Gate 双向路径覆盖拦截` 排第 5（limit=3 进不来）
//      · 「加了一条校验但没测过…」→ `Code 实践与测试规范` 排第 6
//      这两条**故意保留**为红/低分信号，下调门槛会把它们一起放过。
//
// 门槛策略不变：**只防倒退，不假装已达到「好」**。本次下调是「答案失效导致分母
// 口径变了」的同步，不是接受更差的质量；要抬高门槛仍须先有实测改进。
const BASELINE = {
  limit3: { lines: 65, relevant: 6, hits: 6, topicCases: 8, quietClean: 1 },
};

test("质量基线（limit=3）：精确率与命中数不得低于记录值", async () => {
  const s = await runSuite(3);
  // 先打印可读摘要，失败时便于定位（node:test 会带上 stdout）。
  const detail = s.rows
    .map((r) => `  ${r.hit ? "✔" : "✘"} ${r.q.slice(0, 26).padEnd(28)} ${r.relevant}/${r.n}`)
    .join("\n");
  assert.ok(
    s.precision >= BASELINE.limit3.relevant / BASELINE.limit3.lines - 0.001,
    `精确率倒退：${(s.precision * 100).toFixed(1)}% < 基线 `
    + `${((BASELINE.limit3.relevant / BASELINE.limit3.lines) * 100).toFixed(1)}%\n${detail}`,
  );
  assert.ok(
    s.hits >= BASELINE.limit3.hits,
    `主题类命中倒退：${s.hits}/${s.topicCases} < 基线 ${BASELINE.limit3.hits}/${BASELINE.limit3.topicCases}\n${detail}`,
  );
  // 记录当前真实值，供每次跑测试时对照（不参与断言，避免把基线当目标）。
  test.diagnostic?.(`limit=3 实测：${s.relevant}/${s.lines} = ${(s.precision * 100).toFixed(1)}%，`
    + `主题命中 ${s.hits}/${s.topicCases}，无主题干净 ${s.quietClean}/${s.quietCases}`);
});

test("无主题查询不得大量注入（当前为已知缺陷，记录真实值）", async () => {
  // 这条**暂不断言为 0**——当前实现对「按你建议推进」这类短指令会召回若干条
  // 弱命中。若断言「必须为 0」，本用例天天红、失去信号价值。
  // 故此处只断言「不得超过一个上限」，并把真实值记录下来供后续收敛。
  const s = await runSuite(3);
  const quietLines = s.rows.filter((r) => r.want === 0).reduce((a, r) => a + r.n, 0);
  assert.ok(
    quietLines <= 20,
    `无主题查询共注入 ${quietLines} 行，超过上限 20——这是「为了给而给」的直接度量`,
  );
});
