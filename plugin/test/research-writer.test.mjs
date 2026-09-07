import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  createResearchObject,
  readResearchObject,
  updateResearchObject,
  validateResearchFrontmatter,
  validateBodyStructure,
  extractFindingUnits,
  validateIndexBodyCoherence,
  validateResearchRelations,
} from "../lib/research-writer.js";

let root;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "ldvh-research-test-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

function validFrontmatterDraft() {
  return {
    title: "dsh-agent-teams 插件调研与 LDVH 吸收价值分析",
    status: "active",
    research_question: "dsh-agent-teams 的队长式委派与任务调度对 LDVH 编排系统有什么可吸收模式？",
    research_purpose: "决定 LDVH 编排系统是否引入队长式多角色并行执行",
    stopping_reason: "sufficient",
    urls: [
      { ref: "https://github.com/NanmiCoder/dsh-agent-teams", title: "dsh-agent-teams", summary: "源码仓库 v0.1.12" },
    ],
    confirmed_statements: [
      "F1 队长式委派：单队长 spawn 成员、成员可续聊、任务 DAG 驱动调度",
      "F2 attempt/handoff 单调能力令牌：claim 返回 attemptId，update 必须携带，过期即拒",
    ],
    uncertain: [],
    gaps: [],
    implications: [
      {
        finding_ref: "F2 attempt/handoff 单调能力令牌：claim 返回 attemptId，update 必须携带，过期即拒",
        implication: "该令牌机制与 LDVH Git Gate 的单调提交序列同源，可直接吸收为机械正确性范本",
      },
    ],
    change_summary: "初次创建：基于 dsh-agent-teams v0.1.12 源码静态分析",
  };
}

const validFindingsBody = `## 关键发现

### F1 队长式委派：单队长 spawn 成员、成员可续聊、任务 DAG 驱动调度

队长是唯一的委派入口：spawn 成员、投递任务、收集汇报全部经队长；成员是可续聊的持续会话（不因单轮完成即销毁）；调度由任务 DAG 的事件驱动（前置完成触发后继）。整套形态把"多代理协作"收敛为"单点指挥+持续执行者"。

**对 LDVH 的价值**：这证明 DSH 宿主的子代理机制可以承载"队长-成员"的长期协作形态而无需自建调度器；但 LDVH 的主控模式（单一主控最终负责）已经是队长形态的规范表达，直接复用主控模式即可，不需要引入团队状态机。

溯源：https://github.com/NanmiCoder/dsh-agent-teams（src/agents/manager.ts 调度器与 README 团队协议章节）

### F2 attempt/handoff 单调能力令牌：claim 返回 attemptId，update 必须携带，过期即拒

每个任务执行携带单调 attempt + 唯一 attemptId 令牌；claim_task 返回 attemptId，update_task 必须携带，令牌过期即拒绝；reassign_task 走 invalidateTaskAttempt 先中断旧成员再启动新 attempt；调度器在成员 idle/ready 但仍持有开放任务时以新 attempt 冷恢复重试。

**对 LDVH 的价值**：「单调执行代次 + 能力令牌 + 先撤销后安静 + 冷恢复」是「并发 AI 执行者不可靠」前提下的机械正确性范本，与 LDVH Git Gate 的「单调提交序列 + 署名锚点」同源。

溯源：https://github.com/NanmiCoder/dsh-agent-teams（src/attempts/tokens.ts 与 docs/usage.md 令牌章节）`;

const validAnalysisBody = `## 研究问题
dsh-agent-teams 的队长式委派与任务调度对 LDVH 编排系统有什么可吸收模式？

## 输入与边界
读取 dsh-agent-teams v0.1.12 源码（浅克隆 489c007），静态分析。不运行。

${validFindingsBody}

## 未证实与缺口
（无——两个发现均有源码级证据）

## 建议
A1 吸收 attempt/handoff 令牌模式：可被 21 号 WorkCase 规范（执行授权包）直接承接——目标对象 21，预期目标"授权包含单调 attempt 字段"，验收条件"attempt 不匹配的更新被拒"。判断依据：与 Git Gate 同源的机械正确性已在本仓库验证过两轮。
A2 不吸收团队状态机/任务 DAG：LDVH 主控模式已覆盖委派需求，引入第二套调度模型违反 00 反过度设计。后续监测条件：出现单主控无法承载的并行规模时重新评估。

## 后续分流
- A1 → 创建/更新 21 号规范候选时作为设计输入；信号：21 号启动重建时。
- A2 → 无需对象化；监测条件如 A2 所述。`;

