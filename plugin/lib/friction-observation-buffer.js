
import { readFile, mkdir, appendFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { recordRun, readRuns } from "./idle-runlog.js";

export const FRICTION_OBSERVATION_DIR = Object.freeze(["ldvh", "friction-observations"]);

export const FRICTION_OBSERVATION_STATUSES = Object.freeze([
  "pending",
  "promoted",
  "discarded",
  "evicted",
]);

export const FRICTION_OBSERVATION_CAPACITY = 200;

export const FRICTION_OBSERVATION_PENDING_TTL_DAYS = 90;

export const FRICTION_OBSERVATION_SETTLED_TTL_DAYS = 90;

export const FRICTION_OBSERVATION_THRESHOLD_N = 3;

export const FRICTION_OBSERVATION_FIELDS = Object.freeze([
  "id",
  "at",
  "project",
  "session",
  "anchor",
  "phenomenon",
  "evidence",
  "group",
  "target_uid",
  "title",
  "basis",
  "attribution",
  "status",
  "promoted_to",
]);

export const FRICTION_OBSERVATION_SETTLED_AT_FIELD = "settled_at";

export const FRICTION_OBSERVATION_MAX_PHENOMENON_LENGTH = 400;

export const FRICTION_OBSERVATION_MAX_EVIDENCE_LENGTH = 4000;

export const FRICTION_OBSERVATION_MAX_REFERENCE_LENGTH = 256;

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = FRICTION_OBSERVATION_PENDING_TTL_DAYS * DAY_MS;
const SETTLED_TTL_MS = FRICTION_OBSERVATION_SETTLED_TTL_DAYS * DAY_MS;

const APPEND_INPUT_FIELDS = new Set([
  "at",
  "project",
  "session",
  "anchor",
  "phenomenon",
  "evidence",
  "group",
  "target_uid",
  "title",
  "basis",
  "attribution",
]);

const STORED_FIELDS = new Set([
  ...FRICTION_OBSERVATION_FIELDS,
  FRICTION_OBSERVATION_SETTLED_AT_FIELD,
]);

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const PURE_REFERENCE_EVIDENCE = new Set([
  "见上",
  "见上文",
  "见上所述",
  "见以上",
  "见前",
  "见前文",
  "如上",
  "同上",
  "同上所述",
  "以上",
  "以上所述",
  "上述",
  "上面",
  "asabove",
  "sameasabove",
  "same",
  "ditto",
  "seeabove",
]);

function normalizeReference(text) {
  return text
    .toLowerCase()
    .replace(/[\s\u3000]/g, "")
    .replace(/[，。；：、！？,.;:!?"'`（）()【】[\]…—-]/g, "");
}

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const EVICTION_KEY_PREFIX = "登记键：";

function evictionRegistrationKey(ids, reason) {
  return `${EVICTION_KEY_PREFIX}${reason}|${[...ids].sort().join(",")}`;
}

async function registerEvictedPending(dshHomePath, evicted, reason) {
  if (!Array.isArray(evicted) || evicted.length === 0) {
    return success({ registered: [], reused: [] });
  }

  const byGroup = new Map();
  for (const item of evicted) {
    const key = typeof item.group === "string" && item.group.length > 0 ? item.group : "(无 group)";
    if (!byGroup.has(key)) byGroup.set(key, { ids: [], count: item.pending_count_at_eviction, threshold: item.threshold });
    const bucket = byGroup.get(key);
    bucket.ids.push(item.id);
    bucket.count = Math.max(bucket.count, item.pending_count_at_eviction);
  }

  const existing = await readRuns(dshHomePath, {});
  if (!existing.ok) {
    return failure(
      "friction_observation/eviction_unregistered",
      `refusing to evict: the run log cannot be read to check for an existing registration `
      + `(${existing.error?.code ?? "unknown"}: ${existing.error?.message ?? "unknown"}). `
      + `§18 该行的失败处置是「不得淘汰」——the eviction was aborted in full, no entry was removed.`,
    );
  }
  const voidedKeys = new Set();
  for (const run of existing.value.runs) {
    if (run?.stage === "eviction-registration-voided" && typeof run.voided_key === "string") {
      voidedKeys.add(run.voided_key);
    }
  }
  const liveKeys = new Map();
  for (const run of existing.value.runs) {
    if (run?.stage !== "eviction-registration" || !Array.isArray(run.residual)) continue;
    for (const line of run.residual) {
      if (typeof line === "string" && line.startsWith(EVICTION_KEY_PREFIX) && !voidedKeys.has(line)) {
        liveKeys.set(line, run.registration_id ?? null);
      }
    }
  }

  const registered = [];
  const reused = [];
  for (const [group, bucket] of byGroup) {
    const survivors = Math.max(0, bucket.count - bucket.ids.length);
    const head = bucket.count >= bucket.threshold
      ? `组 ${group} 淘汰前已达晋升阈值（${bucket.count}/${bucket.threshold}）却仍未晋升就被淘汰`
      : `组 ${group} 未达晋升阈值（${bucket.count}/${bucket.threshold}）即被淘汰，距成立为待修账目只差 ${bucket.threshold - bucket.count} 次观察`;
    const key = evictionRegistrationKey(bucket.ids, reason);
    if (liveKeys.has(key)) {
      reused.push(liveKeys.get(key));
      continue;
    }
    const queued = await recordRun(dshHomePath, {
      task: "friction-discovery",
      stage: "eviction-registration",
      registration_id: key,
      reason: `摩擦观察条目的淘汰：${head}（本次${reason}，淘汰 ${bucket.ids.length} 条，剩 ${survivors} 条）`,
      residual: [
        head,
        `被淘汰条目 id：${bucket.ids.join("、")}`,
        survivors > 0
          ? `该组仍有 ${survivors} 条 pending 条目在攒，仍可正常晋升；被淘汰的 ${bucket.ids.length} 条不再计入聚合`
          : "该组已无 pending 条目，聚合归零；若该阻碍再次出现将从 0 重新攒起",
        "如认为该组仍需跟踪，须由主控或 Human 核查后决定是否以 Human 入口重新入账（26 §10 的 Human 入口不受阈值硬前置约束）",
        key,
      ],
      at: new Date().toISOString(),
    });
    if (!queued.ok) {
      return failure(
        "friction_observation/eviction_unregistered",
        `refusing to evict: the §20.1 第 11 项 registration could not be written to the run log `
        + `(${queued.error?.code ?? "unknown"}: ${queued.error?.message ?? "unknown"}). `
        + `§18 该行的失败处置是「不得淘汰」——the eviction was aborted in full, no entry was removed.`,
      );
    }
    registered.push(key);
  }
  return success({ registered, reused });
}

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateProjectId(projectId) {
  if (!isNonEmptyString(projectId)) {
    return failure(
      "friction_observation/invalid_project",
      "project is required and must be a non-empty string (§12bis.1：按管辖项目分载体)",
    );
  }
  const trimmed = projectId.trim();
  if (!PROJECT_ID_PATTERN.test(trimmed) || trimmed === "." || trimmed === "..") {
    return failure(
      "friction_observation/invalid_project",
      `project must match ${PROJECT_ID_PATTERN} (got ${JSON.stringify(projectId)}) — it becomes a path segment`,
    );
  }
  return success(trimmed);
}

export function frictionObservationPath(dshHomePath, projectId) {
  const validated = validateProjectId(projectId);
  const id = validated.ok ? validated.value : "__invalid_project__";
  return dshHomePath(...FRICTION_OBSERVATION_DIR, `${id}.jsonl`);
}

function resolveCapacity(value) {
  if (value === undefined || value === null) {
    return success(FRICTION_OBSERVATION_CAPACITY);
  }
  if (!Number.isInteger(value) || value <= 0) {
    return failure(
      "friction_observation/invalid_capacity",
      `capacity must be a positive integer (got ${JSON.stringify(value)})`,
    );
  }
  if (value > FRICTION_OBSERVATION_CAPACITY) {
    return failure(
      "friction_observation/capacity_above_spec",
      `capacity must not exceed ${FRICTION_OBSERVATION_CAPACITY} (§12bis.1：实现侧不得调高)`,
    );
  }
  return success(value);
}

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validateAppendInput(input, projectId) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return failure("friction_observation/invalid_entry", "the observation entry must be an object");
  }
  for (const key of Object.keys(input)) {
    if (!APPEND_INPUT_FIELDS.has(key)) {
      return failure(
        "friction_observation/unexpected_field",
        `field "${key}" is outside the §12bis.1 field set (accepted: ${[...APPEND_INPUT_FIELDS].join(", ")}; id/status/promoted_to are assigned by the implementation)`,
      );
    }
  }
  for (const field of ["session", "anchor", "phenomenon", "evidence", "group", "title", "basis", "attribution"]) {
    if (!isNonEmptyString(input[field])) {
      return failure(
        `friction_observation/missing_${field}`,
        `${field} is required and must be a non-empty string (§12bis.1 字段闭集；title/basis/attribution 是审核层跨运行晋升所需的承载，缺任一项晋升即无法建账)`,
      );
    }
  }
  if (input.project !== undefined && input.project !== null) {
    if (input.project.trim() !== projectId) {
      return failure(
        "friction_observation/project_mismatch",
        `entry project ${JSON.stringify(input.project)} does not match the carrier partition ${JSON.stringify(projectId)} (§12bis.1：分区是载体层，project 是条目层，二者须自洽)`,
      );
    }
  }
  for (const field of ["session", "anchor", "group"]) {
    if (input[field].trim().length > FRICTION_OBSERVATION_MAX_REFERENCE_LENGTH) {
      return failure(
        `friction_observation/invalid_${field}`,
        `${field} must be ≤ ${FRICTION_OBSERVATION_MAX_REFERENCE_LENGTH} characters (it is a marker, not content)`,
      );
    }
  }
  if (input.phenomenon.trim().length > FRICTION_OBSERVATION_MAX_PHENOMENON_LENGTH) {
    return failure(
      "friction_observation/phenomenon_too_long",
      `phenomenon must be ≤ ${FRICTION_OBSERVATION_MAX_PHENOMENON_LENGTH} characters — it is one sentence describing what was seen, not an essay`,
    );
  }
  if (input.evidence.trim().length > FRICTION_OBSERVATION_MAX_EVIDENCE_LENGTH) {
    return failure(
      "friction_observation/evidence_too_long",
      `evidence must be ≤ ${FRICTION_OBSERVATION_MAX_EVIDENCE_LENGTH} characters — only the minimal verbatim span that supports the phenomenon`,
    );
  }
  if (PURE_REFERENCE_EVIDENCE.has(normalizeReference(input.evidence))) {
    return failure(
      "friction_observation/evidence_not_verbatim",
      "evidence must be the verbatim fragment of the source material together with a source reference — a bare pointer such as 「见上」/「同上」 carries neither (§12bis.1)",
    );
  }
  let at = new Date().toISOString();
  if (input.at !== undefined && input.at !== null) {
    if (
      !isNonEmptyString(input.at) ||
      !RFC3339_PATTERN.test(input.at.trim()) ||
      !Number.isFinite(Date.parse(input.at.trim()))
    ) {
      return failure(
        "friction_observation/invalid_at",
        `at must be an RFC3339 timestamp (got ${JSON.stringify(input.at)})`,
      );
    }
    at = input.at.trim();
  }
  return success({
    id: randomUUID(),
    at,
    project: projectId,
    session: input.session.trim(),
    anchor: input.anchor.trim(),
    phenomenon: input.phenomenon.trim(),
    evidence: input.evidence,
    group: input.group.trim(),
    target_uid: isNonEmptyString(input.target_uid) ? input.target_uid.trim() : null,
    title: input.title.trim(),
    basis: input.basis.trim(),
    attribution: input.attribution.trim(),
    status: "pending",
    promoted_to: null,
  });
}

export function validateStoredEntry(record) {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return "entry is not an object";
  }
  for (const key of Object.keys(record)) {
    if (!STORED_FIELDS.has(key)) {
      return `field "${key}" is outside the §12bis.1 field set`;
    }
  }
  for (const field of FRICTION_OBSERVATION_FIELDS) {
    if (field === "target_uid") {
      if (!(field in record)) return `missing field "${field}"`;
      if (record[field] !== null && !isNonEmptyString(record[field])) {
        return `field "target_uid" must be null or a non-empty string`;
      }
      continue;
    }
    if (!(field in record)) {
      return `missing field "${field}"`;
    }
  }
  if (!FRICTION_OBSERVATION_STATUSES.includes(record.status)) {
    return `status ${JSON.stringify(record.status)} is not in the closed set`;
  }
  if (!RFC3339_PATTERN.test(String(record.at))) {
    return `at ${JSON.stringify(record.at)} is not RFC3339`;
  }
  if (record.status === "promoted" && !isNonEmptyString(record.promoted_to)) {
    return "status=promoted requires a non-empty promoted_to";
  }
  if (record.status !== "promoted" && record.promoted_to !== null) {
    return "promoted_to must be null unless status=promoted";
  }
  return null;
}

