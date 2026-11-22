
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONSULT_ANSWERS,
  CONSULT_POINT,
  INTERNAL_LOOKUP_TYPES,
  buildInternalQuery,
  classifyInternalHits,
  composeConsultQuestion,
  composeResearchDispatchTemplate,
  internalLookup,
  researchDispatchTemplate,
} from "../lib/research-consult.js";
import { executeResearchConsult } from "../lib/research-consult-tools.js";
import { createHostSeams } from "../lib/host-seams.js";
import { findReviewAskDecision, recordReviewAskDecision, reviewAskFingerprint } from "../lib/review-ask.js";
import { seedFactCorpus } from "./helpers.mjs";

async function corpusRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), "ldvh-consult-corpus-"));
  t.after(async () => {
    await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
  });
  await seedFactCorpus(dir, { pitfallCount: 2 });
  return dir;
}

async function governedHome(t, projectPath) {
  const home = await mkdtemp(join(tmpdir(), "ldvh-consult-home-"));
  t.after(async () => {
    await import("node:fs/promises").then((fs) => fs.rm(home, { recursive: true, force: true }));
  });
  await mkdir(join(home, "ldvh"), { recursive: true });
  await writeFile(join(home, "ldvh", "governed-projects.yaml"), [
    "schema_version: 1",
    "governance_instance_name: consult-test",
    "product_description: test",
    "projects:",
    "  - id: consult-test",
    `    path: ${projectPath}`,
    "    name: consult-test",
    "default_project_id: consult-test",
    "",
  ].join("\n"), "utf8");
  return home;
}

function agentOf(cwd) {
  return { session: { id: "s-consult", header: { sessionId: "s-consult", cwd } } };
}

test("buildInternalQuery：need、keywords、scope 都进查询，空值忽略", () => {
  assert.equal(buildInternalQuery({ need: "查 X 行为" }), "查 X 行为");
  assert.equal(buildInternalQuery({ need: "查 X", keywords: ["a", "  ", "b"] }), "查 X a b");
  assert.equal(buildInternalQuery({ need: "查 X", scope: "v2" }), "查 X v2");
  assert.equal(buildInternalQuery({}), "");
});

test("internalLookup：在合成语料里命中内部对象", async (t) => {
  const root = await corpusRoot(t);
  const found = await internalLookup({ root, need: "合成经验条目1 触发条件" });
  assert.equal(found.ok, true);
  assert.ok(found.hits.length > 0, "合成经验条目应当被召回");
  assert.equal(found.proves_applicability, false, "命中不证明适用");
  assert.match(found.coverage_note, /未命中也不代表没有/);
});

test("internalLookup：查不到时命中集为空，且不把未命中写成「内部没有」", async (t) => {
  const root = await corpusRoot(t);
  const miss = await internalLookup({ root, need: "qqzzxxyyww" });
  assert.equal(miss.ok, true);
  assert.deepEqual(miss.hits, []);
  assert.match(miss.coverage_note, /未命中也不代表没有/);
});

test("internalLookup：词面碰撞也会命中——命中是候选不是结论", async (t) => {
  const root = await corpusRoot(t);
  const noisy = await internalLookup({ root, need: "zzz不存在的合成条目xxx" });
  assert.equal(noisy.ok, true);
  assert.ok(noisy.hits.length > 0, "中文二元组碰撞会命中——这正是「命中不等于适用」的形态");
  assert.equal(noisy.proves_applicability, false);
});

test("internalLookup：空查询直接拒绝，不静默返回空命中", async (t) => {
  const root = await corpusRoot(t);
  const empty = await internalLookup({ root, need: "  " });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "consult/no_query");
});

test("internalLookup：只看内部事实类型（经验、报告、事实规范），不读规范源", () => {
  assert.deepEqual([...INTERNAL_LOOKUP_TYPES], ["pitfall", "report", "norm"]);
});

