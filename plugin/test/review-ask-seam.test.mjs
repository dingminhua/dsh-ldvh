import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHostSeams } from "../lib/host-seams.js";

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
  const install = seams.install(ctx, { dshHomePath: (...segments) => join(home, ...segments) });
  return { seams, install };
}

async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), "ldvh-review-ask-seam-"));
  await mkdir(join(dir, "ldvh"), { recursive: true });
  return dir;
}

function agentOf(sessionId, cwd) {
  return { session: { id: sessionId, header: { sessionId, cwd } } };
}

const PRE = "pre-action";
const POST = "post-work";

function answerSelecting(...labels) {
  return async () => ({ answers: [{ id: "ldvh-review-ask", selected: labels }] });
}


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
  const ledger = await readFile(join(home, "ldvh", "review-ask-decisions.json"), "utf8").catch(() => "");
  assert.equal(ledger, "", "无答题器时不得写载体");
  install.dispose();
});


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
  assert.equal(q.detail, undefined, "卡片不得带 detail 块");
  assert.equal(q.options.length, 2, "两个选项：安排 / 跳过");
  const descriptions = q.options.map((o) => o.description ?? "");
  assert.ok(descriptions.every((d) => d.length > 0), "两个选项都要有说明");
  assert.match(descriptions[0], /独立子代理/, "安排项须说明会派独立子代理");
  assert.match(descriptions[1], /不做独立把关/, "跳过项须说明本次不做独立把关");
  for (const option of q.options) {
    assert.notEqual(option.description, option.label, `选项「${option.label}」的说明不得与标签重复`);
  }
  install.dispose();
});


test("review-ask seam: 占位词 task 与 null 同义（MAJOR-2 的绕过口）", async () => {
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
	const home = await freshHome();
	let asked = 0;
	const { seams, install } = installWith(async () => {
		asked += 1;
		return { answers: [{ id: "ldvh-review-ask", selected: ["跳过，直接推进"] }] };
	}, home);
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
	assert.notEqual(entry.task, "当次任务", "占位词不得写进载体——它标识不了「是哪件事」");
	install.dispose();
});
