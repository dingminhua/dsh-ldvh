// WorkCase 投影**保真**契约——对真实读入的载体断言「投影不丢失实际存在的字段」。
//
// 为什么需要这条不同的守卫：此前的 WorkCase 契约测试（workcase-design-language-
// contract / workcase-detail-current-contract）全部是**源码形态断言**——用正则断言
// 某个标识符出现在某个文件里。它们能拦「代码被改写成另一形态」，但拦不住
// 「投影在运行时把字段丢了」，因为后者不改变源码形态。于是下面这组缺陷在一路
// 绿灯（250/250）中存活下来了：
//
//   D1 `result.criteria_checks[].satisfied` 是**布尔**，投影却按 `typeof === 'string'`
//      判定 → 恒不命中 → closed 详情逐条核对全部显示「未记录」；
//   D2 `result.residual` 是**字符串数组**，同一误判 → 字段被丢弃 → 残留责任节点
//      整体不渲染（空数组与「未记录」不可区分）；
//   D3 `gate_1.approved_at` 被 js-yaml 解析为 **Date**（frontmatter 里的 ISO 时间戳
//      未加引号）→ 同样被字符串守卫丢弃 → 详情取不到批准时间；
//   D4 `attempt.started_at` 根本未被复制、`heartbeat_at` 被 Date 守卫拦下 →
//      open 详情执行现场残缺，而 heartbeat_at 正是 21 §10.4 判定孤立 attempt 的依据。
//
// 本文件因此不查源码文本，而是**跑真实管道**：用 `ldvh-base/workcases/` 中的对象
// 走「读取层 readLocalFact → 投影层 projectCurrentWorkCaseCard → 详情装配顺序」，
// 逐字段对照「源对象实际有什么」与「投影后还剩什么」。任何实际存在的字段在投影后
// 消失即失败，并报出确切字段路径。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readLocalFact, type LocalFactScope } from '../../api/services/localFactReader.ts';
import { projectCurrentWorkCaseCard } from '../../api/services/facts.ts';
import { toRfc3339Text } from '../../shared/timestamp.ts';

/** 仓库根（tests/api → web → plugin → repo）。 */
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..');
const WORKCASE_DIR = path.join(REPOSITORY_ROOT, 'ldvh-base', 'workcases');

function workcaseScope(): LocalFactScope {
  return { worktreeLocator: REPOSITORY_ROOT, governedProjectId: 'dsh-ldvh' };
}

/** 真实存在的 WorkCase 载体 id（目录为空时返回空数组，由断言显式报告）。 */
function existingWorkCaseIds(): string[] {
  if (!fs.existsSync(WORKCASE_DIR)) return [];
  return fs.readdirSync(WORKCASE_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''))
    .sort();
}

/**
 * 复刻 `showObject` 的详情装配顺序（api/services/facts.ts）：
 * `data = { ...fact_object }` 之后 `Object.assign(data, currentCard)`。
 * 投影对同一 key 的写入会**覆盖**源字段——这正是 D1/D2/D3 的生效路径，
 * 因此不能只比较 `projectCurrentWorkCaseCard` 的返回值，必须按真实装配比较。
 */
async function readAndAssemble(objectId: string) {
  const detail = await readLocalFact('workcase', objectId, workcaseScope());
  if (detail.status !== 'ok') return { detail, assembled: null, source: null };
  const source = detail.item.fact_object as Record<string, unknown>;
  const assembled: Record<string, unknown> = { ...source };
  Object.assign(assembled, projectCurrentWorkCaseCard(source, detail.item.source_content_fingerprint));
  return { detail, assembled, source };
}

/**
 * 源对象中实际存在、且在详情装配后消失的字段路径。
 *
 * 只检查**详情面实际消费**的嵌套字段（gate_1/attempt/result 及其子字段）——
 * 列表投影按载荷纪律有意不带 report_body 等大字段，那不是缺陷。
 */
