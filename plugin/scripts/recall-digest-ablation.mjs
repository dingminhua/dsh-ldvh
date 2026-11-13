#!/usr/bin/env node
/**
 * `recall_digest` 去留的**配对消融**工具（2026-11-10）。
 *
 * WHY
 * `recall_digest`（02 §7.1）是人工维护的召回摘要。它「有没有用」不能用
 * 「删掉后是否仍能命中」回答——那只会证明回退链存在；也不能用「同一对象
 * 的症状段能否召回自己」回答——self-recall 已被证明与质量不相关
 * （`plugin/test/recall-quality.test.mjs` 文件头记录了 24/24 先例）。
 *
 * 唯一能回答它的是**同一语料、同一查询集、同一参数下，带该字段与不带该字段的
 * 配对比较**。本脚本就做这一件事：把 `ldvh-base/` 与 `specs/` 复制到临时目录，
 * 在副本上删除每个载体的 `recall_digest` 行，然后对同一组查询跑两遍。
 * **工作树不会被修改**（副本用完即删）。
 *
 * WHAT IT MEASURES（唯一口径）
 * 与 `recall-quality.test.mjs` 同一套人工标注查询与同一判定函数：
 *   · 候选行数、相关行数、精确率 —— 「有没有凑数」；
 *   · 主题命中 —— 「该命中的漏没漏」；
 *   · 无主题干净 —— 「不该召回的召回了没有」。
 * 差异只比较**同一查询**在两版下的结果，不做跨查询汇总外的推断。
 *
 * WHAT IT DOES NOT MEASURE（如实声明的边界）
 *   · 不是真实用户流量的精确率/召回率（样本仅十余条，且 `want` 只标注目标标题，
 *     其他结果不一定无关）；
 *   · 不覆盖自动注入的完整链路（L0 索引、分节名额、预算截断）；
 *   · 不覆盖 AI 后续主动查询（那是 `ldvh_spark_list` 的 `keyword` 通道，见
 *     `--probe-terms` 的说明）；
 *   · 不判断「候选是否适用」——命中不等于适用（34 §13）。
 *
 * 用法：
 *   node scripts/recall-digest-ablation.mjs              # 配对消融（默认，limit=3）
 *   node scripts/recall-digest-ablation.mjs --limit 12   # 换条数上限
 *   node scripts/recall-digest-ablation.mjs --probe-terms # digest 独有完整词项探测
 *   node scripts/recall-digest-ablation.mjs --probe-terms --all-probes
 *                                                        # 全量探针（不复抽样）
 *   node scripts/recall-digest-ablation.mjs --probe-terms --all-probes --limit 400
 *                                                        # 排除「掉出前 N 位」的干扰
 *   node scripts/recall-digest-ablation.mjs --migration-check   # 词面并入 trigger_signal 后重测
 *   node scripts/recall-digest-ablation.mjs --object-reachability
 *                                                        # 对象级：移除后是否有对象整体召不回
 *   node scripts/recall-digest-ablation.mjs --delete-feasibility
 *                                                        # 四方案 × 三 limit 对照表（回答「能否安全删除」）
 *   node scripts/recall-digest-ablation.mjs --json        # 只输出机器可读结果
 *
 * **limit 与 budgetBytes 都是判据的一部分，不是无关参数**（2026-11-10 实测教训）：
 * 同一语料指纹下，limit 由 3→5→400 改变会使「失去可达」的条数大幅变化；更隐蔽的
 * 是 `budgetBytes`——20000 时移除后 111 条**全部**不可达，200000 时同一批只剩 48 条
 * 真正不可达。原因很简单——「掉出前 N 位」与「预算把结果截断」都不是「真的查不到」。
 * 因此本脚本统一用 `PROBE_BUDGET_BYTES`，且所有模式必须同口径才可互比。故：
 *   · 要判断**真实可达性**，用足够大的 limit（≥ 结果集规模，实测 400 即封顶）；
 *   · 要判断**注入面实际可见性**，才用小 limit（生产注入就是小 limit）；
 *   · 跨轮比较数字前先对齐 limit，否则会得到自相矛盾的结论。
 *
 * 退出码：0 = 移除后无主题命中损失；1 = 有损失（须先判定该损失是否真相关）；
 * 2 = 环境不可用（语料缺失）。
 *
 * 与 specs/06 的关系：本脚本是**开发期度量工具**，不构成验证结论，也不替代
 * 06 §7 的验证纪律。它产出的数字须与语料指纹同时记录，否则不可跨时比较。
 */

import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { recallForAction, INJECTION_EXCLUDED_TYPES, tokenize, isWeakToken } from "../lib/source-recall.js";
// 共享数据源（**不要** import 测试文件：那会连带执行整组断言）。
import { QUALITY_CASES, isRelated } from "../test/recall-quality-cases.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** 探针抽样上限；0 = 全量。由 `--all-probes` 置 0。 */
let MAX_PROBES = 120;

/**
 * 移除 `recall_digest` 行的**唯一**正则（三处共用：剥离语料、探针取词、迁移）。
 *
 * `(?:[ \t]*\r?\n|$)` 而不是 `\n`：该键位于 frontmatter 末行时**没有尾随换行**，
 * 强制 `\n` 会让删除静默失败，副本仍带该字段，从而给出反向结论（2026-11-10 实测）。
 */
const STRIP_PATTERN = /^recall_digest:[^\n]*(?:[ \t]*\r?\n|$)/gm;
const FACT_DIRS = Object.freeze([
  "adrs", "devlogs", "frictions", "norms", "pitfalls", "researches", "sparks", "subgoals",
]);

async function listMarkdown(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listMarkdown(path));
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

/**
 * 复制可复算语料到临时根。
 *
 * **为什么连 `specs/` 一起复制**：规范源也参与召回（`includeSpecs` 默认为真），
 * 只复制事实源会让两版测的不是同一件事。
 */
