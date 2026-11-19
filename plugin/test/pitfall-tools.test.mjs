import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as pitfallToolsModule from "../lib/pitfall-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, sessionPersistenceWithRoutingLog, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

const exec = (cwd, header = {}) => ({ agent: { session: { header: { cwd, ...header } } } });

function makeDescriptors(deps, { surface = "root" } = {}) {
  const registered = [];
  const ctx = {
    tools: {
      register: (descriptor) => {
        registered.push(descriptor);
        return () => {};
      },
    },
  };
  pitfallToolsModule.registerPitfallTools(ctx, deps, { surface });
  const byName = {};
  for (const descriptor of registered) byName[descriptor.name] = descriptor;
  return byName;
}

async function run(descriptors, toolName, args, cwd, header = {}) {
  try {
    const out = await descriptors[toolName].execute(args, exec(cwd, header));
    return out.envelope ?? out;
  } catch (error) {
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


function validFrontmatterDraft(overrides = {}) {
  return {
    title: "SG-4 落地后重复采坑（工具）",
    status: "active",
    scope: "适用于本仓库依赖升级场景；经验可信于同版本组合，跨大版本需重审。",
    trigger_signal: "当 SG-4 依赖升级时重审本经验",
    change_summary: "受控创建（测试夹具）",
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

async function governedFixture(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  await mkdir(join(repo, "ldvh-base", "pitfalls"), { recursive: true });
  await registerProject(dshHome(home), { id: "demo", path: repo });
  return { home, repo };
}

function makeDeps(home, base) {
  return {
    dshHomePath: dshHome(home),
    workspaceRoot: base,
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
  };
}



const ROOT_SURFACE = ["ldvh_pitfall_arm_delegate", "ldvh_pitfall_list", "ldvh_pitfall_read", "ldvh_pitfall_write"];
const CHILD_SURFACE = ["ldvh_pitfall_list", "ldvh_pitfall_read", "ldvh_pitfall_write"];

test("registerPitfallTools: 根面注册四个操作（含开工授权入口）", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const registered = [];
    const ctx = { tools: { register: (descriptor) => { registered.push(descriptor.name); return () => {}; } } };
    const deps = makeDeps(join(base, "home"), base);
    const dispose = pitfallToolsModule.registerPitfallTools(ctx, deps);
    assert.deepEqual([...registered].sort(), ROOT_SURFACE);
    assert.equal(typeof dispose, "function");
  });
});

test("registerPitfallTools: 分身面**不含**开工授权入口（授权不可自我繁殖）", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const registered = [];
    const ctx = { tools: { register: (descriptor) => { registered.push(descriptor.name); return () => {}; } } };
    const deps = makeDeps(join(base, "home"), base);
    pitfallToolsModule.registerPitfallTools(ctx, deps, { surface: "child" });
    assert.deepEqual([...registered].sort(), CHILD_SURFACE,
      "child 面必须恰好是 read/list/write 三个；含 arm 即允许分身给自己记授权");
  });
});


test("pitfall descriptors return text blocks from render and an object schema", async () => {
  const deps = makeDeps("/nope", "/nope");
  const descriptors = makeDescriptors(deps);
  for (const descriptor of Object.values(descriptors)) {
    const blocks = descriptor.output.render({}, { envelope: { operation_key: "pitfall-read-object", outcome: "completed", result: null, gaps: [] } });
    assert.ok(Array.isArray(blocks), "render must return an array");
    assert.equal(blocks[0].type, "text");
    assert.equal(descriptor.output.schema.type, "object");
  }
});


test("read/list/write are unavailable outside governed sessions", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const home = join(base, "home");
    await mkdir(join(home, "ldvh"), { recursive: true });
    const descriptors = makeDescriptors(makeDeps(home, base));
    const readOut = await run(descriptors, "ldvh_pitfall_read", { object_uid: "11111111-1111-4111-8111-111111111111" }, base);
    assert.equal(readOut.outcome, "unavailable");
    assert.ok(readOut.gaps[0].includes("not_governed"));
    const listOut = await run(descriptors, "ldvh_pitfall_list", {}, base);
    assert.equal(listOut.outcome, "unavailable");
    assert.ok(listOut.gaps[0].includes("not_governed"));
    const writeOut = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, base);
    assert.equal(writeOut.outcome, "unavailable");
    assert.ok(writeOut.gaps[0].includes("not_governed"));
  });
});