function parseCarrierText(text, projectId) {
  const invalid = [];
  const records = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      invalid.push({
        line: index + 1,
        reason: `not valid JSON: ${String(error?.message ?? error)}`,
        excerpt: line.slice(0, 80),
      });
      continue;
    }
    const issue = validateStoredEntry(parsed);
    if (issue !== null) {
      invalid.push({ line: index + 1, reason: issue, excerpt: line.slice(0, 80) });
      continue;
    }
    if (parsed.project !== projectId) {
      invalid.push({
        line: index + 1,
        reason: `entry project ${JSON.stringify(parsed.project)} is not the carrier partition ${JSON.stringify(projectId)}`,
        excerpt: line.slice(0, 80),
      });
      continue;
    }
    records.push({ index, record: parsed });
  }
  return { lines, records, invalid };
}

async function readCarrierRecords(dshHomePath, projectId) {
  const path = frictionObservationPath(dshHomePath, projectId);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return success({ lines: [], records: [], invalid: [], carrier: path });
    }
    return failure(
      "friction_observation/unavailable",
      `cannot read the friction observation carrier: ${String(error?.message ?? error)}`,
    );
  }
  const parsed = parseCarrierText(text, projectId);
  return success({ ...parsed, carrier: path });
}

async function rewriteCarrier(dshHomePath, projectId, lines) {
  const path = frictionObservationPath(dshHomePath, projectId);
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    const body = lines.join("\n");
    await writeFile(tempPath, body, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    return failure(
      "friction_observation/unavailable",
      `cannot rewrite the friction observation carrier: ${String(error?.message ?? error)}`,
    );
  }
  return success({ carrier: path });
}

