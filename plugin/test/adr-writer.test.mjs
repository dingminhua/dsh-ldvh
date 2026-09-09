// Tests for plugin/lib/adr-writer.js — the ADR mechanical writer slice.
//
// Every case is derived from specs/22 (the single authority):
//   §6 对象边界与查重, §8 字段契约与正文五段+条件证据段,
//   §9 状态生命周期（含 §9.3 勘误边界）, §10 来源证据, §11 superseded-by
//   关系, §12 召回, §13 受控操作, §14.1 类型特有验证, §17 Stop Conditions.
// Tests assert spec behaviour; where the implementation diverges from the
// spec the failure is reported in the task report, never "fixed" by bending
// the assertion. lib/ is NOT modified here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { withTemp } from "./helpers.mjs";
import {
  createAdrObject,
  readAdrObject,
  updateAdrObject,
  listAdrObjects,
  isSingleSentence,
  adrFileName,
  ADR_DIRECTORY,
} from "../lib/adr-writer.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validFrontmatterDraft(overrides = {}) {
  return {
    title: "归档方案定案",
    decision: "采用基于对象存储的归档方案。",
    scope: "适用于本仓库的归档读取场景，不适用于实时写入场景。",
    change_summary: "受控创建（测试）",
    ...overrides,
  };
}

// 22 §8 正文固定结构：决策背景 / 决定 / 备选与理由 / 后果 / 适用范围
// （必填五段）+ 证据（urls 非空时必填）。决定与适用范围段逐字包含
// frontmatter 的 decision / scope（载体内聚，22 §8）。
function validBodyMarkdown(draft = validFrontmatterDraft()) {
  const sections = [
    `## 决策背景\n需要跨会话保留的归档读取通道，现有临时方案无法支撑长时间追溯。`,
    `## 决定\n${draft.decision}\n扩展说明：对象存储的成本与读取语义满足归档场景。`,
    `## 备选与理由\n备选一：本地文件快照，落选原因：无版本语义。\n备选二：数据库表，落选原因：归档增长拖累在线查询。`,
    `## 后果\n已接受后果：归档读取延迟高于在线存储；无已知重大后果。`,
    `## 适用范围\n${draft.scope}\n展开：何时适用、何时不适用。`,
  ];
  if (Array.isArray(draft.urls) && draft.urls.length > 0) {
    sections.push(`## 证据\n外部来源见 urls 字段；内部引用：research 对象结论支撑本决策。`);
  }
  return sections.join("\n\n");
}

function parseFrontmatter(raw) {
  const fmEnd = raw.indexOf("\n---\n", 5);
  return parseYaml(raw.slice(4, fmEnd));
}

