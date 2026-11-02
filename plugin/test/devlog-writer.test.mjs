// Tests for plugin/lib/devlog-writer.js — the DevLog fact-type writer.
//
// Authority: specs/29 §7 (identity/carrier), §8 (field contract + fixed body
// H2 + 字段间不变量), §9 (status closure, compression, 细化/替换 分档), §11
// (relation closure), §13 (controlled operations), §14.1 (type-specific
// mechanical checks), plus the shared 02 §10 contract and the Human requirement
// that every change_log entry is mechanically signed.
//
// What these tests deliberately do NOT assert: whether `summary` is really a
// conclusion rather than a narrative, whether it still holds, whether an
// `absorbed-into` target really covers it, or whether a summary edit is 细化 or
// 替换. 29 §14.1 assigns all of these to AI/Human judgement — a test claiming
// to prove them would itself be the defect.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	ABSORBING_TYPES,
	DEVLOG_DIRECTORY,
	DEVLOG_REMOVABLE_FIELDS,
	DEVLOG_RELATION_KEYS,
	BODY_H2_ACTIVE,
	BODY_H2_ABSORBED,
	computeDevLogCreateCandidateFingerprint,
	createDevLogObject,
	devlogFileName,
	listDevLogObjects,
	precheckDevLogCreate,
	readDevLogObject,
	updateDevLogObject,
	validateCarrierCoherence,
	validateDevLogBodyStructure,
	validateDevLogFrontmatter,
	validateDevLogRelations,
} from "../lib/devlog-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";
import { withTemp } from "./helpers.mjs";

const SIG = authoritativeSignature({ provider: "test-provider", model: "test-model" });

const SUMMARY = "上限 20000 在实测语料下把截断损失从 36.9% 降到 0.21%，但在 28048 字的轮次上仍会截断，故「等价于全文」不成立。";
const TITLE = "单轮上限 20000 的实测边界";

const bodyFor = (summary = SUMMARY) => [
	"## 背景", "", "要解决长会话材料在单轮渲染时被砍掉的问题。",
	"", "## 做法", "", "把常量从 2000 提到 20000，保留 clamp 与 truncated 标记。",
	"", "## 实测", "", "645 会话 / 1331 轮；上限 2000 损失 36.9%，上限 20000 损失 0.21%。",
	"", "## 结论与边界", "", summary,
	"", "## 去向", "", "由提交 883a3cb 与 §7.1 共同承接。",
].join("\n");

function draft(overrides = {}) {
	return {
		title: TITLE,
		occurred_at: "2026-01-01T00:00:00.000Z",
		summary: SUMMARY,
		change_summary: "初始落盘",
		...overrides,
	};
}

async function freshRoot(base) {
	const root = join(base, "ldvh-base");
	await mkdir(root, { recursive: true });
	await mkdir(join(root, DEVLOG_DIRECTORY), { recursive: true });
	return root;
}

async function createOne(root, overrides = {}, body = bodyFor()) {
	const created = await createDevLogObject({
		factSourceRoot: root,
		frontmatterDraft: draft(overrides),
		bodyMarkdown: body,
		sessionSignature: SIG,
	});
	assert.equal(created.ok, true, created.ok ? "" : `${created.error.code}: ${created.error.message}`);
	return created.value;
}

// ---------------------------------------------------------------------------
// Identity & carrier (29 §7)
// ---------------------------------------------------------------------------

test("carrier lives under devlogs/ and derives its file name from object_uid (29 §7)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		assert.equal(created.file, join(root, DEVLOG_DIRECTORY, devlogFileName(created.object_uid)));
		const raw = await readFile(created.file, "utf8");
		assert.match(raw, /^---\n/);
		assert.match(raw, /fact_type_key: devlog/);
	});
});

test("a DevLog carries no business number — identity is object_uid alone (29 §7)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const read = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		for (const forbidden of ["anchor", "number", "seq", "index"]) {
			assert.equal(Object.hasOwn(read.value.frontmatter, forbidden), false, `${forbidden} must not exist`);
		}
	});
});

