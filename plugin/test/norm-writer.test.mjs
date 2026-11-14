// Norm writer + tools: the mechanical slice of specs/27 §11 and §13.
//
// Coverage focus — the three uniqueness layers and the lifecycle lanes, plus
// the schema↔writer field agreement that a prior defect (aa12604) showed can
// drift silently:
//   - layer 1 (pre-write refusal, ERR_DIRECTION_ALREADY_EXISTS)
//   - the refusal must let the caller IDENTIFY the occupant, and the tool layer
//     must render it into `gaps` (friction cccb379f: object-shaped details used
//     to fall through `Array.isArray` and vanish, leaving a bare code)
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
import { OPERATIONS, toolDescriptorFor, writeRejected } from "../lib/norm-tools.js";
import * as normToolsModule from "../lib/norm-tools.js";
import { ID_PATTERN } from "../lib/spec-registry.js";
import { withTemp, testSignature, initRepo, sessionPersistenceWithRoutingLog } from "./helpers.mjs";
import { registerProject } from "../lib/governed-projects.js";
const dshHome = (home) => (...segments) => join(home, ...segments);

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

test("create: the refusal names the occupant and the tool layer renders it (friction cccb379f)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const first = await createNormObject(createArgs(root));
		assert.equal(first.ok, true);
		const second = await createNormObject(createArgs(root, { draft: { title: "重复方向" } }));
		assert.equal(second.ok, false);
		assert.equal(second.error.code, ERR_DIRECTION_ALREADY_EXISTS);

		// 写入器一侧：载荷须让占用者可被识别（title/status），而不只是一个 uid。
		const conflicts = second.error.details?.conflicts;
		assert.ok(Array.isArray(conflicts) && conflicts.length === 1, "载荷必须携带占用者");
		assert.equal(conflicts[0].title, "代码风格");
		assert.equal(conflicts[0].status, "active");
		assert.equal(conflicts[0].object_uid, first.value.object_uid);

		// 工具层一侧：把**上面这个真实载荷**喂进映射器，两半由同一条测试锁住。
		const rejected = writeRejected("norm-write-object", second, root, "create");
		assert.equal(rejected.outcome, "rejected");
		assert.ok(rejected.gaps.some((gap) => gap.includes("代码风格")), "占用者标题必须抵达调用方");
		assert.ok(rejected.gaps.some((gap) => gap.includes(first.value.object_uid)), "占用者 object_uid 必须抵达调用方");
		assert.ok(rejected.gaps.some((gap) => gap.includes("code-style")), "方向键必须出现在拒绝信息里");
		// 回归：对象型 details 不再被 Array.isArray 判否而整体落空。
		assert.ok(rejected.gaps.length >= 3, "除错误码外至少还要有占用者行");
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

// 34 §8.1 适用识别：AI 仅凭标题无法判断哪份规范在管当次事项，故 list 投影
// 须给出「方向定位与适用范围」段的确定性摘录，供其决定展开哪份（ldvh_norm_read）。
// 该摘录是正文的派生视图、不是新增 frontmatter 字段（27 §7 载体内聚不破）。
test("list: projections carry a bounded, deterministic 方向定位 excerpt", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		// 直接以带「管什么」标记的四段正文创建，模拟真实 Norm 的方向定位段。
		const body = `## 方向定位与适用范围

**管什么**：本方向管示例事务的准入与边界，不回答其它方向的判定。

## 核心规则体系

规则一。

## 约束与反模式

禁止项。

## 验证与遵从性检查

核对方式。
`;
		const created = await createNormObject(createArgs(root, { bodyMarkdown: body }));
		const uid = created.value.object_uid;

		const listed = await listNormObjects({ factSourceRoot: root });
		const item = listed.value.items.find((i) => i.object_uid === uid);
		assert.ok(item, "the created Norm must be listed");
		assert.equal(typeof item.positioning, "string");
		assert.match(item.positioning, /本方向管示例事务的准入与边界/);
		assert.ok(!item.positioning.includes("管什么"), "markdown 标记须剥除");
		assert.ok(!item.positioning.includes("**"), "强调标记须剥除");
		// 27 §8 契约：≤60 字、无截断（超限即不合格、不外发）。断言具体长度而非
		// 恒真的上界，使「实现把上限放宽」时本用例会红（06 §7 断言检测力）。
		assert.ok(item.positioning.length <= 60, "摘录须 ≤60 字（27 §8 书写契约）");
		assert.ok(!item.positioning.endsWith("…"), "合契约时不得出现截断省略号");
		// 确定性：同一载体两次调用逐字相同。
		const again = await listNormObjects({ factSourceRoot: root });
		assert.equal(again.value.items.find((i) => i.object_uid === uid).positioning, item.positioning);
	});
});

