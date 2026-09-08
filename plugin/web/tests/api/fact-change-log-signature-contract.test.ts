import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLatestFactChangeAt, getLatestFactChangeSignature, getObjectUpdatedAt } from '../../src/utils/factChangeLog';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

test('object header attribution reads the newest complete signature from change_log only', () => {
  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { model_id: 'legacy', agent_workbench: 'legacy-runtime' } },
    { signature: { agent_id: 'partial' } },
    { signature: { product_name: 'Cindy', model_name: 'gpt-5.6-luna', agent_runtime_name: 'codex-cli' } },
  ]), { productName: 'Cindy', modelName: 'gpt-5.6-luna' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'chatGPT', model_name: 'chatgpt/gpt-5.6-terra', agent_runtime_name: 'codex' } },
  ]), { productName: 'ChatGPT', modelName: 'gpt-5.6-terra' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'C i n d y', agent_runtime_name: 'CINDY' } },
  ]), { productName: 'C i n d y' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'Claude Code', model_name: 'glm-5.2', agent_runtime_name: 'claude-code' } },
  ]), { productName: 'Claude Code', modelName: 'glm-5.2' });

  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'Cindy', model_name: 'deepseek/deepseek-v4-flash[1m]', agent_runtime_name: 'claude-code' } },
  ]), { productName: 'Cindy', modelName: 'deepseek-v4-flash' });

  assert.equal(getLatestFactChangeSignature([
    { signature: { agent_id: 'legacy', host_environment: 'old-host' } },
    { signature: { model_id: 'gpt-5', agent_workbench: 'Cindy' } },
  ]), undefined);

  assert.equal(getLatestFactChangeSignature([
    { signature: { model_id: 'gpt-5', host_name: 'Cindy' } },
  ]), undefined);

  assert.equal(getLatestFactChangeSignature([
    { signature: { agent_id: 'partial' } },
    { signature: { host_environment: 'missing-agent' } },
  ]), undefined);
  assert.equal(getLatestFactChangeSignature(undefined), undefined);
});

