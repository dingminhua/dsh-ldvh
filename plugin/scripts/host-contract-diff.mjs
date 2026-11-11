#!/usr/bin/env node
// 宿主契约差分器 — Norm `host-upgrade-followup`（norm-e188af99）第 3–4 步的机械通道。
//
// 用法：
//   node scripts/host-contract-diff.mjs <基线tag> <目标tag> [--json] [--repo <上游克隆路径>]
//
// tag 可写 `dsh-v0.2.2-rc.1` 或裸 `0.2.2-rc.1`（自动补 `dsh-v` 前缀）。
//
// 三通道取数（全部来自上游仓内已提交、带 CI 新鲜度门禁的生成物）：
//   A. api-catalog.ts   → SERVICE_API / EVENT_API / TYPE_API 三表逐条差分
//   B. slot-catalog.ts  → CLIENT_SLOT_API 槽位表逐条差分
//   C. docs/upgrade-guide/ → 区间 (基线,目标] 新增指南清单（官方破坏性变更自述）
//
// 三态初值（对照 lib/host-consumption.json 消费面清单，机械函数）：
//   破坏   — 消费面内条目被删除、改名，或其差分指纹变化
//   须审   — 命中的 upgrade-guide 强匹配消费面 token；或 TYPE_API 变更出现在
//            消费面服务的签名文本里；或消费面条目的弱信号变化（如仅注释面）
//   无关   — 其余（含一切纯新增与非消费面变更）
//
// fail-closed：上游克隆缺失、tag 不存在、catalog 解析失败（畸形/不平衡/缺 id
// 字段）一律报「不可判定」并以非零码退出——**不得降级为「零变更」**
// （Norm 第 3 步）。三态是初值不是结论：最终归类由 AI 读 guide 后提请、
// Human 落定；本脚本不构成任何授权。
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_PATHS, API_ARRAYS, SLOT_ARRAY, FIELD_LAYERS,
  parseCatalogArray, parseEntryFields, extractArrayBody, splitTopLevelEntries, readEntryId,
} from "../lib/host-contract-catalog.js";
import { tagVersion, inInterval, compareVersions } from "../lib/host-version.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, "..");
const DEFAULT_REPO = process.env.LDVH_UPSTREAM_REPO ?? "/Users/dmh2002/DshProject/deepseek-harness";

/** 判据失败即整体不可判定（fail-closed），不产部分报告。 */
class Undecidable extends Error {}

function parseArgs(argv) {
  const args = { json: false, repo: DEFAULT_REPO, tags: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--repo") { args.repo = argv[++i]; if (!args.repo) throw new Undecidable("--repo 缺少路径参数"); }
    else if (a.startsWith("--")) throw new Undecidable(`未知参数 ${a}`);
    else args.tags.push(a);
  }
  if (args.tags.length !== 2) throw new Undecidable("需要恰好两个 tag：<基线tag> <目标tag>");
  return args;
}

/** 裸版本号补 dsh-v 前缀；已带前缀或自定义 ref 原样保留。 */
export function normalizeTag(tag) {
  return /^\d+\.\d+\.\d+/.test(tag) ? `dsh-v${tag}` : tag;
}

function git(repo, args) {
  try {
    return execFileSync("git", args, { cwd: repo, maxBuffer: 512 * 1024 * 1024, encoding: "utf8" });
  } catch (e) {
    throw new Undecidable(`git ${args.join(" ")} 失败：${String(e.stderr ?? e.message).slice(0, 300)}`);
  }
}

/**
 * 一条共有条目的字段级变更：返回 {contractFields:[...], noiseFields:[...]}。
 * 字段分层（契约 vs 噪音）定义在 lib/host-contract-catalog.js 的 FIELD_LAYERS，
 * 与解析器同居为单一来源；source 行号指针已归噪音，不再单独剥离。
 */
function fieldLevelChange(baseEntry, targetEntry, arrayName) {
  const layer = FIELD_LAYERS[arrayName];
  const fa = parseEntryFields(baseEntry);
  const fb = parseEntryFields(targetEntry);
  const contractFields = [];
  const noiseFields = [];
  const allFields = new Set([...fa.keys(), ...fb.keys()]);
  for (const f of allFields) {
    const va = (fa.get(f) ?? "").trim();
    const vb = (fb.get(f) ?? "").trim();
    if (va === vb) continue;
    if (layer.contract.includes(f)) contractFields.push(f);
    else noiseFields.push(f);
  }
  return { contractFields, noiseFields };
}