// 27 §8 书写契约 / M1 防线：不合契约的首段（无标签、含授权措辞、超长）
// 绝不外发成「定位」摘录，须显式标 unavailable 并指引读正文（34 §12 三态）。
// 旧「上游更新跟进规程」的整段首句是「…AI 无须另行请示即可按本规程跟进」，
// 回退取首段会把一句脱离上下文的授权抛给 AI。
test("list: 方向定位不合契约时不外发摘录、显式标 unavailable", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const body = `## 方向定位与适用范围

当 Human 告知上游已更新时，AI 无须另行请示即可按本规程跟进；适用于差分全过程。

## 核心规则体系

规则一。

## 约束与反模式

禁止项。

## 验证与遵从性检查

核对方式。
`;
		const created = await createNormObject(createArgs(root, { bodyMarkdown: body }));
		const uid = created.value.object_uid;
		const item = (await listNormObjects({ factSourceRoot: root })).value.items.find((i) => i.object_uid === uid);
		assert.equal(item.positioning, "", "无「管什么」标签且含授权措辞时不得外发摘录");
		assert.match(item.positioning_status, /unavailable/, "须显式标注不可用");
		assert.match(item.positioning_status, /ldvh_norm_read/, "须指引读正文，不静默当成没有定位");
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

// ---------------------------------------------------------------------------
// 02 §9.3 指称形态：工具的 JSON 输出不得留下裸 object_uid
// ---------------------------------------------------------------------------

test("render: norm read/list JSON output carries the typed reference, not a bare uid (02 §9.3)", () => {
	const uid = "abf557e1-1111-2222-3333-444455556666";
	for (const [operationKey, result] of [
		["norm-read-object", { object_uid: uid, title: "代码风格", fact_type_key: "norm" }],
		["norm-list-objects", { count: 1, total: 1, items: [{ object_uid: uid, title: "代码风格", status: "active" }] }],
	]) {
		const descriptor = toolDescriptorFor(operationKey, OPERATIONS[operationKey], () => {});
		const blocks = descriptor.output.render({}, {
			envelope: { operation_key: operationKey, outcome: "completed", result, gaps: [], follow_up: [] },
		});
		const rendered = blocks.map((block) => block.text).join("\n");
		assert.ok(
			rendered.includes("norm-abf557e1"),
			`${operationKey}: the reference must carry its type (got: ${rendered})`,
		);
		assert.ok(
			!rendered.includes(uid),
			`${operationKey}: the full raw uid must not be the reference form (got: ${rendered})`,
		);
	}
});

test("render: an unattributable uid is left alone rather than given a guessed type (02 §9.3)", () => {
	const descriptor = toolDescriptorFor("norm-list-objects", OPERATIONS["norm-list-objects"], () => {});
	const blocks = descriptor.output.render({}, {
		envelope: {
			operation_key: "some-other-operation",
			outcome: "completed",
			result: { object_uid: "deadbeef-0000-0000-0000-000000000000" },
			gaps: [],
			follow_up: [],
		},
	});
	const rendered = blocks.map((block) => block.text).join("\n");
	assert.ok(
		!rendered.includes("norm-deadbeef"),
		"a non-Norm envelope must not stamp the norm type onto its uids",
	);
	assert.ok(rendered.includes("deadbeef"), "the uid must still be visible, not dropped");
});

// ---------------------------------------------------------------------------
// 27 §15 Human Gate（2026-11-15）：create 与 retire 必须在落盘之前取得 Human 确认
// ---------------------------------------------------------------------------
//
// 这个缺口此前**测试完全覆盖不到**：norm-writer 的机械层是对的，缺的是「谁在写
// 之前问过」。而这一层在真实组合里不生效时，表现是「写入照常成功」——没有任何
// 断言会红。故这几条用例钉的是**调用点的行为**，不是 writer 的内部。
// 删掉 `requestNormGate` 的两处调用，本组全红；这不是靠读代码看出来的。

/** 造一个受管辖的仓库 + 登记。与 `adr-tools.test.mjs` 同一形态（不另造一套夹具）。 */
async function governedFixture(base) {
	const home = join(base, "home");
	const repo = await initRepo(base);
	await mkdir(join(repo, "ldvh-base", "norms"), { recursive: true });
	await registerProject(dshHome(home), { id: "demo", path: repo });
	return { home, repo, root: join(repo, "ldvh-base") };
}

/**
 * 造一个最小 hostSeams 替身：记录问了几次、并按 `answer` 给答复。
 * `null` = 人没答（须 fail-closed）。镜像 `adr-tools.test.mjs` 的 `adrSeam`。
 */
function fakeSeams(answer = "确认") {
	const calls = [];
	return {
		calls,
		async requestNormConsent(payload) {
			calls.push(payload);
			if (answer === null) return { granted: false, reason: "human did not answer" };
			if (answer === "确认") return { granted: true, answer };
			return { granted: false, reason: `human did not confirm (answer: ${JSON.stringify(answer)})` };
		}
	};
}

/**
 * 捕获 `registerNormTools` 真正注册的描述符，并按 DSH 运行时的形态驱动它们。
 *
 * **这是 ADR 测试的做法**（`adr-tools.test.mjs` 的 `makeDescriptors`），不是我
 * 另造的通道。它比「直接调 handler」强：**参数 schema 与 descriptor 都在路径上**，
 * 于是「加了参数但 schema 不收」这类缺陷会被真实宿主校验挡住——独立审查 MINOR-1
 * 正是拿这一点反对我第一版的 test-only 导出。
 */
function makeNormDescriptors(deps) {
	const registered = [];
	const ctx = { tools: { register: (descriptor) => { registered.push(descriptor); return () => {}; } } };
	normToolsModule.registerNormTools(ctx, deps);
	const byName = {};
	for (const descriptor of registered) byName[descriptor.name] = descriptor;
	return byName;
}

/** 跑一次写入：注入 seams，cwd 决定管辖判定。 */
async function runWrite(args, seams, fixture) {
	const descriptors = makeNormDescriptors({
		hostSeams: seams,
		dshHomePath: dshHome(fixture.home),
		sessionPersistence: sessionPersistenceWithRoutingLog(fixture.repo),
	});
	const out = await descriptors["ldvh_norm_write"].execute(
		args,
		{ agent: { session: { header: { cwd: fixture.repo } } } },
	);
	return out.envelope ?? out;
}

const CREATE_ARGS = {
	action: "create",
	frontmatter_draft: { title: "代码风格", direction_key: "code-style", status: "active" },
	body_markdown: BODY_H2,
	dedup_result: "与既有 active 方向逐个比对：无同主题、无上下位重叠",
};

test("27 §15.2：create 的呈报取自正文「方向定位与适用范围」，不是不存在的 scope 字段", async () => {
	// 独立审查 MAJOR-1 抓出：第一版照抄 ADR 读 `draft.scope`，而 Norm 的 frontmatter
	// 闭集里**没有** scope（27 §8）——那行是死代码，Human 永远看不到「这份 Norm 管什么」。
	// 这条用例钉住：报告里出现正文首段的实质内容，且**不含** scope 字段。
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams(null);  // 人没答：只要问到就够，不落盘
		await runWrite({
			...CREATE_ARGS,
			body_markdown: BODY_H2.replace("本规范管辖插件运行时的代码风格与可读性基线。", "本规范管辖插件运行时的代码风格与可读性基线，关键判据是缩进与命名。"),
		}, seams, f);
		assert.equal(seams.calls.length, 1, "必须问过一次");
		const report = String(seams.calls[0].summary);
		assert.ok(report.includes("关键判据是缩进与命名"), `呈报须含正文定位段的实质内容，实际：${report}`);
		assert.ok(!report.includes("scope："), `呈报不得出现 Norm 没有的 scope 字段，实际：${report}`);
		assert.ok(report.includes("查重结论"), "呈报须含查重结论（27 §15.2）");
	});
});