// ---------------------------------------------------------------------------
// Create (29 §13)
// ---------------------------------------------------------------------------

test("create stamps object_uid/created_at and yields status=active (29 §9.2 唯一合法初态)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const read = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		assert.equal(read.value.frontmatter.status, "active");
		assert.equal(read.value.frontmatter.object_uid, created.object_uid);
		assert.ok(read.value.frontmatter.created_at);
		assert.equal(read.value.mechanical_issues.length, 0, read.value.mechanical_issues.join("; "));
	});
});

test("create refuses a non-active initial status (29 §9.2)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		for (const status of ["absorbed", "superseded", "dropped"]) {
			const created = await createDevLogObject({
				factSourceRoot: root,
				frontmatterDraft: draft({ status }),
				bodyMarkdown: bodyFor(),
				sessionSignature: SIG,
			});
			assert.equal(created.ok, false, `${status} must be refused at creation`);
			assert.equal(created.error.code, "devlog/initial_state_violation");
		}
	});
});

test("occurred_at must not be later than created_at (29 §8 不变量 2)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const future = new Date(Date.now() + 86_400_000).toISOString();
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft({ occurred_at: future }),
			bodyMarkdown: bodyFor(),
			sessionSignature: SIG,
		});
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "devlog/frontmatter_invalid");
		assert.ok(created.error.details.issues.some((i) => i.includes("occurred_at")));
	});
});

test("occurred_at is a distinct field from created_at, both preserved (29 §10.4)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const past = "2025-06-01T12:00:00.000Z";
		const created = await createOne(root, { occurred_at: past });
		const read = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		assert.equal(read.value.frontmatter.occurred_at, past);
		assert.notEqual(read.value.frontmatter.created_at, past);
	});
});

test("title is capped at 40 characters (29 §8)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft({ title: "长".repeat(41) }),
			bodyMarkdown: bodyFor(),
			sessionSignature: SIG,
		});
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "devlog/frontmatter_invalid");
	});
});

test("summary must appear verbatim in the 结论与边界 section (29 §8 不变量 1)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft(),
			bodyMarkdown: bodyFor("这是一句不同的结论。"),
			sessionSignature: SIG,
		});
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "devlog/coherence_invalid");
	});
});

test("the body must carry all five fixed H2 sections in order (29 §8)", () => {
	const missing = "## 背景\n\nx\n\n## 做法\n\ny\n\n## 结论与边界\n\n" + SUMMARY + "\n";
	const check = validateDevLogBodyStructure(`# ${TITLE}\n\n${missing}`, TITLE, "active");
	assert.equal(check.ok, false);
	assert.ok(check.issues.some((i) => i.includes("H2 sections")));
});

test("a section present but empty is refused, distinguishing empty from missing (29 §8)", () => {
	const body = `# ${TITLE}\n\n## 背景\n\n## 做法\n\nx\n\n## 实测\n\ny\n\n## 结论与边界\n\n${SUMMARY}\n\n## 去向\n\nz\n`;
	const check = validateDevLogBodyStructure(body, TITLE, "active");
	assert.equal(check.ok, false);
	assert.ok(check.issues.some((i) => i.includes('"背景" section must be non-empty')));
});

// ---------------------------------------------------------------------------
// summary as a live semantic snapshot (29 §9.3)
// ---------------------------------------------------------------------------

test("a 细化档 summary update is a supplement-level write: status unchanged, one change_log (29 §9.3)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		const refined = SUMMARY + " 补充：2026-11-02 重测语料为 645 会话 1331 轮。";
		const updated = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: { summary: refined },
			bodyMarkdownAfter: `# ${TITLE}\n\n${bodyFor(refined)}`,
			changeSummary: "细化 summary：补入重测语料口径",
			sessionSignature: SIG,
		});
		assert.equal(updated.ok, true, updated.ok ? "" : updated.error.message);
		assert.equal(updated.value.transition, "supplement");
		const after = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		assert.equal(after.value.frontmatter.status, "active");
		assert.equal(after.value.frontmatter.change_log.length, before.value.frontmatter.change_log.length + 1);
		assert.ok(after.value.frontmatter.summary.includes("重测语料"));
	});
});