async function enforceCapacity(dshHomePath, projectId, capacity, { excludeId = null, now = new Date() } = {}) {
  const read = await readCarrierRecords(dshHomePath, projectId);
  if (!read.ok) return read;
  const { lines, records } = read.value;

  const live = records.filter((item) => item.record.status !== "evicted");
  const overflow = live.length - capacity;
  if (overflow <= 0) return success({ evicted_pending: [] });

  const ordered = [...live].sort((a, b) => {
    const atA = Date.parse(a.record.at);
    const atB = Date.parse(b.record.at);
    if (atA !== atB) return atA - atB;
    return a.index - b.index;
  });
  const victims = ordered.slice(0, overflow);
  const stamp = new Date(now).toISOString();
  const evictedPending = [];
  const replacements = new Map();
  for (const victim of victims) {
    const record = victim.record;
    if (record.status === "pending") {
      const sameGroup = records.filter(
        (item) => item.record.status === "pending" && item.record.group === record.group,
      );
      evictedPending.push({
        id: record.id,
        group: record.group,
        pending_count_at_eviction: sameGroup.length,
        threshold: FRICTION_OBSERVATION_THRESHOLD_N,
      });
    }
    replacements.set(victim.index, {
      ...record,
      status: "evicted",
      promoted_to: null,
      [FRICTION_OBSERVATION_SETTLED_AT_FIELD]: stamp,
    });
  }

  const registered = await registerEvictedPending(dshHomePath, evictedPending, "因容量上限被淘汰");
  if (!registered.ok) return registered;

  const nextLines = lines.map((line, index) => {
    if (!replacements.has(index)) return line;
    return JSON.stringify(replacements.get(index));
  });
  const rewritten = await rewriteCarrier(dshHomePath, projectId, nextLines);
  if (!rewritten.ok) {
    const pendingIds = [...(registered.value.registered ?? []), ...(registered.value.reused ?? [])]
      .filter((value) => typeof value === "string" && value.length > 0);
    const unresolved = [];
    for (const registrationId of pendingIds) {
      const resolved = await recordRun(dshHomePath, {
        task: "friction-discovery",
        stage: "eviction-registration-voided",
        voided_key: registrationId,
        note: "登记未生效：载体回写失败，被淘汰条目仍在缓冲中，下次写入会重新判定",
      });
      if (!resolved.ok) {
        unresolved.push(`${registrationId}: ${resolved.error?.code ?? "unknown"}`);
      }
    }
    return failure(
      "friction_observation/eviction_writeback_failed",
      `the §20.1 第 11 项 registration was written but the carrier rewrite failed `
      + `(${rewritten.error?.code ?? "unknown"}: ${rewritten.error?.message ?? "unknown"}); `
      + `no entry was evicted, so ${pendingIds.length} registration(s) were resolved with a `
      + `"did not take effect" note`
      + (unresolved.length === 0
        ? ". The observation itself WAS written and is in the carrier — do not write it again."
        : `; however ${unresolved.length} registration(s) could not be resolved: ${unresolved.join("; ")}. `
          + "The observation itself WAS written and is in the carrier — do not write it again."),
    );
  }
  return success({
    evicted_pending: evictedPending,
    eviction_registrations: registered.value.registered,
    eviction_registrations_reused: registered.value.reused ?? [],
  });
}

