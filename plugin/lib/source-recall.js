
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadRecallCriteria, loadRecallCriteriaBundle, typeKeyDerivedWords } from "./recall-criteria.js";
import { FRICTION_DEFAULT_CANDIDATE_STATUSES } from "./friction-writer.js";
import { normPositioningOf, positioningExcerptLine } from "./norm-positioning.js";
import { RUNTIME_CARRIER_RECALL_LIMIT, matchRuntimeCarriers } from "./runtime-carrier-reader.js";


export const MATCHED_FACT_FIELDS = Object.freeze([
  "decision",
  "phenomenon",
  "question",
  "research_question",
  "gist",
  "intent",
  "direction_key",
  "research_purpose",
  "trigger_signal",
  "summary",
  "scope",
  "title",
]);

export const DEFAULT_STATUSES_BY_TYPE = Object.freeze({
  spark: ["open"],
  friction: [...FRICTION_DEFAULT_CANDIDATE_STATUSES],
  report: ["active"],
  norm: ["active"],
  pitfall: ["active"],
  subgoal: ["active"],
});

export const DEFAULT_STATUSES_FALLBACK = Object.freeze(["active"]);

export function recallStatusPolicyOf(criteria, type) {
  const entry = criteria?.byType?.get(type) ?? null;
  if (entry !== null) {
    if (entry.values?.notApplicable?.["默认候选状态"] === true) {
      return { kind: "non-candidate", statuses: [] };
    }
    const fromTable = entry.values?.defaultStatuses;
    if (Array.isArray(fromTable) && fromTable.length > 0) {
      return { kind: "table", statuses: fromTable };
    }
  }
  const parseFailed = (criteria?.errors ?? []).some((error) => error.type === type);
  const named = DEFAULT_STATUSES_BY_TYPE[type];
  if (named === undefined) {
    return { kind: parseFailed ? "disabled" : "unregistered", statuses: [] };
  }
  return {
    kind: parseFailed ? "disabled" : "fallback",
    statuses: named,
  };
}

export const REGISTERED_FACT_TYPES = Object.freeze([
  "spark", "pitfall", "report", "goal", "friction", "norm", "subgoal",
]);

export const REQUIRED_RECALL_TYPES = Object.freeze(["pitfall"]);


export const INJECTION_EXCLUDED_TYPES = Object.freeze(["spark"]);

const SCOPE_EXCLUDED_ENTRY_BY_TYPE = Object.freeze({
  spark: "ldvh_spark_list",
});

const GENERIC_TOKENS = new Set([
  "任何", "规范", "写作", "执行", "测试", "验证", "校验", "检查", "复核", "审核",
  "独立", "写", "改", "回", "做", "用", "说", "看", "有", "无", "时停", "停止",
  "事实", "系统", "机制", "业务", "流程", "结果", "问题", "情况", "内容", "部分",
]);

const ACTION_CHARS = new Set("改删增建加写读查提跑测审批配装卸修重构部署发布回滚合并推拉取移转拆分");

const FUNCTION_CHARS = new Set(
  "的了是在和与或一个这对就也都是而把被让从到向但并且还又会能要可以不没无这那什么你我他她它们所因如果现之其等该者",
);

export function tokenize(text) {
  if (typeof text !== "string" || text === "") return [];
  const tokens = new Set();
  for (const m of text.toLowerCase().matchAll(/[a-z0-9][a-z0-9._-]*/g)) {
    if (m[0].length >= 2) tokens.add(m[0]);
  }
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjk) {
    for (let i = 0; i + 1 < run.length; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (FUNCTION_CHARS.has(bigram[0]) && FUNCTION_CHARS.has(bigram[1])) continue;
      tokens.add(bigram);
    }
    if (run.length === 1 && !FUNCTION_CHARS.has(run)) tokens.add(run);
    for (const ch of run) {
      if (ACTION_CHARS.has(ch)) tokens.add(ch);
    }
  }
  return [...tokens];
}

export function isWeakToken(token) {
  if (typeof token !== "string" || token.length !== 2) return false;
  if (!/[\u4e00-\u9fff]/.test(token)) return false;
  return FUNCTION_CHARS.has(token[0]) !== FUNCTION_CHARS.has(token[1]);
}



const TOKEN_CACHE = new WeakMap();

export function tokenSetOf(candidate) {
  let entry = TOKEN_CACHE.get(candidate);
  if (entry !== undefined) return entry;
  const scope = typeof candidate.scope === "string" ? candidate.scope : "";
  const detail = typeof candidate.detail === "string" ? candidate.detail : "";
  const title = typeof candidate.title === "string" ? candidate.title : "";
  const bodyText = candidate.bodyText ?? candidate.body;
  const body = typeof bodyText === "string" ? bodyText : "";
  const scopeTokens = tokenize(scope);
  const detailTokens = tokenize(detail);
  const titleTokens = tokenize(title);
  const bodyTokens = tokenize(body);
  const narrow = new Set([...scopeTokens, ...detailTokens, ...titleTokens]);
  const wide = new Set([...narrow, ...bodyTokens]);
  entry = {
    scope: scopeTokens,
    detail: detailTokens,
    title: titleTokens,
    body: bodyTokens,
    narrow,
    wide,
    scopeSet: new Set(scopeTokens),
    detailSet: new Set(detailTokens),
    titleSet: new Set(titleTokens),
    bodySet: new Set(bodyTokens),
  };
  TOKEN_CACHE.set(candidate, entry);
  return entry;
}

