
const BRAND = Symbol("ldvh/authoritative-signature");
const IDENTITY_BRAND = Symbol("ldvh/authoritative-session-identity");

export function authoritativeSignature(route) {
  if (typeof route !== "object" || route === null) return null;
  if (typeof route.provider !== "string" || route.provider.length === 0) return null;
  if (typeof route.model !== "string" || route.model.length === 0) return null;
  return { [BRAND]: { provider: route.provider, model: route.model } };
}

export function resolveAuthoritativeSignature(arg) {
  if (typeof arg !== "object" || arg === null) return null;
  const value = arg[BRAND];
  if (typeof value !== "object" || value === null) return null;
  if (typeof value.provider !== "string" || value.provider.length === 0) return null;
  if (typeof value.model !== "string" || value.model.length === 0) return null;
  return { provider: value.provider, model: value.model };
}

export function requireAuthoritativeSignature(carrier, { context = "change_log entry" } = {}) {
  const signature = resolveAuthoritativeSignature(carrier);
  if (signature !== null) return { ok: true, signature };
  return {
    ok: false,
    code: "signature_unavailable",
    message: `refusing to write ${context} without the authoritative provider/model: `
      + "no branded session signature was supplied (09 机械签名 requires Code to obtain it from the DSH "
      + "authoritative session record; AI must not self-fill, use a deployment default, or have a caller override it). "
      + "REPORT TO HUMAN: this write cannot be signed, so it must not be recorded as a stable fact."
  };
}


function identityRecord({ sessionId, source = null, origin = null, parentSession = null, delegationDepth = null }) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const record = { sessionId };
  if (source === "host" || source === "shell") record.source = source;
  if (typeof origin === "string" && origin.length > 0) record.origin = origin;
  if (typeof parentSession === "string" && parentSession.length > 0) record.parentSession = parentSession;
  if (Number.isInteger(delegationDepth) && delegationDepth >= 0) record.delegationDepth = delegationDepth;
  return { [IDENTITY_BRAND]: Object.freeze(record) };
}

export function authoritativeSessionIdentity(record) {
  if (typeof record !== "object" || record === null) return null;
  return identityRecord(record);
}

export function resolveAuthoritativeSessionIdentity(arg) {
  if (typeof arg !== "object" || arg === null) return null;
  const value = arg[IDENTITY_BRAND];
  if (typeof value !== "object" || value === null) return null;
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0) return null;
  const record = { sessionId: value.sessionId };
  if (value.source === "host" || value.source === "shell") record.source = value.source;
  if (typeof value.origin === "string" && value.origin.length > 0) record.origin = value.origin;
  if (typeof value.parentSession === "string" && value.parentSession.length > 0) record.parentSession = value.parentSession;
  if (Number.isInteger(value.delegationDepth) && value.delegationDepth >= 0) record.delegationDepth = value.delegationDepth;
  return record;
}