test("create: completed envelope, object_uid assigned, read-back ok, file on disk", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);

    assert.equal(created.outcome, "completed", JSON.stringify(created));
    assert.ok(created.result.object_uid);
    assert.equal(created.result.read_back.ok, true);
    assert.ok(created.result.changes.some((c) => c.change === "created"));
    assert.ok(created.verification.checks.includes("read-back"));

    const raw = await readFile(join(repo, "ldvh-base", "pitfalls", `pitfall-${created.result.object_uid}.md`), "utf8");
    assert.ok(raw.includes("fact_type_key"));
    assert.ok(raw.includes("# SG-4 落地后重复采坑（工具）"));
  });
});


test("create: mechanical rejection is outcome=rejected with zero writes", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = validFrontmatterDraft({
      urls: [{ ref: "https://example.com/evidence", title: "证据来源" }],
    });
    const bodyWithoutEvidence = validBodyMarkdown(draft).split("\n\n## 证据")[0];
    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: draft,
      body_markdown: bodyWithoutEvidence,
    }, repo);

    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("body_invalid")));
    assert.equal(out.verification.passed, false);
    const files = await readdir(join(repo, "ldvh-base", "pitfalls"));
    assert.equal(files.length, 0);
  });
});


test("read: created object returns completed with active status and matching fingerprint; missing uid rejected", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(created.outcome, "completed");
    const uid = created.result.object_uid;
    const fp = created.result.fingerprint;

    const readOut = await run(descriptors, "ldvh_pitfall_read", { object_uid: uid }, repo);
    assert.equal(readOut.outcome, "completed", JSON.stringify(readOut));
    assert.equal(readOut.result.frontmatter.status, "active");
    assert.equal(readOut.result.fingerprint, fp);

    const missing = await run(descriptors, "ldvh_pitfall_read", { object_uid: "99999999-9999-4999-8999-999999999999" }, repo);
    assert.equal(missing.outcome, "rejected");
    assert.ok(missing.gaps.some((g) => g.includes("object_not_found")));
  });
});


test("list: active-only by default; status=all includes discarded", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const mkDraft = (title) => ({ ...validFrontmatterDraft(), title, change_summary: "受控创建（清单夹具）" });
    const active1 = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: mkDraft("甲坑位（工具清单）"),
      body_markdown: validBodyMarkdown(mkDraft("甲坑位（工具清单）")),
    }, repo);
    assert.equal(active1.outcome, "completed", JSON.stringify(active1));

    const active2 = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: mkDraft("乙坑位（工具清单）"),
      body_markdown: validBodyMarkdown(mkDraft("乙坑位（工具清单）")),
    }, repo);
    assert.equal(active2.outcome, "completed", JSON.stringify(active2));

    const terminal = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: mkDraft("丙坑位（工具清单）"),
      body_markdown: validBodyMarkdown(mkDraft("丙坑位（工具清单）")),
    }, repo);
    assert.equal(terminal.outcome, "completed", JSON.stringify(terminal));
    const readTerminal = await run(descriptors, "ldvh_pitfall_read", { object_uid: terminal.result.object_uid }, repo);
    assert.equal(readTerminal.outcome, "completed");
    const toDiscarded = {
      ...readTerminal.result.frontmatter,
      status: "discarded",
      disposition: "前提消失：SG-4 已回滚该变更，机制不再存在。",
    };
    const discarded = await run(descriptors, "ldvh_pitfall_write", {
      action: "update",
      object_uid: terminal.result.object_uid,
      expected_fingerprint: terminal.result.fingerprint,
      frontmatter_after: toDiscarded,
      body_markdown_after: validBodyMarkdown(mkDraft("丙坑位（工具清单）")),
      change_summary: "转入 discarded",
    }, repo);
    assert.equal(discarded.outcome, "completed", JSON.stringify(discarded));

    const activeOnly = await run(descriptors, "ldvh_pitfall_list", {}, repo);
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
      assert.ok(item.scope.length > 0, "item must project scope");
      assert.equal(typeof item.trigger_signal, "string", "fixture declares a trigger_signal — it must be projected");
    }
    assert.equal(activeOnly.result.items.find((i) => i.object_uid === terminal.result.object_uid), undefined, "discarded Pitfall must not appear in the active-only list (23 §12)");

    const all = await run(descriptors, "ldvh_pitfall_list", { status: "all" }, repo);
    assert.equal(all.outcome, "completed", JSON.stringify(all));
    assert.equal(all.result.count, 3);
    assert.equal(all.result.total, 3);
    assert.equal(all.result.filter, "all");
    const allUids = all.result.items.map((i) => i.object_uid).sort();
    assert.deepEqual(allUids, [active1.result.object_uid, active2.result.object_uid, terminal.result.object_uid].sort());
    const discardedItem = all.result.items.find((i) => i.object_uid === terminal.result.object_uid);
    assert.equal(discardedItem.status, "discarded");
  });
});


