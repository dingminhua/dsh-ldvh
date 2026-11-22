
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildNormDirectory, buildNormDirectoryForRoot, NORM_DIRECTORY_SECTION_NAME } from "../lib/norm-directory.js";
import { buildRecallInjection } from "../lib/recall-injection.js";
import { seedFactCorpus } from "./helpers.mjs";

async function writeNorm(dir, uid, { title, directionKey, governs, whenToRead, positioning = null }) {
  const body = positioning === null
    ? [
      "## 方向定位与适用范围",
      "",
      `**管什么**：${governs}`,
      "",
      `**何时查阅**：${whenToRead}`,
      "",
      "## 核心规则体系",
      "",
      "规则一。",
      "",
      "## 约束与反模式",
      "",
      "禁止项。",
      "",
      "## 验证与遵从性检查",
      "",
      "核对方式。",
      "",
    ].join("\n")
    : positioning;
  await writeFile(
    join(dir, `norm-${uid}.md`),
    [
      "---",
      `title: ${title}`,
      "status: active",
      `direction_key: ${directionKey}`,
      `object_uid: ${uid}`,
      "fact_type_key: norm",
      "created_at: 2026-11-15T00:00:00.000Z",
      "---",
      "",
      `# ${title}`,
      "",
      body,
    ].join("\n"),
    "utf8",
  );
}

