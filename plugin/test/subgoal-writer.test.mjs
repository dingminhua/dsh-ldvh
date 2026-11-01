// Tests for plugin/lib/subgoal-writer.js — the SubGoal fact-type writer.
//
// Authority: specs/28 §7 (identity/carrier), §8 (field contract + fixed body
// H2), §9 (status closure + object_uid identity), §13 (controlled operations), §14.1
// (type-specific mechanical checks), plus the shared 02 §10 contract and the
// Human requirement that every change_log entry is mechanically signed.
//
// What these tests deliberately do NOT assert: whether a criterion is really
// decidable, or whether `alignment` really tracks the goal statement. 28 §15
// assigns both to AI/Human judgement and §18 red line 9 forbids a mechanical
// gate on them — so a test claiming to prove them would be the defect.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	SUBGOAL_DIRECTORY,
	computeSubGoalCreateCandidateFingerprint,
	createSubGoalObject,
	listResolvableSubGoals,
	listSubGoalObjects,
	precheckSubGoalCreate,
	readSubGoalObject,
	resolveSubGoal,
	updateSubGoalObject,
	validateCarrierCoherence,
	validateSubGoalBodyStructure,
	validateSubGoalFrontmatter,
} from "../lib/subgoal-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";
import { withTemp } from "./helpers.mjs";

const SIG = authoritativeSignature({ provider: "test-provider", model: "test-model" });

const validBody = (draft) =>
	`## 达成条件\n\n${draft.criterion}\n\n## 对齐说明\n\n${draft.alignment}\n`;

function draft(overrides = {}) {
	return {
		title: "验收材料成为可回读证据",
		order: 1,
		parent_goal: "project-goal",
		criterion: "该类型的验证表每一行都能机械判定，且实跑结果与表内声明一致。",
		criterion_kind: "executable-check",
		alignment: "目标陈述要求框架可被外部验证；验证表是本框架自证的最小材料，故本条直接服务该要求。",
		change_summary: "初始落盘",
		...overrides,
	};
}

async function freshRoot(base) {
	const root = join(base, "ldvh-base");
	await mkdir(root, { recursive: true });
	await writeFile(join(root, "goal.md"), [
		"---",
		"goal_key: project-goal",
		"title: 夹具项目目标",
		"status: active",
		"created_at: 2026-01-01T00:00:00.000Z",
		"change_log:",
		"  - at: 2026-01-01T00:00:00.000Z",
		"    summary: 存量",
		"---",
		"",
		"# 项目目标",
		"",
		"## 目标陈述",
		"",
		"夹具目标陈述。",
		"",
	].join("\n"), "utf8");
	return root;
}

async function createOne(root, overrides = {}) {
	const d = draft(overrides);
	const r = await createSubGoalObject({
		factSourceRoot: root,
		frontmatterDraft: d,
		bodyMarkdown: validBody(d),
		sessionSignature: SIG,
	});
	return { result: r, draft: d };
}

// ---------------------------------------------------------------------------
// identity & carrier (28 §7)
// ---------------------------------------------------------------------------

test("carrier lives under subgoals/ and carries the type key (28 §7)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const { result } = await createOne(root);
		assert.equal(result.ok, true, JSON.stringify(result.error));
		assert.equal(result.value.file, join(root, SUBGOAL_DIRECTORY, `subgoal-${result.value.object_uid}.md`));
		const raw = await readFile(result.value.file, "utf8");
		assert.match(raw, /fact_type_key: subgoal/);
		assert.match(raw, /order: 1/);
		assert.match(raw, /parent_goal: project-goal/);
	});
});

test("create requires the parent goal carrier to resolve (28 §14.1)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = join(base, "ldvh-base");
		await mkdir(root, { recursive: true });
		// No goal.md at all.
		const d = draft();
		const r = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/parent_goal_unresolvable");
	});
});

test("create refuses a parent_goal that is not the singleton key (28 §8)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const d = draft({ parent_goal: "some-other-goal" });
		const r = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.ok(
			["subgoal/frontmatter_invalid", "subgoal/parent_goal_unresolvable"].includes(r.error.code),
			`unexpected code ${r.error.code}`,
		);
	});
});

// ---------------------------------------------------------------------------
// identity & order (28 §7/§8, 2026-11-01)
// ---------------------------------------------------------------------------

