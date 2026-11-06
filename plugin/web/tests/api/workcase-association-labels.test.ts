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

test('中英文标注准确区分本单引用、反向引用和正式关系', () => {
  const sample = group({ meanings: [
    { kind: 'outgoing-ref' },
    { kind: 'incoming-ref' },
    { kind: 'relation', relationKey: 'contributed-to' },
  ] });
  assert.deepEqual(workCaseAssociationLabels(sample, translate('zh')).map((label) => label.text), [
    '本单引用', '引用本单', '关系：contributed-to',
  ]);
  assert.deepEqual(workCaseAssociationLabels(sample, translate('en')).map((label) => label.text), [
    'WorkCase references', 'References WorkCase', 'Relation: contributed-to',
  ]);
});

test('去向仅在按序候选位置标明候选，未配对和未知键不冒领', () => {
  const meanings: WorkCaseAssociationGroup['meanings'] = [
    { kind: 'relation', relationKey: 'routed-to' },
    { kind: 'relation', relationKey: null },
  ];
  const inline = workCaseAssociationLabels(group({ meanings, inlineIndex: 0 }), translate('zh'));
  assert.deepEqual(inline, [
    { text: '去向：routed-to（按序候选）', title: '去向按顺序候选配对，未经验证' },
    { text: '关系类型未标明' },
  ]);
  const unmatched = workCaseAssociationLabels(group({ meanings }), translate('zh'));
  assert.deepEqual(unmatched, [
    { text: '关系：routed-to' },
    { text: '关系类型未标明' },
  ]);
});

test('配对不匹配提示不假定下方存在关联列表', () => {
  assert.equal(translate('zh')('objectList.workcaseAssociation.pairingMismatch'), '去向条目与关联目标数量不一致，未进行配对。');
  assert.equal(translate('en')('objectList.workcaseAssociation.pairingMismatch'), 'The numbers of direction entries and association targets differ; no pairing was made.');
});

test('身份未确认时保留原有语义并明确提示不可打开', () => {
  const sample = group({ meanings: [{ kind: 'incoming-ref' }], identityConflict: true });
  assert.deepEqual(workCaseAssociationLabels(sample, translate('zh')).map((label) => label.text), [
    '引用本单', '身份未能确认，暂不可打开',
  ]);
});
