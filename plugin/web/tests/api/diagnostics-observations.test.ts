/**
 * 摩擦观察在诊断页的呈现契约（`/api/diagnostics/observations`）。
 *
 * ## 这组测试守的是什么
 *
 * 不是像素，是**规范边界**。11 §12bis.1 第 2 条（Human 决定 2026-10）把呈现面
 * 钉死为「存在与数量 + 现象/时间/来源/状态四项」，并明禁两件事：展示 `evidence`
 * 全文、以及使其可被点击进入事实对象详情（它没有对象身份）。
 *
 * 这两条禁令**极易在演进中被悄悄放开**——只要有人觉得「诊断页给全一点更方便」，
 * 缓冲就会变成第二个事实源入口。故用测试钉住：
 *   1. 投影里不得出现 evidence / session / promoted_to 等表外字段；
 *   2. 条目不得携带任何可当对象标识用的 uid；
 *   3. 目录不存在须如实标注（不是错误、也不是"零条目"的伪装）；
 *   4. 破损行/闭集外状态须跳过并**计入**跳过数，不能静默吞掉。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFrictionObservationReport } from '../../api/services/runtimeDiagnostics.ts';

/** 造一条合法的缓冲条目（字段闭集见 11 §12bis.1）。 */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ee000000-0000-4000-8000-000000000001',
    at: '2026-10-26T04:00:00.000Z',
    project: 'proj-a',
    session: 'session-secret',
    anchor: 'turn 12 · 助手正文第 3 段',
    phenomenon: '研究文档因缺少溯源行被校验器打回。',
    evidence: '这是一段不该出现在任何界面上的证据全文。',
    group: 'g-doc-format',
    status: 'pending',
    promoted_to: null,
    ...overrides,
  };
}

