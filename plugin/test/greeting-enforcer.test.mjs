
import test from "node:test";
import assert from "node:assert/strict";

import { createGreetingEnforcer, GREETING_PREFIX_ENFORCER_ID } from "../lib/greeting-enforcer.js";
import { GREETING_TEXT } from "../lib/greeting-text.js";
import { parseAssuranceDeclarations, assuranceSummaryOf } from "../lib/norm-assurance.js";

function makeCtx() {
  const listeners = {};
  return {
    listeners,
    on(event, handler) {
      (listeners[event] ??= []).push(handler);
      return () => { listeners[event] = listeners[event].filter((h) => h !== handler); };
    },
    logger: { info() {}, warn() {} },
  };
}

function makeScopes(map = {}) {
  return { get: (id) => map[id] };
}

async function* chunks(list) {
  for (const chunk of list) yield chunk;
}

async function runStream(ctx, options, upstreamChunks) {
  const handler = ctx.listeners["llm/stream"][0];
  const out = [];
  const iterable = handler.call({}, options, async () => chunks(upstreamChunks));
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

const governedScope = { state: "governed", project: { path: "/proj/a", id: "a" } };

test("前置器：缺称呼时在 block-end 改写，BlockAssembler 组装的最终消息含称呼", async () => {
  const ctx = makeCtx();
  const enforcer = createGreetingEnforcer({
    sessionScopes: makeScopes({ s1: governedScope }),
    projectCarriesNorm: async () => true,
  });
  enforcer.install(ctx);
  const out = await runStream(ctx, { sessionId: "s1" }, [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: "我先看一下" },
    { type: "text-delta", index: 0, text: "文件。" },
    { type: "block-end", index: 0, block: { type: "text", text: "我先看一下文件。" } },
  ]);
  assert.equal(out[0].type, "block-start");
  assert.equal(out[1].type, "text-delta");
  assert.ok(out[1].text.startsWith(GREETING_TEXT), "第二个 chunk 须是合成称呼");
  const end = out.find((c) => c.type === "block-end");
  assert.ok(end.block.text.startsWith(GREETING_TEXT), "block-end.block.text 须含称呼前缀");
  const { BlockAssembler } = await import("@deepseek-ai/dsh-llm");
  const a = new BlockAssembler();
  for (const chunk of out) a.push(chunk);
  const blocks = a.blocks();
  assert.ok(blocks[0].text.startsWith(GREETING_TEXT), `最终消息须以称呼起首，实际：${blocks[0].text.slice(0, 20)}`);
});

test("前置器：已带称呼的流不被改写（透传）", async () => {
  const ctx = makeCtx();
  createGreetingEnforcer({ sessionScopes: makeScopes({ s1: governedScope }), projectCarriesNorm: async () => true }).install(ctx);
  const src = [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: `${GREETING_TEXT}。本轮…` },
    { type: "block-end", index: 0, block: { type: "text", text: `${GREETING_TEXT}。本轮…` } },
  ];
  const out = await runStream(ctx, { sessionId: "s1" }, src);
  assert.deepEqual(out, src, "已带称呼须逐块透传");
});

test("前置器：称呼被切片时按累积前缀判定（缓冲到判定窗口）", async () => {
  const ctx = makeCtx();
  createGreetingEnforcer({ sessionScopes: makeScopes({ s1: governedScope }), projectCarriesNorm: async () => true }).install(ctx);
  const out = await runStream(ctx, { sessionId: "s1" }, [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: "你" },
    { type: "text-delta", index: 0, text: "好，老" },
    { type: "text-delta", index: 0, text: "丁，开始。" },
    { type: "block-end", index: 0, block: { type: "text", text: "你好，老丁，开始。" } },
  ]);
  const firstDelta = out.find((c) => c.type === "text-delta");
  assert.equal(firstDelta.text, "你", "判定前缓冲须原样转发，不得注入");
  assert.ok(!out.some((c) => c.type === "text-delta" && c.text.startsWith(`${GREETING_TEXT}\n`)), "已带称呼不得再注入");
});

