import { parseAllDocuments, isMap, isScalar } from "yaml";
import { ID_PATTERN, parseSpecDocument, extractHeadings, resolveHeadingPath } from "./spec-registry.js";
import { normalizeNewlines } from "./markdown-structure.js";

export const RUNTIME_CARRIER_NAMESPACES = Object.freeze({ RUNTIME: "plugin-specs", DEVELOPMENT: "specs" });

export const RUNTIME_CARRIER_LIMITS = Object.freeze({
  minRequirements: 1,
  maxRequirements: 30,
  maxRequirementTextCodePoints: 600,
  maxDocumentBytes: 20480
});

export const RUNTIME_CARRIER_FIELDS = Object.freeze([
  "spec_key",
  "spec_kind",
  "title",
  "canonical_path",
  "positioning",
  "scope",
  "carries",
  "role",
  "requirements"
]);

export const RUNTIME_CARRIER_REQUIRED_FIELDS = Object.freeze([
  "spec_key",
  "spec_kind",
  "title",
  "canonical_path",
  "positioning",
  "scope"
]);

export const RUNTIME_CARRIER_OPTIONAL_FIELDS = Object.freeze(["carries", "role"]);

export const RUNTIME_REQUIREMENT_FIELDS = Object.freeze(["id", "title", "text"]);

export const RUNTIME_CARRIER_RELATION_FIELDS = Object.freeze([
  "supersedes",
  "parent_spec",
  "relation",
  "related_specs"
]);

export const RUNTIME_CARRIER_WEAK_WORDING = Object.freeze(["应当", "应该", "建议", "尽量"]);

export const RUNTIME_CARRIER_GUIDANCE_PHRASES = Object.freeze([
  "见上",
  "见前",
  "见下",
  "如前所述",
  "如上所述",
  "参照前文",
  "上面那几条",
  "参见前文",
  "另见",
  "详见",
  "参见",
  "见《"
]);

export const RUNTIME_CARRIER_LOAD_BEARING_MARKERS = Object.freeze(["【承重声明】", "**恢复条件**："]);

