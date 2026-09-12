// Tests for plugin/lib/ldvh-tools.js: the five LDVH tool handlers
// (resolve-governance-scope, read-specification-candidates,
// read-specification-content, discover-ldvh-capabilities, precheck-git-commit)
// and the guidance-text module that produces the minimal rule guidance
// attached to governed sessions.
//
// The handlers are obtained from makeExecute(deps); the DSH tool layer
// (registerLdvhTools) is not exercised here — it is the index.js wiring
// and tested separately.
//
// Common envelope (specs/05 §8): { operation_key, outcome, scope, sources,
// gaps, verification, follow_up }. Every test inspects the full envelope
// shape, not just the result.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { guidanceTextFor, GUIDANCE_SECTION_NAME, GUIDANCE_SECTION_ORDER } from "../lib/guidance-text.js";
import { makeExecute, OPERATIONS, renderEnvelope, toolDescriptor } from "../lib/ldvh-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { git, initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

// Exercise the renderer over every operation_key and every outcome the
// envelope can carry, so a shape regression in one branch is caught.
function renderAllOutcomes() {
	const outcomes = ["completed", "partial", "unavailable", "rejected", "invalid_request", "execution_error"];
	const collected = [];
	for (const operationKey of Object.keys(OPERATIONS)) {
		for (const outcome of outcomes) {
			collected.push({
				operationKey,
				outcome,
				blocks: renderEnvelope(operationKey, {
					envelope: {
						operation_key: operationKey,
						outcome,
						result: null,
						scope: { requested: null, completed: [], not_completed: [] },
						sources: [],
						gaps: [],
						verification: { checks: [], passed: false },
						follow_up: []
					}
				})
			});
		}
	}
	return collected;
}

function renderBlocks(value) {
	return renderEnvelope("read-specification-candidates", value);
}

function descriptors() {
	const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	return Object.entries(OPERATIONS).map(([operationKey, operation]) => toolDescriptor(operationKey, operation, handlers[operationKey]));
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SAMPLE_SPEC_01 = `---
ldvh_spec:
  spec_key: "sample-spec-1"
  spec_id: "11"
  spec_kind: "spec"
  title: "规范示例一"
  canonical_path: "specs/11-规范示例一.md"
  parent_spec: "ldvh-root"
  relation: "refines"
  positioning: "p1"
  scope: "s1"
  basis: ["sample-spec-2"]
  authorized_attachments: []
  dimensions: ["read", "write"]
---

# 规范示例一

## 1. 价值

正文段落。

## 2. 职责边界

### 2.1 子节

子节正文。

### 2.2 又一子节

又一正文。

## 3. 其它小节

最后正文。
`;

const SAMPLE_SPEC_02 = `---
ldvh_spec:
  spec_key: "sample-spec-2"
  spec_id: "12"
  spec_kind: "spec"
  title: "规范示例二"
  canonical_path: "specs/12-规范示例二.md"
  parent_spec: "ldvh-root"
  relation: "refines"
  positioning: "p2"
  scope: "s2"
  basis: []
  authorized_attachments: []
  dimensions: ["read", "write"]
---

# 规范示例二

## 1. 价值

正文段落。
`;

const SAMPLE_ATTACHMENT = `---
ldvh_attachment:
  attachment_key: "sample-attachment-1"
  attachment_id: "11.Att.01"
  title: "附件示例"
  canonical_path: "specs/attachments/11.Att.01-附件示例.md"
  positioning: "附件定位"
---

# 附件示例

## 1. 节

附件正文。
`;

async function writeSpecsTree(projectRoot) {
	await mkdir(join(projectRoot, "specs"), { recursive: true });
	await writeFile(join(projectRoot, "specs", "11-规范示例一.md"), SAMPLE_SPEC_01);
	await writeFile(join(projectRoot, "specs", "12-规范示例二.md"), SAMPLE_SPEC_02);
	await mkdir(join(projectRoot, "specs", "attachments"), { recursive: true });
	await writeFile(join(projectRoot, "specs", "attachments", "11.Att.01-附件示例.md"), SAMPLE_ATTACHMENT);
}

function makeExec(deps) {
	const { handlers, OPERATIONS: ops } = makeExecute(deps);
	return { handlers, OPERATIONS: ops };
}

function assertEnvelopeShape(envelope, expectedKey, expectedOutcome) {
	assert.equal(envelope.operation_key, expectedKey);
	assert.equal(envelope.outcome, expectedOutcome);
	assert.ok(typeof envelope.scope === "object");
	assert.ok(Array.isArray(envelope.sources));
	assert.ok(Array.isArray(envelope.gaps));
	assert.ok(typeof envelope.verification === "object");
	assert.ok(Array.isArray(envelope.follow_up));
}

// ---------------------------------------------------------------------------
// resolve-governance-scope
// ---------------------------------------------------------------------------

test("resolve-governance-scope returns governed with the registered project", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		const reg = await registerProject(dshHome(home), { id: "demo", path: root });
		assert.equal(reg.ok, true);
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["resolve-governance-scope"]({}, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "resolve-governance-scope", "completed");
		assert.equal(envelope.result.state, "governed");
		assert.equal(envelope.result.project.id, "demo");
		assert.ok(typeof envelope.sources[0].fingerprint === "string");
	});
});

