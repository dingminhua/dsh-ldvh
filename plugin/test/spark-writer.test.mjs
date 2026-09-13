// Tests for plugin/lib/spark-writer.js — the Spark mechanical writer slice.
//
// Every case is derived from specs/20 (the single authority):
//   §7 身份与载体, §8 字段契约与不变量, §9 状态与生命周期（含合并/拆分）,
//   §11 关系契约, §13 受控操作, §14.1 类型特有验证, §17 Stop Conditions.
// Tests assert spec behaviour; where the implementation diverges from the
// spec the failure is reported in the task report, never "fixed" by bending
// the assertion. lib/ is NOT modified here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { testSignature, withTemp } from "./helpers.mjs";

// 03 §6.1 / 09: every write carries the authoritative signature. Domain-rule
// tests supply a branded test carrier; the signature gate has its own cases.
const TEST_SIGNATURE = testSignature();
import {
  createSparkObject,
  readSparkObject,
  updateSparkObject,
  isSingleSentence,
  readGoalAnchors,
  sparkFileName,
  SPARK_DIRECTORY,
  validateSparkBodyStructure,
  resolveRefsTargets,
  listSparkObjects,
} from "../lib/spark-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// goal.md fixture: 20 §13 / 25 §6 — serves must match an SG-n anchor in
// the ## 子目标 section.
const GOAL_MD_FIXTURE = `---
goal_key: project-goal
title: 测试目标
status: active
created_at: 2026-09-09T12:00:00+08:00
---

# 项目目标

## 目标陈述

测试。

## 子目标

SG-1 第一条子目标。
SG-2 第二条子目标。
SG-3 第三条子目标。
SG-4 第四条子目标。
`;

function validFrontmatterDraft(overrides = {}) {
  return {
    title: "悬置问题的机械层验证",
    question: "如何在不引入额外状态的前提下验证 Spark 机械层？",
    scope_boundary: "仅以本仓库规范与单元测试为证据，不运行外部系统，不扩大调研范围。",
    intent: "验证机械层正确性，为后续自动化覆盖保留事实依据。",
    summary: "Spark 机械层已实现基本验证；未决事项是边界用例的自动化覆盖。",
    change_summary: "受控创建（测试）",
    ...overrides,
  };
}

function validBodyMarkdown(draft = validFrontmatterDraft()) {
  const sections = [
    `## 当前理解\n${draft.summary}\n扩展说明：当前实现经往返读写验证。`,
    `## 调查问题\n${draft.question}\n扩展背景：问题聚焦机械层的可验证性。`,
    `## 调查边界\n${draft.scope_boundary}\n扩展：超出上述范围的话题不属于本 Spark。`,
  ];
  if (Array.isArray(draft.evolution) && draft.evolution.length > 0) {
    sections.push(`## 演变\n${draft.evolution.map((e) => `${e.at} ${e.summary}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// §8 question 单句可读 (isSingleSentence)
// ---------------------------------------------------------------------------

test("isSingleSentence accepts a single terminal-ending sentence or a terminal-free string", () => {
  assert.equal(isSingleSentence("如何验证机械层？"), true);
  assert.equal(isSingleSentence("如何验证机械层。"), true);
  assert.equal(isSingleSentence("如何验证机械层"), true);
});

test("isSingleSentence rejects two terminals, terminal-not-at-end and empty input", () => {
  assert.equal(isSingleSentence("如何验证？如何验证？"), false);
  assert.equal(isSingleSentence("如何验证？还有后续"), false);
  assert.equal(isSingleSentence(""), false);
});

// ---------------------------------------------------------------------------
// create 正向 (20 §13)
// ---------------------------------------------------------------------------

test("create: valid draft lands at sparks/spark-<uid>.md with Code identity and precise read-back", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: authoritativeSignature({ provider: "test-provider", model: "test-model" }),
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    const uid = result.value.object_uid;
    assert.match(uid, UUID_PATTERN);

    // file name & directory (20 §7: ldvh-base/sparks/spark-<uid>.md)
    const filePath = join(root, SPARK_DIRECTORY, sparkFileName(uid));
    assert.equal(result.value.file, filePath);
    const raw = await readFile(filePath, "utf8");
    assert.ok(raw.startsWith("---\n"));

    // frontmatter contains Code-generated uid/created_at/change_log first entry (20 §7/§8)
    const fmEnd = raw.indexOf("\n---\n", 5);
    const fm = parseYaml(raw.slice(4, fmEnd));
    assert.equal(fm.object_uid, uid);
    assert.equal(fm.fact_type_key, "spark");
    assert.equal(fm.status, "open");
    assert.ok(typeof fm.created_at === "string" && fm.created_at.length > 0);
    assert.equal(fm.change_log.length, 1);
    assert.equal(fm.change_log[0].summary, "受控创建（测试）");
    assert.ok(fm.change_log[0].at);

    // H1 generated from title (20 §8 body template)
    assert.ok(raw.includes(`# ${draft.title}`));

    // precise read-back round-trip
    const read = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.frontmatter.question, draft.question);
    assert.equal(read.value.frontmatter.summary, draft.summary);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.fingerprint, result.value.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// 签名通道负向 (specs/03 §6.1 + specs/09 机械签名)
// ---------------------------------------------------------------------------

test("create: a forged plain sessionSignature is REFUSED — no unsigned change_log entry (specs/09)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    // Human 2026-09-12: changelog must be mechanically signed; a write that
    // cannot be signed is refused rather than recorded unsigned. A plain
    // {provider,model} object is NOT a signature (09 forbids AI self-filling).
    const created = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: { provider: "forged", model: "self-filled" },
    });
    assert.equal(created.ok, false, "a forged carrier must not produce a write");
    assert.equal(created.error.code, "signature_unavailable");
    assert.match(created.error.message, /REPORT TO HUMAN/);
  });
});