test("composeConsultQuestion：一行标题，长文案原样通过、不被截断不改写", () => {
  const { question } = composeConsultQuestion({ need: "Node 22 的 fetch 是否默认 keep-alive" });
  assert.match(question, /要不要联网调查？/);
  const longNeed = "x".repeat(400);
  const longScope = "y".repeat(400);
  const long = composeConsultQuestion({ need: longNeed, scope: longScope });
  assert.equal(long.question, `${longNeed}——要不要联网调查？（范围：${longScope}）`);
  assert.ok(long.question.length > 200);
  assert.ok(long.question.startsWith(longNeed));
  assert.ok(long.question.endsWith(`${longScope}）`));
});

test("composeResearchDispatchTemplate：带调研问题、硬性约束与输出格式", () => {
  const prompt = composeResearchDispatchTemplate({
    need: "查 X 的行为",
    purpose: "支撑一个实现判断",
    subQuestions: ["X 是否默认 Y"],
    keywords: ["X Y"]
  });
  assert.match(prompt, /联网调研任务/);
  assert.match(prompt, /查 X 的行为/);
  assert.match(prompt, /支撑一个实现判断/);
  assert.match(prompt, /X 是否默认 Y/);
  assert.match(prompt, /confirmed \/ uncertain \/ gap/);
  assert.match(prompt, /不要下「该怎么做」的结论/);
  const template = researchDispatchTemplate({ need: "查 X" });
  assert.equal(template.point, CONSULT_POINT);
  assert.equal(template.kind, "online-research");
});

test("答复留痕载体接受 research 这一处请示点", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "ldvh-consult-ledger-"));
  t.after(async () => {
    await import("node:fs/promises").then((fs) => fs.rm(home, { recursive: true, force: true }));
  });
  await mkdir(join(home, "ldvh"), { recursive: true });
  const dshHomePath = (...segments) => join(home, ...segments);
  const fingerprint = reviewAskFingerprint({ point: CONSULT_POINT, task: "查 X", scope: "s" });
  const recorded = await recordReviewAskDecision(dshHomePath, {
    fingerprint,
    point: CONSULT_POINT,
    answer: "review",
    task: "查 X"
  });
  assert.equal(recorded.ok, true);
  const found = await findReviewAskDecision(dshHomePath, fingerprint);
  assert.equal(found.ok, true);
  assert.equal(found.value.point, CONSULT_POINT);
  assert.equal(found.value.answer, "review");
});

