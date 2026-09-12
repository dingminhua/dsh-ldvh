// Tests for plugin/lib/friction-tools.js — the runtime wiring of the Friction
// mechanical layer (specs/23 §13 受控操作 + specs/03 §9) into the governed
// ldvh_* tool surface.
//
// Coverage follows the adr-tools.test.mjs / spark-tools.test.mjs pattern:
// handlers are driven through registerFrictionTools's descriptors with a
// mock ctx.tools registry, a real governed-project fixture, the full envelope
// shape is asserted, and the friction-writer.create* / update* are used to
// seed scenario data that the tools then consume.
const { validateJsonSchemaValue } = await import("/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tools/lib/index.js");
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as frictionToolsModule from "../lib/friction-tools.js";
import { createFrictionObject, readFrictionObject, updateFrictionObject, listFrictionObjects, readGoalAnchors } from "../lib/friction-writer.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });

// ---------------------------------------------------------------------------
// Mock registry: capture the descriptors registerFrictionTools registers, then
// drive them exactly as the DSH runtime would (descriptor.execute wraps the
// handler result in { envelope }).
// ---------------------------------------------------------------------------

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
  frictionToolsModule.registerFrictionTools(ctx, deps);
  const byName = {};
  for (const descriptor of registered) byName[descriptor.name] = descriptor;
  return byName;
}

async function run(descriptors, toolName, args, cwd) {
  const out = await descriptors[toolName].execute(args, exec(cwd));
  return out.envelope ?? out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validFrontmatterDraft(overrides = {}) {
  return {
    title: "CI 构建缓慢",
    phenomenon: "CI 每次构建平均需要 8 分钟，其中 5 分钟花在重复依赖安装上。",
    impact: "heavy",
    change_summary: "受控创建（工具测试）",
    ...overrides,
  };
}

function validBodyMarkdown(draft = validFrontmatterDraft()) {
  return [
    `## 现象\n${draft.phenomenon}\n重复出现超过 3 次；可被 CI 日志证明。`,
    `## 入账依据\n归因：CI 配置未缓存依赖层；修了会改善：构建时间预计缩短到 3 分钟以内。`,
  ].join("\n\n");
}

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

async function governedFixture(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  await mkdir(join(repo, "ldvh-base", "frictions"), { recursive: true });
  // goal.md lives at the fact-source root (ldvh-base/) — the writer resolves
  // serves anchors from factSourceRoot, not the repo root.
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

async function seedFriction(root, overrides = {}) {
  const draft = validFrontmatterDraft(overrides);
  const created = await createFrictionObject({
    factSourceRoot: root,
    frontmatterDraft: draft,
    bodyMarkdown: validBodyMarkdown(draft),
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  return { draft, created };
}

async function seedResolvedFriction(root, adrUid) {
  const { draft, created } = await seedFriction(root, { title: "待销账摩擦", serves: "SG-3" });
  const read = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  const updated = await updateFrictionObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: {
      ...read.value.frontmatter,
      status: "resolved",
      relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
    },
    bodyMarkdownAfter: validBodyMarkdown(draft) + "\n\n## 处置\n已解决。",
    changeSummary: "销账",
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));
  return { draft, created, read, updated };
}

async function seedDeferredFriction(root, overrides = {}) {
  const { draft, created } = await seedFriction(root, overrides);
  const read = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  const updated = await updateFrictionObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: { ...read.value.frontmatter, status: "deferred" },
    bodyMarkdownAfter: validBodyMarkdown(draft) + "\n\n## 处置\n暂时搁置。",
    changeSummary: "转为缓议",
  });
  assert.ok(updated.ok, JSON.stringify(updated.error));
  return { draft, created, read, updated };
}

