/**
 * 机器可读召回判据表（`recall-criteria/v1`）的**确定性读取器**。
 *
 * 规范出处：
 *   · `specs/02-事实源与事实模型基础规范.md` §12.4「机器可读召回判据表（格式契约）」
 *     ——表头版本锚、四列列名与列序、七项判据闭集、四类机械值形态、**读取
 *     fail-closed**；
 *   · `specs/20`–`27` 各事实类型规范的「召回与消费」章各含一张同格式表。
 *
 * 本模块**只做解析与校验**，不做召回决策，也不读规范自然语言正文：
 * 02 §12.4 明文要求 Code「依本契约确定性读取执行，不从规范自然语言正文抽取判据」。
 *
 * ── 为什么解析必须 fail-closed ─────────────────────────────────────────
 *
 * 判据表的机械值是**类型通道**（类型点名／核心语义字段／关系展开）的唯一输入。
 * 一旦某张表缺失、版本不识别、列序不符或机械值形态非法，任何「猜一个默认值」
 * 都会让实现替规范做裁决——那正是 02 §12.4 与 `02 §9` 判定红线禁止的。
 * 故本模块返回**结构化错误**（说清缺什么），由调用方停用该类型的机器判据、
 * 按 partial 口径披露；绝不静默回落默认值。
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** 判据表版本锚：表头行必须逐字包含（02 §12.4）。 */
export const RECALL_CRITERIA_VERSION = "recall-criteria/v1";

/** v1 列名闭集，按序（02 §12.4）。 */
export const RECALL_CRITERIA_COLUMNS = Object.freeze([
  "判据项（recall-criteria/v1）",
  "本类型规则",
  "机械值",
  "依据/理由",
]);

/** v1 判据项闭集，逐项登记、不得省行（02 §12.4）。 */
export const RECALL_CRITERIA_ITEMS = Object.freeze([
  "召回时机",
  "默认候选状态",
  "核心语义字段",
  "类型词别名",
  "关系展开",
  "F3/F4 展开",
  "条数上限归属",
]);

/** 承载机械值的判据项（其余项机械值必须留空或「不采用」）。 */
export const RECALL_CRITERIA_MACHINE_ITEMS = Object.freeze([
  "默认候选状态",
  "核心语义字段",
  "类型词别名",
  "关系展开",
]);

/** 判据项「不采用」的标记（02 §12.3 第 2 条：不适用项须显式登记）。 */
export const RECALL_CRITERIA_NOT_APPLICABLE = "不采用";

/**
 * 20–29 段事实类型规范 → `fact_type_key` 值域（02 §7.1）。
 *
 * **为什么用显式表而不是从文件名猜类型**：文件名里的中文标题不是类型身份，
 * 目录名还有英文变形陷阱（`researches → research`，本仓曾真的读出
 * `"researche"`）。规范号是稳定锚，故按 `spec_id` 映射。
 */
export const FACT_TYPE_BY_SPEC_ID = Object.freeze({
  "20": "spark",
  "21": "workcase",
  "22": "adr",
  "23": "pitfall",
  "24": "research",
  "25": "goal",
  "26": "friction",
  "27": "norm",
});

/** 全部已登记事实类型键（用于「别名不得与类型键派生词冲突」的校验）。 */
export const FACTSOURCE_TYPE_KEYS = Object.freeze(Object.values(FACT_TYPE_BY_SPEC_ID));

/**
 * `fact_type_key` 的派生词（大小写不敏感整词）。
 *
 * 02 §12.4 的类型词别名规则：别名「不得与 `fact_type_key` 值域（§7.1）派生词
 * 冲突」。派生规则保持**最小且确定**：键本身与键的复数形（`adr`/`adrs`）。
 * 复数是事实源目录名的实际形态（`adrs/`、`pitfalls/`），故一并覆盖。
 */
export function typeKeyDerivedWords(typeKey) {
  const key = String(typeKey ?? "").trim().toLowerCase();
  if (key === "") return [];
  return [key, `${key}s`];
}

