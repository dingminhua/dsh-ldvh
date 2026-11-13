// 回归锚点 — Norm host-upgrade-followup「验证与遵从性检查」第 1 条的机械承载。
//
// 锚定两段**已被人工独立登记过**的区间，差分器的机械结论必须与人工登记数字
// 吻合（吻合 = 机械通道与既有权威同源可信）；并锚定**三次已知真实破坏**必须
// 被差分器报出（漏报 = 机制失去存在意义）：
//
//   A. dsh-v0.2.1-rc.5 → dsh-v0.2.2-rc.1（norm a1b559a6 2026-11-05 登记：
//      0.2 线首次破坏性变更）
//      · 服务表 98→107、槽位表 103→109（spark 76ee7b7b PoC 数字）
//      · schedule-agent-tools / fs-observation-policy-default-off 须强匹配
//        （schedule 服务重建、fs 观察策略默认关——两处 norm 已登记的破坏面）
//      · 消费面服务 schedule 的 methods 契约变更须报「破坏（初值）」
//
//   B. dsh-v0.2.0-rc.2 → dsh-v0.2.1-alpha.1（research 21ea3e9f 登记：
//      invariants 删除 + subagent-activations 迁移）
//      · 服务表 removed 含 invariants 且落「破坏（初值）」（消费面成员）
//      · subagent-activations 须强匹配 subagents（guide 回填陷阱的回归锚：
//        该 guide 在 alpha.1 tag 当时不存在、由上游回填——差分器必须从
//        最新 tree 读，否则此断言转红，见 lib/host-version.js 头注）
//
// 依赖外部上游克隆：缺席时 skip；**克隆在而锚点 tag 缺失时不 skip、直接失败**
// （runbook 第 1 步的 fetch 纪律属开发机义务，skip 会掩盖它——corpus.test
// 同款「skip 不得静默掩盖」纪律）。
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runDiff, normalizeTag, loadConsumption } from "../scripts/host-contract-diff.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.LDVH_UPSTREAM_REPO ?? "/Users/dmh2002/DshProject/deepseek-harness";
const ANCHOR_TAGS = ["dsh-v0.2.1-rc.5", "dsh-v0.2.2-rc.1", "dsh-v0.2.0-rc.2", "dsh-v0.2.1-alpha.1"];