export async function appendFrictionObservation(dshHomePath, entry = {}, options = {}) {
  if (typeof entry !== "object" || entry === null) {
    return failure("friction_observation/invalid_entry", "the observation entry must be an object");
  }
  const projectResult = validateProjectId(entry.project);
  if (!projectResult.ok) return projectResult;
  const projectId = projectResult.value;

  const capacity = resolveCapacity(options?.capacity);
  if (!capacity.ok) return capacity;

  const validated = validateAppendInput(entry, projectId);
  if (!validated.ok) return validated;
  const record = validated.value;

  const path = frictionObservationPath(dshHomePath, projectId);
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    return failure(
      "friction_observation/unavailable",
      `cannot append to the friction observation carrier: ${String(error?.message ?? error)}`,
    );
  }

  const evicted = await enforceCapacity(dshHomePath, projectId, capacity.value, {
    excludeId: record.id,
    now: options?.now ?? new Date(),
  });
  if (!evicted.ok) {
    return {
      ok: false,
      error: {
        code: evicted.error?.code ?? "friction_observation/eviction_failed",
        message: `the observation was written (id ${record.id}, group ${record.group}) but the `
          + `capacity eviction did not run: ${evicted.error?.message ?? "unknown"}. `
          + `The entry IS in the carrier — do not write it again. §11 水位是否推进由调用方按 `
          + `§12 决定，但重放会重复计入同一现象。`,
        written: true,
        entry_id: record.id,
        evicted_code: evicted.error?.code ?? "unknown",
      },
    };
  }

  const readBack = await readCarrierRecords(dshHomePath, projectId);
  if (!readBack.ok) {
    return failure(
      "friction_observation/read_back_failed",
      `the entry was written but the read-back failed: ${readBack.error.message}`,
    );
  }
  const found = readBack.value.records.find((item) => item.record.id === record.id);
  if (!found) {
    return failure(
      "friction_observation/read_back_mismatch",
      `the entry was written but the read-back did not find id ${record.id}`,
    );
  }
  const observed = found.record;
  for (const field of FRICTION_OBSERVATION_FIELDS) {
    if (observed[field] !== record[field]) {
      return failure(
        "friction_observation/read_back_mismatch",
        `the read-back of ${field} does not match what was written (expected ${JSON.stringify(record[field])}, got ${JSON.stringify(observed[field])})`,
      );
    }
  }

  const sameGroup = readBack.value.records.filter(
    (item) => item.record.status === "pending" && item.record.group === record.group,
  );
  return success({
    entry_id: record.id,
    group: record.group,
    group_pending_count: sameGroup.length,
    promotion_ready: sameGroup.length >= FRICTION_OBSERVATION_THRESHOLD_N,
    evicted_pending: evicted.value.evicted_pending,
    eviction_registrations: evicted.value.eviction_registrations ?? [],
  });
}

