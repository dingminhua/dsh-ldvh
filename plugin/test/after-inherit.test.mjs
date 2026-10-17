// 契约测试：受控更新 after 完整性（specs/02 §10.5 实现对齐 / workcase-c36b0208 计划步骤 4）
//
// 本套测试锁定本单引入的**新契约**：update 路径的 frontmatter 由
// 「磁盘基线 + 显式声明变更 + 显式删除通道」构造——
//   · 漏传的字段**继承磁盘**（旧语义「省略即删除」已反转）；
//   · 删除必须经 frontmatter_removals 显式声明，且仅限该类型白名单；
//   · 白名单外字段一律拒绝且**零写入**；
//   · Code 托管字段不可经 after 覆盖、不可经 removals 删除；
//   · correct 路径不受影响。
//
// 8 组用例对应 21 §14 授权范围中的契约测试条目。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import {
  buildUpdateFrontmatter,
  FRONTMATTER_AFTER_DESCRIPTION,
  FRONTMATTER_REMOVALS_DESCRIPTION,
  CODE_MANAGED_FIELDS,
} from "../lib/after-integrity.js";
import {
  ADR_REMOVABLE_FIELDS,
} from "../lib/adr-writer.js";
import {
  FRICTION_REMOVABLE_FIELDS,
  createFrictionObject,
  readFrictionObject,
  updateFrictionObject,
} from "../lib/friction-writer.js";
import { GOAL_REMOVABLE_FIELDS } from "../lib/goal-writer.js";
import { NORM_REMOVABLE_FIELDS } from "../lib/norm-writer.js";
import { PITFALL_REMOVABLE_FIELDS } from "../lib/pitfall-writer.js";
import { RESEARCH_REMOVABLE_FIELDS } from "../lib/research-writer.js";
import { SPARK_REMOVABLE_FIELDS } from "../lib/spark-writer.js";

import { stripLeadingH1 } from "../lib/friction-discovery.js";
import { testSignature, withTemp } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// 各类型的 VALID_FM_KEYS（用于白名单自检；与 writer 内常量同源，此处独立列出
// 以免测试依赖 writer 的内部导出——若二者漂移，自检用例会失败）。
// ---------------------------------------------------------------------------
const VALID_FM_KEYS_BY_TYPE = {
  spark: new Set([
    "object_uid", "fact_type_key", "title", "created_at", "status",
    "question", "scope_boundary", "intent", "summary",
    "evolution", "serves", "refs", "priority", "disposition", "relations", "change_log",
  ]),
  friction: new Set([
    "object_uid", "fact_type_key", "title", "created_at", "status",
    "phenomenon", "attribution", "attribution_ref", "impact", "relations",
    "occurrence", "disposition", "change_log",
  ]),
  adr: new Set([
    "object_uid", "fact_type_key", "title", "created_at", "status",
    "decision", "scope", "trigger_signal", "urls",
    "relations", "retirement_reason", "retired_at", "change_log",
  ]),
  pitfall: new Set([
    "object_uid", "fact_type_key", "title", "created_at", "status",
    "scope", "trigger_signal", "urls", "disposition", "change_log",
  ]),
  research: new Set([
    "object_uid", "fact_type_key", "title", "created_at", "status",
    "urls", "relations", "change_log",
    "research_question", "research_purpose", "stopping_reason",
    "confirmed_statements", "uncertain", "gaps",
    "implications", "clarification_log",
    "retirement_reason", "retired_at",
  ]),
  norm: new Set([
    "object_uid", "fact_type_key", "title", "created_at", "status",
    "direction_key", "retirement_reason", "retired_at", "change_log",
  ]),
  goal: new Set(["goal_key", "title", "status", "created_at", "change_log"]),
};

const REMOVABLE_BY_TYPE = {
  spark: SPARK_REMOVABLE_FIELDS,
  friction: FRICTION_REMOVABLE_FIELDS,
  adr: ADR_REMOVABLE_FIELDS,
  pitfall: PITFALL_REMOVABLE_FIELDS,
  research: RESEARCH_REMOVABLE_FIELDS,
  norm: NORM_REMOVABLE_FIELDS,
  goal: GOAL_REMOVABLE_FIELDS,
};