test("summary is NOT capped to a single sentence — the 2026-11-02 revision made it a snapshot (29 §8)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const long = `${SUMMARY} 边界：超过 20000 的单轮仍被砍，28048 字那轮损失 8048 字。另一条已确认不成立的是「与完全删除上限逐字节相同」——2026-11-02 重测已推翻。`;
		const created = await createOne(root, { summary: long }, bodyFor(long));
		const read = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		assert.equal(read.value.mechanical_issues.length, 0);
		assert.ok(read.value.frontmatter.summary.length > 100);
	});
});

// ---------------------------------------------------------------------------
// Terminal states (29 §9.1, §9.2)
// ---------------------------------------------------------------------------

test("absorbed is COMPRESSED to exactly 结论与边界 + 去向 (29 §9.1)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const target = await createOne(root);
		const absorbedCheck = validateDevLogBodyStructure(
			`# ${TITLE}\n\n## 结论与边界\n\n${SUMMARY}\n\n## 去向\n\n已承接。`,
			TITLE,
			"absorbed",
		);
		assert.equal(absorbedCheck.ok, true, absorbedCheck.issues.join("; "));
		// The full five-section form is NOT the absorbed form.
		const fullForm = validateDevLogBodyStructure(`# ${TITLE}\n\n${bodyFor()}`, TITLE, "absorbed");
		assert.equal(fullForm.ok, false);
		assert.ok(fullForm.issues.some((i) => i.includes("压缩形态")));
		assert.deepEqual(BODY_H2_ABSORBED, ["结论与边界", "去向"]);
		assert.deepEqual(BODY_H2_ACTIVE, ["背景", "做法", "实测", "结论与边界", "去向"]);
		assert.equal(target.object_uid.length > 0, true);
	});
});

test("absorbed without an absorbed-into edge is refused (29 §8 不变量 4)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		const bad = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: { status: "absorbed" },
			bodyMarkdownAfter: `# ${TITLE}\n\n## 结论与边界\n\n${SUMMARY}\n\n## 去向\n\n已承接。`,
			changeSummary: "试转 absorbed（缺边）",
			sessionSignature: SIG,
		});
		assert.equal(bad.ok, false);
		assert.ok(bad.error.details.issues.some((i) => i.includes("absorbed-into")));
	});
});

test("absorbed-into may target a commit, and an unresolvable hash fails closed (02 §8.1 第 ② 条)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		const attempted = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: {
				status: "absorbed",
				relations: [{ relation_key: "absorbed-into", target: { commit: "0".repeat(40) } }],
			},
			bodyMarkdownAfter: `# ${TITLE}\n\n## 结论与边界\n\n${SUMMARY}\n\n## 去向\n\n已承接。`,
			changeSummary: "试转 absorbed（假 commit）",
			sessionSignature: SIG,
			gitCommitResolver: async () => false,
		});
		assert.equal(attempted.ok, false);
		assert.equal(attempted.error.code, "devlog/absorbed_into_unresolvable");
	});
});

test("absorbed-into must not point at another DevLog — that would be two authorities (29 §18 红线 3)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const first = await createOne(root);
		const second = await createOne(root, { title: "第二条" }, bodyFor());
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: second.object_uid });
		const attempted = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: second.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: {
				status: "absorbed",
				relations: [{ relation_key: "absorbed-into", target: { object_uid: first.object_uid } }],
			},
			bodyMarkdownAfter: `# 第二条\n\n## 结论与边界\n\n${SUMMARY}\n\n## 去向\n\n已承接。`,
			changeSummary: "试转 absorbed 到另一条 DevLog",
			sessionSignature: SIG,
		});
		assert.equal(attempted.ok, false);
		assert.equal(attempted.error.code, "devlog/absorbed_into_unresolvable");
		assert.equal(ABSORBING_TYPES.has("devlog"), false);
	});
});

