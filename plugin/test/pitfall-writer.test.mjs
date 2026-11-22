import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { testSignature, withTemp } from "./helpers.mjs";

const TEST_SIGNATURE = testSignature();
import {
  createPitfallObject,
  readPitfallObject,
  updatePitfallObject,
  listPitfallObjects,
  pitfallFileName,
  PITFALL_DIRECTORY,
  validatePitfallBodyStructure,
  validateCarrierCoherence,
} from "../lib/pitfall-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validFrontmatterDraft(overrides = {}) {
  return {
    title: "SG-4 落地后重复采坑",
    status: "active",
    scope: "适用于本仓库依赖升级场景；经验可信于同版本组合，跨大版本需重审。",
    trigger_signal: "当 SG-4 依赖升级时重审本经验",
    change_summary: "受控创建（测试）",
    ...overrides,
  };
}

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

test("create: a valid Pitfall object lands at pitfalls/pitfall-<uid>.md with Code identity and precise read-back", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, created, read } = await createAndRead(root);
    const uid = created.value.object_uid;
    assert.match(uid, UUID_PATTERN);

    const filePath = join(root, PITFALL_DIRECTORY, pitfallFileName(uid));
    assert.equal(created.value.file, filePath);
    const raw = await readFile(filePath, "utf8");
    assert.ok(raw.startsWith("---\n"));

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

    assert.equal(fm.object_uid, uid);

    assert.ok(raw.includes(`# ${draft.title}`));

    assert.equal(read.value.frontmatter.scope, draft.scope);
    assert.equal(read.value.frontmatter.trigger_signal, draft.trigger_signal);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.fingerprint, created.value.fingerprint);
    assert.deepEqual(read.value.body_issues, []);
  });
});

test("create: urls non-empty with 证据 body section present succeeds (25 §8 条件出现)", async () => {
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

test("create: a forged plain sessionSignature is REFUSED — no unsigned change_log entry (specs/09)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
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

test("create: non-active initial status is rejected (25 §9 初态必须 active)", async () => {
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

test("create: disposition at creation is rejected (25 §8: disposition ⇔ discarded)", async () => {
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

test("create: unknown frontmatter field rejected (25 §8 closed set)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const result = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), custom_field: "x" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/frontmatter_invalid");
  });
});

test("create: title longer than 30 chars rejected (25 §8 title ≤ 30 字)", async () => {
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

test("create: missing or empty scope rejected (25 §8 required)", async () => {
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
  });
});

test("create: urls empty array rejected as fabricated conditional field (25 §8 urls 条件出现)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const result = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), urls: [] },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/frontmatter_invalid");
  });
});

test("create: body with wrong H2 order rejected (25 §8 fixed order)", async () => {
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

test("create: body missing a required H2 section rejected (25 §8 必填七段)", async () => {
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

test("create: empty H2 section rejected (25 §8 body must carry content)", async () => {
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
  });
});

test("create: urls non-empty but body lacks 证据 section rejected (25 §8 条件出现)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({
      urls: [{ ref: "https://example.com/evidence", title: "证据来源" }],
    });
    const bodyWithoutEvidence = validBodyMarkdown(draft).split("\n\n## 证据")[0];
    const result = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: bodyWithoutEvidence , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pitfall/body_invalid");
  });
});

test("create: carrier coherence — drifted scope not verbatim now accepted (warning only, Human 2026-11-10) (25 §8/§14.1, 25 §17)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const drifted = draft.scope.replace("适用于", "针对");
    const body = validBodyMarkdown().replace(draft.scope, drifted);
    const result = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body , sessionSignature: TEST_SIGNATURE});
    assert.ok(result.ok, JSON.stringify(result.error));
  });
});

