import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { resolveAllowedDocPath } from '../../api/routes/docs.ts';

test('docs route allow-list applies after normalization', () => {
  const root = path.resolve('/workspace/ldvh');
  assert.equal(resolveAllowedDocPath(root, 'specs/08-Web.md'), path.resolve(root, 'specs/08-Web.md'));
  assert.equal(resolveAllowedDocPath(root, 'web/docs/03-ObjectList.md'), path.resolve(root, 'web/docs/03-ObjectList.md'));
  assert.equal(resolveAllowedDocPath(root, 'specs/../.env'), null);
  assert.equal(resolveAllowedDocPath(root, '../outside.md'), null);
});
