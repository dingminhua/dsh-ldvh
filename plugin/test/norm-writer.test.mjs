// Norm writer + tools: the mechanical slice of specs/27 §11 and §13.
//
// Coverage focus — the three uniqueness layers and the lifecycle lanes, plus
// the schema↔writer field agreement that a prior defect (aa12604) showed can
// drift silently:
//   - layer 1 (pre-write refusal, ERR_DIRECTION_ALREADY_EXISTS)
//   - layer 3 (consumption fail-closed on direction_collision)
//   - active→active errata lane with direction_key held fixed
//   - active→retired terminal transition + read-only afterwards
//   - the tool-surface schema admits every field the writer's closed set
//     accepts (the "no field is unreachable through the tool plane" guard)

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	createNormObject,
	readNormObject,
	updateNormObject,
	listNormObjects,
	validateNormFrontmatter,
	validateNormBodyStructure,
	ERR_DIRECTION_ALREADY_EXISTS,
	NORM_DIRECTORY,
} from "../lib/norm-writer.js";
import { OPERATIONS, toolDescriptorFor } from "../lib/norm-tools.js";
import { ID_PATTERN } from "../lib/spec-registry.js";
import { withTemp, testSignature } from "./helpers.mjs";

const BODY_H2 = `## 方向定位与适用范围

本规范管辖插件运行时的代码风格与可读性基线。

## 核心规则体系

- 一律使用 ESM，不使用 CommonJS。
- 导入路径必须带扩展名。

## 约束与反模式

禁止在 lib/ 下引入 TypeScript 源文件。

## 验证与遵从性检查

以 eslint 配置为准；新增规则须同时补充测试。
`;

async function factRoot(base) {
	const root = join(base, "ldvh-base");
	await mkdir(join(root, NORM_DIRECTORY), { recursive: true });
	return root;
}

function createArgs(root, overrides = {}) {
	return {
		factSourceRoot: root,
		frontmatterDraft: { title: "代码风格", direction_key: "code-style", ...overrides.draft },
		bodyMarkdown: overrides.bodyMarkdown ?? BODY_H2,
		sessionSignature: overrides.sessionSignature === undefined ? testSignature() : overrides.sessionSignature,
	};
}

// ---------------------------------------------------------------------------
// Frontmatter / body closed sets (27 §8)
// ---------------------------------------------------------------------------

test("frontmatter: closed set rejects unknown fields; direction_key uses the 01.Att.02 identifier pattern", () => {
	const base = {
		object_uid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		fact_type_key: "norm",
		title: "代码风格",
		created_at: "2026-09-13T00:00:00.000Z",
		status: "active",
		direction_key: "code-style",
	};
	assert.equal(validateNormFrontmatter(base).ok, true);

	const unknown = validateNormFrontmatter({ ...base, norm_source: "specs/09" });
	assert.equal(unknown.ok, false);
	assert.ok(unknown.issues.some((issue) => issue.includes("norm_source")));

	// 27 §13.1 pins direction_key to the ID_PATTERN authority — not a copy.
	assert.equal(ID_PATTERN.test("code-style"), true);
	assert.equal(ID_PATTERN.test("Code_Style"), false);
	const bad = validateNormFrontmatter({ ...base, direction_key: "Code_Style" });
	assert.equal(bad.ok, false);
	assert.ok(bad.issues.some((issue) => issue.includes("direction_key")));
});

test("frontmatter: title cap is 40 characters (27 §8)", () => {
	const base = {
		object_uid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		fact_type_key: "norm",
		created_at: "2026-09-13T00:00:00.000Z",
		status: "active",
		direction_key: "code-style",
	};
	assert.equal(validateNormFrontmatter({ ...base, title: "x".repeat(40) }).ok, true);
	const over = validateNormFrontmatter({ ...base, title: "x".repeat(41) });
	assert.equal(over.ok, false);
	assert.ok(over.issues.some((issue) => issue.includes("≤ 40")));
});