function installSeams(ask, home) {
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

async function seamHome(t) {
  const home = await mkdtemp(join(tmpdir(), "ldvh-consult-seam-"));
  t.after(async () => {
    await import("node:fs/promises").then((fs) => fs.rm(home, { recursive: true, force: true }));
  });
  await mkdir(join(home, "ldvh"), { recursive: true });
  return home;
}

test("research consult seam：选「联网调查」→ decision research，并留痕", async (t) => {
  const home = await seamHome(t);
  const { seams, install } = installSeams(async () => ({ answers: [{ id: "ldvh-research-consult", selected: ["联网调查"] }] }), home);
  const out = await seams.requestResearchConsult({ need: "查 X", agent: agentOf("/p") });
  assert.equal(out.decision, CONSULT_ANSWERS.RESEARCH);
  assert.equal(out.asked, true);
  const ledger = JSON.parse(await readFile(join(home, "ldvh", "review-ask-decisions.json"), "utf8"));
  assert.equal(ledger.decisions[0].point, CONSULT_POINT);
  install.dispose();
});

test("research consult seam：选「先不查」→ decision skip，并留痕", async (t) => {
  const home = await seamHome(t);
  const { seams, install } = installSeams(async () => ({ answers: [{ id: "ldvh-research-consult", selected: ["先不查"] }] }), home);
  const out = await seams.requestResearchConsult({ need: "查 Y", agent: agentOf("/p") });
  assert.equal(out.decision, CONSULT_ANSWERS.SKIP);
  install.dispose();
});

test("research consult seam：空答复不是答复，且不写载体", async (t) => {
  const home = await seamHome(t);
  const { seams, install } = installSeams(async () => ({ answers: [] }), home);
  const out = await seams.requestResearchConsult({ need: "查 Z", agent: agentOf("/p") });
  assert.equal(out.decision, null);
  assert.equal(out.asked, true);
  const ledger = await readFile(join(home, "ldvh", "review-ask-decisions.json"), "utf8").catch(() => "");
  assert.equal(ledger, "");
  install.dispose();
});

test("research consult seam：无答题器时不提问、不假设决定", async (t) => {
  const home = await seamHome(t);
  const { seams, install } = installSeams(null, home);
  const out = await seams.requestResearchConsult({ need: "查 W", agent: agentOf("/p") });
  assert.equal(out.decision, null);
  assert.equal(out.asked, false);
  install.dispose();
});

test("research consult seam：同内容复用已留痕的答复，不再提问", async (t) => {
  const home = await seamHome(t);
  let asked = 0;
  const { seams, install } = installSeams(async () => {
    asked += 1;
    return { answers: [{ id: "ldvh-research-consult", selected: ["联网调查"] }] };
  }, home);
  const first = await seams.requestResearchConsult({ need: "查 Q", agent: agentOf("/p") });
  const second = await seams.requestResearchConsult({ need: "查 Q", agent: agentOf("/p") });
  assert.equal(first.decision, CONSULT_ANSWERS.RESEARCH);
  assert.equal(second.reused, true);
  assert.equal(second.asked, false);
  assert.equal(asked, 1);
  install.dispose();
});

test("executeResearchConsult：缺 need 直接拒绝", async () => {
  const out = await executeResearchConsult({ need: "  " }, { agent: agentOf("/p") }, {});
  assert.equal(out.outcome, "invalid_request");
  assert.match(out.gaps[0], /need/);
});

test("executeResearchConsult：内部命中 → 不提请，直接给内部候选", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  let asked = 0;
  const out = await executeResearchConsult(
    { need: "合成经验条目1 触发条件" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => { asked += 1; return { decision: "research", asked: true }; } }
    }
  );
  assert.equal(out.outcome, "completed");
  assert.equal(out.result.internal_found, true);
  assert.ok(out.result.internal_hit_count > 0);
  assert.equal(out.result.asked, false);
  assert.equal(asked, 0, "内部命中时不得打扰 Human");
});

test("executeResearchConsult：内部未命中 → 提请；获准后返回派发模板", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  const out = await executeResearchConsult(
    { need: "qqzzxxyyww", purpose: "支撑实现判断" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => ({ decision: "research", asked: true }) }
    }
  );
  assert.equal(out.outcome, "completed");
  assert.equal(out.result.internal_found, false);
  assert.equal(out.result.decision, CONSULT_ANSWERS.RESEARCH);
  assert.equal(out.result.consult_required, true);
  assert.match(out.result.research_template.prompt, /联网调研任务/);
  assert.match(out.result.research_template.prompt, /支撑实现判断/);
});

test("executeResearchConsult：未取得答复 → partial，且明写不阻断行动", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  const out = await executeResearchConsult(
    { need: "qqzzxxyyww" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => ({ decision: null, asked: true, reason: "未决策不是答复" }) }
    }
  );
  assert.equal(out.outcome, "partial");
  assert.equal(out.result.decision, null);
  assert.ok(out.gaps.some((line) => line.includes("不得据此暂停整件工作")));
  assert.ok(out.follow_up.some((line) => line.includes("如实写明")));
});

test("executeResearchConsult：Human 选先不查 → 不联网，且不许把未命中写成「内部没有」", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  const out = await executeResearchConsult(
    { need: "qqzzxxyyww" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => ({ decision: "skip", asked: true }) }
    }
  );
  assert.equal(out.outcome, "completed");
  assert.equal(out.result.decision, CONSULT_ANSWERS.SKIP);
  assert.equal(out.result.consult_required, false);
  assert.ok(out.follow_up.some((line) => line.includes("不得写成「内部没有相关经验」")));
});

