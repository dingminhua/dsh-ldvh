import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, sessionPersistenceWithRoutingLog, withTemp } from "./helpers.mjs";
import { OPERATIONS, toolDescriptorFor } from "../lib/report-tools.js";

const dshHome = (home) => (...segments) => join(home, ...segments);

function makeDescriptors(deps) {
  const { createHandlers } = require_handlers();
  const handlers = createHandlers(deps);
  return Object.entries(OPERATIONS).map(([operationKey, operation]) =>
    toolDescriptorFor(operationKey, operation, handlers[operationKey])
  );
}

function makeRegistry() {
  const registered = [];
  const dispose = (ctx2, deps) => {
    const { registerReportTools } = require_module();
    return registerReportTools(ctx2, deps);
  };
  return { registered, dispose };
}

import * as researchToolsModule from "../lib/report-tools.js";
function require_module() {
  return researchToolsModule;
}
function require_handlers() {
  return {
    createHandlers: (deps) => {
      const handlers = {};
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
      mod.registerReportTools(stubCtx, deps);
      return handlers;
    }
  };
}

const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });


function validFrontmatterDraft() {
  return {
    title: "工具接入调研（测试夹具）",
    status: "active",
    report_form: "research",
    research_question: "调研机械层工具接入对主控工作流有什么影响？",
    research_purpose: "验证 specs/33+24 机械层的运行时通道",
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

主控经 ldvh_report_session 的 submit-round 提交发现、经 ldvh_report_write 落盘；两层机械校验都在运行时通道上执行。

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


test("registerReportTools registers exactly the four research tools", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const registered = [];
    const ctx = { tools: { register: (descriptor) => { registered.push(descriptor.name); return () => {}; } } };
    const deps = { dshHomePath: dshHome(join(base, "home")), workspaceRoot: base, sessionPersistence: () => undefined };
    const { registerReportTools } = researchToolsModule;
    const dispose = registerReportTools(ctx, deps);
    assert.deepEqual(
      [...registered].sort(),
      ["ldvh_report_list", "ldvh_report_read", "ldvh_report_session", "ldvh_report_write"]
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


function sessionHandlers() {
  return require_handlers().createHandlers({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
}

async function run(handlerName, args) {
  const handlers = sessionHandlers();
  const out = await handlers[handlerName].execute(args, exec("/tmp"));
  return out.envelope ?? out;
}

test("session machine: clarify detects an unbounded question", async () => {
  const out = await run("ldvh_report_session", { action: "clarify", question: "调研一下 dsh 的工作流和子代理" });
  assert.equal(out.outcome, "completed");
  assert.ok(out.result.needsClarification);
  assert.ok(out.result.questions.length >= 1);
  assert.ok(out.result.questions.length <= 3);
});

test("session machine: create → submit-round → finalize happy path (sufficient)", async () => {
  const created = await run("ldvh_report_session", {
    action: "create",
    question: "Example 的调度机制是什么？",
    purpose: "验证状态机",
    sub_questions: ["sq1"],
    max_rounds: 2,
  });
  assert.equal(created.outcome, "completed");
  const sessionId = created.result.session_id;

  const round = await run("ldvh_report_session", {
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

  const bundle = await run("ldvh_report_session", { action: "finalize", session_id: sessionId });
  assert.equal(bundle.outcome, "completed");
  assert.equal(bundle.result.stopping_reason, "sufficient");
  assert.equal(bundle.result.confirmed.length, 1);
  assert.equal(bundle.result.urls[0].ref, "https://example.com/dag");
});

test("session machine: finalize before convergence is rejected", async () => {
  const created = await run("ldvh_report_session", { action: "create", question: "Q?", purpose: "P" });
  const out = await run("ldvh_report_session", { action: "finalize", session_id: created.result.session_id });
  assert.equal(out.outcome, "rejected");
  assert.ok(out.gaps[0].includes("not_converged") || out.gaps[0].includes("session/"));
});

test("session machine: unknown session_id is rejected, invalid action is invalid_request", async () => {
  const unknown = await run("ldvh_report_session", { action: "state", session_id: "rs-nope" });
  assert.equal(unknown.outcome, "rejected");
  let invalid;
  try {
    invalid = await run("ldvh_report_session", { action: "explode" });
  } catch (error) {
    invalid = { outcome: "invalid_request", gaps: [String(error?.message ?? error)] };
  }
  assert.equal(invalid.outcome, "invalid_request");
});

test("session machine: check-delivery flags placeholders (fail loud)", async () => {
  const bad = await run("ldvh_report_session", { action: "check-delivery", body: "结论：TODO 补充" });
  assert.equal(bad.outcome, "rejected");
  assert.ok(bad.gaps.some((g) => g.includes("TODO")));
  const good = await run("ldvh_report_session", { action: "check-delivery", body: "结论：机制已核实。" });
  assert.equal(good.outcome, "completed");
});


async function governedFixture(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  await mkdir(join(repo, "ldvh-base", "reports"), { recursive: true });
  await registerProject(dshHome(home), { id: "demo", path: repo });
  return { home, repo };
}

function governedHandlers(home, base) {
  const raw = require_handlers().createHandlers({
    dshHomePath: dshHome(home),
    workspaceRoot: base,
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
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

test("reference form: tool create succeeds with internal anchor; sufficient is rejected end-to-end", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const body = [
      "## 参考内容", "据称 X 支持 Y。",
      "## 出处与来源", "来源：commit（0123456789abcdef0123456789abcdef01234567）",
      "## 记录理由", "备查。",
      "## 未验证与疑点", "未核实。",
      "## 后续核验方向", "待核。",
    ].join("\n\n");
    const draft = { title: "参考报告工具测试", report_form: "reference", stopping_reason: "no-gain", uncertain: [{ issue: "未验证", reason: "测试" }], change_summary: "测试" };

    const ok = await handlers["ldvh_report_write"].execute(
      { action: "create", frontmatter_draft: draft, analysis_body: body }, exec(repo)
    );
    assert.equal(ok.outcome, "completed", JSON.stringify(ok));
    assert.ok(ok.result.read_back.ok);

    const bad = await handlers["ldvh_report_write"].execute(
      { action: "create", frontmatter_draft: { ...draft, stopping_reason: "sufficient" }, analysis_body: body }, exec(repo)
    );
    assert.equal(bad.outcome, "rejected", JSON.stringify(bad));
  });
});

test("write/read round-trip through the tool surface, with read-back", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);

    const created = await handlers["ldvh_report_write"].execute(
      { action: "create", frontmatter_draft: validFrontmatterDraft(), analysis_body: ANALYSIS_BODY },
      exec(repo)
    );
    assert.equal(created.outcome, "completed");
    assert.ok(created.result.read_back.ok);
    assert.ok(Array.isArray(created.result.changes) && created.result.changes.length === 1);
    assert.ok(created.verification.checks.includes("read-back"));
    const uid = created.result.object_uid;
    const fp1 = created.result.fingerprint;

    const read = await handlers["ldvh_report_read"].execute({ object_uid: uid }, exec(repo));
    assert.equal(read.outcome, "completed");
    assert.equal(read.result.frontmatter.object_uid, uid);
    assert.equal(read.result.fingerprint, fp1);
    assert.equal(read.result.sub_stage, "directed");

    const raw = await readFile(join(repo, "ldvh-base", "reports", `report-${uid}.md`), "utf8");
    assert.ok(raw.includes("research_question"));

    const draft2 = { ...validFrontmatterDraft(), change_summary: "title 更新" };
    const body2 = ANALYSIS_BODY.replace("调研机械层工具接入对主控工作流有什么影响？", "调研机械层工具接入对主控工作流有什么影响？（更新）");
    const updated = await handlers["ldvh_report_write"].execute(
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
    const created = await handlers["ldvh_report_write"].execute(
      { action: "create", frontmatter_draft: validFrontmatterDraft(), analysis_body: ANALYSIS_BODY },
      exec(repo)
    );
    assert.equal(created.outcome, "completed");
    const conflicted = await handlers["ldvh_report_write"].execute(
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
    let out;
    try {
      out = await handlers["ldvh_report_write"].execute(
        { action: "create", frontmatter_draft: bad, analysis_body: ANALYSIS_BODY },
        exec(repo)
      );
    } catch (error) {
      out = {
        outcome: "rejected",
        gaps: [String(error?.message ?? error)],
        rejected_at: "parameter_schema",
      };
    }
    assert.equal(out.outcome, "rejected");
    assert.ok(
      out.gaps.some((g) => g.includes("relations_invalid"))
      || out.rejected_at === "parameter_schema",
      JSON.stringify(out.gaps),
    );
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(repo, "ldvh-base", "reports"));
    assert.equal(files.length, 0);
  });
});

test("read/write are unavailable outside governed sessions", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const home = join(base, "home");
    await mkdir(join(home, "ldvh"), { recursive: true });
    const handlers = governedHandlers(home, base);
    const read = await handlers["ldvh_report_read"].execute({ object_uid: "11111111-1111-4111-8111-111111111111" }, exec(base));
    assert.equal(read.outcome, "unavailable");
    assert.ok(read.gaps[0].includes("not_governed"));
    const write = await handlers["ldvh_report_write"].execute(
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
    const out = await handlers["ldvh_report_read"].execute({ object_uid: "99999999-9999-4999-8999-999999999999" }, exec(repo));
    assert.equal(out.outcome, "rejected");
    assert.ok(out.gaps.some((g) => g.includes("object_not_found")));
  });
});

test("write missing required fields is invalid_request (zero write)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const noAction = await handlers["ldvh_report_write"].execute({}, exec(repo));
    assert.equal(noAction.outcome, "invalid_request");
    const noBody = await handlers["ldvh_report_write"].execute({ action: "create", frontmatter_draft: validFrontmatterDraft() }, exec(repo));
    assert.equal(noBody.outcome, "invalid_request");
  });
});