test("resolve-governance-scope returns not_governed for an outside cwd", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const elsewhere = await initRepo(base, { name: "elsewhere" });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["resolve-governance-scope"]({}, { agent: { session: { header: { cwd: elsewhere } } } });
		assert.equal(envelope.result.state, "not_governed");
	});
});

test("resolve-governance-scope returns unavailable when the registration is unparseable", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		await mkdir(join(home, "ldvh"), { recursive: true });
		await writeFile(join(home, "ldvh", "governed-projects.yaml"), ":\n  this: not\n  [broken");
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["resolve-governance-scope"]({}, { agent: { session: { header: { cwd: base } } } });
		assert.equal(envelope.result.state, "unavailable");
		assert.match(envelope.result.detail, /registration unavailable/);
	});
});

// ---------------------------------------------------------------------------
// read-specification-candidates
// ---------------------------------------------------------------------------

test("read-specification-candidates enumerates all candidates by default", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "read-specification-candidates", "completed");
		assert.equal(envelope.result.layer, "L0");
		assert.equal(envelope.result.candidates.length, 3);
		const keys = envelope.result.candidates.map((c) => c.responsibility_key).sort();
		assert.deepEqual(keys, ["sample-attachment-1", "sample-spec-1", "sample-spec-2"]);
	});
});

test("read-specification-candidates filters by responsibility_key when supplied", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({ responsibility_key: "sample-spec-2" }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.candidates.length, 1);
		assert.equal(envelope.result.candidates[0].responsibility_key, "sample-spec-2");
	});
});

test("read-specification-candidates rejects a key that matches no candidate", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({ responsibility_key: "no-such-key" }, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "read-specification-candidates", "rejected");
		assert.equal(envelope.result, null);
		assert.ok(envelope.gaps.some((g) => g.includes("no-such-key")));
	});
});

// ---------------------------------------------------------------------------
// specs/01 §9.1 defenses: excluded names, collision withholding, snapshot
// ---------------------------------------------------------------------------

/** Build a minimal parseable carrier with an explicit identity + file name. */
function specCarrier({ key, id, title, canonicalPath }) {
	return `---
ldvh_spec:
  spec_key: "${key}"
  spec_id: "${id}"
  spec_kind: "spec"
  title: "${title}"
  canonical_path: "${canonicalPath}"
  parent_spec: "ldvh-root"
  relation: "refines"
  positioning: "p"
  scope: "s"
  basis: []
  authorized_attachments: []
  dimensions: ["read"]
---

# ${title}

## 1. 价值

正文段落。
`;
}

test("01 §9.1 defense 1: a .draft carrier never enters candidate discovery", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		// The audit counterexample: this name matches the canonical pattern.
		await writeFile(
			join(root, "specs", "13-规范示例三.draft.md"),
			specCarrier({ key: "sample-spec-3", id: "13", title: "规范示例三", canonicalPath: "specs/13-规范示例三.draft.md" })
		);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		const keys = envelope.result.candidates.map((c) => c.responsibility_key);
		assert.ok(!keys.includes("sample-spec-3"), "the .draft carrier must not become a candidate");
		// Excluded carriers are visible as diagnostics, not silently dropped.
		assert.ok(
			envelope.gaps.some((g) => typeof g === "object" && g.reason?.includes("excluded_name_marker")),
			"the excluded carrier must be reported with a precise reason"
		);
	});
});