async function stageCorpus(tempRoot) {
  await cp(join(REPO_ROOT, "ldvh-base"), join(tempRoot, "ldvh-base"), { recursive: true });
  await cp(join(REPO_ROOT, "specs"), join(tempRoot, "specs"), { recursive: true });
  const files = await listMarkdown(join(tempRoot, "ldvh-base"));
  let stripped = 0;
  for (const path of files) {
    const source = await readFile(path, "utf8");
    // **必须连行尾换行一并允许缺失**（2026-11-10 实测缺陷）：当 `recall_digest`
    // 是 frontmatter 的最后一个键时，该行之后直接是 `---`，行内容**没有尾随换行**；
    // 正则若强制 `\n` 结尾，这一行就删不掉，"无 digest" 副本仍带着该字段——
    // 于是本脚本会给出「移除后无差异」的**假结论**，而字段其实从未被移除。
    // 故改用 `(?:[ \t]*\r?\n|$)`，并在下方**自检**：剥离后不得残留该键。
    const strippedText = source.replace(STRIP_PATTERN, "");
    if (strippedText === source) continue;
    if (/^recall_digest:/m.test(strippedText) || /^[ \t]*recall_digest:/m.test(strippedText)) {
      throw new Error(`剥离 recall_digest 后仍残留该键，拒绝用未真正移除的语料测量：${path}`);
    }
    stripped += 1;
    await writeFile(path, strippedText);
  }
  return { files: files.length, stripped };
}

/** 语料指纹：让数字可跨时比较（语料一变，旧数字就不再可比）。 */
async function corpusFingerprint() {
  const hash = createHash("sha256");
  for (const dir of FACT_DIRS) {
    let names = [];
    try { names = (await readdir(join(REPO_ROOT, "ldvh-base", dir))).sort(); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      hash.update(`${dir}/${name}\n`);
      hash.update(await readFile(join(REPO_ROOT, "ldvh-base", dir, name), "utf8"));
    }
  }
  return hash.digest("hex").slice(0, 16);
}

/** 对给定根跑一遍评测集，返回逐条结果。 */
async function evaluate(root, limit) {
  const rows = [];
  for (const testCase of QUALITY_CASES) {
    const result = await recallForAction({
      action: testCase.q,
      root,
      limit,
      budgetBytes: 10240,
      includeSpecs: true,
      // 与质量基线同参：注入路径恒传该排除集（31 §10：spark 不进自动注入）。
      excludeTypes: INJECTION_EXCLUDED_TYPES,
    });
    const titles = result.ok === true
      ? [...(result.specs ?? []), ...(result.facts ?? [])].map((x) => x.title)
      : [];
    const relevant = titles.filter((t) => isRelated(t, testCase.want)).length;
    const hit = testCase.want.length === 0
      ? titles.length === 0
      : titles.some((t) => isRelated(t, testCase.want));
    rows.push({ q: testCase.q, want: testCase.want.length, titles, relevant, hit });
  }
  return rows;
}

function summarize(rows) {
  const lines = rows.reduce((sum, r) => sum + r.titles.length, 0);
  const relevant = rows.reduce((sum, r) => sum + r.relevant, 0);
  const topic = rows.filter((r) => r.want > 0);
  const quiet = rows.filter((r) => r.want === 0);
  return {
    lines,
    relevant,
    precision: lines === 0 ? 0 : relevant / lines,
    topicHits: topic.filter((r) => r.hit).length,
    topicCases: topic.length,
    quietClean: quiet.filter((r) => r.titles.length === 0).length,
    quietCases: quiet.length,
  };
}

// ---------------------------------------------------------------------------
// 模式 A：配对消融
// ---------------------------------------------------------------------------

async function runPairAblation(limit, asJson) {
  const tempRoot = await mkdtemp(join(tmpdir(), "ldvh-digest-ablation-"));
  try {
    const staged = await stageCorpus(tempRoot);
    const withDigest = await evaluate(REPO_ROOT, limit);
    const withoutDigest = await evaluate(tempRoot, limit);
    const changed = withDigest
      .map((row, index) => {
        const other = withoutDigest[index];
        const same = JSON.stringify(row.titles) === JSON.stringify(other.titles);
        return same ? null : {
          q: row.q,
          hitWithDigest: row.hit,
          hitWithoutDigest: other.hit,
          relevantWithDigest: row.relevant,
          relevantWithoutDigest: other.relevant,
          titlesWithDigest: row.titles,
          titlesWithoutDigest: other.titles,
        };
      })
      .filter((x) => x !== null);

    const before = summarize(withDigest);
    const after = summarize(withoutDigest);
    const lostTopicHits = before.topicHits - after.topicHits;
    const report = {
      mode: "paired-ablation",
      corpusFingerprint: await corpusFingerprint(),
      limit,
      cases: QUALITY_CASES.length,
      carriersScanned: staged.files,
      carriersStripped: staged.stripped,
      withDigest: before,
      withoutDigest: after,
      delta: {
        lines: after.lines - before.lines,
        relevant: after.relevant - before.relevant,
        precision: after.precision - before.precision,
        topicHits: after.topicHits - before.topicHits,
        quietClean: after.quietClean - before.quietClean,
      },
      changed,
      verdict: lostTopicHits > 0 ? "topic-hit-loss" : "no-topic-hit-difference",
    };

    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printPairReport(report);
    }
    return lostTopicHits > 0 ? 1 : 0;
  } finally {
    await removeStagedCorpus(tempRoot, "ldvh-digest-ablation-");
  }
}