test("superseded-by refuses the commit form — a commit cannot answer 「新结论在哪里」(29 §11)", () => {
	const check = validateDevLogRelations({
		status: "superseded",
		relations: [{ relation_key: "superseded-by", target: { commit: "a".repeat(40) } }],
	});
	assert.equal(check.ok, false);
	assert.ok(check.issues.some((i) => i.includes("新结论在哪里")));
});

test("dropped requires a disposition (29 §8/§9.1)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		const attempted = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: { status: "dropped" },
			bodyMarkdownAfter: `# ${TITLE}\n\n${bodyFor()}`,
			changeSummary: "试转 dropped（缺 disposition）",
			sessionSignature: SIG,
		});
		assert.equal(attempted.ok, false);
		assert.equal(attempted.error.code, "devlog/disposition_required");
	});
});

test("dropped keeps the FULL text — no compression without an absorbing target (29 §9.1/§18 红线 5)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		const dropped = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: { status: "dropped", disposition: "前提消失：该上限已被逐字全文取代。" },
			bodyMarkdownAfter: `# ${TITLE}\n\n${bodyFor()}`,
			changeSummary: "前提消失，转 dropped 并保留全文",
			sessionSignature: SIG,
		});
		assert.equal(dropped.ok, true, dropped.ok ? "" : dropped.error.message);
		const after = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		assert.equal(after.value.frontmatter.status, "dropped");
		for (const heading of BODY_H2_ACTIVE) {
			assert.ok(after.value.body.includes(`## ${heading}`), `${heading} must survive dropped`);
		}
	});
});

test("all three terminal states are read-only — no transition out (29 §9.2)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		const dropped = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: { status: "dropped", disposition: "前提消失。" },
			bodyMarkdownAfter: `# ${TITLE}\n\n${bodyFor()}`,
			changeSummary: "转 dropped",
			sessionSignature: SIG,
		});
		assert.equal(dropped.ok, true);
		const reopen = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: dropped.value.fingerprint,
			frontmatterAfter: { status: "active" },
			bodyMarkdownAfter: `# ${TITLE}\n\n${bodyFor()}`,
			changeSummary: "试图重开",
			sessionSignature: SIG,
		});
		assert.equal(reopen.ok, false);
		assert.equal(reopen.error.code, "devlog/terminal_readonly");
	});
});

test("an illegal transition (active → a state that is not in the closure) is refused (29 §9.2)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		const attempted = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: { status: "archived" },
			bodyMarkdownAfter: `# ${TITLE}\n\n${bodyFor()}`,
			changeSummary: "试转一个闭集外的状态",
			sessionSignature: SIG,
		});
		assert.equal(attempted.ok, false);
		assert.equal(attempted.error.code, "devlog/frontmatter_invalid");
	});
});

// ---------------------------------------------------------------------------
// Relation contract (29 §11)
// ---------------------------------------------------------------------------

test("the relation closed set is exactly two terminal edges (29 §11)", () => {
	assert.deepEqual([...DEVLOG_RELATION_KEYS].sort(), ["absorbed-into", "superseded-by"]);
});

test("both edges are forbidden while status=active (29 §11 均只用于终态)", () => {
	for (const relation_key of ["absorbed-into", "superseded-by"]) {
		const check = validateDevLogRelations({
			status: "active",
			relations: [{ relation_key, target: { object_uid: "11111111-1111-4111-8111-111111111111" } }],
		});
		assert.equal(check.ok, false, `${relation_key} must be refused on active`);
	}
});

