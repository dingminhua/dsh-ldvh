
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const RECALL_CRITERIA_VERSION = "recall-criteria/v1";

export const RECALL_CRITERIA_BUNDLE_FILE = join(import.meta.dirname, "recall-criteria.bundle.json");

export const RECALL_CRITERIA_COLUMNS = Object.freeze([
  "判据项（recall-criteria/v1）",
  "本类型规则",
  "机械值",
  "依据/理由",
]);

export const RECALL_CRITERIA_ITEMS = Object.freeze([
  "召回时机",
  "默认候选状态",
  "核心语义字段",
  "类型词别名",
  "关系展开",
  "F3/F4 展开",
  "条数上限归属",
]);

export const RECALL_CRITERIA_MACHINE_ITEMS = Object.freeze([
  "默认候选状态",
  "核心语义字段",
  "类型词别名",
  "关系展开",
]);

export const RECALL_CRITERIA_NOT_APPLICABLE = "不采用";

export const FACT_TYPE_BY_SPEC_ID = Object.freeze({
  "20": "goal",
  "21": "subgoal",
  "22": "spark",
  "23": "norm",
  "24": "report",
  "25": "pitfall",
  "26": "friction",
});

export const FACTSOURCE_TYPE_KEYS = Object.freeze(Object.values(FACT_TYPE_BY_SPEC_ID));

export function typeKeyDerivedWords(typeKey) {
  const key = String(typeKey ?? "").trim().toLowerCase();
  if (key === "") return [];
  return [key, `${key}s`];
}

export function allTypeKeyDerivedWords() {
  const out = new Set();
  for (const key of FACTSOURCE_TYPE_KEYS) {
    for (const word of typeKeyDerivedWords(key)) out.add(word);
  }
  return out;
}


function splitTableRow(line) {
  const trimmed = line.trim();
  const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const cells = [];
  let cur = "";
  let escaped = false;
  for (const ch of body) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      cur += ch;
      escaped = true;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  if (trimmed.endsWith("|") && cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell) || cell === "");
}

function machineValueText(cell) {
  return String(cell ?? "").replace(/\\\|/g, "|").trim();
}