test("update: CAS normal flow completed with new fingerprint; CAS conflict rejected with file unchanged", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const created = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(created.outcome, "completed");
    const uid = created.result.object_uid;
    const fp1 = created.result.fingerprint;

    const read1 = await run(descriptors, "ldvh_pitfall_read", { object_uid: uid }, repo);
    assert.equal(read1.outcome, "completed");

    const bodyAfter = [
      `## 症状\n升级后出现重复的解析失败（勘误后表述），报错指向同一异常签名。`,
      `## 触发条件\n升级 SG-4 到新大版本后首次运行归档读取流程时触发。`,
      `## 根因\nSG-4 内部缓存键变更，旧缓存未失效导致重复命中失败路径。`,
      `## 解决\n升级后清理缓存并重建索引；成功信号是读取流程连续通过。`,
      `## 规避\n后续升级前先比对缓存键语义；升级批次内同步清理。`,
      `## 验证\n已在测试环境观察 3 次连续成功；未覆盖多租户并发升级场景。`,
      `## 影响与适用范围\n${validFrontmatterDraft().scope}\n展开：何时可能踩到、经验何时可信。`,
    ].join("\n\n");

    const updated = await run(descriptors, "ldvh_pitfall_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: fp1,
      frontmatter_after: read1.result.frontmatter,
      body_markdown_after: bodyAfter,
      change_summary: "勘误：修正症状表述",
    }, repo);
    assert.equal(updated.outcome, "completed", JSON.stringify(updated));
    assert.notEqual(updated.result.fingerprint, fp1);
    assert.equal(updated.result.read_back.ok, true);
    assert.ok(updated.result.changes.some((c) => c.change === "updated"));
    assert.ok(updated.verification.checks.includes("cas-baseline"));

    const rawBefore = await readFile(join(repo, "ldvh-base", "pitfalls", `pitfall-${uid}.md`), "utf8");
    const conflicted = await run(descriptors, "ldvh_pitfall_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: fp1,
      frontmatter_after: read1.result.frontmatter,
      body_markdown_after: bodyAfter,
      change_summary: "过期指纹重试",
    }, repo);
    assert.equal(conflicted.outcome, "rejected", JSON.stringify(conflicted));
    assert.ok(conflicted.gaps.some((g) => g.includes("cas_conflict")));
    assert.ok(conflicted.follow_up.some((f) => f.includes("re-read")));

    const rawAfter = await readFile(join(repo, "ldvh-base", "pitfalls", `pitfall-${uid}.md`), "utf8");
    assert.equal(rawAfter, rawBefore);

    const read2 = await run(descriptors, "ldvh_pitfall_read", { object_uid: uid }, repo);
    assert.equal(read2.result.fingerprint, updated.result.fingerprint);
  });
});


test("render: pitfall read output carries the FULL 64-char fingerprint and semantic lines (no ellipsis truncation)", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = validFrontmatterDraft();
    const created = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;
    const fp = created.result.fingerprint;
    assert.match(fp, /^[0-9a-f]{64}$/, "fingerprint must be a full 64-char hex SHA-256");

    const readOut = await run(descriptors, "ldvh_pitfall_read", { object_uid: uid }, repo);
    assert.equal(readOut.outcome, "completed", JSON.stringify(readOut));

    const blocks = descriptors["ldvh_pitfall_read"].output.render({ object_uid: uid }, { envelope: readOut });
    const text = blocks.map((b) => b.text).join("\n");
    assert.ok(text.includes(`fingerprint: ${fp}`), `render must carry the complete fingerprint:\n${text}`);
    assert.ok(text.includes(`title: ${draft.title}`), `render must carry the title:\n${text}`);
    assert.ok(text.includes("status: active"), `render must carry the status:\n${text}`);
    assert.ok(text.includes(`scope: ${draft.scope}`), `render must carry the scope:\n${text}`);
    assert.ok(text.includes(`trigger_signal: ${draft.trigger_signal}`), `render must carry the trigger_signal:\n${text}`);
    assert.ok(text.includes("body_valid: true"), `render must carry body_valid:\n${text}`);
    assert.ok(!text.includes("…"), "render must not truncate with an ellipsis");
  });
});