async function createAndRead(root, overrides = {}) {
  const draft = validFrontmatterDraft(overrides);
  const created = await createAdrObject({
    factSourceRoot: root,
    frontmatterDraft: draft,
    bodyMarkdown: validBodyMarkdown(draft),
    sessionSignature: { provider: "p", model: "m" },
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  const read = await readAdrObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read.ok, JSON.stringify(read.error));
  return { draft, created, read };
}

// ---------------------------------------------------------------------------
// §8 decision 单句可读 (isSingleSentence, same shape as 20 号 question)
// ---------------------------------------------------------------------------

test("isSingleSentence accepts a single terminal-ending decision or a terminal-free decision", () => {
  assert.equal(isSingleSentence("采用对象存储方案。"), true);
  assert.equal(isSingleSentence("采用对象存储方案"), true);
  assert.equal(isSingleSentence("当发布版本时重审。"), true);
});

test("isSingleSentence rejects two terminals, terminal-not-at-end and empty input", () => {
  assert.equal(isSingleSentence("采用方案A。采用方案B。"), false);
  assert.equal(isSingleSentence("采用方案A。后续补充"), false);
  assert.equal(isSingleSentence(""), false);
});

// ---------------------------------------------------------------------------
// create 正向 (22 §13)
// ---------------------------------------------------------------------------

test("create: valid draft lands at adrs/adr-<uid>.md with Code identity and precise read-back", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, created, read } = await createAndRead(root);
    const uid = created.value.object_uid;
    assert.match(uid, UUID_PATTERN);

    // fileName & directory (22 §7: ldvh-base/adrs/adr-<uid>.md)
    const filePath = join(root, ADR_DIRECTORY, adrFileName(uid));
    assert.equal(created.value.file, filePath);
    const raw = await readFile(filePath, "utf8");
    assert.ok(raw.startsWith("---\n"));

    // Code identity: uid / created_at / change_log first entry (22 §7/§8)
    const fm = parseFrontmatter(raw);
    assert.equal(fm.object_uid, uid);
    assert.equal(fm.fact_type_key, "adr");
    assert.equal(fm.status, "active");
    assert.ok(typeof fm.created_at === "string" && fm.created_at.length > 0);
    assert.equal(fm.change_log.length, 1);
    assert.equal(fm.change_log[0].summary, "受控创建（测试）");
    assert.equal(fm.change_log[0].provider, "p", "sessionSignature must land in the change_log entry");
    assert.ok(fm.change_log[0].at);
    assert.equal(fm.change_summary, undefined, "change_summary is a call argument, not object metadata");

    // H1 generated from title (22 §8)
    assert.ok(raw.includes(`# ${draft.title}`));

    // precise read-back round-trip (22 §13 写后精确回读)
    assert.equal(read.value.frontmatter.decision, draft.decision);
    assert.equal(read.value.frontmatter.scope, draft.scope);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.fingerprint, created.value.fingerprint);
  });
});

test("create: urls non-empty with 证据 body section present succeeds (22 §8 条件出现)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft({
      urls: [{ ref: "https://example.com/evidence", title: "证据来源" }],
    });
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    const read = await readAdrObject({ factSourceRoot: root, objectUid: result.value.object_uid });
    assert.ok(read.ok);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.frontmatter.urls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// create 反向 (22 §8/§9/§11/§13)
// ---------------------------------------------------------------------------

test("create: non-active initial status is rejected (22 §9 初态必须 active)", async () => {
  await withTemp("adr-writer.", async (root) => {
    for (const status of ["retired", "archived"]) {
      const result = await createAdrObject({
        factSourceRoot: root,
        frontmatterDraft: { ...validFrontmatterDraft(), status },
        bodyMarkdown: validBodyMarkdown(),
      });
      assert.ok(!result.ok, `${status} should be rejected`);
      assert.equal(result.error.code, "adr/initial_state_violation");
    }
  });
});

test("create: retirement_reason at creation is rejected (22 §9.1 active forbids terminal fields)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), retirement_reason: "outdated" },
      bodyMarkdown: validBodyMarkdown(),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
  });
});

test("create: retired_at at creation is rejected (Code assigns it at the retirement transition only)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), retired_at: "2026-09-09T12:00:00Z" },
      bodyMarkdown: validBodyMarkdown(),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
  });
});

test("create: relations at creation are rejected (22 §11 superseded-by only attaches to a retired transition)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: {
        ...validFrontmatterDraft(),
        relations: [{ relation_key: "superseded-by", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
      },
      bodyMarkdown: validBodyMarkdown(),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
  });
});

test("create: unknown frontmatter field rejected (22 §8 closed set)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), custom_field: "x" },
      bodyMarkdown: validBodyMarkdown(),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("unexpected field")), JSON.stringify(result.error.details.issues));
  });
});

test("create: title longer than 30 chars rejected (22 §8 title ≤ 30 字)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "长".repeat(31) },
      bodyMarkdown: validBodyMarkdown(),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
  });
});

test("create: decision with two sentence terminals rejected (22 §8 decision 单句)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), decision: "采用方案A。采用方案B。" },
      bodyMarkdown: validBodyMarkdown({ ...validFrontmatterDraft(), decision: "采用方案A。采用方案B。" }),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
  });
});

test("create: decision whose terminal is not at the end rejected (22 §8 decision 单句)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), decision: "采用方案A。后续补充" },
      bodyMarkdown: validBodyMarkdown(),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
  });
});