const PATH_VALUE_PATTERN = /\b(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.ya?ml\b/g;
const DEV_PATH_SEGMENT_PATTERN = /(?<![A-Za-z0-9._-])specs\//g;
const SECTION_PATTERN = /§|第\s*[0-9]+\s*[章节条]/g;
const RELATION_FIELD_PATTERN = /supersed|parent_|relation|related_|inherit|extends|replaces/i;

function reject(code, message) {
  return { ok: false, error: { code, message } };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasControlCharacter(value) {
  return Array.from(String(value)).some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
}

function escapePattern(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifierPattern(key) {
  return new RegExp(`(?<![a-z0-9-])${escapePattern(key)}(?![a-z0-9-])`, "g");
}

function filenamePattern(name) {
  return new RegExp(`(?<![A-Za-z0-9._/-])${escapePattern(name)}`, "g");
}

function carrierFilenamePattern(name) {
  return new RegExp(`(?<![A-Za-z0-9._-])${escapePattern(name)}(?![A-Za-z0-9._-])`, "g");
}

function canonicalPathPattern(path) {
  return new RegExp(`(?<![A-Za-z0-9._-])${escapePattern(path)}(?![A-Za-z0-9._-])`, "g");
}

const CARRIER_REFERENCE_FORM_PRIORITY = Object.freeze(["canonical_path", "filename", "spec_key"]);

function collectCarrierReferenceHits(text, carriers) {
  const hits = [];
  for (const carrier of carriers) {
    const reference = carrier.specKey ?? carrier.canonicalPath ?? null;
    if (isNonEmptyString(carrier.specKey)) {
      for (const match of collectMatches(identifierPattern(carrier.specKey), text)) {
        hits.push({ ...match, form: "spec_key", reference });
      }
    }
    const filename = isNonEmptyString(carrier.canonicalPath) ? basenameOf(carrier.canonicalPath) : (isNonEmptyString(carrier.specKey) ? `${carrier.specKey}.yaml` : null);
    if (isNonEmptyString(filename)) {
      for (const match of collectMatches(carrierFilenamePattern(filename), text)) {
        hits.push({ ...match, form: "filename", reference });
      }
    }
    if (isNonEmptyString(carrier.canonicalPath)) {
      for (const match of collectMatches(canonicalPathPattern(carrier.canonicalPath), text)) {
        hits.push({ ...match, form: "canonical_path", reference });
      }
    }
  }
  return hits;
}

function groupOverlappingMatches(hits) {
  const sorted = [...hits].sort((left, right) => left.index - right.index || right.text.length - left.text.length);
  const groups = [];
  for (const hit of sorted) {
    const end = hit.index + hit.text.length;
    const current = groups[groups.length - 1];
    if (current !== undefined && hit.index < current.end) {
      current.end = Math.max(current.end, end);
      current.hits.push(hit);
      continue;
    }
    groups.push({ start: hit.index, end, hits: [hit] });
  }
  return groups;
}

function basenameOf(path) {
  const index = String(path).lastIndexOf("/");
  return index === -1 ? String(path) : String(path).slice(index + 1);
}

function codePointLength(value) {
  return Array.from(String(value)).length;
}

function textCodePoints(value) {
  const text = String(value);
  return codePointLength(text.endsWith("\n") ? text.slice(0, -1) : text);
}

function finding(code, item, level, fieldPath, message, extra = {}) {
  return { code, item, level, fieldPath, message, ...extra };
}

function collectMatches(pattern, text) {
  const matches = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    matches.push({ index: match.index, text: match[0] });
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
  return matches;
}

function maskRange(text, start, end) {
  if (start < 0 || end <= start || end > text.length) return text;
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

function maskLiteral(text, literal) {
  if (!isNonEmptyString(literal)) return text;
  let output = text;
  let index = output.indexOf(literal);
  while (index !== -1) {
    output = maskRange(output, index, index + literal.length);
    index = output.indexOf(literal, index + literal.length);
  }
  return output;
}

function matchesOverlap(covered, start, length) {
  for (let index = start; index < start + length; index += 1) {
    if (covered[index]) return true;
  }
  return false;
}

function phraseMatches(text, phrases) {
  const ordered = [...phrases].sort((left, right) => right.length - left.length);
  const covered = new Array(text.length).fill(false);
  const found = [];
  for (const phrase of ordered) {
    let index = text.indexOf(phrase);
    while (index !== -1) {
      if (!matchesOverlap(covered, index, phrase.length)) {
        found.push({ index, text: phrase });
        for (let cursor = index; cursor < index + phrase.length; cursor += 1) covered[cursor] = true;
      }
      index = text.indexOf(phrase, index + 1);
    }
  }
  return found.sort((left, right) => left.index - right.index);
}

function dedupeMatches(matches) {
  const seen = new Set();
  const output = [];
  for (const match of matches) {
    const key = `${match.index}:${match.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(match);
  }
  return output.sort((left, right) => left.index - right.index);
}

function descriptorFromText(text, actualPath) {
  const fallbackKey = typeof actualPath === "string" && actualPath.endsWith(".yaml") ? basenameOf(actualPath).slice(0, -".yaml".length) : null;
  let documents;
  try {
    documents = parseAllDocuments(String(text), { uniqueKeys: false });
  } catch {
    return { specKey: fallbackKey, canonicalPath: actualPath ?? null, role: undefined };
  }
  const document = documents[0];
  if (document === undefined) return { specKey: fallbackKey, canonicalPath: actualPath ?? null, role: undefined };
  const contents = document.contents;
  if (!isMap(contents)) return { specKey: fallbackKey, canonicalPath: actualPath ?? null, role: undefined };
  const specPair = contents.items.find((item) => isScalar(item.key) && item.key.value === "ldvh_spec");
  if (specPair === undefined || !isMap(specPair.value)) return { specKey: fallbackKey, canonicalPath: actualPath ?? null, role: undefined };
  const block = specPair.value.toJS(document);
  return {
    specKey: typeof block.spec_key === "string" ? block.spec_key : fallbackKey,
    canonicalPath: typeof block.canonical_path === "string" ? block.canonical_path : (actualPath ?? null),
    role: block.role
  };
}

export function buildDevelopmentSpecCorpus(documents) {
  const specs = [];
  const parseFailures = [];
  const kindMismatches = [];
  for (const document of documents ?? []) {
    const parsed = parseSpecDocument(document.text, document.path);
    if (!parsed.ok) {
      parseFailures.push({ path: document.path, reason: "parse_failed", error: parsed.error });
      continue;
    }
    if (parsed.value.identity.kind !== "ldvh_spec") {
      kindMismatches.push({ path: document.path, reason: "kind_mismatch", kind: parsed.value.identity.kind });
      continue;
    }
    specs.push({
      specKey: parsed.value.identity.responsibilityKey,
      canonicalPath: parsed.value.identity.canonicalPath,
      title: parsed.value.identity.title,
      text: document.text,
      path: document.path
    });
  }
  return {
    specs,
    rejected: [...parseFailures, ...kindMismatches],
    parseFailures,
    kindMismatches,
    counts: {
      accepted: specs.length,
      parseFailed: parseFailures.length,
      kindMismatch: kindMismatches.length
    }
  };
}

export function parseCarryAnchor(anchor) {
  if (typeof anchor !== "string" || anchor.length === 0) return reject("anchor/form_invalid", "anchor must be a non-empty string");
  if (anchor.includes("\n") || anchor.includes("\r")) return reject("anchor/form_invalid", "anchor must fit on one line");
  const separator = anchor.indexOf("::");
  if (separator < 0) return reject("anchor/form_invalid", "anchor must use the <target spec_key>::<H2 heading>[/<H3 heading>] form");
  const specKey = anchor.slice(0, separator);
  const headingPath = anchor.slice(separator + 2);
  if (!ID_PATTERN.test(specKey)) return reject("anchor/form_invalid", "anchor prefix must be a runtime/development identifier");
  if (headingPath.length === 0 || headingPath.trim() !== headingPath) return reject("anchor/form_invalid", "anchor heading path must be non-empty and free of surrounding whitespace");
  const segments = headingPath.split("/");
  if (segments.length > 2) return reject("anchor/form_invalid", "anchor heading path must be one H2 or one H2/H3 pair");
  if (segments.some((segment) => segment.length === 0 || segment.trim() !== segment)) {
    return reject("anchor/form_invalid", "anchor heading segments must be non-empty and free of surrounding whitespace");
  }
  return { ok: true, value: { specKey, headingPath, segments } };
}

function sectionOwnBody(text, startLine) {
  const lines = normalizeNewlines(text).split("\n");
  const headings = extractHeadings(text);
  const nextHeading = headings.find((heading) => heading.line > startLine);
  const ownEnd = nextHeading === undefined ? lines.length : nextHeading.line - 1;
  for (let line = startLine + 1; line <= ownEnd; line += 1) {
    if ((lines[line - 1] ?? "").trim() === "") continue;
    return true;
  }
  return false;
}

export function resolveCarryAnchor(anchor, developmentSpecs) {
  const parsed = parseCarryAnchor(anchor);
  if (!parsed.ok) return parsed;
  const target = (developmentSpecs ?? []).find((spec) => spec.specKey === parsed.value.specKey);
  if (target === undefined) return reject("anchor/target_unknown", `development spec "${parsed.value.specKey}" is not in the corpus`);
  if (typeof target.text !== "string") return reject("anchor/target_unreadable", `development spec "${parsed.value.specKey}" has no readable text`);
  const resolved = resolveHeadingPath(target.text, parsed.value.headingPath);
  if (!resolved.ok) {
    if (resolved.error.code === "content/heading_ambiguous") return reject("anchor/heading_ambiguous", resolved.error.message);
    if (resolved.error.code === "content/heading_path_invalid") return reject("anchor/form_invalid", resolved.error.message);
    return reject("anchor/heading_not_found", resolved.error.message);
  }
  if (!sectionOwnBody(target.text, resolved.value.startLine)) {
    return reject("anchor/empty_locator", `heading path "${parsed.value.headingPath}" carries no body of its own`);
  }
  return {
    ok: true,
    value: {
      specKey: parsed.value.specKey,
      canonicalPath: target.canonicalPath,
      headingPath: parsed.value.headingPath,
      startLine: resolved.value.startLine,
      endLine: resolved.value.endLine
    }
  };
}

function isScanSkippedPath(path) {
  if (path === "ldvh_spec.spec_key" || path === "ldvh_spec.canonical_path") return true;
  if (path === "ldvh_spec.carries" || path.startsWith("ldvh_spec.carries[")) return true;
  if (/^ldvh_spec\.requirements\[\d+\]\.id$/.test(path)) return true;
  return false;
}

function collectScalarValues(value, path, output) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectScalarValues(item, `${path}[${index}]`, output));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (isScanSkippedPath(childPath)) continue;
      collectScalarValues(child, childPath, output);
    }
    return;
  }
  if (typeof value === "string") {
    output.push({ path, value, type: "string" });
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.push({ path, value: String(value), type: typeof value });
  }
}

function scanOtherCarrierReferences(text, path, context, output) {
  const hits = collectCarrierReferenceHits(text, context.otherCarriers);
  for (const group of groupOverlappingMatches(hits)) {
    const forms = CARRIER_REFERENCE_FORM_PRIORITY.filter((form) => group.hits.some((hit) => hit.form === form));
    const references = [...new Set(group.hits.map((hit) => hit.reference))];
    const widest = [...group.hits].sort((left, right) => right.text.length - left.text.length || left.index - right.index)[0];
    output.push(finding(
      "prohibited/other_runtime_carrier",
      1,
      "error",
      path,
      `references another runtime carrier "${references[0]}" (forms: ${forms.join(", ")})`,
      { matched: widest.text, reference: references[0], references, matchedForm: forms[0], matchedForms: forms }
    ));
  }
}

function scanDevelopmentSpecReferences(text, path, context, output) {
  const hits = [];
  for (const match of collectMatches(DEV_PATH_SEGMENT_PATTERN, text)) hits.push({ ...match, reference: "specs/", kind: "path_segment" });
  for (const spec of context.developmentSpecs) {
    if (spec.specKey === context.ownKey) continue;
    const filename = basenameOf(spec.canonicalPath);
    if (filename.length > 0) {
      for (const match of collectMatches(filenamePattern(filename), text)) hits.push({ ...match, reference: filename, kind: "filename" });
    }
    if (isNonEmptyString(spec.specKey)) {
      for (const match of collectMatches(identifierPattern(spec.specKey), text)) hits.push({ ...match, reference: spec.specKey, kind: "spec_key" });
    }
  }
  for (const hit of dedupeMatches(hits)) {
    output.push(finding(
      "prohibited/development_spec",
      2,
      "error",
      path,
      `references a development-spec artifact "${hit.reference}"`,
      { matched: hit.text, reference: hit.reference, referenceKind: hit.kind }
    ));
  }
}

function scanSectionReferences(text, path, output) {
  for (const match of collectMatches(SECTION_PATTERN, text)) {
    output.push(finding(
      "prohibited/section_reference",
      3,
      "error",
      path,
      `contains a section or clause designation "${match.text}"`,
      { matched: match.text }
    ));
  }
}

function scanTableSyntax(text, path, output) {
  const lines = normalizeNewlines(text).split("\n");
  lines.forEach((line, index) => {
    if (!line.startsWith("|")) return;
    const pipes = line.split("|").length - 1;
    if (pipes < 2) return;
    output.push(finding(
      "prohibited/gfm_table",
      4,
      "error",
      path,
      `contains a GFM table row at value line ${index + 1}`,
      { matched: line }
    ));
  });
}

function scanWeakWording(text, path, output) {
  for (const phrase of RUNTIME_CARRIER_WEAK_WORDING) {
    let index = text.indexOf(phrase);
    while (index !== -1) {
      output.push(finding(
        "prohibited/weak_wording",
        5,
        "error",
        path,
        `contains weak wording "${phrase}"`,
        { matched: phrase }
      ));
      index = text.indexOf(phrase, index + phrase.length);
    }
  }
}

function scanGuidancePhrases(text, path, output) {
  for (const match of phraseMatches(text, RUNTIME_CARRIER_GUIDANCE_PHRASES)) {
    output.push(finding(
      "prohibited/guidance_phrase",
      6,
      "error",
      path,
      `contains guidance wording "${match.text}"`,
      { matched: match.text }
    ));
  }
}

function scanLoadBearingMarkers(text, path, output) {
  for (const marker of RUNTIME_CARRIER_LOAD_BEARING_MARKERS) {
    let index = text.indexOf(marker);
    while (index !== -1) {
      output.push(finding(
        "hint/load_bearing_claim",
        "5.5-乙类8",
        "hint",
        path,
        `contains the load-bearing marker "${marker}"; independent review decides whether it is a claim or a description`,
        { matched: marker }
      ));
      index = text.indexOf(marker, index + marker.length);
    }
  }
}

function validateStructure(text) {
  const findings = [];
  let documents;
  try {
    documents = parseAllDocuments(String(text), { uniqueKeys: true });
  } catch (error) {
    return {
      findings: [finding("structure/yaml_invalid", 7, "error", "ldvh_spec", `the carrier is not parseable YAML: ${String(error?.message ?? error)}`)],
      block: null,
      blockNode: null,
      topLevelKeys: []
    };
  }
  if (documents.length === 0) {
    return {
      findings: [finding("structure/top_level_document_count", 7, "error", "ldvh_spec", "the carrier contains no YAML document")],
      block: null,
      blockNode: null,
      topLevelKeys: []
    };
  }
  const fatal = [];
  for (const document of documents) {
    for (const error of document.errors) {
      if (error.code === "DUPLICATE_KEY") {
        findings.push(finding("structure/duplicate_key", 7, "error", "ldvh_spec", error.message.split("\n")[0]));
        continue;
      }
      fatal.push(error);
    }
  }
  if (fatal.length > 0) {
    return {
      findings: findings.concat(fatal.map((error) => finding("structure/yaml_invalid", 7, "error", "ldvh_spec", error.message.split("\n")[0]))),
      block: null,
      blockNode: null,
      topLevelKeys: []
    };
  }
  if (documents.length > 1) {
    findings.push(finding("structure/top_level_document_count", 7, "error", "ldvh_spec", `the carrier holds ${documents.length} YAML documents; exactly one is allowed`));
  }
  const topLevelKeys = [];
  let blockNode = null;
  const primary = documents[0];
  if (!isMap(primary.contents)) {
    findings.push(finding("structure/top_level_mapping", 7, "error", "ldvh_spec", "the document root is not a mapping"));
    return { findings, block: null, blockNode: null, topLevelKeys: [] };
  }
  const rootPairs = primary.contents.items;
  for (const pair of rootPairs) {
    const key = isScalar(pair.key) ? String(pair.key.value) : null;
    topLevelKeys.push(key);
    if (key === "ldvh_attachment") {
      findings.push(finding("structure/attachment_form", 7, "error", "ldvh_attachment", "the carrier declares ldvh_attachment; the attachment carrier form is not admitted"));
      continue;
    }
    if (key !== "ldvh_spec") {
      findings.push(finding("structure/top_level_field", 7, "error", key === null ? "ldvh_spec" : key, `top-level field "${key}" is outside the closed set`));
      continue;
    }
    if (blockNode !== null) {
      findings.push(finding("structure/top_level_mapping", 7, "error", "ldvh_spec", "the ldvh_spec mapping appears more than once"));
      continue;
    }
    blockNode = pair.value;
  }
  if (rootPairs.length !== 1) {
    findings.push(finding("structure/top_level_mapping", 7, "error", "ldvh_spec", `the document root holds ${rootPairs.length} mappings; exactly one "ldvh_spec" mapping is allowed`));
  }
  if (blockNode === null) {
    findings.push(finding("structure/top_level_mapping", 7, "error", "ldvh_spec", "the document root has no ldvh_spec mapping"));
    return { findings, block: null, blockNode: null, topLevelKeys };
  }
  if (!isMap(blockNode)) {
    findings.push(finding("structure/top_level_mapping", 7, "error", "ldvh_spec", "ldvh_spec is not a mapping"));
    return { findings, block: null, blockNode: null, topLevelKeys };
  }
  const allowed = new Set(RUNTIME_CARRIER_FIELDS);
  for (const pair of blockNode.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : null;
    if (key === null) {
      findings.push(finding("structure/field_key", 7, "error", "ldvh_spec", "a field key is not a scalar"));
      continue;
    }
    if (!allowed.has(key)) {
      findings.push(finding("structure/unknown_field", 7, "error", `ldvh_spec.${key}`, `field "${key}" is outside the closed set`));
      if (key === "spec_id") {
        findings.push(finding("structure/spec_id", 7, "error", `ldvh_spec.${key}`, "spec_id is not admitted on a runtime carrier"));
      }
      if (RUNTIME_CARRIER_RELATION_FIELDS.includes(key) || RELATION_FIELD_PATTERN.test(key)) {
        findings.push(finding("structure/relation_field", 7, "error", `ldvh_spec.${key}`, `relation, replacement or inheritance field "${key}" is not admitted`));
      }
    }
  }
  const block = blockNode.toJS(primary);
  if (block !== null && typeof block === "object") {
    for (const [key, value] of Object.entries(block)) {
      if (RUNTIME_CARRIER_FIELDS.includes(key)) continue;
      if (!Array.isArray(value)) continue;
      const looksLikeEntries = value.some((item) => item !== null && typeof item === "object" && !Array.isArray(item) && ("id" in item || "text" in item));
      if (looksLikeEntries) {
        findings.push(finding("structure/requirement_container", 7, "error", `ldvh_spec.${key}`, "requirements is the only requirement container; another container is not admitted"));
      }
    }
  }
  return { findings, block: block !== null && typeof block === "object" ? block : null, blockNode, topLevelKeys };
}

function validateIdentity(block, actualPath, context, findings) {
  for (const field of RUNTIME_CARRIER_REQUIRED_FIELDS) {
    if (!Object.hasOwn(block, field)) {
      findings.push(finding("structure/identity_missing", 7, "error", `ldvh_spec.${field}`, `required identity field "${field}" is missing`));
    }
  }
  const specKey = block.spec_key;
  if (Object.hasOwn(block, "spec_key")) {
    if (typeof specKey !== "string" || !ID_PATTERN.test(specKey)) {
      findings.push(finding("structure/identity_invalid", 7, "error", "ldvh_spec.spec_key", "spec_key must be a lowercase kebab-case identifier"));
    }
  }
  if (Object.hasOwn(block, "spec_kind") && block.spec_kind !== "spec") {
    findings.push(finding("structure/identity_invalid", 7, "error", "ldvh_spec.spec_kind", "spec_kind must be the fixed value \"spec\""));
  }
  if (Object.hasOwn(block, "title")) {
    const title = block.title;
    if (!isNonEmptyString(title)) {
      findings.push(finding("structure/identity_invalid", 7, "error", "ldvh_spec.title", "title must be a non-empty string"));
    } else {
      if (title.includes("/") || title.includes("\\")) findings.push(finding("structure/identity_invalid", 7, "error", "ldvh_spec.title", "title must not contain a path separator"));
      if (hasControlCharacter(title)) findings.push(finding("structure/identity_invalid", 7, "error", "ldvh_spec.title", "title must not contain control characters"));
      if (title !== title.trim()) findings.push(finding("structure/identity_invalid", 7, "error", "ldvh_spec.title", "title must not carry leading or trailing whitespace"));
    }
  }
  for (const field of ["positioning", "scope"]) {
    if (Object.hasOwn(block, field) && !isNonEmptyString(block[field])) {
      findings.push(finding("structure/identity_invalid", 7, "error", `ldvh_spec.${field}`, `${field} must be a non-empty string`));
    }
  }
  if (Object.hasOwn(block, "canonical_path")) {
    const canonicalPath = block.canonical_path;
    const expected = typeof specKey === "string" && ID_PATTERN.test(specKey) ? `${RUNTIME_CARRIER_NAMESPACES.RUNTIME}/${specKey}.yaml` : null;
    if (typeof canonicalPath !== "string" || canonicalPath.length === 0) {
      findings.push(finding("structure/identity_invalid", 7, "error", "ldvh_spec.canonical_path", "canonical_path must be a non-empty string"));
    } else {
      if (expected !== null && canonicalPath !== expected) {
        findings.push(finding("structure/identity_invalid", 7, "error", "ldvh_spec.canonical_path", `canonical_path must equal "${expected}"`, { expected }));
      }
      if (actualPath !== undefined && canonicalPath !== actualPath) {
        findings.push(finding("structure/path_mismatch", 7, "error", "ldvh_spec.canonical_path", `canonical_path "${canonicalPath}" does not match the actual path "${actualPath}"`, { actualPath }));
      }
    }
  }
  const ownDescriptor = typeof specKey === "string" && typeof block.canonical_path === "string"
    ? (context.carrierCatalog ?? []).filter((carrier) => carrier.specKey === specKey && carrier.canonicalPath !== block.canonical_path && carrier.canonicalPath !== context.actualPath)
    : [];
  if (typeof specKey === "string" && ownDescriptor.length > 0) {
    findings.push(finding("structure/ident_ambiguous", 7, "error", "ldvh_spec.spec_key", `spec_key "${specKey}" is already used by ${ownDescriptor.map((carrier) => carrier.canonicalPath).join(", ")}`));
  }
  if (Object.hasOwn(block, "carries")) {
    const carries = block.carries;
    if (!Array.isArray(carries)) {
      findings.push(finding("structure/optional_field_invalid", 7, "error", "ldvh_spec.carries", "carries must be an array of anchor strings"));
    } else if (carries.length === 0) {
      findings.push(finding("structure/optional_field_empty", 7, "error", "ldvh_spec.carries", "an optional field without a value must be omitted entirely, not written as an empty list"));
    }
  }
  if (Object.hasOwn(block, "role")) {
    if (block.role !== "router") {
      if (typeof block.role === "string" && block.role.length === 0) {
        findings.push(finding("structure/optional_field_empty", 7, "error", "ldvh_spec.role", "an optional field without a value must be omitted entirely, not written as an empty string"));
      } else {
        findings.push(finding("structure/role_invalid", 7, "error", "ldvh_spec.role", "role may only take the value \"router\""));
      }
    }
  }
  return { specKey, role: block.role };
}

function validateRequirements(block, findings, measurements) {
  if (!Object.hasOwn(block, "requirements")) {
    findings.push(finding("structure/requirements_missing", 7, "error", "ldvh_spec.requirements", "requirements is the required container of requirement entries"));
    return;
  }
  const requirements = block.requirements;
  if (!Array.isArray(requirements)) {
    findings.push(finding("structure/requirements_invalid", 7, "error", "ldvh_spec.requirements", "requirements must be a list of requirement entries"));
    return;
  }
  measurements.requirementCount = requirements.length;
  const seenIds = new Set();
  requirements.forEach((entry, index) => {
    const path = `ldvh_spec.requirements[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      findings.push(finding("structure/requirements_invalid", 7, "error", path, "a requirement entry must be a mapping"));
      return;
    }
    for (const field of RUNTIME_REQUIREMENT_FIELDS) {
      if (!Object.hasOwn(entry, field)) {
        findings.push(finding("structure/requirement_field_missing", 7, "error", `${path}.${field}`, `requirement entry is missing "${field}"`));
      }
    }
    for (const key of Object.keys(entry)) {
      if (RUNTIME_REQUIREMENT_FIELDS.includes(key)) continue;
      findings.push(finding("structure/requirement_unknown_field", 7, "error", `${path}.${key}`, `requirement entry field "${key}" is outside the closed set`));
    }
    if (Object.hasOwn(entry, "id")) {
      if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
        findings.push(finding("structure/requirement_id_invalid", 7, "error", `${path}.id`, "requirement id must be a lowercase kebab-case identifier"));
      } else if (seenIds.has(entry.id)) {
        findings.push(finding("structure/requirement_id_duplicate", 7, "error", `${path}.id`, `requirement id "${entry.id}" is duplicated inside this carrier`));
      } else {
        seenIds.add(entry.id);
      }
    }
    if (Object.hasOwn(entry, "title") && !isNonEmptyString(entry.title)) {
      findings.push(finding("structure/requirement_value_invalid", 7, "error", `${path}.title`, "requirement title must be a non-empty string"));
    }
    if (Object.hasOwn(entry, "text")) {
      if (typeof entry.text !== "string" || entry.text.trim().length === 0) {
        findings.push(finding("structure/requirement_value_invalid", 7, "error", `${path}.text`, "requirement text must be a non-empty string"));
      } else {
        const length = textCodePoints(entry.text);
        if (length > measurements.maxTextCodePoints) {
          measurements.maxTextCodePoints = length;
          measurements.maxTextFieldPath = `${path}.text`;
        }
      }
    }
  });
}

function validateVolume(block, requirementsPresent, measurements, findings) {
  const limits = RUNTIME_CARRIER_LIMITS;
  const count = Array.isArray(block.requirements) ? block.requirements.length : 0;
  measurements.requirementCount = count;
  measurements.requirementCountRemaining = limits.maxRequirements - count;
  if (requirementsPresent && Array.isArray(block.requirements) && (count < limits.minRequirements || count > limits.maxRequirements)) {
    findings.push(finding(
      "volume/requirement_count",
      8,
      "error",
      "ldvh_spec.requirements",
      `requirement count ${count} is outside ${limits.minRequirements}-${limits.maxRequirements}`,
      { measured: count, limit: [limits.minRequirements, limits.maxRequirements] }
    ));
  }
  if (requirementsPresent && Array.isArray(block.requirements)) {
    block.requirements.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || typeof entry.text !== "string") return;
      const length = textCodePoints(entry.text);
      if (length > limits.maxRequirementTextCodePoints) {
        findings.push(finding(
          "volume/text_too_long",
          8,
          "error",
          `ldvh_spec.requirements[${index}].text`,
          `requirement text is ${length} code points; the limit is ${limits.maxRequirementTextCodePoints}`,
          { measured: length, limit: limits.maxRequirementTextCodePoints, remaining: limits.maxRequirementTextCodePoints - length }
        ));
      }
    });
  }
  const bytes = Buffer.byteLength(String(measurements.text), "utf8");
  const carriesBytes = measurements.carriesBytes;
  const withoutCarries = bytes - carriesBytes;
  measurements.documentBytes = bytes;
  measurements.documentBytesRemaining = limits.maxDocumentBytes - bytes;
  measurements.documentBytesWithoutCarries = withoutCarries;
  measurements.documentBytesWithoutCarriesRemaining = limits.maxDocumentBytes - withoutCarries;
  measurements.carriesBytes = carriesBytes;
  if (bytes > limits.maxDocumentBytes && withoutCarries > limits.maxDocumentBytes) {
    findings.push(finding(
      "volume/document_bytes",
      8,
      "error",
      "ldvh_spec",
      `the carrier is ${bytes} bytes and ${withoutCarries} bytes without the carries registration; the limit is ${limits.maxDocumentBytes} under either reading`,
      { measured: bytes, measuredWithoutCarries: withoutCarries, limit: limits.maxDocumentBytes }
    ));
  } else if (bytes > limits.maxDocumentBytes) {
    findings.push(finding(
      "volume/document_bytes_scope_gap",
      8,
      "gap",
      "ldvh_spec",
      `the carrier is ${bytes} bytes with the carries registration (${measurementGap(limits.maxDocumentBytes - bytes)} over) and ${withoutCarries} bytes without it; the contract does not settle whether carries counts, so no verdict is issued`,
      { measured: bytes, measuredWithoutCarries: withoutCarries, limit: limits.maxDocumentBytes }
    ));
  }
}