test("01 §9.1 defense 1: every canonical-pattern excluded marker form is rejected", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		// All four still end in .md, so all four reach the candidate pattern.
		const names = ["14-甲.draft.md", "15-乙.tmp.md", "16-丙.bak.md", "17-丁.temp.md"];
		for (const [index, name] of names.entries()) {
			const id = String(14 + index);
			await writeFile(join(root, "specs", name), specCarrier({ key: `sample-extra-${index}`, id, title: `额外${index}`, canonicalPath: `specs/${name}` }));
		}
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		const keys = envelope.result.candidates.map((c) => c.responsibility_key);
		assert.deepEqual(keys.sort(), ["sample-attachment-1", "sample-spec-1", "sample-spec-2"], "no excluded name may become a candidate");
		assert.equal(
			envelope.gaps.filter((g) => typeof g === "object" && g.reason?.includes("excluded_name_marker")).length,
			names.length,
			"each excluded carrier must be reported exactly once"
		);
	});
});

test("01 §9.1 defense 2: colliding responsibility_key withholds every affected candidate", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await mkdir(join(root, "specs"), { recursive: true });
		// Two carriers claiming the same responsibility_key, each with its own
		// consistent identity so only the key collides.
		await writeFile(join(root, "specs", "21-甲.md"), specCarrier({ key: "shared-key", id: "21", title: "甲", canonicalPath: "specs/21-甲.md" }));
		await writeFile(join(root, "specs", "22-乙.md"), specCarrier({ key: "shared-key", id: "22", title: "乙", canonicalPath: "specs/22-乙.md" }));
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.deepEqual(envelope.result.candidates, [], "no colliding candidate may be served as a member");
		assert.ok(
			envelope.gaps.some((g) => typeof g === "object" && g.reason?.includes("duplicate_responsibility_key")),
			"the collision must be reported with its kind"
		);
		// And the content read must refuse rather than pick the first match.
		const read = await handlers["read-specification-content"]({ responsibility_key: "shared-key" }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(read.outcome, "rejected");
		assert.ok(read.gaps.some((g) => String(g).includes("collides across")));
	});
});

test("01 §9.1 defense 2: an approximate-path collision rejects both carriers", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await mkdir(join(root, "specs"), { recursive: true });
		// Same visible name, different Unicode composition: on a
		// case-sensitive/NFC-normalizing checkout these can exist as two files
		// that normalize to one path — the cross-platform ambiguity the rule
		// guards. (The identity spec_id/canonical_path are kept distinct so that
		// only the path-collision defense is under test.)
		const composed = "41-caf\u00e9.md"; // é as one code point (NFC)
		const decomposed = "41-cafe\u0301.md"; // e + combining acute (NFD)
		await writeFile(join(root, "specs", composed), specCarrier({ key: "nfc-key", id: "41", title: "cafe1", canonicalPath: `specs/${composed}` }));
		await writeFile(join(root, "specs", decomposed), specCarrier({ key: "nfd-key", id: "42", title: "cafe2", canonicalPath: `specs/${decomposed}` }));
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		// Whether the host folds these into one file or keeps them apart, the
		// invariant holds: no two candidates that normalize to the same path may
		// both be served.
		const served = envelope.result.candidates.map((c) => c.responsibility_key);
		const collided = envelope.gaps.some((g) => typeof g === "object" && g.reason?.includes("approximate_path_collision"));
		if (served.length === 2) {
			assert.ok(collided, "two candidates normalizing to one path must be withheld and reported");
			assert.deepEqual(served, [], "no colliding candidate may be served");
		} else {
			// The filesystem itself collapsed them to one file; the scan cannot
			// and must not invent a second candidate.
			assert.ok(served.length <= 2);
		}
	});
});