test("write schema: create missing required frontmatter fields is rejected at schema layer", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/report-tools.js");
  const desc = toolDescriptorFor("report-write-object", OPERATIONS["report-write-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {
    action: "create",
    frontmatter_draft: { title: "only-title" }
  }, "args");
  assert.ok(violations.length > 0, "should reject");
  assert.ok(violations.some((v) => v.includes("report_form")), "report_form is the form-determining required field");
});

test("write schema: urls as object shape (the model mis-shape) is rejected with a clear message", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/report-tools.js");
  const desc = toolDescriptorFor("report-write-object", OPERATIONS["report-write-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {
    action: "create",
    frontmatter_draft: { title: "t", report_form: "research", research_question: "q", research_purpose: "p", stopping_reason: "round-cap", urls: { item: { ref: "x" } } }
  }, "args");
  assert.ok(violations.some((v) => v.includes("urls") && v.includes("array")), "urls object-shape must be rejected with 'must be an array'");
});

test("write schema: update with retired status passes (24 §9 lifecycle transition)", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/report-tools.js");
  const desc = toolDescriptorFor("report-write-object", OPERATIONS["report-write-object"], async () => ({}));
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
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/report-tools.js");
  const desc = toolDescriptorFor("report-write-object", OPERATIONS["report-write-object"], async () => ({}));
  const violations = validateJsonSchemaValue(desc.parameters, {
    action: "update",
    object_uid: "x",
    expected_fingerprint: "y",
    change_summary: "rename",
    frontmatter_after: { title: "新标题" }
  }, "args");
  assert.equal(violations.length, 0, JSON.stringify(violations));
});

