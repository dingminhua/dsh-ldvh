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
    eventLine({ type: 'tool/call', time: 1_700_000_002_000, data: { name: 'ldvh_adr_write', callId: 'c2' } }),
    eventLine({
      type: 'tool/result',
      time: 1_700_000_003_000,
      data: {
        toolCallId: 'c2',
        message: { content: [{ type: 'text', text: 'LDVH norm-write-object: invalid_request\ngap: frontmatter_after (object) is required for action=update' }] },
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

/**
 * **多帧压缩日志必须整份解出**（2026-11-04 登记）。
 *
 * 宿主的会话日志是**逐次追加、每次独立压一帧**的，一份日志因此是多帧 zstd。
 * `zlib.zstdDecompressSync(整份)` 在多帧输入上**只解第一帧就返回且不报错**——
 * 实测某 2.7MB 日志只解出 212 字节（正好是 `{"type":"session",...}` 那一行），
 * 页面于是把「读不全」显示成「没有调用」：扫描 500 个会话、调用数恒为 0。
 *
 * 本用例构造一份**两帧**日志：第一帧只有 session 头（模拟真实形态），第二帧
 * 才是工具调用。若实现退回「整份喂内置 API」，第二帧丢失、`calls` 归零，
 * 本用例即失败——这正是原来缺失的那条防线（既有用例全部用未压缩明文，
 * 故该缺陷从未被任何用例触达）。
 */
test('多帧 zstd 日志须整份解出——只解第一帧会把「读不全」显示成「没有调用」', async () => {
  const { zstdCompressSync } = await import('node:zlib') as typeof import('node:zlib');
  const compress = (zstdCompressSync as unknown as ((input: Buffer) => Buffer) | undefined);
  if (typeof compress !== 'function') return; // 无内置 zstd 的运行时跳过（CLI 回退路径由实现负责）

  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-multiframe-'));
  const workspaceRoot = path.join(home, 'multiframe-project');
  const sessionId = 'session-multiframe';
  const dir = path.join(home, 'sessions', sessionDirNameFor(workspaceRoot), sessionId);
  await mkdir(dir, { recursive: true });

  // 第一帧：session 头。真实日志的第一帧就只有这一行。
  const headerFrame = compress(Buffer.from(
    eventLine({ type: 'session', version: 4, id: sessionId }),
    'utf8',
  ));
  // 第二帧：真正的工具调用与结果——它在单帧解压时**全部丢失**。
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
  // 帧边界不得把两段内容粘成一行坏 JSON——故失败明细须正常解析出来。
  assert.match(report.recentFailures[0]?.detail ?? '', /coherence_invalid/);
});

/**
 * 结局分布（2026-11-16 补）：顶部「未完成调用」是一个聚合数，历史上被界面
 * 直接标成「被拒次数」。这个用例钉住它被 `byStatus` 拆回多种真实结局——
 * 尤其 `partial`（部分结果）与 `unknown`（无 LDVH 结果头）不得被算成 completed，
 * 也不得在分布里消失。
 */
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
    // partial：分页截断被如实披露，不是失败、更不是拒绝
    pair('c3', 'ldvh_pitfall_list', 'LDVH pitfall-list-objects: partial\ngap: projection truncated at limit=1 of 74 matching objects'),
    // 无 LDVH 结果头 → statusOf 落 unknown（宿主直接拦下/工具未知）
    pair('c4', 'ldvh_research_session', 'Error: invalid arguments: missing required property "findings[5].statement"'),
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

/**
 * 分类表补类（2026-11-16）：原表只认 5 类，实测大部分未完成调用落进 `other`。
 * 本用例用每类的逐字代表文本钉住新增的五类都能被识别，`other` 不再吞掉它们。
 */
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

/**
 * 缓存新鲜度披露（2026-11-16 补）：TTL 由 5 分钟延长到 30 分钟，命中缓存必须
 * 带 `scope.cachedAt`（生成时刻），实时计算则不带——否则延长 TTL 会把旧数字
 * 呈现成此刻的实况。前端 scope 框据此显示「实时 / 命中缓存」。
 */
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

/**
 * 空目录预筛（2026-11-16 补）：实测 52.6% 的会话目录没有任何日志文件。本用例
 * 钉住「预筛只改调度、不改口径」——空目录仍计入 `sessionsScanned`，且不产生
 * 任何 outcomes；有日志的目录照常统计。
 *
 * 与既有「按体积预筛已放弃」的区别：那条会静默少统计（小会话也可能有调用），
 * 本处判的是「目录里是否存在日志文件」，不存在的目录本来就贡献 0 条调用。
 */
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

/**
 * 先粗筛再 parse（2026-11-16，P3）：实测 69% 的行不是工具事件，全量逐行
 * `JSON.parse` 是冷路径最大单项。本用例钉住「粗筛只改性能、不改口径」——
 * 无关行被跳过不丢统计、不同 `type` 写法仍命中、伪子串不产生假 outcome。
 */
test('目标事件行粗筛不改统计口径：无关行跳过、不同写法保留、伪子串不误判', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-diag-prescan-'));
  const workspaceRoot = path.join(home, 'project');
  const body = [
    // 大量无关事件行：粗筛应跳过它们，不进 JSON.parse
    eventLine({ type: 'session', version: 4, id: 'fixture' }),
    eventLine({ type: 'user', text: '一段与工具无关的用户文本' }),
    eventLine({ type: 'assistant', text: '另一段无关文本' }),
    eventLine({ type: 'message', content: [{ type: 'text', text: '…' }] }),
    // 伪子串：无关行里恰好含 tool/call 字面，粗筛会保留它 parse，但 event.type
    // 不是 'tool/call'/'tool/result'，不得产生任何 outcome。
    eventLine({ type: 'note', text: 'the tool/call surface is documented here' }),
    // 目标行 A：标准 eventLine 写法（JSON.stringify 无空格）
    eventLine({ type: 'tool/call', time: 1_700_000_000_000, data: { name: 'ldvh_spark_read', callId: 'c1' } }),
    eventLine({
      type: 'tool/result', time: 1_700_000_001_000,
      data: { toolCallId: 'c1', message: { content: [{ type: 'text', text: 'LDVH spark-read-object: completed\n' }] } },
    }),
    // 目标行 B：带空格的 type 写法（手工拼 JSON），粗筛按字面保留、parse 后照常命中。
    // 手工行须自带换行，否则 join('') 会把相邻两行粘成一条坏 JSON（本用例踩过）。
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