test("two sub-goals may share the same order — it is display-only, not an identity (28 §8)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const a = await createOne(root);
		assert.equal(a.result.ok, true, JSON.stringify(a.result.error));

		// Same `order`, different object. This MUST succeed: the old model refused
		// a duplicate anchor here, which is exactly the coupling that was removed —
		// order carries no reference duty, so it cannot be unique.
		const b = await createOne(root, { title: "第二条子目标" });
		assert.equal(b.result.ok, true, JSON.stringify(b.result.error));
		assert.notEqual(a.result.value.object_uid, b.result.value.object_uid);
	});
});

test("order may be omitted entirely — a missing order is a legal state (28 §8)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const d = draft();
		delete d.order;
		const r = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
		});
		assert.equal(r.ok, true, JSON.stringify(r.error));
		const raw = await readFile(r.value.file, "utf8");
		assert.ok(!/^order:/m.test(raw), "a missing order must not be fabricated into the carrier");
	});
});

test("order must be a positive integer when present (28 §8)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		for (const order of [0, -1, 1.5, "1"]) {
			const d = draft({ order });
			const r = await createSubGoalObject({
				factSourceRoot: root,
				frontmatterDraft: d,
				bodyMarkdown: validBody(d),
				sessionSignature: SIG,
			});
			assert.equal(r.ok, false, `order=${JSON.stringify(order)} must be refused`);
			assert.equal(r.error.code, "subgoal/frontmatter_invalid", `${JSON.stringify(order)}: ${r.error.code}`);
		}
	});
});

test("a RETIRED object keeps its uid but is no longer a serves target (28 §9.2/§12.3)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const first = await createOne(root);
		const created = first.result.value;
		const read = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });

		const retired = await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: { status: "retired", disposition: "判据不再独立成立" },
			bodyMarkdownAfter: read.value.body,
			changeSummary: "判据失效，退役",
			sessionSignature: SIG,
		});
		assert.equal(retired.ok, true, JSON.stringify(retired.error));

		// The uid still resolves to the object, but not as a NEW serves target.
		const after = await resolveSubGoal(root, created.object_uid);
		assert.equal(after.ok, false);
		assert.equal(after.error.code, "subgoal/serves_unresolvable");
	});
});

// ---------------------------------------------------------------------------
// status closure (28 §9)
// ---------------------------------------------------------------------------

test("create refuses a status other than active (28 §9.2 初态必为 active)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const d = draft({ status: "achieved" });
		const r = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/initial_state_violation");
	});
});

test("achieved is terminal — a later update is refused (28 §9.2)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const created = (await createOne(root)).result.value;
		const read = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });
		const achieved = await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: { status: "achieved" },
			bodyMarkdownAfter: read.value.body,
			changeSummary: "判据已满足：验证表 10 行逐行实跑通过（证据见该次运行记录）",
			sessionSignature: SIG,
		});
		assert.equal(achieved.ok, true, JSON.stringify(achieved.error));

		const after = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });
		const reopen = await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: after.value.fingerprint,
			frontmatterAfter: { status: "achieved" },
			bodyMarkdownAfter: after.value.body,
			changeSummary: "再改一次",
			sessionSignature: SIG,
		});
		assert.equal(reopen.ok, false);
		assert.equal(reopen.error.code, "subgoal/terminal_readonly");
	});
});

test("retired requires a disposition (28 §8/§9.3)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const created = (await createOne(root)).result.value;
		const read = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });
		const r = await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: { status: "retired" },
			bodyMarkdownAfter: read.value.body,
			changeSummary: "退役但不写去向",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/disposition_required");
	});
});

// ---------------------------------------------------------------------------
// identity immutability vs order mutability (28 §8, 2026-11-01)
// ---------------------------------------------------------------------------

test("order can be changed in place — supplement-level update (28 §8/§9.3)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const created = (await createOne(root, { order: 1 })).result.value;
		const read = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });
		const r = await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: { order: 7 },
			bodyMarkdownAfter: read.value.body,
			changeSummary: "调整显示次序",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, true, JSON.stringify(r.error));
		assert.equal(r.value.transition, "supplement");
		const after = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });
		assert.equal(after.value.frontmatter.order, 7);
		assert.equal(after.value.frontmatter.object_uid, created.object_uid);
	});
});

// ---------------------------------------------------------------------------
// body contract (28 §8)
// ---------------------------------------------------------------------------

