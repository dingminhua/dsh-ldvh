import type { FactCardAssociation } from './api';

/**
 * 关联行的纯逻辑（2026-11-04 自 `components/FactAssociationRows.tsx` 抽出）。
 *
 * **为什么单独成文件**：`web/tests/` 下的用例用 `tsx --test` 直接 import `src/`
 * 下的模块，而组件文件含 JSX 与 `@/` 别名，在测试运行器里解析不了。把不依赖
 * React 的判定逻辑放在这里，行为就能被直接断言——这不是为了测试而重构：
 * `dedupeFactCardAssociations` 的缺陷此前正是因为只有一条源码正则断言、没有
 * 行为用例，才让 `if (!target) return true` 的恒真分支长期未被发现
 * （spark-b0e805d1 缺陷②）。
 */

/** 关联目标的三态键（02 §8.1）：commit / 权威 UID / 已解析 locator。 */
export function associationTargetKey(target: FactCardAssociation['target']): string {
  if ('commit' in target) return `commit\u0000${target.commit}`;
  if ('objectUid' in target) return `uid\u0000${target.objectUid}`;
  return `${target.governedProjectId}\u0000${target.factTypeKey}\u0000${target.objectId}`;
}

export function associationLocator(association: FactCardAssociation) {
  if (association.resolvedTarget) return association.resolvedTarget;
  // 旧窗口或不可读投影可能缺 target；保留不可打开的关联行，不伪造定位符。
  if (!association.target || typeof association.target !== 'object') return null;
  // commit 目标（02 §8.1）不是对象 locator——没有 factTypeKey/objectId 可开面板。
  if ('commit' in association.target) return null;
  return 'objectUid' in association.target ? null : association.target;
}

/**
 * 卡片关联行的 React key。commit 目标（02 §8.1）与对象目标分属不同命名空间，
 * 不能用同一套字段拼 key——否则 commit 行会退化成 'unavailable:unknown:0'。
 */
export function factCardAssociationKey(association: FactCardAssociation, index: number): string {
  const target = association.target;
  if (!target) return `unavailable:${index}`;
  return associationTargetKey(target).replace(/\u0000/g, ':');
}

/**
 * 去重：按**来源分组隔离**（03 §7.2 分工纪律——同一目标同时被 relations 与 refs
 * 指向时是两条不同语义的记录，必须各留一条），组内按目标键去重。
 *
 * **2026-11-04 修 spark-b0e805d1 缺陷②**：`FactCardAssociation.target` 已改为
 * 必填，refs 与 relations 走同一形状。此前 refs 投影不带 `target`，而本函数用
 * `if (!target) return true` 放行——该分支对每条 refs 恒成立，等于对 refs 完全
 * 放弃去重，且没有任何用例会失败。
 *
 * `!target` 判断保留，仅用于容忍旧窗口里的历史投影；它不是合法状态的表达。
 */
export function dedupeFactCardAssociations<T extends { association: FactCardAssociation; source: string }>(rows: T[]): T[] {
  const seenTargets = new Set<string>();
  return rows.filter((row) => {
    const target = row.association.target;
    if (!target) return true;
    const scopedKey = `${row.source}\u0000${associationTargetKey(target)}`;
    if (seenTargets.has(scopedKey)) return false;
    seenTargets.add(scopedKey);
    return true;
  });
}