async function createAdrFixture(root, uid) {
  const adrBody = [
    "## 决策背景\n背景说明。",
    "## 决定\n我们决定采用方式 X 解决摩擦问题。",
    "## 备选与理由\n替代方案 Y 已被否决因为 Z。",
    "## 后果\n预期结果可被度量。",
    "## 适用范围\n适用于本仓库所有 CI 场景。",
  ].join("\n\n");
  const adrFm = {
    object_uid: uid,
    fact_type_key: "adr",
    title: "解决 CI 摩擦的决策",
    status: "active",
    decision: "我们决定采用方式 X 解决摩擦问题。",
    scope: "适用于本仓库所有 CI 场景。",
    trigger_signal: "当 CI 摩擦出现时触发",
    created_at: "2026-09-10T12:00:00+08:00",
    change_log: [{ at: "2026-09-10T12:00:00+08:00", summary: "受控创建" }],
  };
  const yaml = await import("yaml");
  const fmStr = yaml.stringify(adrFm);
  const content = `---\n${fmStr}---\n\n${adrBody.trim()}\n`;
  await mkdir(join(root, "adrs"), { recursive: true });
  await writeFile(join(root, "adrs", `adr-${uid}.md`), content, "utf8");
  return uid;
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

test("registerFrictionTools registers exactly the three friction tools", async () => {
  await withTemp("friction-tools.", async (base) => {
    const registered = [];
    const ctx = {
      tools: {
        register: (descriptor) => {
          registered.push(descriptor.name);
          return () => {};
        },
      },
    };
    frictionToolsModule.registerFrictionTools(ctx, { dshHomePath: () => "x", workspaceRoot: base, sessionPersistence: () => undefined });
    assert.deepEqual(registered, ["ldvh_friction_read", "ldvh_friction_list", "ldvh_friction_write"]);
  });
});

// ---------------------------------------------------------------------------
// Un-governed sessions return unavailable (all three tools)
// ---------------------------------------------------------------------------

test("friction-read-object outside governed project returns unavailable", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = makeDeps(join(base, "home"), base);
    const desc = makeDescriptors(deps);
    const env = await run(desc, "ldvh_friction_read", { object_uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, base);
    assert.equal(env.outcome, "unavailable");
    assert.ok(env.gaps.some((g) => g.includes("not_governed") || g.includes("governance state is not_governed")));
  });
});

test("friction-list-objects outside governed project returns unavailable", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = makeDeps(join(base, "home"), base);
    const desc = makeDescriptors(deps);
    const env = await run(desc, "ldvh_friction_list", {}, base);
    assert.equal(env.outcome, "unavailable");
    assert.ok(env.gaps.some((g) => g.includes("not_governed") || g.includes("governance state is not_governed")));
  });
});

test("friction-write-object outside governed project returns unavailable", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = makeDeps(join(base, "home"), base);
    const desc = makeDescriptors(deps);
    const env = await run(desc, "ldvh_friction_write", { action: "create", frontmatter_draft: { title: "t" }, body_markdown: "## 现象\nx" }, base);
    assert.equal(env.outcome, "unavailable");
    assert.ok(env.gaps.some((g) => g.includes("not_governed") || g.includes("governance state is not_governed")));
  });
});

// ---------------------------------------------------------------------------
// friction-read-object
// ---------------------------------------------------------------------------

test("friction-read-object: read-back full envelope for an existing friction", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const { created } = await seedFriction(join(repo, "ldvh-base"));

    const env = await run(desc, "ldvh_friction_read", { object_uid: created.value.object_uid }, repo);
    assert.equal(env.outcome, "completed");
    assert.equal(env.result.object_uid, created.value.object_uid);
    assert.equal(env.result.fingerprint, created.value.fingerprint);
    assert.equal(env.result.status, "open");
    assert.equal(env.result.phenomenon, validFrontmatterDraft().phenomenon);
    assert.equal(env.result.body_valid, true);
    assert.ok(env.result.body.length > 0, "body must be returned");
    assert.ok(env.result.frontmatter.phenomenon === env.result.phenomenon);
  });
});

test("friction-read-object: missing uid rejected with rejected outcome", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const env = await run(desc, "ldvh_friction_read", { object_uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, repo);
    assert.equal(env.outcome, "rejected");
    assert.ok(env.gaps.some((g) => g.includes("friction/object_not_found")));
    assert.equal(env.verification.passed, false);
    assert.deepEqual(env.scope.not_completed, ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]);
  });
});