function splitCommaList(text) {
  return String(text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function uniqueViolations(values) {
  const seen = new Set();
  const dup = new Set();
  for (const value of values) {
    if (seen.has(value)) dup.add(value);
    seen.add(value);
  }
  return [...dup];
}


const STATUS_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_RE = /^[a-z][a-z0-9_]*$/;
const ALIAS_RE = /^[\p{L}\p{N}_-]+$/u;
const RELATION_KEY_RE = /^[a-z][a-z0-9-]*$/;
const TARGET_TYPE_RE = /^[a-z][a-z0-9_]*$/;

function error(code, message, extra = {}) {
  return { code, message, ...extra };
}

export function parseRecallCriteriaTable(text, options = {}) {
  const file = String(options.file ?? "");
  const specId = String(options.specId ?? "");
  const type = String(options.type ?? "");
  const lines = String(text ?? "").split(/\r?\n/);

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    if (line.includes("recall-criteria/")) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim().startsWith("|")) continue;
      const cells = splitTableRow(line);
      if (cells.length >= 3 && cells[0].startsWith("判据项") && cells.includes("机械值")) {
        headerIndex = i;
        break;
      }
    }
  }
  if (headerIndex < 0) {
    return {
      ok: false,
      file,
      specId,
      type,
      errors: [error("recall-criteria/missing_table", "载体中没有找到召回判据表（02 §12.4）", { file })],
    };
  }

  const headerLine = lines[headerIndex];
  const markers = headerLine.match(/recall-criteria\/[A-Za-z0-9._-]+/g) ?? [];
  if (markers.length === 0) {
    return {
      ok: false,
      file,
      specId,
      type,
      errors: [error(
        "recall-criteria/missing_version_marker",
        `判据表表头缺少版本标记 \`${RECALL_CRITERIA_VERSION}\`（02 §12.4）`,
        { file, header: headerLine.trim() },
      )],
    };
  }
  if (markers.length !== 1 || markers[0] !== RECALL_CRITERIA_VERSION) {
    return {
      ok: false,
      file,
      specId,
      type,
      errors: [error(
        "recall-criteria/unknown_version",
        `判据表版本不识别：${markers.join(" / ")}；本实现只认 \`${RECALL_CRITERIA_VERSION}\`（02 §12.4）`,
        { file, marker: markers.join(" / ") },
      )],
    };
  }

  const headerCells = splitTableRow(headerLine);
  if (
    headerCells.length !== RECALL_CRITERIA_COLUMNS.length
    || headerCells.some((cell, index) => cell !== RECALL_CRITERIA_COLUMNS[index])
  ) {
    return {
      ok: false,
      file,
      specId,
      type,
      errors: [error(
        "recall-criteria/bad_columns",
        `判据表列名或列序与契约不符：应为 ${RECALL_CRITERIA_COLUMNS.join(" | ")}，实得 ${headerCells.join(" | ")}（02 §12.4）`,
        { file, expected: [...RECALL_CRITERIA_COLUMNS], actual: headerCells },
      )],
    };
  }

  const separator = lines[headerIndex + 1];
  if (separator === undefined || !separator.trim().startsWith("|") || !isSeparatorRow(splitTableRow(separator))) {
    return {
      ok: false,
      file,
      specId,
      type,
      errors: [error(
        "recall-criteria/missing_separator",
        "判据表表头下一行不是 Markdown 表格分隔行（02 §12.4）",
        { file },
      )],
    };
  }

  const rows = [];
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    const cells = splitTableRow(line);
    if (isSeparatorRow(cells)) continue;
    if (cells.length !== 4) {
      return {
        ok: false,
        file,
        specId,
        type,
        errors: [error(
          "recall-criteria/bad_columns",
          `判据表第 ${i + 1} 行不是四列：${line.trim()}（02 §12.4）`,
          { file, line: i + 1 },
        )],
      };
    }
    rows.push({ line: i + 1, item: cells[0], rule: cells[1], machine: cells[2], basis: cells[3] });
  }

  const errors = [];
  const byItem = new Map();
  for (const row of rows) {
    if (!RECALL_CRITERIA_ITEMS.includes(row.item)) {
      errors.push(error(
        "recall-criteria/bad_item",
        `判据项「${row.item}」不在 v1 闭集内（02 §12.4）：${RECALL_CRITERIA_ITEMS.join("、")}`,
        { file, line: row.line, item: row.item },
      ));
      continue;
    }
    if (byItem.has(row.item)) {
      errors.push(error(
        "recall-criteria/duplicate_item",
        `判据项「${row.item}」重复登记（第 ${byItem.get(row.item).line} 行与第 ${row.line} 行）`,
        { file, item: row.item },
      ));
      continue;
    }
    byItem.set(row.item, row);
  }
  const missingItems = RECALL_CRITERIA_ITEMS.filter((item) => !byItem.has(item));
  if (missingItems.length > 0) {
    errors.push(error(
      "recall-criteria/missing_item",
      `判据表缺判据项（每类型须逐项登记、不得省行，02 §12.4）：${missingItems.join("、")}`,
      { file, missing: missingItems },
    ));
  }
  if (errors.length > 0) return { ok: false, file, specId, type, errors };

  const values = {
    defaultStatuses: [],
    coreFields: [],
    typeAliases: [],
    relations: [],
    notApplicable: {
      默认候选状态: false,
      核心语义字段: false,
      类型词别名: false,
      关系展开: false,
    },
  };
  const derivedWords = allTypeKeyDerivedWords();

  for (const item of RECALL_CRITERIA_ITEMS) {
    const row = byItem.get(item);
    const raw = machineValueText(row.machine);
    const machineItem = RECALL_CRITERIA_MACHINE_ITEMS.includes(item);
    if (!machineItem) {
      if (raw !== "" && raw !== RECALL_CRITERIA_NOT_APPLICABLE) {
        errors.push(error(
          "recall-criteria/bad_machine_value",
          `判据项「${item}」的机械值必须留空或写「${RECALL_CRITERIA_NOT_APPLICABLE}」，实得「${raw}」（02 §12.4）`,
          { file, line: row.line, item },
        ));
      }
      continue;
    }
    if (raw === RECALL_CRITERIA_NOT_APPLICABLE) {
      values.notApplicable[item] = true;
      continue;
    }
    if (raw === "") {
      errors.push(error(
        "recall-criteria/missing_machine_value",
        `判据项「${item}」是机械值项，不得留空；不适用时必须显式写「${RECALL_CRITERIA_NOT_APPLICABLE}」（02 §12.4）`,
        { file, line: row.line, item },
      ));
      continue;
    }

    if (item === "默认候选状态") {
      const entries = splitCommaList(raw);
      const bad = entries.filter((entry) => !STATUS_RE.test(entry));
      const dup = uniqueViolations(entries);
      if (entries.length === 0 || bad.length > 0 || dup.length > 0) {
        errors.push(error(
          "recall-criteria/bad_machine_value",
          `「默认候选状态」须为逗号分隔的 status 值表${bad.length > 0 ? `（非法值：${bad.join("、")}）` : ""}${dup.length > 0 ? `（重复：${dup.join("、")}）` : ""}：${raw}`,
          { file, line: row.line, item },
        ));
        continue;
      }
      values.defaultStatuses = entries;
      continue;
    }

    if (item === "核心语义字段") {
      const entries = splitCommaList(raw);
      const bad = entries.filter((entry) => !FIELD_RE.test(entry));
      const dup = uniqueViolations(entries);
      if (entries.length === 0 || bad.length > 0 || dup.length > 0) {
        errors.push(error(
          "recall-criteria/bad_machine_value",
          `「核心语义字段」须为逗号分隔的 frontmatter 字段名表${bad.length > 0 ? `（非法值：${bad.join("、")}）` : ""}${dup.length > 0 ? `（重复：${dup.join("、")}）` : ""}：${raw}`,
          { file, line: row.line, item },
        ));
        continue;
      }
      values.coreFields = entries;
      continue;
    }

    if (item === "类型词别名") {
      const entries = splitCommaList(raw);
      const bad = entries.filter((entry) => !ALIAS_RE.test(entry));
      const dup = uniqueViolations(entries);
      const clash = entries.filter((entry) => derivedWords.has(entry.toLowerCase()));
      if (entries.length === 0 || bad.length > 0 || dup.length > 0 || clash.length > 0) {
        errors.push(error(
          "recall-criteria/bad_machine_value",
          `「类型词别名」须为逗号分隔词表、成员唯一且不得与 fact_type_key 派生词冲突`
            + `${bad.length > 0 ? `（非法值：${bad.join("、")}）` : ""}`
            + `${dup.length > 0 ? `（重复：${dup.join("、")}）` : ""}`
            + `${clash.length > 0 ? `（与类型键派生词冲突：${clash.join("、")}）` : ""}：${raw}`,
          { file, line: row.line, item },
        ));
        continue;
      }
      values.typeAliases = entries;
      continue;
    }

    const entries = splitCommaList(raw);
    const parsed = [];
    for (const entry of entries) {
      const m = /^([a-z][a-z0-9-]*)->(.+)$/.exec(entry);
      if (m === null) {
        errors.push(error(
          "recall-criteria/bad_machine_value",
          `「关系展开」条目须为 <relation_key>-><目标类型>：${entry}`,
          { file, line: row.line, item: "关系展开" },
        ));
        continue;
      }
      const targets = m[2].split("|").map((t) => t.trim()).filter((t) => t !== "");
      const badTargets = targets.filter((t) => !TARGET_TYPE_RE.test(t));
      if (!RELATION_KEY_RE.test(m[1]) || targets.length === 0 || badTargets.length > 0) {
        errors.push(error(
          "recall-criteria/bad_machine_value",
          `「关系展开」条目目标非法：${entry}${badTargets.length > 0 ? `（非法目标：${badTargets.join("、")}）` : ""}`,
          { file, line: row.line, item: "关系展开" },
        ));
        continue;
      }
      parsed.push({ relationKey: m[1], targets });
    }
    const dupKeys = uniqueViolations(parsed.map((edge) => edge.relationKey));
    if (dupKeys.length > 0) {
      errors.push(error(
        "recall-criteria/bad_machine_value",
        `「关系展开」的 relation_key 重复：${dupKeys.join("、")}`,
        { file, line: row.line, item: "关系展开" },
      ));
      continue;
    }
    values.relations = parsed;
  }

  if (errors.length > 0) return { ok: false, file, specId, type, errors };

  return {
    ok: true,
    version: RECALL_CRITERIA_VERSION,
    file,
    specId,
    type,
    values,
  };
}


