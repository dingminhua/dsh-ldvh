// Tests for plugin/lib/adr-writer.js — the ADR mechanical writer slice.
//
// Every case is derived from specs/22 (the single authority):
//   §6 对象边界与查重, §8 字段契约与正文五段+条件证据段,
//   §9 状态生命周期（含 §9.3 勘误边界）, §10 来源证据, §11 superseded-by
//   关系, §12 召回, §13 受控操作, §14.1 类型特有验证, §17 必停情形.
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
  createAdrObject,
  readAdrObject,
  updateAdrObject,
  correctAdrObject,
  listAdrObjects,
  isSingleSentence,
  adrFileName,
  ADR_DIRECTORY,
} from "../lib/adr-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";
import { createNormObject } from "../lib/norm-writer.js";

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
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
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
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    const read = await readAdrObject({ factSourceRoot: root, objectUid: result.value.object_uid });
    assert.ok(read.ok);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.frontmatter.urls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 签名通道负向 (specs/03 §6.1 + specs/09 机械签名)
// ---------------------------------------------------------------------------

test("create: a forged plain sessionSignature is REFUSED — no unsigned change_log entry (specs/09)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    // Human 2026-09-12: changelog must be mechanically signed; a write that
    // cannot be signed is refused rather than recorded unsigned.
    const created = await createAdrObject({
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
// create 反向 (22 §8/§9/§11/§13)
// ---------------------------------------------------------------------------

test("create: non-active initial status is rejected (22 §9 初态必须 active)", async () => {
  await withTemp("adr-writer.", async (root) => {
    for (const status of ["retired", "archived"]) {
      const result = await createAdrObject({
        factSourceRoot: root,
        frontmatterDraft: { ...validFrontmatterDraft(), status },
        bodyMarkdown: validBodyMarkdown(),
        sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(!r1.ok, `${field} missing should reject`);
      assert.equal(r1.error.code, "adr/frontmatter_invalid");

      const r2 = await createAdrObject({
        factSourceRoot: root,
        frontmatterDraft: { ...validFrontmatterDraft(), [field]: "" },
        bodyMarkdown: validBodyMarkdown({ ...validFrontmatterDraft(), [field]: "占位" }),
        sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: wrongOrder , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/body_invalid");
  });
});

test("create: body missing a required H2 section rejected (22 §8 必填五段)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const missing = `## 决策背景\n背景。\n\n## 决定\n${draft.decision}\n说明。\n\n## 后果\n后果。\n\n## 适用范围\n${draft.scope}\n范围。`;
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: missing , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/body_invalid");
  });
});

test("create: empty H2 section rejected (22 §8 body must carry content)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const emptySection = `## 决策背景\n背景。\n\n## 决定\n\n## 备选与理由\n备选。\n\n## 后果\n后果。\n\n## 适用范围\n${draft.scope}\n范围。`;
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: emptySection , sessionSignature: TEST_SIGNATURE});
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
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: bodyWithoutEvidence , sessionSignature: TEST_SIGNATURE});
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
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body , sessionSignature: TEST_SIGNATURE});
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
    const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body , sessionSignature: TEST_SIGNATURE});
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
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
      sessionSignature: TEST_SIGNATURE,
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

test("update: active→retired (reason=abolished) succeeds without any relation (22 §9.2 废除记录、影响保留)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const updated = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "retired", retirement_reason: "abolished" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "Human 决定不再保留该决策记录，已产生的影响保留",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read2.value.frontmatter.status, "retired");
    assert.equal(read2.value.frontmatter.retirement_reason, "abolished");
    assert.equal(read2.value.frontmatter.relations, undefined, "abolished carries no relation (22 §9.1)");
  });
});