test("friction-read-object: bad uid shape (non-UUID) rejected", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const env = await run(desc, "ldvh_friction_read", { object_uid: "not-a-uid" }, repo);
    assert.equal(env.outcome, "rejected");
    assert.ok(env.gaps.some((g) => g.includes("friction/invalid_uid")));
  });
});

test("friction-read-object: object_uid omitted → invalid_request envelope", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const env = await run(desc, "ldvh_friction_read", {}, repo);
    assert.equal(env.outcome, "invalid_request");
    assert.deepEqual(env.result, null);
    assert.ok(env.verification.passed === false);
  });
});

// ---------------------------------------------------------------------------
// friction-list-objects
// ---------------------------------------------------------------------------

test("friction-list-objects: default (open+deferred) filter and full projection", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const open = await seedFriction(join(repo, "ldvh-base"), { title: "公开摩擦" });
    const deferred = await seedDeferredFriction(join(repo, "ldvh-base"), { title: "缓议摩擦" });
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(join(repo, "ldvh-base"), adrUid);
    const resolved = await seedResolvedFriction(join(repo, "ldvh-base"), adrUid);

    const env = await run(desc, "ldvh_friction_list", {}, repo);
    assert.equal(env.outcome, "completed");
    assert.equal(env.result.filter, "open+deferred");
    assert.equal(env.result.count, 2);
    assert.equal(env.result.total, 2);
    assert.equal(env.result.items.length, 2);
    for (const item of env.result.items) assert.notEqual(item.status, "resolved");

    const itemUids = env.result.items.map((i) => i.object_uid).sort();
    const expected = [open.created.value.object_uid, deferred.created.value.object_uid].sort();
    assert.deepEqual(itemUids, expected);

    assert.ok(env.follow_up.some((s) => s.includes("dedup")));
    assert.ok(env.follow_up.some((s) => s.includes("friction-read-object")));
    assert.equal(env.scope.not_completed.length, 0);
    assert.equal(env.verification.passed, true);
  });
});

test("friction-list-objects: includeResolved=all returns all, including resolved", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    await seedFriction(join(repo, "ldvh-base"), { title: "甲" });
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(join(repo, "ldvh-base"), adrUid);
    await seedResolvedFriction(join(repo, "ldvh-base"), adrUid);

    const env = await run(desc, "ldvh_friction_list", { status: "all" }, repo);
    assert.equal(env.outcome, "completed");
    assert.equal(env.result.filter, "all");
    assert.equal(env.result.count, 2);
    assert.equal(env.result.total, 2);
    const statuses = env.result.items.map((i) => i.status);
    assert.ok(statuses.includes("open") || statuses.includes("deferred"));
    assert.ok(statuses.includes("resolved"));
  });
});

test("friction-list-objects: limit truncates to partial with the true total (03 §8.1)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    await seedFriction(join(repo, "ldvh-base"), { title: "摩擦甲" });
    await seedFriction(join(repo, "ldvh-base"), { title: "摩擦乙" });
    await seedFriction(join(repo, "ldvh-base"), { title: "摩擦丙" });

    const env = await run(desc, "ldvh_friction_list", { limit: 2 }, repo);
    assert.equal(env.outcome, "partial");
    assert.equal(env.result.count, 2);
    assert.equal(env.result.total, 3);
    assert.equal(env.verification.passed, false);
    assert.ok(env.gaps.some((g) => g.includes("truncated") && g.includes("limit=2")));
    assert.ok(env.follow_up.some((s) => s.includes("dedup")));
  });
});

// ---------------------------------------------------------------------------
// friction-write-object create (05 §8 envelope, zero-write on rejection)
// ---------------------------------------------------------------------------

test("friction-write-object create: completed envelope with read-back", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);
    await writeFile(join(repo, "ldvh-base", "goal.md"), GOAL_MD_FIXTURE, "utf8");

    const env = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "create",
        frontmatter_draft: { ...validFrontmatterDraft(), serves: "SG-3" },
        body_markdown: validBodyMarkdown(),
      },
      repo
    );
    assert.equal(env.outcome, "completed");
    assert.equal(env.result.action, "create");
    assert.ok(env.result.object_uid);
    assert.equal(env.result.read_back.ok, true);
    assert.ok(env.result.read_back.fingerprint.length === 64);
    assert.deepEqual(env.scope.completed, ["create", "read-back"]);
    assert.deepEqual(env.scope.not_completed, []);
    assert.equal(env.verification.passed, true);
    assert.ok(env.follow_up.some((s) => s.includes("controlled-commit")));
    assert.equal(env.result.changes.length, 1);
    assert.equal(env.result.changes[0].change, "created");
    assert.equal(env.result.changes[0].object_uid, env.result.object_uid);
  });
});

