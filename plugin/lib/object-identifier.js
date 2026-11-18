
import { __FACT_TYPE_KEYS_FOR_TEST } from "./object-reference.js";

const FACT_TYPE_KEYS = __FACT_TYPE_KEYS_FOR_TEST;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SHORT_ID_PATTERN = /^[0-9a-f]{8}$/i;

const TYPE_PREFIXED = /^([a-z][a-z0-9]*)-(.+)$/;

const PROJECT_SCOPED = /^([^@]+)@(.+)$/;

export const IDENTIFIER_ERRORS = Object.freeze({
  MALFORMED: "malformed",
  UNKNOWN_TYPE: "unknown_type",
  FOREIGN_PROJECT: "foreign_project",
  AMBIGUOUS: "ambiguous",
  NOT_FOUND: "not_found",
});

function fail(code, detail) {
  return { ok: false, error: { code, ...detail } };
}

function ok(fields) {
  return { ok: true, value: fields };
}

export function parseObjectIdentifier(input) {
  if (typeof input !== "string") {
    return fail(IDENTIFIER_ERRORS.MALFORMED, { message: "identifier must be a string" });
  }
  const raw = input.trim();
  if (raw.length === 0) {
    return fail(IDENTIFIER_ERRORS.MALFORMED, { message: "identifier must not be empty" });
  }

  const projectMatch = raw.match(PROJECT_SCOPED);
  const projectId = projectMatch === null ? undefined : projectMatch[1];
  const body = projectMatch === null ? raw : projectMatch[2];

  if (UUID_PATTERN.test(body)) {
    return ok({ objectUid: body.toLowerCase(), ...(projectId === undefined ? {} : { projectId }) });
  }

  const prefixed = body.match(TYPE_PREFIXED);
  if (prefixed !== null) {
    const [, type, rest] = prefixed;
    if (!FACT_TYPE_KEYS.has(type)) {
      return fail(IDENTIFIER_ERRORS.UNKNOWN_TYPE, {
        message: `"${type}" is not a registered fact_type_key (02 §7.1)`,
        declared_type: type,
      });
    }
    if (UUID_PATTERN.test(rest)) {
      return ok({ objectUid: rest.toLowerCase(), declaredType: type, ...(projectId === undefined ? {} : { projectId }) });
    }
    if (SHORT_ID_PATTERN.test(rest)) {
      return ok({ shortId: rest.toLowerCase(), declaredType: type, ...(projectId === undefined ? {} : { projectId }) });
    }
    return fail(IDENTIFIER_ERRORS.MALFORMED, {
      message: `"${rest}" is neither a canonical UUIDv4 nor an 8-hex short id`,
      declared_type: type,
    });
  }

  if (SHORT_ID_PATTERN.test(body)) {
    return ok({ shortId: body.toLowerCase(), ...(projectId === undefined ? {} : { projectId }) });
  }

  return fail(IDENTIFIER_ERRORS.MALFORMED, {
    message: "expected one of: canonical UUIDv4, <type>-<uuid>, <type>-<8hex>, {projectId}@<one of those>",
  });
}

export function isRegisteredFactType(typeKey) {
  return typeof typeKey === "string" && FACT_TYPE_KEYS.has(typeKey);
}


export const FACT_TYPE_DIRECTORIES = Object.freeze({
  friction: "frictions",
  norm: "norms",
  pitfall: "pitfalls",
  report: "reports",
  spark: "sparks",
  subgoal: "subgoals",
});

const CARRIER_NAME = /^([a-z]+)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i;

export async function resolveShortId({ factSourceRoot, shortId, declaredType }, deps = {}) {
  const readdir = deps.readdir ?? (await import("node:fs/promises")).readdir;
  const dirs = declaredType === undefined
    ? Object.entries(FACT_TYPE_DIRECTORIES)
    : Object.entries(FACT_TYPE_DIRECTORIES).filter(([type]) => type === declaredType);
  if (declaredType !== undefined && dirs.length === 0) {
    return fail(IDENTIFIER_ERRORS.UNKNOWN_TYPE, {
      message: `"${declaredType}" is not a registered fact_type_key (02 §7.1)`,
      declared_type: declaredType,
    });
  }

  const hits = [];
  for (const [factTypeKey, directory] of dirs) {
    let entries;
    try {
      entries = await readdir(`${factSourceRoot}/${directory}`);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const name of entries) {
      const match = name.match(CARRIER_NAME);
      if (match === null) continue;
      const [, fileType, uuid] = match;
      if (uuid.slice(0, 8).toLowerCase() !== shortId.toLowerCase()) continue;
      hits.push({ objectUid: uuid.toLowerCase(), factTypeKey, carrierType: fileType, file: name });
    }
  }

  if (hits.length === 0) {
    return fail(IDENTIFIER_ERRORS.NOT_FOUND, {
      message: `no carrier in this project matches short id "${shortId}"`
        + (declaredType === undefined ? "" : ` under type "${declaredType}"`),
      short_id: shortId,
    });
  }
  if (hits.length > 1) {
    return fail(IDENTIFIER_ERRORS.AMBIGUOUS, {
      message: `short id "${shortId}" matches ${hits.length} carriers; use the full object_uid instead `
        + "(02 §9.3 第 4 条: 短标识只在同一文本内至多指一个对象时使用)",
      short_id: shortId,
      candidates: hits.map((hit) => `${hit.factTypeKey}-${hit.objectUid}`),
    });
  }
  const [hit] = hits;
  return ok({ objectUid: hit.objectUid, factTypeKey: hit.factTypeKey });
}
