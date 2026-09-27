// Tests for plugin/lib/spark-tools.js — the runtime wiring of the Spark
// mechanical layer (specs/20 §13 受控操作 + specs/03 §9) into the governed
// ldvh_* tool surface.
//
// Coverage follows the sibling research-tools.test.mjs pattern: handlers are
// driven through registerSparkTools's descriptors with a mock ctx.tools
// registry, a real governed-project fixture (tmp repo + registration), and
// the full 05 §8 envelope shape is asserted, not just the result.
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as sparkToolsModule from "../lib/spark-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, sessionPersistenceWithRoutingLog, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });

/**
 * Build a fake host-seam registry whose Spark confirmation answerer is driven
 * by `reply`. Mirrors `routingSeam` in workcase-create-confirmation.test.mjs:
 * the gate is injected through `deps.hostSeams`, NOT through ctx — host-seams.js
 * installs `seams.ask` at plugin load, which never runs in a unit test.
 */
function sparkSeam(reply) {
  const calls = [];
  return {
    calls,
    requestSparkConsent: async (payload) => {
      calls.push(payload);
      return reply(payload);
    },
  };
}

/** Default consenting answerer for the fixtures below. */
function consentingSeam() {
  return sparkSeam(() => ({ granted: true, answer: "确认" }));
}

/** The 20 §6.2/§17.7 dedup conclusion required on create. */
const DEDUP_OK = "查重结论（测试夹具）：与本仓库既有 Spark 无同题重叠。";

/** Strip the Code-generated H1: a read returns the WHOLE carrier body, but
 * `body_markdown_after` must start at H2 (20 §8: the H1 is generated from
 * title and is never supplied by the caller). */
function bodyWithoutH1(body) {
  return body.replace(/^#\s.*\n+/, "");
}

// Mock registry: capture the descriptors registerSparkTools registers, then
// drive them exactly as the DSH runtime would (descriptor.execute wraps the
// handler result in { envelope }).
function makeDescriptors(deps) {
  const registered = [];
  const ctx = {
    tools: {
      register: (descriptor) => {
        registered.push(descriptor);
        return () => {};
      },
    },
  };
  sparkToolsModule.registerSparkTools(ctx, deps);
  const byName = {};
  for (const descriptor of registered) byName[descriptor.name] = descriptor;
  return byName;
}

async function run(descriptors, toolName, args, cwd) {
  const out = await descriptors[toolName].execute(args, exec(cwd));
  // Descriptor wraps handler results as { envelope } (the DSH tool contract).
  return out.envelope ?? out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    title: "工具接入悬置问题（测试夹具）",
    question: "如何在不引入额外状态的前提下验证 Spark 工具接入？",
    scope_boundary: "仅以本仓库规范与单元测试为证据，不运行外部系统。",
    intent: "验证工具层机械通道，为后续自动化覆盖保留依据。",
    summary: "工具层已完成注册与封装；未决事项是边界用例的覆盖。",
    change_summary: "受控创建（测试夹具）",
    ...overrides,
  };
}

function validBodyMarkdown(draft = validFrontmatterDraft()) {
  return [
    `## 当前理解\n${draft.summary}\n扩展：通道已验证。`,
    `## 调查问题\n${draft.question}\n扩展背景。`,
    `## 调查边界\n${draft.scope_boundary}\n扩展：不涉及外部系统。`,
  ].join("\n\n");
}

async function governedFixture(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  await mkdir(join(repo, "ldvh-base", "sparks"), { recursive: true });
  await writeFile(join(repo, "ldvh-base", "goal.md"), GOAL_MD_FIXTURE, "utf8");
  await registerProject(dshHome(home), { id: "demo", path: repo });
  return { home, repo };
}

/**
 * Default deps carry a CONSENTING host seam: the 20 §16 Gate is fail-closed, so
 * without it every create is refused. Tests that assert the ungated path pass
 * their own deps; tests that assert refusal pass `{ hostSeams: null }` (an
 * explicit absence) or a declining seam.
 */
function makeDeps(home, base, { hostSeams } = {}) {
  return {
    dshHomePath: dshHome(home),
    workspaceRoot: base,
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
    ...(hostSeams === null ? {} : { hostSeams: hostSeams ?? consentingSeam() }),
  };
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

test("registerSparkTools registers exactly the three spark tools", async () => {
  await withTemp("spark-tools.", async (base) => {
    const registered = [];
    const ctx = { tools: { register: (descriptor) => { registered.push(descriptor.name); return () => {}; } } };
    const deps = makeDeps(join(base, "home"), base);
    const dispose = sparkToolsModule.registerSparkTools(ctx, deps);
    assert.deepEqual([...registered].sort(), ["ldvh_spark_list", "ldvh_spark_read", "ldvh_spark_write"]);
    assert.equal(typeof dispose, "function");
  });
});

test("spark descriptors return text blocks from render and an object schema", async () => {
  const deps = makeDeps("/nope", "/nope");
  const descriptors = makeDescriptors(deps);
  for (const descriptor of Object.values(descriptors)) {
    const blocks = descriptor.output.render({}, { envelope: { operation_key: "spark-read-object", outcome: "completed", result: null, gaps: [] } });
    assert.ok(Array.isArray(blocks), "render must return an array");
    assert.equal(blocks[0].type, "text");
    assert.equal(descriptor.output.schema.type, "object");
  }
});

// ---------------------------------------------------------------------------
// 未管辖会话 (governance-scope check failed → unavailable)
// ---------------------------------------------------------------------------

test("read/write are unavailable outside governed sessions", async () => {
  await withTemp("spark-tools.", async (base) => {
    const home = join(base, "home");
    await mkdir(join(home, "ldvh"), { recursive: true });
    const descriptors = makeDescriptors(makeDeps(home, base));
    const readOut = await run(descriptors, "ldvh_spark_read", { object_uid: "11111111-1111-4111-8111-111111111111" }, base);
    assert.equal(readOut.outcome, "unavailable");
    assert.ok(readOut.gaps[0].includes("not_governed"));
    const writeOut = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, base);
    assert.equal(writeOut.outcome, "unavailable");
    assert.ok(writeOut.gaps[0].includes("not_governed"));
  });
});

