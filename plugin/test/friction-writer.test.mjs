// Tests for plugin/lib/friction-writer.js — the Friction mechanical writer slice.
//
// Every case is derived from specs/26 (the single authority):
//   §6 查重与攒账, §8 字段契约与正文三段（处置段条件出现）,
//   §9 状态机（**三值闭集 open/resolved/voided**；resolved/voided 终态；
//      informs 只在销账流转写入。观察态 observing 已于 2026-10 退出闭集——
//      观察材料改由 11 §12bis.1 的摩擦观察缓冲承载（非事实对象），不进事实源；
//      `observing → open`（阈值）与 `open → observing`（放回留观）两条流转一并删除）,
//   §11 informs 关系（目标限 ADR/WorkCase 目录可解析）,
//   §12 召回（默认 open；resolved/voided 只在 includeResolved）,
//   §13 受控操作, §14.1 特有验证.
// Tests assert spec behaviour; where the implementation diverges from the
// spec the failure is reported in the task report, never "fixed" by bending
// the assertion. lib/ is NOT modified here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { testSignature, withTemp } from "./helpers.mjs";

// 03 §6.1 / 09: every write carries the authoritative signature. Domain-rule
// tests supply a branded test carrier; the signature gate has its own cases.
const TEST_SIGNATURE = testSignature();
import {
  createFrictionObject,
  readFrictionObject,
  updateFrictionObject,
  correctFrictionObject,
  listFrictionObjects,
  isSingleSentence,
  frictionFileName,
  FRICTION_DIRECTORY,
  validateFrictionFrontmatter,
  validateFrictionRelations,
  validateFrictionBodyStructure,
  validateCarrierCoherence,
} from "../lib/friction-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// goal.md fixture: 26 §6 / §8 — serves must match an SG-n anchor in
// the ## 子目标 section. Contains SG-3 specifically required by tests.
const GOAL_MD_FIXTURE = `---
goal_key: framework-goal
title: LDVH 框架目标
status: active
created_at: 2026-09-10T12:00:00+08:00
---

# LDVH 框架目标

## 目标陈述

LDVH 框架的总体目标。

## 子目标

SG-1 第一条子目标。
SG-2 第二条子目标。
SG-3 框架效能目标。
SG-4 第四条子目标。
`;

/** ADR fixture file written to the fact source root for informs target resolution. */
async function createAdrFixture(factSourceRoot, uid) {
  const adrBody = [
    `## 决策背景\n背景说明。`,
    `## 决定\n我们决定采用方式 X 解决摩擦问题。`,
    `## 备选与理由\n替代方案 Y 已被否决因为 Z。`,
    `## 后果\n预期结果可被度量。`,
    `## 适用范围\n适用于本仓库所有 CI 场景。`,
  ].join("\n\n");
  const adrFm = {
    object_uid: uid,
    fact_type_key: "adr",
    title: "解决 CI 摩擦的决策",
    status: "active",
    decision: "我们决定采用方式 X 解决摩擦问题。",
    scope: "适用于本仓库所有 CI 场景。",
    created_at: "2026-09-10T12:00:00+08:00",
    change_log: [{ at: "2026-09-10T12:00:00+08:00", summary: "受控创建" }],
  };
  const content = `---\n${stringifyYaml(adrFm)}---\n\n${adrBody.trim()}\n`;
  await mkdir(join(factSourceRoot, "adrs"), { recursive: true });
  await writeFile(join(factSourceRoot, "adrs", `adr-${uid}.md`), content, "utf8");
  return uid;
}

function validFrontmatterDraft(overrides = {}) {
  return {
    title: "CI 构建缓慢",
    phenomenon: "CI 每次构建平均需要 8 分钟，其中 5 分钟花在重复依赖安装上。",
    impact: "heavy",
    // 26 §8 必填：创建时初值 count=1、first_at=last_at。
    // 成员闭集 = { count, first_at, last_at }——`human_return_at` 已随
    // `open → observing`（放回留观）流转一并删除（2026-10 修订），多带即拒
    // （`friction/occurrence_invalid`，三入口统一：create / update / correct 补填）。
    // d925ad6 起 create 拒绝缺 occurrence 的草稿；本夹具此前漏改，导致本文件
    // 全部 create 路径在 ESM 之外的机械层被拒（2026-10 修复）。
    occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
    change_summary: "受控创建（测试）",
    ...overrides,
  };
}

// 26 §8 正文固定结构：phenomenon / 入账依据（必填两段）+ 处置（条件：resolved/voided）
function validBodyMarkdown(draft = validFrontmatterDraft(), options = {}) {
  const { disposition: extraDisposition } = options;
  const sections = [
    `## 现象\n${draft.phenomenon}\n重复出现证据：在流水线日志中可观察到的现象。`,
    `## 入账依据\n${extraDisposition ? "重复出现超过 3 次；" : "重复出现多次；"}归因：CI 配置未缓存依赖层；修了会改善：构建时间预计缩短至 3 分钟内。`,
  ];
  if (extraDisposition) {
    sections.push(`## 处置\n${extraDisposition}`);
  }
  return sections.join("\n\n");
}

function resolvedBodyMarkdown(draft = validFrontmatterDraft()) {
  return validBodyMarkdown(draft, {
    disposition: "已解决：通过配置 Docker 层缓存，构建时间从 8 分钟缩短至 2 分钟。",
  });
}

function parseFrontmatter(raw) {
  const fmEnd = raw.indexOf("\n---\n", 5);
  return parseYaml(raw.slice(4, fmEnd));
}

async function createAndRead(root, overrides = {}) {
  const draft = validFrontmatterDraft(overrides);
  const created = await createFrictionObject({
    factSourceRoot: root,
    frontmatterDraft: draft,
    bodyMarkdown: validBodyMarkdown(draft),
    sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  const read = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  assert.ok(read.ok, JSON.stringify(read.error));
  return { draft, created, read };
}

// ---------------------------------------------------------------------------
// §8 phenomenon 单句可读 (isSingleSentence)
// ---------------------------------------------------------------------------

test("isSingleSentence accepts a single terminal-ending sentence or a terminal-free string", () => {
  assert.equal(isSingleSentence("CI 每次构建平均需要 8 分钟。"), true);
  assert.equal(isSingleSentence("如何验证机械层？"), true);
  assert.equal(isSingleSentence("无终符陈述"), true);
});

test("isSingleSentence rejects two terminals, terminal-not-at-end and empty input", () => {
  assert.equal(isSingleSentence("CI 慢。构建还失败。"), false);
  assert.equal(isSingleSentence("CI 慢。但后续"), false);
  assert.equal(isSingleSentence(""), false);
});

// ---------------------------------------------------------------------------
// create 正向 (26 §13)
// ---------------------------------------------------------------------------

test("create: 合法草稿落盘于 frictions/friction-<uid>.md，Code 指派身份且精确回读一致（26 §7/§8/§9——初态为 open）", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { draft, created, read } = await createAndRead(root);
    const uid = created.value.object_uid;
    assert.match(uid, UUID_PATTERN);

    // fileName & directory (26 §7: ldvh-base/frictions/friction-<uid>.md)
    const filePath = join(root, FRICTION_DIRECTORY, frictionFileName(uid));
    assert.equal(created.value.file, filePath);
    const raw = await readFile(filePath, "utf8");
    assert.ok(raw.startsWith("---\n"));

    // Code identity: uid / created_at / change_log first entry (26 §7/§8)
    const fm = parseFrontmatter(raw);
    assert.equal(fm.object_uid, uid);
    assert.equal(fm.fact_type_key, "friction");
    assert.equal(fm.status, "open", "26 §9：创建初态为 open（观察态 observing 已退出闭集，观察材料在 11 §12bis.1 缓冲侧）");
    assert.ok(typeof fm.created_at === "string" && fm.created_at.length > 0);
    assert.equal(fm.change_log.length, 1);
    assert.equal(fm.change_log[0].summary, "受控创建（测试）");
    assert.equal(fm.change_log[0].provider, "p", "sessionSignature must land in the change_log entry");
    assert.ok(fm.change_log[0].at);
    assert.equal(fm.change_summary, undefined, "change_summary is a call argument, not object metadata");

    // H1 generated from title (26 §8)
    assert.ok(raw.includes(`# ${draft.title}`));

    // precise read-back round-trip (26 §13 创建后精确回读)
    assert.equal(read.value.frontmatter.phenomenon, draft.phenomenon);
    assert.equal(read.value.frontmatter.impact, draft.impact);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.fingerprint, created.value.fingerprint);
    assert.deepEqual(read.value.body_issues, []);
  });
});

