const { validateJsonSchemaValue } = await import("/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-tools/lib/index.js");
// Tests for plugin/lib/research-tools.js — the runtime wiring of the
// research mechanical layer (specs/11 state machine + specs/24 writer) into
// the governed ldvh_* tool surface.
//
// Coverage follows the sibling ldvh-tools.test.mjs pattern: handlers are
// driven through registerResearchTools's descriptors with a mock ctx.tools
// registry, a real governed-project fixture (tmp repo + registration), and
// the full 05 §8 envelope shape is asserted, not just the result.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, withTemp } from "./helpers.mjs";
import { OPERATIONS, toolDescriptorFor } from "../lib/research-tools.js";

const dshHome = (home) => (...segments) => join(home, ...segments);

function makeDescriptors(deps) {
  // Mirror registerResearchTools without a live ctx: build descriptors via
  // the exported factory with the same handlers the registration uses.
  const { createHandlers } = require_handlers();
  const handlers = createHandlers(deps);
  return Object.entries(OPERATIONS).map(([operationKey, operation]) =>
    toolDescriptorFor(operationKey, operation, handlers[operationKey])
  );
}

// registerResearchTools closes over its own handler construction; to keep
// tests honest we drive the public registration path with a mock registry.
function makeRegistry() {
  const registered = [];
  const dispose = (ctx2, deps) => {
    const { registerResearchTools } = require_module();
    return registerResearchTools(ctx2, deps);
  };
  return { registered, dispose };
}

// Lazy require to avoid a circular import at module top.
import * as researchToolsModule from "../lib/research-tools.js";
function require_module() {
  return researchToolsModule;
}
function require_handlers() {
  // The handlers are created inside registerResearchTools; the descriptor
  // factory is exported so tests can also compose them directly. For the
  // mock-registry path we use registerResearchTools itself.
  return {
    createHandlers: (deps) => {
      const handlers = {};
      // Same construction as registerResearchTools (kept in sync by the
      // registration test below, which asserts the real path registers 3 tools).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = researchToolsModule;
      const stubCtx = {
        tools: {
          register: (descriptor) => {
            handlers[descriptor.name] = descriptor;
            return () => {};
          }
        }
      };
      const names = Object.fromEntries(Object.values(OPERATIONS).map((op) => [op.toolName, op.toolName]));
      mod.registerResearchTools(stubCtx, deps);
      // Map back to operation keys for descriptor composition tests.
      return handlers;
    }
  };
}

const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });

// ---------------------------------------------------------------------------
// Fixtures — a valid research draft, reusing the writer test shapes
// ---------------------------------------------------------------------------

function validFrontmatterDraft() {
  return {
    title: "工具接入调研（测试夹具）",
    status: "active",
    research_question: "调研机械层工具接入对主控工作流有什么影响？",
    research_purpose: "验证 specs/11+24 机械层的运行时通道",
    stopping_reason: "sufficient",
    urls: [
      { ref: "https://example.com/docs/guide", title: "Example Guide", summary: "机制说明" },
    ],
    confirmed_statements: [
      "F1 工具接入后主控可直驱调研状态机",
    ],
    uncertain: [],
    gaps: [],
    change_summary: "受控创建（测试夹具）",
  };
}

const FINDINGS_BODY = `## 关键发现

### F1 工具接入后主控可直驱调研状态机

主控经 ldvh_research_session 的 submit-round 提交发现、经 ldvh_research_write 落盘；两层机械校验都在运行时通道上执行。

**对 LDVH 的价值**：调研系统从纯库代码变为会话内可调用的机械守护。

溯源：https://example.com/docs/guide（§2 通道）`;

const ANALYSIS_BODY = `## 研究问题
调研机械层工具接入对主控工作流有什么影响？

## 输入与边界
读取本仓库源码与规范。不运行外部系统。

${FINDINGS_BODY}

## 未证实与缺口
（无）

## 建议
无需对象化：本夹具即验证。

## 后续分流
如通道缺陷暴露，更新本对象。`;

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