test("write schema: legacy serves is accepted in frontmatter_draft and frontmatter_after (issue #4)", async () => {
  const { toolDescriptorFor, OPERATIONS } = await import("../lib/report-tools.js");
  const desc = toolDescriptorFor("report-write-object", OPERATIONS["report-write-object"], async () => ({}));
  const legacyUid = "a415bbd4-ee4b-43e1-9bb0-0c4e8761c188";
  const draftViolations = validateJsonSchemaValue(desc.parameters, {
    action: "create",
    frontmatter_draft: { title: "t", report_form: "research", serves: legacyUid }
  }, "args");
  assert.equal(draftViolations.length, 0, JSON.stringify(draftViolations));
  const afterViolations = validateJsonSchemaValue(desc.parameters, {
    action: "update",
    object_uid: "x",
    expected_fingerprint: "y",
    change_summary: "legacy serves",
    frontmatter_after: { serves: legacyUid }
  }, "args");
  assert.equal(afterViolations.length, 0, JSON.stringify(afterViolations));
});


test("render: research read output carries the FULL 64-char fingerprint and semantic lines (no ellipsis truncation)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);

    const created = await handlers["ldvh_report_write"].execute(
      { action: "create", frontmatter_draft: validFrontmatterDraft(), analysis_body: ANALYSIS_BODY },
      exec(repo)
    );
    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;
    const fp = created.result.fingerprint;
    assert.match(fp, /^[0-9a-f]{64}$/, "fingerprint must be a full 64-char hex SHA-256");

    const readOut = await handlers["ldvh_report_read"].execute({ object_uid: uid }, exec(repo));
    assert.equal(readOut.outcome, "completed", JSON.stringify(readOut));

    const raw = require_handlers().createHandlers({
      dshHomePath: dshHome(home),
      workspaceRoot: base,
      sessionPersistence: () => undefined,
    });
    const blocks = raw["ldvh_report_read"].output.render({ object_uid: uid }, { envelope: readOut });
    const text = blocks.map((b) => b.text).join("\n");
    assert.ok(text.includes(`fingerprint: ${fp}`), `render must carry the complete fingerprint:\n${text}`);
    assert.ok(text.includes("title: 工具接入调研（测试夹具）"), `render must carry the title:\n${text}`);
    assert.ok(text.includes("status: active"), `render must carry the status:\n${text}`);
    assert.ok(text.includes("sub_stage: directed"), `render must carry sub_stage:\n${text}`);
    assert.ok(text.includes("body_valid: true"), `render must carry body_valid:\n${text}`);
    assert.ok(!text.includes("…"), "render must not truncate with an ellipsis");
  });
});


