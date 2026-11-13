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
// 例外：spark 不携带 urls（20 §10：悬置问题不直接接受外部证据，由 30 号调研
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
  // 28 §11：子目标不采用 urls（判据与对齐住正文，不接外部证据链）与 relations
  //（层级只两层，上下游由 parent_goal 与 serves 反查派生，不建第二边）。
  subgoal: ['urls', 'relations'],
  // 29 §8 / §11：DevLog 不采用 urls（条目源自内部过程，不调查外部世界）与
  // refs（与工单的连接由**工单侧** refs 单向声明，条目侧不复制反向边）。
  // relations 仍采用（absorbed-into / superseded-by 两条终态边）。
  devlog: ['urls', 'refs'],
};

// 每类型固定的必填面：这些字段被当前阅读面无条件消费。
const TYPE_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  // 22 §8：decision/scope 必填（trigger_signal/retirement_reason/retired_at 条件）。
  adr: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'decision', 'scope'],
  // 23 §8：scope 必填（trigger_signal/disposition 条件；六要素住正文）。
  pitfall: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'scope'],
  // 20 §8：question/scope_boundary/intent/summary 必填（evolution/serves/
  // disposition/relations 条件出现）。
  spark: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'question', 'scope_boundary', 'intent', 'summary'],
  research: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'research_question', 'research_purpose'],
  // 26 §8：phenomenon 必填（attribution/relations 条件；原 impact 必填面随
  // 2026-11-02 撤销分级制度一并退出，26 §8 字段表）。
  friction: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'phenomenon'],
  // 27 号 §8：direction_key 必填（retirement_reason/retired_at 条件，retired 时必填）。
  norm: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'direction_key'],
  // 28 号 §8：parent_goal/criterion/criterion_kind/alignment 全必填（2026-11-01
  // 起 anchor 废止，order 为可选显示次序，故两者都不在必填面）——
  // 缺任一项，子目标就不再是「可判定 + 已声明对齐」的对象，退化成一句待办。
  subgoal: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'parent_goal', 'criterion', 'criterion_kind', 'alignment'],
  // 29 §8：occurred_at 与 summary 必填（serves/disposition 条件出现）。
  // occurred_at 是「该工作发生的时间」，与 created_at 不同轴（§10.4）——它缺失
  // 时间线索即失真，故与 summary 同为必填面。
  devlog: ['object_id', 'fact_type_key', 'title', 'status', 'created_at', 'occurred_at', 'summary'],
};

test('field contract is internally consistent for every fact type', () => {
  assert.deepEqual(FACT_TYPES, ['adr', 'pitfall', 'spark', 'research', 'friction', 'norm', 'subgoal', 'devlog']);

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
  // v4 遗留字段不进 v5 闭集：无 urls（20 §10）、终态去向由 disposition 承载
  // 而非 disposition_summary（§8）。priority 于 2026-09-13 由 Human 裁定新增
  // （20 §8，非 v4 迁移），故在此登记为存在字段。
  assert.ok(!('urls' in FACT_FIELD_CONTRACT.spark), 'spark 不应登记 urls');
  assert.ok(!('disposition_summary' in FACT_FIELD_CONTRACT.spark), 'spark 不应登记 disposition_summary');

  // 20 §8 类型字段：serves（SG-n 轻量锚点）/priority（悬置排序档位，条件出现）
  // /disposition（终态去向）均为条件字段。
  assert.equal(FACT_FIELD_CONTRACT.spark.serves.expected, 'string');
  assert.equal(FACT_FIELD_CONTRACT.spark.serves.required, false);
  assert.equal(FACT_FIELD_CONTRACT.spark.priority.expected, 'string');
  assert.equal(FACT_FIELD_CONTRACT.spark.priority.required, false);
  assert.equal(FACT_FIELD_CONTRACT.spark.disposition.expected, 'string');
  assert.equal(FACT_FIELD_CONTRACT.spark.disposition.required, false);
  assert.equal(FACT_FIELD_CONTRACT.spark.evolution.expected, 'array');
  // 正文 report_body 只在详情阅读，不复制进列表投影（同 research）。
  assert.ok(!FACT_LIST_FIELD_NAMES.spark.includes('report_body'));
  assert.ok(FACT_LIST_FIELD_NAMES.spark.includes('question'));
  assert.ok(FACT_LIST_FIELD_NAMES.spark.includes('serves'));
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
  // 各类型的终态语义：决策退休、经验废弃、火花落实/废弃（20 §9
  // 状态闭集 open/implemented/discarded，implemented 与 discarded 均为终态）、调研退休。
  assert.deepEqual(FACT_TERMINAL_STATUSES.adr, ['retired']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.pitfall, ['discarded']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.spark, ['implemented', 'discarded']);
  assert.deepEqual(FACT_TERMINAL_STATUSES.research, ['retired']);
  // 26 §9（2026-10 修订，Human 决定：观察不进事实源）：摩擦的状态闭集为三值
  // `open` / `resolved` / `voided`——原第四值 `observing` 已退出（观察材料改由
  // 11 §12bis.1 的摩擦观察缓冲承载，非事实对象）。故终态只有销账与废弃两值，
  // **不得**把已退出的 `observing` 登记成终态或非终态。
  assert.deepEqual(FACT_TERMINAL_STATUSES.friction, ['resolved', 'voided']);
  assert.ok(!FACT_TERMINAL_STATUSES.friction.includes('observing'),
    'observing 已退出 26 §9 闭集，不得出现在摩擦终态集里');
});
test('friction registers attribution_ref as an object reference (26 §8/§11)', () => {
  // 回归点：attribution_ref 原登记为 string，而真实载体
  // （ldvh-base/frictions/friction-abf557e1…md）写的是 {object_uid} 对象形态——
  // 读取层按 type_mismatch 静默丢弃该字段（Web 详情与 CLI 列表/详情三处全丢）。
  // 26 §8 字段表已订正为 object 形态（与 relations 的 target 同一承载），契约随之。
  assert.equal(FACT_FIELD_CONTRACT.friction.attribution_ref.expected, 'object');
  assert.equal(FACT_FIELD_CONTRACT.friction.attribution_ref.required, false);
  // 归因自由文本仍为 string（26 §8：不强制指向事实对象），两字段分工不变。
  assert.equal(FACT_FIELD_CONTRACT.friction.attribution.expected, 'string');
  // 列表投影携带 attribution_ref（F1 按归因机械聚合的输入，26 §12）。
  assert.ok(FACT_LIST_FIELD_NAMES.friction.includes('attribution_ref'));
});
