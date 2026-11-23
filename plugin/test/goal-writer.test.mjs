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
	hasLegacySubGoalSection,
	readServableSubGoals,
	readGoalObject,
	splitBodySections,
	updateGoalObject,
	validateAnchorStability,
	validateGoalBodyStructure,
	validateGoalFrontmatter,
} from "../lib/goal-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";
import { seedSubGoals, subGoalUid, withTemp } from "./helpers.mjs";
import { skipWithoutCorpus } from "./helpers.mjs";

const SIG = authoritativeSignature({ provider: "test-provider", model: "test-model" });

const validBody = () =>
	`## 目标陈述\n\n这是一个项目目标陈述，说明为什么与要实现什么。\n`;

const legacyBody = (subGoals = "SG-1 第一条判据\nSG-2 第二条判据") =>
	`## 目标陈述\n\n这是一个项目目标陈述，说明为什么与要实现什么。\n\n## 子目标\n\n${subGoals}\n`;

async function freshRoot(base) {
	const root = join(base, "ldvh-base");
	await mkdir(root, { recursive: true });
	return root;
}

async function writeLegacyGoal(root) {
	const fm = [
		"goal_key: project-goal",
		"title: T",
		"status: active",
		"created_at: 2026-01-01T00:00:00.000Z",
		"change_log:",
		"  - at: 2026-01-01T00:00:00.000Z",
		"    summary: 存量初始化",
	].join("\n");
	await writeFile(join(root, "goal.md"), `---\n${fm}\n---\n\n# 项目目标\n\n${legacyBody()}`, "utf8");
}


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


test("body must be exactly 目标陈述 — 方法与规划 is not accepted (25 §7)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const withRemoved = "## 目标陈述\n\nx。\n\n## 方法与规划\n\n这不是合法区块。\n";
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
			bodyMarkdown: "## 目标陈述\n\n只有陈述，子目标待精化。\n",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, true, JSON.stringify(r.error));
		const read = await readGoalObject({ factSourceRoot: root });
		assert.deepEqual(read.value.sub_goals, []);
	});
});

test("body structure validation requires a non-empty 目标陈述", () => {
	const body = "# 项目目标\n\n## 目标陈述\n\n";
	const r = validateGoalBodyStructure(body);
	assert.equal(r.ok, false);
	assert.ok(r.issues.some((i) => /目标陈述 section must be present and non-empty/.test(i)));
});


test("目标陈述 200 字符通过、201 字符拒绝（25 §7 硬上限）", () => {
	const at = (n) => `# 项目目标\n\n## 目标陈述\n\n${"字".repeat(n)}\n`;
	assert.equal(validateGoalBodyStructure(at(200)).ok, true, "恰好 200 字符须通过");

	const over = validateGoalBodyStructure(at(201));
	assert.equal(over.ok, false, "201 字符须拒绝");
	assert.ok(
		over.issues.some((i) => /must be ≤ 200 characters/.test(i)),
		JSON.stringify(over.issues),
	);
});

test("超限拒绝写入，且不得截断后写入（25 §7 拒绝纪律）", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const long = "这是一条超过上限的目标陈述。".repeat(20);
		assert.ok(long.length > 200, "夹具须真的超限");
		const r = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "x" },
			bodyMarkdown: `## 目标陈述\n\n${long}\n`,
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false, "超限必须被拒绝");
		assert.equal(r.error.code, "goal/body_invalid");
		await assert.rejects(() => readFile(join(root, "goal.md"), "utf8"));
	});
});

test("上限按去除首尾空白后的正文段计，段内换行照常计入", () => {
	const padded = `# 项目目标\n\n## 目标陈述\n\n\n\n${"字".repeat(200)}\n\n\n`;
	assert.equal(validateGoalBodyStructure(padded).ok, true, "首尾空白不计入");

	const withNewline = `# 项目目标\n\n## 目标陈述\n\n${"字".repeat(199)}\n${"字".repeat(2)}\n`;
	assert.equal(validateGoalBodyStructure(withNewline).ok, false, "段内换行不豁免长度");
});

test("存量 87 字陈述仍合规（上限不追溯改写既有内容）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const raw = await readFile(
		join(fileURLToPath(new URL("../../", import.meta.url)), "ldvh-base", "goal.md"),
		"utf8",
	);
	const m = /^##\s*目标陈述\s*$/m.exec(raw);
	assert.ok(m !== null, "本仓 goal.md 须含 目标陈述 段");
	const section = raw.slice(m.index + m[0].length).split(/^##\s/m)[0].trim();
	assert.ok(section.length > 0 && section.length <= 200, `本仓陈述长度 ${section.length} 须 ≤ 200`);
});


test("parseSubGoals reads SG-n entries and flags malformed lines", () => {
	const parsed = parseSubGoals("SG-1 第一条\nSG-2 第二条\n没有锚点的一行\n");
	assert.equal(parsed.length, 3);
	assert.deepEqual(parsed.map((p) => p.anchor), ["SG-1", "SG-2", null]);
	assert.equal(parsed[2].malformed, true);
});