function measurementGap(value) {
  if (value < 0) return `${-value} bytes`;
  return `${value} bytes within`;
}

function carriesByteSpan(text, blockNode) {
  if (blockNode === null || !isMap(blockNode)) return 0;
  const pair = blockNode.items.find((item) => isScalar(item.key) && item.key.value === "carries");
  if (pair === undefined) return 0;
  const start = pair.key.range?.[0];
  const end = pair.value?.range?.[1];
  if (typeof start !== "number" || typeof end !== "number" || end < start) return 0;
  return Buffer.byteLength(String(text).slice(start, end), "utf8");
}

function validateAnchors(block, developmentSpecs, findings) {
  if (!Object.hasOwn(block, "carries") || !Array.isArray(block.carries)) return;
  const seen = new Set();
  block.carries.forEach((anchor, index) => {
    const path = `ldvh_spec.carries[${index}]`;
    if (typeof anchor !== "string" || anchor.trim().length === 0) {
      findings.push(finding("structure/optional_field_invalid", 7, "error", path, "a carries member must be a non-empty anchor string"));
      return;
    }
    if (seen.has(anchor)) {
      findings.push(finding("anchor/duplicate", "6.2", "error", path, `anchor "${anchor}" appears more than once in this carrier's carries`));
    }
    seen.add(anchor);
    const resolved = resolveCarryAnchor(anchor, developmentSpecs);
    if (resolved.ok) return;
    const level = "error";
    if (resolved.error.code === "anchor/form_invalid") {
      findings.push(finding("anchor/form_invalid", "6.2", level, path, resolved.error.message, { anchor }));
      return;
    }
    if (resolved.error.code === "anchor/target_unknown") {
      findings.push(finding("anchor/target_unknown", "6.2", level, path, resolved.error.message, { anchor }));
      return;
    }
    if (resolved.error.code === "anchor/heading_ambiguous") {
      findings.push(finding("anchor/heading_ambiguous", "6.2", level, path, resolved.error.message, { anchor }));
      return;
    }
    if (resolved.error.code === "anchor/empty_locator") {
      findings.push(finding("anchor/empty_locator", "6.2", level, path, resolved.error.message, { anchor }));
      return;
    }
    findings.push(finding("anchor/heading_not_found", "6.2", level, path, resolved.error.message, { anchor }));
  });
}