test("body must carry 达成条件 then 对齐说明 (28 §8)", () => {
	const good = validateSubGoalBodyStructure(
		"# 标题\n\n## 达成条件\n\n某判据。\n\n## 对齐说明\n\n某对齐。\n",
		"标题",
	);
	assert.equal(good.ok, true, JSON.stringify(good.issues));

	const missing = validateSubGoalBodyStructure("# 标题\n\n## 达成条件\n\n某判据。\n", "标题");
	assert.equal(missing.ok, false);
	assert.ok(missing.issues.some((i) => /对齐说明/.test(i)));
});

test("criterion and alignment must appear verbatim in their sections (28 §8)", () => {
	// This invariant lives in validateCarrierCoherence (frontmatter is the single
	// authoritative text; the body only expands it), not in the structure check.
	const body = "# 标题\n\n## 达成条件\n\n这不是判据原文。\n\n## 对齐说明\n\n也不是对齐原文。\n";
	const bad = validateCarrierCoherence({ criterion: "某判据。", alignment: "某对齐。" }, body);
	assert.equal(bad.ok, false);
	assert.equal(bad.issues.length, 2, JSON.stringify(bad.issues));

	const good = validateCarrierCoherence(
		{ criterion: "某判据。", alignment: "某对齐。" },
		"# 标题\n\n## 达成条件\n\n某判据。\n\n## 对齐说明\n\n某对齐。\n",
	);
	assert.equal(good.ok, true, JSON.stringify(good.issues));
});

test("a third status value is not in the closure (28 §9)", () => {
	const r = validateSubGoalFrontmatter({
		object_uid: "00000000-0000-4000-8000-000000000000",
		fact_type_key: "subgoal",
		title: "T",
		order: 1,
		parent_goal: "project-goal",
		status: "abandoned",
		criterion: "某判据。",
		criterion_kind: "metric",
		alignment: "某对齐。",
		created_at: "2026-01-01T00:00:00.000Z",
		change_log: [{ at: "2026-01-01T00:00:00.000Z", summary: "x" }],
	});
	assert.equal(r.ok, false);
	assert.ok(r.issues.some((i) => /status/.test(i)));
});

test("criterion_kind is a closed set — an unknown kind is refused (28 §10.2)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const d = draft({ criterion_kind: "vibes" });
		const r = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/frontmatter_invalid");
	});
});

test("a retired-era `anchor` key is no longer part of the closed set (28 §8, 2026-11-01)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const d = draft({ anchor: "SG-1" });
		const r = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/frontmatter_invalid");
		assert.ok(r.error.details.issues.some((i) => /anchor/.test(i)), JSON.stringify(r.error.details));
	});
});

// ---------------------------------------------------------------------------
// serves resolution (28 §12.3)
// ---------------------------------------------------------------------------

test("resolveSubGoal: active and achieved resolve; retired does not (28 §12.3)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const a = (await createOne(root)).result.value;
		const b = (await createOne(root, { title: "第二条子目标" })).result.value;

		const active = await resolveSubGoal(root, a.object_uid);
		assert.equal(active.ok, true, JSON.stringify(active.error));

		// Achieve b → still a valid `serves` target.
		const readB = await readSubGoalObject({ factSourceRoot: root, objectUid: b.object_uid });
		await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: b.object_uid,
			expectedFingerprint: readB.value.fingerprint,
			frontmatterAfter: { status: "achieved" },
			bodyMarkdownAfter: readB.value.body,
			changeSummary: "达成：证据已回读",
			sessionSignature: SIG,
		});
		const achieved = await resolveSubGoal(root, b.object_uid);
		assert.equal(achieved.ok, true, JSON.stringify(achieved.error));

		// Retire a → no longer resolvable as a NEW serves target.
		const readA = await readSubGoalObject({ factSourceRoot: root, objectUid: a.object_uid });
		await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: a.object_uid,
			expectedFingerprint: readA.value.fingerprint,
			frontmatterAfter: { status: "retired", disposition: "判据不再独立成立" },
			bodyMarkdownAfter: readA.value.body,
			changeSummary: "退役",
			sessionSignature: SIG,
		});
		const retired = await resolveSubGoal(root, a.object_uid);
		assert.equal(retired.ok, false);
		assert.equal(retired.error.code, "subgoal/serves_unresolvable");

		// An unknown uid is a distinct refusal.
		const unknown = await resolveSubGoal(root, "00000099-9999-4999-8999-999999999999");
		assert.equal(unknown.ok, false);
		assert.equal(unknown.error.code, "subgoal/serves_unresolvable");
	});
});

test("resolveSubGoal refuses a non-uuid value — the anchor form is gone (28 §12.3)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		await createOne(root);
		const r = await resolveSubGoal(root, "SG-1");
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/serves_shape_invalid");
	});
});

