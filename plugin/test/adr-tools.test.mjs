// Tests for plugin/lib/adr-tools.js — the runtime wiring of the ADR
// mechanical layer (specs/22 §13 受控操作 + specs/03 §9) into the governed
// ldvh_* tool surface.
//
// Coverage follows the spark-tools.test.mjs pattern: handlers are driven
// through registerAdrTools's descriptors with a mock ctx.tools registry, a
// real governed-project fixture (tmp repo + registration), and the full
// 05 §8 envelope shape is asserted, not just the result.
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as adrToolsModule from "../lib/adr-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, sessionPersistenceWithRoutingLog, withTemp } from "./helpers.mjs";

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
  try {
    const out = await descriptors[toolName].execute(args, exec(cwd));
    return out.envelope ?? out;
  } catch (error) {
    // 参数层（DSH defineTool）在 handler 之前拒绝时抛 ToolArgsError。这些用例多数要证
    // 「非法输入被拒」，而参数层拦下是比 handler 拦下更强的结果，故归一成一个可断言的
    // 形态，并在 gaps 里标明层次，避免测试把「哪一层拒的」当成「有没有拒」。
    if (error?.name === "ToolArgsError" || Array.isArray(error?.violations)) {
      return {
        outcome: "rejected",
        result: null,
        gaps: [`parameter_schema: ${String(error?.message ?? error)}`],
        scope: { requested: null, completed: [], not_completed: [toolName] },
        verification: { checks: [], passed: false },
        follow_up: [],
        rejected_at: "parameter_schema",
      };
    }
    throw error;
  }
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

function makeDeps(home, base, { hostSeams } = {}) {
  return {
    dshHomePath: dshHome(home),
    workspaceRoot: base,
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
    // 22 §16 的两道 Human Gate 经 deps.hostSeams 注入（host-seams.js 的 seam 在
    // 单元测试里不会真正 install）。默认给一个同意的 seam，否则每个 create/retire
    // 都会 fail-closed；要断言拒绝路径的用例显式传 hostSeams: null 或拒绝版。
    ...(hostSeams === null ? {} : { hostSeams: hostSeams ?? consentingSeam() }),
  };
}

/** Fake host-seam registry whose ADR confirmation answerer is driven by `reply`.
 * Mirrors `sparkSeam` in spark-tools.test.mjs: the gate is injected through
 * `deps.hostSeams`, NOT through ctx. */
function adrSeam(reply) {
  const calls = [];
  return {
    calls,
    requestAdrConsent: async (payload) => {
      calls.push(payload);
      return reply(payload);
    },
  };
}

/** Default consenting answerer for the fixtures below. */
function consentingSeam() {
  return adrSeam(() => ({ granted: true, answer: "确认" }));
}

/** 22 §14.1 dedup conclusion required on create. */
const DEDUP_OK = "查重结论（测试夹具）：与本仓库既有 active ADR 无同主题重叠。";

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
      dedup_result: DEDUP_OK,
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
      dedup_result: DEDUP_OK,
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
      dedup_result: DEDUP_OK,
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
      dedup_result: DEDUP_OK,
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
      dedup_result: DEDUP_OK,
    }, repo);
    assert.equal(active1.outcome, "completed", JSON.stringify(active1));

    const active2 = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: mkDraft("乙决策（工具清单）"),
      body_markdown: validBodyMarkdown(mkDraft("乙决策（工具清单）")),
      dedup_result: DEDUP_OK,
    }, repo);
    assert.equal(active2.outcome, "completed", JSON.stringify(active2));

    const terminal = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: mkDraft("丙决策（工具清单）"),
      body_markdown: validBodyMarkdown(mkDraft("丙决策（工具清单）")),
      dedup_result: DEDUP_OK,
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
      dedup_result: DEDUP_OK,
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
      dedup_result: DEDUP_OK,
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
      dedup_result: DEDUP_OK,
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
      dedup_result: DEDUP_OK,
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
  // 必填由 handler 的 invalid_request 信封承担（保留 gaps + follow_up 可操作提示），
  // 不在参数层强制；参数层负责类型/枚举/嵌套形状。故此处断言参数表**声明了** object_uid。
  assert.ok(
    desc.parameters.properties?.object_uid !== undefined,
    "object_uid must be a declared parameter",
  );
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
test("schema + handler: action=correct 拒绝 frontmatter_after / frontmatter_removals（22 §13 不接收）", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/adr-tools.js");
  const desc = toolDescriptorFor("adr-write-object", OPERATIONS["adr-write-object"], async () => ({}));
  // schema 层：enum 含 correct，且 human_authorization 已公布
  assert.ok(desc.parameters.properties.action.enum.includes("correct"), JSON.stringify(desc.parameters.properties.action.enum));
  assert.ok("human_authorization" in desc.parameters.properties, "human_authorization must be declared for correct");
});