test("create: with attribution backfilled succeeds (26 §8 conditional field)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { draft, created, read } = await createAndRead(root, { attribution: "CI 配置的 Docker 层未缓存" });
    assert.equal(read.value.frontmatter.attribution, "CI 配置的 Docker 层未缓存");
  });
});

test("create: serves 已退出闭集，带该字段一律被机械拒绝（26 §8，cb2a37a）", async () => {
  await withTemp("friction-writer.", async (root) => {
    await writeFile(join(root, "goal.md"), GOAL_MD_FIXTURE, "utf8");
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), serves: "SG-3" },
      bodyMarkdown: validBodyMarkdown(validFrontmatterDraft()),
      sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "friction/frontmatter_invalid");
    assert.ok(
      result.error.message.includes("serves") || JSON.stringify(result.error.details).includes("serves"),
      "拒绝理由须点名 serves 是表外字段，而非某种不可解析",
    );
  });
});

// ---------------------------------------------------------------------------
// occurrence 成员闭集（26 §8，2026-10 修订）
//
// `occurrence` 的成员闭集 = { count, first_at, last_at }——**不多不少**。
// `human_return_at` 随 `open → observing`（放回留观）流转一并删除后仍在载体里
// 出现过；此前只有 correct 的补填分支校验成员，create/update 只查存在性，
// 于是携带已删除字段的载体一路落盘（fail-open）。本次修订把校验收到一处，
// 三个入口共用同一判据。本组用例逐入口钉住「多带即拒」。
// ---------------------------------------------------------------------------

test("create: occurrence 携带已删除的 human_return_at 被拒（26 §8 成员闭集——堵住 fail-open）", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = validFrontmatterDraft({
      occurrence: {
        count: 1,
        first_at: "2026-11-01T00:00:00.000Z",
        last_at: "2026-11-01T00:00:00.000Z",
        human_return_at: "2026-11-02T00:00:00.000Z",
      },
    });
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok, "occurrence 多出已删除字段 human_return_at 必须被拒——否则是 fail-open");
    assert.equal(result.error.code, "friction/occurrence_invalid");
    assert.match(result.error.message, /human_return_at/);
    assert.match(result.error.message, /closed set/);

    // 零写：被拒的草稿不得留下载体
    const listed = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.total, 0, "被拒的创建不得留下载体");
  });
});

test("create: occurrence 携带任意表外成员同样被拒（26 §8 成员闭集——不多不少）", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = validFrontmatterDraft({
      occurrence: {
        count: 1,
        first_at: "2026-11-01T00:00:00.000Z",
        last_at: "2026-11-01T00:00:00.000Z",
        observed_by: "人类观察者",
      },
    });
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: validBodyMarkdown(draft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok, "occurrence 的成员闭集不多不少——表外成员一律被拒");
    assert.equal(result.error.code, "friction/occurrence_invalid");
    assert.match(result.error.message, /observed_by/);
  });
});

test("update: occurrence 携带已删除的 human_return_at 被拒（26 §8 成员闭集——补充级同样过共享关口）", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const result = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        occurrence: { ...r1.value.frontmatter.occurrence, human_return_at: "2026-11-02T00:00:00.000Z" },
      },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "给 occurrence 补一个已删除字段",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok, "补充级更新同样不得把已删除字段写回 occurrence——否则 fail-open 从更新侧复现");
    // update 路径的共享关口是 validateFrictionFrontmatter：它把成员违规作为
    // issue 收进 issues，故顶层码是 frontmatter_invalid，而拒绝理由必须点名
    // human_return_at 与闭集（否则「以别的理由被拒」也会让本用例通过）。
    assert.equal(result.error.code, "friction/frontmatter_invalid");
    const issues = result.error.details?.issues ?? [];
    assert.ok(
      issues.some((i) => i.includes("human_return_at") && i.includes("closed set")),
      `拒绝理由须点名 occurrence 的成员闭集违规；got ${JSON.stringify(issues)}`,
    );

    // 零写：被拒的更新不得改动载体
    const after = await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid });
    assert.equal(after.value.fingerprint, r1.value.fingerprint, "被拒的更新必须零写");
    assert.equal(after.value.frontmatter.occurrence.human_return_at, undefined);
  });
});

test("correct: 补填 occurrence 带 human_return_at 被拒（26 §8 成员闭集 / §13 补填通道）", async () => {
  await withTemp("friction-writer.", async (root) => {
    // 补填通道只补「新进入闭集」的字段（26 §13），而补进去的**值**仍须满足
    // §8 的成员闭集——否则补填通道就成了绕过成员校验的后门。
    // 造一条**缺 occurrence** 的 voided 存量载体（§14.2 豁免允许 voided 无 occurrence）。
    const uid = "44444444-4444-4444-8444-444444444444";
    const phenomenon = "存量载体带一条被误记的摩擦。";
    const disposition = "误记：与本项目无关。";
    await mkdir(join(root, FRICTION_DIRECTORY), { recursive: true });
    await writeFile(
      join(root, FRICTION_DIRECTORY, frictionFileName(uid)),
      `---\nobject_uid: ${uid}\nfact_type_key: friction\ntitle: 存量作废载体\nstatus: voided\n` +
        `phenomenon: "${phenomenon}"\nimpact: light\ndisposition: "${disposition}"\n` +
        `created_at: "2026-01-01T00:00:00.000Z"\nchange_log: []\n` +
        `---\n\n# 存量作废载体\n\n## 现象\n${phenomenon}\n\n## 入账依据\n依据。\n\n## 处置\n${disposition}\n`,
      "utf8",
    );

    const rejected = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: (await readFrictionObject({ factSourceRoot: root, objectUid: uid })).value.fingerprint,
      frontmatterAdditions: {
        occurrence: {
          count: 1,
          first_at: "2026-11-01T00:00:00.000Z",
          last_at: "2026-11-01T00:00:00.000Z",
          human_return_at: "2026-11-02T00:00:00.000Z",
        },
      },
      bodyMarkdownAfter: [
        `## 现象\n${phenomenon}`,
        "## 入账依据\n依据。",
        `## 处置\n${disposition}`,
      ].join("\n\n"),
      changeSummary: "补填 occurrence（夹带已删除字段）",
      humanAuthorization: "Human 于 2026-10 授权（测试）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!rejected.ok, "补填通道不得成为 occurrence 成员闭集的后门");
    assert.equal(rejected.error.code, "friction/occurrence_invalid");
    assert.match(rejected.error.message, /human_return_at/);

    // 零写：被拒的补填不得改动终态载体
    const after = await readFrictionObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence, undefined, "被拒的补填不得写入 occurrence");
  });
});

// ---------------------------------------------------------------------------
// 签名通道负向 (specs/03 §6.1 + specs/09 机械签名)
// ---------------------------------------------------------------------------