const repoPresent = existsSync(join(REPO, ".git"));
let tagsPresent = false;
if (repoPresent) {
  const listed = execFileSync("git", ["tag", "--list", ...ANCHOR_TAGS], { cwd: REPO, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  tagsPresent = listed.length === ANCHOR_TAGS.length;
}

const consumption = loadConsumption(join(PLUGIN, "lib", "host-consumption.json"));

/** 区间 A 报告（惰性求值一次，多个用例共享）。 */
let reportA = null;
let reportB = null;
function diffA() {
  if (reportA === null) {
    reportA = runDiff({ repo: REPO, baseTag: normalizeTag("0.2.1-rc.5"), targetTag: normalizeTag("0.2.2-rc.1"), consumption });
  }
  return reportA;
}
function diffB() {
  if (reportB === null) {
    reportB = runDiff({ repo: REPO, baseTag: normalizeTag("0.2.0-rc.2"), targetTag: normalizeTag("0.2.1-alpha.1"), consumption });
  }
  return reportB;
}

test("上游克隆在而锚点 tag 缺失 = 违反 runbook fetch 纪律，不得由 skip 掩盖", (t) => {
  if (!repoPresent) {
    t.skip(`上游克隆缺席（${REPO}）——本用例与后续锚点用例一并 skip；克隆在场时此路径不可达`);
    return;
  }
  assert.ok(tagsPresent, `上游克隆在场但锚点 tag 不全（需 ${ANCHOR_TAGS.join(", ")}）——先 git fetch --tags（Norm runbook 第 1 步），不得 skip`);
});

test("锚 A：rc.5→0.2.2-rc.1 表规模与人工登记数字吻合（服务 98→107、槽位 103→109）", (t) => {
  if (!repoPresent || !tagsPresent) { t.skip("上游克隆或锚点 tag 缺席（见上一用例的判定）"); return; }
  const r = diffA();
  assert.equal(r.tables.services.base, 98);
  assert.equal(r.tables.services.target, 107);
  assert.equal(r.tables.slots.base, 103);
  assert.equal(r.tables.slots.target, 109);
  // 事件表：norm 未登记数字，只锚「解析得出且 target>base」的弱不变量
  assert.ok(r.tables.events.target >= r.tables.events.base, "事件表不应缩小（该区间只增）");
});

test("锚 A：schedule 服务重建被报为破坏初值（消费面成员 methods 契约变更）", (t) => {
  if (!repoPresent || !tagsPresent) { t.skip("上游克隆或锚点 tag 缺席"); return; }
  const r = diffA();
  const changedIds = r.tables.services.tri.breaking.changed.map((c) => c.id);
  assert.ok(changedIds.includes("schedule"), `schedule 必须落破坏初值（norm 已登记的 0.2.2 线首破坏）；实得 ${JSON.stringify(changedIds)}`);
});

test("锚 A：schedule-agent-tools 与 fs-observation-policy-default-off 强匹配", (t) => {
  if (!repoPresent || !tagsPresent) { t.skip("上游克隆或锚点 tag 缺席"); return; }
  const r = diffA();
  const strongItems = r.upgradeGuides.matched.filter((g) => g.match === "strong").map((g) => g.item);
  assert.ok(strongItems.includes("schedule-agent-tools"), `schedule-agent-tools 须强匹配；实得 ${JSON.stringify(strongItems)}`);
  assert.ok(strongItems.includes("fs-observation-policy-default-off"), `fs-observation-policy-default-off 须强匹配；实得 ${JSON.stringify(strongItems)}`);
});

test("锚 A：三个在用槽位的**注册面**零破坏，diff 报出的字段变更须逐条有归因", (t) => {
  if (!repoPresent || !tagsPresent) { t.skip("上游克隆或锚点 tag 缺席"); return; }
  const r = diffA();
  // 一、槽位键本身零删除：这是「注册面不破」的硬断言，永远成立。
  assert.deepEqual(r.tables.slots.tri.breaking.removed, [], "在用槽位不得被删除");

  // 二、契约字段变更**不再断言为零**（2026-11-13 更正）。
  //
  // 原断言是「四个槽位的契约字段零变更」，依据 norm a1b559a6 在 2026-10-30 /
  // 11-05 的登记。该登记**是错的**——它成立于解析器把多行字段截断到第一个内层
  // `},` 的时期（见 lib/host-contract-catalog.js parseEntryFields 头注），
  // `ownerProps` / `keyDomain` 这类多行字段根本没有被完整比对过。修好解析器后，
  // rc.5→0.2.2-rc.1 区间实测确实有两条变更：
  //
  //   · conversation.chat.node.ownerProps —— 少 `fileMentions`
  //     （连带 ownerPropsReferences 少 MarkdownFileMentions）；
  //   · plugins.bundle.config.keyDomain  —— 「already taken」清单多一个
  //     `@deepseek-ai/dsh-cua-bundle`（注册表快照，不是键域形状）。
  //
  // **2026-11-13 起 conversation.chat.node 退出消费面**（宿主 0.2.2-rc.2 让
  // Context 注入行原生可见，本插件不再注册该槽位，详见 client-contract.test.mjs
  // 与 lib/client.js）。故它不再参与本断言的「消费面变更」比对，期望集合随之
  // 只剩 plugins.bundle.config 一条。**该槽位的历史变更是已知且无需处置的**
  // （本插件当年只读 `props.node`，从不读 fileMentions），此处保留说明而不是
  // 让历史事实随条目移除而消失。
  //
  // 剩余这条不是对本插件的破坏：plugins.bundle.config 用的是本包名作键，
  // 已占用清单增减与它无关。故断言保持「变更集合精确等于已归因集合」——未来的
  // 新变更仍会转红，但历史事实不再被一句错误的全称断言掩盖。
  //
  // 2026-11-13：plugins.bundle.config 与 plugins.row.config **双双退出消费面**
  // （Human 决定「设置只留一处」，两个 keyed 槽位撤除，改用 settings.section）。
  // 退出消费面后，宿主对这两个槽位的契约字段变更**不再影响本插件**，故期望集合
  // 随之清空——**不是**「变更消失了」，是「变更与我们无关了」。
  //
  // 这里保留一句历史说明而不让它随条目移除而消失：那条 keyDomain 变更
  // （「already taken」清单多一个 @deepseek-ai/dsh-cua-bundle）当年被归因为
  // 「注册表快照，与本插件用包名作键无关」；该归因对已撤除的槽位仍然成立，
  // 只是不再构成对本插件的约束。
  const KNOWN_SLOT_FIELD_CHANGES = {
  };
  const observed = {};
  for (const c of r.tables.slots.tri.breaking.changed) observed[c.id] = [...c.contractFields].sort();
  const expected = {};
  for (const [k, v] of Object.entries(KNOWN_SLOT_FIELD_CHANGES)) expected[k] = [...v].sort();
  assert.deepEqual(
    observed,
    expected,
    "槽位契约字段变更集合必须精确等于已归因的条目；出现新条目须重新判断是否影响本插件",
  );

  // 三、其余在用槽位仍须零契约变更（它们是真正没变的）。
  // 在用槽位 = conversation.view（会话视图）+ settings.section /
  // settings.section.icon（设置页那节与其图标，2026-11-13 新增）。
  for (const id of ["conversation.view", "settings.section", "settings.section.icon"]) {
    assert.equal(observed[id], undefined, `${id} 不得出现契约字段变更`);
  }
});

test("锚 B：invariants 删除被报为破坏初值（消费面成员 removed）", (t) => {
  if (!repoPresent || !tagsPresent) { t.skip("上游克隆或锚点 tag 缺席"); return; }
  const r = diffB();
  assert.ok(r.tables.services.diff.removed.includes("invariants"), "invariants 必须在 removed");
  assert.ok(r.tables.services.tri.breaking.removed.includes("invariants"), "invariants 是消费面成员，必须落破坏初值");
});

test("锚 B：subagent-activations 强匹配——guide 回填陷阱的回归锚", (t) => {
  if (!repoPresent || !tagsPresent) { t.skip("上游克隆或锚点 tag 缺席"); return; }
  const r = diffB();
  const guide = r.upgradeGuides.matched.find((g) => g.item === "subagent-activations");
  assert.ok(guide, `subagent-activations 必须在区间 guide 清单中（该 guide 由上游回填到 alpha.1 目录——若差分器退回「按 targetTag 当时 tree 枚举」的实现，本断言转红）；实得 ${JSON.stringify(r.upgradeGuides.matched.map((g) => g.item))}`);
  assert.equal(guide.match, "strong", "subagent-activations 须强匹配 subagents token（单复数归一）");
});

test("锚 B：区间 guide 数量 = 最新 tree 上 (0.2.0-rc.2, 0.2.1-alpha.1] 的全部条目（22）", (t) => {
  if (!repoPresent || !tagsPresent) { t.skip("上游克隆或锚点 tag 缺席"); return; }
  const r = diffB();
  // 22 = 2026-11-11 实测 dsh-v0.2.2-rc.1 tree 上 v0.2.1-alpha.1 目录的 guide.md 数。
  // 上游若再往该目录回填新 guide，此数字会涨——那是**事实变化**，须人工核实后更新本锚。
  assert.equal(r.upgradeGuides.totalAdded, 22, `回填后区间 guide 总数应为 22；实得 ${r.upgradeGuides.totalAdded}（若上游又回填了新 guide，核实后更新本锚）`);
});
