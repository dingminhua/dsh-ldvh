// Tests for plugin/lib/friction-subagent-contract.js —
// 04 §8.4 第 1 项语义判断的承载契约（提示词 + outputSchema + 落地前校验）.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VERDICTS,
  discoveryOutputSchema,
  buildDiscoveryPrompt,
  validateDiscoveryVerdict,
} from "../lib/friction-subagent-contract.js";

const CANDIDATES = [
  { object_uid: "11111111-2222-4333-8444-555555555555", status: "observing", title: "CI 慢", phenomenon: "CI 平均 8 分钟。" },
  { object_uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", status: "open", title: "钩子依赖 PATH", phenomenon: "提交钩子找不到 node。" },
];

function verdict(overrides = {}) {
  return {
    verdict: "no-discovery",
    target_uid: "",
    title: "",
    phenomenon: "",
    basis: "",
    impact: "light",
    reason: "本次区间内没有出现反复出现的阻碍。",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// schema 形状（宿主支持的子集）
// ---------------------------------------------------------------------------

test("schema: object root，只有受支持的 JSON Schema 子集（无 oneOf/$ref 等扩展）", () => {
  const s = discoveryOutputSchema();
  assert.equal(s.type, "object");
  assert.ok(Array.isArray(s.required) && s.required.length > 0);
  assert.equal(s.additionalProperties, false, "多余字段必须交不出来（实测宿主在提交层拦）");
  // 宿主只支持 type/properties/required/additionalProperties/items/enum/description 等
  for (const key of Object.keys(s)) {
    assert.ok(["type", "properties", "required", "additionalProperties", "description"].includes(key), `unexpected top-level key ${key}`);
  }
  for (const [name, node] of Object.entries(s.properties)) {
    for (const key of Object.keys(node)) {
      assert.ok(["type", "enum", "description"].includes(key), `property ${name} uses unsupported construct ${key}`);
    }
  }
});

test("schema: verdict 的 enum 与模块导出的闭集同源（防规范与实现漂移）", () => {
  const s = discoveryOutputSchema();
  assert.deepEqual(s.properties.verdict.enum, [...VERDICTS]);
  assert.deepEqual([...VERDICTS], ["same-obstacle", "new-obstacle", "no-discovery"]);
});

test("schema: 所有字段都在 required 内（三态共用一套字段，跨态约束由落地侧校验）", () => {
  const s = discoveryOutputSchema();
  for (const name of Object.keys(s.properties)) {
    assert.ok(s.required.includes(name), `${name} must be required (宿主子集无条件 schema，故三态不填者交空串)`);
  }
});

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

test("prompt: 含阈值、候选清单与区间声明（§8.4 第 1 项的机械前提）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: CANDIDATES, window: { from: "seq 40", to: "seq 88" } });
  assert.match(prompt, /N=3/, "阈值必须写明");
  assert.ok(prompt.includes(CANDIDATES[0].object_uid), "候选 uid 必须可见（否则无从产出 target_uid）");
  assert.match(prompt, /seq 40/, "水位区间必须写明");
  assert.match(prompt, /seq 88/);
});

test("prompt: 明确禁止价值判断与 Human 决定项（§8.4 + §8.2 第 2/4 条）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: "自上次运行" });
  assert.match(prompt, /不取得授权或完成效力/);
  assert.match(prompt, /不得.*值不值得修|值不值得修/, "必须写出不得判断值不值得修");
  assert.match(prompt, /Human/, "必须点明哪些属外送 Human 的判断项");
});

test("prompt: 明确要求只判断区间内内容，且不得默默扩大范围（§8.4 水位段）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: "自 seq 40 起" });
  assert.match(prompt, /只对该区间内的新增内容作判断/);
  assert.match(prompt, /如实声明/, "区间边界不明时须声明，不得默默扩大");
});

test("prompt: 空候选时如实说明（避免子代理误报 same-obstacle）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: "x" });
  assert.match(prompt, /没有 open\/observing 账目/);
  assert.match(prompt, /只能是 new-obstacle/);
});

test("prompt: 未给出区间时要求子代理声明其边界（不自行假定）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [] });
  assert.match(prompt, /若未给出/);
  assert.match(prompt, /声明/);
});

test("prompt: 不得由子代理自行数 count（计数属机械层）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: CANDIDATES, window: "w" });
  assert.match(prompt, /不得自己数 count/);
});

// ---------------------------------------------------------------------------
// 落地前校验（跨态约束）
// ---------------------------------------------------------------------------

test("validate: no-discovery 合法（其余字段可为空串）", () => {
  const r = validateDiscoveryVerdict(verdict(), { candidates: CANDIDATES });
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.verdict, "no-discovery");
});

test("validate: verdict 越界被拒", () => {
  const r = validateDiscoveryVerdict(verdict({ verdict: "maybe" }), { candidates: CANDIDATES });
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/verdict_out_of_set");
});

test("validate: same-obstacle 缺 target_uid 被拒", () => {
  const r = validateDiscoveryVerdict(verdict({ verdict: "same-obstacle", target_uid: "" }), { candidates: CANDIDATES });
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/target_uid_missing");
});

test("validate: same-obstacle 指向本次未提供的 uid 被拒（只能指它见过的账目）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "same-obstacle", target_uid: "99999999-8888-4777-8666-555555555555" }),
    { candidates: CANDIDATES },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/target_uid_unknown");
});

test("validate: same-obstacle 指向候选内的 uid 通过", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "same-obstacle", target_uid: CANDIDATES[0].object_uid }),
    { candidates: CANDIDATES },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.target_uid, CANDIDATES[0].object_uid);
});

test("validate: new-obstacle 必填字段逐个缺失均被拒", () => {
  for (const field of ["title", "phenomenon", "basis"]) {
    const r = validateDiscoveryVerdict(
      verdict({ verdict: "new-obstacle", title: "T", phenomenon: "P 现象。", basis: "B 依据。", [field]: "" }),
      { candidates: CANDIDATES },
    );
    assert.ok(!r.ok, `${field} missing must be rejected`);
    assert.equal(r.error.code, `discovery/${field}_missing`);
  }
});

test("validate: new-obstacle 的 impact 必须在闭集内", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "new-obstacle", title: "T", phenomenon: "P。", basis: "B。", impact: "critical" }),
    { candidates: CANDIDATES },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/impact_out_of_set");
});

test("validate: new-obstacle 的 title 超 30 字被拒（26 §8）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "new-obstacle", title: "x".repeat(31), phenomenon: "P。", basis: "B。" }),
    { candidates: CANDIDATES },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/title_too_long");
});

test("validate: reason 必填（须指回本次区间）", () => {
  const r = validateDiscoveryVerdict(verdict({ reason: "   " }), { candidates: CANDIDATES });
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/reason_missing");
});

test("validate: 非对象输入被拒（结构化通道理论上交不出，仍须兜底）", () => {
  for (const bad of [null, undefined, "text", 42]) {
    const r = validateDiscoveryVerdict(bad, { candidates: [] });
    assert.ok(!r.ok, `${JSON.stringify(bad)} must be rejected`);
    assert.equal(r.error.code, "discovery/verdict_malformed");
  }
});

test("validate: 通过时返回已 trim 的规范形态", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "new-obstacle", title: "  带空格的标题  ", phenomenon: " P。 ", basis: " B。 " }),
    { candidates: CANDIDATES },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.title, "带空格的标题");
  assert.equal(r.value.phenomenon, "P。");
  assert.equal(r.value.basis, "B。");
});
