import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listObjects, showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';

const fixtures = [
  { type: 'adr', id: 'adr-0001', directory: 'adrs', carrier: 'yaml', body: 'object_id: adr-0001\nfact_type_key: adr\ntitle: ADR fixture\nstatus: active\n' },
  { type: 'pitfall', id: 'pitfall-0001', directory: 'pitfalls', carrier: 'yaml', body: 'object_id: pitfall-0001\nfact_type_key: pitfall\ntitle: Pitfall fixture\nstatus: active\n' },
  {
    type: 'study', id: 'study-0001', directory: 'studies', carrier: 'markdown',
    body: '---\nobject_id: study-0001\nfact_type_key: study\ntitle: Study fixture\nstatus: active\n---\n\n## 研究问题\n\nFixture body.\n',
  },
] as const;

test('local exact reads carry source metadata for each local carrier, while list candidates do not', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-facts-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    for (const fixture of fixtures) {
      const extension = fixture.carrier === 'markdown' ? '.md' : '.yaml';
      const dir = path.join(root, 'ldvh-base', fixture.directory);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${fixture.id}${extension}`), fixture.body, 'utf8');
    }
    for (const fixture of fixtures) {
      const result = await showObject(fixture.id, scope);
      if (!result.ok) throw new Error(result.error);
      assert.equal(result.ok, true);
      assert.equal(result.data.canonical_path, `ldvh-base/${fixture.directory}/${fixture.id}${fixture.carrier === 'markdown' ? '.md' : '.yaml'}`);
      assert.equal(result.data.carrier, fixture.carrier);
      assert.equal(result.data.read_status, 'readable');
      assert.equal(result.data.check_status, undefined);
      assert.equal(result.data.fact_read_failure, undefined);
    }

    const listed = await listObjects('study', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    assert.equal(listed.ok, true);
    const candidate = (listed.data.items as Array<Record<string, unknown>>)[0];
    assert.equal(candidate?.object_id, 'study-0001');
    assert.equal('canonical_path' in (candidate ?? {}), false);
    assert.equal('carrier' in (candidate ?? {}), false);
    assert.equal(candidate?.read_status, 'readable');
    assert.deepEqual(candidate?.read_issues, []);
    assert.equal(candidate?.report_body, undefined);

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fact list projections preserve full UID authority without derived identity fields', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-facts-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const adrUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abc';
  const workCaseUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abd';
  try {
    await mkdir(path.join(root, 'ldvh-base', 'adrs'), { recursive: true });
    await mkdir(path.join(root, 'ldvh-base', 'workcases'), { recursive: true });
    await writeFile(
      path.join(root, 'ldvh-base', 'adrs', 'adr-0001.yaml'),
      `object_uid: ${adrUid}\nobject_id: adr-0001\nfact_type_key: adr\ntitle: UID ADR\nstatus: active\n`,
      'utf8',
    );
    await writeFile(
      path.join(root, 'ldvh-base', 'workcases', 'workcase-0001.yaml'),
      `object_uid: ${workCaseUid}\nobject_id: workcase-0001\nfact_type_key: workcase\ntitle: UID WorkCase\nstatus: open\nphase: executing\n`,
      'utf8',
    );

    const adrList = await listObjects('adr', undefined, undefined, scope);
    const workCaseList = await listObjects('workcase', undefined, undefined, scope);
    if (!adrList.ok || !workCaseList.ok) throw new Error('fact list unavailable');
    const adr = (adrList.data.items as Array<Record<string, unknown>>)[0];
    const workCase = (workCaseList.data.items as Array<Record<string, unknown>>)[0];
    const retiredField = ['short', 'ref'].join('_');
    assert.equal(adr?.[retiredField], undefined);
    assert.equal(adr?.object_uid, adrUid);
    assert.equal(workCase?.[retiredField], undefined);
    assert.equal(workCase?.object_uid, workCaseUid);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UID-native object ids open through the exact-read detail path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-facts-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const objectId = 'spark-01KZXN5TXNFTKR60XNHDPSKV6D';
  const objectUid = '019ffb52-ebb5-724c-881f-4f0f7d97038f';
  try {
    await mkdir(path.join(root, 'ldvh-base', 'sparks'), { recursive: true });
    await writeFile(
      path.join(root, 'ldvh-base', 'sparks', `${objectId}.yaml`),
      `object_uid: ${objectUid}\nobject_id: ${objectId}\nfact_type_key: spark\ntitle: UID Spark\nstatus: open\n`,
      'utf8',
    );
    const result = await showObject(objectId, scope);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.object_id, objectId);
    assert.equal(result.data.object_uid, objectUid);
    assert.equal(result.data[['short', 'ref'].join('_')], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('identity and required-field problems remain readable field-level results', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-facts-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const studyDir = path.join(root, 'ldvh-base', 'studies');
  await mkdir(studyDir, { recursive: true });
  await writeFile(
    path.join(studyDir, 'study-0002.md'),
    '---\nobject_id: study-9999\nfact_type_key: study\nstatus: active\n---\n\n## 研究问题\n\nBroken identity.\n',
    'utf8',
  );
  try {
    const readable = await showObject('study-0002', scope);
    if (!readable.ok) throw new Error(readable.error);
    assert.equal(readable.ok, true);
    assert.equal(readable.summary.read_status, undefined);
    assert.equal(readable.data.read_status, 'readable');
    assert.equal(readable.data.fact_read_failure, undefined);
    assert.equal(readable.data.status, 'active');
    const issues = readable.data.field_issues as Array<Record<string, unknown>>;
    assert.deepEqual(issues.map((issue) => [issue.path, issue.reason]).sort(), [
      ['abstract', 'missing'],
      ['created_at', 'missing'],
      ['object_id', 'identity_mismatch'], ['research_question', 'missing'], ['title', 'missing'],
      ['updated_at', 'missing'],
    ]);

    const missing = await showObject('study-9999', scope);
    if (!missing.ok) throw new Error(missing.error);
    assert.equal(missing.ok, true);
    assert.equal(missing.summary.read_status, 'unreadable');
    assert.equal(missing.data.fact_read_failure, true);
    assert.equal(missing.data.canonical_path, 'ldvh-base/studies/study-9999.md');
    assert.equal(missing.data.report_body, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('list responses keep per-object read failures and collection coverage in their declared channels', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-facts-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const adrDir = path.join(root, 'ldvh-base', 'adrs');
  await mkdir(adrDir, { recursive: true });
  await writeFile(path.join(adrDir, 'adr-0001.yaml'), 'object_id: [unterminated\n', 'utf8');
  try {
    const listed = await listObjects('adr', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    const candidate = (listed.data.items as Array<Record<string, unknown>>)[0];
    assert.equal(candidate?.read_status, 'unreadable');
    assert.equal(candidate?.check_status, undefined);
    assert.deepEqual((candidate?.read_issues as Array<Record<string, unknown>>).map((issue) => issue.code), ['yaml_parse_failed']);
    assert.deepEqual(listed.issues.map((issue) => issue.code), ['yaml_parse_failed']);

    const notIntegrated = await listObjects('study', undefined, undefined, scope);
    if (!notIntegrated.ok) throw new Error(notIntegrated.error);
    assert.equal(notIntegrated.data.coverage_status, 'type_not_integrated');
    assert.deepEqual((notIntegrated.data.collection_issues as Array<Record<string, unknown>>).map((issue) => issue.code), ['type_not_integrated']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fact list cards project every formal association through exact readable targets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-facts-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    await mkdir(path.join(root, 'ldvh-base', 'sparks'), { recursive: true });
    await mkdir(path.join(root, 'ldvh-base', 'workcases'), { recursive: true });
    await writeFile(
      path.join(root, 'ldvh-base', 'workcases', 'workcase-0001.yaml'),
      'object_uid: 0198f1c7-8a2b-7c3d-9e4f-123456789abc\nobject_id: workcase-0001\nfact_type_key: workcase\ntitle: Target title\ntitle_zh: 关联目标\nstatus: open\nphase: executing\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'ldvh-base', 'sparks', 'spark-0001.yaml'),
      [
        'object_id: spark-0001', 'fact_type_key: spark', 'title: Spark source', 'status: open', 'relations:',
        '  - relation_key: related-to', '    target:', '      governed_project_id: fixture', '      fact_type_key: workcase', '      object_id: workcase-0001',
        '  - relation_key: informs', '    target:', '      governed_project_id: fixture', '      fact_type_key: workcase', '      object_id: workcase-0001',
        '  - relation_key: related-to', '    target:', '      governed_project_id: fixture', '      fact_type_key: study', '      object_id: study-9999',
        '  - relation_key: related-to', '    target:', '      object_uid: 0198f1c7-8a2b-7c3d-9e4f-123456789abc',
        '  - relation_key: related-to', '    target:', '      object_uid: 0198f1c7-8a2b-7c3d-9e4f-123456789abc', '      governed_project_id: fixture', '      fact_type_key: workcase', '      object_id: workcase-0001',
        '  - relation_key: related-to', '    target:', '      governed_project_id: fixture', '      fact_type_key: workcase', '      object_id: workcase-0001', '      copied_title: Bad target',
        '  - malformed relation',
        '',
      ].join('\n'),
      'utf8',
    );

    const listed = await listObjects('spark', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    const item = (listed.data.items as Array<Record<string, unknown>>)[0];
    assert.deepEqual(item?.factAssociations, [
      {
        relationKey: 'related-to',
        target: { governedProjectId: 'fixture', factTypeKey: 'workcase', objectId: 'workcase-0001' },
        available: true,
        title: 'Target title',
        status: 'open',
        progressGroup: 'progressing',
      },
      {
        relationKey: 'related-to',
        target: { governedProjectId: 'fixture', factTypeKey: 'study', objectId: 'study-9999' },
        available: false,
      },
      {
        relationKey: 'related-to',
        target: { objectUid: '0198f1c7-8a2b-7c3d-9e4f-123456789abc' },
        resolvedTarget: { governedProjectId: 'fixture', factTypeKey: 'workcase', objectId: 'workcase-0001' },
        available: true,
        title: 'Target title',
        status: 'open',
        progressGroup: 'progressing',
      },
      { available: false },
      { available: false },
      { available: false },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
