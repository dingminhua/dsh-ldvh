// Tests for plugin/lib/pitfall-writer.js — the Pitfall mechanical writer slice.
//
// Every case is derived from specs/23 (the single authority):
//   §6 对象边界与查重, §8 字段契约与正文七段+条件证据段,
//   §9 状态生命周期（含 §9.3 勘误与补充级更新边界）, §12 召回（默认 active）,
//   §13 受控操作, §14.1 类型特有验证, §17 Stop Conditions.
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
  createPitfallObject,
  readPitfallObject,
  updatePitfallObject,
  listPitfallObjects,
  pitfallFileName,
  PITFALL_DIRECTORY,
} from "../lib/pitfall-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validFrontmatterDraft(overrides = {}) {
  return {
    title: "SG-4 落地后重复采坑",
    scope: "适用于本仓库依赖升级场景；经验可信于同版本组合，跨大版本需重审。",
    trigger_signal: "当 SG-4 依赖升级时重审本经验",
    change_summary: "受控创建（测试）",
    ...overrides,
  };
}

// 23 §8 正文固定结构：症状 / 触发条件 / 根因 / 解决 / 规避 / 验证 /
// 影响与适用范围（必填七段）+ 证据（urls 非空时必填）。影响与适用范围段
// 逐字包含 frontmatter scope（载体内聚，23 §8/§14.1）。
function validBodyMarkdown(draft = validFrontmatterDraft()) {
  const sections = [
    `## 症状\n升级后出现重复的解析失败，报错指向同一异常签名。`,
    `## 触发条件\n升级 SG-4 到新大版本后首次运行归档读取流程时触发。`,
    `## 根因\nSG-4 内部缓存键变更，旧缓存未失效导致重复命中失败路径。`,
    `## 解决\n升级后清理缓存并重建索引；成功信号是读取流程连续通过。`,
    `## 规避\n后续升级前先比对缓存键语义；升级批次内同步清理。`,
    `## 验证\n已在测试环境观察 3 次连续成功；未覆盖多租户并发升级场景。`,
    `## 影响与适用范围\n${draft.scope}\n展开：何时可能踩到、经验何时可信。`,
  ];
  if (Array.isArray(draft.urls) && draft.urls.length > 0) {
    sections.push(`## 证据\n外部来源见 urls 字段；内部引用：当次行动会话留痕支撑本经验。`);
  }
  return sections.join("\n\n");
}

function parseFrontmatter(raw) {
  const fmEnd = raw.indexOf("\n---\n", 5);
  return parseYaml(raw.slice(4, fmEnd));
}

async function createAndRead(root, overrides = {}) {
  const draft = validFrontmatterDraft(overrides);
  const created = await createPitfallObject({
    factSourceRoot: root,
    frontmatterDraft: draft,
    bodyMarkdown: validBodyMarkdown(draft),
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  const read = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read.ok, JSON.stringify(read.error));
  return { draft, created, read };
}

// ---------------------------------------------------------------------------
// create 正向 (23 §13)
// ---------------------------------------------------------------------------

test("create: valid draft lands at pitfalls/pitfall-<uid>.md with Code identity and precise read-back", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, created, read } = await createAndRead(root);
    const uid = created.value.object_uid;
    assert.match(uid, UUID_PATTERN);

    // fileName & directory (23 §7: ldvh-base/pitfalls/pitfall-<uid>.md)
    const filePath = join(root, PITFALL_DIRECTORY, pitfallFileName(uid));
    assert.equal(created.value.file, filePath);
    const raw = await readFile(filePath, "utf8");
    assert.ok(raw.startsWith("---\n"));

    // Code identity: uid / created_at / change_log first entry (23 §7/§8)
    const fm = parseFrontmatter(raw);
    assert.equal(fm.object_uid, uid);
    assert.equal(fm.fact_type_key, "pitfall");
    assert.equal(fm.status, "active");
    assert.ok(typeof fm.created_at === "string" && fm.created_at.length > 0);
    assert.equal(fm.change_log.length, 1);
    assert.equal(fm.change_log[0].summary, "受控创建（测试）");
    assert.equal(fm.change_log[0].provider, "p", "sessionSignature must land in the change_log entry");
    assert.ok(fm.change_log[0].at);
    assert.equal(fm.change_summary, undefined, "change_summary is a call argument, not object metadata");

    // Code-assigned facts are never overridable by the draft (23 §8 Code fields)
    assert.equal(fm.object_uid, uid);

    // H1 generated from title (23 §8)
    assert.ok(raw.includes(`# ${draft.title}`));

    // precise read-back round-trip (23 §13 创建后精确回读)
    assert.equal(read.value.frontmatter.scope, draft.scope);
    assert.equal(read.value.frontmatter.trigger_signal, draft.trigger_signal);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.fingerprint, created.value.fingerprint);
    assert.deepEqual(read.value.body_issues, []);
  });
});

