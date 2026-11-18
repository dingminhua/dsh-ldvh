
export const CATALOG_PATHS = Object.freeze({
  api: "packages/extensions/tool-cordis/src/api-catalog.ts",
  slot: "packages/extensions/cordis-client-runner/src/client/slot-catalog.ts",
  upgradeGuideRoot: "docs/upgrade-guide",
});

export const API_ARRAYS = Object.freeze([
  { name: "SERVICE_API", idField: "key" },
  { name: "EVENT_API", idField: "name" },
  { name: "TYPE_API", idField: "name" },
]);

export const SLOT_ARRAY = Object.freeze({ name: "CLIENT_SLOT_API", idField: "key" });

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
    contract: ["key", "kind", "scope", "registerOptions", "ownerProps", "ownerPropsReferences", "keyDomain", "hookContext", "slotInject", "replaceRisk"],
    noise: ["occupants", "declaredBy", "example", "summary", "doc", "source", "standardProps"],
  },
});

export function extractArrayBody(source, name) {
  const declRe = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[`, "u");
  const m = declRe.exec(source);
  if (m === null) throw new Error(`catalog: declaration for ${name} not found`);
  let i = m.index + m[0].length;
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

export function readEntryId(entry, idField) {
  const re = new RegExp(`(?:^|[\\n{,])\\s*${idField}:\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`, "u");
  const m = re.exec(entry);
  if (m === null) throw new Error(`catalog: entry has no ${idField} field: ${entry.slice(0, 60)}`);
  return m[2].replace(/\\(['"`\\])/gu, "$1");
}

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
    if (c === "/" && next === "/") return;
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