/** 各类型的必填字段（白名单不得包含它们）。 */
const REQUIRED_BY_TYPE = {
  spark: ["object_uid", "fact_type_key", "title", "created_at", "status", "question", "scope_boundary", "intent", "summary"],
  friction: ["object_uid", "fact_type_key", "title", "created_at", "status", "phenomenon", "impact", "occurrence"],
  adr: ["object_uid", "fact_type_key", "title", "created_at", "status", "decision", "scope"],
  pitfall: ["object_uid", "fact_type_key", "title", "created_at", "status", "scope"],
  research: ["object_uid", "fact_type_key", "title", "created_at", "status", "research_question", "research_purpose", "stopping_reason"],
  norm: ["object_uid", "fact_type_key", "title", "created_at", "status", "direction_key"],
  goal: ["goal_key", "title", "status", "created_at"],
};

/** 终态伴随字段（update 路径不可达，白名单亦不得包含）。 */
const TERMINAL_COMPANION_FIELDS = new Set([
  "disposition", "relations", "retirement_reason", "retired_at",
]);

// ---------------------------------------------------------------------------
// 组 1：漏字段即继承（核心回归；含条件字段与必填字段）
// ---------------------------------------------------------------------------
test("after-inherit: 未携带的字段从磁盘基线继承，不被静默删除（含必填与条件字段）", () => {
  const baseline = {
    object_uid: "11111111-1111-4111-8111-111111111111",
    fact_type_key: "friction",
    title: "原始标题",
    created_at: "2026-01-01T00:00:00.000Z",
    status: "open",
    phenomenon: "CI 平均 8 分钟",
    attribution: "CI 子系统",     // 条件字段
    attribution_ref: { object_uid: "22222222-2222-4222-8222-222222222222" },
    impact: "medium",
    occurrence: { count: 1, first_at: "2026-01-01T00:00:00.000Z", last_at: "2026-01-01T00:00:00.000Z" },
    change_log: [{ at: "2026-01-01T00:00:00.000Z", summary: "首建" }],
  };

  // 只声明改 title —— 其余全部省略
  const built = buildUpdateFrontmatter({
    currentFrontmatter: baseline,
    frontmatterAfter: { title: "新标题" },
    frontmatterRemovals: null,
    removableFields: FRICTION_REMOVABLE_FIELDS,
    typeLabel: "friction",
    validFields: VALID_FM_KEYS_BY_TYPE.friction,
  });

  assert.equal(built.ok, true, "构造应成功");
  const fm = built.value;
  assert.equal(fm.title, "新标题", "声明的字段被覆盖");
  // 这就是本单的核心回归：旧实现下这些字段会被静默删除
  assert.equal(fm.phenomenon, "CI 平均 8 分钟", "必填字段 phenomenon 应继承");
  assert.equal(fm.impact, "medium", "必填字段 impact 应继承");
  assert.equal(fm.attribution, "CI 子系统", "条件字段 attribution 应继承");
  assert.deepEqual(fm.attribution_ref, { object_uid: "22222222-2222-4222-8222-222222222222" }, "条件字段 attribution_ref 应继承");
  assert.deepEqual(fm.occurrence, baseline.occurrence, "嵌套对象应继承");
  assert.equal(fm.status, "open", "status 应继承");

  // 基线对象未被污染（structuredClone 深拷贝）
  assert.equal(baseline.title, "原始标题", "CAS 基线对象不得被就地修改");
});

