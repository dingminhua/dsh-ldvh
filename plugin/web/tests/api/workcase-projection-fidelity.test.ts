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

test('attempt.session_id 在投影后存活——关闭侧独立性比对的基准必须可回读（D5）', async () => {
  const ids = existingWorkCaseIds();
  let asserted = 0;

  for (const objectId of ids) {
    const { detail, assembled, source } = await readAndAssemble(objectId);
    if (detail.status !== 'ok' || !assembled || !source) continue;
    const sourceAttempt = source.attempt as Record<string, unknown> | undefined;
    if (!sourceAttempt || !('session_id' in sourceAttempt)) continue;

    const placedAttempt = assembled.attempt as Record<string, unknown> | undefined;
    assert.ok(
      placedAttempt && 'session_id' in placedAttempt,
      `${objectId}: attempt.session_id 在投影后丢失——21 §14 关闭前置条件二以它为独立性比对基准，`
        + 'Human 在详情面将只能读到结论而看不到依据',
    );
    assert.equal(
      placedAttempt.session_id,
      sourceAttempt.session_id,
      `${objectId}: attempt.session_id 必须逐字保留（它是身份基准，不得改写或归一）`,
    );
    // provenance 同样由 Code 托管；来源有则必须一并搬运（缺席即缺席，不得补默认值）。
    if ('session_source' in sourceAttempt) {
      assert.equal(
        placedAttempt.session_source,
        sourceAttempt.session_source,
        `${objectId}: attempt.session_source 有值时必须搬运——它是「该身份是否可采信」的判据`,
      );
    }
    asserted += 1;
  }

  assert.ok(asserted > 0, '至少应有一个真实对象的 attempt 带 session_id，本断言才有判别力');
});

test('attempt 投影覆盖 21 §8 登记的全部字段——白名单与字段登记不得分叉', () => {
  // 这条守卫针对 D5 的**根因**：投影的白名单与 21 §8 的 `attempt` 字段登记是
  // 两处权威。2be11478 新增 session_id 时后者更新、前者未同步，字段被静默丢弃，
  // 而当时没有守卫能发现「白名单落后于登记」——运行时保真守卫当时只对真实载体
  // 断言，恰好那个载体是 open 且带该字段才暴露；若换成一个不带该字段的载体集，
  // 缺陷会继续潜伏。
  //
  // 故此处直接对**登记集**断言：21 §8 的 `attempt` 行登记了哪几个字段，投影就
  // 必须搬运哪几个（Date 归一的 started_at/heartbeat_at 以输出名比对）。新增字段
  // 若忘了同步白名单，本用例立即失败并点名缺失字段。
  const REGISTERED = [
    'attempt_id',       // 21 §8 attempt 令牌
    'started_at',       // 同上（Date → RFC 3339 文本）
    'controller',       // 当次主控执行者标识
    'heartbeat_at',     // 21 §10.4 判定孤立 attempt 的依据（Date → RFC 3339 文本）
    'session_id',       // 21 §14 关闭前置条件二的身份基准
    'session_source',   // 同一身份的可采信来源（host / shell）
  ];

  const projected = projectCurrentWorkCaseCard({
    status: 'open',
    attempt: {
      attempt_id: '7', controller: 'c', started_at: '2026-01-01T00:00:00+08:00',
      heartbeat_at: '2026-01-01T00:00:00+08:00', session_id: 'session-x', session_source: 'host',
    },
  }, 'c'.repeat(64)) as Record<string, unknown>;

  const attempt = projected.attempt as Record<string, unknown> | undefined;
  assert.ok(attempt, 'open 状态必须投影 attempt（21 §9.1）');
  const missing = REGISTERED.filter((field) => !(field in attempt));
  assert.deepEqual(
    missing,
    [],
    `以下 21 §8 登记的 attempt 字段未进入投影（白名单落后于字段登记）：${missing.join(', ')}`,
  );
});

test('attempt 身份缺席时不得补默认值——「无身份」不等于「有身份」', () => {
  // 21 §14：身份不可得不得解释为独立（未知 ≠ 独立）。投影若给 session_id 补一个
  // 空串或占位，下游会把「无身份」误读为「有一个可比对的身份」。
  const projected = projectCurrentWorkCaseCard({
    status: 'open',
    attempt: { attempt_id: '7', controller: 'c', started_at: '2026-01-01T00:00:00+08:00', heartbeat_at: '2026-01-01T00:00:00+08:00' },
  }, 'd'.repeat(64)) as Record<string, unknown>;

  const attempt = projected.attempt as Record<string, unknown>;
  assert.equal('session_id' in attempt, false, '来源无 session_id 时投影不得凭空补上');
  assert.equal('session_source' in attempt, false, '来源无 session_source 时投影不得补默认 host');
});

