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
  correctResearchObject,
  validateResearchFrontmatter,
  validateBodyStructure,
  extractFindingUnits,
  validateIndexBodyCoherence,
  validateResearchRelations,
  validateInternalSourceAnchors,
  INTERNAL_SOURCE_KINDS,
} from "../lib/report-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";

const TEST_SIGNATURE = authoritativeSignature({ provider: "test-provider", model: "test-model" });

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
A1 吸收 attempt/handoff 令牌模式：可被执行授权包直接承接——预期目标"授权包含单调 attempt 字段"，验收条件"attempt 不匹配的更新被拒"。判断依据：与 Git Gate 同源的机械正确性已在本仓库验证过两轮。
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
  const expandedBody = validAnalysisBody.replace(
    "dsh-agent-teams 的队长式委派与任务调度对 LDVH 编排系统有什么可吸收模式？",
    "dsh-agent-teams 的队长式委派与任务调度对 LDVH 编排系统有什么可吸收模式？\n\n调研对象为 dsh-agent-teams v0.1.12（单队长多成员的任务编排插件）；本轮调研为 LDVH 编排系统是否引入队长式多角色并行执行提供依据。",
  );
  const { change_summary: _cs, ...draft } = validFrontmatterDraft();
  const fm = { ...draft, object_uid: "u", fact_type_key: "research", created_at: "t" };
  const result = validateIndexBodyCoherence(fm, expandedBody);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("createResearchObject REFUSES a forged plain sessionSignature — no unsigned change_log entry (specs/09)", async () => {
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: { provider: "forged", model: "self-filled" },
  });
  assert.equal(result.ok, false, "a forged carrier must not produce a write");
  assert.equal(result.error.code, "signature_unavailable");
  assert.match(result.error.message, /REPORT TO HUMAN/);
});

test("createResearchObject creates directed object with v4-style body", async () => {
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: authoritativeSignature({ provider: "zzztoken-glm", model: "glm-5.3" }),
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
    sessionSignature: TEST_SIGNATURE,
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
    sessionSignature: TEST_SIGNATURE,
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
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
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
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
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
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(created.ok);
  const result = await updateResearchObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: "0".repeat(64),
    frontmatterAfter: created.value,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "x",
    sessionSignature: TEST_SIGNATURE,
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
    sessionSignature: TEST_SIGNATURE,
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
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/substage_immutable");
});


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
  const rejected = await createResearchObject({ factSourceRoot: root, frontmatterDraft: bad, analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
  assert.ok(!rejected.ok);
  assert.equal(rejected.error.code, "research/relations_invalid");

  const first = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
  assert.ok(first.ok);
  const secondDraft = { ...validFrontmatterDraft(), relations: [{ relation_key: "updates", target: { object_uid: first.value.object_uid } }] };
  const second = await createResearchObject({ factSourceRoot: root, frontmatterDraft: secondDraft, analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
  assert.ok(second.ok, JSON.stringify(second.error));

  const dangling = { ...validFrontmatterDraft(), relations: [{ relation_key: "updates", target: { object_uid: "99999999-9999-4999-8999-999999999999" } }] };
  const failed = await createResearchObject({ factSourceRoot: root, frontmatterDraft: dangling, analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
  assert.ok(!failed.ok);
  assert.equal(failed.error.code, "research/relation_target_unresolvable");
});


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
  const result = await createResearchObject({ factSourceRoot: root, frontmatterDraft: bad, analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/initial_state_violation");
});

test("updateResearchObject rejects status=retired without retirement_reason", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: TEST_SIGNATURE,
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
    sessionSignature: TEST_SIGNATURE,
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
    sessionSignature: TEST_SIGNATURE,
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
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read2.ok);
  assert.notEqual(read2.value.frontmatter.retired_at, "1999-01-01T00:00:00.000Z");
});

test("updateResearchObject rejects retirement_reason=superseded without updates relation", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: TEST_SIGNATURE,
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
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(!updated.ok);
  assert.equal(updated.error.code, "research/frontmatter_invalid");
  assert.ok(updated.error.details.issues.some((i) => i.includes("superseded requires at least one updates relation")));
});

test("updateResearchObject accepts retirement_reason=superseded with resolvable updates relation", async () => {
  const replacement = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
  assert.ok(replacement.ok);
  const created = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
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
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read2.ok);
  assert.equal(read2.value.frontmatter.status, "retired");
  assert.equal(read2.value.frontmatter.retirement_reason, "superseded");
  assert.ok(typeof read2.value.frontmatter.retired_at === "string" && read2.value.frontmatter.retired_at.length > 0);
});