test("27 §15.2：create 缺查重结论即硬拒，且根本不发出提问", async () => {
	// 独立审查 MAJOR-2 抓出：dedup_result 不 required 时，title+direction_key 就足以
	// 让报告非空——「查重没做」在链条上完全不可见，create 会被**放过**而不是被拒。
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams("确认");
		const { dedup_result: _omit, ...withoutDedup } = CREATE_ARGS;
		const env = await runWrite(withoutDedup, seams, f);
		assert.equal(env.outcome, "invalid_request", `缺查重结论须硬拒，实际 ${env.outcome}: ${JSON.stringify(env.gaps)}`);
		assert.equal(seams.calls.length, 0, "缺查重结论时不得发出提问（否则 Human 会对一个没核过重的方向点头）");
		const { readdir } = await import("node:fs/promises");
		assert.deepEqual(await readdir(join(f.root, "norms")).catch(() => []), [], "零写入");
	});
});

test("27 §15.2：create 的 body 缺「方向定位与适用范围」段 ⇒ 清晰拒绝，不是内部 TypeError", async () => {
	// 独立复核 MAJOR-1 实测抓出：`sectionContent` 找不到该 H2 时**返回 null**，
	// 我第一版直接 `.trim()`，于是把一条「缺段，请补」的可行动拒绝变成
	// `Cannot read properties of null`。缺段是常规输入错误，必须走 gaps 报出来。
	// 与 norm-tools.js 自己的「缺什么报什么」纪律、00 §4.6 据实声明同向。
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams("确认");
		// 故意去掉该 H2（保留其余三段）
		const noPositioning = BODY_H2.replace(/## 方向定位与适用范围\n\n[^#]*/, "");
		assert.ok(!noPositioning.includes("## 方向定位与适用范围"), "夹具须真的缺该段");
		const env = await runWrite({ ...CREATE_ARGS, body_markdown: noPositioning }, seams, f);
		assert.equal(env.outcome, "invalid_request", `缺段须为 invalid_request，实际 ${env.outcome}: ${JSON.stringify(env.gaps)}`);
		assert.ok(!String(env.gaps).includes("Cannot read properties of null"), `不得把缺段报成内部错误：${JSON.stringify(env.gaps)}`);
		assert.ok(String(env.gaps).includes("方向定位与适用范围"), `须点名缺的是哪一段：${JSON.stringify(env.gaps)}`);
		assert.equal(seams.calls.length, 0, "缺段时不得提问");
		const { readdir } = await import("node:fs/promises");
		assert.deepEqual(await readdir(join(f.root, "norms")).catch(() => []), [], "零写入");
	});
});

