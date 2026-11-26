import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildGateReport, sessionDirNameFor } from '../../api/services/runtimeDiagnostics.ts';

test('会话目录名与宿主实际命名一致（前导斜杠不额外多一个短横）', () => {
  const cases = [
    { input: 'D:\\DshProject\\dsh-ldvh', expected: '--D-DshProject-dsh-ldvh--' },
    { input: 'D:\\MinMax\\ld-gpu-solver', expected: '--D-MinMax-ld-gpu-solver--' },
    { input: 'D:\\DshProject\\GTOpen_ld5090_private', expected: '--D-DshProject-GTOpen_ld5090_private--' },
  ];
  for (const { input, expected } of cases) {
    if (path.resolve('/') === '/') continue;
    assert.equal(sessionDirNameFor(input), expected, `Windows 路径应得到宿主同款目录名：${input}`);
  }
  const anyPath = sessionDirNameFor(path.join('a', 'b-c'));
  assert.doesNotMatch(anyPath, /-{3,}/, '连续短横必须折叠，否则与宿主命名不符');
  assert.match(anyPath, /^--.*--$/);
});

function eventLine(event: Record<string, unknown>): string {
  return `${JSON.stringify(event)}\n`;
}

async function writeSession(home: string, workspaceRoot: string, sessionId: string, body: string): Promise<void> {
  const dir = path.join(home, 'sessions', sessionDirNameFor(workspaceRoot), sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'session.v4.jsonl'), body, 'utf8');
}

test('只统计成对的 LDVH 工具调用，未配对的结果与无关工具不计入', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-'));
  const workspaceRoot = path.join(home, 'project');
  const body = [
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: 'ldvh_spark_read', callId: 'c1' } }),
    eventLine({
      type: 'tool/result',
      time: 1_700_000_001_000,
      data: { toolCallId: 'c1', message: { content: [{ type: 'text', text: 'LDVH spark-read-object: completed\n' }] } },
    }),
    eventLine({ type: 'tool/call', time: 1_700_000_002_000, data: { name: 'ldvh_adr_write', callId: 'c2' } }),
    eventLine({
      type: 'tool/result',
      time: 1_700_000_003_000,
      data: {
        toolCallId: 'c2',
        message: { content: [{ type: 'text', text: 'LDVH norm-write-object: invalid_request\ngap: frontmatter_after (object) is required for action=update' }] },
      },
    }),
    eventLine({ type: 'tool/call', time: 1_700_000_004_000, data: { name: 'bash', callId: 'c3' } }),
    eventLine({
      type: 'tool/result',
      time: 1_700_000_005_000,
      data: { toolCallId: 'c3', message: { content: [{ type: 'text', text: 'boom' }] } },
    }),
    eventLine({ type: 'tool/call', time: 1_700_000_006_000, data: { name: 'ldvh_goal_read', callId: 'c4' } }),
  ].join('');
  await writeSession(home, workspaceRoot, 'session-a', body);

  const report = await buildGateReport({ workspaceRoot, dshHome: home });

  assert.equal(report.totals.calls, 2);
  assert.equal(report.totals.completed, 1);
  assert.equal(report.totals.failed, 1);
  assert.equal(report.byTool.length, 2);
  assert.deepEqual(
    report.byCategory.map((row) => row.category),
    ['missing_arguments'],
  );
  assert.equal(report.recentFailures[0]?.tool, 'ldvh_adr_write');
  assert.match(report.recentFailures[0]?.detail ?? '', /frontmatter_after/);
  assert.equal(report.scope.sessionsScanned, 1);
  assert.equal(report.scope.sessionDirExists, true);
});

test('数据边界随响应给出——空结果必须能与“没有调用”区分开', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-empty-'));
  const workspaceRoot = path.join(home, 'absent-project');

  const report = await buildGateReport({ workspaceRoot, dshHome: home });

  assert.equal(report.totals.calls, 0);
  assert.equal(report.scope.sessionDirExists, false);
  assert.ok(report.scope.limits.length > 0, '空结果也必须带上覆盖范围说明');
});

