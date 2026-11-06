import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

/**
 * Source-structure guard, not a browser layout test. The advice text and its
 * routed-to association must share a full-width flex child; as siblings they
 * compete for horizontal space and a long advice squeezes the target title.
 */
function hasStackedAdviceLayout(source: string): boolean {
  const file = ts.createSourceFile('WorkCaseClosedSummary.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const descendants = (root: ts.Node): ts.Node[] => {
    const found: ts.Node[] = [];
    const visit = (node: ts.Node) => { found.push(node); node.forEachChild(visit); };
    visit(root);
    return found;
  };
  const hasAttribute = (element: ts.JsxElement, name: string) =>
    element.openingElement.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText(file) === name);
  const classes = (element: ts.JsxElement): string[] => {
    const attr = element.openingElement.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'className');
    return attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer)
      ? attr.initializer.text.split(/\s+/)
      : [];
  };
  const rows = descendants(file).filter((node): node is ts.JsxElement => ts.isJsxElement(node) && hasAttribute(node, 'data-workcase-advice-kind'));
  return rows.length === 1 && rows[0].children.some((child) => {
    if (!ts.isJsxElement(child) || child.openingElement.tagName.getText(file) !== 'div') return false;
    const childClasses = classes(child);
    if (!childClasses.includes('min-w-0') || !childClasses.includes('flex-1') || childClasses.includes('flex')) return false;
    const containsBoth = (root: ts.Node): boolean => {
      const nodes = descendants(root);
      const text = nodes.some((node) => ts.isCallExpression(node) && node.expression.getText(file) === 'stripCardMarkdown' && node.arguments[0]?.getText(file) === 'item.text');
      const association = nodes.some((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'FactAssociationCardRow');
      return text && association;
    };
    const horizontal = descendants(child).some((node) => ts.isJsxElement(node)
      && classes(node).includes('flex') && !classes(node).includes('flex-col') && containsBoth(node));
    return containsBoth(child) && !horizontal;
  });
}

test('关闭工单的去向正文与关联对象同属可伸缩的整宽子块', () => {
  const file = resolve(import.meta.dirname, '../../src/components/WorkCaseClosedSummary.tsx');
  assert.equal(hasStackedAdviceLayout(readFileSync(file, 'utf8')), true);
});

test('布局守卫拒绝正文和关联对象并排的原故障形态', () => {
  const siblings = `const row = <div data-workcase-advice-kind="转入 Spark">
    <span>{stripCardMarkdown(item.text)}</span>
    <div className="mt-0.5 grid min-w-0 gap-0.5"><FactAssociationCardRow /></div>
  </div>;`;
  const stacked = `const row = <div data-workcase-advice-kind="转入 Spark">
    <div className="min-w-0 flex-1"><span>{stripCardMarkdown(item.text)}</span><FactAssociationCardRow /></div>
  </div>;`;
  const flexRow = stacked.replace('min-w-0 flex-1', 'min-w-0 flex-1 flex');
  const nestedFlexRow = `const row = <div data-workcase-advice-kind="转入 Spark">
    <div className="min-w-0 flex-1"><div className="flex"><span>{stripCardMarkdown(item.text)}</span><FactAssociationCardRow /></div></div>
  </div>;`;
  assert.equal(hasStackedAdviceLayout(siblings), false);
  assert.equal(hasStackedAdviceLayout(flexRow), false);
  assert.equal(hasStackedAdviceLayout(nestedFlexRow), false);
  assert.equal(hasStackedAdviceLayout(stacked), true);
});
