import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as sparkToolsModule from "../lib/spark-tools.js";
import * as pitfallToolsModule from "../lib/pitfall-tools.js";
import { listSparkObjects } from "../lib/spark-writer.js";
import { objectRef, objectRefOf, promptObjectRef } from "../lib/object-reference.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, seedSubGoals, subGoalUid, sessionPersistenceWithRoutingLog, withTemp } from "./helpers.mjs";

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


test("objectRef: minimum form is type + 8-hex short id", () => {
  assert.equal(objectRef({ object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "spark" }), "spark-996e207a");
});

test("objectRef: title is appended only when asked (02 §9.3 第 2 条 is the writer's reader judgement)", () => {
  const item = { object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "spark", title: "事实对象指称须带类型与标题" };
  assert.equal(objectRef(item), "spark-996e207a");
  assert.equal(objectRef(item, { withTitle: true }), "spark-996e207a 事实对象指称须带类型与标题");
});

test("objectRef: an unknown type degrades to the bare short id instead of fabricating a type", () => {
  assert.equal(objectRef({ object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "unknown-type" }), "996e207a");
  assert.equal(objectRef({ object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7" }), "996e207a");
});

test("objectRef: a missing uid renders as empty, never as a partial reference", () => {
  assert.equal(objectRef({ fact_type_key: "spark", title: "t" }), "");
  assert.equal(objectRef(undefined), "");
  assert.equal(objectRefOf("", "spark"), "");
});

test("promptObjectRef keeps the FULL uid for executors that must echo it back", () => {
  const item = { object_uid: "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7", fact_type_key: "friction", title: "CI 平均 8 分钟" };
  assert.equal(promptObjectRef(item), "friction-996e207a CI 平均 8 分钟 (996e207a-3ca2-494b-bcbe-3f00d7c0c3b7)");
});


async function governedFixture(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  await mkdir(join(repo, "ldvh-base", "sparks"), { recursive: true });
  await writeFile(join(repo, "ldvh-base", "goal.md"), GOAL_MD_FIXTURE, "utf8");
  await seedSubGoals(join(repo, "ldvh-base"), ["SG-1", "SG-2"]);
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

async function createSpark(descriptors, args, cwd) {
  const pre = await run(descriptors, "ldvh_spark_precheck_create", {
    frontmatter_draft: args.frontmatter_draft,
    body_markdown: args.body_markdown,
    dedup_result: args.dedup_result,
  }, cwd);
  return run(descriptors, "ldvh_spark_write", {
    ...args,
    expected_candidate_fingerprint: pre.result?.candidate_fingerprint,
  }, cwd);
}

test("spark list: every item line carries a type-prefixed reference, and the projection carries fact_type_key", async () => {
  await withTemp("object-reference.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const descriptors = makeDescriptors(sparkToolsModule.registerSparkTools, sparkDeps(home, base));

    const created = await createSpark(descriptors, {
      action: "create",
      dedup_result: "查重结论（测试夹具）：与本仓库既有 Spark 无同题重叠。",
      frontmatter_draft: {
        title: "指称形态（测试夹具）",
        question: "工具响应中的对象指称应当长什么样？",
        scope_boundary: "仅以本仓库单元测试为证据。",
        intent: "钉住 02 §9.3 的指称形态。",
        summary: "工具响应已按形态渲染。",
        serves: subGoalUid(1),
        priority: "P2",
        change_summary: "受控创建（测试夹具）",
      },
      body_markdown: [
        "## 当前理解\n工具响应已按形态渲染。",
        "## 调查问题\n工具响应中的对象指称应当长什么样？",
        "## 调查边界\n仅以本仓库单元测试为证据。",
      ].join("\n\n"),
    }, repo);
    assert.equal(created.outcome, "completed", JSON.stringify(created));

    const listed = await run(descriptors, "ldvh_spark_list", {}, repo);
    assert.equal(listed.outcome, "completed", JSON.stringify(listed));
    assert.equal(listed.result.items[0].fact_type_key, "spark", "F1 projection must carry fact_type_key");

    const listText = renderText(descriptors["ldvh_spark_list"], {}, listed);
    const itemLine = listText.split("\n").find((line) => line.startsWith("- ")) ?? "";
    const match = SPARK_UID_RE.exec(itemLine);
    assert.ok(match, `list line must carry a type-prefixed reference:\n${listText}`);
    assert.equal(match[1], created.result.object_uid.slice(0, 8), "the short id must be the uid prefix");

    const read = await run(descriptors, "ldvh_spark_read", { object_uid: created.result.object_uid }, repo);
    assert.equal(read.outcome, "completed", JSON.stringify(read));
    const readText = renderText(descriptors["ldvh_spark_read"], { object_uid: created.result.object_uid }, read);
    assert.ok(
      readText.split("\n").includes(`object: spark-${created.result.object_uid.slice(0, 8)}`),
      `read envelope must carry the reference:\n${readText}`,
    );
    const writeText = renderText(descriptors["ldvh_spark_write"], { action: "create" }, created);
    assert.ok(
      writeText.split("\n").includes(`change: created spark-${created.result.object_uid.slice(0, 8)}`),
      `change line must carry the reference:\n${writeText}`,
    );
  });
});


test("pitfall list: the projection carries fact_type_key and the rendered line is type-prefixed", () => {
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


test("spark read: refs targets carry type + title, unresolvable ones keep their bare id", async () => {
  await withTemp("object-reference.refs.", async (base) => {
    const { home, repo } = await governedFixture(base);
    await mkdir(join(repo, "ldvh-base", "pitfalls"), { recursive: true });
    const targetUid = "bb0fe837-2a8f-4f4e-b17a-a0200abc116b";
    await writeFile(
      join(repo, "ldvh-base", "pitfalls", `pitfall-${targetUid}.md`),
      `---\nfact_type_key: pitfall\nobject_uid: ${targetUid}\ntitle: 裸标识指称（测试夹具）\nstatus: active\n---\n\n# 裸标识指称（测试夹具）\n`,
      "utf8",
    );
    const descriptors = makeDescriptors(sparkToolsModule.registerSparkTools, sparkDeps(home, base));

    const created = await createSpark(descriptors, {
      action: "create",
      dedup_result: "查重结论（测试夹具）：与本仓库既有 Spark 无同题重叠。",
      frontmatter_draft: {
        title: "refs 指称（测试夹具）",
        question: "refs 目标在读取响应里是否带类型与标题？",
        scope_boundary: "仅以本仓库单元测试为证据。",
        intent: "钉住 refs 目标的指称形态。",
        summary: "refs 目标已按形态渲染。",
        serves: subGoalUid(1),
        priority: "P2",
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
    assert.deepEqual(read.result.refs, [{ object_uid: targetUid, fact_type_key: "pitfall", title: "裸标识指称（测试夹具）" }]);
    assert.deepEqual(read.result.frontmatter.refs, [{ object_uid: targetUid }], "the carrier must keep the minimal refs shape");

    const text = renderText(descriptors["ldvh_spark_read"], { object_uid: created.result.object_uid }, read);
    assert.ok(text.split("\n").includes("refs: pitfall-bb0fe837 裸标识指称（测试夹具）"), `refs line must be type-prefixed:\n${text}`);
  });
});

test("spark read: an unresolvable refs target renders as its bare short id, never dropped", () => {
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


test("spark F1 list: refs targets carry a resolved type, so the line is type-prefixed", async () => {
  await withTemp("object-reference.f1refs.", async (base) => {
    const root = join(base, "ldvh-base");
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

test("spark terminal report: relation targets render with the type prefix, never the full uid", async () => {
  await withTemp("object-reference.relation.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const sparks = join(repo, "ldvh-base", "sparks");
    const seed = (uid, title) => writeFile(
      join(sparks, `spark-${uid}.md`),
      [
        "---",
        `object_uid: ${uid}`,
        "fact_type_key: spark",
        `title: ${title}`,
        "status: open",
        "question: 关系目标该怎样被指称？",
        "scope_boundary: 仅以本仓库单元测试为证据。",
        "intent: 钉住关系行的指称形态。",
        "summary: 关系目标按 02 §9.3 渲染。",
        `serves: ${subGoalUid(1)}`,
        "created_at: 2026-10-18T00:00:00.000Z",
        "---",
        "",
        `# ${title}`,
        "",
        "## 当前理解",
        "",
        "关系目标按 02 §9.3 渲染。",
        "",
        "## 调查问题",
        "",
        "关系目标该怎样被指称？",
        "",
        "## 调查边界",
        "",
        "仅以本仓库单元测试为证据。",
        "",
      ].join("\n"),
      "utf8",
    );
    const targetUid = "11111111-1111-4111-8111-111111111111";
    const hostUid = "996e207a-3ca2-494b-bcbe-3f00d7c0c3b7";
    await seed(targetUid, "合并目标（测试夹具）");
    await seed(hostUid, "被合并议题（测试夹具）");

    const captured = [];
    const descriptors = makeDescriptors(sparkToolsModule.registerSparkTools, {
      dshHomePath: dshHome(home),
      workspaceRoot: base,
      sessionPersistence: sessionPersistenceWithRoutingLog(base),
      hostSeams: {
        requestSparkConsent: async (request) => {
          captured.push(String(request.summary ?? ""));
          return { granted: true, answer: "确认" };
        },
      },
    });

    const read = await run(descriptors, "ldvh_spark_read", { object_uid: hostUid }, repo);
    assert.equal(read.outcome, "completed", JSON.stringify(read));
    const merged = await run(descriptors, "ldvh_spark_write", {
      action: "update",
      object_uid: hostUid,
      expected_fingerprint: read.result.fingerprint,
      frontmatter_after: {
        status: "discarded",
        disposition: "合并：议题收敛进目标。",
        relations: [{ relation_key: "merged-into", target: { object_uid: targetUid } }],
      },
      body_markdown_after: [
        "## 当前理解",
        "",
        "关系目标按 02 §9.3 渲染。",
        "",
        "## 调查问题",
        "",
        "关系目标该怎样被指称？",
        "",
        "## 调查边界",
        "",
        "仅以本仓库单元测试为证据。",
      ].join("\n"),
      change_summary: "合并进目标（测试夹具）",
    }, repo);
    assert.equal(merged.outcome, "completed", JSON.stringify(merged));
    assert.equal(captured.length, 1, "exactly one 22 §16 Gate must be asked on a terminal transition");
    const report = captured[0];
    assert.ok(
      report.includes(`merged-into → spark-${targetUid.slice(0, 8)}`),
      `relation line must carry the type prefix:\n${report}`,
    );
    assert.ok(!report.includes(targetUid), `relation line must not print the full 36-char uid:\n${report}`);
  });
});