test('多帧 zstd 日志须整份解出——只解第一帧会把「读不全」显示成「没有调用」', async () => {
  const { zstdCompressSync } = await import('node:zlib') as typeof import('node:zlib');
  const compress = (zstdCompressSync as unknown as ((input: Buffer) => Buffer) | undefined);
  if (typeof compress !== 'function') return;

  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-multiframe-'));
  const workspaceRoot = path.join(home, 'multiframe-project');
  const sessionId = 'session-multiframe';
  const dir = path.join(home, 'sessions', sessionDirNameFor(workspaceRoot), sessionId);
  await mkdir(dir, { recursive: true });

  const headerFrame = compress(Buffer.from(
    eventLine({ type: 'session', version: 4, id: sessionId }),
    'utf8',
  ));
  const body = [
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: 'ldvh_spark_write', callId: 'c9' } }),
    eventLine({
      type: 'tool/result',
      time: 1_700_000_001_000,
      data: {
        toolCallId: 'c9',
        message: {
          content: [{ type: 'text', text: 'LDVH spark-write-object: rejected\ngap: spark/coherence_invalid: carrier coherence failed' }],
        },
      },
    }),
  ].join('');
  const bodyFrame = compress(Buffer.from(body, 'utf8'));

  await writeFile(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.concat([headerFrame, bodyFrame]));

  const report = await buildGateReport({ workspaceRoot, dshHome: home });

  assert.equal(report.totals.calls, 1, '第二帧里的调用必须被读到（只解首帧时为 0）');
  assert.equal(report.totals.failed, 1);
  assert.equal(report.byTool[0]?.tool, 'ldvh_spark_write');
  assert.match(report.recentFailures[0]?.detail ?? '', /coherence_invalid/);
});

test('未完成结局分布：partial / unknown / invalid_request 不得被当作 completed 或被拒', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-status-'));
  const workspaceRoot = path.join(home, 'project');
  const pair = (callId: string, tool: string, text: string): string => [
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: tool, callId } }),
    eventLine({
      type: 'tool/result', time: 1_700_000_001_000,
      data: { toolCallId: callId, message: { content: [{ type: 'text', text }] } },
    }),
  ].join('');
  const body = [
    pair('c1', 'ldvh_spark_read', 'LDVH spark-read-object: completed\n'),
    pair('c2', 'ldvh_adr_write', 'LDVH adr-write-object: rejected\ngap: 22 §16 requires an explicit Human confirmation for this action: human did not confirm'),
    pair('c3', 'ldvh_pitfall_list', 'LDVH pitfall-list-objects: partial\ngap: projection truncated at limit=1 of 74 matching objects'),
    pair('c4', 'ldvh_report_session', 'Error: invalid arguments: missing required property "findings[5].statement"'),
    pair('c5', 'ldvh_norm_write', 'LDVH norm-write-object: invalid_request\ngap: frontmatter_after (object) is required for action=update'),
  ].join('');
  await writeSession(home, workspaceRoot, 'session-a', body);

  const report = await buildGateReport({ workspaceRoot, dshHome: home });

  assert.equal(report.totals.calls, 5);
  assert.equal(report.totals.completed, 1);
  assert.equal(report.totals.failed, 4, '只有 completed 算成功，其余四种结局都计入未完成');
  const byStatus = new Map(report.byStatus.map((row) => [row.status, row.count]));
  assert.equal(byStatus.get('completed'), 1, '分布含 completed，便于对照总量');
  assert.equal(byStatus.get('rejected'), 1);
  assert.equal(byStatus.get('partial'), 1, 'partial 必须作为独立结局出现，不能被吞掉');
  assert.equal(byStatus.get('unknown'), 1, 'unknown 必须作为独立结局出现');
  assert.equal(byStatus.get('invalid_request'), 1);
  assert.equal(report.byStatus.reduce((sum, row) => sum + row.count, 0), report.totals.calls, '分布之和等于总调用数');
});

