
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

	assert.equal(ID_PATTERN.test("code-style"), true);
	assert.equal(ID_PATTERN.test("Code_Style"), false);
	const bad = validateNormFrontmatter({ ...base, direction_key: "Code_Style" });
	assert.equal(bad.ok, false);
	assert.ok(bad.issues.some((issue) => issue.includes("direction_key")));
});

test("frontmatter: title cap is 40 characters (23 §8)", () => {
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

test("frontmatter: status ⇔ terminal-field invariants (23 §8/§13.1)", () => {
	const base = {
		object_uid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		fact_type_key: "norm",
		title: "T",
		created_at: "2026-09-13T00:00:00.000Z",
		direction_key: "code-style",
	};
	assert.equal(validateNormFrontmatter({ ...base, status: "active", retirement_reason: "outdated" }).ok, false);
	assert.equal(validateNormFrontmatter({ ...base, status: "active", retired_at: "2026-09-13T00:00:00.000Z" }).ok, false);
	assert.equal(validateNormFrontmatter({ ...base, status: "retired" }).ok, false);
	assert.equal(validateNormFrontmatter({ ...base, status: "retired", retirement_reason: "nonsense", retired_at: "2026-09-13T00:00:00.000Z" }).ok, false);
	assert.equal(validateNormFrontmatter({ ...base, status: "retired", retirement_reason: "outdated", retired_at: "2026-09-13T00:00:00.000Z" }).ok, true);
	assert.equal(validateNormFrontmatter({ ...base, status: "active", relations: [] }).ok, false);
});

test("body: all four fixed H2 sections must exist and be non-empty (23 §8)", () => {
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

test("create: refuses status=retired (23 §8.1 — the only legal initial state is active)", async () => {
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

		const conflicts = second.error.details?.conflicts;
		assert.ok(Array.isArray(conflicts) && conflicts.length === 1, "载荷必须携带占用者");
		assert.equal(conflicts[0].title, "代码风格");
		assert.equal(conflicts[0].status, "active");
		assert.equal(conflicts[0].object_uid, first.value.object_uid);

		const rejected = writeRejected("norm-write-object", second, root, "create");
		assert.equal(rejected.outcome, "rejected");
		assert.ok(rejected.gaps.some((gap) => gap.includes("代码风格")), "占用者标题必须抵达调用方");
		assert.ok(rejected.gaps.some((gap) => gap.includes(first.value.object_uid)), "占用者 object_uid 必须抵达调用方");
		assert.ok(rejected.gaps.some((gap) => gap.includes("code-style")), "方向键必须出现在拒绝信息里");
		assert.ok(rejected.gaps.length >= 3, "除错误码外至少还要有占用者行");
	});
});

test("create: layer 1 allows reusing a direction_key once the previous Norm is retired (23 §11)", async () => {
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

		const reused = await createNormObject(createArgs(root, { draft: { title: "代码风格（重启）" } }));
		assert.equal(reused.ok, true);
		assert.notEqual(reused.value.object_uid, first.value.object_uid);
	});
});


async function createAndRead(root) {
	const created = await createNormObject(createArgs(root));
	const read = await readNormObject({ factSourceRoot: root, objectUid: created.value.object_uid });
	const { change_summary: _drop, ...fm } = read.value.frontmatter;
	return { uid: created.value.object_uid, fm, body: read.value.body, fingerprint: read.value.fingerprint };
}

