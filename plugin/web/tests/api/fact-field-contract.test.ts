import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { FACT_FIELD_CONTRACT, FACT_LIST_FIELD_NAMES, FACT_TYPES } from '../../api/services/factFieldContract.ts';

// v4 迁移适配：specs 根可用 LDVH_SPEC_ROOT 覆盖（默认保持 v4 布局的相对推算）。
const repositoryRoot = process.env.LDVH_SPEC_ROOT || path.resolve('..');
const attachment = readFileSync(path.join(repositoryRoot, 'specs/attachments/08.Att.01-Web API 阅读契约字段表.md'), 'utf8');
const registry = readFileSync(path.join(repositoryRoot, 'specs/attachments/05.Att.01-事实对象统一字段登记.md'), 'utf8');

function rowsAfter(source: string, heading: string): string[][] {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const lines = source.slice(start).split('\n');
  const tableStart = lines.findIndex((line) => line.startsWith('|'));
  assert.ok(tableStart >= 0, `missing table after: ${heading}`);
  const tableLines: string[] = [];
  for (const line of lines.slice(tableStart)) {
    if (!line.startsWith('|')) break;
    tableLines.push(line);
  }
  return tableLines.slice(2)
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

function codeValues(value: string): string[] {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

const registryByKey = new Map(rowsAfter(registry, '## 统一字段登记表').map((row) => [row[0].replace(/`/g, ''), row]));
const typeSpecs: Record<string, string> = {
  spark: '20-Spark-火花.md', workcase: '21-WorkCase-工作项.md', adr: '22-ADR-决策.md',
  pitfall: '23-Pitfall-踩坑经验.md', study: '24-Study-研究报告.md',
};

function boundPresence(type: string): Map<string, string> {
  const source = readFileSync(path.join(repositoryRoot, 'specs', typeSpecs[type]), 'utf8');
  return new Map(rowsAfter(source, '### 类型字段使用绑定').map((row) => [row[0].replace(/`/g, ''), row[1]]));
}

test('Web field contract is exactly the 05 registry and type bindings projected through 08', () => {
  const projectionRows = new Map(rowsAfter(attachment, '## 页面消费字段投影').map((row) => [row[0], row]));
  const identityCommon = ['object_uid', 'object_id', 'fact_type_key', 'title', 'status', 'created_at', 'updated_at'];

  for (const type of FACT_TYPES) {
    const bindings = boundPresence(type);
    const contract = FACT_FIELD_CONTRACT[type];
    const row = projectionRows.get(
      type === 'workcase' ? 'WorkCase'
        : type === 'adr' ? 'ADR'
          : `${type[0].toUpperCase()}${type.slice(1)}`,
    );
    assert.ok(row, `08 is missing ${type} projection`);
    const allowedCommon = [...identityCommon, 'urls', 'relations'];
    const projected = new Set([...allowedCommon, ...codeValues(row[1]), ...codeValues(row[2])]);
    assert.deepEqual(new Set(Object.keys(contract)), projected, `${type} must not add or lose a consumed field`);
    for (const [path, entry] of Object.entries(contract)) {
      if (path === 'report_body') {
        assert.equal(type, 'study');
        continue;
      }
      const registered = registryByKey.get(entry.fieldKey);
      assert.ok(registered, `${type}.${path} must reference a 05 field_key`);
      assert.equal(registered[2].replace(/`/g, ''), path, `${type}.${path} must retain its 05 field path`);
      assert.equal(entry.expected, registered[3] === 'integer' ? 'number' : registered[3], `${type}.${path} type drift`);
      assert.equal(entry.required, bindings.get(entry.fieldKey) === 'required', `${type}.${path} requiredness drift`);
    }
  }
});

test('non-WorkCase list candidates are a declared subset and omit the Study report body', () => {
  for (const type of ['adr', 'pitfall', 'spark', 'study'] as const) {
    const names = FACT_LIST_FIELD_NAMES[type];
    assert.ok(names.every((name) => name in FACT_FIELD_CONTRACT[type]));
  }
  assert.equal(FACT_LIST_FIELD_NAMES.study.includes('report_body'), false);
});