function frozenFieldPaths(source: Record<string, unknown>, assembled: Record<string, unknown>): string[] {
  const frozen: string[] = [];
  const readNested = (key: string): Record<string, unknown> | null => {
    const value = source[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  };
  const assembledNested = (key: string): Record<string, unknown> | null => {
    const value = assembled[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  };

  for (const objectKey of ['gate_1', 'attempt', 'result'] as const) {
    const from = readNested(objectKey);
    if (!from) continue;
    const to = assembledNested(objectKey) ?? {};
    for (const field of Object.keys(from)) {
      if (!(field in to)) frozen.push(`${objectKey}.${field}`);
    }
  }

  // criteria_checks 是数组，逐条核对 satisfied 是否存活（D1 的实际生效点）。
  const sourceChecks = (readNested('result')?.criteria_checks ?? []) as unknown;
  const placedChecks = (assembledNested('result')?.criteria_checks ?? []) as unknown;
  if (Array.isArray(sourceChecks)) {
    const placed = Array.isArray(placedChecks) ? placedChecks : [];
    sourceChecks.forEach((check, index) => {
      if (!check || typeof check !== 'object' || Array.isArray(check)) return;
      const record = check as Record<string, unknown>;
      const placedRecord = (placed[index] ?? {}) as Record<string, unknown>;
      for (const field of Object.keys(record)) {
        if (!(field in placedRecord)) frozen.push(`result.criteria_checks[${index}].${field}`);
      }
    });
  }
  return frozen;
}

test('真实 WorkCase 载体存在（保真断言的前提）', () => {
  assert.ok(
    existingWorkCaseIds().length > 0,
    `未找到任何 WorkCase 载体：${WORKCASE_DIR}——保真断言需要至少一个真实对象`,
  );
});

test('投影不丢失任何实际存在的 WorkCase 字段（D1–D4 的运行时守卫）', async () => {
  const ids = existingWorkCaseIds();
  const failures: string[] = [];
  const checked: string[] = [];

  for (const objectId of ids) {
    const { detail, assembled, source } = await readAndAssemble(objectId);
    if (detail.status !== 'ok' || !assembled || !source) {
      failures.push(`${objectId}: 读取失败（status=${detail.status}）——保真断言不能跳过真实对象`);
      continue;
    }
    const frozen = frozenFieldPaths(source, assembled);
    if (frozen.length > 0) failures.push(`${objectId} [${String(source.status)}]: ${frozen.join(', ')}`);
    checked.push(objectId);
  }

  assert.deepEqual(
    failures,
    [],
    `以下 WorkCase 字段在投影后消失（投影守卫按错误类型判定会静默丢弃合规字段）：\n${failures.join('\n')}`,
  );
  assert.equal(checked.length, ids.length, '全部真实对象都必须被实际核对，不得跳过');
});

test('result.criteria_checks[].satisfied 以布尔存活，未被字符串守卫丢弃', async () => {
  const ids = existingWorkCaseIds();
  let asserted = 0;

  for (const objectId of ids) {
    const { detail, assembled, source } = await readAndAssemble(objectId);
    if (detail.status !== 'ok' || !assembled || !source) continue;
    const sourceResult = source.result as Record<string, unknown> | undefined;
    const checks = sourceResult?.criteria_checks;
    if (!Array.isArray(checks)) continue;

    const placed = (assembled.result as Record<string, unknown> | undefined)?.criteria_checks;
    assert.ok(Array.isArray(placed), `${objectId}: criteria_checks 必须在投影后仍是数组`);
    checks.forEach((check, index) => {
      if (!check || typeof check !== 'object' || Array.isArray(check)) return;
      const record = check as Record<string, unknown>;
      if (!('satisfied' in record)) return;
      // 21 §9.3：satisfied 是布尔判定。
      assert.equal(
        typeof record.satisfied,
        'boolean',
        `${objectId}: criteria_checks[${index}].satisfied 的来源值应是布尔（21 §9.3）`,
      );
      const placedCheck = (placed as Array<Record<string, unknown>>)[index];
      assert.ok(
        placedCheck && 'satisfied' in placedCheck,
        `${objectId}: criteria_checks[${index}].satisfied 在投影后丢失——详情会退化为「未记录」`,
      );
      assert.equal(
        placedCheck.satisfied,
        record.satisfied,
        `${objectId}: criteria_checks[${index}].satisfied 值必须逐字保留`,
      );
      asserted += 1;
    });
  }

  assert.ok(asserted > 0, '至少应有一个真实对象的 criteria_checks 带 satisfied，本断言才有判别力');
});

test('result.residual 以字符串数组存活，空数组不塌缩为缺失', async () => {
  const ids = existingWorkCaseIds();
  let asserted = 0;

  for (const objectId of ids) {
    const { detail, assembled, source } = await readAndAssemble(objectId);
    if (detail.status !== 'ok' || !assembled || !source) continue;
    const sourceResult = source.result as Record<string, unknown> | undefined;
    if (!sourceResult || !('residual' in sourceResult)) continue;

    const placed = (assembled.result as Record<string, unknown> | undefined);
    assert.ok(
      placed && 'residual' in placed,
      `${objectId}: result.residual 在投影后丢失——残留责任节点会整体不渲染`,
    );
    // 21 §8/§9.3：residual 是字符串数组；`completed` 时可为空数组，
    // 空数组表示「无残留」，与「未记录」必须可区分。
    assert.ok(Array.isArray(placed.residual), `${objectId}: result.residual 必须是数组`);
    assert.deepEqual(
      placed.residual,
      sourceResult.residual,
      `${objectId}: result.residual 内容必须逐字保留（含空数组形态）`,
    );
    asserted += 1;
  }

  assert.ok(asserted > 0, '至少应有一个真实对象带 result.residual，本断言才有判别力');
});

test('时间字段在投影后是 RFC 3339 文本，Date 实例不被 string 守卫拦下', async () => {
  const ids = existingWorkCaseIds();
  let asserted = 0;

  for (const objectId of ids) {
    const { detail, assembled, source } = await readAndAssemble(objectId);
    if (detail.status !== 'ok' || !assembled || !source) continue;

    const expectations: Array<[string, Record<string, unknown> | null, Record<string, unknown> | null]> = [
      ['gate_1.approved_at', source.gate_1 as Record<string, unknown> | null, assembled.gate_1 as Record<string, unknown> | null],
      ['attempt.started_at', source.attempt as Record<string, unknown> | null, assembled.attempt as Record<string, unknown> | null],
      ['attempt.heartbeat_at', source.attempt as Record<string, unknown> | null, assembled.attempt as Record<string, unknown> | null],
    ];

    for (const [label, from, to] of expectations) {
      const field = label.split('.')[1];
      if (!from || !(field in from)) continue;
      assert.ok(
        to && field in to,
        `${objectId}: ${label} 在投影后丢失——详情执行现场/授权时间会残缺`,
      );
      const placed = to[field];
      assert.equal(
        typeof placed,
        'string',
        `${objectId}: ${label} 投影后必须是 RFC 3339 文本（源可能是 Date 实例）`,
      );
      // 归一后的文本必须是合法 RFC 3339，且与来源表示同一时刻。
      assert.equal(
        placed,
        toRfc3339Text(from[field]),
        `${objectId}: ${label} 必须经 toRfc3339Text 归一，且与来源同刻`,
      );
      asserted += 1;
    }
  }

  assert.ok(asserted > 0, '至少应有一个真实对象的授权/执行时间字段，本断言才有判别力');
});

test('投影按真实类型判定，不放宽字段闭集——类型不符者仍被如实丢弃', () => {
  // 负向控制：satisfied 不是布尔（例如被误写成字符串）时不得进入投影——
  // 修复 D1 只应把「布尔」这一真实类型放回来，不得顺手把任意值都放行。
  const projected = projectCurrentWorkCaseCard({
    status: 'closed',
    outcome: 'completed',
    result: {
      criteria_checks: [{ satisfied: 'true', evidence: 'x' }],
      residual: ['不是数组元素形态的字符串也保留', 42, null],
    },
  }, 'b'.repeat(64)) as Record<string, unknown>;

  const checks = (projected.result as Record<string, unknown>).criteria_checks as Array<Record<string, unknown>>;
  assert.equal(
    'satisfied' in checks[0],
    false,
    '字符串形态的 satisfied 不是 21 §9.3 的布尔判定，必须如实丢弃而非放行',
  );
  // residual 只保留字符串成员——非字符串成员不入投影。
  assert.deepEqual(
    (projected.result as Record<string, unknown>).residual,
    ['不是数组元素形态的字符串也保留'],
    'residual 必须只保留字符串成员，不把任意值等同为合规',
  );
});
