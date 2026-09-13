// Tests for plugin/lib/goal-writer.js — the singleton Goal writer.
//
// Authority: specs/25 §5 (identity/carrier, singleton exemptions), §6 (field
// contract + fixed body H2), §7 (status closure), §11 §12 (controlled
// operations, anchor stability), plus the shared 03 §9 contract and the
// Human requirement that every change_log entry is mechanically signed.
//
// The singleton shape is the defining difference from 20–24/27, so the tests
// below concentrate on what only a singleton can get wrong: the second-create
// refusal, path-as-identity (no uid/type key), and anchor stability.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	GOAL_RELATIVE_PATH,
	createGoalObject,
	goalFilePath,
	parseSubGoals,
	readGoalAnchors,
	readGoalObject,
	splitBodySections,
	updateGoalObject,
	validateAnchorStability,
	validateGoalBodyStructure,
	validateGoalFrontmatter,
} from "../lib/goal-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";
import { withTemp } from "./helpers.mjs";

const SIG = authoritativeSignature({ provider: "test-provider", model: "test-model" });

const validBody = (subGoals = "SG-1 第一条判据\nSG-2 第二条判据") =>
	`## 目标陈述\n\n这是一个项目目标陈述，说明为什么与要实现什么。\n\n## 子目标\n\n${subGoals}\n`;

async function freshRoot(base) {
	const root = join(base, "ldvh-base");
	await mkdir(root, { recursive: true });
	return root;
}

// ---------------------------------------------------------------------------
// identity & carrier (25 §5)
// ---------------------------------------------------------------------------

test("carrier is the fixed singleton path — path IS identity", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const created = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "目标短标题", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		assert.equal(created.ok, true, JSON.stringify(created.error));
		assert.equal(created.value.file, join(root, GOAL_RELATIVE_PATH));
		assert.equal(goalFilePath(root), join(root, "goal.md"));

		// 25 §5: no object_uid / fact_type_key / type subdirectory.
		const raw = await readFile(created.value.file, "utf8");
		assert.doesNotMatch(raw, /object_uid/);
		assert.doesNotMatch(raw, /fact_type_key/);
		assert.match(raw, /goal_key: project-goal/);
	});
});

test("create refuses a second Goal — the singleton is fail-closed (25 §11)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const first = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		assert.equal(first.ok, true);
		const second = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T2", change_summary: "again" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		assert.equal(second.ok, false);
		assert.equal(second.error.code, "goal/already_exists");
		// The original must be untouched.
		const after = await readGoalObject({ factSourceRoot: root });
		assert.equal(after.value.frontmatter.title, "T");
	});
});

test("create refuses status other than active (25 §7 初态必为 active)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const created = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", status: "achieved", change_summary: "x" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "goal/initial_state_violation");
	});
});

test("create refuses the multi-instance fields 25 declares not adopted", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		for (const forbidden of ["object_uid", "fact_type_key", "urls", "relations"]) {
			const r = await createGoalObject({
				factSourceRoot: root,
				frontmatterDraft: { title: "T", [forbidden]: forbidden === "relations" ? [] : "x", change_summary: "x" },
				bodyMarkdown: validBody(),
				sessionSignature: SIG,
			});
			assert.equal(r.ok, false, `${forbidden} must be refused`);
			assert.equal(r.error.code, "goal/frontmatter_invalid");
		}
	});
});

// ---------------------------------------------------------------------------
// body contract (25 §6)
// ---------------------------------------------------------------------------

test("body must be exactly 目标陈述 then 子目标 — 方法与规划 is not accepted (25 §6)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const withRemoved = "## 目标陈述\n\nx。\n\n## 方法与规划\n\n这不是合法区块。\n\n## 子目标\n\nSG-1 判据\n";
		const r = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "x" },
			bodyMarkdown: withRemoved,
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "goal/body_invalid");
		assert.ok(r.error.details.issues.some((i) => /H2 sections must be exactly/.test(i)), JSON.stringify(r.error.details));
	});
});

test("a statement-only goal is a legal intermediate state (25 §7)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const r = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: "## 目标陈述\n\n只有陈述，子目标待精化。\n\n## 子目标\n\n",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, true, JSON.stringify(r.error));
		const read = await readGoalObject({ factSourceRoot: root });
		assert.deepEqual(read.value.sub_goals, []);
	});
});

test("body structure validation requires a non-empty 目标陈述", () => {
	const body = "# 项目目标\n\n## 目标陈述\n\n\n## 子目标\n\n";
	const r = validateGoalBodyStructure(body);
	assert.equal(r.ok, false);
	assert.ok(r.issues.some((i) => /目标陈述 section must be present and non-empty/.test(i)));
});

// ---------------------------------------------------------------------------
// sub-goal anchors (25 §11 §12)
// ---------------------------------------------------------------------------

