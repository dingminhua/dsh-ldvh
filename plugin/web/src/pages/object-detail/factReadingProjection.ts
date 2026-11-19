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
  } | {
    commit: string;
  };
  resolvedTarget?: {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  };
  resolvedCommitTitle?: string;
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

export type ReadingRef = {
  originPath: string;
  objectUid: string;
  resolvedTarget?: {
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  };
  resolvedCommitTitle?: string;
};

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
  const commitTitles = new Map<string, string>();
  if (Array.isArray(obj.factAssociations)) {
    for (const association of obj.factAssociations) {
      if (!isRecord(association) || !isRecord(association.target)) continue;
      const hash = association.target.commit;
      if (typeof hash !== 'string' || !hash.trim()) continue;
      if (typeof association.title !== 'string' || !association.title.trim()) continue;
      commitTitles.set(hash.trim(), association.title.trim());
    }
  }
  const relations = projectRelations(obj.relations, unresolved).map((relation) => {
    if ('commit' in relation.target) {
      const commitTitle = commitTitles.get(relation.target.commit);
      return commitTitle ? { ...relation, resolvedCommitTitle: commitTitle } : relation;
    }
    if (!('objectUid' in relation.target)) return relation;
    const resolvedTarget = resolvedTargets.get(relation.target.objectUid);
    return resolvedTarget ? { ...relation, resolvedTarget } : relation;
  });
  return { relations: dedupeRelationsByTarget(relations), unresolved };
}

function dedupeRelationsByTarget(relations: ReadingRelation[]): ReadingRelation[] {
  const seenTargets = new Set<string>();
  return relations.filter((relation) => {
    const targetKey = 'commit' in relation.target
      ? `commit\u0000${relation.target.commit}`
      : 'objectUid' in relation.target
        ? `uid\u0000${relation.target.objectUid}`
        : `${relation.target.governedProjectId}\u0000${relation.target.factTypeKey}\u0000${relation.target.objectId}`;
    if (seenTargets.has(targetKey)) return false;
    seenTargets.add(targetKey);
    return true;
  });
}

export function groupRelationsByTargetType(relations: ReadingRelation[]): RelationTargetTypeGroup[] {
  const grouped = new Map<string, ReadingRelation[]>();
  for (const relation of relations) {
    const factTypeKey = 'commit' in relation.target
      ? 'commit'
      : relation.resolvedTarget?.factTypeKey
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
    if (targetKeys.length === 1 && typeof target.commit === 'string'
      && /^[0-9a-f]{40}$/i.test(target.commit.trim())) {
      return [{
        originPath,
        relationKey: item.relation_key,
        target: { commit: target.commit.trim() },
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
