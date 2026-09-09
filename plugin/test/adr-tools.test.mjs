// Tests for plugin/lib/adr-tools.js — the runtime wiring of the ADR
// mechanical layer (specs/22 §13 受控操作 + specs/03 §9) into the governed
// ldvh_* tool surface.
//
// Coverage follows the spark-tools.test.mjs pattern: handlers are driven
// through registerAdrTools's descriptors with a mock ctx.tools registry, a
// real governed-project fixture (tmp repo + registration), and the full
// 05 §8 envelope shape is asserted, not just the result.
const { validateJsonSchemaValue } = await import("/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tools/lib/index.js");
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as adrToolsModule from "../lib/adr-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });

// Mock registry: capture the descriptors registerAdrTools registers, then
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
  adrToolsModule.registerAdrTools(ctx, deps);
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

function validFrontmatterDraft(overrides = {}) {
  return {
    title: "归档方案定案（工具）",
    decision: "采用基于对象存储的归档方案。",
    scope: "适用于本仓库的归档读取场景，不适用于实时写入场景。",
    trigger_signal: "当 SG-4 落地时重审本决策",
    change_summary: "受控创建（测试夹具）",
    ...overrides,
  };
}

function validBodyMarkdown(draft = validFrontmatterDraft()) {
  const sections = [
    `## 决策背景\n需要跨会话保留的归档读取通道，现有临时方案无法支撑长时间追溯。`,
    `## 决定\n${draft.decision}\n扩展说明：对象存储的成本与读取语义满足归档场景。`,
    `## 备选与理由\n备选一：本地文件快照，落选原因：无版本语义。\n备选二：数据库表，落选原因：归档增长拖累在线查询。`,
    `## 后果\n已接受后果：归档读取延迟高于在线存储；无已知重大后果。`,
    `## 适用范围\n${draft.scope}\n展开：何时适用、何时不适用。`,
  ];
  if (Array.isArray(draft.urls) && draft.urls.length > 0) {
    sections.push(`## 证据\n外部来源见 urls 字段。`);
  }
  return sections.join("\n\n");
}

async function governedFixture(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  await mkdir(join(repo, "ldvh-base", "adrs"), { recursive: true });
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

test("registerAdrTools registers exactly the three adr tools", async () => {
  await withTemp("adr-tools.", async (base) => {
    const registered = [];
    const ctx = { tools: { register: (descriptor) => { registered.push(descriptor.name); return () => {}; } } };
    const deps = makeDeps(join(base, "home"), base);
    const dispose = adrToolsModule.registerAdrTools(ctx, deps);
    assert.deepEqual([...registered].sort(), ["ldvh_adr_list", "ldvh_adr_read", "ldvh_adr_write"]);
    assert.equal(typeof dispose, "function");
  });
});

test("adr descriptors return text blocks from render and an object schema", async () => {
  const deps = makeDeps("/nope", "/nope");
  const descriptors = makeDescriptors(deps);
  for (const descriptor of Object.values(descriptors)) {
    const blocks = descriptor.output.render({}, { envelope: { operation_key: "adr-read-object", outcome: "completed", result: null, gaps: [] } });
    assert.ok(Array.isArray(blocks), "render must return an array");
    assert.equal(blocks[0].type, "text");
    assert.equal(descriptor.output.schema.type, "object");
  }
});

// ---------------------------------------------------------------------------
// 未管辖会话 (governance-scope check failed → unavailable)
// ---------------------------------------------------------------------------

test("read/list/write are unavailable outside governed sessions", async () => {
  await withTemp("adr-tools.", async (base) => {
    const home = join(base, "home");
    await mkdir(join(home, "ldvh"), { recursive: true });
    const descriptors = makeDescriptors(makeDeps(home, base));
    const readOut = await run(descriptors, "ldvh_adr_read", { object_uid: "11111111-1111-4111-8111-111111111111" }, base);
    assert.equal(readOut.outcome, "unavailable");
    assert.ok(readOut.gaps[0].includes("not_governed"));
    const listOut = await run(descriptors, "ldvh_adr_list", {}, base);
    assert.equal(listOut.outcome, "unavailable");
    assert.ok(listOut.gaps[0].includes("not_governed"));
    const writeOut = await run(descriptors, "ldvh_adr_write", {
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
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_adr_write", {
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
    const raw = await readFile(join(repo, "ldvh-base", "adrs", `adr-${created.result.object_uid}.md`), "utf8");
    assert.ok(raw.includes("fact_type_key"));
    assert.ok(raw.includes("# 归档方案定案（工具）"));
  });
});

// ---------------------------------------------------------------------------
// create 机械拒绝 (zero write)
// ---------------------------------------------------------------------------

test("create: mechanical rejection is outcome=rejected with zero writes", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    // decision with two terminals → frontmatter mechanical check fails
    const out = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: { ...validFrontmatterDraft(), decision: "采用方案A。采用方案B。" },
      body_markdown: validBodyMarkdown({ ...validFrontmatterDraft(), decision: "采用方案A。采用方案B。" }),
    }, repo);

    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("frontmatter_invalid")));
    assert.equal(out.verification.passed, false);
    const files = await readdir(join(repo, "ldvh-base", "adrs"));
    assert.equal(files.length, 0);
  });
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

