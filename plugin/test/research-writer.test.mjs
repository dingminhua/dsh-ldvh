import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createResearchObject,
  readResearchObject,
  updateResearchObject,
  validateResearchFrontmatter,
  validateBodySections,
  mainMdFileName,
  surveyMdFileName,
} from "../lib/research-writer.js";

let root;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "ldvh-research-test-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validFrontmatterDraft() {
  return {
    title: "dsh-solo-thinking 插件调研与 LDVH 吸收价值分析",
    status: "active",
    research_question: "dsh-solo-thinking 的 fork worker 隔离审查机制对 LDVH 记忆系统维护有什么可吸收模式？",
    research_purpose: "决定 LDVH 反思引擎是否采用 fork worker 范式作为记忆系统维护子机制",
    stopping_reason: "sufficient",
    urls: [
      { ref: "https://github.com/fredalxin/dsh-solo-thinking", title: "dsh-solo-thinking", summary: "源码仓库 v0.1.19" },
    ],
    confirmed: [
      {
        statement: "fork worker 继承父检查点且允许清单排除写工具",
        confidence: "high",
        quotes: [
          {
            text: "fork worker（继承已完成父检查点）：仅 idle 审查——允许清单排除 mnemon_remember/forget",
            anchor: "§5.2",
            source: "https://github.com/fredalxin/dsh-solo-thinking",
          },
        ],
      },
    ],
    uncertain: [],
    gaps: [],
    implications: [
      {
        finding_ref: "fork worker 继承父检查点且允许清单排除写工具",
        implication: "LDVH 反思引擎可直接吸收此模式作为记忆系统的维护子机制",
      },
    ],
    change_summary: "初次创建：基于 dsh-solo-thinking v0.1.19 源码调研",
  };
}

const validAnalysisBody = `## 调研问题
dsh-solo-thinking 的 fork worker 隔离审查机制……

## 输入与边界
读取源码……

## 已证实
fork worker 允许清单排除写工具……

## 未证实与缺口
（无）

## 停止与后续
sufficient 收敛……`;

const validSurveyBody = `## 调查问题与范围
调查 dsh-solo-thinking 的 worker 模式……

## 调查方法与来源
读源码……

## 调查发现
发现 fork worker 与 spawn worker 分工……

## 调查停止与交接
调查收敛，交接分析阶段……`;

// ---------------------------------------------------------------------------
// validateResearchFrontmatter
// ---------------------------------------------------------------------------

test("validateResearchFrontmatter accepts a valid frontmatter", () => {
  const fm = { ...validFrontmatterDraft(), object_uid: "test-uid", fact_type_key: "research", created_at: "2026-09-08T00:00:00Z" };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("validateResearchFrontmatter rejects missing three-state", () => {
  const fm = { ...validFrontmatterDraft(), object_uid: "u", fact_type_key: "research", created_at: "t", confirmed: [], uncertain: [], gaps: [] };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("three-state")));
});

test("validateResearchFrontmatter rejects quote.source not in urls", () => {
  const fm = {
    ...validFrontmatterDraft(),
    object_uid: "u", fact_type_key: "research", created_at: "t",
    confirmed: [{ statement: "x", confidence: "high", quotes: [{ text: "t", anchor: "a", source: "https://not-registered.example.com" }] }],
  };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("must match a urls[].ref")));
});

test("validateResearchFrontmatter rejects sufficient with empty confirmed", () => {
  const fm = { ...validFrontmatterDraft(), object_uid: "u", fact_type_key: "research", created_at: "t", confirmed: [] };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("sufficient requires non-empty confirmed")));
});

test("validateResearchFrontmatter rejects sufficient with high gap", () => {
  const fm = {
    ...validFrontmatterDraft(), object_uid: "u", fact_type_key: "research", created_at: "t",
    gaps: [{ description: "critical missing", priority: "high" }],
  };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("sufficient must not have an open high-priority gap")));
});