function printPairReport(report) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log("recall_digest 配对消融（同语料 / 同查询集 / 同参数）");
  console.log(`  语料指纹 ${report.corpusFingerprint}（语料一变，本数字即不可跨时比较）`);
  console.log(`  条数上限 limit=${report.limit}，评测用例 ${report.cases} 条`);
  console.log(`  载体 ${report.carriersScanned} 个，实际移除字段 ${report.carriersStripped} 个`);
  console.log("");
  console.log("  指标            有 digest        无 digest");
  const row = (label, a, b) => console.log(`  ${label.padEnd(14)}${String(a).padEnd(17)}${b}`);
  row("候选行数", report.withDigest.lines, report.withoutDigest.lines);
  row("相关行数", report.withDigest.relevant, report.withoutDigest.relevant);
  row("精确率", pct(report.withDigest.precision), pct(report.withoutDigest.precision));
  row("主题命中", `${report.withDigest.topicHits}/${report.withDigest.topicCases}`,
    `${report.withoutDigest.topicHits}/${report.withoutDigest.topicCases}`);
  row("无主题干净", `${report.withDigest.quietClean}/${report.withDigest.quietCases}`,
    `${report.withoutDigest.quietClean}/${report.withoutDigest.quietCases}`);
  console.log("");
  if (report.changed.length === 0) {
    console.log("  逐条结果：两版**完全一致**（无一条查询的候选集发生变化）。");
  } else {
    console.log(`  逐条差异：${report.changed.length} 条查询的候选集发生变化`);
    for (const item of report.changed) {
      console.log(`    · ${item.q}`);
      console.log(`      有 digest：${item.titlesWithDigest.join(" | ")}`);
      console.log(`      无 digest：${item.titlesWithoutDigest.join(" | ")}`);
      console.log(`      主题命中 ${item.hitWithDigest} → ${item.hitWithoutDigest}`);
    }
  }
  console.log("");
  console.log(`  结论：${report.verdict === "no-topic-hit-difference"
    ? "移除后主题命中无损失（不代表该字段在其他查询上也无增益——见脚本头边界）"
    : "移除后主题命中下降，须先逐条判定该损失是否真相关，不得直接采用"}`);
  console.log("  边界：样本仅十余条人工标注；不覆盖完整注入链路、L0 索引与 AI 主动查询；"
    + "命中不等于适用（34 §13）。");
}

// ---------------------------------------------------------------------------
// 模式 B：digest 独有完整词项探测
// ---------------------------------------------------------------------------

/**
 * 为什么用**完整词项**而不是分词后的二字组：
 * 中文按二字滑窗切分，「录承」「析短」这类碎片必然与任意文本重叠，用它们
 * 造探针会系统性高估该字段的独有覆盖。只取作者按空白分隔写出的完整词项，
 * 才是「人工维护时真正想加进去的查询词面」。
 */
async function collectWholeWordProbes() {
  const probes = [];
  for (const dir of FACT_DIRS) {
    let names = [];
    try { names = await readdir(join(REPO_ROOT, "ldvh-base", dir)); } catch { continue; }
    for (const name of names.filter((n) => n.endsWith(".md"))) {
      const full = await readFile(join(REPO_ROOT, "ldvh-base", dir, name), "utf8");
      const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(full);
      if (match === null) continue;
      const digestMatch = /^recall_digest:[ \t]*(.*)$/m.exec(match[1]);
      if (digestMatch === null) continue;
      const digest = digestMatch[1].trim();
      if (digest === "" || digest === "|" || digest === ">") continue;
      // **必须连行尾换行一并允许缺失**：frontmatter 的最后一个键后面就是 `\n---`，
      // 该键行本身**没有尾随换行**（行内容之后直接换行进入 `---`）。若正则要求
      // `\n` 结尾，这个键就删不掉，`rest` 里仍含 digest 原文，于是每个词项都会被
      // 误判为「正文已含」而探针恒为 0（2026-11-10 实测踩中：292 个对象给出 0 条
      // 探针，而按 YAML 键值统计应为 997 条）。故改用 `(?:[ \t]*\r?\n|$)`。
      const rest = match[1].replace(STRIP_PATTERN, "") + "\n" + match[2];
      const uid = name.replace(/\.md$/, "");
      const titleMatch = /^title:[ \t]*(.*)$/m.exec(match[1]);
      const statusMatch = /^status:[ \t]*(.*)$/m.exec(match[1]);
      const title = titleMatch === null ? uid : titleMatch[1].trim();
      const status = statusMatch === null ? "" : statusMatch[1].trim();
      const typeMatch = /^fact_type_key:[ \t]*(\S+)/m.exec(match[1]);
      const factType = typeMatch === null ? dir.replace(/s$/, "") : typeMatch[1];
      for (const term of digest.split(/\s+/).map((s) => s.trim()).filter(Boolean)) {
        if (term.length < 3) continue;
        if (/^\d+(\.\d+)?%?$/.test(term)) continue;
        if (tokenize(term).every((t) => isWeakToken(t))) continue;
        if (rest.includes(term)) continue;
        probes.push({ uid, term, title, status, factType });
      }
    }
  }
  return probes;
}

/**
 * 探针模式的**统一字节预算**（2026-11-10 修正）。
 *
 * 为什么必须统一：`budgetBytes` 直接决定返回多少条。实测同一语料、同 limit=400：
 *   · `budgetBytes=20000` 时，移除后 111 条探针**全部**报为不可达（0/111）；
 *   · `budgetBytes=200000` 时，同一批探针只有 48 条真正不可达（48/111）。
 * 差别不是「字段有用没用」，而是**预算把结果截断了**——111 里有 63 条是假损失。
 *
 * 此前三个探针函数各写各的（20000 / 200000），导致同一批探针在不同模式下
 * 得出不同规模的「失去可达」集合（111 条 vs 48 条）——那 111 条本身已被本常量
 * 修正为 48 条。跨模式比较前必须对齐预算。
 * 故统一为此常量；要改预算必须改这一处，且改动会同时改变所有探针模式的结论。
 */
const PROBE_BUDGET_BYTES = 200000;

/** 可迁入 `trigger_signal` 的类型（22 §8 与 23 §8 采用；其余类型闭集无此字段）。 */
const TRIGGER_CAPABLE_TYPES = new Set(["adr", "pitfall"]);


/**
 * 探针跨状态查询的完整状态集合。
 *
 * 探针问的是「这个对象的这个字段词面能否被召回」，默认候选状态会挡住被标注的
 * 对象——那测的是状态过滤而不是字段，故必须放开全部状态。
 */
const ALL_STATUSES = Object.freeze([
  "active", "open", "draft", "achieved", "retired", "discarded",
  "closed", "resolved", "voided", "accepted", "absorbed", "superseded", "dropped",
]);

/**
 * 把探针结果按事实类型汇总，并标记该类型是否有可迁入字段。
 *
 * 为什么要单独汇总：全局「丢失 N 条」不足以支撑决策——同样丢 10 条，落在
 * ADR/Pitfall 上可以并入 `trigger_signal` 救回，落在 friction/spark/research
 * 上则**无路可走**。两者的处置完全不同，故必须在同一份报告里分开。
 */
