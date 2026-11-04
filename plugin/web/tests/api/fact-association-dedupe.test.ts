import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupeFactCardAssociations } from '../../src/utils/factAssociations.ts';
import { type FactCardAssociation } from '../../src/utils/api.ts';

/**
 * `dedupeFactCardAssociations` 的直接用例（2026-11-04 补，修 spark-b0e805d1 缺陷②）。
 *
 * **为什么需要这份用例**：该函数此前只有一条 `assert.match(source, ...)` 式的
 * 源码正则断言（`spark-reading-contract.test.ts:58`）——它只证明调用点存在，
 * 不证明去重行为正确。而缺陷本体正藏在行为里：`if (!target) return true` 这一行
 * 对每条 refs 恒成立（refs 投影当时不带 `target`），等于对 refs 完全放弃去重，
 * 却没有任何用例会失败。
 *
 * **本用例锁定的不变量**：
 *   ① refs 条目现在必带 `target`，故进入去重计算（不再被 `!target` 放行）；
 *   ② 同一目标同时被 relations 与 refs 指向时**各留一条**（03 §7.2 分工纪律：
 *      两者语义互不替代，隔离由 `source` 显式承载）；
 *   ③ 同一 source 内的重复目标被去掉。
 */

const UID = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';

function association(target: FactCardAssociation['target']): FactCardAssociation {
  return { available: true, target };
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
  assert.equal(dedupeFactCardAssociations(rows).length, 1);
});

test('refs 条目参与去重——不再被「没有 target」放行（缺陷②回归）', () => {
  // 缺陷形态：refs 投影不带 target 时，`if (!target) return true` 对每条恒成立，
  // 两条指向同一 UID 的 refs 都会留下。收敛后 refs 必带 target，第二条被去掉。
  const rows = [
    { association: association({ objectUid: UID }), source: 'refs' as const },
    { association: association({ objectUid: UID }), source: 'refs' as const },
  ];
  assert.equal(dedupeFactCardAssociations(rows).length, 1, 'refs 必须真正参与去重');
});

test('不同目标各自保留，不被误去重', () => {
  const other = '0198f1c7-8a2b-4c3d-9e4f-aaaaaaaaaaaa';
  const rows = [
    { association: association({ objectUid: UID }), source: 'refs' as const },
    { association: association({ objectUid: other }), source: 'refs' as const },
  ];
  assert.equal(dedupeFactCardAssociations(rows).length, 2);
});

test('commit 目标与对象目标分属不同命名空间，同来源下不互相去重', () => {
  const rows = [
    { association: association({ commit: 'e4e178fd7e3293f47003ed0150ab1128cc6ae0ef' }), source: 'relations' as const },
    { association: association({ objectUid: UID }), source: 'relations' as const },
  ];
  assert.equal(dedupeFactCardAssociations(rows).length, 2);
});