test("update: reason=abolished with relations rejected (22 §9.1 abolished forbids relations)", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root);
    const result = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "retired",
        retirement_reason: "abolished",
        relations: [{ relation_key: "superseded-by", target: { object_uid: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "试图为 abolished 附去向键",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "adr/relations_invalid");
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
      sessionSignature: TEST_SIGNATURE,
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
    const a = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draftA, bodyMarkdown: validBodyMarkdown(draftA) , sessionSignature: TEST_SIGNATURE});
    assert.ok(a.ok, JSON.stringify(a.error));

    const draftB = { ...validFrontmatterDraft(), title: "乙决策", trigger_signal: "当 SG-4 落地时重审本决策" };
    const b = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draftB, bodyMarkdown: validBodyMarkdown(draftB) , sessionSignature: TEST_SIGNATURE});
    assert.ok(b.ok, JSON.stringify(b.error));

    // retire the third one via a terminal transition
    const draftC = { ...validFrontmatterDraft(), title: "丙决策" };
    const c = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draftC, bodyMarkdown: validBodyMarkdown(draftC) , sessionSignature: TEST_SIGNATURE});
    assert.ok(c.ok, JSON.stringify(c.error));
    const readC = await readAdrObject({ factSourceRoot: root, objectUid: c.value.object_uid });
    const retired = await updateAdrObject({
      factSourceRoot: root,
      objectUid: c.value.object_uid,
      expectedFingerprint: readC.value.fingerprint,
      frontmatterAfter: { ...readC.value.frontmatter, status: "retired", retirement_reason: "outdated" },
      bodyMarkdownAfter: validBodyMarkdown(draftC),
      changeSummary: "转入 retired",
      sessionSignature: TEST_SIGNATURE,
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
      const result = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
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
    const created = await createAdrObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
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

// ---------------------------------------------------------------------------
// absorbed: ADR 被某方向 Norm 完整承接后的退休路径（22 §9.2 / §11）
//
// 缺口来源 spark-351a0b17：决策沉淀为规则体系后，ADR 没有合法退休路径，
// 只能借 superseded 指向另一条 ADR（它在规范里不是 ADR）。以下四个用例
// 锁定该路径的正向放行与三条反向拒绝，防止实现层与 22 §11 再次漂移。
// ---------------------------------------------------------------------------

const NORM_BODY_MIN = `## 方向定位与适用范围

本方向管辖示例规则集。

## 核心规则体系

- 示例规则一。

## 约束与反模式

禁止示例反模式。

## 验证与遵从性检查

以示例检查为准。
`;

async function createNormForAbsorb(root, directionKey = "example-rules") {
  const out = await createNormObject({
    factSourceRoot: root,
    frontmatterDraft: { title: "示例规则集", direction_key: directionKey },
    bodyMarkdown: NORM_BODY_MIN,
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(out.ok, JSON.stringify(out.error));
  return out.value.object_uid;
}

async function retireAbsorbed(root, read, relations) {
  return updateAdrObject({
    factSourceRoot: root,
    objectUid: read.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: {
      ...read.value.frontmatter,
      status: "retired",
      retirement_reason: "absorbed",
      ...(relations === undefined ? {} : { relations }),
    },
    bodyMarkdownAfter: validBodyMarkdown({
      decision: read.value.frontmatter.decision,
      scope: read.value.frontmatter.scope,
    }),
    changeSummary: "规则已并入方向规范",
    sessionSignature: TEST_SIGNATURE,
  });
}

test("absorbed: absorbed-into → 已存在的 Norm 通过，并按类型分派解析目标（22 §9.2/§11）", async () => {
  await withTemp("adr-absorbed.", async (root) => {
    const normUid = await createNormForAbsorb(root);
    const { read } = await createAndRead(root);
    const updated = await retireAbsorbed(root, read, [
      { relation_key: "absorbed-into", target: { object_uid: normUid } },
    ]);
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const back = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.ok(back.ok);
    const fm = back.value.frontmatter;
    assert.equal(fm.status, "retired");
    assert.equal(fm.retirement_reason, "absorbed");
    assert.equal(fm.relations.length, 1);
    assert.equal(fm.relations[0].relation_key, "absorbed-into");
    assert.equal(fm.relations[0].target.object_uid, normUid);
  });
});

test("absorbed: 目标不存在 → adr/relation_target_unresolvable 且零写入（22 §11 目标可解析）", async () => {
  await withTemp("adr-absorbed.", async (root) => {
    const { read } = await createAndRead(root);
    const ghost = "11111111-1111-4111-8111-111111111111";
    const updated = await retireAbsorbed(root, read, [
      { relation_key: "absorbed-into", target: { object_uid: ghost } },
    ]);
    assert.equal(updated.ok, false);
    assert.equal(updated.error.code, "adr/relation_target_unresolvable", JSON.stringify(updated.error));

    const back = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.ok(back.ok);
    assert.equal(back.value.frontmatter.status, "active");
    assert.equal(back.value.frontmatter.retirement_reason, undefined);
    assert.equal(back.value.frontmatter.relations, undefined);
  });
});

test("absorbed: 理由与关系键错配（absorbed + superseded-by）被拒绝（22 §9.1 一一配对）", async () => {
  await withTemp("adr-absorbed.", async (root) => {
    const normUid = await createNormForAbsorb(root, "example-rules-mismatch");
    const { read } = await createAndRead(root);
    const updated = await retireAbsorbed(root, read, [
      { relation_key: "superseded-by", target: { object_uid: normUid } },
    ]);
    assert.equal(updated.ok, false);
    assert.equal(updated.error.code, "adr/relations_invalid", JSON.stringify(updated.error));
    assert.ok(
      updated.error.details.issues.some((i) => i.includes("requires relation_key")),
      JSON.stringify(updated.error.details.issues),
    );
  });
});

test("absorbed: 关系键不在闭集（absorbed-by）被拒绝（22 §11 闭集）", async () => {
  await withTemp("adr-absorbed.", async (root) => {
    const normUid = await createNormForAbsorb(root, "example-rules-closed");
    const { read } = await createAndRead(root);
    const updated = await retireAbsorbed(root, read, [
      { relation_key: "absorbed-by", target: { object_uid: normUid } },
    ]);
    assert.equal(updated.ok, false);
    assert.equal(updated.error.code, "adr/relations_invalid", JSON.stringify(updated.error));
    assert.ok(
      updated.error.details.issues.some((i) => i.includes("not in closed set")),
      JSON.stringify(updated.error.details.issues),
    );
  });
});

test("absorbed: 零条关系被拒绝（22 §9.1 absorbed 必带恰好一条 absorbed-into）", async () => {
  await withTemp("adr-absorbed.", async (root) => {
    const { read } = await createAndRead(root);
    const updated = await retireAbsorbed(root, read, undefined);
    assert.equal(updated.ok, false);
    assert.equal(updated.error.code, "adr/relations_invalid", JSON.stringify(updated.error));
    assert.ok(
      updated.error.details.issues.some((i) => i.includes("required when retirement_reason") && i.includes("absorbed-into")),
      JSON.stringify(updated.error.details.issues),
    );
  });
});

test("absorbed: 两条同一关系键被拒绝（22 §11 基数恰 1）", async () => {
  await withTemp("adr-absorbed.", async (root) => {
    const normA = await createNormForAbsorb(root, "example-rules-two-a");
    const normB = await createNormForAbsorb(root, "example-rules-two-b");
    const { read } = await createAndRead(root);
    const updated = await retireAbsorbed(root, read, [
      { relation_key: "absorbed-into", target: { object_uid: normA } },
      { relation_key: "absorbed-into", target: { object_uid: normB } },
    ]);
    assert.equal(updated.ok, false);
    assert.equal(updated.error.code, "adr/relations_invalid", JSON.stringify(updated.error));
    assert.ok(
      updated.error.details.issues.some((i) => i.includes("has cardinality exactly 1")),
      JSON.stringify(updated.error.details.issues),
    );
  });
});

test("absorbed: 零关系数组（relations: []）被拒绝（22 §11 出现即非空）", async () => {
  await withTemp("adr-absorbed.", async (root) => {
    const { read } = await createAndRead(root);
    const updated = await retireAbsorbed(root, read, []);
    assert.equal(updated.ok, false);
    assert.equal(updated.error.code, "adr/relations_invalid", JSON.stringify(updated.error));
    assert.ok(
      updated.error.details.issues.some((i) => i.includes("must be non-empty")),
      JSON.stringify(updated.error.details.issues),
    );
  });
});

test("absorbed: 旧理由带关系被拒绝（outdated + 关系 → 22 §9.1 禁止）", async () => {
  await withTemp("adr-absorbed.", async (root) => {
    const normUid = await createNormForAbsorb(root, "example-rules-outdated");
    const { read } = await createAndRead(root);
    const updated = await updateAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "retired",
        retirement_reason: "outdated",
        relations: [{ relation_key: "absorbed-into", target: { object_uid: normUid } }],
      },
      bodyMarkdownAfter: validBodyMarkdown({
        decision: read.value.frontmatter.decision,
        scope: read.value.frontmatter.scope,
      }),
      changeSummary: "环境变化",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(updated.ok, false);
    assert.equal(updated.error.code, "adr/relations_invalid", JSON.stringify(updated.error));
    assert.ok(
      updated.error.details.issues.some((i) => i.includes("may only appear on status=retired")),
      JSON.stringify(updated.error.details.issues),
    );
  });
});

// ---------------------------------------------------------------------------
// 终态事实更正 correct (22 §13; specs/02 §10.5 事实更正 ≠ 内容更新)
//
// 22 §9.2 承诺「错误的终态记录按事实更正修正」，而 update 对 retired 一律拒绝
// ——该承诺此前无任何承载。本条覆盖四个边界：
//   ① retired 正文可改，终态判定与全部 frontmatter 逐字不变
//   ② 判定字段不可改（入口结构性不接收 frontmatter 输入）
//   ③ 缺 Human 授权 → fail-closed
//   ④ 正文未变 → no-op 拒绝（不追加假流水）
// ---------------------------------------------------------------------------

async function createRetired(root, overrides = {}) {
  const { draft, read } = await createAndRead(root, overrides);
  const retired = await updateAdrObject({
    factSourceRoot: root,
    objectUid: read.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: { ...read.value.frontmatter, status: "retired", retirement_reason: "outdated" },
    bodyMarkdownAfter: validBodyMarkdown(draft),
    changeSummary: "决策不再适用",
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(retired.ok, JSON.stringify(retired.error));
  const afterRetire = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
  assert.ok(afterRetire.ok, JSON.stringify(afterRetire.error));
  return { draft, read: afterRetire };
}

/** 把正文的「决策背景」段替换成给定时长文本，保持其余段与载体内聚不变。 */
function bodyWithBackground(draft, background) {
  const base = validBodyMarkdown(draft);
  return base.replace(/## 决策背景\n[^\n]*/, `## 决策背景\n${background}`);
}

test("correct ①: retired 正文可更正，且 status/decision/scope/retirement_reason/retired_at 逐字不变", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createRetired(root);
    const before = read.value.frontmatter;

    const corrected = await correctAdrObject({
      factSourceRoot: root,
      objectUid: before && read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: bodyWithBackground(draft, "更正后的背景：原文把归档上线时间写错了，此处据实修正。"),
      changeSummary: "更正决策背景的错述",
      humanAuthorization: "老丁 2026-11-04 授权更正该条 retired ADR 的背景段错述",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(corrected.ok, JSON.stringify(corrected.error));

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.ok(read2.ok, JSON.stringify(read2.error));

    // 正文确实变了
    assert.ok(read2.value.body.includes("更正后的背景"), "corrected body must carry the new text");

    // 终态判定与全部 frontmatter 逐字继承
    for (const field of ["status", "decision", "scope", "retirement_reason", "retired_at", "title", "created_at", "object_uid"]) {
      assert.deepEqual(read2.value.frontmatter[field], before[field], `${field} must be inherited verbatim`);
    }
    assert.equal(read2.value.frontmatter.status, "retired");

    // 恰好追加一条 change_log，且带授权文本
    assert.equal(read2.value.frontmatter.change_log.length, before.change_log.length + 1);
    const entry = read2.value.frontmatter.change_log.at(-1);
    assert.match(entry.summary, /事实更正（非状态转换）/);
    assert.match(entry.summary, /老丁 2026-11-04 授权/);
    assert.equal(read2.value.body_valid, true);
  });
});

test("correct ②: 判定字段不可改 —— 入口结构性不接收 frontmatter（传了也无效果）", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createRetired(root);
    const before = read.value.frontmatter;

    // 调用方即使塞入 frontmatterAfter，writer 也没有对应参数可承载它：
    // decision/scope 保持落盘值，不会被这次调用改写。
    const corrected = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: bodyWithBackground(draft, "另一处背景更正。"),
      changeSummary: "更正背景",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
      // 越权尝试：writer 的签名里没有这个参数，JS 层被忽略。
      frontmatterAfter: { ...before, decision: "改掉的决策。", scope: "改掉的适用范围。" },
    });
    assert.ok(corrected.ok, JSON.stringify(corrected.error));

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read2.value.frontmatter.decision, before.decision, "decision must not change through correct");
    assert.equal(read2.value.frontmatter.scope, before.scope, "scope must not change through correct");
    assert.equal(read2.value.frontmatter.status, "retired");
  });
});

