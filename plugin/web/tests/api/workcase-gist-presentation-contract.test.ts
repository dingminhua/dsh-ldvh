// WorkCase `gist`（要点）呈现契约——21 §8 字段 + 10 §5.5 呈现接线。
//
// 本文件覆盖 `gist` 引入后的两件独立事情，它们此前都没有守卫：
//
//   1. **投影层**：`gist` 必须出现在**列表投影**（`projectCurrentWorkCaseCard`
//      是列表与详情卡共用的投影函数）的三个状态下。这不是理论风险——
//      `summary` 就犯过这个错：它只在 `view.status === 'draft'` 分支投影，于是
//      open/closed 的卡面拿不到 Human 向文本。既有保真守卫
//      （workcase-projection-fidelity.test.ts）覆盖的是**详情装配**路径，而该路径
//      以 `{...fact_object}` 起手，`Object.assign(data, currentCard)` 的投影缺失
//      会被源对象原值掩盖——所以它抓不到「列表投影漏字段」。本文件直接断言
//      投影函数自身的返回值，不用源对象兜底。
//
//   2. **呈现层**：卡面渲染 `gist` 而**不**渲染 `summary`；详情两者都渲染且形态
//      不同（`gist` 纯文本、`summary` Markdown）。这些是源码形态断言——它们能拦
//      「被改回渲染 summary」，但拦不住运行时取值错误，故与第 1 组互补。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { projectCurrentWorkCaseCard } from '../../api/services/facts.ts';
import { readLocalFact, type LocalFactScope } from '../../api/services/localFactReader.ts';

/** 仓库根（tests/api → web → plugin → repo）。 */
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..');
const WORKCASE_DIR = path.join(REPOSITORY_ROOT, 'ldvh-base', 'workcases');
const WEB_SRC = path.join(REPOSITORY_ROOT, 'plugin', 'web', 'src');
/** 服务端投影层在 `plugin/web/api/`（不在 src 下），故另设基准。 */
const WEB_ROOT = path.join(REPOSITORY_ROOT, 'plugin', 'web');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(WEB_SRC, relativePath), 'utf8');
}

/** 读 `plugin/web/` 下任意相对路径（含 api/ 投影层）。 */
function readWebFile(relativePath: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, relativePath), 'utf8');
}

/**
 * 去掉注释与字符串字面量后的代码文本。
 *
 * 用于「某标识符不得出现在**代码**中」一类断言——直接在原文上匹配会被注释命
 * 中：本仓库的注释大量引述字段名（例如说明「不以 summary 静默替代」），
 * 那是**解释**而非用法。断言必须落在代码上，否则守卫会因注释措辞而误报。
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function workcaseScope(): LocalFactScope {
  return { worktreeLocator: REPOSITORY_ROOT, governedProjectId: 'dsh-ldvh' }
}

function existingWorkCaseIds(): string[] {
  if (!fs.existsSync(WORKCASE_DIR)) return [];
  return fs.readdirSync(WORKCASE_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''))
    .sort();
}

/**
 * 合成夹具：只提供投影所需的最小字段。
 *
 * 刻意**不**读真实载体——真实对象的 `gist` 缺失与否取决于迁移进度，把它作为
 * 断言前提会让本测试随数据漂移而失效（且 closed 对象按 21 §8 本就允许缺失）。
 * 这里断言的是**投影函数的搬运行为**，与数据状态无关。
 */
function workcaseFixture(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    object_uid: '11111111-2222-4333-8444-555555555555',
    object_id: 'wc-fixture',
    fact_type_key: 'workcase',
    title: '夹具工单',
    created_at: '2026-09-18T00:00:00.000Z',
    change_log: [],
    serves: 'SG-3',
    summary: '给 AI 看的完整语义快照。',
    scope: '做什么：夹具。明确不做什么：无。',
    plan: [{ step: '步骤一', done_criteria: '判据一' }],
    gist: '给 Human 扫读的一句话要点。',
    ...overrides,
  };
}