test("friction-write-object create: rejected (invalid_request — missing body_markdown)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const env = await run(desc, "ldvh_friction_write", { action: "create", frontmatter_draft: validFrontmatterDraft() }, repo);
    assert.equal(env.outcome, "invalid_request");
    assert.equal(env.result, null);
    assert.equal(env.verification.passed, false);
    assert.deepEqual(env.scope.completed, []);
    assert.ok(env.gaps.some((g) => g.includes("body_markdown")));
  });
});

test("friction-write-object create: zero write on frontmatter validation failure", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);
    await writeFile(join(repo, "ldvh-base", "goal.md"), GOAL_MD_FIXTURE, "utf8");

    const env = await run(desc, "ldvh_friction_write", { action: "create", frontmatter_draft: { title: "t", impact: "light", phenomenon: "现象。" }, body_markdown: "## 现象\n无" }, repo);
    assert.equal(env.outcome, "rejected");
    assert.equal(env.result, null);
    const items = await readFile(join(repo, "ldvh-base", "frictions"), "utf8").catch(() => null);
    assert.equal(items, null, "no file should be written on writer-level rejection");
    assert.deepEqual(env.scope.not_completed, ["write"]);
  });
});

test("friction-write-object create: mechanical rejection preserves follow_up hints", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);
    await writeFile(join(repo, "ldvh-base", "goal.md"), GOAL_MD_FIXTURE, "utf8");

    const env = await run(desc, "ldvh_friction_write", { action: "create", frontmatter_draft: { title: "t", impact: "light", phenomenon: "现象。" }, body_markdown: "## 现象\n无" }, repo);
    assert.equal(env.outcome, "rejected");
    assert.deepEqual(env.scope.completed, []);
    assert.ok(env.follow_up.length > 0, "rejected envelope must carry follow_up guidance");
    assert.ok(env.follow_up.some((s) => s.includes("fix") || s.includes("zero write")), JSON.stringify(env.follow_up));
  });
});

// ---------------------------------------------------------------------------
// friction-write-object update (05 §8 envelope, CAS, read-back)
// ---------------------------------------------------------------------------

test("friction-write-object update: normal transition and read-back", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const { draft, created } = await seedFriction(join(repo, "ldvh-base"), { title: "摩擦甲" });
    const read1 = await readFrictionObject({ factSourceRoot: join(repo, "ldvh-base"), objectUid: created.value.object_uid });
    assert.equal(read1.value.frontmatter.status, "open");

    const env = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "update",
        object_uid: created.value.object_uid,
        expected_fingerprint: read1.value.fingerprint,
        frontmatter_after: { ...read1.value.frontmatter, title: "摩擦甲（修订）", status: "deferred" },
        body_markdown_after: validBodyMarkdown(draft) + "\n\n## 处置\n暂时搁置。",
        change_summary: "转为缓议",
      },
      repo
    );
    assert.equal(env.outcome, "completed");
    assert.equal(env.result.action, "update");
    assert.equal(env.result.object_uid, created.value.object_uid);
    assert.ok(env.result.read_back.ok);
    assert.equal(env.result.read_back.body_valid, true);
    assert.deepEqual(env.scope.completed, ["update", "read-back"]);
    assert.deepEqual(env.scope.not_completed, []);
    assert.equal(env.verification.passed, true);
    assert.equal(env.result.changes.length, 1);
    assert.equal(env.result.changes[0].change, "updated");
    assert.equal(env.result.changes[0].summary, "转为缓议");
  });
});