function exploreRouterEntries(block, allCarriers, ownKey, role, findings, routerSpans) {
  if (role !== "router" || !Array.isArray(block.requirements)) return;
  block.requirements.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || typeof entry.text !== "string") return;
    const path = `ldvh_spec.requirements[${index}].text`;
    const text = entry.text;
    const pathValues = collectMatches(PATH_VALUE_PATTERN, text);
    if (pathValues.length !== 1) {
      findings.push(finding(
        "structure/router_target_count",
        "5.7",
        "error",
        path,
        `a router entry must carry exactly one target path value; found ${pathValues.length}`
      ));
      return;
    }
    const target = pathValues[0];
    const targetCarrier = allCarriers.find((carrier) => carrier.canonicalPath === target.text);
    if (targetCarrier === undefined) {
      findings.push(finding("structure/router_target_unresolved", "5.7", "error", path, `router target "${target.text}" is not an existing runtime carrier path`, { matched: target.text }));
      return;
    }
    if (targetCarrier.specKey === ownKey) {
      findings.push(finding("structure/router_target_self", "5.7", "error", path, "a router entry must not point at the router itself", { matched: target.text }));
      return;
    }
    if (targetCarrier.role === "router") {
      findings.push(finding("structure/router_target_router", "5.7", "error", path, "a router entry must not point at another router", { matched: target.text }));
      return;
    }
    const remainder = maskRange(text, target.index, target.index + target.text.length);
    const remainderHits = collectCarrierReferenceHits(remainder, allCarriers);
    for (const match of collectMatches(SECTION_PATTERN, remainder)) remainderHits.push(match);
    if (remainderHits.length > 0) return;
    routerSpans.set(path, { start: target.index, end: target.index + target.text.length });
  });
}