async function corpusFingerprintOf(files) {
  const hash = createHash("sha256");
  const sorted = [...files].sort();
  for (const file of sorted) {
    const content = await readFile(file);
    hash.update(`${file}\0`);
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

const PARSED_CORPUS_CACHE = new Map();

async function readCorpusFiles(dir, { recursive, skipTopLevelFiles }) {
  const out = [];
  const walk = async (current, rel) => {
    const entries = await readdirOrEmpty(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!recursive) continue;
        await walk(full, rel === "" ? entry.name : `${rel}/${entry.name}`);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (rel === "" && skipTopLevelFiles) continue;
      out.push({ dir: rel, name: entry.name, path: full });
    }
  };
  await walk(dir, "");
  out.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const texts = await Promise.all(out.map((entry) => readFile(entry.path, "utf8")));
  return out.map((entry, index) => ({ ...entry, text: texts[index] }));
}

async function cachedCorpus(dir, recursive, parse, { skipTopLevelFiles = false, cacheSalt = "" } = {}) {
  const files = await readCorpusFiles(dir, { recursive, skipTopLevelFiles });
  if (files.length === 0) return parse(files);
  let fingerprint;
  try {
    fingerprint = await corpusFingerprintOf(files.map((entry) => entry.path));
  } catch {
    return parse(files);
  }
  const cacheKey = `${fingerprint}\u0000${cacheSalt}`;
  const byFingerprint = PARSED_CORPUS_CACHE.get(dir);
  if (byFingerprint !== undefined && byFingerprint.get(cacheKey) !== undefined) {
    return byFingerprint.get(cacheKey);
  }
  const parsed = parse(files);
  if (byFingerprint === undefined) {
    PARSED_CORPUS_CACHE.set(dir, new Map([[cacheKey, parsed]]));
  } else {
    byFingerprint.set(cacheKey, parsed);
    if (byFingerprint.size > 4) {
      const oldest = byFingerprint.keys().next().value;
      if (oldest !== cacheKey) byFingerprint.delete(oldest);
    }
  }
  return parsed;
}

function intersect(a, b) {
  const set = b instanceof Set ? b : new Set(b);
  return a.filter((t) => set.has(t));
}


async function readdirOrEmpty(dir, options) {
  try {
    return await readdir(dir, options);
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

async function isReadableDir(dir) {
  try {
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (m === null) return {};
  const out = {};
  let cur = null;
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
    if (kv !== null) { cur = kv[1]; out[cur] = kv[2].trim(); continue; }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item !== null && cur !== null) {
      out[cur] = `${typeof out[cur] === "string" ? out[cur] : ""} ${item[1].trim()}`.trim();
    }
  }
  return out;
}

function parseObjectFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (m === null) return { data: {}, yamlError: null };
  let data;
  try {
    data = parseYaml(m[1]);
  } catch (error) {
    return {
      data: parseFrontmatter(text),
      yamlError: error instanceof Error ? error.message : String(error),
    };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return {
      data: parseFrontmatter(text),
      yamlError: `frontmatter 不是映射（得到 ${Array.isArray(data) ? "array" : typeof data}）`,
    };
  }
  return { data, yamlError: null };
}

function textField(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (/^[|>][-+0-9]*$/.test(trimmed)) return "";
  return trimmed;
}

export function statusRank(status) {
  if (status === "active" || status === "open") return 0;
  if (status === "draft" || status === "pending") return 1;
  return 2;
}

export function compareFactHits(a, b) {
  const fa = a?.fact ?? {};
  const fb = b?.fact ?? {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const byEvidence = Number(fa.weakHit === true) - Number(fb.weakHit === true);
  if (byEvidence !== 0) return byEvidence;
  const evidence =
    num(fa.tier) - num(fb.tier) ||
    num(fb.hits) - num(fa.hits);
  if (evidence !== 0) return evidence;
  return (
    statusRank(fa.status) - statusRank(fb.status) ||
    String(fb.updatedAt ?? "").localeCompare(String(fa.updatedAt ?? "")) ||
    String(fa.path ?? "").localeCompare(String(fb.path ?? "")) ||
    num(a?.index) - num(b?.index)
  );
}

const ISO_TS = /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z/g;

export function updatedAtOf(fm) {
  if (fm === null || typeof fm !== "object") return "";
  const stamps = [];
  const created = typeof fm.created_at === "string" ? fm.created_at.trim() : "";
  if (ISO_TS.test(created)) stamps.push(created);
  ISO_TS.lastIndex = 0;
  const log = typeof fm.change_log === "string" ? fm.change_log : "";
  for (const m of log.matchAll(ISO_TS)) stamps.push(m[0]);
  stamps.sort();
  return stamps.length === 0 ? "" : stamps[stamps.length - 1];
}

const EXCERPT_MAX_CHARS = 120;

export const RECALL_DIRECT_BYTE_BUDGET = 4000;

export const RENDER_FIXED_OVERHEAD_BYTES = 720;

export const BASELINE_YIELD_BELOW_BYTES = 1200;

export const L0_SEGMENT_ORDER = Object.freeze(["norm"]);

export const PITFALL_ON_DEMAND_ENTRYPOINT = "ldvh_pitfall_list";

export const PITFALL_ON_DEMAND_HEADER = "【经验 · active Pitfall（25 §12 按需索引）】";

export const L0_SEGMENT_HEADERS = Object.freeze({
  norm: "【事实规范 · active Norm（23 §10 F1 常驻枚举）】",
  pitfall: "【经验 · active Pitfall（25 §12 F1 枚举）】",
});

export const L0_SEGMENT_ENTRYPOINTS = Object.freeze({
  norm: "ldvh_norm_list",
  pitfall: "ldvh_pitfall_list",
});

export const L0_SHARE_DIVISOR = 3;

export const L0_FULL_NOTE = "（索引：只标「有哪些」，不证明适用。）";

export const L0_NORM_NOTE = "（索引不证明适用；命中先读全文核对。）";

export function planL0Enumeration(segments, budgetBytes, reserveBytes = 0) {
  const ordered = Array.isArray(segments) ? segments : [];
  const hasBudget = Number.isFinite(budgetBytes) && budgetBytes > 0;
  const remaining = hasBudget ? Math.max(0, budgetBytes - reserveBytes) : Number.POSITIVE_INFINITY;
  const cap = hasBudget ? Math.floor(remaining / L0_SHARE_DIVISOR) : Number.POSITIVE_INFINITY;
  const yieldAll = () => ({
    segments: ordered.map((segment) => ({
      type: segment.type,
      lines: [],
      total: segment.total,
      shown: 0,
      omitted: segment.total,
      bytes: 0,
      yielded: segment.total > 0,
    })),
    bytes: 0,
    yielded: ordered.some((segment) => segment.total > 0),
    note: "",
  });
  if (hasBudget && budgetBytes < BASELINE_YIELD_BELOW_BYTES) return yieldAll();
  if (cap <= 0) return yieldAll();

  const lineBytes = (line) => Buffer.byteLength(line, "utf8") + 1;
  let used = 0;
  const planned = [];
  for (const segment of ordered) {
    const header = L0_SEGMENT_HEADERS[segment.type] ?? `【L0 · ${segment.type}】`;
    const entry = L0_SEGMENT_ENTRYPOINTS[segment.type] ?? "对应 list 工具";
    const total = Number.isInteger(segment.total) ? segment.total : segment.entries.length;
    if (total === 0) {
      planned.push({ type: segment.type, lines: [], total: 0, shown: 0, omitted: 0, bytes: 0, yielded: false });
      continue;
    }
    const headerBytes = lineBytes(header);
    const degradationClauses = (omittedCount, unavailableCount) => {
      const parts = [];
      if (omittedCount > 0) parts.push(`${omittedCount} 条定位摘录未附出`);
      if (unavailableCount > 0) {
        parts.push(`${unavailableCount} 条定位机械导不出（正文不合 23 §8 两句契约，须改写载体；不表示该份没有定位，用 ldvh_norm_read 读正文）`);
      }
      return parts;
    };
    const noteOf = (shown, omittedCount = 0, unavailableCount = 0) => {
      const parts = degradationClauses(omittedCount, unavailableCount);
      const extra = parts.length > 0 ? `另有 ${parts.join("；")}；` : "";
      return `（本档预算仅容前 ${shown} 条，共 ${total} 条；${extra}全量用 ${entry}。索引不证明适用。）`;
    };
    const fullNote = segment.type === "norm" ? L0_NORM_NOTE : L0_FULL_NOTE;
    const degradedNoteOf = (omittedCount, unavailableCount) => {
      const parts = degradationClauses(omittedCount, unavailableCount);
      return `（索引不证明适用；命中先读全文核对；另有 ${parts.join("；")}。）`;
    };
    const truncNoteBytes = lineBytes(noteOf(total, total, total));
    const fullNoteBytes = lineBytes(fullNote);
    const degradedNoteBytes = segment.type === "norm"
      ? lineBytes(degradedNoteOf(total, total))
      : 0;
    const worstNoteBytes = Math.max(truncNoteBytes, fullNoteBytes, degradedNoteBytes);
    if (cap - used < headerBytes + worstNoteBytes + lineBytes(segment.entries[0] ?? "")) {
      planned.push({ type: segment.type, lines: [], total, shown: 0, omitted: total, bytes: 0, yielded: true });
      continue;
    }
    const excerpts = Array.isArray(segment.excerpts) ? segment.excerpts : [];
    const hasExcerpts = segment.type === "norm" && excerpts.length > 0;
    const kept = [];
    let segmentUsed = headerBytes + worstNoteBytes;
    for (const line of segment.entries) {
      const size = lineBytes(line);
      if (used + segmentUsed + size > cap) break;
      segmentUsed += size;
      kept.push(line);
    }
    if (kept.length === 0) {
      planned.push({ type: segment.type, lines: [], total, shown: 0, omitted: total, bytes: 0, yielded: true });
      continue;
    }
    const keptExcerpts = new Map();
    for (let i = 0; i < kept.length; i += 1) {
      const excerptLine = excerpts[i];
      if (typeof excerptLine !== "string" || excerptLine === "") continue;
      const size = lineBytes(excerptLine);
      if (used + segmentUsed + size > cap) continue;
      segmentUsed += size;
      keptExcerpts.set(i, excerptLine);
    }

    const recount = () => {
      if (!hasExcerpts) return { unavailable: 0, omitted: 0 };
      let unavailable = 0;
      for (let i = 0; i < kept.length; i += 1) {
        const excerptLine = excerpts[i];
        if (typeof excerptLine !== "string" || excerptLine === "") unavailable += 1;
      }
      return { unavailable, omitted: kept.length - keptExcerpts.size - unavailable };
    };

    const counts = recount();
    const excerptOmitted = counts.omitted;
    const excerptUnavailable = counts.unavailable;

    const interleaved = [];
    kept.forEach((line, i) => {
      interleaved.push(line);
      const excerptLine = keptExcerpts.get(i);
      if (excerptLine !== undefined) interleaved.push(excerptLine);
    });
    const omitted = total - kept.length;
    const note = omitted > 0
      ? noteOf(kept.length, excerptOmitted, excerptUnavailable)
      : (excerptOmitted > 0 || excerptUnavailable > 0)
        ? degradedNoteOf(excerptOmitted, excerptUnavailable)
        : fullNote;
    const bytes = headerBytes
      + interleaved.reduce((sum, line) => sum + lineBytes(line), 0)
      + Buffer.byteLength(note, "utf8") + 1;
    used += bytes;
    planned.push({
      type: segment.type,
      lines: [header, ...interleaved, note],
      total,
      shown: kept.length,
      omitted,
      bytes,
      yielded: false,
      note,
      excerptShown: keptExcerpts.size,
      excerptOmitted,
      excerptUnavailable,
      excerptDisclosed: excerptOmitted > 0 || excerptUnavailable > 0,
    });
  }
  return {
    segments: planned,
    bytes: used,
    yielded: planned.some((segment) => segment.yielded === true),
    note: planned.some((segment) => segment.omitted > 0) ? "partial" : "full",
  };
}

export function l0EnumerationOf(facts) {
  const all = Array.isArray(facts) ? facts : [];
  return L0_SEGMENT_ORDER.map((type) => {
    const statuses = DEFAULT_STATUSES_BY_TYPE[type] ?? DEFAULT_STATUSES_FALLBACK;
    const picked = all.filter((fact) => fact.type === type && statuses.includes(fact.status));
    picked.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)
      || (String(a.ref) < String(b.ref) ? -1 : String(a.ref) > String(b.ref) ? 1 : 0));
    const entries = picked.map((fact) => {
      const directionKey = fact.structural?.directionKey;
      if (type === "norm" && typeof directionKey === "string" && directionKey !== "") {
        return `· ${fact.title}（${directionKey}）`;
      }
      return `· ${fact.title}`;
    });
    const excerpts = type === "norm"
      ? picked.map((fact) => {
        const extracted = normPositioningOf(fact.body ?? fact.fullText ?? "");
        return extracted.available ? positioningExcerptLine(extracted) : "";
      })
      : [];
    return { type, entries, excerpts, total: entries.length };
  });
}

export function countActivePitfalls(facts) {
  const statuses = DEFAULT_STATUSES_BY_TYPE.pitfall ?? DEFAULT_STATUSES_FALLBACK;
  return (Array.isArray(facts) ? facts : [])
    .filter((fact) => fact.type === "pitfall" && statuses.includes(fact.status)).length;
}

