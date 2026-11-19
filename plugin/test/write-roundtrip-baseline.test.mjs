
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { testSignature, withTemp } from "./helpers.mjs";
import {
  createSparkObject,
  readSparkObject,
  updateSparkObject,
  computeSparkCreateCandidateFingerprint,
} from "../lib/spark-writer.js";
import { stripLeadingH1 } from "../lib/friction-discovery.js";

const SIG = testSignature();

function draft() {
  return {
    title: "写入往返形态基准",
    question: "五种 uid 形态与可写回正文能否一次写成功？",
    scope_boundary: "仅以自造夹具与受控写入接缝为证据，不触碰仓库活载体。",
    intent: "固定住已修复的失败形态，作为回归基准（代理指标，非语料级失败率）。",
    summary: "形态回归基准：覆盖 uid 多形态、跨项目拒绝、H1 剥离。",
    priority: "P2",
    change_summary: "基准夹具创建",
  };
}

function body(d = draft()) {
  return [
    `## 当前理解\n${d.summary}\n说明文字。`,
    `## 调查问题\n${d.question}\n说明文字。`,
    `## 调查边界\n${d.scope_boundary}\n说明文字。`,
  ].join("\n\n");
}

async function seed(root) {
  const d = draft();
  const created = await createSparkObject({
    factSourceRoot: root,
    frontmatterDraft: d,
    bodyMarkdown: body(d),
    expectedCandidateFingerprint: computeSparkCreateCandidateFingerprint(d, body(d)),
    sessionSignature: SIG,
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  return created.value.object_uid;
}

function withoutH1(text) {
  return text.replace(/^#\s+[^\r\n]*(?:\r?\n)+/, "");
}

async function updateWith(root, objectUid, expectedFingerprint, d) {
  return updateSparkObject({
    factSourceRoot: root,
    objectUid,
    expectedFingerprint,
    frontmatterAfter: { ...d, summary: d.summary + "（已更新）" },
    bodyMarkdownAfter: body({ ...d, summary: d.summary + "（已更新）" }),
    changeSummary: "基准更新",
    sessionSignature: SIG,
    currentProjectId: "dsh-ldvh",
  });
}

test("基准：canonical UUID 更新一次写成功", async () => {
  await withTemp("write-baseline-canonical.", async (root) => {
    const uid = await seed(root);
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read1.ok);
    const r = await updateWith(root, uid, read1.value.fingerprint, draft());
    assert.ok(r.ok, JSON.stringify(r.error));
  });
});

test("基准：type-<uuid> 形态更新一次写成功，且写回 canonical", async () => {
  await withTemp("write-baseline-prefixed.", async (root) => {
    const uid = await seed(root);
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const r = await updateWith(root, `spark-${uid}`, read1.value.fingerprint, draft());
    assert.ok(r.ok, JSON.stringify(r.error));
    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read2.ok, "type-<uuid> 写入后应能用 canonical 读回");
    assert.equal(read2.value.frontmatter.summary.includes("已更新"), true);
  });
});

test("基准：裸 8-hex 短 id 更新一次写成功，且写回 canonical", async () => {
  await withTemp("write-baseline-short.", async (root) => {
    const uid = await seed(root);
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const r = await updateWith(root, uid.slice(0, 8), read1.value.fingerprint, draft());
    assert.ok(r.ok, JSON.stringify(r.error));
    const read2 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    assert.ok(read2.ok, "短 id 写入应落在 canonical 载体上");
    assert.equal(read2.value.frontmatter.summary.includes("已更新"), true);
  });
});

test("基准：projectId@uuid 形态更新一次写成功", async () => {
  await withTemp("write-baseline-project.", async (root) => {
    const uid = await seed(root);
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const r = await updateWith(root, `dsh-ldvh@${uid}`, read1.value.fingerprint, draft());
    assert.ok(r.ok, JSON.stringify(r.error));
  });
});

test("基准：跨项目前缀被拒，且载体未被触碰（入口短路）", async () => {
  await withTemp("write-baseline-foreign.", async (root) => {
    const uid = await seed(root);
    const before = await readFile(join(root, "sparks", `spark-${uid}.md`), "utf8");
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const r = await updateWith(root, `other-project@${uid}`, read1.value.fingerprint, draft());
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "spark/invalid_uid");
    assert.match(r.error.message, /foreign_project/);
    const after = await readFile(join(root, "sparks", `spark-${uid}.md`), "utf8");
    assert.equal(after, before, "被拒的写入不得触碰载体");
  });
});

test("基准：读回正文带 H1 被拒，诊断给出模型可执行动作（不再要求 import 内部模块）", async () => {
  await withTemp("write-baseline-h1.", async (root) => {
    const uid = await seed(root);
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const withH1 = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: draft(),
      bodyMarkdownAfter: read1.value.body,
      changeSummary: "误带 H1",
      sessionSignature: SIG,
    });
    assert.equal(withH1.ok, false);
    assert.equal(withH1.error.code, "spark/body_invalid");
    const issues = Array.isArray(withH1.error.details?.issues) ? withH1.error.details.issues.join(" ") : "";
    assert.match(issues, /H1/, `带 H1 的回读正文应被拒并指明 H1：${issues}`);
  });
  const source = await readFile(new URL("../lib/friction-writer.js", import.meta.url), "utf8");
  const diagnostic = source.slice(source.indexOf("function requireBodyWithoutH1"), source.indexOf("function assembleBody"));
  assert.doesNotMatch(diagnostic, /import \{ stripLeadingH1 \}/, "诊断不得要求模型 import 插件内部模块");
  assert.match(diagnostic, /deleting the FIRST line/, "诊断须给出模型可执行的动作");
});

test("基准：stripLeadingH1 在 LF 与 CRLF 上都剥掉 H1 并保留正文", () => {
  assert.equal(stripLeadingH1("# T\n\n## 现象\nx"), "## 现象\nx");
  assert.equal(stripLeadingH1("# T\r\n\r\n## 现象\r\nx"), "## 现象\r\nx");
  assert.equal(stripLeadingH1("## 现象\nx"), "## 现象\nx");
});

test("基准：withoutH1 剥离后的正文可被 update 接受（对照被拒路径）", async () => {
  await withTemp("write-baseline-strip.", async (root) => {
    const uid = await seed(root);
    const read1 = await readSparkObject({ factSourceRoot: root, objectUid: uid });
    const r = await updateSparkObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read1.value.fingerprint,
      frontmatterAfter: draft(),
      bodyMarkdownAfter: withoutH1(read1.value.body),
      changeSummary: "剥离 H1 后更新",
      sessionSignature: SIG,
    });
    assert.ok(r.ok, JSON.stringify(r.error));
  });
});