function scanValues(block, context, findings) {
  const values = [];
  collectScalarValues(block, "ldvh_spec", values);
  for (const value of values) {
    scanLoadBearingMarkers(value.value, value.path, findings);
  }
  for (const value of values) {
    const text = maskLiteral(value.value, context.ownPath);
    const item1Text = context.routerSpans.has(value.path) ? maskRange(text, context.routerSpans.get(value.path).start, context.routerSpans.get(value.path).end) : text;
    scanOtherCarrierReferences(item1Text, value.path, context, findings);
    scanDevelopmentSpecReferences(text, value.path, context, findings);
    scanSectionReferences(text, value.path, findings);
    scanTableSyntax(value.value, value.path, findings);
    scanWeakWording(value.value, value.path, findings);
    scanGuidancePhrases(value.value, value.path, findings);
  }
}

export function validateRuntimeCarrier(input = {}) {
  const text = typeof input.text === "string" ? input.text : "";
  const actualPath = input.actualPath;
  const carrierCatalog = Array.isArray(input.carrierCatalog) ? input.carrierCatalog.filter((carrier) => isNonEmptyString(carrier?.specKey)) : [];
  const developmentSpecs = Array.isArray(input.developmentSpecs) ? input.developmentSpecs.filter((spec) => isNonEmptyString(spec?.specKey)) : [];
  const structure = validateStructure(text);
  const findings = [...structure.findings];
  const measurements = {
    text,
    carriesBytes: carriesByteSpan(text, structure.blockNode),
    requirementCount: 0,
    requirementCountRemaining: RUNTIME_CARRIER_LIMITS.maxRequirements,
    maxTextCodePoints: 0,
    maxTextFieldPath: null,
    documentBytes: 0,
    documentBytesRemaining: RUNTIME_CARRIER_LIMITS.maxDocumentBytes,
    documentBytesWithoutCarries: 0,
    documentBytesWithoutCarriesRemaining: RUNTIME_CARRIER_LIMITS.maxDocumentBytes
  };
  if (structure.block === null) {
    measurements.documentBytes = Buffer.byteLength(text, "utf8");
    measurements.documentBytesRemaining = RUNTIME_CARRIER_LIMITS.maxDocumentBytes - measurements.documentBytes;
    measurements.documentBytesWithoutCarries = measurements.documentBytes;
    measurements.documentBytesWithoutCarriesRemaining = measurements.documentBytesRemaining;
    return finishCarrierResult(findings, measurements, { specKey: null, canonicalPath: null });
  }
  const block = structure.block;
  const context = { ownKey: null, ownPath: null, actualPath, carrierCatalog, developmentSpecs, otherCarriers: [], routerSpans: new Map() };
  const identity = validateIdentity(block, actualPath, context, findings);
  context.ownKey = identity.specKey;
  context.ownPath = block.canonical_path;
  context.otherCarriers = carrierCatalog.filter((carrier) => carrier.specKey !== identity.specKey && carrier.canonicalPath !== block.canonical_path);
  const ownDescriptor = { specKey: identity.specKey, canonicalPath: block.canonical_path, role: identity.role };
  const allCarriers = [ownDescriptor, ...carrierCatalog.filter((carrier) => carrier.specKey !== identity.specKey)];
  validateRequirements(block, findings, measurements);
  const requirementsPresent = Object.hasOwn(block, "requirements");
  validateVolume(block, requirementsPresent, measurements, findings);
  validateAnchors(block, developmentSpecs, findings);
  if (!Object.hasOwn(block, "carries") && identity.role !== "router") {
    findings.push(finding(
      "hint/source_missing",
      "6.2",
      "hint",
      "ldvh_spec.carries",
      "the carrier declares no carries registration; this is a source-missing hint for independent review, not a form failure"
    ));
  }
  exploreRouterEntries(block, allCarriers, identity.specKey, identity.role, findings, context.routerSpans);
  scanValues(block, context, findings);
  return finishCarrierResult(findings, measurements, { specKey: identity.specKey, canonicalPath: typeof block.canonical_path === "string" ? block.canonical_path : null });
}