test("create: a forged plain sessionSignature is REFUSED — no unsigned change_log entry (specs/09)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    // Human 2026-09-12: changelog must be mechanically signed; a write that
    // cannot be signed is refused rather than recorded unsigned.
    const created = await createFrictionObject({
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
// create 反向 (26 §8/§9/§11/§13/§14.1)
// ---------------------------------------------------------------------------

test("create: 非 open 的初态一律被拒（26 §9 三值闭集——观察态 observing 已退出）", async () => {
  // 2026-10 修订（Human 决定）：状态闭集由四值（observing/open/resolved/voided）
  // 收缩为三值（open/resolved/voided），创建初态随之由 observing 改为 open。
  // 故「非 observing 的初态该被拒」这条判据整体反向：**非 open 的初态**才该被拒，
  // 且 observing 自身现在也是闭集外取值。
  await withTemp("friction-writer.", async (root) => {
    for (const status of ["observing", "resolved", "voided", "deferred"]) {
      const result = await createFrictionObject({
        factSourceRoot: root,
        frontmatterDraft: { ...validFrontmatterDraft(), status },
        bodyMarkdown: validBodyMarkdown(),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(!result.ok, `${status} should be rejected`);
      assert.equal(result.error.code, "friction/initial_state_violation");
    }

    // 正向：不声明 status 或显式声明 open，落盘初态都是 open
    for (const draft of [validFrontmatterDraft(), validFrontmatterDraft({ status: "open" })]) {
      const created = await createFrictionObject({
        factSourceRoot: root,
        frontmatterDraft: draft,
        bodyMarkdown: validBodyMarkdown(),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(created.ok, JSON.stringify(created.error));
      const read = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
      assert.ok(read.ok, JSON.stringify(read.error));
      assert.equal(read.value.frontmatter.status, "open");
    }
  });
});

test("create: relations at creation rejected (26 §11: informs only on resolved)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: {
        ...validFrontmatterDraft(),
        relations: [{ relation_key: "informs", target: { object_uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } }],
      },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/frontmatter_invalid");
  });
});

test("create: unknown frontmatter field rejected (26 §8 closed set)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), custom_field: "x" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("unexpected field")), JSON.stringify(result.error.details.issues));
  });
});

test("create: title longer than 30 chars rejected (26 §8 title ≤ 30 字)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), title: "长".repeat(31) },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/frontmatter_invalid");
  });
});

test("create: phenomenon missing or empty rejected (26 §8 required)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result1 = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), phenomenon: "" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result1.ok);
    assert.equal(result1.error.code, "friction/frontmatter_invalid");

    const result2 = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), phenomenon: undefined },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result2.ok);
    assert.equal(result2.error.code, "friction/frontmatter_invalid");
  });
});

test("create: phenomenon with double terminals rejected (26 §8 single-sentence)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), phenomenon: "CI 慢。构建还失败。" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/frontmatter_invalid");
  });
});

test("create: impact outside closed set rejected (26 §8 impact 闭集)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), impact: "critical" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("impact")), JSON.stringify(result.error.details.issues));
  });
});

test("create: goal.md 缺席不再阻断——serves 退出闭集后无锚点依赖（26 §8，cb2a37a）", async () => {
  await withTemp("friction-writer.", async (root) => {
    // no goal.md in root
    const { created, read } = await createAndRead(root);
    assert.equal(read.value.frontmatter.status, "open", "26 §9：创建初态为 open");
    assert.equal(read.value.frontmatter.serves, undefined, "闭集内不得再出现 serves");
  });
});

test("create: attribution empty string rejected (26 §8 conditional — present means non-empty)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: { ...validFrontmatterDraft(), attribution: "" },
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/frontmatter_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("attribution")), JSON.stringify(result.error.details.issues));
  });
});

test("create: body with wrong H2 order rejected (26 §8 fixed order)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const wrongOrder = [
      `## 入账依据\n重复出现多次。`,
      `## 现象\n${draft.phenomenon}\n展开。`,
    ].join("\n\n");
    const result = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: wrongOrder , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/body_invalid");
  });
});

test("create: body missing required H2 sections rejected (26 §8 必填两段)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const onlyPhenomenon = `## 现象\n${draft.phenomenon}\n展开。`;
    const result = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: onlyPhenomenon , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/body_invalid");
  });
});

test("create: open status with 处置 section rejected (26 §8 条件出现 — 处置 ⇔ resolved/voided)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const bodyWithDisposition = validBodyMarkdown(draft) + "\n\n## 处置\n不应出现在 open。";
    const result = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: bodyWithDisposition , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/body_invalid");
  });
});

test("create: carrier coherence — phenomenon not verbatim in 现象 section rejected (26 §8/§14.1)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const drifted = draft.phenomenon.replace("8 分钟", "10 分钟");
    const body = validBodyMarkdown(draft).replace(draft.phenomenon, drifted);
    const result = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: body , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/coherence_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("carrier coherence")), JSON.stringify(result.error.details.issues));
  });
});

test("create: empty H2 section rejected (26 §8 body must carry content)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = validFrontmatterDraft();
    const emptySection = [
      `## 现象\n${draft.phenomenon}\n`,
      `## 入账依据\n\n`,
      `## 附注\n\n`,
    ].join("\n\n");
    const result = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: emptySection , sessionSignature: TEST_SIGNATURE});
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/body_invalid");
    assert.ok(result.error.details.issues.some((i) => i.includes("is empty")), JSON.stringify(result.error.details.issues));
  });
});

// ---------------------------------------------------------------------------
// State machine transitions (26 §9.2 重点)
// ---------------------------------------------------------------------------

test("state machine: 阈值晋升流转已随观察态删除——创建即为 open，观察材料不进事实源（26 §9 三值闭集 / 11 §12bis.1 观察缓冲）", async () => {
  // 2026-10 修订：`observing → open`（阈值晋升）随观察态退出闭集而删除。原用例
  // 断言「晋升后 status=open」，现在**创建初态就是 open**，账本里不再存在
  // 「observing 前态」这一段。观察材料改由 11 §12bis.1 的摩擦观察缓冲承载
  // （本地缓冲、非事实对象），事实源里关于观察的唯一载体是 `occurrence` 计数。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    assert.equal(r1.value.frontmatter.status, "open", "26 §9：创建初态即 open，无 observing 前态");
    assert.equal(r1.value.frontmatter.occurrence.count, 1, "观察次数只由 occurrence 承载");
    const fmKeys = Object.keys(r1.value.frontmatter);
    assert.ok(!fmKeys.includes("observing"), "观察态不得以字段形式进事实源");
    assert.ok(!fmKeys.includes("observation_buffer"), "观察缓冲不是事实对象，载体上不得留指针字段");

    // 补充级更新（status 逐字未变）只累积观察次数，状态不动
    const updated = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        occurrence: { ...r1.value.frontmatter.occurrence, count: 3, last_at: "2026-11-03T00:00:00.000Z" },
      },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "观察次数累积到 3",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.status, "open", "补充级更新不得改变状态");
    assert.equal(read2.value.frontmatter.occurrence.count, 3);
    assert.equal(read2.value.body_valid, true);
    assert.equal(read2.value.frontmatter.change_log.length, 2);
  });
});

test("state machine: open→observing 放回留观流转已删除——一律被拒（26 §9 三值闭集）", async () => {
  // 2026-10 修订（Human 决定）：「放回留观」这条流转已随观察态退出闭集而删除
  // （Human 明示「open 的都是累积到达 3 次观察到的，不存在放回去的说法」）。
  // 原用例断言「盖了 human_return_at 才放行」——现在正确判据是**反向**的：
  // 目标状态 observing 不在闭集内，机械必须拒绝，零写。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    assert.equal(r1.value.frontmatter.status, "open", "创建即 open（26 §9）");

    const returned = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: { ...r1.value.frontmatter, status: "observing" },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "放回留观（流转已删除）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!returned.ok, "open → observing 必须被拒——该流转已随观察态退出闭集而删除");
    assert.equal(returned.error.code, "friction/status_transition_invalid");
    assert.match(returned.error.message, /closed set/);

    // 零写：被拒的流转不得改动载体（状态与 change_log 均不变）
    const after = await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid });
    assert.ok(after.ok);
    assert.equal(after.value.frontmatter.status, "open");
    assert.equal(after.value.frontmatter.change_log.length, 1, "被拒的流转不得追加 change_log");
    assert.equal(after.value.fingerprint, r1.value.fingerprint, "被拒的流转必须零写");
  });
});

test("state machine: open→resolved with 1 informs relation to existing ADR succeeds (26 §9.2)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);

    const updated = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.status, "resolved");
    assert.equal(read2.value.body_valid, true);
    assert.equal(read2.value.frontmatter.relations.length, 1);
    assert.equal(read2.value.frontmatter.relations[0].relation_key, "informs");
  });
});