const validSurveyH3Body = `### 调查问题与范围
调查 dsh-agent-teams 的多代理协作形态……

### 调查方法与来源
读源码与 README……

### 调查发现
发现队长-成员-任务三层结构……

### 调查停止与交接
调查收敛，交接分析阶段……`;

test("validateResearchFrontmatter accepts valid thin-index frontmatter", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("validateResearchFrontmatter rejects unknown fields (closed set)", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", custom_field: "x" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("unexpected field")));
});

test("validateResearchFrontmatter rejects empty three-state", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", confirmed_statements: [], uncertain: [], gaps: [] };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("three-state")));
});

test("validateResearchFrontmatter rejects sufficient with empty confirmed_statements", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", confirmed_statements: [] };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("sufficient requires non-empty confirmed_statements")));
});

test("validateResearchFrontmatter rejects implications with unanchored finding_ref", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t",
    implications: [{ finding_ref: "no such statement", implication: "dangling" }] };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("confirmed_statements[] member")));
});

test("validateBodyStructure accepts directed body (six H2: v4 skeleton)", () => {
  const result = validateBodyStructure(validAnalysisBody);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.exploratory, false);
});

test("validateBodyStructure accepts exploratory body (seven H2 with 调查阶段)", () => {
  const exploratoryBody = validAnalysisBody.replace(
    "## 关键发现",
    "## 调查阶段\n\n" + validSurveyH3Body + "\n\n## 关键发现",
  );
  const result = validateBodyStructure(exploratoryBody);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.exploratory, true);
});

test("validateBodyStructure rejects missing 建议 section", () => {
  const bad = validAnalysisBody.replace(/## 建议[\s\S]*?(?=## 后续分流)/, "");
  const result = validateBodyStructure(bad);
  assert.equal(result.ok, false);
});

test("extractFindingUnits extracts units with trace anchors", () => {
  const units = extractFindingUnits(validAnalysisBody);
  assert.equal(units.length, 2);
  assert.equal(units[0].title, "F1 队长式委派：单队长 spawn 成员、成员可续聊、任务 DAG 驱动调度");
  assert.equal(units[0].hasTrace, true);
  assert.equal(units[0].traceRef, "https://github.com/NanmiCoder/dsh-agent-teams");
  assert.ok(units[0].traceAnchor.includes("manager.ts"));
  assert.equal(units[1].hasTrace, true);
});

test("validateIndexBodyCoherence passes when statements match units and anchors valid", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t" };
  const result = validateIndexBodyCoherence(fm, validAnalysisBody);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("validateIndexBodyCoherence flags statement without matching unit", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t",
    confirmed_statements: [...draft.confirmed_statements, "F3 不存在的发现"] };
  const result = validateIndexBodyCoherence(fm, validAnalysisBody);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("no verbatim finding unit")));
});

test("validateIndexBodyCoherence flags unit without trace anchor", () => {
  const noAnchorBody = validAnalysisBody.replace(
    "溯源：https://github.com/NanmiCoder/dsh-agent-teams（src/agents/manager.ts 调度器与 README 团队协议章节）",
    "（此单元故意去掉溯源行）",
  );
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t" };
  const result = validateIndexBodyCoherence(fm, noAnchorBody);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("no 溯源")));
});

test("validateIndexBodyCoherence flags trace ref not in urls", () => {
  const badRefBody = validAnalysisBody.replaceAll(
    "https://github.com/NanmiCoder/dsh-agent-teams（src/agents/manager.ts",
    "https://unregistered.example.com（src/agents/manager.ts",
  );
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t" };
  const result = validateIndexBodyCoherence(fm, badRefBody);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("does not match any urls[].ref")));
});