/**
 * 差分一张 catalog 表。返回：
 *   added/removed   — 增删条目 id
 *   contractChanged — 共有条目中**契约字段**变化的 id（携带变了哪些字段）
 *   noiseOnlyChanged— 共有条目中仅噪音字段变化的 id（不构成契约变更，单列）
 * consumed 为消费面清单 id 集合，供上层落三态。
 */
function diffTable(baseParsed, targetParsed, consumedIds, arrayName) {
  const baseSet = new Set(baseParsed.ids);
  const targetSet = new Set(targetParsed.ids);
  const added = targetParsed.ids.filter((id) => !baseSet.has(id));
  const removed = baseParsed.ids.filter((id) => !targetSet.has(id));
  const contractChanged = [];
  const noiseOnlyChanged = [];
  for (const id of baseParsed.ids) {
    if (!targetSet.has(id)) continue;
    const base = baseParsed.entries.get(id);
    const target = targetParsed.entries.get(id);
    const { contractFields, noiseFields } = fieldLevelChange(base, target, arrayName);
    if (contractFields.length > 0) contractChanged.push({ id, contractFields });
    else if (noiseFields.length > 0) noiseOnlyChanged.push({ id, noiseFields });
  }
  return { added, removed, contractChanged, noiseOnlyChanged, consumed: consumedIds };
}

/** 消费面 token → 三态影响。removed/contractChanged 命中消费面 = 破坏（初值）。 */
function classifyTableDiff(diff) {
  const consumed = new Set(diff.consumed);
  const breaking = {
    removed: diff.removed.filter((id) => consumed.has(id)),
    changed: diff.contractChanged.filter((c) => consumed.has(c.id)),
  };
  const review = {
    // 消费面条目仅噪音字段变化：不构成契约破坏，但列出供人工扫读（如 occupants 变化可能意味邻座重构）
    noiseOnConsumed: diff.noiseOnlyChanged.filter((c) => consumed.has(c.id)),
  };
  const neutral = {
    added: diff.added.length,
    removedUnconsumed: diff.removed.filter((id) => !consumed.has(id)),
    changedUnconsumed: diff.contractChanged.filter((c) => !consumed.has(c.id)),
    noiseUnconsumed: diff.noiseOnlyChanged.filter((c) => !consumed.has(c.id)).length,
  };
  return { breaking, review, neutral };
}

/**
 * 选「回填最完整」的读取参照：上游把 guide **事后回填**到最新 tree（实测
 * subagent-activations/guide.md 在 dsh-v0.2.1-alpha.1 tag 当时不存在，回填到
 * alpha.2+ 的 tree）。故枚举与读取 guide 一律用克隆内**最高版本 tag** 的 tree
 * ——它对区间 (base, target] 内每个版本目录都已回填完整；区间成员资格则按
 * **版本号**判定（inInterval），不靠 git diff 的「新增文件」（那读 targetTag
 * 当时 tree，会漏回填）。
 *
 * @returns {{ref:string, version:string}} 最高版本 tag 及其版本号
 */
function newestGuideRef(repo) {
  const raw = git(repo, ["tag", "--list", "dsh-v*"]);
  let best = null;
  for (const line of raw.split("\n")) {
    const tag = line.trim();
    if (tag === "") continue;
    let ver;
    try { ver = tagVersion(tag); } catch { continue; }
    if (best === null || compareVersions(ver, best.version) > 0) best = { ref: tag, version: ver };
  }
  if (best === null) throw new Undecidable("上游克隆无任何 dsh-v* tag——无法选定 guide 读取参照（先 git fetch --tags）");
  return best;
}

/**
 * 区间 (base, target] 的 upgrade-guide 枚举 + 消费面匹配。
 * 从最新 tag tree 列出全部 guide，按版本号筛区间，内容也从最新 tree 读（回填可见）。
 * 强匹配 = guide 目录名或 frontmatter description 含消费面 token（词边界）；
 * 弱匹配 = 仅正文含 token。强匹配 → 须审；弱匹配 → 参考（列出供 AI 阅读判断）。
 */
