import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('discarded Pitfall cards use the terminal disposition presentation', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const statusBadge = fs.readFileSync(path.resolve('src/components/StatusBadge.tsx'), 'utf8');

  assert.match(source, /function PitfallTerminalCardContent/);
  assert.match(source, /obj\.status === 'discarded'/);
  assert.match(source, /function isDeprecatedListCard[\s\S]*obj\.status === 'retired' \|\| obj\.status === 'discarded' \|\| obj\.status === 'deprecated'/);
  assert.match(source, /\.filter\(\(item\) => !isDeprecatedListCard\(item\) \|\| searchParams\.get\('status'\) === ALL_STATUS_PARAM \|\| activeStatus === item\.status\)/);
  // 契约修正（2026-10-19）：此处原先断言终态卡读 `obj.disposition_summary`——
  // 那是 *v4* 字段，已随 23 号移出闭集（见 factFieldContract.ts 的 pitfall 段
  // 注释「disposition_summary 已随 23 号移除」）。断言读旧键，等于把 bug 钉成
  // 契约：服务端送的是 `disposition`，卡片却读 `disposition_summary`，恒得
  // undefined，于是每条 discarded Pitfall 都渲染成「处置说明缺失。」——测试
  // 全绿而页面全错。现改为断言 v5 闭集字段 `disposition`。
  assert.match(source, /obj\.disposition\?\.trim\(\) \|\| t\('objectList\.dispositionMissing'\)/);
  assert.doesNotMatch(source, /disposition_summary\?\.trim/, '终态卡不得再读 v4 disposition_summary');
  assert.match(source, /<TerminalFactPanel tone="retired" content=\{formatReasonText\(disposition\)\}/);
  assert.match(source, /tone: 'implemented' \| 'retired';/);
  assert.doesNotMatch(source, /tone: 'implemented' \| 'discarded'/);
  assert.match(statusBadge, /objectType === 'pitfall' && status === 'discarded'/);
  assert.match(source, /currentType === 'pitfall'[\s\S]*showNonActiveReason=\{false\}[\s\S]*PitfallCardContent/);
});

test('active Pitfall cards retain only the shared identity and title frame', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');

  assert.match(source, /function PitfallCardContent[\s\S]*?obj\.status === 'active'\) return null/);
});

test('终结理由读取 v5 闭集字段 disposition，不再读 v4 disposition_summary（2026-10-19）', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const contract = fs.readFileSync(path.resolve('api/services/factFieldContract.ts'), 'utf8');

  // 上位事实：v5 闭集里根本没有 disposition_summary 这个键。契约层只登记
  // `disposition`（且仅 pitfall.adr.spark.friction 有），故任何消费方读
  // disposition_summary 都必然拿到 undefined。
  const pitfallBlock = contract.slice(contract.indexOf('  pitfall: {'))
  assert.match(pitfallBlock.slice(0, 600), /disposition: field\('pitfall-disposition'/, '① 闭集用 disposition');
  assert.doesNotMatch(pitfallBlock.slice(0, 600), /disposition_summary/, '② pitfall 闭集不含 v4 键');

  // 两个消费点都改用 v5 键：终态卡体 + 状态说明条。
  // 说明条此前读 disposition_summary，会让「卡体写理由全文、说明条写理由缺失」
  // 同时出现在一张卡上（同一对象两种自相矛盾的呈现）。
  assert.match(source, /function PitfallTerminalCardContent[\s\S]{0,900}?const disposition = obj\.disposition\?\.trim\(\)/,
    '③ 终态卡读 disposition');
  assert.match(source, /function getNonActiveReason[\s\S]{0,400}?const disposition = obj\.disposition;/,
    '④ 状态说明条读 disposition');
  assert.doesNotMatch(source, /obj\.disposition_summary/, '⑤ 呈现层不得再消费 v4 键');
});
