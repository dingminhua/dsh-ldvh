// Direct unit tests for `requestReviewAsk` (plugin/lib/host-seams.js).
//
// Why this file exists (2026-11-13, independent review MAJOR #4): review-ask.test.mjs
// injects a FAKE seam, so it proves the call site is wired but never exercises the real
// parse. That is the same gap spark-consent-seam.test.mjs was created for, and its own
// header records the identical lesson. The gap is not academic: this very batch shipped
// a BLOCKER (renderEnvelope had no review-ask branch, so every decision rendered as the
// same "completed" text) while every test stayed green — because the tests asserted the
// raw envelope object instead of what the model actually receives.
//
// The host returns `selected` as an ARRAY of labels (`{answers:[{id, selected:["…"]}]}`),
// so a scalar comparison silently fails. Each answer shape below is asserted explicitly:
//   * exact 安排代理 label  → decision "review"
//   * exact 跳过 label      → decision "skip"
//   * empty / multi / unknown / missing entry → decision null (未决策 ≠ 答复)
//
// It also pins the two properties the mechanism depends on for correctness:
//   * the answer ledger is consulted BEFORE asking (same fingerprint → not asked twice)
//   * the fingerprint carries session+project scope, so two sessions with the same task
//     text are NOT treated as the same question (MAJOR #2: without scope, answering once
//     silenced every later question forever)
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHostSeams } from "../lib/host-seams.js";

/** Install seams against a ctx whose answerer is driven by `ask`. */
function installWith(ask, home) {
  const seams = createHostSeams();
  const ctx = {
    get: (key) => ({
      tools: { guard: () => () => {} },
      invariants: { register: () => () => {} },
      userQuestions: ask === null ? undefined : { ask },
      fs: {
        resolve: async (p) => ({ targetKey: `tk:${p}`, displayPath: p }),
        stat: async () => ({ version: "v", type: "file" }),
      },
    }[key]),
    on: () => () => {},
    emit: () => {},
    logger: { info() {} },
  };
  // **dshHomePath 是 (...segments) => path**，不是 () => home。
  // 生产装配是 `(...segments) => join(resolveDshHome(), ...segments)`（lib/bin.js:10）；
  // 夹具若写成 `() => home` 会忽略路径分段，让载体路径解析成目录本身，实测报
  // `EISDIR: illegal operation on a directory`——这是夹具的错，不是被测代码的错。
  const install = seams.install(ctx, { dshHomePath: (...segments) => join(home, ...segments) });
  return { seams, install };
}

/** A private per-test home so ledger state never leaks between cases. */
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), "ldvh-review-ask-seam-"));
  await mkdir(join(dir, "ldvh"), { recursive: true });
  return dir;
}

/** Caller-supplied identity: the seam reads session/cwd from here (never self-reported). */
function agentOf(sessionId, cwd) {
  return { session: { id: sessionId, header: { sessionId, cwd } } };
}

const PRE = "pre-action";
const POST = "post-work";

/** Host answer shape: `selected` is an ARRAY of labels. */
function answerSelecting(...labels) {
  return async () => ({ answers: [{ id: "ldvh-review-ask", selected: labels }] });
}

// ---------------------------------------------------------------------------
// Fail-closed paths: nothing is asked, and no decision is invented
// ---------------------------------------------------------------------------

test("review-ask seam: switch off → no prompt, no decision", async () => {
  const home = await freshHome();
  let asked = 0;
  const { seams, install } = installWith(async () => { asked += 1; return { answers: [] }; }, home);
  const out = await seams.requestReviewAsk({ point: PRE, task: "x", enabled: false, agent: agentOf("s1", "/p") });
  assert.equal(out.decision, null);
  assert.equal(out.asked, false);
  assert.equal(asked, 0, "开关关闭时不得向 Human 提问");
  assert.match(out.reason, /switch is off/);
  install.dispose();
});

test("review-ask seam: no answerer installed → no prompt, no decision, no ledger write", async () => {
  const home = await freshHome();
  const { seams, install } = installWith(null, home);
  const out = await seams.requestReviewAsk({ point: PRE, task: "x", enabled: true, agent: agentOf("s1", "/p") });
  assert.equal(out.decision, null);
  assert.equal(out.asked, false);
  assert.match(out.reason, /no human-answerer entry/);
  // 「没问成」不得留下答复痕迹——否则下次会被当成「问过了」
  const ledger = await readFile(join(home, "ldvh", "review-ask-decisions.json"), "utf8").catch(() => "");
  assert.equal(ledger, "", "无答题器时不得写载体");
  install.dispose();
});

