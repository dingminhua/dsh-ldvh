// Tests for plugin/lib/devlog-tools.js — the runtime wiring of the DevLog
// mechanical layer (specs/29 §13 受控操作 + specs/05 §8 envelope) into the
// governed ldvh_* tool surface.
//
// Coverage follows the friction-tools.test.mjs / adr-tools.test.mjs pattern:
// handlers are driven through registerDevLogTools's descriptors with a mock
// ctx.tools registry, a real governed-project fixture, and the full envelope
// shape is asserted. The writer seeds scenario data that the tools consume.
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as devlogToolsModule from "../lib/devlog-tools.js";
import { createDevLogObject, readDevLogObject } from "../lib/devlog-writer.js";
import { registerProject } from "../lib/governed-projects.js";
import { git, initRepo, sessionPersistenceWithRoutingLog, testSignature, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

const exec = (cwd) => ({ agent: { session: { header: { cwd } } } });

// ---------------------------------------------------------------------------
// Mock registry: capture the descriptors registerDevLogTools registers, then
// drive them exactly as the DSH runtime would.
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
	devlogToolsModule.registerDevLogTools(ctx, deps);
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

const TITLE = "单轮上限 20000 的实测边界";
const SUMMARY = "上限 20000 在实测语料下把截断损失从 36.9% 降到 0.21%，但在 28048 字的轮次上仍会截断，故「等价于全文」不成立。";

function validFrontmatterDraft(overrides = {}) {
	return {
		title: TITLE,
		occurred_at: "2026-01-01T00:00:00.000Z",
		summary: SUMMARY,
		change_summary: "受控创建（工具测试）",
		...overrides,
	};
}

function validBodyMarkdown(summary = SUMMARY, title = TITLE) {
	return [
		`## 背景\n要解决长会话材料在单轮渲染时被砍掉的问题。`,
		`## 做法\n把常量从 2000 提到 20000，保留 clamp 与 truncated 标记。`,
		`## 实测\n645 会话 / 1331 轮；上限 2000 损失 36.9%，上限 20000 损失 0.21%。`,
		`## 结论与边界\n${summary}`,
		`## 去向\n由提交 883a3cb 与 §7.1 共同承接。`,
	].join("\n\n");
}

async function governedFixture(base) {
	const home = join(base, "home");
	const repo = await initRepo(base);
	await mkdir(join(repo, "ldvh-base", "devlogs"), { recursive: true });
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

async function seedDevLog(root, overrides = {}) {
	const created = await createDevLogObject({
		factSourceRoot: root,
		frontmatterDraft: validFrontmatterDraft(overrides),
		bodyMarkdown: validBodyMarkdown(overrides.summary ?? SUMMARY, overrides.title ?? TITLE),
		sessionSignature: testSignature(),
	});
	assert.ok(created.ok, JSON.stringify(created.error));
	return created.value;
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

test("registers exactly the four devlog tools with the documented effects", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		assert.deepEqual(
			Object.keys(descriptors).sort(),
			["ldvh_devlog_list", "ldvh_devlog_precheck_create", "ldvh_devlog_read", "ldvh_devlog_write"],
		);
		assert.deepEqual(
			Object.entries(devlogToolsModule.OPERATIONS)
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([key, op]) => [key, op.effect]),
			[
				["devlog-list-objects", "read"],
				["devlog-precheck-create", "read"],
				["devlog-read-object", "read"],
				["devlog-write-object", "may_change_state"],
			],
		);
	});
});

test("every devlog descriptor declares its参数 as an object schema", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		for (const descriptor of Object.values(descriptors)) {
			assert.equal(descriptor.parameters.type, "object", descriptor.name);
			// 参数表由 defineTool 编译：宿主**不输出** additionalProperties，且参数根是隐式
			// 开放对象（不可关闭，spark-5b0b380e 核实）。因此不再断言「顶层封闭」——那在
			// 宿主层面不成立。真正拦住通道外字段的是 writer 的字段闭集，见 write-channel 测试。
			assert.ok(
				descriptor.parameters.properties !== undefined,
				`${descriptor.name} must declare its properties`,
			);
		}
	});
});