test("commit target: target.commit is accepted when it resolves (02 §8.1 commit 形态)", async () => {
  // commit 可直接作 target（解药本身是一次未对象化的受控提交）——这是 target 唯一
  // 允许不带 object_uid 的情形。本例钉住该形态可落盘、hash 真实存在时通过。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const realHash = "a".repeat(40);

    const ok = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{
          relation_key: "informs",
          target: { commit: realHash },
        }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账并登记 commit 证据定位",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async (h) => h === realHash,
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));

    // 回读钉住 evidence_locator 真被写入落盘对象——只断言 ok.ok 会漏掉「写入成功
    // 但字段被静默丢弃」这一形态（与 execute payload 克隆语义同类教训）。
    const readBack = await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid });
    assert.ok(readBack.ok);
    assert.equal(readBack.value.frontmatter.relations.length, 1);
    assert.equal(readBack.value.frontmatter.relations[0].target.commit, realHash);
  });
});

test("evidence_locator.commit 拒绝路径仍有覆盖：不可解析与无 resolver（02 §8.1）", async () => {
  // 上一轮迁移把 evidence_locator.commit 全换成 target.commit 后，该机制的**拒绝
  // 路径**一度零覆盖。本例补回：它仍是合法的附加定位形态（附加在 object_uid 上），
  // 同样必须在 hash 不可解析／无 resolver 时 fail-closed。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const bad = "9".repeat(40);

    const unresolvable = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{
          relation_key: "informs",
          target: { object_uid: adrUid },
          evidence_locator: { commit: bad },
        }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "evidence_locator 指向不存在的 commit",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => false,
    });
    assert.equal(unresolvable.ok, false, "an unresolvable evidence_locator.commit must be refused");
    assert.equal(unresolvable.error.code, "friction/relation_target_unresolvable");

    const noResolver = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{
          relation_key: "informs",
          target: { object_uid: adrUid },
          evidence_locator: { commit: "8".repeat(40) },
        }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "无 resolver 时登记 evidence_locator",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(noResolver.ok, false, "no resolver must fail closed, never silently accept");
    assert.equal(noResolver.error.code, "friction/relation_target_unresolvable");

    // 正向：evidence_locator.commit 真实可解析时随 object_uid target 一并放行
    const ok = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{
          relation_key: "informs",
          target: { object_uid: adrUid },
          evidence_locator: { commit: "7".repeat(40) },
        }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "evidence_locator 指向真实 commit",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));
  });
});

test("commit target: unresolvable hash, missing resolver and both-forms-carrying are ALL rejected (02 §8.1/§8.2)", async () => {
  // 四条负向：① hash 不可解析即拒（不得只记一串 hex）② 无 resolver 即拒（fail-closed）
  // ③ target 同时带 object_uid 与 commit 即拒（两种形态互斥）④ commit 形态禁带
  //    evidence_locator（两机制不混用）
  //
  // **断言错误文案而不只是 ok=false**（上一轮审核发现 A：仅断 ok 时，③被后面的
  // 「carries fields beyond commit」兜住、④根本无覆盖——把互斥分支改成 false &&
  // 测试仍全绿）。故每条都断言 issues 里出现该条规则的专属文案。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const bad = "b".repeat(40);

    const unresolvable = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{
          relation_key: "informs",
          target: { commit: bad },
        }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "尝试登记不可解析的 commit",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => false,
    });
    assert.equal(unresolvable.ok, false);
    assert.equal(unresolvable.error.code, "friction/relation_target_unresolvable");

    const noResolver = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{
          relation_key: "informs",
          target: { commit: "c".repeat(40) },
        }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "无 resolver 时尝试登记 commit",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(noResolver.ok, false, "no resolver must fail closed, never silently accept");
    assert.equal(noResolver.error.code, "friction/relation_target_unresolvable");

    const bothForms = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid, commit: "d".repeat(40) } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "把 commit 塞进 target",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.equal(bothForms.ok, false, "target 的 object_uid 与 commit 两形态互斥（02 §8.1）");
    assert.equal(bothForms.error.code, "friction/relations_invalid");
    // 断专属文案：若互斥分支被去掉，这里会落空——后面的「carries fields beyond commit」
    // 虽仍会报错，但文案不同，故本断言可判别。
    assert.ok(
      (bothForms.error.details?.issues ?? []).some((i) => i.includes("mutually exclusive")),
      `the mutual-exclusion rule must be the one that fires; got ${JSON.stringify(bothForms.error.details?.issues)}`,
    );

    // ④ commit 形态下带 evidence_locator → 拒（02 §8.1：两机制不混用）
    const mixed = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{
          relation_key: "informs",
          target: { commit: "f".repeat(40) },
          evidence_locator: { commit: "f".repeat(40) },
        }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "commit 形态混入 evidence_locator",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.equal(mixed.ok, false, "a commit-form target must not carry evidence_locator（02 §8.1）");
    assert.equal(mixed.error.code, "friction/relations_invalid");
    assert.ok(
      (mixed.error.details?.issues ?? []).some((i) => i.includes("must not carry evidence_locator")),
      `the no-mixing rule must be the one that fires; got ${JSON.stringify(mixed.error.details?.issues)}`,
    );
  });
});

test("correct: resolved 账可改正文与 relations，终态判定逐字不变（26 §13）", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const resolved = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(resolved.ok, JSON.stringify(resolved.error));

    const before = (await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid })).value;
    const fixed = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: before.fingerprint,
      // 销账时曾把 target(object_uid) 与 commit 证据定位混着写——更正为「解药就是那次受控
      // 提交」的正确形态（02 §8.1 commit 形态：target 直接取 commit，不带 object_uid）。
      relationsAfter: [{
        relation_key: "informs",
        target: { commit: "a".repeat(40) },
      }],
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "更正销账时把消费者工单当作解药对象的形态偏差",
      humanAuthorization: "Human（dsh-ldvh 会话主，2026-10-09 明示「授权你可以临时修改一下」）",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.ok(fixed.ok, JSON.stringify(fixed.error));

    const after = (await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid })).value;
    assert.equal(after.frontmatter.status, "resolved", "correct 不使终态重开");
    assert.equal(after.frontmatter.relations[0].target.commit, "a".repeat(40));
    // 终态判定与内容字段逐字不变
    for (const key of ["title", "phenomenon", "impact", "serves", "attribution", "created_at"]) {
      assert.deepEqual(after.frontmatter[key], before.frontmatter[key], `${key} must be byte-identical across a correction`);
    }
    // change_log 恰好追加一条
    assert.equal(after.frontmatter.change_log.length, before.frontmatter.change_log.length + 1);
  });
});

test("correct: open 账与缺授权的更正请求都被机械拒绝（26 §13 fail-closed）", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);

    // ① open 状态不得走 correct（否则等于把更正伪装成状态转换，02 §10.5）
    const onOpen = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "对 open 账做终态更正",
      humanAuthorization: "Human 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(onOpen.ok, false);
    assert.equal(onOpen.error.code, "friction/correction_requires_terminal");

    // ② 缺 human_authorization 即拒——更正与其它受控更新同权限
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const resolved = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(resolved.ok);

    const noAuth = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: resolved.value.fingerprint,
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "无授权记录的更正请求",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(noAuth.ok, false, "a correction without human_authorization must fail closed");
  });
});

