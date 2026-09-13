import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Spark serves 子目标锚点筛选契约（第二层筛选）。
 *
 * Human 定案 2026-09-13：Spark 有 SG 绑定（20 §6 serves），列表按当前 goal
 * 的子目标数量与变化增加一层筛选——两层结构与 WorkCase（进展分组 + 优先级）
 * 同构：状态（生命周期）为第一层，SG 锚点为第二层。
 */

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('serves filter component follows the shared tab filter grammar', () => {
  const component = read('src/components/ServesSgFilter.tsx');

  // 选项源动态传入（goal 子目标决定），非固定档位。
  assert.match(component, /interface ServesSgFilterOption \{\s*\n\s*id: string;\s*\n\s*text: string;\s*\n\}/);
  // tab 形态与 ObjectStatusFilter 同语法（ldvh-tab-button + ldvh-tab-list）。
  assert.match(component, /ldvh-tab-button \$\{active \? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'\}/);
  // SG id 以 mono 呈现，title 携带子目标全文（扫读定位 + 完整判定条件悬停可见）。
  assert.match(component, /<span className="font-mono">\{option\.id\}<\/span>/);
  assert.match(component, /title=\{option\.text\}/);
  // 「全部」选项 + 总数；计数覆盖降级（unavailable → —，partial → n+）。
  assert.match(component, /onChange\(null\)/);
  assert.match(component, /formatCoverageCount\(total, coverageStatus\)/);
  // 计数缺失时显示 0（goal 里声明、当前池尚无 spark 的 SG 仍可见）。
  assert.match(component, /counts\.get\(option\.id\) \?\? 0/);
});

test('spark list applies the serves layer on top of the status filter', () => {
  const objectList = read('src/pages/ObjectList.tsx');

  // 仅 spark 启用；激活值必须存在于 goal 子目标选项中（URL 伪造值不生效）。
  assert.match(objectList, /const supportsServesSgNavigation = currentType === 'spark';/);
  assert.match(objectList, /servesSgOptions\.some\(\(option\) => option\.id === servesParam\)/);
  // 过滤在前端应用（items 已按状态过滤——计数与过滤同口径）。
  assert.match(objectList, /filteredItems\.filter\(\(item\) => item\.serves === activeServesSg\)/);
  // 计数按状态过滤后的池聚合 serves（1e21a1f D-9 锚点字段统一定名）。
  assert.match(objectList, /typeof item\.serves === 'string' && item\.serves\.trim\(\) \? item\.serves\.trim\(\) : null/);
  // URL 参数 serves 的写/删与 priority 同模式。
  assert.match(objectList, /nextParams\.set\('serves', servesSg\);/);
  assert.match(objectList, /nextParams\.delete\('serves'\);/);
  // 非 spark 类型清掉 serves 参数（与 removesForeignProgress 同款清理）。
  assert.match(objectList, /const removesForeignServes = currentType !== 'spark' && searchParams\.has\('serves'\);/);
  // 第二层筛选渲染在状态筛选行下方（与 WorkCase priority 行同构）。
  assert.match(objectList, /supportsServesSgNavigation && servesSgOptions\.length > 0 && \(/);
});

test('serves options follow the current goal sub-goals dynamically', () => {
  const objectList = read('src/pages/ObjectList.tsx');

  // 选项源：/api/cognition/goal 的 sub_goals（25 号——SG 数量与变化以 goal 为准）。
  assert.match(objectList, /if \(currentType !== 'spark'\) \{\s*\n\s*setServesSgOptions\(\[\]\);/);
  assert.match(objectList, /fetchCognitionGoal\(\)\s*\n\s*\.then\(\(data\) => \{/);
  assert.match(objectList, /data\.goal\?\.sub_goals/);
  // goal 未创建是合法状态：静默保持空选项（筛选层不渲染）。
  assert.match(objectList, /\.catch\(\(\) => \{\s*\n\s*if \(!cancelled\) setServesSgOptions\(\[\]\);/);
});

test('the serves filter i18n key is registered in both locales', () => {
  const locales = read('src/i18n/locales.ts');
  assert.match(locales, /'objectList\.servesSgFilter': '服务子目标',/);
  assert.match(locales, /'objectList\.servesSgFilter': 'Serves sub-goal',/);
});