async function writeBuffer(
  home: string,
  projectId: string,
  entries: Record<string, unknown>[],
): Promise<string> {
  const dir = path.join(home, 'ldvh', 'friction-observations');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${projectId}.jsonl`);
  await writeFile(file, entries.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  return file;
}

test('缓冲目录不存在时如实标注为正常初态，且不伪造零条目之外的错误', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  const report = await buildFrictionObservationReport({ dshHome: home });

  assert.equal(report.ok, true);
  assert.equal(report.scope.bufferDirExists, false, '目录不存在须如实标注');
  assert.equal(report.totals.entries, 0);
  // 关键：目录不存在是**正常初态**，不是失败——不得抛错、不得伪造数据。
  assert.deepEqual(report.scope.files, []);
});

test('投影只含规范允许的四项 + group，绝不包含 evidence / session / promoted_to', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  await writeBuffer(home, 'proj-a', [entry()]);
  const report = await buildFrictionObservationReport({ dshHome: home });

  assert.equal(report.totals.entries, 1);
  const row = report.recent[0];
  assert.ok(row, '应有一条投影');

  // 允许的字段面（11 §12bis.1 第 2 条）。
  const allowed = new Set(['at', 'anchor', 'phenomenon', 'status', 'group']);
  for (const key of Object.keys(row)) {
    assert.ok(allowed.has(key), `投影不得含表外字段 ${key}——呈现面由规范钉死`);
  }

  // 明禁项逐一点名断言（即便 allowed 检查已覆盖，独立断言使失败信息直指规范）。
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('不该出现在任何界面上'), '不得输出 evidence 全文（11 §12bis.1 第 2 条）');
  assert.ok(!serialized.includes('session-secret'), '不得输出 session（不是呈现四项之一）');
  assert.ok(!('evidence' in row), '投影对象本身不得带 evidence 键');
  assert.ok(!('promoted_to' in row), '投影对象本身不得带 promoted_to 键');
});

test('条目不得携带可当对象标识的 uid——它没有对象身份，不得据此进入详情', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  await writeBuffer(home, 'proj-a', [entry()]);
  const report = await buildFrictionObservationReport({ dshHome: home });

  // 缓冲条目内确有 id 字段（写入侧的记录标识），但**投影面不得暴露**：
  // 一旦暴露，前端就具备了"按 id 打开某对象"的能力，等于把它当事实对象。
  assert.ok(!('id' in report.recent[0]), '投影不得暴露 id——否则可被当作对象标识使用');
  assert.ok(
    !/object_uid/i.test(JSON.stringify(report.recent)),
    '投影不得出现 object_uid（缓冲条目没有对象身份）',
  );
});

test('同组 pending 条目累积到 N=3 时标记为可晋升（与阈值并列呈现）', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  await writeBuffer(home, 'proj-a', [
    entry({ at: '2026-10-26T04:00:00.000Z' }),
    entry({ at: '2026-10-26T04:05:00.000Z' }),
    entry({ at: '2026-10-26T04:10:00.000Z' }),
  ]);
  const report = await buildFrictionObservationReport({ dshHome: home });

  assert.equal(report.scope.threshold, 3, '阈值由 11 §9 内嵌固定为 3，不可配置');
  const group = report.groups.find((row) => row.group === 'g-doc-format');
  assert.ok(group, '应有一个观察组');
  assert.equal(group.pendingCount, 3);
  assert.equal(group.promotionReady, true, '达 3 条即标记可晋升');
  assert.equal(group.firstAt, '2026-10-26T04:00:00.000Z');
  assert.equal(group.lastAt, '2026-10-26T04:10:00.000Z');
  // 组里呈现的是**最新一条**现象（读者要看的是"最近这次是什么样"）。
  assert.ok(group.latestPhenomenon?.includes('溯源行'));
});

test('未达阈值的组如实标注进度，不提前标记可晋升', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  await writeBuffer(home, 'proj-a', [entry(), entry({ at: '2026-10-26T04:05:00.000Z' })]);
  const report = await buildFrictionObservationReport({ dshHome: home });

  const group = report.groups[0];
  assert.equal(group.pendingCount, 2);
  assert.equal(group.promotionReady, false, '2 < 3，不得标记可晋升');
});

test('终态条目（promoted/discarded/evicted）不参与观察组——它们已不在"正在攒"的那批', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  await writeBuffer(home, 'proj-a', [
    entry({ status: 'pending' }),
    entry({ status: 'promoted', at: '2026-10-26T04:05:00.000Z' }),
    entry({ status: 'evicted', at: '2026-10-26T04:10:00.000Z' }),
  ]);
  const report = await buildFrictionObservationReport({ dshHome: home });

  const group = report.groups.find((row) => row.group === 'g-doc-format');
  assert.ok(group);
  assert.equal(group.pendingCount, 1, '只有 pending 计入攒账进度');
  assert.equal(group.promotionReady, false);
  // 但总数按状态如实分组（终态条目仍然存在于缓冲里，须可见）。
  const byStatus = new Map(report.totals.byStatus.map((row) => [row.status, row.count]));
  assert.equal(byStatus.get('pending'), 1);
  assert.equal(byStatus.get('promoted'), 1);
  assert.equal(byStatus.get('evicted'), 1);
});

test('破损行与闭集外状态被跳过并如实计数，不伪装成"本来就没有"', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  const dir = path.join(home, 'ldvh', 'friction-observations');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'proj-a.jsonl'),
    [
      JSON.stringify(entry()),
      '{ 这不是合法 JSON',
      JSON.stringify(entry({ status: 'observing', at: '2026-10-26T04:20:00.000Z' })),
      '',
    ].join('\n'),
    'utf8',
  );
  const report = await buildFrictionObservationReport({ dshHome: home });

  assert.equal(report.totals.entries, 1, '只有合法条目计入');
  // 闭集外的 observing 不得被当作合法状态呈现（26 §9 已删除该状态）。
  const statuses = report.totals.byStatus.map((row) => row.status);
  assert.ok(!statuses.includes('observing'), '闭集外状态不得出现在统计里');
  // 跳过必须如实声明——否则"解析失败"会伪装成"条目较少"。
  assert.ok(
    report.scope.limits.some((line) => line.includes('无法解析') || line.includes('跳过')),
    `跳过数须在 limits 里如实声明；实际 limits=${JSON.stringify(report.scope.limits)}`,
  );
});

test('按管辖项目分文件：多项目条目汇总呈现，且总数与文件数各自如实', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  await writeBuffer(home, 'proj-a', [entry()]);
  await writeBuffer(home, 'proj-b', [entry({ project: 'proj-b', group: 'g-other' })]);

  const report = await buildFrictionObservationReport({ dshHome: home });

  assert.equal(report.totals.entries, 2, '两个项目的条目都汇总');
  assert.equal(report.totals.projects, 2, '文件数如实反映项目数');
  assert.deepEqual(report.scope.files.sort(), ['proj-a.jsonl', 'proj-b.jsonl']);
  // 两组的进度各自独立（不得跨项目合并同组名）。
  assert.equal(report.groups.length, 2);
});

test('最近条目按时间倒序，只取前 40 条', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  const rows = Array.from({ length: 45 }, (_, index) =>
    entry({ at: `2026-10-26T04:${String(index).padStart(2, '0')}:00.000Z` }),
  );
  await writeBuffer(home, 'proj-a', rows);
  const report = await buildFrictionObservationReport({ dshHome: home });

  assert.equal(report.totals.entries, 45);
  assert.equal(report.recent.length, 40, '最近条目上限 40');
  // 倒序：首条应是最新的（04:44）。
  assert.equal(report.recent[0].at, '2026-10-26T04:44:00.000Z');
});

test('本页只读：报告不写任何载体，缓冲文件内容逐字不变', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-obs-'));
  const file = await writeBuffer(home, 'proj-a', [entry()]);
  const { readFile } = await import('node:fs/promises');
  const before = await readFile(file, 'utf8');

  await buildFrictionObservationReport({ dshHome: home });
  await buildFrictionObservationReport({ dshHome: home });

  const after = await readFile(file, 'utf8');
  assert.equal(after, before, '读取不得改动缓冲文件（本页只读）');
});