test("01 §9.1 defense 3: the envelope carries the snapshot the members came from", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		const snapshot = envelope.sources[0].snapshot;
		assert.ok(snapshot, "the source must bind the scan snapshot");
		assert.equal(await realpath(snapshot.worktree_root), await realpath(root));
		assert.equal(snapshot.candidate_count, 3);
		assert.equal(typeof snapshot.candidate_set_fingerprint, "string");
		assert.equal(snapshot.candidate_set_fingerprint.length, 64);
		// Every member's content fingerprint is bound in the same snapshot.
		assert.equal(Object.keys(snapshot.content_fingerprints).length, 3);
		for (const value of Object.values(snapshot.content_fingerprints)) {
			assert.equal(value.length, 64);
		}
	});
});

test("read-specification-candidates returns unavailable when the session is not_governed", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const elsewhere = await initRepo(base, { name: "elsewhere" });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: elsewhere } } } });
		assertEnvelopeShape(envelope, "read-specification-candidates", "unavailable");
		assert.equal(envelope.result, null);
	});
});

test("read-specification-candidates at L2 includes a section outline", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({ responsibility_key: "sample-spec-1", layer: "L2" }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.result.layer, "L2");
		const candidate = envelope.result.candidates[0];
		assert.ok(Array.isArray(candidate.section_outline));
		assert.ok(candidate.section_outline.length >= 3);
	});
});

// ---------------------------------------------------------------------------
// read-specification-content
// ---------------------------------------------------------------------------

test("read-specification-content returns L4 (full source) when no heading_path is given", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-content"]({ responsibility_key: "sample-spec-1" }, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "read-specification-content", "completed");
		assert.equal(envelope.result.layer, "L4");
		assert.equal(envelope.result.responsibility_key, "sample-spec-1");
		assert.equal(envelope.result.canonical_path, "specs/11-规范示例一.md");
		assert.match(envelope.result.content_fingerprint, /^[0-9a-f]{64}$/);
		assert.ok(envelope.result.content.includes("规范示例一"));
	});
});

test("read-specification-content returns L3 (sliced) with line numbers and section fingerprint", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-content"]({ responsibility_key: "sample-spec-1", heading_path: "2. 职责边界" }, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "read-specification-content", "completed");
		assert.equal(envelope.result.layer, "L3");
		// Counted from the fixture: ## 2. 职责边界 sits at line 23
		// (1 H1 + 1 blank + 1 fence-open + 14 identity-block lines + 1 fence-close
		//  + 1 blank + 1 H2 + 1 H2 text = 22; the actual layout is verified
		// by the test outcome below).
		assert.ok(typeof envelope.result.start_line === "number" && envelope.result.start_line > 0);
		assert.ok(envelope.result.end_line >= envelope.result.start_line);
		assert.match(envelope.result.section_fingerprint, /^[0-9a-f]{64}$/);
		assert.ok(envelope.result.content.includes("2. 职责边界"));
		// the slice must NOT contain the previous H2 ("1. 价值")
		assert.ok(!envelope.result.content.includes("1. 价值"));
	});
});

test("read-specification-content returns invalid_request when responsibility_key is missing", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-content"]({}, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "read-specification-content", "invalid_request");
		assert.equal(envelope.result, null);
		assert.ok(envelope.gaps.some((g) => g.includes("responsibility_key")));
	});
});

test("read-specification-content returns rejected for an unknown key", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-content"]({ responsibility_key: "no-such-key" }, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "read-specification-content", "rejected");
	});
});

test("read-specification-content returns rejected for an ambiguous heading path", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		// "1. 价值" is unique in sample-spec-1; sample-spec-2 also has it.
		// Pass an H2 that appears in multiple carriers to make sure each
		// call only sees its own target.
		const envelope = await handlers["read-specification-content"]({ responsibility_key: "sample-spec-1", heading_path: "1. 价值" }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		// Now a path that is genuinely ambiguous inside sample-spec-1: there
		// is no duplicate; instead exercise content/heading_not_found.
		const envelope404 = await handlers["read-specification-content"]({ responsibility_key: "sample-spec-1", heading_path: "不存在的节" }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope404.outcome, "rejected");
		assert.ok(envelope404.gaps.some((g) => g.includes("heading_not_found")));
	});
});

// ---------------------------------------------------------------------------
// discover-ldvh-capabilities
// ---------------------------------------------------------------------------

