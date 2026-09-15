import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';

/** 20 §8 refs 上限 10 项；此处用两条覆盖「可解析 + 不可解析」两种目标。 */
const SPARK_UID = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
const MISSING_UID = '0198f1c7-8a2b-4c3d-9e4f-000000000000';

const research = `---
object_uid: ${SPARK_UID}
fact_type_key: research
title: Study fixture
status: active
---

## 研究问题

Fixture body.
`;

// refs 指向可解析的 research，并额外携带一个无法解析的目标；relations 携带
// 一条生命周期关系（merged-into）——两者必须各走各的字段。
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
    const researchDir = path.join(root, 'ldvh-base', 'researches');
    const sparkDir = path.join(root, 'ldvh-base', 'sparks');
    await mkdir(researchDir, { recursive: true });
    await mkdir(sparkDir, { recursive: true });
    await writeFile(path.join(researchDir, `research-${SPARK_UID}.md`), research, 'utf8');
    await writeFile(path.join(sparkDir, 'spark-0001.md'), spark, 'utf8');

    const result = await showObject('spark-0001', scope);
    if (!result.ok) throw new Error(result.error);

    // refs 走独立字段 factRefs：可解析目标带定位与标题，不可解析目标保留条目。
    const refs = result.data.factRefs as Array<Record<string, unknown>>;
    assert.equal(refs.length, 2);
    assert.deepEqual(refs[0], {
      objectUid: SPARK_UID,
      available: true,
      resolvedTarget: { governedProjectId: 'fixture', factTypeKey: 'research', objectId: `research-${SPARK_UID}` },
      title: 'Study fixture',
      status: 'active',
    });
    assert.equal(refs[1].objectUid, MISSING_UID);
    assert.equal(refs[1].available, false);
    assert.equal('title' in refs[1], false);

    // relations 保持独立：factRefs 不得混入 factAssociations，也不得反向混入。
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
