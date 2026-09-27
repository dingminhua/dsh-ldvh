import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listObjects, showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';

/**
 * 21 §8 / 03 §7.2：`refs` 是状态中立的普通内容关联，目标是 object_uid。承接对象
 * 声明「来源 WorkCase ← 承接对象」后，该 WorkCase 卡必须能反向枚举出这些来源。
 *
 * 本测试钉住计划步骤 4 的完成判据：承接对象 refs 携带来源工单 object_uid 时，
 * 可被解析并回读、且反向可枚举；同时钉住它**只是可见性线索**，不得承载任何
 * 建议履行／覆盖／关闭的结论。
 */
const WORKCASE_UID = '0198f1c7-8a2b-4c3d-9e4f-aaaaaaaaaaaa';
const ADR_UID = '0198f1c7-8a2b-4c3d-9e4f-bbbbbbbbbbbb';
const SPARK_UID = '0198f1c7-8a2b-4c3d-9e4f-cccccccccccc';
const TITLELESS_SPARK_UID = '0198f1c7-8a2b-4c3d-9e4f-dddddddddddd';

const adr = `---
object_uid: ${ADR_UID}
fact_type_key: adr
title: Decision fixture
status: active
created_at: "2026-01-01"
---

## 决策背景

Fixture body.
`;

// 来源工单：自身携带一条指向 ADR 的普通 refs（正向面），同时是被反向枚举的目标。
const workcase = `---
object_uid: ${WORKCASE_UID}
fact_type_key: workcase
title: WorkCase fixture
status: open
gist: 夹具工单
summary: 夹具工单摘要
scope: 夹具授权范围
plan:
  - step: 夹具步骤
    done_criteria: 夹具判据
refs:
  - object_uid: ${ADR_UID}
created_at: "2026-01-01"
---

# WorkCase fixture

## 摘要

夹具工单摘要
`;

// 承接对象：refs 携带来源工单 object_uid。
const spark = `---
object_uid: ${SPARK_UID}
fact_type_key: spark
title: Follow-up spark
status: open
question: 是否继续该议题？
scope_boundary: 当议题收敛时停止
intent: 承接来源工单的建议
summary: 当前理解
refs:
  - object_uid: ${WORKCASE_UID}
created_at: "2026-01-01"
---

# Follow-up spark

## 调查问题

是否继续该议题？
`;

// 可读但无 title 的来源：可读性（而非可选 title 元数据）决定 available。
const titlelessSpark = `---
object_uid: ${TITLELESS_SPARK_UID}
fact_type_key: spark
object_id: spark-0003
status: open
question: 无标题来源？
scope_boundary: 当议题收敛时停止
intent: 承接来源工单的建议
summary: 当前理解
refs:
  - object_uid: ${WORKCASE_UID}
created_at: "2026-01-01"
---

# spark-0003

## 调查问题

无标题来源？
`;

async function seed(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-wcrefs-'));
  const dirs = ['workcases', 'adrs', 'sparks'];
  for (const dir of dirs) await mkdir(path.join(root, 'ldvh-base', dir), { recursive: true });
  await writeFile(path.join(root, 'ldvh-base', 'workcases', `workcase-${WORKCASE_UID}.md`), workcase, 'utf8');
  await writeFile(path.join(root, 'ldvh-base', 'adrs', `adr-${ADR_UID}.md`), adr, 'utf8');
  await writeFile(path.join(root, 'ldvh-base', 'sparks', 'spark-0002.md'), spark, 'utf8');
  await writeFile(path.join(root, 'ldvh-base', 'sparks', 'spark-0003.md'), titlelessSpark, 'utf8');
  return root;
}

test('承接对象的 refs 反向枚举到来源 WorkCase 卡（列表与详情一致）', async () => {
  const root = await seed();
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const workcaseId = `workcase-${WORKCASE_UID}`;

    // 正向面：来源工单自身的 refs 走独立字段 factRefs。
    const detail = await showObject(workcaseId, scope);
    if (!detail.ok) throw new Error(detail.error);
    const forward = detail.data.factRefs as Array<Record<string, unknown>>;
    assert.equal(forward.length, 1);
    assert.equal(forward[0].objectUid, ADR_UID);
    assert.equal(forward[0].available, true);

    // 反向面：承接对象（两个 spark）各自声明 refs → 来源工单。
    const sources = detail.data.factRefSources as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(sources), 'factRefSources must be projected on the WorkCase detail read');
    assert.equal(sources.length, 2);
    const byUid = new Map(sources.map((entry) => [entry.objectUid, entry]));
    assert.deepEqual(byUid.get(SPARK_UID), {
      objectUid: SPARK_UID,
      available: true,
      resolvedTarget: { governedProjectId: 'fixture', factTypeKey: 'spark', objectId: 'spark-0002' },
      title: 'Follow-up spark',
      status: 'open',
    });
    // 可读但无 title 的来源仍然 available=true，且不伪造 title 字段。
    const titleless = byUid.get(TITLELESS_SPARK_UID);
    assert.ok(titleless, 'titleless readable source must still be enumerated');
    assert.equal(titleless.available, true);
    assert.equal('title' in titleless, false);

    // 列表路径给出与详情逐字相同的反向投影（两层阅读器契约一致）。
    const listed = await listObjects('workcase', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    const items = (listed.data as { items: Array<Record<string, unknown>> }).items;
    const card = items.find((item) => item.object_id === workcaseId);
    assert.ok(card, 'WorkCase must be listed');
    assert.deepEqual(card.factRefSources, detail.data.factRefSources);

    // 反向条目只是可见性线索：不得携带建议履行／覆盖／关闭类结论字段。
    for (const entry of sources) {
      for (const forbidden of ['outcome', 'result', 'satisfied', 'coverage', 'closure', 'closed', 'advice']) {
        assert.equal(forbidden in entry, false, `reverse projection must not claim ${forbidden}`);
      }
    }

    // 边界：反向枚举只挂在 WorkCase 上，普通目标对象不得凭空获得 factRefSources。
    const adrRead = await showObject(`adr-${ADR_UID}`, scope);
    if (!adrRead.ok) throw new Error(adrRead.error);
    assert.equal('factRefSources' in adrRead.data, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('无任何承接对象声明 refs 时，来源 WorkCase 不暴露 factRefSources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-wcnorefs-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const dir = path.join(root, 'ldvh-base', 'workcases');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `workcase-${WORKCASE_UID}.md`), workcase
      .replace(/refs:\n(?: {2}- object_uid: [^\n]*\n)+/, ''), 'utf8');

    const result = await showObject(`workcase-${WORKCASE_UID}`, scope);
    if (!result.ok) throw new Error(result.error);
    assert.equal('factRefs' in result.data, false);
    assert.equal('factRefSources' in result.data, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
