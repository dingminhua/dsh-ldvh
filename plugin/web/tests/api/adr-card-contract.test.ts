import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('retired ADR cards use the terminal disposition presentation', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');

  assert.match(source, /function AdrTerminalCardContent/);
  assert.match(source, /obj\.status === 'retired'/);
  // 契约修正（2026-10-19）：这里的旧断言要求源码中出现
  // `obj.disposition_summary?.trim()`——而 ADR 终态卡**本来就正确地**读
  // `retirement_reason`（22 §9 闭集），`disposition_summary` 是不属该闭集的
  // v4 键。断言一个不该存在的调用，等于把缺陷写进契约：谁要按规范修正代码，
  // 就得先弄绿这条测试，从而被推回去读已废弃的键。现改为断言真实承载字段。
  assert.match(source, /function AdrTerminalCardContent[\s\S]{0,700}?obj\.retirement_reason/,
    'retired ADR 的终态原因由 retirement_reason 承载（22 §9）');
  const adrCard = source.slice(source.indexOf('function AdrTerminalCardContent'), source.indexOf('export function AdrCardContent'));
  // 只禁「读字段」的代码形态，不禁注释：函数内注释本就写着「v4 disposition_summary
  // 已不属 ADR 字段闭集」，禁词会连正确的说明一起判红。
  assert.doesNotMatch(adrCard, /obj\.disposition_summary/, 'ADR 终态卡不得读 v4 disposition_summary');
  assert.match(source, /currentType === 'adr'[\s\S]*showNonActiveReason=\{false\}[\s\S]*AdrCardContent/);
});