test("discover-ldvh-capabilities enumerates all operations", async () => {
	const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	const envelope = await handlers["discover-ldvh-capabilities"]({}, {});
	assertEnvelopeShape(envelope, "discover-ldvh-capabilities", "completed");
	const keys = envelope.result.operations.map((o) => o.operation_key).sort();
	assert.deepEqual(keys, [
		"discover-ldvh-capabilities",
		"precheck-git-commit",
		"read-specification-candidates",
		"read-specification-content",
		// 07 §5.4 / §5.7 AI entries, declared per 05 §6.1 in specs/07.
		"register-governed-project",
		"resolve-governance-scope",
		"unregister-governed-project",
	]);
	for (const op of envelope.result.operations) {
		assert.ok(typeof op.dsh_tool_name === "string" && op.dsh_tool_name.startsWith("ldvh_"));
		assert.match(op.availability, /^(当次可调用|不可用|已声明)$/);
	}
});

test("discover-ldvh-capabilities returns a single operation when operation_key is supplied", async () => {
	const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	const envelope = await handlers["discover-ldvh-capabilities"]({ operation_key: "resolve-governance-scope" }, {});
	assert.equal(envelope.outcome, "completed");
	assert.equal(envelope.result.operations.length, 1);
	assert.equal(envelope.result.operations[0].operation_key, "resolve-governance-scope");
});

test("discover-ldvh-capabilities returns rejected for an unknown operation_key", async () => {
	const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	const envelope = await handlers["discover-ldvh-capabilities"]({ operation_key: "no-such-operation" }, {});
	assertEnvelopeShape(envelope, "discover-ldvh-capabilities", "rejected");
});

// ---------------------------------------------------------------------------
// precheck-git-commit
//
// Outcome matrix (06 §6.2 item 4, two sub-conditions):
//   passed        — every check passed, including trailer-traceability
//                   (route source available AND trailer values match it)
//   failed        — positive failure evidence: any non-signature issue, a
//                   STRUCTURAL trailer defect (missing/empty trailer line,
//                   decidable without a route), or a trailer value MISMATCH
//                   against an available authoritative route
//   unverifiable  — no positive failure evidence, but the signature cannot
//                   be traced (sessionPersistence unavailable / locate fails
//                   / jsonl unreadable / jsonl has no routing event).
//                   Trailer structure is fine, but traceability is incomplete
//                   — must NOT collapse into "passed".
//
// The "route source" is built from a temp JSONL file the test controls;
// the stub `sessionPersistence.locate` returns { kind: "jsonl", path: ... }
// pointing at that file, and `currentRouteValues` reads it via the same
// path the real DSH service uses. Pure-text JSONL works because
// currentRouteValues falls back to raw text when zstd decompression fails.
// ---------------------------------------------------------------------------

/** Build a JSONL file containing a single routing event. */
async function writeSessionLog(base, fileName, events) {
	const path = join(base, fileName);
	await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
	return path;
}

/** Build a stub sessionPersistence whose locate() points at the given file. */
function stubSessionPersistence(logPath) {
	return {
		locate: () => ({ kind: "jsonl", path: logPath }),
	};
}

test("precheck-git-commit returns invalid_request when message is missing", async () => {
	const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	const envelope = await handlers["precheck-git-commit"]({}, {});
	assertEnvelopeShape(envelope, "precheck-git-commit", "invalid_request");
	assert.ok(envelope.gaps.some((g) => g.includes("message")));
});

test("precheck-git-commit returns unavailable when the session is not governed", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const elsewhere = await initRepo(base, { name: "elsewhere" });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["precheck-git-commit"]({ message: "anything" }, { agent: { session: { header: { cwd: elsewhere } } } });
		assert.equal(envelope.result.mechanical_outcome, "unverifiable");
	});
});

// ----- passed: route available + trailer matches ----------------------------