test("create: missing or empty decision/scope rejected (22 §8 required)", async () => {
  for (const field of ["decision", "scope"]) {
    await withTemp("adr-writer.", async (root) => {
      const missing = { ...validFrontmatterDraft() };
      delete missing[field];
      const r1 = await createAdrObject({
        factSourceRoot: root,
        frontmatterDraft: missing,
        bodyMarkdown: validBodyMarkdown({ ...missing, [field]: "占位" }),
      });
      assert.ok(!r1.ok, `${field} missing should reject`);
      assert.equal(r1.error.code, "adr/frontmatter_invalid");

      const r2 = await createAdrObject({
        factSourceRoot: root,
        frontmatterDraft: { ...validFrontmatterDraft(), [field]: "" },
        bodyMarkdown: validBodyMarkdown({ ...validFrontmatterDraft(), [field]: "占位" }),
      });
      assert.ok(!r2.ok, `${field} empty should reject`);
      assert.equal(r2.error.code, "adr/frontmatter_invalid");
    });
  }
});

test("create: trigger_signal empty string rejected (03 §6.1 conditional field fabrication)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), trigger_signal: "" },
      bodyMarkdown: validBodyMarkdown(),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("trigger_signal")), JSON.stringify(result.error.details.issues));
  });
});

test("create: urls empty array rejected as fabricated conditional field (22 §8 urls 条件出现)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const result = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), urls: [] },
      bodyMarkdown: validBodyMarkdown(),
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("urls")), JSON.stringify(result.error.details.issues));
  });
});

test("create: body with wrong H2 order rejected (22 §8 fixed order)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const wrongOrder = `## 决定\n${draft.decision}\n说明。\n\n## 决策背景\n背景。\n\n## 备选与理由\n备选。\n\n## 后果\n后果。\n\n## 适用范围\n${draft.scope}\n范围。`;
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: wrongOrder });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/body_invalid");
  });
});

test("create: body missing a required H2 section rejected (22 §8 必填五段)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const missing = `## 决策背景\n背景。\n\n## 决定\n${draft.decision}\n说明。\n\n## 后果\n后果。\n\n## 适用范围\n${draft.scope}\n范围。`;
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: missing });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/body_invalid");
  });
});

test("create: empty H2 section rejected (22 §8 body must carry content)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const emptySection = `## 决策背景\n背景。\n\n## 决定\n\n## 备选与理由\n备选。\n\n## 后果\n后果。\n\n## 适用范围\n${draft.scope}\n范围。`;
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: emptySection });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/body_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("is empty")), JSON.stringify(result.error.details.issues));
  });
});

test("create: urls non-empty but body lacks 证据 section rejected (22 §8 条件出现)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft({
      urls: [{ ref: "https://example.com/evidence", title: "证据来源" }],
    });
    // validBodyMarkdown builds 证据 iff urls non-empty — strip it to force the violation
    const bodyWithoutEvidence = validBodyMarkdown(draft).split("\n\n## 证据")[0];
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: bodyWithoutEvidence });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/body_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("证据")), JSON.stringify(result.error.details.issues));
  });
});

test("create: carrier coherence — drifted decision not verbatim rejected (22 §8/§14.1)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const drifted = draft.decision.replace("采用", "改用");
    const body = `## 决策背景\n背景。\n\n## 决定\n${drifted}\n说明。\n\n## 备选与理由\n备选。\n\n## 后果\n后果。\n\n## 适用范围\n${draft.scope}\n范围。`;
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/coherence_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("carrier coherence")), JSON.stringify(result.error.details.issues));
  });
});

test("create: carrier coherence — drifted scope not verbatim rejected (22 §8/§14.1)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const drifted = draft.scope.replace("适用于", "针对");
    const body = `## 决策背景\n背景。\n\n## 决定\n${draft.decision}\n说明。\n\n## 备选与理由\n备选。\n\n## 后果\n后果。\n\n## 适用范围\n${drifted}\n范围。`;
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/coherence_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("carrier coherence")), JSON.stringify(result.error.details.issues));
  });
});