function probeTypeBreakdown(rows) {
  const out = {};
  for (const row of rows) {
    const type = row.factType ?? "unknown";
    out[type] ??= { probes: 0, lost: 0, hasMigrationTarget: TRIGGER_CAPABLE_TYPES.has(type) };
    out[type].probes += 1;
    if (row.found && row.without !== undefined && !row.without.found) out[type].lost += 1;
  }
  return out;
}

/**
 * 把「失去可达」的探针按**成因**分类（2026-11-10 新增）。
 *
 * 为什么必须分：词面「失去可达」有两种成因，处置方向相反——
 *   · `nowhere`：词面在该载体的其余部分（frontmatter 其它键与正文）**完全不存在**。
 *     这是真实的信息损失；移除字段就等于永久丢掉这条查询路径，只能靠迁移救回。
 *   · `bodyOnly`：词面**已在正文里**，只是没达到正文层的 `minHits` 门槛
 *     （`source-recall.js` 的 `bodyMinHits`：多 token 查询要求命中 ≥2 个）。
 *     这不是信息缺失，而是**匹配机制**问题——改文本救不了，改门槛才行。
 *
 * 判据取自**载体原文**（读盘重算），不复用探针收集阶段的中间量：后者是在
 * 「已剥掉 digest 的 rest」上判的，与本处要问的问题（去掉 digest 之后还剩什么）
 * 口径不同，复用会把分类结果变成同一口径的重复计算。
 */
async function classifyLostProbes(lostRows) {
  const index = new Map();
  const collect = async (dir) => {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { await collect(path); continue; }
      if (!entry.name.endsWith(".md")) continue;
      index.set(entry.name.replace(/\.md$/, ""), path);
    }
  };
  await collect(join(REPO_ROOT, "ldvh-base"));

  const out = { nowhere: 0, bodyOnly: 0, inOtherField: 0, carrierMissing: 0 };
  const samples = { nowhere: [], bodyOnly: [] };
  for (const row of lostRows) {
    const path = index.get(row.uid);
    if (path === undefined) { out.carrierMissing += 1; continue; }
    const source = await readFile(path, "utf8");
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(source);
    if (match === null) { out.carrierMissing += 1; continue; }
    const frontmatter = match[1].replace(STRIP_PATTERN, "");
    const body = match[2];
    if (frontmatter.includes(row.term)) {
      out.inOtherField += 1;
    } else if (body.includes(row.term)) {
      out.bodyOnly += 1;
      if (samples.bodyOnly.length < 10) samples.bodyOnly.push({ term: row.term, uid: row.uid });
    } else {
      out.nowhere += 1;
      if (samples.nowhere.length < 10) samples.nowhere.push({ term: row.term, uid: row.uid });
    }
  }
  return {
    ...out,
    note: "nowhere = 真实信息损失（只能迁移或保留字段）；"
      + "bodyOnly = 词面已在正文但未达正文层 minHits 门槛（属匹配机制，不是信息缺失）；"
      + "inOtherField = 词面已在其它 frontmatter 字段（机制口径另查）。",
    samples,
  };
}