// ---------------------------------------------------------------------------
// create 反向 (20 §8/§9/§11/§13/§17.1)
// ---------------------------------------------------------------------------

test("create: non-open initial status is rejected (20 §9 initial state)", async () => {
  await withTemp("spark-writer.", async (root) => {
    for (const status of ["implemented", "discarded"]) {
      const result = await createSparkObject({
        factSourceRoot: root,
        frontmatterDraft: { ...validFrontmatterDraft(), status },
        bodyMarkdown: validBodyMarkdown(),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(!result.ok, `${status} should be rejected`);
      assert.equal(result.error.code, "spark/initial_state_violation");
    }
  });
});

test("create: disposition at creation is rejected (20 §8: disposition ⇔ terminal)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), disposition: "已落实" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
  });
});

test("create: relations at creation are rejected (20 §11: merge/split relations only on discarded transitions)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: {
        ...validFrontmatterDraft(),
        relations: [{ relation_key: "merged-into", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
      },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
  });
});

test("create: unknown frontmatter field rejected (20 §8 closed set)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), custom_field: "x" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("unexpected field")), JSON.stringify(result.error.details.issues));
  });
});

test("create: title longer than 30 chars rejected (20 §8 ≤ 30 字)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "长".repeat(31) },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
  });
});

test("create: question with two sentence terminals rejected (20 §8 single sentence)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), question: "如何验证机械层？如何验证边界？" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
  });
});

test("create: question whose terminal is not at the end rejected (20 §8 single sentence)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), question: "如何验证机械层？后续说明" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
  });
});

test("create: missing or empty question/scope_boundary/intent/summary rejected (20 §8 required)", async () => {
  for (const field of ["question", "scope_boundary", "intent", "summary"]) {
    await withTemp("spark-writer.", async (root) => {
      const missing = { ...validFrontmatterDraft() };
      delete missing[field];
      const r1 = await createSparkObject({ factSourceRoot: root, frontmatterDraft: missing, bodyMarkdown: validBodyMarkdown() , sessionSignature: TEST_SIGNATURE});
      assert.ok(!r1.ok, `${field} missing should reject`);
      assert.equal(r1.error.code, "spark/frontmatter_invalid");

      const r2 = await createSparkObject({
        factSourceRoot: root,
        frontmatterDraft: { ...validFrontmatterDraft(), [field]: "" },
        bodyMarkdown: validBodyMarkdown(),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(!r2.ok, `${field} empty should reject`);
      assert.equal(r2.error.code, "spark/frontmatter_invalid");
    });
  }
});

test("create: serves declared but goal.md missing rejected (20 §17.1 stop condition)", async () => {
  await withTemp("spark-writer.", async (root) => {
    // no goal.md in root
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), serves: "SG-1" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/serves_unresolvable");
  });
});

test("create: serves=SG-99 not present in goal.md rejected (20 §13)", async () => {
  await withTemp("spark-writer.", async (root) => {
    await writeFile(join(root, "goal.md"), GOAL_MD_FIXTURE, "utf8");
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), serves: "SG-99" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/serves_unresolvable");
  });
});

test("create: serves undeclared succeeds even when goal.md is missing (20 §17.1: 未声明时不停止)", async () => {
  await withTemp("spark-writer.", async (root) => {
    // no goal.md in root, no serves declared → no stop condition (25 §10)
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: validFrontmatterDraft(),
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
  });
});

test("create: body with wrong H2 order rejected (20 §8 fixed order)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const wrongOrder = `## 调查问题\n${draft.question}\n背景。\n\n## 当前理解\n${draft.summary}\n说明。\n\n## 调查边界\n${draft.scope_boundary}\n边界。`;
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: wrongOrder , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/body_invalid");
  });
});

test("create: body missing 调查边界 section rejected (20 §8 required H2)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const missingBoundary = `## 当前理解\n${draft.summary}\n说明。\n\n## 调查问题\n${draft.question}\n背景。`;
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: missingBoundary , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/body_invalid");
  });
});