test("the write tool's frontmatter schema admits every AI-supplied field (29 §8 closed set)", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const fields = Object.keys(descriptors.ldvh_devlog_write.parameters.properties.frontmatter_draft.properties);
		for (const expected of ["title", "occurred_at", "summary", "serves", "disposition", "relations"]) {
			assert.ok(fields.includes(expected), `${expected} must be reachable from the tool plane`);
		}
	});
});

test("the DSH argument validator accepts a create carrying every optional field", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const args = {
			action: "create",
			frontmatter_draft: validFrontmatterDraft(),
			body_markdown: validBodyMarkdown(),
		};
		const violations = validateJsonSchemaValue(descriptors.ldvh_devlog_write.parameters, args, "");
		assert.deepEqual(violations, []);
	});
});

// ---------------------------------------------------------------------------
// Governance gate
// ---------------------------------------------------------------------------

test("an ungoverned cwd yields unavailable, not a silent empty result", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const env = await run(descriptors, "ldvh_devlog_list", {}, join(base, "elsewhere"));
		assert.equal(env.outcome, "unavailable");
		assert.ok(env.gaps.some((gap) => gap.includes("governance state")));
	});
});

// ---------------------------------------------------------------------------
// create + read
// ---------------------------------------------------------------------------

test("create returns completed with a bound precheck fingerprint and a read-back", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const pre = await run(descriptors, "ldvh_devlog_precheck_create", {
			frontmatter_draft: validFrontmatterDraft(),
			body_markdown: validBodyMarkdown(),
		}, repo);
		assert.equal(pre.outcome, "completed");
		assert.equal(pre.result.mechanical_outcome, "passed");

		const created = await run(descriptors, "ldvh_devlog_write", {
			action: "create",
			frontmatter_draft: validFrontmatterDraft(),
			body_markdown: validBodyMarkdown(),
			expected_candidate_fingerprint: pre.result.candidate_fingerprint,
		}, repo);
		assert.equal(created.outcome, "completed", JSON.stringify(created.gaps));
		assert.equal(created.result.precheck_fingerprint_bound, true);
		assert.equal(created.result.read_back, "ok");
		assert.deepEqual(created.scope.not_completed, []);
	});
});

test("create without a precheck fingerprint discloses the unfulfilled scope (02 §10.1)", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const created = await run(descriptors, "ldvh_devlog_write", {
			action: "create",
			frontmatter_draft: validFrontmatterDraft(),
			body_markdown: validBodyMarkdown(),
		}, repo);
		assert.equal(created.outcome, "completed");
		assert.equal(created.result.precheck_fingerprint_bound, false);
		assert.deepEqual(created.scope.not_completed, ["precheck (no candidate fingerprint supplied — this create was NOT covered by ldvh_devlog_precheck_create, 02 §10.1)"]);
		assert.ok(created.gaps.some((gap) => gap.includes("precheck-not-run")));
	});
});

test("read returns the frontmatter, the body and the fingerprint", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const seeded = await seedDevLog(join(repo, "ldvh-base"));
		const env = await run(descriptors, "ldvh_devlog_read", { object_uid: seeded.object_uid }, repo);
		assert.equal(env.outcome, "completed");
		assert.equal(env.result.title, TITLE);
		assert.equal(env.result.status, "active");
		assert.equal(env.result.occurred_at, "2026-01-01T00:00:00.000Z");
		assert.ok(env.result.body.includes("## 实测"));
		assert.equal(env.result.mechanical_issues.length, 0);
	});
});