test("validateIndexBodyCoherence flags 研究问题 section missing question verbatim (24 §8 invariant 10)", () => {
  // 正文研究问题段改写了问题措辞（frontmatter 有「对 LDVH 编排系统」，正文没有）——漂移即拒。
  const driftedBody = validAnalysisBody.replace(
    "dsh-agent-teams 的队长式委派与任务调度对 LDVH 编排系统有什么可吸收模式？",
    "dsh-agent-teams 的队长式委派对编排有什么可吸收模式？（措辞已漂移）",
  );
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t" };
  const result = validateIndexBodyCoherence(fm, driftedBody);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("must contain research_question verbatim")));
});

test("validateIndexBodyCoherence accepts 研究问题 section that expands around the verbatim question", () => {
  // 原文逐字在场 + 其外展开背景：合法。
  const expandedBody = validAnalysisBody.replace(
    "dsh-agent-teams 的队长式委派与任务调度对 LDVH 编排系统有什么可吸收模式？",
    "dsh-agent-teams 的队长式委派与任务调度对 LDVH 编排系统有什么可吸收模式？\n\n调研对象为 dsh-agent-teams v0.1.12（单队长多成员的任务编排插件）；本轮调研为 LDVH 编排系统是否引入队长式多角色并行执行提供依据。",
  );
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t" };
  const result = validateIndexBodyCoherence(fm, expandedBody);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("createResearchObject creates directed object with v4-style body", async () => {
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: { provider: "zzztoken-glm", model: "glm-5.3" },
  });
  assert.ok(result.ok, JSON.stringify(result.error));
  const readBack = await readResearchObject({ factSourceRoot: root, objectUid: result.value.object_uid });
  assert.ok(readBack.ok);
  assert.equal(readBack.value.exploratory, false);
  assert.equal(readBack.value.frontmatter.confirmed_statements.length, 2);
  assert.ok(readBack.value.body.includes("对 LDVH 的价值"));
});

test("createResearchObject creates exploratory object", async () => {
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    surveyBody: validSurveyH3Body,
  });
  assert.ok(result.ok, JSON.stringify(result.error));
  const readBack = await readResearchObject({ factSourceRoot: root, objectUid: result.value.object_uid });
  assert.ok(readBack.ok);
  assert.equal(readBack.value.exploratory, true);
  assert.ok(readBack.value.body.includes("## 调查阶段"));
});

test("createResearchObject rejects coherence violation (statement without unit)", async () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const bad = { ...draft, confirmed_statements: [...draft.confirmed_statements, "幽灵声明"] };
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: bad,
    analysisBody: validAnalysisBody,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/coherence_invalid");
});

test("readResearchObject rejects invalid uid (path injection)", async () => {
  const result = await readResearchObject({ factSourceRoot: root, objectUid: "../../etc/passwd" });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/invalid_uid");
});

test("updateResearchObject CAS flow with change_log", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: { provider: "p", model: "m" },
  });
  assert.ok(created.ok);
  const uid = created.value.object_uid;

  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read1.ok);

  const fmAfter = { ...read1.value.frontmatter, status: "retired", retirement_reason: "outdated" };
  const updated = await updateResearchObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: fmAfter,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "retire: 资料过时",
    sessionSignature: { provider: "p", model: "m" },
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));

  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read2.ok);
  assert.equal(read2.value.frontmatter.status, "retired");
  assert.equal(read2.value.frontmatter.change_log.length, 2);
});

test("updateResearchObject rejects stale fingerprint", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
  });
  assert.ok(created.ok);
  const result = await updateResearchObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: "0".repeat(64),
    frontmatterAfter: created.value,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "x",
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/cas_conflict");
});

test("updateResearchObject rejects sub-stage change", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    surveyBody: validSurveyH3Body,
  });
  assert.ok(created.ok);
  const read = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read.ok);
  const result = await updateResearchObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: read.value.frontmatter,
    analysisBodyAfter: validAnalysisBody,
    surveyBodyAfter: null,
    changeSummary: "remove survey",
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/substage_immutable");
});