// ---------------------------------------------------------------------------
// 组 2：显式删除生效
// ---------------------------------------------------------------------------
test("after-inherit: frontmatter_removals 声明的字段被删除，未声明者保留", () => {
  const baseline = {
    object_uid: "33333333-3333-4333-8333-333333333333",
    fact_type_key: "friction",
    title: "t", created_at: "2026-01-01T00:00:00.000Z", status: "open",
    phenomenon: "p", impact: "light",
    occurrence: { count: 1, first_at: "2026-01-01T00:00:00.000Z", last_at: "2026-01-01T00:00:00.000Z" },
    attribution: "某子系统",
    attribution_ref: { object_uid: "44444444-4444-4444-8444-444444444444" },
  };

  const built = buildUpdateFrontmatter({
    currentFrontmatter: baseline,
    frontmatterAfter: null,
    frontmatterRemovals: ["attribution"],
    removableFields: FRICTION_REMOVABLE_FIELDS,
    typeLabel: "friction",
    validFields: VALID_FM_KEYS_BY_TYPE.friction,
  });

  assert.equal(built.ok, true);
  assert.equal(Object.hasOwn(built.value, "attribution"), false, "声明删除的字段应确实消失");
  assert.ok(Object.hasOwn(built.value, "attribution_ref"), "未声明的同类字段应保留");
  assert.equal(built.value.phenomenon, "p", "其余字段继承");
});

// ---------------------------------------------------------------------------
// 组 3：越界删除被拒（逐类型：白名单外 / 必填字段 / 终态伴随字段 / 托管字段）
// ---------------------------------------------------------------------------
test("after-inherit: 白名单外字段的删除声明被拒（逐类型，fail-closed）", () => {
  for (const [type, removable] of Object.entries(REMOVABLE_BY_TYPE)) {
    const valid = VALID_FM_KEYS_BY_TYPE[type];
    const required = REQUIRED_BY_TYPE[type];
    const baseline = { ...Object.fromEntries([...valid].map((k) => [k, k === "status" ? "open" : "x"])) };

    // (a) 白名单外、且是本类型合法字段
    const outside = [...valid].filter((k) => !removable.has(k) && !CODE_MANAGED_FIELDS.has(k));
    if (outside.length > 0) {
      const built = buildUpdateFrontmatter({
        currentFrontmatter: baseline,
        frontmatterAfter: null,
        frontmatterRemovals: [outside[0]],
        removableFields: removable,
        typeLabel: type,
        validFields: valid,
      });
      assert.equal(built.ok, false, `${type}: 白名单外的 ${outside[0]} 必须被拒`);
      assert.match(built.error.code, /removal_not_allowed$/, `${type}: 拒绝码应为 removal_not_allowed`);
    }

    // (b) 必填字段（必在白名单外，应被同一道闸拒绝）
    for (const req of required) {
      const built = buildUpdateFrontmatter({
        currentFrontmatter: baseline,
        frontmatterAfter: null,
        frontmatterRemovals: [req],
        removableFields: removable,
        typeLabel: type,
        validFields: valid,
      });
      assert.equal(built.ok, false, `${type}: 必填字段 ${req} 不得可删`);
    }

    // (c) 终态伴随字段
    for (const tc of TERMINAL_COMPANION_FIELDS) {
      if (!valid.has(tc)) continue;
      const built = buildUpdateFrontmatter({
        currentFrontmatter: baseline,
        frontmatterAfter: null,
        frontmatterRemovals: [tc],
        removableFields: removable,
        typeLabel: type,
        validFields: valid,
      });
      assert.equal(built.ok, false, `${type}: 终态伴随字段 ${tc} 不得可删`);
    }

    // (d) Code 托管字段
    for (const cm of CODE_MANAGED_FIELDS) {
      if (!valid.has(cm)) continue;
      const built = buildUpdateFrontmatter({
        currentFrontmatter: baseline,
        frontmatterAfter: null,
        frontmatterRemovals: [cm],
        removableFields: removable,
        typeLabel: type,
        validFields: valid,
      });
      assert.equal(built.ok, false, `${type}: 托管字段 ${cm} 不得可删`);
      assert.match(built.error.code, /removal_forbidden$/, `${type}: 托管字段拒绝码应为 removal_forbidden`);
    }
  }
});

