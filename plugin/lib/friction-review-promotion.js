
import {
  promoteReadyGroup,
  supplementOccurrence,
} from "./friction-discovery.js";
import {
  readFrictionObservations,
  readPromotionReadyGroups,
  validateStoredEntry,
  frictionObservationPath,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "./friction-observation-buffer.js";
import { registerSupplementFailure } from "./friction-failure-registration.js";

function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

function success(value) {
  return { ok: true, value };
}

const MAX_CREATES_PER_REVIEW_RUN = 1;

export async function runFrictionReviewPromotion({
  factSourceRoot,
  dshHomePath,
  projectId,
  sessionSignature,
  now = new Date(),
}) {
  if (typeof dshHomePath !== "function") {
    return failure("review_promotion/no_home", "dshHomePath is required to read the friction observation buffer");
  }
  if (typeof projectId !== "string" || projectId.length === 0) {
    return failure("review_promotion/no_project", "projectId is required — the buffer is partitioned by governed project (§12bis.1)");
  }

  const residual = [];

  const allPending = await readFrictionObservations(dshHomePath, projectId, { status: "pending" });
  if (!allPending.ok) {
    return failure(
      "review_promotion/buffer_unreadable",
      `the friction observation buffer cannot be read: ${allPending.error?.message ?? "unknown"} (§12bis.1 纪律：不得降级为空集合)`,
    );
  }
  const supplementTargets = allPending.value.items.filter(
    (entry) => typeof entry.target_uid === "string" && entry.target_uid.length > 0,
  );
  const supplemented = [];
  for (const entry of supplementTargets) {
    const result = await supplementOccurrence({
      factSourceRoot,
      objectUid: entry.target_uid,
      observation: entry.phenomenon,
      evidence: typeof entry.evidence === "string" && entry.evidence.length > 0 ? entry.evidence : null,
      observationAt: entry.at,
      sessionSignature,
    });
    if (!result.ok) {
      const failureItem = {
        stage: "supplement",
        entry_id: entry.id,
        target_uid: entry.target_uid,
        code: result.error?.code ?? "review_promotion/supplement_failed",
        message: result.error?.message ?? "unknown",
      };
      await registerSupplementFailure(dshHomePath, failureItem, now);
      residual.push(failureItem);
      continue;
    }
    supplemented.push({ entry_id: entry.id, target_uid: entry.target_uid, count: result.value?.count_after ?? null });
  }

  if (supplemented.length > 0) {
    const settled = await settleSupplementedEntries(dshHomePath, projectId, supplemented.map((item) => item.entry_id));
    if (!settled.ok) {
      return failure(
        "review_promotion/supplement_settle_failed",
        `the supplement landed but settling its buffer entries failed (${settled.error?.code ?? "unknown"}); `
        + `they stay pending and the next run would count them again — stop and register this (§12)`,
        { stage: "supplement-settle" },
      );
    }
  }

  const ready = await readPromotionReadyGroups(dshHomePath, projectId);
  if (!ready.ok) {
    return failure(
      "review_promotion/ready_groups_unreadable",
      `promotion-ready groups cannot be read: ${ready.error?.message ?? "unknown"}`,
    );
  }

  const promotions = [];
  const skipped = [];
  for (const group of ready.value.ready) {
    if (promotions.length >= MAX_CREATES_PER_REVIEW_RUN) {
      skipped.push({ group: group.group, reason: "per-run-create-cap", pending_count: group.entries.length });
      continue;
    }
    const latest = group.entries[group.entries.length - 1];
    const promoted = await promoteReadyGroup({
      factSourceRoot,
      dshHomePath,
      projectId,
      group: group.group,
      title: latest.title,
      basis: latest.basis,
      attribution: latest.attribution,
      sessionSignature,
    });
    if (!promoted.ok) {
      residual.push({
        stage: "promote",
        group: group.group,
        code: promoted.error?.code ?? "review_promotion/promote_failed",
        message: promoted.error?.message ?? "unknown",
      });
      continue;
    }
    if (promoted.value?.promoted === true) {
      promotions.push({
        group: group.group,
        object_uid: promoted.value.object_uid,
        count: promoted.value.count ?? group.entries.length,
      });
    } else {
      skipped.push({ group: group.group, reason: promoted.value?.action ?? "promotion-skip", pending_count: group.entries.length });
    }
  }

  return success({
    supplemented,
    promotions,
    skipped,
    residual,
    threshold: FRICTION_OBSERVATION_THRESHOLD_N,
  });
}

async function settleSupplementedEntries(dshHomePath, projectId, entryIds) {
  const { readFile, writeFile, rename } = await import("node:fs/promises");

  const path = frictionObservationPath(dshHomePath, projectId);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return success({ removed: 0 });
    return failure("friction_observation/read_failed", `cannot read ${path}: ${String(error?.message ?? error)}`);
  }

  const idSet = new Set(entryIds);
  const kept = [];
  let removed = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return failure("friction_observation/corrupt_line", `the buffer contains a line that is not JSON; refusing to rewrite it`);
    }
    const problem = validateStoredEntry(record);
    if (problem !== null) {
      return failure("friction_observation/invalid_entry", `the buffer contains an invalid entry (${problem}); refusing to rewrite it`);
    }
    if (idSet.has(record.id)) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }
  if (removed === 0) return success({ removed: 0 });

  const next = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
  const tmp = `${path}.settle.${process.pid}.tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, path);

  const after = await readFile(path, "utf8");
  for (const id of idSet) {
    if (after.includes(id)) {
      return failure(
        "friction_observation/settle_readback_failed",
        `entry ${id} is still present after the settle rewrite — the removal did not take effect`,
      );
    }
  }
  return success({ removed });
}