test("list: projects the F1 field set and nothing beyond it (24 §12)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const created = await handlers["ldvh_report_write"].execute(
      { action: "create", frontmatter_draft: validFrontmatterDraft(), analysis_body: ANALYSIS_BODY },
      exec(repo)
    );
    assert.equal(created.outcome, "completed", JSON.stringify(created));

    const listed = await handlers["ldvh_report_list"].execute({}, exec(repo));
    assert.equal(listed.outcome, "completed", JSON.stringify(listed));
    assert.equal(listed.result.count, 1);
    const item = listed.result.items[0];
    assert.equal(item.object_uid, created.result.object_uid);
    assert.equal(item.fact_type_key, "report");
    assert.equal(item.status, "active");
    assert.ok(typeof item.title === "string" && item.title.length > 0);
    assert.ok(typeof item.research_question === "string" && item.research_question.length > 0);
    assert.ok(typeof item.research_purpose === "string" && item.research_purpose.length > 0);
    assert.equal(item.stopping_reason, "sufficient");
    assert.ok(typeof item.created_at === "string" && item.created_at.length > 0);
    for (const forbidden of ["confirmed_statements", "uncertain", "gaps", "urls", "relations", "body", "sub_stage"]) {
      assert.ok(!(forbidden in item), `F1 projection must not carry ${forbidden}`);
    }
  });
});

test("list: active-only by default, retired only under status=all (24 §12 F2)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const created = await handlers["ldvh_report_write"].execute(
      { action: "create", frontmatter_draft: validFrontmatterDraft(), analysis_body: ANALYSIS_BODY },
      exec(repo)
    );
    assert.equal(created.outcome, "completed", JSON.stringify(created));
    const uid = created.result.object_uid;

    const retiredBody = ANALYSIS_BODY.replace(
      "## 建议\n",
      "## 建议\n\n本对象在来源失效后仍可被回查，锚点保留。\n"
    );
    const retired = await handlers["ldvh_report_write"].execute(
      {
        action: "update",
        object_uid: uid,
        expected_fingerprint: created.result.fingerprint,
        frontmatter_after: { status: "retired", retirement_reason: "outdated", change_summary: "退出测试" },
        analysis_body_after: retiredBody,
        change_summary: "退出测试",
      },
      exec(repo)
    );
    assert.equal(retired.outcome, "completed", JSON.stringify(retired));

    const activeOnly = await handlers["ldvh_report_list"].execute({}, exec(repo));
    assert.equal(activeOnly.result.count, 0, "retired objects are not current evidence inputs by default");
    assert.equal(activeOnly.result.filter, "active");

    const all = await handlers["ldvh_report_list"].execute({ status: "all" }, exec(repo));
    assert.equal(all.result.count, 1);
    assert.equal(all.result.filter, "all");
    assert.equal(all.result.items[0].status, "retired");
  });
});