test('补类后的分类表覆盖五类高频未完成形态，other 不再吞掉它们', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-categories-'));
  const workspaceRoot = path.join(home, 'project');
  const cases: { callId: string; tool: string; text: string; category: string }[] = [
    { callId: 'k1', tool: 'ldvh_read_specification_content',
      text: 'LDVH read-specification-content: rejected\ngap: content/heading_not_found: no H2 heading matches "3. Human 权利"',
      category: 'spec_lookup_miss' },
    { callId: 'k2', tool: 'ldvh_friction_read',
      text: 'Error: unknown tool "ldvh_friction_read"',
      category: 'host_param_validation' },
    { callId: 'k3', tool: 'ldvh_spark_write',
      text: 'LDVH spark-write-object: rejected\ngap: 20 §16 requires an explicit Human confirmation for this action: human did not confirm the Spark 创建',
      category: 'human_gate_pending' },
    { callId: 'k4', tool: 'ldvh_friction_list',
      text: 'LDVH friction-list-objects: partial\ngap: projection truncated at limit=50 of 66 matching objects — narrow the filter or raise the limit',
      category: 'partial_result' },
    { callId: 'k5', tool: 'ldvh_workcase_write',
      text: 'LDVH workcase-write-object: rejected\ngap: workcase/goals_conflict: the session\'s current goal points at another object',
      category: 'business_precondition' },
  ];
  const body = cases.flatMap(({ callId, tool, text }) => [
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: tool, callId } }),
    eventLine({
      type: 'tool/result', time: 1_700_000_001_000,
      data: { toolCallId: callId, message: { content: [{ type: 'text', text }] } },
    }),
  ]).join('');
  await writeSession(home, workspaceRoot, 'session-a', body);

  const report = await buildGateReport({ workspaceRoot, dshHome: home });

  const byCategory = new Map(report.byCategory.map((row) => [row.category, row.count]));
  for (const { category } of cases) {
    assert.equal(byCategory.get(category), 1, `${category} 必须被识别为独立类别，不得落进 other`);
  }
  assert.equal(byCategory.get('other'), undefined, '这五类代表文本不应有任何一条落进 other');
});

test('命中缓存必须带 cachedAt，实时计算不带', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-cache-'));
  const workspaceRoot = path.join(home, 'project');
  await writeSession(home, workspaceRoot, 'session-a', [
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: 'ldvh_spark_read', callId: 'c1' } }),
    eventLine({
      type: 'tool/result', time: 1_700_000_001_000,
      data: { toolCallId: 'c1', message: { content: [{ type: 'text', text: 'LDVH spark-read-object: completed\n' }] } },
    }),
  ].join(''));

  const fresh = await buildGateReport({ workspaceRoot, dshHome: home, noCache: true });
  assert.equal(fresh.scope.cachedAt, undefined, '实时计算不得冒充缓存，也不带 cachedAt');

  const cached = await buildGateReport({ workspaceRoot, dshHome: home });
  assert.ok(cached.scope.cachedAt, 'TTL 内二次读取命中缓存，须如实标注生成时刻');
  assert.equal(cached.totals.calls, fresh.totals.calls, '缓存复用不改变统计数字');
  assert.equal(cached.generatedAt, fresh.generatedAt, '命中缓存时 generatedAt 仍是原始生成时刻');
});

test('空目录预筛不改变统计口径：sessionsScanned 仍报总数，有日志目录照常统计', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-emptydirs-'));
  const workspaceRoot = path.join(home, 'project');
  const sessionDir = path.join(home, 'sessions', sessionDirNameFor(workspaceRoot));
  await mkdir(path.join(sessionDir, 'empty-a'), { recursive: true });
  await mkdir(path.join(sessionDir, 'empty-b'), { recursive: true });
  await writeSession(home, workspaceRoot, 'with-log', [
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: 'ldvh_spark_read', callId: 'c1' } }),
    eventLine({
      type: 'tool/result', time: 1_700_000_001_000,
      data: { toolCallId: 'c1', message: { content: [{ type: 'text', text: 'LDVH spark-read-object: completed\n' }] } },
    }),
  ].join(''));

  const report = await buildGateReport({ workspaceRoot, dshHome: home, noCache: true });

  assert.equal(report.scope.sessionsScanned, 3, '两个空目录仍计入已扫描会话总数');
  assert.equal(report.totals.calls, 1, '只有有日志的目录贡献调用，空目录不产生也不吞掉调用');
  assert.equal(report.totals.completed, 1);
  assert.equal(report.totals.failed, 0);
});