// ---------------------------------------------------------------------------
// 22 §16 Human Gate
//
// 22 §16 把「ADR 的创建」（第 1 项）与「ADR 的终态决定 retired」（第 2 项）定为
// Human Gate，13 又写明创建是「Human 确认后经受控创建入口落盘」。此前实现侧零
// 承载：两个写入点都不经任何询问即可落盘，AI 能在没有 Human 回应时让一条对全仓
// 有法定约束力的决策生效或退出基线。本组用例钉住两条 Gate 的接线。
//
// 判据的可分辨性要求：必须经 lib/adr-tools.js 的 toolDescriptorFor 取描述符——
// 既有 plugin/test/ldvh-tools.test.mjs:1188-1211 那组断言走 lib/ldvh-tools.js 的
// 聚合 OPERATIONS，而该表不含任何 adr 条目，照抄会空转通过（friction-661831ae）。
// ---------------------------------------------------------------------------

test("22 §16: create 取确认，seam 收到含查重结论／决定／适用范围的呈报", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(home, base, { hostSeams: seam }));
    const out = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
      dedup_result: DEDUP_OK,
    }, repo);
    assert.equal(out.outcome, "completed", JSON.stringify(out));
    assert.equal(seam.calls.length, 1, "the 22 §16 Gate must be asked exactly once");
    assert.equal(seam.calls[0].action, "create");
    for (const needle of ["查重结论", "决定陈述", "适用范围", DEDUP_OK]) {
      assert.ok(seam.calls[0].summary.includes(needle), `呈报 must carry ${needle}: ${seam.calls[0].summary}`);
    }
    assert.ok(seam.calls[0].summary.includes(validFrontmatterDraft().decision), "呈报 must carry the decision itself");
  });
});

test("22 §16: 无 seam 时 create 返回 unavailable 且零写入（fail-closed）", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base, { hostSeams: null }));
    const out = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
      dedup_result: DEDUP_OK,
    }, repo);
    assert.equal(out.outcome, "unavailable", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("22 §16")), JSON.stringify(out.gaps));
    assert.equal((await readdir(join(repo, "ldvh-base", "adrs"))).length, 0, "zero write on a refused gate");
  });
});

test("22 §16: Human 拒绝时 create 返回 rejected 且零写入", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const seam = adrSeam(() => ({ granted: false, reason: "human did not confirm (declined)" }));
    const descriptors = makeDescriptors(makeDeps(home, base, { hostSeams: seam }));
    const out = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
      dedup_result: DEDUP_OK,
    }, repo);
    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    assert.equal((await readdir(join(repo, "ldvh-base", "adrs"))).length, 0, "zero write when the Human declines");
  });
});

test("22 §16: 空答复（人跳过）也是未决策 —— create 被拒且零写入", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    // 宿主把空答复表示为 granted:false（selected 为空数组）；此处直接模拟
    // 「答应了别的问题」这一形态，确认解析不会回落到 answers[0]。
    const seam = adrSeam(() => ({ granted: false, reason: "no selection" }));
    const descriptors = makeDescriptors(makeDeps(home, base, { hostSeams: seam }));
    const out = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
      dedup_result: DEDUP_OK,
    }, repo);
    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    assert.equal((await readdir(join(repo, "ldvh-base", "adrs"))).length, 0);
  });
});

test("22 §14.1: 缺 dedup_result 时 create 不提问、直接 invalid_request 且零写入", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(home, base, { hostSeams: seam }));
    const out = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "invalid_request", JSON.stringify(out));
    assert.ok(out.gaps[0].includes("dedup_result"), JSON.stringify(out.gaps));
    assert.equal(seam.calls.length, 0, "no question is asked before the dedup conclusion exists");
    assert.equal((await readdir(join(repo, "ldvh-base", "adrs"))).length, 0);
  });
});

test("22 §16: 退休（active → retired）取确认，呈报含理由与据实说明全文", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(home, base, { hostSeams: seam }));
    const created = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
      dedup_result: DEDUP_OK,
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;
    const read1 = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    const fm = read1.result.frontmatter;

    const EVIDENCE = "前提已随 SG-4 落地而消失；既有承载为 specs/20 §11 与 spark-writer.js 的写入前置校验，可被测试持续核对。";
    seam.calls.length = 0;
    const retired = await run(descriptors, "ldvh_adr_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: { ...fm, status: "retired", retirement_reason: "outdated" },
      body_markdown_after: read1.result.body,
      change_summary: EVIDENCE,
    }, repo);

    assert.equal(retired.outcome, "completed", JSON.stringify(retired));
    assert.equal(seam.calls.length, 1, "the 22 §16 terminal Gate must be asked exactly once");
    assert.equal(seam.calls[0].action, "retire");
    for (const needle of ["retired", "outdated", "据实说明", EVIDENCE]) {
      assert.ok(seam.calls[0].summary.includes(needle), `退休呈报 must carry ${needle}: ${seam.calls[0].summary}`);
    }
  });
});