// ---------------------------------------------------------------------------
// Relations contract (specs/24 §11 + 03 §7.2) — T4 enforcement
// ---------------------------------------------------------------------------

test("validateResearchRelations accepts relations omitted entirely", () => {
  const check = validateResearchRelations(validFrontmatterDraft(), null);
  assert.ok(check.ok, JSON.stringify(check.issues));
});

test("validateResearchRelations accepts closed-set keys with canonical targets", () => {
  const check = validateResearchRelations({
    relations: [
      { relation_key: "inspired-by", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
      { relation_key: "informs", target: { object_uid: "22222222-2222-4222-8222-222222222222" } },
    ],
  }, null);
  assert.ok(check.ok, JSON.stringify(check.issues));
});

test("validateResearchRelations rejects forbidden keys (supersedes/depends-on)", () => {
  for (const key of ["supersedes", "depends-on"]) {
    const check = validateResearchRelations({
      relations: [{ relation_key: key, target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
    }, null);
    assert.ok(!check.ok);
    assert.ok(check.issues.some((i) => i.includes("forbidden")));
  }
});

test("validateResearchRelations rejects unknown relation_key", () => {
  const check = validateResearchRelations({
    relations: [{ relation_key: "cites", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
  }, null);
  assert.ok(!check.ok);
  assert.ok(check.issues.some((i) => i.includes("closed set")));
});

test("validateResearchRelations rejects v4 legacy target ids and legacy triples", () => {
  const legacy = validateResearchRelations({
    relations: [{ relation_key: "informs", target: { object_uid: "study-01M0SPKT43E1" } }],
  }, null);
  assert.ok(!legacy.ok);
  assert.ok(legacy.issues.some((i) => i.includes("canonical UUID")));
  const triple = validateResearchRelations({
    relations: [{ relation_key: "informs", target: { object_id: "study-01M0SPKT43E1", fact_type_key: "spark", title: "x" } }],
  }, null);
  assert.ok(!triple.ok);
  assert.ok(triple.issues.some((i) => i.includes("target.object_uid")));
});

test("validateResearchRelations enforces updates cardinality, self-reference and dedupe", () => {
  const two = validateResearchRelations({
    relations: [
      { relation_key: "updates", target: { object_uid: "33333333-3333-4333-8333-333333333333" } },
      { relation_key: "updates", target: { object_uid: "44444444-4444-4444-8444-444444444444" } },
    ],
  }, null);
  assert.ok(!two.ok);
  assert.ok(two.issues.some((i) => i.includes("at most one updates")));
  const self = validateResearchRelations({
    relations: [{ relation_key: "updates", target: { object_uid: "55555555-5555-4555-8555-555555555555" } }],
  }, "55555555-5555-4555-8555-555555555555");
  assert.ok(!self.ok);
  assert.ok(self.issues.some((i) => i.includes("itself")));
  const dup = validateResearchRelations({
    relations: [
      { relation_key: "informs", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
      { relation_key: "informs", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
    ],
  }, null);
  assert.ok(!dup.ok);
  assert.ok(dup.issues.some((i) => i.includes("duplicate")));
});

test("createResearchObject rejects invalid relations but accepts resolvable updates target", async () => {
  const bad = { ...validFrontmatterDraft(), relations: [{ relation_key: "supersedes", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }] };
  const rejected = await createResearchObject({ factSourceRoot: root, frontmatterDraft: bad, analysisBody: validAnalysisBody });
  assert.ok(!rejected.ok);
  assert.equal(rejected.error.code, "research/relations_invalid");

  // Create a first object, then a second one updating it — resolvable target passes.
  const first = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody });
  assert.ok(first.ok);
  const secondDraft = { ...validFrontmatterDraft(), relations: [{ relation_key: "updates", target: { object_uid: first.value.object_uid } }] };
  const second = await createResearchObject({ factSourceRoot: root, frontmatterDraft: secondDraft, analysisBody: validAnalysisBody });
  assert.ok(second.ok, JSON.stringify(second.error));

  // A dangling updates target must fail resolution.
  const dangling = { ...validFrontmatterDraft(), relations: [{ relation_key: "updates", target: { object_uid: "99999999-9999-4999-8999-999999999999" } }] };
  const failed = await createResearchObject({ factSourceRoot: root, frontmatterDraft: dangling, analysisBody: validAnalysisBody });
  assert.ok(!failed.ok);
  assert.equal(failed.error.code, "research/relation_target_unresolvable");
});

// ---------------------------------------------------------------------------
// Retirement contract (24 §8 retirement_reason + §9 retired invariants)
// ---------------------------------------------------------------------------

test("validateResearchFrontmatter requires retirement_reason when status=retired", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", status: "retired" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("retirement_reason")));
});

test("validateResearchFrontmatter rejects retirement_reason with closed-set violation", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", status: "retired", retirement_reason: "anything-else" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("retirement_reason must be one of")));
});

test("validateResearchFrontmatter requires retired_at when status=retired", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", status: "retired", retirement_reason: "outdated" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("retired_at")));
});

test("validateResearchFrontmatter rejects retirement fields when status=active", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", retirement_reason: "outdated" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("retirement_reason must not be present when status=active")));
});

test("validateResearchFrontmatter requires updates relation when retirement_reason=superseded", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", status: "retired", retirement_reason: "superseded", retired_at: "2026-09-07T00:50:00.000Z" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("superseded requires at least one updates relation")));
});

