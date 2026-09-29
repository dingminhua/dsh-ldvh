// `gate_1.amendments`（增量授权流水）的投影契约（21 §8/§14；10 §5.5）。
//
// 为什么单列一个用例：2026-09-30 之前，投影白名单 `projectWorkCaseGate1` 只列
// gate_1 的四个字段，`amendments` 被**静默丢弃**——writer 侧已能按「末项无 decision」
// 判出「待批」，呈现层却收不到任何数据（画了也没有源）。本用例用**临时事实源**钉住：
// ① 该字段确实穿透投影；② 逐条保留 items/rationale/decision；
// ③ 两个时间字段（请求的 `requested_at`、决定的 `decision.at`）被归一到 RFC 3339 文本
//    （js-yaml 会把未加引号的 ISO 时间戳解析成 `Date`，不归一就会在运行期出现非文本值）。
//
// 用临时事实源而非 `ldvh-base/`：后者当前**没有任何对象携带 amendments**（实测 0），
// 对真实源的断言会是空转。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { showObject } from '../../api/services/facts.ts';
import type { LocalFactScope } from '../../api/services/localFactReader.ts';

const UID = '63700bd2-f688-464b-b490-fc0c6ed78f25';

function workcaseCarrier(): string {
  // 注意：`requested_at` 与 `decision.at` **不加引号**——这样才能验证归一（yaml → Date → RFC3339）。
  return [
    '---',
    'fact_type_key: workcase',
    `object_uid: ${UID}`,
    'title: 增量审批投影用例',
    'status: open',
    'serves: SG-3',
    'gist: 用例。',
    'summary: |-',
    '  用例摘要。',
    'scope: |',
    '  做什么：',
    '  - 用例',
    '',
    '  明确不做什么：',
    '  - 不动实现',
    'plan:',
    '  - step: 第一步',
    '    done_criteria: 有证据',
    'gate_1:',
    '  approved_at: 2026-09-30T01:00:00.000Z',
    '  approver: Human',
    '  authorization_fingerprint: ' + 'a'.repeat(64),
    '  scope_snapshot: |',
    '    做什么：',
    '    - 用例',
    '  amendments:',
    '    - requested_at: 2026-09-30T02:00:00.000Z',
    '      items:',
    '        - step: 追加一步',
    '          done_criteria: 有证据 2',
    '      rationale: 不做它，第一步判据达不成',
    '      decision:',
    '        kind: approved',
    '        by: Human',
    '        at: 2026-09-30T02:30:00.000Z',
    '        resulting_fingerprint: ' + 'b'.repeat(64),
    '        session_id: session-decider-fixture',
    '        session_source: host',
    '    - requested_at: 2026-09-30T03:00:00.000Z',
    '      items:',
    '        - step: 待批的一步',
    '          done_criteria: 有证据 3',
    '      rationale: 待批中',
    'created_at: 2026-09-30T00:00:00.000Z',
    'change_log:',
    '  - at: 2026-09-30T00:00:00.000Z',
    '    summary: fixture',
    '---',
    '',
    `# 增量审批投影用例`,
    '',
    '## 摘要',
    '',
    '用例摘要。',
    '',
    '## 授权范围',
    '',
    '做什么：',
    '- 用例',
    '',
    '明确不做什么：',
    '- 不动实现',
    '',
    '## 计划',
    '',
    '- 第一步：判据——有证据',
    '',
    '## 执行',
    '',
    '- 用例。',
    '',
  ].join('\n');
}

test('gate_1.amendments 穿透投影：逐条保留 items/rationale/decision，时间归一为 RFC3339 文本', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-amendments-proj-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  const directory = path.join(root, 'ldvh-base', 'workcases');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, `workcase-${UID}.md`), workcaseCarrier(), 'utf8');
    const result = await showObject(`workcase-${UID}`, scope);
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 400));
    const gate1 = (result as { data: Record<string, unknown> }).data.gate_1 as Record<string, unknown>;
    assert.ok(gate1, 'gate_1 必须被投影');

    const amendments = gate1.amendments as Record<string, unknown>[];
    assert.ok(Array.isArray(amendments), 'amendments 必须穿透投影（此前被白名单静默丢弃）');
    assert.equal(amendments.length, 2);

    // ① 已决定的那条：字段齐 + 时间归一
    const decided = amendments[0];
    assert.equal(decided.requested_at, '2026-09-30T02:00:00.000Z', '请求时间须为 RFC3339 文本（非 Date 对象）');
    assert.equal(typeof decided.requested_at, 'string');
    assert.equal(decided.rationale, '不做它，第一步判据达不成');
    const items = decided.items as Record<string, unknown>[];
    assert.equal(items.length, 1);
    assert.equal(items[0].step, '追加一步');
    assert.equal(items[0].done_criteria, '有证据 2');
    const decision = decided.decision as Record<string, unknown>;
    assert.equal(decision.kind, 'approved');
    assert.equal(decision.by, 'Human');
    assert.equal(decision.at, '2026-09-30T02:30:00.000Z', '决定时间须为 RFC3339 文本');
    assert.equal(decision.session_id, 'session-decider-fixture', '决定者会话身份须可回读（by 是自报）');
    assert.equal(decision.session_source, 'host');

    // ② 待批的那条：末项无 decision —— 呈现层判「待批」的依据（10 §5.5）
    const pending = amendments[1];
    assert.equal(pending.requested_at, '2026-09-30T03:00:00.000Z');
    assert.equal(pending.decision, undefined, '待批 = 末项无 decision（判据即此）');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