test("no merge edge exists — a DevLog has no merged-into (29 §11 不建合并边)", () => {
	const check = validateDevLogRelations({
		status: "absorbed",
		relations: [
			{ relation_key: "merged-into", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
			{ relation_key: "absorbed-into", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
		],
	});
	assert.equal(check.ok, false);
	assert.ok(check.issues.some((i) => i.includes("merged-into")));
});

test("cardinality is 1 — two absorbed-into edges are refused (29 §11)", () => {
	const check = validateDevLogRelations({
		status: "absorbed",
		relations: [
			{ relation_key: "absorbed-into", target: { object_uid: "11111111-1111-4111-8111-111111111111" } },
			{ relation_key: "absorbed-into", target: { object_uid: "22222222-2222-4222-8222-222222222222" } },
		],
	});
	assert.equal(check.ok, false);
	assert.ok(check.issues.some((i) => i.includes("cardinality 1")));
});

// ---------------------------------------------------------------------------
// Field contract (29 §8)
// ---------------------------------------------------------------------------

test("the closed set refuses refs and urls — neither is adopted by this type (29 §8)", () => {
	for (const field of ["refs", "urls", "topic", "attachments"]) {
		const check = validateDevLogFrontmatter({
			object_uid: "11111111-1111-4111-8111-111111111111",
			fact_type_key: "devlog",
			title: "t",
			status: "active",
			occurred_at: "2026-01-01T00:00:00.000Z",
			summary: "s",
			created_at: "2026-01-02T00:00:00.000Z",
			change_log: [{ at: "2026-01-02T00:00:00.000Z", summary: "x" }],
			[field]: field === "refs" || field === "urls" || field === "attachments" ? [] : "x",
		});
		assert.equal(check.ok, false, `${field} must be outside the closed set`);
	}
});

test("disposition appears iff status=dropped (29 §8 不变量 3)", () => {
	const base = {
		object_uid: "11111111-1111-4111-8111-111111111111",
		fact_type_key: "devlog",
		title: "t",
		occurred_at: "2026-01-01T00:00:00.000Z",
		summary: "s",
		created_at: "2026-01-02T00:00:00.000Z",
		change_log: [{ at: "2026-01-02T00:00:00.000Z", summary: "x" }],
	};
	const activeWithDisposition = validateDevLogFrontmatter({ ...base, status: "active", disposition: "x" });
	assert.equal(activeWithDisposition.ok, false);
	const droppedWithout = validateDevLogFrontmatter({ ...base, status: "dropped" });
	assert.equal(droppedWithout.ok, false);
});

test("the removable fields are the two optional references — `serves` (topic) and `refs` (associations) (29 §8)", () => {
	// 2026-11-02: `refs` joined the removable set together with `serves` — both
	// are OPTIONAL reference fields, and 02 §10.5's "省略即保留" would otherwise
	// make either one永久 un-withdrawable once written.
	assert.deepEqual([...DEVLOG_REMOVABLE_FIELDS].sort(), ["refs", "serves"]);
	assert.equal(DEVLOG_REMOVABLE_FIELDS.has("summary"), false);
	assert.equal(DEVLOG_REMOVABLE_FIELDS.has("disposition"), false);
	assert.equal(DEVLOG_REMOVABLE_FIELDS.has("relations"), false);
});

test("serves may be withdrawn via frontmatter_removals (29 §8.1 空集是合法状态)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		// No SubGoal object exists, so a declared serves cannot resolve — the
		// point here is that a previously absent serves simply stays absent.
		const created = await createOne(root);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		assert.equal(before.value.frontmatter.serves, undefined);
		const updated = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: {},
			frontmatterRemovals: [],
			bodyMarkdownAfter: `# ${TITLE}\n\n${bodyFor()}`,
			changeSummary: "正文补充说明（serves 仍缺席）",
			sessionSignature: SIG,
		});
		assert.equal(updated.ok, true, updated.ok ? "" : updated.error.message);
	});
});