/** 全部类型键派生词集合（小写）。 */
export function allTypeKeyDerivedWords() {
  const out = new Set();
  for (const key of FACTSOURCE_TYPE_KEYS) {
    for (const word of typeKeyDerivedWords(key)) out.add(word);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 表格切分
// ---------------------------------------------------------------------------

/**
 * 按**未转义的** `|` 切一行 Markdown 表格行。
 *
 * 关系展开机械值里的多目标写作 `\|`（转义），故切分时必须把它当普通字符。
 * 返回的单元格**保留** `\|` 转义，由取值方自行还原（见 `machineValueText`）。
 */
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
      // 反斜杠本身也保留，便于还原 `\|`；转义只影响「下一个字符不被当分隔符」。
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
  // 末列的收尾 `|` 会产出一个空尾格：去掉（仅当确实以 `|` 结尾）。
  if (trimmed.endsWith("|") && cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

/** 是否为表格分隔行（`|---|---|`）。 */
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell) || cell === "");
}

/** 还原机械值单元格里的 `\|` 转义。 */
function machineValueText(cell) {
  return String(cell ?? "").replace(/\\\|/g, "|").trim();
}

/** 逗号分隔表（去空项）。 */
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

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

const STATUS_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_RE = /^[a-z][a-z0-9_]*$/;
// 别名：允许中日韩文字、字母、数字、下划线与连字符；不得含空白（整词白名单）。
const ALIAS_RE = /^[\p{L}\p{N}_-]+$/u;
const RELATION_KEY_RE = /^[a-z][a-z0-9-]*$/;
const TARGET_TYPE_RE = /^[a-z][a-z0-9_]*$/;

function error(code, message, extra = {}) {
  return { code, message, ...extra };
}

/**
 * 解析一份规范载体的召回判据表。
 *
 * @param {string} text 规范载体全文
 * @param {{file?: string, specId?: string, type?: string}} [options]
 * @returns {object} 成功时 `{ok:true, ...}`；失败时 `{ok:false, errors:[...]}`。
 *   失败时**不返回任何机械值**——调用方不得据此回落到默认值。
 */
export function parseRecallCriteriaTable(text, options = {}) {
  const file = String(options.file ?? "");
  const specId = String(options.specId ?? "");
  const type = String(options.type ?? "");
  const lines = String(text ?? "").split(/\r?\n/);

  // ── 定位表头 ──────────────────────────────────────────────────────────
  // 先找带版本锚的表格行；找不到再退到「首格为判据项」的行——这样
  // 「表在、版本标记缺」能报 missing_version_marker，而不是笼统的 missing_table。
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

  // ── 版本锚 ────────────────────────────────────────────────────────────
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

  // ── 列名与列序 ────────────────────────────────────────────────────────
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

  // ── 读行 ──────────────────────────────────────────────────────────────
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

  // ── 机械值 ────────────────────────────────────────────────────────────
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
      // 契约：非机械项机械值留空；不适用项写「不采用」（02 §12.3 第 2 条）。
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

    // 关系展开：`<relation_key>-><目标 fact_type_key，多个用 | 分隔>`。
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

// ---------------------------------------------------------------------------
// 载入全部事实类型规范
// ---------------------------------------------------------------------------

/** 语料目录 → 内容指纹 → 读取结果（同一份语料恒得同一对象）。 */
const CRITERIA_CACHE = new Map();

async function readdirOrEmpty(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * 读取并解析 20–29 段事实类型规范里的全部召回判据表。
 *
 * @param {string} specsDir 规范源目录（通常是 `<项目根>/specs` 或回退来源）
 * @returns {Promise<{ok: boolean, version: string, byType: Map<string, object>,
 *   tables: object[], errors: object[], unreadable: boolean, fingerprint: string}>}
 *
 * `byType` 只含**解析成功**的类型；失败类型的错误在 `errors` 里逐条说明缺什么。
 * 调用方据此停用失败类型的机器判据并按 partial 口径披露（02 §12.4）。
 */
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

  // 跨类型别名冲突：02 §12.4 要求别名「不得与其他类型的别名冲突」。
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