test("list: truncation is reported as partial with the true total, never silently (03 §8.1)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    for (const title of ["甲调研", "乙调研"]) {
      const draft = { ...validFrontmatterDraft(), title };
      const created = await handlers["ldvh_report_write"].execute(
        { action: "create", frontmatter_draft: draft, analysis_body: ANALYSIS_BODY },
        exec(repo)
      );
      assert.equal(created.outcome, "completed", JSON.stringify(created));
    }

    const page = await handlers["ldvh_report_list"].execute({ limit: 1 }, exec(repo));
    assert.equal(page.outcome, "partial");
    assert.equal(page.result.count, 1);
    assert.equal(page.result.total, 2);
    assert.ok(page.gaps.some((g) => g.includes("truncated")), `truncation must be stated in gaps: ${JSON.stringify(page.gaps)}`);
    assert.ok(page.scope.not_completed.length > 0);
  });
});

test("list: an absent researches directory is an empty set, not an error (24 §12)", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const home = join(base, "home");
    const repo = await initRepo(base);
    await registerProject(dshHome(home), { id: "demo", path: repo });
    const handlers = governedHandlers(home, base);
    const listed = await handlers["ldvh_report_list"].execute({}, exec(repo));
    assert.equal(listed.outcome, "completed", JSON.stringify(listed));
    assert.equal(listed.result.count, 0);
    assert.equal(listed.result.total, 0);
  });
});

test("list: an ungoverned directory is unavailable — discovery never guesses (08)", async () => {
  const handlers = require_handlers().createHandlers({
    dshHomePath: dshHome("/nope"),
    workspaceRoot: "/nope",
    sessionPersistence: () => undefined,
  });
  const out = await handlers["ldvh_report_list"].execute({}, exec("/tmp"));
  assert.equal(out.envelope.outcome, "unavailable");
  assert.ok(out.envelope.gaps.some((g) => g.includes("governance state")));
});

