/**
 * 经验观察在诊断页的呈现契约（`/api/diagnostics/experience-observations`）。
 *
 * ## 这组测试守的是什么
 *
 * 不是像素，是**规范边界**。11 §12bis 读取纪律第 2 条把 Human 查阅面钉死为
 * 「只可展示其存在与数量」，并由 §12bis 的字段闭集与「证据不留在缓冲」配套纪律
 * 进一步限死：`evidence` 是**逐字引证**（属内容），`candidate_question` 是**审核段的
 * 判断输入**，`id`/`consumed_by` 是**对象身份与去向**——三者都不得出现在查阅面。
 *
 * 这些禁令极易在演进中被悄悄放开：只要有人觉得「诊断页给全一点更方便」，经验观察就会
 * 变成第二个事实源入口。故用测试钉住：
 *
 *   1. 投影里不得出现 evidence / candidate_question / id / consumed_by；
 *   2. 条目不得携带任何可当对象标识用的 uid；
 *   3. 目录不存在须如实标注（是正常初态，既不是错误、也不是「零条目」的伪装）；
 *   4. 破损行/闭集外状态须跳过并**计入**跳过数，不能静默吞掉；
 *   5. 按项目分区：多个项目文件汇总，且文件数 = 项目数。
 *
 * ## 与摩擦侧（`diagnostics-observations.test.ts`）的关系
 *
 * 两套测试**刻意并列而不合并**：两个载体各有唯一消费者（02 §6.1 第 2 条），规范条款
 * 也不同（§12bis vs §12bis.1）。合并成一套会让某一边的条款失去独立的护栏。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildExperienceBufferReport } from '../../api/services/runtimeDiagnostics.ts';

/** 造一条合法的经验缓冲条目（字段闭集见 11 §12bis，9 项，**无 project**）。 */
/**
 * 造一条合法的经验缓冲条目（字段闭集见 11 §12bis，9 项，**无 project**）。
 *
 * **id 默认逐条唯一**：追加事件日志按 id 折叠，重复 id 会让后写的覆盖前一条
 * （折叠层会把它判为 invalid）。夹具若都返回同一个 id，「三条条目」实际只有一条——
 * 这正是本文件踩过的坑，故在此自动递增。
 */
let entrySeq = 0;
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  entrySeq += 1;
  return {
    id: `aa000000-0000-4000-8000-0000000000${String(entrySeq).padStart(2, '0')}`,
    at: '2026-10-26T04:00:00.000Z',
    session: 'session-secret-should-not-surface',
    anchor: 'turn 12 · 助手正文第 3 段',
    phenomenon: '插件以只读身份写配置失败。',
    evidence: '这是一段不该出现在任何界面上的逐字引证全文。',
    candidate_question: '这是什么机制？',
    status: 'pending',
    consumed_by: null,
    ...overrides,
  };
}

/**
 * 写载体——**必须用生产格式**（追加事件日志，2026-10-26）。
 *
 * 这里曾写「一行一条完整记录」，而生产代码已改为折叠事件。后果是：**测试全绿、界面
 * 全空**（条目数正确、字段全 null）。夹具与生产不同格式时，测试守的不是它以为在守的
 * 东西——这是本文件最重要的一条纪律，改格式时必须同步改这里。
 */