test("update: active→active with scope change rejected as supplement-boundary violation (25 §9.3)", async () => {
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

test("update: active→discarded with disposition succeeds and lands disposition (25 §13 终态流转)", async () => {
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

test("update: disposition longer than 200 characters is rejected (25 §9.1)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);

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

test("update: active object with disposition rejected (25 §8: disposition ⇔ discarded)", async () => {
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

test("update: discarded object allows content correction but not reopening (25 §9.2)", async () => {
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
      frontmatterAfter: { ...read2.value.frontmatter, disposition: "更正后的废弃依据。" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "更正终态理由",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(r2.ok, JSON.stringify(r2.error));

    const read3 = await readPitfallObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read3.value.frontmatter.disposition, "更正后的废弃依据。");
    assert.equal(read3.value.frontmatter.status, "discarded", "correction must not change status");
    assert.equal(read3.value.frontmatter.change_log.length, 3, "every update appends exactly one change_log entry");

    const reopen = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read3.value.fingerprint,
      frontmatterAfter: { ...read3.value.frontmatter, status: "active" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "试图重开",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!reopen.ok);
    assert.equal(reopen.error.code, "pitfall/status_terminal");
  });
});

test("update: active→active with scope change rejected as supplement-boundary violation (25 §9.3)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({ status: "active" });
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const current = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });

    const newScope = "该经验改为只适用于另一套适用条件。";
    const result = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: current.value.fingerprint,
      frontmatterAfter: { status: "active", scope: newScope },
      bodyMarkdownAfter: validBodyMarkdown({ ...draft, scope: newScope }),
      changeSummary: "试图在 active 期改写影响范围",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok, "active→active scope change must be refused");
    assert.equal(result.error.code, "pitfall/supplement_boundary");
    const after = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.fingerprint, current.value.fingerprint);
    assert.equal(after.value.frontmatter.scope, draft.scope);
  });
});

test("update: active→active body-only supplement succeeds (scope identical) — no over-blocking", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({ status: "active" });
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    const current = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const body2 = validBodyMarkdown(draft).replace("升级后出现重复的解析失败", "升级后出现重复的解析失败（补充新的触发样例）");
    const result = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: current.value.fingerprint,
      frontmatterAfter: { status: "active" },
      bodyMarkdownAfter: body2,
      changeSummary: "补充新触发样例（补充级，25 §9.3）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    const after = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.frontmatter.status, "active");
    assert.equal(after.value.frontmatter.scope, draft.scope);
    assert.equal(after.value.frontmatter.change_log.length, 2);
  });
});

test("update: discarded→discarded errata with scope change rejected (25 §9.3 终态内容更正同受补充边界)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const toDiscarded = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { status: "discarded", disposition: "前提消失，机制不再存在。" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "转入 discarded",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(toDiscarded.ok, JSON.stringify(toDiscarded.error));
    const terminal = await readPitfallObject({ factSourceRoot: root, objectUid: read.value.object_uid });

    const newScope = "该经验改为只适用于另一套适用条件。";
    const result = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: terminal.value.fingerprint,
      frontmatterAfter: { scope: newScope },
      bodyMarkdownAfter: validBodyMarkdown({ ...draft, scope: newScope }),
      changeSummary: "试图借终态更正改写影响范围",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok, "terminal errata must not smuggle a scope change");
    assert.equal(result.error.code, "pitfall/supplement_boundary");
  });
});

test("list: empty pitfalls directory is a valid empty state (25 §12)", async () => {
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
    delete draftA.trigger_signal;
    const a = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draftA, bodyMarkdown: validBodyMarkdown(draftA) , sessionSignature: TEST_SIGNATURE});
    assert.ok(a.ok, JSON.stringify(a.error));

    const draftB = { ...validFrontmatterDraft(), title: "乙坑位", trigger_signal: "当 SG-4 依赖升级时重审本经验" };
    const b = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: draftB, bodyMarkdown: validBodyMarkdown(draftB) , sessionSignature: TEST_SIGNATURE});
    assert.ok(b.ok, JSON.stringify(b.error));

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

    const listed = await listPitfallObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.total, 2);
    assert.equal(listed.value.complete, true);
    assert.ok(listed.value.items.every((i) => i.status === "active"), "default list must contain active Pitfalls only (25 §12)");
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