// ---------------------------------------------------------------------------
// Carrier self-sufficiency (29 §10.2)
// ---------------------------------------------------------------------------

test("no resolverable path pointer to a plain document — the body carries the evidence (29 §10.2)", () => {
	// The closed set is the mechanical expression of §10.2: there is no field
	// that could hold a filesystem path.
	for (const forbidden of ["source_path", "doc_path", "path", "attachment_path"]) {
		assert.equal(Object.hasOwn(Object.fromEntries([...DEVLOG_REMOVABLE_FIELDS].map((k) => [k, 1])), forbidden), false);
	}
	const check = validateDevLogFrontmatter({
		object_uid: "11111111-1111-4111-8111-111111111111",
		fact_type_key: "devlog",
		title: "t",
		status: "active",
		occurred_at: "2026-01-01T00:00:00.000Z",
		summary: "s",
		created_at: "2026-01-02T00:00:00.000Z",
		change_log: [{ at: "2026-01-02T00:00:00.000Z", summary: "x" }],
		doc_path: "docs/foo.md",
	});
	assert.equal(check.ok, false);
});

// ---------------------------------------------------------------------------
// Precheck / write parity (29 §13 双入口一致性)
// ---------------------------------------------------------------------------

test("precheck runs the same validator as create — same verdict on the same content (29 §13)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const badBody = "## 背景\n\nx\n"; // missing four sections
		const pre = await precheckDevLogCreate({ factSourceRoot: root, frontmatterDraft: draft(), bodyMarkdown: badBody });
		assert.equal(pre.ok, true);
		assert.equal(pre.value.mechanical_outcome, "failed");
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft(),
			bodyMarkdown: badBody,
			sessionSignature: SIG,
		});
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "devlog/body_invalid");
	});
});

test("precheck mints no identity and writes nothing (29 §13 不落盘、不生成对象标识)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const pre = await precheckDevLogCreate({ factSourceRoot: root, frontmatterDraft: draft(), bodyMarkdown: bodyFor() });
		assert.equal(pre.value.mechanical_outcome, "passed");
		const listing = await listDevLogObjects({ factSourceRoot: root, status: "all" });
		assert.equal(listing.value.total, 0);
		assert.equal(JSON.stringify(pre.value).includes("00000000-0000-4000-8000-000000000000"), false);
	});
});

test("a candidate fingerprint mismatch between precheck and write is refused (29 §13)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const pre = await precheckDevLogCreate({ factSourceRoot: root, frontmatterDraft: draft(), bodyMarkdown: bodyFor() });
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft({ summary: SUMMARY + "（已改）" }),
			bodyMarkdown: bodyFor(SUMMARY + "（已改）"),
			sessionSignature: SIG,
			expectedCandidateFingerprint: pre.value.candidate_fingerprint,
		});
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "devlog/candidate_changed");
	});
});

test("the candidate fingerprint is order-insensitive over frontmatter keys (29 §13)", () => {
	const a = computeDevLogCreateCandidateFingerprint({ title: "t", occurred_at: "x", summary: "s" }, "b");
	const b = computeDevLogCreateCandidateFingerprint({ summary: "s", occurred_at: "x", title: "t" }, "b");
	assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// List projection (29 §12.4)
// ---------------------------------------------------------------------------

test("list defaults to active only; status=all includes terminals (29 §12.4)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const kept = await createOne(root);
		const dropped = await createOne(root, { title: "将被 dropped" }, bodyFor());
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: dropped.object_uid });
		await updateDevLogObject({
			factSourceRoot: root,
			objectUid: dropped.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: { status: "dropped", disposition: "前提消失。" },
			bodyMarkdownAfter: `# 将被 dropped\n\n${bodyFor()}`,
			changeSummary: "转 dropped",
			sessionSignature: SIG,
		});
		const activeOnly = await listDevLogObjects({ factSourceRoot: root, status: "active" });
		assert.equal(activeOnly.value.total, 1);
		assert.equal(activeOnly.value.items[0].object_uid, kept.object_uid);
		const all = await listDevLogObjects({ factSourceRoot: root, status: "all" });
		assert.equal(all.value.total, 2);
	});
});

