// dsh-ldvh — mechanical extraction of the upstream DSH contract surface.
//
// Authority: Norm `host-upgrade-followup` (norm-e188af99) step 3「契约差分」.
// The upstream repo commits THREE machine-readable generated artifacts, so the
// contract surface can be diffed WITHOUT parsing asar or reading source:
//
//   packages/extensions/tool-cordis/src/api-catalog.ts
//     → export const SERVICE_API / EVENT_API / TYPE_API  (server plane)
//   packages/extensions/cordis-client-runner/src/client/slot-catalog.ts
//     → export const CLIENT_SLOT_API                     (client slot plane)
//   docs/upgrade-guide/v<version>/<item>/guide.md        (official break notes)
//
// All three are `Generated — do not edit by hand`, freshness-gated by the
// upstream CI (`verify-cordis-api` / `verify-client-catalog`), so they cannot
// silently diverge from the source they are generated from. This module is the
// single home for reading them; the diff script (scripts/host-contract-diff.mjs)
// and its tests both consume it, so the parse rule lives in one reviewable place
// (specs/06 单一实现原则).
//
// PARSE STRATEGY — bracket depth, not a TS AST. The catalogs are data literals
// with a fixed 2-space shape (`  {` … `  },` at array top level). A TS parser
// would be a second dependency for no gain: we only need the top-level entry
// boundaries and one identifier field per entry. The parser FAILS CLOSED — a
// malformed catalog raises, it never returns a short list (Norm step 3:
// 「解析失败时报不可判定并停止，不得降级为零变更」).

/** Catalog file paths relative to the upstream repo root. */
export const CATALOG_PATHS = Object.freeze({
  api: "packages/extensions/tool-cordis/src/api-catalog.ts",
  slot: "packages/extensions/cordis-client-runner/src/client/slot-catalog.ts",
  upgradeGuideRoot: "docs/upgrade-guide",
});

/** The three server-plane arrays inside api-catalog.ts and their identity field. */
export const API_ARRAYS = Object.freeze([
  { name: "SERVICE_API", idField: "key" },
  { name: "EVENT_API", idField: "name" },
  { name: "TYPE_API", idField: "name" },
]);

/** The client slot array inside slot-catalog.ts and its identity field. */
export const SLOT_ARRAY = Object.freeze({ name: "CLIENT_SLOT_API", idField: "key" });

/**
 * 每张 catalog 表的字段分层：哪些是**契约字段**（变了即契约变更），哪些是
 * **噪音/文档字段**（变了不构成契约变更，单列不并入三态）。这是三态判定有
 * 意义的前提——不分层，槽位表会因 standardProps（框架级 hook 席位，对所有
 * 槽位统一变化）与 source（行号指针）而全表「变更」，真信号被噪音淹没。
 *
 * 实测依据（0.2.1-rc.5→0.2.2-rc.1 槽位表 103 条共有条目全变）：漂移集中在
 * standardProps(103) 与 source(57)，二者皆非「本插件注册进去的契约」；契约字段
 * registerOptions/ownerProps/keyDomain/kind/scope 才是 registrant 读的形状。
 * 与解析器同居于此，使「catalog 怎么读」与「哪些字段算契约」是单一来源。
 */
export const FIELD_LAYERS = Object.freeze({
  SERVICE_API: {
    contract: ["key", "methods"],
    noise: ["summary", "description"],
  },
  EVENT_API: {
    contract: ["name", "mode", "signature", "parameters"],
    noise: ["summary", "description"],
  },
  TYPE_API: {
    contract: ["name", "declaration"],
    noise: [],
  },
  CLIENT_SLOT_API: {
    // registrant 读到的注册形状与键域 = 契约
    contract: ["key", "kind", "scope", "registerOptions", "ownerProps", "ownerPropsReferences", "keyDomain", "hookContext", "slotInject", "replaceRisk"],
    // occupants=组合态(谁是邻座)、declaredBy=挂载者、example=示例、summary/doc=散文、source=行号、standardProps=框架级hook席位(对所有槽位统一变)
    noise: ["occupants", "declaredBy", "example", "summary", "doc", "source", "standardProps"],
  },
});