test("validateResearchFrontmatter rejects implications with unanchored finding_ref", () => {
  const fm = {
    ...validFrontmatterDraft(), object_uid: "u", fact_type_key: "research", created_at: "t",
    implications: [{ finding_ref: "this statement does not exist", implication: "dangling" }],
  };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("must match a confirmed[].statement")));
});

test("validateResearchFrontmatter rejects bad confidence value", () => {
  const fm = {
    ...validFrontmatterDraft(), object_uid: "u", fact_type_key: "research", created_at: "t",
    confirmed: [{ statement: "s", confidence: "超高", quotes: [{ text: "t", anchor: "a", source: "https://github.com/fredalxin/dsh-solo-thinking" }] }],
  };
  const result = validateResearchFrontmatter(fm);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("confidence")));
});

// ---------------------------------------------------------------------------
// validateBodySections
// ---------------------------------------------------------------------------

test("validateBodySections accepts valid five-section main body", () => {
  const result = validateBodySections(validAnalysisBody, ["调研问题", "输入与边界", "已证实", "未证实与缺口", "停止与后续"], "main md");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("validateBodySections rejects missing section", () => {
  const body = validAnalysisBody.replace("## 停止与后续\nsufficient 收敛……", "");
  const result = validateBodySections(body, ["调研问题", "输入与边界", "已证实", "未证实与缺口", "停止与后续"], "main md");
  assert.equal(result.ok, false);
});

test("validateBodySections rejects empty section", () => {
  const body = validAnalysisBody.replace("## 已证实\nfork worker 允许清单排除写工具……", "## 已证实\n");
  const result = validateBodySections(body, ["调研问题", "输入与边界", "已证实", "未证实与缺口", "停止与后续"], "main md");
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("empty")));
});

// ---------------------------------------------------------------------------
// createResearchObject (directed)
// ---------------------------------------------------------------------------

test("createResearchObject creates a directed object (single md)", async () => {
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: { provider: "zzztoken-glm", model: "glm-5.3" },
  });
  assert.ok(result.ok, JSON.stringify(result.error));
  const { object_uid, directory, files, fingerprint } = result.value;
  assert.equal(files.length, 1);
  assert.equal(files[0], mainMdFileName(object_uid));
  assert.ok(fingerprint.length === 64); // SHA-256 hex
  assert.ok(directory.includes("research"));
  // re-read to verify
  const readBack = await readResearchObject({ factSourceRoot: root, objectUid: object_uid });
  assert.ok(readBack.ok);
  assert.equal(readBack.value.exploratory, false);
  assert.equal(readBack.value.frontmatter.fact_type_key, "research");
  assert.equal(readBack.value.frontmatter.confirmed.length, 1);
  assert.equal(readBack.value.analysis_body.includes("## 调研问题"), true);
});

test("createResearchObject creates an exploratory object (double md)", async () => {
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    surveyBody: validSurveyBody,
    sessionSignature: { provider: "test", model: "test" },
  });
  assert.ok(result.ok, JSON.stringify(result.error));
  const { object_uid, files } = result.value;
  assert.equal(files.length, 2);
  assert.ok(files.includes(surveyMdFileName(object_uid)));
  const readBack = await readResearchObject({ factSourceRoot: root, objectUid: object_uid });
  assert.ok(readBack.ok);
  assert.equal(readBack.value.exploratory, true);
  assert.ok(readBack.value.survey_body.includes("## 调查问题与范围"));
});

test("createResearchObject rejects invalid frontmatter", async () => {
  const bad = { ...validFrontmatterDraft(), stopping_reason: "invalid" };
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: bad,
    analysisBody: validAnalysisBody,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/frontmatter_invalid");
});

test("createResearchObject rejects bad analysis body sections", async () => {
  const badBody = "## 错误的章节\n内容";
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: badBody,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/main_md_invalid");
});

test("createResearchObject rejects empty survey for exploratory", async () => {
  const result = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    surveyBody: "",
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "invalid_request");
});

// ---------------------------------------------------------------------------
// readResearchObject
// ---------------------------------------------------------------------------