function verdictOf(findings) {
  if (findings.some((item) => item.level === "error")) return "fail";
  if (findings.some((item) => item.level === "gap")) return "undetermined";
  return "pass";
}

function finishCarrierResult(findings, measurements, carrier) {
  const ordered = orderFindings(findings);
  const verdict = verdictOf(ordered);
  return {
    ok: verdict === "pass",
    verdict,
    carrier,
    findings: ordered,
    measurements: {
      requirementCount: measurements.requirementCount,
      requirementCountRemaining: measurements.requirementCountRemaining,
      maxTextCodePoints: measurements.maxTextCodePoints,
      maxTextFieldPath: measurements.maxTextFieldPath,
      documentBytes: measurements.documentBytes,
      documentBytesRemaining: measurements.documentBytesRemaining,
      documentBytesWithoutCarries: measurements.documentBytesWithoutCarries,
      documentBytesWithoutCarriesRemaining: measurements.documentBytesWithoutCarriesRemaining,
      carriesBytes: measurements.carriesBytes
    }
  };
}

function orderFindings(findings) {
  const rank = (item) => {
    if (item === 7) return 0;
    if (item === 8) return 1;
    if (item === "6.2") return 2;
    if (item === "5.7") return 3;
    if (typeof item === "number") return 4 + item;
    return 20;
  };
  return [...findings].sort((left, right) => {
    const byRank = rank(left.item) - rank(right.item);
    if (byRank !== 0) return byRank;
    if (left.fieldPath === right.fieldPath) return 0;
    return left.fieldPath < right.fieldPath ? -1 : 1;
  });
}