test("legacy 子目标 section: dropping it now SUCCEEDS and reports what it dropped (25 §7 2026-11)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await writeLegacyGoal(root);
		const cur = await readGoalObject({ factSourceRoot: root });
		assert.equal(cur.value.body_valid, true, JSON.stringify(cur.value.body_issues));
		assert.equal(hasLegacySubGoalSection(cur.value.body), true);

		const r = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: cur.value.fingerprint,
			frontmatterAfter: { ...cur.value.frontmatter },
			bodyMarkdownAfter: "## 目标陈述\n\n这是一个项目目标陈述，说明为什么与要实现什么。\n",
			changeSummary: "删掉子目标段",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, true, JSON.stringify(r.error));
		assert.deepEqual(r.value.legacy_sub_goals_dropped, ["SG-1 第一条判据", "SG-2 第二条判据"]);
		const after = await readGoalObject({ factSourceRoot: root });
		assert.equal(hasLegacySubGoalSection(after.value.body), false);
	});
});

test("legacy 子目标 section: editable content is refused — no drift through the goal carrier (25 §7)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await writeLegacyGoal(root);
		const cur = await readGoalObject({ factSourceRoot: root });
		const r = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: cur.value.fingerprint,
			frontmatterAfter: { ...cur.value.frontmatter },
			bodyMarkdownAfter: legacyBody("SG-1 第一条判据\nSG-2 第二条判据\nSG-3 新加的"),
			changeSummary: "在 goal.md 里加一条子目标",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "goal/legacy_subgoal_immutable");
		assert.deepEqual(r.error.details.existing_anchors, ["SG-1", "SG-2"]);
		assert.deepEqual(r.error.details.attempted_anchors, ["SG-1", "SG-2", "SG-3"]);
	});
});

test("legacy 子目标 section: dropping it succeeds once every anchor migrated (25 §7 → 28)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await writeLegacyGoal(root);
		await seedSubGoals(root, ["SG-1", "SG-2"]);
		const cur = await readGoalObject({ factSourceRoot: root });
		const r = await updateGoalObject({
			factSourceRoot: root,
			expectedFingerprint: cur.value.fingerprint,
			frontmatterAfter: { ...cur.value.frontmatter },
			bodyMarkdownAfter: "## 目标陈述\n\n这是一个项目目标陈述，说明为什么与要实现什么。\n",
			changeSummary: "子目标已迁入 SubGoal 载体，删除旧段",
			sessionSignature: SIG,
		});
		assert.equal(r.ok, true, JSON.stringify(r.error));
		assert.equal(r.value.legacy_subgoal_section, false);
		const after = await readGoalObject({ factSourceRoot: root });
		assert.equal(hasLegacySubGoalSection(after.value.body), false);
		assert.equal(after.value.body_valid, true);
	});
});

test("create refuses a NEW carrier carrying the legacy 子目标 section (25 §7 2026-11)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		const r = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: legacyBody(),
			sessionSignature: SIG,
		});
		assert.equal(r.ok, false);
		assert.equal(r.error.code, "goal/legacy_subgoal_reintroduced");
	});
});

test("anchor stability: rewriting or reordering SG-n is refused; adding is allowed", async () => {
	const rewritten = validateAnchorStability(["SG-1", "SG-2"], ["SG-1", "SG-9"]);
	assert.equal(rewritten.ok, false);
	const reordered = validateAnchorStability(["SG-1", "SG-2"], ["SG-2", "SG-1"]);
	assert.equal(reordered.ok, false);
	assert.ok(reordered.issues.some((i) => /reordered/.test(i)));
	const added = validateAnchorStability(["SG-1", "SG-2"], ["SG-1", "SG-2", "SG-3"]);
	assert.equal(added.ok, true, JSON.stringify(added.issues));
});

test("readServableSubGoals resolves sub-goals from SubGoal carriers, not from goal.md (21 §12.3)", async () => {
	await withTemp("goal.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
		const empty = await readServableSubGoals({ factSourceRoot: root });
		assert.equal(empty.ok, true, JSON.stringify(empty.error));
		assert.deepEqual(empty.value.sub_goals, []);

		await seedSubGoals(root, ["SG-1", "SG-2"]);
		const listed = await readServableSubGoals({ factSourceRoot: root });
		assert.deepEqual(listed.value.sub_goals.map((g) => g.object_uid), [subGoalUid(1), subGoalUid(2)]);

		await seedSubGoals(root, ["SG-3"], { status: "retired", indexOffset: 10 });
		const retiredOnly = await readServableSubGoals({ factSourceRoot: root });
		assert.deepEqual(retiredOnly.value.sub_goals.map((g) => g.object_uid), [subGoalUid(1), subGoalUid(2)]);
	});
});


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
		const forged = await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: { provider: "forged", model: "x" },
		});
		assert.equal(forged.error.code, "signature_unavailable");
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

