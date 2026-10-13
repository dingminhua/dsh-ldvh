// Tests for 36 §10（经验积累）的两个实现切片：
//   - lib/experience-capture-contract.js（提示词段 / 输出 schema / 落地前校验）
//   - lib/experience-landing.js（机械通道的落地：仅建 draft 候选）
//
// 权威：specs/36 §10（含「机械通道的边界」）与 specs/23（Pitfall 事实类型）。
// 断言的是规范行为；实现与规范不符时在任务报告里如实登记，不靠改断言「修正」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { testSignature, withTemp } from "./helpers.mjs";
import {
  CAPTURE_VERDICTS,
  REQUIRED_BODY_SECTIONS,
  buildCapturePromptSection,
  captureOutputSchema,
  validateCaptureVerdict,
} from "../lib/experience-capture-contract.js";
import { landCaptureVerdict, residualFromCaptureError } from "../lib/experience-landing.js";
import { listPitfallObjects } from "../lib/pitfall-writer.js";

const TEST_SIGNATURE = testSignature();
const SCOPE = "适用范围：本仓库依赖升级场景；经验可信于同版本组合，跨大版本需重审。";
const WINDOW = "本次材料原文：升级后解析失败反复出现，清理缓存后恢复。";

function goodBody(scope = SCOPE) {
  return [
    "## 症状", "升级后出现重复的解析失败，报错指向同一异常签名。",
    "## 触发条件", "升级依赖到新大版本后首次运行归档读取流程时触发。",
    "## 根因", "依赖内部缓存键变更，旧缓存未失效导致重复命中失败路径。",
    "## 解决", "升级后清理缓存并重建索引；成功信号是读取流程连续通过。",
    "## 规避", "后续升级前先比对缓存键语义；升级批次内同步清理。",
    "## 验证", "已在测试环境观察 3 次连续成功；未覆盖多租户并发升级场景。",
    "## 影响与适用范围", `${scope}\n展开：何时可能踩到、经验何时可信。`,
  ].join("\n\n");
}

function goodVerdict(overrides = {}) {
  return {
    verdict: "new-experience",
    title: "缓存键变更致解析失败",
    scope: SCOPE,
    body: goodBody(),
    failure_observed: "会话留痕：同一异常签名出现 3 次",
    root_cause_known: "依赖缓存键语义变更使旧缓存未失效",
    resolution_adopted: "清理缓存并重建索引",
    verification_observed: "已在测试环境观察 3 次连续成功；未覆盖并发升级",
    duplicate_of: "",
    quote: "升级后解析失败反复出现",
    reason: "该失败已实际发生、根因已查明、解法已采用且有观察",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 契约：闭集与 schema
// ---------------------------------------------------------------------------

test("36 §10：判定态是闭集两值（无阈值流转，故不像摩擦那样需要 same-obstacle）", () => {
  assert.deepEqual([...CAPTURE_VERDICTS], ["new-experience", "no-capture"]);
});

test("36 §10 / 23 §8：输出 schema 的必填字段含四项前提各自的陈述", () => {
  const schema = captureOutputSchema();
  assert.deepEqual([...schema.required], ["verdict", "title", "scope", "body", "quote", "reason"]);
  for (const f of ["failure_observed", "root_cause_known", "resolution_adopted", "verification_observed"]) {
    assert.ok(schema.properties[f] !== undefined, `${f} 须在 schema 内（四前提各自的陈述）`);
  }
  assert.equal(schema.additionalProperties, false);
});

test("36 §10：提示词段自足——含四前提与七段要求", () => {
  const section = buildCapturePromptSection();
  for (const kw of ["四前提", ...REQUIRED_BODY_SECTIONS, "no-capture", "不要写 H1"]) {
    assert.ok(section.includes(kw), `提示词段须说明「${kw}」`);
  }
  // 既有对象为空时须显式说明（否则执行体不知道是「没有」还是「没给它」）
  assert.ok(section.includes("当前没有"));
});

test("36 §10：提示词段列出既有对象（查重比对对象）", () => {
  const section = buildCapturePromptSection({
    existing: [{ object_uid: "u-1", status: "draft", title: "既有经验甲" }],
  });
  assert.ok(section.includes("u-1"), "既有对象的 uid 须出现");
  assert.ok(section.includes("既有经验甲"));
  assert.ok(section.includes("draft"), "状态须出现（active 与 draft 都是查重对象）");
});

// ---------------------------------------------------------------------------
// 契约：落地前校验
// ---------------------------------------------------------------------------

test("36 §10：合法候选通过（四前提齐 + 七段齐）", () => {
  const r = validateCaptureVerdict(goodVerdict(), { windowText: WINDOW });
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.verdict, "new-experience");
});

test("36 §10：非空材料下「无候选」也必须引证（否则恒报无候选不可见）", () => {
  const r = validateCaptureVerdict({ verdict: "no-capture", quote: "", reason: "r" }, { windowText: WINDOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "capture/quote_missing");
});

test("36 §10：引证必须真在材料内（不得取自材料外）", () => {
  const r = validateCaptureVerdict(goodVerdict({ quote: "这段话不在材料里" }), { windowText: WINDOW });
  assert.equal(r.ok, false, "引证不在材料内须被拒");
});

test("36 §10：缺任一前提陈述即不构成候选", () => {
  for (const f of ["failure_observed", "root_cause_known", "resolution_adopted", "verification_observed"]) {
    const r = validateCaptureVerdict(goodVerdict({ [f]: "" }), { windowText: WINDOW });
    assert.equal(r.ok, false, `${f} 为空须被拒`);
    assert.equal(r.error.code, `capture/${f}_missing`);
  }
});

test("36 §10 / 23 §8：正文七段须按序齐备且各段非空", () => {
  const missing = validateCaptureVerdict(goodVerdict({ body: goodBody().replace("## 规避", "## 别的") }), { windowText: WINDOW });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "capture/body_section_missing");

  const empty = validateCaptureVerdict(goodVerdict({ body: goodBody().replace("依赖内部缓存键变更，旧缓存未失效导致重复命中失败路径。", "") }), { windowText: WINDOW });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "capture/body_section_empty");
});