test("frontmatter: status ⇔ terminal-field invariants (27 §8/§13.1)", () => {
	const base = {
		object_uid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		fact_type_key: "norm",
		title: "T",
		created_at: "2026-09-13T00:00:00.000Z",
		direction_key: "code-style",
	};
	// active must not carry terminal fields
	assert.equal(validateNormFrontmatter({ ...base, status: "active", retirement_reason: "outdated" }).ok, false);
	assert.equal(validateNormFrontmatter({ ...base, status: "active", retired_at: "2026-09-13T00:00:00.000Z" }).ok, false);
	// retired requires both, reason within the closed set
	assert.equal(validateNormFrontmatter({ ...base, status: "retired" }).ok, false);
	assert.equal(validateNormFrontmatter({ ...base, status: "retired", retirement_reason: "nonsense", retired_at: "2026-09-13T00:00:00.000Z" }).ok, false);
	assert.equal(validateNormFrontmatter({ ...base, status: "retired", retirement_reason: "outdated", retired_at: "2026-09-13T00:00:00.000Z" }).ok, true);
	// relations is not a Norm field (27 §9)
	assert.equal(validateNormFrontmatter({ ...base, status: "active", relations: [] }).ok, false);
});

test("body: all four fixed H2 sections must exist and be non-empty (27 §8)", () => {
	const title = "代码风格";
	const full = `# ${title}\n\n${BODY_H2}`;
	assert.equal(validateNormBodyStructure(full, title).ok, true);

	const missing = `# ${title}\n\n## 方向定位与适用范围\n\n内容\n`;
	const missingCheck = validateNormBodyStructure(missing, title);
	assert.equal(missingCheck.ok, false);
	assert.equal(missingCheck.issues.filter((issue) => issue.includes("missing required H2")).length, 3);

	const empty = `# ${title}\n\n## 方向定位与适用范围\n\n\n## 核心规则体系\n\nx\n## 约束与反模式\n\nx\n## 验证与遵从性检查\n\nx\n`;
	const emptyCheck = validateNormBodyStructure(empty, title);
	assert.equal(emptyCheck.ok, false);
	assert.ok(emptyCheck.issues.some((issue) => issue.includes("non-empty")));
});

// ---------------------------------------------------------------------------
// Create (27 §8.1 legal initial state + §11 uniqueness layer 1)
// ---------------------------------------------------------------------------

test("create: initialises as active with a signed change_log and Code-assigned identity", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const created = await createNormObject(createArgs(root));
		assert.equal(created.ok, true);

		const read = await readNormObject({ factSourceRoot: root, objectUid: created.value.object_uid });
		assert.equal(read.ok, true);
		assert.equal(read.value.frontmatter.status, "active");
		assert.equal(read.value.frontmatter.direction_key, "code-style");
		assert.equal(read.value.frontmatter.fact_type_key, "norm");
		assert.equal(read.value.frontmatter.change_log.length, 1);
		assert.equal(read.value.frontmatter.change_log[0].provider, "test-provider");
		assert.equal(read.value.body_valid, true);
		assert.deepEqual(read.value.mechanical_issues, []);
	});
});

test("create: refuses status=retired (27 §8.1 — the only legal initial state is active)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const created = await createNormObject(createArgs(root, { draft: { status: "retired" } }));
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "norm/initial_state_violation");
	});
});

test("create: refuses an unsigned write (09 机械签名)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const created = await createNormObject(createArgs(root, { sessionSignature: null }));
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "signature_unavailable");
	});
});

test("create: layer 1 refuses a second ACTIVE Norm on the same direction_key", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		assert.equal((await createNormObject(createArgs(root))).ok, true);
		const second = await createNormObject(createArgs(root, { draft: { title: "重复方向" } }));
		assert.equal(second.ok, false);
		assert.equal(second.error.code, ERR_DIRECTION_ALREADY_EXISTS);
	});
});