test("executeResearchConsult：非管辖项目不受理", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, join(root, "not-registered"));
  const out = await executeResearchConsult(
    { need: "查 X" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => ({ decision: "research", asked: true }) }
    }
  );
  assert.equal(out.outcome, "unavailable");
});

test("internalLookup：弱命中被标出，不与强命中混为一谈", async (t) => {
  const root = await corpusRoot(t);
  const weak = await internalLookup({ root, need: "规范" });
  assert.equal(weak.ok, true);
  assert.ok(weak.hits.length > 0);
  assert.ok(weak.hits.every((hit) => hit.weak_hit === true), "「规范」是通用词，命中应全为弱命中");
  const classified = classifyInternalHits(weak.hits);
  assert.equal(classified.usable, false);
  assert.equal(classified.strong.length, 0);
});

test("executeResearchConsult：内部命中时须提示「强命中也可能全是词面碰撞」并给出升级入口", async (t) => {
	const root = await corpusRoot(t);
	const home = await governedHome(t, root);
	const out = await executeResearchConsult(
		{ need: "合成经验条目1 触发条件" },
		{ agent: agentOf(root) },
		{
			dshHomePath: (...segments) => join(home, ...segments),
			getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
			hostSeams: { requestResearchConsult: async () => ({ decision: "research", asked: true }) }
		}
	);
	assert.ok(out.follow_up.some((line) => line.includes("词面碰撞")), "须提示命中可能是词面碰撞");
	assert.ok(out.follow_up.some((line) => line.includes("internal_gap")), "须给出升级入口");
});

test("executeResearchConsult：只有弱命中时不得硬停，须继续提请", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  let asked = 0;
  const out = await executeResearchConsult(
    { need: "规范" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => { asked += 1; return { decision: "research", asked: true }; } }
    }
  );
  assert.equal(asked, 1, "弱命中不构成「内部已有可用结论」，必须继续走提请");
  assert.equal(out.result.decision, CONSULT_ANSWERS.RESEARCH);
  assert.ok(out.follow_up.some((line) => line.includes("内部只有弱命中")));
});

test("executeResearchConsult：带 internal_gap 时，即使内部有强命中也继续提请", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  let asked = 0;
  const out = await executeResearchConsult(
    { need: "合成经验条目1 触发条件", internal_gap: "内部已有 X 仍缺 Y" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => { asked += 1; return { decision: "research", asked: true }; } }
    }
  );
  assert.equal(asked, 1, "内部缺口声明后必须能真的走到提请（33 §6.6 第 1 项的逃生通道）");
  assert.equal(out.result.consult_required, true);
  assert.ok(out.follow_up.some((line) => line.includes("内部已有 X 仍缺 Y")));
});

test("executeResearchConsult：内部事实源不可读时不得报成「未命中」", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ldvh-consult-empty-"));
  t.after(async () => {
    await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }));
  });
  const home = await governedHome(t, root);
  const out = await executeResearchConsult(
    { need: "qqzzxxyyww" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => ({ decision: "research", asked: true }) }
    }
  );
  assert.equal(out.result.internal_source_read, false);
  assert.equal(out.outcome, "partial", "内部没查成，不能报完成");
  assert.ok(out.gaps.some((line) => line.includes("未检查")));
  assert.ok(out.gaps.some((line) => line.includes("不是「未命中」")));
});

test("executeResearchConsult：未取得答复时已完成内部查找，scope 须如实写", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  const out = await executeResearchConsult(
    { need: "qqzzxxyyww" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: true, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => ({ decision: null, asked: true, reason: "未决策不是答复" }) }
    }
  );
  assert.ok(out.scope.completed.includes("internal-lookup"), "内部查找已完成，须如实登记在 completed");
  assert.ok(out.scope.not_completed.includes("consult"));
});