test("correct ②b: 非 retired 对象拒绝（把内容更新伪装成事实更正的路径被封）", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createAndRead(root); // active
    const corrected = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: bodyWithBackground(draft, "试图在 active 上走更正入口。"),
      changeSummary: "越界尝试",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(corrected.ok, false);
    assert.equal(corrected.error.code, "adr/correction_requires_retired", JSON.stringify(corrected.error));

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read2.value.fingerprint, read.value.fingerprint, "rejected call must leave zero write");
  });
});

test("correct ③: 缺 Human 授权 → fail-closed 且零写入", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createRetired(root);
    for (const auth of [undefined, "", "   "]) {
      const corrected = await correctAdrObject({
        factSourceRoot: root,
        objectUid: read.value.object_uid,
        expectedFingerprint: read.value.fingerprint,
        bodyMarkdownAfter: bodyWithBackground(draft, "无授权时的更正尝试。"),
        changeSummary: "无授权",
        humanAuthorization: auth,
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(corrected.ok, false, `auth=${JSON.stringify(auth)} must be refused`);
      assert.equal(corrected.error.code, "adr/human_authorization_required");
    }
    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read2.value.fingerprint, read.value.fingerprint, "all refusals must leave zero write");
  });
});

test("correct ④: 正文未变 → no-op 拒绝，不追加声称更正过的流水", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { read } = await createRetired(root);
    // read.body carries the H1 (`# <title>`); body_markdown_after starts at
    // `## 决策背景` (the H1 is regenerated from title by assembleBody).
    const bodyOnly = read.value.body.replace(/^#\s.*\n+/, "");
    // 提交与落盘正文完全相同的内容
    const same = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: bodyOnly,
      changeSummary: "声称改了但没改",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(same.ok, false);
    assert.equal(same.error.code, "adr/no_op", JSON.stringify(same.error));

    const withTrailing = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: `${bodyOnly}\n\n   `,
      changeSummary: "只差尾随空白",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(withTrailing.ok, false, "trailing-whitespace-only difference is still a no-op");
    assert.equal(withTrailing.error.code, "adr/no_op");

    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    assert.equal(read2.value.fingerprint, read.value.fingerprint, "no-op refusals must leave zero write");
  });
});