test("create: layer 1 allows reusing a direction_key once the previous Norm is retired (27 §11)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const first = await createNormObject(createArgs(root));
		const read = await readNormObject({ factSourceRoot: root, objectUid: first.value.object_uid });
		const { change_summary: _drop, ...fm } = read.value.frontmatter;
		const retired = await updateNormObject({
			factSourceRoot: root,
			objectUid: first.value.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: { ...fm, status: "retired", retirement_reason: "outdated" },
			bodyMarkdownAfter: read.value.body,
			changeSummary: "退役",
			sessionSignature: testSignature(),
		});
		assert.equal(retired.ok, true);

		// Same direction_key, new object — the formula counts ACTIVE only.
		const reused = await createNormObject(createArgs(root, { draft: { title: "代码风格（重启）" } }));
		assert.equal(reused.ok, true);
		assert.notEqual(reused.value.object_uid, first.value.object_uid);
	});
});

// ---------------------------------------------------------------------------
// Update lanes (27 §8.1)
// ---------------------------------------------------------------------------

async function createAndRead(root) {
	const created = await createNormObject(createArgs(root));
	const read = await readNormObject({ factSourceRoot: root, objectUid: created.value.object_uid });
	const { change_summary: _drop, ...fm } = read.value.frontmatter;
	return { uid: created.value.object_uid, fm, body: read.value.body, fingerprint: read.value.fingerprint };
}

test("update: active→active is errata; direction_key is held fixed mechanically (27 §13.2)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const { uid, fm, body, fingerprint } = await createAndRead(root);
		const edited = body.replace("一律使用 ESM，不使用 CommonJS。", "一律使用 ESM，不使用 CommonJS（含测试夹具）。");

		const updated = await updateNormObject({
			factSourceRoot: root,
			objectUid: uid,
			expectedFingerprint: fingerprint,
			frontmatterAfter: fm,
			bodyMarkdownAfter: edited,
			changeSummary: "勘误：澄清适用范围",
			sessionSignature: testSignature(),
		});
		assert.equal(updated.ok, true);
		assert.equal(updated.value.transition, "errata");

		// direction drift must be refused as an in-place update
		const drift = await updateNormObject({
			factSourceRoot: root,
			objectUid: uid,
			expectedFingerprint: updated.value.fingerprint,
			frontmatterAfter: { ...fm, direction_key: "other-direction" },
			bodyMarkdownAfter: edited,
			changeSummary: "试图改方向键",
			sessionSignature: testSignature(),
		});
		assert.equal(drift.ok, false);
		assert.equal(drift.error.code, "norm/direction_key_immutable");
	});
});

test("update: CAS baseline mismatch is refused (03 §9.5)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const { uid, fm, body } = await createAndRead(root);
		const stale = await updateNormObject({
			factSourceRoot: root,
			objectUid: uid,
			expectedFingerprint: "0".repeat(64),
			frontmatterAfter: fm,
			bodyMarkdownAfter: body,
			changeSummary: "陈旧基线",
			sessionSignature: testSignature(),
		});
		assert.equal(stale.ok, false);
		assert.equal(stale.error.code, "norm/fingerprint_mismatch");
	});
});

test("update: active→retired is terminal and read-only afterwards (27 §8.1)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const { uid, fm, body, fingerprint } = await createAndRead(root);
		const retired = await updateNormObject({
			factSourceRoot: root,
			objectUid: uid,
			expectedFingerprint: fingerprint,
			frontmatterAfter: { ...fm, status: "retired", retirement_reason: "outdated" },
			bodyMarkdownAfter: body,
			changeSummary: "退役：方向不再需要",
			sessionSignature: testSignature(),
		});
		assert.equal(retired.ok, true);
		assert.equal(retired.value.transition, "retire");

		const read = await readNormObject({ factSourceRoot: root, objectUid: uid });
		assert.equal(read.value.frontmatter.status, "retired");
		assert.equal(read.value.frontmatter.retirement_reason, "outdated");
		assert.equal(typeof read.value.frontmatter.retired_at, "string");
		assert.equal(read.value.frontmatter.change_log.length, 2);

		const reopen = await updateNormObject({
			factSourceRoot: root,
			objectUid: uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: fm,
			bodyMarkdownAfter: body,
			changeSummary: "试图复活",
			sessionSignature: testSignature(),
		});
		assert.equal(reopen.ok, false);
		assert.equal(reopen.error.code, "norm/terminal_readonly");
	});
});