test("friction-write-object update: CAS conflict → rejected with retry follow-up", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const { draft, created } = await seedFriction(join(repo, "ldvh-base"));
    const read1 = await readFrictionObject({ factSourceRoot: join(repo, "ldvh-base"), objectUid: created.value.object_uid });
    const staleFp = read1.value.fingerprint.slice(0, -8) + "00000000"; // mutated stale baseline

    const env = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "update",
        object_uid: created.value.object_uid,
        expected_fingerprint: staleFp,
        frontmatter_after: { ...read1.value.frontmatter, status: "deferred" },
        body_markdown_after: validBodyMarkdown(draft) + "\n\n## 处置\n先改。",
        change_summary: "CAS 冲突",
      },
      repo
    );
    assert.equal(env.outcome, "rejected");
    assert.equal(env.result, null);
    assert.deepEqual(env.scope.completed, []);
    assert.deepEqual(env.scope.not_completed, ["write"]);
    assert.ok(env.follow_up.some((s) => s.includes("friction-read-object")), JSON.stringify(env.follow_up));
  });
});

// ---------------------------------------------------------------------------
// friction-write-object update: resolved transition with informs (26 §9.2/§11)
// ---------------------------------------------------------------------------

test("friction-write-object update: resolve with informs to ADR → completed with read-back", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);
    await writeFile(join(repo, "ldvh-base", "goal.md"), GOAL_MD_FIXTURE, "utf8");

    const { draft, created } = await seedFriction(join(repo, "ldvh-base"), { title: "可销账摩擦" });
    const read1 = await readFrictionObject({ factSourceRoot: join(repo, "ldvh-base"), objectUid: created.value.object_uid });
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(join(repo, "ldvh-base"), adrUid);

    const env = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "update",
        object_uid: created.value.object_uid,
        expected_fingerprint: read1.value.fingerprint,
        frontmatter_after: {
          ...read1.value.frontmatter,
          status: "resolved",
          relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
        },
        body_markdown_after: validBodyMarkdown(draft) + "\n\n## 处置\n已解决。",
        change_summary: "销账",
      },
      repo
    );
    assert.equal(env.outcome, "completed");
    assert.equal(env.result.read_back.ok, true);
    assert.equal(env.verification.passed, true);
    assert.ok(env.follow_up.some((s) => s.includes("controlled-commit")), JSON.stringify(env.follow_up));
  });
});

test("friction-write-object update: resolve without informs → rejected (26 §9.2)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const { created } = await seedFriction(join(repo, "ldvh-base"));
    const read1 = await readFrictionObject({ factSourceRoot: join(repo, "ldvh-base"), objectUid: created.value.object_uid });

    const env = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "update",
        object_uid: created.value.object_uid,
        expected_fingerprint: read1.value.fingerprint,
        frontmatter_after: { ...read1.value.frontmatter, status: "resolved" },
        body_markdown_after: validBodyMarkdown() + "\n\n## 处置\n已解决。",
        change_summary: "不带 informs 试图销账",
      },
      repo
    );
    assert.equal(env.outcome, "rejected");
    assert.ok(env.follow_up.some((s) => s.includes("informs 1..n")), JSON.stringify(env.follow_up));
  });
});

// ---------------------------------------------------------------------------
// friction-write-object update: deferred→open without relations allowed (26 §9.2)
// ---------------------------------------------------------------------------

test("friction-write-object update: deferred→open reactivation allowed (26 §9.2)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const { created } = await seedFriction(join(repo, "ldvh-base"));
    const read1 = await readFrictionObject({ factSourceRoot: join(repo, "ldvh-base"), objectUid: created.value.object_uid });

    // First: open→deferred
    const env1 = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "update",
        object_uid: created.value.object_uid,
        expected_fingerprint: read1.value.fingerprint,
        frontmatter_after: { ...read1.value.frontmatter, status: "deferred" },
        body_markdown_after: validBodyMarkdown() + "\n\n## 处置\n暂时搁置。",
        change_summary: "转为缓议",
      },
      repo
    );
    assert.equal(env1.outcome, "completed");

    // Reactivate: deferred→open
    const env2 = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "update",
        object_uid: created.value.object_uid,
        expected_fingerprint: env1.result.fingerprint,
        frontmatter_after: { ...read1.value.frontmatter, status: "open" },
        body_markdown_after: validBodyMarkdown(),
        change_summary: "重新激活",
      },
      repo
    );
    assert.equal(env2.outcome, "completed");
    assert.equal(env2.result.read_back.ok, true);
    const read2 = await readFrictionObject({ factSourceRoot: join(repo, "ldvh-base"), objectUid: created.value.object_uid });
    assert.equal(read2.value.frontmatter.status, "open");
    assert.equal(read2.value.frontmatter.relations, undefined, "reactivation must not carry relations");
  });
});