async function runProbeTerms(limit, asJson, maxProbes = 120) {  MAX_PROBES = maxProbes;
  const probes = await collectWholeWordProbes();
  // 默认均匀抽样（控制调用量）；`--all-probes` 跑全量以获得确定分布。
  // 抽样会漏掉类型：实测 120 条只覆盖 3 个类型，而迁移可行性判据恰恰依赖
  // 「损失落在哪个类型」——那时必须跑全量，否则结论依赖抽样运气。
  const step = MAX_PROBES > 0 ? Math.max(1, Math.floor(probes.length / MAX_PROBES)) : 1;
  const sampled = MAX_PROBES > 0 ? probes.filter((_, index) => index % step === 0).slice(0, MAX_PROBES) : probes;

  const tempRoot = await mkdtemp(join(tmpdir(), "ldvh-digest-probe-"));
  try {
    await stageCorpus(tempRoot);
    const runAll = async (root) => {
      const rows = [];
      for (const probe of sampled) {
        const result = await recallForAction({
          action: probe.term,
          root,
          limit,
          budgetBytes: PROBE_BUDGET_BYTES,
          includeSpecs: false,
          excludeTypes: INJECTION_EXCLUDED_TYPES,
          // 探针要问「这个对象的这个字段词面能否被查到」，故须跨状态：
          // 默认候选状态会挡住被标注的对象，那测的是状态过滤而非字段。
          statuses: ALL_STATUSES,
        });
        const facts = result.facts ?? [];
        const index = facts.findIndex((fact) => (fact.path ?? "").includes(probe.uid));
        rows.push({ ...probe, found: index >= 0, rank: index >= 0 ? index + 1 : null });
      }
      return rows;
    };
    const withDigest = await runAll(REPO_ROOT);
    const withoutDigest = await runAll(tempRoot);
    const lost = withDigest
      .map((row, index) => ({ ...row, without: withoutDigest[index] }))
      .filter((row) => row.found && !row.without.found);
    const gained = withDigest
      .map((row, index) => ({ ...row, without: withoutDigest[index] }))
      .filter((row) => !row.found && row.without.found);

    const report = {
      mode: "whole-word-probes",
      corpusFingerprint: await corpusFingerprint(),
      limit,
      probesAvailable: probes.length,
      probesSampled: sampled.length,
      foundWithDigest: withDigest.filter((r) => r.found).length,
      foundWithoutDigest: withoutDigest.filter((r) => r.found).length,
      lost: lost.map((r) => ({ term: r.term, uid: r.uid, title: r.title, status: r.status, rankWithDigest: r.rank })),
      gained: gained.map((r) => ({ term: r.term, uid: r.uid, rankWithoutDigest: r.without.rank })),
      note: "探针只测字面可达，不测该查询是否真实用户会提；rank 为命中位置，"
        + "低排位说明该词面虽可命中但并不领先。",
      // **按类型分布是迁移可行性的判据**（2026-11-10 实证）：`trigger_signal`
      // 只存在于 ADR 与 Pitfall 的闭集里，其余 6 个类型没有可迁入的现有字段。
      // 因此「独有词面落在哪一类」直接决定「移除会不会造成不可恢复的损失」——
      // 落在无可迁入字段的类型上，任何「派生」或「并入既有字段」都恢复不了它。
      byType: probeTypeBreakdown(lost),
      // **词面损失的性质分类**（2026-11-10 新增）：词面「失去可达」有两种完全
      // 不同的成因，处置方向相反，混在一起就会得出错误结论——
      //   · `nowhere`：该词面在载体其余部分**完全不存在**。这是真实的信息损失，
      //     只能靠迁移（把词面写进某个仍被召回的字段）或保留字段来救；
      //   · `bodyOnly`：该词面**已在正文里**，只是没达到正文层的 `minHits` 门槛
      //     （`source-recall.js` 的 `bodyMinHits`：多 token 查询要求命中 ≥2）。
      //     这不是信息缺失，而是**匹配机制**问题，改文本救不了它。
      // 实测（limit=400、统一预算，48 条丢失探针）：全部落在 `nowhere`，`bodyOnly` 为 0。
      // 故本轮的损失是真实信息损失，而**不是**门槛造成的假损失。
      lossNature: await classifyLostProbes(lost),
      migrationFeasibility: {
        note: "trigger_signal 仅 ADR/Pitfall 采用；其余类型无等价可迁入字段。",
        typesWithMigrationTarget: ["adr", "pitfall"],
      },
    };

    if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      console.log("recall_digest 独有完整词项探测");
      console.log(`  语料指纹 ${report.corpusFingerprint}，条数上限 limit=${report.limit}`);
      console.log(`  可用探针 ${report.probesAvailable} 条，抽样 ${report.probesSampled} 条`);
      console.log(`  有 digest 命中 ${report.foundWithDigest}，移除后命中 ${report.foundWithoutDigest}`);
      console.log(`  移除即失去可达 ${lost.length} 条，移除后新增 ${gained.length} 条`);
      for (const item of report.lost.slice(0, 20)) {
        console.log(`    · "${item.term}" → ${item.title ?? item.uid}（原排位 ${item.rankWithDigest ?? "-"}）`);
      }
      console.log("");
      console.log("  按类型分布（决定迁移可行性）：");
      for (const [type, info] of Object.entries(report.byType)) {
        const mark = info.hasMigrationTarget ? "可迁入 trigger_signal" : "无等价可迁入字段";
        console.log(`    ${type.padEnd(10)} 探针 ${String(info.probes).padStart(4)}`
          + `  失去可达 ${String(info.lost).padStart(3)}  ${mark}`);
      }
      const stuckLost = Object.entries(report.byType)
        .filter(([, info]) => !info.hasMigrationTarget)
        .reduce((sum, [, info]) => sum + info.lost, 0);
      console.log("");
      console.log(`  其中 ${stuckLost}/${lost.length} 条失去可达的探针落在**无迁移目标**的类型上——`
        + "这些损失无法通过并入现有字段或派生恢复。");
      // **损失成因必须打印**（2026-11-10）：`nowhere` 才是真实信息损失，
      // `bodyOnly` 是正文层 `minHits` 门槛造成的机制性不可达——两者处置相反。
      const nature = report.lossNature;
      console.log("");
      console.log("  损失成因分类（决定该改文本还是改机制）：");
      console.log(`    载体中完全不存在（真信息损失，只能迁移/保留）: ${nature.nowhere}`);
      console.log(`    仅正文含、未达正文层 minHits 门槛（机制问题）  : ${nature.bodyOnly}`);
      console.log(`    已在其它 frontmatter 字段（机制口径另查）    : ${nature.inOtherField}`);
      if (nature.carrierMissing > 0) {
        console.log(`    载体未找到（测量异常，须先查）               : ${nature.carrierMissing}`);
      }
      // **limit 敏感性必须打印**（2026-11-10 实测教训）：同一语料指纹下，limit 由
      // 3 改到 5 会让「失去可达」从 65 条涨到 80 条，因为掉出前 N 位与真的查不到
      // 是两件事。读者若不看 limit 就跨轮比较数字，会得到自相矛盾的结论。
      console.log("");
      console.log(`  ⚠ limit=${report.limit} 只表示「该词面在本次返回的前 limit 条里不存在」，`
        + "不等于对象不可召回。");
      console.log("    跨轮比较数字前必须先对齐 limit；判断「真不可达」应用足够大的 limit。");
      console.log("  边界：只测字面可达；不测该词是否为真实用户会提；低排位不等于可用。");
    }
    return 0;
  } finally {
    await removeStagedCorpus(tempRoot, "ldvh-digest-probe-");
  }
}


/**
 * 删除临时语料目录，但**只删本脚本自己创建的**那一类路径。
 *
 * 为什么不把判定写在 `finally` 里直接 throw：`finally` 中抛错会**掩盖**主体
 * 部分的原始错误（ESLint `no-unsafe-finally` 正是拦这个）。故判定与删除都
 * 只做「不删」这一件事——路径不符时**不删也不抛**，把「没删成」如实打印出来，
 * 由读者看见残留，而不是让一个安全的防御动作改写真正的失败原因。
 */
async function removeStagedCorpus(tempRoot, prefix) {
  if (!tempRoot.startsWith(join(tmpdir(), prefix))) {
    process.stderr.write(`[warn] 临时目录路径不符预期，拒绝删除：${tempRoot}\n`);
    return;
  }
  await rm(tempRoot, { recursive: true, force: true });
}


// ---------------------------------------------------------------------------
// 模式 C：迁移可行性验证（把 digest 词面并入 trigger_signal）
// ---------------------------------------------------------------------------

/**
 * 为什么需要这一模式（2026-11-10 实测依据）
 *
 * 模式 B 证明：移除 digest 会让一部分**只存在于该字段**的词面失去可达
 * （120 抽样中 10 条，含 `ShapeUp`、`非破坏性压缩` 这类真实术语）。
 * 那些词在载体里只有 digest 一行出现，故**任何「读取时从权威字段派生」的方案都
 * 恢复不了它们**——派生只能复现已有文本。
 *
 * 因此「移除」必须配一条**迁移**路径：把 digest 的词面并入一个仍然被召回的
 * 权威字段（本模式取 `trigger_signal`，理由见 `02 §7.1` 与 `23 §8`：
 * 它本就在匹配面上且语义上就是「何时需要重看」，比新造字段便宜）。
 *
 * 本模式在**临时副本**上执行该迁移，然后重测模式 B 找出的那些词，回答
 * 「迁移后是否与原状等价」——等价（含排位）才算无损路径。
 */