const CRITERIA_CACHE = new Map();

async function readdirOrEmpty(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadRecallCriteria(specsDir) {
  const dir = String(specsDir ?? "");
  if (dir === "") {
    return {
      ok: false,
      version: RECALL_CRITERIA_VERSION,
      byType: new Map(),
      tables: [],
      errors: [],
      unreadable: true,
      fingerprint: "",
      tier: "specs",
    };
  }

  let entries;
  try {
    entries = await readdirOrEmpty(dir);
  } catch (error) {
    return {
      ok: false,
      version: RECALL_CRITERIA_VERSION,
      byType: new Map(),
      tables: [],
      errors: [error(
        "recall-criteria/specs_unreadable",
        `规范源不可读，无法读取召回判据表：${String(error?.message ?? error)}`,
        { dir },
      )],
      unreadable: true,
      fingerprint: "",
      tier: "specs",
    };
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const m = /^(\d{2})-/.exec(entry.name);
    if (m === null || FACT_TYPE_BY_SPEC_ID[m[1]] === undefined) continue;
    files.push({ specId: m[1], type: FACT_TYPE_BY_SPEC_ID[m[1]], name: entry.name });
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const hash = createHash("sha256");
  const contents = [];
  for (const file of files) {
    const text = await readFile(join(dir, file.name), "utf8");
    contents.push(text);
    hash.update(`${file.name}\0`);
    hash.update(text);
    hash.update("\0");
  }
  const fingerprint = hash.digest("hex");

  const cached = CRITERIA_CACHE.get(dir);
  if (cached !== undefined && cached.get(fingerprint) !== undefined) return cached.get(fingerprint);

  const byType = new Map();
  const tables = [];
  const errors = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const result = parseRecallCriteriaTable(contents[i], {
      file: `specs/${file.name}`,
      specId: file.specId,
      type: file.type,
    });
    tables.push(result);
    if (result.ok === true) {
      byType.set(file.type, result);
    } else {
      for (const item of result.errors) errors.push({ type: file.type, specId: file.specId, file: `specs/${file.name}`, ...item });
    }
  }

  const seenAlias = new Map();
  for (const [type, result] of byType) {
    for (const alias of result.values.typeAliases) {
      if (seenAlias.has(alias)) {
        const owner = seenAlias.get(alias);
        errors.push(error(
          "recall-criteria/alias_conflict",
          `类型词别名「${alias}」同时登记于 ${owner} 与 ${type}（02 §12.4：成员必须唯一）`,
          { type, file: result.file, alias },
        ));
        byType.delete(type);
        break;
      }
      seenAlias.set(alias, type);
    }
  }

  const loaded = {
    ok: errors.length === 0,
    version: RECALL_CRITERIA_VERSION,
    byType,
    tables,
    errors,
    unreadable: false,
    fingerprint,
    tier: "specs",
  };
  if (cached === undefined) {
    CRITERIA_CACHE.set(dir, new Map([[fingerprint, loaded]]));
  } else {
    cached.set(fingerprint, loaded);
    if (cached.size > 4) {
      const oldest = cached.keys().next().value;
      if (oldest !== fingerprint) cached.delete(oldest);
    }
  }
  return loaded;
}


const BUNDLE_MACHINE_ITEMS = Object.freeze([
  { item: "默认候选状态", key: "defaultStatuses", pattern: STATUS_RE },
  { item: "核心语义字段", key: "coreFields", pattern: FIELD_RE },
  { item: "类型词别名", key: "typeAliases", pattern: ALIAS_RE },
  { item: "关系展开", key: "relations", pattern: null },
]);

function bundleStructuralErrors(file, code, message) {
  return FACTSOURCE_TYPE_KEYS.map((type) => {
    const specId = Object.keys(FACT_TYPE_BY_SPEC_ID).find((id) => FACT_TYPE_BY_SPEC_ID[id] === type) ?? "";
    return { code, message, type, specId, file };
  });
}

function validateBundleValues(raw, context) {
  const errors = [];
  const file = context.file;
  const type = context.type;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return [error("recall-criteria/bad_bundle_values", `包内判据表条目不是对象：${type}`, { file, type })];
  }
  const notApplicable = raw.notApplicable;
  if (notApplicable === null || typeof notApplicable !== "object" || Array.isArray(notApplicable)) {
    return [error("recall-criteria/bad_bundle_values", `包内判据表条目缺 notApplicable 对象：${type}`, { file, type })];
  }
  const notApplicableKeys = Object.keys(notApplicable).sort();
  const expectedKeys = [...RECALL_CRITERIA_MACHINE_ITEMS].sort();
  if (notApplicableKeys.length !== expectedKeys.length || notApplicableKeys.some((key, index) => key !== expectedKeys[index])) {
    errors.push(error(
      "recall-criteria/bad_bundle_values",
      `包内判据表条目的 notApplicable 键集不符（应为 ${expectedKeys.join("、")}，实得 ${notApplicableKeys.join("、")}）：${type}`,
      { file, type },
    ));
    return errors;
  }
  for (const key of expectedKeys) {
    if (typeof notApplicable[key] !== "boolean") {
      errors.push(error("recall-criteria/bad_bundle_values", `包内判据表条目的 notApplicable.${key} 不是布尔值：${type}`, { file, type }));
      return errors;
    }
  }
  for (const spec of BUNDLE_MACHINE_ITEMS) {
    const list = raw[spec.key];
    if (!Array.isArray(list)) {
      errors.push(error("recall-criteria/bad_bundle_values", `包内判据表条目的 ${spec.key} 不是数组：${type}`, { file, type }));
      continue;
    }
    if (notApplicable[spec.item] === true) {
      if (list.length > 0) {
        errors.push(error(
          "recall-criteria/bad_bundle_values",
          `包内判据表条目登记为「不采用」却带机械值（${spec.key}）：${type}`,
          { file, type },
        ));
      }
      continue;
    }
    if (list.length === 0) {
      errors.push(error(
        "recall-criteria/bad_bundle_values",
        `包内判据表条目的 ${spec.key} 为空且未登记「不采用」：${type}`,
        { file, type },
      ));
      continue;
    }
    if (spec.key === "relations") {
      const keys = [];
      for (const entry of list) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          errors.push(error("recall-criteria/bad_bundle_values", `包内判据表条目的关系边不是对象：${type}`, { file, type }));
          continue;
        }
        const relationKey = entry.relationKey;
        const targets = entry.targets;
        if (typeof relationKey !== "string" || !RELATION_KEY_RE.test(relationKey)) {
          errors.push(error("recall-criteria/bad_bundle_values", `包内判据表条目的关系键非法：${String(relationKey)}`, { file, type }));
          continue;
        }
        if (!Array.isArray(targets) || targets.length === 0 || targets.some((t) => typeof t !== "string" || !TARGET_TYPE_RE.test(t))) {
          errors.push(error("recall-criteria/bad_bundle_values", `包内判据表条目的关系目标非法：${relationKey}`, { file, type }));
          continue;
        }
        keys.push(relationKey);
      }
      const dupKeys = uniqueViolations(keys);
      if (dupKeys.length > 0) {
        errors.push(error("recall-criteria/bad_bundle_values", `包内判据表条目的关系键重复：${dupKeys.join("、")}`, { file, type }));
      }
      continue;
    }
    const bad = list.filter((entry) => typeof entry !== "string" || !spec.pattern.test(entry));
    const dup = uniqueViolations(list);
    if (bad.length > 0) {
      errors.push(error("recall-criteria/bad_bundle_values", `包内判据表条目的 ${spec.key} 含非法值：${bad.join("、")}`, { file, type }));
    }
    if (dup.length > 0) {
      errors.push(error("recall-criteria/bad_bundle_values", `包内判据表条目的 ${spec.key} 含重复值：${dup.join("、")}`, { file, type }));
    }
  }
  return errors;
}

