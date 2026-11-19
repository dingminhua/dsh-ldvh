#!/usr/bin/env node
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

function classifyTableDiff(diff) {
  const consumed = new Set(diff.consumed);
  const breaking = {
    removed: diff.removed.filter((id) => consumed.has(id)),
    changed: diff.contractChanged.filter((c) => consumed.has(c.id)),
  };
  const review = {
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

function diffUpgradeGuides(repo, baseVersion, targetVersion, tokens, readRef) {
  const raw = git(repo, ["ls-tree", "-r", "--name-only", readRef, "--", CATALOG_PATHS.upgradeGuideRoot]);
  const byVersion = new Map();
  for (const line of raw.split("\n")) {
    const path = line.trim();
    if (path === "") continue;
    const m = /^docs\/upgrade-guide\/(v[^/]+)\/([^/]+)\/guide\.md$/.exec(path);
    if (m === null) continue;
    const version = tagVersion(m[1].replace(/^v/u, ""));
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
        continue;
      }
      const descMatch = /^description:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/mu.exec(text);
      const description = descMatch ? (descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? "") : "";
      const haystackStrong = `${g.version} ${g.item} ${description}`.toLowerCase();
      const haystackWeak = text.toLowerCase();
      const strong = [];
      const weak = [];
      for (const token of tokens) {
        const t = token.toLowerCase();
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