test("listResolvableSubGoals sorts by order, then created_at — never by identifier (28 §8)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		// Created OUT of display order on purpose: a naive directory or uuid sort
		// would produce a different sequence than the declared order.
		for (const [title, order] of [["第三条", 30], ["第一条", 10], ["第二条", 20]]) {
			const made = await createOne(root, { title, order });
			assert.equal(made.result.ok, true, JSON.stringify(made.result.error));
		}
		const listed = await listResolvableSubGoals(root);
		assert.equal(listed.ok, true);
		assert.deepEqual(listed.value.items.map((i) => i.title), ["第一条", "第二条", "第三条"]);
		assert.deepEqual(listed.value.items.map((i) => i.order), [10, 20, 30]);
	});
});

// ---------------------------------------------------------------------------
// listing (28 §12.4)
// ---------------------------------------------------------------------------

test("list defaults to active only; status=all includes both terminals (28 §12.4)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const keep = (await createOne(root)).result.value;
		const gone = (await createOne(root, { title: "将被退役的子目标" })).result.value;

		const readGone = await readSubGoalObject({ factSourceRoot: root, objectUid: gone.object_uid });
		await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: gone.object_uid,
			expectedFingerprint: readGone.value.fingerprint,
			frontmatterAfter: { status: "retired", disposition: "判据不再独立成立" },
			bodyMarkdownAfter: readGone.value.body,
			changeSummary: "退役",
			sessionSignature: SIG,
		});

		const activeOnly = await listSubGoalObjects({ factSourceRoot: root, status: "active" });
		assert.deepEqual(activeOnly.value.items.map((i) => i.title), ["验收材料成为可回读证据"]);

		const all = await listSubGoalObjects({ factSourceRoot: root, status: "all" });
		assert.deepEqual(all.value.items.map((i) => i.status).sort(), ["active", "retired"]);
		assert.ok(keep.object_uid);
	});
});

test("an unreadable carrier is reported, never silently dropped (02 §9.1)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		await createOne(root);
		await mkdir(join(root, SUBGOAL_DIRECTORY), { recursive: true });
		await writeFile(join(root, SUBGOAL_DIRECTORY, "subgoal-broken.md"), "not a carrier at all", "utf8");
		const listed = await listSubGoalObjects({ factSourceRoot: root, status: "all" });
		assert.equal(listed.ok, true);
		assert.equal(listed.value.items.length, 1);
		assert.equal(listed.value.unreadable.length, 1, JSON.stringify(listed.value.unreadable));
	});
});

// ---------------------------------------------------------------------------
// shared 02 §10 contract
// ---------------------------------------------------------------------------

test("create and update refuse an unsigned change_log entry (02 §7.1 + 09)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const d = draft();
		const r = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "signature_unavailable");
		// Nothing written by the refusal.
		const dir = join(root, SUBGOAL_DIRECTORY);
		const entries = await readdir(dir).catch(() => []);
		assert.deepEqual(entries, []);
	});
});

test("update refuses a stale CAS baseline (02 §10.5)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const created = (await createOne(root)).result.value;
		const r = await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: "0".repeat(64),
			frontmatterAfter: { title: "新标题" },
			bodyMarkdownAfter: await readFile(created.file, "utf8"),
			changeSummary: "stale",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/fingerprint_mismatch");
	});
});

test("read reports an unknown uid as not_found, not as a crash (02 §9.2)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const r = await readSubGoalObject({ factSourceRoot: root, objectUid: "00000000-0000-4000-8000-000000000000" });
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/not_found");
	});
});

test("the created entry carries the authoritative signature (02 §7.1)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const created = (await createOne(root)).result.value;
		const read = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });
		const entry = read.value.frontmatter.change_log[0];
		assert.equal(entry.provider, "test-provider");
		assert.equal(entry.model, "test-model");
	});
});

// ---------------------------------------------------------------------------
// create precheck (28 §13 提请前机械预检 + 双入口一致性)
// ---------------------------------------------------------------------------

test("precheck: a valid candidate passes and yields a fingerprint, writing NOTHING (28 §13)", async () => {
	await withTemp("subgoal-precheck.", async (base) => {
		const root = await freshRoot(base);
		const d = draft();
		const r = await precheckSubGoalCreate({ factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: validBody(d) });
		assert.equal(r.ok, true, JSON.stringify(r.error));
		assert.equal(r.value.mechanical_outcome, "passed");
		assert.match(r.value.candidate_fingerprint, /^[0-9a-f]{64}$/);
		// Read-only: no carrier appeared, and no identifier was minted (28 §13:
		// 不落盘、不生成对象标识).
		const entries = await readdir(join(root, SUBGOAL_DIRECTORY)).catch(() => []);
		assert.deepEqual(entries, []);
		assert.equal(r.value.object_uid, null);
	});
});