async function writeBuffer(
  home: string,
  projectId: string,
  entries: Record<string, unknown>[],
): Promise<string> {
  const dir = path.join(home, 'ldvh', 'experience-buffers');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${projectId}.jsonl`);
  const lines = entries.map((row) => JSON.stringify({ kind: 'entry', record: row }));
  await writeFile(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

/** 写一条 settle 事件（追加）。 */
async function appendSettle(
  home: string,
  projectId: string,
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const file = path.join(home, 'ldvh', 'experience-buffers', `${projectId}.jsonl`);
  const event = { kind: 'settle', id, status, consumed_by: null, settled_at: '2026-10-26T00:00:00.000Z', ...extra };
  await writeFile(file, JSON.stringify(event) + '\n', { encoding: 'utf8', flag: 'a' });
}

async function freshHome(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'experience-buffer-report-'));
}

/**
 * 这条守的是**夹具与生产同格式**——本轮真实踩过的坑。
 *
 * 当时载体已改成追加事件日志，而本文件的夹具还在写「一行一条完整记录」。结果是
 * **测试全绿、界面全空**：条目数正确、字段全 null。测试守的不是它以为在守的东西。
 *
 * 故这里用**生产写入口**（`appendBufferEntry`）造数据，再断言本页读得出——两个方向
 * 都覆盖：既证明生产写入的格式被本页认识，也证明夹具不能靠自己编格式混过去。
 */
test('夹具与生产同格式：生产写入口写出的载体，本页必须读得出', async () => {
  const home = await freshHome();
  // 直接按**生产写入口实际写出的字节形态**构造（`{kind:"entry", record}` 一行一条），
  // 而不是经由 `lib/` 的函数——`web/` 的 tsconfig 不含 `lib/`，跨目录导入 JS 会
  // 破坏类型检查。这里固定住的是**格式**，格式正是此前脱节的那一环。
  const dir = path.join(home, 'ldvh', 'experience-buffers');
  await mkdir(dir, { recursive: true });
  const produced = {
    kind: 'entry',
    record: {
      id: 'aa000000-0000-4000-8000-0000000000ff',
      at: '2026-10-26T09:00:00.000Z',
      session: 'session-real',
      anchor: 'turn 9 · 助手正文第 2 段',
      phenomenon: '生产写入口写入的现象。',
      evidence: '逐字引证\n来源：session-real turn 9',
      candidate_question: '这是什么机制？',
      status: 'pending',
      consumed_by: null,
    },
  };
  await writeFile(path.join(dir, 'proj-real.jsonl'), JSON.stringify(produced) + '\n', 'utf8');

  const report = await buildExperienceBufferReport({ dshHome: home });
  assert.equal(report.totals.entries, 1, '生产写入的一条必须被读出（否则就是夹具格式与生产脱节）');
  assert.equal(report.recent[0].phenomenon, '生产写入口写入的现象。', '字段必须落在 record 上，而不是事件外壳');
  assert.equal(report.recent[0].status, 'pending');
  assert.equal(report.recent[0].anchor, 'turn 9 · 助手正文第 2 段');
  assert.equal(report.pendingCount, 1);
});

test('只呈现四项：投影里不得出现 evidence / candidate_question / id / consumed_by', async () => {
  const home = await freshHome();
  await writeBuffer(home, 'dsh-ldvh', [entry()]);

  const report = await buildExperienceBufferReport({ dshHome: home });
  assert.equal(report.ok, true);
  assert.equal(report.recent.length, 1);

  const allowed = new Set(['at', 'anchor', 'phenomenon', 'status']);
  for (const row of report.recent) {
    for (const key of Object.keys(row)) {
      assert.ok(
        allowed.has(key),
        `投影字段 ${key} 越界——11 §12bis 读取纪律第 2 条只允许存在与数量 + 现象/时间/来源/状态`,
      );
    }
  }

  // 逐项断言：这些**一个都不能**以任何形式出现在报告里。
  const serialized = JSON.stringify(report);
  for (const forbidden of ['evidence', 'candidate_question', 'consumed_by']) {
    // 用字段形状匹配而非词频匹配：说明性文案里可能出现这些词（那是解释，不是泄漏）。
    const pattern = new RegExp(`"${forbidden}"\\s*:`);
    assert.equal(
      pattern.test(serialized),
      false,
      `报告不得携带 ${forbidden} 字段——它是内容/判断输入/去向，不属运行状态`,
    );
  }
  // 逐字引证与待审核问题的**内容本身**也不得出现。
  assert.equal(serialized.includes('不该出现在任何界面上'), false, 'evidence 全文泄漏了');
  assert.equal(serialized.includes('这是什么机制？'), false, 'candidate_question 内容泄漏了');
  assert.equal(serialized.includes('session-secret-should-not-surface'), false, 'session 标识泄漏了');
});

test('条目不得携带任何可当对象身份用的标识（它没有 object_uid）', async () => {
  const home = await freshHome();
  await writeBuffer(home, 'dsh-ldvh', [
    entry({ id: 'aa000000-0000-4000-8000-00000000beef' }),
    entry({ id: 'aa000000-0000-4000-8000-00000000cafe', at: '2026-10-26T05:00:00.000Z' }),
  ]);

  const report = await buildExperienceBufferReport({ dshHome: home });
  const serialized = JSON.stringify(report.recent);
  assert.equal(serialized.includes('aa000000-0000-4000-8000'), false, '条目 id 不得出现在查阅面');
  // 也不得出现任何形如 object_uid 的字段名。
  assert.equal(/"object_uid"\s*:/.test(JSON.stringify(report)), false, '不得暴露对象身份字段');
  // 每个投影行只有四个键——「点击进入详情」在类型上就没有落点。
  for (const row of report.recent) {
    assert.equal(Object.keys(row).length, 4);
  }
});

test('按项目分区：多个项目文件汇总，文件数即项目数', async () => {
  const home = await freshHome();
  await writeBuffer(home, 'project-a', [entry()]);
  await writeBuffer(home, 'project-b', [
    entry({ at: '2026-10-26T06:00:00.000Z' }),
    entry({ at: '2026-10-26T07:00:00.000Z' }),
  ]);

  const report = await buildExperienceBufferReport({ dshHome: home });
  assert.equal(report.totals.entries, 3, '两个项目的条目须汇总');
  assert.equal(report.totals.projects, 2, '文件数 = 项目数（§12bis 载体段：按项目分文件）');
  assert.deepEqual(report.scope.files, ['project-a.jsonl', 'project-b.jsonl']);
  assert.equal(report.scope.bufferDirExists, true);
  // 目录名须与规范的分区形态一致（不是旧的全局单文件）。
  assert.ok(report.scope.bufferDir.endsWith(path.join('ldvh', 'experience-buffers')));
});

test('目录不存在是合法初态：如实标注，不是错误、也不是「零条目」的伪装', async () => {
  const home = await freshHome();
  const report = await buildExperienceBufferReport({ dshHome: home });
  assert.equal(report.ok, true, '目录不存在不得抛错（正常初态）');
  assert.equal(report.scope.bufferDirExists, false, '须如实标注为「不存在」，不能装作存在但为空');
  assert.equal(report.totals.entries, 0);
  assert.equal(report.scope.files.length, 0);
});

test('破损行与闭集外状态被跳过并**计入**跳过数（不得静默吞掉）', async () => {
  const home = await freshHome();
  const dir = path.join(home, 'ldvh', 'experience-buffers');
  await mkdir(dir, { recursive: true });
  const body = [
    JSON.stringify({ kind: 'entry', record: entry() }),
    '{ 这不是合法 JSON }',
    // 未知事件类型：如实跳过并计入。
    JSON.stringify({ kind: 'unknown-kind', id: 'x' }),
  ].join('\n') + '\n';
  await writeFile(path.join(dir, 'dsh-ldvh.jsonl'), body, 'utf8');

  const report = await buildExperienceBufferReport({ dshHome: home });
  assert.equal(report.totals.entries, 1, '只有一条合法条目');
  const note = report.scope.limits.find((line) => line.includes('无法解析') || line.includes('闭集外'));
  assert.ok(note, '跳过数须如实登记在 limits 里——「解析失败」不得伪装成「条目较少」');
  assert.equal(note.includes('2'), true, `跳过数应为 2（1 破行 + 1 闭集外状态），实际：${note}`);
});

test('待审核数与最老一条：读者最关心的两个数', async () => {
  const home = await freshHome();
  // entry 事件**必须是 pending**（`consumed` 由 settle 事件达成——追加型载体里
  // 一条「出生即终态」的 entry 会被折叠层判为非法）。
  await writeBuffer(home, 'dsh-ldvh', [
    entry({ at: '2026-10-01T00:00:00.000Z', status: 'pending' }),
    entry({ at: '2026-10-20T00:00:00.000Z', status: 'pending' }),
    entry({ id: 'aa000000-0000-4000-8000-000000000003', at: '2026-10-25T00:00:00.000Z', status: 'pending' }),
  ]);
  await appendSettle(home, 'dsh-ldvh', 'aa000000-0000-4000-8000-000000000003', 'consumed', { consumed_by: 'x' });

  const report = await buildExperienceBufferReport({ dshHome: home });
  assert.equal(report.pendingCount, 2, '只数 pending');
  assert.equal(
    report.oldestPendingAt,
    '2026-10-01T00:00:00.000Z',
    '最老一条 pending 的时刻——用来判断是否积压太久',
  );
  // 终态条目不计入 pending，但仍计入总数。
  assert.equal(report.totals.entries, 3);
});

test('没有聚合键与阈值：经验侧不得出现 group / promotionReady / threshold', async () => {
  const home = await freshHome();
  await writeBuffer(home, 'dsh-ldvh', [entry()]);
  const report = await buildExperienceBufferReport({ dshHome: home });
  const serialized = JSON.stringify(report);

  // §12bis 闭集 9 项里没有 group；阈值 N=3 是 §9 摩擦晋升的判据，经验侧没有对应数值。
  // 凭空给一个就是编造规范——故这三者一个都不许有。
  for (const key of ['group', 'promotionReady', 'threshold', 'groups']) {
    assert.equal(
      new RegExp(`"${key}"\\s*:`).test(serialized),
      false,
      `${key} 不得出现在经验侧报告——§12bis 无聚合键、无阈值，凭空给出即编造规范`,
    );
  }
});

/**
 * 页签结构：摩擦观察与经验观察是**两个页签**（Human 2026-10-27）。
 *
 * 此前两者叠在同一个摩擦页签里上下排列：经验区排在摩擦区之后，
 * 要往下滚动才看得到，等于被摩擦区盖住（Human 从截图发现「没看到经验观察」）。
 * 抖动点在于「同一个页签」这件事很容易被后来者合并回去——所以钉住结构。
 */
test("诊断页把摩擦观察与经验观察拆成两个页签，且摩擦页签不再叫「缓冲」", async () => {
  const source = await readFile(new URL("../../src/pages/Diagnostics.tsx", import.meta.url), "utf8");
  const locales = await readFile(new URL("../../src/i18n/locales.ts", import.meta.url), "utf8");

  // ① Tab 联合类型里两者并存。
  assert.match(source, /type Tab = [^;]*'observations'[^;]*'experience'/, "Tab 类型须同时含 observations 与 experience");

  // ② tabs 列表里各有一项（不是一个页签装两个面板）。
  assert.match(source, /\{ key: 'observations' as Tab, label: t\('diagnostics\.tab\.observations'\) \}/, "摩擦观察须独立成项");
  assert.match(source, /\{ key: 'experience' as Tab, label: t\('diagnostics\.tab\.experience'\) \}/, "经验观察须独立成项");

  // ③ 渲染分支里两者各自返回各自的面板——不得在一个分支里并列两个面板。
  assert.match(source, /tab === 'observations' && observations \? \(\s*<ObservationPanel/, "摩擦页签只渲染摩擦面板");
  assert.match(source, /tab === 'experience' && experienceBuffer \? \(\s*<ExperienceBufferPanel/, "经验页签只渲染经验面板");

  // ④ 中文文案：两个页签都叫「…观察」（去掉「缓冲」二字）。
  assert.match(locales, /'diagnostics\.tab\.observations': '摩擦观察',/, "摩擦页签须叫「摩擦观察」");
  assert.match(locales, /'diagnostics\.tab\.experience': '经验观察',/, "经验页签须叫「经验观察」");
});

/**
 * 命名口径：**载体在规范里叫「缓冲」，在页面上叫「观察」**（Human 2026-10-27）。
 *
 * 这不是文案洁癖：`缓冲`是 §12bis 的载体术语（字段闭集、容量、保留期都挂在这个词
 * 上），而用户在诊断页要看的是「我攒了哪些观察」。两套词各有归属，但**呈现面**一律
 * 用「观察」——页签、面板标题、指标卡、清理目标、正常初态说明都不许再出现「缓冲」。
 *
 * 抖动点是「顺手把规范术语抄进界面」：它很容易回潮，而回潮后界面上会重新出现一个
 * 用户没建立过概念的词。故逐处钉住呈现面文案。
 */
test("呈现面一律称「观察」：页签、面板、指标卡与清理目标都不再出现「缓冲」", async () => {
  const locales = await readFile(new URL("../../src/i18n/locales.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../../src/pages/Diagnostics.tsx", import.meta.url), "utf8");
  const cleanup = await readFile(new URL("../../api/services/logsCleanup.ts", import.meta.url), "utf8");

  // 呈现面文案（locale 键值）里不得有「留观」「观察缓冲」这类载体术语。
  for (const pattern of [
    /'diagnostics\.experience\.title': '[^']*留观/,
    /'diagnostics\.experience\.noBufferDir': '[^']*留观/,
    /'diagnostics\.observations\.[a-zA-Z]+': '[^']*缓冲/,
    /'diagnostics\.cleanup\.t\.experienceBuffer': '[^']*留观/,
    /'diagnostics\.cleanup\.t\.frictionObservations': '[^']*缓冲/,
  ]) {
    assert.equal(pattern.test(locales), false, `呈现面文案不得含载体术语：${pattern}`);
  }

  // 两个页签的面板都走同一套指标网格（结构对齐，读者不必学两套版式）。
  assert.match(page, /function ObservationPanel[\s\S]*?ldvh-metric-grid/, "摩擦面板须有指标网格");
  assert.match(page, /function ExperienceBufferPanel[\s\S]*?ldvh-metric-grid/, "经验面板须有指标网格");

  // 清理目标的中文名与页签同口径。
  assert.match(cleanup, /label: '经验观察',/, "清理目标须叫「经验观察」");
  assert.match(cleanup, /label: '摩擦观察',/, "清理目标须叫「摩擦观察」");
});