test("reading an absorbed entry discloses the compression gap (29 §9.1)", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const factRoot = join(repo, "ldvh-base");
		const descriptors = makeDescriptors(makeDeps(home, base));
		const seeded = await seedDevLog(factRoot);
		// A real commit in the fixture repo, so the commit-form absorbed-into
		// target genuinely resolves (02 §8.1 第 ② 条) — a fake hash would refuse.
		await git(repo, ["add", "-A"]);
		await git(repo, ["commit", "-q", "-m", "chore: fixture commit for absorb target"]);
		const commit = await git(repo, ["rev-parse", "HEAD"]);
		const read = await readDevLogObject({ factSourceRoot: factRoot, objectUid: seeded.object_uid });
		const { updateDevLogObject } = await import("../lib/devlog-writer.js");
		const absorbed = await updateDevLogObject({
			factSourceRoot: factRoot,
			objectUid: seeded.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: {
				status: "absorbed",
				relations: [{ relation_key: "absorbed-into", target: { commit } }],
			},
			bodyMarkdownAfter: `# ${TITLE}\n\n## 结论与边界\n\n${SUMMARY}\n\n## 去向\n\n由提交 ${commit.slice(0, 7)} 承接。`,
			changeSummary: "结论被该提交完整承接，转 absorbed",
			sessionSignature: testSignature(),
			gitCommitResolver: async (hash) => hash === commit,
		});
		assert.equal(absorbed.ok, true, absorbed.ok ? "" : JSON.stringify(absorbed.error));
		const env = await run(descriptors, "ldvh_devlog_read", { object_uid: seeded.object_uid }, repo);
		assert.equal(env.outcome, "completed");
		assert.equal(env.result.status, "absorbed");
		assert.equal(env.gaps.some((gap) => gap.includes("compressed")), true, env.gaps.join("; "));
		// 29 §9.1: compression really removed the evidence sections.
		assert.equal(env.result.body.includes("## 实测"), false);
	});
});

test("a dropped entry does NOT get the compression gap — it keeps the full text (29 §9.1)", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const factRoot = join(repo, "ldvh-base");
		const descriptors = makeDescriptors(makeDeps(home, base));
		const seeded = await seedDevLog(factRoot);
		const read = await readDevLogObject({ factSourceRoot: factRoot, objectUid: seeded.object_uid });
		const { updateDevLogObject } = await import("../lib/devlog-writer.js");
		await updateDevLogObject({
			factSourceRoot: factRoot,
			objectUid: seeded.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: { status: "dropped", disposition: "前提消失。" },
			bodyMarkdownAfter: `# ${TITLE}\n\n${validBodyMarkdown()}`,
			changeSummary: "转 dropped",
			sessionSignature: testSignature(),
		});
		const env = await run(descriptors, "ldvh_devlog_read", { object_uid: seeded.object_uid }, repo);
		assert.equal(env.outcome, "completed");
		assert.equal(env.result.status, "dropped");
		assert.equal(env.gaps.some((gap) => gap.includes("compressed")), false);
		assert.equal(env.result.body.includes("## 实测"), true);
	});
});

test("a missing object is rejected with a not_found gap", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const env = await run(descriptors, "ldvh_devlog_read", { object_uid: "11111111-1111-4111-8111-111111111111" }, repo);
		assert.equal(env.outcome, "rejected");
		assert.ok(env.gaps.some((gap) => gap.includes("devlog/not_found")));
	});
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

test("list defaults to active and reports the filter it applied", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const factRoot = join(repo, "ldvh-base");
		await seedDevLog(factRoot);
		const env = await run(descriptors, "ldvh_devlog_list", {}, repo);
		assert.equal(env.outcome, "completed");
		assert.equal(env.result.filter, "active");
		assert.equal(env.result.total, 1);
		assert.equal(env.result.items[0].title, TITLE);
	});
});

// ---------------------------------------------------------------------------
// write failures map to the right outcome
// ---------------------------------------------------------------------------

test("a mechanical refusal is rejected, not unavailable (the request shape is wrong)", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const created = await run(descriptors, "ldvh_devlog_write", {
			action: "create",
			frontmatter_draft: validFrontmatterDraft({ title: "长".repeat(41) }),
			body_markdown: validBodyMarkdown(),
		}, repo);
		assert.equal(created.outcome, "rejected");
		assert.ok(created.gaps.some((gap) => gap.includes("devlog/frontmatter_invalid")));
	});
});