test("precheck: an invalid candidate reports issues instead of writing (28 §13)", async () => {
	await withTemp("subgoal-precheck.", async (base) => {
		const root = await freshRoot(base);
		const d = draft({ criterion_kind: "vibes" });
		const r = await precheckSubGoalCreate({ factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: validBody(d) });
		assert.equal(r.ok, true, JSON.stringify(r.error));
		assert.equal(r.value.mechanical_outcome, "failed");
		assert.equal(r.value.error_code, "subgoal/frontmatter_invalid");
		assert.ok(r.value.issues.length > 0, JSON.stringify(r.value));
	});
});

test("precheck: an unresolved parent goal is 'failed', not 'unverifiable' (28 §14.1)", async () => {
	await withTemp("subgoal-precheck.", async (base) => {
		const root = join(base, "ldvh-base");
		await mkdir(root, { recursive: true });
		const d = draft();
		const r = await precheckSubGoalCreate({ factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: validBody(d) });
		assert.equal(r.value.mechanical_outcome, "failed");
		assert.equal(r.value.error_code, "subgoal/parent_goal_unresolvable");
	});
});

test("precheck: a body it cannot evaluate at all is 'unverifiable', not 'failed'", async () => {
	await withTemp("subgoal-precheck.", async (base) => {
		const root = await freshRoot(base);
		const d = draft();
		const r = await precheckSubGoalCreate({ factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: "" });
		assert.equal(r.value.mechanical_outcome, "unverifiable");
	});
});

test("双入口一致性: precheck and create reach the SAME verdict on the same candidate (28 §13)", async () => {
	await withTemp("subgoal-precheck.", async (base) => {
		const root = await freshRoot(base);

		// A candidate that must FAIL both entries on a candidate-level rule.
		// (2026-11-01: this used to drive an "anchor already taken" collision —
		// that rule is gone with the anchor, so the shared failing rule is now a
		// content-level one: `order` out of range. Two rule sets would let them
		// disagree while both claiming compliance, which is what §13 forbids.)
		const bad = draft({ order: 0 });
		const pre = await precheckSubGoalCreate({ factSourceRoot: root, frontmatterDraft: bad, bodyMarkdown: validBody(bad) });
		const write = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: bad,
			bodyMarkdown: validBody(bad),
			sessionSignature: SIG,
		});
		assert.equal(pre.value.mechanical_outcome, "failed");
		assert.equal(write.ok, false);
		assert.equal(pre.value.error_code, write.error.code);
		assert.equal(pre.value.error_code, "subgoal/frontmatter_invalid");
	});
});

test("双入口一致性: a passing candidate passes BOTH entries", async () => {
	await withTemp("subgoal-precheck.", async (base) => {
		const root = await freshRoot(base);
		const d = draft();
		const pre = await precheckSubGoalCreate({ factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: validBody(d) });
		assert.equal(pre.value.mechanical_outcome, "passed", JSON.stringify(pre.value));
		const write = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
			expectedCandidateFingerprint: pre.value.candidate_fingerprint,
		});
		assert.equal(write.ok, true, JSON.stringify(write.error));
	});
});

test("候选指纹: excludes Code-stamped fields so two identical candidates agree", () => {
	const d = draft();
	const body = validBody(d);
	const a = computeSubGoalCreateCandidateFingerprint(d, body);
	const b = computeSubGoalCreateCandidateFingerprint(d, body);
	assert.equal(a, b);
	// The create-time `change_summary` flows into change_log (a Code-stamped
	// field), so it must not move the candidate fingerprint.
	const withSummary = { ...d, change_summary: "另一个理由" };
	assert.equal(computeSubGoalCreateCandidateFingerprint(withSummary, body), a);
	// A real content change DOES move it.
	assert.notEqual(computeSubGoalCreateCandidateFingerprint({ ...d, criterion: "换一条判据。" }, body), a);
	assert.notEqual(computeSubGoalCreateCandidateFingerprint(d, `${body}\n补一句。`), a);
});