/**
 * Extract the source text of one top-level `export const NAME … = [ … ]` array.
 *
 * Scans from the declaration to its matching close bracket by depth counting,
 * honouring string literals (single, double, backtick) and `//` / block comments
 * so a bracket or quote inside a doc string cannot shift the boundary. Returns
 * the text BETWEEN the outer `[` and `]` (exclusive).
 *
 * @param {string} source - full file text
 * @param {string} name - the exported const name
 * @returns {string} the array body (entries, without the outer brackets)
 * @throws when the declaration or its balanced close is absent (fail-closed)
 */
export function extractArrayBody(source, name) {
  const declRe = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[`, "u");
  const m = declRe.exec(source);
  if (m === null) throw new Error(`catalog: declaration for ${name} not found`);
  let i = m.index + m[0].length; // just past the opening '['
  const start = i;
  let depth = 1;
  let strQuote = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (strQuote !== null) {
      if (c === "\\") { i += 2; continue; }
      if (c === strQuote) strQuote = null;
      i += 1; continue;
    }
    if (c === "/" && next === "/") { i = source.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && next === "*") { const end = source.indexOf("*/", i + 2); i = end < 0 ? source.length : end + 2; continue; }
    if (c === "'" || c === '"' || c === "`") { strQuote = c; i += 1; continue; }
    if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i);
    }
    i += 1;
  }
  throw new Error(`catalog: unbalanced array for ${name}`);
}

/**
 * Split one array body into its top-level entry objects (the `{ … }` blocks at
 * depth 0 within the body). Same string/comment-aware depth walk as
 * extractArrayBody, so nested braces inside a `declaration:` string do not
 * create phantom entries.
 *
 * @param {string} body - text between the outer brackets
 * @returns {string[]} one source text per top-level entry
 */
export function splitTopLevelEntries(body) {
  const entries = [];
  let i = 0;
  let depth = 0;
  let entryStart = -1;
  let strQuote = null;
  while (i < body.length) {
    const c = body[i];
    const next = body[i + 1];
    if (strQuote !== null) {
      if (c === "\\") { i += 2; continue; }
      if (c === strQuote) strQuote = null;
      i += 1; continue;
    }
    if (c === "/" && next === "/") { const nl = body.indexOf("\n", i); i = nl < 0 ? body.length : nl; continue; }
    if (c === "/" && next === "*") { const end = body.indexOf("*/", i + 2); i = end < 0 ? body.length : end + 2; continue; }
    if (c === "'" || c === '"' || c === "`") { strQuote = c; i += 1; continue; }
    if (c === "{" || c === "[") {
      if (depth === 0 && c === "{") entryStart = i;
      depth += 1;
    } else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0 && entryStart >= 0) { entries.push(body.slice(entryStart, i + 1)); entryStart = -1; }
    }
    i += 1;
  }
  if (depth !== 0) throw new Error("catalog: unbalanced entry braces in body");
  return entries;
}

/**
 * Read the identity field (`key:` or `name:`) of one entry, first occurrence at
 * the entry's own top level. Values are single-quoted in the generated catalog;
 * both quote styles are accepted.
 *
 * @param {string} entry - one entry's source text
 * @param {string} idField - 'key' or 'name'
 * @returns {string} the identifier value
 * @throws when the field is absent (fail-closed — never a silent empty id)
 */