// ---------------------------------------------------------------------------
// update 勘误边界 (22 §9.3 —— active→active 是勘误级, decision/scope 必须
// 与 CAS 基线逐字段一致; 变了就走替代路径)
// ---------------------------------------------------------------------------

test("update: active→active with decision change rejected as errata-boundary violation (22 §9.3)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, decision: "改用消息队列方案。" },
      bodyMarkdownAfter: validBodyMarkdown({ ...draft, decision: "改用消息队列方案。" }),
      changeSummary: "试图改写决策语义",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/errata_boundary");
  });
});

test("update: active→active with scope change rejected as errata-boundary violation (22 §9.3)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, scope: "该决策不再适用于任何场景。" },
      bodyMarkdownAfter: validBodyMarkdown({ ...draft, scope: "该决策不再适用于任何场景。" }),
      changeSummary: "试图改写适用范围",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/errata_boundary");
  });
});

test("update: active→active body-only errata succeeds, appends exactly one change_log entry, created_at unchanged", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, created, read } = await createAndRead(root);
    const created_at = read.value.frontmatter.created_at;

    // 正文勘误：仅改决策背景/后果措辞, decision/scope 逐字不变
    const body2 = `## 决策背景\n需要跨会话保留的归档读取通道（勘误后表述）。\n\n## 决定\n${draft.decision}\n扩展说明：对象存储的成本与读取语义满足归档场景。\n\n## 备选与理由\n备选一：本地文件快照，落选原因：无版本语义。\n\n## 后果\n已接受后果：归档读取延迟高于在线存储；无已知重大后果。\n\n## 适用范围\n${draft.scope}\n展开：何时适用、何时不适用。`;
    const updated = await updateAdrObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: read.value.frontmatter,
      bodyMarkdownAfter: body2,
      changeSummary: "勘误：修正决策背景表述",
      sessionSignature: { provider: "p", model: "m" },
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.change_log.length, 2, "exactly one entry appended");
    assert.equal(read2.value.frontmatter.change_log[1].summary, "勘误：修正决策背景表述");
    assert.equal(read2.value.frontmatter.created_at, created_at, "created_at must not change");
    assert.equal(read2.value.frontmatter.status, "active");
    assert.equal(read2.value.body_valid, true);
    assert.notEqual(read2.value.fingerprint, read.value.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// update 终态流转 (22 §9.2 —— 正常转换只有 active → retired; 终态不重开)
// ---------------------------------------------------------------------------

test("update: active→retired (reason=outdated) succeeds with Code-assigned retired_at", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const updated = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "retired", retirement_reason: "outdated" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "决策不再适用",
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.status, "retired");
    assert.equal(read2.value.frontmatter.retirement_reason, "outdated");
    assert.ok(typeof read2.value.frontmatter.retired_at === "string" && read2.value.frontmatter.retired_at.length > 0, "retired_at must be Code-assigned");
    assert.equal(read2.value.frontmatter.change_log.length, 2);
    assert.equal(read2.value.body_valid, true);
  });
});

test("update: retired_at supplied by the caller is rejected (22 §8 Code-assigned, AI must not supply)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "retired",
        retirement_reason: "outdated",
        retired_at: "2026-09-09T12:00:00Z",
      },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "试图自行填写 retired_at",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
  });
});

test("update: retirement_reason outside the closed set rejected (22 §9.2 理由闭集)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "retired", retirement_reason: "archived" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "试图用闭集外理由流转",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("retirement_reason")), JSON.stringify(result.error.details.issues));
  });
});

test("update: retired object is read-only — further update rejected as adr/status_terminal (22 §9.2 终态不重开)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const r1 = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "retired", retirement_reason: "out-of-scope" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "转入 retired",
    });
    assert.ok(r1.ok, JSON.stringify(r1.error));

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read2.value.frontmatter.status, "retired");
    const r2 = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read2.value.fingerprint,
      frontmatterAfter: { ...read2.value.frontmatter, title: "试图重开" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "试图重开终态",
    });
    assert.ok(!r2.ok);
    assert.equal(r2.error.code, "adr/status_terminal");
  });
});