// ---------------------------------------------------------------------------
// 组 4：合法转终态（spark open → discarded 时清除 priority）
// ---------------------------------------------------------------------------
test("after-inherit: spark 转终态时经 removals 清除 priority（本类型唯一必需的顶层删除）", () => {
  const baseline = {
    object_uid: "55555555-5555-4555-8555-555555555555",
    fact_type_key: "spark",
    title: "s", created_at: "2026-01-01T00:00:00.000Z",
    status: "open", priority: "P1",
    question: "q?", scope_boundary: "b", intent: "i", summary: "sum",
  };

  const built = buildUpdateFrontmatter({
    currentFrontmatter: baseline,
    frontmatterAfter: { status: "discarded" },
    frontmatterRemovals: ["priority"],
    removableFields: SPARK_REMOVABLE_FIELDS,
    typeLabel: "spark",
    validFields: VALID_FM_KEYS_BY_TYPE.spark,
  });

  assert.equal(built.ok, true);
  assert.equal(built.value.status, "discarded", "状态已转终态");
  assert.equal(Object.hasOwn(built.value, "priority"), false, "priority 已清除（20 §8：终态必须省略）");
});

// ---------------------------------------------------------------------------
// 组 5：合法嵌套清除（删除含嵌套结构的条件字段）
// ---------------------------------------------------------------------------
test("after-inherit: 删除携带嵌套结构的条件字段整体生效", () => {
  const baseline = {
    object_uid: "66666666-6666-4666-8666-666666666666",
    fact_type_key: "research",
    title: "r", created_at: "2026-01-01T00:00:00.000Z", status: "active",
    research_question: "q", research_purpose: "p", stopping_reason: "sufficient",
    gaps: [{ description: "g1", priority: "high" }],
    uncertain: [{ issue: "i1", reason: "r1" }],
    implications: [{ finding_ref: "f", implication: "im" }],
    clarification_log: [{ question: "cq", answer: "ca", answered_by: "human" }],
  };

  const built = buildUpdateFrontmatter({
    currentFrontmatter: baseline,
    frontmatterAfter: null,
    frontmatterRemovals: ["gaps", "uncertain"],
    removableFields: RESEARCH_REMOVABLE_FIELDS,
    typeLabel: "research",
    validFields: VALID_FM_KEYS_BY_TYPE.research,
  });

  assert.equal(built.ok, true);
  assert.equal(Object.hasOwn(built.value, "gaps"), false, "嵌套数组字段 gaps 应被整体删除");
  assert.equal(Object.hasOwn(built.value, "uncertain"), false, "嵌套数组字段 uncertain 应被整体删除");
  assert.ok(Array.isArray(built.value.implications), "未声明的 implications 应保留");
});

// ---------------------------------------------------------------------------
// 组 6：托管字段不可改（after 携带被忽略；removals 声明被拒）
// ---------------------------------------------------------------------------
test("after-inherit: Code 托管字段不接受调用方覆盖", () => {
  const baseline = {
    object_uid: "77777777-7777-4777-8777-777777777777",
    fact_type_key: "friction",
    title: "t", created_at: "2026-01-01T00:00:00.000Z", status: "open",
    phenomenon: "p", impact: "light",
    occurrence: { count: 1, first_at: "2026-01-01T00:00:00.000Z", last_at: "2026-01-01T00:00:00.000Z" },
    change_log: [{ at: "2026-01-01T00:00:00.000Z", summary: "原条目" }],
  };

  const built = buildUpdateFrontmatter({
    currentFrontmatter: baseline,
    frontmatterAfter: {
      object_uid: "99999999-9999-4999-8999-999999999999",
      created_at: "2020-01-01T00:00:00.000Z",
      change_log: [],
      title: "新",
    },
    frontmatterRemovals: null,
    removableFields: FRICTION_REMOVABLE_FIELDS,
    typeLabel: "friction",
    validFields: VALID_FM_KEYS_BY_TYPE.friction,
  });

  assert.equal(built.ok, true);
  assert.equal(built.value.object_uid, baseline.object_uid, "object_uid 不被调用方覆盖");
  assert.equal(built.value.created_at, baseline.created_at, "created_at 不被调用方覆盖");
  assert.deepEqual(built.value.change_log, baseline.change_log, "change_log 不被调用方覆盖");
  assert.equal(built.value.title, "新", "普通字段仍可覆盖");
});

