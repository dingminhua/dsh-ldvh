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
  assert.match(panelContent, /target=\{objectId\}/);
  assert.doesNotMatch(associations, /ObjectReferenceCopyButton/);
  assert.match(associations, /objectType=\{locator\.factTypeKey\} size="xs"/);
  assert.match(workcaseReading, /<ObjectReferenceCopyButton projectId=\{projectId\} objectId=\{objectId\}/);
  assert.match(referenceCard, /<ObjectReferenceCopyButton projectId=\{selectedProjectId\} objectId=\{refId\}/);

  for (const source of [associations, workcaseReading, referenceCard]) {
    assert.doesNotMatch(source, /CopyPathButton path=\{(?:canonicalPath|info\?\.path)\}/);
  }
});