test("correct ⑤: CAS 基线不符 → cas_conflict 且零写入", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { draft, read } = await createRetired(root);
    const corrected = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: "0".repeat(64),
      bodyMarkdownAfter: bodyWithBackground(draft, "陈旧基线下的更正。"),
      changeSummary: "陈旧指纹",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(corrected.ok, false);
    assert.equal(corrected.error.code, "adr/cas_conflict");
  });
});

test("correct ⑥: 正文结构破坏被拒绝（固定 H2 骨架仍适用）", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { read } = await createRetired(root);
    const broken = read.value.body.replace("## 备选与理由", "## 备选");
    const corrected = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: broken,
      changeSummary: "破坏结构",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(corrected.ok, false);
    assert.equal(corrected.error.code, "adr/body_invalid", JSON.stringify(corrected.error));
  });
});

test("correct ⑦: 改掉决定段逐字行 → 载体内聚失败（decision 不许事后篡改）", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { read } = await createRetired(root);
    const tampered = read.value.body.replace(/## 决定\n[^\n]*/, "## 决定\n改用另一套完全不同的方案。");
    const corrected = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: tampered,
      changeSummary: "试图改写决定",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(corrected.ok, false);
    assert.equal(corrected.error.code, "adr/coherence_invalid", JSON.stringify(corrected.error));
  });
});