test("research consult seam：内容指纹含 scope，同 need 不同 scope 不复用旧答复", async (t) => {
  const home = await seamHome(t);
  let asked = 0;
  const { seams, install } = installSeams(async () => {
    asked += 1;
    return { answers: [{ id: "ldvh-research-consult", selected: ["先不查"] }] };
  }, home);
  const first = await seams.requestResearchConsult({ need: "查 X", scope: "v2", agent: agentOf("/p") });
  const second = await seams.requestResearchConsult({ need: "查 X", scope: "v4", agent: agentOf("/p") });
  assert.equal(first.decision, CONSULT_ANSWERS.SKIP);
  assert.equal(second.reused, undefined, "范围变了就不是同一件事，不得复用旧答复");
  assert.equal(second.asked, true);
  assert.equal(asked, 2);
  const same = await seams.requestResearchConsult({ need: "查 X", scope: "v4", agent: agentOf("/p") });
  assert.equal(same.reused, true, "同内容才复用");
  install.dispose();
});

test("executeResearchConsult：开关关闭时不提请，只交还内部读数", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  let asked = 0;
  const out = await executeResearchConsult(
    { need: "qqzzxxyyww" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: false, researchConsultKnown: true }),
      hostSeams: { requestResearchConsult: async () => { asked += 1; return { decision: "research", asked: true }; } }
    }
  );
  assert.equal(asked, 0, "开关关闭时不得打扰 Human");
  assert.equal(out.outcome, "completed");
  assert.equal(out.result.asked, false);
  assert.equal(out.result.consult_required, false);
  assert.ok(out.gaps.some((line) => line.includes("switch_off")));
  assert.ok(out.follow_up.some((line) => line.includes("开关关闭未提请")));
});

test("executeResearchConsult：开关状态读不到时按不可用报告，不当作已关闭", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  let asked = 0;
  const out = await executeResearchConsult(
    { need: "qqzzxxyyww" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      hostSeams: { requestResearchConsult: async () => { asked += 1; return { decision: "research", asked: true }; } }
    }
  );
  assert.equal(out.outcome, "unavailable");
  assert.equal(asked, 0);
  assert.ok(out.gaps.some((line) => line.includes("NOT the same as the switch being off")));
});

test("executeResearchConsult：开关未设置时按不可用报告，不当作已关闭", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  let asked = 0;
  const out = await executeResearchConsult(
    { need: "qqzzxxyyww" },
    { agent: agentOf(root) },
    {
      dshHomePath: (...segments) => join(home, ...segments),
      getReviewAskSettings: () => ({ researchConsult: false, researchConsultKnown: false }),
      hostSeams: { requestResearchConsult: async () => { asked += 1; return { decision: "research", asked: true }; } }
    }
  );
  assert.equal(out.outcome, "unavailable");
  assert.equal(asked, 0);
  assert.ok(out.gaps.some((line) => line.includes("not set in the configuration")));
});

test("开关读取走调用时的配置取值，不在装载时固化（pitfall-2236bdbb）", async (t) => {
  const root = await corpusRoot(t);
  const home = await governedHome(t, root);
  let enabled = false;
  let asked = 0;
  const deps = {
    dshHomePath: (...segments) => join(home, ...segments),
    getReviewAskSettings: () => ({ researchConsult: enabled, researchConsultKnown: true }),
    hostSeams: { requestResearchConsult: async () => { asked += 1; return { decision: "research", asked: true }; } }
  };
  const closed = await executeResearchConsult({ need: "qqzzxxyyww" }, { agent: agentOf(root) }, deps);
  assert.equal(asked, 0);
  assert.equal(closed.result.consult_required, false);
  enabled = true;
  const opened = await executeResearchConsult({ need: "qqzzxxyyww" }, { agent: agentOf(root) }, deps);
  assert.equal(asked, 1, "改设置后须立即生效，不需重启");
  assert.equal(opened.result.consult_required, true);
});