test("create: empty H2 section rejected (20 §8 body must carry content)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const emptySection = `## 当前理解\n${draft.summary}\n说明。\n\n## 调查问题\n\n## 调查边界\n${draft.scope_boundary}\n边界。`;
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: emptySection , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/body_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("is empty")), JSON.stringify(result.error.details.issues));
  });
});

test("create: evolution non-empty but body lacks 演变 section rejected (20 §8 条件出现)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), evolution: [{ at: "2026-09-09T12:00:00Z", summary: "焦点转向机械层边界" }] };
    // validBodyMarkdown builds 演变 iff evolution non-empty — strip it to force the violation
    const bodyWithoutEvolution = validBodyMarkdown(draft).split("\n\n## 演变")[0];
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: bodyWithoutEvolution , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/body_invalid");
  });
});

test("create: evolution omitted (no pivots) but body has 演变 section rejected (20 §8 条件出现)", async () => {
  await withTemp("spark-writer.", async (root) => {
    // evolution absent → conditional field not applicable; a 演变 section is
    // then out of contract (20 §8: 演变 条件出现, only when evolution non-empty)
    const draft = validFrontmatterDraft(); // no evolution key
    const bodyWithEvolution = validBodyMarkdown(draft) + "\n\n## 演变\n不应出现的演变段。";
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: bodyWithEvolution , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/body_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("演变")), JSON.stringify(result.error.details.issues));
  });
});

test("create: empty evolution array rejected as fabricated conditional field", async () => {
  await withTemp("spark-writer.", async (root) => {
    // 20 §8: evolution 条件出现 — omitted when not applicable; an explicit
    // empty array fabricates the conditional field (03 §6.1), so the draft
    // is invalid regardless of body content.
    const draft = { ...validFrontmatterDraft(), evolution: [] };
    const bodyWithEvolution = validBodyMarkdown(draft) + "\n\n## 演变\n不应出现的演变段。";
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: bodyWithEvolution , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("evolution")), JSON.stringify(result.error.details.issues));
  });
});

test("create: carrier coherence — drifted question not verbatim rejected (24 §8 invariant-10 precedent)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const driftedQuestion = draft.question.replace("如何", "怎样");
    const body = `## 当前理解\n${draft.summary}\n说明。\n\n## 调查问题\n${driftedQuestion}\n背景。\n\n## 调查边界\n${draft.scope_boundary}\n边界。`;
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/coherence_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("question verbatim")), JSON.stringify(result.error.details.issues));
  });
});

test("create: carrier coherence — drifted scope_boundary not verbatim rejected", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const driftedBoundary = draft.scope_boundary.replace("仅以", "只用");
    const body = `## 当前理解\n${draft.summary}\n说明。\n\n## 调查问题\n${draft.question}\n背景。\n\n## 调查边界\n${driftedBoundary}\n边界。`;
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/coherence_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("scope_boundary verbatim")), JSON.stringify(result.error.details.issues));
  });
});

test("create: carrier coherence — drifted summary not verbatim rejected", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const driftedSummary = draft.summary.replace("已实现", "已完成");
    const body = `## 当前理解\n${driftedSummary}\n说明。\n\n## 调查问题\n${draft.question}\n背景。\n\n## 调查边界\n${draft.scope_boundary}\n边界。`;
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/coherence_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("summary verbatim")), JSON.stringify(result.error.details.issues));
  });
});

// ---------------------------------------------------------------------------
// update 正向 (20 §9/§13: open→open 精化, open→implemented, open→discarded)
// ---------------------------------------------------------------------------

test("update: open→open refinement appends exactly one change_log entry and preserves created_at", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read1.ok);
    const created_at = read1.value.frontmatter.created_at;

    const refined = { ...read1.value.frontmatter, question: "如何在精化后验证机械层的边界？", summary: "精化后的总结：机械层已验证，边界用例纳入后续覆盖计划。" };
    const fmAfter = { ...refined, change_summary: undefined };
    delete fmAfter.change_summary;
    const body2 = `## 当前理解\n${fmAfter.summary}\n说明。\n\n## 调查问题\n${fmAfter.question}\n背景。\n\n## 调查边界\n${fmAfter.scope_boundary}\n边界。`;

    const updated = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: fmAfter,
      bodyMarkdownAfter: body2,
      changeSummary: "精化问题表述与总结",
      sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.change_log.length, 2); // exactly one appended
    assert.equal(read2.value.frontmatter.change_log[1].summary, "精化问题表述与总结");
    assert.equal(read2.value.frontmatter.created_at, created_at); // unchanged
    assert.equal(read2.value.frontmatter.question, fmAfter.question);
    assert.equal(read2.value.frontmatter.status, "open");
    assert.notEqual(read2.value.fingerprint, read1.value.fingerprint);
  });
});