test("create: urls non-empty with 证据 body section present succeeds (23 §8 条件出现)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({
      urls: [{ ref: "https://example.com/evidence", title: "证据来源" }],
    });
    const result = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    const read = await readPitfallObject({ factSourceRoot: root, objectUid: result.value.object_uid });
    assert.ok(read.ok);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.frontmatter.urls.length, 1);
    assert.equal(read.value.frontmatter.urls[0].ref, "https://example.com/evidence");
  });
});

// ---------------------------------------------------------------------------
// 签名通道负向 (specs/03 §6.1 + specs/09 机械签名)
// ---------------------------------------------------------------------------

test("create: a forged plain sessionSignature is REFUSED — no unsigned change_log entry (specs/09)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    // Human 2026-09-12: changelog must be mechanically signed; a write that
    // cannot be signed is refused rather than recorded unsigned.
    const created = await createPitfallObject({
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
// create 反向 (23 §8/§9/§13/§17)
// ---------------------------------------------------------------------------

test("create: non-active initial status is rejected (23 §9 初态必须 active)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    for (const status of ["discarded", "archived"]) {
      const result = await createPitfallObject({
        factSourceRoot: root,
        frontmatterDraft: { ...validFrontmatterDraft(), status },
        bodyMarkdown: validBodyMarkdown(),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(!result.ok, `${status} should be rejected`);
      assert.equal(result.error.code, "pitfall/initial_state_violation");
    }
  });
});

test("create: disposition at creation is rejected (23 §8: disposition ⇔ discarded)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const result = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), disposition: "前提消失" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/frontmatter_invalid");
  });
});

test("create: unknown frontmatter field rejected (23 §8 closed set)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const result = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), custom_field: "x" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("unexpected field")), JSON.stringify(result.error.details.issues));
  });
});

test("create: title longer than 30 chars rejected (23 §8 title ≤ 30 字)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const result = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "长".repeat(31) },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/frontmatter_invalid");
  });
});

test("create: missing or empty scope rejected (23 §8 required)", async () => {
  for (const variant of ["missing", "empty"]) {
    await withTemp("pitfall-writer.", async (root) => {
      const draft = validFrontmatterDraft();
      const mutated = { ...draft };
      if (variant === "missing") delete mutated.scope;
      else mutated.scope = "";
      const result = await createPitfallObject({
        factSourceRoot: root,
        frontmatterDraft: mutated,
        bodyMarkdown: validBodyMarkdown({ ...draft, scope: mutated.scope || "占位" }),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(!result.ok, `${variant} scope should reject`);
      assert.equal(result.error.code, "pitfall/frontmatter_invalid");
    });
  }
});

test("create: trigger_signal empty string rejected (03 §6.1 conditional field fabrication)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const result = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), trigger_signal: "" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("trigger_signal")), JSON.stringify(result.error.details.issues));
  });
});

test("create: urls empty array rejected as fabricated conditional field (23 §8 urls 条件出现)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const result = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), urls: [] },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("urls")), JSON.stringify(result.error.details.issues));
  });
});

test("create: body with wrong H2 order rejected (23 §8 fixed order)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const wrongOrder = [
      `## 触发条件\n会触发该机制的前置条件。`,
      `## 症状\n失败后的可观察表现。`,
      `## 根因\n机制判断。`,
      `## 解决\n已采用的处理方式。`,
      `## 规避\n预防与安全复用方式。`,
      `## 验证\n已观察结果与覆盖。`,
      `## 影响与适用范围\n${draft.scope}\n范围。`,
    ].join("\n\n");
    const result = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: wrongOrder , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/body_invalid");
  });
});

