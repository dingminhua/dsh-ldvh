import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listLocalFacts, readLocalFact, type LocalFactScope } from '../../api/services/localFactReader.ts';

const base = [
  'fact_type_key: adr',
  'status: active',
  'created_at: "2026-01-01"',
  'decision_question: Which option?',
  'decision: Use the current option',
  'applicability: This fixture',
  'trigger_signal: Test trigger condition',
  'rationale: It is sufficient here',
  'consequences: No production effect',
].join('\n');

test('field-level reader preserves canonical UID authority without adding a derived identity field', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'adrs');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(
      path.join(directory, 'adr-0001.yaml'),
      `object_uid: 0198f1c7-8a2b-7c3d-9e4f-123456789abc\nobject_id: adr-0001\ntitle: UID projection\n${base}\n`,
      'utf8',
    );
    const listed = await listLocalFacts('adr', scope);
    assert.equal(listed.items[0]?.fact_object?.object_uid, '0198f1c7-8a2b-7c3d-9e4f-123456789abc');
    const retiredField = ['short', 'ref'].join('_');
    assert.equal(listed.items[0]?.fact_object?.[retiredField], undefined);
    assert.deepEqual(listed.items[0]?.authority_ref, { object_uid: '0198f1c7-8a2b-7c3d-9e4f-123456789abc' });
    assert.equal(listed.items[0]?.unparsed_structures.some((item) => item.path === 'object_uid'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('field-level reader discovers a UID-native Crockford carrier name', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'adrs');
  await mkdir(directory, { recursive: true });
  const objectId = 'adr-01KZXN5TXNEBSRC6HHGTBQKAJ4';
  try {
    await writeFile(
      path.join(directory, `${objectId}.yaml`),
      `object_uid: 019ffb52-ebb5-72f3-861a-31869779aa44\nobject_id: ${objectId}\ntitle: UID locator\n${base}\n`,
      'utf8',
    );
    const listed = await listLocalFacts('adr', scope);
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.object_ref.object_id, objectId);
    assert.equal(listed.items[0]?.fact_object?.object_uid, '019ffb52-ebb5-72f3-861a-31869779aa44');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('field-level reader keeps recoverable field defects separate from unreadable carriers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'adrs');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, 'adr-0001.yaml'), `object_id: adr-0001\n${base}\n`, 'utf8');
    await writeFile(path.join(directory, 'adr-0002.yaml'), `object_id: adr-0002\ntitle: [not, text]\n${base}\n`, 'utf8');
    await writeFile(path.join(directory, 'adr-0003.yaml'), `object_id: adr-0003\ntitle: Legacy\nlegacy_owner: old\n${base}\n`, 'utf8');
    await writeFile(path.join(directory, 'adr-0004.yaml'), `object_id: adr-0004\ntitle: Nested\nunknown_tree:\n  before: after\n${base}\n`, 'utf8');
    await writeFile(path.join(directory, 'adr-0005.yaml'), 'object_id: [unterminated\n', 'utf8');

    const listed = await listLocalFacts('adr', scope);
    assert.equal(listed.status, 'complete');
    assert.equal(listed.items.length, 5);
    const byId = new Map(listed.items.map((item) => [item.object_ref.object_id, item]));
    assert.deepEqual(byId.get('adr-0001')?.field_issues.map((issue) => issue.path), ['title']);
    assert.equal(byId.get('adr-0002')?.fact_object?.title, undefined);
    assert.deepEqual(byId.get('adr-0002')?.field_issues.map((issue) => issue.reason), ['type_mismatch']);
    assert.deepEqual(byId.get('adr-0003')?.unparsed_structures, [{ path: 'legacy_owner', reason: 'unconsumed_field', raw_value: 'old' }]);
    assert.deepEqual(byId.get('adr-0004')?.unparsed_structures, [{ path: 'unknown_tree', reason: 'unconsumed_field', raw_value: { before: 'after' } }]);
    assert.equal(byId.get('adr-0005')?.read_status, 'unreadable');
    assert.equal(byId.get('adr-0005')?.issues[0]?.code, 'yaml_parse_failed');

    const detail = await readLocalFact('adr', 'adr-0003', scope);
    assert.equal(detail.status, 'ok');
    if (detail.status === 'ok') assert.equal(detail.item.read_status, 'readable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unclosed Markdown frontmatter is the only Study field-path failure that becomes unreadable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'researches');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, 'research-0001.md'), '---\nobject_id: research-0001\n', 'utf8');
    const detail = await readLocalFact('research', 'research-0001', scope);
    assert.equal(detail.status, 'ok');
    if (detail.status === 'ok') {
      assert.equal(detail.item.read_status, 'unreadable');
      assert.equal(detail.item.issues[0]?.code, 'frontmatter_unclosed');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('WorkCase object fields and malformed consumed array members remain visible separately', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'workcases');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, 'workcase-0001.yaml'), [
      'object_id: workcase-0001', 'fact_type_key: workcase', 'title: Object fields',
      'status: open', 'created_at: "2026-01-01"',
      'execution_authorization:', '  action_ceiling: Stay in scope',
      'execution_approval:', '  subject_version: 1', 'closure_proposal:', '  proposed_outcome: partial',
      'work_items:', '  - item_id: item-valid', '    goal: Keep this item', '  - malformed member',
    ].join('\n'), 'utf8');

    const detail = await readLocalFact('workcase', 'workcase-0001', scope);
    assert.equal(detail.status, 'ok');
    if (detail.status === 'ok') {
      assert.equal(detail.item.fact_object?.execution_authorization && typeof detail.item.fact_object.execution_authorization, 'object');
      assert.equal(detail.item.fact_object?.execution_approval && typeof detail.item.fact_object.execution_approval, 'object');
      assert.equal(detail.item.fact_object?.closure_proposal && typeof detail.item.fact_object.closure_proposal, 'object');
      assert.deepEqual(detail.item.unparsed_structures, [{
        path: 'work_items[1]', reason: 'unparseable_member', raw_value: 'malformed member',
      }]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Spark evolution members without a timestamp and forbidden Pitfall tags remain unparsed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const sparkDir = path.join(root, 'ldvh-base', 'sparks');
  const pitfallDir = path.join(root, 'ldvh-base', 'pitfalls');
  await mkdir(sparkDir, { recursive: true });
  await mkdir(pitfallDir, { recursive: true });
  try {
    // v5 Spark 载体（20 §7）：.md + frontmatter + 正文；文件名编码 UID。
    // 本夹具用短名 fact_type_key（24 号 research 先例）——读取层两种写法都收。
    await writeFile(path.join(sparkDir, 'spark-3f2504e0-4f89-41d3-9a0c-0305e82c3301.md'), [
      '---',
      'object_uid: 3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      'fact_type_key: spark',
      'title: Missing event time',
      'status: open',
      'created_at: "2026-01-01"',
      'question: 何时必须补充演变时间？',
      'scope_boundary: 只验证成员形态，不验证语义。',
      'intent: 保留时间戳缺失的可视性。',
      'summary: Current observation',
      'evolution:',
      '  - summary: This entry has no source time',
      '---',
      '',
      '# Missing event time',
      '',
      '## 当前理解',
      '',
      'Current observation',
      '',
    ].join('\n'), 'utf8');
    await writeFile(path.join(pitfallDir, 'pitfall-0001.yaml'), [
      'object_id: pitfall-0001', 'fact_type_key: pitfall', 'title: Forbidden tag',
      'status: active', 'created_at: "2026-01-01"', 'tags: [legacy]',
    ].join('\n'), 'utf8');

    const spark = await readLocalFact('spark', 'spark-3f2504e0-4f89-41d3-9a0c-0305e82c3301', scope);
    const pitfall = await readLocalFact('pitfall', 'pitfall-0001', scope);
    assert.equal(spark.status, 'ok');
    assert.equal(pitfall.status, 'ok');
    if (spark.status === 'ok') {
      assert.equal(spark.item.read_status, 'readable');
      assert.deepEqual(spark.item.unparsed_structures, [{
        path: 'evolution[0]', reason: 'unparseable_member', raw_value: { summary: 'This entry has no source time' },
      }]);
    }
    if (pitfall.status === 'ok') assert.deepEqual(pitfall.item.unparsed_structures, [{
      path: 'tags', reason: 'unconsumed_field', raw_value: ['legacy'],
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('change_log accepts the current three-field signature shape without retired session_id', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'sparks');
  await mkdir(directory, { recursive: true });
  try {
    // 规范键形式 fact_type_key（20 §8：spark-fact-type）——与短名写法并存收。
    await writeFile(path.join(directory, 'spark-0d5c3e2a-7b1f-4c8e-8f2a-9d4b6e8a1c3d.md'), [
      '---',
      'object_uid: 0d5c3e2a-7b1f-4c8e-8f2a-9d4b6e8a1c3d',
      'fact_type_key: spark-fact-type',
      'title: Current signature',
      'status: open',
      'created_at: "2026-01-01"',
      'question: 当前署名形态是否可读？',
      'scope_boundary: 只验证 change_log 成员形态。',
      'intent: 署名兼容性回归。',
      'summary: Current observation',
      'change_log:',
      '  - signature:', '      product_name: Cindy', '      model_name: gpt-5.6-luna', '      agent_runtime_name: codex-cli',
      '    at: "2026-01-01T00:00:00+08:00"', '    summary: Current entry',
      '---',
      '',
      '# Current signature',
    ].join('\n'), 'utf8');

    const detail = await readLocalFact('spark', 'spark-0d5c3e2a-7b1f-4c8e-8f2a-9d4b6e8a1c3d', scope);
    assert.equal(detail.status, 'ok');
    if (detail.status === 'ok') {
      assert.equal(detail.item.read_status, 'readable');
      assert.equal(detail.item.fact_object?.fact_type_key, 'spark-fact-type');
      assert.equal((detail.item.fact_object?.change_log as unknown[])?.length, 1);
      assert.deepEqual(detail.item.unparsed_structures, []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('change_log accepts the canonical and legacy signature shapes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'sparks');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, 'spark-6a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d.md'), [
      '---',
      'object_uid: 6a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d',
      'fact_type_key: spark-fact-type',
      'title: Signature compatibility',
      'status: open',
      'created_at: "2026-01-01T00:00:00+08:00"',
      'question: 历史署名形态是否仍可读？',
      'scope_boundary: 只验证 change_log 成员形态。',
      'intent: 署名向后兼容。',
      'summary: Current observation',
      'change_log:',
      '  - signature:', '      model_id: gpt-5', '      agent_workbench: Cindy',
      '    session_id: canonical-session', '    at: "2026-01-01T00:00:00+08:00"', '    summary: Canonical entry',
      '  - signature:', '      agent_id: codex', '      host_environment: LegacyHost',
      '    session_id: legacy-session', '    at: "2026-01-02T00:00:00+08:00"', '    summary: Legacy entry',
      '  - signature:', '      model_id: gpt-5', '      host_name: InterimHost',
      '    session_id: interim-session', '    at: "2026-01-03T00:00:00+08:00"', '    summary: Interim entry',
      '---',
      '',
      '# Signature compatibility',
    ].join('\n'), 'utf8');

    const detail = await readLocalFact('spark', 'spark-6a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d', scope);
    assert.equal(detail.status, 'ok');
    if (detail.status === 'ok') {
      assert.equal(detail.item.read_status, 'readable');
      assert.equal((detail.item.fact_object?.change_log as unknown[])?.length, 3);
      assert.deepEqual(detail.item.unparsed_structures, []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('change_log consumes the two-field signature contract and exposes incomplete records', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'sparks');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, 'spark-9f8e7d6c-5b4a-4c3d-8e9f-0a1b2c3d4e5f.md'), [
      '---',
      'object_uid: 9f8e7d6c-5b4a-4c3d-8e9f-0a1b2c3d4e5f',
      'fact_type_key: spark',
      'title: Trace contract',
      'status: open',
      'created_at: "2026-01-01"',
      'question: 未识别的署名形态是否暴露为未解析？',
      'scope_boundary: 只验证 change_log 成员形态。',
      'intent: 防止坏流水静默丢弃。',
      'summary: Read contract',
      'change_log:',
      '  - signature:', '      agent_id: codex', '      host_environment: Cindy',
      '    session_id: session-one', '    at: "2026-01-01T00:00:00+08:00"', '    summary: Created',
      '  - signature:', '      agent_id: codex', '      host_environment: Cindy', '      signer_type: ai-agent',
      '    session_id: session-two', '    at: "2026-01-02T00:00:00+08:00"', '    summary: Retired shape',
      '---',
      '',
      '# Trace contract',
    ].join('\n'), 'utf8');
    const detail = await readLocalFact('spark', 'spark-9f8e7d6c-5b4a-4c3d-8e9f-0a1b2c3d4e5f', scope);
    assert.equal(detail.status, 'ok');
    if (detail.status === 'ok') {
      assert.equal((detail.item.fact_object?.change_log as unknown[])?.length, 2);
      assert.deepEqual(detail.item.unparsed_structures, [{
        path: 'change_log[1]', reason: 'unparseable_member', raw_value: {
          signature: { agent_id: 'codex', host_environment: 'Cindy', signer_type: 'ai-agent' },
          session_id: 'session-two', at: '2026-01-02T00:00:00+08:00', summary: 'Retired shape',
        },
      }]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('yaml_source carries the verbatim YAML text — unknown fields, order and comments preserved', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'researches');
  await mkdir(directory, { recursive: true });
  try {
    // 顺序非字母序、含注释、含契约外未知字段 tags —— yaml_source 必须逐字保留这三者。
    const rawFrontmatter = [
      '# 顶部注释：机器索引层',
      'title: 原文保真夹具',
      'tags: [legacy]', '  # 契约外字段，直显必须保留',
      'status: active',
      'fact_type_key: research',
      'created_at: "2026-01-01"',
      'research_question: 夹具问题？',
      'research_purpose: 验证原文透传',
      'stopping_reason: sufficient',
    ].join('\n');
    await writeFile(
      path.join(directory, 'research-0009.md'),
      `---\n${rawFrontmatter}\n---\n\n## 研究问题\n\n夹具问题？\n`,
      'utf8',
    );
    const detail = await readLocalFact('research', 'research-0009', scope);
    assert.equal(detail.status, 'ok');
    if (detail.status === 'ok') {
      assert.equal(detail.item.read_status, 'readable');
      assert.equal(detail.item.yaml_source, rawFrontmatter);
      assert.ok(detail.item.yaml_source.includes('# 顶部注释'));
      assert.ok(detail.item.yaml_source.indexOf('title:') < detail.item.yaml_source.indexOf('tags:'));
      // 未知字段进入未解析结构（契约面如实报告），但 yaml_source 仍逐字保留它。
      assert.ok((detail.item.unparsed_structures ?? []).some((s) => s.path === 'tags'));
      assert.ok(detail.item.yaml_source.includes('tags: [legacy]'));
      // 注入字段不进 yaml_source：object_id 由文件名推导，文件里没有。
      assert.ok(!detail.item.yaml_source.includes('object_id'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('yaml carrier objects carry the whole file as yaml_source', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-field-reader-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'adrs');
  await mkdir(directory, { recursive: true });
  try {
    const rawFile = `# 文件级注释\nobject_uid: 0198f1c7-8a2b-7c3d-9e4f-123456789abc\nobject_id: adr-0007\n${base}\n`;
    await writeFile(path.join(directory, 'adr-0007.yaml'), rawFile, 'utf8');
    const detail = await readLocalFact('adr', 'adr-0007', scope);
    assert.equal(detail.status, 'ok');
    if (detail.status === 'ok') {
      assert.equal(detail.item.read_status, 'readable');
      // 逐字原文含尾随换行——不做任何修剪。
      assert.equal(detail.item.yaml_source, rawFile);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
