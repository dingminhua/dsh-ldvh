import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';


const FRICTION_UID = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
const COMMIT = 'e4e178fd7e3293f47003ed0150ab1128cc6ae0ef';

function frictionWithRelation(targetYaml: string): string {
  return `---
object_uid: ${FRICTION_UID}
fact_type_key: friction
title: Fixture friction
status: resolved
phenomenon: "fixture phenomenon"
relations:
  - relation_key: informs
    target:
${targetYaml}
---

## 现象

fixture phenomenon

## 入账依据

fixture basis

## 处置

fixture disposition
`;
}

async function readFriction(targetYaml: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-commitassoc-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const dir = path.join(root, 'ldvh-base', 'frictions');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `friction-${FRICTION_UID}.md`), frictionWithRelation(targetYaml), 'utf8');
    const result = await showObject(`friction-${FRICTION_UID}`, scope);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    return result.data;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('commit-form target projects as an AVAILABLE association (02 §8.1)', async () => {
  const data = await readFriction(`      commit: ${COMMIT}`);
  const associations = data.factAssociations as Array<Record<string, unknown>>;
  assert.equal(associations.length, 1);
  assert.equal(associations[0].available, true, 'a commit remedy is available — it must not read as 「关联信息不可用」');
  assert.equal(associations[0].relationKey, 'informs');
  assert.deepEqual(associations[0].target, { commit: COMMIT });
  assert.equal(associations[0].shortHash, COMMIT.slice(0, 7));
});

test('malformed commit targets stay unavailable rather than rendering as commits', async () => {
  const cases: Array<[string, string]> = [
    ['short hash', '      commit: abc1234'],
    ['non-hex', '      commit: ' + 'z'.repeat(40)],
    ['ref name', '      commit: refs/heads/main'],
    ['mixed with object_uid', `      object_uid: ${FRICTION_UID}\n      commit: ${COMMIT}`],
  ];
  for (const [label, targetYaml] of cases) {
    const data = await readFriction(targetYaml);
    const associations = (data.factAssociations ?? []) as Array<Record<string, unknown>>;
    for (const association of associations) {
      assert.notEqual(association.available, true, `${label} must not read as an available commit association`);
      assert.ok(
        !('commit' in ((association.target ?? {}) as Record<string, unknown>)),
        `${label} must not project a commit target`,
      );
    }
  }
});