test("前置器：同一回合第二个 step 不重复注入（turn 去重）", async () => {
  const ctx = makeCtx();
  createGreetingEnforcer({ sessionScopes: makeScopes({ s1: governedScope }), projectCarriesNorm: async () => true }).install(ctx);
  const step1 = [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: "我先查一下。" },
    { type: "block-end", index: 0, block: { type: "text", text: "我先查一下。" } },
  ];
  const r1 = await runStream(ctx, { sessionId: "s1" }, step1);
  assert.ok(r1.some((c) => c.type === "text-delta" && c.text.startsWith(`${GREETING_TEXT}\n`)), "step1 须注入");
  const r2 = await runStream(ctx, { sessionId: "s1" }, step1);
  assert.ok(!r2.some((c) => c.type === "text-delta" && c.text.startsWith(`${GREETING_TEXT}\n`)), "step2 不得重复注入");
  await ctx.listeners["agent/inbox/inserted"][0]({ agent: { session: { header: { id: "s1" } } } });
  const r3 = await runStream(ctx, { sessionId: "s1" }, step1);
  assert.ok(r3.some((c) => c.type === "text-delta" && c.text.startsWith(`${GREETING_TEXT}\n`)), "新回合须再保证");
});

test("前置器：非 governed／未知会话／它项目 一律透传", async () => {
  const ctx = makeCtx();
  createGreetingEnforcer({
    sessionScopes: makeScopes({ s2: { state: "not_governed" }, s3: { state: "governed", project: { path: "/proj/b", id: "b" } } }),
    projectCarriesNorm: async (path) => path === "/proj/a",
  }).install(ctx);
  const src = [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: "普通回复。" },
    { type: "block-end", index: 0, block: { type: "text", text: "普通回复。" } },
  ];
  for (const sessionId of ["s2", "unknown", "s3"]) {
    const out = await runStream(ctx, { sessionId }, src);
    assert.deepEqual(out, src, `${sessionId} 须透传`);
  }
});

test("前置器：上游抛错时原样抛出（不吞错）；判定前 abort 放行缓冲", async () => {
  const ctx = makeCtx();
  createGreetingEnforcer({ sessionScopes: makeScopes({ s1: governedScope }), projectCarriesNorm: async () => true }).install(ctx);
  const handler = ctx.listeners["llm/stream"][0];
  await assert.rejects(async () => {
    for await (const _ of handler.call({}, { sessionId: "s1" }, async function* () { yield { type: "block-start", index: 0, blockType: "text" }; throw new Error("upstream"); })) void _;
  }, /upstream/);
  const out = await runStream(ctx, { sessionId: "s9" }, []);
  assert.deepEqual(out, []);
});

test("解析器：三种形态、kind 闭集、首个冒号切分、invalid 计数", () => {
  const body = [
    "### 1. 某规则",
    "强制面：gate:validation/lint_failed",
    "### 2. 某规则",
    "强制面：bogus:whatever",
    "保证面：pre-injector:greeting-prefix",
    "无机械强制面（核对：Human 直接可见）",
    "强制面：test:some:colon:name",
  ].join("\n");
  const parsed = parseAssuranceDeclarations(body);
  assert.equal(parsed.declarations.length, 4);
  assert.equal(parsed.noneMarks.length, 1);
  assert.equal(parsed.noneMarks[0].checker, "Human 直接可见");
  const byLine = Object.fromEntries(parsed.declarations.map((d) => [d.line, d]));
  assert.equal(byLine[2].resolvable, true, "gate 面须可解析");
  assert.equal(byLine[4].kind, "bogus");
  assert.equal(byLine[5].resolvable, true, "pre-injector:greeting-prefix 须可解析");
  const colonCase = parsed.declarations.find((d) => d.line === 7);
  assert.equal(colonCase.kind, "test");
  assert.equal(colonCase.name, "some:colon:name", "name 须按首个冒号切分保留其余冒号");
  assert.equal(parsed.invalid.length, 2, "bogus 与 test 两条须记 invalid");
  assert.equal(parsed.hasAtLeastOne, true);
  assert.equal(parsed.ruleUnitsDecidable, false, "规则单元不可机械判定须如实披露");
  const summary = assuranceSummaryOf(body);
  assert.equal(summary.declared, 4);
  assert.match(summary.note, /只披露，不阻断/);
});

test("解析器：空正文与无声明正文不得假通过", () => {
  for (const body of ["", "### 1. 规则一\n内容。", undefined]) {
    const parsed = parseAssuranceDeclarations(body);
    assert.equal(parsed.hasAtLeastOne, false);
    assert.equal(parsed.invalid.length, 0);
  }
});

test("常量：登记 ID 与称呼文本稳定", () => {
  assert.equal(GREETING_PREFIX_ENFORCER_ID, "greeting-prefix");
  assert.equal(GREETING_TEXT, "你好，老丁");
});