test('object header attribution reads the v5 flat provider/model change_log shape (specs/09)', () => {
  // v5 writer 写出的扁平流水：{ at, provider, model, summary }，无嵌套 signature 对象。
  // 返回区分键形态：provider/model 原词携键（供应商 id 逐字呈现，不折叠进
  // productName——下游二次归一会大写化）；显示层经 normalizeSignature 合并。
  assert.deepEqual(getLatestFactChangeSignature([
    { at: '2026-09-06T07:48:23.255Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' },
    { at: '2026-09-07T18:53:00.235Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '更新' },
  ]), { provider: 'zzztoken-glm', model: 'glm-5.3' });

  // v4 嵌套 signature 与 v5 扁平混合：倒序取最新一条完整署名（扁平条目排在后面）。
  assert.deepEqual(getLatestFactChangeSignature([
    { signature: { product_name: 'Cindy', model_name: 'gpt-5.6-luna' }, at: '2026-08-01T00:00:00Z' },
    { at: '2026-09-01T00:00:00Z', provider: 'modlens-zzztoken-glm', model: 'glm-5.3', summary: '受控更新' },
  ]), { provider: 'modlens-zzztoken-glm', model: 'glm-5.3' });

  // 反之：v4 嵌套条目更新时取嵌套署名（归一 productName/modelName 形态）。
  assert.deepEqual(getLatestFactChangeSignature([
    { at: '2026-09-01T00:00:00Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' },
    { signature: { product_name: 'Cindy', model_name: 'gpt-5.6-luna' }, at: '2026-09-02T00:00:00Z', summary: '归档迁移' },
  ]), { productName: 'Cindy', modelName: 'gpt-5.6-luna' });

  // 扁平字段不完整（只有 provider 没有 model）仍是完整署名（两字段可缺一）。
  assert.deepEqual(getLatestFactChangeSignature([
    { at: '2026-09-01T00:00:00Z', provider: 'workbuddy', summary: '受控创建' },
  ]), { provider: 'workbuddy' });
  // 空白扁平值不算完整署名，不补造。
  assert.equal(getLatestFactChangeSignature([
    { at: '2026-09-01T00:00:00Z', provider: '  ', model: '', summary: '受控创建' },
  ]), undefined);
});

test('provider renders verbatim through normalizeSignature while v4 product_name keeps normalization', async () => {
  const { normalizeSignature } = await import('../../shared/signature.ts');

  // 供应商 id 逐字呈现：不首字母大写、不套平台映射（签名值零清理原则）。
  assert.deepEqual(normalizeSignature({ provider: 'zzztoken-glm', model: 'glm-5.3' }), {
    productName: 'zzztoken-glm', modelName: 'glm-5.3',
  });
  assert.deepEqual(normalizeSignature({ provider: 'modlens-zzztoken-glm' }), {
    productName: 'modlens-zzztoken-glm', modelName: '',
  });
  // v4 产品名归一保持（契约行为）：首字母大写与平台映射。
  assert.deepEqual(normalizeSignature({ productName: 'cindy' }), { productName: 'Cindy', modelName: '' });
  assert.deepEqual(normalizeSignature({ productName: 'deepseek-harness' }), { productName: 'DeepSeek Harness', modelName: '' });
  // 区分键经二次归一仍逐字（管道幂等：读取边界返回的 provider 键到显示层不变）。
  const fromRead = getLatestFactChangeSignature([
    { at: '2026-09-01T00:00:00Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' },
  ]);
  assert.deepEqual(normalizeSignature(fromRead ?? {}), { productName: 'zzztoken-glm', modelName: 'glm-5.3' });
});

test('latest change-log at tolerates Date instances and requires complete RFC 3339 strings', () => {
  // YAML 未加引号的 ISO 时间戳被 js-yaml 解析为 Date 实例（进程内）；HTTP 层为字符串。
  assert.equal(getLatestFactChangeAt([
    { at: new Date('2026-09-06T07:48:23.255Z'), summary: '受控创建' },
    { at: new Date('2026-09-07T18:53:00.235Z'), summary: '更新' },
  ]), '2026-09-07T18:53:00.235Z');
  assert.equal(getLatestFactChangeAt([
    { at: '2026-09-07T18:53:00.235Z', summary: '更新' },
  ]), '2026-09-07T18:53:00.235Z');
  // 无效时刻不采用：跳过末条取更旧的有效流水。
  assert.equal(getLatestFactChangeAt([
    { at: '2026-09-07 18:53:00', summary: '非 RFC3339' },
    { at: '2026-09-06T07:48:23.255Z', summary: '受控创建' },
  ]), '2026-09-06T07:48:23.255Z');
  assert.equal(getLatestFactChangeAt([]), undefined);
  assert.equal(getLatestFactChangeAt(undefined), undefined);
  assert.equal(getLatestFactChangeAt([{ summary: 'no at' }]), undefined);
});

test('object updated time falls back to change_log at when updated_at/updated are absent (03 §6.1)', () => {
  // v4 归档对象：updated_at 优先，保持既有显示。
  assert.equal(getObjectUpdatedAt({
    updated_at: '2026-08-24T10:56:13Z', updated: '2026-08-01T00:00:00Z',
    change_log: [{ at: '2026-08-24T10:56:13Z', summary: '创建' }],
  }), '2026-08-24T10:56:13Z');
  // v5 对象：无公共 updated_at/updated——回退 change_log 末条流水 at（规范权威承载）。
  assert.equal(getObjectUpdatedAt({
    created_at: '2026-09-06T07:48:23.255Z',
    change_log: [{ at: '2026-09-06T07:48:23.255Z', provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' }],
  }), '2026-09-06T07:48:23.255Z');
  // Date 形态的 at 同样可用。
  assert.equal(getObjectUpdatedAt({
    change_log: [{ at: new Date('2026-09-07T18:53:00.235Z'), provider: 'x', model: 'y', summary: '更新' }],
  }), '2026-09-07T18:53:00.235Z');
  // 什么都没有：undefined（显示层按缺失处理）。
  assert.equal(getObjectUpdatedAt({ created_at: '2026-09-06T07:48:23.255Z' }), undefined);
  assert.equal(getObjectUpdatedAt(null), undefined);
  assert.equal(getObjectUpdatedAt(undefined), undefined);
});

test('all fact Cards reuse the shared update and update-log attribution surface', () => {
  const list = readFileSync(path.join(repositoryRoot, 'web/src/pages/ObjectList.tsx'), 'utf8');
  const facts = readFileSync(path.join(repositoryRoot, 'web/api/services/facts.ts'), 'utf8');

  assert.match(list, /import ObjectUpdatedMeta from '@\/components\/ObjectUpdatedMeta'/);
  assert.match(list, /<ObjectUpdatedMeta source=\{obj\} updatedAt=\{obj\.updated\} \/>/);
  assert.match(list, /flex min-w-0 items-center justify-end pt-0\.5 text-right/);
  assert.doesNotMatch(list, /formatDateTime\(obj\.updated\)/);
  assert.match(facts, /copyPresentFields\(source, \['change_log'\]\)/);
});

test('detail page and reading panel derive the updated time via getObjectUpdatedAt (03 §6.1 fallback)', () => {
  const detail = readFileSync(path.join(repositoryRoot, 'web/src/pages/ObjectDetail.tsx'), 'utf8');
  const panel = readFileSync(
    path.join(repositoryRoot, 'web/src/components/reading-panel/PanelContent.tsx'),
    'utf8',
  );

  assert.match(detail, /import \{ getObjectUpdatedAt \} from '@\/utils\/factChangeLog'/);
  assert.match(detail, /<ObjectUpdatedMeta source=\{obj\} updatedAt=\{getObjectUpdatedAt\(obj\)\} \/>/);
  assert.match(panel, /import \{ getObjectUpdatedAt \} from '@\/utils\/factChangeLog'/);
  assert.match(panel, /<ObjectUpdatedMeta source=\{obj \|\| \{\}\} updatedAt=\{getObjectUpdatedAt\(obj\)\} \/>/);
  // 不再直接读对象头 updated_at/updated——v5 对象没有这些字段，落款由回退链承担。
  assert.doesNotMatch(detail, /obj\.updated_at \?\? obj\.updated/);
  assert.doesNotMatch(panel, /obj\?\.updated_at \?\? obj\?\.updated/);
});

test('object list route derives item updated time with the change_log fallback (03 §6.1)', () => {
  const objectsRoute = readFileSync(path.join(repositoryRoot, 'web/api/routes/objects.ts'), 'utf8');

  assert.match(objectsRoute, /import \{ getLatestChangeLogAt \} from '\.\.\/\.\.\/shared\/factChangeLog\.js'/);
  assert.match(objectsRoute, /updated: resolveListItemUpdated\(value\)/);
  // 回退链：updated_at → updated → change_log 末条流水 at。
  assert.match(objectsRoute, /toStringValue\(value\.updated_at\)[\s\S]*?\|\| toStringValue\(value\.updated\)[\s\S]*?\|\| getLatestChangeLogAt\(value\.change_log\)/);
});

test('change-log reading node reads the v5 flat provider/model entries', () => {
  const layouts = readFileSync(
    path.join(repositoryRoot, 'web/src/pages/object-detail/FactReadingLayouts.tsx'),
    'utf8',
  );

  // 扩展后的 normalizeSignature 承接双形态：provider 逐字落位 productName（不美化），
  // v4 product_name 保持归一；此处直接渲染，无二次归一。
  assert.match(layouts, /provider: record\.provider/);
  assert.match(layouts, /model: record\.model/);
  assert.doesNotMatch(layouts, /productName: signatureRecord\?\.product_name \?\? record\.provider/);
});

test('provider surfaces are labelled 供应商/Provider and display values verbatim', () => {
  const locales = readFileSync(path.join(repositoryRoot, 'web/src/i18n/locales.ts'), 'utf8');

  // Human 2026-09-10 定案：署名环境 → 供应商（commit 详情面板 + 聚焦页用量两处，zh/en）。
  assert.match(locales, /environmentName: '供应商'/);
  assert.match(locales, /environmentName: 'Provider'/);
  assert.match(locales, /'cognition\.recent\.environmentUsage': '供应商'/);
  assert.match(locales, /'cognition\.recent\.environmentUsage': 'Provider'/);
  assert.doesNotMatch(locales, /署名环境/);
  assert.doesNotMatch(locales, /'Signing environment'/);
  // Human 2026-09-10 定案：署名 AI → 模型（同四处）。
  assert.match(locales, /modelName: '模型'/);
  assert.match(locales, /modelName: 'Model'/);
  assert.match(locales, /'cognition\.recent\.modelUsage': '模型'/);
  assert.match(locales, /'cognition\.recent\.modelUsage': 'Model'/);
  assert.doesNotMatch(locales, /署名 AI/);
  assert.doesNotMatch(locales, /'Signing AI'/);
});

test('cognition recent activity row drops the research question display; research type carries teal color', async () => {
  const cognition = readFileSync(path.join(repositoryRoot, 'web/src/pages/CognitionCenter.tsx'), 'utf8');

  // Human 2026-09-10 定案：近期动态行不显示研究问题——该行是动态摘要不是 F1 卡
  // （24 §12 的 research_question 卡片摘要投影归对象列表卡片承载）。
  assert.doesNotMatch(cognition, /item\.research_question/);
  assert.doesNotMatch(cognition, /getFieldLabel\('research_question'/);

  // 类型色：后端 typeColors 补 research 映射（与前端 CATEGORY_COLORS.research 的
  // teal 一致）——认知页标题旁类型图标用后端 typeColor，不再是灰色兜底。
  const { getTypeColor } = await import('../../api/services/typeColors.ts');
  assert.equal(getTypeColor('research'), '#14b8a6');
  assert.equal(getTypeColor('workcase'), '#0ea5e9');
  assert.equal(getTypeColor('no-such-type'), '#6b7280');
});

test('Cognition Spark health and recent activity reuse the fact Card attribution surface', () => {
  const cognition = readFileSync(path.join(repositoryRoot, 'web/src/pages/CognitionCenter.tsx'), 'utf8');

  assert.match(cognition, /import ObjectUpdatedMeta from '@\/components\/ObjectUpdatedMeta'/);
  assert.match(cognition, /<ObjectUpdatedMeta source=\{\{\}\} updatedAt=\{item\.occurredAt\} signature=\{item\.signature\} \/>/);
  assert.match(cognition, /<ObjectUpdatedMeta source=\{\{\}\} updatedAt=\{item\.updatedAt\} signature=\{item\.signature\} \/>/);
});
