import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseAllDocuments } from "yaml";

export const RUNTIME_CARRIER_DIR = "plugin-specs";

export const RUNTIME_CARRIER_REQUIRED_FIELDS = Object.freeze([
  "spec_key",
  "spec_kind",
  "title",
  "canonical_path",
  "positioning",
  "scope",
]);

export const RUNTIME_CARRIER_RECALL_LIMIT = 3;

export const RUNTIME_CARRIER_ROUTE_LIMIT = 8;

export const RUNTIME_CARRIER_ENTRY_LIMIT = 5;

const SPEC_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const YAML_FILE_PATTERN = /\.ya?ml$/i;

const SCENE_STOP_TOKENS = new Set([
  "任何", "规范", "写作", "执行", "测试", "验证", "校验", "检查", "复核", "审核",
  "独立", "事实", "系统", "机制", "业务", "流程", "结果", "问题", "情况", "内容",
  "文件", "这份", "本文", "时候", "什么", "怎么", "这些", "那些", "一个", "以及",
  "或者", "并且", "要求", "判断", "记录", "行动", "需要", "可以", "不得", "查阅",
  "运行", "载体", "索引", "条目", "时候", "该读", "哪份", "哪里", "这里", "那里",
  "使用", "进行", "按照", "根据", "是否", "有的", "没有", "已经", "还是",
  "一条", "要我", "要写", "这个", "那条", "这条", "写一", "读",
]);

const FUNCTION_CHARS = new Set(
  "的了是在和与或一个这对就也都是而把被让从到向但并且还又会能要可以不没无这那什么你我他她它们所因如果现之其等该者",
);

const CJK_RUN = /[\u3400-\u9fff]+/g;
const ALNUM_RUN = /[a-z0-9][a-z0-9._-]*/g;

