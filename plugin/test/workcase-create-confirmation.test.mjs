// WorkCase tool-surface contract: `create` must obtain the Human's ROUTING
// decision through the host answerer before any object is written
// (21 §14 C1 提案对象模式 + §6.3 对象边界).
//
// Background (2026-09-18). Two rounds of context:
//
//   (a) §14 states the Human confirmation as part of the C1 proposal-object
//       pattern, but the controlled entry validated only the proposal's FIELD
//       legality (status=draft; no gate_1/attempt/result). "Was this proposal
//       actually confirmed?" therefore had NO mechanical carrier, and an AI
//       could walk the whole creation flow alone and land the object. The cost
//       is asymmetric: WorkCase has no delete operation (21 §14) and a created
//       object immediately enters recall, blueprint rendering and systemPrompt
//       injection (21 §13) — an unconfirmed creation cannot be undone.
//
//   (b) The FIRST fix required the AI to self-fill a `human_confirmation`
//       string. That is a pseudo-guarantee: the AI can invent the string, so
//       credential authenticity was unverifiable. It was NOT "obtaining the
//       Human's intent" (the Human's own words: 「create 的时候没有拿到 human
//       是否创建 wc 的意图，就不能 create」).
//
// The current design routes the ROUTING question through `ctx.userQuestions.ask`
// — the same seam `ldvh_register_governed_project` uses for its 07 §5.6 consent
// (ldvh-tools.js:636) — and fails closed on a missing answerer, a failed ask, or
// no selection, because silence is not a routing decision.
//
// What is asked is ROUTING ("WorkCase or direct?"), not content: content
// judgement belongs to Gate 1 (21 §10.1), where the Human has the whole object.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { withTemp, sessionPersistenceWithRoutingLog } from "./helpers.mjs";
import { registerWorkcaseTools } from "../lib/workcase-tools.js";

/** Minimal ctx capturing registered tool descriptors. */
function collectorCtx() {
  const tools = new Map();
  return {
    ctx: { tools: { register: (descriptor) => { tools.set(descriptor.name, descriptor); return () => tools.delete(descriptor.name); } } },
    tools,
  };
}

/** Well-formed governed-projects carrier pointing at `projectPath`. */
async function writeCarrier(home, projectPath) {
  const dir = join(home, "ldvh");
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  const file = join(dir, "governed-projects.yaml");
  await writeFile(file, [
    "schema_version: 1",
    "governance_instance_name: Test",
    "product_description: Test",
    "projects:",
    "  - id: p1",
    "    name: P1",
    `    path: ${projectPath}`,
    'default_project_id: "p1"',
    "",
  ].join("\n"));
  await chmod(file, 0o600);
  return file;
}

/** A minimally well-formed create payload (shape only — not a semantic claim). */
function createArgs(extra = {}) {
  return {
    action: "create",
    frontmatter_draft: {
      title: "测试工单",
      status: "draft",
      summary: "把某处行为改成预期形态。",
      scope: "做什么：\n- 改 X\n\n明确不做什么：\n- 不动 Y",
      plan: [{ step: "改 X", done_criteria: "X 的输出为 Z" }],
    },
    body_markdown: [
      "## 摘要",
      "把某处行为改成预期形态。",
      "",
      "## 授权范围",
      "做什么：改 X。明确不做什么：不动 Y。",
      "",
      "## 计划",
      "1. 改 X —— X 的输出为 Z",
      "",
    ].join("\n"),
    ...extra,
  };
}

/**
 * Build a fake host-seam registry whose routing answerer is driven by `reply`.
 * `reply` receives the request payload and returns the routing result shape.
 */
function routingSeam(reply) {
  const calls = [];
  return {
    calls,
    requestWorkcaseRouting: async (payload) => {
      calls.push(payload);
      return reply(payload);
    },
  };
}

async function setup(base, { hostSeams } = {}) {
  const projectDir = join(base, "proj");
  await mkdir(projectDir, { recursive: true });
  await writeCarrier(base, projectDir);
  const { ctx, tools } = collectorCtx();
  registerWorkcaseTools(ctx, {
    dshHomePath: (...segments) => join(base, ...segments),
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
    ...(hostSeams === undefined ? {} : { hostSeams }),
  });
  const write = tools.get("ldvh_workcase_write");
  assert.ok(write, "write tool must be registered");
  return { write, exec: { agent: { session: { header: { cwd: projectDir } } } } };
}

test("create: an unwired answerer fails closed — no object may be created (21 §14 C1)", async () => {
  await withTemp("workcase-route-", async (base) => {
    // No hostSeams at all: consent CANNOT be obtained, so creation must refuse
    // rather than proceed on the caller's say-so (same discipline as 07 §5.6).
    const { write, exec } = await setup(base);
    const result = await write.execute(createArgs(), exec);

    const text = JSON.stringify(result);
    assert.match(text, /userQuestions\.ask|human-routing/, `expected the guard to report the missing answerer, got: ${text.slice(0, 500)}`);
    assert.doesNotMatch(text, /"ok":true/, "an un-routable create must not succeed");
  });
});