test("create: body missing a required H2 section rejected (23 §8 必填七段)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const missing = [
      `## 症状\n失败后的可观察表现。`,
      `## 触发条件\n会触发该机制的前置条件。`,
      `## 解决\n已采用的处理方式。`,
      `## 规避\n预防与安全复用方式。`,
      `## 验证\n已观察结果与覆盖。`,
      `## 影响与适用范围\n${draft.scope}\n范围。`,
    ].join("\n\n");
    const result = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: missing , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/body_invalid");
  });
});

test("create: empty H2 section rejected (23 §8 body must carry content)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const emptySection = [
      `## 症状\n失败后的可观察表现。`,
      `## 触发条件\n\n`,
      `## 根因\n机制判断。`,
      `## 解决\n已采用的处理方式。`,
      `## 规避\n预防与安全复用方式。`,
      `## 验证\n已观察结果与覆盖。`,
      `## 影响与适用范围\n${draft.scope}\n范围。`,
    ].join("\n\n");
    const result = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: emptySection , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/body_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("is empty")), JSON.stringify(result.error.details.issues));
  });
});

test("create: urls non-empty but body lacks 证据 section rejected (23 §8 条件出现)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({
      urls: [{ ref: "https://example.com/evidence", title: "证据来源" }],
    });
    // validBodyMarkdown builds 证据 iff urls non-empty — strip it to force the violation
    const bodyWithoutEvidence = validBodyMarkdown(draft).split("\n\n## 证据")[0];
    const result = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: bodyWithoutEvidence , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/body_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("证据")), JSON.stringify(result.error.details.issues));
  });
});

test("create: carrier coherence — drifted scope not verbatim rejected (23 §8/§14.1, 23 §17.3)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const drifted = draft.scope.replace("适用于", "针对");
    const body = validBodyMarkdown().replace(draft.scope, drifted);
    const result = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/coherence_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("carrier coherence")), JSON.stringify(result.error.details.issues));
  });
});

// ---------------------------------------------------------------------------
// update 补充边界 (23 §9.3 —— active→active 是勘误与补充级: scope 必须与
// CAS 基线逐字段一致; 变了就走新对象路径)
// ---------------------------------------------------------------------------

test("update: active→active with scope change rejected as supplement-boundary violation (23 §9.3)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, scope: "该经验不再适用于任何场景。" },
      bodyMarkdownAfter: validBodyMarkdown({ ...draft, scope: "该经验不再适用于任何场景。" }),
      changeSummary: "试图改写影响范围",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/supplement_boundary");
  });
});

test("update: active→active body-only errata succeeds, appends exactly one change_log entry, created_at unchanged, new fingerprint", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, created, read } = await createAndRead(root);
    const created_at = read.value.frontmatter.created_at;

    // 正文勘误：仅改症状/验证段措辞（补充新表现样例, 23 §9.3 允许项），
    // scope 逐字不变（23 §9.3 机械边界）
    const body2 = [
      `## 症状\n升级后出现重复的解析失败，报错指向同一异常签名；补充观察：在并发批处出现偶发重试。`,
      `## 触发条件\n升级 SG-4 到新大版本后首次运行归档读取流程时触发。`,
      `## 根因\nSG-4 内部缓存键变更，旧缓存未失效导致重复命中失败路径。`,
      `## 解决\n升级后清理缓存并重建索引；成功信号是读取流程连续通过。`,
      `## 规避\n后续升级前先比对缓存键语义；升级批次内同步清理。`,
      `## 验证\n已在测试环境观察 3 次连续成功；未覆盖多租户并发升级场景。`,
      `## 影响与适用范围\n${draft.scope}\n展开：何时可能踩到、经验何时可信。`,
    ].join("\n\n");
    const updated = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: read.value.frontmatter,
      bodyMarkdownAfter: body2,
      changeSummary: "勘误：修正症状表述并补充新表现样例",
      sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.change_log.length, 2, "exactly one entry appended");
    assert.equal(read2.value.frontmatter.change_log[1].summary, "勘误：修正症状表述并补充新表现样例");
    assert.ok(read2.value.frontmatter.change_log[1].provider, "p", "sessionSignature must land in the appended entry");
    assert.equal(read2.value.frontmatter.created_at, created_at, "created_at must not change");
    assert.equal(read2.value.frontmatter.status, "active");
    assert.equal(read2.value.frontmatter.scope, draft.scope, "scope must stay field-identical on a supplement");
    assert.equal(read2.value.body_valid, true);
    assert.notEqual(read2.value.fingerprint, read.value.fingerprint, "the append must change the fingerprint");
    assert.equal(read2.value.fingerprint, updated.value.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// update 终态流转 (23 §9.2 —— 正常转换只有 active → discarded; 终态不重开)
// ---------------------------------------------------------------------------

test("update: active→discarded with disposition succeeds and lands disposition (23 §13 终态流转)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const updated = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "discarded", disposition: "前提消失：SG-4 已回滚该变更，机制不再存在。" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "经验不再适用",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readPitfallObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.status, "discarded");
    assert.equal(read2.value.frontmatter.disposition, "前提消失：SG-4 已回滚该变更，机制不再存在。");
    assert.equal(read2.value.frontmatter.change_log.length, 2);
    assert.equal(read2.value.body_valid, true);
  });
});