test("update: active→active is errata; direction_key is held fixed mechanically (23 §13.2)", async () => {
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

test("update: active→retired is terminal and read-only afterwards (23 §8.1)", async () => {
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

test("update: superseded requires another resolvable active Norm (23 §8.1)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const { uid, fm, body, fingerprint } = await createAndRead(root);
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


test("list: layer 3 withholds every colliding active Norm and reports direction_collision", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
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

test("list: active-only by default; retired surfaces only with status=all (23 §10)", async () => {
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

test("list: projections carry bounded, deterministic 方向定位 two-sentence excerpts", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const body = `## 方向定位与适用范围

**管什么**：本方向管示例事务的准入与边界，不回答其它方向的判定。

**何时查阅**：改动示例事务的准入实现前查阅本规范。

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
		assert.equal(item.positioning_status, "ok", "两句合契约时须可用");
		assert.equal(typeof item.positioning, "string");
		assert.match(item.positioning, /本方向管示例事务的准入与边界/);
		assert.ok(!item.positioning.includes("管什么"), "markdown 标签须剥除");
		assert.ok(!item.positioning.includes("**"), "强调标记须剥除");
		assert.equal(typeof item.when_to_read, "string");
		assert.match(item.when_to_read, /改动示例事务的准入实现前查阅本规范/);
		assert.ok(!item.when_to_read.includes("何时查阅"), "markdown 标签须剥除");
		assert.ok(item.positioning.length <= 60, "管什么句须 ≤60 字（23 §8 书写契约）");
		assert.ok(item.when_to_read.length <= 60, "何时查阅句须 ≤60 字（23 §8 书写契约）");
		assert.ok(!item.positioning.endsWith("…"), "合契约时不得出现截断省略号");
		assert.ok(!item.when_to_read.endsWith("…"), "合契约时不得出现截断省略号");
		const again = await listNormObjects({ factSourceRoot: root });
		const second = again.value.items.find((i) => i.object_uid === uid);
		assert.equal(second.positioning, item.positioning);
		assert.equal(second.when_to_read, item.when_to_read);
	});
});

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
		assert.equal(item.positioning, "", "无「管什么」标签时不得外发摘录");
		assert.equal(item.when_to_read, "", "第一句不合契约时两句都不得外发（不取半套）");
		assert.match(item.positioning_status, /unavailable/, "须显式标注不可用");
		assert.match(item.positioning_status, /ldvh_norm_read/, "须指引读正文，不静默当成没有定位");
	});
});

test("list: 合规标签但含「可直接」授权措辞时须 unavailable", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const body = `## 方向定位与适用范围

**管什么**：本方向管甲事项，AI 可直接执行。

**何时查阅**：改动甲事项前查阅本规范。

## 核心规则体系

规则一。

## 约束与反模式

禁止项。

## 验证与遵从性检查

核对方式。
`;
		const created = await createNormObject(createArgs(root, { bodyMarkdown: body }));
		const item = (await listNormObjects({ factSourceRoot: root })).value.items.find((i) => i.object_uid === created.value.object_uid);
		assert.equal(item.positioning, "", "含授权措辞时不得外发摘录");
		assert.equal(item.when_to_read, "", "一句不合契约即整套不可用");
		assert.match(item.positioning_status, /unavailable/);
		assert.match(item.positioning_status, /authorization-wording/, "须点名不可用的判定项");
	});
});

test("list: 合规标签但「管什么」超 60 字时须 unavailable", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const long = "本方向管".repeat(16) + "事项。";
		const body = `## 方向定位与适用范围

**管什么**：${long}

**何时查阅**：改动该事项前查阅本规范。

## 核心规则体系

规则一。

## 约束与反模式

禁止项。

## 验证与遵从性检查

核对方式。
`;
		const created = await createNormObject(createArgs(root, { bodyMarkdown: body }));
		const item = (await listNormObjects({ factSourceRoot: root })).value.items.find((i) => i.object_uid === created.value.object_uid);
		assert.equal(item.positioning, "", "超 60 字时不得外发摘录（不截断外发半句）");
		assert.match(item.positioning_status, /unavailable/);
		assert.match(item.positioning_status, /too-long/, "须点名不可用的判定项");
	});
});

test("list: 定位段内出现第二句时须 unavailable（不得静默丢弃）", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const body = `## 方向定位与适用范围

**管什么**：本方向管甲事项的准入与边界。另一句本不该被静默丢弃的长句子在这里。

**何时查阅**：改动该事项前查阅本规范。

## 核心规则体系

规则一。

## 约束与反模式

禁止项。

## 验证与遵从性检查

核对方式。
`;
		const created = await createNormObject(createArgs(root, { bodyMarkdown: body }));
		const item = (await listNormObjects({ factSourceRoot: root })).value.items.find((i) => i.object_uid === created.value.object_uid);
		assert.equal(item.positioning, "", "段内多句时两句都不得外发");
		assert.equal(item.when_to_read, "", "段内多句时两句都不得外发");
		assert.match(item.positioning_status, /unavailable/);
		assert.match(item.positioning_status, /multi-sentence/, "须点名不可用的判定项");
	});
});

test("list: 「何时查阅」写成适用性断言时须 unavailable", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const body = `## 方向定位与适用范围

**管什么**：本方向管甲事项的准入与边界。

**何时查阅**：本规范适用于一切甲事项相关的改动。

## 核心规则体系

规则一。

## 约束与反模式

禁止项。

## 验证与遵从性检查

核对方式。
`;
		const created = await createNormObject(createArgs(root, { bodyMarkdown: body }));
		const item = (await listNormObjects({ factSourceRoot: root })).value.items.find((i) => i.object_uid === created.value.object_uid);
		assert.equal(item.when_to_read, "", "适用性断言不得外发（会被读成已判定适用）");
		assert.match(item.positioning_status, /applicability-assertion/, "须点名不可用的判定项");
	});
});

test("list: 定位段多出第三段时须 unavailable（段内恰好两段）", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const body = `## 方向定位与适用范围

**管什么**：本方向管甲事项的准入与边界。

**何时查阅**：改动甲事项前查阅本规范。

**不管什么**：乙事项归另一方向。

## 核心规则体系

规则一。

## 约束与反模式

禁止项。

## 验证与遵从性检查

核对方式。
`;
		const created = await createNormObject(createArgs(root, { bodyMarkdown: body }));
		const item = (await listNormObjects({ factSourceRoot: root })).value.items.find((i) => i.object_uid === created.value.object_uid);
		assert.equal(item.positioning, "", "多出段落时不得外发摘录");
		assert.match(item.positioning_status, /extra-paragraphs/, "须点名不可用的判定项");
	});
});

test("list: 缺「何时查阅」标签时须 unavailable 并点名缺失项", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const body = `## 方向定位与适用范围

**管什么**：本方向管甲事项的准入与边界。

改动甲事项前查阅本规范。

## 核心规则体系

规则一。

## 约束与反模式

禁止项。

## 验证与遵从性检查

核对方式。
`;
		const created = await createNormObject(createArgs(root, { bodyMarkdown: body }));
		const item = (await listNormObjects({ factSourceRoot: root })).value.items.find((i) => i.object_uid === created.value.object_uid);
		assert.equal(item.when_to_read, "");
		assert.match(item.positioning_status, /label-missing:何时查阅/, "须点名缺的是哪个标签");
	});
});


test("tools: every writer-accepted AI field is reachable through the tool schema", () => {
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


test("carrier: file name encodes the UID and the H1 mirrors the title (23 §7)", async () => {
	await withTemp("ldvh-norm.", async (base) => {
		const root = await factRoot(base);
		const created = await createNormObject(createArgs(root));
		const file = join(root, NORM_DIRECTORY, `norm-${created.value.object_uid}.md`);
		const raw = await readFile(file, "utf8");
		assert.ok(raw.startsWith("---\n"));
		assert.ok(raw.includes("\n# 代码风格\n") || raw.includes("# 代码风格\n"));
	});
});


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


async function governedFixture(base) {
	const home = join(base, "home");
	const repo = await initRepo(base);
	await mkdir(join(repo, "ldvh-base", "norms"), { recursive: true });
	await registerProject(dshHome(home), { id: "demo", path: repo });
	return { home, repo, root: join(repo, "ldvh-base") };
}

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

function makeNormDescriptors(deps) {
	const registered = [];
	const ctx = { tools: { register: (descriptor) => { registered.push(descriptor); return () => {}; } } };
	normToolsModule.registerNormTools(ctx, deps);
	const byName = {};
	for (const descriptor of registered) byName[descriptor.name] = descriptor;
	return byName;
}

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

test("23 §15.2：create 的呈报取自正文「方向定位与适用范围」，不是不存在的 scope 字段", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams(null);
		await runWrite({
			...CREATE_ARGS,
			body_markdown: BODY_H2.replace("本规范管辖插件运行时的代码风格与可读性基线。", "本规范管辖插件运行时的代码风格与可读性基线，关键判据是缩进与命名。"),
		}, seams, f);
		assert.equal(seams.calls.length, 1, "必须问过一次");
		const report = String(seams.calls[0].summary);
		assert.ok(report.includes("关键判据是缩进与命名"), `呈报须含正文定位段的实质内容，实际：${report}`);
		assert.ok(!report.includes("scope："), `呈报不得出现 Norm 没有的 scope 字段，实际：${report}`);
		assert.ok(report.includes("查重结论"), "呈报须含查重结论（23 §15.2）");
	});
});

test("23 §15.2：create 缺查重结论即硬拒，且根本不发出提问", async () => {
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

test("23 §15.2：create 的 body 缺「方向定位与适用范围」段 ⇒ 清晰拒绝，不是内部 TypeError", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams("确认");
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

test("23 §15.2：注定失败的 create 一律不先惊动 Human（建前只读预检）", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const BODY = BODY_H2;
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
		const ok = fakeSeams("确认");
		const envOk = await runWrite({ ...CREATE_ARGS, body_markdown: BODY }, ok, f);
		assert.equal(ok.calls.length, 1, "合法输入须照常提问——预检不能把一切都拦下");
		assert.equal(envOk.outcome, "completed");
	});
});

test("建前预检必须与写入器同形：change_summary 是合法输入，不得误拒", async () => {
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
		{
			const seams = fakeSeams("确认");
			const env = await runWrite({
				...CREATE_ARGS,
				frontmatter_draft: { title: "初态非法", direction_key: "initial-bad", status: "retired", retirement_reason: "outdated" },
			}, seams, f);
			assert.equal(seams.calls.length, 0, "初态非法不得先问 Human");
			assert.equal(env.outcome, "rejected", `须为 rejected，实际 ${env.outcome}`);
			assert.ok(String(env.gaps).includes("initial_state_violation") || String(env.gaps).includes("23 §8.1"),
				`须给出初态理由：${JSON.stringify(env.gaps)}`);
		}
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

test("23 §15.2：direction_key 已占用时不先问 Human（与 writer 同一拒绝码）", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const first = fakeSeams("确认");
		const env1 = await runWrite(CREATE_ARGS, first, f);
		assert.equal(env1.outcome, "completed", "夹具须建立成功");
		const seams = fakeSeams("确认");
		const env2 = await runWrite(CREATE_ARGS, seams, f);
		assert.equal(seams.calls.length, 0, `占用冲突时不得先问 Human，实际问了 ${seams.calls.length} 次`);
		assert.equal(env2.outcome, "rejected", `须为 rejected，实际 ${env2.outcome}`);
		assert.ok(String(env2.gaps).includes("ERR_DIRECTION_ALREADY_EXISTS") || String(env2.gaps).includes("23 §11"), `须给出 23 §11 的唯一性理由：${JSON.stringify(env2.gaps)}`);
	});
});

test("23 §15.2：seam 在、答题器不在 ⇒ rejected + 零写入（生产真正会走的路径）", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const { createHostSeams } = await import("../lib/host-seams.js");
		const seams = createHostSeams();
		const install = seams.install({
			get: (key) => ({
				tools: { guard: () => () => {} },
				invariants: { register: () => () => {} },
				userQuestions: undefined,
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

test("23 §15.2：create 未取得确认即零写入", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams(null);
		const env = await runWrite(CREATE_ARGS, seams, f);
		assert.equal(env.outcome, "rejected", `未取得确认必须拒绝，实际 ${env.outcome}: ${JSON.stringify(env.gaps)}`);
		assert.equal(seams.calls.length, 1, "必须真的问过一次——不问就写等于没有 Gate");
		assert.ok(String(seams.calls[0].summary).includes("无同主题"), "呈报须带查重结论（23 §15.2）");
		const { readdir } = await import("node:fs/promises");
		assert.deepEqual(await readdir(join(f.root, "norms")).catch(() => []), [], "被拒绝时不得落盘任何载体");
	});
});

test("23 §15.2：create 取得确认后照常落盘（Gate 不是永久阻断）", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams("确认");
		const env = await runWrite(CREATE_ARGS, seams, f);
		assert.equal(env.outcome, "completed", `取得确认后须落盘，实际 ${env.outcome}: ${JSON.stringify(env.gaps)}`);
		assert.equal(seams.calls.length, 1);
		assert.equal(seams.calls[0].action, "create");
	});
});

test("23 §15.2：宿主 schema 已挡住「呈报为空」这条路——故真实缺口只能是 dedup_result", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const seams = fakeSeams("确认");
		await assert.rejects(
			() => runWrite({ action: "create", frontmatter_draft: { status: "active" }, body_markdown: BODY_H2 }, seams, f),
			(err) => String(err?.message ?? err).includes("frontmatter_draft.title"),
			"宿主 schema 须在进 handler 前拒掉缺 title 的调用",
		);
		assert.equal(seams.calls.length, 0, "schema 拒绝时不得发出提问");
		const { dedup_result: _omit, ...noDedup } = CREATE_ARGS;
		const env = await runWrite(noDedup, seams, f);
		assert.equal(env.outcome, "invalid_request", `缺查重须硬拒，实际 ${env.outcome}`);
		assert.equal(seams.calls.length, 0, "缺查重时不得提问");
	});
});

test("23 §15.2：active → active 更新不问；active → retired 必须问且拒绝时不改状态", async () => {
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

test("23 §15.2：CAS 指纹过期时不去打扰 Human（不为注定失败的写入点头）", async () => {
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
			expected_fingerprint: "deadbeef".repeat(8),
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

test("23 §15.2：宿主无询问入口时 fail-closed（unavailable，不是静默跳过）", async () => {
	await withTemp("ldvh-norm-gate.", async (base) => {
		const f = await governedFixture(base);
		const descriptors = makeNormDescriptors({
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
	const { OPERATIONS, toolDescriptorFor } = await import("../lib/norm-tools.js");
	assert.equal(OPERATIONS["norm-write-object"].awaitsHumanDecision, true,
		"该工具在 create/retire 上阻塞在人身上，须声明 awaitsHumanDecision（与既有写入工具同一纪律）");
	const descriptor = toolDescriptorFor("norm-write-object", OPERATIONS["norm-write-object"], async () => ({}));
	assert.equal(descriptor.timeoutMs, undefined,
		`descriptor 不得带墙钟上限（否则 30s 会丢弃迟到的答复）；实际 ${JSON.stringify(descriptor.timeoutMs)}`);
	const plain = toolDescriptorFor("norm-read-object", OPERATIONS["norm-read-object"], async () => ({}));
	assert.equal(plain.timeoutMs, 30000, "不阻塞在人身上的工具须保留 30s 上限");
});