test("render: create output carries the full fingerprint and read_back without truncation", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = validFrontmatterDraft();
    const created = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));

    const blocks = descriptors["ldvh_pitfall_write"].output.render({ action: "create" }, { envelope: created });
    const text = blocks.map((b) => b.text).join("\n");
    assert.ok(text.includes(`fingerprint: ${created.result.fingerprint}`), `render must carry the complete fingerprint:\n${text}`);
    assert.ok(text.includes("read_back: ok"), `render must carry read_back:\n${text}`);
    assert.ok(
      text.includes(`object: pitfall-${created.result.object_uid.slice(0, 8)}`),
      `render must carry the type-prefixed reference:\n${text}`,
    );
    assert.ok(!text.includes("…"), "render must not truncate with an ellipsis");
  });
});

test("render: discarded read output carries disposition (23 §9 terminal fields surface to the model)", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(home, base));

    const draft = validFrontmatterDraft();
    const created = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: draft,
      body_markdown: validBodyMarkdown(draft),
    }, repo);
    assert.equal(created.outcome, "completed");
    const uid = created.result.object_uid;

    const read1 = await run(descriptors, "ldvh_pitfall_read", { object_uid: uid }, repo);
    const toDiscarded = {
      ...read1.result.frontmatter,
      status: "discarded",
      disposition: "前提消失：SG-4 已回滚该变更，机制不再存在。",
    };
    const discarded = await run(descriptors, "ldvh_pitfall_write", {
      action: "update",
      object_uid: uid,
      expected_fingerprint: read1.result.fingerprint,
      frontmatter_after: toDiscarded,
      body_markdown_after: validBodyMarkdown(draft),
      change_summary: "转入 discarded",
    }, repo);
    assert.equal(discarded.outcome, "completed", JSON.stringify(discarded));

    const read2 = await run(descriptors, "ldvh_pitfall_read", { object_uid: uid }, repo);
    assert.equal(read2.outcome, "completed");
    assert.equal(read2.result.disposition, "前提消失：SG-4 已回滚该变更，机制不再存在。");

    const blocks = descriptors["ldvh_pitfall_read"].output.render({ object_uid: uid }, { envelope: read2 });
    const text = blocks.map((b) => b.text).join("\n");
    assert.ok(text.includes("disposition: 前提消失：SG-4 已回滚该变更，机制不再存在。"), `render must carry disposition:\n${text}`);
    assert.ok(text.includes("status: discarded"), `render must carry the discarded status:\n${text}`);
  });
});


test("execution_error: a throwing dshHomePath surfaces execution_error with the message in gaps", async () => {
  await withTemp("pitfall-tools.", async (base) => {
    const deps = makeDeps(join(base, "home"), base);
    const boomDeps = { ...deps, dshHomePath: () => { throw new Error("dsh home exploded"); } };
    const descriptors = makeDescriptors(boomDeps);

    for (const [tool, args] of [
      ["ldvh_pitfall_list", {}],
      ["ldvh_pitfall_read", { object_uid: "11111111-1111-4111-8111-111111111111" }],
      ["ldvh_pitfall_write", { action: "create", frontmatter_draft: validFrontmatterDraft(), body_markdown: validBodyMarkdown() }],
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
  await withTemp("pitfall-tools.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const deps = makeDeps(home, base);
    const boomDeps = { ...deps, sessionPersistence: () => { throw new Error("persistence store down"); } };
    const descriptors = makeDescriptors(boomDeps);

    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo);
    assert.equal(out.outcome, "execution_error", JSON.stringify(out));
    assert.ok(out.gaps.some((g) => g.includes("persistence store down")), JSON.stringify(out.gaps));
    const files = await readdir(join(repo, "ldvh-base", "pitfalls"));
    assert.equal(files.length, 0, "no write may have landed");
  });
});


test("schema: pitfall-read-object requires object_uid", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/pitfall-tools.js");
  const desc = toolDescriptorFor("pitfall-read-object", OPERATIONS["pitfall-read-object"], async () => ({}));
  assert.ok(
    desc.parameters.properties?.object_uid !== undefined,
    "object_uid must be a declared parameter",
  );
  assert.equal(validateJsonSchemaValue(desc.parameters, { object_uid: "11111111-1111-4111-8111-111111111111" }, "args").length, 0);
});

test("schema: pitfall-list-objects status is a closed set", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/pitfall-tools.js");
  const desc = toolDescriptorFor("pitfall-list-objects", OPERATIONS["pitfall-list-objects"], async () => ({}));
  const bad = validateJsonSchemaValue(desc.parameters, { status: "closed" }, "args");
  assert.ok(bad.some((v) => v.includes('must be one of ["active","all"]')), JSON.stringify(bad));
  assert.equal(validateJsonSchemaValue(desc.parameters, { status: "active" }, "args").length, 0);
  assert.equal(validateJsonSchemaValue(desc.parameters, { status: "all", limit: 5 }, "args").length, 0);
  const pending = validateJsonSchemaValue(desc.parameters, { status: "pending" }, "args");
  assert.ok(pending.some((v) => v.includes('must be one of ["active","all"]')), JSON.stringify(pending));
});