// ---------------------------------------------------------------------------
// The real parse: every answer shape, asserted explicitly
// ---------------------------------------------------------------------------

test("review-ask seam: 选「安排代理」→ decision review（selected 是数组，这是真实的宿主形状）", async () => {
  const home = await freshHome();
  const { seams, install } = installWith(answerSelecting("安排代理"), home);
  const out = await seams.requestReviewAsk({ point: PRE, task: "把设置移到设置页", enabled: true, agent: agentOf("s1", "/p") });
  assert.equal(out.decision, "review");
  assert.equal(out.asked, true);
  assert.equal(out.reused, undefined, "首次询问不该是复用");
  install.dispose();
});

test("review-ask seam: 选「跳过，直接推进」→ decision skip", async () => {
  const home = await freshHome();
  const { seams, install } = installWith(answerSelecting("跳过，直接推进"), home);
  const out = await seams.requestReviewAsk({ point: POST, task: "完成迁移", enabled: true, agent: agentOf("s1", "/p") });
  assert.equal(out.decision, "skip");
  assert.equal(out.asked, true);
  install.dispose();
});

test("review-ask seam: 空答复（按了跳过/关掉）→ decision null，且不写载体", async () => {
  const home = await freshHome();
  const { seams, install } = installWith(async () => ({ answers: [] }), home);
  const out = await seams.requestReviewAsk({ point: PRE, task: "x", enabled: true, agent: agentOf("s1", "/p") });
  assert.equal(out.decision, null, "未决策不是答复");
  assert.equal(out.asked, true, "问了，只是没答");
  assert.match(out.reason, /未决策/);
  // 不留痕迹：下次仍会问（这是设计，不是缺陷）
  const ledger = await readFile(join(home, "ldvh", "review-ask-decisions.json"), "utf8").catch(() => "");
  assert.equal(ledger, "", "空答复不得写成决定");
  install.dispose();
});

test("review-ask seam: 多选与未知标签一律视为未决策（不猜）", async () => {
  const home = await freshHome();
  for (const labels of [["安排代理", "跳过，直接推进"], ["什么都不是"], []]) {
    let ask = async () => ({ answers: [{ id: "ldvh-review-ask", selected: labels }] });
    const { seams, install } = installWith(ask, home);
    const out = await seams.requestReviewAsk({ point: PRE, task: "x", enabled: true, agent: agentOf("s1", "/p") });
    assert.equal(out.decision, null, `selected=${JSON.stringify(labels)} 不得被猜成某个决定`);
    install.dispose();
  }
});

test("review-ask seam: 答复里没有本工具的 entry → 未决策", async () => {
  const home = await freshHome();
  const { seams, install } = installWith(async () => ({ answers: [{ id: "some-other-question", selected: ["安排代理"] }] }), home);
  const out = await seams.requestReviewAsk({ point: PRE, task: "x", enabled: true, agent: agentOf("s1", "/p") });
  assert.equal(out.decision, null, "别的询问的答复不得被当成本工具的答复");
  install.dispose();
});

// ---------------------------------------------------------------------------
// 先读后问：同指纹不重复提问
// ---------------------------------------------------------------------------

test("review-ask seam: 同一会话同一任务问过一次 → 第二次复用，不再打扰 Human", async () => {
  const home = await freshHome();
  let asked = 0;
  const { seams, install } = installWith(async () => {
    asked += 1;
    return { answers: [{ id: "ldvh-review-ask", selected: ["安排代理"] }] };
  }, home);
  const agent = agentOf("s1", "/p");
  const first = await seams.requestReviewAsk({ point: PRE, task: "同一件事", enabled: true, agent });
  const second = await seams.requestReviewAsk({ point: PRE, task: "同一件事", enabled: true, agent });
  assert.equal(asked, 1, "同一内容只问一次");
  assert.equal(second.reused, true);
  assert.equal(second.decision, first.decision, "复用须返回同一答复");
  install.dispose();
});

test("review-ask seam: 不同会话/项目、同样任务文字 → 必须重新提问（MAJOR #2）", async () => {
  const home = await freshHome();
  let asked = 0;
  const { seams, install } = installWith(async () => {
    asked += 1;
    return { answers: [{ id: "ldvh-review-ask", selected: ["跳过，直接推进"] }] };
  }, home);
  await seams.requestReviewAsk({ point: PRE, task: "修复登录bug", enabled: true, agent: agentOf("s1", "/proj-a") });
  await seams.requestReviewAsk({ point: PRE, task: "修复登录bug", enabled: true, agent: agentOf("s2", "/proj-b") });
  assert.equal(asked, 2, "跨会话/跨项目不得复用答复（否则答过一次就永远不再问）");
  install.dispose();
});