test("update: open→implemented requires disposition (20 §8/§14.1); succeeds with it", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read1.ok);

    // without disposition -> rejected (终态处置完整性, 20 §14.1)
    const noDisposition = { ...read1.value.frontmatter, status: "implemented" };
    const r1 = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: noDisposition,
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "转入 implemented",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!r1.ok);
    assert.equal(r1.error.code, "spark/frontmatter_invalid");
    assert.ok(r1.error.details.issues.some((i) => i.includes("disposition")), JSON.stringify(r1.error.details.issues));

    // with disposition -> succeeds (20 §9.2 normal transition)
    const withDisposition = {
      ...read1.value.frontmatter,
      status: "implemented",
      disposition: "已落实：该问题已由直接调研工作承接，仅结束本 Spark 入口，不代表下游完成。",
    };
    const r2 = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: withDisposition,
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "转入 implemented",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(r2.ok, JSON.stringify(r2.error));
    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read2.value.frontmatter.status, "implemented");
    assert.ok(read2.value.frontmatter.disposition.length > 0);
    assert.equal(read2.value.frontmatter.change_log.length, 2);
  });
});

test("update: disposition longer than 200 characters is rejected (20 §9.1)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read1.ok);

    // 201 -> rejected; the reason must NOT be silently truncated. (Attempted
    // on the still-open object: a terminal object is read-only, §9.2, so the
    // length check must be exercised on the transition that would set it.)
    const overCap = { ...read1.value.frontmatter, status: "implemented", disposition: "x".repeat(201) };
    const r = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: overCap,
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "超限终态说明",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "spark/frontmatter_invalid");
    assert.ok(
      r.error.details.issues.some((i) => i.includes("disposition") && i.includes("200")),
      JSON.stringify(r.error.details.issues)
    );

    // The rejected write left no trace: the object is still open.
    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read2.value.frontmatter.status, "open");
    assert.equal(read2.value.fingerprint, read1.value.fingerprint);

    // Exactly 200 -> accepted (boundary is inclusive).
    const atCap = { ...read2.value.frontmatter, status: "implemented", disposition: "y".repeat(200) };
    const okUpdate = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read2.value.fingerprint,
      frontmatterAfter: atCap,
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "边界内终态说明",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(okUpdate.ok, JSON.stringify(okUpdate.error));

    const read3 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read3.value.frontmatter.disposition.length, 200);
  });
});

test("update: open→discarded plain (no relations) succeeds (20 §9.2)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read1.ok);

    const discarding = {
      ...read1.value.frontmatter,
      status: "discarded",
      disposition: "不再跟踪：该问题已无独立承接价值，终止跟踪。",
    };
    const updated = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: discarding,
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "转入 discarded",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));
    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read2.value.frontmatter.status, "discarded");
    assert.equal(read2.value.frontmatter.relations, undefined);
    assert.equal(read2.value.frontmatter.change_log.length, 2);
  });
});

// ---------------------------------------------------------------------------
// update 反向 (20 §9/§11/§13, 03 §9.5 CAS)
// ---------------------------------------------------------------------------

test("update: stale fingerprint rejected as CAS conflict (20 §13, 03 §9.5)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const result = await updateSparkObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: "0".repeat(64),
      frontmatterAfter: {},
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "x",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/cas_conflict");
  });
});

test("update: terminal implemented object allows content correction with a change_log (20 §9.2)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;

    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const toImpl = { ...read1.value.frontmatter, status: "implemented", disposition: "已落实。" };
    const r1 = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: toImpl, bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "转入 implemented",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(r1.ok, JSON.stringify(r1.error));

    // Content correction on a terminal object is allowed (status unchanged).
    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const corrected = { ...read2.value.frontmatter, title: "更正后的标题" };
    const r2 = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read2.value.fingerprint,
      frontmatterAfter: corrected, bodyMarkdownAfter: validBodyMarkdown({ ...draft, title: "更正后的标题" }), changeSummary: "更正终态记录的文字",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(r2.ok, JSON.stringify(r2.error));

    const read3 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read3.value.frontmatter.title, "更正后的标题");
    assert.equal(read3.value.frontmatter.status, "implemented", "correction must not change status");
    assert.equal(read3.value.frontmatter.change_log.length, 3, "every update appends exactly one change_log entry");

    // Status reversal (reopen) stays forbidden.
    const read4 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const reopen = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read4.value.fingerprint,
      frontmatterAfter: { ...read4.value.frontmatter, status: "open" }, bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "试图重开",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!reopen.ok);
    assert.equal(reopen.error.code, "spark/status_terminal");
  });
});

test("update: terminal discarded object allows content correction but not reopening (20 §9.2)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;

    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const toDiscard = { ...read1.value.frontmatter, status: "discarded", disposition: "不再跟踪。" };
    const r1 = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: toDiscard, bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "转入 discarded",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(r1.ok, JSON.stringify(r1.error));

    // Content correction on the terminal discarded object is allowed.
    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const r2 = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read2.value.fingerprint,
      frontmatterAfter: { ...read2.value.frontmatter, disposition: "更正后的终态理由。" }, bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "更正终态理由",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(r2.ok, JSON.stringify(r2.error));

    const read3 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read3.value.frontmatter.disposition, "更正后的终态理由。");
    assert.equal(read3.value.frontmatter.status, "discarded");

    // Reopen stays forbidden.
    const read4 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const r3 = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read4.value.fingerprint,
      frontmatterAfter: { ...read4.value.frontmatter, status: "open" }, bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "试图重开",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!r3.ok);
    assert.equal(r3.error.code, "spark/status_terminal");
  });
});