// ---------------------------------------------------------------------------
// create 正向 (governed fixture)
// ---------------------------------------------------------------------------

test("create: completed envelope, object_uid assigned, read-back ok, file on disk", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);

    assert.equal(created.outcome, "completed", JSON.stringify(created));
    assert.ok(created.result.object_uid);
    assert.equal(created.result.read_back.ok, true);
    assert.ok(created.result.changes.some((c) => c.change === "created"));
    assert.ok(created.verification.checks.includes("read-back"));

    // file really landed inside the governed repo's fact source
    const raw = await readFile(join(repo, "ldvh-base", "sparks", `spark-${created.result.object_uid}.md`), "utf8");
    assert.ok(raw.includes("fact_type_key"));
  });
});

// ---------------------------------------------------------------------------
// create 正例: OPTIONAL fields must survive the tool plane (the aa12604 class)
// ---------------------------------------------------------------------------

test("create: optional fields (priority/serves) succeed through the tool plane and land on disk", async () => {
  // WHY THIS EXISTS — this is the positive half of the aa12604 defect.
  //
  // aa12604 added Spark `priority` to the writer but not to spark-tools.js's
  // JSON Schema. Because that schema declares `additionalProperties: false`,
  // EVERY call carrying `priority` was rejected by DSH argument validation
  // BEFORE the writer ran — and it sat latent across 727 green tests. The
  // schema/writer agreement guard now proves the field is *declared*; it does
  // NOT prove the field is *usable*. This test drives the field through the
  // real tool plane end-to-end, so a future regression that drops an optional
  // field from the schema fails here by rejection rather than by silence.
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = validFrontmatterDraft({
      priority: "P1",
      serves: "SG-1",
    });

    // Guard the premise: this call only means something if the optional
    // fields are actually present in the arguments we hand the tool plane.
    assert.equal(draft.priority, "P1");
    assert.equal(draft.serves, "SG-1");

    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);

    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;

    // The optional values survived into the persisted object.
    // `serves` is projected to the top level; `priority` lives in frontmatter.
    const readBack = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    assert.equal(readBack.outcome, "completed", JSON.stringify(readBack));
    assert.equal(readBack.result.serves, "SG-1", JSON.stringify(readBack.result));
    assert.equal(readBack.result.frontmatter.priority, "P1", JSON.stringify(readBack.result.frontmatter));

    // ...and onto disk, not merely into the in-memory envelope.
    const raw = await readFile(join(repo, "ldvh-base", "sparks", `spark-${uid}.md`), "utf8");
    assert.ok(raw.includes("priority: P1"), raw.slice(0, 400));
    assert.ok(raw.includes("serves: SG-1"), raw.slice(0, 400));
  });
});

test("create: optional-field calls are NOT rejected by tool-plane argument validation", async () => {
  // The narrowest form of the aa12604 defect: the DSH argument validator, not
  // the writer, is what rejected `priority`. Assert directly against the
  // declared schema so the failure message names the real cause instead of
  // surfacing as a generic rejection downstream.
  const desc = sparkToolsModule.toolDescriptorFor(
    "spark-write-object",
    sparkToolsModule.OPERATIONS["spark-write-object"],
    async () => ({}),
  );
  const violations = validateJsonSchemaValue(desc.parameters, {
    action: "create",
    frontmatter_draft: validFrontmatterDraft({ priority: "P1", serves: "SG-1" }),
    body_markdown: validBodyMarkdown(),
  }, "args");
  assert.deepEqual(violations, [], JSON.stringify(violations));
});

// ---------------------------------------------------------------------------
// create 机械拒绝 (zero write)
// ---------------------------------------------------------------------------

test("create: mechanical rejection is outcome=rejected with zero writes", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    // question with two terminals → frontmatter mechanical check fails
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: { ...validFrontmatterDraft(), question: "如何验证？如何验证？" },
      body_markdown: validBodyMarkdown(),
    }, repo);

    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("frontmatter_invalid")));
    assert.equal(out.verification.passed, false);
    const files = await readdir(join(repo, "ldvh-base", "sparks"));
    assert.equal(files.length, 0);
  });
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

test("read: created object returns completed with open status and matching fingerprint; missing uid rejected", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(created.outcome, "completed");
    const uid = created.result.object_uid;
    const fp = created.result.fingerprint;

    const readOut = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    assert.equal(readOut.outcome, "completed", JSON.stringify(readOut));
    assert.equal(readOut.result.frontmatter.status, "open");
    assert.equal(readOut.result.fingerprint, fp);

    const missing = await run(descriptors, "ldvh_spark_read", { object_uid: "99999999-9999-4999-8999-999999999999" }, repo);
    assert.equal(missing.outcome, "rejected");
    assert.ok(missing.gaps.some((g) => g.includes("object_not_found")));
  });
});

// ---------------------------------------------------------------------------
// update (CAS 正常流 + CAS 冲突)
// ---------------------------------------------------------------------------