test("parseSubGoals reads SG-n entries and flags malformed lines", () => {
	const parsed = parseSubGoals("SG-1 第一条\nSG-2 第二条\n没有锚点的一行\n");
	assert.equal(parsed.length, 3);
	assert.deepEqual(parsed.map((p) => p.anchor), ["SG-1", "SG-2", null]);
	assert.equal(parsed[2].malformed, true);
});

test("anchor stability: deleting an existing SG-n is refused (25 §12)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		const cur = await readGoalObject({ factSourceRoot: root });
		const r = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: cur.value.fingerprint,
			frontmatterAfter: { ...cur.value.frontmatter },
			bodyMarkdownAfter: "## 目标陈述\n\n这是一个项目目标陈述。\n\n## 子目标\n\nSG-1 第一条判据\n",
			changeSummary: "删掉了 SG-2",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "goal/anchor_instability");
		assert.ok(r.error.details.issues.some((i) => /SG-2 disappeared/.test(i)));
	});
});

test("anchor stability: rewriting or reordering SG-n is refused; adding is allowed", async () => {
	// A rewritten number is a delete+add, so the delete half is what fires.
	const rewritten = validateAnchorStability(["SG-1", "SG-2"], ["SG-1", "SG-9"]);
	assert.equal(rewritten.ok, false);
	const reordered = validateAnchorStability(["SG-1", "SG-2"], ["SG-2", "SG-1"]);
	assert.equal(reordered.ok, false);
	assert.ok(reordered.issues.some((i) => /reordered/.test(i)));
	const added = validateAnchorStability(["SG-1", "SG-2"], ["SG-1", "SG-2", "SG-3"]);
	assert.equal(added.ok, true, JSON.stringify(added.issues));
});

test("update adds an anchor through the real writer and reports revised anchors", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		const cur = await readGoalObject({ factSourceRoot: root });
		const r = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: cur.value.fingerprint,
			frontmatterAfter: { ...cur.value.frontmatter },
			bodyMarkdownAfter: validBody("SG-1 第一条判据\nSG-2 第二条判据\nSG-3 第三条判据"),
			changeSummary: "补入 SG-3：第三条判据已可判定",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, true, JSON.stringify(r.error));
		assert.deepEqual(r.value.revised_anchors, ["SG-1", "SG-2"]);
		const anchors = await readGoalAnchors({ factSourceRoot: root });
		assert.deepEqual(anchors.value.anchors, ["SG-1", "SG-2", "SG-3"]);
	});
});

// ---------------------------------------------------------------------------
// status lifecycle (25 §7)
// ---------------------------------------------------------------------------

test("achieved is terminal — a later update is refused (25 §7 冻结)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		const cur = await readGoalObject({ factSourceRoot: root });
		const achieved = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: cur.value.fingerprint,
			frontmatterAfter: { ...cur.value.frontmatter, status: "achieved" },
			bodyMarkdownAfter: validBody(),
			changeSummary: "全部 sub-goal 达成，Human 判定收官",
			sessionSignature: SIG,
		});
		assert.equal(achieved.ok, true, JSON.stringify(achieved.error));
		const after = await readGoalObject({ factSourceRoot: root });
		const refused = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: after.value.fingerprint,
			frontmatterAfter: { ...after.value.frontmatter },
			bodyMarkdownAfter: validBody("SG-1 改过的判据\nSG-2 第二条判据"),
			changeSummary: "再改一次",
			sessionSignature: SIG,
		});
		assert.equal(refused.ok, false);
		assert.equal(refused.error.code, "goal/status_terminal");
	});
});

test("a third status value is not in the closure (25 §7)", async () => {
	const r = validateGoalFrontmatter({ goal_key: "project-goal", title: "T", status: "abandoned", created_at: "x", change_log: [{ at: "x", summary: "y" }] });
	assert.equal(r.ok, false);
	assert.ok(r.issues.some((i) => /status: must be one of active\/achieved/.test(i)));
});

// ---------------------------------------------------------------------------
// shared 03 §9 contract
// ---------------------------------------------------------------------------

test("read reports a missing goal as not_initialised, not as an error (25 §10)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const r = await readGoalObject({ factSourceRoot: root });
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "goal/not_initialised");
	});
});

test("update refuses a stale CAS baseline (03 §9.5)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		const r = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: "0".repeat(64),
			frontmatterAfter: { goal_key: "project-goal", title: "T", status: "active", created_at: "x" },
			bodyMarkdownAfter: validBody(),
			changeSummary: "stale",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "goal/cas_conflict");
	});
});

test("update requires a change reason (25 §6 每条必含修订理由)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		const cur = await readGoalObject({ factSourceRoot: root });
		const r = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: cur.value.fingerprint,
			frontmatterAfter: { ...cur.value.frontmatter },
			bodyMarkdownAfter: validBody("SG-1 改\nSG-2 第二条判据"),
			changeSummary: "",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "goal/change_summary_required");
	});
});