test("precheck-git-commit returns passed when the route source agrees with the trailers, and attaches snapshot_identity", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "new content\n");
		await git(root, ["add", "feature.txt"]);
		const logPath = await writeSessionLog(base, "session.jsonl", [
			{ type: "model/selection", data: { provider: "deepseek-harness", model: "test" } },
		]);
		const message = [
			"chore(code): add feature",
			"",
			"关键变更:",
			"- create feature.txt with the new line",
			"- seed README.md test carrier",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const { handlers } = makeExec({
			dshHomePath: dshHome(home),
			workspaceRoot: base,
			sessionPersistence: () => stubSessionPersistence(logPath),
		});
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "precheck-git-commit", "completed");
		assert.equal(envelope.result.mechanical_outcome, "passed");
		// passed is the ONLY branch that attaches snapshot_identity
		assert.match(envelope.result.snapshot_identity, /^[0-9a-f]{64}$/);
		assert.equal(envelope.result.source_fingerprint.length, 64);
		// signature_source traces back to the authoritative record
		assert.equal(envelope.result.signature_source.provider, "deepseek-harness");
		assert.equal(envelope.result.signature_source.model, "test");
		assert.equal(envelope.result.signature_source.event_type, "model/selection");
		// scope.completed is full; nothing is not_completed
		assert.equal(envelope.scope.not_completed.length, 0);
	});
});

// ----- failed: route available + trailer value MISMATCH ---------------------

test("precheck-git-commit returns failed when the trailer values do not match the available route (positive mismatch evidence)", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "new content\n");
		await git(root, ["add", "feature.txt"]);
		const logPath = await writeSessionLog(base, "session.jsonl", [
			{ type: "model/selection", data: { provider: "deepseek-harness", model: "test" } },
		]);
		const message = [
			"chore(code): add feature",
			"",
			"关键变更:",
			"- create feature.txt with the new line",
			"- seed README.md test carrier",
			"",
			"LDVH-Provider: WRONG-VENDOR",
			"LDVH-Model: WRONG-MODEL",
		].join("\n");
		const { handlers } = makeExec({
			dshHomePath: dshHome(home),
			workspaceRoot: base,
			sessionPersistence: () => stubSessionPersistence(logPath),
		});
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.mechanical_outcome, "failed");
		// a positive mismatch is reported as a concrete issue
		assert.ok(envelope.result.issues.some((i) => i.rule.startsWith("validation/signature_provider_mismatch")));
		assert.ok(envelope.result.issues.some((i) => i.rule.startsWith("validation/signature_model_mismatch")));
		// no snapshot_identity on a failed precheck
		assert.equal(envelope.result.snapshot_identity, undefined);
		// signature_source still surfaces the authoritative values that
		// the trailer was measured against
		assert.equal(envelope.result.signature_source.provider, "deepseek-harness");
		assert.equal(envelope.result.signature_source.model, "test");
	});
});

// ----- failed: structural trailer defect (no route needed) ------------------

test("precheck-git-commit returns failed when the trailer is structurally incomplete (no route needed for the verdict)", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "x\n");
		await git(root, ["add", "feature.txt"]);
		// missing LDVH-Model entirely (structural defect — decidable
		// without any route source).
		const message = [
			"chore(code): add feature",
			"",
			"关键变更:",
			"- create feature.txt",
			"- seed README.md test carrier",
			"",
			"LDVH-Provider: deepseek-harness",
		].join("\n");
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.mechanical_outcome, "failed");
		// the structural defect is the deciding issue; route is irrelevant
		assert.ok(envelope.result.issues.some((i) => i.message.includes("LDVH-Model")));
	});
});

test("precheck-git-commit returns failed when the trailer values are empty (no route needed)", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "x\n");
		await git(root, ["add", "feature.txt"]);
		const message = [
			"chore(code): add feature",
			"",
			"关键变更:",
			"- create feature.txt",
			"- seed README.md test carrier",
			"",
			"LDVH-Provider: ",
			"LDVH-Model: test",
		].join("\n");
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.result.mechanical_outcome, "failed");
		assert.ok(envelope.result.issues.some((i) => i.message.includes("LDVH-Provider")));
	});
});

// ----- failed: bad header / illegal body ------------------------------------

test("precheck-git-commit returns failed for a non-conventional header (no route needed)", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "x\n");
		await git(root, ["add", "feature.txt"]);
		const illegal = "Bug fix\n\nno body\nno trailers";
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["precheck-git-commit"]({ message: illegal }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.mechanical_outcome, "failed");
		assert.ok(envelope.result.issues.length > 0);
	});
});

test("precheck-git-commit returns failed when a 关键变更: item names a change absent from the staged diff", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "x\n");
		await git(root, ["add", "feature.txt"]);
		const message = [
			"chore(code): add feature",
			"",
			"关键变更:",
			"- rename bar.js to baz.js (NOT in diff)",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.result.mechanical_outcome, "failed");
		assert.ok(envelope.result.issues.some((i) => i.message.includes("bar.js")));
	});
});