export function l0LinesOf(plan) {
  if (plan === null || typeof plan !== "object" || !Array.isArray(plan.segments)) return [];
  return plan.segments.flatMap((segment) => (Array.isArray(segment.lines) ? segment.lines : []));
}

export const INJECTION_BUDGET_TIERS = Object.freeze({
  10: 10 * 1024,
  20: 20 * 1024,
  30: 30 * 1024,
  40: 40 * 1024,
  50: 50 * 1024,
});

export const DEFAULT_INJECTION_BUDGET_TIER = 10;

export const RECALL_LIMIT_BYTES_PER_ITEM = 220;

export const RECALL_LIMIT_MAX = Math.floor(Math.max(...Object.values(INJECTION_BUDGET_TIERS)) / RECALL_LIMIT_BYTES_PER_ITEM / 2);

export function recallLimitForBudget(budgetBytes) {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) return RECALL_LIMIT_MIN;
  const raw = Math.floor(budgetBytes / RECALL_LIMIT_BYTES_PER_ITEM / 2);
  return Math.min(RECALL_LIMIT_MAX, Math.max(RECALL_LIMIT_MIN, raw));
}

export const RECALL_LIMIT_MIN = 3;

export function resolveInjectionBudget(tier) {
  if (tier === undefined || tier === null) {
    return { ok: true, tier: DEFAULT_INJECTION_BUDGET_TIER, bytes: INJECTION_BUDGET_TIERS[DEFAULT_INJECTION_BUDGET_TIER] };
  }
  const key = typeof tier === "string" ? Number(tier) : tier;
  const bytes = INJECTION_BUDGET_TIERS[key];
  if (bytes === undefined) {
    const allowed = Object.keys(INJECTION_BUDGET_TIERS).join("/");
    return {
      ok: false,
      reason: `未登记的预算档位 ${JSON.stringify(tier)}；可用档位：${allowed}（单位 K 字节）`,
      tier: DEFAULT_INJECTION_BUDGET_TIER,
      bytes: INJECTION_BUDGET_TIERS[DEFAULT_INJECTION_BUDGET_TIER],
    };
  }
  return { ok: true, tier: key, bytes };
}

function excerptOf(text) {
  if (typeof text !== "string") return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_MAX_CHARS) return flat;
  return `${flat.slice(0, EXCERPT_MAX_CHARS)}…`;
}

function structuralCardOf(candidate) {
  const s = candidate?.structural;
  if (s === null || typeof s !== "object") return null;
  const out = {};
  if (typeof s.serves === "string" && s.serves !== "") out.serves = s.serves;
  if (typeof s.priority === "string" && s.priority !== "") out.priority = s.priority;
  if (typeof s.directionKey === "string" && s.directionKey !== "") out.directionKey = s.directionKey;
  if (Number.isInteger(s.occurrenceCount)) out.occurrenceCount = s.occurrenceCount;
  if (Array.isArray(s.relationKeys) && s.relationKeys.length > 0) {
    out.relationKeys = [...new Set(s.relationKeys)];
  }
  return Object.keys(out).length === 0 ? null : out;
}


function contentFingerprintOf(text) {
  const value = typeof text === "string" ? text : "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return {
    kind: "content",
    algorithm: "fnv1a-32",
    value: hash.toString(16).padStart(8, "0"),
    coversContent: true,
    length: value.length,
  };
}

const CONTENT_FINGERPRINT_CACHE = new WeakMap();

function contentFingerprintOfCached(text, owner) {
  if (owner !== undefined && owner !== null && typeof owner === "object") {
    const hit = CONTENT_FINGERPRINT_CACHE.get(owner);
    if (hit !== undefined) return hit;
    const computed = contentFingerprintOf(text);
    CONTENT_FINGERPRINT_CACHE.set(owner, computed);
    return computed;
  }
  return contentFingerprintOf(text);
}

function fingerprintOf(candidates) {
  const paths = candidates.map((candidate) => candidate.path).filter((p) => typeof p === "string").sort();
  let hash = 0x811c9dc5;
  const text = paths.join("\n");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return {
    kind: "candidate-set",
    algorithm: "fnv1a-32 over sorted paths",
    value: hash.toString(16).padStart(8, "0"),
    memberCount: paths.length,
    coversContent: false,
  };
}

export async function resolveSpecsRoot(projectRoot) {
  const candidates = [
    { dir: join(projectRoot, "specs"), tier: "project" },
    { dir: join(import.meta.dirname, "..", "..", "specs"), tier: "source-repo" },
    { dir: join(import.meta.dirname, "..", "specs"), tier: "package" },
  ];
  for (const candidate of candidates) {
    const files = await readdirOrEmpty(candidate.dir);
    if (files.some((file) => file.endsWith(".md"))) return candidate;
  }
  return null;
}

