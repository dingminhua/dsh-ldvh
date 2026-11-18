
import { createHash } from "node:crypto";

import {
  listFrictionObjects,
  readFrictionObject,
  createFrictionObject,
  updateFrictionObject,
} from "./friction-writer.js";
import { listPitfallObjects } from "./pitfall-writer.js";
import {
  appendFrictionObservation,
  readFrictionObservations,
  readPromotionReadyGroups,
  settleGroupPromoted,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "./friction-observation-buffer.js";

export const FRICTION_THRESHOLD_N = 3;

export const MAX_CREATES_PER_RUN = 1;

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fingerprintText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function stripLeadingH1(body) {
  if (typeof body !== "string") return "";
  return body.replace(/^\s*#\s+.*(\n+|$)/, "").replace(/^\s+/, "");
}


export async function loadDedupCandidates(factSourceRoot) {
  const listed = await listFrictionObjects({ factSourceRoot, includeResolved: true, limit: 200 });
  if (!listed.ok) return listed;
  const candidates = listed.value.items.filter((item) => item.status === "open" || item.status === "accepted");
  return success({
    candidates,
    invalid: listed.value.invalid,
    complete: listed.value.complete,
    total: listed.value.total,
  });
}

export async function loadCrossTypeDedupCandidates(factSourceRoot) {
  const listed = await listPitfallObjects({ factSourceRoot, statusFilter: ["active"], limit: 200 });
  if (!listed.ok) return listed;
  const items = (listed.value.items ?? []).map((item) => ({
    object_uid: item.object_uid,
    fact_type_key: item.fact_type_key,
    title: item.title,
    status: item.status,
    scope: item.scope,
    trigger_signal: item.trigger_signal,
  }));
  return success({
    items,
    invalid: listed.value.invalid ?? [],
    complete: listed.value.complete,
    total: listed.value.total,
  });
}

export async function loadObservationDedupCandidates(dshHomePath, projectId, options = {}) {
  const read = await readFrictionObservations(dshHomePath, projectId, {
    status: "pending",
    ...options,
  });
  if (!read.ok) return read;
  if (read.value.invalid.length > 0) {
    return failure(
      "friction_observation/dedup_input_incomplete",
      `${read.value.invalid.length} buffer entr(ies) could not be parsed; dedup input is incomplete (36 §8.7 第 1 项)`,
    );
  }
  return success({
    entries: read.value.items,
    by_group: groupEntries(read.value.items),
    complete: read.value.complete,
    total: read.value.total,
    evicted_pending: read.value.evicted_pending,
    eviction_registration_error: read.value.eviction_registration_error ?? null,
  });
}

function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  const result = [];
  for (const [group, items] of groups) {
    const ordered = [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    result.push({ group, pending_count: ordered.length, entries: ordered });
  }
  return result;
}


export async function supplementOccurrence({
  factSourceRoot,
  objectUid,
  observation,
  observationAt,
  evidence,
  sessionSignature,
}) {
  if (!isNonEmptyString(objectUid)) return failure("invalid_request", "objectUid is required");
  if (!isNonEmptyString(observation)) {
    return failure("invalid_request", "observation is required (the one-line human-readable record of this sighting)");
  }

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  const status = fm.status;
  const countOnly = status === "accepted";
  if (status !== "open" && !countOnly) {
    return failure("friction/status_terminal", `status=${status} is neither open nor accepted; occurrence counting applies to an open ledger entry (full supplement) or an accepted one (count only, 26 §9.3 计数豁免). A new obstacle goes through the observation buffer instead (36 §8.8).`);
  }
  const occurrence = fm.occurrence;
  if (typeof occurrence !== "object" || occurrence === null || !Number.isInteger(occurrence.count)) {
    return failure("friction/occurrence_missing", "the record carries no usable occurrence field; refusing to invent one (26 §8 必填)");
  }

  const now = isNonEmptyString(observationAt) ? observationAt : new Date().toISOString();
  const evidenceText = isNonEmptyString(evidence) ? evidence.trim() : null;
  const addition = countOnly
    ? null
    : evidenceText === null
      ? `补充观察（${now}）：${observation.trim()}`
      : `补充观察（${now}）：${observation.trim()}\n逐字引证：${evidenceText}`;
  const baseBody = stripLeadingH1(current.value.body);
  const nextBody = addition === null ? baseBody : `${baseBody}\n\n${addition}`;

  const frontmatterAfter = {
    ...fm,
    occurrence: {
      count: occurrence.count + 1,
      first_at: occurrence.first_at,
      last_at: now,
    },
    status,
  };

  const updated = await updateFrictionObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint: current.value.fingerprint,
    frontmatterAfter,
    bodyMarkdownAfter: nextBody,
    changeSummary: `补充观察：count ${occurrence.count} → ${occurrence.count + 1}（36 §8.7 第 2 项）`,
    sessionSignature,
  });
  if (!updated.ok) return updated;

  const readBack = await readFrictionObject({ factSourceRoot, objectUid });
  if (!readBack.ok) {
    return failure("friction/read_back_failed", `the update reported success but the read-back failed: ${readBack.error.message}`);
  }
  const got = readBack.value.frontmatter.occurrence;
  if (got?.count !== occurrence.count + 1 || got?.last_at !== now) {
    return failure(
      "friction/read_back_mismatch",
      `read-back does not match the intended write: expected count=${occurrence.count + 1} last_at=${now}, got count=${got?.count} last_at=${got?.last_at}`,
    );
  }
  if (readBack.value.frontmatter.status !== status) {
    return failure(
      "friction/read_back_mismatch",
      `supplement-level update must not change status: expected ${status}, got ${readBack.value.frontmatter.status}`,
    );
  }

  const readBackBody = readBack.value.body ?? "";
  const h1Count = (readBackBody.match(/^ {0,3}#(?!#)[ \t]+\S.*$/gm) ?? []).length;
  if (h1Count !== 1) {
    return failure(
      "friction/read_back_structure_invalid",
      `read-back found ${h1Count} H1 heading(s) in the body; 26 §8 requires exactly one (generated from title). `
      + "This write path must not duplicate the generated H1 — see stripLeadingH1 in this module.",
    );
  }

  return success({
    action: "supplement",
    object_uid: objectUid,
    count_before: occurrence.count,
    count_after: got.count,
    status,
    fingerprint: readBack.value.fingerprint,
  });
}


export async function recordObservation({
  dshHomePath,
  projectId,
  session,
  anchor,
  phenomenon,
  evidence,
  group,
  target_uid,
  title,
  basis,
  attribution,
  observationAt,
}) {
  if (!isNonEmptyString(phenomenon)) {
    return failure("invalid_request", "phenomenon is required (a single-sentence description of what was seen)");
  }
  if (!isNonEmptyString(evidence)) {
    return failure("invalid_request", "evidence is required (the verbatim fragment plus its source reference)");
  }
  if (!isNonEmptyString(group)) {
    return failure(
      "invalid_request",
      "group is required — it is the aggregation key the semantic dedup step decided; without it the threshold can never be computed (36 §8.7 第 3 项)",
    );
  }
  for (const [field, value] of [["title", title], ["basis", basis], ["attribution", attribution]]) {
    if (!isNonEmptyString(value)) {
      return failure(
        "invalid_request",
        `${field} is required — it is carried into the buffer so the review layer can promote this entry in a later run (§12bis.1)`,
      );
    }
  }
  return appendFrictionObservation(dshHomePath, {
    project: projectId,
    session,
    anchor,
    phenomenon,
    evidence,
    group,
    title,
    basis,
    attribution,
    ...(isNonEmptyString(target_uid) ? { target_uid } : {}),
    ...(isNonEmptyString(observationAt) ? { at: observationAt } : {}),
  });
}


export function meetsPromotionThreshold(pendingCount) {
  return Number.isInteger(pendingCount) && pendingCount >= FRICTION_OBSERVATION_THRESHOLD_N;
}

export async function promoteReadyGroup({
  factSourceRoot,
  dshHomePath,
  projectId,
  group,
  title,
  basis,
  attribution,
  sessionSignature,
}) {
  if (!isNonEmptyString(group)) return failure("invalid_request", "group is required");
  if (!isNonEmptyString(title)) {
    return failure("invalid_request", "title is required — the promoted ledger entry needs a short title (26 §8 ≤ 30 字)");
  }
  if (!isNonEmptyString(basis)) {
    return failure("invalid_request", "basis is required — the 入账依据 paragraph answering the three conditions");
  }

  const ready = await readPromotionReadyGroups(dshHomePath, projectId);
  if (!ready.ok) return ready;
  const target = ready.value.ready.find((item) => item.group === group);
  if (!target) {
    const read = await readFrictionObservations(dshHomePath, projectId, { status: "pending", group });
    const count = read.ok ? read.value.total : 0;
    return success({
      action: "promotion-skip",
      group,
      pending_count: count,
      threshold: FRICTION_OBSERVATION_THRESHOLD_N,
      promoted: false,
    });
  }

  const entries = target.entries;
  const count = entries.length;
  const firstAt = entries[0].at;
  const lastAt = entries[entries.length - 1].at;

  const phenomenonLines = entries
    .map((entry, index) => `${index + 1}. （${entry.at}，${entry.session} @ ${entry.anchor}）${entry.evidence}`)
    .join("\n");
  const phenomenon = entries[entries.length - 1].phenomenon;
  const bodyMarkdown = `## 现象\n${phenomenon}\n\n### 该阻碍的历次观察（${count} 次，逐字引证）\n${phenomenonLines}\n\n## 入账依据\n${basis.trim()}`;

  const frontmatterDraft = {
    title: title.trim(),
    phenomenon: phenomenon.trim(),
    occurrence: { count, first_at: firstAt, last_at: lastAt },
    ...(isNonEmptyString(attribution) ? { attribution: attribution.trim() } : {}),
    change_summary: `摩擦发现阈值晋升（观察缓冲同源条目 ${count} 条 ≥ ${FRICTION_OBSERVATION_THRESHOLD_N}，36 §8.7 第 3 项）`,
  };

  const created = await createFrictionObject({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    sessionSignature,
  });
  if (!created.ok) return created;

  const uid = created.value?.object_uid ?? created.value?.uid;

  const readBack = await readFrictionObject({ factSourceRoot, objectUid: uid });
  if (!readBack.ok) {
    return failure("friction/read_back_failed", `create reported success but the read-back failed: ${readBack.error.message}`);
  }
  const fm = readBack.value.frontmatter;
  if (fm.status !== "open" || fm.occurrence?.count !== count) {
    return failure(
      "friction/read_back_mismatch",
      `promotion requires initial status=open and count=${count}; read back status=${fm.status} count=${fm.occurrence?.count}`,
    );
  }
  const body = readBack.value.body ?? "";
  for (const entry of entries) {
    if (!body.includes(entry.evidence)) {
      return failure(
        "friction/evidence_not_carried",
        `the promoted entry body does not contain buffer entry ${entry.id}'s verbatim evidence — 02 §6.1 第 3 条 forbids leaving the evidence chain in an evictable carrier`,
      );
    }
  }

  const settled = await settleGroupPromoted(dshHomePath, projectId, entries.map((entry) => entry.id), uid);
  if (!settled.ok) {
    return failure(
      "friction_observation/promotion_settle_failed",
      `the ledger entry ${uid} was created but settling the buffer entries failed (${settled.error.code}: ${settled.error.message}); `
      + `the group's entries are still pending and the next run would promote them again — stop and register this (§12), do not continue`,
    );
  }

  return success({
    action: "promotion",
    object_uid: uid,
    group,
    count,
    first_at: firstAt,
    last_at: lastAt,
    status: "open",
    promoted: true,
    pending_count: count,
    threshold: FRICTION_OBSERVATION_THRESHOLD_N,
    settled_entries: settled.value.settled,
    fingerprint: readBack.value.fingerprint,
  });
}


export function verifyThresholdAvailable() {
  const n = FRICTION_THRESHOLD_N;
  if (!Number.isInteger(n) || n < 1) {
    return failure(
      "friction/threshold_unavailable",
      `the fixed threshold N is not a positive integer (got ${JSON.stringify(n)}); 36 §8.7 pins N = 3 and §8.3 requires the whole run to stop rather than proceed`,
    );
  }
  return success({ threshold: n });
}

export { fingerprintText };
