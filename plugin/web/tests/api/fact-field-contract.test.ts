import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACT_FIELD_CONTRACT, FACT_LIST_FIELD_NAMES, FACT_TERMINAL_STATUSES, FACT_TYPES } from '../../api/services/factFieldContract.ts';

// v5 规范载体迁移：Web 消费字段契约的唯一强来源是 `api/services/factFieldContract.ts`
// 本身（fieldKey / expected / required），不再依赖 v4 归档的 `specs/attachments/05.Att.01`、
// `08.Att.01` 与 20–23 号类型规范文件（v5 已重构并散入 03/24 等规范）。
// 以下断言从代码模块自洽：验证契约内部一致性、类型必填面、终态闭集与生命周期。
//
// v5 现状边界：research 以 24 号调研规范薄索引承载（frontmatter 字段面 + 正文），
// 不提供 v4 档的"统一字段登记表 + 类型绑定"1:1 对账基准。

const FIELD_EXPECTATIONS = new Set(['string', 'number', 'array', 'object']);
// 所有类型共有的公共字段（03 §6.1：无公共 updated_at，变更由 change_log[].at 承担）。
// 例外：spark 不携带 urls（20 §10：悬置问题不直接接受外部证据，由 11 号调研
// 系统收集）——公共面按类型声明豁免，不做静默宽放。
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
};

// 每类型固定的必填面：这些字段被当前阅读面无条件消费。
const TYPE_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  workcase: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'goal', 'scope', 'success_criterion_definitions'],
  // 22 §8：decision/scope 必填（trigger_signal/retirement_reason/retired_at 条件）。
  adr: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'decision', 'scope'],
  // 23 §8：scope 必填（trigger_signal/disposition 条件；六要素住正文）。
  pitfall: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'scope'],
  // 20 §8：question/scope_boundary/intent/summary 必填（evolution/serves_sg/
  // disposition/relations 条件出现）。
  spark: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'question', 'scope_boundary', 'intent', 'summary'],
  research: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'research_question', 'research_purpose'],
};

test('field contract is internally consistent for every fact type', () => {
  assert.deepEqual(FACT_TYPES, ['workcase', 'adr', 'pitfall', 'spark', 'research']);

  for (const type of FACT_TYPES) {
    const contract = FACT_FIELD_CONTRACT[type];
    const fields = Object.entries(contract);

    // 每个字段都是一个有效登记项：稳定的 fieldKey + 闭集期望类型 + required 布尔。
    for (const [path, entry] of fields) {
      assert.ok(path.length > 0, `${type} 字段路径不能为空`);
      assert.ok(entry.fieldKey.length > 0, `${type}.${path} 必须引用有效 field_key`);
      assert.ok(FIELD_EXPECTATIONS.has(entry.expected), `${type}.${path} 期望类型必须在闭集内`);
      assert.equal(typeof entry.required, 'boolean', `${type}.${path} required 必须是布尔`);
    }

    // 每个类型都必须携带全部公共字段（豁免清单除外）。
    const exempted = COMMON_FIELD_EXEMPTIONS[type] ?? [];
    for (const common of COMMON_FIELDS) {
      if (exempted.includes(common)) continue;
      assert.ok(common in contract, `${type} 必须携带公共字段 ${common}`);
    }

    // 类型必填面全部成立。
    for (const field of TYPE_REQUIRED_FIELDS[type]) {
      assert.equal(contract[field]?.required, true, `${type} 必填面应包含 ${field}`);
    }
  }
});

test('research keeps report_body only in detail, never in list projection', () => {
  // 详情消费 report_body（仍登记，避免被误判为 unconsumed_field）。
  assert.equal(FACT_FIELD_CONTRACT.research.report_body.required, false);

  // 列表投影（FACT_LIST_FIELD_NAMES）不携带正文：research 列表不含 report_body。
  assert.ok(!FACT_LIST_FIELD_NAMES.research.includes('report_body'));
  assert.ok(FACT_LIST_FIELD_NAMES.research.includes('research_question'));
});

test('spark carries the 20-spec field closure without v4 leftovers', () => {
  // v4 遗留字段不进 v5 闭集：priority 不迁入（20 §14.2）、无 urls（§10）、
  // 终态去向由 disposition 承载而非 disposition_summary（§8）。
  assert.ok(!('priority' in FACT_FIELD_CONTRACT.spark), 'spark 不应登记 priority');
  assert.ok(!('urls' in FACT_FIELD_CONTRACT.spark), 'spark 不应登记 urls');
  assert.ok(!('disposition_summary' in FACT_FIELD_CONTRACT.spark), 'spark 不应登记 disposition_summary');

  // 20 §8 类型字段：serves_sg（SG-n 轻量锚点）/disposition（终态去向）条件出现。
  assert.equal(FACT_FIELD_CONTRACT.spark.serves_sg.expected, 'string');
  assert.equal(FACT_FIELD_CONTRACT.spark.serves_sg.required, false);
  assert.equal(FACT_FIELD_CONTRACT.spark.disposition.expected, 'string');
  assert.equal(FACT_FIELD_CONTRACT.spark.disposition.required, false);
  assert.equal(FACT_FIELD_CONTRACT.spark.evolution.expected, 'array');

  // 正文 report_body 只在详情阅读，不复制进列表投影（同 research）。
  assert.ok(!FACT_LIST_FIELD_NAMES.spark.includes('report_body'));
  assert.ok(FACT_LIST_FIELD_NAMES.spark.includes('question'));
  assert.ok(FACT_LIST_FIELD_NAMES.spark.includes('serves_sg'));
});

test('list candidates are a declared subset of each type contract', () => {
  for (const type of ['adr', 'pitfall', 'spark', 'research'] as const) {
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
  // 各类型的终态语义：workcase 关闭、决策退休、经验废弃、火花落实/废弃（20 §9
  // 状态闭集 open/implemented/discarded，implemented 与 discarded 均为终态）、调研退休。
  assert.deepEqual(FACT_TERMINAL_STATUSES.workcase, ['closed']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.adr, ['retired']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.pitfall, ['discarded']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.spark, ['implemented', 'discarded']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.research, ['retired']);
});