test("correct: relationsAfter 非法输入被机械拒绝，no-op 被拒（26 §13）", async () => {
  // 审核发现⑥：原有 2 例对「不可触及字段」的断言结构上恒真（无 frontmatter 入口），
  // 未覆盖 relationsAfter 的非法输入与 no-op。本例补真判别力。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const resolved = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(resolved.ok);

    // ① resolved 后 relations 被清空 → 违反「resolved 必有 informs」
    const noInforms = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: resolved.value.fingerprint,
      relationsAfter: [],
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "把 informs 清空",
      humanAuthorization: "Human 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(noInforms.ok, false, "a resolved friction must keep at least one informs");
    assert.equal(noInforms.error.code, "friction/relations_invalid");

    // ② 非法 relation_key（非 informs）→ 闭集拒绝
    const badKey = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: resolved.value.fingerprint,
      relationsAfter: [{ relation_key: "supersedes", target: { object_uid: adrUid } }],
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "写入闭集外的 relation_key",
      humanAuthorization: "Human 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(badKey.ok, false, "relation_key closed set is {informs}");
    assert.equal(badKey.error.code, "friction/relations_invalid");

    // ③ 目标不可解析 → 拒
    const unresolvable = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: resolved.value.fingerprint,
      relationsAfter: [{ relation_key: "informs", target: { object_uid: "bbbbbbbb-bbbb-4bbb-8bbb-eeeeeeeeeeee" } }],
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "指向不存在的目标",
      humanAuthorization: "Human 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(unresolvable.ok, false);
    assert.equal(unresolvable.error.code, "friction/relation_target_unresolvable");

    // ④ 缺 change_summary → 拒
    const noSummary = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: resolved.value.fingerprint,
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "",
      humanAuthorization: "Human 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(noSummary.ok, false);

    // ⑤ CAS 失配 → 拒
    const badCas = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: "0".repeat(64),
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "陈旧指纹",
      humanAuthorization: "Human 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(badCas.ok, false);
    assert.equal(badCas.error.code, "friction/cas_conflict");

    // ⑥ no-op：正文与 relations 均未变 → 拒（02 §10.5 不记录 no-op）
    const unchanged = (await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid })).value;
    const noOp = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: unchanged.fingerprint,
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "什么都没改",
      humanAuthorization: "Human 授权",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(noOp.ok, false, "a no-op correction must be refused rather than logged as a change");
    assert.equal(noOp.error.code, "friction/no_op");

    // 断言 no-op 被拒后 change_log 未被追加（假记录不得留下）
    const afterNoOp = (await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid })).value;
    assert.equal(afterNoOp.frontmatter.change_log.length, unchanged.frontmatter.change_log.length);
  });
});

test("correct: 等价键序的 relations 重传被判 no-op（复审缺陷 A 的回归钉）", async () => {
  // 缺陷形态：no-op 曾用 JSON.stringify 全等比较 relations，对键序敏感。落盘经 YAML
  // 序列化后键序由序列化器决定，调用方以等价键序重传会被误判「有变更」→ 追加一条
  // 声称更正过的 change_log，即本动作要防的假记录。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const resolved = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{
          relation_key: "informs",
          target: { commit: "a".repeat(40) },
        }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.ok(resolved.ok, JSON.stringify(resolved.error));

    const stored = (await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid })).value;
    // 反序键序（语义完全等价）：evidence_locator / target / relation_key 换位
    const reordered = [{
      target: { commit: "a".repeat(40) },
      relation_key: "informs",
    }];
    const noOp = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: stored.fingerprint,
      relationsAfter: reordered,
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "以等价键序重传 relations",
      humanAuthorization: "Human 授权",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.equal(noOp.ok, false, "等价键序的 relations 不是变更，必须判 no-op");
    assert.equal(noOp.error.code, "friction/no_op");

    const afterNoOp = (await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid })).value;
    assert.equal(
      afterNoOp.frontmatter.change_log.length,
      stored.frontmatter.change_log.length,
      "a no-op must not append a change_log entry claiming a correction",
    );
  });
});

test("correct: 合法 relations 变更确实写入并落盘（正向路径的运行期证据）", async () => {
  // 复审指出「正确路径的 relations 写入」缺运行期证据。本例钉住：把不带 locator 的 informs
  // 更正为带 locator 的形态（真实变更），应放行、回读可见、change_log 带授权原文。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const resolved = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(resolved.ok);

    const fixed = await correctFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: resolved.value.fingerprint,
      relationsAfter: [{
        relation_key: "informs",
        target: { commit: "e4e178fd7e3293f47003ed0150ab1128cc6ae0ef" },
      }],
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "补记 commit 证据定位",
      humanAuthorization: "Human（dsh-ldvh 会话主，2026-10-09 明示「授权你可以临时修改一下」）",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.ok(fixed.ok, JSON.stringify(fixed.error));

    const after = (await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid })).value;
    assert.equal(after.frontmatter.relations[0].target.commit, "e4e178fd7e3293f47003ed0150ab1128cc6ae0ef");
    assert.ok(
      after.frontmatter.change_log.at(-1).summary.includes("经 Human 授权："),
      "the change_log entry must carry the authorization text verbatim",
    );
  });
});

test("state machine: resolved object update returns status_terminal (26 §9.2 终态不重开)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const updated1 = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated1.ok, JSON.stringify(updated1.error));

    const read2 = await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid });
    assert.equal(read2.value.frontmatter.status, "resolved");

    // Try to update a resolved object
    const updated2 = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: read2.value.fingerprint,
      frontmatterAfter: { ...read2.value.frontmatter, title: "试图重开" },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "试图修改终态对象",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!updated2.ok);
    assert.equal(updated2.error.code, "friction/status_terminal");
  });
});

test("state machine: open→resolved succeeds with informs written at that transition (26 §9.2)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);

    // First: 活账上的补充级更新（status 逐字未变——创建即 open，26 §9）
    const updated1 = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: { ...r1.value.frontmatter, status: "open" },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "补充级更新（状态未变）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated1.ok, JSON.stringify(updated1.error));

    // Then: open→resolved with informs
    const updated2 = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: updated1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "事后销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated2.ok, JSON.stringify(updated2.error));

    const read3 = await readFrictionObject({ factSourceRoot: root, objectUid: r1.value.object_uid });
    assert.ok(read3.ok);
    assert.equal(read3.value.frontmatter.status, "resolved");
    assert.equal(read3.value.frontmatter.relations.length, 1);
    assert.equal(read3.value.frontmatter.change_log.length, 3);
  });
});

test("state machine: resolving without informs → friction/relations_invalid (26 §9.2)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const result = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: { ...r1.value.frontmatter, status: "resolved" },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "试图不带 informs 销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/relations_invalid");
  });
});

test("state machine: informs target not resolvable → friction/relation_target_unresolvable (26 §11)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const result = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb" } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账指向不存在对象",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/relation_target_unresolvable");
  });
});

test("state machine: informs target pointing to spark file (wrong type) → relation_target_unresolvable (26 §11)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    // Create a spark file (not ADR/WorkCase) — informs target must resolve in adrs/ or workcases/
    await mkdir(join(root, "sparks"), { recursive: true });
    const sparkFm = {
      object_uid: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      fact_type_key: "spark",
      title: "测试火花",
      status: "open",
      question: "怎么验证？",
      scope_boundary: "范围限定。",
      intent: "测试意图。",
      summary: "测试摘要。",
      created_at: "2026-09-10T12:00:00+08:00",
      change_log: [],
    };
    await writeFile(
      join(root, "sparks", "spark-ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb.md"),
      `---\n${parseYaml(stringifyYaml(sparkFm))}\n---\n\n## 当前理解\n测试。\n\n## 调查问题\n测试。\n\n## 调查边界\n测试。`,
      "utf8"
    );
    const result = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb" } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账指向 spark 文件",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/relation_target_unresolvable");
  });
});

test("state machine: open 活账携带 relations → relations_invalid (26 §11 — 活账不得带关系)", async () => {
  // 原用例写作「observing→open with relations」；三值闭集下活账只有 open 一值，
  // 该判据的实质不变：26 §11 的 informs 只在销账流转写入，活账带关系一律被拒。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const result = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "open",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "试图在 open 时带关系",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/relations_invalid");
  });
});