test("registerResearchTools registers exactly the three research tools", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const registered = [];
    const ctx = { tools: { register: (descriptor) => { registered.push(descriptor.name); return () => {}; } } };
    const deps = { dshHomePath: dshHome(join(base, "home")), workspaceRoot: base, sessionPersistence: () => undefined };
    const { registerResearchTools } = researchToolsModule;
    const dispose = registerResearchTools(ctx, deps);
    assert.deepEqual(
      [...registered].sort(),
      ["ldvh_research_read", "ldvh_research_session", "ldvh_research_write"]
    );
    assert.equal(deps.dshHomePath("ldvh"), join(base, "home", "ldvh"));
    dispose();
  });
});

test("every research descriptor honours the output array contract", async () => {
  const deps = { dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined };
  const handlers = require_handlers().createHandlers(deps);
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    const descriptor = toolDescriptorFor(operationKey, operation, handlers[operation.toolName]);
    const blocks = descriptor.output.render({}, { envelope: { operation_key: operationKey, outcome: "completed", result: null, gaps: [] } });
    assert.ok(Array.isArray(blocks), `${operationKey} render must return an array`);
    assert.equal(blocks[0].type, "text");
    assert.ok(descriptor.output.schema.type === "object");
  }
});

// ---------------------------------------------------------------------------
// research-session-machine
// ---------------------------------------------------------------------------

