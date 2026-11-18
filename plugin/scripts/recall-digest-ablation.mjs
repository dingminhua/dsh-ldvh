#!/usr/bin/env node

import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { recallForAction, INJECTION_EXCLUDED_TYPES, tokenize, isWeakToken } from "../lib/source-recall.js";
import { QUALITY_CASES, isRelated } from "../test/recall-quality-cases.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

let MAX_PROBES = 120;

const STRIP_PATTERN = /^recall_digest:[^\n]*(?:[ \t]*\r?\n|$)/gm;
const FACT_DIRS = Object.freeze([
  "devlogs", "frictions", "norms", "pitfalls", "researches", "sparks", "subgoals",
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

async function stageCorpus(tempRoot) {
  await cp(join(REPO_ROOT, "ldvh-base"), join(tempRoot, "ldvh-base"), { recursive: true });
  await cp(join(REPO_ROOT, "specs"), join(tempRoot, "specs"), { recursive: true });
  const files = await listMarkdown(join(tempRoot, "ldvh-base"));
  let stripped = 0;
  for (const path of files) {
    const source = await readFile(path, "utf8");
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

async function evaluate(root, limit) {
  const rows = [];
  for (const testCase of QUALITY_CASES) {
    const result = await recallForAction({
      action: testCase.q,
      root,
      limit,
      budgetBytes: 10240,
      includeSpecs: true,
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

const PROBE_BUDGET_BYTES = 200000;

const TRIGGER_CAPABLE_TYPES = new Set(["pitfall"]);


const ALL_STATUSES = Object.freeze([
  "active", "open", "draft", "achieved", "retired", "discarded",
  "closed", "resolved", "voided", "accepted", "absorbed", "superseded", "dropped",
]);

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
      byType: probeTypeBreakdown(lost),
      lossNature: await classifyLostProbes(lost),
      migrationFeasibility: {
        note: "trigger_signal 仅 Pitfall 采用；其余类型无等价可迁入字段。",
        typesWithMigrationTarget: ["pitfall"],
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
      const nature = report.lossNature;
      console.log("");
      console.log("  损失成因分类（决定该改文本还是改机制）：");
      console.log(`    载体中完全不存在（真信息损失，只能迁移/保留）: ${nature.nowhere}`);
      console.log(`    仅正文含、未达正文层 minHits 门槛（机制问题）  : ${nature.bodyOnly}`);
      console.log(`    已在其它 frontmatter 字段（机制口径另查）    : ${nature.inOtherField}`);
      if (nature.carrierMissing > 0) {
        console.log(`    载体未找到（测量异常，须先查）               : ${nature.carrierMissing}`);
      }
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


async function removeStagedCorpus(tempRoot, prefix) {
  if (!tempRoot.startsWith(join(tmpdir(), prefix))) {
    process.stderr.write(`[warn] 临时目录路径不符预期，拒绝删除：${tempRoot}\n`);
    return;
  }
  await rm(tempRoot, { recursive: true, force: true });
}



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


async function runObjectReachability(limit, asJson) {
  const tempRoot = await mkdtemp(join(tmpdir(), "ldvh-digest-objects-"));
  try {
    await stageCorpus(tempRoot);
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
      if (INJECTION_EXCLUDED_TYPES.includes(object.type)) {
        excluded.push({ uid: object.uid, title: object.title, type: object.type });
        continue;
      }
      const before = await hitObject(REPO_ROOT, object);
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
      notCoveredByEntry: excluded.length,
      notCoveredByType: excludedByType,
      excludedTypes: [...INJECTION_EXCLUDED_TYPES],
      unreachableByTitleBefore: dropped.length,
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


async function runDeleteFeasibility(asJson) {
  const probes = await collectWholeWordProbes();
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
      note: "只有「并入 trigger_signal」在**生产小 limit** 下接近无损，而它只对 Pitfall 可用；"
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
