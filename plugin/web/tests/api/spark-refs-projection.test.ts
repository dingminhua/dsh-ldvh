import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listObjects, showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';

const SPARK_UID = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
const MISSING_UID = '0198f1c7-8a2b-4c3d-9e4f-000000000000';

const research = `---
object_uid: ${SPARK_UID}
fact_type_key: research
title: Report fixture
status: active
---

## 研究问题

Fixture body.
`;

const spark = `---
object_id: spark-0001
fact_type_key: spark
title: Spark fixture
status: open
question: 是否保留该议题？
scope_boundary: 当议题收敛时停止
intent: 保留以便后续处置
summary: 当前理解
refs:
  - object_uid: ${SPARK_UID}
  - object_uid: ${MISSING_UID}
relations:
  - relation_key: merged-into
    target:
      governed_project_id: fixture
      fact_type_key: spark
      object_id: spark-0012
created_at: "2026-01-01"
---

# Spark fixture

## 调查问题

是否保留该议题？
`;

test('refs project into factRefs without merging into relations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-refs-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const reportDir = path.join(root, 'ldvh-base', 'reports');
    const sparkDir = path.join(root, 'ldvh-base', 'sparks');
    await mkdir(reportDir, { recursive: true });
    await mkdir(sparkDir, { recursive: true });
    await writeFile(path.join(reportDir, `report-${SPARK_UID}.md`), research, 'utf8');
    await writeFile(path.join(sparkDir, 'spark-0001.md'), spark, 'utf8');

    const result = await showObject('spark-0001', scope);
    if (!result.ok) throw new Error(result.error);

    const refs = result.data.factRefs as Array<Record<string, unknown>>;
    assert.equal(refs.length, 2);
    assert.deepEqual(refs[0], {
      objectUid: SPARK_UID,
      target: { objectUid: SPARK_UID },
      available: true,
      resolvedTarget: { governedProjectId: 'fixture', factTypeKey: 'report', objectId: `report-${SPARK_UID}` },
      title: 'Report fixture',
      status: 'active',
    });
    assert.deepEqual(refs[1].target, { objectUid: MISSING_UID });
    assert.equal(refs[1].objectUid, MISSING_UID);
    assert.equal(refs[1].available, false);
    assert.equal('title' in refs[1], false);

    const associations = result.data.factAssociations as Array<Record<string, unknown>>;
    assert.equal(associations.length, 1);
    assert.equal(associations[0].relationKey, 'merged-into');
    assert.equal(associations.some((a) => a.objectUid === SPARK_UID), false);
    assert.equal(refs.some((r) => r.relationKey !== undefined), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a Spark without refs exposes no factRefs field', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-norefs-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const sparkDir = path.join(root, 'ldvh-base', 'sparks');
    await mkdir(sparkDir, { recursive: true });
    await writeFile(path.join(sparkDir, 'spark-0002.md'), spark
      .replace('spark-0001', 'spark-0002')
      .replace(/refs:\n(?: {2}- object_uid: [^\n]*\n)+/, '')
      .replace(/relations:\n(?: {2}[^\n]*\n| {4}[^\n]*\n)+/, ''), 'utf8');

    const result = await showObject('spark-0002', scope);
    if (!result.ok) throw new Error(result.error);
    assert.equal('factRefs' in result.data, false);
    assert.equal('factAssociations' in result.data, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('list cards project factRefs with the same contract as the detail read', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-listrefs-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const reportDir = path.join(root, 'ldvh-base', 'reports');
    const sparkDir = path.join(root, 'ldvh-base', 'sparks');
    await mkdir(reportDir, { recursive: true });
    await mkdir(sparkDir, { recursive: true });
    await writeFile(path.join(reportDir, `report-${SPARK_UID}.md`), research, 'utf8');
    await writeFile(path.join(sparkDir, 'spark-0001.md'), spark, 'utf8');

    const listed = await listObjects('spark', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    const items = (listed.data as { items: Array<Record<string, unknown>> }).items;
    const open = items.find((item) => item.object_id === 'spark-0001');
    assert.ok(open, 'open spark must be listed');

    const refs = open.factRefs as Array<Record<string, unknown>>;
    assert.equal(Array.isArray(refs), true);
    assert.equal(refs.length, 2);
    assert.equal(refs[1].available, false);

    const associations = open.factAssociations as Array<Record<string, unknown>>;
    assert.equal(associations.length, 1);
    assert.equal(associations[0].relationKey, 'merged-into');
    assert.equal(refs.some((r) => r.relationKey !== undefined), false);

    const detail = await showObject('spark-0001', scope);
    if (!detail.ok) throw new Error(detail.error);
    assert.deepEqual(open.factRefs, detail.data.factRefs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