test("22 §16: 退休被拒时对象保持 active、指纹不变（零写入）", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const { home: _h } = { home };
    const descriptors = makeDescriptors(makeDeps(home, base, { hostSeams: consentingSeam() }));
    const created = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
      dedup_result: DEDUP_OK,
    }, repo);
    const uid = created.result.object_uid;
    const read1 = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);

    const declining = makeDescriptors(makeDeps(home, base, {
      hostSeams: adrSeam(() => ({ granted: false, reason: "human did not confirm (declined)" })),
    }));
    const refused = await run(declining, "ldvh_adr_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: { ...read1.result.frontmatter, status: "retired", retirement_reason: "outdated" },
      body_markdown_after: read1.result.body,
      change_summary: "拟退休（应被拒）",
    }, repo);
    assert.equal(refused.outcome, "rejected", JSON.stringify(refused));

    const read2 = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    assert.equal(read2.result.status, "active", "a refused retirement must leave the object active");
    assert.equal(read2.result.fingerprint, read1.result.fingerprint, "zero write: fingerprint unchanged");
  });
});

test("22 §16: active → active 勘误更新不触发 Gate（22 §9.3 不是 Human Gate 对象）", async () => {
  await withTemp("adr-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const seam = consentingSeam();
    const descriptors = makeDescriptors(makeDeps(home, base, { hostSeams: seam }));
    const created = await run(descriptors, "ldvh_adr_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
      dedup_result: DEDUP_OK,
    }, repo);
    const uid = created.result.object_uid;
    const read1 = await run(descriptors, "ldvh_adr_read", { object_uid: uid }, repo);
    seam.calls.length = 0;
    const errata = await run(descriptors, "ldvh_adr_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: { ...read1.result.frontmatter, trigger_signal: "当 SG-5 落地时重审本决策" },
      body_markdown_after: read1.result.body,
      change_summary: "勘误：更新重审信号",
    }, repo);
    assert.equal(errata.outcome, "completed", JSON.stringify(errata));
    assert.equal(seam.calls.length, 0, "an errata update must not be gated");
  });
});

// ---------------------------------------------------------------------------
// 描述符：awaitsHumanDecision 的消费与旁及工具的 timeoutMs
//
// **必须经 lib/adr-tools.js 的 toolDescriptorFor**：lib/ldvh-tools.js 的聚合
// OPERATIONS 不含 adr 条目，其 toolDescriptor 早已是条件展开——照它的断言写这个
// 用例会空转通过，测不到本改动（friction-661831ae 的同型失效）。
// ---------------------------------------------------------------------------

test("descriptor: adr_write 无 timeoutMs，adr_read/adr_list 仍保留正上界", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/adr-tools.js");
  const descs = {};
  for (const [key, op] of Object.entries(OPERATIONS)) {
    descs[op.toolName] = toolDescriptorFor(key, op, async () => ({}));
  }
  assert.equal(
    "timeoutMs" in descs["ldvh_adr_write"],
    false,
    "adr write must drop timeoutMs — a 30s deadline would DISCARD a late Human answer and leave the 22 §16 Gate unenforced"
  );
  for (const name of ["ldvh_adr_read", "ldvh_adr_list"]) {
    assert.equal(descs[name].timeoutMs, 30000, `${name} is purely mechanical and must keep its bounded budget`);
  }
});

test("descriptor: OPERATIONS declares awaitsHumanDecision for adr-write-object", async () => {
  const { OPERATIONS } = await import("../lib/adr-tools.js");
  assert.equal(OPERATIONS["adr-write-object"].awaitsHumanDecision, true);
  assert.equal(OPERATIONS["adr-read-object"].awaitsHumanDecision, undefined);
  assert.equal(OPERATIONS["adr-list-objects"].awaitsHumanDecision, undefined);
});

test("schema: dedup_result 已公布且 create 需要它", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/adr-tools.js");
  const desc = toolDescriptorFor("adr-write-object", OPERATIONS["adr-write-object"], async () => ({}));
  assert.ok("dedup_result" in desc.parameters.properties, "dedup_result must be declared in the schema");
  assert.equal(typeof desc.parameters.properties.dedup_result.type, "string");
});