test("state machine: open→observing 带关系同样被拒（26 §9 三值闭集——闭集检查先于关系检查）", async () => {
  // 原用例断言「放回留观带关系 → relations_invalid」。该流转已随观察态退出闭集
  // 而删除，故正确判据变为：目标状态 observing 不在闭集内 → 机械拒绝。
  // 实现上闭集检查发生在关系检查之前，故错误码是 status_transition_invalid。
  await withTemp("friction-writer.", async (root) => {
    const { read: r1 } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);

    const result = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: r1.value.object_uid,
      expectedFingerprint: r1.value.fingerprint,
      frontmatterAfter: {
        ...r1.value.frontmatter,
        status: "observing",
        occurrence: { ...r1.value.frontmatter.occurrence, human_return_at: "2026-11-02T00:00:00.000Z" },
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "放回留观带关系（流转已删除）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok, "open → observing（带关系）必须被拒——闭集里没有 observing");
    assert.equal(result.error.code, "friction/status_transition_invalid");
  });
});

// ---------------------------------------------------------------------------
// 补充级更新 (26 §9.3)
// ---------------------------------------------------------------------------

test("update: supplement-level — status unchanged, phenomenon unchanged, attribution backfilled succeeds (change_log adds exactly 1 entry)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { draft, created, read } = await createAndRead(root);
    const created_at = read.value.frontmatter.created_at;
    const beforeLogLength = read.value.frontmatter.change_log.length;

    const updated = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, attribution: "CI 配置问题" },
      bodyMarkdownAfter: validBodyMarkdown(draft),
      changeSummary: "归因后补",
      sessionSignature: authoritativeSignature({ provider: "p", model: "m" }),
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));

    const read2 = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.ok(read2.ok);
    assert.equal(read2.value.frontmatter.change_log.length, beforeLogLength + 1, "exactly one entry appended");
    assert.equal(read2.value.frontmatter.change_log[1].summary, "归因后补");
    assert.equal(read2.value.frontmatter.created_at, created_at, "created_at must not change");
    assert.equal(read2.value.frontmatter.status, "open", "status must stay unchanged on supplement（26 §9：初态即 open）");
    assert.equal(read2.value.frontmatter.attribution, "CI 配置问题");
    assert.equal(read2.value.frontmatter.phenomenon, draft.phenomenon, "phenomenon must stay unchanged on supplement");
    assert.equal(read2.value.body_valid, true);
    assert.notEqual(read2.value.fingerprint, read.value.fingerprint, "the append must change the fingerprint");
    assert.equal(read2.value.fingerprint, updated.value.fingerprint);
  });
});

// 26 §9.3 补充边界的真实判据。原用例名声称 "is rejected"、断言却是
// `assert.ok(result.ok)`——名实不符的常绿死断言，改前改后皆然（复核 14bb353 发现）。
// 真实边界不是「改状态被拒」：改状态本身就是**流转**，走流转守卫；而是**补充级**
// 更新（status 逐字未变）不得携带 relations（26 §11 informs 只在销账流转写入）。
// 此处按该判据重写，使用例名与断言一致且真正具备判别力。
test("update: 补充级更新不得携带 relations（26 §9.3 补充边界 / §11）", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { read } = await createAndRead(root);
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);

    // status 逐字未变 → 补充级；带 relations 必须被拒
    const result = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: read.value.object_uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "在补充级更新里塞关系",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok, "补充级更新携带 relations 必须被机械拒绝——否则 26 §11 的「informs 只在销账流转写入」形同虚设");
    assert.equal(result.error.code, "friction/relations_invalid");
  });
});

// ---------------------------------------------------------------------------
// read (26 §13 精确回读)
// ---------------------------------------------------------------------------

test("read: returned values include frontmatter, body, body_valid, fingerprint", async () => {
  await withTemp("friction-writer.", async (root) => {
    const { created, read } = await createAndRead(root);
    assert.ok(read.ok);
    assert.equal(read.value.object_uid, created.value.object_uid);
    assert.equal(read.value.file, created.value.file);
    assert.equal(read.value.body_valid, true);
    assert.equal(read.value.fingerprint, created.value.fingerprint);
    assert.ok(typeof read.value.frontmatter.status === "string");
    assert.ok(typeof read.value.body === "string" && read.value.body.length > 0);
  });
});

test("read: invalid uid shape rejected (26 §13)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result = await readFrictionObject({ factSourceRoot: root, objectUid: "not-a-uuid" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/invalid_uid");
  });
});

test("read: non-existent uid rejected with object_not_found (26 §13)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const result = await readFrictionObject({
      factSourceRoot: root,
      objectUid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "friction/object_not_found");
  });
});

// ---------------------------------------------------------------------------
// list (26 §12 召回 —— 默认 open, resolved/voided 仅 includeResolved)
// ---------------------------------------------------------------------------

test("list: empty frictions directory is a valid empty state (26 §12)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const listed = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.deepEqual(listed.value.items, []);
    assert.equal(listed.value.total, 0);
    assert.equal(listed.value.complete, true);
    assert.deepEqual(listed.value.invalid, []);
  });
});

test("list: 2 live（open）+ 1 resolved——默认召回 2 条，includeResolved 召回 3 条；投影带 uid/title/status/impact/attribution/occurrence（26 §12）", async () => {
  // 2026-10 修订：三值闭集下**活账只有 open 一值**（observing 已退出闭集，
  // 观察材料在 11 §12bis.1 的缓冲侧）。故默认召回覆盖的是 open，
  // resolved（与 voided）作为终态只在 includeResolved 时展开。
  await withTemp("friction-writer.", async (root) => {
    await writeFile(join(root, "goal.md"), GOAL_MD_FIXTURE, "utf8");
    const draftA = { ...validFrontmatterDraft(), title: "甲摩擦" };
    const a = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draftA, bodyMarkdown: validBodyMarkdown(draftA) , sessionSignature: TEST_SIGNATURE});
    assert.ok(a.ok, JSON.stringify(a.error));

    const draftB = { ...validFrontmatterDraft(), title: "乙摩擦", attribution: "外部工具" };
    const b = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draftB, bodyMarkdown: validBodyMarkdown(draftB) , sessionSignature: TEST_SIGNATURE});
    assert.ok(b.ok, JSON.stringify(b.error));

    // Create a third and resolve it (needs ADR)
    const draftC = { ...validFrontmatterDraft(), title: "丙摩擦" };
    const c = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draftC, bodyMarkdown: validBodyMarkdown(draftC) , sessionSignature: TEST_SIGNATURE});
    assert.ok(c.ok, JSON.stringify(c.error));
    const readC = await readFrictionObject({ factSourceRoot: root, objectUid: c.value.object_uid });
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, adrUid);
    const resolvedC = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: c.value.object_uid,
      expectedFingerprint: readC.value.fingerprint,
      frontmatterAfter: {
        ...readC.value.frontmatter,
        status: "resolved",
        relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
      },
      bodyMarkdownAfter: resolvedBodyMarkdown(),
      changeSummary: "销账",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(resolvedC.ok, JSON.stringify(resolvedC.error));

    // default: open = 2 (resolved excluded)
    const listed = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.total, 2); // total = filtered projection count (open), resolved excluded
    assert.equal(listed.value.items.length, 2);
    assert.equal(listed.value.complete, true);
    for (const item of listed.value.items) {
      assert.notEqual(item.status, "resolved", "resolved must not appear in default list (26 §12)");
      assert.notEqual(item.status, "voided", "voided must not appear in default list (26 §12)");
    }
    const uids = listed.value.items.map((i) => i.object_uid).sort();
    assert.deepEqual(uids, [a.value.object_uid, b.value.object_uid].sort());

    for (const item of listed.value.items) {
      assert.match(item.object_uid, UUID_PATTERN);
      assert.ok(typeof item.title === "string" && item.title.length > 0, "item must project title");
      assert.equal(typeof item.status, "string");
      assert.ok(typeof item.impact === "string" && item.impact.length > 0, "item must project impact");
    }
    const statuses = listed.value.items.map((i) => i.status).sort();
    assert.deepEqual(statuses, ["open", "open"], "默认召回只覆盖 open（26 §12：三值闭集下活账仅 open 一值）");
    const withOcc = listed.value.items.find((i) => i.object_uid === a.value.object_uid);
    assert.equal(withOcc.occurrence?.count, 1, "26 §8：occurrence 进F1 投影");
    assert.equal(withOcc.serves, undefined, "serves 已退出闭集，投影中不得出现");
    const withAttr = listed.value.items.find((i) => i.object_uid === b.value.object_uid);
    assert.equal(withAttr.attribution, "外部工具");

    // includeResolved: all 3
    const all = await listFrictionObjects({ factSourceRoot: root, includeResolved: true });
    assert.ok(all.ok);
    assert.equal(all.value.items.length, 3);
    const allUids = all.value.items.map((i) => i.object_uid).sort();
    assert.deepEqual(allUids, [a.value.object_uid, b.value.object_uid, c.value.object_uid].sort());
    const resolvedItem = all.value.items.find((i) => i.object_uid === c.value.object_uid);
    assert.equal(resolvedItem.status, "resolved");
  });
});