test("目录：全部 active Norm 的标题与两句定位逐条 inline，尾注承接查阅时机", async () => {
  const project = await mkdtemp(join(tmpdir(), "ldvh-normdir-"));
  try {
    const dir = join(project, "ldvh-base", "norms");
    await mkdir(dir, { recursive: true });
    await writeNorm(dir, "aaaaaaaa-0000-4000-8000-000000000001", {
      title: "合成方向甲",
      directionKey: "fixture-direction-alpha",
      governs: "本方向管合成语料甲方向的准入边界。",
      whenToRead: "改动合成语料甲方向前查阅本规范。",
    });
    await writeNorm(dir, "bbbbbbbb-0000-4000-8000-000000000002", {
      title: "合成方向乙",
      directionKey: "fixture-direction-beta",
      governs: "本方向管合成语料乙方向的发布门禁。",
      whenToRead: "执行合成语料乙方向的发布动作前查阅本规范。",
    });
    const { loadFacts } = await import("../lib/source-recall.js");
    const facts = await loadFacts(join(project, "ldvh-base"));
    const directory = buildNormDirectory(facts, { budgetChars: 4096 });
    assert.equal(directory.total, 2, "两份 active Norm 都要列入");
    assert.equal(directory.shown, 2, "预算充足时不得截断");
    assert.equal(directory.truncated, false);
    for (const [title, governs, when] of [
      ["合成方向甲", "本方向管合成语料甲方向的准入边界。", "改动合成语料甲方向前查阅本规范。"],
      ["合成方向乙", "本方向管合成语料乙方向的发布门禁。", "执行合成语料乙方向的发布动作前查阅本规范。"],
    ]) {
      assert.ok(directory.text.includes(title), `标题「${title}」须在场`);
      assert.ok(directory.text.includes(governs), `「管什么」须 inline：${governs}`);
      assert.ok(directory.text.includes(when), `「何时查阅」须 inline：${when}`);
    }
    assert.match(directory.text, /何时查阅.*时机成立即须读全文/, "尾注须写明查阅时机成立即须读全文");
    assert.match(directory.text, /不证明适用/, "目录仍须如实声明不证明适用");
    assert.match(directory.text, /ldvh_norm_list/, "须给出全量入口");
    assert.ok(directory.text.startsWith("【事实规范目录"), "目录须有段头");
    assert.equal(NORM_DIRECTORY_SECTION_NAME, "事实规范目录");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("目录：预算不足时整份成对截断并披露条数与全量入口，不得静默", async () => {
  const project = await mkdtemp(join(tmpdir(), "ldvh-normdir-budget-"));
  try {
    const dir = join(project, "ldvh-base", "norms");
    await mkdir(dir, { recursive: true });
    for (let i = 1; i <= 5; i += 1) {
      await writeNorm(dir, `cccccccc-0000-4000-8000-00000000000${i}`, {
        title: `合成方向${String(i).padStart(2, "0")}`,
        directionKey: `fixture-direction-${String(i).padStart(2, "0")}`,
        governs: `本方向管合成语料第${i}号方向的准入边界与例外处理口径。`,
        whenToRead: `改动合成语料第${i}号方向前查阅本规范。`,
      });
    }
    const { loadFacts } = await import("../lib/source-recall.js");
    const facts = await loadFacts(join(project, "ldvh-base"));
    const directory = buildNormDirectory(facts, { budgetChars: 400 });
    assert.equal(directory.total, 5, "总数须如实报告");
    assert.ok(directory.shown < 5, "额度不足时须截断");
    assert.equal(directory.truncated, true, "截断须被标记");
    assert.match(directory.text, /另有 \d+ 条规范未列出/, "须披露未列出的条数");
    assert.match(directory.text, /ldvh_norm_list/, "须给出全量入口");
    const titleLines = directory.text.split("\n").filter((l) => l.startsWith("· "));
    const excerptLines = directory.text.split("\n").filter((l) => l.startsWith("  ↳ "));
    assert.equal(titleLines.length, excerptLines.length, "标题与定位须成对出现，不得留半截");
    const none = buildNormDirectory(facts, { budgetChars: 0 });
    assert.equal(none.text, "", "额度为零时不得注入目录");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("目录：定位不合 23 §8 契约者显式标注「定位不可机械导出」，不得静默省略", async () => {
  const project = await mkdtemp(join(tmpdir(), "ldvh-normdir-unavail-"));
  try {
    const dir = join(project, "ldvh-base", "norms");
    await mkdir(dir, { recursive: true });
    await writeNorm(dir, "dddddddd-0000-4000-8000-000000000001", {
      title: "旧形态方向规范",
      directionKey: "legacy-shape-direction",
      positioning: [
        "## 方向定位与适用范围",
        "",
        "**管什么**：本方向管旧形态事项。",
        "",
        "**不管什么**：其它事项归别处。",
        "",
        "## 核心规则体系",
        "",
        "1. 规则。",
        "",
        "## 约束与反模式",
        "",
        "1. 禁止项。",
        "",
        "## 验证与遵从性检查",
        "",
        "核对方式。",
        "",
      ].join("\n"),
    });
    const { loadFacts } = await import("../lib/source-recall.js");
    const facts = await loadFacts(join(project, "ldvh-base"));
    const directory = buildNormDirectory(facts, { budgetChars: 4096 });
    assert.equal(directory.total, 1, "旧形态规范仍须在目录里（不得省略）");
    assert.equal(directory.unavailable, 1, "须计数");
    assert.match(directory.text, /旧形态方向规范/, "标题须在场");
    assert.match(directory.text, /定位不可机械导出/, "须显式标注定位导不出");
    assert.match(directory.text, /23 §8/, "须点名书写契约依据");
    assert.match(directory.text, /不表示该份没有定位|不证明适用/, "不得让读者读成「这份没有定位」");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("目录：召回注入块内不再并列规范段（单一来源），且候选名额不受目录占用", async () => {
  const project = await mkdtemp(join(tmpdir(), "ldvh-normdir-single-"));
  try {
    await seedFactCorpus(project, { pitfallCount: 1 });
    const r = await buildRecallInjection({
      userText: "把 34 号规范改名成双源召回",
      projectRoot: project,
      limit: 99,
      budgetBytes: 10240,
    });
    assert.doesNotMatch(r.text, /事实规范 · active Norm/, "召回块内不得再并列规范段");
    assert.doesNotMatch(r.text, /管什么：/, "召回块内不得再出现定位摘录");
    assert.match(r.text, /经验 · active Pitfall（25 §12 按需索引）/, "经验按需通道不受目录迁移影响");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("目录：项目目标与 active 子目标标题注入，retired 不出现，无目标时输出不变", async () => {
  const project = await mkdtemp(join(tmpdir(), "ldvh-normdir-goal-"));
  try {
    const dir = join(project, "ldvh-base", "norms");
    await mkdir(dir, { recursive: true });
    await writeNorm(dir, "aaaaaaaa-0000-4000-8000-000000000001", {
      title: "合成方向甲",
      directionKey: "fixture-direction-alpha",
      governs: "本方向管合成语料甲方向的准入边界。",
      whenToRead: "改动合成语料甲方向前查阅本规范。",
    });
    const { loadFacts } = await import("../lib/source-recall.js");
    const facts = await loadFacts(join(project, "ldvh-base"));
    const baseline = buildNormDirectory(facts, { budgetChars: 4096 });
    assert.ok(!baseline.text.includes("【项目目标与子目标】"), "无目标对象时不得出现目标段");
    assert.ok(baseline.text.startsWith("【事实规范目录"), "无目标时段头不变");

    const withGoals = buildNormDirectory([
      ...facts,
      { type: "goal", title: "合成项目目标", status: "active" },
      { type: "goal", title: "已退休的旧目标", status: "retired" },
      { type: "subgoal", title: "子目标二", status: "active" },
      { type: "subgoal", title: "子目标一", status: "active" },
      { type: "subgoal", title: "已退休的子目标", status: "retired" },
    ], { budgetChars: 4096 });
    assert.ok(withGoals.text.startsWith("【项目目标与子目标】"), "目标段须在目录段之前");
    assert.match(withGoals.text, /· 目标：合成项目目标/, "目标标题须在场");
    assert.match(withGoals.text, /· 子目标：子目标一/, "active 子目标标题须在场");
    assert.match(withGoals.text, /· 子目标：子目标二/, "active 子目标标题须在场");
    assert.doesNotMatch(withGoals.text, /已退休的旧目标|已退休的子目标/, "retired 目标不得出现");
    assert.ok(withGoals.text.indexOf("子目标一") < withGoals.text.indexOf("子目标二"), "子目标须按标题排序");
    assert.match(withGoals.text, /【事实规范目录 · active Norm/, "原 norm 段头须保留");
    assert.equal(withGoals.shown, 1, "norm 条目数不受目标段影响");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("目录：ForRoot 补读顶层 goal.md 并纳入子目标标题", async () => {
  const project = await mkdtemp(join(tmpdir(), "ldvh-normdir-forroot-"));
  try {
    const base = join(project, "ldvh-base");
    const normDir = join(base, "norms");
    const subgoalDir = join(base, "subgoals");
    await mkdir(normDir, { recursive: true });
    await mkdir(subgoalDir, { recursive: true });
    await writeNorm(normDir, "aaaaaaaa-0000-4000-8000-000000000001", {
      title: "合成方向甲",
      directionKey: "fixture-direction-alpha",
      governs: "本方向管合成语料甲方向的准入边界。",
      whenToRead: "改动合成语料甲方向前查阅本规范。",
    });
    await writeFile(join(base, "goal.md"), [
      "---",
      "goal_key: project-goal",
      "title: 合成根目录目标",
      "status: active",
      "---",
      "",
      "# 项目目标",
      "",
      "## 目标陈述",
      "",
      "目标陈述正文。",
      "",
    ].join("\n"), "utf8");
    await writeFile(join(subgoalDir, "subgoal-bbbb.md"), [
      "---",
      "title: 根目录子目标",
      "status: active",
      "object_uid: bbbbbbbb-0000-4000-8000-000000000001",
      "fact_type_key: subgoal",
      "---",
      "",
      "# 根目录子目标",
      "",
      "## 达成条件",
      "",
      "合成达成条件。",
      "",
    ].join("\n"), "utf8");
    const directory = await buildNormDirectoryForRoot({ root: project, budgetChars: 4096 });
    assert.match(directory.text, /· 目标：合成根目录目标/, "顶层 goal.md 标题须被补读");
    assert.match(directory.text, /· 子目标：根目录子目标/, "子目标标题须在场");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("目录：目标段计入预算，norm 条目在剩余额度内截断", async () => {
  const project = await mkdtemp(join(tmpdir(), "ldvh-normdir-goal-budget-"));
  try {
    const dir = join(project, "ldvh-base", "norms");
    await mkdir(dir, { recursive: true });
    for (let i = 1; i <= 5; i += 1) {
      await writeNorm(dir, `cccccccc-0000-4000-8000-00000000000${i}`, {
        title: `合成方向${String(i).padStart(2, "0")}`,
        directionKey: `fixture-direction-${String(i).padStart(2, "0")}`,
        governs: `本方向管合成语料第${i}号方向的准入边界与例外处理口径。`,
        whenToRead: `改动合成语料第${i}号方向前查阅本规范。`,
      });
    }
    const { loadFacts } = await import("../lib/source-recall.js");
    const facts = await loadFacts(join(project, "ldvh-base"));
    const plain = buildNormDirectory(facts, { budgetChars: 400 });
    const withGoal = buildNormDirectory([
      ...facts,
      { type: "goal", title: "合成目标", status: "active" },
      { type: "subgoal", title: "合成子目标一", status: "active" },
      { type: "subgoal", title: "合成子目标二", status: "active" },
      { type: "subgoal", title: "合成子目标三", status: "active" },
      { type: "subgoal", title: "合成子目标四", status: "active" },
    ], { budgetChars: 400 });
    assert.ok(plain.shown > 0 && withGoal.shown > 0, "两侧都要有 norm 条目");
    assert.ok(withGoal.shown < plain.shown, "目标段占用预算后 norm 列出数须减少");
    assert.match(withGoal.text, /· 目标：合成目标|· 子目标：合成子目标/, "预算受限时目标段仍须在场");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
