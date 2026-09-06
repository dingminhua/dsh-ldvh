// LDVH specification identity-block parsing, heading resolution, and L0–L4
// projections.
//
// Pure functions over text: no host services, no filesystem, no clock.
// Semantics authority: specs/01 §6 (identity block contract, elaborated by
// 01.Att.02 field tables) and 01.Att.03 §4 (L0–L4 disclosure levels).
// The parser implements the closed-set contract: unknown fields, duplicate
// YAML keys, unquoted scalar strings, misplaced identity blocks and
// ambiguous heading paths are rejected — never silently repaired.
// Algorithmic lineage: the heading-path uniqueness rule and the L0–L2
// projection shapes are adapted from v4
// code/ldvh/specs/{identity,markdown,projection}.py; see
// docs/p0-implementation-plan.md §2 for the minimal absorption record.

import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

const SPEC_FIELDS = ["spec_key", "spec_id", "spec_kind", "title", "canonical_path", "parent_spec", "relation", "positioning", "scope", "basis", "authorized_attachments", "dimensions", "supersedes", "related_specs"];
const ROOT_ONLY_FIELDS = ["authority", "code_consumption"];
// 01.Att.02 §5: attachments declare exactly key/id/title/path/positioning
// plus optional supersedes — no attachment_kind, scope, basis, parent_spec,
// relation, dimensions, authorized_attachments or related_specs.
const ATTACHMENT_FIELDS = ["attachment_key", "attachment_id", "title", "canonical_path", "positioning", "supersedes"];
const DIMENSION_VALUES = ["read", "write", "orchestrate", "memory", "research", "discussion", "comply"];
const RELATION_VALUES = ["refines"];
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SPEC_ID_PATTERN = /^[0-9]{2,}$/;
const ATTACHMENT_ID_PATTERN = /^[0-9]{2,}\.Att\.[0-9]{2,}$/;
const SPEC_PATH_PATTERN = /^specs\/[0-9]{2,}-[^/]+\.md$/;
const ATTACHMENT_PATH_PATTERN = /^specs\/attachments\/[0-9]{2,}\.Att\.[0-9]{2,}-[^/]+\.md$/;