test("schema: pitfall-write-object enforces the frontmatter_draft shape", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/pitfall-tools.js");
  const desc = toolDescriptorFor("pitfall-write-object", OPERATIONS["pitfall-write-object"], async () => ({}));
  const missing = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { title: "只有标题" } }, "args");
  assert.ok(missing.some((v) => v.includes("frontmatter_draft.scope")), `missing scope: ${JSON.stringify(missing)}`);
  const missingTitle = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { scope: "只有范围" } }, "args");
  assert.ok(missingTitle.some((v) => v.includes("frontmatter_draft.title")), `missing title: ${JSON.stringify(missingTitle)}`);
  const unknownField = validateJsonSchemaValue(desc.parameters, { action: "create", frontmatter_draft: { ...validFrontmatterDraft(), bogus: 1 } }, "args");
  assert.ok(unknownField.some((v) => v.includes("frontmatter_draft.bogus") && v.includes("not a declared property")), JSON.stringify(unknownField));
});

const { createExperienceArming } = await import("../lib/experience-arming.js");
const { realpath } = await import("node:fs/promises");

const childHeader = (childId, parentId) => ({
  id: childId,
  origin: "subagent",
  parentSession: parentId,
  delegationDepth: 1,
  isSeeded: false
});

async function armedFixture(base, { childId = "session-child-1", parentId = "session-parent-1" } = {}) {
  const { home, repo } = await governedFixture(base);
  const arming = createExperienceArming({ dshHomePath: dshHome(home) });
  const projectPath = await realpath(repo);
  const armed = await arming.arm({ parentSessionId: parentId, projectPath, projectId: "demo", purpose: "记录本轮升级踩坑" });
  assert.equal(armed.ok, true, JSON.stringify(armed));
  const bound = arming.bindForChild({ parentSessionId: parentId, childSessionId: childId, projectPath });
  assert.equal(bound.ok, true, JSON.stringify(bound));
  const deps = { ...makeDeps(home, base), experienceArming: arming };
  return { home, repo, arming, deps, projectPath, childId, parentId, armed: armed.value.arming };
}

test("分身 create：授权有效时落盘为 active 并完成写后回读", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { repo, deps, childId, parentId } = await armedFixture(base);
    const descriptors = makeDescriptors(deps, { surface: "child" });
    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo, childHeader(childId, parentId));
    assert.equal(out.outcome, "completed", JSON.stringify(out));
    assert.ok(out.result.object_uid);
    assert.equal(out.result.read_back.ok, true, "分身的写入同样必须写后精确回读（03 §9.4）");
  });
});

test("分身 update：一律拒绝——终态流转与勘误不属其授权范围（审核 B4）", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { repo, deps, childId, parentId } = await armedFixture(base);
    const descriptors = makeDescriptors(deps, { surface: "child" });
    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "update",
      object_uid: "00000001-1111-4111-8111-111111111111",
      expected_fingerprint: "x".repeat(64),
      frontmatter_after: {},
      body_markdown_after: validBodyMarkdown(),
      change_summary: "分身尝试废止",
    }, repo, childHeader(childId, parentId));
    assert.equal(out.outcome, "rejected");
    assert.ok(out.gaps[0].includes("delegated_caller_may_only_create"), JSON.stringify(out.gaps));
    assert.ok(out.verification.passed === false);
  });
});

test("未绑定的分身写入被拒（child_not_armed）——注册面给了也不放行", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { repo, deps, parentId } = await armedFixture(base);
    const descriptors = makeDescriptors(deps, { surface: "child" });
    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo, childHeader("session-some-other-child", parentId));
    assert.equal(out.outcome, "rejected");
    assert.ok(out.gaps[0].includes("child_not_armed"), JSON.stringify(out.gaps));
  });
});