export function tokenizeScene(text) {
  if (typeof text !== "string" || text === "") return [];
  const tokens = new Set();
  for (const match of text.toLowerCase().matchAll(ALNUM_RUN)) {
    if (match[0].length >= 2) tokens.add(match[0]);
  }
  for (const run of text.match(CJK_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (FUNCTION_CHARS.has(bigram[0]) && FUNCTION_CHARS.has(bigram[1])) continue;
      tokens.add(bigram);
    }
    if (run.length === 1 && !FUNCTION_CHARS.has(run)) tokens.add(run);
  }
  return [...tokens].filter((token) => !SCENE_STOP_TOKENS.has(token));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

function parseErrorReason(error) {
  if (error === null || typeof error !== "object") return String(error);
  const line = error.linePos?.[0];
  const position = line === undefined ? "" : ` (line ${line.line}, column ${line.col})`;
  return `${String(error.message ?? error)}${position}`;
}

export function parseRuntimeCarrier(text, { file = null } = {}) {
  if (typeof text !== "string" || text.trim() === "") {
    return failure("carrier/empty_document", "the carrier document is empty", { file });
  }
  let documents;
  try {
    documents = parseAllDocuments(text);
  } catch (error) {
    return failure("carrier/parse_failed", parseErrorReason(error), { file });
  }
  if (documents.length !== 1) {
    return failure(
      "carrier/parse_failed",
      `the carrier file must hold exactly one YAML document, found ${documents.length}`,
      { file },
    );
  }
  const document = documents[0];
  if (document.errors.length > 0) {
    return failure("carrier/parse_failed", parseErrorReason(document.errors[0]), { file });
  }
  let root;
  try {
    root = document.toJS();
  } catch (error) {
    return failure("carrier/parse_failed", parseErrorReason(error), { file });
  }
  if (!isPlainObject(root) || !isPlainObject(root.ldvh_spec)) {
    return failure("carrier/structure_invalid", "the document must hold a single mapping under ldvh_spec", { file });
  }
  const block = root.ldvh_spec;
  for (const field of RUNTIME_CARRIER_REQUIRED_FIELDS) {
    if (!Object.hasOwn(block, field) || !nonEmptyString(block[field])) {
      return failure("carrier/identity_missing", `identity field "${field}" is missing or empty`, { file });
    }
  }
  if (!SPEC_KEY_PATTERN.test(block.spec_key)) {
    return failure("carrier/identity_invalid", `spec_key ${JSON.stringify(block.spec_key)} is not lowercase kebab-case`, { file });
  }
  if (block.spec_kind !== "spec") {
    return failure("carrier/identity_invalid", `spec_kind must be "spec", got ${JSON.stringify(block.spec_kind)}`, { file });
  }
  const expectedPath = `${RUNTIME_CARRIER_DIR}/${block.spec_key}.yaml`;
  if (block.canonical_path !== expectedPath) {
    return failure(
      "carrier/path_mismatch",
      `canonical_path must equal ${JSON.stringify(expectedPath)}, got ${JSON.stringify(block.canonical_path)}`,
      { file },
    );
  }
  if (block.role !== undefined && block.role !== "router") {
    return failure("carrier/role_invalid", `role may only be "router", got ${JSON.stringify(block.role)}`, { file });
  }
  if (!Array.isArray(block.requirements)) {
    return failure("carrier/requirements_invalid", "requirements must be a list of requirement entries", { file });
  }
  const requirements = [];
  const seenIds = new Set();
  for (let index = 0; index < block.requirements.length; index += 1) {
    const entry = block.requirements[index];
    if (!isPlainObject(entry)) {
      return failure("carrier/requirements_invalid", `requirements[${index}] is not a mapping`, { file });
    }
    for (const field of ["id", "title", "text"]) {
      if (!nonEmptyString(entry[field])) {
        return failure(
          "carrier/requirements_invalid",
          `requirements[${index}].${field} is missing or empty`,
          { file },
        );
      }
    }
    if (seenIds.has(entry.id)) {
      return failure("carrier/requirements_invalid", `requirement id ${JSON.stringify(entry.id)} appears more than once`, { file });
    }
    seenIds.add(entry.id);
    requirements.push({ id: entry.id, title: entry.title, text: entry.text });
  }
  return {
    ok: true,
    carrier: {
      specKey: block.spec_key,
      specKind: block.spec_kind,
      title: block.title,
      canonicalPath: block.canonical_path,
      positioning: block.positioning,
      scope: block.scope,
      role: block.role ?? null,
      requirements,
      file,
    },
  };
}

export async function resolveRuntimeCarrierRoot(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot === "") return null;
  const candidates = [
    { dir: join(projectRoot, RUNTIME_CARRIER_DIR), tier: "project" },
    { dir: join(import.meta.dirname, "..", RUNTIME_CARRIER_DIR), tier: "package" },
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.dir)) continue;
    seen.add(candidate.dir);
    let entries;
    try {
      entries = await readdir(candidate.dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
      throw error;
    }
    if (entries.some((entry) => entry.isFile() && YAML_FILE_PATTERN.test(entry.name))) {
      return candidate;
    }
  }
  return null;
}

export function readablePathOf(carrier, tier) {
  const absolutePath = typeof carrier?.absolutePath === "string" && carrier.absolutePath !== ""
    ? carrier.absolutePath
    : null;
  const canonicalPath = typeof carrier?.canonicalPath === "string" && carrier.canonicalPath !== ""
    ? carrier.canonicalPath
    : null;
  if (tier === "package" && absolutePath !== null) {
    return { path: absolutePath, kind: "absolute" };
  }
  if (canonicalPath !== null) return { path: canonicalPath, kind: "project-relative" };
  return { path: absolutePath, kind: absolutePath === null ? null : "absolute" };
}

function descriptorOf(carrier, tier = null) {
  const readable = readablePathOf(carrier, tier);
  return {
    specKey: carrier.specKey,
    title: carrier.title,
    canonicalPath: carrier.canonicalPath,
    absolutePath: carrier.absolutePath,
    readablePath: readable.path,
    readablePathKind: readable.kind,
    carrierRootTier: tier,
    positioning: carrier.positioning,
    scope: carrier.scope,
    role: carrier.role,
    requirementCount: carrier.requirements.length,
    requirementIds: carrier.requirements.map((entry) => entry.id),
    file: carrier.file,
  };
}