test("update: status outside closed set rejected (20 §9 closed set)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const result = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: { ...read1.value.frontmatter, status: "archived" }, bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "x",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/status_transition_invalid");
  });
});

test("update: open object with disposition rejected (20 §8: disposition ⇔ terminal)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const result = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: { ...read1.value.frontmatter, disposition: "不应出现" }, bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "x",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
  });
});

test("update: open object with relations rejected (20 §11 status gating)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const result = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: {
        ...read1.value.frontmatter,
        relations: [{ relation_key: "merged-into", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "x",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/relations_invalid");
  });
});

test("update: merged-into with cardinality 2 rejected (20 §11 cardinality 1)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const result = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: {
        ...read1.value.frontmatter, status: "discarded", disposition: "合并到两个目标",
        relations: [
          { relation_key: "merged-into", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
          { relation_key: "merged-into", target: { object_uid: "22222222-2222-4222-8222-222222222222" } },
        ],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "合并",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/relations_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("cardinality 1")), JSON.stringify(result.error.details.issues));
  });
});

test("update: merged-into and split-into mixed rejected (20 §9.3/§11 no mixing)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const result = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: {
        ...read1.value.frontmatter, status: "discarded", disposition: "又合并又拆分",
        relations: [
          { relation_key: "merged-into", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
          { relation_key: "split-into", target: { object_uid: "22222222-2222-4222-8222-222222222222" } },
        ],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "混用",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/relations_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("must not be mixed")), JSON.stringify(result.error.details.issues));
  });
});

test("update: merge target that does not exist rejected (20 §11 目标可解析)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const result = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: {
        ...read1.value.frontmatter, status: "discarded", disposition: "合并到不存在的对象",
        relations: [{ relation_key: "merged-into", target: { object_uid: "99999999-9999-4999-8999-999999999999" } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "合并",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/relation_target_unresolvable");
  });
});