test("validateResearchFrontmatter accepts retired with valid retirement_reason and retired_at", () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t", status: "retired", retirement_reason: "out-of-scope", retired_at: "2026-09-07T00:50:00.000Z" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("createResearchObject rejects status=retired on initial create (24 §9 initial state)", async () => {
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const bad = { ...draft, status: "retired", retirement_reason: "out-of-scope", retired_at: "2026-09-07T00:50:00.000Z" };
  const result = await createResearchObject({ factSourceRoot: root, frontmatterDraft: bad, analysisBody: validAnalysisBody });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/initial_state_violation");
});

test("updateResearchObject rejects status=retired without retirement_reason", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
  });
  assert.ok(created.ok);
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read1.ok);
  const fmAfter = { ...read1.value.frontmatter, status: "retired" };
  const updated = await updateResearchObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: fmAfter,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "retire without reason",
  });
  assert.ok(!updated.ok);
  assert.equal(updated.error.code, "research/frontmatter_invalid");
  assert.ok(updated.error.details.issues.some((i) => i.includes("retirement_reason")));
});

test("updateResearchObject rejects AI-supplied retired_at (Code-managed only)", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
  });
  assert.ok(created.ok);
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read1.ok);
  const fmAfter = { ...read1.value.frontmatter, status: "retired", retirement_reason: "outdated", retired_at: "1999-01-01T00:00:00.000Z" };
  const updated = await updateResearchObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: fmAfter,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "retire with bad retired_at",
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));
  // Code should overwrite AI-supplied retired_at with wall-clock now
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read2.ok);
  assert.notEqual(read2.value.frontmatter.retired_at, "1999-01-01T00:00:00.000Z");
});

test("updateResearchObject rejects retirement_reason=superseded without updates relation", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
  });
  assert.ok(created.ok);
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read1.ok);
  const fmAfter = { ...read1.value.frontmatter, status: "retired", retirement_reason: "superseded" };
  const updated = await updateResearchObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: fmAfter,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "retire superseded without relation",
  });
  assert.ok(!updated.ok);
  assert.equal(updated.error.code, "research/frontmatter_invalid");
  assert.ok(updated.error.details.issues.some((i) => i.includes("superseded requires at least one updates relation")));
});

test("updateResearchObject accepts retirement_reason=superseded with resolvable updates relation", async () => {
  // first: a replacement
  const replacement = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody });
  assert.ok(replacement.ok);
  // second: the one that will be retired
  const created = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody });
  assert.ok(created.ok);
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read1.ok);
  const fmAfter = {
    ...read1.value.frontmatter,
    status: "retired",
    retirement_reason: "superseded",
    relations: [{ relation_key: "updates", target: { object_uid: replacement.value.object_uid } }],
  };
  const updated = await updateResearchObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: fmAfter,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "retire superseded with replacement",
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read2.ok);
  assert.equal(read2.value.frontmatter.status, "retired");
  assert.equal(read2.value.frontmatter.retirement_reason, "superseded");
  assert.ok(typeof read2.value.frontmatter.retired_at === "string" && read2.value.frontmatter.retired_at.length > 0);
});