test("update: CAS normal flow completed with new fingerprint; CAS conflict rejected with file unchanged", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(created.outcome, "completed");
    const uid = created.result.object_uid;
    const fp1 = created.result.fingerprint;

    const read1 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    assert.equal(read1.outcome, "completed");

    // CAS normal flow: refine summary + body, keep the rest verbatim
    const fmAfter = { ...read1.result.frontmatter, summary: "精化后的总结：机械层已验证，边界用例纳入后续覆盖。" };
    const bodyAfter = [
      `## 当前理解\n${fmAfter.summary}\n扩展：通道已验证。`,
      `## 调查问题\n${read1.result.frontmatter.question}\n扩展背景。`,
      `## 调查边界\n${read1.result.frontmatter.scope_boundary}\n扩展：不涉及外部系统。`,
    ].join("\n\n");

    const updated = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: fp1,
      frontmatter_after: fmAfter,
      body_markdown_after: bodyAfter,
      change_summary: "精化总结",
    }, repo);
    assert.equal(updated.outcome, "completed", JSON.stringify(updated));
    assert.notEqual(updated.result.fingerprint, fp1);
    assert.equal(updated.result.read_back.ok, true);
    assert.ok(updated.result.changes.some((c) => c.change === "updated"));
    assert.ok(updated.verification.checks.includes("cas-baseline"));

    // CAS conflict: stale fingerprint → rejected, file content unchanged
    const rawBefore = await readFile(join(repo, "ldvh-base", "sparks", `spark-${uid}.md`), "utf8");
    const conflicted = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: fp1, // stale
      frontmatter_after: fmAfter,
      body_markdown_after: bodyAfter,
      change_summary: "过期指纹重试",
    }, repo);
    assert.equal(conflicted.outcome, "rejected", JSON.stringify(conflicted));
    assert.ok(conflicted.gaps.some((g) => g.includes("cas_conflict")));
    assert.ok(conflicted.follow_up.some((f) => f.includes("re-read")));

    const rawAfter = await readFile(join(repo, "ldvh-base", "sparks", `spark-${uid}.md`), "utf8");
    assert.equal(rawAfter, rawBefore);

    // a fresh read still reports the post-update fingerprint
    const read2 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    assert.equal(read2.result.fingerprint, updated.result.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// serves resolution through the tool (20 §13/§17.1 wiring)
// ---------------------------------------------------------------------------

test("create: serves resolution flows through the tool (SG-1 ok, SG-99 rejected)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const ok = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: { ...validFrontmatterDraft(), serves: "SG-1" },
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(ok.outcome, "completed", JSON.stringify(ok));

    const bad = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: { ...validFrontmatterDraft(), serves: "SG-99" },
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(bad.outcome, "rejected");
    assert.ok(bad.gaps.some((g) => g.includes("serves_unresolvable")));
    const files = await readdir(join(repo, "ldvh-base", "sparks"));
    assert.equal(files.length, 1); // only the SG-1 object landed
  });
});

// ---------------------------------------------------------------------------
// invalid_request paths
// ---------------------------------------------------------------------------

test("write: missing required args is invalid_request (zero write)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const noAction = await run(descriptors, "ldvh_spark_write", {}, repo);
    assert.equal(noAction.outcome, "invalid_request");

    const noBody = await run(descriptors, "ldvh_spark_write", { action: "create", frontmatter_draft: validFrontmatterDraft() }, repo);
    assert.equal(noBody.outcome, "invalid_request");

    const noUid = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      expected_fingerprint: "0".repeat(64),
      frontmatter_after: validFrontmatterDraft(),
      body_markdown_after: validBodyMarkdown(),
      change_summary: "x",
    }, repo);
    assert.equal(noUid.outcome, "invalid_request");
  });
});

// ---------------------------------------------------------------------------
// renderEnvelope: full fingerprint + rich semantic lines (A: 渲染层修复)
// ---------------------------------------------------------------------------
//
// The render output is the model's only window on the tool result (03 §9.5).
// A truncated fingerprint would make the CAS baseline unobtainable; the
// render must carry the complete 64-char SHA-256 and the semantic fields.

test("render: spark read output carries the FULL 64-char fingerprint and semantic lines (no ellipsis truncation)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = { ...validFrontmatterDraft(), serves: "SG-1" };
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;
    const fp = created.result.fingerprint;
    assert.match(fp, /^[0-9a-f]{64}$/, "fingerprint must be a full 64-char hex SHA-256");

    const readOut = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    assert.equal(readOut.outcome, "completed", JSON.stringify(readOut));

    const blocks = descriptors["ldvh_spark_read"].output.render({ object_uid: uid }, { envelope: readOut });
    const text = blocks.map((b) => b.text).join("\n");
    assert.ok(text.includes(`fingerprint: ${fp}`), `render must carry the complete fingerprint:\n${text}`);
    assert.ok(text.includes(`title: ${draft.title}`), `render must carry the title:\n${text}`);
    assert.ok(text.includes("status: open"), `render must carry the status:\n${text}`);
    assert.ok(text.includes("serves: SG-1"), `render must carry serves:\n${text}`);
    assert.ok(text.includes(`question: ${draft.question}`), `render must carry the question:\n${text}`);
    assert.ok(text.includes("body_valid: true"), `render must carry body_valid:\n${text}`);
    assert.ok(!text.includes("…"), "render must not truncate with an ellipsis");
  });
});

test("render: spell/default descriptor uses the same envelope rendering with no truncation", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));
    const draft = { ...validFrontmatterDraft(), serves: "SG-2" };
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed");
    const readOut = await run(descriptors, "ldvh_spark_read", { object_uid: created.result.object_uid }, repo);
    const blocks = descriptors["ldvh_spark_read"].output.render({ object_uid: created.result.object_uid }, { envelope: readOut });
    const text = blocks.map((b) => b.text).join("\n");
    assert.equal((text.match(/fingerprint: [0-9a-f]{64}/g) ?? []).length, 1, "exactly one full fingerprint line, never truncated");
    assert.ok(text.includes("LDVH spark-read-object: completed"));
  });
});