test("create: a declined routing decision rejects creation and names the reason", async () => {
  await withTemp("workcase-route-b-", async (base) => {
    const seam = routingSeam(() => ({ granted: false, routedTo: null, reason: "human did not choose a routing option (answer: null)" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const result = await write.execute(createArgs(), exec);

    const text = JSON.stringify(result);
    assert.match(text, /21 §6\.3|explicit Human routing decision/, `expected the routing refusal, got: ${text.slice(0, 600)}`);
    assert.equal(seam.calls.length, 1, "the routing question must actually be asked");
  });
});

test("create: choosing 直接执行 does NOT create an object (21 §6.3 不对象化)", async () => {
  await withTemp("workcase-route-c-", async (base) => {
    const seam = routingSeam(() => ({ granted: false, routedTo: "direct", reason: "Human chose 直接执行" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const result = await write.execute(createArgs(), exec);

    const text = JSON.stringify(result);
    assert.match(text, /handle the work directly/, `expected the direct-execution follow-up, got: ${text.slice(0, 600)}`);
    assert.doesNotMatch(text, /"ok":true/, "direct handling must not create an object");
  });
});

test("create: the routing prompt shows the request and the §6.3 rationale, not the object content", async () => {
  await withTemp("workcase-route-d-", async (base) => {
    const seam = routingSeam(() => ({ granted: false, routedTo: "direct", reason: "x" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    await write.execute(createArgs({
      routing_request: "把 WC card 的 scope 补上",
      routing_rationale: {
        forWorkcase: ["涉及前后端两处改动", "需要独立复核"],
        forDirect: ["改动范围小，单文件"],
      },
    }), exec);

    assert.equal(seam.calls.length, 1, "the routing question must be asked once");
    const payload = seam.calls[0];
    assert.equal(payload.request, "把 WC card 的 scope 补上");
    assert.deepEqual(payload.rationale.forWorkcase, ["涉及前后端两处改动", "需要独立复核"]);
    assert.deepEqual(payload.rationale.forDirect, ["改动范围小，单文件"]);
    // The prompt is ROUTING; it must not smuggle the object body in.
    assert.equal(payload.frontmatter_draft, undefined, "routing must not carry the proposal content");
  });
});

test("create: an affirmative routing decision lets the write proceed past the gate", async () => {
  await withTemp("workcase-route-e-", async (base) => {
    const seam = routingSeam(() => ({ granted: true, routedTo: "workcase", answer: "建工单走流程" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const result = await write.execute(createArgs(), exec);

    const text = JSON.stringify(result);
    // Must NOT be refused by the routing gate. Environment-side failures are
    // tolerated only if they are unrelated to routing.
    assert.doesNotMatch(text, /21 §6\.3|explicit Human routing decision/, `routing was affirmed but the gate still refused: ${text.slice(0, 600)}`);
    assert.equal(seam.calls.length, 1, "exactly one routing question");
  });
});

test("create: the superseded self-filled confirmation field is not persisted", async () => {
  await withTemp("workcase-route-f-", async (base) => {
    const seam = routingSeam(() => ({ granted: true, routedTo: "workcase", answer: "建工单走流程" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const result = await write.execute(createArgs(), exec);

    // The routing decision records a conversation-level act; it is not part of
    // the 21 §8 field closed set. Persisting it would silently extend the schema.
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /"human_confirmation"\s*:/, `the superseded field must not reappear; got: ${serialized.slice(0, 600)}`);
  });
});

test("create: the routing request carries the live agent (host forwarder requires it)", async () => {
  await withTemp("workcase-route-g-", async (base) => {
    // Measured 2026-09-18: without `agent` the host forwarder
    // (dsh-api-remotes/lib/index.js:115-119) declines the request and the
    // waterfall exhausts to NO_PROVIDER, so the browser answerer is never
    // reached — the prompt silently fails to appear.
    const seam = routingSeam(() => ({ granted: false, routedTo: "direct", reason: "x" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    await write.execute(createArgs(), exec);

    assert.equal(seam.calls.length, 1, "the routing question must be asked once");
    assert.ok(seam.calls[0].agent !== undefined, "the routing request must carry the live agent");
    assert.equal(seam.calls[0].agent, exec.agent, "the agent must be the caller's own live agent");
  });
});

test("create: an array-shaped selected answer is read correctly (host returns arrays)", async () => {
  await withTemp("workcase-route-h-", async (base) => {
    // The host returns `selected` as an ARRAY of labels
    // (`{answers:[{id, selected:["建工单走流程"]}]}`), matching the official
    // consumer's `[...answer.selected]` (dsh-tool-ask-user:108). Reading it as
    // a scalar made every label comparison fail, so an answered question was
    // still treated as unanswered — the prompt would appear, the Human would
    // choose, and creation would still be rejected.
    const seam = {
      calls: [],
      requestWorkcaseRouting: async () => ({ granted: true, routedTo: "workcase", answer: "建工单走流程" }),
    };
    const { write, exec } = await setup(base, { hostSeams: seam });
    const result = await write.execute(createArgs(), exec);

    const text = JSON.stringify(result);
    assert.doesNotMatch(text, /did not choose a routing option/, `an affirmative answer must not be read as unanswered: ${text.slice(0, 500)}`);
  });
});

// ---------------------------------------------------------------------------
// Timeout budget vs. the Human-facing routing ask
//
// Measured 2026-09-20 in a real session: `ldvh_workcase_write(action=create)`
// returned "Error: tool call timed out after 30000ms" while the routing prompt
// was still on screen. The cause was the descriptor's hardcoded
// `timeoutMs: 30000` — the host's timeout policy armed a 30s deadline and, on
// expiry, substituted TOOL_TIMEOUT for the real result. A person cannot answer
// within 30s, so the failure was guaranteed, not incidental; and because the
// policy awaits the tool BEFORE reporting the expiry, an answer arriving at
// second 31 was discarded even though it had been received.
//
// The fix is to declare NO wall-clock budget on this tool, which makes the
// caller's cancellation signal the only release — hence both halves are pinned.
test("create: the tool declares no timeoutMs (a Human cannot answer in 30s)", async () => {
  await withTemp("workcase-route-i-", async (base) => {
    const seam = routingSeam(() => ({ granted: false, routedTo: "direct", reason: "x" }));
    const { write } = await setup(base, { hostSeams: seam });
    assert.equal(
      "timeoutMs" in write,
      false,
      "a declared budget on this tool discards the Human's real answer (host substitutes TOOL_TIMEOUT after the tool resolves)"
    );
  });
});

test("create: the routing request forwards the caller's cancellation signal", async () => {
  await withTemp("workcase-route-j-", async (base) => {
    // With no wall-clock deadline, the caller's signal is the ONLY way an
    // abandoned prompt is released. Dropping it would trade "always times out"
    // for "hangs forever" — strictly worse, since nothing would ever settle.
    //
    // The exec must carry a REAL signal: an exec without one cannot tell
    // "forwarded correctly" from "dropped on the floor", which is exactly the
    // distinction this test exists to make.
    const seam = routingSeam(() => ({ granted: false, routedTo: "direct", reason: "x" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const signal = new AbortController().signal;
    await write.execute(createArgs(), { ...exec, signal });

    assert.equal(seam.calls.length, 1, "the routing question must be asked once");
    assert.ok(
      seam.calls[0].signal !== undefined,
      "the routing request must carry exec.signal so the ask aborts (ASK_ABORTED) instead of hanging"
    );
    assert.equal(seam.calls[0].signal, signal, "the forwarded signal must be the caller's own");
  });
});

// ---------------------------------------------------------------------------
// record_review via the subagent relay (workcase-2be11478 计划步骤 4)
//
// 子代理本身不注册 ldvh_* 工具（lifecycle.js 对 origin==="subagent" 走 installChild
// 后即返回），故它无法自行记录复核结论。父会话代其回传时，**身份与结论文本都取自
// 宿主登记表**（Code 亲观测、调用方不可设置）——否则「开启代理做独立审核」在机械上
// 走不通，而「代述」又会把父会话的文本冒充成子代理的结论。
// ---------------------------------------------------------------------------

/** 带子代理登记表的 ctx。 */
function setupWithChild(base, child) {
  return { lookupChild: (id) => (id === child.agentId ? child : null) };
}

async function setupRelay(base, child) {
  const projectDir = join(base, "proj");
  await mkdir(projectDir, { recursive: true });
  await writeCarrier(base, projectDir);
  const { ctx, tools } = collectorCtx();
  registerWorkcaseTools(ctx, {
    dshHomePath: (...segments) => join(base, ...segments),
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
    hostSeams: routingSeam(() => ({ granted: true, routedTo: "workcase" })),
    ...setupWithChild(base, child),
  });
  const write = tools.get("ldvh_workcase_write");
  assert.ok(write, "write tool must be registered");
  return { write, exec: { agent: { session: { header: { cwd: projectDir } } } } };
}

test("record_review: an unknown child id is rejected (只有宿主观测过的会话可被引用)", async () => {
  await withTemp("workcase-relay-a-", async (base) => {
    const { write, exec } = await setupRelay(base, { agentId: "child-1", sessionId: "s-child-1", conclusion: "结论" });
    const result = await write.execute({
      action: "record_review", object_uid: "00000000-0000-4000-8000-000000000000",
      expected_fingerprint: "0".repeat(64), change_summary: "x",
      reviewer_child_agent_id: "child-NOT-REGISTERED",
    }, exec);
    const text = JSON.stringify(result);
    assert.match(text, /is not a subagent registered under this session/,
      `expected an unknown child to be refused before any write, got: ${text.slice(0, 400)}`);
  });
});

test("record_review: a child with no captured conclusion is rejected (空结论不是复核)", async () => {
  await withTemp("workcase-relay-b-", async (base) => {
    const { write, exec } = await setupRelay(base, { agentId: "child-2", sessionId: "s-child-2", conclusion: null });
    const result = await write.execute({
      action: "record_review", object_uid: "00000000-0000-4000-8000-000000000000",
      expected_fingerprint: "0".repeat(64), change_summary: "x",
      reviewer_child_agent_id: "child-2",
    }, exec);
    const text = JSON.stringify(result);
    assert.match(text, /has produced no captured conclusion/,
      `expected an empty conclusion to be refused, got: ${text.slice(0, 400)}`);
  });
});

test("record_review: a summary that is NOT a verbatim excerpt of the child's conclusion is rejected (防「代述」冒充)", async () => {
  await withTemp("workcase-relay-c-", async (base) => {
    const { write, exec } = await setupRelay(base, {
      agentId: "child-3", sessionId: "s-child-3", conclusion: "子代理的真实结论原文。",
    });
    const result = await write.execute({
      action: "record_review", object_uid: "00000000-0000-4000-8000-000000000000",
      expected_fingerprint: "0".repeat(64), change_summary: "x",
      reviewer_child_agent_id: "child-3",
      summary: "父会话改写的、看起来更漂亮的结论。",
    }, exec);
    const text = JSON.stringify(result);
    assert.match(text, /not a verbatim excerpt of the reviewer subagent's captured conclusion/,
      `the parent must not be able to substitute its own text for the reviewer's conclusion, got: ${text.slice(0, 400)}`);
  });
});

test("record_review: a LONG conclusion is not silently truncated — a verbatim excerpt is required (21 §8 cap)", async () => {
  // 本单实测发现的设计缺陷：子代理的 captured conclusion 是其**最终正文全文**，
  // 常超 600 字符，而 reviews[].summary 有 ≤600 上限（21 §8）。若无脑采用全文，
  // 通道对真实复核不可用；若无脑截断，则产生一个「看似完整、实则被腰斩」的结论。
  // 故要求在超限时由调用方提供**逐字子串**作为概要，全文留在 transcript。
  await withTemp("workcase-relay-e-", async (base) => {
    const longConclusion = "对象：某单。基线：规范。方法：读码与跑测试。".repeat(40); // >600
    const { write, exec } = await setupRelay(base, {
      agentId: "child-5", sessionId: "s-child-5", conclusion: longConclusion,
    });
    const result = await write.execute({
      action: "record_review", object_uid: "00000000-0000-4000-8000-000000000000",
      expected_fingerprint: "0".repeat(64), change_summary: "x",
      reviewer_child_agent_id: "child-5",
    }, exec);
    const text = JSON.stringify(result);
    assert.match(text, /longer than the 600-char reviews\[\]\.summary cap/,
      `a long conclusion must demand an explicit excerpt, not be truncated silently, got: ${text.slice(0, 400)}`);
  });
});

test("record_review: without the host subagent registry the channel fails closed (不降级为无身份写入)", async () => {
  await withTemp("workcase-relay-d-", async (base) => {
    const projectDir = join(base, "proj");
    await mkdir(projectDir, { recursive: true });
    await writeCarrier(base, projectDir);
    const { ctx, tools } = collectorCtx();
    registerWorkcaseTools(ctx, {
      dshHomePath: (...segments) => join(base, ...segments),
      sessionPersistence: sessionPersistenceWithRoutingLog(base),
      // 故意不给 lookupChild：模拟宿主未暴露登记表
    });
    const write = tools.get("ldvh_workcase_write");
    const result = await write.execute({
      action: "record_review", object_uid: "00000000-0000-4000-8000-000000000000",
      expected_fingerprint: "0".repeat(64), change_summary: "x",
      reviewer_child_agent_id: "child-4",
    }, { agent: { session: { header: { cwd: projectDir } } } });
    const text = JSON.stringify(result);
    assert.match(text, /review_channel_unavailable|not a subagent registered/,
      `a missing registry must not silently degrade into an unattributed write, got: ${text.slice(0, 400)}`);
  });
});
