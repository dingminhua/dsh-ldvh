import { canonicalUid } from '../../../shared/factIdentity';

export type ReadingRelation = {
  originPath: string;
  relationKey: string;
  target: {
    objectUid: string;
  } | {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  };
  resolvedTarget?: {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  };
};

export type UnresolvedAssociation = {
  originPath: string;
  role: 'relation';
  value: unknown;
};

export type FactReadingAssociations = {
  relations: ReadingRelation[];
  unresolved: UnresolvedAssociation[];
};

/**
 * refs（03 §7.2 关联引用型 / 20 §8）的阅读投影条目。
 *
 * 与 ReadingRelation 的关键区别：**没有 relationKey**。refs 是引用型承载
 * 而非关系型声明，不定义 relation key、不参与关系闭集校验（03 §7.2）；
 * 因此它在类型上就不可能被误并入 relations 数组。
 */
export type ReadingRef = {
  originPath: string;
  objectUid: string;
  resolvedTarget?: {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  };
};

/**
 * 从精确读取投影 factRefs 归一出 refs 条目。
 *
 * 与 projectFactReadingAssociations 并列调用、**不合并**——03 §7.2 分工纪律
 * 要求 `relations` 不得承载普通内容关联、`refs` 不得承载生命周期关系，
 * 二者语义互不替代。
 */
export function projectFactReadingRefs(obj: Record<string, unknown>): ReadingRef[] {
  if (!Array.isArray(obj.factRefs)) return [];
  const out: ReadingRef[] = [];
  const seen = new Set<string>();
  obj.factRefs.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.objectUid !== 'string' || !entry.objectUid.trim()) return;
    if (seen.has(entry.objectUid)) return;
    seen.add(entry.objectUid);
    const resolved = isRecord(entry.resolvedTarget)
      && typeof entry.resolvedTarget.governedProjectId === 'string'
      && typeof entry.resolvedTarget.factTypeKey === 'string'
      && typeof entry.resolvedTarget.objectId === 'string'
      ? {
        governedProjectId: entry.resolvedTarget.governedProjectId,
        factTypeKey: entry.resolvedTarget.factTypeKey,
        objectId: entry.resolvedTarget.objectId,
      }
      : undefined;
    out.push({
      originPath: `factRefs[${index}]`,
      objectUid: entry.objectUid,
      ...(resolved ? { resolvedTarget: resolved } : {}),
    });
  });
  return out;
}

export type RelationTargetTypeGroup = {
  factTypeKey: string;
  relations: ReadingRelation[];
};

/** Project only the two-part fact-object relation contract. */
export function projectFactReadingAssociations(obj: Record<string, unknown>): FactReadingAssociations {
  const unresolved: UnresolvedAssociation[] = [];
  const resolvedTargets = new Map<string, ReadingRelation['resolvedTarget']>();
  if (Array.isArray(obj.factAssociations)) {
    for (const association of obj.factAssociations) {
      if (!isRecord(association) || !isRecord(association.target) || !isRecord(association.resolvedTarget)) continue;
      if (typeof association.target.objectUid !== 'string'
        || typeof association.resolvedTarget.governedProjectId !== 'string'
        || typeof association.resolvedTarget.factTypeKey !== 'string'
        || typeof association.resolvedTarget.objectId !== 'string') continue;
      resolvedTargets.set(association.target.objectUid, {
        governedProjectId: association.resolvedTarget.governedProjectId,
        factTypeKey: association.resolvedTarget.factTypeKey,
        objectId: association.resolvedTarget.objectId,
      });
    }
  }
  const relations = projectRelations(obj.relations, unresolved).map((relation) => {
    if (!('objectUid' in relation.target)) return relation;
    const resolvedTarget = resolvedTargets.get(relation.target.objectUid);
    return resolvedTarget ? { ...relation, resolvedTarget } : relation;
  });
  return { relations: dedupeRelationsByTarget(relations), unresolved };
}

/** Multiple formal relation keys can describe one target, but reading presents it once. */
function dedupeRelationsByTarget(relations: ReadingRelation[]): ReadingRelation[] {
  const seenTargets = new Set<string>();
  return relations.filter((relation) => {
    const targetKey = 'objectUid' in relation.target
      ? `uid\u0000${relation.target.objectUid}`
      : `${relation.target.governedProjectId}\u0000${relation.target.factTypeKey}\u0000${relation.target.objectId}`;
    if (seenTargets.has(targetKey)) return false;
    seenTargets.add(targetKey);
    return true;
  });
}

/**
 * A plain relation only says that two fact objects are associated.  The reading
 * view therefore groups by the target's object type, not by relation_key.
 */
export function groupRelationsByTargetType(relations: ReadingRelation[]): RelationTargetTypeGroup[] {
  const grouped = new Map<string, ReadingRelation[]>();
  for (const relation of relations) {
    const factTypeKey = relation.resolvedTarget?.factTypeKey
      ?? ('objectUid' in relation.target ? 'uid' : relation.target.factTypeKey);
    grouped.set(factTypeKey, [...(grouped.get(factTypeKey) ?? []), relation]);
  }
  return [...grouped.entries()].map(([factTypeKey, items]) => ({ factTypeKey, relations: items }));
}

function projectRelations(value: unknown, unresolved: UnresolvedAssociation[]): ReadingRelation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    unresolved.push({ originPath: 'relations', role: 'relation', value });
    return [];
  }
  return value.flatMap<ReadingRelation>((item, index) => {
    const originPath = `relations[${index}]`;
    if (!isRecord(item) || typeof item.relation_key !== 'string' || !isRecord(item.target)) {
      unresolved.push({ originPath, role: 'relation', value: item });
      return [];
    }
    const target = item.target;
    const targetKeys = Object.keys(target);
    if (targetKeys.length === 1 && canonicalUid(target.object_uid)) {
      return [{
        originPath,
        relationKey: item.relation_key,
        target: { objectUid: target.object_uid },
      }];
    }
    if (targetKeys.length !== 3
      || !targetKeys.every((key) => ['governed_project_id', 'fact_type_key', 'object_id'].includes(key))) {
      unresolved.push({ originPath, role: 'relation', value: item });
      return [];
    }
    if (
      typeof target.governed_project_id !== 'string'
      || typeof target.fact_type_key !== 'string'
      || typeof target.object_id !== 'string'
    ) {
      unresolved.push({ originPath, role: 'relation', value: item });
      return [];
    }
    return [{
      originPath,
      relationKey: item.relation_key,
      target: {
        governedProjectId: target.governed_project_id,
        factTypeKey: target.fact_type_key,
        objectId: target.object_id,
      },
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