test("list: limit truncation reports total and complete:false (03 §8.1)", async () => {
  await withTemp("friction-writer.", async (root) => {
    for (const title of ["摩擦甲", "摩擦乙", "摩擦丙"]) {
      const draft = { ...validFrontmatterDraft(), title };
      const result = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
      assert.ok(result.ok, JSON.stringify(result.error));
    }
    const listed = await listFrictionObjects({ factSourceRoot: root, limit: 2 });
    assert.ok(listed.ok);
    assert.equal(listed.value.items.length, 2, "limit must truncate the projection");
    assert.equal(listed.value.total, 3, "the true total must be reported");
    assert.equal(listed.value.complete, false, "a truncated page must declare incompleteness");
  });
});

test("list: bad carrier (valid uid filename without frontmatter) lands in invalid, never silently skipped", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), title: "合法载体" };
    const created = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok, JSON.stringify(created.error));

    const badUid = "123e4567-e89b-42d3-a456-426614174000";
    await mkdir(join(root, FRICTION_DIRECTORY), { recursive: true });
    await writeFile(join(root, FRICTION_DIRECTORY, `friction-${badUid}.md`), "# 这不是一个载体\n", "utf8");

    const listed = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.total, 1, "invalid carrier is not counted as an object");
    assert.equal(listed.value.items[0].object_uid, created.value.object_uid);
    assert.equal(listed.value.invalid.length, 1);
    assert.equal(listed.value.invalid[0].file, `friction-${badUid}.md`);
    assert.ok(listed.value.invalid[0].reason.includes("no YAML frontmatter block"), JSON.stringify(listed.value.invalid));
  });
});

test("list: bad carrier with invalid status lands in invalid (26 §12)", async () => {
  await withTemp("friction-writer.", async (root) => {
    const draft = { ...validFrontmatterDraft(), title: "合法载体" };
    const created = await createFrictionObject({ factSourceRoot: root, frontmatterDraft: draft, bodyMarkdown: validBodyMarkdown(draft) , sessionSignature: TEST_SIGNATURE});
    assert.ok(created.ok, JSON.stringify(created.error));

    // Write a file with an invalid status
    const fmBad = {
      object_uid: "123e4567-e89b-42d3-a456-426614174000",
      fact_type_key: "friction",
      title: "坏状态",
      status: "nonexistent",
      phenomenon: "现象。",
      impact: "light",
      created_at: "2026-09-10T12:00:00+08:00",
      change_log: [],
    };
    await mkdir(join(root, FRICTION_DIRECTORY), { recursive: true });
    await writeFile(join(root, FRICTION_DIRECTORY, "friction-123e4567-e89b-42d3-a456-426614174000.md"),
      `---\n${parseYaml(stringifyYaml(fmBad))}\n---\n\n## 现象\n现象。\n\n## 入账依据\n依据。`,
      "utf8"
    );
    const listed = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(listed.ok);
    assert.equal(listed.value.items.length, 1);
    assert.equal(listed.value.invalid.length, 1);
    assert.equal(listed.value.invalid[0].reason.includes("outside the closed set"), true);
  });
});

// ---------------------------------------------------------------------------
// 26 §8/§11 锚点型（2026-10 订正）：attribution_ref 的规范形态是对象
// { object_uid }，裸 string 仅存量兼容。
// ---------------------------------------------------------------------------

/** Build a complete (Code-assigned) Friction frontmatter for field-level validation tests. */
function validStoredFrontmatter(overrides = {}) {
  return {
    object_uid: "33333333-3333-4333-8333-333333333333",
    fact_type_key: "friction",
    title: "CI 构建缓慢",
    status: "open",
    phenomenon: "CI 每次构建平均需要 8 分钟，其中 5 分钟花在重复依赖安装上。",
    impact: "heavy",
    created_at: "2026-09-10T12:00:00+08:00",
    occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
    change_log: [{ at: "2026-09-10T12:00:00+08:00", summary: "受控创建" }],
    ...overrides,
  };
}

test("attribution_ref 形态：对象形态与裸 string 均接受，坏形态被拒（26 §8/§11 锚点型）", () => {
  const anchorUid = "8d5437b7-91c4-4cbe-af27-1d6f305297af";

  // 对象形态（规范）
  const objectForm = validateFrictionFrontmatter(validStoredFrontmatter({ attribution_ref: { object_uid: anchorUid } }));
  assert.deepEqual(objectForm.issues, [], "object form is the canonical carrier shape");

  // 裸 string（存量兼容）
  const bareString = validateFrictionFrontmatter(validStoredFrontmatter({ attribution_ref: anchorUid }));
  assert.deepEqual(bareString.issues, [], "bare uuid string stays accepted for legacy carriers");

  // 裸 string 但不是合法 uuid
  const badString = validateFrictionFrontmatter(validStoredFrontmatter({ attribution_ref: "not-a-uuid" }));
  assert.equal(badString.issues.length, 1);
  assert.match(badString.issues[0], /bare string must be a valid object_uid uuid/);

  // 对象形态但 object_uid 非法
  const badObject = validateFrictionFrontmatter(validStoredFrontmatter({ attribution_ref: { object_uid: "nope" } }));
  assert.equal(badObject.issues.length, 1);
  assert.match(badObject.issues[0], /must be \{ object_uid \} with a valid uuid/);

  // 错误类型
  const badType = validateFrictionFrontmatter(validStoredFrontmatter({ attribution_ref: 42 }));
  assert.equal(badType.issues.length, 1);
  assert.match(badType.issues[0], /must be \{ object_uid \} object form/);

  // 未出现 = 合法（26 §8：条件出现）
  assert.deepEqual(validateFrictionFrontmatter(validStoredFrontmatter()).issues, []);
});

test("attribution_ref 可解析性：指向已存在对象→入账；指向空气→零写拒绝（26 §8/§11）", async () => {
  await withTemp("friction-attribution.", async (root) => {
    const anchorUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(root, anchorUid);

    // 可解析：对象形态
    const okObject = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: validFrontmatterDraft({ title: "对象形态归因", attribution_ref: { object_uid: anchorUid } }),
      bodyMarkdown: validBodyMarkdown(validFrontmatterDraft({ title: "对象形态归因", attribution_ref: { object_uid: anchorUid } })),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(okObject.ok, JSON.stringify(okObject.error));
    const readBack = await readFrictionObject({ factSourceRoot: root, objectUid: okObject.value.object_uid });
    assert.ok(readBack.ok);
    assert.deepEqual(readBack.value.frontmatter.attribution_ref, { object_uid: anchorUid },
      "read projects attribution_ref in the canonical object shape");

    // 可解析：裸 string 存量形态
    const okBare = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: validFrontmatterDraft({ title: "裸串归因", attribution_ref: anchorUid }),
      bodyMarkdown: validBodyMarkdown(validFrontmatterDraft({ title: "裸串归因", attribution_ref: anchorUid })),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(okBare.ok, JSON.stringify(okBare.error));

    // 不可解析：指向不存在的 uid → 拒绝且零写
    const ghostUid = "00000000-0000-4000-8000-000000000000";
    const ghostDraft = validFrontmatterDraft({ title: "悬空归因", attribution_ref: { object_uid: ghostUid } });
    const rejected = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: ghostDraft,
      bodyMarkdown: validBodyMarkdown(ghostDraft),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(rejected.ok, false, "an unresolvable anchor must not be admitted");
    assert.equal(rejected.error.code, "friction/attribution_ref_unresolvable");
    assert.match(rejected.error.message, /does not resolve to any same-project fact object/);

    const listed = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(listed.ok);
    assert.equal(listed.value.total, 2, "the rejected carrier left no file behind (zero-write)");
    assert.equal(listed.value.items.some((item) => item.title === "悬空归因"), false);
  });
});

