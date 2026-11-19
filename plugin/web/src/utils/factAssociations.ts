import type { FactCardAssociation } from './api';


export function associationTargetKey(target: FactCardAssociation['target']): string {
  if ('commit' in target) return `commit\u0000${target.commit}`;
  if ('objectUid' in target) return `uid\u0000${target.objectUid}`;
  return `${target.governedProjectId}\u0000${target.factTypeKey}\u0000${target.objectId}`;
}

export function associationLocator(association: FactCardAssociation) {
  if (association.resolvedTarget) return association.resolvedTarget;
  if (!association.target || typeof association.target !== 'object') return null;
  if ('commit' in association.target) return null;
  return 'objectUid' in association.target ? null : association.target;
}

export function factCardAssociationKey(association: FactCardAssociation, index: number): string {
  const target = association.target;
  if (!target) return `unavailable:${index}`;
  // eslint-disable-next-line no-control-regex
  return associationTargetKey(target).replace(/\u0000/g, ':');
}

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