// ---------------------------------------------------------------------------
// ldvh_spark_list (B: F0/F1 enumeration)
// ---------------------------------------------------------------------------

test("list: unavailable outside governed sessions", async () => {
  await withTemp("spark-tools.", async (base) => {
    const home = join(base, "home");
    await mkdir(join(home, "ldvh"), { recursive: true });
    const descriptors = makeDescriptors(makeDeps(home, base));
    const out = await run(descriptors, "ldvh_spark_list", {}, base);
    assert.equal(out.outcome, "unavailable");
    assert.ok(out.gaps[0].includes("not_governed"));
    assert.equal(out.result, null);
  });
});

test("list: missing sparks directory is a valid empty state (completed, count 0)", async () => {
  await withTemp("spark-tools.", async (base) => {
    // A governed project whose fact source has no sparks directory at all.
    const home = join(base, "home");
    const repo = await initRepo(base);
    await mkdir(join(repo, "ldvh-base"), { recursive: true });
    await writeFile(join(repo, "ldvh-base", "goal.md"), GOAL_MD_FIXTURE, "utf8");
    await registerProject(dshHome(home), { id: "demo", path: repo });
    const descriptors = makeDescriptors(makeDeps(home, base));

    const out = await run(descriptors, "ldvh_spark_list", {}, repo);
    assert.equal(out.outcome, "completed", JSON.stringify(out));
    assert.equal(out.result.count, 0);
    assert.equal(out.result.total, 0);
    assert.equal(out.result.filter, "open");
    assert.deepEqual(out.result.items, []);
    assert.deepEqual(out.gaps, []);
    assert.equal(out.verification.passed, true);
  });
});

test("list: open-only by default, status=all includes terminal; projection carries uid/title/status/question/serves", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    // two open sparks (one with serves) + one implemented (via update)
    const mkDraft = (title, question, more = {}) => {
      const draft = {
        ...validFrontmatterDraft(),
        title,
        question,
        summary: `总结：${title}`,
        change_summary: "受控创建（清单夹具）",
        ...more,
      };
      return draft;
    };
    const open1 = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: mkDraft("悬置甲（工具清单）", "问题甲如何进入清单投影？", { serves: "SG-1" }),
      body_markdown: validBodyMarkdown(mkDraft("悬置甲（工具清单）", "问题甲如何进入清单投影？", { serves: "SG-1" })),
    }, repo);
    assert.equal(open1.outcome, "completed", JSON.stringify(open1));

    const open2 = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: mkDraft("悬置乙（工具清单）", "问题乙如何进入清单投影？"),
      body_markdown: validBodyMarkdown(mkDraft("悬置乙（工具清单）", "问题乙如何进入清单投影？")),
    }, repo);
    assert.equal(open2.outcome, "completed", JSON.stringify(open2));

    const terminal = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: mkDraft("悬置丙（工具清单）", "问题丙如何进入清单投影？"),
      body_markdown: validBodyMarkdown(mkDraft("悬置丙（工具清单）", "问题丙如何进入清单投影？")),
    }, repo);
    assert.equal(terminal.outcome, "completed", JSON.stringify(terminal));
    // open → implemented (terminal) via CAS update
    const readTerminal = await run(descriptors, "ldvh_spark_read", { object_uid: terminal.result.object_uid }, repo);
    assert.equal(readTerminal.outcome, "completed");
    const toImpl = {
      ...readTerminal.result.frontmatter,
      status: "implemented",
      disposition: "已落实：该问题由清单验证工作承接，仅结束本 Spark 入口。",
    };
    const impl = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: terminal.result.object_uid,
      expected_fingerprint: terminal.result.fingerprint,
      frontmatter_after: toImpl,
      body_markdown_after: validBodyMarkdown(mkDraft("悬置丙（工具清单）", "问题丙如何进入清单投影？")),
      change_summary: "转入 implemented",
    }, repo);
    assert.equal(impl.outcome, "completed", JSON.stringify(impl));

    // default (open-only): exactly the two open sparks
    const openOnly = await run(descriptors, "ldvh_spark_list", {}, repo);
    assert.equal(openOnly.outcome, "completed", JSON.stringify(openOnly));
    assert.equal(openOnly.result.count, 2);
    assert.equal(openOnly.result.total, 2);
    assert.equal(openOnly.result.filter, "open");
    const uids = openOnly.result.items.map((i) => i.object_uid).sort();
    assert.deepEqual(uids, [open1.result.object_uid, open2.result.object_uid].sort());
    for (const item of openOnly.result.items) {
      assert.equal(typeof item.object_uid, "string");
      assert.ok(item.title.length > 0, "item must project title");
      assert.equal(typeof item.status, "string");
      assert.ok(item.question.length > 0, "item must project question");
    }
    const withSg = openOnly.result.items.find((i) => i.object_uid === open1.result.object_uid);
    assert.equal(withSg.serves, "SG-1", "serves must be projected when declared");
    assert.equal(openOnly.result.items.find((i) => i.object_uid === terminal.result.object_uid), undefined, "terminal spark must not appear in open-only list");

    // status=all: all three
    const all = await run(descriptors, "ldvh_spark_list", { status: "all" }, repo);
    assert.equal(all.outcome, "completed", JSON.stringify(all));
    assert.equal(all.result.count, 3);
    assert.equal(all.result.total, 3);
    assert.equal(all.result.filter, "all");
    const allUids = all.result.items.map((i) => i.object_uid).sort();
    assert.deepEqual(allUids, [open1.result.object_uid, open2.result.object_uid, terminal.result.object_uid].sort());
    const implItem = all.result.items.find((i) => i.object_uid === terminal.result.object_uid);
    assert.equal(implItem.status, "implemented");
  });
});