test("updateResearchObject rejects transition retired → active (terminal)", async () => {
  const replacement = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
  const created = await createResearchObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), analysisBody: validAnalysisBody , sessionSignature: TEST_SIGNATURE});
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  const retireFm = { ...read1.value.frontmatter, status: "retired", retirement_reason: "superseded", relations: [{ relation_key: "updates", target: { object_uid: replacement.value.object_uid } }] };
  const retired = await updateResearchObject({
    factSourceRoot: root, objectUid: created.value.object_uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: retireFm, analysisBodyAfter: validAnalysisBody,
    changeSummary: "retire",
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(retired.ok);
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  const reopenFm = { ...read2.value.frontmatter, status: "active" };
  delete reopenFm.retirement_reason; delete reopenFm.retired_at;
  const reopened = await updateResearchObject({
    factSourceRoot: root, objectUid: created.value.object_uid,
    expectedFingerprint: read2.value.fingerprint,
    frontmatterAfter: reopenFm, analysisBodyAfter: validAnalysisBody,
    changeSummary: "reopen",
    sessionSignature: TEST_SIGNATURE,
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
A1 修复方法 X：研究→执行断链由回查条件说明补足——可被后续规范在重新评估时检索本对象。

## 后续分流
- A1 → 修复`;
  const check = validateBodyStructure(goodRetireBody, true);
  assert.equal(check.ok, true, JSON.stringify(check.issues));
});

test("frontmatter fields are written in the canonical reading order regardless of caller key order (24 §7)", async () => {
  const alphabetical = {};
  for (const key of Object.keys(validFrontmatterDraft()).sort()) alphabetical[key] = validFrontmatterDraft()[key];
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: alphabetical,
    analysisBody: validAnalysisBody,
    sessionSignature: TEST_SIGNATURE,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues ?? result.error));
  const raw = await readFile(join(root, "reports", `report-${result.value.object_uid}.md`), "utf8");
  const fmEnd = raw.indexOf("\n---\n", 5);
  const fm = parseYaml(raw.slice(4, fmEnd));
  const keys = Object.keys(fm);
  assert.equal(keys[0], "title");
  assert.equal(keys.at(-1), "change_log");
  assert.ok(keys.indexOf("research_question") < keys.indexOf("confirmed_statements"));
  assert.ok(keys.indexOf("stopping_reason") < keys.indexOf("confirmed_statements"));
  assert.ok(keys.indexOf("urls") < keys.indexOf("object_uid"));
});


async function createRetiredResearch() {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  const uid = created.value.object_uid;
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read1.ok);

  const retired = await updateResearchObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: { ...read1.value.frontmatter, status: "retired", retirement_reason: "outdated" },
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "retire: 资料过时",
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(retired.ok, JSON.stringify(retired.error));

  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read2.ok, JSON.stringify(read2.error));
  return read2;
}

test("correct ①: retired 正文可更正，status/retirement_reason/retired_at/urls/stopping_reason 逐字不变", async () => {
  const read = await createRetiredResearch();
  const before = read.value.frontmatter;

  const corrected = await correctResearchObject({
    factSourceRoot: root,
    objectUid: read.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    analysisBodyAfter: read.value.body.replace("## 未证实与缺口\n（无——两个发现均有源码级证据）", "## 未证实与缺口\n（更正：原句误写为「两个」，实为三条证据，此处据实修正）"),
    changeSummary: "更正未证实与缺口段的错述",
    humanAuthorization: "老丁 2026-11-04 授权更正该条 retired Research 的缺口段错述",
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(corrected.ok, JSON.stringify(corrected.error));

  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: read.value.object_uid });
  assert.ok(read2.ok);
  assert.ok(read2.value.body.includes("更正：原句误写为"), "body must carry the correction");

  for (const field of ["status", "retirement_reason", "retired_at", "urls", "research_purpose", "stopping_reason", "research_question"]) {
    assert.deepEqual(read2.value.frontmatter[field], before[field], `${field} must be inherited verbatim`);
  }
  assert.equal(read2.value.frontmatter.status, "retired");
  assert.equal(read2.value.frontmatter.change_log.length, before.change_log.length + 1);
  assert.match(read2.value.frontmatter.change_log.at(-1).summary, /事实更正（非状态转换）/);
  assert.match(read2.value.frontmatter.change_log.at(-1).summary, /老丁 2026-11-04 授权/);
});

test("correct ②: stopping_reason 被拒绝 —— 属判断变更，不是错述更正", async () => {
  const read = await createRetiredResearch();
  const corrected = await correctResearchObject({
    factSourceRoot: root,
    objectUid: read.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: { stopping_reason: "round-cap" },
    analysisBodyAfter: read.value.body,
    changeSummary: "试图改停止理由",
    humanAuthorization: "老丁 2026-11-04 授权",
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(!corrected.ok);
  assert.equal(corrected.error.code, "research/correction_judgment_field_immutable", JSON.stringify(corrected.error));

  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: read.value.object_uid });
  assert.equal(read2.value.fingerprint, read.value.fingerprint, "rejected call must leave zero write");
});

test("correct ②b: 终态字段与白名单外字段一律拒绝，且零写入", async () => {
  const read = await createRetiredResearch();
  for (const [field, value] of [["status", "active"], ["retirement_reason", "abolished"], ["urls", []]]) {
    const corrected = await correctResearchObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { [field]: value },
      analysisBodyAfter: read.value.body,
      changeSummary: "越界尝试",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
    });
    assert.ok(!corrected.ok, `${field} must be refused`);
  }
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: read.value.object_uid });
  assert.equal(read2.value.fingerprint, read.value.fingerprint, "all refusals must leave zero write");
});

test("correct ②c: 非 retired 对象拒绝（内容更新不得伪装成事实更正）", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(created.ok);
  const read = await readResearchObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  const corrected = await correctResearchObject({
    factSourceRoot: root,
    objectUid: read.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    analysisBodyAfter: read.value.body + "\n",
    changeSummary: "越界尝试",
    humanAuthorization: "老丁 2026-11-04 授权",
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(!corrected.ok);
  assert.equal(corrected.error.code, "research/correction_requires_retired");
});

test("correct ③: 缺 Human 授权 → fail-closed 且零写入", async () => {
  const read = await createRetiredResearch();
  for (const auth of [undefined, "", "  "]) {
    const corrected = await correctResearchObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      analysisBodyAfter: read.value.body + "\n补一行。",
      changeSummary: "无授权",
      humanAuthorization: auth,
      sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
    });
    assert.ok(!corrected.ok, `auth=${JSON.stringify(auth)} must be refused`);
    assert.equal(corrected.error.code, "research/human_authorization_required");
  }
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: read.value.object_uid });
  assert.equal(read2.value.fingerprint, read.value.fingerprint, "all refusals must leave zero write");
});

test("correct ④: 正文与白名单字段均未变 → no-op 拒绝，不追加假流水", async () => {
  const read = await createRetiredResearch();
  const same = await correctResearchObject({
    factSourceRoot: root,
    objectUid: read.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    analysisBodyAfter: read.value.body,
    changeSummary: "声称改了但没改",
    humanAuthorization: "老丁 2026-11-04 授权",
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(!same.ok);
  assert.equal(same.error.code, "research/no_op", JSON.stringify(same.error));

  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: read.value.object_uid });
  assert.equal(read2.value.fingerprint, read.value.fingerprint, "no-op refusal must leave zero write");
});

test("correct ⑤: 改 confirmed_statements 但不同改关键发现 H3 → 索引-正文一致性拒绝（不变量 7）", async () => {
  const read = await createRetiredResearch();
  const corrected = await correctResearchObject({
    factSourceRoot: root,
    objectUid: read.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: { confirmed_statements: ["F1 被改过的标题"] },
    analysisBodyAfter: read.value.body,
    changeSummary: "只改索引不同改正文",
    humanAuthorization: "老丁 2026-11-04 授权",
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(!corrected.ok);
  assert.equal(corrected.error.code, "research/coherence_invalid", JSON.stringify(corrected.error));
});

test("correct ⑥: 同改 confirmed_statements 与正文 H3 标题 → 通过（不变量 7 是可满足的）", async () => {
  const read = await createRetiredResearch();
  const oldTitle = "F1 队长式委派：单队长 spawn 成员、成员可续聊、任务 DAG 驱动调度";
  const newTitle = "F1 队长式委派：单队长 spawn 成员、成员可续聊、任务 DAG 驱动调度（订正：DAG 由事件触发）";
  const corrected = await correctResearchObject({
    factSourceRoot: root,
    objectUid: read.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: {
      confirmed_statements: read.value.frontmatter.confirmed_statements.map((s) => (s === oldTitle ? newTitle : s)),
    },
    analysisBodyAfter: read.value.body.replace(oldTitle, newTitle),
    changeSummary: "订正 F1 的表述错述",
    humanAuthorization: "老丁 2026-11-04 授权",
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(corrected.ok, JSON.stringify(corrected.error));

  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: read.value.object_uid });
  assert.ok(read2.value.frontmatter.confirmed_statements.includes(newTitle));
  assert.ok(read2.value.body.includes(newTitle));
  assert.equal(read2.value.frontmatter.status, "retired");
  assert.equal(read2.value.body_valid, true);
});


test("internal-source: kind 闭集与 locator 形态 — 四个合法 kind", () => {
  const body = [
    "来源：commit（0123456789abcdef0123456789abcdef01234567）",
    "来源：object（11111111-1111-4111-8111-111111111111）",
    "来源：session（session-abc-123）",
    "来源：run-record（npm test @ 2026-11-17T02:00:00Z）",
  ].join("\n");
  const r = validateInternalSourceAnchors(body, { requireAny: true });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.anchors.length, 4);
});

test("internal-source: kind 不在闭集 → 拒绝（旧 summary 的「代码」即此类）", () => {
  const r = validateInternalSourceAnchors("来源：代码（plugin/lib/foo.js）", { requireAny: true });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes("代码") && i.includes("closed set")), JSON.stringify(r.issues));
});

test("internal-source: commit locator 必须是 40 位小写 hex", () => {
  const bad = validateInternalSourceAnchors("来源：commit（abc123）", { requireAny: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.includes("40 lowercase hex")));
  const upper = validateInternalSourceAnchors("来源：commit（ABCDEF0123456789ABCDEF0123456789ABCDEF01）", { requireAny: true });
  assert.equal(upper.ok, false, "uppercase hex must be rejected");
});

test("internal-source: object locator 必须是规范 UUID", () => {
  const r = validateInternalSourceAnchors("来源：object（not-a-uuid）", { requireAny: true });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes("canonical object_uid")));
});

test("internal-source: object locator 可解析性由 resolveObject 回调判定", () => {
  const line = "来源：object（11111111-1111-4111-8111-111111111111）";
  const bad = validateInternalSourceAnchors(line, { requireAny: true, resolveObject: () => false });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.includes("does not resolve")));
  const good = validateInternalSourceAnchors(line, { requireAny: true, resolveObject: () => true });
  assert.equal(good.ok, true);
});

test("internal-source: docs/ 路径与绝对路径不得作 locator", () => {
  const docs = validateInternalSourceAnchors("来源：run-record（docs/devlog-archive/foo.md）", { requireAny: true });
  assert.equal(docs.ok, false);
  assert.ok(docs.issues.some((i) => i.includes("docs/ path")));
  const abs = validateInternalSourceAnchors("来源：run-record（/Users/me/foo.log）", { requireAny: true });
  assert.equal(abs.ok, false);
  assert.ok(abs.issues.some((i) => i.includes("absolute/local path")));
});

test("internal-source: requireAny 时空正文被拒绝，非 requireAny 时放行", () => {
  const strict = validateInternalSourceAnchors("正文无任何锚点行", { requireAny: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.issues.some((i) => i.includes("at least one")));
  const loose = validateInternalSourceAnchors("正文无任何锚点行", { requireAny: false });
  assert.equal(loose.ok, true);
  assert.equal(loose.anchors.length, 0);
});

test("internal-source: 闭集恰好四值，无多无少", () => {
  assert.deepEqual([...INTERNAL_SOURCE_KINDS].sort(), ["commit", "object", "run-record", "session"]);
});

test("internal-source: create summary 缺锚点被拒绝，带合法锚点通过", async () => {
  const summaryDraft = {
    title: "内部过程总结测试",
    status: "active",
    report_form: "summary",
    research_purpose: "验证内部来源锚点校验",
    stopping_reason: "no-gain",
    uncertain: [{ issue: "仅测试锚点校验", reason: "非真实调研" }],
    change_summary: "测试 summary 创建",
  };
  const summaryBodyNoAnchor = `## 范围与目的\n验证锚点校验。\n\n## 工作与结论\n做了一些工作。\n\n## 证据摘录\n摘录内容。\n\n## 遗留与下一步\n无。`;
  const noAnchor = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: summaryDraft,
    analysisBody: summaryBodyNoAnchor,
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(!noAnchor.ok, JSON.stringify(noAnchor));
  assert.equal(noAnchor.error.code, "research/internal_source_anchor_invalid");

  const summaryBodyWithAnchor = summaryBodyNoAnchor.replace(
    "摘录内容。",
    "摘录内容。\n来源：commit（0123456789abcdef0123456789abcdef01234567）"
  );
  const ok = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: summaryDraft,
    analysisBody: summaryBodyWithAnchor,
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(ok.ok, JSON.stringify(ok.error));
});