function diffUpgradeGuides(repo, baseVersion, targetVersion, tokens, readRef) {
  // 从最新 tree 列出全部 guide.md（一次 ls-tree，避免逐目录 spawn）
  const raw = git(repo, ["ls-tree", "-r", "--name-only", readRef, "--", CATALOG_PATHS.upgradeGuideRoot]);
  const byVersion = new Map();
  for (const line of raw.split("\n")) {
    const path = line.trim();
    if (path === "") continue;
    const m = /^docs\/upgrade-guide\/(v[^/]+)\/([^/]+)\/guide\.md$/.exec(path);
    if (m === null) continue;
    const version = tagVersion(m[1].replace(/^v/u, "")); // v0.2.1-alpha.1 → 0.2.1-alpha.1
    if (!inInterval(version, baseVersion, targetVersion)) continue;
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push({ version, item: m[2], path });
  }
  const results = [];
  let totalAdded = 0;
  for (const guides of byVersion.values()) {
    totalAdded += guides.length;
    for (const g of guides) {
      let text;
      try {
        text = git(repo, ["show", `${readRef}:${g.path}`]);
      } catch {
        continue; // 最新 tree 上也已删除的指南，不构成当前差异
      }
      // frontmatter description 有带引号与不带引号两种形态（上游两种都在用），都要取到
      const descMatch = /^description:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/mu.exec(text);
      const description = descMatch ? (descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? "") : "";
      const haystackStrong = `${g.version} ${g.item} ${description}`.toLowerCase();
      const haystackWeak = text.toLowerCase();
      const strong = [];
      const weak = [];
      for (const token of tokens) {
        const t = token.toLowerCase();
        // 单复数归一：上游行文常用单数（"Managed subagent activations"），
        // 清单 token 是服务键复数（subagents）——不做归一，已知破坏只落弱匹配。
        const variants = new Set([t]);
        if (t.endsWith("s")) variants.add(t.slice(0, -1));
        else variants.add(`${t}s`);
        const hit = (hay) => [...variants].some((v) => new RegExp(`(^|[^a-z0-9])${v.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}($|[^a-z0-9])`, "u").test(hay));
        if (hit(haystackStrong)) strong.push(token);
        else if (hit(haystackWeak)) weak.push(token);
      }
      if (strong.length > 0) results.push({ ...g, description, match: "strong", tokens: strong, weakTokens: weak });
      else if (weak.length > 0) results.push({ ...g, description, match: "weak", tokens: [], weakTokens: weak });
    }
  }
  results.sort((a, b) => (a.version === b.version ? (a.item < b.item ? -1 : 1) : compareVersions(a.version, b.version)));
  return { totalAdded, matched: results, readRef };
}

/**
 * TYPE_API 变更的定向交叉引用：变更/删除的类型名若出现在任一消费面服务的
 * 签名文本里 → 须审（消费面可能经类型间接破坏）。
 */
function crossRefTypes(targetApiSource, consumedServiceKeys, typeDiff) {
  const suspect = new Set([...typeDiff.removed, ...typeDiff.contractChanged.map((c) => c.id)]);
  if (suspect.size === 0) return [];
  const svcBody = extractArrayBody(targetApiSource, "SERVICE_API");
  const entries = splitTopLevelEntries(svcBody);
  const hits = [];
  for (const entry of entries) {
    const key = readEntryId(entry, "key");
    if (!consumedServiceKeys.has(key)) continue;
    for (const typeName of suspect) {
      const re = new RegExp(`(^|[^A-Za-z0-9_])${typeName}($|[^A-Za-z0-9_])`, "u");
      if (re.test(entry)) hits.push({ service: key, type: typeName });
    }
  }
  return hits;
}