test("update: disposition longer than 200 characters is rejected (23 §9.1)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);

    // 201 -> rejected; the reason must NOT be silently truncated.
    const overCap = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "discarded", disposition: "x".repeat(201) },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "超限终态说明",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!overCap.ok);
    assert.equal(overCap.error.code, "pitfall/frontmatter_invalid");
    assert.ok(
      overCap.error.details.issues.some((i) => i.includes("disposition") && i.includes("200")),
      JSON.stringify(overCap.error.details.issues)
    );

    // Rejected write left no trace. 200 -> accepted (boundary is inclusive).
    const read2 = await readPitfallObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read2.value.fingerprint, read.value.fingerprint);

    const atCap = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read2.value.fingerprint,
      frontmatterAfter: { ...read2.value.frontmatter, status: "discarded", disposition: "y".repeat(200) },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "边界内终态说明",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(atCap.ok, JSON.stringify(atCap.error));

    const read3 = await readPitfallObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read3.value.frontmatter.disposition.length, 200);
  });
});

test("update: active object with disposition rejected (23 §8: disposition ⇔ discarded)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, disposition: "不该出现在 active" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "试图给 active 挂 disposition",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/frontmatter_invalid");
    assert.ok(result.error.message.includes("disposition"), JSON.stringify(result.error.message));
  });
});

test("update: discarded object is read-only — further update rejected as pitfall/status_terminal (23 §9.2 终态不重开)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const r1 = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "discarded", disposition: "前提消失，机制不再存在。" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "转入 discarded",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(r1.ok, JSON.stringify(r1.error));

    const read2 = await readPitfallObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read2.value.frontmatter.status, "discarded");
    const r2 = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read2.value.fingerprint,
      frontmatterAfter: { ...read2.value.frontmatter, title: "试图重开" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "试图重开终态",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!r2.ok);
    assert.equal(r2.error.code, "pitfall/status_terminal");
  });
});

// ---------------------------------------------------------------------------
// list (23 §12 召回 —— 默认只列 active; discarded 不进入普通候选)
// ---------------------------------------------------------------------------

test("list: empty pitfalls directory is a valid empty state (23 §12)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const listed = await listPitfallObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.deepEqual(listed.value.items, []);
    assert.equal(listed.value.total, 0);
    assert.equal(listed.value.complete, true);
    assert.deepEqual(listed.value.invalid, []);
  });
});

