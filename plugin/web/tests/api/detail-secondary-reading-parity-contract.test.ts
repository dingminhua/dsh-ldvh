import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

test('full detail and secondary reading use one fact-reading body', () => {
  const detail = readFileSync(path.join(repositoryRoot, 'web/src/pages/ObjectDetail.tsx'), 'utf8');
  const panel = readFileSync(
    path.join(repositoryRoot, 'web/src/components/reading-panel/PanelContent.tsx'),
    'utf8',
  );

  assert.match(detail, /export function FactReadingContent/);
  assert.match(detail, /export function FactReadFailureContent/);
  assert.match(detail, /<FieldIssuesSection value=\{obj\.field_issues\} \/>/);
  assert.match(detail, /<UnparsedStructuresSection value=\{obj\.unparsed_structures\} \/>/);
  // YAML 源节点（2026-09-16 推广后不再按 objType/carrier 白名单挑选，故此处
  // 直接断言节点本体与来源选择逻辑，不再以 carrier === 'yaml' 代指其存在）。
  assert.match(detail, /<YamlDataNode/);
  assert.match(detail, /typeof obj\.yaml_source === 'string'/);
  assert.match(panel, /import \{[\s\S]*?FactReadingContent[\s\S]*?\} from '@\/pages\/ObjectDetail';/);
  assert.match(panel, /<FactReadingContent[\s\S]*?carrier=\{readMeta\.carrier\}/);
  assert.match(panel, /<FactReadFailureContent type=\{objectType\} id=\{objectId\} meta=\{meta\} \/>/);
  assert.doesNotMatch(panel, /function ObjectSemanticPreview|function GenericObjectPreview/);
});