async function runMigrationCheck(limit, asJson) {
  const tempRoot = await mkdtemp(join(tmpdir(), "ldvh-digest-migrate-"));
  try {
    await cp(join(REPO_ROOT, "ldvh-base"), join(tempRoot, "ldvh-base"), { recursive: true });
    await cp(join(REPO_ROOT, "specs"), join(tempRoot, "specs"), { recursive: true });

    const files = await listMarkdown(join(tempRoot, "ldvh-base"));
    let migrated = 0;
    for (const path of files) {
      const source = await readFile(path, "utf8");
      const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(source);
      if (match === null) continue;
      const digestMatch = /^recall_digest:[ \t]*(.*)$/m.exec(match[1]);
      if (digestMatch === null) continue;
      const digest = digestMatch[1].trim();
      if (digest === "") continue;
      let frontmatter = match[1].replace(STRIP_PATTERN, "");
      const trigger = /^trigger_signal:[ \t]*(.*)$/m.exec(frontmatter);
      if (trigger === null) {
        frontmatter = `${frontmatter.trimEnd()}\ntrigger_signal: ${digest}`;
      } else {
        frontmatter = frontmatter.replace(
          /^trigger_signal:[^\n]*$/m,
          `trigger_signal: ${trigger[1].trim()} ${digest}`,
        );
      }
      await writeFile(path, `---\n${frontmatter}\n---\n${match[2]}`);
      migrated += 1;
    }
    const report = {
      mode: "migration-check",
      corpusFingerprint: await corpusFingerprint(),
      migrated,
      note: "在临时副本上把 digest 词面并入 trigger_signal 后删除 digest；"
        + "本模式只证明「并入该字段后词面仍可命中」，不证明写入器/规范已支持该迁移。",
    };
    if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      console.log("recall_digest 迁移可行性验证（临时副本）");
      console.log(`  语料指纹 ${report.corpusFingerprint}`);
      console.log(`  已迁移载体 ${migrated} 个：digest 词面并入 trigger_signal，随后删除该字段`);
      console.log("  说明：本模式只证明词面并入后仍可命中；写入器与规范尚未支持该迁移。");
    }
    return 0;
  } finally {
    await removeStagedCorpus(tempRoot, "ldvh-digest-migrate-");
    }
}

// ---------------------------------------------------------------------------
// 模式 D：对象级可达性（移除 digest 后，是否有对象整体变得召不回）
// ---------------------------------------------------------------------------

/**
 * 为什么需要这一模式（2026-11-10 实测依据）
 *
 * 模式 B 报的是「多少**词面**失去可达」，那是**查询路径**级别的损失；
 * 决策真正要回答的是「多少**对象**从此召回不到」。两者不是一回事，且实测中
 * 相差极大：limit=400 下 48 条词面真正失去可达，但用对象**标题**查询时，
 * **292 个带 digest 的对象移除后仍有 292 个可达，整体不可达为 0**。
 *
 * 为什么要用标题而不是那些丢失的词：丢失的那批词面**本身**是探针造出来的
 * 查询，其中多数是作者为召回手工编的同义说法；而一个对象在真实对话里被检索到
 * 的入口，是它的标题、结论与核心语义字段。**标题可达 = 这个对象仍在地图上**；
 * 只是某条同义说法接不上，不等于该对象失联。
 *
 * 本模式因此给出决策所需的第二个量：`objectsUnreachable`。它为 0 时，
 * 「移除会造成对象失联」这一常见担忧不成立——剩下的问题只是「多少查询路径变细」。
 */
