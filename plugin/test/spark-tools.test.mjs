// Tests for plugin/lib/spark-tools.js — the runtime wiring of the Spark
// mechanical layer (specs/20 §13 受控操作 + specs/03 §9) into the governed
// ldvh_* tool surface.
//
// Coverage follows the sibling research-tools.test.mjs pattern: handlers are
// driven through registerSparkTools's descriptors with a mock ctx.tools
// registry, a real governed-project fixture (tmp repo + registration), and
// the full 05 §8 envelope shape is asserted, not just the result.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as sparkToolsModule from "../lib/spark-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });

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

function makeDeps(home, base) {
  return {
    dshHomePath: dshHome(home),
    workspaceRoot: base,
    sessionPersistence: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

test("registerSparkTools registers exactly the two spark tools", async () => {
  await withTemp("spark-tools.", async (base) => {
    const registered = [];
    const ctx = { tools: { register: (descriptor) => { registered.push(descriptor.name); return () => {}; } } };
    const deps = makeDeps(join(base, "home"), base);
    const dispose = sparkToolsModule.registerSparkTools(ctx, deps);
    assert.deepEqual([...registered].sort(), ["ldvh_spark_read", "ldvh_spark_write"]);
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
// create 机械拒绝 (zero write)
// ---------------------------------------------------------------------------

test("create: mechanical rejection is outcome=rejected with zero writes", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    // question with two terminals → frontmatter mechanical check fails
    const out = await run(descriptors, "ldvh_spark_write", {
      action: "create",
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
// serves_sg resolution through the tool (20 §13/§17.1 wiring)
// ---------------------------------------------------------------------------

test("create: serves_sg resolution flows through the tool (SG-1 ok, SG-99 rejected)", async () => {
  await withTemp("spark-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const ok = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      frontmatter_draft: { ...validFrontmatterDraft(), serves_sg: "SG-1" },
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(ok.outcome, "completed", JSON.stringify(ok));

    const bad = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      frontmatter_draft: { ...validFrontmatterDraft(), serves_sg: "SG-99" },
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(bad.outcome, "rejected");
    assert.ok(bad.gaps.some((g) => g.includes("serves_sg_unresolvable")));
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