function sessionHandlers() {
  return require_handlers().createHandlers({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
}

async function run(handlerName, args) {
  const handlers = sessionHandlers();
  const out = await handlers[handlerName].execute(args, exec("/tmp"));
  // Descriptors wrap handler results as { envelope } (the DSH tool contract).
  return out.envelope ?? out;
}

test("session machine: clarify detects an unbounded question", async () => {
  const out = await run("ldvh_research_session", { action: "clarify", question: "调研一下 dsh 的工作流和子代理" });
  assert.equal(out.outcome, "completed");
  assert.ok(out.result.needsClarification);
  assert.ok(out.result.questions.length >= 1);
  assert.ok(out.result.questions.length <= 3);
});

test("session machine: create → submit-round → finalize happy path (sufficient)", async () => {
  const created = await run("ldvh_research_session", {
    action: "create",
    question: "Example 的调度机制是什么？",
    purpose: "验证状态机",
    sub_questions: ["sq1"],
    max_rounds: 2,
  });
  assert.equal(created.outcome, "completed");
  const sessionId = created.result.session_id;

  const round = await run("ldvh_research_session", {
    action: "submit-round",
    session_id: sessionId,
    findings: [
      {
        statement: "Example 按 DAG 调度",
        state: "confirmed",
        sub_question_key: "sq1",
        evidence: { text: "DAG-driven scheduling", source: "https://example.com/dag", anchor: "§3", confidence: "high" },
      },
    ],
  });
  assert.equal(round.outcome, "completed");
  assert.equal(round.result.stop, true);
  assert.equal(round.result.reason, "sufficient");

  const bundle = await run("ldvh_research_session", { action: "finalize", session_id: sessionId });
  assert.equal(bundle.outcome, "completed");
  assert.equal(bundle.result.stopping_reason, "sufficient");
  assert.equal(bundle.result.confirmed.length, 1);
  assert.equal(bundle.result.urls[0].ref, "https://example.com/dag");
});

test("session machine: finalize before convergence is rejected", async () => {
  const created = await run("ldvh_research_session", { action: "create", question: "Q?", purpose: "P" });
  const out = await run("ldvh_research_session", { action: "finalize", session_id: created.result.session_id });
  assert.equal(out.outcome, "rejected");
  assert.ok(out.gaps[0].includes("not_converged") || out.gaps[0].includes("session/"));
});

test("session machine: unknown session_id is rejected, invalid action is invalid_request", async () => {
  const unknown = await run("ldvh_research_session", { action: "state", session_id: "rs-nope" });
  assert.equal(unknown.outcome, "rejected");
  const invalid = await run("ldvh_research_session", { action: "explode" });
  assert.equal(invalid.outcome, "invalid_request");
});

test("session machine: check-delivery flags placeholders (fail loud)", async () => {
  const bad = await run("ldvh_research_session", { action: "check-delivery", body: "结论：TODO 补充" });
  assert.equal(bad.outcome, "rejected");
  assert.ok(bad.gaps.some((g) => g.includes("TODO")));
  const good = await run("ldvh_research_session", { action: "check-delivery", body: "结论：机制已核实。" });
  assert.equal(good.outcome, "completed");
});

// ---------------------------------------------------------------------------
// research-read-object / research-write-object (governed fixture)
// ---------------------------------------------------------------------------

async function governedFixture(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  await mkdir(join(repo, "ldvh-base", "researches"), { recursive: true });
  await registerProject(dshHome(home), { id: "demo", path: repo });
  return { home, repo };
}

function governedHandlers(home, base) {
  // Unwrap the { envelope } descriptor contract so tests assert on the
  // 05 §8 envelope itself (same unwrapping as the run() helper).
  const raw = require_handlers().createHandlers({
    dshHomePath: dshHome(home),
    workspaceRoot: base,
    sessionPersistence: () => undefined,
  });
  const unwrapped = {};
  for (const [name, descriptor] of Object.entries(raw)) {
    unwrapped[name] = {
      execute: async (args, execArg) => {
        const out = await descriptor.execute(args, execArg);
        return out.envelope ?? out;
      }
    };
  }
  return unwrapped;
}

test("write/read round-trip through the tool surface, with read-back", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);

    // Create through the tool.
    const created = await handlers["ldvh_research_write"].execute(
      { action: "create", frontmatter_draft: validFrontmatterDraft(), analysis_body: ANALYSIS_BODY },
      exec(repo)
    );
    assert.equal(created.outcome, "completed");
    assert.ok(created.result.read_back.ok);
    assert.ok(Array.isArray(created.result.changes) && created.result.changes.length === 1);
    assert.ok(created.verification.checks.includes("read-back"));
    const uid = created.result.object_uid;
    const fp1 = created.result.fingerprint;

    // Precise read through the tool.
    const read = await handlers["ldvh_research_read"].execute({ object_uid: uid }, exec(repo));
    assert.equal(read.outcome, "completed");
    assert.equal(read.result.frontmatter.object_uid, uid);
    assert.equal(read.result.fingerprint, fp1);
    assert.equal(read.result.sub_stage, "directed");

    // The file is really on disk inside the governed repo.
    const raw = await readFile(join(repo, "ldvh-base", "researches", `research-${uid}.md`), "utf8");
    assert.ok(raw.includes("research_question"));

    // CAS update with the observed fingerprint.
    const draft2 = { ...validFrontmatterDraft(), change_summary: "title 更新" };
    const body2 = ANALYSIS_BODY.replace("调研机械层工具接入对主控工作流有什么影响？", "调研机械层工具接入对主控工作流有什么影响？（更新）");
    const updated = await handlers["ldvh_research_write"].execute(
      {
        action: "update",
        object_uid: uid,
        expected_fingerprint: fp1,
        frontmatter_after: draft2,
        analysis_body_after: body2,
        change_summary: "更新研究问题表述",
      },
      exec(repo)
    );
    assert.equal(updated.outcome, "completed");
    assert.notEqual(updated.result.fingerprint, fp1);
    assert.equal(updated.result.read_back.ok, true);
    assert.equal(updated.verification.checks.includes("cas-baseline"), true);
  });
});

test("write: CAS conflict surfaces as rejected with reconcile follow-up", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const created = await handlers["ldvh_research_write"].execute(
      { action: "create", frontmatter_draft: validFrontmatterDraft(), analysis_body: ANALYSIS_BODY },
      exec(repo)
    );
    assert.equal(created.outcome, "completed");
    const conflicted = await handlers["ldvh_research_write"].execute(
      {
        action: "update",
        object_uid: created.result.object_uid,
        expected_fingerprint: "0".repeat(64),
        frontmatter_after: validFrontmatterDraft(),
        analysis_body_after: ANALYSIS_BODY,
        change_summary: "x",
      },
      exec(repo)
    );
    assert.equal(conflicted.outcome, "rejected");
    assert.ok(conflicted.gaps.some((g) => g.includes("cas_conflict")));
    assert.ok(conflicted.follow_up.some((f) => f.includes("re-read")));
  });
});