test("27 §15.2：注定失败的 create 一律不先惊动 Human（建前只读预检）", async () => {
	// 实测过的真实缺陷：Gate 原先排在 writer 的机械校验之前，于是四种**注定失败**
	// 的输入每一种都会先弹出询问、拿到「确认」，再被 writer 拒掉——那道确认已经
	// 发生、已经落进会话记录，读起来却像一次失败的决定，且让 Gate 沦为噪声。
	// 预检复用 writer 自己的校验函数（01 §11.4：不新造第二规则源）。
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const BODY = BODY_H2;
		// **每条都钉住具体错误码与结论形态**（独立复核 MINOR-3）：只断言
		// `outcome !== "completed"` 太弱——`unavailable` 也会通过，而「预检给出一个
		// 错的理由」同样会通过。这正是上一轮 BLOCKER 能溜过测试的原因。
		const cases = [
			["direction_key 格式非法", { ...CREATE_ARGS, frontmatter_draft: { title: "坏键", direction_key: "BAD KEY!!", status: "active" } },
				"rejected", "norm/frontmatter_invalid", "direction_key"],
			["title 超 40 字", { ...CREATE_ARGS, frontmatter_draft: { title: "超长标题".repeat(12), direction_key: "long-title", status: "active" } },
				"rejected", "norm/frontmatter_invalid", "title"],
			["正文骨架残缺", { ...CREATE_ARGS, body_markdown: "## 方向定位与适用范围\n\n**管什么**：只有一段。" },
				"rejected", "norm/body_invalid", "H2"],
		];
		for (const [name, args, wantOutcome, wantCode, wantReason] of cases) {
			const seams = fakeSeams("确认");
			const env = await runWrite(args, seams, f);
			assert.equal(seams.calls.length, 0, `${name}：不得先问 Human（实际问了 ${seams.calls.length} 次）`);
			assert.equal(env.outcome, wantOutcome, `${name}：outcome 须为 ${wantOutcome}，实际 ${env.outcome}`);
			const gaps = String(env.gaps);
			assert.ok(gaps.includes(wantCode), `${name}：须带错误码 ${wantCode}，实际 ${gaps}`);
			assert.ok(gaps.includes(wantReason), `${name}：须点明 ${wantReason}，实际 ${gaps}`);
			assert.ok(!gaps.includes("Cannot read"), `${name}：不得报内部错误`);
		}
		// 反向：合法输入仍必须真的问（预检不得误伤）
		const ok = fakeSeams("确认");
		const envOk = await runWrite({ ...CREATE_ARGS, body_markdown: BODY }, ok, f);
		assert.equal(ok.calls.length, 1, "合法输入须照常提问——预检不能把一切都拦下");
		assert.equal(envOk.outcome, "completed");
	});
});