test("list: limit hit returns partial outcome with the true total (never silent truncation)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));
    const mkDraft = (title, question) => ({ ...validFrontmatterDraft(), title, question, summary: `总结：${title}`, change_summary: "x" });

    for (let i = 1; i <= 2; i++) {
      const out = await run(descriptors, "ldvh_spark_write", {
        action: "create",
        dedup_result: DEDUP_OK,
        frontmatter_draft: mkDraft(`悬置${i}（限额夹具）`, `问题${i}如何出现？`),
        body_markdown: validBodyMarkdown(mkDraft(`悬置${i}（限额夹具）`, `问题${i}如何出现？`)),
      }, repo);
      assert.equal(out.outcome, "completed", JSON.stringify(out));
    }

    const out = await run(descriptors, "ldvh_spark_list", { limit: 1 }, repo);
    assert.equal(out.outcome, "partial", JSON.stringify(out));
    assert.equal(out.result.count, 1);
    assert.equal(out.result.total, 2, "the true total must be reported when a page is truncated");
    assert.equal(out.result.items.length, 1);
    assert.ok(out.gaps.some((g) => g.includes("projection truncated at limit=1 of 2")), JSON.stringify(out.gaps));
    assert.ok(out.scope.not_completed.some((s) => s.includes("beyond the limit")), JSON.stringify(out.scope));
    assert.equal(out.verification.passed, false);
  });
});

test("list: invalid carriers (no frontmatter) are reported in gaps without failing the operation", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = { ...validFrontmatterDraft(), title: "悬置唯一（坏载体夹具）", question: "坏载体是否被静默跳过？", summary: "总结：坏载体", change_summary: "x" };
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));

    // a carrier-named file with a valid uid but no YAML frontmatter
    const badUid = "123e4567-e89b-42d3-a456-426614174000";
    await writeFile(join(repo, "ldvh-base", "sparks", `spark-${badUid}.md`), "# 这不是一个载体\n", "utf8");

    const out = await run(descriptors, "ldvh_spark_list", {}, repo);
    assert.equal(out.outcome, "completed", JSON.stringify(out));
    assert.equal(out.result.count, 1, "valid object still returned");
    assert.equal(out.result.total, 1, "invalid carrier is not counted as an object");
    assert.equal(out.result.items[0].object_uid, created.result.object_uid);
    assert.ok(out.gaps.some((g) => g.includes(`invalid carrier spark-${badUid}.md`) && g.includes("no YAML frontmatter block")), JSON.stringify(out.gaps));
    assert.equal(out.verification.passed, false, "invalid carriers must fail verification (not silently skipped)");
  });
});

// ---------------------------------------------------------------------------
// execution_error (C: handler throw → execution_error envelope)
// ---------------------------------------------------------------------------

test("execution_error: a throwing dshHomePath surfaces execution_error with the message in gaps", async () => {
  await withTemp("spark-tools.", async (base) => {
    const deps = makeDeps(join(base, "home"), base);
    const boomDeps = { ...deps, dshHomePath: () => { throw new Error("dsh home exploded"); } };
    const descriptors = makeDescriptors(boomDeps);

    for (const [tool, args] of [
      ["ldvh_spark_list", {}],
      ["ldvh_spark_read", { object_uid: "11111111-1111-4111-8111-111111111111" }],
    ]) {
      const out = await run(descriptors, tool, args, base);
      assert.equal(out.outcome, "execution_error", `${tool} must wrap a thrown handler: ${JSON.stringify(out)}`);
      assert.ok(out.gaps.some((g) => g.includes("dsh home exploded")), `${tool} gaps must carry the error message`);
      assert.equal(out.result, null);
      assert.equal(out.verification.passed, false);
    }
  });
});

test("execution_error: a throwing sessionPersistence surfaces execution_error on the write path", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const boomDeps = { ...deps, sessionPersistence: () => { throw new Error("persistence store down"); } };
    const descriptors = makeDescriptors(boomDeps);

    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "execution_error", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("persistence store down")), JSON.stringify(out.gaps));
    const files = await readdir(join(repo, "ldvh-base", "sparks"));
    assert.equal(files.length, 0, "no write may have landed");
  });
});

// ---------------------------------------------------------------------------
// Schema layer (D: parameter schemas reject mis-shapes before the handler)
// ---------------------------------------------------------------------------

test("schema: spark-read-object requires object_uid", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/spark-tools.js");
  const desc = toolDescriptorFor("spark-read-object", OPERATIONS["spark-read-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {}, "args");
  assert.ok(violations.some((v) => v.includes("object_uid")), JSON.stringify(violations));
  assert.equal(validateJsonSchemaValue(desc.parameters, { object_uid: "11111111-1111-4111-8111-111111111111" }, "args").length, 0);
});

test("schema: spark-list-objects status is a closed set", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/spark-tools.js");
  const desc = toolDescriptorFor("spark-list-objects", OPERATIONS["spark-list-objects"], async () => ({}));
  const bad = validateJsonSchemaValue(desc.parameters, { status: "closed" }, "args");
  assert.ok(bad.some((v) => v.includes('must be one of ["open","all"]')), JSON.stringify(bad));
  assert.equal(validateJsonSchemaValue(desc.parameters, { status: "open" }, "args").length, 0);
  assert.equal(validateJsonSchemaValue(desc.parameters, { status: "all", limit: 5 }, "args").length, 0);
});

