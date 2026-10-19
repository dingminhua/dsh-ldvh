// Tests for the fact-object reference form (specs/02 §9.3 候选条款): every
// controlled tool response that names an object renders「类型短名 + 短标识」
// (`pitfall-bb0fe837`), never a bare 8-hex id, and the writer projections carry
// `fact_type_key` so the rendering layer never has to hard-code a type name
// (a second authority — 03 §7.1/§7.2).
//
// The three axes covered here map 1:1 onto the authorised four layers:
//   - writer projection + list rendering (:①②)
//   - read envelope + change log (:②③)
//   - a render point outside the spark tool (:④)
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as sparkToolsModule from "../lib/spark-tools.js";
import * as pitfallToolsModule from "../lib/pitfall-tools.js";
import * as workcaseToolsModule from "../lib/workcase-tools.js";
import { listSparkObjects } from "../lib/spark-writer.js";
import { listWorkcaseObjects } from "../lib/workcase-writer.js";
import { objectRef, objectRefOf, promptObjectRef } from "../lib/object-reference.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, sessionPersistenceWithRoutingLog, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);
const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });

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
`;

function consentingSeam() {
  return { requestSparkConsent: async () => ({ granted: true, answer: "确认" }) };
}

function makeDescriptors(register, deps) {
  const registered = [];
  const ctx = { tools: { register: (descriptor) => { registered.push(descriptor); return () => {}; } } };
  register(ctx, deps);
  const byName = {};
  for (const descriptor of registered) byName[descriptor.name] = descriptor;
  return byName;
}

async function run(descriptors, toolName, args, cwd) {
  const out = await descriptors[toolName].execute(args, exec(cwd));
  return out.envelope ?? out;
}

function renderText(descriptor, args, envelope) {
  return descriptor.output.render(args, { envelope }).map((block) => block.text).join("\n");
}

const SPARK_UID_RE = /spark-([0-9a-f]{8})/;

// ---------------------------------------------------------------------------
// The single form generator
// ---------------------------------------------------------------------------

test("objectRef: minimum form is type + 8-hex short id", () => {
  assert.equal(objectRef({ object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "workcase" }), "workcase-996e207a");
});

test("objectRef: title is appended only when asked (02 §9.3 第 2 条 is the writer's reader judgement)", () => {
  const item = { object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "workcase", title: "事实对象指称须带类型与标题" };
  assert.equal(objectRef(item), "workcase-996e207a");
  assert.equal(objectRef(item, { withTitle: true }), "workcase-996e207a 事实对象指称须带类型与标题");
});

test("objectRef: an unknown type degrades to the bare short id instead of fabricating a type", () => {
  // 猜造类型比缺类型更坏：读者会以为该对象属于一个它并不属于的类型。
  assert.equal(objectRef({ object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "unknown-type" }), "996e207a");
  assert.equal(objectRef({ object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7" }), "996e207a");
});

test("objectRef: a missing uid renders as empty, never as a partial reference", () => {
  assert.equal(objectRef({ fact_type_key: "spark", title: "t" }), "");
  assert.equal(objectRef(undefined), "");
  assert.equal(objectRefOf("", "spark"), "");
});

test("promptObjectRef keeps the FULL uid for executors that must echo it back", () => {
  // 执行体要把 object_uid 作为结构化字段回填；截成 8 位会让它无从回填合法值。
  const item = { object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "friction", title: "CI 平均 8 分钟" };
  assert.equal(promptObjectRef(item), "friction-996e207a CI 平均 8 分钟 (996e207a-3ca2-494b-bcbe-3f00d7c0c3b7)");
});

// ---------------------------------------------------------------------------
// Layers ①②: writer projection + list rendering
// ---------------------------------------------------------------------------

async function governedFixture(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  await mkdir(join(repo, "ldvh-base", "sparks"), { recursive: true });
  await writeFile(join(repo, "ldvh-base", "goal.md"), GOAL_MD_FIXTURE, "utf8");
  await registerProject(dshHome(home), { id: "demo", path: repo });
  return { home, repo };
}

function sparkDeps(home, base) {
  return {
    dshHomePath: dshHome(home),
    workspaceRoot: base,
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
    hostSeams: consentingSeam(),
  };
}

test("spark list: every item line carries a type-prefixed reference, and the projection carries fact_type_key", async () => {
  await withTemp("object-reference.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(sparkToolsModule.registerSparkTools, sparkDeps(home, base));

    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: "查重结论（测试夹具）：与本仓库既有 Spark 无同题重叠。",
      frontmatter_draft: {
        title: "指称形态（测试夹具）",
        question: "工具响应中的对象指称应当长什么样？",
        scope_boundary: "仅以本仓库单元测试为证据。",
        intent: "钉住 02 §9.3 的指称形态。",
        summary: "工具响应已按形态渲染。",
        change_summary: "受控创建（测试夹具）",
      },
      body_markdown: [
        "## 当前理解\n工具响应已按形态渲染。",
        "## 调查问题\n工具响应中的对象指称应当长什么样？",
        "## 调查边界\n仅以本仓库单元测试为证据。",
      ].join("\n\n"),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));

    // ① writer 投影：fact_type_key 必须可达——否则渲染层只能硬编码类型短名。
    const listed = await run(descriptors, "ldvh_spark_list", {}, repo);
    assert.equal(listed.outcome, "completed", JSON.stringify(listed));
    assert.equal(listed.result.items[0].fact_type_key, "spark", "F1 projection must carry fact_type_key");

    // ① 列表渲染：行首是 `spark-<8hex>`，不是裸 uid。
    const listText = renderText(descriptors["ldvh_spark_list"], {}, listed);
    const itemLine = listText.split("\n").find((line) => line.startsWith("- ")) ?? "";
    const match = SPARK_UID_RE.exec(itemLine);
    assert.ok(match, `list line must carry a type-prefixed reference:\n${listText}`);
    assert.equal(match[1], created.result.object_uid.slice(0, 8), "the short id must be the uid prefix");

    // ② 读取 envelope + ③ 变更流水：同样带类型短名。
    const read = await run(descriptors, "ldvh_spark_read", { object_uid: created.result.object_uid }, repo);
    assert.equal(read.outcome, "completed", JSON.stringify(read));
    const readText = renderText(descriptors["ldvh_spark_read"], { object_uid: created.result.object_uid }, read);
    assert.ok(
      readText.split("\n").includes(`object: spark-${created.result.object_uid.slice(0, 8)}`),
      `read envelope must carry the reference:\n${readText}`,
    );
    // ③ 变更流水在 **write** 的响应里（read 不产生流水）。
    const writeText = renderText(descriptors["ldvh_spark_write"], { action: "create" }, created);
    assert.ok(
      writeText.split("\n").includes(`change: created spark-${created.result.object_uid.slice(0, 8)}`),
      `change line must carry the reference:\n${writeText}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Layer ④: a render point outside the spark tool