test("read: created object returns completed with active status and matching fingerprint; missing uid rejected", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(created.outcome, "completed");
    const uid = created.result.object_uid;
    const fp = created.result.fingerprint;

    const readOut = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    assert.equal(readOut.outcome, "completed", JSON.stringify(readOut));
    assert.equal(readOut.result.frontmatter.status, "active");
    assert.equal(readOut.result.fingerprint, fp);

    const missing = await run(descriptors, "ldvh_adr_read", { object_uid: "99999999-9999-4999-8999-999999999999" }, repo);
    assert.equal(missing.outcome, "rejected");
    assert.ok(missing.gaps.some((g) => g.includes("object_not_found")));
  });
});

// ---------------------------------------------------------------------------
// list (active 默认过滤; status=all 含 retired)
// ---------------------------------------------------------------------------

test("list: active-only by default; status=all includes retired", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const mkDraft = (title) => ({ ...validFrontmatterDraft(), title, change_summary: "受控创建（清单夹具）" });
    const active1 = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: mkDraft("甲决策（工具清单）"),
      body_markdown: validBodyMarkdown(mkDraft("甲决策（工具清单）")),
    }, repo);
    assert.equal(active1.outcome, "completed", JSON.stringify(active1));

    const active2 = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: mkDraft("乙决策（工具清单）"),
      body_markdown: validBodyMarkdown(mkDraft("乙决策（工具清单）")),
    }, repo);
    assert.equal(active2.outcome, "completed", JSON.stringify(active2));

    const terminal = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: mkDraft("丙决策（工具清单）"),
      body_markdown: validBodyMarkdown(mkDraft("丙决策（工具清单）")),
    }, repo);
    assert.equal(terminal.outcome, "completed", JSON.stringify(terminal));
    // active → retired via CAS update
    const readTerminal = await run(descriptors, "ldvh_adr_read", { object_uid: terminal.result.object_uid }, repo);
    assert.equal(readTerminal.outcome, "completed");
    const toRetired = {
      ...readTerminal.result.frontmatter,
      status: "retired",
      retirement_reason: "outdated",
    };
    const retired = await run(descriptors, "ldvh_adr_write", {
      action: "update",
      object_uid: terminal.result.object_uid,
      expected_fingerprint: terminal.result.fingerprint,
      frontmatter_after: toRetired,
      body_markdown_after: validBodyMarkdown(mkDraft("丙决策（工具清单）")),
      change_summary: "转入 retired",
    }, repo);
    assert.equal(retired.outcome, "completed", JSON.stringify(retired));

    // default (active-only): exactly the two active ADRs
    const activeOnly = await run(descriptors, "ldvh_adr_list", {}, repo);
    assert.equal(activeOnly.outcome, "completed", JSON.stringify(activeOnly));
    assert.equal(activeOnly.result.count, 2);
    assert.equal(activeOnly.result.total, 2);
    assert.equal(activeOnly.result.filter, "active");
    const uids = activeOnly.result.items.map((i) => i.object_uid).sort();
    assert.deepEqual(uids, [active1.result.object_uid, active2.result.object_uid].sort());
    for (const item of activeOnly.result.items) {
      assert.equal(typeof item.object_uid, "string");
      assert.ok(item.title.length > 0, "item must project title");
      assert.equal(typeof item.status, "string");
      assert.ok(item.decision.length > 0, "item must project decision");
      assert.equal(typeof item.trigger_signal, "string", "fixture declares a trigger_signal — it must be projected");
    }
    assert.equal(activeOnly.result.items.find((i) => i.object_uid === terminal.result.object_uid), undefined, "retired ADR must not appear in the active-only list (22 §12)");

    // status=all: all three
    const all = await run(descriptors, "ldvh_adr_list", { status: "all" }, repo);
    assert.equal(all.outcome, "completed", JSON.stringify(all));
    assert.equal(all.result.count, 3);
    assert.equal(all.result.total, 3);
    assert.equal(all.result.filter, "all");
    const allUids = all.result.items.map((i) => i.object_uid).sort();
    assert.deepEqual(allUids, [active1.result.object_uid, active2.result.object_uid, terminal.result.object_uid].sort());
    const retiredItem = all.result.items.find((i) => i.object_uid === terminal.result.object_uid);
    assert.equal(retiredItem.status, "retired");
  });
});