test("update: superseded requires another resolvable active Norm (27 §8.1)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const { uid, fm, body, fingerprint } = await createAndRead(root);
		// No other active Norm exists, so superseded cannot resolve a successor.
		const bad = await updateNormObject({
			factSourceRoot: root,
			objectUid: uid,
			expectedFingerprint: fingerprint,
			frontmatterAfter: { ...fm, status: "retired", retirement_reason: "superseded" },
			bodyMarkdownAfter: body,
			changeSummary: "被替代",
			sessionSignature: testSignature(),
		});
		assert.equal(bad.ok, false);
		assert.equal(bad.error.code, "norm/superseded_unresolvable");

		// With a second active Norm present the same transition is accepted.
		assert.equal((await createNormObject(createArgs(root, { draft: { title: "安全策略", direction_key: "security" } }))).ok, true);
		const good = await updateNormObject({
			factSourceRoot: root,
			objectUid: uid,
			expectedFingerprint: fingerprint,
			frontmatterAfter: { ...fm, status: "retired", retirement_reason: "superseded" },
			bodyMarkdownAfter: body,
			changeSummary: "被安全策略替代",
			sessionSignature: testSignature(),
		});
		assert.equal(good.ok, true);
	});
});

// ---------------------------------------------------------------------------
// Layer 3 — consumption fail-closed (27 §11 item 3)
// ---------------------------------------------------------------------------

test("list: layer 3 withholds every colliding active Norm and reports direction_collision", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		// Hand-written carriers (the layer-1 writer is bypassed on purpose —
		// that is exactly the situation layer 2/3 exist for).
		for (const [uid, key] of [
			["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "shared-key"],
			["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "shared-key"],
		]) {
			await writeFile(
				join(root, NORM_DIRECTORY, `norm-${uid}.md`),
				`---\ntitle: 方向\nstatus: active\ndirection_key: ${key}\nobject_uid: ${uid}\nfact_type_key: norm\ncreated_at: 2026-09-13T00:00:00.000Z\n---\n\n# 方向\n`,
				"utf8",
			);
		}
		const listed = await listNormObjects({ factSourceRoot: root, status: "all" });
		assert.equal(listed.ok, true);
		assert.equal(listed.value.total, 0, "colliding Norms must not be served");
		assert.equal(listed.value.withheld_count, 2);
		assert.equal(listed.value.gaps.length, 1);
		assert.equal(listed.value.gaps[0].reason, "direction_collision");
		assert.equal(listed.value.gaps[0].direction_key, "shared-key");
	});
});

test("list: unreadable carriers are reported, not silently dropped", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		await writeFile(join(root, NORM_DIRECTORY, "norm-broken.md"), "no frontmatter fence here\n", "utf8");
		const listed = await listNormObjects({ factSourceRoot: root, status: "all" });
		assert.equal(listed.ok, true);
		assert.equal(listed.value.unreadable.length, 1);
		assert.match(listed.value.unreadable[0].reason, /frontmatter/);
	});
});

test("list: active-only by default; retired surfaces only with status=all (27 §10)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const { uid, fm, body, fingerprint } = await createAndRead(root);
		await updateNormObject({
			factSourceRoot: root,
			objectUid: uid,
			expectedFingerprint: fingerprint,
			frontmatterAfter: { ...fm, status: "retired", retirement_reason: "out-of-scope" },
			bodyMarkdownAfter: body,
			changeSummary: "退役",
			sessionSignature: testSignature(),
		});
		assert.equal((await listNormObjects({ factSourceRoot: root })).value.total, 0);
		assert.equal((await listNormObjects({ factSourceRoot: root, status: "all" })).value.total, 1);
	});
});

// ---------------------------------------------------------------------------
// Tool-plane reachability (the aa12604 defect class)
// ---------------------------------------------------------------------------