test("write refuses when the candidate changed after the precheck (28 §13)", async () => {
	await withTemp("subgoal-precheck.", async (base) => {
		const root = await freshRoot(base);
		const d = draft();
		const pre = await precheckSubGoalCreate({ factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: validBody(d) });
		assert.equal(pre.value.mechanical_outcome, "passed");

		// The criterion text changed between the two calls.
		const changed = { ...d, criterion: "另一条完全不同的判据。" };
		const write = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: changed,
			bodyMarkdown: validBody(changed),
			sessionSignature: SIG,
			expectedCandidateFingerprint: pre.value.candidate_fingerprint,
		});
		assert.equal(write.ok, false);
		assert.equal(write.error.code, "subgoal/candidate_changed");
		// Nothing written by the refusal.
		const entries = await readdir(join(root, SUBGOAL_DIRECTORY)).catch(() => []);
		assert.deepEqual(entries, []);
	});
});

test("a create without a precheck fingerprint is still allowed (the gap must then be disclosed)", async () => {
	await withTemp("subgoal-precheck.", async (base) => {
		const root = await freshRoot(base);
		const d = draft();
		// 02 §10.1: the precheck obligation is real, but the WRITE must not invent
		// a verification it never ran. Omitting the fingerprint is permitted; the
		// caller then reports the missing precheck as unfulfilled scope.
		const write = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
		});
		assert.equal(write.ok, true, JSON.stringify(write.error));
	});
});

test("守卫：预检的占位 object_uid 绝不会落盘（28 §13 不生成对象标识）", async () => {
	await withTemp("subgoal-placeholder.", async (base) => {
		const root = await freshRoot(base);
		const d = draft();
		const pre = await precheckSubGoalCreate({ factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: validBody(d) });
		assert.equal(pre.value.mechanical_outcome, "passed");
		assert.equal(pre.value.object_uid, null);

		const write = await createSubGoalObject({
			factSourceRoot: root,
			frontmatterDraft: d,
			bodyMarkdown: validBody(d),
			sessionSignature: SIG,
		});
		assert.equal(write.ok, true, JSON.stringify(write.error));
		// The real uid must be the object's own, never the placeholder the
		// precheck used to satisfy the closed-set check.
		assert.notEqual(write.value.object_uid, "00000000-0000-4000-8000-000000000000");
		const raw = await readFile(write.value.file, "utf8");
		assert.doesNotMatch(raw, /00000000-0000-4000-8000-000000000000/);
	});
});

// ---------------------------------------------------------------------------
// tools layer (subgoal-tools.js)
// ---------------------------------------------------------------------------

test("subgoal tools: read/list/write lifecycle through the real handlers", async () => {
	const { makeExecute } = await import("../lib/subgoal-tools.js");
	const { initRepo, git, sessionPersistenceWithRoutingLog } = await import("./helpers.mjs");
	await withTemp("subgoal-tools.", async (base) => {
		const repo = await initRepo(base, { name: "repo" });
		await git(repo, ["commit", "-qm", "init"]);
		const root = join(repo, "ldvh-base");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "goal.md"), [
			"---", "goal_key: project-goal", "title: T", "status: active",
			"created_at: 2026-01-01T00:00:00.000Z",
			"change_log:", "  - at: 2026-01-01T00:00:00.000Z", "    summary: 存量", "---",
			"", "# 项目目标", "", "## 目标陈述", "", "夹具。", "",
		].join("\n"), "utf8");
		const home = join(base, "home");
		await mkdir(join(home, "ldvh"), { recursive: true });
		await writeFile(join(home, "ldvh", "governed-projects.yaml"), [
			"schema_version: 1", "governance_instance_name: T", "product_description: T",
			"projects:", "  - id: p", `    path: ${repo}`, "default_project_id: p", "",
		].join("\n"), "utf8");

		const { handlers } = makeExecute({
			dshHomePath: (...p) => join(home, ...p),
			sessionPersistence: sessionPersistenceWithRoutingLog(base),
		});
		const ctx = { agent: { session: { header: { cwd: repo } } } };

		// Empty list is a completed answer, not a failure.
		const empty = await handlers["subgoal-list-objects"]({}, ctx);
		assert.equal(empty.outcome, "completed");
		assert.equal(empty.result.count, 0);

		// Create through the tool plane (signature comes from the routing log).
		const d = draft();
		const created = await handlers["subgoal-write-object"]({
			action: "create",
			frontmatter_draft: d,
			body_markdown: validBody(d),
		}, ctx);
		assert.equal(created.outcome, "completed", JSON.stringify(created.gaps));

		// Read carries the derived serving set AND flags its emptiness (28 §8.1).
		const read = await handlers["subgoal-read-object"]({ object_uid: created.result.object_uid }, ctx);
		assert.equal(read.outcome, "completed", JSON.stringify(read.gaps));
		assert.equal(read.result.order, 1);
		assert.deepEqual(read.result.serving_objects, []);
		assert.equal(read.result.serving_objects_unresolved, true);
		assert.ok(read.gaps.some((g) => /serving-empty/.test(g)), JSON.stringify(read.gaps));

		// The retired `anchor` key is refused as a closed-set violation, and the
		// gap names the offending field rather than a generic rejection.
		const dup = await handlers["subgoal-write-object"]({
			action: "create",
			frontmatter_draft: { ...d, anchor: "SG-1" },
			body_markdown: validBody(d),
		}, ctx);
		assert.equal(dup.outcome, "rejected");
		assert.ok(dup.gaps.some((g) => /anchor/.test(g)), JSON.stringify(dup.gaps));
	});
});

