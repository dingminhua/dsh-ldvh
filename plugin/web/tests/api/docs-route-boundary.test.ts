import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { resolveAllowedDocPath } from '../../api/routes/docs.ts';

test('docs route allow-list applies after normalization', () => {
  // `path.resolve` is platform-dependent: a leading '/' is drive-relative on
  // Windows, so '/workspace/ldvh' resolves under the current drive. Building the
  // expectation with the SAME resolver — and canonicalizing the root first —
  // keeps this test about the allow-list rule instead of about separator
  // spelling. The two `null` cases are the substance: `specs/../.env` must not
  // escape into the project root, and `../outside.md` must leave the tree
  // entirely.
  const root = path.resolve('/workspace/ldvh');
  assert.equal(resolveAllowedDocPath(root, 'specs/08-Web.md'), path.resolve(root, 'specs/08-Web.md'));
  assert.equal(resolveAllowedDocPath(root, 'web/docs/03-ObjectList.md'), path.resolve(root, 'web/docs/03-ObjectList.md'));
  assert.equal(resolveAllowedDocPath(root, 'specs/../.env'), null);
  assert.equal(resolveAllowedDocPath(root, '../outside.md'), null);
});