test("write: relations contract flows through the tool surface (supersedes rejected)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const bad = {
      ...validFrontmatterDraft(),
      relations: [{ relation_key: "supersedes", target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
    };
    const out = await handlers["ldvh_research_write"].execute(
      { action: "create", frontmatter_draft: bad, analysis_body: ANALYSIS_BODY },
      exec(repo)
    );
    assert.equal(out.outcome, "rejected");
    assert.ok(out.gaps.some((g) => g.includes("relations_invalid")));
    // Zero write: the researches directory must stay empty.
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(repo, "ldvh-base", "researches"));
    assert.equal(files.length, 0);
  });
});

test("read/write are unavailable outside governed sessions", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const home = join(base, "home");
    await mkdir(join(home, "ldvh"), { recursive: true });
    const handlers = governedHandlers(home, base);
    const read = await handlers["ldvh_research_read"].execute({ object_uid: "11111111-1111-4111-8111-111111111111" }, exec(base));
    assert.equal(read.outcome, "unavailable");
    assert.ok(read.gaps[0].includes("not_governed"));
    const write = await handlers["ldvh_research_write"].execute(
      { action: "create", frontmatter_draft: validFrontmatterDraft(), analysis_body: ANALYSIS_BODY },
      exec(base)
    );
    assert.equal(write.outcome, "unavailable");
  });
});

test("read of a missing object is rejected (not unavailable)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const out = await handlers["ldvh_research_read"].execute({ object_uid: "99999999-9999-4999-8999-999999999999" }, exec(repo));
    assert.equal(out.outcome, "rejected");
    assert.ok(out.gaps.some((g) => g.includes("object_not_found")));
  });
});

test("write missing required fields is invalid_request (zero write)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const noAction = await handlers["ldvh_research_write"].execute({}, exec(repo));
    assert.equal(noAction.outcome, "invalid_request");
    const noBody = await handlers["ldvh_research_write"].execute({ action: "create", frontmatter_draft: validFrontmatterDraft() }, exec(repo));
    assert.equal(noBody.outcome, "invalid_request");
  });
});

// ---------------------------------------------------------------------------
// Schema validation unit tests (S6 from the independent audit — the schema
// layer's rejection paths are not covered by handler fixtures)
// ---------------------------------------------------------------------------

test("write schema: create missing required frontmatter fields is rejected at schema layer", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/research-tools.js");
  const desc = toolDescriptorFor("research-write-object", OPERATIONS["research-write-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {
    action: "create",
    frontmatter_draft: { title: "only-title" }
  }, "args");
  assert.ok(violations.length > 0, "should reject");
  assert.ok(violations.some((v) => v.includes("research_question")));
});

test("write schema: urls as object shape (the model mis-shape) is rejected with a clear message", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/research-tools.js");
  const desc = toolDescriptorFor("research-write-object", OPERATIONS["research-write-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {
    action: "create",
    frontmatter_draft: { title: "t", research_question: "q", research_purpose: "p", stopping_reason: "round-cap", urls: { item: { ref: "x" } } }
  }, "args");
  assert.ok(violations.some((v) => v.includes("urls") && v.includes("array")), "urls object-shape must be rejected with 'must be an array'");
});

test("write schema: update with retired status passes (24 §9 lifecycle transition)", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/research-tools.js");
  const desc = toolDescriptorFor("research-write-object", OPERATIONS["research-write-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {
    action: "update",
    object_uid: "x",
    expected_fingerprint: "y",
    change_summary: "retire",
    frontmatter_after: { status: "retired" }
  }, "args");
  assert.equal(violations.length, 0, JSON.stringify(violations));
});

test("write schema: partial update (title only) passes schema layer", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/research-tools.js");
  const desc = toolDescriptorFor("research-write-object", OPERATIONS["research-write-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {
    action: "update",
    object_uid: "x",
    expected_fingerprint: "y",
    change_summary: "rename",
    frontmatter_after: { title: "新标题" }
  }, "args");
  assert.equal(violations.length, 0, JSON.stringify(violations));
});