// ---------------------------------------------------------------------------

test("pitfall list: the projection carries fact_type_key and the rendered line is type-prefixed", () => {
  // 直接驱动 render，不经文件系统：本用例钉住的是**形态**，不是写入通道。
  const descriptor = makeDescriptors(pitfallToolsModule.registerPitfallTools, {
    dshHomePath: () => "/nope",
    workspaceRoot: "/nope",
  })["ldvh_pitfall_list"];
  const envelope = {
    operation_key: "pitfall-list-objects",
    outcome: "completed",
    result: {
      count: 1,
      items: [{ object_uid: "bb0fe837-2a8f-4f4e-b17a-a0200abc116b", fact_type_key: "pitfall", title: "裸标识指称（测试夹具）", status: "active" }],
      invalid: [],
    },
    gaps: [],
  };
  const text = renderText(descriptor, {}, envelope);
  assert.ok(text.includes("- pitfall-bb0fe837 [active] 裸标识指称（测试夹具）"), `pitfall list line must be type-prefixed:\n${text}`);
});

// ---------------------------------------------------------------------------
// Layer ④ (workcase): the sixth writer projection must carry the type too
// ---------------------------------------------------------------------------
// 第 6 轮独立复核（2026-10-19）发现 workcase 层是「声称＞实际」的具体落点：
// listWorkcaseObjects 未投 fact_type_key，渲染即退化为裸 8hex。workcase 与
// spark/adr/pitfall/friction/norm 同属被授权的消费面，缺一层等于条款在那一层
// 无声失效——故此处分别钉住「投影带类型」与「渲染带前缀」两环。