async function loadCarrierDocuments(projectRoot) {
  const source = await resolveRuntimeCarrierRoot(projectRoot);
  if (source === null) {
    return { dir: null, tier: null, missing: true, carriers: [], invalid: [] };
  }
  let entries;
  try {
    entries = await readdir(source.dir, { withFileTypes: true });
  } catch (error) {
    return {
      dir: source.dir,
      tier: source.tier,
      missing: false,
      carriers: [],
      invalid: [{ file: null, code: "carrier/directory_unreadable", reason: String(error?.message ?? error) }],
    };
  }
  const names = entries
    .filter((entry) => entry.isFile() && YAML_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const carriers = [];
  const invalid = [];
  for (const name of names) {
    const absolutePath = join(source.dir, name);
    let text;
    try {
      text = await readFile(absolutePath, "utf8");
    } catch (error) {
      invalid.push({ file: name, code: "carrier/unreadable", reason: String(error?.message ?? error) });
      continue;
    }
    const parsed = parseRuntimeCarrier(text, { file: name });
    if (parsed.ok !== true) {
      invalid.push({ file: name, code: parsed.error.code, reason: parsed.error.message });
      continue;
    }
    carriers.push({ ...parsed.carrier, absolutePath });
  }
  return {
    dir: source.dir,
    tier: source.tier,
    missing: false,
    carriers,
    invalid,
  };
}

export async function loadRuntimeCarrierIndex({ root } = {}) {
  const loaded = await loadCarrierDocuments(root);
  const carriers = loaded.carriers.map((carrier) => descriptorOf(carrier, loaded.tier));
  return {
    ok: true,
    available: !loaded.missing && carriers.length > 0,
    missing: loaded.missing,
    dir: loaded.dir,
    tier: loaded.tier,
    count: carriers.length,
    carriers,
    invalid: loaded.invalid,
    note: loaded.missing
      ? "运行时机制载体源未找到：项目内 plugin-specs/ 不存在或不可读"
      : `运行时机制载体索引：共 ${carriers.length} 份；只含定位字段，条目正文不随索引返回`,
  };
}

function insideResolved(base, candidate) {
  const offset = relative(base, candidate);
  if (offset === "" || offset === ".") return true;
  return !offset.startsWith("..") && !isAbsolute(offset);
}

async function realPathOrNull(value) {
  try {
    return await realpath(value);
  } catch {
    return null;
  }
}

async function insideDirectory(directory, target) {
  if (typeof directory !== "string" || directory === "") return false;
  const base = resolve(directory);
  const candidate = resolve(target);
  if (insideResolved(base, candidate)) return true;
  const [realBase, realCandidate] = await Promise.all([realPathOrNull(base), realPathOrNull(candidate)]);
  if (realBase === null || realCandidate === null) return false;
  return insideResolved(realBase, realCandidate);
}

function resolveRequestedPath({ root, carrierRootDir, rawPath }) {
  if (isAbsolute(rawPath)) return [resolve(rawPath)];
  const bases = [];
  if (typeof root === "string" && root !== "") bases.push(resolve(root));
  bases.push(resolve(dirname(carrierRootDir)));
  return [...new Set(bases.map((base) => resolve(base, rawPath)))];
}

export async function readRuntimeCarrier({ root, specKey, canonicalPath, path } = {}) {
  const requested = [
    nonEmptyString(specKey),
    nonEmptyString(canonicalPath),
    nonEmptyString(path),
  ].filter((given) => given).length;
  if (requested > 1) {
    return failure(
      "carrier/request_invalid",
      "a read request must carry exactly one of spec_key, canonical_path or path",
    );
  }
  if (requested === 0) {
    return failure("carrier/request_invalid", "a read request must carry a spec_key, a canonical_path or a path");
  }
  const loaded = await loadCarrierDocuments(root);
  if (loaded.missing) {
    return failure("carrier/source_missing", "the runtime carrier source is missing: plugin-specs/ is not readable");
  }
  const hasPath = nonEmptyString(path);
  const hasCanonicalPath = nonEmptyString(canonicalPath);
  let matches;
  if (hasPath) {
    const wanted = resolveRequestedPath({ root, carrierRootDir: loaded.dir, rawPath: path });
    matches = loaded.carriers.filter((carrier) => wanted.includes(resolve(carrier.absolutePath)));
    if (matches.length === 0 && !isAbsolute(path)) {
      matches = loaded.carriers.filter((carrier) => carrier.canonicalPath === path);
    }
    if (matches.length === 0) {
      const target = wanted[0];
      const escaped = !(await Promise.all(wanted.map((entry) => insideDirectory(loaded.dir, entry)))).some(Boolean);
      if (escaped) {
        return failure(
          "carrier/path_outside_root",
          `path ${JSON.stringify(path)} resolves outside the runtime carrier root ${JSON.stringify(loaded.dir)}`,
          { root: loaded.dir },
        );
      }
      return failure(
        "carrier/not_found",
        `no readable runtime carrier lives at path ${JSON.stringify(path)}`,
        { root: loaded.dir, resolved: target },
      );
    }
  } else {
    matches = hasCanonicalPath
      ? loaded.carriers.filter((carrier) => carrier.canonicalPath === canonicalPath)
      : loaded.carriers.filter((carrier) => carrier.specKey === specKey);
  }
  if (matches.length === 0) {
    const requestedFile = hasPath
      ? String(path).slice(String(path).lastIndexOf("/") + 1)
      : hasCanonicalPath
        ? canonicalPath.slice(canonicalPath.lastIndexOf("/") + 1)
        : `${specKey}.yaml`;
    const invalidHit = loaded.invalid.find((entry) => entry.file === requestedFile);
    if (invalidHit !== undefined) {
      return failure("carrier/parse_failed", invalidHit.reason, { file: invalidHit.file, code: invalidHit.code });
    }
    return failure(
      "carrier/not_found",
      hasCanonicalPath
        ? `no readable runtime carrier has canonical_path ${JSON.stringify(canonicalPath)}`
        : `no readable runtime carrier has spec_key ${JSON.stringify(specKey)}`,
    );
  }
  if (matches.length > 1) {
    return failure("carrier/ambiguous", "more than one runtime carrier matches the request");
  }
  const carrier = matches[0];
  const readable = readablePathOf(carrier, loaded.tier);
  return {
    ok: true,
    carrier: {
      specKey: carrier.specKey,
      specKind: carrier.specKind,
      title: carrier.title,
      canonicalPath: carrier.canonicalPath,
      positioning: carrier.positioning,
      scope: carrier.scope,
      role: carrier.role,
      requirements: carrier.requirements.map((entry) => ({ ...entry })),
      file: carrier.file,
      absolutePath: carrier.absolutePath,
      readablePath: readable.path,
      readablePathKind: readable.kind,
      carrierRootTier: loaded.tier,
      carrierRootDir: loaded.dir,
    },
    invalid: loaded.invalid,
  };
}

function tokenSetOfText(text) {
  return new Set(tokenizeScene(text));
}

function entryMatchOf(requirement, queryTokens) {
  const haystack = `${requirement.id} ${requirement.title} ${requirement.text}`;
  const haystackTokens = tokenSetOfText(haystack);
  const hits = queryTokens.filter((token) => haystackTokens.has(token));
  if (hits.length === 0) return null;
  return { id: requirement.id, title: requirement.title, hits };
}

function carrierMatchOf(carrier, queryTokens) {
  if (queryTokens.length === 0) return null;
  const fields = [
    { name: "spec_key", weight: 3, text: carrier.specKey, tier: 0 },
    { name: "title", weight: 3, text: carrier.title, tier: 1 },
    { name: "positioning", weight: 2, text: carrier.positioning, tier: 2 },
    { name: "scope", weight: 2, text: carrier.scope, tier: 2 },
  ];
  let score = 0;
  let tier = null;
  const reasons = [];
  for (const field of fields) {
    const fieldTokens = tokenSetOfText(field.text);
    const hits = queryTokens.filter((token) => fieldTokens.has(token));
    if (hits.length === 0) continue;
    score += hits.length * field.weight;
    tier = tier === null ? field.tier : Math.min(tier, field.tier);
    reasons.push(`${field.name} 命中「${hits.slice(0, 3).join("、")}」`);
  }
  const entryMatches = [];
  for (const requirement of carrier.requirements) {
    const match = entryMatchOf(requirement, queryTokens);
    if (match === null) continue;
    entryMatches.push(match);
    score += Math.min(match.hits.length, 3);
    if (tier === null) tier = 3;
  }
  if (score === 0 || entryMatches.length === 0) return null;
  entryMatches.sort((left, right) => right.hits.length - left.hits.length || left.id.localeCompare(right.id));
  const shownEntries = entryMatches.slice(0, RUNTIME_CARRIER_ENTRY_LIMIT);
  const reasonParts = [...reasons];
  reasonParts.push(`条目命中「${shownEntries.map((entry) => entry.id).join("、")}」`);
  return {
    tier: tier ?? 3,
    hits: score,
    hitReason: `载体索引${reasonParts.join("；")}`,
    carrier,
    entries: shownEntries.map((entry) => ({ id: entry.id, title: entry.title })),
    entryIds: shownEntries.map((entry) => entry.id),
    entryHitCount: entryMatches.length,
  };
}

function carrierCandidateOf(match, tier = null) {
  const readable = readablePathOf(match.carrier, tier);
  return {
    kind: "runtime-carrier",
    label: "载体条目",
    source: "runtime-carrier",
    ref: match.carrier.specKey,
    specKey: match.carrier.specKey,
    title: match.carrier.title,
    canonicalPath: match.carrier.canonicalPath,
    absolutePath: match.carrier.absolutePath,
    readablePath: readable.path,
    readablePathKind: readable.kind,
    carrierRootTier: tier,
    path: readable.path,
    positioning: match.carrier.positioning,
    scope: match.carrier.scope,
    role: match.carrier.role,
    entries: match.entries,
    entryIds: match.entryIds,
    entryHitCount: match.entryHitCount,
    tier: match.tier,
    matchTierMeaning: "载体索引字段位置（spec_key/title/positioning/scope/条目），非 F0–F4 事实分层、非 L0–L4 规范读取分层",
    hits: match.hits,
    hitReason: match.hitReason,
    provesApplicability: false,
    note: "载体条目候选只给定位引用（canonical_path／可读路径 + 条目 id），正文须按该引用读取；可读路径为 absolute 者可直接打开，为 project-relative 者相对项目根",
  };
}

export async function matchRuntimeCarriers({ root, query, limit = RUNTIME_CARRIER_RECALL_LIMIT } = {}) {
  const loaded = await loadCarrierDocuments(root);
  const queryTokens = tokenizeScene(typeof query === "string" ? query : "");
  const matched = [];
  if (!loaded.missing && queryTokens.length > 0) {
    for (const carrier of loaded.carriers) {
      const match = carrierMatchOf(carrier, queryTokens);
      if (match === null) continue;
      matched.push(carrierCandidateOf(match, loaded.tier));
    }
  }
  matched.sort(
    (left, right) =>
      left.tier - right.tier ||
      right.hits - left.hits ||
      left.specKey.localeCompare(right.specKey),
  );
  const requested = Number.isInteger(limit) && limit > 0 ? limit : RUNTIME_CARRIER_RECALL_LIMIT;
  const carriers = matched.slice(0, requested);
  const unchecked = matched.slice(requested).map((carrier) => ({
    specKey: carrier.specKey,
    title: carrier.title,
    canonicalPath: carrier.canonicalPath,
    absolutePath: carrier.absolutePath,
    readablePath: carrier.readablePath,
    readablePathKind: carrier.readablePathKind,
    entryIds: carrier.entryIds,
  }));
  return {
    ok: true,
    available: !loaded.missing,
    missing: loaded.missing,
    dir: loaded.dir,
    tier: loaded.tier,
    carriers,
    unchecked,
    counts: {
      scanned: loaded.carriers.length,
      hits: matched.length,
      returned: carriers.length,
    },
    truncated: matched.length > carriers.length,
    invalid: loaded.invalid,
    note: "载体侧候选按索引字段与条目词面确定性匹配；索引正文不随候选返回，按 canonical_path 或可读路径 + 条目 id 读取",
  };
}

function canonicalPathsIn(text) {
  const matches = String(text).match(/plugin-specs\/[a-z0-9][a-z0-9-]*\.ya?ml/g) ?? [];
  return [...new Set(matches)];
}

function routerRouteOf(carrier, queryTokens, descriptorsByPath) {
  const routes = [];
  for (const entry of carrier.requirements) {
    const paths = canonicalPathsIn(entry.text);
    if (paths.length !== 1) continue;
    const targetPath = paths[0];
    const sceneText = entry.text.replace(targetPath, " ");
    const sceneTokens = tokenSetOfText(sceneText);
    const hits = queryTokens.filter((token) => sceneTokens.has(token));
    if (hits.length === 0) continue;
    const target = descriptorsByPath.get(targetPath);
    if (target === undefined) {
      routes.push({
        ok: false,
        entryId: entry.id,
        targetPath,
        hits: hits.length,
        reason: `路由条目「${entry.id}」指向的路径不在当前语料中：${targetPath}`,
      });
      continue;
    }
    routes.push({
      ok: true,
      entryId: entry.id,
      entryTitle: entry.title,
      target,
      targetPath,
      hits: hits.length,
      reason: `路由条目「${entry.id}」命中「${hits.slice(0, 3).join("、")}」；目标 ${targetPath}`,
    });
  }
  routes.sort((left, right) => right.hits - left.hits || String(left.entryId).localeCompare(String(right.entryId)));
  return routes;
}

export async function routeRuntimeCarriers({ root, scene, limit = RUNTIME_CARRIER_ROUTE_LIMIT } = {}) {
  const loaded = await loadCarrierDocuments(root);
  const queryTokens = tokenizeScene(typeof scene === "string" ? scene : "");
  const routers = loaded.carriers.filter((carrier) => carrier.role === "router");
  const warnings = [];
  if (routers.length > 1) {
    warnings.push(`语料中包含 ${routers.length} 份 role: router 载体，违反至多一份的要求；本次只用 ${routers[0].specKey}`);
  }
  const requested = Number.isInteger(limit) && limit > 0 ? limit : RUNTIME_CARRIER_ROUTE_LIMIT;
  if (routers.length > 0 && queryTokens.length > 0) {
    const descriptorsByPath = new Map(
      loaded.carriers.map((carrier) => [carrier.canonicalPath, descriptorOf(carrier, loaded.tier)]),
    );
    const router = routers[0];
    const routes = routerRouteOf(router, queryTokens, descriptorsByPath);
    const unresolved = routes.filter((route) => route.ok !== true);
    const resolved = routes.filter((route) => route.ok === true);
    const candidates = resolved.slice(0, requested).map((route) => ({
      ...route.target,
      routeEntryId: route.entryId,
      routeEntryTitle: route.entryTitle,
      targetPath: route.targetPath,
      reason: route.reason,
      heuristic: false,
    }));
    return {
      ok: true,
      method: "router",
      heuristic: false,
      router: router.specKey,
      routerPath: router.canonicalPath,
      available: true,
      candidates,
      counts: { routes: routes.length, resolved: resolved.length, returned: candidates.length },
      truncated: resolved.length > candidates.length,
      invalid: loaded.invalid,
      warnings,
      note: candidates.length > 0
        ? `按场景路由表 ${router.specKey} 的条目定位；路由只给目标路径，不载入目标正文，仍须读取被指向的载体`
        : `场景路由表 ${router.specKey} 存在，但本次场景未命中任何条目`,
      unresolved: unresolved.map((route) => ({ entryId: route.entryId, targetPath: route.targetPath, reason: route.reason })),
    };
  }
  const candidates = [];
  for (const carrier of loaded.carriers) {
    if (carrier.role === "router") continue;
    const match = carrierMatchOf(carrier, queryTokens);
    if (match === null) continue;
    candidates.push({
      ...descriptorOf(carrier, loaded.tier),
      reason: match.hitReason,
      heuristic: true,
      hits: match.hits,
    });
  }
  candidates.sort(
    (left, right) =>
      right.hits - left.hits ||
      left.specKey.localeCompare(right.specKey),
  );
  const shown = candidates.slice(0, requested);
  return {
    ok: true,
    method: candidates.length > 0 ? "heuristic" : "none",
    heuristic: true,
    router: null,
    routerPath: null,
    available: !loaded.missing,
    candidates: shown,
    counts: { routes: 0, resolved: candidates.length, returned: shown.length },
    truncated: candidates.length > shown.length,
    invalid: loaded.invalid,
    warnings,
    note: loaded.missing
      ? "运行时机制载体源未找到：plugin-specs/ 不存在或不可读"
      : candidates.length > 0
        ? "语料中暂无 role: router 的场景路由表；以下候选由各载体 positioning／scope／title 的词面命中给出，属启发式，不是权威路由"
        : "语料中暂无 role: router 的场景路由表，且词面启发式未命中任何载体",
    unresolved: [],
  };
}