export async function readFrictionObservations(dshHomePath, projectId, options = {}) {
  const projectResult = validateProjectId(projectId);
  if (!projectResult.ok) return projectResult;
  const id = projectResult.value;

  const { status = null, group = null, limit = null, now = new Date(), capacity } = options;
  if (status !== null && status !== undefined && !FRICTION_OBSERVATION_STATUSES.includes(status)) {
    return failure(
      "friction_observation/invalid_status",
      `status must be one of ${JSON.stringify([...FRICTION_OBSERVATION_STATUSES])} (got ${JSON.stringify(status)})`,
    );
  }
  if (limit !== null && limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return failure(
      "friction_observation/invalid_limit",
      `limit must be a positive integer (got ${JSON.stringify(limit)})`,
    );
  }
  const resolvedCapacity = resolveCapacity(capacity);
  if (!resolvedCapacity.ok) return resolvedCapacity;
  const nowMs = toTimestamp(now);
  if (nowMs === null) {
    return failure(
      "friction_observation/invalid_now",
      "now must be a Date, a millisecond timestamp or an RFC3339 string",
    );
  }

  const read = await readCarrierRecords(dshHomePath, id);
  if (!read.ok) return read;
  const { lines, records, invalid, carrier } = read.value;

  const stamp = new Date(nowMs).toISOString();
  const settledByIndex = new Map();
  const removedIndexes = new Set();
  const evictedPending = [];
  for (const item of records) {
    const record = item.record;
    if (record.status === "pending") {
      const age = nowMs - Date.parse(record.at);
      if (Number.isFinite(age) && age > PENDING_TTL_MS) {
        const sameGroup = records.filter(
          (other) => other.record.status === "pending" && other.record.group === record.group,
        );
        evictedPending.push({
          id: record.id,
          group: record.group,
          pending_count_at_eviction: sameGroup.length,
          threshold: FRICTION_OBSERVATION_THRESHOLD_N,
        });
        settledByIndex.set(item.index, {
          ...record,
          status: "evicted",
          promoted_to: null,
          [FRICTION_OBSERVATION_SETTLED_AT_FIELD]: stamp,
        });
      }
      continue;
    }
    const reference =
      typeof record[FRICTION_OBSERVATION_SETTLED_AT_FIELD] === "string"
        ? record[FRICTION_OBSERVATION_SETTLED_AT_FIELD]
        : record.at;
    const age = nowMs - Date.parse(reference);
    if (Number.isFinite(age) && age > SETTLED_TTL_MS) {
      removedIndexes.add(item.index);
    }
  }

  let evictionRegistrations = [];
  let evictionReusedRegistrations = [];
  let evictionRegistrationFailed = null;
  if (evictedPending.length > 0) {
    const registered = await registerEvictedPending(dshHomePath, evictedPending, "因保留期到期被淘汰");
    if (!registered.ok) {
      evictionRegistrationFailed = {
        code: registered.error?.code ?? "friction_observation/eviction_unregistered",
        message: registered.error?.message ?? "unknown",
      };
      settledByIndex.clear();
      evictedPending.length = 0;
    } else {
      evictionRegistrations = registered.value.registered;
      evictionReusedRegistrations = registered.value.reused ?? [];
    }
  }

  let complete = true;
  if (settledByIndex.size > 0 || removedIndexes.size > 0) {
    const keptIndexes = new Set(records.map((item) => item.index));
    const nextLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!keptIndexes.has(index)) {
        nextLines.push(lines[index]);
        continue;
      }
      if (removedIndexes.has(index)) continue;
      const replacement = settledByIndex.get(index);
      nextLines.push(replacement ? JSON.stringify(replacement) : lines[index]);
    }
    const rewritten = await rewriteCarrier(dshHomePath, id, nextLines);
    if (!rewritten.ok) {
      complete = false;
      const pendingIds = [...evictionRegistrations, ...evictionReusedRegistrations].filter(
        (value) => typeof value === "string" && value.length > 0,
      );
      const unresolved = [];
      for (const registrationId of pendingIds) {
        const resolved = await recordRun(dshHomePath, {
          task: "friction-discovery",
          stage: "eviction-registration-voided",
          voided_key: registrationId,
          note: "登记未生效：载体回写失败，被淘汰条目仍在缓冲中，下次读取会重新判定",
        });
        if (!resolved.ok) {
          unresolved.push(`${registrationId}: ${resolved.error?.code ?? "unknown"}`);
        }
      }
      evictionRegistrationFailed = {
        code: "friction_observation/eviction_writeback_failed",
        message: `the §20.1 第 11 项 registration was written but the carrier rewrite failed `
          + `(${rewritten.error?.code ?? "unknown"}: ${rewritten.error?.message ?? "unknown"}); `
          + `the entries were NOT evicted, so ${pendingIds.length} registration(s) were resolved with a `
          + `"did not take effect" note`
          + (unresolved.length === 0
            ? "."
            : `; however ${unresolved.length} registration(s) could not be resolved: ${unresolved.join("; ")}`),
      };
    }
  }

  let effective = records
    .filter((item) => !removedIndexes.has(item.index))
    .map((item) => settledByIndex.get(item.index) ?? item.record);
  if (status !== null && status !== undefined) {
    effective = effective.filter((record) => record.status === status);
  }
  if (group !== null && group !== undefined) {
    effective = effective.filter((record) => record.group === group);
  }
  const total = effective.length;
  const limited = limit !== null && limit !== undefined ? effective.slice(0, limit) : effective;

  const all = records
    .filter((item) => !removedIndexes.has(item.index))
    .map((item) => settledByIndex.get(item.index) ?? item.record);
  const byStatus = {};
  for (const record of all) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
  }
  const liveTotal = all.filter((record) => record.status !== "evicted").length;

  return success({
    items: limited,
    total,
    by_status: byStatus,
    at_capacity: liveTotal >= resolvedCapacity.value,
    live_total: liveTotal,
    capacity: resolvedCapacity.value,
    invalid,
    complete: complete && evictionRegistrationFailed === null,
    carrier,
    evicted_pending: evictedPending,
    eviction_registrations: evictionRegistrations,
    eviction_registration_error: evictionRegistrationFailed,
  });
}