test("readResearchObject returns not_found for nonexistent uid", async () => {
  const result = await readResearchObject({ factSourceRoot: root, objectUid: "nonexistent-uid" });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/object_not_found");
});

// ---------------------------------------------------------------------------
// updateResearchObject (CAS)
// ---------------------------------------------------------------------------

test("updateResearchObject succeeds with correct fingerprint and appends change_log", async () => {
  // Create
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    sessionSignature: { provider: "p", model: "m" },
  });
  assert.ok(created.ok);
  const uid = created.value.object_uid;

  // Read to get current fingerprint
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read1.ok);
  const fp1 = read1.value.fingerprint;
  const logLen1 = read1.value.frontmatter.change_log.length;

  // Update (add a new confirmed)
  const fm = read1.value.frontmatter;
  const fmAfter = {
    ...fm,
    confirmed: [...fm.confirmed, {
      statement: "第二项发现",
      confidence: "medium",
      quotes: [{ text: "引用", anchor: "§1", source: fm.urls[0].ref }],
    }],
  };
  const updated = await updateResearchObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: fp1,
    frontmatterAfter: fmAfter,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "追加第二项 confirmed 发现",
    sessionSignature: { provider: "p", model: "m" },
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));

  // Verify change_log grew
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read2.ok);
  assert.equal(read2.value.frontmatter.change_log.length, logLen1 + 1);
  assert.equal(read2.value.frontmatter.confirmed.length, 2);
});

test("updateResearchObject fails with stale fingerprint (CAS conflict)", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
  });
  assert.ok(created.ok);
  const uid = created.value.object_uid;

  const result = await updateResearchObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
    frontmatterAfter: created.value,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "should fail",
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/cas_conflict");
});

test("updateResearchObject rejects sub-stage change (exploratory → directed)", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    surveyBody: validSurveyBody,
  });
  assert.ok(created.ok);
  const uid = created.value.object_uid;

  const read = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read.ok);
  assert.equal(read.value.exploratory, true);

  // Try to update without survey (directed)
  const result = await updateResearchObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: read.value.frontmatter,
    analysisBodyAfter: validAnalysisBody,
    surveyBodyAfter: null,
    changeSummary: "attempt to remove survey",
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "research/substage_immutable");
});

test("updateResearchObject requires changeSummary", async () => {
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
  });
  assert.ok(created.ok);
  const uid = created.value.object_uid;

  const read = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read.ok);

  const result = await updateResearchObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: read.value.frontmatter,
    analysisBodyAfter: validAnalysisBody,
    changeSummary: "",
  });
  assert.ok(!result.ok);
});

// ---------------------------------------------------------------------------
// Round-trip: create → read → update → read
// ---------------------------------------------------------------------------

test("round-trip: create exploratory, read, update evidence, read again", async () => {
  // 1. Create exploratory
  const created = await createResearchObject({
    factSourceRoot: root,
    frontmatterDraft: validFrontmatterDraft(),
    analysisBody: validAnalysisBody,
    surveyBody: validSurveyBody,
    sessionSignature: { provider: "test", model: "test" },
  });
  assert.ok(created.ok);
  const uid = created.value.object_uid;

  // 2. Read
  const read1 = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read1.ok);
  assert.equal(read1.value.exploratory, true);

  // 3. Update: retire the object
  const fmAfter = { ...read1.value.frontmatter, status: "retired" };
  const updated = await updateResearchObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: read1.value.fingerprint,
    frontmatterAfter: fmAfter,
    analysisBodyAfter: validAnalysisBody,
    surveyBodyAfter: validSurveyBody,
    changeSummary: "retire: 资料过时",
    sessionSignature: { provider: "test", model: "test" },
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));

  // 4. Read again
  const read2 = await readResearchObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(read2.ok);
  assert.equal(read2.value.frontmatter.status, "retired");
  assert.equal(read2.value.frontmatter.change_log.length, 2);
});