test("建前预检必须与写入器同形：change_summary 是合法输入，不得误拒", async () => {
	// 自查抓出的真缺陷：`frontmatter_draft.change_summary` 在 schema 里**合法**
	// （writer 会把它剥出 draft 放进 change_log），而预检第一版原样喂给
	// validateNormFrontmatter，于是把这份**合法**输入判成 `unexpected field
	// "change_summary"` 闭集违规而拒。预检与写入不同源，就成了新的误判源。
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams("确认");
		const env = await runWrite({
			...CREATE_ARGS,
			frontmatter_draft: { ...CREATE_ARGS.frontmatter_draft, change_summary: "初始创建" },
		}, seams, f);
		assert.equal(env.outcome, "completed", `带 change_summary 的合法输入不得被拒：${JSON.stringify(env.gaps)}`);
		assert.equal(seams.calls.length, 1, "合法输入须照常提问");
	});
});

test("建前预检必须与写入器同形：初态与终态伴随字段沿用 writer 的判定", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		// ① create 带 status=retired → initial_state_violation，且不问
		{
			const seams = fakeSeams("确认");
			const env = await runWrite({
				...CREATE_ARGS,
				// retired_at 被宿主 schema 挡住（additionalProperties:false），故只用 status+retirement_reason
				frontmatter_draft: { title: "初态非法", direction_key: "initial-bad", status: "retired", retirement_reason: "outdated" },
			}, seams, f);
			assert.equal(seams.calls.length, 0, "初态非法不得先问 Human");
			assert.equal(env.outcome, "rejected", `须为 rejected，实际 ${env.outcome}`);
			assert.ok(String(env.gaps).includes("initial_state_violation") || String(env.gaps).includes("27 §8.1"),
				`须给出初态理由：${JSON.stringify(env.gaps)}`);
		}
		// ② create 带 retirement_reason 而 status=active → frontmatter_invalid，且不问
		{
			const seams = fakeSeams("确认");
			const env = await runWrite({
				...CREATE_ARGS,
				frontmatter_draft: { title: "夹带终态字段", direction_key: "terminal-smuggle", status: "active", retirement_reason: "outdated" },
			}, seams, f);
			assert.equal(seams.calls.length, 0, "终态伴随字段禁入时不得先问 Human");
			assert.equal(env.outcome, "rejected", `须为 rejected，实际 ${env.outcome}`);
			assert.ok(String(env.gaps).includes("retirement_reason"), `须点明 retirement_reason：${JSON.stringify(env.gaps)}`);
		}
	});
});

