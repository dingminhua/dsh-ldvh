import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupRelationsByTargetType, projectFactReadingAssociations } from '../../src/pages/object-detail/factReadingProjection.ts';
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
  const objectUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abc';
  const projected = projectFactReadingAssociations({
    relations: [{ relation_key: 'related-to', target: { object_uid: objectUid } }],
  });
  assert.deepEqual(projected.relations, [{
    originPath: 'relations[0]', relationKey: 'related-to', target: { objectUid },
  }]);
  assert.deepEqual(projected.unresolved, []);
});

test('a uniquely resolved UID relation keeps UID authority and a separate detail locator', () => {
  const objectUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abc';
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
  const objectUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abc';
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
      { relation_key: 'depends-on', target: { governed_project_id: 'sample', fact_type_key: 'study', object_id: 'study-0001' } },
      { relation_key: 'related-to', target: { governed_project_id: 'sample', fact_type_key: 'spark', object_id: 'spark-0003' } },
    ],
  }).relations;
  assert.deepEqual(groupRelationsByTargetType(relations).map((group) => [group.factTypeKey, group.relations.map((relation) => 'objectId' in relation.target ? relation.target.objectId : relation.target.objectUid)]), [
    ['spark', ['spark-0002', 'spark-0003']],
    ['study', ['study-0001']],
  ]);
});

test('exact read metadata never becomes an object content field', () => {
  const entries = getObjectDetailContentEntries({
    object_uid: '019ffc1f-36b6-7175-891f-a3ba657b5ec0',
    object_id: 'study-0001',
    fact_type_key: 'study',
    status: 'active',
    canonical_path: 'ldvh-base/studies/study-0001.md',
    carrier: 'markdown',
    read_status: 'readable',
    read_issues: [],
    report_body: '## 研究问题',
  }, 'study');
  assert.deepEqual(entries, [['report_body', '## 研究问题']]);
});