test("授权过期后写入被拒（arming_expired）——一次性与存活期是两道闸", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { home, repo } = await governedFixture(base);
    let clock = 1_700_000_000_000;
    const arming = createExperienceArming({ dshHomePath: dshHome(home), now: () => clock });
    const projectPath = await realpath(repo);
    await arming.arm({ parentSessionId: "p1", projectPath, purpose: "短时授权", ttlMs: 1000 });
    arming.bindForChild({ parentSessionId: "p1", childSessionId: "c1", projectPath });
    clock += 5000;
    const deps = { ...makeDeps(home, base), experienceArming: arming };
    const descriptors = makeDescriptors(deps, { surface: "child" });
    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo, childHeader("c1", "p1"));
    assert.equal(out.outcome, "rejected");
    assert.ok(out.gaps[0].includes("arming_expired"), JSON.stringify(out.gaps));
  });
});

test("项目错位被拒（审核 B5）——分身不得把经验写进另一个受辖项目", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { home, deps, childId, parentId } = await armedFixture(base);
    const otherRepo = await initRepo(base, { name: "other" });
    await registerProject(dshHome(home), { id: "other", path: otherRepo });
    const descriptors = makeDescriptors(deps, { surface: "child" });
    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, otherRepo, childHeader(childId, parentId));
    assert.equal(out.outcome, "rejected");
    assert.ok(out.gaps[0].includes("project_mismatch"),
      "必须命中项目对齐这道闸，而不是更早的治理判定：" + JSON.stringify(out.gaps));
  });
});

test("分身调用开工授权入口被拒（root_session_only）——授权不可自我繁殖", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { repo, deps, childId, parentId } = await armedFixture(base);
    const descriptors = makeDescriptors(deps, { surface: "root" });
    const out = await run(descriptors, "ldvh_pitfall_arm_delegate", {
      purpose: "再开一个分身"
    }, repo, childHeader(childId, parentId));
    assert.equal(out.outcome, "rejected");
    assert.ok(out.gaps[0].includes("root_session_only"), JSON.stringify(out.gaps));
  });
});

test("根会话授权：purpose 缺失即拒，且授权账落盘可回读", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const arming = createExperienceArming({ dshHomePath: dshHome(home) });
    const descriptors = makeDescriptors({ ...makeDeps(home, base), experienceArming: arming });
    const missing = await run(descriptors, "ldvh_pitfall_arm_delegate", {}, repo, { id: "root-1" });
    assert.equal(missing.outcome, "invalid_request", JSON.stringify(missing));

    const good = await run(descriptors, "ldvh_pitfall_arm_delegate", { purpose: "记录本轮经验" }, repo, { id: "root-1" });
    assert.equal(good.outcome, "completed", JSON.stringify(good));
    assert.ok(good.result.arming_id);
    assert.ok(good.result.grants.includes("仅") || good.result.grants.includes("only"),
      "授权范围须回给调用方，含「只能新建」这条最易被忽略的边界");
    const reloaded = createExperienceArming({ dshHomePath: dshHome(home) });
    await reloaded.load();
    assert.equal(reloaded.list().some((e) => e.arming_id === good.result.arming_id), true);
  });
});

test("装配缺失时分身写入 unavailable（fail-closed，不降级放行）", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { repo } = await governedFixture(base);
    const descriptors = makeDescriptors(makeDeps(join(base, "home"), base), { surface: "child" });
    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft(),
      body_markdown: validBodyMarkdown(),
    }, repo, childHeader("c1", "p1"));
    assert.equal(out.outcome, "unavailable");
    assert.ok(out.gaps[0].includes("arming_ledger_unavailable"), JSON.stringify(out.gaps));
  });
});

test("根会话（非分身）写入不受本收窄影响——既有路径逐字保持", async () => {
  await withTemp("pitfall-arm.", async (base) => {
    const { repo, deps } = await armedFixture(base);
    const descriptors = makeDescriptors(deps);
    const out = await run(descriptors, "ldvh_pitfall_write", {
      action: "create",
      frontmatter_draft: validFrontmatterDraft({ title: "主控自行记录的经验" }),
      body_markdown: validBodyMarkdown(validFrontmatterDraft({ title: "主控自行记录的经验" })),
    }, repo, { id: "root-1" });
    assert.equal(out.outcome, "completed", JSON.stringify(out));
  });
});
