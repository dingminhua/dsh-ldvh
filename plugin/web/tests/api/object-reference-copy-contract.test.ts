import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('fact-object copy controls require the owning project and preserve the full object id', async () => {
  const { formatObjectReference } = await import('../../src/utils/objectReference.ts');
  assert.equal(formatObjectReference('sample', 'spark-0001'), 'sample@spark-0001');
  assert.equal(formatObjectReference('sample', 'spark-01KZXN5TXNEBSRC6HHGTBQKAJ4'), 'sample@spark-01KZXN5TXNEBSRC6HHGTBQKAJ4');
  assert.equal(formatObjectReference(undefined, 'spark-0001'), undefined);
  assert.equal(formatObjectReference('sample', undefined), undefined);
  assert.equal(formatObjectReference(undefined, undefined), undefined);
  const referenceButton = read('src/components/ObjectReferenceCopyButton.tsx');
  const referenceFormatter = read('src/utils/objectReference.ts');
  const identityActions = read('src/components/ObjectIdentityActions.tsx');
  const cognition = read('src/pages/CognitionCenter.tsx');
  const detail = read('src/pages/ObjectDetail.tsx');
  const associations = read('src/pages/object-detail/FactAssociationsSection.tsx');
  const workcaseReading = read('src/pages/object-detail/WorkCaseReadingLayout.tsx');
  const referenceCard = read('src/components/ReferenceCard.tsx');
  const panelContent = read('src/components/reading-panel/PanelContent.tsx');

  assert.match(referenceButton, /formatObjectReference\(projectId, objectId\)/);
  assert.doesNotMatch(referenceButton, /useProjectScope/);
  assert.match(referenceFormatter, /return `\$\{projectId\}@\$\{objectId\}`;/);
  assert.match(identityActions, /projectId=\{projectId\} objectId=\{target\}/);
  assert.match(cognition, /projectId=\{selectedProjectId\} objectId=\{item\.id\}/);
  assert.doesNotMatch(cognition, /formatObjectReference/);
  assert.match(detail, /target=\{objId\}/);
  assert.match(detail, /<ObjectReferenceCopyButton projectId=\{selectedProjectId\} objectId=\{value\}/);
  // 25 号 Goal 单例（Human 定案 2026-09-12）：面板复制目标对 goal 特判为
  // 目标 md 路径（projectId@ldvh-base/goal.md——路径即身份）；其余类型保持完整 objectId。
  assert.match(panelContent, /target=\{objectType === 'goal' \? readMeta\.canonicalPath \?\? objectId : objectId\}/);
  assert.doesNotMatch(associations, /ObjectReferenceCopyButton/);
  assert.match(associations, /objectType=\{locator\.factTypeKey\} size="xs"/);
  // 2026-09-17（WC 364df30e）：WorkCase 详情不再自持复制入口——复制归共享
  // ObjectIdentityHeader（docs/01 §1.8.1 身份头部契约），与其余六类阅读布局一致
  // （六类布局的复制入口数均为 0）。此前布局内重复渲染身份行与复制按钮，
  // 形成「详情页两套头部」。
  assert.doesNotMatch(workcaseReading, /ObjectReferenceCopyButton/);
  assert.doesNotMatch(workcaseReading, /status:\s*\{obj\.status\}/);
  assert.match(referenceCard, /<ObjectReferenceCopyButton projectId=\{selectedProjectId\} objectId=\{refId\}/);

  for (const source of [associations, workcaseReading, referenceCard]) {
    assert.doesNotMatch(source, /CopyPathButton path=\{(?:canonicalPath|info\?\.path)\}/);
  }
});