export function runDiff({ repo, baseTag, targetTag, consumption }) {
  if (!existsSync(join(repo, ".git"))) throw new Undecidable(`上游克隆不存在或不是 Git 仓库：${repo}（先克隆或 --repo 指路；不得以记忆代替取数）`);
  for (const tag of [baseTag, targetTag]) {
    const found = git(repo, ["tag", "--list", tag]).trim();
    if (found !== tag) throw new Undecidable(`上游克隆无 tag ${tag}——先 git fetch --tags；不得以旧 tag 或记忆代替`);
  }
  const baseVersion = tagVersion(baseTag);
  const targetVersion = tagVersion(targetTag);
  if (compareVersions(baseVersion, targetVersion) >= 0) {
    throw new Undecidable(`基线 ${baseTag} 不低于目标 ${targetTag}——区间 (基线,目标] 为空，拒绝出「零变更」报告（方向写反或重复推进都属不可判定）`);
  }

  const show = (tag, path) => git(repo, ["show", `${tag}:${path}`]);

  const consumedServiceKeys = new Set(consumption.hostServices.map((s) => s.key));
  const consumedEventNames = new Set(consumption.hostEvents.map((e) => e.name));
  const consumedSlotKeys = new Set(consumption.clientSlots.map((s) => s.key));

  const tables = {};
  for (const tag of [baseTag, targetTag]) {
    const apiSource = show(tag, CATALOG_PATHS.api);
    const slotSource = show(tag, CATALOG_PATHS.slot);
    tables[tag] = { apiSource };
    for (const spec of API_ARRAYS) tables[tag][spec.name] = parseCatalogArray(apiSource, spec);
    tables[tag][SLOT_ARRAY.name] = parseCatalogArray(slotSource, SLOT_ARRAY);
  }

  const serviceDiff = diffTable(tables[baseTag].SERVICE_API, tables[targetTag].SERVICE_API, consumedServiceKeys, "SERVICE_API");
  const eventDiff = diffTable(tables[baseTag].EVENT_API, tables[targetTag].EVENT_API, consumedEventNames, "EVENT_API");
  const typeDiff = diffTable(tables[baseTag].TYPE_API, tables[targetTag].TYPE_API, new Set(), "TYPE_API");
  const slotDiff = diffTable(tables[baseTag][SLOT_ARRAY.name], tables[targetTag][SLOT_ARRAY.name], consumedSlotKeys, SLOT_ARRAY.name);

  const tokens = [
    ...consumedServiceKeys,
    ...consumedEventNames,
    ...consumedSlotKeys,
    ...consumption.valueServices.map((v) => v.key),
    ...consumption.clientServices.map((v) => v.key),
    ...consumption.nonContract.map((n) => n.anchor),
  ];
  // guide 读取参照：克隆内最高版本 tag（回填最全）；目标 tag 更新时用目标 tag
  const newest = newestGuideRef(repo);
  const guideRef = compareVersions(targetVersion, newest.version) > 0 ? targetTag : newest.ref;
  const guides = diffUpgradeGuides(repo, baseVersion, targetVersion, tokens, guideRef);
  const typeCrossRef = crossRefTypes(tables[targetTag].apiSource, consumedServiceKeys, typeDiff);

  const classify = (d) => classifyTableDiff(d);
  const report = {
    undecidable: false,
    baseTag, targetTag, repo,
    tables: {
      services: { base: tables[baseTag].SERVICE_API.ids.length, target: tables[targetTag].SERVICE_API.ids.length, diff: serviceDiff, tri: classify(serviceDiff) },
      events: { base: tables[baseTag].EVENT_API.ids.length, target: tables[targetTag].EVENT_API.ids.length, diff: eventDiff, tri: classify(eventDiff) },
      types: { base: tables[baseTag].TYPE_API.ids.length, target: tables[targetTag].TYPE_API.ids.length, diff: { added: typeDiff.added.length, removed: typeDiff.removed.length, contractChanged: typeDiff.contractChanged.length }, crossRefConsumedServices: typeCrossRef },
      slots: { base: tables[baseTag][SLOT_ARRAY.name].ids.length, target: tables[targetTag][SLOT_ARRAY.name].ids.length, diff: slotDiff, tri: classify(slotDiff) },
    },
    upgradeGuides: guides,
    uncheckable: [
      ...consumption.valueServices.map((v) => ({ key: v.key, why: "ctx.provide 值服务，不在 SERVICE_API；人工核 boot 源码" })),
      ...consumption.clientServices.map((v) => ({ key: v.key, why: "客户端面服务无仓内生成物目录；经 Cordis Inspect client Service 旁证" })),
      ...consumption.nonContract.map((v) => ({ key: v.anchor, why: "非契约面锚点：宿主改名即静默失效，差分器不可判，真机验收兜底" })),
    ],
  };
  return report;
}