test("readServableSubGoals reports the real repo sub-goals (integration)", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const root = fileURLToPath(new URL("../../ldvh-base", import.meta.url));
	const r = await readServableSubGoals({ factSourceRoot: root });
	assert.equal(r.ok, true, JSON.stringify(r.error));
	assert.equal(r.value.status, "active");
	assert.equal(r.value.sub_goals.length, 4);
	assert.deepEqual(r.value.sub_goals.map((g) => g.order), [1, 2, 3, 4]);
});


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

		const absent = await handlers["goal-read-object"]({}, ctx);
		assert.equal(absent.outcome, "unavailable");
		assert.match(absent.gaps[0], /goal\/not_initialised/);

		const unsigned = await handlers["goal-write-object"]({
			action: "create",
			frontmatter_draft: { title: "T", change_summary: "init" },
			body_markdown: validBody(),
		}, ctx);
		assert.equal(unsigned.outcome, "unavailable");
		assert.ok(unsigned.gaps.some((g) => /signature_unavailable/.test(g)), JSON.stringify(unsigned.gaps));
		assert.ok(unsigned.gaps.some((g) => /REPORT TO HUMAN/.test(g)));

		const stillAbsent = await handlers["goal-read-object"]({}, ctx);
		assert.equal(stillAbsent.outcome, "unavailable");
	});
});

test("goal tools: goal-read-object derives sub-goals from SubGoal carriers, never crashing on them", async () => {
	const { makeExecute } = await import("../lib/goal-tools.js");
	const { initRepo, git } = await import("./helpers.mjs");
	await withTemp("goal-tools-subgoals.", async (base) => {
		const repo = await initRepo(base, { name: "repo" });
		await git(repo, ["commit", "-qm", "init"]);
		const factRoot = join(repo, "ldvh-base");
		await mkdir(factRoot, { recursive: true });
		await writeFile(join(factRoot, "goal.md"), [
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
		await seedSubGoals(factRoot, ["SG-1", "SG-2"]);

		const home = join(base, "home");
		await mkdir(join(home, "ldvh"), { recursive: true });
		await writeFile(join(home, "ldvh", "governed-projects.yaml"), [
			"schema_version: 1", "governance_instance_name: T", "product_description: T",
			"projects:", "  - id: p", `    path: ${repo}`, "default_project_id: p", "",
		].join("\n"));
		const { handlers } = makeExecute({ dshHomePath: (...p) => join(home, ...p) });
		const ctx = { agent: { session: { header: { cwd: repo } } } };

		const read = await handlers["goal-read-object"]({}, ctx);
		assert.equal(read.outcome, "completed", JSON.stringify(read.gaps));
		assert.equal(read.result.sub_goals.length, 2, JSON.stringify(read.result.sub_goals));
		assert.equal(read.result.sub_goals_unresolved, false);
		for (const sg of read.result.sub_goals) {
			assert.equal(typeof sg.object_uid, "string");
			assert.equal(typeof sg.title, "string");
			assert.equal(typeof sg.order, "number");
			assert.equal("anchor" in sg, false);
		}
	});
});

test("goal tools: an invalid action is an invalid_request, not a write", async () => {
	const { makeExecute } = await import("../lib/goal-tools.js");
	const { handlers } = makeExecute({ dshHomePath: () => "/tmp/none" });
	const r = await handlers["goal-write-object"]({ action: "delete" }, {});
	assert.equal(r.outcome, "invalid_request");
});


test("REGRESSION: read→echo-back update is idempotent — the H1 is never doubled", async () => {
	await withTemp("goal-rt.", async (base) => {
		const root = await freshRoot(base);
		await createGoalObject({
			factSourceRoot: root,
			frontmatterDraft: { title: "T", change_summary: "init" },
			bodyMarkdown: validBody(),
			sessionSignature: SIG,
		});
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

test("REGRESSION: a malformed anchor cannot escape the legacy-section guard (25 §7)", async () => {
	await withTemp("goal-anchor.", async (base) => {
		const root = await freshRoot(base);
		await writeLegacyGoal(root);
		const cur = await readGoalObject({ factSourceRoot: root });
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
				["goal/legacy_subgoal_unparsable", "goal/legacy_subgoal_immutable"].includes(r.error.code),
				`${label}: unexpected code ${r.error.code}`
			);
		}
	});
});

test("parseSubGoals tolerates a list marker and reports anchor-shaped failures", () => {
	assert.equal(parseSubGoals("- SG-1 判据")[0].anchor, "SG-1");
	assert.equal(parseSubGoals("* SG-2 判据")[0].anchor, "SG-2");
	const zero = parseSubGoals("SG-0 判据")[0];
	assert.equal(zero.anchor, "SG-0");
	assert.equal(zero.malformed, true);
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

		await ch(file, 0o644);
		const resolveHome = (...p) => join(home, ...p);
		const wide = await evaluateRegistrationEntry(resolveHome);
		assert.equal(wide.ok, false);
		assert.equal(wide.error.code, "registration_permission_unverified");
		assert.match(wide.error.message, /file permission is wider than 0600/);

		await ch(file, 0o600);
		const ok = await evaluateRegistrationEntry(resolveHome);
		assert.equal(ok.ok, true, JSON.stringify(ok));
	});
});
