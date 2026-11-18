
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

const SPEC_FIELDS = ["spec_key", "spec_id", "spec_kind", "title", "canonical_path", "parent_spec", "relation", "positioning", "scope", "basis", "authorized_attachments", "supersedes", "related_specs"];
const ROOT_ONLY_FIELDS = ["authority", "code_consumption"];
const ATTACHMENT_FIELDS = ["attachment_key", "attachment_id", "title", "canonical_path", "positioning", "supersedes"];
const RELATION_VALUES = ["refines"];
export const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
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

function fencedLineMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open === null) {
      if (match !== null && !(match[1][0] === "`" && match[2].includes("`"))) {
        open = { marker: match[1][0], length: match[1].length };
        mask[index] = true;
      }
      continue;
    }
    mask[index] = true;
    if (match === null) continue;
    const marker = match[1][0];
    if (marker !== open.marker) continue;
    if (match[1].length < open.length) continue;
    if (match[2].trim() !== "") continue;
    open = null;
  }
  return mask;
}

export function splitIdentityBlock(markdownText) {
  const lines = markdownText.split("\n");
  if (lines[0] !== "---") return reject("identity/fence_missing", "frontmatter fence must open at line 1");
  const closeIndex = lines.indexOf("---", 1);
  if (closeIndex === -1) return reject("identity/fence_unclosed", "the frontmatter fence is never closed");
  const yamlText = lines.slice(1, closeIndex).join("\n");
  const afterFence = closeIndex + 1;
  if (lines[afterFence] !== "") return reject("identity/block_position", "frontmatter close must be followed by exactly one blank line before the H1");
  const fenced = fencedLineMask(lines);
  const h1Index = lines.findIndex((line, i) => i > afterFence && !fenced[i] && /^# \S/.test(line));
  if (h1Index === -1) return reject("identity/h1_missing", "the file must contain exactly one H1 after the frontmatter");
  const h1Count = lines.filter((line, i) => !fenced[i] && /^# /.test(line)).length;
  if (h1Count > 1) return reject("identity/h1_missing", "the file must contain exactly one H1");
  const h1 = lines[h1Index].slice(2).trim();
  return { ok: true, value: { h1, yamlText, yamlLine: 1, totalLines: lines.length } };
}

function assertIdentityShape(yamlText) {
  const seen = new Set();
  for (const line of yamlText.split("\n")) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (match === null) continue;
    const [, key, rest] = match;
    if (seen.has(key)) return reject("identity/duplicate_key", `duplicate top-level key "${key}"`);
    seen.add(key);
    const value = rest.trim();
    if (value.length === 0) continue;
    if (value.startsWith("[")) continue;
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
    for (const [field, value] of [["scope", identity.scope], ["basis", identity.basis], ["parent_spec", identity.parentSpec], ["relation", identity.relation], ["authorized_attachments", identity.authorizedAttachments], ["related_specs", identity.relatedSpecs]]) {
      if (value !== undefined) return reject("identity/unknown_field", `attachments do not declare ${field}`);
    }
  }
  if (kind === "ldvh_spec") {
    const parentSpec = identity.parentSpec ?? "";
    const relation = identity.relation ?? "";
    if (parentSpec !== "" || relation !== "") {
      if (parentSpec === "" || relation === "") return reject("identity/field_invalid", "parent_spec and relation must both be empty or both non-empty");
      if (!RELATION_VALUES.includes(relation)) return reject("identity/field_invalid", `relation "${relation}" is outside the closed set`);
      if (parentSpec === identity.responsibilityKey) return reject("identity/field_invalid", "parent_spec must not point at the document itself");
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
  }
  const supersedesCheck = identity.supersedes === undefined ? { ok: true } : validateStringList(identity.supersedes, "supersedes", { allowEmpty: false });
  if (!supersedesCheck.ok) return supersedesCheck;
  const relatedAllowEmpty = isRoot;
  const relatedCheck = identity.relatedSpecs === undefined ? { ok: true } : validateStringList(identity.relatedSpecs, "related_specs", { allowEmpty: relatedAllowEmpty });
  if (!relatedCheck.ok) return relatedCheck;
  for (const list of [identity.supersedes, identity.relatedSpecs]) {
    for (const key of list ?? []) if (key === identity.responsibilityKey) return reject("identity/field_invalid", "relation lists must not contain the document's own key");
  }
  return { ok: true, value: identity };
}

export function parseSpecDocument(markdownText, actualPath) {
  const split = splitIdentityBlock(markdownText);
  if (!split.ok) return split;
  const identity = parseIdentityBlock(split.value.yamlText);
  if (!identity.ok) return identity;
  if (split.value.h1 !== identity.value.title) return reject("identity/title_mismatch", `H1 "${split.value.h1}" does not match identity title "${identity.value.title}"`);
  if (actualPath !== undefined && identity.value.canonicalPath !== actualPath) return reject("identity/path_mismatch", `canonical_path "${identity.value.canonicalPath}" does not match the actual path "${actualPath}"`);
  return { ok: true, value: { identity: identity.value, h1: split.value.h1, markdownText, totalLines: split.value.totalLines } };
}

export function extractHeadings(markdownText) {
  const headings = [];
  const lines = markdownText.split("\n");
  const fenced = fencedLineMask(lines);
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced[index]) continue;
    const match = lines[index].match(/^(##|###) (.*)$/);
    if (match === null) continue;
    headings.push({ level: match[1].length, text: match[2].trim(), line: index + 1 });
  }
  return headings;
}

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

export function contentFingerprint(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function parseOperationDeclarations(specText, resolveAnchor) {
  const rows = new Map();
  if (typeof specText !== "string" || specText.length === 0) {
    Object.defineProperty(rows, "reason", { value: "declaring source text is unavailable", enumerable: false });
    return rows;
  }
  const lines = specText.split("\n");
  const header = /^\|\s*operation_key\s*\|\s*summary\s*\|\s*effect\s*\|\s*arguments_contract\s*\|\s*result_contract\s*\|\s*$/;
  const tableStarts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (header.test(lines[i].trim())) tableStarts.push(i + 2);
  }
  if (tableStarts.length === 0) {
    Object.defineProperty(rows, "reason", { value: "no 05 §6.1 operation declaration table in the declaring source", enumerable: false });
    return rows;
  }
  for (const start of tableStarts) {
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/^`(.*)`$/s, "$1").trim());
    if (cells.length < 5) continue;
    const [operationKey, summary, effect, argumentsContract, resultContract] = cells;
    if (operationKey === "" || /^-+$/.test(operationKey)) continue;
    if (operationKey.startsWith("<")) continue;
    const effectValid = effect === "read" || effect === "may_change_state";
    const anchorErrors = [];
    if (!effectValid) anchorErrors.push(`effect "${effect}" is outside the closed set (read|may_change_state)`);
    for (const [label, contract] of [["arguments_contract", argumentsContract], ["result_contract", resultContract]]) {
      if (!contract.includes("::")) {
        anchorErrors.push(`${label} does not use the <source>::<heading path> form`);
        continue;
      }
      if (typeof resolveAnchor === "function") {
        const headingPath = contract.slice(contract.indexOf("::") + 2).trim();
        if (!resolveAnchor(headingPath)) anchorErrors.push(`${label} heading path does not resolve: ${headingPath}`);
      }
    }
    rows.set(operationKey, { operation_key: operationKey, summary, effect, arguments_contract: argumentsContract, result_contract: resultContract, anchor_errors: anchorErrors });
  }
  }
  if (rows.size === 0) {
    Object.defineProperty(rows, "reason", { value: "declaration table present but carries no operation rows", enumerable: false });
  }
  return rows;
}

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
    ...(identity.codeConsumption === undefined ? {} : { code_consumption: identity.codeConsumption }),
    ...(identity.authority === undefined ? {} : { authority: identity.authority }),
    ...(sectionOutline === undefined ? {} : { section_outline: sectionOutline })
  };
  return l2;
}