test('列表投影在 draft/open/closed 三态都携带 gist（10 §5.5 卡面渲染前提）', () => {
  // 三个状态各自的合法最小字段集：21 §8 的不变量要求
  // gate_1 出现 ⇔ open/closed；attempt ⇔ open；result/outcome ⇔ closed。
  const fixtures: Array<[string, Record<string, unknown>]> = [
    ['draft', workcaseFixture({ status: 'draft' })],
    ['open', workcaseFixture({
      status: 'open',
      gate_1: { approved_at: '2026-09-18T00:00:00.000Z', approver: 'Human', authorization_fingerprint: 'a'.repeat(64), scope_snapshot: '快照' },
      attempt: { attempt_id: '1', controller: 'c', started_at: '2026-09-18T00:00:00.000Z', heartbeat_at: '2026-09-18T00:00:00.000Z' },
    })],
    ['closed', workcaseFixture({
      status: 'closed',
      outcome: 'completed',
      gate_1: { approved_at: '2026-09-18T00:00:00.000Z', approver: 'Human', authorization_fingerprint: 'a'.repeat(64), scope_snapshot: '快照' },
      result: { achieved_scope: '全部', criteria_checks: [{ satisfied: true, evidence: '证据' }], residual: [] },
    })],
  ];

  for (const [status, fixture] of fixtures) {
    const projected = projectCurrentWorkCaseCard(fixture, null);
    assert.equal(
      projected.gist,
      '给 Human 扫读的一句话要点。',
      `status=${status} 的列表投影必须携带 gist——卡面靠它渲染，缺失则卡体无 Human 向文本`,
    );
  }
});

test('投影对 gist 的搬运是恒定的，不因状态分流（summary 曾犯的错）', () => {
  // 反例守卫：`summary` 此前只在 draft 分支投影，open/closed 卡面因此没有可渲染
  // 文本。gist 必须**无条件**搬运——缺失与否由来源对象决定（21 §8：closed 缺失
  // 合法），投影层不做状态分流。本断言在 open/closed 夹具中显式去掉 gist，
  // 确认投影既不伪造也不报错。
  const withoutGist = workcaseFixture({ status: 'draft' });
  delete withoutGist.gist;
  const projected = projectCurrentWorkCaseCard(withoutGist, null);
  assert.equal('gist' in projected, false, '来源无 gist 时投影不得伪造该字段（03 §6.1）');

  // 且 gist 必须在**投影恒复制段**，而非任何状态分支内。
  const facts = readWebFile('api/services/facts.ts');
  const shape = facts.slice(
    facts.indexOf('function projectCurrentWorkCaseCardShape('),
    facts.indexOf('export function projectCurrentWorkCaseCard('),
  );
  const copyBlock = shape.slice(0, shape.indexOf('if (view.status'));
  assert.match(
    copyBlock,
    /'gist'/,
    'gist 必须出现在状态分支之前的恒复制清单中——放进状态分支就会重演 summary 的错（open/closed 卡面丢失字段）',
  );
});