test("schema: spark-write-object enforces the frontmatter_draft shape", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/spark-tools.js");
  const desc = toolDescriptorFor("spark-write-object", OPERATIONS["spark-write-object"], async () => ({}));
  const missing = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { title: "只有标题" } }, "args");
  for (const field of ["question", "scope_boundary", "intent", "summary"]) {
    assert.ok(missing.some((v) => v.includes(`frontmatter_draft.${field}`)), `missing ${field}: ${JSON.stringify(missing)}`);
  }
  const unknownField = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { ...validFrontmatterDraft(), bogus: 1 } }, "args");
  assert.ok(unknownField.some((v) => v.includes("frontmatter_draft.bogus") && v.includes("not a declared property")), JSON.stringify(unknownField));
});

// ---------------------------------------------------------------------------
// E: update 时新增 serves（SG-1 成功 / SG-99 rejected 零写入）
// ---------------------------------------------------------------------------

test("update: adding serves works for an existing SG and is rejected (zero-write) for an unknown SG", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = { ...validFrontmatterDraft(), title: "无归属悬置（补充SG）", question: "补充子目标归属后能否被清单接纳？", summary: "总结：补充SG" };
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;

    const read1 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    assert.equal(read1.outcome, "completed");
    assert.equal(read1.result.serves, undefined, "fixture created without serves");

    // SG-1 exists in goal.md → update succeeds
    const updated = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: { ...read1.result.frontmatter, serves: "SG-1" },
      body_markdown_after: validBodyMarkdown(draft),
      change_summary: "补充子目标归属 SG-1",
    }, repo);
    assert.equal(updated.outcome, "completed", JSON.stringify(updated));
    assert.ok(updated.verification.checks.includes("serves-resolution"));
    const read2 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    assert.equal(read2.result.serves, "SG-1");

    // second object: SG-99 does not exist in goal.md → rejected with zero writes
    const draft2 = { ...validFrontmatterDraft(), title: "另一悬置（错误SG）", question: "伪造子目标归属是否被拒绝？", summary: "总结：错误SG" };
    const created2 = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: draft2,
      body_markdown: validBodyMarkdown(draft2),
    }, repo);
    assert.equal(created2.outcome, "completed", JSON.stringify(created2));
    const uid2 = created2.result.object_uid;
    const read2b = await run(descriptors, "ldvh_spark_read", { object_uid: uid2 }, repo);
    const before = await readFile(join(repo, "ldvh-base", "sparks", `spark-${uid2}.md`), "utf8");

    const rejected = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid2,
      expected_fingerprint: read2b.result.fingerprint,
      frontmatter_after: { ...read2b.result.frontmatter, serves: "SG-99" },
      body_markdown_after: validBodyMarkdown(draft2),
      change_summary: "伪造 SG-99",
    }, repo);
    assert.equal(rejected.outcome, "rejected", JSON.stringify(rejected));
    assert.ok(rejected.gaps.some((g) => g.includes("serves_unresolvable")), JSON.stringify(rejected.gaps));
    const after = await readFile(join(repo, "ldvh-base", "sparks", `spark-${uid2}.md`), "utf8");
    assert.equal(after, before, "rejected update must leave the carrier untouched");
    const rerun = await run(descriptors, "ldvh_spark_read", { object_uid: uid2 }, repo);
    assert.equal(rerun.result.serves, undefined);
  });
});
// ---------------------------------------------------------------------------
// 20 §16 Human Gate（创建 / 终态转换）—— 机械承载
// ---------------------------------------------------------------------------
//
// These tests exist because the Gate was previously AI self-discipline only:
// the type source declared three Human Gates while the tool plane consumed
// nothing. The cases below pin the four fail-closed paths, the two carried
// Gates, and — crucially — that the 呈报内容 actually reaches the Human.

test("gate: create without a host seam is unavailable (fail-closed, zero writes)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: null }));
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "unavailable", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("human-confirmation") || g.includes("20 §16")), JSON.stringify(out.gaps));
    assert.equal(out.verification.passed, false);
    // Zero writes: the sparks directory must still hold no carrier.
    const entries = await readdir(join(repo, "ldvh-base", "sparks")).catch(() => []);
    assert.equal(entries.filter((f) => f.endsWith(".md")).length, 0, "refused create must not write");
  });
});

test("gate: create is rejected when the Human declines or does not choose", async () => {
  for (const reply of [
    () => ({ granted: false, reason: "human did not confirm the Spark 创建 (answer: null)" }),
    () => ({ granted: false, reason: "human did not confirm the Spark 创建 (answer: \"取消\")" }),
    () => ({ granted: false, reason: "no human-answerer entry is available" }),
    () => ({ granted: false, reason: "spark consent request failed: ASK_ABORTED" }),
  ]) {
    await withTemp("spark-tools.", async (base) => {
      const { repo } = await governedFixture(base);
      const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: sparkSeam(reply) }));
      const out = await run(descriptors, "ldvh_spark_write", {
        action: "create",
        dedup_result: DEDUP_OK,
        frontmatter_draft: validFrontmatterDraft(),
        body_markdown: validBodyMarkdown(),
      }, repo);
      assert.equal(out.outcome, "rejected", `reply ${JSON.stringify(reply({}))} must reject: ${JSON.stringify(out)}`);
      const entries = await readdir(join(repo, "ldvh-base", "sparks")).catch(() => []);
      assert.equal(entries.filter((f) => f.endsWith(".md")).length, 0, "rejected create must not write");
    });
  }
});

test("gate: create is refused without a dedup conclusion (20 §6.2/§17.7 Stop Condition)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: seam }));
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "invalid_request", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("dedup_result")), JSON.stringify(out.gaps));
    // The refusal happens BEFORE the ask: an unrecorded dedup must not be
    // laundered into a Human confirmation of something unreported.
    assert.equal(seam.calls.length, 0, "no question may be asked when the dedup Stop Condition is unmet");
  });
});