test("attribution_ref 可解析性：update 与 correct 同样核验（补充级更新不留后门，26 §8/§11）", async () => {
  await withTemp("friction-attribution-u.", async (root) => {
    const anchorUid = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    await createAdrFixture(root, anchorUid);

    const created = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: validFrontmatterDraft(),
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const objectUid = created.value.object_uid;
    const read = await readFrictionObject({ factSourceRoot: root, objectUid });
    assert.ok(read.ok);

    // update：后补一个可解析的归因锚点 → 通过
    const updatedOk = await updateFrictionObject({
      factSourceRoot: root,
      objectUid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { attribution_ref: { object_uid: anchorUid } },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "补充归因锚点",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updatedOk.ok, JSON.stringify(updatedOk.error));

    const reread = await readFrictionObject({ factSourceRoot: root, objectUid });
    assert.ok(reread.ok);
    assert.deepEqual(reread.value.frontmatter.attribution_ref, { object_uid: anchorUid });

    // update：改成悬空锚点 → 拒绝且零写
    const ghostUid = "11111111-1111-4111-8111-111111111111";
    const updatedBad = await updateFrictionObject({
      factSourceRoot: root,
      objectUid,
      expectedFingerprint: reread.value.fingerprint,
      frontmatterAfter: { attribution_ref: { object_uid: ghostUid } },
      bodyMarkdownAfter: validBodyMarkdown(),
      changeSummary: "改成悬空锚点",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(updatedBad.ok, false);
    assert.equal(updatedBad.error.code, "friction/attribution_ref_unresolvable");

    const afterReject = await readFrictionObject({ factSourceRoot: root, objectUid });
    assert.ok(afterReject.ok);
    assert.deepEqual(afterReject.value.frontmatter.attribution_ref, { object_uid: anchorUid },
      "rejected update left the carrier byte-identical in substance");

    // correct（终态）：attr 继承落盘值可解析则放行；改为悬空则拒绝。
    // 终态记录需先 resolve 才有处置段，这里直接用 resolved 路径造一条。
    await withTemp("friction-attribution-c.", async (root2) => {
      await createAdrFixture(root2, anchorUid);
      const draft = validFrontmatterDraft({ attribution_ref: { object_uid: anchorUid } });
      const c = await createFrictionObject({
        factSourceRoot: root2,
        frontmatterDraft: draft,
        bodyMarkdown: validBodyMarkdown(draft),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(c.ok, JSON.stringify(c.error));
      const r = await readFrictionObject({ factSourceRoot: root2, objectUid: c.value.object_uid });
      assert.ok(r.ok);
      // 让记录进入终态：open → voided（无需 informs）
      const voided = await updateFrictionObject({
        factSourceRoot: root2,
        objectUid: c.value.object_uid,
        expectedFingerprint: r.value.fingerprint,
        frontmatterAfter: { status: "voided", disposition: "误记：现象由外部服务维护窗口造成，与本项目无关。" },
        bodyMarkdownAfter: validBodyMarkdown(draft, { disposition: "误记：现象由外部服务维护窗口造成，与本项目无关。" }),
        changeSummary: "作废",
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(voided.ok, JSON.stringify(voided.error));
      const r2 = await readFrictionObject({ factSourceRoot: root2, objectUid: c.value.object_uid });
      assert.ok(r2.ok);

      const correctedOk = await correctFrictionObject({
        factSourceRoot: root2,
        objectUid: c.value.object_uid,
        expectedFingerprint: r2.value.fingerprint,
        bodyMarkdownAfter: validBodyMarkdown(draft, { disposition: "误记：现象由外部服务维护窗口造成，与本项目无关。" }) + "\n\n更正补充说明。",
        humanAuthorization: "Human 于 2026-10 授权更正（测试）",
        changeSummary: "终态正文更正",
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(correctedOk.ok, JSON.stringify(correctedOk.error));

      // 26 §13：correct 不接收 frontmatter 值（只收 relations/正文/字段有无），
      // 悬空锚点只能来自落盘的继承值——下面直接篡改载体验证继承值同样过核验闸。
      // 篡改落盘载体：把 attribution_ref 改成指向空气的 uid（模拟非法写入/迁移残留）。
      // correct 继承落盘 frontmatter，必须在写盘前被可解析性核验拦下——即便正文有变更。
      const carrierPath = join(root2, FRICTION_DIRECTORY, frictionFileName(c.value.object_uid));
      const rawCarrier = await readFile(carrierPath, "utf8");
      const tampered = rawCarrier.replace(anchorUid, "22222222-2222-4222-8222-222222222222");
      assert.notEqual(tampered, rawCarrier, "tampering actually rewrote the anchor uid");
      await writeFile(carrierPath, tampered, "utf8");
      const r3 = await readFrictionObject({ factSourceRoot: root2, objectUid: c.value.object_uid });
      assert.ok(r3.ok);

      const correctedBad = await correctFrictionObject({
        factSourceRoot: root2,
        objectUid: c.value.object_uid,
        expectedFingerprint: r3.value.fingerprint,
        bodyMarkdownAfter: validBodyMarkdown(draft, { disposition: "误记：现象由外部服务维护窗口造成，与本项目无关。" }) + "\n\n第二次更正说明。",
        humanAuthorization: "Human 于 2026-10 授权更正（测试）",
        changeSummary: "正文更正（落盘锚点已悬空）",
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(correctedBad.ok, false, "correct must not admit a carrier whose inherited anchor is dangling");
      assert.equal(correctedBad.error.code, "friction/attribution_ref_unresolvable");
    });
  });
});

test("attribution_ref 可解析性只认顶层 object_uid 声明行（缩进 uid 不得被当成可解析，26 §8/§11）", async () => {
  // 2026-10 复核发现 6 的 fail-open 方向：判定「目标可解析」时若允许行首空白，
  // 那么 relations 成员或正文里的**缩进** uid 行就会被当成某载体声明的身份。
  // 于是「引用一个只作为关系目标出现在别人文件里的 uid」也会被判可解析——
  // 等于绕开「同项目某已存在事实对象」这条要求。这里钉住行首锚定。
  await withTemp("friction-attribution-ind.", async (root) => {
    const ghostUid = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
    const hostUid = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
    // 抓取面存在的「宿主」载体：它自己的 object_uid 是 hostUid，ghostUid 只以
    // 缩进的关系目标形态出现——不是顶层声明。
    await mkdir(join(root, FRICTION_DIRECTORY), { recursive: true });
    await writeFile(
      join(root, FRICTION_DIRECTORY, `friction-${hostUid}.md`),
      `---\nobject_uid: ${hostUid}\nfact_type_key: friction\ntitle: host carrier\nstatus: open\n` +
        `created_at: "2026-01-01T00:00:00.000Z"\nimpact: light\nphenomenon: "host"\n` +
        `relations:\n  - relation_key: informs\n    target:\n      object_uid: ${ghostUid}\n` +
        `occurrence:\n  count: 1\n  first_at: "2026-01-01T00:00:00.000Z"\n  last_at: "2026-01-01T00:00:00.000Z"\n` +
        `change_log: []\n---\n\n## 现象\n\nfixture\n`,
      "utf8",
    );

    const result = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: validFrontmatterDraft({ attribution_ref: { object_uid: ghostUid } }),
      bodyMarkdown: validBodyMarkdown(),
      sessionSignature: TEST_SIGNATURE,
      changeSummary: "pin: indented uid is not a carrier declaration",
    });
    assert.equal(result.ok, false, "a uid that only appears as an indented relation target must not resolve");
    assert.equal(result.error.code, "friction/attribution_ref_unresolvable");
  });
});