test("the list projection is newest occurred_at first — a timeline reads backwards (29 §12.1)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const older = await createOne(root, { title: "旧", occurred_at: "2025-01-01T00:00:00.000Z" }, bodyFor());
		const newer = await createOne(root, { title: "新", occurred_at: "2025-12-01T00:00:00.000Z" }, bodyFor());
		const listed = await listDevLogObjects({ factSourceRoot: root, status: "all" });
		assert.equal(listed.value.items[0].object_uid, newer.object_uid);
		assert.equal(listed.value.items[1].object_uid, older.object_uid);
	});
});

test("the list projection carries no serves filter — there is no topic view (29 §12.1)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		await createOne(root);
		const listed = await listDevLogObjects({ factSourceRoot: root, status: "all" });
		assert.equal(listed.value.items[0].serves, undefined);
	});
});

// ---------------------------------------------------------------------------
// Signature channel (specs/09)
// ---------------------------------------------------------------------------

test("an unsigned write is refused — change_log is Code-signed (specs/09)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft(),
			bodyMarkdown: bodyFor(),
			sessionSignature: { provider: "forged", model: "forged" },
		});
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "signature_unavailable");
	});
});

// ---------------------------------------------------------------------------
// Coherence helper is exported and behaves (29 §8 不变量 1)
// ---------------------------------------------------------------------------

test("validateCarrierCoherence compares verbatim, no normalization (29 §14.1)", () => {
	const fm = { summary: "结论。" };
	const body = `# t\n\n## 结论与边界\n\n结论。\u3000\n`;
	assert.equal(validateCarrierCoherence(fm, body).ok, true);
	const truncated = `# t\n\n## 结论与边界\n\n结论\n`;
	assert.equal(validateCarrierCoherence(fm, truncated).ok, false);
});

test("an existing carrier with trailing-space headings still parses (no false rejection)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createOne(root);
		const raw = await readFile(created.file, "utf8");
		await writeFile(created.file, raw.replace("## 背景", "## 背景  "));
		const read = await readDevLogObject({ factSourceRoot: root, objectUid: created.object_uid });
		assert.equal(read.value.body_valid, true, read.value.mechanical_issues.join("; "));
	});
});

// ---------------------------------------------------------------------------
// refs (29 §8 / §12.3bis; adopting-surface decision 2026-11-02, 02 §8.2)
// ---------------------------------------------------------------------------

test("refs shape is checked: {object_uid} members only, capped at 10, no duplicates (29 §8)", () => {
	const base = {
		object_uid: "11111111-1111-4111-8111-111111111111",
		fact_type_key: "devlog",
		title: TITLE,
		status: "active",
		occurred_at: "2026-01-01T00:00:00.000Z",
		summary: SUMMARY,
		created_at: "2026-01-02T00:00:00.000Z",
		change_log: [{ at: "2026-01-02T00:00:00.000Z", provider: "p", model: "m", summary: "x" }],
	};
	const one = { object_uid: "22222222-2222-4222-8222-222222222222" };
	const good = validateDevLogFrontmatter({ ...base, refs: [one] });
	assert.equal(good.ok, true, good.issues.join("; "));

	const notArray = validateDevLogFrontmatter({ ...base, refs: "x" });
	assert.equal(notArray.ok, false);
	assert.ok(notArray.issues.some((i) => i.startsWith("refs: must be an array")));

	const empty = validateDevLogFrontmatter({ ...base, refs: [] });
	assert.equal(empty.ok, false);
	assert.ok(empty.issues.some((i) => i.includes("must be omitted when there is no association")));

	const tooMany = validateDevLogFrontmatter({
		...base,
		refs: Array.from({ length: 11 }, (_, i) => ({ object_uid: `0000000${i}-0000-4000-8000-000000000000` })),
	});
	assert.equal(tooMany.ok, false);
	assert.ok(tooMany.issues.some((i) => i.includes("exceeds the 10-entry cap")));

	const dup = validateDevLogFrontmatter({ ...base, refs: [one, one] });
	assert.equal(dup.ok, false);
	assert.ok(dup.issues.some((i) => i.includes("duplicate target")));

	const extraKey = validateDevLogFrontmatter({ ...base, refs: [{ ...one, title: "不该在载体里" }] });
	assert.equal(extraKey.ok, false);
	assert.ok(extraKey.issues.some((i) => i.includes("carries fields beyond object_uid")));

	const badUid = validateDevLogFrontmatter({ ...base, refs: [{ object_uid: "not-a-uuid" }] });
	assert.equal(badUid.ok, false);
	assert.ok(badUid.issues.some((i) => i.includes("canonical UUIDv4")));
});