test("36 §10：正文不得用占位符冒充（写不出该段说明四前提未齐）", () => {
  const r = validateCaptureVerdict(goodVerdict({ body: goodBody().replace("依赖内部缓存键变更，旧缓存未失效导致重复命中失败路径。", "待查明") }), { windowText: WINDOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "capture/body_placeholder");
});

test("36 §10：正文不得自带 H1（标题由 title 生成）", () => {
  const r = validateCaptureVerdict(goodVerdict({ body: `# 标题\n\n${goodBody()}` }), { windowText: WINDOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "capture/body_has_h1");
});

test("36 §10：报「已存在」时 duplicate_of 须指向本次交给它的对象", () => {
  const bad = validateCaptureVerdict(
    { verdict: "no-capture", quote: "升级后解析失败反复出现", reason: "r", duplicate_of: "11111111-1111-4111-8111-111111111111" },
    { windowText: WINDOW, existing: [] },
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "capture/duplicate_of_unknown");

  const ok = validateCaptureVerdict(
    { verdict: "no-capture", quote: "升级后解析失败反复出现", reason: "r", duplicate_of: "u-1" },
    { windowText: WINDOW, existing: [{ object_uid: "u-1" }] },
  );
  assert.ok(ok.ok, JSON.stringify(ok.error));
  assert.equal(ok.value.duplicateOf, "u-1");
});

test("23 §8：title 上限 30 字", () => {
  const r = validateCaptureVerdict(goodVerdict({ title: "字".repeat(31) }), { windowText: WINDOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "capture/title_too_long");
});

// ---------------------------------------------------------------------------
// 落地：机械通道的边界（36 §10）
// ---------------------------------------------------------------------------

test("36 §10：机械通道只建 draft——初态绝不是 active", async () => {
  await withTemp("experience-landing.", async (root) => {
    const landed = await landCaptureVerdict({
      factSourceRoot: root,
      verdict: { verdict: "new-experience", title: "缓存键变更致解析失败", scope: SCOPE, body: goodBody() },
      observationAt: "2026-10-14T00:00:00.000Z",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(landed.ok, JSON.stringify(landed.error));
    assert.equal(landed.value.action, "candidate-created");

    const raw = await readFile(join(root, "pitfalls", `pitfall-${landed.value.object_uid}.md`), "utf8");
    const fm = parseYaml(raw.slice(4, raw.indexOf("\n---\n", 5)));
    assert.equal(fm.status, "draft", "机械通道的初态必须是 draft（入档属 Human Gate，23 §16.1）");
    assert.equal(fm.disposition, undefined, "draft 是非终态，不得带 disposition");
  });
});

test("36 §10：建出的 draft 不进默认候选，但待确认队列能枚举它", async () => {
  await withTemp("experience-landing.", async (root) => {
    await landCaptureVerdict({
      factSourceRoot: root,
      verdict: { verdict: "new-experience", title: "缓存键变更致解析失败", scope: SCOPE, body: goodBody() },
      sessionSignature: TEST_SIGNATURE,
    });
    const def = await listPitfallObjects({ factSourceRoot: root });
    assert.equal(def.value.items.length, 0, "draft 不得进入默认候选（23 §12）");
    const queue = await listPitfallObjects({ factSourceRoot: root, statusFilter: ["draft"] });
    assert.equal(queue.value.items.length, 1, "待确认队列须能枚举该候选");
  });
});

test("36 §10：无候选时不建、不改、不记账", async () => {
  await withTemp("experience-landing.", async (root) => {
    const landed = await landCaptureVerdict({
      factSourceRoot: root,
      verdict: { verdict: "no-capture", duplicateOf: "" },
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(landed.ok);
    assert.equal(landed.value.action, "none");
    assert.equal((await listPitfallObjects({ factSourceRoot: root, statusFilter: ["draft"] })).value.items.length, 0);
  });
});

test("36 §10：查重命中如实登记（不改既有对象）", async () => {
  await withTemp("experience-landing.", async (root) => {
    const landed = await landCaptureVerdict({
      factSourceRoot: root,
      verdict: { verdict: "no-capture", duplicateOf: "u-existing" },
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(landed.ok);
    assert.equal(landed.value.action, "duplicate-registered");
    assert.equal(landed.value.object_uid, "u-existing");
  });
});

test("09 机械签名：无署名载体即拒绝写入（不得无签名记账）", async () => {
  await withTemp("experience-landing.", async (root) => {
    const landed = await landCaptureVerdict({
      factSourceRoot: root,
      verdict: { verdict: "new-experience", title: "t", scope: SCOPE, body: goodBody() },
      sessionSignature: null,
    });
    assert.equal(landed.ok, false);
    assert.match(landed.error.code, /signature/);
  });
});

test("落地失败须保留完整诊断（issues 明细不得只留 message）", () => {
  const residual = residualFromCaptureError({
    code: "pitfall/body_invalid",
    message: "updated body failed structure checks",
    cause: { details: { issues: ["缺 根因 段", "缺 验证 段"] } },
  });
  assert.ok(residual.some((l) => l.includes("pitfall/body_invalid")));
  assert.ok(residual.some((l) => l.includes("缺 根因 段")), "逐条 issues 须保留");
});