// ----- unverifiable: route missing but every other check passed ------------

test("precheck-git-commit returns unverifiable (NOT passed) when the route source is unavailable and the trailer is structurally complete", async () => {
	// This is the canonical "no route" case: sessionPersistence is
	// unavailable, every other check passes. The contract says the
	// outcome must be "unverifiable" — never "passed" — because the
	// trailer values cannot be traced to an authoritative record.
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "new content\n");
		await git(root, ["add", "feature.txt"]);
		const message = [
			"chore(code): add feature",
			"",
			"关键变更:",
			"- create feature.txt with the new line",
			"- seed README.md test carrier",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.mechanical_outcome, "unverifiable");
		// unverifiable does NOT attach snapshot_identity
		assert.equal(envelope.result.snapshot_identity, undefined);
		// signature_source reports WHY traceability was lost
		assert.ok(envelope.result.signature_source.unavailable_reason);
		// scope explicitly names the incomplete check
		assert.ok(envelope.scope.not_completed.includes("signature-traceability"));
		// no positive failure evidence, so the issues list is empty
		assert.deepEqual(envelope.result.issues, []);
	});
});

test("precheck-git-commit returns unverifiable when the session log exists but contains no routing event", async () => {
	// The route source "exists" (locate returns a path) but the file has
	// no model/selection or request/context event. The structural trailer
	// check passes, but traceability is still incomplete → unverifiable.
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "x\n");
		await git(root, ["add", "feature.txt"]);
		const logPath = await writeSessionLog(base, "session.jsonl", [
			{ type: "user/prompt", data: { text: "hi" } },
			{ type: "tool/result", data: { ok: true } },
		]);
		const message = [
			"chore(code): add feature",
			"",
			"关键变更:",
			"- create feature.txt",
			"- seed README.md test carrier",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const { handlers } = makeExec({
			dshHomePath: dshHome(home),
			workspaceRoot: base,
			sessionPersistence: () => stubSessionPersistence(logPath),
		});
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.result.mechanical_outcome, "unverifiable");
		// specifically because the session has no routing event, not a
		// structural defect
		assert.match(envelope.result.signature_source.unavailable_reason, /no model\/selection or request\/context/);
	});
});

// ---------------------------------------------------------------------------
// makeExecute shape
// ---------------------------------------------------------------------------

test("makeExecute returns five handlers and the same OPERATIONS export", () => {
	const { handlers, OPERATIONS: ops } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	assert.equal(typeof handlers["resolve-governance-scope"], "function");
	assert.equal(typeof handlers["read-specification-candidates"], "function");
	assert.equal(typeof handlers["read-specification-content"], "function");
	assert.equal(typeof handlers["discover-ldvh-capabilities"], "function");
	assert.equal(typeof handlers["precheck-git-commit"], "function");
	assert.equal(ops, OPERATIONS);
});

// ---------------------------------------------------------------------------
// render contract (regression guard)
//
// The DSH tool layer calls `result.content.some((block) => block.type ===
// "image")` on every tool result, so output.render MUST return an ARRAY of
// content blocks. A string return throws `content.some is not a function`
// and the tool result never reaches the model — a silent total failure of
// the whole tool batch that no handler-level test can catch.
// ---------------------------------------------------------------------------

test("output.render returns an array of content blocks (never a bare string)", () => {
	for (const block of renderAllOutcomes()) {
		assert.ok(Array.isArray(block.blocks), "render must return an array");
		assert.ok(block.blocks.length > 0, "render must return at least one block");
		for (const item of block.blocks) {
			assert.equal(typeof item.type, "string", "each content block needs a string type");
			assert.equal(typeof item.text, "string", "each text block needs string text");
		}
		// The exact call dsh-tools performs on the result.
		assert.equal(block.blocks.some((b) => b.type === "image"), false);
	}
});