export function readEntryId(entry, idField) {
  const re = new RegExp(`(?:^|[\\n{,])\\s*${idField}:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`, "u");
  const m = re.exec(entry);
  if (m === null) throw new Error(`catalog: entry has no ${idField} field: ${entry.slice(0, 60)}`);
  return m[2].replace(/\\(['"`\\])/gu, "$1");
}

/**
 * Parse one catalog array into an ordered id list plus a per-id raw-entry map.
 *
 * @param {string} source - full catalog file text
 * @param {{name:string, idField:string}} arraySpec - which array, which id field
 * @returns {{ids: string[], entries: Map<string,string>}} ids in source order
 * @throws when the array is absent, unbalanced, or any entry lacks its id field
 */
export function parseCatalogArray(source, arraySpec) {
  const body = extractArrayBody(source, arraySpec.name);
  const raw = splitTopLevelEntries(body);
  const ids = [];
  const entries = new Map();
  for (const entry of raw) {
    const id = readEntryId(entry, arraySpec.idField);
    if (entries.has(id)) throw new Error(`catalog: duplicate ${arraySpec.idField} '${id}' in ${arraySpec.name}`);
    ids.push(id);
    entries.set(id, entry);
  }
  return { ids, entries };
}

/**
 * Advance one line's brace/bracket depth, honouring string literals and
 * comments so a `{` or `}` inside a doc string (or after `//`) cannot move the
 * boundary. Mirrors the scanning rule of {@link splitTopLevelEntries} so both
 * agree on what "the entry's own top level" means.
 *
 * @param {string} line - one physical line, WITHOUT its newline
 * @param {{depth:number, strQuote:string|null, blockComment:boolean}} state - mutated in place
 */
function scanLineDepth(line, state) {
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const next = line[i + 1];
    if (state.blockComment) {
      const end = line.indexOf("*/", i);
      if (end < 0) return;
      state.blockComment = false;
      i = end + 2;
      continue;
    }
    if (state.strQuote !== null) {
      if (c === "\\") { i += 2; continue; }
      if (c === state.strQuote) state.strQuote = null;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") return; // rest of the line is a comment
    if (c === "/" && next === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end < 0) { state.blockComment = true; return; }
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { state.strQuote = c; i += 1; continue; }
    if (c === "{" || c === "[") state.depth += 1;
    else if (c === "}" || c === "]") state.depth -= 1;
    i += 1;
  }
}

/**
 * Split one entry's source text into its top-level `field: value` pairs.
 *
 * The generated catalogs write one field per physical line at 4-space indent
 * (`    key: 'x',`); a field's value may span many physical lines (the
 * `methods:` / `ownerProps:` literals), and string values carry `\n` ESCAPED.
 *
 * **Depth-aware, not "first close line wins".** A field line is recognised
 * only while the scan sits at the entry's own top level (depth 1), and the
 * entry ends only when the depth returns to 0. Matching a bare `^\\s*\\},?$`
 * line instead — the earlier implementation — truncated every multi-line field
 * at its FIRST nested `      },`, so `methods:` yielded just the first method.
 * That silently collapsed the whole service-method surface to one comparable
 * entry and made real breaking changes read as "no change" (measured on
 * dsh-v0.2.2-rc.1→rc.2: `ctx.subagents.list()` removal was reported as
 * 破坏「无」). Fail-closed reasoning does not help here — a truncated parse
 * still looks like a successful parse — so the depth rule is load-bearing.
 *
 * @param {string} entry - one entry's source text (`{ … }`)
 * @returns {Map<string,string>} field name → value text (trimmed, quotes kept)
 * @throws when no field line is found (fail-closed)
 */
export function parseEntryFields(entry) {
  const FIELD_LINE = /^ {4}([A-Za-z_$][\w$]*): ?/u;
  const lines = entry.split("\n");
  const fields = new Map();
  const state = { depth: 0, strQuote: null, blockComment: false };
  let currentKey = null;
  let buf = [];
  const flush = () => {
    if (currentKey !== null) fields.set(currentKey, buf.join("\n").replace(/,\s*$/u, "").trim());
  };
  for (const line of lines) {
    // Probe first: the line that closes the entry (depth 1 → 0) belongs to no
    // field, so it must be recognised BEFORE it can be appended to one.
    const probe = { ...state };
    scanLineDepth(line, probe);
    if (probe.depth === 0) break;
    const atEntryTopLevel = state.depth === 1 && state.strQuote === null && !state.blockComment;
    const m = atEntryTopLevel ? FIELD_LINE.exec(line) : null;
    if (m !== null) {
      flush();
      currentKey = m[1];
      buf = [line.slice(m[0].length)];
    } else if (currentKey !== null) {
      buf.push(line.trim());
    }
    state.depth = probe.depth;
    state.strQuote = probe.strQuote;
    state.blockComment = probe.blockComment;
  }
  flush();
  if (fields.size === 0) throw new Error("catalog: entry has no parseable fields");
  return fields;
}
