import assert from 'node:assert/strict';
import { test } from 'node:test';
import { associationLocator, dedupeFactCardAssociations } from '../../src/utils/factAssociations.ts';
import { type FactCardAssociation } from '../../src/utils/api.ts';


const UID = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';

function association(target: FactCardAssociation['target']): FactCardAssociation {
  return { available: true, target };
}

function objectUidOf(target: FactCardAssociation['target']): string {
  assert.ok('objectUid' in target, '保留下来的目标必须是 UID');
  return target.objectUid;
}

test('relations 与 refs 指向同一目标时各留一条（去重按 source 分组隔离，03 §7.2）', () => {
  const rows = [
    { association: association({ objectUid: UID }), source: 'relations' as const },
    { association: association({ objectUid: UID }), source: 'refs' as const },
  ];
  const kept = dedupeFactCardAssociations(rows);
  assert.equal(kept.length, 2, '跨 source 不得互相吞掉——两者是不同语义的记录');
  assert.deepEqual(kept.map((r) => r.source), ['relations', 'refs']);
});

test('同一 source 内的重复目标被去掉', () => {
  const rows = [
    { association: association({ objectUid: UID }), source: 'refs' as const },
    { association: association({ objectUid: UID }), source: 'refs' as const },
  ];
  const kept = dedupeFactCardAssociations(rows);
  assert.deepEqual(kept.map((r) => objectUidOf(r.association.target)), [UID]);
});

test('refs 条目参与去重——不再被「没有 target」放行（缺陷②回归）', () => {
  const rows = [
    { association: association({ objectUid: UID }), source: 'refs' as const },
    { association: association({ objectUid: UID }), source: 'refs' as const },
  ];
  const kept = dedupeFactCardAssociations(rows);
  assert.deepEqual(kept.map((r) => [r.source, objectUidOf(r.association.target)]), [['refs', UID]], 'refs 必须真正参与去重');
});

test('不同目标各自保留，不被误去重', () => {
  const other = '0198f1c7-8a2b-4c3d-9e4f-aaaaaaaaaaaa';
  const rows = [
    { association: association({ objectUid: UID }), source: 'refs' as const },
    { association: association({ objectUid: other }), source: 'refs' as const },
  ];
  assert.deepEqual(
    dedupeFactCardAssociations(rows).map((r) => objectUidOf(r.association.target)),
    [UID, other],
  );
});

test('缺失 target 的旧投影保留为不可定位关联，不影响合法定位符', () => {
  const legacy = { available: false } as FactCardAssociation;
  const locator = { governedProjectId: 'project', factTypeKey: 'spark', objectId: 'spark-123' };
  assert.equal(associationLocator(legacy), null);
  assert.deepEqual(associationLocator(association(locator)), locator);
  assert.equal(associationLocator(association({ objectUid: UID })), null);
});

test('commit 目标与对象目标分属不同命名空间，同来源下不互相去重', () => {
  const rows = [
    { association: association({ commit: 'e4e178fd7e3293f47003ed0150ab1128cc6ae0ef' }), source: 'relations' as const },
    { association: association({ objectUid: UID }), source: 'relations' as const },
  ];
  assert.deepEqual(
    dedupeFactCardAssociations(rows).map((r) => (r.association.target && 'commit' in r.association.target ? 'commit' : 'objectUid')),
    ['commit', 'objectUid'],
  );
});