test("update: merge target exists but is not open rejected (20 §11 target must be open)", async () => {
  await withTemp("spark-writer.", async (root) => {
    // target B: create then move to implemented
    const b = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "目标 Spark B" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(b.ok, JSON.stringify(b.error));
    const bUid = b.value.object_uid;
    const readB1 = await readSparkObject({ factSourceRoot: root, objectUid: bUid });
    const bImpl = await updateSparkObject({
      factSourceRoot: root, objectUid: bUid, expectedFingerprint: readB1.value.fingerprint,
      frontmatterAfter: { ...readB1.value.frontmatter, status: "implemented", disposition: "已落实。" },
      bodyMarkdownAfter: validBodyMarkdown(), changeSummary: "目标转入 implemented",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(bImpl.ok, JSON.stringify(bImpl.error));

    // A merges into the now-terminal B
    const a = await createSparkObject({ factSourceRoot: root, frontmatterDraft: validFrontmatterDraft(), bodyMarkdown: validBodyMarkdown() , sessionSignature: TEST_SIGNATURE});
    assert.ok(a.ok);
    const readA = await readSparkObject({ factSourceRoot: root, objectUid: a.value.object_uid });
    const result = await updateSparkObject({
      factSourceRoot: root, objectUid: a.value.object_uid, expectedFingerprint: readA.value.fingerprint,
      frontmatterAfter: {
        ...readA.value.frontmatter, status: "discarded", disposition: "合并到已终态目标",
        relations: [{ relation_key: "merged-into", target: { object_uid: bUid } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(), changeSummary: "合并",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/relation_target_unresolvable");
  });
});

test("update: implemented with split-into relations rejected (20 §9.1/§14.1 implemented never carries merge/split relations)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok);
    const uid = created.value.object_uid;
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const result = await updateSparkObject({
      factSourceRoot: root, objectUid: uid, expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: {
        ...read1.value.frontmatter, status: "implemented", disposition: "已落实。",
        relations: [{ relation_key: "split-into", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft), changeSummary: "拆分却写成 implemented",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/relations_invalid");
  });
});

// ---------------------------------------------------------------------------
// 合并/拆分正向 (20 §9.3)
// ---------------------------------------------------------------------------

test("merge: A read-back then discarded+merged-into→B (B stays open) succeeds", async () => {
  await withTemp("spark-writer.", async (root) => {
    const a = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "A 被合并议题" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    const b = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "B 合并目标" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(a.ok && b.ok, JSON.stringify({ a: a.error, b: b.error }));

    // A: 逐字读回 (20 §9.2: AI 先精确读取 F3)
    const readA = await readSparkObject({ factSourceRoot: root, objectUid: a.value.object_uid });
    assert.ok(readA.ok);
    assert.equal(readA.value.body_valid, true);

    const updated = await updateSparkObject({
      factSourceRoot: root, objectUid: a.value.object_uid, expectedFingerprint: readA.value.fingerprint,
      frontmatterAfter: {
        ...readA.value.frontmatter, status: "discarded", disposition: "合并：议题收敛进 B。",
        relations: [{ relation_key: "merged-into", target: { object_uid: b.value.object_uid } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "合并进 B",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const readA2 = await readSparkObject({ factSourceRoot: root, objectUid: a.value.object_uid });
    assert.equal(readA2.value.frontmatter.status, "discarded");
    assert.equal(readA2.value.frontmatter.relations.length, 1);
    assert.equal(readA2.value.frontmatter.relations[0].relation_key, "merged-into");
    assert.equal(readA2.value.frontmatter.relations[0].target.object_uid, b.value.object_uid);

    // B 仍 open (20 §11: 合并目标是继续承载议题的活对象)
    const readB = await readSparkObject({ factSourceRoot: root, objectUid: b.value.object_uid });
    assert.equal(readB.value.frontmatter.status, "open");
  });
});

test("split: A discarded+split-into→B,C (both open) succeeds (20 §9.3 拆分)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const b = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "B 子议题" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    const c = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "C 子议题" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(b.ok && c.ok, JSON.stringify({ b: b.error, c: c.error }));
    const a = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "A 原议题" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(a.ok, JSON.stringify(a.error));

    const readA = await readSparkObject({ factSourceRoot: root, objectUid: a.value.object_uid });
    const updated = await updateSparkObject({
      factSourceRoot: root, objectUid: a.value.object_uid, expectedFingerprint: readA.value.fingerprint,
      frontmatterAfter: {
        ...readA.value.frontmatter, status: "discarded", disposition: "拆分：分化出 B、C 两个独立子议题。",
        relations: [
          { relation_key: "split-into", target: { object_uid: b.value.object_uid } },
          { relation_key: "split-into", target: { object_uid: c.value.object_uid } },
        ],
      },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "拆分为 B、C",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const readA2 = await readSparkObject({ factSourceRoot: root, objectUid: a.value.object_uid });
    assert.equal(readA2.value.frontmatter.status, "discarded");
    assert.equal(readA2.value.frontmatter.relations.length, 2);
    assert.ok(readA2.value.frontmatter.relations.every((r) => r.relation_key === "split-into"));

    const readB = await readSparkObject({ factSourceRoot: root, objectUid: b.value.object_uid });
    const readC = await readSparkObject({ factSourceRoot: root, objectUid: c.value.object_uid });
    assert.equal(readB.value.frontmatter.status, "open");
    assert.equal(readC.value.frontmatter.status, "open");
  });
});

// ---------------------------------------------------------------------------
// goal.md anchors (20 §13 / 25 §6)
// ---------------------------------------------------------------------------

test("readGoalAnchors parses SG-n anchors from the ## 子目标 section", async () => {
  await withTemp("spark-writer.", async (root) => {
    await writeFile(join(root, "goal.md"), GOAL_MD_FIXTURE, "utf8");
    const anchors = await readGoalAnchors(root);
    assert.equal(anchors.ok, true, anchors.reason);
    assert.deepEqual([...anchors.anchors].sort(), ["SG-1", "SG-2", "SG-3", "SG-4"]);
  });
});

test("create with serves matching a goal.md anchor succeeds (20 §13)", async () => {
  await withTemp("spark-writer.", async (root) => {
    await writeFile(join(root, "goal.md"), GOAL_MD_FIXTURE, "utf8");
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), serves: "SG-1" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    const read = await readSparkObject({ factSourceRoot: root, objectUid: result.value.object_uid });
    assert.equal(read.value.frontmatter.serves, "SG-1");
  });
});

// ---------------------------------------------------------------------------
// evolution 边界 (20 §8: 上限 20 项, 每项 {at, summary})
// ---------------------------------------------------------------------------

test("create: evolution with 21 entries exceeds the cap (20 §8 上限 20 项)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const evolution = Array.from({ length: 21 }, (_, i) => ({ at: `2026-09-0${(i % 9) + 1}T00:00:00Z`, summary: `第 ${i} 次转折` }));
    const draft = { ...validFrontmatterDraft(), evolution };
    const result = await createSparkObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("cap")), JSON.stringify(result.error.details.issues));
  });
});

test("create: evolution entry missing at or summary rejected (20 §8 evolution shape)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const missingAt = { ...validFrontmatterDraft(), evolution: [{ summary: "无 at" }] };
    const r1 = await createSparkObject({ factSourceRoot: root, frontmatterDraft: missingAt, bodyMarkdown: validBodyMarkdown(missingAt) , sessionSignature: TEST_SIGNATURE});
    assert.ok(!r1.ok);
    assert.equal(r1.error.code, "spark/frontmatter_invalid");
    assert.ok(r1.error.details.issues.some((i) => i.includes("at")), JSON.stringify(r1.error.details.issues));

    const missingSummary = { ...validFrontmatterDraft(), evolution: [{ at: "2026-09-09T12:00:00Z" }] };
    const r2 = await createSparkObject({ factSourceRoot: root, frontmatterDraft: missingSummary, bodyMarkdown: validBodyMarkdown(missingSummary) , sessionSignature: TEST_SIGNATURE});
    assert.ok(!r2.ok);
    assert.equal(r2.error.code, "spark/frontmatter_invalid");
    assert.ok(r2.error.details.issues.some((i) => i.includes("summary")), JSON.stringify(r2.error.details.issues));
  });
});

// ---------------------------------------------------------------------------
// read 契约 (03 §9.2)
// ---------------------------------------------------------------------------

test("read: invalid uid shape rejected (03 §6.1 canonical uid)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const result = await readSparkObject({ factSourceRoot: root, objectUid: "../../etc/passwd" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/invalid_uid");
  });
});
// ---------------------------------------------------------------------------
// Body H1 uniqueness (20 §8 正文结构: the H1 comes from title and is the only
// level-1 heading — the body itself starts at H2)
// ---------------------------------------------------------------------------