test("list: newest first — the order dedup scans and resumption depend on", async () => {
  await withTemp("ldvh-rt.", async (base) => {
    const { home, repo } = await governedFixture(base);
    const handlers = governedHandlers(home, base);
    const created = [];
    for (const title of ["较早的调研", "较晚的调研"]) {
      const draft = { ...validFrontmatterDraft(), title };
      const out = await handlers["ldvh_report_write"].execute(
        { action: "create", frontmatter_draft: draft, analysis_body: ANALYSIS_BODY },
        exec(repo)
      );
      assert.equal(out.outcome, "completed", JSON.stringify(out));
      created.push(out.result.object_uid);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const listed = await handlers["ldvh_report_list"].execute({}, exec(repo));
    assert.deepEqual(listed.result.items.map((i) => i.object_uid), [created[1], created[0]]);
  });
});


test("session machine: an unknown id is reported as in-memory/restart, not as a caller typo", async () => {
  const out = await run("ldvh_report_session", { action: "state", session_id: "rs-does-not-exist" });
  assert.equal(out.outcome, "rejected");
  const reason = out.gaps.join(" ");
  assert.ok(reason.includes("in-memory only"), `must say sessions do not persist:\n${reason}`);
  assert.ok(reason.includes("recreate with action=create"), `must give the recovery step:\n${reason}`);
});

test("session machine: an evicted id is reported as evicted, with the cause and the recovery step", async () => {
  const first = await run("ldvh_report_session", {
    action: "create",
    question: "第一个会话会被淘汰吗？",
    purpose: "验证淘汰告知",
  });
  assert.equal(first.outcome, "completed");
  const evictedId = first.result.session_id;
  for (let i = 0; i < 32; i += 1) {
    await run("ldvh_report_session", { action: "create", question: `填充会话 ${i}？`, purpose: "占位" });
  }
  const out = await run("ldvh_report_session", { action: "state", session_id: evictedId });
  assert.equal(out.outcome, "rejected");
  const reason = out.gaps.join(" ");
  assert.ok(reason.includes("evicted"), `must name eviction rather than a bad id:\n${reason}`);
  assert.ok(reason.includes("at most 32"), `must state the cap:\n${reason}`);
});

test("session machine: clarification_log is reachable from the tool and reaches the bundle", async () => {
  const created = await run("ldvh_report_session", {
    action: "create",
    question: "澄清日志能进 bundle 吗？",
    purpose: "验证 §7.3 通道",
    clarification_log: [
      { question: "指哪一个编排？", answer: "指 DSH 子代理编排", answered_by: "human" },
    ],
  });
  assert.equal(created.outcome, "completed", JSON.stringify(created));
  const sessionId = created.result.session_id;

  const round = await run("ldvh_report_session", {
    action: "submit-round",
    session_id: sessionId,
    findings: [
      {
        statement: "澄清日志经工具参数可达",
        state: "confirmed",
        evidence: { text: "clarification_log 进入 bundle", anchor: "测试", source: "https://example.com/x", confidence: "high" },
      },
    ],
  });
  assert.equal(round.outcome, "completed", JSON.stringify(round));

  const bundle = await run("ldvh_report_session", { action: "finalize", session_id: sessionId });
  assert.equal(bundle.outcome, "completed", JSON.stringify(bundle));
  assert.equal(bundle.result.clarification_log.length, 1);
  assert.equal(bundle.result.clarification_log[0].answer, "指 DSH 子代理编排");
});


async function seededListFixture(base, count) {
  const { home, repo } = await governedFixture(base);
  const handlers = governedHandlers(home, base);
  for (let i = 0; i < count; i += 1) {
    const created = await handlers["ldvh_report_write"].execute(
      {
        action: "create",
        frontmatter_draft: {
          ...validFrontmatterDraft(),
          title: `候选条目 ${i}（渲染守卫）`,
        },
        analysis_body: ANALYSIS_BODY,
      },
      exec(repo),
    );
    assert.equal(created.outcome, "completed", JSON.stringify(created));
  }
  return { home, repo };
}

test("list render: the model actually sees each candidate, not just the outcome line", async () => {
  await withTemp("ldvh-rl.", async (base) => {
    const { home, repo } = await seededListFixture(base, 3);
    const out = await governedHandlers(home, base)["ldvh_report_list"].execute({}, exec(repo));
    assert.equal(out.outcome, "completed", JSON.stringify(out));
    assert.equal(out.result.items.length, 3);

    const raw = require_handlers().createHandlers({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
    const text = raw["ldvh_report_list"].output.render({}, { envelope: out }).map((b) => b.text).join("\n");

    assert.ok(text.includes(`count: ${out.result.count}`), `render must carry count:\n${text}`);
    for (const item of out.result.items) {
      assert.ok(
        text.includes(item.title),
        `render must carry candidate title "${item.title}" — an outcome line alone leaves the model blind:\n${text}`,
      );
    }
  });
});

test("list render: truncation reads as count (of total), never as a silently complete page", async () => {
  await withTemp("ldvh-rl.", async (base) => {
    const { home, repo } = await seededListFixture(base, 3);
    const out = await governedHandlers(home, base)["ldvh_report_list"].execute({ limit: 1 }, exec(repo));
    assert.equal(out.outcome, "partial", JSON.stringify(out));
    const raw = require_handlers().createHandlers({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
    const text = raw["ldvh_report_list"].output.render({ limit: 1 }, { envelope: out }).map((b) => b.text).join("\n");
    assert.ok(
      text.includes(`count: 1 (of ${out.result.total})`),
      `render must show the truncation as count (of total):\n${text}`,
    );
  });
});

test("list render: status and stopping_reason are visible per candidate (24 §12 triage fields)", async () => {
  await withTemp("ldvh-rl.", async (base) => {
    const { home, repo } = await seededListFixture(base, 2);
    const out = await governedHandlers(home, base)["ldvh_report_list"].execute({}, exec(repo));
    const raw = require_handlers().createHandlers({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
    const text = raw["ldvh_report_list"].output.render({}, { envelope: out }).map((b) => b.text).join("\n");
    for (const item of out.result.items) {
      assert.ok(text.includes(`[${item.status}]`), `render must carry status per item:\n${text}`);
      if (item.stopping_reason) {
        assert.ok(text.includes(`[${item.stopping_reason}]`), `render must carry stopping_reason per item:\n${text}`);
      }
    }
  });
});