export async function loadSpecs(specsDir) {
  return cachedCorpus(specsDir, false, (files) => {
  const out = [];
  for (const { name: file, text } of files) {
    const fm = parseFrontmatter(text);
    const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const pick = (key) => {
      const direct = fm[key];
      if (direct !== undefined && direct !== "") return direct;
      const m = new RegExp(`^\\s+${key}:\\s*(.+)$`, "m").exec(block);
      return m !== null ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    const headings = [...text.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim());
    out.push({
      source: "spec",
      ref: pick("spec_key") || file.replace(/\.md$/, ""),
      specKey: pick("spec_key") || null,
      specId: pick("spec_id"),
      title: pick("title") || file.replace(/\.md$/, ""),
      positioning: pick("positioning"),
      scope: pick("scope"),
      basis: pick("basis"),
      path: `specs/${file}`,
      absolutePath: join(specsDir, file),
      headings,
      text,
      bodyText: text.replace(/^---\n[\s\S]*?\n---\n?/, ""),
    });
  }
  return out;
  });
}

export async function loadRecallCriteriaForRoot(root, specsSource = undefined) {
  const source = specsSource === null || specsSource === undefined
    ? await resolveSpecsRoot(root)
    : specsSource;
  if (source !== null) return await loadRecallCriteria(source.dir);
  const bundled = await loadRecallCriteriaBundle();
  return bundled.unreadable === true ? null : bundled;
}

async function resolveRecallCriteriaForFacts(baseDir) {
  return loadRecallCriteriaForRoot(dirname(baseDir));
}

function coreFieldTextOf(fm, field) {
  if (fm === null || typeof fm !== "object") return "";
  const direct = textField(fm[field]);
  if (direct !== "") return direct;
  if (field === "scope") return textField(fm.scope_boundary);
  return "";
}

export async function loadFacts(baseDir, options = {}) {
  let criteria = options.criteria;
  if (criteria === undefined) criteria = await resolveRecallCriteriaForFacts(baseDir);
  return cachedCorpus(baseDir, true, (files) => {
  const out = [];
  for (const { dir, name: file, text } of files) {
      const { data: fm, yamlError } = parseObjectFrontmatter(text);
      const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
      const fullText = text;
      const relations = Array.isArray(fm.relations) ? fm.relations : [];
      const relationKeys = [];
      const relationTargets = [];
      const relationEdges = [];
      for (const rel of relations) {
        if (rel === null || typeof rel !== "object") continue;
        const key = textField(rel.relation_key);
        if (key !== "") relationKeys.push(key);
        const target = rel.target;
        if (target !== null && typeof target === "object") {
          const uid = textField(target.object_uid);
          const commit = textField(target.commit);
          if (uid !== "") {
            relationTargets.push(uid);
            if (key !== "") relationEdges.push({ relationKey: key, targetUid: uid });
          }
          if (commit !== "") relationTargets.push(commit);
        } else if (typeof target === "string" && target.trim() !== "") {
          relationTargets.push(target.trim());
          if (key !== "") relationEdges.push({ relationKey: key, targetUid: target.trim() });
        }
      }
      const refs = Array.isArray(fm.refs) ? fm.refs : [];
      const refTargets = refs
        .map((r) => (r !== null && typeof r === "object" ? textField(r.object_uid) : textField(r)))
        .filter((r) => r !== "");
      const occurrence = fm.occurrence !== null && typeof fm.occurrence === "object"
        ? fm.occurrence : null;
      const excerptSource =
        textField(fm.summary) || textField(fm.gist) || textField(fm.decision)
        || textField(fm.phenomenon) || textField(fm.research_question)
        || textField(fm.scope) || textField(fm.scope_boundary) || "";
      const type = textField(fm.fact_type_key) || dir.replace(/s$/, "");
      const criteriaEntry = criteria?.byType?.get(type) ?? null;
      const criteriaErrors = criteriaEntry === null
        ? (criteria?.errors ?? [])
          .filter((error) => error.type === type)
          .map((error) => error.message ?? error.code ?? "判据表不可用")
        : [];
      const criteriaBroken = criteriaEntry === null
        && (criteria?.errors ?? []).some((error) => error.type === type);
      const typeNames = criteriaEntry === null ? [] : [...new Set([
        ...typeKeyDerivedWords(type).map((word) => word.toLowerCase()),
        ...criteriaEntry.values.typeAliases.map((word) => word.toLowerCase()),
      ])];
      out.push({
        source: "fact",
        type,
        dir,
        ref: textField(fm.object_uid) || file.replace(/\.md$/, ""),
        objectUid: textField(fm.object_uid) || null,
        title: textField(fm.title),
        status: textField(fm.status),
        scope: textField(fm.scope) || textField(fm.scope_boundary),
        detail: criteriaEntry === null ? "" : [
          ...criteriaEntry.values.coreFields.map((field) => coreFieldTextOf(fm, field)),
          textField(fm.trigger_signal),
        ].filter((value) => value !== "").join(" "),
        typeNames,
        machineCriteria: criteriaEntry !== null ? "ok" : (criteriaBroken ? "disabled" : "missing"),
        criteriaError: criteriaErrors,
        trigger: textField(fm.trigger_signal),
        summary: textField(fm.summary),
        structural: {
          serves: textField(fm.serves),
          priority: textField(fm.priority),
          directionKey: textField(fm.direction_key),
          disposition: textField(fm.disposition),
          outcome: textField(fm.outcome),
          stoppingReason: textField(fm.stopping_reason),
          attribution: textField(fm.attribution),
          attributionRef: textField(
            fm.attribution_ref !== null && typeof fm.attribution_ref === "object"
              ? fm.attribution_ref.object_uid : fm.attribution_ref,
          ),
          occurrenceCount: occurrence !== null && Number.isInteger(occurrence.count)
            ? occurrence.count : null,
          relationKeys,
          relationTargets,
          relationEdges,
          refTargets,
        },
        yamlError,
        updatedAt: updatedAtOf(fm),
        excerptSource,
        path: `ldvh-base/${dir}/${file}`,
        absolutePath: join(baseDir, dir, file),
        body,
        fullText,
      });
  }
  return out;
  }, {
    skipTopLevelFiles: true,
    cacheSalt: criteria === null ? "criteria-unavailable" : `criteria:${criteria.fingerprint}`,
  });
}


export const MATCH_TIERS = Object.freeze([
  { tier: 0, field: "specId", label: "规范编号命中" },
  { tier: 1, field: "scope", label: "适用范围命中" },
  { tier: 2, field: "detail", label: "类型正文命中" },
  { tier: 3, field: "title", label: "标题命中" },
  { tier: 4, field: "body", label: "正文片段命中" },
]);


export const STRUCTURAL_BARE_QUERY_MAX_TOKENS = 2;

export const STRUCTURAL_DEFERRED_TIER = 5;

export const STRUCTURAL_MATCH_FIELDS = Object.freeze([
  "object_uid",
  "serves",
  "priority",
  "direction_key",
  "disposition",
  "outcome",
  "relation_key",
  "relation_target",
  "refs_target",
]);

export const SHORT_REF_LENGTH = 8;

export const SHORT_FORM_COLLISION_CAVEAT =
  "｜短形态边界：短标识与「类型短名+短标识」只是被接受的书写形态，存在前缀碰撞可能；" +
  "碰撞时同一次查询会一并命中多个对象，属候选可筛选而非指称唯一，不得据此断言该指称无歧义";

const FULL_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function structuralHits(actionTokens, candidate) {
  const s = candidate?.structural;
  if (s === null || typeof s !== "object") return [];
  const tokens = new Set(actionTokens);
  const hits = [];
  const add = (field, value, form) => {
    if (typeof value !== "string" || value === "") return;
    if (tokens.has(value.toLowerCase())) {
      if (form === undefined) hits.push({ field, value });
      else hits.push({ field, value, form });
    }
  };
  const ref = candidate.ref;
  add("object_uid", ref, "完整标识");
  if (typeof ref === "string" && FULL_UID_PATTERN.test(ref)) {
    const short = ref.slice(0, SHORT_REF_LENGTH).toLowerCase();
    add("object_uid", short, "短标识");
    if (typeof candidate.type === "string" && candidate.type !== "") {
      add("object_uid", `${candidate.type}-${short}`, "类型短名+短标识");
    }
  }
  add("serves", s.serves);
  add("priority", s.priority);
  add("direction_key", s.directionKey);
  add("disposition", s.disposition);
  add("outcome", s.outcome);
  for (const key of s.relationKeys ?? []) add("relation_key", key);
  for (const target of s.relationTargets ?? []) add("relation_target", target);
  for (const target of s.refTargets ?? []) add("refs_target", target);
  const seen = new Set();
  return hits.filter((h) => {
    const k = `${h.field}\u0000${h.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

function isCorpusStats(v) {
  return v !== null && typeof v === "object"
    && v.docFreq instanceof Map && Number.isFinite(v.total) && Number.isFinite(v.avgdl) && v.avgdl > 0;
}

function corpusStatsOf(list) {
  const docFreq = new Map();
  let total = 0;
  let tokenSum = 0;
  for (const c of list) {
    const toks = tokenSetOf(c).wide;
    total += 1;
    tokenSum += toks.size;
    for (const t of toks) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  return { docFreq, total, avgdl: Math.max(1, tokenSum / Math.max(1, total)) };
}

export const HIGH_DF_RATIO = 0.6;

function docFreqOfImpl(list) {
  const narrow = new Map();
  const wide = new Map();
  for (const c of list) {
    const tokens = tokenSetOf(c);
    for (const token of tokens.narrow) narrow.set(token, (narrow.get(token) ?? 0) + 1);
    for (const token of tokens.wide) wide.set(token, (wide.get(token) ?? 0) + 1);
  }
  return { narrow, wide, total: list.length };
}

const CORPUS_DF_CACHE = new Map();
const CORPUS_STATS_CACHE = new Map();

const SIGNATURE_CACHE = new WeakMap();

function memberSignatureOf(list) {
  const first = list.length === 0 ? null : list[0];
  if (first === null) return "";
  const cached = SIGNATURE_CACHE.get(first);
  if (cached !== undefined && cached.size === list.length) return cached.value;
  const value = list
    .map((c) => `${c.path}\0${contentFingerprintOfCached(c.fullText ?? c.text ?? "", c).value}`)
    .join("\0");
  SIGNATURE_CACHE.set(first, { size: list.length, value });
  return value;
}

function cachedDocFreqOf(list) {
  const key = memberSignatureOf(list);
  const hit = CORPUS_DF_CACHE.get(key);
  if (hit !== undefined) return hit;
  const computed = docFreqOfImpl(list);
  CORPUS_DF_CACHE.set(key, computed);
  return computed;
}

function cachedCorpusStatsOf(list) {
  const key = memberSignatureOf(list);
  const hit = CORPUS_STATS_CACHE.get(key);
  if (hit !== undefined) return hit;
  const computed = corpusStatsOf(list);
  CORPUS_STATS_CACHE.set(key, computed);
  return computed;
}

function isTooCommon(token, docFreq, total) {
  if (total < 4) return false;
  const narrow = docFreq?.narrow;
  if (narrow instanceof Map) {
    return (narrow.get(token) ?? 0) / total >= HIGH_DF_RATIO;
  }
  return (docFreq?.get?.(token) ?? 0) / total >= HIGH_DF_RATIO;
}

const CJK_CHAR = /[\u3400-\u9fff]/;

function closedSetTypeNameOf(candidate, actionTokens, queryText) {
  const names = candidate.typeNames;
  if (!Array.isArray(names) || names.length === 0) return null;
  for (const token of actionTokens) {
    const lower = token.toLowerCase();
    if (lower === "") continue;
    if (CJK_CHAR.test(lower)) continue;
    if (names.includes(lower)) return { name: lower, hit: token };
  }
  for (const name of names) {
    if (!CJK_CHAR.test(name)) continue;
    let index = queryText.indexOf(name);
    while (index !== -1) {
      const next = queryText[index + name.length] ?? "";
      if (!CJK_CHAR.test(next)) return { name, hit: name };
      index = queryText.indexOf(name, index + 1);
    }
  }
  return null;
}

export function matchCandidate(actionTokens, candidate, corpusStats, queryText = "") {
  const structural = structuralHits(actionTokens, candidate);
  const specId = candidate.specId;
  if (typeof specId === "string" && specId !== "" && actionTokens.includes(specId)) {
    return { tier: 0, hits: 1, hitReason: `规范编号命中：${specId}` };
  }
  if (structural.length > 0) {
    const shown = structural
      .slice(0, 3)
      .map((h) => (h.form === undefined
        ? `${h.field}=${h.value}`
        : `${h.field}=${h.value}（${h.form}）`))
      .join("、");
    const subjectTokens = actionTokens.filter(
      (t) => t.length >= 2 && !isWeakToken(t) && !GENERIC_TOKENS.has(t),
    );
    const isBareReference = subjectTokens.length <= STRUCTURAL_BARE_QUERY_MAX_TOKENS;
    const hasShortForm = structural.some(
      (h) => h.form === "短标识" || h.form === "类型短名+短标识",
    );
    const shortFormCaveat = hasShortForm ? SHORT_FORM_COLLISION_CAVEAT : "";
    return {
      tier: isBareReference ? 0 : STRUCTURAL_DEFERRED_TIER,
      hits: structural.length,
      hitReason: (isBareReference
        ? `结构命中：${shown}${structural.length > 3 ? " 等" : ""}`
        : `结构命中（查询有其它主题词，不占优先位）：${shown}${structural.length > 3 ? " 等" : ""}`)
        + shortFormCaveat,
      structuralFields: [...new Set(structural.map((h) => h.field))],
      bareReference: isBareReference,
      shortForm: hasShortForm,
    };
  }

  let namingFallback = null;
  if (candidate.source === "fact") {
    const named = closedSetTypeNameOf(candidate, actionTokens, queryText);
    if (named !== null) {
      const namingSubjectTokens = actionTokens.filter(
        (t) => t.length >= 2 && !isWeakToken(t) && !GENERIC_TOKENS.has(t)
          && !named.name.includes(t),
      );
      const namingBare = namingSubjectTokens.length <= STRUCTURAL_BARE_QUERY_MAX_TOKENS;
      if (namingBare) {
        return {
          tier: 0.5,
          hits: 1,
          hitReason: `类型点名命中：${named.hit}`,
          typeNamed: true,
          bareReference: true,
        };
      }
      namingFallback = {
        tier: STRUCTURAL_DEFERRED_TIER,
        hits: 1,
        hitReason: `类型点名命中（查询有其它主题词，不占优先位）：${named.hit}`,
        typeNamed: true,
        bareReference: false,
      };
    }
  }

  if (candidate.source === "spec" && typeof candidate.title === "string") {
    const titleTypeNames = (candidate.title.match(/[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/g) ?? []).map((w) => w.toLowerCase());
    if (titleTypeNames.length > 0) {
      const named = actionTokens.find((token) => titleTypeNames.includes(token.toLowerCase()));
      if (named !== undefined) {
        return { tier: 0.5, hits: 1, hitReason: `类型点名命中：${named}` };
      }
    }
  }
  const singleStrongToken =
    actionTokens.length === 1 && !GENERIC_TOKENS.has(actionTokens[0]);
  const bodyMinHits = singleStrongToken ? 1 : 2;
  const cachedTokens = tokenSetOf(candidate);
  const sections = [
    { tier: 1, text: candidate.scope, tokens: cachedTokens.scopeSet, label: "适用范围", minHits: 1 },
    { tier: 2, text: candidate.detail, tokens: cachedTokens.detailSet, label: "内容", minHits: 1 },
    { tier: 3, text: candidate.title, tokens: cachedTokens.titleSet, label: "标题", minHits: 1 },
    { tier: 4, text: candidate.bodyText ?? candidate.body, tokens: cachedTokens.bodySet, label: "正文", minHits: bodyMinHits },
  ];
  let best = null;
  for (const section of sections) {
    if (typeof section.text !== "string" || section.text === "") continue;
    const hits = intersect(actionTokens, section.tokens);
    const strong = hits.filter((token) => token.length >= 2);
    const weak = hits.filter((token) => token.length === 1);
    const specific = strong.filter((token) => !GENERIC_TOKENS.has(token) && !isWeakToken(token));
    const decisive = specific.length > 0 ? specific : (strong.length > 0 ? strong : weak);
    if (decisive.length >= (section.minHits ?? 1)) {
      const shown = decisive.slice(0, 3).join("、");
      const onlyGenericOrWeak = specific.length === 0;
      const reason = onlyGenericOrWeak
        ? `${section.label}仅通用词/单字命中（相关性弱，须自行核实）：${shown}`
        : `${section.label}命中：${shown}`;
      best = {
        tier: section.tier,
        matchTierMeaning:
          "匹配层（命中了哪个字段），非 F0–F4 事实分层、非 L0–L4 规范读取分层（02 §9.1）",
        hits: decisive.length,
        hitReason: reason,
        weakHit: onlyGenericOrWeak,
      };
      break;
    }
  }
  if (best === null) return namingFallback;
  const allHits = intersect(actionTokens, tokenSetOf(candidate).wide);
  const strongAll = allHits.filter((t) => t.length >= 2);
  const specificAll = strongAll.filter((t) => !GENERIC_TOKENS.has(t) && !isWeakToken(t));
  const contributing = specificAll.length > 0 ? specificAll : strongAll;
  let breadth = contributing.length;
  let weighted = null;
  const SINGLE_CHAR_BASE = 1;
  if (isCorpusStats(corpusStats)) {
    const docTokens = [...tokenSetOf(candidate).wide];
    const tf = new Map();
    for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);
    const dl = Math.max(1, docTokens.length);
    let sum = 0;
    for (const t of contributing) {
      const df = corpusStats.docFreq.get(t) ?? 0;
      const idf = Math.log(1 + (corpusStats.total - df + 0.5) / (df + 0.5));
      const tfv = Math.max(tf.get(t) ?? 0, 1);
      const sat = (tfv * (BM25_K1 + 1))
        / (tfv + BM25_K1 * (1 - BM25_B + BM25_B * dl / corpusStats.avgdl))
        / (BM25_K1 + 1);
      sum += idf * sat;
    }
    weighted = Math.round(sum * 1000) / 1000;
  }
  if (weighted !== null) {
    best.hits = weighted > 0 ? weighted : Math.max(best.hits ?? 0, SINGLE_CHAR_BASE);
    if (breadth > 1) best.hitReason = `${best.hitReason}·${breadth}词/${weighted}`;
  } else if (breadth > best.hits) {
    best.hits = breadth;
    if (breadth > 1) best.hitReason = `${best.hitReason}·${breadth}词`;
  }
  return best;
}


function diffByPath(hits, kept) {
  const keptPaths = new Set(kept.map((item) => item.path));
  return hits
    .filter((item) => !keptPaths.has(item.path))
    .map((item) => ({ title: item.title, path: item.path }));
}

export function selectFactsBySection(hits, plan = {}) {
  const order = Array.isArray(plan.order) ? plan.order : [];
  const quotaByType = plan.quotaByType ?? {};
  const total = Number.isInteger(plan.total) && plan.total >= 0 ? plan.total : Number.POSITIVE_INFINITY;
  const byType = new Map();
  for (const hit of hits) {
    const type = typeof hit?.type === "string" ? hit.type : "";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(hit);
  }
  const droppedByQuota = [];
  const quotaGroups = [];
  for (const type of order) {
    const all = byType.get(type) ?? [];
    byType.delete(type);
    if (all.length === 0) continue;
    const quota = Number.isInteger(quotaByType[type]) ? quotaByType[type] : 0;
    const kept = quota > 0 ? all.slice(0, quota) : [];
    if (all.length > kept.length) droppedByQuota.push({ type, count: all.length - kept.length });
    if (kept.length > 0) quotaGroups.push({ type, items: kept });
  }
  const unassignedByType = [];
  let unassigned = 0;
  for (const [type, rest] of byType) {
    if (rest.length === 0) continue;
    unassigned += rest.length;
    unassignedByType.push({ type, count: rest.length });
  }
  const droppedByTotal = [];
  const groups = [];
  const selected = [];
  let remaining = total;
  for (const group of quotaGroups) {
    const take = Math.max(0, Math.min(group.items.length, remaining));
    if (take < group.items.length) droppedByTotal.push({ type: group.type, count: group.items.length - take });
    if (take > 0) {
      groups.push({ type: group.type, items: group.items.slice(0, take) });
      selected.push(...group.items.slice(0, take));
    }
    remaining -= take;
  }
  return { selected, groups, droppedByQuota, droppedByTotal, unassigned, unassignedByType };
}

function unregisteredStatusTypesOf(facts) {
  return [...new Set(
    facts
      .filter((fact) => REGISTERED_FACT_TYPES.includes(fact.type))
      .filter((fact) => DEFAULT_STATUSES_BY_TYPE[fact.type] === undefined)
      .map((fact) => fact.type),
  )].sort();
}

function unregisteredStatusGapOf(types, reason) {
  return `该类型的机械判据不可用，故不作为候选：${types.join("、")}（${reason}）`;
}

function criteriaTierGapOf(criteria) {
  if (criteria?.tier !== "package-data") return null;
  return "判据表来源：包内数据文件，由类型规范判据表生成（非规范源原文）";
}

function criteriaGapsOf(criteria, facts) {
  const gaps = [];
  const unregisteredStatusTypes = unregisteredStatusTypesOf(facts);
  if (criteria === null) {
    gaps.push("判据表不可用：未找到规范源，也没有可用包内判据表数据文件，全部事实类型的机器判据已停用（类型点名／核心语义字段／关系展开不生效）");
    if (unregisteredStatusTypes.length > 0) {
      gaps.push(unregisteredStatusGapOf(
        unregisteredStatusTypes,
        "判据表不可读，且这些类型没有登记机械值，不按任何兜底状态放行",
      ));
    }
    return gaps;
  }
  const tierGap = criteriaTierGapOf(criteria);
  if (tierGap !== null) gaps.push(tierGap);
  for (const error of criteria.errors) {
    gaps.push(`判据表不可用（${error.type ?? "未知类型"}／规范 ${error.specId ?? "?"}）：${error.code}：${error.message}`);
  }
  const registered = [...new Set(
    facts.filter((fact) => REGISTERED_FACT_TYPES.includes(fact.type)).map((fact) => fact.type),
  )].sort();
  for (const type of registered) {
    const policy = recallStatusPolicyOf(criteria, type);
    if (policy.kind === "disabled") continue;
    if (policy.kind === "fallback") {
      gaps.push(`判据表未登记该类型（${type}）：默认候选状态回落具名兜底 ${policy.statuses.join("/")}，类型点名／核心语义字段／关系展开不生效（该类型尚无判据表条目，不是判据表损坏）`);
    }
    if (policy.kind === "unregistered") {
      gaps.push(unregisteredStatusGapOf(
        [type],
        "该类型没有判据表条目，也没有登记机械值，不按任何兜底状态放行",
      ));
    }
  }
  return gaps;
}

const RELATION_EXPANSION_MAX = 6;

function relationExpansionsOf(hitCards, pool, scopedFacts, criteria) {
  const poolByRef = new Map(pool.map((fact) => [fact.ref, fact]));
  const scopeByRef = new Map(scopedFacts.map((fact) => [fact.ref, fact]));
  const items = [];
  const seen = new Set();
  let dropped = 0;
  for (const card of hitCards) {
    if (card.tier !== 0 || card.bareReference !== true) continue;
    if (!Array.isArray(card.structuralFields) || card.structuralFields.length === 0) continue;
    const source = poolByRef.get(card.ref);
    if (source === undefined) continue;
    const entry = criteria?.byType?.get(source.type) ?? null;
    if (entry === null) continue;
    if (entry.values.notApplicable["关系展开"]) continue;
    const edges = new Map(entry.values.relations.map((rel) => [rel.relationKey, rel.targets]));
    if (edges.size === 0) continue;
    const actual = Array.isArray(source.structural?.relationEdges)
      ? source.structural.relationEdges : [];
    for (const edge of actual) {
      const targets = edges.get(edge.relationKey);
      if (targets === undefined) continue;
      const target = scopeByRef.get(edge.targetUid) ?? null;
      let unresolvedReason = "";
      if (target === null) unresolvedReason = `目标不可解析：${edge.targetUid}`;
      else if (!targets.includes(target.type)) {
        unresolvedReason = `目标类型不在判据表：${target.type}（期望 ${targets.join("|")}）`;
      }
      const dedupeKey = `${target === null ? edge.targetUid : target.ref}\u0000${edge.relationKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (items.length >= RELATION_EXPANSION_MAX) {
        dropped += 1;
        continue;
      }
      items.push({
        kind: "relation",
        type: target === null ? "" : target.type,
        ref: target === null ? edge.targetUid : target.ref,
        title: target === null ? "" : target.title,
        status: target === null ? "" : target.status,
        path: target === null ? "" : target.path,
        excerpt: target === null ? "" : (excerptOf(target.excerptSource) || target.title),
        updatedAt: target === null ? "" : (target.updatedAt ?? ""),
        resolved: unresolvedReason === "",
        ...(unresolvedReason === "" ? {} : { unresolvedReason }),
        derivedFrom: {
          sourceRef: source.ref,
          sourceTitle: source.title,
          relationKey: edge.relationKey,
        },
        hitReason: unresolvedReason === ""
          ? `关系展开：${source.ref}+${edge.relationKey}`
          : `关系展开：${source.ref}+${edge.relationKey}（${unresolvedReason}）`,
      });
    }
  }
  return { items, dropped };
}

export async function baselineOnlyForAction(input = {}) {
  const root = input.root ?? join(import.meta.dirname, "..", "..");
  const budgetBytes = Number.isInteger(input.budgetBytes) && input.budgetBytes > 0
    ? input.budgetBytes : null;
  const factsDir = join(root, "ldvh-base");
  const factsReadable = await isReadableDir(factsDir);
  const facts = factsReadable ? await loadFacts(factsDir) : [];
  const enumeration = l0EnumerationOf(facts);
  const l0Plan = planL0Enumeration(
    enumeration.filter((segment) => segment.type !== "norm"),
    budgetBytes,
    RENDER_FIXED_OVERHEAD_BYTES,
  );
  return {
    ok: true,
    l0Enumeration: {
      order: [...L0_SEGMENT_ORDER],
      segments: l0Plan.segments,
      bytes: l0Plan.bytes,
      note: l0Plan.note,
      sourceUnreadable: !factsReadable,
      pitfallTotal: factsReadable ? countActivePitfalls(facts) : null,
    },
    provesApplicability: false,
    gaps: factsReadable ? [] : ["事实源不可读：项目内 ldvh-base/ 不存在或不可读，该源未检查"],
  };
}

export async function recallForAction(input = {}) {
  const action = typeof input.action === "string" ? input.action.trim() : "";
  if (action === "") {
    return { ok: false, error: { code: "recall/action_required", message: "动作描述必填" } };
  }
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 5;
  const budgetBytes = Number.isInteger(input.budgetBytes) && input.budgetBytes > 0
    ? input.budgetBytes : RECALL_DIRECT_BYTE_BUDGET;
  const explicitStatuses = Array.isArray(input.statuses) && input.statuses.length > 0
    ? input.statuses : null;
  const types = Array.isArray(input.types) ? input.types : null;
  const excludedTypes = Array.isArray(input.excludeTypes) ? input.excludeTypes : null;
  const facet = (name) => {
    const v = input[name];
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  const facetUid = facet("objectUid");
  const facetServes = facet("serves");
  const facetPriority = facet("priority");
  const facetDirectionKey = facet("directionKey");
  const facetRelationKey = facet("relationKey");
  const facetAttributionRef = facet("attributionRef");
  const appliedFacets = Object.entries({
    objectUid: facetUid,
    serves: facetServes,
    priority: facetPriority,
    directionKey: facetDirectionKey,
    relationKey: facetRelationKey,
    attributionRef: facetAttributionRef,
  }).filter(([, v]) => v !== null);

  const query = `${action} ${input.scope ?? ""}`.trim();
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return {
      ok: false,
      error: { code: "recall/no_tokens", message: "动作描述切不出可匹配的词，召回无从开始" },
    };
  }
  if (tokens.every((t) => isWeakToken(t))) {
    return {
      ok: false,
      error: { code: "recall/no_tokens", message: "动作描述只有虚字与跨词组合，无主题词，召回无从开始" },
    };
  }

  const root = input.root ?? join(import.meta.dirname, "..", "..");
  const specsSource = await resolveSpecsRoot(root);
  const criteria = await loadRecallCriteriaForRoot(root, specsSource);
  const statusPolicy = (type) => recallStatusPolicyOf(criteria, type);
  const statusAllowed = (type, status) => {
    if (explicitStatuses !== null) return explicitStatuses.includes(status);
    const policy = statusPolicy(type);
    if (policy.kind === "non-candidate" || policy.kind === "unregistered") return false;
    return policy.statuses.includes(status);
  };
  const factsDir = join(root, "ldvh-base");
  const [facts, factsReadable] = await Promise.all([
    loadFacts(factsDir, { criteria }),
    isReadableDir(factsDir),
  ]);
  const specs = [];

  const includeCarriers = input.includeCarriers !== false;
  const carrierSource = includeCarriers
    ? await matchRuntimeCarriers({ root, query, limit: RUNTIME_CARRIER_RECALL_LIMIT })
    : {
      ok: true,
      available: false,
      missing: false,
      dir: null,
      tier: null,
      carriers: [],
      counts: { scanned: 0, hits: 0, returned: 0 },
      truncated: false,
      invalid: [],
      note: "运行时机制载体未读取（includeCarriers:false）",
    };
  const allCarrierHits = carrierSource.carriers.map((carrier) => ({ ...carrier }));

  const scopedFacts = excludedTypes === null
    ? facts
    : facts.filter((c) => !excludedTypes.includes(c.type));
  const disabledCriteriaTypes = [...new Set(
    scopedFacts.filter((fact) => fact.machineCriteria === "disabled").map((fact) => fact.type),
  )].sort();
  const statusPolicyOfType = (type) => statusPolicy(type);
  const fallbackStatusTypes = criteria === null ? [] : [...new Set(
    scopedFacts
      .filter((fact) => REGISTERED_FACT_TYPES.includes(fact.type))
      .filter((fact) => statusPolicyOfType(fact.type).kind === "fallback")
      .map((fact) => fact.type),
  )].sort();
  const nonCandidateTypes = [...(criteria?.byType?.keys() ?? [])]
    .filter((type) => statusPolicyOfType(type).kind === "non-candidate")
    .sort();

  const sameText = (a, b) => typeof a === "string" && typeof b === "string"
    && a.toLowerCase() === b.toLowerCase();
  const pool = scopedFacts.filter((c) => {
    if (!REGISTERED_FACT_TYPES.includes(c.type)) return false;
    if (types !== null && !types.includes(c.type)) return false;
    if (!statusAllowed(c.type, c.status)) return false;
    if (facetUid !== null && !sameText(c.ref, facetUid)) return false;
    if (facetServes !== null && !sameText(c.structural?.serves, facetServes)) return false;
    if (facetPriority !== null && !sameText(c.structural?.priority, facetPriority)) return false;
    if (facetDirectionKey !== null && !sameText(c.structural?.directionKey, facetDirectionKey)) return false;
    if (facetAttributionRef !== null && !sameText(c.structural?.attributionRef, facetAttributionRef)) return false;
    if (facetRelationKey !== null) {
      const keys = c.structural?.relationKeys ?? [];
      if (!keys.some((k) => sameText(k, facetRelationKey))) return false;
    }
    return true;
  });

  const collect = (list, mapper) => {
    const df = cachedDocFreqOf(list);
    const effective = tokens.filter((token) => !isTooCommon(token, df, df.total));
    const queryTokens = effective.length > 0 ? effective : tokens;
    const corpusStats = cachedCorpusStatsOf(list);
    return list
    .map((c) => {
      const m = matchCandidate(queryTokens, c, corpusStats, query);
      return m === null ? null : {
        ...mapper(c),
        tier: m.tier,
        matchTierMeaning:
          "匹配层（命中了哪个字段），非 F0–F4 事实分层、非 L0–L4 规范读取分层（02 §9.1）",
        hits: m.hits,
        hitReason: m.hitReason,
        weakHit: m.weakHit === true,
        ...(m.structuralFields === undefined ? {} : { structuralFields: m.structuralFields }),
        ...(m.bareReference === true ? { bareReference: true } : {}),
        ...(m.shortForm === true ? { shortForm: true } : {}),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(a.weakHit === true) - Number(b.weakHit === true) ||
        a.tier - b.tier ||
        b.hits - a.hits ||
        statusRank(a.status) - statusRank(b.status) ||
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
        a.path.localeCompare(b.path),
    );
  };

  const allSpecHits = collect(specs, (c) => ({
    kind: "spec", ref: c.ref, title: c.title, path: c.path,
    specKey: c.specKey ?? null,
    headingPath: null,
    ...(c.absolutePath === undefined ? {} : { absolutePath: c.absolutePath }),
    positioning: c.positioning.slice(0, 160),
    source: {
      tier: specsSource === null ? null : specsSource.tier,
      contentFingerprint: contentFingerprintOfCached(c.text, c),
    },
  }));
  const allFactHits = collect(pool, (c) => ({
    kind: "fact", type: c.type, ref: c.ref, title: c.title, status: c.status, path: c.path,
    absolutePath: c.absolutePath,
    objectUid: c.objectUid ?? null,
    updatedAt: c.updatedAt ?? "",
    excerpt: excerptOf(c.excerptSource) || c.title,
    ...(structuralCardOf(c) === null ? {} : { structural: structuralCardOf(c) }),
    source: {
      tier: "project",
      contentFingerprint: contentFingerprintOfCached(c.fullText ?? c.body ?? "", c),
    },
  })).map((fact, index) => ({ fact, index }))
    .sort((a, b) => compareFactHits(a, b))
    .map((entry) => entry.fact);
  const relationExpansion = relationExpansionsOf(allFactHits, pool, scopedFacts, criteria);
  const factSelection = input.factSelection ?? null;
  let selectedFactHits = allFactHits;
  let sectioning = null;
  if (factSelection !== null) {
    const plan = selectFactsBySection(allFactHits, factSelection);
    selectedFactHits = plan.selected;
    sectioning = {
      order: Array.isArray(factSelection.order) ? [...factSelection.order] : [],
      total: Number.isInteger(factSelection.total) ? factSelection.total : null,
      kept: plan.selected.length,
      droppedByQuota: plan.droppedByQuota,
      droppedByTotal: plan.droppedByTotal,
      unassigned: plan.unassigned,
      unassignedByType: plan.unassignedByType,
      note: "分节与名额是交付次序，不是排序键：候选名次仍只由证据（weakHit/tier/hits/status/updatedAt/path）决定",
    };
  }
  const specHits = allSpecHits.slice(0, limit);
  const factHits = selectedFactHits.slice(0, limit);

  let used = 0;
  const estimateLineBytes = (item) => {
    const title = typeof item.title === "string" ? item.title : "";
    const reason = typeof item.hitReason === "string" ? item.hitReason : "";
    const path = typeof item.path === "string" ? item.path : "";
    const excerpt = typeof item.excerpt === "string" ? item.excerpt : "";
    const stableRef = typeof item.objectUid === "string" && item.objectUid !== ""
      ? ` · uid=${item.objectUid}`
      : (typeof item.specKey === "string" && item.specKey !== "" ? ` · key=${item.specKey}` : "");
    let structuralBytes = 0;
    if (item.structural !== null && typeof item.structural === "object") {
      const parts = [];
      for (const [key, value] of Object.entries(item.structural)) {
        if (value === null || value === undefined) continue;
        parts.push(Array.isArray(value) ? `${key}=${value.join("|")}` : `${key}=${value}`);
      }
      if (parts.length > 0) structuralBytes = Buffer.byteLength(` · ${parts.join(" / ")}`, "utf8");
    }
    return Buffer.byteLength(`${title}${reason}${path}${excerpt}${stableRef}`, "utf8")
      + structuralBytes + 8;
  };
  const l0AllSegments = l0EnumerationOf(scopedFacts);
  const l0PitfallTotal = countActivePitfalls(scopedFacts);
  const l0Plan = planL0Enumeration(
    l0AllSegments.filter((segment) => segment.type !== "norm"),
    budgetBytes,
    RENDER_FIXED_OVERHEAD_BYTES,
  );
  const l0Bytes = l0Plan.bytes;
  const usableBudget = Math.max(0, budgetBytes - RENDER_FIXED_OVERHEAD_BYTES - l0Bytes);
  const bothSources = specHits.length > 0 && factHits.length > 0;
  const specBudget = bothSources ? Math.floor(usableBudget * 0.6) : usableBudget;
  const fitsSpec = (item) => {
    const size = estimateLineBytes(item);
    if (used + size > specBudget) return false;
    used += size;
    return true;
  };
  const fits = (item) => {
    const size = estimateLineBytes(item);
    if (used + size > usableBudget) return false;
    used += size;
    return true;
  };
  const keptSpecs = specHits.filter(fitsSpec);
  const keptFacts = factHits.filter(fits);
  if (keptSpecs.length === 0 && keptFacts.length === 0) {
    const first = specHits[0] ?? factHits[0];
    if (first !== undefined) {
      used += estimateLineBytes(first);
      if (specHits.length > 0) keptSpecs.push(first);
      else keptFacts.push(first);
    }
  }
  const truncated =
    keptSpecs.length < allSpecHits.length || keptFacts.length < allFactHits.length;
  const overBudget =
    used + RENDER_FIXED_OVERHEAD_BYTES + l0Bytes > budgetBytes;

  const factSideUnreadable = !factsReadable;
  const carrierSideUnreadable = includeCarriers && carrierSource.missing === true;
  const sourceUnreadable = factSideUnreadable;
  const returnedCount = keptSpecs.length + keptFacts.length;
  const carrierReturnedCount = allCarrierHits.length;
  const recallCompletenessValue = (() => {
    const filteredOut = scopedFacts.length - pool.length > 0;
    if (sourceUnreadable && returnedCount === 0 && carrierReturnedCount === 0) return "unavailable";
    if (truncated || filteredOut || sourceUnreadable) return "partial";
    return "complete";
  })();


  return {
    ok: true,
    query: { action, scope: input.scope ?? "", tokens: tokens.length },
    specs: keptSpecs,
    facts: keptFacts,
    runtimeCarriers: {
      available: carrierSource.available === true,
      read: includeCarriers,
      tier: carrierSource.tier ?? null,
      dir: carrierSource.dir ?? null,
      candidates: allCarrierHits,
      counts: {
        scanned: carrierSource.counts.scanned,
        hits: carrierSource.counts.hits,
        returned: carrierReturnedCount,
      },
      truncated: carrierSource.truncated === true,
      missing: carrierSource.missing === true,
      invalid: carrierSource.invalid,
      note: carrierSource.note,
      locatorFields: ["canonicalPath", "readablePath", "entryIds"],
      provesApplicability: false,
    },
    l0Enumeration: {
      order: [...L0_SEGMENT_ORDER],
      segments: l0Plan.segments,
      bytes: l0Bytes,
      note: l0Plan.note,
      sourceUnreadable: factSideUnreadable,
      pitfallTotal: factSideUnreadable ? null : l0PitfallTotal,
    },
    truncated,
    overBudget,
    budget: { limitBytes: budgetBytes, usedBytes: used, limit },
    provesApplicability: false,
    coverage: "deterministic-token-match; may miss rephrasings; not exhaustive",
    partial: truncated,
    recallCompleteness: recallCompletenessValue,
    sectioning,
    relationExpansions: relationExpansion.items,
    relationExpansion: {
      count: relationExpansion.items.length,
      dropped: relationExpansion.dropped,
      max: RELATION_EXPANSION_MAX,
      note: "由精确引用命中对象的判据表关系边派生；不进 F2 候选计数、不占类型名额；目标不可解析者保留并标注",
    },
    criteria: {
      ok: criteria !== null && criteria.errors.length === 0,
      version: criteria === null ? null : criteria.version,
      errors: (criteria?.errors ?? []).map((error) => ({
        type: error.type ?? null,
        specId: error.specId ?? null,
        file: error.file ?? null,
        code: error.code,
        message: error.message,
      })),
      disabledTypes: disabledCriteriaTypes,
      fallbackTypes: fallbackStatusTypes,
      nonCandidateTypes,
      tier: criteria === null ? null : criteria.tier,
      note: criteria === null
        ? "判据表不可用（未找到规范源，也没有可用包内判据表数据文件）：类型点名／核心语义字段／关系展开全部停用，按 partial 口径披露"
        : `${criteria.tier === "package-data" ? "判据表来源：包内数据文件（由类型规范判据表构建期生成，非规范源原文）；" : "判据表来源：规范源（开发形态）；"}判据表不可用的类型已停用类型点名／核心语义字段／关系展开，按 partial 口径披露`,
    },
    counts: {
      specHits: allSpecHits.length,
      factHits: allFactHits.length,
      carrierHits: carrierSource.counts.hits,
      specsReturned: keptSpecs.length,
      factsReturned: keptFacts.length,
      carriersReturned: carrierReturnedCount,
      candidatesScanned: specs.length + pool.length,
      candidatesExcluded: scopedFacts.length - pool.length,
    },
    pagination: {
      limit,
      hasCursor: false,
      howToGetMore: "调大 limit 或缩小 action 描述范围后重新召回（本实现不持有跨调用游标）",
    },
    unchecked: {
      specs: diffByPath(allSpecHits, keptSpecs),
      facts: diffByPath(allFactHits, keptFacts),
      runtimeCarriers: (carrierSource.unchecked ?? []).map((carrier) => ({
        title: carrier.title,
        path: carrier.readablePath ?? carrier.canonicalPath,
        canonicalPath: carrier.canonicalPath,
      })),
    },
    gaps: [
      ...criteriaGapsOf(criteria, scopedFacts),
      ...[...allSpecHits, ...allFactHits].some((c) => c.source?.contentFingerprint?.value === undefined)
        ? ["部分载体内容指纹缺失"]
        : [],
      ...(recallCompletenessValue === "unavailable"
        ? ["完成范围：一源不可读且未取得任何候选，无法给出任何结果"]
        : []),
      ...(includeCarriers ? [] : ["运行时机制载体未读取（includeCarriers:false）"]),
      ...(carrierSideUnreadable
        ? ["运行时机制载体源缺失：项目内 plugin-specs/ 不存在或不可读，该源未检查"]
        : []),
      ...(carrierSource.invalid.length > 0
        ? [`运行时机制载体有 ${carrierSource.invalid.length} 份未能解析：${carrierSource.invalid.map((item) => item.file ?? "?").join("、")}`]
        : []),
      ...(carrierSource.truncated === true
        ? [`运行时机制载体侧按相关度截断：命中 ${carrierSource.counts.hits} 份，返回 ${carrierSource.counts.returned} 份`]
        : []),
      ...(factSideUnreadable
        ? ["事实源不可读：项目内 ldvh-base/ 不存在或不可读，该源未检查"]
        : []),
      "既有行动结构路由未实现（10 §5.3 要求；无可路由载体，见 limitations.unimplemented）",
      ...(() => {
        const unknown = scopedFacts.filter((fact) => !REGISTERED_FACT_TYPES.includes(fact.type));
        if (unknown.length === 0) return [];
        const byType = [...new Set(unknown.map((fact) => fact.type))].sort();
        return [
          `未登记事实类型被排除在召回外：${byType.join("、")}（共 ${unknown.length} 条）。` +
            `这不表示该类事实不存在——是白名单未收录，须按 20–26 的类型规范同步 REGISTERED_FACT_TYPES`,
        ];
      })(),
    ],
    f0: {
      countsByTypeStatus: facts.reduce((acc, fact) => {
        acc[fact.type] ??= {};
        acc[fact.type][fact.status] = (acc[fact.type][fact.status] ?? 0) + 1;
        return acc;
      }, {}),
      totalObjects: facts.length,
      coverage: {
        scanned: specs.length + pool.length,
        totalLoaded: specs.length + facts.length,
        notScanned: scopedFacts.length - pool.length,
        notInScope: facts.length - scopedFacts.length,
      },
      typesPresent: [...new Set(facts.map((fact) => fact.type))].sort(),
      setAudit: {
        status: specs.length + facts.length === 0 ? "unavailable" : "complete",
        notCompleted: specs.length + facts.length === 0
          ? ["事实源未读到"]
          : [],
        note: "本实现一次读完全部载体（不建索引、不分页载入），故载入阶段无部分完成状态；本次召回的截断另见 recallCompleteness",
      },
    },
    uncheckedRange: {
      excludedByTypeFilter: types === null ? [] : scopedFacts
        .filter((fact) => REGISTERED_FACT_TYPES.includes(fact.type))
        .filter((fact) => !types.includes(fact.type))
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      excludedByStatus: scopedFacts
        .filter((fact) => types === null || types.includes(fact.type))
        .filter((fact) => statusPolicyOfType(fact.type).kind !== "non-candidate")
        .filter((fact) => statusPolicyOfType(fact.type).kind !== "unregistered")
        .filter((fact) => !statusAllowed(fact.type, fact.status))
        .map((fact) => ({ type: fact.type, status: fact.status, title: fact.title, path: fact.path })),
      excludedByNonCandidate: scopedFacts
        .filter((fact) => types === null || types.includes(fact.type))
        .filter((fact) => {
          const kind = statusPolicyOfType(fact.type).kind;
          return kind === "non-candidate" || kind === "unregistered";
        })
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      excludedByFacet: appliedFacets.length === 0 ? [] : scopedFacts
        .filter((fact) => REGISTERED_FACT_TYPES.includes(fact.type))
        .filter((fact) => types === null || types.includes(fact.type))
        .filter((fact) => statusAllowed(fact.type, fact.status))
        .filter((fact) => !pool.includes(fact))
        .map((fact) => ({
          type: fact.type,
          status: fact.status,
          title: fact.title,
          path: fact.path,
          values: Object.fromEntries(appliedFacets.map(([name]) => {
            if (name === "objectUid") return [name, fact.ref ?? null];
            if (name === "relationKey") {
              return [name, (fact.structural?.relationKeys ?? []).length > 0
                ? fact.structural.relationKeys : null];
            }
            const key = {
              serves: "serves", priority: "priority",
              directionKey: "directionKey", attributionRef: "attributionRef",
            }[name];
            const v = key === undefined ? undefined : fact.structural?.[key];
            return [name, typeof v === "string" && v !== "" ? v : null];
          })),
        })),
      appliedFacets: Object.fromEntries(appliedFacets),
      excludedByTypeWhitelist: scopedFacts
        .filter((fact) => !REGISTERED_FACT_TYPES.includes(fact.type))
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      excludedByScope: excludedTypes === null ? [] : facts
        .filter((fact) => excludedTypes.includes(fact.type))
        .map((fact) => ({ type: fact.type, title: fact.title, path: fact.path })),
      scopeExcluded: excludedTypes === null ? null : {
        types: [...excludedTypes],
        entryByType: Object.fromEntries(
          excludedTypes.map((type) => {
            const entry = SCOPE_EXCLUDED_ENTRY_BY_TYPE[type];
            if (typeof entry !== "string" || entry === "") {
              throw new Error(
                `召回：类型「${type}」被声明为排除，但 SCOPE_EXCLUDED_ENTRY_BY_TYPE 没有它的主动查入口——`
                + "新增排除类型时须同时登记入口，不得让读者停留在「须另行查询」",
              );
            }
            return [type, entry];
          }),
        ),
      },
      sourceNotRead: [
        "specs/ 需求文档不进入运行期召回（只作判据表构建期来源；正文用常规文件读取，不分层）",
        ...(factSideUnreadable ? ["事实源（项目内 ldvh-base/ 不存在或不可读，未读取）"] : []),
        ...(includeCarriers ? [] : ["运行时机制载体（includeCarriers:false，未读取）"]),
        ...(carrierSideUnreadable ? ["运行时机制载体（项目内 plugin-specs/ 不存在或不可读，未读取）"] : []),
      ],
      note: `本次实际扫描：specs/ 仅作判据表来源、不召回候选；${factSideUnreadable ? "事实源 ldvh-base/ 不存在或不可读（未扫描）" : "事实源（项目内 ldvh-base/）"}；${!includeCarriers ? "运行时机制载体未读取（includeCarriers:false）" : carrierSideUnreadable ? "运行时机制载体 plugin-specs/ 不存在或不可读（未扫描）" : `运行时机制载体（plugin-specs/，${carrierSource.counts.scanned} 份）`}。其它目录、其它 worktree、回退来源之外的语料均未检查`,
    },
    ranking: {
      keys: ["tier", "hits", "path"],
      usesWeights: true,
      usesSimilarity: false,
      usesEmbedding: false,
      usesAiJudgement: false,
      truncationIsNotJudgement: true,
      note: "tier 是字段位置（确定性）；hits 是跨层命中词经 idf 加权的厚度（可复算，但非标准 BM25，tf 恒为 1，跨源不可比），path 仅为稳定输出；limit 截断只表示排得靠后，不表示不相关",
    },
    fingerprint: fingerprintOf([...specs, ...facts]),
    limitations: {
      lexicalOnly: true,
      usesSemanticUnderstanding: false,
      measuredSymptomSelfRecall: {
        hits: 46,
        total: 47,
        measuredAt: "2026-11-03",
        discriminatingPower: "none",
        why: "测「正文→自身标题」，与用户口吻查询不同距离；双版本同为 24/24 而真实精确率 13.9%→10.5%，故不得据此判断召回质量。质量基线见 test/recall-quality.test.mjs",
      },
      insufficientForConsumptionPoints: [
        "25 §12 故障调查：可召回「表现相近」的 Pitfall，但「是否同一机制」须由消费方语义判断——本模块只提供候选",
      ],
      unimplemented: [
        {
          item: "既有行动结构路由",
          requiredBy: "10 §5.3（行动前引导入口须提供事实候选与既有行动结构路由）",
          reason: "无可路由载体：03 §11.4 声明旧行动模板规范已退出且其内容在 §9 承接前不取得规范效力；ldvh-base/ 下无 action/template 类事实类型",
          status: "unavailable-until-carrier-exists",
        },
      ],
    },
    sourceView: {
      specs: null,
      specsAreProjectAuthored: false,
      facts: { dir: join(root, "ldvh-base") },
      runtimeCarriers: includeCarriers && carrierSource.dir !== null
        ? { tier: carrierSource.tier, dir: carrierSource.dir, read: true }
        : { tier: null, dir: null, read: false },
    },
  };
}