test("body structure: exactly one H1 — an extra title heading is rejected (20 §8)", () => {
  const base = "## 当前理解\n\nA\n\n## 调查问题\n\nB\n\n## 调查边界\n\nC";

  // The only accepted shape.
  assert.ok(validateSparkBodyStructure(`# T\n\n${base}`, "T", 0).ok);

  // An extra H1 slips past a first-line-only check, so it must be counted.
  const dupConsecutive = validateSparkBodyStructure(`# T\n\n# T\n\n${base}`, "T", 0);
  assert.ok(!dupConsecutive.ok, "consecutive duplicate H1 must be rejected");
  assert.ok(dupConsecutive.issues.some((i) => i.includes("exactly 1 H1")), JSON.stringify(dupConsecutive.issues));

  const dupMiddle = validateSparkBodyStructure(
    "# T\n\n## 当前理解\n\nA\n\n# T\n\n## 调查问题\n\nB\n\n## 调查边界\n\nC", "T", 0);
  assert.ok(!dupMiddle.ok, "H1 in the middle of the body must be rejected");

  const dupLast = validateSparkBodyStructure(`# T\n\n${base}\n\n# T`, "T", 0);
  assert.ok(!dupLast.ok, "trailing H1 must be rejected");

  // The wrong title is caught by the existing first-line check.
  assert.ok(!validateSparkBodyStructure(`# X\n\n${base}`, "T", 0).ok);
});

test("body structure: H1 scan follows CommonMark ATX semantics (20 §8)", () => {
  const base = "## 当前理解\n\nA\n\n## 调查问题\n\nB\n\n## 调查边界\n\nC";

  // Escapes that a naive `startsWith("# ")` scan would miss: CommonMark treats
  // up to 3 leading spaces and a tab separator as the same ATX heading.
  assert.ok(!validateSparkBodyStructure(`# T\n\n   # T\n\n${base}`, "T", 0).ok, "indented duplicate H1 must be counted");
  assert.ok(!validateSparkBodyStructure(`# T\n\n#\tT\n\n${base}`, "T", 0).ok, "tab-separated duplicate H1 must be counted");

  // Not false positives: these are all legal single-H1 carriers.
  assert.ok(validateSparkBodyStructure(`# T   \n\n${base}`, "T", 0).ok, "trailing spaces on the H1 are legal");
  assert.ok(validateSparkBodyStructure(`# T\n\n\u0060\u0060\u0060\n# T\n\u0060\u0060\u0060\n\n${base}`, "T", 0).ok, "a `#` inside a fenced code block is not a heading");
  assert.ok(validateSparkBodyStructure(`# T\r\n\r\n${base.replace(/\n/g, "\r\n")}`, "T", 0).ok, "CRLF body is a legal carrier");
});

// ---------------------------------------------------------------------------
// refs (20 §8 + 03 §7.2 关联引用型) — 关联的事实对象引用
// ---------------------------------------------------------------------------

/** A minimal other-type fact object whose object_uid refs can target. */
async function seedResearch(root, uid, title = "目标调研对象") {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, "researches"), { recursive: true });
  await writeFile(
    join(root, "researches", `research-${uid}.md`),
    `---\nobject_uid: ${uid}\ntitle: ${title}\nstatus: active\n---\n\n## 研究问题\nfixture\n`,
    "utf8",
  );
}

const REF_UID = "0ca1ab2c-7976-431b-a3d2-2f9e346ff345";
const OTHER_UID = "11111111-2222-4333-8444-555555555555";

test("refs: create with a resolvable target lands and round-trips (20 §8, 03 §7.2)", async () => {
  await withTemp("spark-writer.", async (root) => {
    await seedResearch(root, REF_UID);
    const draft = { ...validFrontmatterDraft(), refs: [{ object_uid: REF_UID }] };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    const read = await readSparkObject({ factSourceRoot: root, objectUid: result.value.object_uid });
    assert.deepEqual(read.value.frontmatter.refs, [{ object_uid: REF_UID }]);
  });
});