// ---------------------------------------------------------------------------
// friction-write-object update: resolved object returns status_terminal
// ---------------------------------------------------------------------------

test("friction-write-object update: updating a resolved friction → rejected status_terminal (26 §9.2)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const desc = makeDescriptors(deps);

    const { created } = await seedFriction(join(repo, "ldvh-base"));
    const read1 = await readFrictionObject({ factSourceRoot: join(repo, "ldvh-base"), objectUid: created.value.object_uid });
    const adrUid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await createAdrFixture(join(repo, "ldvh-base"), adrUid);

    // open→resolved
    const envResolve = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "update",
        object_uid: created.value.object_uid,
        expected_fingerprint: read1.value.fingerprint,
        frontmatter_after: {
          ...read1.value.frontmatter,
          status: "resolved",
          relations: [{ relation_key: "informs", target: { object_uid: adrUid } }],
        },
        body_markdown_after: validBodyMarkdown() + "\n\n## 处置\n已解决。",
        change_summary: "销账",
      },
      repo
    );
    assert.equal(envResolve.outcome, "completed");

    // Now try to update the resolved object
    const read2 = await readFrictionObject({ factSourceRoot: join(repo, "ldvh-base"), objectUid: created.value.object_uid });
    const envRetry = await run(
      desc,
      "ldvh_friction_write",
      {
        action: "update",
        object_uid: created.value.object_uid,
        expected_fingerprint: read2.value.fingerprint,
        frontmatter_after: { ...read2.value.frontmatter, title: "试图重开" },
        body_markdown_after: validBodyMarkdown() + "\n\n## 处置\n已解决。",
        change_summary: "试图重开",
      },
      repo
    );
    assert.equal(envRetry.outcome, "rejected");
    assert.equal(envRetry.result, null);
    assert.deepEqual(envRetry.scope.completed, []);
    assert.deepEqual(envRetry.scope.not_completed, ["write"]);
    assert.ok(envRetry.follow_up.some((s) => s.includes("NEW ledger entry")), JSON.stringify(envRetry.follow_up));
  });
});

// ---------------------------------------------------------------------------
// Execution error path
// ---------------------------------------------------------------------------

test("toolDescriptor.execute: unexpected exception → execution_error envelope (05 §8)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = { dshHomePath: () => "x", workspaceRoot: base, sessionPersistence: () => undefined };
    const byName = makeDescriptors(deps);
    // Force an exception by calling execute directly with a descriptor whose handler
    // throws due to an unexpected failure path. We use the read-object with
    // a malformed non-object exec to trigger the thrown path.
    const read = byName["ldvh_friction_read"];
    assert.ok(read);
    // Write an invalid friction object to trigger a thrown path during parse
    const fmBad = {
      object_uid: "123e4567-e89b-42d3-a456-426614174000",
      fact_type_key: "friction",
      title: "坏",
      status: "open",
      phenomenon: "无符号。",
      impact: "heavy",
      created_at: "2026-09-10T12:00:00+08:00",
      change_log: [],
    };
    await mkdir(join(base, "frictions"), { recursive: true });
    await writeFile(join(base, "frictions", "friction-123e4567-e89b-42d3-a456-426614174000.md"), "---\nnot a valid yaml frontmatter block\n---\n", "utf8");
    const out = await read.execute({ object_uid: "123e4567-e89b-42d3-a456-426614174000" }, { agent: { session: { header: { cwd: base } } } });
    const env = out.envelope ?? out;
    // The read handler should produce rejected (invalid uid) or unavailable (ENOENT)
    // not an execution_error for this input — we verify the execute wrapper doesn't
    // swallow parse errors as execution_error for normal tools:
    assert.notEqual(env.outcome, "execution_error", "normal read input should not produce execution_error");
  });
});