function reject(code, message) {
  return { ok: false, error: { code, message } };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Split the fixed-position identity block: the file must open with a YAML
 * frontmatter formation (`---` fence at line 1, closed by a matching `---`)
 * containing the identity mapping (01.Att.02 §1, unified frontmatter form).
 * The first markdown line after the frontmatter must be the single H1.
 * A later ```yaml fence inside the body (an example block) does not form a
 * second identity block and is not rejected. Returns the H1 text, the yaml
 * block text and the 1-based line where the block opens.
 */
export function splitIdentityBlock(markdownText) {
  const lines = markdownText.split("\n");
  if (lines[0] !== "---") return reject("identity/fence_missing", "frontmatter fence must open at line 1");
  const closeIndex = lines.indexOf("---", 1);
  if (closeIndex === -1) return reject("identity/fence_unclosed", "the frontmatter fence is never closed");
  const yamlText = lines.slice(1, closeIndex).join("\n");
  const afterFence = closeIndex + 1;
  if (lines[afterFence] !== "") return reject("identity/block_position", "frontmatter close must be followed by exactly one blank line before the H1");
  const h1Index = lines.findIndex((line, i) => i > afterFence && /^# \S/.test(line));
  if (h1Index === -1) return reject("identity/h1_missing", "the file must contain exactly one H1 after the frontmatter");
  const h1Count = lines.filter((line) => /^# /.test(line)).length;
  if (h1Count > 1) return reject("identity/h1_missing", "the file must contain exactly one H1");
  const h1 = lines[h1Index].slice(2).trim();
  return { ok: true, value: { h1, yamlText, yamlLine: 1, totalLines: lines.length } };
}

/**
 * Enforce the closed-shape guarantees the `yaml` parser itself cannot
 * express: duplicate top-level keys are rejected, and every top-level field
 * whose value is a scalar (not a sequence, block or flow collection) must be
 * written as a double-quoted YAML string (01.Att.02 §1).
 */
function assertIdentityShape(yamlText) {
  const seen = new Set();
  for (const line of yamlText.split("\n")) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = line.match(/^  ([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (match === null) continue;
    const [, key, rest] = match;
    if (seen.has(key)) return reject("identity/duplicate_key", `duplicate top-level key "${key}"`);
    seen.add(key);
    const value = rest.trim();
    if (value.length === 0) continue; // block sequence / nested mapping opens below
    if (value.startsWith("[")) continue; // flow sequence: members carry their own quotes
    if (value.startsWith("{")) return reject("identity/field_invalid", `field "${key}" must not use a flow mapping`);
    if (!value.startsWith("\"") || !/"$/.test(value)) return reject("identity/field_invalid", `field "${key}" must use a double-quoted YAML string`);
  }
  return { ok: true, value: true };
}

function validateStringList(value, field, { allowEmpty }) {
  if (!Array.isArray(value)) return reject("identity/field_invalid", `${field} must be a sequence`);
  if (!allowEmpty && value.length === 0) return reject("identity/field_invalid", `${field} must not be empty`);
  for (const item of value) {
    if (!isNonEmptyString(item)) return reject("identity/field_invalid", `${field} members must be non-empty strings`);
  }
  if (new Set(value).size !== value.length) return reject("identity/field_invalid", `${field} members must be unique`);
  return { ok: true, value };
}

function validateDimensions(value, { required }) {
  if (value === undefined) return required ? reject("identity/field_missing", "dimensions is required") : { ok: true, value: undefined };
  if (!Array.isArray(value) || value.length === 0) return reject("identity/field_invalid", "dimensions must be a non-empty sequence when present");
  for (const item of value) {
    if (!DIMENSION_VALUES.includes(item)) return reject("identity/field_invalid", `dimensions member "${item}" is outside the closed set`);
  }
  if (new Set(value).size !== value.length) return reject("identity/field_invalid", "dimensions members must be unique");
  return { ok: true, value };
}

/**
 * Parse one identity block (`ldvh_spec` or `ldvh_attachment` mapping) into a
 * projected identity, or reject with a stable code. Field requirements follow
 * 01.Att.02 §3 (root profile), §4 (ordinary spec) and §5 (attachment).
 */
export function parseIdentityBlock(yamlText) {
  const shapeCheck = assertIdentityShape(yamlText);
  if (!shapeCheck.ok) return shapeCheck;
  let parsed;
  try {
    parsed = parseYaml(yamlText, { schema: "core" });
  } catch (error) {
    return reject("identity/yaml_invalid", String(error?.message ?? error));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return reject("identity/yaml_invalid", "identity root must be a mapping");
  const keys = Object.keys(parsed);
  if (keys.length !== 1) return reject("identity/top_level", `identity root must contain exactly one of ldvh_spec/ldvh_attachment (found: ${keys.join(", ")})`);
  const kind = keys[0];
  if (kind !== "ldvh_spec" && kind !== "ldvh_attachment") return reject("identity/top_level", `unknown identity root "${kind}"`);
  const block = parsed[kind];
  if (typeof block !== "object" || block === null || Array.isArray(block)) return reject("identity/yaml_invalid", `${kind} must be a mapping`);
  const allowed = kind === "ldvh_spec" ? [...SPEC_FIELDS, ...ROOT_ONLY_FIELDS] : ATTACHMENT_FIELDS;
  const unknownFields = Object.keys(block).filter((key) => !allowed.includes(key));
  if (unknownFields.length > 0) return reject("identity/unknown_field", `unknown ${kind} field(s): ${unknownFields.join(", ")}`);
  const identity = {
    kind,
    responsibilityKey: block.spec_key ?? block.attachment_key,
    specId: block.spec_id ?? block.attachment_id,
    specKind: block.spec_kind ?? block.attachment_kind,
    title: block.title,
    canonicalPath: block.canonical_path,
    parentSpec: block.parent_spec,
    relation: block.relation,
    positioning: block.positioning,
    scope: block.scope,
    basis: block.basis,
    authorizedAttachments: block.authorized_attachments,
    dimensions: block.dimensions,
    supersedes: block.supersedes,
    relatedSpecs: block.related_specs,
    codeConsumption: block.code_consumption,
    authority: block.authority
  };
  for (const [field, value] of [["title", identity.title], ["positioning", identity.positioning], ["canonical_path", identity.canonicalPath]]) {
    if (!isNonEmptyString(value)) return reject("identity/field_missing", `${field} must be a non-empty string`);
  }
  if (identity.title.includes("/") || identity.title.includes("\\")) return reject("identity/field_invalid", "title must not contain \"/\" or \"\\\"");
  if (!ID_PATTERN.test(identity.responsibilityKey ?? "")) return reject("identity/field_invalid", `${kind === "ldvh_spec" ? "spec_key" : "attachment_key"} must match the responsibility-identifier pattern`);
  if (kind === "ldvh_spec") {
    if (identity.specKind !== "spec") return reject("identity/field_invalid", "spec_kind must be \"spec\"");
    if (!SPEC_ID_PATTERN.test(identity.specId ?? "")) return reject("identity/field_invalid", "spec_id must match the numeric spec-number pattern");
    if (!SPEC_PATH_PATTERN.test(identity.canonicalPath)) return reject("identity/field_invalid", "canonical_path must match the spec path format");
    if (!isNonEmptyString(identity.scope ?? "")) return reject("identity/field_missing", "scope must be a non-empty string");
  }
  const isRoot = kind === "ldvh_spec" && identity.responsibilityKey === "ldvh-root";
  if (kind === "ldvh_spec") {
    if (isRoot) {
      if (identity.authority !== "active") return reject("identity/field_invalid", "the root profile must declare authority: \"active\"");
      if (identity.codeConsumption === undefined) return reject("identity/field_missing", "the root profile must declare code_consumption");
      if (identity.title !== "理念与构成" || identity.specId !== "00" || identity.canonicalPath !== "specs/00-理念与构成.md" || identity.parentSpec !== "" || identity.relation !== "") return reject("identity/field_invalid", "root profile fixed values do not match 01.Att.02 §3");
      const dimensions = validateDimensions(identity.dimensions, { required: true });
      if (!dimensions.ok) return dimensions;
      if (JSON.stringify(dimensions.value) !== JSON.stringify(DIMENSION_VALUES)) return reject("identity/field_invalid", "the root profile must declare the full seven dimensions in canonical order");
      const basis = validateStringList(identity.basis, "basis", { allowEmpty: true });
      if (!basis.ok) return basis;
      identity.basis = basis.value;
      const consumption = validateStringList(identity.codeConsumption, "code_consumption", { allowEmpty: false });
      if (!consumption.ok) return consumption;
      for (const item of consumption.value) if (!ID_PATTERN.test(item)) return reject("identity/field_invalid", "code_consumption members must match the responsibility-identifier pattern");
    } else {
      if (identity.authority !== undefined) return reject("identity/unknown_field", "authority is reserved for the root profile");
      if (identity.codeConsumption !== undefined) return reject("identity/unknown_field", "code_consumption is reserved for the root profile");
    }
  } else {
    if (!ATTACHMENT_ID_PATTERN.test(identity.specId ?? "")) return reject("identity/field_invalid", "attachment_id must match the attachment-number pattern");
    if (!ATTACHMENT_PATH_PATTERN.test(identity.canonicalPath)) return reject("identity/field_invalid", "canonical_path must match the attachment path format");
    // 01.Att.02 §5: attachments declare neither scope, basis, parent_spec,
    // relation, dimensions, authorized_attachments nor related_specs.
    for (const [field, value] of [["scope", identity.scope], ["basis", identity.basis], ["parent_spec", identity.parentSpec], ["relation", identity.relation], ["dimensions", identity.dimensions], ["authorized_attachments", identity.authorizedAttachments], ["related_specs", identity.relatedSpecs]]) {
      if (value !== undefined) return reject("identity/unknown_field", `attachments do not declare ${field}`);
    }
  }
  if (kind === "ldvh_spec") {
    const parentSpec = identity.parentSpec ?? "";
    const relation = identity.relation ?? "";
    if (parentSpec === "" && relation === "") {
      // no structural parent: valid for the root spec and parent-less specs
    } else if (parentSpec !== "" && relation !== "") {
      if (!RELATION_VALUES.includes(relation)) return reject("identity/field_invalid", `relation "${relation}" is outside the closed set`);
      if (parentSpec === identity.responsibilityKey) return reject("identity/field_invalid", "parent_spec must not point at the document itself");
    } else {
      return reject("identity/field_invalid", "parent_spec and relation must both be empty or both non-empty");
    }
    if (parentSpec !== "" && !ID_PATTERN.test(parentSpec)) return reject("identity/field_invalid", "parent_spec must be a responsibility identifier or empty");
    const basisCheck = identity.basis === undefined ? { ok: true, value: [] } : validateStringList(identity.basis, "basis", { allowEmpty: true });
    if (!basisCheck.ok) return basisCheck;
    identity.basis = basisCheck.value;
    if (identity.basis.includes(identity.responsibilityKey)) return reject("identity/field_invalid", "basis must not contain the document's own key");
    if (parentSpec !== "" && identity.basis.includes(parentSpec)) return reject("identity/field_invalid", "basis must not name the same target as parent_spec");
    const authorizedCheck = identity.authorizedAttachments === undefined ? { ok: true, value: [] } : validateStringList(identity.authorizedAttachments, "authorized_attachments", { allowEmpty: true });
    if (!authorizedCheck.ok) return authorizedCheck;
    identity.authorizedAttachments = authorizedCheck.value;
    const dimensionCheck = validateDimensions(identity.dimensions, { required: false });
    if (!dimensionCheck.ok) return dimensionCheck;
    identity.dimensions = dimensionCheck.value;
  }
  const supersedesCheck = identity.supersedes === undefined ? { ok: true } : validateStringList(identity.supersedes, "supersedes", { allowEmpty: false });
  if (!supersedesCheck.ok) return supersedesCheck;
  // 01.Att.02 §3 table: root related_specs is 必填; allows empty list; regular
  // specs: optional; if present must be non-empty (规范 §3: "可选；若出现必须非空").
  const relatedAllowEmpty = isRoot;
  const relatedCheck = identity.relatedSpecs === undefined ? { ok: true } : validateStringList(identity.relatedSpecs, "related_specs", { allowEmpty: relatedAllowEmpty });
  if (!relatedCheck.ok) return relatedCheck;
  for (const list of [identity.supersedes, identity.relatedSpecs]) {
    for (const key of list ?? []) if (key === identity.responsibilityKey) return reject("identity/field_invalid", "relation lists must not contain the document's own key");
  }
  return { ok: true, value: identity };
}

/**
 * Parse a full specification/attachment document: split the identity block,
 * parse it, and cross-check the H1 against the identity title plus the
 * canonical path against the requested repo-relative path (01.Att.02 §1:
 * title, file name and identity must match verbatim).
 */
export function parseSpecDocument(markdownText, actualPath) {
  const split = splitIdentityBlock(markdownText);
  if (!split.ok) return split;
  const identity = parseIdentityBlock(split.value.yamlText);
  if (!identity.ok) return identity;
  if (split.value.h1 !== identity.value.title) return reject("identity/title_mismatch", `H1 "${split.value.h1}" does not match identity title "${identity.value.title}"`);
  if (actualPath !== undefined && identity.value.canonicalPath !== actualPath) return reject("identity/path_mismatch", `canonical_path "${identity.value.canonicalPath}" does not match the actual path "${actualPath}"`);
  return { ok: true, value: { identity: identity.value, h1: split.value.h1, markdownText, totalLines: split.value.totalLines } };
}

/** Extract `##`/`###` headings with 1-based line numbers, verbatim text. */
export function extractHeadings(markdownText) {
  const headings = [];
  const lines = markdownText.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(##|###) (.*)$/);
    if (match === null) continue;
    headings.push({ level: match[1].length, text: match[2].trim(), line: index + 1 });
  }
  return headings;
}

/**
 * Resolve an exact H2 or H2/H3 heading path (01 §10.3). The path must be
 * unique within one carrier: duplicates or ambiguity reject instead of
 * picking the first match. Returns 1-based inclusive start/end lines; the
 * section runs from the heading line to the line before the next same-or-
 * higher level heading (file end when none follows).
 */
export function resolveHeadingPath(markdownText, headingPath) {
  if (typeof headingPath !== "string" || headingPath.length === 0) return reject("content/heading_path_invalid", "heading_path must be a non-empty string");
  const segments = headingPath.split("/").map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0) || segments.length > 2) return reject("content/heading_path_invalid", "heading_path must be one H2 or one H2/H3 pair joined by \"/\"");
  const headings = extractHeadings(markdownText);
  const lines = markdownText.split("\n");
  const fileEnd = lines.length;
  const sectionEnd = (current) => {
    const next = headings.find((heading) => heading.line > current.line && heading.level <= current.level);
    return next === undefined ? fileEnd : next.line - 1;
  };
  const h2Matches = headings.filter((heading) => heading.level === 2 && heading.text === segments[0]);
  if (h2Matches.length === 0) return reject("content/heading_not_found", `no H2 heading matches "${segments[0]}"`);
  if (h2Matches.length > 1) return reject("content/heading_ambiguous", `H2 heading "${segments[0]}" appears ${h2Matches.length} times`);
  const h2 = h2Matches[0];
  if (segments.length === 1) return { ok: true, value: { startLine: h2.line, endLine: sectionEnd(h2) } };
  const h2End = sectionEnd(h2);
  const h3Matches = headings.filter((heading) => heading.level === 3 && heading.text === segments[1] && heading.line > h2.line && heading.line <= h2End);
  if (h3Matches.length === 0) return reject("content/heading_not_found", `no H3 heading matches "${segments[1]}" inside "${segments[0]}"`);
  if (h3Matches.length > 1) return reject("content/heading_ambiguous", `H3 heading "${segments[1]}" appears ${h3Matches.length} times inside "${segments[0]}"`);
  return { ok: true, value: { startLine: h3Matches[0].line, endLine: sectionEnd(h3Matches[0]) } };
}