// ---------------------------------------------------------------------------
// 组 7：correct 路径不受影响 + 同一键覆盖/删除冲突被拒
// ---------------------------------------------------------------------------
test("after-inherit: 同一键既覆盖又删除的声明自相矛盾，被拒", () => {
  const baseline = {
    object_uid: "88888888-8888-4888-8888-888888888888",
    fact_type_key: "friction", title: "t", created_at: "2026-01-01T00:00:00.000Z",
    status: "open", phenomenon: "p", impact: "light",
    occurrence: { count: 1, first_at: "2026-01-01T00:00:00.000Z", last_at: "2026-01-01T00:00:00.000Z" },
    attribution: "x",
  };

  const built = buildUpdateFrontmatter({
    currentFrontmatter: baseline,
    frontmatterAfter: { attribution: "y" },
    frontmatterRemovals: ["attribution"],
    removableFields: FRICTION_REMOVABLE_FIELDS,
    typeLabel: "friction",
    validFields: VALID_FM_KEYS_BY_TYPE.friction,
  });

  assert.equal(built.ok, false, "覆盖与删除同时声明应被拒");
  assert.match(built.error.code, /removals_conflict$/, "拒绝码应为 removals_conflict");
});

// ---------------------------------------------------------------------------
// 组 8：白名单自检（REMOVABLE ⊆ VALID；不含必填；不含终态伴随；描述为三向口径）
// ---------------------------------------------------------------------------
test("after-inherit: 白名单自检——⊆ VALID_FM_KEYS、不含必填与终态伴随字段", () => {
  for (const [type, removable] of Object.entries(REMOVABLE_BY_TYPE)) {
    const valid = VALID_FM_KEYS_BY_TYPE[type];
    for (const key of removable) {
      assert.ok(valid.has(key), `${type}: 白名单字段 ${key} 必须是本类型的合法字段（⊆ VALID_FM_KEYS）`);
      assert.equal(REQUIRED_BY_TYPE[type].includes(key), false, `${type}: 白名单不得包含必填字段 ${key}`);
      assert.equal(TERMINAL_COMPANION_FIELDS.has(key), false, `${type}: 白名单不得包含终态伴随字段 ${key}`);
      assert.equal(CODE_MANAGED_FIELDS.has(key), false, `${type}: 白名单不得包含托管字段 ${key}`);
    }
  }

  // 规范口径：norm 与 goal 白名单为空；spark 仅 priority/refs/serves
  assert.equal(NORM_REMOVABLE_FIELDS.size, 0, "norm 白名单应为空");
  assert.equal(GOAL_REMOVABLE_FIELDS.size, 0, "goal 白名单应为空");
  assert.deepEqual([...SPARK_REMOVABLE_FIELDS].sort(), ["priority", "refs", "serves"], "spark 白名单应为 priority/refs/serves");

  // 白名单含非本类型字段 → 必被 VALID 校验捕获（以 spark 字段混入 friction 为例）
  const built = buildUpdateFrontmatter({
    currentFrontmatter: { object_uid: "u", fact_type_key: "friction", title: "t", created_at: "c", status: "open" },
    frontmatterAfter: { priority: "P1" },  // priority 不是 friction 的字段
    frontmatterRemovals: null,
    removableFields: FRICTION_REMOVABLE_FIELDS,
    typeLabel: "friction",
    validFields: VALID_FM_KEYS_BY_TYPE.friction,
  });
  assert.equal(built.ok, false, "非本类型字段混入 after 应被闭集校验拒绝");

  // schema 描述已是三向口径
  assert.match(FRONTMATTER_AFTER_DESCRIPTION, /INHERITED/, "after 描述应声明继承语义");
  assert.doesNotMatch(FRONTMATTER_AFTER_DESCRIPTION, /complete target frontmatter \(all fields/, "after 描述不得再教「全字段展开」");
  assert.match(FRONTMATTER_REMOVALS_DESCRIPTION, /DELETE/, "removals 描述应声明删除语义");
});

// ---------------------------------------------------------------------------
// 端到端：经真实 writer 验证「漏字段不被删除」与「越界删除零写入」
// ---------------------------------------------------------------------------
test("after-inherit e2e: 经 friction writer 更新时漏传 attribution 不再丢失（本单修复的实测事故）", async () => {
  await withTemp("after-inherit-e2e.", async (base) => {
    const factSourceRoot = join(base, "facts");
    const created = await createFrictionObject({
      factSourceRoot,
      frontmatterDraft: {
        title: "局部改动时以记忆或截断输出为数据源",
        phenomenon: "改一处代码要连着改三处同类调用",
        impact: "medium",
        attribution: "主控会话",
        occurrence: { count: 1, first_at: "2026-10-16T00:00:00.000Z", last_at: "2026-10-16T00:00:00.000Z" },
      },
      bodyMarkdown: "## 现象\n改一处代码要连着改三处同类调用。\n\n## 入账依据\n实测。\n",
      sessionSignature: testSignature(),
    });
    assert.equal(created.ok, true, "fixture 创建失败: " + JSON.stringify(created.error));

    const read1 = await readFrictionObject({ factSourceRoot, objectUid: created.value.object_uid });
    assert.equal(read1.ok, true);
    assert.equal(read1.value.frontmatter.attribution, "主控会话", "前置：attribution 已在盘上");

    // 关键：只传 title（模拟 2026-10-16 漏抄 attribution 的那次销账调用）
    const updated = await updateFrictionObject({
      factSourceRoot,
      objectUid: created.value.object_uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: { title: "局部改动时以记忆或截断输出为数据源（修订）" },
      bodyMarkdownAfter: stripLeadingH1(read1.value.body),
      changeSummary: "只改标题",
      sessionSignature: testSignature(),
    });
    assert.equal(updated.ok, true, "更新失败: " + JSON.stringify(updated.error));

    const read2 = await readFrictionObject({ factSourceRoot, objectUid: created.value.object_uid });
    assert.equal(read2.ok, true);
    assert.equal(
      read2.value.frontmatter.attribution,
      "主控会话",
      "★ 核心回归：未携带的 attribution 必须继承，不得被静默删除",
    );
    assert.equal(read2.value.frontmatter.title, "局部改动时以记忆或截断输出为数据源（修订）", "声明的字段已更新");
  });
});

test("after-inherit e2e: 越界删除被拒且零写入", async () => {
  await withTemp("after-inherit-e2e2.", async (base) => {
    const factSourceRoot = join(base, "facts");
    const created = await createFrictionObject({
      factSourceRoot,
      frontmatterDraft: {
        title: "越界删除测试",
        phenomenon: "现象一句话",
        impact: "light",
        occurrence: { count: 1, first_at: "2026-10-16T00:00:00.000Z", last_at: "2026-10-16T00:00:00.000Z" },
      },
      bodyMarkdown: "## 现象\n现象一句话。\n\n## 入账依据\n实测。\n",
      sessionSignature: testSignature(),
    });
    assert.equal(created.ok, true);

    const read1 = await readFrictionObject({ factSourceRoot, objectUid: created.value.object_uid });
    const fileBefore = await readFile(read1.value.file, "utf-8");

    // phenomenon 是必填字段、不在白名单内
    const rejected = await updateFrictionObject({
      factSourceRoot,
      objectUid: created.value.object_uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: null,
      frontmatterRemovals: ["phenomenon"],
      bodyMarkdownAfter: stripLeadingH1(read1.value.body),
      changeSummary: "试图删除必填字段",
      sessionSignature: testSignature(),
    });
    assert.equal(rejected.ok, false, "越界删除必须被拒");
    assert.match(rejected.error.code, /removal_not_allowed$/, "拒绝码应为 friction/removal_not_allowed");

    // 零写入：文件逐字节未变
    const fileAfter = await readFile(read1.value.file, "utf-8");
    assert.equal(fileAfter, fileBefore, "被拒时不得发生任何写入");
  });
});