test("review-ask seam: task 省略时两次询问**都问**（不得静默复用）", async () => {
  // 2026-11-13 独立审核 MAJOR-2。原用例的**标题与断言相反**——标题写
  // 「不带 task 的两次询问不得共用指纹」，断言却是 `asked === 1`、
  // `second.reused === true`，等于把缺陷钉成了正确行为。
  //
  // 缺陷本体：指纹 = point + task + scope，task 可省时同一会话里**所有**该位置
  // 的询问指纹相同。第一次答 skip 后，另一件复杂任务的询问静默复用那次 skip，
  // Human 根本收不到第二次提问。
  //
  // 解法：复用前检查**历史记录的 task 是否为空**——task 为空的记录标识不了
  // 「是哪件事」，故不复用（宁可多问一次，也不静默套用无关答复）。
  const home = await freshHome();
  let asked = 0;
  const { seams, install } = installWith(async () => {
    asked += 1;
    return { answers: [{ id: "ldvh-review-ask", selected: ["跳过，直接推进"] }] };
  }, home);
  const agent = agentOf("s1", "/p");
  const first = await seams.requestReviewAsk({ point: PRE, task: null, enabled: true, agent });
  const second = await seams.requestReviewAsk({ point: PRE, task: null, enabled: true, agent });
  assert.equal(first.asked, true);
  assert.equal(second.asked, true, "task 省略时必须重新问，不得静默复用上一次的答复");
  assert.equal(second.reused, undefined, "不得声称复用了");
  assert.equal(asked, 2, "两次询问都要真的问出去");
  install.dispose();
});

test("review-ask seam: task 非空时同一件事仍复用（不得被 MAJOR-2 的修法误伤）", async () => {
  const home = await freshHome();
  let asked = 0;
  const { seams, install } = installWith(async () => {
    asked += 1;
    return { answers: [{ id: "ldvh-review-ask", selected: ["安排代理"] }] };
  }, home);
  const agent = agentOf("s1", "/p");
  await seams.requestReviewAsk({ point: PRE, task: "同一件事", enabled: true, agent });
  const second = await seams.requestReviewAsk({ point: PRE, task: "同一件事", enabled: true, agent });
  assert.equal(asked, 1, "同一件事重试不得重复问（这是机制的核心语义）");
  assert.equal(second.reused, true);
  install.dispose();
});

// ---------------------------------------------------------------------------
// 载体异常：fail-closed，不静默当「没问过」
// ---------------------------------------------------------------------------

test("review-ask seam: 载体损坏时 fail-closed（不猜、不问、不覆盖）", async () => {
  const home = await freshHome();
  const ledger = join(home, "ldvh", "review-ask-decisions.json");
  await writeFile(ledger, "{ this is not json", "utf8");
  let asked = 0;
  const { seams, install } = installWith(async () => { asked += 1; return { answers: [] }; }, home);
  const out = await seams.requestReviewAsk({ point: PRE, task: "x", enabled: true, agent: agentOf("s1", "/p") });
  assert.equal(out.decision, null);
  assert.equal(out.asked, false, "载体不可读时不得贸然提问");
  assert.equal(asked, 0);
  assert.match(out.reason, /malformed/i);
  // 不得覆盖掉 Human 已有的答复
  assert.equal(await readFile(ledger, "utf8"), "{ this is not json");
  install.dispose();
});

test("review-ask seam: ?signal 透传给答题器", async () => {
  const home = await freshHome();
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-review-ask", selected: ["跳过，直接推进"] }] };
  }, home);
  const controller = new AbortController();
  await seams.requestReviewAsk({ point: PRE, task: "x", enabled: true, agent: agentOf("s1", "/p"), signal: controller.signal });
  assert.equal(seen?.signal, controller.signal, "中断信号须透传，否则无法取消");
  install.dispose();
});

// ---------------------------------------------------------------------------
// 卡片形状：只写「要做什么」与「要不要审」（Human 2026-11-13）
// ---------------------------------------------------------------------------