test("create and update refuse an unsigned change_log entry (Human 2026-09-12)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const create = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
		});
		assert.equal(create.ok, false);
		assert.equal(create.error.code, "signature_unavailable");
		assert.match(create.error.message, /REPORT TO HUMAN/);
		// A forged plain object is not a signature either.
		const forged = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: { provider: "forged", model: "x" },
		});
		assert.equal(forged.error.code, "signature_unavailable");
		// Nothing written by either refusal.
		const read = await readGoalObject({ factSourceRoot: root });
		assert.equal(read.error.code, "goal/not_initialised");
	});
});

test("the created entry carries the authoritative signature (03 §6.1)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		const read = await readGoalObject({ factSourceRoot: root });
		const entry = read.value.frontmatter.change_log[0];
		assert.equal(entry.provider, "test-provider");
		assert.equal(entry.model, "test-model");
	});
});

test("splitBodySections returns the H2 sections in order", () => {
	const s = splitBodySections("# 项目目标\n\n## 目标陈述\n\naaa\n\n## 子目标\n\nSG-1 x\n");
	assert.deepEqual(s.map((x) => x.heading), ["目标陈述", "子目标"]);
	assert.equal(s[0].text, "aaa");
});

test("readGoalAnchors reports the real repo goal (integration)", async () => {
	// The repository's own goal.md must parse under this writer's contract —
	// otherwise the writer and the live carrier disagree.
	const root = fileURLToPath(new URL("../../ldvh-base", import.meta.url));
	const r = await readGoalAnchors({ factSourceRoot: root });
	assert.equal(r.ok, true, JSON.stringify(r.error));
	assert.equal(r.value.status, "active");
	assert.deepEqual(r.value.anchors, ["SG-1", "SG-2", "SG-3", "SG-4"]);
});

// ---------------------------------------------------------------------------
// tools layer (goal-tools.js)
// ---------------------------------------------------------------------------

test("goal tools: read/write lifecycle through the real tool handlers", async () => {
	const { mkdir } = await import("node:fs/promises");
	const { makeExecute } = await import("../lib/goal-tools.js");
	const { initRepo, git } = await import("./helpers.mjs");
	await withTemp("goal-tools.", async (base) => {
		const repo = await initRepo(base, { name: "repo" });
		await git(repo, ["commit", "-qm", "init"]);
		await mkdir(join(repo, "ldvh-base"), { recursive: true });
		const home = join(base, "home");
		await mkdir(join(home, "ldvh"), { recursive: true });
		await writeFile(join(home, "ldvh", "governed-projects.yaml"), [
			"schema_version: 1", "governance_instance_name: T", "product_description: T",
			"projects:", "  - id: p", `    path: ${repo}`, "default_project_id: p", "",
		].join("\n"));
		const { handlers } = makeExecute({ dshHomePath: (...p) => join(home, ...p) });
		const ctx = { agent: { session: { header: { cwd: repo } } } };

		// Absent singleton → unavailable with the 25 §10 reason (reads not blocked).
		const absent = await handlers["goal-read-object"]({}, ctx);
		assert.equal(absent.outcome, "unavailable");
		assert.match(absent.gaps[0], /goal\/not_initialised/);

		// Writing without a session authority → refused and reported for Human.
		const unsigned = await handlers["goal-write-object"]({
			action: "create",
			frontmatter_draft: { title: "T", change_summary: "init" },
			body_markdown: validBody(),
		}, ctx);
		assert.equal(unsigned.outcome, "unavailable");
		assert.ok(unsigned.gaps.some((g) => /signature_unavailable/.test(g)), JSON.stringify(unsigned.gaps));
		assert.ok(unsigned.gaps.some((g) => /REPORT TO HUMAN/.test(g)));

		// Still absent — the refusal must not have written anything.
		const stillAbsent = await handlers["goal-read-object"]({}, ctx);
		assert.equal(stillAbsent.outcome, "unavailable");
	});
});

test("goal tools: an invalid action is an invalid_request, not a write", async () => {
	const { makeExecute } = await import("../lib/goal-tools.js");
	const { handlers } = makeExecute({ dshHomePath: () => "/tmp/none" });
	const r = await handlers["goal-write-object"]({ action: "delete" }, {});
	assert.equal(r.outcome, "invalid_request");
});

// ---------------------------------------------------------------------------
// 回归：独立审核发现的缺陷（2026-09-12）
// ---------------------------------------------------------------------------

