// 21 §9.2「审核结论 → 显式下一步」的回归（2026-11-12）。
//
// 为什么需要这个文件：实测 52 个工单里，`pre_reviews` 无一条 pass 的 5 个工单
// **全部 cancelled**，而有 pass 的 14 个无一 cancelled。死因不是审核过严，是
// 「闸只拒绝、不推动」——审核通过后没有任何机械动作告诉调用方「现在该去批准」，
// 轮次耗尽后也没有任何动作把它推到 Human 面前。Human 的原话是「审核通过或者
// 3 次流出再进行请示」，而那个「请示」在机械层不存在。
//
// 本文件守的是**回执文本里真的有下一步**，不是「有代码写了提示」——故断言按
// 关键词定位到具体行动（approve / 同轮定向复审出口 / 提请 Human），并反向钉住
// 「不越权」：提示不得声称已获授权。

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const TOOLS_PATH = join(ROOT, "plugin", "lib", "workcase-tools.js");

const source = await readFile(TOOLS_PATH, "utf8");

test("auto-audit pass hands back an explicit Gate 1 next step (not just a verdict)", async () => {
  // 定位 create 信封里按 autoAudit.status 分支的那段。
  const marker = 'auto-audit returned verdict=pass';
  const start = source.indexOf(marker);
  assert.ok(start > 0, "create 的 follow_up 须按 auto-audit 结论分支——否则通过后无人知道该批准");
  const slice = source.slice(start, start + 900);
  assert.match(slice, /action=approve/, "pass 分支须点名下一步是 approve");
  // 不越权：必须同时声明「批准仍是 Human 决定」，否则提示会被读成已授权。
  assert.match(slice, /Human decision|21 §10\.1/, "须声明批准仍属 Human 决定（21 §10.1）");
});

test("auto-audit needs_revision names the round cap AND the same-round exit", async () => {
  const start = source.indexOf('auto-audit returned verdict=needs_revision');
  assert.ok(start > 0, "needs_revision 须有独立分支");
  const slice = source.slice(start, start + 900);
  assert.match(slice, /3rd round|3 轮|round cap/, "须点明轮次上限");
  // 关键：达上限后不能只说「别再开了」——必须给出 21 §9.2 写明的出口。
  assert.match(slice, /round_index/, "须指出可复用既有轮号（同轮定向复审出口）");
  assert.match(slice, /Human/, "须指出另一条路是提请 Human 裁决");
});

test("record_audit receipt names who owns the next step", async () => {
  const start = source.indexOf('args.action === "record_audit"');
  assert.ok(start > 0, "record_audit 的回执须有专属分支——通用文案让人不知道下一步是谁的事");
  const slice = source.slice(start, start + 1600);
  // pass 与 needs_revision 两条路都要有明确归宿。
  assert.match(slice, /verdict=pass/, "须区分 pass 的归宿（可提请 Gate 1）");
  assert.match(slice, /needs_revision|revise/, "须区分 needs_revision 的归宿（revise 后重审）");
  assert.match(slice, /round_index/, "needs_revision 分支须给出达上限后的同轮复审出口");
});

test("the prompts never claim authorization on their own", async () => {
  // 反向不变量：这两段是**提示**，不得出现「已批准/已授权」这类越权措辞。
  for (const anchor of ['auto-audit returned verdict=pass', 'args.action === "record_audit"']) {
    const start = source.indexOf(anchor);
    const slice = source.slice(start, start + 1600);
    assert.ok(!/已获授权|已批准|authorized to execute/i.test(slice), `提示不得自称已授权：${anchor}`);
  }
});