test("body structure: exactly one H1 — an extra title heading is rejected (25 §8)", () => {
  const secs = "## 症状\n\nA\n\n## 触发条件\n\nB\n\n## 根因\n\nC\n\n## 解决\n\nD\n\n## 规避\n\nE\n\n## 验证\n\nF\n\n## 影响与适用范围\n\nG";

  assert.ok(validatePitfallBodyStructure(`# T\n\n${secs}`, "T", 0).ok);

  const dupConsecutive = validatePitfallBodyStructure(`# T\n\n# T\n\n${secs}`, "T", 0);
  assert.ok(!dupConsecutive.ok, "consecutive duplicate H1 must be rejected");
  assert.ok(dupConsecutive.issues.some((i) => i.includes("exactly 1 H1")), JSON.stringify(dupConsecutive.issues));

  assert.ok(!validatePitfallBodyStructure(`# T\n\n${secs}\n\n# T`, "T", 0).ok, "trailing H1 must be rejected");
  assert.ok(!validatePitfallBodyStructure(`# X\n\n${secs}`, "T", 0).ok, "wrong title caught by first-line check");
});

test("body structure: H1 scan follows CommonMark ATX semantics (25 §8)", () => {
  const secs = "## 症状\n\nA\n\n## 触发条件\n\nB\n\n## 根因\n\nC\n\n## 解决\n\nD\n\n## 规避\n\nE\n\n## 验证\n\nF\n\n## 影响与适用范围\n\nG";

  assert.ok(!validatePitfallBodyStructure(`# T\n\n   # T\n\n${secs}`, "T", 0).ok, "indented duplicate H1 must be counted");
  assert.ok(!validatePitfallBodyStructure(`# T\n\n#\tT\n\n${secs}`, "T", 0).ok, "tab-separated duplicate H1 must be counted");

  assert.ok(validatePitfallBodyStructure(`# T   \n\n${secs}`, "T", 0).ok, "trailing spaces on the H1 are legal");
  assert.ok(validatePitfallBodyStructure(`# T\n\n\u0060\u0060\u0060\n# T\n\u0060\u0060\u0060\n\n${secs}`, "T", 0).ok, "a `#` inside a fenced code block is not a heading");
  assert.ok(validatePitfallBodyStructure(`# T\r\n\r\n${secs.replace(/\n/g, "\r\n")}`, "T", 0).ok, "CRLF body is a legal carrier");
});

test("create: status=draft is refused — active is the only initial state (25 §9/§13)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({ status: "draft" });
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!created.ok, "draft must no longer be an admissible initial state");
    assert.equal(created.error.code, "pitfall/initial_state_violation");
    assert.match(created.error.message, /active/);
  });
});

test("create: status omitted is rejected — there is no default (25 §8/§13/§16)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    delete draft.status;
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(created.ok, false, "omitting status must be refused, never defaulted");
    assert.equal(created.error.code, "pitfall/status_required");
    await assert.rejects(readdir(join(root, "pitfalls")), { code: "ENOENT" });
  });
});

test("create: status=null is rejected on the same ground as omission", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({ status: null });
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(created.ok, false);
    assert.equal(created.error.code, "pitfall/status_required");
  });
});

test("create: status=active explicit still lands active (Human 入口创建即入档)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({ status: "active" });
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created));
    assert.equal(parseFrontmatter(await readFile(created.value.file, "utf8")).status, "active");
  });
});

test("create: status=discarded is rejected — create never enters a terminal state (25 §9)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({ status: "discarded", disposition: "x" });
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(created.ok, false);
    assert.equal(created.error.code, "pitfall/initial_state_violation");
  });
});

test("create: active must not carry disposition (25 §8 disposition ⇔ discarded)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({ status: "active", disposition: "不该出现" });
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(created.ok, false);
    assert.equal(created.error.code, "pitfall/frontmatter_invalid");
  });
});

test("update: active→draft is rejected — no reverse transition (25 §9.2)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    const current = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const back = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: current.value.fingerprint,
      frontmatterAfter: { ...current.value.frontmatter, status: "draft" },
      bodyMarkdownAfter: current.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "非法回退",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(back.ok, false);
    assert.equal(back.error.code, "pitfall/status_transition_invalid");
  });
});