test("REGRESSION: read→echo-back update is idempotent — the H1 is never doubled", async () => {
	await withTemp("goal-rt.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		// Feed back exactly what read returned, three times. `readGoalObject`
		// returns the body INCLUDING the H1, so a non-idempotent assembly
		// doubles it — which is what happened to the real goal.md (94a51bf).
		for (let i = 1; i <= 3; i += 1) {
			const cur = await readGoalObject({ factSourceRoot: root });
			const r = await updateGoalObject({
				factSourceRoot: root,
				expectedFingerprint: cur.value.fingerprint,
				frontmatterAfter: { ...cur.value.frontmatter },
				bodyMarkdownAfter: cur.value.body,
				changeSummary: `round ${i}`,
				sessionSignature: SIG,
			});
			assert.equal(r.ok, true, `round ${i}: ${JSON.stringify(r.error)}`);
			const after = await readGoalObject({ factSourceRoot: root });
			assert.equal((after.value.body.match(/^#\s+\S/gm) ?? []).length, 1, `round ${i} must leave exactly one H1`);
			assert.equal(after.value.body_valid, true);
		}
	});
});

test("REGRESSION: a duplicated H1 is a mechanical failure, not 'valid'", () => {
	const doubled = "# 项目目标\n\n# 项目目标\n\n## 目标陈述\n\nx。\n\n## 子目标\n\nSG-1 一\n";
	const r = validateGoalBodyStructure(doubled);
	assert.equal(r.ok, false);
	assert.ok(r.issues.some((i) => /exactly one H1/.test(i)), JSON.stringify(r.issues));
});

test("REGRESSION: a malformed anchor cannot escape the stability check (25 §12)", async () => {
	await withTemp("goal-anchor.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody("SG-1 一\nSG-2 二\n"),
			sessionSignature: SIG,
		});
		const cur = await readGoalObject({ factSourceRoot: root });
		// Each malformed shape must be REFUSED with a precise code — otherwise
		// the anchor stops parsing (anchor: null), becomes invisible to the
		// comparison, and deleting it would be silently accepted.
		for (const [label, sub] of [
			["no separator", "SG-3三"],
			["colon", "SG-3: 三"],
			["zero index", "SG-0 三"],
		]) {
			const r = await updateGoalObject({
				factSourceRoot: root,
				expectedFingerprint: cur.value.fingerprint,
				frontmatterAfter: { ...cur.value.frontmatter },
				bodyMarkdownAfter: `## 目标陈述\n\n这是一个项目目标陈述。\n\n## 子目标\n\nSG-1 一\nSG-2 二\n${sub}\n`,
				changeSummary: label,
				sessionSignature: SIG,
			});
			assert.equal(r.ok, false, `${label} must be refused`);
			assert.ok(
				["goal/anchor_unparsable", "goal/anchor_instability"].includes(r.error.code),
				`${label}: unexpected code ${r.error.code}`
			);
		}
	});
});

test("parseSubGoals tolerates a list marker and reports anchor-shaped failures", () => {
	// A leading marker is tolerated (hand-edited files may use one).
	assert.equal(parseSubGoals("- SG-1 判据")[0].anchor, "SG-1");
	assert.equal(parseSubGoals("* SG-2 判据")[0].anchor, "SG-2");
	// `SG-0` parses but is flagged non-canonical.
	const zero = parseSubGoals("SG-0 判据")[0];
	assert.equal(zero.anchor, "SG-0");
	assert.equal(zero.malformed, true);
	// Anchor-shaped text that does not parse carries a reason so the writer can
	// refuse instead of silently ignoring it.
	const broken = parseSubGoals("SG-3: 判据")[0];
	assert.equal(broken.anchor, null);
	assert.match(String(broken.reason), /looks like a sub-goal anchor/);
});

test("REGRESSION: the carrier FILE mode is checked, not just the directory (07 §5.6)", async () => {
	if (process.platform === "win32") return;
	const { evaluateRegistrationEntry } = await import("../lib/governed-projects.js");
	const { chmod: ch } = await import("node:fs/promises");
	await withTemp("ldvh-filemode.", async (base) => {
		const home = join(base, "home");
		const dir = join(home, "ldvh");
		await mkdir(dir, { recursive: true });
		await ch(dir, 0o700);
		const file = join(dir, "governed-projects.yaml");
		await writeFile(file, [
			"schema_version: 1", "governance_instance_name: T", "product_description: T",
			"projects: []", 'default_project_id: ""', "",
		].join("\n"));

		// Directory correct, file world-readable → must be refused.
		await ch(file, 0o644);
		const resolveHome = (...p) => join(home, ...p);
		const wide = await evaluateRegistrationEntry(resolveHome);
		assert.equal(wide.ok, false);
		assert.equal(wide.error.code, "registration_permission_unverified");
		assert.match(wide.error.message, /file permission is wider than 0600/);

		// Compliant 0600 → accepted.
		await ch(file, 0o600);
		const ok = await evaluateRegistrationEntry(resolveHome);
		assert.equal(ok.ok, true, JSON.stringify(ok));
	});
});
