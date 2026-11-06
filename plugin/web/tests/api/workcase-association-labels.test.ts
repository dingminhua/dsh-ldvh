import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UI_LOCALES, type Locale, type LocaleKey } from '../../src/i18n/locales.ts';
import { workCaseAssociationLabels } from '../../src/utils/workcaseAssociationLabels.ts';
import type { WorkCaseAssociationGroup } from '../../src/utils/workcaseAssociationGroups.ts';

const translate = (locale: Locale) => (key: LocaleKey, params?: Record<string, string>) => {
  let text: string = UI_LOCALES[locale][key];
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, value);
  return text;
};

function group(overrides: Partial<WorkCaseAssociationGroup> = {}): WorkCaseAssociationGroup {
  return {
    key: 'target',
    association: { available: false, target: { objectUid: 'sample' } },
    meanings: [],
    inlineIndex: null,
    identityConflict: false,
    ...overrides,
  };
}

// 2026-11-07 Human 裁定：卡面关联行**不再呈现方向与关系键标注**（「本单引用」「引用本单」
// 「关系：<key>」「去向：routed-to（按序候选）」全部下线）。下面第一组用例是本裁定的
// 行为锁：三条边齐备时，行内标注仍必须为空数组——**空数组是本案的正确结果，不是漏测**。
test('方向与关系键不再上行：三条边齐备时行内标注为空', () => {
  const sample = group({ meanings: [
    { kind: 'outgoing-ref' },
    { kind: 'incoming-ref' },
    { kind: 'relation', relationKey: 'contributed-to' },
  ] });
  assert.deepEqual(workCaseAssociationLabels(sample, translate('zh')), []);
  assert.deepEqual(workCaseAssociationLabels(sample, translate('en')), []);
});

test('去向候选位置也不再并存候选标注', () => {
  const inline = group({ meanings: [{ kind: 'relation', relationKey: 'routed-to' }], inlineIndex: 0 });
  assert.deepEqual(workCaseAssociationLabels(inline, translate('zh')), []);
  const unmatched = group({ meanings: [{ kind: 'relation', relationKey: 'routed-to' }] });
  assert.deepEqual(workCaseAssociationLabels(unmatched, translate('zh')), []);
});

// 身份冲突标注是**动作说明**而非方向语义（行不可点时读者须知道原因），故保留。
test('身份未确认时保留不可打开的说明', () => {
  const sample = group({ meanings: [{ kind: 'incoming-ref' }], identityConflict: true });
  assert.deepEqual(workCaseAssociationLabels(sample, translate('zh')), [
    { text: '身份未能确认，暂不可打开' },
  ]);
  assert.deepEqual(workCaseAssociationLabels(sample, translate('en')), [
    { text: 'Identity unconfirmed; cannot open' },
  ]);
});

test('配对不匹配提示不假定下方存在关联列表', () => {
  assert.equal(translate('zh')('objectList.workcaseAssociation.pairingMismatch'), '去向条目与关联目标数量不一致，未进行配对。');
  assert.equal(translate('en')('objectList.workcaseAssociation.pairingMismatch'), 'The numbers of direction entries and association targets differ; no pairing was made.');
});

// 词条本身已删（不是留作死键）：删键使 `LocaleKey` 在编译期拒绝恢复该标注的引用。
test('已下线的方向与关系键词条不得回归', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  const removed = [
    'objectList.workcaseAssociation.outgoing',
    'objectList.workcaseAssociation.incoming',
    'objectList.workcaseAssociation.relation',
    'objectList.workcaseAssociation.relationUnknown',
    'objectList.workcaseAssociation.routedTo',
    'objectList.workcaseAssociation.routedToCandidate',
  ] as const;
  for (const key of removed) {
    assert.equal(key in UI_LOCALES.zh, false, `zh 仍留有已下线的词条 ${key}`);
    assert.equal(key in UI_LOCALES.en, false, `en 仍留有已下线的词条 ${key}`);
  }
});