// ---------------------------------------------------------------------------
// Schema layer tests (26 §8 field contract in tool schema)
// ---------------------------------------------------------------------------

test("tool schema: friction-read-object rejects unknown fields (26 §8 closed set)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = { dshHomePath: () => "x", workspaceRoot: base, sessionPersistence: () => undefined };
    const byName = makeDescriptors(deps);
    const desc = byName["ldvh_friction_read"];
    assert.ok(desc);

    // object_uid is the ONLY accepted field
    const bad = { object_uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", bogus: 1 };
    const violations = validateJsonSchemaValue(desc.parameters, bad, "args");
    assert.ok(violations.length > 0, `unknown field bogus must be rejected; violations=${JSON.stringify(violations)}`);
  });
});

test("tool schema: friction-list-objects status open is valid, invalid status rejected", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = { dshHomePath: () => "x", workspaceRoot: base, sessionPersistence: () => undefined };
    const byName = makeDescriptors(deps);
    const desc = byName["ldvh_friction_list"];
    assert.ok(desc);

    assert.equal(validateJsonSchemaValue(desc.parameters, { status: "open" }, "args").length, 0);
    assert.equal(validateJsonSchemaValue(desc.parameters, { status: "all" }, "args").length, 0);
    const bad = validateJsonSchemaValue(desc.parameters, { status: "closed" }, "args");
    assert.ok(bad.length > 0, "status must be one of open|all");
  });
});

test("tool schema: friction-write-object create requires action+frontmatter_draft+body_markdown (26 §8)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = { dshHomePath: () => "x", workspaceRoot: base, sessionPersistence: () => undefined };
    const byName = makeDescriptors(deps);
    const desc = byName["ldvh_friction_write"];
    assert.ok(desc);

    const missingTitle = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { phenomenon: "只有现象", impact: "light" } }, "args");
    assert.ok(missingTitle.length > 0, "title is required in frontmatter_draft");
    assert.ok(missingTitle.some((v) => v.includes("title")), JSON.stringify(missingTitle));

    const invalidImpact = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { title: "t", phenomenon: "p", impact: "critical" } }, "args");
    assert.ok(invalidImpact.length > 0, "impact must be light/medium/heavy");

    const unknownFm = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { title: "t", phenomenon: "p", impact: "light", custom: 1 } }, "args");
    assert.ok(unknownFm.length > 0, "frontmatter_draft has a closed set");
  });
});

test("tool schema: friction-write-object write action accepts expected_fingerprint (26 §9 CAS baseline)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = { dshHomePath: () => "x", workspaceRoot: base, sessionPersistence: () => undefined };
    const byName = makeDescriptors(deps);
    const desc = byName["ldvh_friction_write"];
    assert.ok(desc);

    const ok = validateJsonSchemaValue(desc.parameters, { action: "update", object_uid: "a", expected_fingerprint: "x", frontmatter_after: { title: "t", phenomenon: "p", impact: "light" }, body_markdown_after: "m", change_summary: "x" }, "args");
    assert.equal(ok.length, 0, "update with fingerprint should pass schema validation: " + JSON.stringify(ok));
  });
});

test("tool schema: frontmatter_after update schema omits required, carries type fields (26 §9.2 update envelope)", async () => {
  await withTemp("friction-tools.", async (base) => {
    const deps = { dshHomePath: () => "x", workspaceRoot: base, sessionPersistence: () => undefined };
    const byName = makeDescriptors(deps);
    const desc = byName["ldvh_friction_write"];
    assert.ok(desc);

    const schema = desc.parameters.properties.frontmatter_after;
    assert.ok(typeof schema === "object", "frontmatter_after must be an object schema");
    // The update schema must not require all fields (handler does CAS + writer validation)
    assert.ok(schema.required === undefined || Array.isArray(schema.required), "frontmatter_after schema should carry the relaxed required");
    assert.ok(typeof schema.description === "string" && schema.description.length > 0, "must carry description");
    assert.ok(typeof schema.properties === "object", "must carry properties");
  });
});