export async function readPromotionReadyGroups(dshHomePath, projectId, options = {}) {
  const read = await readFrictionObservations(dshHomePath, projectId, {
    status: "pending",
    ...options,
  });
  if (!read.ok) return read;
  const groups = new Map();
  for (const record of read.value.items) {
    if (typeof record.target_uid === "string" && record.target_uid.length > 0) continue;
    if (!groups.has(record.group)) groups.set(record.group, []);
    groups.get(record.group).push(record);
  }
  const ready = [];
  for (const [group, entries] of groups) {
    if (entries.length >= FRICTION_OBSERVATION_THRESHOLD_N) {
      const ordered = [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      ready.push({ group, pending_count: entries.length, entries: ordered });
    }
  }
  return success({ ready, invalid: read.value.invalid, complete: read.value.complete });
}

export async function settleGroupPromoted(dshHomePath, projectId, entryIds, promotedTo, options = {}) {
  const projectResult = validateProjectId(projectId);
  if (!projectResult.ok) return projectResult;
  const id = projectResult.value;
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return failure(
      "friction_observation/invalid_entry_ids",
      "entryIds must be a non-empty array of buffer entry ids",
    );
  }
  if (!isNonEmptyString(promotedTo)) {
    return failure(
      "friction_observation/invalid_promoted_to",
      "promotedTo must be a non-empty object_uid (§12bis.1 `promoted_to` 行)",
    );
  }
  const read = await readCarrierRecords(dshHomePath, id);
  if (!read.ok) return read;
  const { lines, records } = read.value;
  const stamp = new Date(options?.now ?? new Date()).toISOString();
  const wanted = new Set(entryIds);
  const replacements = new Map();
  const settled = [];
  for (const item of records) {
    if (!wanted.has(item.record.id)) continue;
    if (item.record.status !== "pending") {
      return failure(
        "friction_observation/not_pending",
        `entry ${item.record.id} is ${item.record.status}, not pending — promotion is not idempotent across statuses`,
      );
    }
    replacements.set(item.index, {
      ...item.record,
      status: "promoted",
      promoted_to: promotedTo.trim(),
      [FRICTION_OBSERVATION_SETTLED_AT_FIELD]: stamp,
    });
    settled.push(item.record.id);
  }
  const missing = [...wanted].filter((entryId) => !settled.includes(entryId));
  if (missing.length > 0) {
    return failure(
      "friction_observation/unknown_entry",
      `entries not found in the carrier: ${missing.join(", ")}`,
    );
  }
  const nextLines = lines.map((line, index) =>
    replacements.has(index) ? JSON.stringify(replacements.get(index)) : line,
  );
  const rewritten = await rewriteCarrier(dshHomePath, id, nextLines);
  if (!rewritten.ok) return rewritten;
  return success({ settled, promoted_to: promotedTo.trim() });
}

