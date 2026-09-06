import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('object list cards pass the owning project and full object id to copy actions', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');

  assert.match(source, /target=\{obj\.id\}/);
  assert.match(source, /projectId=\{selectedProjectId\}/);
  assert.match(source, /onOpen\(obj\.id\)/);
});