test("27 §15.2：direction_key 已占用时不先问 Human（与 writer 同一拒绝码）", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const first = fakeSeams("确认");
		const env1 = await runWrite(CREATE_ARGS, first, f);
		assert.equal(env1.outcome, "completed", "夹具须建立成功");
		const seams = fakeSeams("确认");
		const env2 = await runWrite(CREATE_ARGS, seams, f);   // 同一 direction_key
		assert.equal(seams.calls.length, 0, `占用冲突时不得先问 Human，实际问了 ${seams.calls.length} 次`);
		assert.equal(env2.outcome, "rejected", `须为 rejected，实际 ${env2.outcome}`);
		assert.ok(String(env2.gaps).includes("ERR_DIRECTION_ALREADY_EXISTS") || String(env2.gaps).includes("27 §11"), `须给出 27 §11 的唯一性理由：${JSON.stringify(env2.gaps)}`);
	});
});

test("27 §15.2：seam 在、答题器不在 ⇒ rejected + 零写入（生产真正会走的路径）", async () => {
	// 复核 MINOR-3：`requestNormGate` 的 `unavailable` 分支（deps.hostSeams 缺失）
	// 在生产装配链上**不可达**——index.js 恒注入 hostSeams。生产真正会走到的是
	// **接缝内部**的「无答题器」→ granted:false → rejected。上面那条用例钉的是
	// 不可达分支，这条钉可达的那条。
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		// 真实的 createHostSeams()，但 ctx 里没有 userQuestions
		const { createHostSeams } = await import("../lib/host-seams.js");
		const seams = createHostSeams();
		const install = seams.install({
			get: (key) => ({
				tools: { guard: () => () => {} },
				invariants: { register: () => () => {} },
				userQuestions: undefined,   // ← 无答题器
				fs: { resolve: async (p) => ({ targetKey: `tk:${p}`, displayPath: p }), stat: async () => ({ version: "v", type: "file" }) },
			}[key]),
			on: () => () => {},
			emit: () => {},
			logger: { info() {} },
		}, { dshHomePath: dshHome(f.home) });
		const env = await runWrite(CREATE_ARGS, seams, f);
		assert.equal(env.outcome, "rejected", `无答题器须 fail-closed 为 rejected，实际 ${env.outcome}`);
		assert.ok(String(env.gaps).includes("no human-answerer"), `须点明无答题器：${JSON.stringify(env.gaps)}`);
		const { readdir } = await import("node:fs/promises");
		assert.deepEqual(await readdir(join(f.root, "norms")).catch(() => []), [], "零写入");
		install.dispose();
	});
});

test("27 §15.2：create 未取得确认即零写入", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams(null);
		const env = await runWrite(CREATE_ARGS, seams, f);
		assert.equal(env.outcome, "rejected", `未取得确认必须拒绝，实际 ${env.outcome}: ${JSON.stringify(env.gaps)}`);
		assert.equal(seams.calls.length, 1, "必须真的问过一次——不问就写等于没有 Gate");
		assert.ok(String(seams.calls[0].summary).includes("无同主题"), "呈报须带查重结论（27 §15.2）");
		const { readdir } = await import("node:fs/promises");
		assert.deepEqual(await readdir(join(f.root, "norms")).catch(() => []), [], "被拒绝时不得落盘任何载体");
	});
});

test("27 §15.2：create 取得确认后照常落盘（Gate 不是永久阻断）", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams("确认");
		const env = await runWrite(CREATE_ARGS, seams, f);
		assert.equal(env.outcome, "completed", `取得确认后须落盘，实际 ${env.outcome}: ${JSON.stringify(env.gaps)}`);
		assert.equal(seams.calls.length, 1);
		assert.equal(seams.calls[0].action, "create");
	});
});