export function validateRuntimeCarrierCorpus(input = {}) {
  const carriers = Array.isArray(input.carriers) ? input.carriers : [];
  const developmentSpecs = Array.isArray(input.developmentSpecs) ? input.developmentSpecs : [];
  const catalog = carriers.map((carrier) => descriptorFromText(carrier.text, carrier.actualPath));
  const results = carriers.map((carrier) => validateRuntimeCarrier({
    text: carrier.text,
    actualPath: carrier.actualPath,
    carrierCatalog: catalog,
    developmentSpecs
  }));
  const corpusFindings = [];
  const routers = results.filter((result, index) => catalog[index]?.role === "router");
  if (routers.length > 1) {
    corpusFindings.push(finding(
      "structure/router_multiple",
      7,
      "error",
      "ldvh_spec.role",
      `the corpus holds ${routers.length} carriers with role: router; at most one is allowed`,
      { carriers: routers.map((result) => result.carrier.canonicalPath) }
    ));
  }
  const allFindings = results.flatMap((result) => result.findings).concat(corpusFindings);
  const verdict = verdictOf(allFindings);
  return {
    ok: verdict === "pass",
    verdict,
    results,
    findings: corpusFindings,
    summary: {
      carrierCount: carriers.length,
      verdict,
      errorCount: allFindings.filter((item) => item.level === "error").length,
      hintCount: allFindings.filter((item) => item.level === "hint").length,
      gapCount: allFindings.filter((item) => item.level === "gap").length,
      routerCount: routers.length
    }
  };
}

