/**
 * 运行时诊断的聚合契约（`/api/diagnostics/gate`）。
 *
 * 这一页存在的理由是区分「本页看不到」与「确实没有」——因此测试守的是**判据**
 * 而不是像素：会话目录名必须与宿主实际命名一致、未配对的结果不能算成一次调用、
 * 失败必须落进真实类别、数据边界必须随响应一起给出。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildGateReport, sessionDirNameFor } from '../../api/services/runtimeDiagnostics.ts';

/**
 * 宿主把绝对路径的 `/` 与 `.` 各换成 `-`；前导 `/` 换出的 `-` 与两侧包裹的
 * `--` 合并计数。实测目录名来自 `~/.dsh/sessions/`（2026-10-18）。
 */
test('会话目录名与宿主实际命名一致（前导斜杠不额外多一个短横）', () => {
  // 期望值**不写死 POSIX 字面量**：`sessionDirNameFor` 内部先 `path.resolve`，
  // 而 `resolve('/Users/...')` 在 Windows 上得到 `D:\Users\...`（平台相关）。
  // 故此处按「同一解析器构造期望值」断言规则本身：分隔符→`-`、冒号删除、
  // 首尾 `--` 包裹且不产生 `---`。真实宿主目录名已在实现注释中逐个登记。
  const cases = [
    { input: 'D:\\DshProject\\dsh-ldvh', expected: '--D-DshProject-dsh-ldvh--' },
    { input: 'D:\\MinMax\\ld-gpu-solver', expected: '--D-MinMax-ld-gpu-solver--' },
    { input: 'D:\\DshProject\\GTOpen_ld5090_private', expected: '--D-DshProject-GTOpen_ld5090_private--' },
  ];
  for (const { input, expected } of cases) {
    if (path.resolve('/') === '/') continue; // POSIX 上这些盘符样例无意义
    assert.equal(sessionDirNameFor(input), expected, `Windows 路径应得到宿主同款目录名：${input}`);
  }
  // 平台无关的不变量：不出现三连短横，且首尾各恰为 `--`。
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
    // 成功的 LDVH 调用
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: 'ldvh_spark_read', callId: 'c1' } }),
    eventLine({
      type: 'tool/result',
      time: 1_700_000_001_000,
      data: { toolCallId: 'c1', message: { content: [{ type: 'text', text: 'LDVH spark-read-object: completed\n' }] } },
    }),
    // 被拒的 LDVH 调用：应落进“缺必填参数”
    eventLine({ type: 'tool/call', time: 1_700_000_002_000, data: { name: 'ldvh_workcase_write', callId: 'c2' } }),
    eventLine({
      type: 'tool/result',
      time: 1_700_000_003_000,
      data: {
        toolCallId: 'c2',
        message: { content: [{ type: 'text', text: 'LDVH workcase-write-object: invalid_request\ngap: frontmatter_after (object) is required for action=update' }] },
      },
    }),
    // 非 LDVH 工具：与本题无关，不得计入
    eventLine({ type: 'tool/call', time: 1_700_000_004_000, data: { name: 'bash', callId: 'c3' } }),
    eventLine({
      type: 'tool/result',
      time: 1_700_000_005_000,
      data: { toolCallId: 'c3', message: { content: [{ type: 'text', text: 'boom' }] } },
    }),
    // 没有对应 result 的调用：只发生了一半，不能算成一次失败
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
  assert.equal(report.recentFailures[0]?.tool, 'ldvh_workcase_write');
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