test("workcase list: the projection carries fact_type_key for every item", async () => {
  await withTemp("object-reference.workcase.", async (base) => {
    const { repo } = await governedFixture(base);
    // 落一个最小 WorkCase 载体：本用例只关心列表投影，不驱动写入通道。
    const uid = "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7";
    await mkdir(join(repo, "ldvh-base", "workcases"), { recursive: true });
    await writeFile(
      join(repo, "ldvh-base", "workcases", `workcase-${uid}.md`),
      [
        "---",
        "title: 事实对象指称须带类型与标题",
        "object_uid: " + uid,
        "fact_type_key: workcase",
        "status: draft",
        "created_at: 2026-10-18T00:00:00.000Z",
        "change_log:",
        "  - at: 2026-10-18T00:00:00.000Z",
        "    summary: fixture",
        "---",
        "",
        "# 事实对象指称须带类型与标题",
        "",
      ].join("\n"),
      "utf8",
    );
    const listed = await listWorkcaseObjects({ factSourceRoot: join(repo, "ldvh-base"), includeClosed: false, limit: 10 });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    assert.equal(listed.value.items.length, 1);
    assert.equal(
      listed.value.items[0].fact_type_key,
      "workcase",
      "F1 projection must carry fact_type_key — otherwise the render layer can only hard-code the type (a second authority)",
    );
  });
});

test("workcase list line: rendered with a type prefix, never as a bare 8-hex id", () => {
  // 与 pitfall 用例同法：直接驱动 render，钉形态。
  const descriptor = makeDescriptors(workcaseToolsModule.registerWorkcaseTools, {
    dshHomePath: () => "/nope",
    workspaceRoot: "/nope",
  })["ldvh_workcase_list"];
  const envelope = {
    operation_key: "workcase-list-objects",
    outcome: "completed",
    result: { items: [{ object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "workcase", title: "事实对象指称须带类型与标题", status: "open" }], total: 1 },
    gaps: [],
  };
  const text = renderText(descriptor, {}, envelope);
  assert.ok(text.includes("workcase-996e207a"), `workcase list line must be type-prefixed:\n${text}`);
  assert.ok(!/^-\s+996e207a\b/m.test(text), `workcase list line must not be a bare short id:\n${text}`);
});

// ---------------------------------------------------------------------------
// Layer ②: refs targets render as type-prefixed references too
// ---------------------------------------------------------------------------

test("spark read: refs targets carry type + title, unresolvable ones keep their bare id", async () => {
  // refs 在载体里只存 object_uid（03 §7.2 最小形态）；读路径补成指称形态是为了让
  // 读者看得出「指向哪一类对象」，这是派生投影，不构成第二权威。
  await withTemp("object-reference.refs.", async (base) => {
    const { home, repo } = await governedFixture(base);
    // 一个可解析的 Pitfall 载体（refs 目标的实际种类与载体自身种类可不同）。
    await mkdir(join(repo, "ldvh-base", "pitfalls"), { recursive: true });
    const targetUid = "bb0fe837-2a8f-4f4e-b17a-a0200abc116b";
    await writeFile(
      join(repo, "ldvh-base", "pitfalls", `pitfall-${targetUid}.md`),
      `---\nfact_type_key: pitfall\nobject_uid: ${targetUid}\ntitle: 裸标识指称（测试夹具）\nstatus: active\n---\n\n# 裸标识指称（测试夹具）\n`,
      "utf8",
    );
    const descriptors = makeDescriptors(sparkToolsModule.registerSparkTools, sparkDeps(home, base));

    const created = await run(descriptors, "ldvh_spark_write", {
      action: "create",
      dedup_result: "查重结论（测试夹具）：与本仓库既有 Spark 无同题重叠。",
      frontmatter_draft: {
        title: "refs 指称（测试夹具）",
        question: "refs 目标在读取响应里是否带类型与标题？",
        scope_boundary: "仅以本仓库单元测试为证据。",
        intent: "钉住 refs 目标的指称形态。",
        summary: "refs 目标已按形态渲染。",
        change_summary: "受控创建（测试夹具）",
        refs: [{ object_uid: targetUid }],
      },
      body_markdown: [
        "## 当前理解\nrefs 目标已按形态渲染。",
        "## 调查问题\nrefs 目标在读取响应里是否带类型与标题？",
        "## 调查边界\n仅以本仓库单元测试为证据。",
      ].join("\n\n"),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));

    const read = await run(descriptors, "ldvh_spark_read", { object_uid: created.result.object_uid }, repo);
    assert.equal(read.outcome, "completed", JSON.stringify(read));
    // 派生投影已补出类型与标题，但载体里的 refs 仍是最小形态（不回写）。
    assert.deepEqual(read.result.refs, [{ object_uid: targetUid, fact_type_key: "pitfall", title: "裸标识指称（测试夹具）" }]);
    assert.deepEqual(read.result.frontmatter.refs, [{ object_uid: targetUid }], "the carrier must keep the minimal refs shape");

    const text = renderText(descriptors["ldvh_spark_read"], { object_uid: created.result.object_uid }, read);
    assert.ok(text.split("\n").includes("refs: pitfall-bb0fe837 裸标识指称（测试夹具）"), `refs line must be type-prefixed:\n${text}`);
  });
});

