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
      scope: "做什么：改 X。明确不做什么：不动 Y。",
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