// 10 §5.5「执行期阶段」新增输入：卡片侧四阶段判定需要 `reviews`，而它此前不在
// 卡片投影的字段集内（恒复制清单只含 change_log）。缺它则「复核中/修订中/结项中」
// 三者恒不可判，卡片会一律显示「执行中」——正是本文件所守的「投影静默丢字段」形态。
test('open 对象的 reviews 必须完整投影（阶段判定的输入，10 §5.5）', async () => {
  const ids = existingWorkCaseIds();
  const checked: string[] = [];
  for (const objectId of ids) {
    const detail = await readLocalFact('workcase', objectId, workcaseScope());
    if (detail.status !== 'ok') continue;
    const source = detail.item.fact_object as Record<string, unknown>;
    if (source.status !== 'open') continue;
    const reviews = source.reviews;
    if (!Array.isArray(reviews) || reviews.length === 0) continue;
    const assembled: Record<string, unknown> = {};
    Object.assign(assembled, projectCurrentWorkCaseCard(source, detail.item.source_content_fingerprint));
    const placed = assembled.reviews;
    assert.ok(
      Array.isArray(placed),
      `${objectId}: reviews 在投影后消失——阶段判定将恒判为「执行中」（10 §5.5）`,
    );
    assert.equal(placed.length, reviews.length, `${objectId}: reviews 条数不得因投影而改变`);
    checked.push(objectId);
  }
  assert.ok(
    checked.length > 0,
    '必须至少核对一个带 reviews 的 open 对象，否则本守卫是空转',
  );
});

// 「待批准关闭」的核对与建议：`21 §8` 的 result 字段出现 ⇔ status=closed，故该期的
// 数据只在正文「## 结果」节；投影层必须把它解析并送达卡片（10 §5.5）。缺这一步时
// 卡片只能显示计划清单——正是本改动要替换掉的东西。
test('待批准关闭：核对与建议必须投影到位（10 §5.5）', async () => {
  const ids = existingWorkCaseIds();
  const checked: string[] = [];
  for (const objectId of ids) {
    const detail = await readLocalFact('workcase', objectId, workcaseScope());
    if (detail.status !== 'ok') continue;
    const source = detail.item.fact_object as Record<string, unknown>;
    if (source.status !== 'open') continue;
    const plan = Array.isArray(source.plan) ? source.plan : [];
    const projected = projectCurrentWorkCaseCard(source, detail.item.source_content_fingerprint);
    if (!Array.isArray(projected.result_checks) || projected.result_checks.length === 0) continue;
    assert.equal(
      projected.result_checks.length,
      plan.length,
      `${objectId}: 核对条数须与 plan 步数一致（逐条对应，21 §8）`,
    );
    for (const check of projected.result_checks as Record<string, unknown>[]) {
      assert.ok(
        typeof check.planIndex === 'number' && check.planIndex >= 0 && check.planIndex < plan.length,
        `${objectId}: planIndex 必须落在 plan 范围内`,
      );
    }
    checked.push(objectId);
  }
  assert.ok(checked.length > 0, '必须至少核对一个「待批准关闭」对象，否则本守卫是空转');
});

// 「已关闭」的卡体（10 §5.5，Human 2026-09-24 方案 A）：结论行 + 逐条核对（**只给
// 步骤标题**）+ 残留块。判据文本只能由 `plan[i].step` 给出——`21 §8` 的
// `result.criteria_checks[]` 只有 `{satisfied, evidence}`，不含判据文本。故 closed
// 期投影**必须包含 `plan`**：此前该分支不投影 `plan`，卡上因此无法显示步骤标题，
// 只能退化成显示「已满足 · <整段证据>」（实测最长 258 字，撑破扫读窗口）。
test('已关闭：投影必须带上 plan（卡面显示步骤标题的唯一来源，10 §5.5）', async () => {
  const ids = existingWorkCaseIds();
  const checked: string[] = [];
  for (const objectId of ids) {
    const detail = await readLocalFact('workcase', objectId, workcaseScope());
    if (detail.status !== 'ok') continue;
    const source = detail.item.fact_object as Record<string, unknown>;
    if (source.status !== 'closed') continue;
    const sourcePlan = Array.isArray(source.plan) ? source.plan : [];
    const projected = projectCurrentWorkCaseCard(source, detail.item.source_content_fingerprint);
    const placedPlan = projected.plan;
    assert.ok(
      Array.isArray(placedPlan),
      `${objectId}: closed 投影丢失 plan——卡面将拿不到步骤标题（10 §5.5）`,
    );
    assert.equal(placedPlan.length, sourcePlan.length, `${objectId}: plan 步数不得因投影而改变`);
    const checks = (projected.result as Record<string, unknown> | undefined)?.criteria_checks;
    if (Array.isArray(checks)) {
      assert.equal(
        checks.length,
        sourcePlan.length,
        `${objectId}: 核对条数须与 plan 步数一致（逐条对应，21 §8）——否则卡面标题会错位`,
      );
    }
    checked.push(objectId);
  }
  assert.ok(checked.length > 0, '必须至少核对一个 closed 对象，否则本守卫是空转');
});