test("spark read: an unresolvable refs target renders as its bare short id, never dropped", () => {
  // 读路径不复制写路径的零写入拒绝：丢弃会让「载体声明了关联、响应看不见」比裸标识更坏。
  const descriptor = makeDescriptors(sparkToolsModule.registerSparkTools, {
    dshHomePath: () => "/nope",
    workspaceRoot: "/nope",
  })["ldvh_spark_read"];
  const envelope = {
    operation_key: "spark-read-object",
    outcome: "completed",
    result: {
      object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7",
      fact_type_key: "spark",
      refs: [{ object_uid: "deadbeef-0000-4000-8000-000000000000" }],
    },
    gaps: [],
  };
  const text = renderText(descriptor, {}, envelope);
  assert.ok(text.includes("refs: deadbeef"), `unresolved refs target must keep its short id:\n${text}`);
});

// ---------------------------------------------------------------------------
// F1 list line: refs targets use the SAME form as the read path
// ---------------------------------------------------------------------------
// 第 7 轮复核发现 1：读路径把 refs 目标渲染成 `spark-2074408b`，而 F1 列表行内
// 同一目标退化为裸 `2074408b`——两条消费路径对同一对象给出不同指称。根因是
// `listSparkObjects` 的 refs 投影只保留 `object_uid`。此处钉住两端：投影必须
// 带解析出的类型，渲染必须给出同样的前缀形态。

test("spark F1 list: refs targets carry a resolved type, so the line is type-prefixed", async () => {
  await withTemp("object-reference.f1refs.", async (base) => {
    const root = join(base, "ldvh-base");
    // 目标是一个 pitfall 载体——类型与宿主 spark 不同，正是必须解析才能得知的情形。
    const targetUid = "bb0fe837-1111-4222-8333-444455556666";
    await mkdir(join(root, "pitfalls"), { recursive: true });
    await writeFile(
      join(root, "pitfalls", `pitfall-${targetUid}.md`),
      [
        "---",
        "object_uid: " + targetUid,
        "fact_type_key: pitfall",
        "title: 裸标识指称（测试夹具）",
        "---",
        "",
        "# 裸标识指称（测试夹具）",
        "",
      ].join("\n"),
      "utf8",
    );
    const hostUid = "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7";
    await mkdir(join(root, "sparks"), { recursive: true });
    await writeFile(
      join(root, "sparks", `spark-${hostUid}.md`),
      [
        "---",
        "object_uid: " + hostUid,
        "fact_type_key: spark",
        "title: 宿主对象",
        "status: open",
        "question: 测试",
        "scope_boundary: 测试",
        "intent: 测试",
        "summary: 测试",
        "created_at: 2026-10-18T00:00:00.000Z",
        "refs:",
        "  - object_uid: " + targetUid,
        "---",
        "",
        "# 宿主对象",
        "",
        "## 当前理解",
        "",
        "测试",
        "",
      ].join("\n"),
      "utf8",
    );

    const listed = await listSparkObjects({ factSourceRoot: root, includeTerminal: true, limit: 10 });
    assert.ok(listed.ok, JSON.stringify(listed.error));
    const item = listed.value.items.find((i) => i.object_uid === hostUid);
    assert.ok(item, "the host spark must be listed");
    assert.deepEqual(item.refs, [{ object_uid: targetUid, fact_type_key: "pitfall" }]);

    // 渲染端：同一个投影喂给列表渲染器，行内目标必须是 `pitfall-<8hex>`。
    const descriptor = makeDescriptors(sparkToolsModule.registerSparkTools, {
      dshHomePath: () => "/nope",
      workspaceRoot: "/nope",
    })["ldvh_spark_list"];
    const text = renderText(descriptor, {}, {
      operation_key: "spark-list-objects",
      outcome: "completed",
      result: listed.value,
      gaps: [],
    });
    assert.ok(
      text.includes(`→ pitfall-${targetUid.slice(0, 8)}`),
      `F1 list refs target must be type-prefixed like the read path:\n${text}`,
    );
    assert.ok(!text.includes(`→ ${targetUid.slice(0, 8)}`), `must not render the bare short id:\n${text}`);
  });
});
