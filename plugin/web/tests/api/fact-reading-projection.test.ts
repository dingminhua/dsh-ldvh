import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupRelationsByTargetType, projectFactReadingAssociations, projectFactReadingRefs } from '../../src/pages/object-detail/factReadingProjection.ts';
import { getObjectDetailContentEntries } from '../../src/pages/object-detail/model.ts';

test('projects only relation_key and stable target', () => {
  const projected = projectFactReadingAssociations({
    relations: [{ relation_key: 'related-to', target: { governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0002' } }],
  });
  assert.deepEqual(projected.relations, [{
    originPath: 'relations[0]', relationKey: 'related-to',
    target: { governedProjectId: 'sample', factTypeKey: 'spark', objectId: 'spark-0002' },
  }]);
  assert.deepEqual(projected.unresolved, []);
});

test('contributed-to relations project through with their stable target', () => {
  const projected = projectFactReadingAssociations({
    relations: [{ relation_key: 'contributed-to', target: { governed_project_id: 'sample', fact_type_key: 'pitfall', object_id: 'pitfall-0003' } }],
  });
  assert.deepEqual(projected.relations, [{
    originPath: 'relations[0]', relationKey: 'contributed-to',
    target: { governedProjectId: 'sample', factTypeKey: 'pitfall', objectId: 'pitfall-0003' },
  }]);
  assert.deepEqual(projected.unresolved, []);
});

test('UID relation targets remain visible as stable references', () => {
  const objectUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
  const projected = projectFactReadingAssociations({
    relations: [{ relation_key: 'related-to', target: { object_uid: objectUid } }],
  });
  assert.deepEqual(projected.relations, [{
    originPath: 'relations[0]', relationKey: 'related-to', target: { objectUid },
  }]);
  assert.deepEqual(projected.unresolved, []);
});

test('a uniquely resolved UID relation keeps UID authority and a separate detail locator', () => {
  const objectUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
  const resolvedTarget = { governedProjectId: 'sample', factTypeKey: 'workcase', objectId: 'workcase-0002' };
  const projected = projectFactReadingAssociations({
    relations: [{ relation_key: 'related-to', target: { object_uid: objectUid } }],
    factAssociations: [{ target: { objectUid }, resolvedTarget, available: true }],
  });
  assert.deepEqual(projected.relations, [{
    originPath: 'relations[0]', relationKey: 'related-to', target: { objectUid }, resolvedTarget,
  }]);
  assert.deepEqual(groupRelationsByTargetType(projected.relations), [{
    factTypeKey: 'workcase', relations: projected.relations,
  }]);
});

test('reading presents one association per target even when multiple relation keys point to it', () => {
  const projected = projectFactReadingAssociations({
    relations: [
      { relation_key: 'inspired-by', target: { governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0003' } },
      { relation_key: 'informs', target: { governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0003' } },
    ],
  });
  assert.deepEqual(projected.relations, [{
    originPath: 'relations[0]', relationKey: 'inspired-by',
    target: { governedProjectId: 'sample', factTypeKey: 'spark', objectId: 'spark-0003' },
  }]);
});

test('legacy reference fields are not projected', () => {
  const projected = projectFactReadingAssociations({ source_refs: [{ kind: 'web-page', locator: 'https://example.com' }], evidence_refs: [] });
  assert.deepEqual(projected.relations, []);
  assert.deepEqual(projected.unresolved, []);
});

test('malformed relations stay visible as unresolved', () => {
  const objectUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
  const projected = projectFactReadingAssociations({
    relations: [
      { relation_key: 'related-to', target: { object_id: 'spark-0002' } },
      {
        relation_key: 'related-to',
        target: { object_uid: objectUid, governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0002' },
      },
      {
        relation_key: 'related-to',
        target: { governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0002', title: 'copied title' },
      },
    ],
  });
  assert.deepEqual(projected.unresolved.map((item) => item.originPath), ['relations[0]', 'relations[1]', 'relations[2]']);
});

test('groups ordinary relations by target type rather than their relation key', () => {
  const relations = projectFactReadingAssociations({
    relations: [
      { relation_key: 'related-to', target: { governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0002' } },
      { relation_key: 'depends-on', target: { governed_project_id: 'sample', fact_type_key: 'research', object_id: 'research-0001' } },
      { relation_key: 'related-to', target: { governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0003' } },
    ],
  }).relations;
  assert.deepEqual(groupRelationsByTargetType(relations).map((group) => [group.factTypeKey, group.relations.map((relation) => 'objectId' in relation.target ? relation.target.objectId : relation.target.objectUid)]), [
    ['spark', ['spark-0002', 'spark-0003']],
    ['research', ['research-0001']],
  ]);
});

test('exact read metadata never becomes an object content field', () => {
  const entries = getObjectDetailContentEntries({
    object_uid: '019ffc1f-36b6-4175-891f-a3ba657b5ec0',
    object_id: 'research-0001',
    fact_type_key: 'research',
    status: 'active',
    canonical_path: 'ldvh-base/researches/research-0001.md',
    carrier: 'markdown',
    read_status: 'readable',
    read_issues: [],
    report_body: '## 研究问题',
  }, 'research');
  assert.deepEqual(entries, [['report_body', '## 研究问题']]);
});

test('refs project as their own reading set, never as relations', () => {
  const objectUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
  const resolvedTarget = { governedProjectId: 'sample', factTypeKey: 'research', objectId: 'research-0007' };
  const obj = {
    // 03 §7.2 分工纪律：relations 承载生命周期关系、refs 承载普通内容关联。
    relations: [{ relation_key: 'merged-into', target: { governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0012' } }],
    factRefs: [{ objectUid, resolvedTarget, available: true, title: '某调研' }],
  };
  const refs = projectFactReadingRefs(obj);
  assert.deepEqual(refs, [{ originPath: 'factRefs[0]', objectUid, resolvedTarget }]);
  // refs 不进入 relations 集合，反之亦然——两者语义互不替代。
  const associations = projectFactReadingAssociations(obj);
  assert.deepEqual(associations.relations.map((r) => r.relationKey), ['merged-into']);
  assert.equal('objectUid' in associations.relations[0].target, false);
});

test('an unresolvable ref keeps its uid instead of degrading to no association', () => {
  const objectUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
  const refs = projectFactReadingRefs({ factRefs: [{ objectUid, available: false }] });
  assert.deepEqual(refs, [{ originPath: 'factRefs[0]', objectUid }]);
});

test('refs projection tolerates missing, malformed, and duplicate entries', () => {
  const objectUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
  assert.deepEqual(projectFactReadingRefs({}), []);
  assert.deepEqual(projectFactReadingRefs({ factRefs: 'not-an-array' }), []);
  assert.deepEqual(projectFactReadingRefs({ factRefs: [null, { objectUid: '   ' }, { nope: 1 }] }), []);
  assert.equal(projectFactReadingRefs({ factRefs: [{ objectUid }, { objectUid }] }).length, 1);
});

test('factRefs is exact read metadata, not a duplicated object content field', () => {
  const entries = getObjectDetailContentEntries({
    object_id: 'spark-0001',
    fact_type_key: 'spark',
    status: 'open',
    question: '是否应当保留该议题？',
    refs: [{ object_uid: '0198f1c7-8a2b-4c3d-9e4f-123456789abc' }],
    factRefs: [{ objectUid: '0198f1c7-8a2b-4c3d-9e4f-123456789abc', available: true }],
  }, 'spark');
  assert.deepEqual(entries, [['question', '是否应当保留该议题？']]);
});