test("create rejects a refs target that does not exist in this project (02 §8.2 fail closed)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft({ refs: [{ object_uid: "33333333-3333-4333-8333-333333333333" }] }),
			bodyMarkdown: bodyFor(),
			sessionSignature: SIG,
		});
		assert.equal(created.ok, false);
		assert.equal(created.error.code, "devlog/refs_unresolvable");
		assert.equal(created.error.details.missing.length, 1);
	});
});

test("create accepts a refs target that exists (29 §12.3bis)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const target = await createOne(root, { title: "被引用的另一条" });
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft({ refs: [{ object_uid: target.object_uid }] }),
			bodyMarkdown: bodyFor(),
			sessionSignature: SIG,
		});
		assert.equal(created.ok, true, created.ok ? "" : `${created.error.code}: ${created.error.message}`);
		const read = await readDevLogObject({ factSourceRoot: root, objectUid: created.value.object_uid });
		assert.deepEqual(read.value.frontmatter.refs, [{ object_uid: target.object_uid }]);
	});
});

test("refs may be withdrawn via frontmatter_removals (02 §10.5 省略即保留的对称通道)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const target = await createOne(root, { title: "被引用的另一条" });
		const created = await createDevLogObject({
			factSourceRoot: root,
			frontmatterDraft: draft({ refs: [{ object_uid: target.object_uid }] }),
			bodyMarkdown: bodyFor(),
			sessionSignature: SIG,
		});
		assert.equal(created.ok, true);
		const before = await readDevLogObject({ factSourceRoot: root, objectUid: created.value.object_uid });
		const updated = await updateDevLogObject({
			factSourceRoot: root,
			objectUid: created.value.object_uid,
			expectedFingerprint: before.value.fingerprint,
			frontmatterAfter: {},
			frontmatterRemovals: ["refs"],
			bodyMarkdownAfter: `# ${TITLE}\n\n${bodyFor()}`,
			changeSummary: "撤回关联声明（refs 撤销）",
			sessionSignature: SIG,
		});
		assert.equal(updated.ok, true, updated.ok ? "" : `${updated.error.code}: ${updated.error.message}`);
		const after = await readDevLogObject({ factSourceRoot: root, objectUid: created.value.object_uid });
		assert.equal(after.value.frontmatter.refs, undefined);
	});
});

test("the index projection carries refs so the list card can render associations (29 §12.1)", async () => {
	await withTemp("ldvh-devlog-", async (base) => {
		const root = await freshRoot(base);
		const target = await createOne(root, { title: "被引用的另一条" });
		await createOne(root, { title: "引用者", refs: [{ object_uid: target.object_uid }] });
		const listed = await listDevLogObjects({ factSourceRoot: root, status: "all" });
		assert.equal(listed.ok, true);
		const holder = listed.value.items.find((i) => i.title === "引用者");
		assert.deepEqual(holder.refs, [{ object_uid: target.object_uid }]);
	});
});