test("27 §15.2：宿主 schema 已挡住「呈报为空」这条路——故真实缺口只能是 dedup_result", async () => {
	// 独立审查 MINOR-1 的反面收获：改用**真实注册描述符**驱动后暴露了一个事实——
	// `frontmatter_draft.title`/`direction_key` 是 schema 必填，宿主在进 handler 之前
	// 就拒了。所以我原来那条「呈报为空 → 不问」的用例测的是**生产不可达**的路径。
	// 真实可达的缺口只有一个：title+direction_key 在场、而查重结论缺失。
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams("确认");
		// ① schema 自己就拒：title 缺失时 handler 根本不会被调用
		await assert.rejects(
			() => runWrite({ action: "create", frontmatter_draft: { status: "active" }, body_markdown: BODY_H2 }, seams, f),
			(err) => String(err?.message ?? err).includes("frontmatter_draft.title"),
			"宿主 schema 须在进 handler 前拒掉缺 title 的调用",
		);
		assert.equal(seams.calls.length, 0, "schema 拒绝时不得发出提问");
		// ② 真实缺口：字段齐备但没做查重 —— 必须硬拒且不问
		const { dedup_result: _omit, ...noDedup } = CREATE_ARGS;
		const env = await runWrite(noDedup, seams, f);
		assert.equal(env.outcome, "invalid_request", `缺查重须硬拒，实际 ${env.outcome}`);
		assert.equal(seams.calls.length, 0, "缺查重时不得提问");
	});
});

test("27 §15.2：active → active 更新不问；active → retired 必须问且拒绝时不改状态", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const created = await createNormObject({
			factSourceRoot: f.root,
			frontmatterDraft: { title: "代码风格", direction_key: "code-style", status: "active", change_summary: "初始" },
			bodyMarkdown: BODY_H2,
			sessionSignature: testSignature(),
		});
		assert.equal(created.ok, true, `夹具须建立成功：${created.ok ? "" : created.error?.message}`);
		const uid = created.value.object_uid;
		const read = await readNormObject({ factSourceRoot: f.root, objectUid: uid });

		// active → active：不问（27 §15 只覆盖终态决定）
		const seamsA = fakeSeams("确认");
		const envA = await runWrite({
			action: "update",
			object_uid: uid,
			expected_fingerprint: read.value.fingerprint,
			frontmatter_after: {},
			body_markdown_after: read.value.body,
			change_summary: "勘误级更新",
		}, seamsA, f);
		assert.equal(envA.outcome, "completed", `勘误级更新须照常完成，实际 ${envA.outcome}`);
		assert.equal(seamsA.calls.length, 0, "同状态更新不得提问——问了就是把 Gate 扩大到不该管的范围");

		// active → retired：问；拒绝时不落盘
		const read2 = await readNormObject({ factSourceRoot: f.root, objectUid: uid });
		const seamsB = fakeSeams(null);
		const envB = await runWrite({
			action: "update",
			object_uid: uid,
			expected_fingerprint: read2.value.fingerprint,
			frontmatter_after: { status: "retired", retirement_reason: "outdated" },
			body_markdown_after: read2.value.body,
			change_summary: "方向不再需要",
		}, seamsB, f);
		assert.equal(envB.outcome, "rejected", `退役未取得确认必须拒绝，实际 ${envB.outcome}`);
		assert.equal(seamsB.calls.length, 1, "退役必须问");
		assert.equal(seamsB.calls[0].action, "retire");
		const after = await readNormObject({ factSourceRoot: f.root, objectUid: uid });
		assert.equal(after.value.frontmatter.status, "active", "被拒绝时状态不得改变");
	});
});