/** sha256 hex digest of the exact text — the content fingerprint anchor. */
export function contentFingerprint(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Project an identity to a disclosure layer (01.Att.03 §4). Each layer adds
 * content on top of the previous one; the projection never claims validity
 * beyond disclosure depth. Optional relation fields are omitted when absent.
 * Attachments project without the spec-only fields.
 */
export function projectLayer(identity, layer, sectionOutline) {
  const l0 = {
    layer: "L0",
    responsibility_key: identity.responsibilityKey,
    carrier_kind: identity.kind,
    spec_id: identity.specId,
    title: identity.title,
    canonical_path: identity.canonicalPath
  };
  if (layer === "L0") return l0;
  const l1 = { ...l0, layer: "L1", positioning: identity.positioning, ...(identity.scope === undefined ? {} : { scope: identity.scope }) };
  if (layer === "L1") return l1;
  const l2 = {
    ...l1,
    layer: "L2",
    ...(identity.kind === "ldvh_spec" ? { basis: identity.basis ?? [], parent_spec: identity.parentSpec ?? "", relation: identity.relation ?? "", authorized_attachments: identity.authorizedAttachments ?? [] } : {}),
    ...(identity.supersedes === undefined ? {} : { supersedes: identity.supersedes }),
    ...(identity.relatedSpecs === undefined ? {} : { related_specs: identity.relatedSpecs }),
    ...(identity.dimensions === undefined ? {} : { dimensions: identity.dimensions }),
    ...(identity.codeConsumption === undefined ? {} : { code_consumption: identity.codeConsumption }),
    ...(identity.authority === undefined ? {} : { authority: identity.authority }),
    ...(sectionOutline === undefined ? {} : { section_outline: sectionOutline })
  };
  return l2;
}