test("subgoal tools: 预检工具只读运行，交还指纹与结论，不写盘", async () => {
	const { makeExecute } = await import("../lib/subgoal-tools.js");
	const { initRepo, git, sessionPersistenceWithRoutingLog } = await import("./helpers.mjs");
	await withTemp("subgoal-tools-precheck.", async (base) => {
		const repo = await initRepo(base, { name: "repo" });
		await git(repo, ["commit", "-qm", "init"]);
		const root = join(repo, "ldvh-base");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "goal.md"), [
			"---", "goal_key: project-goal", "title: T", "status: active",
			"created_at: 2026-01-01T00:00:00.000Z",
			"change_log:", "  - at: 2026-01-01T00:00:00.000Z", "    summary: 存量", "---",
			"", "# 项目目标", "", "## 目标陈述", "", "夹具。", "",
		].join("\n"), "utf8");
		const home = join(base, "home");
		await mkdir(join(home, "ldvh"), { recursive: true });
		await writeFile(join(home, "ldvh", "governed-projects.yaml"), [
			"schema_version: 1", "governance_instance_name: T", "product_description: T",
			"projects:", "  - id: p", `    path: ${repo}`, "default_project_id: p", "",
		].join("\n"), "utf8");

		const { handlers } = makeExecute({
			dshHomePath: (...p) => join(home, ...p),
			sessionPersistence: sessionPersistenceWithRoutingLog(base),
		});
		const ctx = { agent: { session: { header: { cwd: repo } } } };

		const d = draft();
		const pre = await handlers["subgoal-precheck-create"]({
			frontmatter_draft: d,
			body_markdown: validBody(d),
		}, ctx);
		assert.equal(pre.outcome, "completed", JSON.stringify(pre.gaps));
		assert.equal(pre.result.mechanical_outcome, "passed");
		assert.match(pre.result.candidate_fingerprint, /^[0-9a-f]{64}$/);
		// Read-only: the list is still empty.
		const listed = await handlers["subgoal-list-objects"]({}, ctx);
		assert.equal(listed.result.count, 0);
		// follow_up names the next step, so the caller does not invent one.
		assert.ok((pre.follow_up ?? []).some((f) => /expected_candidate_fingerprint/.test(f)), JSON.stringify(pre.follow_up));

		// Then the write honours the fingerprint it produced, and reports that the
		// precheck gate was met (02 §10.1).
		const created = await handlers["subgoal-write-object"]({
			action: "create",
			frontmatter_draft: d,
			body_markdown: validBody(d),
			expected_candidate_fingerprint: pre.result.candidate_fingerprint,
		}, ctx);
		assert.equal(created.outcome, "completed", JSON.stringify(created.gaps));
		assert.equal(created.result.precheck_fingerprint_bound, true);
		assert.deepEqual(created.scope.not_completed, []);
		assert.ok(!(created.gaps ?? []).some((g) => /precheck-not-run/.test(g)), JSON.stringify(created.gaps));
	});
});