test("refs: unresolvable target is a zero-write rejection (03 §7.2 mechanical boundary)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), refs: [{ object_uid: REF_UID }] };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/refs_unresolvable");
    // Zero-write: no carrier left behind.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(root, SPARK_DIRECTORY)).catch(() => []);
    assert.deepEqual(entries.filter((f) => f.endsWith(".md")), []);
  });
});

test("refs: a target in another project's directory set is not resolvable (同项目约束)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), refs: [{ object_uid: OTHER_UID }] };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/refs_unresolvable");
  });
});

test("refs: non-canonical uid shape rejected by the field contract", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), refs: [{ object_uid: "not-a-uid" }] };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("canonical UUIDv4")));
  });
});

test("refs: empty array rejected (03 §6.1 — no fabricated conditional field)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), refs: [] };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("fabricates a conditional field")));
  });
});

test("refs: cap of 10 entries enforced (20 §8)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const refs = Array.from({ length: 11 }, (_, i) => ({
      object_uid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const draft = { ...validFrontmatterDraft(), refs };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("cap")));
  });
});

test("refs: target title must NOT be copied into the carrier (03 §7.2 minimal shape)", async () => {
  await withTemp("spark-writer.", async (root) => {
    await seedResearch(root, REF_UID);
    const draft = { ...validFrontmatterDraft(), refs: [{ object_uid: REF_UID, title: "抄来的标题" }] };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("beyond object_uid")));
  });
});

test("refs: duplicate targets rejected (03 §7.2 invariant 3 — no synonymous duplicates)", async () => {
  await withTemp("spark-writer.", async (root) => {
    await seedResearch(root, REF_UID);
    const draft = { ...validFrontmatterDraft(), refs: [{ object_uid: REF_UID }, { object_uid: REF_UID }] };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "spark/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("duplicate target")));
  });
});

test("refs: a closed (discarded) target stays a legal reference (20 §8 — state-neutral)", async () => {
  await withTemp("spark-writer.", async (root) => {
    // A target whose own status is terminal must still resolve: the association
    // is a fact about the past and does not expire when the target closes.
    await seedResearch(root, REF_UID);
    await writeFile(
      join(root, "researches", `research-${REF_UID}.md`),
      `---\nobject_uid: ${REF_UID}\ntitle: 已废弃的目标\nstatus: retired\n---\n\n## 研究问题\nfixture\n`,
      "utf8",
    );
    const draft = { ...validFrontmatterDraft(), refs: [{ object_uid: REF_UID }] };
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
  });
});

test("refs: update may add and remove associations (state-neutral, no status gate)", async () => {
  await withTemp("spark-writer.", async (root) => {
    await seedResearch(root, REF_UID);
    const draft = { ...validFrontmatterDraft() };
    const created = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const uid = created.value.object_uid;

    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    // read-back body carries the generated H1; the update entry takes the body
    // from H2 down (20 §8: the H1 is generated by Code, not supplied).
    const bodyAfter = read1.value.body.replace(/^#\s.*\r?\n\r?\n?/, "");
    const upd = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: { ...read1.value.frontmatter, refs: [{ object_uid: REF_UID }] },
      bodyMarkdownAfter: bodyAfter,
      changeSummary: "补充关联",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(upd.ok, JSON.stringify(upd.error));

    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.deepEqual(read2.value.frontmatter.refs, [{ object_uid: REF_UID }]);
  });
});

test("refs: F1 list projection carries refs for the Human card (20 §12)", async () => {
  await withTemp("spark-writer.", async (root) => {
    await seedResearch(root, REF_UID);
    const draft = { ...validFrontmatterDraft(), refs: [{ object_uid: REF_UID }] };
    const created = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const listed = await listSparkObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    const item = listed.value.items.find((i) => i.object_uid === created.value.object_uid);
    assert.deepEqual(item.refs, [{ object_uid: REF_UID }]);
  });
});

test("refs: resolution reports the target type and title for projection (不做第二权威)", async () => {
  await withTemp("spark-writer.", async (root) => {
    await seedResearch(root, REF_UID, "蓝图业界调研");
    const resolved = await resolveRefsTargets(root, [{ object_uid: REF_UID }]);
    assert.ok(resolved.ok, JSON.stringify(resolved));
    assert.equal(resolved.resolved.get(REF_UID).type, "research");
    assert.equal(resolved.resolved.get(REF_UID).title, "蓝图业界调研");
  });
});

test("refs: omitted stays omitted (03 §6.1 — no empty placeholder written)", async () => {
  await withTemp("spark-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const result = await createSparkObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    const raw = await readFile(join(root, SPARK_DIRECTORY, sparkFileName(result.value.object_uid)), "utf8");
    assert.ok(!raw.includes("refs:"), "refs must not be materialised as an empty placeholder");
  });
});