function bundleValuesOf(raw) {
  return {
    defaultStatuses: [...raw.defaultStatuses],
    coreFields: [...raw.coreFields],
    typeAliases: [...raw.typeAliases],
    relations: raw.relations.map((entry) => ({ relationKey: entry.relationKey, targets: [...entry.targets] })),
    notApplicable: {
      默认候选状态: raw.notApplicable["默认候选状态"],
      核心语义字段: raw.notApplicable["核心语义字段"],
      类型词别名: raw.notApplicable["类型词别名"],
      关系展开: raw.notApplicable["关系展开"],
    },
  };
}

export async function loadRecallCriteriaBundle(file = RECALL_CRITERIA_BUNDLE_FILE) {
  const path = String(file ?? "");
  const base = {
    ok: false,
    version: RECALL_CRITERIA_VERSION,
    byType: new Map(),
    tables: [],
    errors: [],
    unreadable: false,
    fingerprint: "",
    tier: "package-data",
    file: path,
  };
  if (path === "") return { ...base, unreadable: true };

  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (readError) {
    return {
      ...base,
      unreadable: true,
      errors: [error(
        "recall-criteria/bundle_unreadable",
        `包内判据表数据文件不可读：${String(readError?.message ?? readError)}`,
        { file: path },
      )],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (parseError) {
    return {
      ...base,
      errors: bundleStructuralErrors(
        path,
        "recall-criteria/bad_bundle_json",
        `包内判据表数据文件不是合法 JSON：${String(parseError?.message ?? parseError)}`,
      ),
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ...base,
      errors: bundleStructuralErrors(path, "recall-criteria/bad_bundle_shape", "包内判据表数据文件的顶层不是对象"),
    };
  }
  if (parsed.version !== RECALL_CRITERIA_VERSION) {
    return {
      ...base,
      errors: bundleStructuralErrors(
        path,
        "recall-criteria/unknown_version",
        `包内判据表数据文件版本标记不识别：${String(parsed.version)}；本实现只认 \`${RECALL_CRITERIA_VERSION}\``,
      ),
    };
  }
  if (typeof parsed.fingerprint !== "string" || parsed.fingerprint === "") {
    return {
      ...base,
      errors: bundleStructuralErrors(path, "recall-criteria/bad_bundle_fingerprint", "包内判据表数据文件缺指纹"),
    };
  }
  const types = parsed.types;
  if (types === null || typeof types !== "object" || Array.isArray(types) || Object.keys(types).length === 0) {
    return {
      ...base,
      errors: bundleStructuralErrors(path, "recall-criteria/bad_bundle_types", "包内判据表数据文件没有登记任何类型判据表"),
    };
  }

  const byType = new Map();
  const tables = [];
  const errors = [];
  for (const type of Object.keys(types)) {
    const specId = String(types[type]?.specId ?? "");
    if (!FACTSOURCE_TYPE_KEYS.includes(type) || FACT_TYPE_BY_SPEC_ID[specId] !== type) {
      errors.push(error(
        "recall-criteria/bad_bundle_type",
        `包内判据表数据文件登记了不认识的类型／规范编号：${type}（specId=${specId}）`,
        { file: path, type, specId },
      ));
      continue;
    }
    const typeErrors = validateBundleValues(types[type], { file: path, type });
    if (typeErrors.length > 0) {
      tables.push({ ok: false, file: path, specId, type, errors: typeErrors });
      for (const item of typeErrors) errors.push({ type, specId, file: path, ...item });
      continue;
    }
    const result = { ok: true, version: RECALL_CRITERIA_VERSION, file: path, specId, type, values: bundleValuesOf(types[type]) };
    tables.push(result);
    byType.set(type, result);
  }

  const seenAlias = new Map();
  for (const [type, result] of byType) {
    for (const alias of result.values.typeAliases) {
      if (seenAlias.has(alias)) {
        const owner = seenAlias.get(alias);
        errors.push(error(
          "recall-criteria/alias_conflict",
          `类型词别名「${alias}」同时登记于 ${owner} 与 ${type}（02 §12.4：成员必须唯一）`,
          { type, file: path, alias },
        ));
        byType.delete(type);
        break;
      }
      seenAlias.set(alias, type);
    }
  }

  return {
    ok: errors.length === 0,
    version: RECALL_CRITERIA_VERSION,
    byType,
    tables,
    errors,
    unreadable: false,
    fingerprint: parsed.fingerprint,
    tier: "package-data",
    file: path,
  };
}