test("updateResearchObject rejects transition retired → active (terminal)", async () => {
  const replacement = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody });
  const created = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody });
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  // First, retire
  const retireFm = { ...read1.value.frontmatter, status: "retired", retirement_reason: "superseded", relations: [{ relation_key: "updates", target: { object_uid: replacement.value.object_uid } }] };
  const retired = await updateResearchObject({
    factSourceRoot: root, objectUid: created.value.object_uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: retireFm, analysisBodyAfter: validAnalysisBody,
    changeSummary: "retire",
  });
  assert.ok(retired.ok);
  // Now try to re-open
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  const reopenFm = { ...read2.value.frontmatter, status: "active" };
  delete reopenFm.retirement_reason; delete reopenFm.retired_at;
  const reopened = await updateResearchObject({
    factSourceRoot: root, objectUid: created.value.object_uid,
    expectedFingerprint: read2.value.fingerprint,
    frontmatterAfter: reopenFm, analysisBodyAfter: validAnalysisBody,
    changeSummary: "reopen",
  });
  assert.ok(!reopened.ok);
  assert.equal(reopened.error.code, "research/status_terminal");
});

test("validateBodyStructure flags retired 建议 section without a 'still-referable' keyword", () => {
  const badRetireBody = `## 研究问题
验证 retired 退出说明是否生效。

## 输入与边界
仅工具面。

## 关键发现

### 24 号 retired 硬约束
正文 24 §9 退出完整性不变量。

溯源：https://github.com/NanmiCoder/dsh-agent-teams（README）

## 未证实与缺口
无。

## 建议
A1 修复方法 X：本次调研完成，无行动建议，文件仅作内部存档。

## 后续分流
- A1 → 归档`;
  const check = validateBodyStructure(badRetireBody, true);
  assert.equal(check.ok, false);
  assert.ok(check.issues.some((i) => i.includes("建议 section must explicitly state")));
});

test("validateBodyStructure accepts retired 建议 section with a 'still-referable' keyword", () => {
  const goodRetireBody = `## 研究问题
验证 retired 退出说明是否生效。

## 输入与边界
仅工具面。

## 关键发现

### 24 号 retired 硬约束
正文 24 §9 退出完整性不变量。

溯源：https://github.com/NanmiCoder/dsh-agent-teams（README）

## 未证实与缺口
无。

## 建议
A1 修复方法 X：研究→执行断链由回查条件说明补足——可被后续 ADR 在重新评估时检索本对象。

## 后续分流
- A1 → 修复`;
  const check = validateBodyStructure(goodRetireBody, true);
  assert.equal(check.ok, true, JSON.stringify(check.issues));
});

test("frontmatter fields are written in the canonical reading order regardless of caller key order (24 §7)", async () => {
  // 故意按字母序传入 draft——写出必须仍是规范序：语义块在前、流水沉底。
  const alphabetical = {};
  for (const key of Object.keys(validFrontmatterDraft()).sort()) alphabetical[key] = validFrontmatterDraft()[key];
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: alphabetical,
    analysisBody: validAnalysisBody,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues ?? result.error));
  const raw = await readFile(join(root, "researches", `research-${result.value.object_uid}.md`), "utf8");
  const fmEnd = raw.indexOf("\n---\n", 5);
  const fm = parseYaml(raw.slice(4, fmEnd));
  const keys = Object.keys(fm);
  // 24 §7：title 首位，change_log 沉底，语义序（question 在 confirmed 之前）。
  assert.equal(keys[0], "title");
  assert.equal(keys.at(-1), "change_log");
  assert.ok(keys.indexOf("research_question") < keys.indexOf("confirmed_statements"));
  assert.ok(keys.indexOf("stopping_reason") < keys.indexOf("confirmed_statements"));
  assert.ok(keys.indexOf("urls") < keys.indexOf("object_uid"));
});
