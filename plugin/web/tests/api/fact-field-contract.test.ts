import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACT_FIELD_CONTRACT, FACT_LIST_FIELD_NAMES, FACT_TERMINAL_STATUSES, FACT_TYPES } from '../../api/services/factFieldContract.ts';


const FIELD_EXPECTATIONS = new Set(['string', 'number', 'array', 'object']);
const COMMON_FIELDS = [
  'object_uid',
  'object_id',
  'fact_type_key',
  'title',
  'status',
  'created_at',
  'change_log',
  'urls',
  'relations',
] as const;
const COMMON_FIELD_EXEMPTIONS: Record<string, readonly string[]> = {
  spark: ['urls'],
  subgoal: ['urls', 'relations'],
};

const TYPE_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  pitfall: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'scope'],
  spark: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'question', 'scope_boundary', 'intent', 'summary'],
  report: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'report_form'],
  friction: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'phenomenon'],
  norm: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'direction_key'],
  subgoal: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'parent_goal', 'criterion', 'criterion_kind', 'alignment'],
};

test('field contract is internally consistent for every fact type', () => {
  assert.deepEqual(FACT_TYPES, ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal']);

  for (const type of FACT_TYPES) {
    const contract = FACT_FIELD_CONTRACT[type];
    const fields = Object.entries(contract);

    for (const [path, entry] of fields) {
      assert.ok(path.length > 0, `${type} 字段路径不能为空`);
      assert.ok(entry.fieldKey.length > 0, `${type}.${path} 必须引用有效 field_key`);
      assert.ok(FIELD_EXPECTATIONS.has(entry.expected), `${type}.${path} 期望类型必须在闭集内`);
      assert.equal(typeof entry.required, 'boolean', `${type}.${path} required 必须是布尔`);
    }

    const exempted = COMMON_FIELD_EXEMPTIONS[type] ?? [];
    for (const common of COMMON_FIELDS) {
      if (exempted.includes(common)) continue;
      assert.ok(common in contract, `${type} 必须携带公共字段 ${common}`);
    }

    for (const field of TYPE_REQUIRED_FIELDS[type]) {
      assert.equal(contract[field]?.required, true, `${type} 必填面应包含 ${field}`);
    }
  }
});

test('report keeps report_body only in detail, never in list projection', () => {
  assert.equal(FACT_FIELD_CONTRACT.report.report_body.required, false);

  assert.ok(!FACT_LIST_FIELD_NAMES.report.includes('report_body'));
  assert.ok(FACT_LIST_FIELD_NAMES.report.includes('research_question'));
});

test('report: report_form is the only unconditionally required typed field (24 §8)', () => {
  assert.equal(FACT_FIELD_CONTRACT.report.report_form.required, true);
  assert.equal(FACT_FIELD_CONTRACT.report.research_question.required, false);
  assert.equal(FACT_FIELD_CONTRACT.report.research_purpose.required, false);
  assert.ok(!('serves' in FACT_FIELD_CONTRACT.report), 'report 不应登记 serves（Human 决定：仅 Spark 关联 SubGoal）');
});

test('spark carries the 20-spec field closure without v4 leftovers', () => {
  assert.ok(!('urls' in FACT_FIELD_CONTRACT.spark), 'spark 不应登记 urls');
  assert.ok(!('disposition_summary' in FACT_FIELD_CONTRACT.spark), 'spark 不应登记 disposition_summary');

  assert.equal(FACT_FIELD_CONTRACT.spark.serves.expected, 'string');
  assert.equal(FACT_FIELD_CONTRACT.spark.serves.required, false);
  assert.equal(FACT_FIELD_CONTRACT.spark.priority.expected, 'string');
  assert.equal(FACT_FIELD_CONTRACT.spark.priority.required, false);
  assert.equal(FACT_FIELD_CONTRACT.spark.disposition.expected, 'string');
  assert.equal(FACT_FIELD_CONTRACT.spark.disposition.required, false);
  assert.equal(FACT_FIELD_CONTRACT.spark.evolution.expected, 'array');
  assert.ok(!FACT_LIST_FIELD_NAMES.spark.includes('report_body'));
  assert.ok(FACT_LIST_FIELD_NAMES.spark.includes('question'));
  assert.ok(FACT_LIST_FIELD_NAMES.spark.includes('serves'));
});

test('list candidates are a declared subset of each type contract', () => {
  for (const type of ['pitfall', 'spark', 'report'] as const) {
    const names = FACT_LIST_FIELD_NAMES[type];
    assert.ok(names.length > 0, `${type} 列表投影不应为空`);
    assert.ok(names.every((name) => name in FACT_FIELD_CONTRACT[type]), `${type} 列表字段必须是契约已登记字段`);
  }
});

test('terminal status closures are non-empty and cover each lifecycle', () => {
  for (const type of FACT_TYPES) {
    const terminals = FACT_TERMINAL_STATUSES[type];
    assert.ok(terminals.length > 0, `${type} 终态闭集不能为空`);
    assert.equal(new Set(terminals).size, terminals.length, `${type} 终态闭集不应有重复`);
  }
  assert.deepEqual(FACT_TERMINAL_STATUSES.pitfall, ['discarded']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.spark, ['implemented', 'discarded']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.report, ['retired']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.friction, ['resolved', 'voided']);
  assert.ok(!FACT_TERMINAL_STATUSES.friction.includes('observing'),
    'observing 已退出 26 §9 闭集，不得出现在摩擦终态集里');
});
test('friction registers attribution_ref as an object reference (26 §8/§11)', () => {
  assert.equal(FACT_FIELD_CONTRACT.friction.attribution_ref.expected, 'object');
  assert.equal(FACT_FIELD_CONTRACT.friction.attribution_ref.required, false);
  assert.equal(FACT_FIELD_CONTRACT.friction.attribution.expected, 'string');
  assert.ok(FACT_LIST_FIELD_NAMES.friction.includes('attribution_ref'));
});
