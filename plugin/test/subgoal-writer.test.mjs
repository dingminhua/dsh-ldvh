// Tests for plugin/lib/subgoal-writer.js — the SubGoal fact-type writer.
//
// Authority: specs/28 §7 (identity/carrier), §8 (field contract + fixed body
// H2), §9 (status closure + anchor freeze), §13 (controlled operations), §14.1
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
	createSubGoalObject,
	listResolvableAnchors,
	listSubGoalObjects,
	readSubGoalObject,
	resolveSubGoalAnchor,
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
		anchor: "SG-1",
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
		assert.match(raw, /anchor: SG-1/);
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
// anchor uniqueness (28 §6.2)
// ---------------------------------------------------------------------------

test("a second object cannot take an anchor that an ACTIVE object holds (28 §6.2)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const first = await createOne(root);
		assert.equal(first.result.ok, true, JSON.stringify(first.result.error));

		const dup = await createOne(root);
		assert.equal(dup.result.ok, false);
		assert.equal(dup.result.error.code, "subgoal/anchor_already_exists");
		// The occupant is reported, not just the code.
		assert.ok(Array.isArray(dup.result.error.details?.conflicts));
		assert.equal(dup.result.error.details.conflicts.length, 1);
		assert.equal(dup.result.error.details.conflicts[0].object_uid, first.result.value.object_uid);
	});
});

test("a RETIRED anchor is still occupied — numbers are never recycled (28 §9.2)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const first = await createOne(root);
		const created = first.result.value;
		const read = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });

		const retired = await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: { status: "retired", disposition: "并入 SG-9，判据不再独立成立" },
			bodyMarkdownAfter: read.value.body,
			changeSummary: "判据失效，退役",
			sessionSignature: SIG,
		});
		assert.equal(retired.ok, true, JSON.stringify(retired.error));

		const reuse = await createOne(root);
		assert.equal(reuse.result.ok, false);
		assert.equal(reuse.result.error.code, "subgoal/anchor_already_exists");
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
// anchor immutability (28 §9.3)
// ---------------------------------------------------------------------------

test("an anchor cannot be renamed in place — a new sub-goal is a new SG-n (28 §9.3)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const created = (await createOne(root)).result.value;
		const read = await readSubGoalObject({ factSourceRoot: root, objectUid: created.object_uid });
		const r = await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: read.value.fingerprint,
			frontmatterAfter: { anchor: "SG-2" },
			bodyMarkdownAfter: read.value.body,
			changeSummary: "改号",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "subgoal/anchor_immutable");
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
		anchor: "SG-1",
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

test("a non-canonical anchor (SG-0 / SG-x) is refused (28 §7)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		for (const anchor of ["SG-0", "SG-x", "sg-1", "1"]) {
			const d = draft({ anchor });
			const r = await createSubGoalObject({
				factSourceRoot: root,
				frontmatterDraft: d,
				bodyMarkdown: validBody(d),
				sessionSignature: SIG,
			});
			assert.equal(r.ok, false, `${anchor} must be refused`);
			assert.equal(r.error.code, "subgoal/frontmatter_invalid", `${anchor}: ${r.error.code}`);
		}
	});
});

// ---------------------------------------------------------------------------
// serves resolution (28 §12.3)
// ---------------------------------------------------------------------------

test("resolveSubGoalAnchor: active and achieved resolve; retired does not (28 §12.3)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const a = (await createOne(root)).result.value;
		const b = (await createOne(root, { anchor: "SG-2" })).result.value;

		const active = await resolveSubGoalAnchor(root, "SG-1");
		assert.equal(active.ok, true, JSON.stringify(active.error));

		// Achieve SG-2 → still a valid `serves` target.
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
		const achieved = await resolveSubGoalAnchor(root, "SG-2");
		assert.equal(achieved.ok, true, JSON.stringify(achieved.error));

		// Retire SG-1 → no longer resolvable.
		const readA = await readSubGoalObject({ factSourceRoot: root, objectUid: a.object_uid });
		await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: a.object_uid,
			expectedFingerprint: readA.value.fingerprint,
			frontmatterAfter: { status: "retired", disposition: "并入 SG-2" },
			bodyMarkdownAfter: readA.value.body,
			changeSummary: "退役",
			sessionSignature: SIG,
		});
		const retired = await resolveSubGoalAnchor(root, "SG-1");
		assert.equal(retired.ok, false);
		assert.equal(retired.error.code, "subgoal/serves_unresolvable");

		// Unknown anchor is a distinct refusal.
		const unknown = await resolveSubGoalAnchor(root, "SG-99");
		assert.equal(unknown.ok, false);
		assert.equal(unknown.error.code, "subgoal/serves_unresolvable");
	});
});

test("listResolvableAnchors returns numeric order, not directory order (28 §12.3)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		// Created out of order on purpose: directory order would be SG-10, SG-2, SG-3.
		for (const anchor of ["SG-10", "SG-2", "SG-3"]) {
			const made = await createOne(root, { anchor });
			assert.equal(made.result.ok, true, JSON.stringify(made.result.error));
		}
		const listed = await listResolvableAnchors(root);
		assert.equal(listed.ok, true);
		assert.deepEqual(listed.value.anchors, ["SG-2", "SG-3", "SG-10"]);
	});
});

// ---------------------------------------------------------------------------
// listing (28 §12.4)
// ---------------------------------------------------------------------------

test("list defaults to active only; status=all includes both terminals (28 §12.4)", async () => {
	await withTemp("subgoal.", async (base) => {
		const root = await freshRoot(base);
		const keep = (await createOne(root)).result.value;
		const gone = (await createOne(root, { anchor: "SG-2" })).result.value;

		const readGone = await readSubGoalObject({ factSourceRoot: root, objectUid: gone.object_uid });
		await updateSubGoalObject({
			factSourceRoot: root,
			objectUid: gone.object_uid,
			expectedFingerprint: readGone.value.fingerprint,
			frontmatterAfter: { status: "retired", disposition: "并入 SG-1" },
			bodyMarkdownAfter: readGone.value.body,
			changeSummary: "退役",
			sessionSignature: SIG,
		});

		const activeOnly = await listSubGoalObjects({ factSourceRoot: root, status: "active" });
		assert.deepEqual(activeOnly.value.items.map((i) => i.anchor), ["SG-1"]);

		const all = await listSubGoalObjects({ factSourceRoot: root, status: "all" });
		assert.deepEqual(all.value.items.map((i) => i.anchor).sort(), ["SG-1", "SG-2"]);
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
		assert.equal(read.result.anchor, "SG-1");
		assert.deepEqual(read.result.serving_objects, []);
		assert.equal(read.result.serving_objects_unresolved, true);
		assert.ok(read.gaps.some((g) => /serving-empty/.test(g)), JSON.stringify(read.gaps));

		// A duplicate anchor is a rejection that names the occupant.
		const dup = await handlers["subgoal-write-object"]({
			action: "create",
			frontmatter_draft: d,
			body_markdown: validBody(d),
		}, ctx);
		assert.equal(dup.outcome, "rejected");
		assert.ok(dup.gaps.some((g) => /anchor SG-1/.test(g)), JSON.stringify(dup.gaps));
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
