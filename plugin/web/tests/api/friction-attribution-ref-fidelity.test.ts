import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';


const FRICTION_UID = '0198f1c7-8a2b-4c3d-9e4f-abcdef123456';
const ANCHOR_UID = '8d5437b7-91c4-4cbe-af27-1d6f305297af';

function frictionCarrier(attributionRefYaml: string): string {
  return `---
object_uid: ${FRICTION_UID}
fact_type_key: friction
title: Fixture friction with an attribution anchor
status: open
phenomenon: "fixture phenomenon"
attribution_ref:
${attributionRefYaml}
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

async function readFriction(attributionRefYaml: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-attributionref-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const dir = path.join(root, 'ldvh-base', 'frictions');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `friction-${FRICTION_UID}.md`), frictionCarrier(attributionRefYaml), 'utf8');
    const result = await showObject(`friction-${FRICTION_UID}`, scope);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    return result.data as Record<string, unknown>;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('object-form attribution_ref survives the read projection (26 §8/§11 锚点型)', async () => {
  const data = await readFriction(`  object_uid: ${ANCHOR_UID}`);

  assert.equal('fact_object' in data, false, 'showObject flattens fact_object into the top level');
  assert.ok('attribution_ref' in data, 'the anchor must not be silently dropped by the read layer');
  assert.deepEqual(
    data.attribution_ref,
    { object_uid: ANCHOR_UID },
    'the projected shape equals relations.target — one reference shape per project, not two',
  );

  const fieldIssues = (data.field_issues ?? []) as Array<Record<string, unknown>>;
  assert.equal(
    fieldIssues.some((issue) => issue.path === 'attribution_ref'),
    false,
    'a canonical carrier must not raise a field issue; got ' + JSON.stringify(fieldIssues),
  );
});

test('legacy bare-string attribution_ref is refused by the read layer (§11: object form only)', async () => {
  const data = await readFriction(`  ${ANCHOR_UID}`);

  assert.equal(
    'attribution_ref' in data,
    false,
    'the read layer must not silently lift a bare string into the canonical shape — normalization belongs to the CLI projection window, not to the contract',
  );
  const fieldIssues = (data.field_issues ?? []) as Array<Record<string, unknown>>;
  const anchorIssue = fieldIssues.find((issue) => issue.path === 'attribution_ref');
  assert.ok(anchorIssue, 'a bare string must surface as a field issue, not vanish; got ' + JSON.stringify(fieldIssues));
  assert.equal(anchorIssue.reason, 'type_mismatch');
  assert.equal(anchorIssue.expected, 'object');
});