// ---------------------------------------------------------------------------
// superseded-by 关系 (22 §11 —— 仅 retired + retirement_reason=superseded
// 时出现, 基数恰 1, 目标必须存在可解析)
// ---------------------------------------------------------------------------

test("superseded: retired+superseded with exactly 1 relation to an existing ADR succeeds (22 §11)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const targetDraft = { ...validFrontmatterDraft(), title: "替代方案定案" };
    const target = await createAdrObject({
      factSourceRoot: root,
      frontmatterDraft: targetDraft,
      bodyMarkdown: validBodyMarkdown(targetDraft),
    });
    assert.ok(target.ok, JSON.stringify(target.error));

    const { draft, read } = await createAndRead(root);
    const updated = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "retired",
        retirement_reason: "superseded",
        relations: [{ relation_key: "superseded-by", target: { object_uid: target.value.object_uid } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "被替代",
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.status, "retired");
    assert.equal(read2.value.frontmatter.retirement_reason, "superseded");
    assert.equal(read2.value.frontmatter.relations.length, 1);
    assert.equal(read2.value.frontmatter.relations[0].relation_key, "superseded-by");
    assert.equal(read2.value.frontmatter.relations[0].target.object_uid, target.value.object_uid);
    assert.ok(typeof read2.value.frontmatter.retired_at === "string" && read2.value.frontmatter.retired_at.length > 0);
  });
});

test("superseded: zero relations rejected (22 §11 基数恰 1)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "retired", retirement_reason: "superseded", relations: [] },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "缺关系流转",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/relations_invalid");
  });
});

test("superseded: two relations rejected (22 §11 基数恰 1)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "retired",
        retirement_reason: "superseded",
        relations: [
          { relation_key: "superseded-by", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
          { relation_key: "superseded-by", target: { object_uid: "22222222-2222-4222-8222-222222222222" } },
        ],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "双目标替代",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/relations_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("cardinality")), JSON.stringify(result.error.details.issues));
  });
});

test("superseded: target that does not resolve to an existing ADR rejected (22 §11 目标可解析)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "retired",
        retirement_reason: "superseded",
        relations: [{ relation_key: "superseded-by", target: { object_uid: "99999999-9999-4999-8999-999999999999" } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "替代不存在的对象",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/relation_target_unresolvable");
  });
});

test("superseded: active status with relations rejected (22 §11 status gating)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        relations: [{ relation_key: "superseded-by", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "active 携带关系",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/relations_invalid");
  });
});

test("superseded: retired+outdated with relations rejected (22 §11 only superseded may carry relations)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "retired",
        retirement_reason: "outdated",
        relations: [{ relation_key: "superseded-by", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "outdated 却携带关系",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/relations_invalid");
  });
});

// ---------------------------------------------------------------------------
// list (22 §12 召回 —— 默认只列 active; retired 不进入普通候选)
// ---------------------------------------------------------------------------

test("list: empty adrs directory is a valid empty state (22 §12)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const listed = await listAdrObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.deepEqual(listed.value.items, []);
    assert.equal(listed.value.total, 0);
    assert.equal(listed.value.complete, true);
    assert.deepEqual(listed.value.invalid, []);
  });
});