test("subgoal tools: 未带指纹的创建**照常执行**，但把「未预检」如实登记为未兑现范围（02 §10.1）", async () => {
	const { makeExecute } = await import("../lib/subgoal-tools.js");
	const { initRepo, git, sessionPersistenceWithRoutingLog } = await import("./helpers.mjs");
	await withTemp("subgoal-tools-noprecheck.", async (base) => {
		const repo = await initRepo(base, { name: "repo" });
		await git(repo, ["commit", "-qm", "init"]);
		const root = join(repo, "ldvh-base");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "goal.md"), [
			"---", "goal_key: project-goal", "title: T", "status: active",
			"created_at: 2026-01-01T00:00:00.000Z",
			"change_log:", "  - at: 2026-01-01T00:00:00.000Z", "    summary: 存量", "---",
			"", "# 项目目标", "", "## 目标陈述", "", "夹具。", "",
		].join("\n"), "utf8");
		const home = join(base, "home");
		await mkdir(join(home, "ldvh"), { recursive: true });
		await writeFile(join(home, "ldvh", "governed-projects.yaml"), [
			"schema_version: 1", "governance_instance_name: T", "product_description: T",
			"projects:", "  - id: p", `    path: ${repo}`, "default_project_id: p", "",
		].join("\n"), "utf8");
		const { handlers } = makeExecute({
			dshHomePath: (...p) => join(home, ...p),
			sessionPersistence: sessionPersistenceWithRoutingLog(base),
		});
		const ctx = { agent: { session: { header: { cwd: repo } } } };

		const d = draft();
		const created = await handlers["subgoal-write-object"]({
			action: "create",
			frontmatter_draft: d,
			body_markdown: validBody(d),
		}, ctx);
		// The write is NOT blocked — 02 §10.1 forbids inventing an obligation the
		// caller never met, but requires the gap to be visible.
		assert.equal(created.outcome, "completed", JSON.stringify(created.gaps));
		assert.equal(created.result.precheck_fingerprint_bound, false);
		assert.ok(created.scope.not_completed.some((x) => /precheck/.test(x)), JSON.stringify(created.scope));
		assert.ok(created.gaps.some((g) => /precheck-not-run/.test(g)), JSON.stringify(created.gaps));
	});
});

test("subgoal tools: 预检失败时 outcome 仍是 completed（工具跑了，候选没过）", async () => {
	const { makeExecute } = await import("../lib/subgoal-tools.js");
	const { initRepo, git, sessionPersistenceWithRoutingLog } = await import("./helpers.mjs");
	await withTemp("subgoal-tools-precheck2.", async (base) => {
		const repo = await initRepo(base, { name: "repo" });
		await git(repo, ["commit", "-qm", "init"]);
		const root = join(repo, "ldvh-base");
		await mkdir(root, { recursive: true });
		const home = join(base, "home");
		await mkdir(join(home, "ldvh"), { recursive: true });
		await writeFile(join(home, "ldvh", "governed-projects.yaml"), [
			"schema_version: 1", "governance_instance_name: T", "product_description: T",
			"projects:", "  - id: p", `    path: ${repo}`, "default_project_id: p", "",
		].join("\n"), "utf8");
		const { handlers } = makeExecute({
			dshHomePath: (...p) => join(home, ...p),
			sessionPersistence: sessionPersistenceWithRoutingLog(base),
		});
		const ctx = { agent: { session: { header: { cwd: repo } } } };

		const d = draft();
		// No goal.md ⇒ parent_goal unresolvable ⇒ mechanical failure.
		const pre = await handlers["subgoal-precheck-create"]({
			frontmatter_draft: d,
			body_markdown: validBody(d),
		}, ctx);
		// The tool RAN and reported a verdict; `rejected` would wrongly say the
		// tool refused to run (05 §8 outcome semantics).
		assert.equal(pre.outcome, "completed");
		assert.equal(pre.result.mechanical_outcome, "failed");
		assert.equal(pre.result.error_code, "subgoal/parent_goal_unresolvable");
		assert.equal(pre.verification.passed, false);
	});
});

test("subgoal tools: an invalid action is an invalid_request, not a write", async () => {
	const { makeExecute } = await import("../lib/subgoal-tools.js");
	const { handlers } = makeExecute({ dshHomePath: () => "/tmp/none" });
	const r = await handlers["subgoal-write-object"]({ action: "delete" }, {});
	assert.equal(r.outcome, "invalid_request");
});

test("subgoal tools: read serves only governed sessions", async () => {
	const { makeExecute } = await import("../lib/subgoal-tools.js");
	const { handlers } = makeExecute({ dshHomePath: () => "/tmp/none" });
	const r = await handlers["subgoal-read-object"]({ object_uid: "00000000-0000-4000-8000-000000000000" }, {});
	assert.equal(r.outcome, "unavailable");
	assert.ok(r.gaps.some((g) => /governance state/.test(g)));
});