export function createSpecNamespaceView(coverage = {}) {
  const namespaces = [];
  const entries = [];
  if (Object.hasOwn(coverage, "runtimeCarriers")) {
    namespaces.push(RUNTIME_CARRIER_NAMESPACES.RUNTIME);
    for (const carrier of coverage.runtimeCarriers ?? []) {
      entries.push({ namespace: RUNTIME_CARRIER_NAMESPACES.RUNTIME, specKey: carrier.specKey, canonicalPath: carrier.canonicalPath });
    }
  }
  if (Object.hasOwn(coverage, "developmentSpecs")) {
    namespaces.push(RUNTIME_CARRIER_NAMESPACES.DEVELOPMENT);
    for (const spec of coverage.developmentSpecs ?? []) {
      entries.push({ namespace: RUNTIME_CARRIER_NAMESPACES.DEVELOPMENT, specKey: spec.specKey, canonicalPath: spec.canonicalPath });
    }
  }
  return Object.freeze({ namespaces: Object.freeze(namespaces), entries: Object.freeze(entries) });
}

export function resolveSpecReference(view, request = {}) {
  const namespaces = view?.namespaces ?? [];
  const entries = view?.entries ?? [];
  const hasPath = isNonEmptyString(request.canonicalPath);
  const hasKey = isNonEmptyString(request.specKey);
  if (hasPath && hasKey) return reject("namespace/request_invalid", "a resolution request must carry either a spec_key or a canonical path, not both");
  if (!hasPath && !hasKey) return reject("namespace/request_invalid", "a resolution request must carry a spec_key or a canonical path");
  if (hasPath) {
    const hits = entries.filter((entry) => entry.canonicalPath === request.canonicalPath);
    if (hits.length === 0) return reject("namespace/path_not_found", `no covered namespace holds the path "${request.canonicalPath}"`);
    if (hits.length > 1) return reject("namespace/path_ambiguous", `the path "${request.canonicalPath}" resolves to more than one entry`);
    if (request.namespace !== undefined && request.namespace !== hits[0].namespace) {
      return reject("namespace/path_mismatch", `the path "${request.canonicalPath}" belongs to namespace "${hits[0].namespace}", not "${request.namespace}"`);
    }
    return { ok: true, value: { ...hits[0] } };
  }
  let namespace = request.namespace;
  if (namespace !== undefined) {
    if (!namespaces.includes(namespace)) return reject("namespace/not_covered", `namespace "${namespace}" is not covered by this view`);
  } else {
    if (namespaces.length > 1) {
      return reject(
        "namespace/ambiguous_identifier",
        `this view covers ${namespaces.join(" and ")}; an identifier-only request is rejected, so name the namespace or give a canonical path`
      );
    }
    if (namespaces.length === 0) return reject("namespace/not_covered", "this view covers no namespace");
    namespace = namespaces[0];
  }
  const hits = entries.filter((entry) => entry.namespace === namespace && entry.specKey === request.specKey);
  if (hits.length === 0) return reject("namespace/not_found", `namespace "${namespace}" holds no carrier with spec_key "${request.specKey}"`);
  if (hits.length > 1) return reject("namespace/ambiguous_identifier", `namespace "${namespace}" holds more than one carrier with spec_key "${request.specKey}"`);
  return { ok: true, value: { ...hits[0] } };
}