function renderText(r) {
  const lines = [];
  lines.push(`宿主契约差分：${r.baseTag} → ${r.targetTag}`);
  lines.push(`上游克隆：${r.repo}`);
  for (const [name, t] of Object.entries({ 服务: r.tables.services, 事件: r.tables.events, 槽位: r.tables.slots })) {
    lines.push(`\n[${name}] ${t.base} → ${t.target}（+${t.diff.added.length} / −${t.diff.removed.length} / 契约改${t.diff.contractChanged.length} / 仅噪音改${t.diff.noiseOnlyChanged.length}）`);
    if (t.tri.breaking.removed.length || t.tri.breaking.changed.length) {
      lines.push(`  破坏（初值）：删除 ${JSON.stringify(t.tri.breaking.removed)}，契约字段变更 ${JSON.stringify(t.tri.breaking.changed.map((c) => ({ id: c.id, fields: c.contractFields })))}`);
    } else {
      lines.push("  破坏（初值）：无——消费面条目零删除、契约字段零变更");
    }
    if (t.tri.review.noiseOnConsumed.length) {
      lines.push(`  参考·消费面条目仅噪音字段变化 ${t.tri.review.noiseOnConsumed.length} 条（occupants/文档/行号/框架hook席位类，不构成契约变更）`);
    }
    if (t.tri.neutral.removedUnconsumed.length) lines.push(`  无关·非消费面删除：${JSON.stringify(t.tri.neutral.removedUnconsumed)}`);
    lines.push(`  无关·新增 ${t.tri.neutral.added} 条；非消费面契约变更 ${t.tri.neutral.changedUnconsumed.length} 条；非消费面噪音变更 ${t.tri.neutral.noiseUnconsumed} 条`);
  }
  const ty = r.tables.types;
  lines.push(`\n[类型] ${ty.base} → ${ty.target}（+${ty.diff.added} / −${ty.diff.removed} / 改${ty.diff.contractChanged}）`);
  lines.push(ty.crossRefConsumedServices.length
    ? `  须审（初值）：变更类型出现在消费面服务签名中：${JSON.stringify(ty.crossRefConsumedServices)}`
    : "  须审（初值）：无——变更类型未出现在任何消费面服务签名文本中");
  lines.push(`\n[升级指南] 区间新增 ${r.upgradeGuides.totalAdded} 份`);
  for (const g of r.upgradeGuides.matched) {
    const tag = g.match === "strong" ? "须审（强匹配）" : "参考（弱匹配）";
    const toks = g.match === "strong" ? g.tokens.join(",") : g.weakTokens.slice(0, 6).join(",");
    lines.push(`  ${tag} ${g.version}/${g.item} [${toks}] — ${g.description.slice(0, 120)}`);
  }
  lines.push(`\n[不可判面] ${r.uncheckable.length} 项（值服务/客户端服务/非契约锚点，逐项列因）：`);
  for (const u of r.uncheckable) lines.push(`  ${u.key} — ${u.why}`);
  lines.push("\n三态是初值不是结论：破坏/须审须由 AI 读原文核实后提请、Human 落定（Norm host-upgrade-followup 第 4–6 步）。");
  return lines.join("\n");
}

export function loadConsumption(file) {
  if (!existsSync(file)) throw new Undecidable(`消费面清单缺失：${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

// —— CLI 入口（被 import 时不执行）——
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const consumption = loadConsumption(join(PLUGIN, "lib", "host-consumption.json"));
    const report = runDiff({
      repo: args.repo,
      baseTag: normalizeTag(args.tags[0]),
      targetTag: normalizeTag(args.tags[1]),
      consumption,
    });
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`${renderText(report)}\n`);
  } catch (e) {
    if (e instanceof Undecidable || e.message?.startsWith("catalog:")) {
      process.stderr.write(`不可判定（fail-closed，不降级为零变更）：${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }
}