// ---------------------------------------------------------------------------
// update (CAS 正常流 + CAS 冲突)
// ---------------------------------------------------------------------------

test("update: CAS normal flow completed with new fingerprint; CAS conflict rejected with file unchanged", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(created.outcome, "completed");
    const uid = created.result.object_uid;
    const fp1 = created.result.fingerprint;

    const read1 = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    assert.equal(read1.outcome, "completed");

    // CAS normal flow: body-only errata (decision/scope unchanged), keep the rest verbatim
    const bodyAfter = [
      `## 决策背景\n需要跨会话保留的归档读取通道（勘误后表述）。`,
      `## 决定\n${validFrontmatterDraft().decision}\n扩展说明：对象存储的成本与读取语义满足归档场景。`,
      `## 备选与理由\n备选一：本地文件快照，落选原因：无版本语义。`,
      `## 后果\n已接受后果：归档读取延迟高于在线存储；无已知重大后果。`,
      `## 适用范围\n${validFrontmatterDraft().scope}\n展开：何时适用、何时不适用。`,
    ].join("\n\n");

    const updated = await run(descriptors, "ldvh_adr_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: fp1,
      frontmatter_after: read1.result.frontmatter,
      body_markdown_after: bodyAfter,
      change_summary: "勘误：修正决策背景表述",
    }, repo);
    assert.equal(updated.outcome, "completed", JSON.stringify(updated));
    assert.notEqual(updated.result.fingerprint, fp1);
    assert.equal(updated.result.read_back.ok, true);
    assert.ok(updated.result.changes.some((c) => c.change === "updated"));
    assert.ok(updated.verification.checks.includes("cas-baseline"));

    // CAS conflict: stale fingerprint → rejected, file content unchanged
    const rawBefore = await readFile(join(repo, "ldvh-base", "adrs", `adr-${uid}.md`), "utf8");
    const conflicted = await run(descriptors, "ldvh_adr_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: fp1, // stale
      frontmatter_after: read1.result.frontmatter,
      body_markdown_after: bodyAfter,
      change_summary: "过期指纹重试",
    }, repo);
    assert.equal(conflicted.outcome, "rejected", JSON.stringify(conflicted));
    assert.ok(conflicted.gaps.some((g) => g.includes("cas_conflict")));
    assert.ok(conflicted.follow_up.some((f) => f.includes("re-read")));

    const rawAfter = await readFile(join(repo, "ldvh-base", "adrs", `adr-${uid}.md`), "utf8");
    assert.equal(rawAfter, rawBefore);

    // a fresh read still reports the post-update fingerprint
    const read2 = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    assert.equal(read2.result.fingerprint, updated.result.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// renderEnvelope: full fingerprint + rich semantic lines (spark 修复批次的教训)
// ---------------------------------------------------------------------------

test("render: adr read output carries the FULL 64-char fingerprint and semantic lines (no ellipsis truncation)", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = validFrontmatterDraft();
    const created = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;
    const fp = created.result.fingerprint;
    assert.match(fp, /^[0-9a-f]{64}$/, "fingerprint must be a full 64-char hex SHA-256");

    const readOut = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    assert.equal(readOut.outcome, "completed", JSON.stringify(readOut));

    const blocks = descriptors["ldvh_adr_read"].output.render({ object_uid: uid }, { envelope: readOut });
    const text = blocks.map((b) => b.text).join("\n");
    assert.ok(text.includes(`fingerprint: ${fp}`), `render must carry the complete fingerprint:\n${text}`);
    assert.ok(text.includes(`title: ${draft.title}`), `render must carry the title:\n${text}`);
    assert.ok(text.includes("status: active"), `render must carry the status:\n${text}`);
    assert.ok(text.includes(`decision: ${draft.decision}`), `render must carry the decision:\n${text}`);
    assert.ok(text.includes(`scope: ${draft.scope}`), `render must carry the scope:\n${text}`);
    assert.ok(text.includes(`trigger_signal: ${draft.trigger_signal}`), `render must carry the trigger_signal:\n${text}`);
    assert.ok(text.includes("body_valid: true"), `render must carry body_valid:\n${text}`);
    assert.ok(!text.includes("…"), "render must not truncate with an ellipsis");
  });
});

