/**
 * Regression lock for the canonical object_uid predicate (specs/03 §6.1).
 *
 * The Web layer previously carried UUIDv7 regexes in four places. Created
 * objects are canonical **UUIDv4** (03 §6.1 explicitly rejects time-ordered
 * UUIDv7), so every formal relation target failed resolution, the uid index
 * stayed empty, and every association degraded to "关联信息不可用".
 *
 * These tests pin the predicate to the spec so a future v7-shaped assumption
 * fails loudly here instead of silently disabling associations in the UI.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalUid } from '../../shared/factIdentity.ts';
import { projectFactReadingAssociations } from '../../src/pages/object-detail/factReadingProjection.ts';

/** A real object_uid observed in this project's fact source (ldvh-base/). */
const REAL_UID = '034533b2-713b-4825-b675-26ba7b4ae713';

test('canonicalUid accepts canonical UUIDv4 identities', () => {
  assert.equal(canonicalUid(REAL_UID), true);
  assert.equal(canonicalUid('0198f1c7-8a2b-4c3d-9e4f-123456789abc'), true);
});

test('canonicalUid rejects UUIDv7 — 03 §6.1 does not adopt time-ordered identity', () => {
  assert.equal(canonicalUid('0198f1c7-8a2b-7c3d-9e4f-123456789abc'), false);
  assert.equal(canonicalUid('019ffb52-ebb5-7812-9630-8e7aad44da3d'), false);
});

test('canonicalUid rejects non-canonical, uppercase, and non-string values', () => {
  for (const value of ['', 'not-a-uid', 'spark-0001', REAL_UID.toUpperCase(), `${REAL_UID} `]) {
    assert.equal(canonicalUid(value), false, `must reject ${JSON.stringify(value)}`);
  }
  for (const value of [undefined, null, 42, {}, [], true]) {
    assert.equal(canonicalUid(value), false, `must reject ${JSON.stringify(value)}`);
  }
});

test('a formal relation to a real canonical v4 uid resolves rather than degrading', () => {
  const projected = projectFactReadingAssociations({
    relations: [{ relation_key: 'contributed-to', target: { object_uid: REAL_UID } }],
  });
  assert.deepEqual(projected.unresolved, []);
  assert.deepEqual(projected.relations, [{
    originPath: 'relations[0]',
    relationKey: 'contributed-to',
    target: { objectUid: REAL_UID },
  }]);
});

test('exact-read resolution attaches the target for a canonical v4 uid', () => {
  const projected = projectFactReadingAssociations({
    relations: [{ relation_key: 'contributed-to', target: { object_uid: REAL_UID } }],
    factAssociations: [{
      target: { objectUid: REAL_UID },
      resolvedTarget: { governedProjectId: 'dsh-ldvh', factTypeKey: 'pitfall', objectId: 'pitfall-0008' },
      available: true,
    }],
  });
  assert.deepEqual(projected.relations[0]?.resolvedTarget, {
    governedProjectId: 'dsh-ldvh', factTypeKey: 'pitfall', objectId: 'pitfall-0008',
  });
});
