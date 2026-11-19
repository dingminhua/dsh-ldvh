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
  assert.deepEqual(r.tables.slots.tri.breaking.removed, [], "在用槽位不得被删除");

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
  assert.equal(r.upgradeGuides.totalAdded, 22, `回填后区间 guide 总数应为 22；实得 ${r.upgradeGuides.totalAdded}（若上游又回填了新 guide，核实后更新本锚）`);
});