test("tools: every writer-accepted AI field is reachable through the tool schema", () => {
	// The writer's closed set minus Code-assigned fields is the set of fields AI
	// supplies. The tool schema declares `additionalProperties: false`, so a
	// field missing from the schema is UNREACHABLE through the tool plane even
	// though the writer would accept it (this is exactly the aa12604 defect:
	// priority existed in the writer but not in spark-tools' schema).
	const AI_FIELDS = ["title", "status", "direction_key", "retirement_reason"];
	const descriptor = toolDescriptorFor(
		"norm-write-object",
		OPERATIONS["norm-write-object"],
		() => {},
	);
	const draftFields = Object.keys(descriptor.parameters.properties.frontmatter_draft.properties)
		.filter((field) => field !== "change_summary");
	for (const field of AI_FIELDS) {
		assert.ok(
			draftFields.includes(field),
			`field "${field}" is accepted by the writer but unreachable via the tool schema`,
		);
	}
	assert.equal(descriptor.parameters.properties.frontmatter_draft.additionalProperties, false);
});

test("tools: write is registered as write-shaped so the guard covers it", async () => {
	// The coverage set is populated when the tools are REGISTERED (each module
	// registers its own writer at that point, so the guard reflects what the
	// build really exposes rather than a hardcoded list that can drift).
	const { writeShapedTools } = await import("../lib/host-seams.js");
	const { registerNormTools } = await import("../lib/norm-tools.js");
	const registered = [];
	registerNormTools({ tools: { register: (descriptor) => { registered.push(descriptor.name); return () => {}; } } }, {});
	assert.deepEqual(
		registered.sort(),
		["ldvh_norm_list", "ldvh_norm_read", "ldvh_norm_write"],
		"registration must expose exactly the three declared Norm tools",
	);
	assert.ok(
		writeShapedTools().includes("ldvh_norm_write"),
		"the write tool must join the guard's coverage set",
	);
});

test("tools: output.render returns an array of content blocks (never a bare string)", () => {
	// Regression guard for the `content.some is not a function` incident: the
	// DSH tool layer calls `result.content.some((block) => block.type ===
	// "image")` on EVERY tool result, so a string return kills the whole batch
	// before the model ever sees it. All three Norm tools are exercised, and
	// both string and structured gaps must survive.
	for (const operationKey of Object.keys(OPERATIONS)) {
		const descriptor = toolDescriptorFor(operationKey, OPERATIONS[operationKey], () => {});
		const blocks = descriptor.output.render({}, {
			envelope: {
				operation_key: operationKey,
				outcome: "partial",
				result: null,
				gaps: ["plain gap", { responsibility_key: null, reason: "structured" }],
				follow_up: [],
			},
		});
		assert.ok(Array.isArray(blocks), `${operationKey}: render must return an array`);
		assert.ok(blocks.length > 0, `${operationKey}: render must return at least one block`);
		for (const block of blocks) {
			assert.equal(typeof block.type, "string", `${operationKey}: each block needs a string type`);
			assert.equal(typeof block.text, "string", `${operationKey}: each text block needs string text`);
		}
		// The exact call dsh-tools performs on the result.
		assert.equal(blocks.some((block) => block.type === "image"), false);
		assert.ok(!blocks[0].text.includes("[object Object]"), "structured gaps must not render as [object Object]");
	}
});

test("tools: read/list are declared read-effect; write is may_change_state", () => {
	assert.equal(OPERATIONS["norm-read-object"].effect, "read");
	assert.equal(OPERATIONS["norm-list-objects"].effect, "read");
	assert.equal(OPERATIONS["norm-write-object"].effect, "may_change_state");
	assert.equal(OPERATIONS["norm-write-object"].writeShaped, true);
});

// ---------------------------------------------------------------------------
// Carrier shape
// ---------------------------------------------------------------------------

test("carrier: file name encodes the UID and the H1 mirrors the title (27 §7)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const created = await createNormObject(createArgs(root));
		const file = join(root, NORM_DIRECTORY, `norm-${created.value.object_uid}.md`);
		const raw = await readFile(file, "utf8");
		assert.ok(raw.startsWith("---\n"));
		assert.ok(raw.includes("\n# 代码风格\n") || raw.includes("# 代码风格\n"));
	});
});