test("review-ask seam: 询问卡片不含判据，只写要做什么与两个选择的后果", async () => {
  const home = await freshHome();
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-review-ask", selected: ["安排代理"] }] };
  }, home);
  await seams.requestReviewAsk({ point: PRE, task: "把 LDVH 设置移到设置页", enabled: true, agent: agentOf("s1", "/p") });
  const q = seen.questions[0];
  assert.match(q.question, /把 LDVH 设置移到设置页/, "标题须写明要做什么");
  assert.match(q.question, /审查/);
  assert.doesNotMatch(q.question, /specs\//, "标题不得出现规范指针");
  // **不带 detail**（Human 2026-11-13 截图指认）：detail 与两个选项重复，
  // 卡片上三处说同一件事。宿主契约 detail 是 optional，缺省即不渲染该块。
  assert.equal(q.detail, undefined, "卡片不得带 detail 块");
  assert.equal(q.options.length, 2, "两个选项：安排 / 跳过");
  // 后果信息改由选项的 description 承担——那是 Human 实际会读的位置
  const descriptions = q.options.map((o) => o.description ?? "");
  assert.ok(descriptions.every((d) => d.length > 0), "两个选项都要有说明");
  assert.match(descriptions[0], /独立子代理/, "安排项须说明会派独立子代理");
  assert.match(descriptions[1], /不做独立把关/, "跳过项须说明本次不做独立把关");
  // 选项标签与自己的 description 不得逐字重复（那等于没写）
  for (const option of q.options) {
    assert.notEqual(option.description, option.label, `选项「${option.label}」的说明不得与标签重复`);
  }
  install.dispose();
});

// ---------------------------------------------------------------------------
// 2026-11-13 第二轮独立审核：占位词绕过口、scope 键降级、known 口径
// ---------------------------------------------------------------------------

test("review-ask seam: 占位词 task 与 null 同义（MAJOR-2 的绕过口）", async () => {
	// 模型若每次都传恒定的退化占位词「当次任务」，task 字段仍**非空**，
	// 「历史记录 task 非空 ⇒ 可复用」的判据被骗过 ⇒ 静默复用复发，MAJOR-2 等于没修。
	const home = await freshHome();
	let asked = 0;
	const { seams, install } = installWith(async () => {
		asked += 1;
		return { answers: [{ id: "ldvh-review-ask", selected: ["跳过，直接推进"] }] };
	}, home);
	const agent = agentOf("s1", "/p");
	await seams.requestReviewAsk({ point: PRE, task: "当次任务", enabled: true, agent });
	const second = await seams.requestReviewAsk({ point: PRE, task: "当次任务", enabled: true, agent });
	assert.equal(second.asked, true, "占位词 task 必须重新问，不得静默复用");
	assert.equal(second.reused, undefined);
	assert.equal(asked, 2);
	install.dispose();
});

test("review-ask seam: 会话 id 取不到时禁止复用（MAJOR-3，scope 键 fail-closed）", async () => {
	// scope 降级成「只带 cwd」时，同项目下**另一个会话**的询问会命中本会话的记录
	// ——正是本机制要消灭的「把别的上下文的决定搬过来用」。
	const home = await freshHome();
	let asked = 0;
	const { seams, install } = installWith(async () => {
		asked += 1;
		return { answers: [{ id: "ldvh-review-ask", selected: ["跳过，直接推进"] }] };
	}, home);
	// agent 无 session id，只有 cwd
	const noSessionId = { session: { header: { cwd: "/p" } } };
	await seams.requestReviewAsk({ point: PRE, task: "同一件事", enabled: true, agent: noSessionId });
	const second = await seams.requestReviewAsk({ point: PRE, task: "同一件事", enabled: true, agent: noSessionId });
	assert.equal(second.asked, true, "会话 id 取不到时必须每次都问");
	assert.equal(second.reused, undefined);
	assert.equal(asked, 2);
	install.dispose();
});

test("review-ask seam: 占位词在载体里归一为 null", async () => {
	const home = await freshHome();
	const { seams, install } = installWith(async () => ({ answers: [{ id: "ldvh-review-ask", selected: ["安排代理"] }] }), home);
	await seams.requestReviewAsk({ point: PRE, task: "当次任务", enabled: true, agent: agentOf("s1", "/p") });
	const raw = await readFile(join(home, "ldvh", "review-ask-decisions.json"), "utf8");
	const parsed = JSON.parse(raw);
	const entry = parsed.decisions[parsed.decisions.length - 1];
	// 载体在 task 为空时**整个省略该键**（recordReviewAskDecision 的形状），
	// 故这里断言「不是占位词」而不是「等于 null」——两种形态都满足该判据。
	assert.notEqual(entry.task, "当次任务", "占位词不得写进载体——它标识不了「是哪件事」");
	install.dispose();
});