test('目标事件行粗筛不改统计口径：无关行跳过、不同写法保留、伪子串不误判', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-prescan-'));
  const workspaceRoot = path.join(home, 'project');
  const body = [
    eventLine({ type: 'session', version: 4, id: 'fixture' }),
    eventLine({ type: 'user', text: '一段与工具无关的用户文本' }),
    eventLine({ type: 'assistant', text: '另一段无关文本' }),
    eventLine({ type: 'message', content: [{ type: 'text', text: '…' }] }),
    eventLine({ type: 'note', text: 'the tool/call surface is documented here' }),
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: 'ldvh_spark_read', callId: 'c1' } }),
    eventLine({
      type: 'tool/result', time: 1_700_000_001_000,
      data: { toolCallId: 'c1', message: { content: [{ type: 'text', text: 'LDVH spark-read-object: completed\n' }] } },
    }),
    '{ "type": "tool/call", "time": 1700000002000, "data": { "name": "ldvh_adr_write", "callId": "c2" } }\n',
    '{ "type": "tool/result", "time": 1700000003000, "data": { "toolCallId": "c2", "message": { "content": [{ "type": "text", "text": "LDVH adr-write-object: rejected\\ngap: 22 §16 requires an explicit Human confirmation" }] } } }\n',
  ].join('');
  await writeSession(home, workspaceRoot, 'session-a', body);

  const report = await buildGateReport({ workspaceRoot, dshHome: home, noCache: true });

  assert.equal(report.totals.calls, 2, '两条成对的 LDVH 调用都须统计，无关行与伪子串不产生 outcome');
  assert.equal(report.totals.completed, 1);
  assert.equal(report.totals.failed, 1);
  const byTool = new Map(report.byTool.map((row) => [row.tool, row]));
  assert.equal(byTool.get('ldvh_spark_read')?.completed, 1, '标准写法的调用仍统计');
  assert.equal(byTool.get('ldvh_adr_write')?.failed, 1, '带空格 type 写法的调用仍统计（粗筛按字面保留）');
});

test('会话数超上限时只扫最近 100 个，且如实标注覆盖范围', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-limit-'));
  const workspaceRoot = path.join(home, 'project');
  const call = (id: string) => [
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: 'ldvh_spark_read', callId: id } }),
    eventLine({
      type: 'tool/result', time: 1_700_000_001_000,
      data: { toolCallId: id, message: { content: [{ type: 'text', text: 'LDVH spark-read-object: completed\n' }] } },
    }),
  ].join('');

  for (let i = 0; i < 105; i += 1) {
    await writeSession(home, workspaceRoot, `session-${String(i).padStart(3, '0')}`, call(`c${i}`));
  }

  const report = await buildGateReport({ workspaceRoot, dshHome: home, noCache: true });

  assert.equal(report.scope.sessionsScanned, 105, 'sessionsScanned 仍报目录总数，不因限流改口径');
  assert.equal(report.scope.sessionsLimited, true, '超上限须标记为已限流');
  assert.equal(report.totals.calls, 100, '统计只来自被扫的 100 个会话');
  assert.ok(
    report.scope.limits.some((line) => line.includes('最近 100 个会话')),
    `超上限须在 scope 里如实标注，实际 limits=${JSON.stringify(report.scope.limits)}`,
  );
});

test('会话数未超上限时不标注截断（避免虚报覆盖不足）', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-nolimit-'));
  const workspaceRoot = path.join(home, 'project');
  for (let i = 0; i < 3; i += 1) {
    await writeSession(home, workspaceRoot, `session-${i}`, eventLine({ type: 'session', version: 4, id: `s${i}` }));
  }

  const report = await buildGateReport({ workspaceRoot, dshHome: home, noCache: true });

  assert.equal(report.scope.sessionsScanned, 3);
  assert.equal(report.scope.sessionsLimited, false, '未超上限不得标记限流');
  assert.ok(
    !report.scope.limits.some((line) => line.includes('最近 100 个会话')),
    '未超上限时不得出现截断说明',
  );
});
