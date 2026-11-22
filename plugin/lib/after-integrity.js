
import { parseObjectIdentifier } from "./object-identifier.js";

const CODE_MANAGED_FIELDS = new Set(["object_uid", "fact_type_key", "created_at", "change_log"]);

export function buildUpdateFrontmatter({
  currentFrontmatter,
  frontmatterAfter,
  frontmatterRemovals,
  removableFields,
  typeLabel,
  validFields,
}) {
  const fail = (code, message) => ({ ok: false, error: { code, message } });

  if (currentFrontmatter === null || typeof currentFrontmatter !== "object") {
    return fail(`${typeLabel}/after_integrity_invalid`, "currentFrontmatter must be a disk baseline object (02 §10.5)");
  }
  if (frontmatterAfter !== null && frontmatterAfter !== undefined && typeof frontmatterAfter !== "object") {
    return fail(`${typeLabel}/after_integrity_invalid`, "frontmatterAfter must be an object when provided");
  }

  let removals = [];
  if (frontmatterRemovals !== null && frontmatterRemovals !== undefined) {
    if (!Array.isArray(frontmatterRemovals)) {
      return fail(`${typeLabel}/removals_invalid`, "frontmatter_removals must be an array of field names");
    }
    const seen = new Set();
    for (const key of frontmatterRemovals) {
      if (typeof key !== "string" || key.length === 0) {
        return fail(`${typeLabel}/removals_invalid`, `frontmatter_removals entries must be non-empty strings, got ${JSON.stringify(key)}`);
      }
      if (seen.has(key)) {
        return fail(`${typeLabel}/removals_invalid`, `frontmatter_removals declares ${JSON.stringify(key)} more than once`);
      }
      seen.add(key);
      removals.push(key);
    }
  }

  for (const key of removals) {
    if (CODE_MANAGED_FIELDS.has(key)) {
      return fail(
        `${typeLabel}/removal_forbidden`,
        `frontmatter_removals may not delete Code-managed field ${JSON.stringify(key)} (writer re-stamps it; 02 §8.2)`,
      );
    }
    if (!removableFields.has(key)) {
      const allowed = [...removableFields].sort();
      return fail(
        `${typeLabel}/removal_not_allowed`,
        `frontmatter_removals may not delete ${JSON.stringify(key)} — not in this type's removable set (${allowed.length === 0 ? "empty" : allowed.join(", ")})`,
      );
    }
  }

  for (const key of removals) {
    if (frontmatterAfter !== null && frontmatterAfter !== undefined && Object.hasOwn(frontmatterAfter, key)) {
      return fail(
        `${typeLabel}/removals_conflict`,
        `field ${JSON.stringify(key)} is both carried in frontmatter_after and listed in frontmatter_removals — declare one or the other`,
      );
    }
  }

  const next = structuredClone(currentFrontmatter);

  if (frontmatterAfter !== null && frontmatterAfter !== undefined) {
    for (const key of Object.keys(frontmatterAfter)) {
      if (key === "change_summary") continue;
      if (CODE_MANAGED_FIELDS.has(key)) continue;
      if (validFields instanceof Set && !validFields.has(key)) {
        return fail(
          `${typeLabel}/frontmatter_invalid`,
          `frontmatter_after carries unexpected field ${JSON.stringify(key)} (closed-set violation)`,
        );
      }
      next[key] = structuredClone(frontmatterAfter[key]);
    }
  }

  for (const key of removals) {
    delete next[key];
  }

  return { ok: true, value: next };
}

export const FRONTMATTER_AFTER_DESCRIPTION =
  "update: the fields to CHANGE (载体：fact-model-common 的 field-channel 条目). "
  + "Declare ONLY the fields you are changing — every field you omit is INHERITED from the on-disk baseline, "
  + "not deleted (省略即保留). To delete a field, list it in `frontmatter_removals` instead — "
  + "「after 不带该键」不再表示删除（省略即删除的旧语义已反转）. "
  + "Code-managed fields (object_uid/fact_type_key/created_at/change_log) are re-stamped by Code and ignored here.";

export const FRONTMATTER_REMOVALS_DESCRIPTION =
  "update: explicit deletion declarations (显式删除通道 / 载体：fact-model-common 的 field-channel 条目). "
  + "Array of field names to DELETE from the target frontmatter. Only fields this type declares as removable "
  + "are accepted — anything else is refused with zero writes (fail-closed). "
  + "A field may not appear in both `frontmatter_after` and `frontmatter_removals`.";

export { CODE_MANAGED_FIELDS };


export function uidRejectionHint(rawInput) {
  const parsed = parseObjectIdentifier(rawInput);
  if (!parsed.ok) {
    return { details: {}, messageSuffix: "" };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  if (objectUid !== undefined) {
    const identifier_form = projectId !== undefined
      ? (declaredType !== undefined ? "project_scoped_type_prefixed_uuid" : "project_scoped_uuid")
      : (declaredType !== undefined ? "type_prefixed_uuid" : "bare_uuid");
    return {
      details: { canonical_object_uid: objectUid, identifier_form },
      messageSuffix: ` — the canonical object_uid for this identifier is "${objectUid}"; pass that value verbatim as object_uid`,
    };
  }
  return {
    details: {},
    messageSuffix: ` — "${shortId}" is a short identifier; read the object first and pass its canonical object_uid from the precise-read result`,
  };
}