test("list: 2 active + 1 retired — default lists only 2, includeTerminal lists 3; projection carries uid/title/status/decision/trigger_signal", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draftA = { ...validFrontmatterDraft(), title: "甲决策" };
    const a = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draftA, bodyMarkdown: validBodyMarkdown(draftA) });
    assert.ok(a.ok, JSON.stringify(a.error));

    const draftB = { ...validFrontmatterDraft(), title: "乙决策", trigger_signal: "当 SG-4 落地时重审本决策" };
    const b = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draftB, bodyMarkdown: validBodyMarkdown(draftB) });
    assert.ok(b.ok, JSON.stringify(b.error));

    // retire the third one via a terminal transition
    const draftC = { ...validFrontmatterDraft(), title: "丙决策" };
    const c = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draftC, bodyMarkdown: validBodyMarkdown(draftC) });
    assert.ok(c.ok, JSON.stringify(c.error));
    const readC = await readAdrObject({ factSourceRoot: root, objectUid: c.value.object_uid });
    const retired = await updateAdrObject({
      factSourceRoot: root,
      objectUid: c.value.object_uid,
      expectedFingerprint: readC.value.fingerprint,
      frontmatterAfter: { ...readC.value.frontmatter, status: "retired", retirement_reason: "outdated" },
      bodyMarkdownAfter: validBodyMarkdown(draftC),
      changeSummary: "转入 retired",
    });
    assert.ok(retired.ok, JSON.stringify(retired.error));

    // default: active only
    const listed = await listAdrObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.total, 2);
    assert.equal(listed.value.complete, true);
    assert.ok(listed.value.items.every((i) => i.status === "active"), "default list must contain active ADRs only (22 §12)");
    const uids = listed.value.items.map((i) => i.object_uid).sort();
    assert.deepEqual(uids, [a.value.object_uid, b.value.object_uid].sort());

    for (const item of listed.value.items) {
      assert.match(item.object_uid, UUID_PATTERN);
      assert.ok(typeof item.title === "string" && item.title.length > 0, "item must project title");
      assert.equal(typeof item.status, "string");
      assert.ok(typeof item.decision === "string" && item.decision.length > 0, "item must project decision");
      assert.ok("trigger_signal" in item, "item must project trigger_signal");
    }
    const withSignal = listed.value.items.find((i) => i.object_uid === b.value.object_uid);
    assert.equal(withSignal.trigger_signal, "当 SG-4 落地时重审本决策");
    const withoutSignal = listed.value.items.find((i) => i.object_uid === a.value.object_uid);
    assert.equal(withoutSignal.trigger_signal, undefined);

    // includeTerminal: all three
    const all = await listAdrObjects({ factSourceRoot: root, includeTerminal: true });
    assert.ok(all.ok);
    assert.equal(all.value.total, 3);
    const allUids = all.value.items.map((i) => i.object_uid).sort();
    assert.deepEqual(allUids, [a.value.object_uid, b.value.object_uid, c.value.object_uid].sort());
    const retiredItem = all.value.items.find((i) => i.object_uid === c.value.object_uid);
    assert.equal(retiredItem.status, "retired");
  });
});

test("list: limit truncation reports total and complete:false — never a silent truncation (03 §8.1)", async () => {
  await withTemp("adr-writer.", async (root) => {
    for (const title of ["决策甲", "决策乙", "决策丙"]) {
      const draft = { ...validFrontmatterDraft(), title };
      const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) });
      assert.ok(result.ok, JSON.stringify(result.error));
    }
    const listed = await listAdrObjects({ factSourceRoot: root, limit: 2 });
    assert.ok(listed.ok);
    assert.equal(listed.value.items.length, 2, "limit must truncate the projection");
    assert.equal(listed.value.total, 3, "the true total must be reported");
    assert.equal(listed.value.complete, false, "a truncated page must declare incompleteness");
  });
});

test("list: bad carrier (valid uid filename without frontmatter) lands in invalid, never silently skipped", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), title: "合法载体" };
    const created = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) });
    assert.ok(created.ok, JSON.stringify(created.error));

    const badUid = "123e4567-e89b-42d3-a456-426614174000";
    await writeFile(join(root, ADR_DIRECTORY, adrFileName(badUid)), "# 这不是一个载体\n", "utf8");

    const listed = await listAdrObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.total, 1, "invalid carrier is not counted as an object");
    assert.equal(listed.value.items[0].object_uid, created.value.object_uid);
    assert.equal(listed.value.invalid.length, 1);
    assert.ok(listed.value.invalid[0].file, `adr-${badUid}.md`);
    assert.ok(listed.value.invalid[0].reason.includes("no YAML frontmatter block"), JSON.stringify(listed.value.invalid));
  });
});