test('卡面渲染 gist 而非 summary；详情两者并存且形态不同（10 §5.5）', () => {
  const list = readSource('pages/ObjectList.tsx');
  const cognition = readSource('pages/CognitionCenter.tsx');
  const layout = readSource('pages/object-detail/WorkCaseReadingLayout.tsx');
  const gistLine = readSource('components/WorkCaseGistLine.tsx');

  // 两个卡面都经共享组件渲染 gist（单一实现，防两处漂移）。
  assert.match(list, /<WorkCaseGistLine gist=\{obj\.gist\}/);
  // 聚焦收件箱有**三个**卡体落点，10 §5.5 把它们登记在同一行
  // （「待决定事项 / 推进中事项」）：
  //   待决定事项 = plan_confirmation（Gate 1 提请）+ closure_confirmation（Gate 2 提请）
  //   推进中事项 = ActiveWorkCaseItemRow（executing）
  // 三者都是扫读窗口，都必须渲染——只改其中一处会让另外两处没有 Human 向文本。
  // 此前「推进中事项」确被漏掉（只改了两个 InboxCardContent 分支），故按数量断言。
  // 计数落在**代码**上：本文件的注释也引述该 JSX 形态，直接匹配原文会多计。
  assert.equal(
    (codeOnly(cognition).match(/<WorkCaseGistLine gist=\{item\.card\.gist\}/g) ?? []).length,
    3,
    '聚焦收件箱的三个卡体（plan_confirmation + closure_confirmation + 推进中事项）各须渲染一次 gist',
  );

  // 卡面**不得**再渲染 summary——这是本次改动的核心（卡面是扫读窗口，
  // summary 是执行者快照，10 §5.5 明文登记「卡面不渲染 summary」）。
  //
  // 断言方式：**按卡体函数取界，在界内禁止出现 `summary` 这个标识符**（落在
  // codeOnly 后的代码上，注释不算）。这比匹配某种写法形态（如 `obj.summary ?`）
  // 强：`{obj.summary && <p>…</p>}`、`{item.card.summary && …}`、以及将来任何
  // 其它 JSX 条件写法都一并被拦——「换写法叠加」的逃逸已实测存在，故不再依赖
  // 形态匹配。
  const cardBody = (source: string, from: string, to: string): string => {
    const start = source.indexOf(from);
    assert.ok(start >= 0, `未找到卡体函数 ${from}——守卫取界失败会使断言失效`);
    const end = source.indexOf(to, start);
    assert.ok(end > start, `未找到卡体函数的结束界 ${to}——守卫取界失败会使断言失效`);
    return codeOnly(source.slice(start, end));
  };

  const listCardBody = cardBody(list, 'function WorkCaseListCardBody(', 'function sortObjectsForList(');
  assert.doesNotMatch(listCardBody, /summary/, '列表卡体不得出现 summary（10 §5.5）');

  const inboxBody = cardBody(cognition, 'function InboxCardContent(', 'function toObjectCard(');
  assert.doesNotMatch(inboxBody, /summary/, '聚焦收件箱「待决定事项」卡体不得出现 summary（10 §5.5）');

  const activeBody = cardBody(cognition, 'function ActiveWorkCaseItemRow(', 'function InboxItemRow(');
  assert.doesNotMatch(activeBody, /summary/, '聚焦收件箱「推进中事项」卡体不得出现 summary（10 §5.5）');

  const federation = readSource('pages/FederationObjects.tsx');
  assert.match(
    codeOnly(federation),
    /<WorkCaseGistLine gist=\{item\.gist\} \/>/,
    '联邦对象卡的 WorkCase 卡体须渲染 gist',
  );
  // 联邦卡的分支界：`if (currentType === 'workcase')` → 下一个 `return null;`。
  const fedBranch = cardBody(federation, "if (currentType === 'workcase')", 'return null;');
  assert.doesNotMatch(fedBranch, /summary/, '联邦对象卡的 WorkCase 卡体不得出现 summary（10 §5.5）');

  // 列表卡四个派生组各接一次 gist（三态全部覆盖）。
  assert.equal(
    (list.match(/<WorkCaseGistLine gist=\{obj\.gist\}/g) ?? []).length,
    4,
    '列表卡四个派生组（pending_gate1/executing/awaiting_gate2/closed）各须渲染一次 gist',
  );

  // 详情：gist 与 summary 都是独立节点，且 gist 走纯文本节点、summary 走 Markdown 节点。
  assert.match(layout, /function GistNode\(/);
  assert.match(layout, /<GistNode/);
  assert.match(layout, /title=\{getFieldLabel\('gist', locale\)\}/);
  assert.match(layout, /title=\{getFieldLabel\('summary', locale\)\}/);
  // GistNode 不得经 Markdown 渲染——21 §8 定义 gist 为纯文本。
  // 断言用**正向**形态（`<p …>{value}</p>` 必须在），而非只查窗口内有无
  // `ResearchTextNodeContent`：后者可被「委托给外部 Markdown 组件」绕开
  // （该组件若定义在 `function GistNode(` 之前就不落在窗口内）——此逃逸已实测。
  const gistNode = layout.slice(layout.indexOf('function GistNode('), layout.indexOf('function ProseNode('));
  assert.match(
    codeOnly(gistNode),
    /<p[^>]*>\{value\}<\/p>/,
    'gist 须由纯文本 <p> 直接渲染——委托任何 Markdown 组件都会使该形态消失',
  );
  assert.doesNotMatch(codeOnly(gistNode), /ResearchTextNodeContent/, 'gist 是纯文本字段，不得经 Markdown 渲染');
  // GistNode 须接受 issue 并在内部决定渲染，使类型不符时 fieldIssue 仍可见
  // （不在调用点用 typeof 把门——那会连问题提示一起吞掉）。
  assert.match(gistNode, /issue\?: ReturnType<typeof fieldIssue>/);
  assert.match(gistNode, /<FieldProblem issue=\{issue\} \/>/);

  // 降级：closed 缺失合法，须如实降级而非以 summary 静默替代。
  // 断言落在**代码**上：本组件的注释大量引述 summary（解释为何不用它），
  // 直接匹配原文会被注释命中而误报。
  assert.match(gistLine, /objectList\.workcaseGistMissing/);
  assert.doesNotMatch(
    codeOnly(gistLine),
    /summary/,
    '降级路径不得以 summary 静默替代（10 §5.5 呈现降级）',
  );
});

test('gist 词条在中英两语均登记，且与 summary 不同译', () => {
  const locales = readSource('i18n/locales.ts');
  // getFieldLabel 经 FIELD_LABEL_LOCALES 取值，故须登记词条而非仅 UI_LOCALES。
  assert.match(locales, /^\s*gist: \{ zh: '要点', en: 'Gist' \},/m);
  assert.match(locales, /^\s*summary: \{ zh: '摘要', en: 'Summary' \},/m);
  // 降级提示词条两语齐备。
  assert.match(locales, /'objectList\.workcaseGistMissing': '（本对象未登记要点）'/);
  assert.match(locales, /'objectList\.workcaseGistMissing': '\(no gist recorded\)'/);
});

test('真实非终态载体都携带 gist，且不超过 21 §8 的 200 字符上限', async () => {
  const ids = existingWorkCaseIds();
  assert.ok(ids.length > 0, `未找到任何 WorkCase 载体：${WORKCASE_DIR}`);

  const missing: string[] = [];
  const tooLong: string[] = [];
  let checkedNonTerminal = 0;

  for (const objectId of ids) {
    const detail = await readLocalFact('workcase', objectId, workcaseScope());
    assert.equal(detail.status, 'ok', `${objectId}: 读取失败——不得跳过真实对象`);
    const source = detail.item.fact_object as Record<string, unknown>;
    if (source.status === 'closed') continue; // 21 §8：closed 缺失合法（终态只读）
    checkedNonTerminal += 1;
    const gist = source.gist;
    if (typeof gist !== 'string' || gist.trim().length === 0) {
      missing.push(objectId);
      continue;
    }
    if (gist.length > 200) tooLong.push(`${objectId} (${gist.length})`);
  }

  assert.deepEqual(missing, [], `以下非终态 WorkCase 缺 gist（21 §8 要求 draft/open 必填）：\n${missing.join('\n')}`);
  assert.deepEqual(tooLong, [], `以下 gist 超过 200 字符上限（21 §8）：\n${tooLong.join('\n')}`);
  assert.ok(checkedNonTerminal > 0, '至少须核对一个非终态对象，否则本断言无判别力');
});