// 结论行与残留块的三个数据源必须**逐份到位**：结论行要数达成条数与残留条数，
// 残留块要逐条原文。缺任一项时卡片只能显示部分内容，而「无残留」与「未记录残留」
// 必须可区分（21 §9.3：completed 时 residual 可为空数组）。
test('已关闭：结论行与残留块的数据源必须投影到位（10 §5.5）', async () => {
  const ids = existingWorkCaseIds();
  const checked: string[] = [];
  let sawEmptyResidual = false;
  for (const objectId of ids) {
    const detail = await readLocalFact('workcase', objectId, workcaseScope());
    if (detail.status !== 'ok') continue;
    const source = detail.item.fact_object as Record<string, unknown>;
    if (source.status !== 'closed') continue;
    const sourceResult = source.result as Record<string, unknown> | undefined;
    if (!sourceResult) continue;
    const projected = projectCurrentWorkCaseCard(source, detail.item.source_content_fingerprint);
    const placed = projected.result as Record<string, unknown> | undefined;
    assert.ok(placed, `${objectId}: closed 投影丢失 result——结论行与残留块都没有数据源`);

    // outcome：结论行的第一个元素。
    assert.equal(placed.outcome ?? projected.outcome, source.outcome, `${objectId}: outcome 必须投影到位`);

    // criteria_checks：结论行的计数来源 + 逐条核对的标题配对。
    const sourceChecks = Array.isArray(sourceResult.criteria_checks) ? sourceResult.criteria_checks : [];
    const placedChecks = Array.isArray(placed.criteria_checks) ? placed.criteria_checks : [];
    assert.equal(placedChecks.length, sourceChecks.length, `${objectId}: criteria_checks 条数不得丢失`);
    for (let i = 0; i < sourceChecks.length; i += 1) {
      const src = sourceChecks[i] as Record<string, unknown>;
      const out = placedChecks[i] as Record<string, unknown>;
      assert.equal(
        typeof out.satisfied,
        'boolean',
        `${objectId}: criteria_checks[${i}].satisfied 必须是布尔（21 §9.3）——非布尔会被卡面判成「未记录」`,
      );
      assert.equal(out.satisfied, src.satisfied, `${objectId}: criteria_checks[${i}].satisfied 值不得改变`);
    }

    // residual：残留块的原文。**空数组与缺失必须可区分**。
    const sourceResidual = Array.isArray(sourceResult.residual) ? sourceResult.residual : null;
    if (sourceResidual !== null) {
      const placedResidual = placed.residual;
      assert.ok(
        Array.isArray(placedResidual),
        `${objectId}: residual 存在却未投影——残留块无数据（10 §5.5）`,
      );
      assert.equal(placedResidual.length, sourceResidual.length, `${objectId}: residual 条数不得丢失`);
      assert.deepEqual(placedResidual, sourceResidual, `${objectId}: residual 原文必须逐字保留`);
      if (sourceResidual.length === 0) sawEmptyResidual = true;
    }
    checked.push(objectId);
  }
  assert.ok(checked.length > 0, '必须至少核对一个 closed 对象，否则本守卫是空转');
  // 「无残留」与「未记录残留」的区分能力：至少一份对象的 residual 是空数组，
  // 否则本守卫没有覆盖「无残留」这一支（21 §9.3）。
  assert.ok(sawEmptyResidual, '必须至少覆盖一份 residual 为空数组的 closed 对象（「无残留」支）');
});

// 「已关闭」的取消记录（10 §5.5 / 21 §8）：`outcome = cancelled` 时，取消理由与
// 「未发生的范围」写在正文「## 结果」节的 `- cancellation:` 段，投影层必须解析并送达
// 卡片。缺这一步时卡面只能整段不显示——正是本改动要消除的（此前这两件事被塞进
// `achieved_scope`，呈现层取不到）。
test('已关闭：cancelled 对象的取消记录必须投影到位（21 §8）', async () => {
  const ids = existingWorkCaseIds();
  const checked: string[] = [];
  for (const objectId of ids) {
    const detail = await readLocalFact('workcase', objectId, workcaseScope());
    if (detail.status !== 'ok') continue;
    const source = detail.item.fact_object as Record<string, unknown>;
    if (source.status !== 'closed' || source.outcome !== 'cancelled') continue;
    const projected = projectCurrentWorkCaseCard(source, detail.item.source_content_fingerprint);
    const cancellation = projected.cancellation as Record<string, unknown> | undefined;
    assert.ok(
      cancellation,
      `${objectId}: cancelled 对象未投影取消记录——卡面将无「取消理由」可显示（21 §8）`,
    );
    // 两行均非空（§15.1 取消记录完备性）：这是投影后的可呈现前提。
    assert.ok(
      typeof cancellation.reason === 'string' && cancellation.reason.trim().length > 0,
      `${objectId}: 取消记录的「理由」为空`,
    );
    assert.ok(
      typeof cancellation.unstartedScope === 'string' && cancellation.unstartedScope.trim().length > 0,
      `${objectId}: 取消记录的「未发生的范围」为空`,
    );
    checked.push(objectId);
  }
  assert.ok(checked.length > 0, '必须至少核对一个 cancelled 对象，否则本守卫是空转');
});
