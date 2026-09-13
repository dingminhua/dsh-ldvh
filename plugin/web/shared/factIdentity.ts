/**
 * Canonical fact-object identity predicate — single authority.
 *
 * specs/03 §6.1 defines `object_uid` as a canonical **UUIDv4** text (RFC 9562
 * version nibble `4`) and states explicitly that the time-ordered UUIDv7 is
 * **not** adopted: time semantics live in `created_at` and `change_log[].at`,
 * never encoded in the identity field.
 *
 * Every reader-side consumer shares this one predicate — association target
 * resolution, list/detail field validation, `authority_ref` projection, hotspot
 * keys and the client-side reading projection. It lives in `shared/` because
 * both the API plane and the browser client consume it.
 *
 * History (why this file exists): the Web layer once carried four independent
 * copies of a UUIDv7 regex. Created objects are UUIDv4, so every formal relation
 * target failed resolution, the uid index stayed empty, and every association
 * degraded to "关联信息不可用". Duplicated predicates had already drifted once;
 * there is now exactly one.
 */
const CANONICAL_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** True iff `value` is a canonical lowercase UUIDv4 object identity (03 §6.1). */
export function canonicalUid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UID_PATTERN.test(value)
}