test("correct ⑧: 把 read.body（含 H1）原样回传也能正常判定 no-op，不会拼出两个 H1", async () => {
  await withTemp("adr-writer.", async (root) => {
    const { read } = await createRetired(root);
    assert.ok(read.value.body.startsWith("# "), "read.body carries the H1 by contract");

    // 直接回传 read.body：契约上 body_markdown_after 从 '## 决策背景' 起，
    // 但调用方按直觉回传含 H1 的全文很常见。writer 剥掉与 title 逐字相同的
    // 前置 H1 后应判为 no-op，而不是拼出双 H1 再报「首个 heading 非法」。
    const same = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: read.value.body,
      changeSummary: "原样回传",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(same.ok, false, "unchanged body must be a no-op, not a structural error");
    assert.equal(same.error.code, "adr/no_op", JSON.stringify(same.error));

    // 带 H1 的真实改动也应落地，且载体里只有一个 H1
    const edited = read.value.body.replace("## 决策背景", "## 决策背景\n补写一行更正说明。");
    const corrected = await correctAdrObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: edited,
      changeSummary: "补写更正说明",
      humanAuthorization: "老丁 2026-11-04 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(corrected.ok, JSON.stringify(corrected.error));
    const read2 = await readAdrObject({ factSourceRoot: root, objectUid: read.value.object_uid });
    const h1Count = (read2.value.body.match(/^# /gm) ?? []).length;
    assert.equal(h1Count, 1, "the carrier must carry exactly one H1");
    assert.ok(read2.value.body.includes("补写一行更正说明。"));
    assert.equal(read2.value.body_valid, true);
  });
});