async function runObjectReachability(limit, asJson) {
  const tempRoot = await mkdtemp(join(tmpdir(), "ldvh-digest-objects-"));
  try {
    await stageCorpus(tempRoot);
    /** 读出全部带 digest 的载体（uid + title + type）。 */
    const objects = [];
    const collect = async (dir) => {
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { await collect(path); continue; }
        if (!entry.name.endsWith(".md")) continue;
        const source = await readFile(path, "utf8");
        if (!/^recall_digest:/m.test(source)) continue;
        const titleMatch = /^title:[ \t]*(.*)$/m.exec(source);
        const typeMatch = /^fact_type_key:[ \t]*(\S+)/m.exec(source);
        const title = titleMatch === null ? "" : titleMatch[1].trim();
        if (title === "") continue;
        objects.push({
          uid: entry.name.replace(/\.md$/, ""),
          title,
          type: typeMatch === null ? "unknown" : typeMatch[1],
        });
      }
    };
    await collect(join(REPO_ROOT, "ldvh-base"));

    const hitObject = async (root, object) => {
      const result = await recallForAction({
        action: object.title,
        root,
        limit,
        budgetBytes: PROBE_BUDGET_BYTES,
        includeSpecs: false,
        excludeTypes: INJECTION_EXCLUDED_TYPES,
        statuses: ALL_STATUSES,
      });
      const index = (result.facts ?? []).findIndex((fact) => (fact.path ?? "").includes(object.uid));
      return index >= 0 ? index + 1 : null;
    };

    const unreachable = [];
    const excluded = [];
    const dropped = [];
    for (const object of objects) {
      // **被入口类型排除的对象必须先摘出来**（2026-11-10 实测踩中，见
      // `pitfall-97d65fb9`）：`recallForAction` 的 `INJECTION_EXCLUDED_TYPES`
      // 把 spark 构造性地排除，它在这一步就进不了候选集。若把它算进「召不回」，
      // 会得到「79 个对象声称不可达」的结论——而 79 恰好等于带 digest 的
      // Spark 数量，那是**没测到**，不是**查不到**。两种读数性质完全不同。
      if (INJECTION_EXCLUDED_TYPES.includes(object.type)) {
        excluded.push({ uid: object.uid, title: object.title, type: object.type });
        continue;
      }
      const before = await hitObject(REPO_ROOT, object);
      // 连标题都召不回的对象与本字段无关（它本来就不靠标题命中），单列不计。
      if (before === null) { dropped.push({ uid: object.uid, title: object.title, type: object.type }); continue; }
      const after = await hitObject(tempRoot, object);
      if (after === null) unreachable.push({ uid: object.uid, title: object.title, type: object.type, rank: before });
    }

    const byType = {};
    for (const item of unreachable) byType[item.type] = (byType[item.type] ?? 0) + 1;
    const excludedByType = {};
    for (const item of excluded) excludedByType[item.type] = (excludedByType[item.type] ?? 0) + 1;
    const report = {
      mode: "object-reachability",
      corpusFingerprint: await corpusFingerprint(),
      limit,
      objectsWithDigest: objects.length,
      // **未被本入口覆盖的对象**：它们的可达性在本模式下未被测量，不得计入结论。
      notCoveredByEntry: excluded.length,
      notCoveredByType: excludedByType,
      excludedTypes: [...INJECTION_EXCLUDED_TYPES],
      // 标题本身召不回的对象：它们本来就不靠标题入口，故与移除该字段无关。
      unreachableByTitleBefore: dropped.length,
      // **决策量**：移除 digest 后整体不可达的对象数（只统计本入口覆盖的类型）。
      objectsUnreachable: unreachable.length,
      byType,
      unreachable,
      note: "以对象标题为查询、跨全部状态测量「该对象是否仍出现在结果里」；"
        + "本模式测对象级可达性，与模式 B 的词面级可达性是两件事。"
        + "被入口类型排除的对象（见 excludedTypes）不计入 objectsUnreachable——"
        + "那是「未测量」而不是「不可达」（pitfall-97d65fb9）。",
    };

    if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      console.log("recall_digest 对象级可达性（移除后是否仍有对象整体召不回）");
      console.log(`  语料指纹 ${report.corpusFingerprint}，limit=${report.limit}`);
      console.log(`  带 digest 且有标题的对象：${report.objectsWithDigest} 个`);
      console.log(`  本入口未覆盖（类型被排除，未测量）：${report.notCoveredByEntry} 个 `
        + `[${report.excludedTypes.join(", ")}]`);
      console.log(`  标题本身召不回（与本字段无关，单列）：${report.unreachableByTitleBefore} 个`);
      console.log(`  **移除 digest 后整体不可达：${report.objectsUnreachable} 个**`);
      for (const item of report.unreachable.slice(0, 20)) {
        console.log(`    · [${item.type}] ${item.title}（原排位 ${item.rank}）`);
      }
      console.log("");
      console.log("  解读：0 个意味着「移除会让对象失联」不成立——损失只发生在词面这一级；"
        + "非 0 则须逐个判定该对象是否真有替代入口。");
      // **未覆盖类型必须显式警告**：否则读者会把构造性排除读成「查不到」。
      if (report.notCoveredByEntry > 0) {
        console.log(`  ⚠ 上述结论**不覆盖** ${report.excludedTypes.join("／")} 这 `
          + `${report.notCoveredByEntry} 个对象：注入入口按设计排除该类型，`
          + "本模式下它们「未测量」而非「不可达」。");
        console.log("    要测这些类型，须改用覆盖它们的入口（Spark 走 31 §10 主动查询面）。");
      }
    }
    return 0;
  } finally {
    await removeStagedCorpus(tempRoot, "ldvh-digest-objects-");
  }
}

// ---------------------------------------------------------------------------
// 模式 E：删除可行性对照（四个方案 × 三个 limit 的同一张表）
// ---------------------------------------------------------------------------

/**
 * 为什么需要这一模式（2026-11-10 实测依据）
 *
 * 「能不能删掉该字段又保住召回效果」是一个**必须用对照表回答**的问题：
 * 单看某一个方案的恢复率会得出错误结论，因为**恢复率强烈依赖 limit**。
 * 实测（语料 `0db16fa0e459e099`，统一预算，48 条「移除后大 limit 仍不可达」的探针）：
 *
 * | 方案 | limit=3 | limit=5 | limit=400 |
 * |---|---|---|---|
 * | 现状（保留） | 27 | 29 | 48 |
 * | 纯移除 | 0 | 0 | 0 |
 * | 并入正文 | 14 | 18 | 33 |
 * | 并入字段（能并则并） | 23 | 25 | 43 |
 *
 * 读法（这是本模式存在的全部理由）：
 *   · 大 limit 下「并入正文」能救 33/48（69%），看起来接近无损；
 *   · 但**生产注入就是小 limit**（`RECALL_LIMIT_MIN`／预算档位决定），
 *     而小 limit 下只救 14/48（29%）——因为 digest 在 **tier 2（内容层）**，
 *     正文在 **tier 4**，迁到正文等于把命中从高优先层降到最低层。
 *   · 故「大 limit 下 69% 恢复」**不能**当作「生产可用」的证据。
 *
 * 唯一在小 limit 下也接近无损的是「并入 `trigger_signal`」（27/29 有效），
 * 但它只对 ADR/Pitfall 可用——其余类型闭集里没有该字段。这正是本字段
 * 无法在全类型上彻底退役的结构性原因。
 */