test("render: retired read output carries retirement_reason (22 §9 terminal fields surface to the model)", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = validFrontmatterDraft();
    const created = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed");
    const uid = created.result.object_uid;

    const read1 = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    const toRetired = { ...read1.result.frontmatter, status: "retired", retirement_reason: "outdated" };
    const retired = await run(descriptors, "ldvh_adr_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: toRetired,
      body_markdown_after: validBodyMarkdown(draft),
      change_summary: "转入 retired",
    }, repo);
    assert.equal(retired.outcome, "completed", JSON.stringify(retired));

    const read2 = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    assert.equal(read2.outcome, "completed");
    assert.equal(read2.result.retirement_reason, "outdated");

    const blocks = descriptors["ldvh_adr_read"].output.render({ object_uid: uid }, { envelope: read2 });
    const text = blocks.map((b) => b.text).join("\n");
    assert.ok(text.includes("retirement_reason: outdated"), `render must carry retirement_reason:\n${text}`);
    assert.ok(text.includes("status: retired"), `render must carry the retired status:\n${text}`);
  });
});

// ---------------------------------------------------------------------------
// execution_error (handler throw → execution_error envelope)
// ---------------------------------------------------------------------------

test("execution_error: a throwing dshHomePath surfaces execution_error with the message in gaps", async () => {
  await withTemp("adr-tools.", async (base) => {
    const deps = makeDeps(join(base, "home"), base);
    const boomDeps = { ...deps, dshHomePath: () => { throw new Error("dsh home exploded"); } };
    const descriptors = makeDescriptors(boomDeps);

    for (const [tool, args] of [
      ["ldvh_adr_list", {}],
      ["ldvh_adr_read", { object_uid: "11111111-1111-4111-8111-111111111111" }],
      ["ldvh_adr_write", { action: "create", frontmatter_draft: validFrontmatterDraft(), body_markdown: validBodyMarkdown() }],
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
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const boomDeps = { ...deps, sessionPersistence: () => { throw new Error("persistence store down"); } };
    const descriptors = makeDescriptors(boomDeps);

    const out = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "execution_error", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("persistence store down")), JSON.stringify(out.gaps));
    const files = await readdir(join(repo, "ldvh-base", "adrs"));
    assert.equal(files.length, 0, "no write may have landed");
  });
});

// ---------------------------------------------------------------------------
// Schema layer (parameter schemas reject mis-shapes before the handler)
// ---------------------------------------------------------------------------

test("schema: adr-read-object requires object_uid", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/adr-tools.js");
  const desc = toolDescriptorFor("adr-read-object", OPERATIONS["adr-read-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {}, "args");
  assert.ok(violations.some((v) => v.includes("object_uid")), JSON.stringify(violations));
  assert.equal(validateJsonSchemaValue(desc.parameters, { object_uid: "11111111-1111-4111-8111-111111111111" }, "args").length, 0);
});

test("schema: adr-list-objects status is a closed set", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/adr-tools.js");
  const desc = toolDescriptorFor("adr-list-objects", OPERATIONS["adr-list-objects"], async () => ({}));
  const bad = validateJsonSchemaValue(desc.parameters, { status: "closed" }, "args");
  assert.ok(bad.some((v) => v.includes('must be one of ["active","all"]')), JSON.stringify(bad));
  assert.equal(validateJsonSchemaValue(desc.parameters, { status: "active" }, "args").length, 0);
  assert.equal(validateJsonSchemaValue(desc.parameters, { status: "all", limit: 5 }, "args").length, 0);
});

test("schema: adr-write-object enforces the frontmatter_draft shape", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/adr-tools.js");
  const desc = toolDescriptorFor("adr-write-object", OPERATIONS["adr-write-object"], async () => ({}));
  const missing = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { title: "只有标题" } }, "args");
  for (const field of ["decision", "scope"]) {
    assert.ok(missing.some((v) => v.includes(`frontmatter_draft.${field}`)), `missing ${field}: ${JSON.stringify(missing)}`);
  }
  const unknownField = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { ...validFrontmatterDraft(), bogus: 1 } }, "args");
  assert.ok(unknownField.some((v) => v.includes("frontmatter_draft.bogus") && v.includes("not a declared property")), JSON.stringify(unknownField));
});