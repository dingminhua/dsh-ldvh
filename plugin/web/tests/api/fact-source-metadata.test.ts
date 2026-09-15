import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listObjects, showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';

const fixtures = [
  // 22 §7：v5 ADR 为 markdown 载体（frontmatter + 正文）；文件名编码 UID。
  {
    type: 'adr', id: 'adr-4f6c1d2e-9a3b-4c8d-8e7f-2b1c3d4e5f6a', directory: 'adrs', carrier: 'markdown',
    body: '---\nfact_type_key: adr\ntitle: ADR fixture\nstatus: active\ndecision: Use the current option\nscope: Applies to this fixture\ncreated_at: "2026-01-01"\n---\n\n# ADR fixture\n\n## 决定\n\nUse the current option\n',
  },
  // 23 §7：v5 Pitfall 为 markdown 载体（frontmatter + 正文）；文件名编码 UID。
  {
    type: 'pitfall', id: 'pitfall-7f4a5c2e-9d31-4b6f-8a07-3e0f5c91b2d4', directory: 'pitfalls', carrier: 'markdown',
    body: '---\nfact_type_key: pitfall\ntitle: Pitfall fixture\nstatus: active\nscope: Applies to this fixture\ncreated_at: "2026-01-01"\n---\n\n# Pitfall fixture\n\n## 影响与适用范围\n\nApplies to this fixture\n',
  },
  {
    type: 'research', id: 'research-0001', directory: 'researches', carrier: 'markdown',
    body: '---\nobject_id: research-0001\nfact_type_key: research\ntitle: Study fixture\nstatus: active\n---\n\n## 研究问题\n\nFixture body.\n',
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

    const listed = await listObjects('research', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    assert.equal(listed.ok, true);
    const candidate = (listed.data.items as Array<Record<string, unknown>>)[0];
    assert.equal(candidate?.object_id, 'research-0001');
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
  const adrUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
  const workCaseUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abd';
  try {
    await mkdir(path.join(root, 'ldvh-base', 'adrs'), { recursive: true });
    await mkdir(path.join(root, 'ldvh-base', 'workcases'), { recursive: true });
    // 22 §7：ADR markdown 载体，文件名编码 UID。
    await writeFile(
      path.join(root, 'ldvh-base', 'adrs', `adr-${adrUid}.md`),
      `---\nobject_uid: ${adrUid}\nfact_type_key: adr\ntitle: UID ADR\nstatus: active\ndecision: Use option A\nscope: Fixture scope\ncreated_at: "2026-01-01"\n---\n\n# UID ADR\n`,
      'utf8',
    );
    await writeFile(
      path.join(root, 'ldvh-base', 'workcases', `workcase-${workCaseUid}.md`),
      `---\nobject_uid: ${workCaseUid}\nobject_id: workcase-${workCaseUid}\nfact_type_key: workcase\ntitle: UID WorkCase\nstatus: open\ncreated_at: "2026-01-01"\nsummary: UID 权威验证。\nscope: 做什么：UID 保真；不做什么：其它。\nplan:\n  - step: one\n    done_criteria: two\n---\n\n# UID WorkCase\n\n## 摘要\n\nUID 权威验证。\n`,
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
  const objectUid = '019ffb52-ebb5-424c-881f-4f0f7d97038f';
  try {
    await mkdir(path.join(root, 'ldvh-base', 'sparks'), { recursive: true });
    // v5 Spark 载体（20 §7）：.md + frontmatter + 正文；ULID 定位符与 UUID 形态
    // 的文件名都在预期载体名闭集内。
    await writeFile(
      path.join(root, 'ldvh-base', 'sparks', `${objectId}.md`),
      [
        '---',
        `object_uid: ${objectUid}`,
        'fact_type_key: spark',
        'title: UID Spark',
        'status: open',
        'question: ULID 定位符能否走精确回读？',
        'scope_boundary: 只验证身份路径。',
        'intent: UID 定位兼容性回归。',
        'summary: UID-native 定位夹具。',
        '---',
        '',
        '# UID Spark',
        '',
      ].join('\n'),
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
  const studyDir = path.join(root, 'ldvh-base', 'researches');
  await mkdir(studyDir, { recursive: true });
  await writeFile(
    path.join(studyDir, 'research-0002.md'),
    '---\nobject_id: research-9999\nfact_type_key: research\nstatus: active\n---\n\n## 研究问题\n\nBroken identity.\n',
    'utf8',
  );
  try {
    const readable = await showObject('research-0002', scope);
    if (!readable.ok) throw new Error(readable.error);
    assert.equal(readable.ok, true);
    assert.equal(readable.summary.read_status, undefined);
    assert.equal(readable.data.read_status, 'readable');
    assert.equal(readable.data.fact_read_failure, undefined);
    assert.equal(readable.data.status, 'active');
    const issues = readable.data.field_issues as Array<Record<string, unknown>>;
    // 03 §6.1 明文不保留公共 updated_at（变更时间由 change_log[].at 承担），
    // 故它不再属必填、不出现在缺失清单中。
    assert.deepEqual(issues.map((issue) => [issue.path, issue.reason]).sort(), [
      ['created_at', 'missing'],
      ['object_id', 'identity_mismatch'],
      ['research_purpose', 'missing'], ['research_question', 'missing'], ['title', 'missing'],
    ]);

    const missing = await showObject('research-9999', scope);
    if (!missing.ok) throw new Error(missing.error);
    assert.equal(missing.ok, true);
    assert.equal(missing.summary.read_status, 'unreadable');
    assert.equal(missing.data.fact_read_failure, true);
    assert.equal(missing.data.canonical_path, 'ldvh-base/researches/research-9999.md');
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
  // 22 §7：ADR markdown 载体——未闭合 frontmatter 是 unreadable 形态。
  await writeFile(path.join(adrDir, 'adr-0001.md'), '---\nobject_id: [unterminated\n', 'utf8');
  try {
    const listed = await listObjects('adr', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    const candidate = (listed.data.items as Array<Record<string, unknown>>)[0];
    assert.equal(candidate?.read_status, 'unreadable');
    assert.equal(candidate?.check_status, undefined);
    assert.deepEqual((candidate?.read_issues as Array<Record<string, unknown>>).map((issue) => issue.code), ['frontmatter_unclosed']);
    assert.deepEqual(listed.issues.map((issue) => issue.code), ['frontmatter_unclosed']);

    const notIntegrated = await listObjects('research', undefined, undefined, scope);
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
      path.join(root, 'ldvh-base', 'workcases', 'workcase-0198f1c7-8a2b-4c3d-9e4f-123456789abc.md'),
      '---\nobject_uid: 0198f1c7-8a2b-4c3d-9e4f-123456789abc\nobject_id: workcase-0198f1c7-8a2b-4c3d-9e4f-123456789abc\nfact_type_key: workcase\ntitle: Target title\ntitle_zh: 关联目标\nstatus: open\ncreated_at: "2026-01-01"\nsummary: 关联目标。\nscope: 做什么：被引用；不做什么：其它。\nplan:\n  - step: one\n    done_criteria: two\n---\n\n# Target title\n\n## 摘要\n\n关联目标。\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'ldvh-base', 'sparks', 'spark-0001.md'),
      [
        '---',
        'object_id: spark-0001', 'fact_type_key: spark', 'title: Spark source', 'status: open',
        'question: 关联投影是否走精确可读目标？',
        'scope_boundary: 只验证关联投影机械。',
        'intent: 关联目标解析回归。',
        'summary: Spark source',
        'relations:',
        '  - relation_key: related-to', '    target:', '      governed_project_id: fixture', '      fact_type_key: workcase', '      object_id: workcase-0198f1c7-8a2b-4c3d-9e4f-123456789abc',
        '  - relation_key: informs', '    target:', '      governed_project_id: fixture', '      fact_type_key: workcase', '      object_id: workcase-0198f1c7-8a2b-4c3d-9e4f-123456789abc',
        '  - relation_key: related-to', '    target:', '      governed_project_id: fixture', '      fact_type_key: research', '      object_id: research-9999',
        '  - relation_key: related-to', '    target:', '      object_uid: 0198f1c7-8a2b-4c3d-9e4f-123456789abc',
        '  - relation_key: related-to', '    target:', '      object_uid: 0198f1c7-8a2b-4c3d-9e4f-123456789abc', '      governed_project_id: fixture', '      fact_type_key: workcase', '      object_id: workcase-0198f1c7-8a2b-4c3d-9e4f-123456789abc',
        '  - relation_key: related-to', '    target:', '      governed_project_id: fixture', '      fact_type_key: workcase', '      object_id: workcase-0198f1c7-8a2b-4c3d-9e4f-123456789abc', '      copied_title: Bad target',
        '  - malformed relation',
        '---',
        '',
        '# Spark source',
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
        target: { governedProjectId: 'fixture', factTypeKey: 'workcase', objectId: 'workcase-0198f1c7-8a2b-4c3d-9e4f-123456789abc' },
        available: true,
        title: 'Target title',
        status: 'open',
        group: 'executing',
      },
      {
        relationKey: 'related-to',
        target: { governedProjectId: 'fixture', factTypeKey: 'research', objectId: 'research-9999' },
        available: false,
      },
      {
        relationKey: 'related-to',
        target: { objectUid: '0198f1c7-8a2b-4c3d-9e4f-123456789abc' },
        resolvedTarget: { governedProjectId: 'fixture', factTypeKey: 'workcase', objectId: 'workcase-0198f1c7-8a2b-4c3d-9e4f-123456789abc' },
        available: true,
        title: 'Target title',
        status: 'open',
        group: 'executing',
      },
      { available: false },
      { available: false },
      { available: false },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
