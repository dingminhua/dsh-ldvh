// 21 §6.3 路由询问「让 Human 看到候选」与 21 §9.2「审核结论 → 显式下一步」的回归。
//
// 为什么需要这个文件（2026-11-12）：
//
// ① 路由询问此前只带 `routing_request`（Human 原话的一行转述），**不带候选内容**。
//    Human 被问「要不要建工单」时看不到这个工单长什么样——他答的是一个尚不存在
//    的东西。Human 的原话是「不是先准备创建，而是问了之后再准备创建」。
//
// ② 建前审核有 verdict 却**没有下一步**。实测 52 个工单里，`pre_reviews` 无一条
//    pass 的 5 个工单全部 cancelled，而有 pass 的 14 个无一 cancelled。死因不是
//    审核过严，是「闸只拒绝、不推动」——审核通过后没有动作告诉调用方「该批准了」，
//    轮次耗尽后也没有动作把它推到 Human 面前。Human 原话：「审核通过或者3次流出
//    再进行请示」，而那个「请示」在机械层不存在。
//
// 本文件守两条行为：呈现里真的有候选字段；回执里真的有下一步指令。

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHostSeams } from "../lib/host-seams.js";

const ROUTE_ID = "ldvh-workcase-route";
const WORKCASE_LABEL = "建工单走流程";

/** Install seams against a temp DSH home; `ask` records every call it receives. */
async function installWith(ask) {
  const home = await mkdtemp(join(tmpdir(), "ldvh-brief-"));
  const calls = [];
  const seams = createHostSeams();
  const ctx = {
    get: (key) => ({
      tools: { guard: () => () => {} },
      invariants: { register: () => () => {} },
      userQuestions: ask === null
        ? undefined
        : { ask: async (request, agent) => { calls.push({ request, agent }); return ask(request, agent); } },
      fs: { resolve: async (p) => ({ displayPath: p }), stat: async () => ({ version: "v", type: "file" }) },
    }[key]),
    on: () => () => {},
    emit: () => {},
    logger: { info() {} },
  };
  const install = seams.install(ctx, { dshHomePath: (...names) => join(home, ...names) });
  return {
    seams,
    calls,
    async cleanup() {
      install.dispose();
      await rm(home, { recursive: true, force: true });
    },
  };
}

const ANSWER_WORKCASE = async () => ({ answers: [{ id: ROUTE_ID, selected: [WORKCASE_LABEL] }] });

// ---------------------------------------------------------------------------
// ① 候选摘要进入呈报
// ---------------------------------------------------------------------------

test("routing: the candidate brief reaches the Human via the scrollable detail, not the title area", async () => {
  const { seams, calls, cleanup } = await installWith(ANSWER_WORKCASE);
  try {
    const brief = {
      title: "修掉召回截断",
      gist: "把正文匹配从 1200 字符改为全文",
      scope: "做什么：改 source-recall.js。明确不做什么：不动注入侧。",
      planSteps: ["定位截断点", "改为全文匹配", "补回归用例"],
    };
    const r = await seams.requestWorkcaseRouting({ request: "改掉召回截断", candidateKey: "d".repeat(64), candidateBrief: brief });
    assert.equal(r.granted, true);

    assert.equal(calls.length, 1, "询问须发生一次");
    const q = calls[0].request.questions[0];
    // 呈现位置：候选进 detail（可滚动区），不进 question（有界标题区，ADR 7ceaf7fc）。
    assert.equal(typeof q.detail, "string", "候选摘要须进入 detail —— 标题区放不下");
    for (const [label, needle] of [
      ["title", "修掉召回截断"],
      ["gist", "把正文匹配从 1200 字符改为全文"],
      ["scope", "明确不做什么"],
      ["plan 步骤 1", "定位截断点"],
      ["plan 步骤 3", "补回归用例"],
    ]) {
      assert.ok(q.detail.includes(needle), `detail 须含候选的 ${label}：「${needle}」`);
    }
    // 边界：AI 的倾向理由仍然不进呈报（21 §6.3 既有裁定不因本次改动松动）。
    assert.ok(!q.detail.includes("我倾向于"), "rationale 仍不得进入任何呈报载体");
  } finally {
    await cleanup();
  }
});

test("routing: an absent brief does not fabricate placeholder lines", async () => {
  const { seams, calls, cleanup } = await installWith(ANSWER_WORKCASE);
  try {
    const r = await seams.requestWorkcaseRouting({ request: "改掉召回截断", candidateKey: "e".repeat(64) });
    assert.equal(r.granted, true);
    const q = calls[0].request.questions[0];
    // 无候选摘要时不加空壳段落（03 §6.1 不编造）。detail 为 undefined 或原话。
    const detail = typeof q.detail === "string" ? q.detail : "";
    assert.ok(!detail.includes("候选工单："), "缺席的候选不得用占位符伪造");
    assert.ok(!detail.includes("计划 0 步"), "不得伪造空计划");
  } finally {
    await cleanup();
  }
});

test("routing: a brief with only some fields shows only those fields", async () => {
  const { seams, calls, cleanup } = await installWith(ANSWER_WORKCASE);
  try {
    await seams.requestWorkcaseRouting({
      request: "改掉召回截断",
      candidateKey: "f".repeat(64),
      candidateBrief: { title: "只有标题的候选", gist: null, scope: undefined, planSteps: [] },
    });
    const q = calls[0].request.questions[0];
    assert.ok(q.detail.includes("只有标题的候选"), "有值的字段须呈现");
    assert.ok(!q.detail.includes("要点："), "空 gist 不得渲染成空标签");
    assert.ok(!q.detail.includes("范围："), "空 scope 不得渲染成空标签");
    assert.ok(!q.detail.includes("计划"), "空 plan 不得渲染成「计划 0 步」");
  } finally {
    await cleanup();
  }
});
