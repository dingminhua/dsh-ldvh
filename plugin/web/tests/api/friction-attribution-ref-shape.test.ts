import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';

const FRICTION_UID = '0198f1c7-8a2b-4c3d-9e4f-987654321fed';

function carrier(refYaml: string): string {
  return `---
object_uid: ${FRICTION_UID}
fact_type_key: friction
title: Shape fixture
status: open
phenomenon: "fixture phenomenon"
attribution_ref:
${refYaml}
occurrence:
  count: 1
  first_at: "2026-11-01T00:00:00.000Z"
  last_at: "2026-11-01T00:00:00.000Z"
change_log: []
---

## 现象

fixture phenomenon

## 入账依据

fixture basis
`;
}

async function readWith(refYaml: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-attrsrc-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const dir = path.join(root, 'ldvh-base', 'frictions');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `friction-${FRICTION_UID}.md`), carrier(refYaml), 'utf8');
    const result = await showObject(`friction-${FRICTION_UID}`, scope);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    return result.data as Record<string, unknown>;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const BAD_SHAPES: Array<[string, string]> = [
  ['missing object_uid', '  garbage_key: 1'],
  ['empty object', '  {}'],
  ['object_uid is not a string', '  object_uid: 42'],
  ['object_uid is an empty string', '  object_uid: ""'],
];

for (const [label, refYaml] of BAD_SHAPES) {
  test(`malformed attribution_ref (${label}) is reported, never projected as canonical`, async () => {
    const data = await readWith(refYaml);
    assert.equal(
      'attribution_ref' in data,
      false,
      `${label}: a malformed anchor must not enter the projection (CLI projects nothing here either — one shape, one read law)`,
    );
    const fieldIssues = (data.field_issues ?? []) as Array<Record<string, unknown>>;
    assert.ok(
      fieldIssues.some((issue) => issue.path === 'attribution_ref'),
      `${label}: the reader must say why; got ${JSON.stringify(fieldIssues)}`,
    );
  });
}