export async function settleObservationDiscarded(dshHomePath, projectId, entryId, options = {}) {
  const projectResult = validateProjectId(projectId);
  if (!projectResult.ok) return projectResult;
  const id = projectResult.value;
  if (!isNonEmptyString(entryId)) {
    return failure("friction_observation/invalid_entry_id", "entryId must be a non-empty string");
  }
  const read = await readCarrierRecords(dshHomePath, id);
  if (!read.ok) return read;
  const { lines, records } = read.value;
  const stamp = new Date(options?.now ?? new Date()).toISOString();
  let found = false;
  const nextLines = lines.map((line, index) => {
    const item = records.find((entry) => entry.index === index);
    if (!item || item.record.id !== entryId) return line;
    found = true;
    if (item.record.status !== "pending") return line;
    return JSON.stringify({
      ...item.record,
      status: "discarded",
      promoted_to: null,
      [FRICTION_OBSERVATION_SETTLED_AT_FIELD]: stamp,
    });
  });
  if (!found) {
    return failure(
      "friction_observation/unknown_entry",
      `entry ${entryId} not found in the carrier`,
    );
  }
  const rewritten = await rewriteCarrier(dshHomePath, id, lines.length === nextLines.length ? nextLines : lines);
  if (!rewritten.ok) return rewritten;
  return success({ entry_id: entryId, status: "discarded" });
}