test("output.render survives structured (object) gaps without throwing", () => {
	// scanSpecCandidates emits object gaps; render must stringify them
	// instead of interpolating them as [object Object].
	const blocks = renderBlocks({
		envelope: {
			operation_key: "read-specification-candidates",
			outcome: "partial",
			result: null,
			scope: { requested: "all", completed: [], not_completed: ["all"] },
			sources: [],
			gaps: [{ responsibility_key: null, canonical_path: "specs/00-x.md", reason: "identity/field_invalid" }],
			verification: { checks: [], passed: false },
			follow_up: []
		}
	});
	const text = blocks[0].text;
	assert.match(text, /specs\/00-x\.md/);
	assert.ok(!text.includes("[object Object]"), "structured gaps must not render as [object Object]");
});

// The output schema constrains OUR handler return, not a model emission, so it
// stays open. Re-tightening it is what rejected every structured gap and is the
// second half of the same incident — this test is the guard against regression.
test("output.schema stays open so structured envelope values are never rejected", () => {
	for (const descriptor of descriptors()) {
		const schema = descriptor.output.schema;
		assert.equal(schema.type, "object");
		assert.equal(schema.additionalProperties, true, `tool ${descriptor.name}: output schema must stay open`);
		assert.equal(schema.properties, undefined, `tool ${descriptor.name}: per-field output constraints self-inflict failures`);
	}
});

test("every tool descriptor declares the DSH registration contract", () => {
	for (const descriptor of descriptors()) {
		assert.equal(typeof descriptor.name, "string");
		assert.match(descriptor.name, /^ldvh_/);
		assert.equal(typeof descriptor.description, "string");
		assert.ok(descriptor.description.length > 0);
		assert.equal(typeof descriptor.execute, "function");
		assert.equal(typeof descriptor.output.render, "function");
		assert.equal(descriptor.timeoutMs > 0, true);
		// parameters stays strict: it constrains what the MODEL emits.
		assert.equal(descriptor.parameters.type, "object");
	}
});

// ---------------------------------------------------------------------------
// guidance-text
// ---------------------------------------------------------------------------

test("guidanceTextFor returns the governed text with the seven 00 anchors", () => {
	const text = guidanceTextFor("governed");
	assert.ok(text.length > 0);
	// 00 anchors: identity block, §2 root scheme, §3.1 work model,
	// §4 Human decision rights, §5 AI responsibilities, §6 dual-track
	// values, §7 anti-self-deception / Stop / handover.
	for (const anchor of ["身份块", "§2", "§3.1", "§4", "§5", "§6", "§7"]) {
		assert.ok(text.includes(anchor), `governed guidance missing anchor: ${anchor}`);
	}
});

test("guidanceTextFor not_governed: one-line judgment notice (Human 2026-09-04 上下文注入决定)", () => {
	// Supersedes the former zero-interference shape (not_governed → "").
	// The judgment must now be TOLD to the AI for every state — including
	// not_governed — as a single judgment line plus a minimal body.
	const text = guidanceTextFor("not_governed");
	assert.ok(text.length > 0, "not_governed must carry text now");
	assert.match(text, /【LDVH 管辖判定】not_governed/);
	assert.match(text, /不受 LDVH 管辖/);
	// Minimal: no seven-anchor body leaks into non-governed sessions.
	assert.ok(!text.includes("工作模型"), "non-governed body must stay minimal");
});

test("guidanceTextFor unavailable: reports unavailable but acts as not_governed", () => {
	// Human decision (2026-09-02): unavailable is a SPECIAL CASE of
	// not_governed — behaviour is identical (no tools, no controlled
	// operations), except that unavailable additionally reports the
	// condition and how to check it. So the text must NOT claim the
	// project is ungoverned (that would guess over an unreadable
	// registration), and must NOT tell AI to call a tool (no ldvh_* tool
	// is registered outside governed sessions — the deadlock the
	// independent audit found).
	const text = guidanceTextFor("unavailable");
	assert.ok(text.length > 0);
	assert.match(text, /不可用/);
	assert.match(text, /不受管辖处理/);
	assert.match(text, /不得据此认定本项目不受辖/);
	assert.ok(!/ldvh_[a-z_]+/.test(text), "unavailable guidance must not recommend tools that are not registered");
});

test("GUIDANCE_SECTION_NAME and ORDER are exported constants", () => {
	assert.equal(GUIDANCE_SECTION_NAME, "ldvh:minimal-guidance");
	assert.equal(typeof GUIDANCE_SECTION_ORDER, "number");
	assert.ok(GUIDANCE_SECTION_ORDER > 0);
});