test("27 §15.2：CAS 指纹过期时不去打扰 Human（不为注定失败的写入点头）", async () => {
	// 独立复核 MINOR-2：Gate 若在 CAS 校验之前、且不读当前载体，Human 会被问、
	// 会答「确认」，而写入随后因指纹不匹配被拒——那道确认已经发生、已经落进会话
	// 记录，读起来却像一次失败的决定。ADR 的 retire 分支先读载体，这里同形。
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const created = await createNormObject({
			factSourceRoot: f.root,
			frontmatterDraft: { title: "代码风格", direction_key: "code-style", status: "active", change_summary: "初始" },
			bodyMarkdown: BODY_H2,
			sessionSignature: testSignature(),
		});
		assert.equal(created.ok, true, "夹具须建立成功");
		const uid = created.value.object_uid;
		const read = await readNormObject({ factSourceRoot: f.root, objectUid: uid });

		const seams = fakeSeams("确认");
		const env = await runWrite({
			action: "update",
			object_uid: uid,
			expected_fingerprint: "deadbeef".repeat(8),   // ← 故意过期
			frontmatter_after: { status: "retired", retirement_reason: "outdated" },
			body_markdown_after: read.value.body,
			change_summary: "方向不再需要",
		}, seams, f);
		assert.equal(seams.calls.length, 0, `指纹不符时不得打扰 Human，实际问了 ${seams.calls.length} 次`);
		assert.notEqual(env.outcome, "completed", "指纹不符不得完成");
		const after = await readNormObject({ factSourceRoot: f.root, objectUid: uid });
		assert.equal(after.value.frontmatter.status, "active", "状态不得改变");
	});
});

test("27 §15.2：宿主无询问入口时 fail-closed（unavailable，不是静默跳过）", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const descriptors = makeNormDescriptors({
			// hostSeams **故意缺失**：真实组合里装配漏掉时的形态
			dshHomePath: dshHome(f.home),
			sessionPersistence: sessionPersistenceWithRoutingLog(f.repo),
		});
		const out = await descriptors["ldvh_norm_write"].execute(
			CREATE_ARGS,
			{ agent: { session: { header: { cwd: f.repo } } } },
		);
		const env = out.envelope ?? out;
		assert.equal(env.outcome, "unavailable", `无询问入口须报 unavailable，实际 ${env.outcome}`);
		const { readdir } = await import("node:fs/promises");
		assert.deepEqual(await readdir(join(f.root, "norms")).catch(() => []), [], "零写入");
	});
});

test("ldvh_norm_write：awaitsHumanDecision 必须真的接线到 descriptor（不是死字段）", async () => {
	// 2026-11-15 自查抓出：我第一版只加了 `awaitsHumanDecision: true`，而
	// `toolDescriptorFor` 里仍是恒定 `timeoutMs: 30000`——**字段声明得好好的，
	// 没有任何人读它**。本仓有过同一形态的先例（`review-ask-tool.js` 注释自述
	// 该字段曾是死的）。故断言分两半，缺一半就等于没接线：
	//
	//   ① 声明为 true（语义：该工具会阻塞在人身上）；
	//   ② descriptor **真的**因此不带 timeoutMs（否则 Human 的答复会被 30s 砍掉，
	//      门禁在真实组合里等于不存在——写入被拒，而人以为自己答过）。
	const { OPERATIONS, toolDescriptorFor } = await import("../lib/norm-tools.js");
	assert.equal(OPERATIONS["norm-write-object"].awaitsHumanDecision, true,
		"该工具在 create/retire 上阻塞在人身上，须声明 awaitsHumanDecision（与 adr-tools 同一纪律）");
	const descriptor = toolDescriptorFor("norm-write-object", OPERATIONS["norm-write-object"], async () => ({}));
	assert.equal(descriptor.timeoutMs, undefined,
		`descriptor 不得带墙钟上限（否则 30s 会丢弃迟到的答复）；实际 ${JSON.stringify(descriptor.timeoutMs)}`);
	// 反向：不声明该字段的工具仍须保留 30s 上限——证明上面那条不是「全都没有」
	const plain = toolDescriptorFor("norm-read-object", OPERATIONS["norm-read-object"], async () => ({}));
	assert.equal(plain.timeoutMs, 30000, "不阻塞在人身上的工具须保留 30s 上限");
});