test("a stale CAS baseline is rejected rather than overwriting", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const factRoot = join(repo, "ldvh-base");
		const descriptors = makeDescriptors(makeDeps(home, base));
		const seeded = await seedDevLog(factRoot);
		const env = await run(descriptors, "ldvh_devlog_write", {
			action: "update",
			object_uid: seeded.object_uid,
			expected_fingerprint: "0".repeat(64),
			frontmatter_after: {},
			body_markdown_after: `# ${TITLE}\n\n${validBodyMarkdown()}`,
			change_summary: "用过期基线更新",
		}, repo);
		assert.equal(env.outcome, "rejected");
		assert.ok(env.gaps.some((gap) => gap.includes("devlog/fingerprint_mismatch")));
	});
});

test("update requires change_summary before touching the disk", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const factRoot = join(repo, "ldvh-base");
		const descriptors = makeDescriptors(makeDeps(home, base));
		const seeded = await seedDevLog(factRoot);
		const read = await readDevLogObject({ factSourceRoot: factRoot, objectUid: seeded.object_uid });
		const env = await run(descriptors, "ldvh_devlog_write", {
			action: "update",
			object_uid: seeded.object_uid,
			expected_fingerprint: read.value.fingerprint,
			frontmatter_after: {},
			body_markdown_after: `# ${TITLE}\n\n${validBodyMarkdown()}`,
		}, repo);
		assert.equal(env.outcome, "invalid_request");
		assert.ok(env.gaps.some((gap) => gap.includes("change_summary")));
	});
});

test("a terminal object cannot be reopened through the tool plane (29 §9.2)", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const factRoot = join(repo, "ldvh-base");
		const descriptors = makeDescriptors(makeDeps(home, base));
		const seeded = await seedDevLog(factRoot);
		const read = await readDevLogObject({ factSourceRoot: factRoot, objectUid: seeded.object_uid });
		const dropped = await run(descriptors, "ldvh_devlog_write", {
			action: "update",
			object_uid: seeded.object_uid,
			expected_fingerprint: read.value.fingerprint,
			frontmatter_after: { status: "dropped", disposition: "前提消失。" },
			body_markdown_after: `# ${TITLE}\n\n${validBodyMarkdown()}`,
			change_summary: "转 dropped",
		}, repo);
		assert.equal(dropped.outcome, "completed", JSON.stringify(dropped.gaps));
		const reopen = await run(descriptors, "ldvh_devlog_write", {
			action: "update",
			object_uid: seeded.object_uid,
			expected_fingerprint: dropped.result.fingerprint,
			frontmatter_after: { status: "active" },
			body_markdown_after: `# ${TITLE}\n\n${validBodyMarkdown()}`,
			change_summary: "试图重开",
		}, repo);
		assert.equal(reopen.outcome, "rejected");
		assert.ok(reopen.gaps.some((gap) => gap.includes("devlog/terminal_readonly")));
		assert.ok(reopen.follow_up.some((item) => item.includes("create a NEW entry")));
	});
});

// ---------------------------------------------------------------------------
// Rendering (05 §8)
// ---------------------------------------------------------------------------

test("the render function emits a text block with gaps and follow-ups", async () => {
	await withTemp("ldvh-devlogtools.", async (base) => {
		const { home, repo } = await governedFixture(base);
		const descriptors = makeDescriptors(makeDeps(home, base));
		const env = await run(descriptors, "ldvh_devlog_read", { object_uid: "11111111-1111-4111-8111-111111111111" }, repo);
		const rendered = descriptors.ldvh_devlog_read.output.render({}, { envelope: env });
		assert.equal(rendered[0].type, "text");
		assert.match(rendered[0].text, /ldvh_devlog_read|devlog-read-object/);
		assert.match(rendered[0].text, /devlog\/not_found/);
	});
});