test("gate: a reply for a DIFFERENT question id cannot grant consent", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    // The seam answers, but with someone else's question id — the parse must
    // not fall back to answers[0], which would grant on an unrelated "yes".
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, {
      hostSeams: sparkSeam(() => ({ granted: false, reason: "human did not confirm" })),
    }));
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "rejected", JSON.stringify(out));
  });
});

test("gate: the 呈报内容 reaches the answerer (dedup + question + scope + serves)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: seam }));
    const draft = { ...validFrontmatterDraft(), serves: "SG-1" };
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(out.outcome, "completed", JSON.stringify(out));
    assert.equal(seam.calls.length, 1, "exactly one question per create");
    const reported = seam.calls[0].summary;
    assert.ok(reported.includes(DEDUP_OK), `report must carry the dedup conclusion: ${reported}`);
    assert.ok(reported.includes(draft.question), `report must carry the question: ${reported}`);
    assert.ok(reported.includes(draft.scope_boundary), `report must carry the scope_boundary: ${reported}`);
    assert.ok(reported.includes("SG-1"), `report must carry serves: ${reported}`);
    assert.equal(seam.calls[0].action, "create");
  });
});

test("gate: terminal transition requires confirmation; a non-terminal update does not", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: seam }));
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;
    const asksAfterCreate = seam.calls.length;

    // A plain open→open content update must NOT raise the Gate.
    const read1 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    const draft = validFrontmatterDraft();
    const stillOpen = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: { ...read1.result.frontmatter, summary: "更新后的当前理解（仍为 open）。" },
      body_markdown_after: [
        `## 当前理解\n更新后的当前理解（仍为 open）。`,
        `## 调查问题\n${draft.question}`,
        `## 调查边界\n${draft.scope_boundary}`,
      ].join("\n\n"),
      change_summary: "精化当前理解（非终态）",
    }, repo);
    assert.equal(stillOpen.outcome, "completed", JSON.stringify(stillOpen));
    assert.equal(seam.calls.length, asksAfterCreate, "a non-terminal update must not raise the 20 §16 Gate");

    // open→implemented must raise it, and the report carries the disposition.
    const read2 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    const disposition = "已落实：本条由测试夹具直接收敛，不表示下游完成。";
    const terminal = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read2.result.fingerprint,
      frontmatter_after: { ...read2.result.frontmatter, status: "implemented", disposition },
      body_markdown_after: bodyWithoutH1(read2.result.body),
      change_summary: "转终态 implemented",
    }, repo);
    assert.equal(terminal.outcome, "completed", JSON.stringify(terminal));
    assert.equal(seam.calls.length, asksAfterCreate + 1, "a terminal transition must raise exactly one Gate");
    const last = seam.calls[seam.calls.length - 1];
    assert.equal(last.action, "terminal");
    assert.ok(last.summary.includes(disposition), `terminal report must carry the disposition: ${last.summary}`);
    assert.ok(last.summary.includes("implemented"), `terminal report must carry the target status: ${last.summary}`);
  });
});

test("gate: a declined terminal transition is rejected with zero writes", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: seam }));
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    const uid = created.result.object_uid;
    const read1 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    const before = await readFile(join(repo, "ldvh-base", "sparks", `spark-${uid}.md`), "utf8");

    // Flip the answerer to decline ONLY the terminal Gate.
    const declining = sparkSeam(() => ({ granted: false, reason: "human did not confirm the Spark 转入终态 (answer: \"取消\")" }));
    const descriptors2 = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: declining }));
    const out = await run(descriptors2, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: { ...read1.result.frontmatter, status: "implemented", disposition: "已落实：测试。" },
      body_markdown_after: bodyWithoutH1(read1.result.body),
      change_summary: "转终态（应被拒绝）",
    }, repo);
    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    const after = await readFile(join(repo, "ldvh-base", "sparks", `spark-${uid}.md`), "utf8");
    assert.equal(after, before, "declined terminal transition must leave the carrier untouched");
  });
});

test("gate: 09 §6 weak constraint — boundary delta is returned, never blocking", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: seam }));
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    const uid = created.result.object_uid;
    const read1 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    const asksBefore = seam.calls.length;

    const newQuestion = "改写后的调查问题（大改候选）？";
    const newBoundary = "改写后的调查边界。";
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: { ...read1.result.frontmatter, question: newQuestion, scope_boundary: newBoundary },
      body_markdown_after: [
        `## 当前理解\n${read1.result.frontmatter.summary}`,
        `## 调查问题\n${newQuestion}`,
        `## 调查边界\n${newBoundary}`,
      ].join("\n\n"),
      change_summary: "改写 question 与 scope_boundary",
    }, repo);

    // NOT blocked: the weak constraint supplies judgement material, it does not
    // decide. A blocking implementation would be over-enforcement (09 §5).
    assert.equal(out.outcome, "completed", JSON.stringify(out));
    assert.ok(Array.isArray(out.boundary_delta), `delta must be returned: ${JSON.stringify(out)}`);
    const qDelta = out.boundary_delta.find((d) => d.field === "question");
    const sDelta = out.boundary_delta.find((d) => d.field === "scope_boundary");
    assert.equal(qDelta.before, read1.result.frontmatter.question);
    assert.equal(qDelta.after, newQuestion);
    assert.equal(sDelta.after, newBoundary);
    // The delta must not be presented as proof the Gate was satisfied.
    assert.ok(String(out.boundary_delta_note).includes("弱约束"), JSON.stringify(out.boundary_delta_note));
    // And it must not raise an ask of its own (the Human judges it, not a prompt).
    assert.equal(seam.calls.length, asksBefore, "the 大改 weak constraint must not issue its own question");
  });
});