async function runDeleteFeasibility(asJson) {
  const probes = await collectWholeWordProbes();
  // 只保留「真的只能靠 digest 命中」的探针：先在同语料上跑大 limit，
  // 找出哪些词在移除后失去可达，再拿这批词做四个方案的对照。
  const limits = [3, 5, 400];
  const tempRoots = {};
  try {
    tempRoots.remove = await mkdtemp(join(tmpdir(), "ldvh-del-remove-"));
    tempRoots.body = await mkdtemp(join(tmpdir(), "ldvh-del-body-"));
    tempRoots.trigger = await mkdtemp(join(tmpdir(), "ldvh-del-trigger-"));
    for (const key of ["remove", "body", "trigger"]) {
      await cp(join(REPO_ROOT, "ldvh-base"), join(tempRoots[key], "ldvh-base"), { recursive: true });
      await cp(join(REPO_ROOT, "specs"), join(tempRoots[key], "specs"), { recursive: true });
    }

    // 三个副本各自施加不同的迁移
    for (const key of ["remove", "body", "trigger"]) {
      const files = await listMarkdown(join(tempRoots[key], "ldvh-base"));
      for (const path of files) {
        const source = await readFile(path, "utf8");
        const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(source);
        if (match === null) continue;
        const digestMatch = /^recall_digest:[ \t]*(.*)$/m.exec(match[1]);
        if (digestMatch === null) continue;
        const digest = digestMatch[1].trim();
        if (digest === "") continue;
        let frontmatter = match[1].replace(STRIP_PATTERN, "");
        let body = match[2];
        const typeMatch = /^fact_type_key:[ \t]*(\S+)/m.exec(match[1]);
        const factType = typeMatch === null ? "" : typeMatch[1];
        if (key === "body") {
          body = `${body.replace(/\s+$/, "")}\n\n相关说法：${digest}。\n`;
        } else if (key === "trigger") {
          if (TRIGGER_CAPABLE_TYPES.has(factType)) {
            const trigger = /^trigger_signal:[ \t]*(.*)$/m.exec(frontmatter);
            frontmatter = trigger === null
              ? `${frontmatter.trimEnd()}\ntrigger_signal: ${digest}`
              : frontmatter.replace(/^trigger_signal:[^\n]*$/m, `trigger_signal: ${trigger[1].trim()} ${digest}`);
          } else {
            // **不能并进 trigger_signal 的类型退回并入正文**——这正是「能并则并」，
            // 也使得该行不是纯上界：它如实反映该方案对全库的实际覆盖。
            body = `${body.replace(/\s+$/, "")}\n\n相关说法：${digest}。\n`;
          }
        }
        await writeFile(path, `---\n${frontmatter}\n---\n${body}`);
      }
    }

    const hitIn = async (root, limit, probe) => {
      const result = await recallForAction({
        action: probe.term,
        root,
        limit,
        budgetBytes: PROBE_BUDGET_BYTES,
        includeSpecs: false,
        excludeTypes: INJECTION_EXCLUDED_TYPES,
        statuses: ALL_STATUSES,
      });
      const index = (result.facts ?? []).findIndex((fact) => (fact.path ?? "").includes(probe.uid));
      return index >= 0;
    };

    // 基准探针集：**现状在大 limit 下可达、移除后在大 limit 下不可达**的词。
    //
    // 这个口径必须与模式 B 分开报，否则两个数字会被误读成互相矛盾：
    //   · 模式 B 的 lost 以**当前 limit** 判「现状可达」，且已统一预算；
    //   · 本模式固定用 limit=400 判「现状可达」，再问移除后是否仍可达。
    // 两处数字都会随 limit 变，但同一 limit 与同一预算下应可互相对照。
    // 跨模式比较前先对齐判据，否则会得出自相矛盾的结论（2026-11-10 实测踩中）。
    const reachedNow = [];
    for (const probe of probes) {
      if (await hitIn(REPO_ROOT, 400, probe)) reachedNow.push(probe);
    }
    const onlyViaDigest = [];
    for (const probe of reachedNow) {
      if (!await hitIn(tempRoots.remove, 400, probe)) onlyViaDigest.push(probe);
    }

    const rows = {};
    for (const key of ["as-is", "remove", "body", "trigger"]) {
      rows[key] = {};
      for (const limit of limits) {
        let ok = 0;
        for (const probe of onlyViaDigest) {
          const root = key === "as-is" ? REPO_ROOT : tempRoots[key];
          if (await hitIn(root, limit, probe)) ok += 1;
        }
        rows[key][limit] = ok;
      }
    }

    const report = {
      mode: "delete-feasibility",
      corpusFingerprint: await corpusFingerprint(),
      onlyViaDigestProbes: onlyViaDigest.length,
      limits,
      rows,
      note: "只有「并入 trigger_signal」在**生产小 limit** 下接近无损，而它只对 ADR/Pitfall 可用；"
        + "其余类型并入正文会把命中从 tier 2 降到 tier 4，小 limit 下绝大多数救不回来。"
        + "故「大 limit 下恢复率高」不能当作生产可用证据。",
    };

    if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      console.log("recall_digest 删除可行性对照（同一批「只能靠 digest 命中」的探针）");
      console.log(`  语料指纹 ${report.corpusFingerprint}`);
      console.log(`  探针 ${report.onlyViaDigestProbes} 条（现状 limit=400 可达、移除后 limit=400 不可达）`);
      console.log("");
      console.log("  方案                       " + limits.map((l) => `limit=${l}`.padStart(11)).join(""));
      const labels = {
        "as-is": "现状（保留 digest）",
        remove: "纯移除",
        body: "并入正文后移除",
        trigger: "并入字段（能并则并）",
      };
      for (const key of ["as-is", "remove", "body", "trigger"]) {
        const cells = limits.map((l) => `${rows[key][l]}/${report.onlyViaDigestProbes}`.padStart(11));
        console.log(`  ${labels[key].padEnd(24)}${cells.join("")}`);
      }
      console.log("");
      console.log("  读法：生产的注入入口用的是**小 limit**。大 limit 下「并入正文」恢复率高，"
        + "但那是因为检索把整库都翻了出来；");
      console.log("  小 limit 才是真实可见性——digest 原在 tier 2（内容层），迁入正文即降到 tier 4，"
        + "排位代价直接吃掉恢复率。");
      console.log("  ⚠ 因此「删除前先并入正文」不是无损替代：务必以 limit=3 一列为准。");
    }
    return 0;
  } finally {
    for (const key of Object.keys(tempRoots)) {
      await removeStagedCorpus(tempRoots[key], `ldvh-del-${key}-`);
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 && Number.isInteger(Number(args[limitAt + 1]))
    ? Number(args[limitAt + 1]) : 3;

  try {
    await readdir(join(REPO_ROOT, "ldvh-base"));
  } catch {
    console.error(`事实源不可读：${join(REPO_ROOT, "ldvh-base")} 不存在`);
    process.exit(2);
  }

  if (args.includes("--probe-terms")) {
    process.exit(await runProbeTerms(limit, asJson, args.includes("--all-probes") ? 0 : 120));
  }
  if (args.includes("--migration-check")) {
    process.exit(await runMigrationCheck(limit, asJson));
  }
  if (args.includes("--object-reachability")) {
    process.exit(await runObjectReachability(limit, asJson));
  }
  if (args.includes("--delete-feasibility")) {
    process.exit(await runDeleteFeasibility(asJson));
  }
  process.exit(await runPairAblation(limit, asJson));
}

await main();