test("update: active→discarded records the rejection reason (25 §9.2)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const draft = validFrontmatterDraft({ status: "active" });
    const created = await createPitfallObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    const current = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const rejected = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: current.value.fingerprint,
      frontmatterAfter: { ...current.value.frontmatter, status: "discarded", disposition: "经验经复核不成立：症状描述与原始留痕不符" },
      bodyMarkdownAfter: current.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "经验废止",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(rejected.ok, JSON.stringify(rejected));
    const after = await readPitfallObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.frontmatter.status, "discarded");
    assert.equal(after.value.frontmatter.disposition, "经验经复核不成立：症状描述与原始留痕不符");
  });
});

test("list: discarded stays out of the default candidates (25 §12)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const active = validFrontmatterDraft();
    await createPitfallObject({ factSourceRoot: root, frontmatterDraft: active, bodyMarkdown: validBodyMarkdown(active), sessionSignature: TEST_SIGNATURE });
    const seed = validFrontmatterDraft({ title: "已废弃经验" });
    const createdSeed = await createPitfallObject({ factSourceRoot: root, frontmatterDraft: seed, bodyMarkdown: validBodyMarkdown(seed), sessionSignature: TEST_SIGNATURE });
    assert.ok(createdSeed.ok, JSON.stringify(createdSeed.error));
    const seedCurrent = await readPitfallObject({ factSourceRoot: root, objectUid: createdSeed.value.object_uid });
    const retired = await updatePitfallObject({
      factSourceRoot: root,
      objectUid: createdSeed.value.object_uid,
      expectedFingerprint: seedCurrent.value.fingerprint,
      frontmatterAfter: { status: "discarded", disposition: "经验经复核不成立" },
      bodyMarkdownAfter: seedCurrent.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "经验废止（测试）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(retired.ok, JSON.stringify(retired.error));

    const def = await listPitfallObjects({ factSourceRoot: root });
    assert.equal(def.value.items.length, 1, "default candidates contain active only");
    assert.equal(def.value.items[0].status, "active");

    const archive = await listPitfallObjects({ factSourceRoot: root, statusFilter: ["discarded"] });
    assert.equal(archive.value.items.length, 1, "the archive view must enumerate discarded (25 §12)");
    assert.equal(archive.value.items[0].status, "discarded");
  });
});

test("list: statusFilter rejects values outside the closed set (25 §9)", async () => {
  await withTemp("pitfall-writer.", async (root) => {
    const bad = await listPitfallObjects({ factSourceRoot: root, statusFilter: ["closed"] });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "invalid_request");
  });
});

test("carrier coherence: the rejection names BOTH the scope and the section text, so the divergence is visible (25 §8)", () => {
  const scope = "LDVH 辅助任务登记链路中所有对 appendPendingEntry 的调用点及 pending-queue.js 契约适用场景。";
  const section = "LDVH 辅助任务登记链路中所有对 appendPendingEntry 的调用点及 pending-queue.js 契约适用场景；影响所有依赖辅助任务登记队列的空闲辅助执行流程。";
  const result = validateCarrierCoherence({ scope }, ["## 症状", "x", "## 影响与适用范围", section].join("\n"));
  assert.equal(result.ok, true, "差异不再阻断写入");
  const issue = result.warnings[0];
  assert.ok(issue.includes(scope), `the scope text must be quoted in full; got: ${issue}`);
  assert.ok(issue.includes(section), `the section text must be quoted in full; got: ${issue}`);
  assert.ok(!issue.includes("…"), "a short scope/section must not be clipped");
});

test("carrier coherence: a section longer than the print budget is clipped WITH its true length (25 §8)", () => {
  const scope = "适用于 X 场景。";
  const filler = "这是一段用于撑长正文的填充文字。".repeat(60);
  const result = validateCarrierCoherence({ scope }, ["## 影响与适用范围", `${filler}${scope}`].join("\n"));
  assert.equal(result.ok, true, "containment (not equality) is the judgement; a long section that contains the scope passes");
  const drifted = validateCarrierCoherence({ scope: "适用于 Y 场景。" }, ["## 影响与适用范围", `${filler}适用于 Z 场景。`].join("\n"));
  assert.equal(drifted.ok, true, "差异不再阻断写入");
  assert.match(drifted.warnings[0], /共 \d+ 字/, "a clipped section must disclose its full length instead of silently truncating");
});