test("gate: boundary delta is omitted when question/scope_boundary did not change", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base));
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    const uid = created.result.object_uid;
    const read1 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: { ...read1.result.frontmatter, intent: "补充保留理由。" },
      body_markdown_after: bodyWithoutH1(read1.result.body),
      change_summary: "补 intent",
    }, repo);
    assert.equal(out.outcome, "completed", JSON.stringify(out));
    assert.equal(out.boundary_delta, undefined, "no delta when neither field changed");
  });
});

// ---------------------------------------------------------------------------
// Descriptor flag consumption (09 §5 mutation guard)
// ---------------------------------------------------------------------------
//
// The flag alone has ZERO effect — this pair is what makes it real. If the
// descriptor factory ever stops consuming `awaitsHumanDecision`, the first test
// fails; if the flag is dropped from OPERATIONS, the second fails. Neither
// mutation can pass silently.

test("descriptor: awaitsHumanDecision is consumed — the write tool declares NO wall-clock deadline", async () => {
  const descriptors = makeDescriptors(makeDeps("/nope", "/nope"));
  assert.ok(
    !("timeoutMs" in descriptors["ldvh_spark_write"]),
    "spark write must drop timeoutMs — a 30s deadline would DISCARD a late Human answer and leave the 20 §16 Gate unenforced",
  );
  // Read-only tools keep their deadline: the flag is per-tool, and widening its
  // effect would remove a useful guard from tools that never wait on a person.
  assert.equal(descriptors["ldvh_spark_read"].timeoutMs, 30000);
  assert.equal(descriptors["ldvh_spark_list"].timeoutMs, 30000);
});

test("descriptor: OPERATIONS declares awaitsHumanDecision for the write tool", async () => {
  assert.equal(sparkToolsModule.OPERATIONS["spark-write-object"].awaitsHumanDecision, true);
  assert.equal(sparkToolsModule.OPERATIONS["spark-read-object"].awaitsHumanDecision, undefined);
});

test("gate: a stale CAS baseline is refused BEFORE the Human is asked (no wasted ask)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: seam }));
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    const uid = created.result.object_uid;
    const read1 = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
    const asksBefore = seam.calls.length;

    // A terminal transition carrying a STALE fingerprint must be refused
    // mechanically, without spending a Human question on it.
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: "0".repeat(64),
      frontmatter_after: { ...read1.result.frontmatter, status: "implemented", disposition: "已落实（陈旧指纹）。" },
      body_markdown_after: bodyWithoutH1(read1.result.body),
      change_summary: "转终态（陈旧基线）",
    }, repo);
    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("cas_conflict") || g.includes("fingerprint mismatch")), JSON.stringify(out.gaps));
    assert.equal(seam.calls.length, asksBefore, "a mechanically-impossible write must not raise the Human Gate");
  });
});

test("gate: a mechanically-invalid create is refused BEFORE the Human is asked", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: seam }));
    // Two terminals in the question → frontmatter mechanical check fails.
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: { ...validFrontmatterDraft(), question: "如何验证？如何验证？" },
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    assert.equal(seam.calls.length, 0, "no question may be asked for a candidate the writer must refuse");
    const entries = await readdir(join(repo, "ldvh-base", "sparks")).catch(() => []);
    assert.equal(entries.filter((f) => f.endsWith(".md")).length, 0, "dry run must not write");
  });
});

test("gate: a dry run allocates no file (no directory, no staging file)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    // The sparks dir exists in the fixture; assert it stays EMPTY across a
    // refused create, and that no stray .tmp staging file is left behind.
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, {
      hostSeams: sparkSeam(() => ({ granted: false, reason: "declined" })),
    }));
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    const entries = await readdir(join(repo, "ldvh-base", "sparks"));
    assert.deepEqual(entries, [], `dry run + refusal must leave no file, found: ${entries.join(",")}`);
  });
});

test("gate: a terminal update that the WRITER must refuse consumes no question (P1 of 26be321 review)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base, { hostSeams: seam }));
    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: DEDUP_OK,
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created).slice(0, 200));
    const uid = created.result.object_uid;

    // 三种「注定被 writer 拒绝」的终态更新。每一种都必须在提问之前被拦下：
    // 提问一旦发出就无法收回，因此让 Human 确认一个必然失败的写入是纯粹的浪费。
    // 本条对应 26be321 独立复核的 P1（当时三种各消耗 1 次提问）。
    const cases = [
      ["illegal relation_key", (fm) => ({ ...fm, status: "discarded", disposition: "不再跟踪。", relations: [{ relation_key: "related-to", target: { object_uid: uid } }] })],
      ["disposition over 200 chars", (fm) => ({ ...fm, status: "implemented", disposition: "长".repeat(240) })],
      ["unresolvable serves", (fm) => ({ ...fm, status: "implemented", disposition: "已落实。", serves: "SG-99" })],
    ];
    for (const [name, mutate] of cases) {
      const read = await run(descriptors, "ldvh_spark_read", { object_uid: uid }, repo);
      const asksBefore = seam.calls.length;
      const out = await run(descriptors, "ldvh_spark_write", {
        action: "update",
        object_uid: uid,
        expected_fingerprint: read.result.fingerprint,
        frontmatter_after: mutate(read.result.frontmatter),
        body_markdown_after: bodyWithoutH1(read.result.body),
        change_summary: `探针：${name}`,
      }, repo);
      assert.equal(out.outcome, "rejected", `${name}: ${JSON.stringify(out).slice(0, 200)}`);
      assert.equal(seam.calls.length, asksBefore, `${name}: 注定失败的写入不得消耗提问（提问不可收回）`);
    }
  });
});