test("list: 2 active + 1 discarded — default lists only 2, includeTerminal lists 3; projection carries uid/title/status/scope/trigger_signal", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draftA = { ...validFrontmatterDraft(), title: "甲坑位" };
    delete draftA.trigger_signal; // signal-free object: projection must omit the key
    const a = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draftA, bodyMarkdown: validBodyMarkdown(draftA) , sessionSignature: TEST_SIGNATURE});
    assert.ok(a.ok, JSON.stringify(a.error));

    const draftB = { ...validFrontmatterDraft(), title: "乙坑位", trigger_signal: "当 SG-4 依赖升级时重审本经验" };
    const b = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draftB, bodyMarkdown: validBodyMarkdown(draftB) , sessionSignature: TEST_SIGNATURE});
    assert.ok(b.ok, JSON.stringify(b.error));

    // discard the third one via a terminal transition
    const draftC = { ...validFrontmatterDraft(), title: "丙坑位" };
    const c = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draftC, bodyMarkdown: validBodyMarkdown(draftC) , sessionSignature: TEST_SIGNATURE});
    assert.ok(c.ok, JSON.stringify(c.error));
    const readC = await readPitfallObject({ factSourceRoot: root, objectUid: c.value.object_uid });
    const discarded = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: c.value.object_uid,
      expectedFingerprint: readC.value.fingerprint,
      frontmatterAfter: { ...readC.value.frontmatter, status: "discarded", disposition: "前提消失，机制不再存在。" },
      bodyMarkdownAfter: validBodyMarkdown(draftC),
      changeSummary: "转入 discarded",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(discarded.ok, JSON.stringify(discarded.error));

    // default: active only
    const listed = await listPitfallObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.total, 2);
    assert.equal(listed.value.complete, true);
    assert.ok(listed.value.items.every((i) => i.status === "active"), "default list must contain active Pitfalls only (23 §12)");
    const uids = listed.value.items.map((i) => i.object_uid).sort();
    assert.deepEqual(uids, [a.value.object_uid, b.value.object_uid].sort());

    for (const item of listed.value.items) {
      assert.match(item.object_uid, UUID_PATTERN);
      assert.ok(typeof item.title === "string" && item.title.length > 0, "item must project title");
      assert.equal(typeof item.status, "string");
      assert.ok(typeof item.scope === "string" && item.scope.length > 0, "item must project scope");
      assert.ok("trigger_signal" in item, "item must project trigger_signal");
    }
    const withSignal = listed.value.items.find((i) => i.object_uid === b.value.object_uid);
    assert.equal(withSignal.trigger_signal, "当 SG-4 依赖升级时重审本经验");
    const withoutSignal = listed.value.items.find((i) => i.object_uid === a.value.object_uid);
    assert.equal(withoutSignal.trigger_signal, undefined);

    // includeTerminal: all three
    const all = await listPitfallObjects({ factSourceRoot: root, includeTerminal: true });
    assert.ok(all.ok);
    assert.equal(all.value.total, 3);
    const allUids = all.value.items.map((i) => i.object_uid).sort();
    assert.deepEqual(allUids, [a.value.object_uid, b.value.object_uid, c.value.object_uid].sort());
    const discardedItem = all.value.items.find((i) => i.object_uid === c.value.object_uid);
    assert.equal(discardedItem.status, "discarded");
  });
});

test("list: limit truncation reports total and complete:false — never a silent truncation (03 §8.1)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    for (const title of ["坑位甲", "坑位乙", "坑位丙"]) {
      const draft = { ...validFrontmatterDraft(), title };
      const result = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
      assert.ok(result.ok, JSON.stringify(result.error));
    }
    const listed = await listPitfallObjects({ factSourceRoot: root, limit: 2 });
    assert.ok(listed.ok);
    assert.equal(listed.value.items.length, 2, "limit must truncate the projection");
    assert.equal(listed.value.total, 3, "the true total must be reported");
    assert.equal(listed.value.complete, false, "a truncated page must declare incompleteness");
  });
});

test("list: bad carrier (valid uid filename without frontmatter) lands in invalid, never silently skipped", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), title: "合法载体" };
    const created = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok, JSON.stringify(created.error));

    const badUid = "123e4567-e89b-42d3-a456-426614174000";
    await writeFile(join(root, PITFALL_DIRECTORY, pitfallFileName(badUid)), "# 这不是一个载体\n", "utf8");

    const listed = await listPitfallObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.total, 1, "invalid carrier is not counted as an object");
    assert.equal(listed.value.items[0].object_uid, created.value.object_uid);
    assert.equal(listed.value.invalid.length, 1);
    assert.equal(listed.value.invalid[0].file, `pitfall-${badUid}.md`);
    assert.ok(listed.value.invalid[0].reason.includes("no YAML frontmatter block"), JSON.stringify(listed.value.invalid));
  });
});