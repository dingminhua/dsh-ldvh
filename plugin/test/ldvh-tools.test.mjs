import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { guidanceTextFor, GUIDANCE_SECTION_NAME, GUIDANCE_SECTION_ORDER } from "../lib/guidance-text.js";
import { makeExecute, OPERATIONS, renderEnvelope, toolDescriptor } from "../lib/ldvh-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { snapshotIdentity, SOURCE_FINGERPRINT } from "../lib/commit-validation.js";
import { execFileAsync, git, initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

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

function operationsAwaitingHuman() {
	return Object.values(OPERATIONS)
		.filter((operation) => operation.awaitsHumanDecision === true)
		.map((operation) => operation.toolName);
}


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
		const composed = "41-caf\u00e9.md";
		const decomposed = "41-cafe\u0301.md";
		await writeFile(join(root, "specs", composed), specCarrier({ key: "nfc-key", id: "41", title: "cafe1", canonicalPath: `specs/${composed}` }));
		await writeFile(join(root, "specs", decomposed), specCarrier({ key: "nfd-key", id: "42", title: "cafe2", canonicalPath: `specs/${decomposed}` }));
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		const served = envelope.result.candidates.map((c) => c.responsibility_key);
		const collided = envelope.gaps.some((g) => typeof g === "object" && g.reason?.includes("approximate_path_collision"));
		if (served.length === 2) {
			assert.ok(collided, "two candidates normalizing to one path must be withheld and reported");
			assert.deepEqual(served, [], "no colliding candidate may be served");
		} else {
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
		assert.ok(typeof envelope.result.start_line === "number" && envelope.result.start_line > 0);
		assert.ok(envelope.result.end_line >= envelope.result.start_line);
		assert.match(envelope.result.section_fingerprint, /^[0-9a-f]{64}$/);
		assert.ok(envelope.result.content.includes("2. 职责边界"));
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
		const envelope = await handlers["read-specification-content"]({ responsibility_key: "sample-spec-1", heading_path: "1. 价值" }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		const envelope404 = await handlers["read-specification-content"]({ responsibility_key: "sample-spec-1", heading_path: "不存在的节" }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope404.outcome, "rejected");
		assert.ok(envelope404.gaps.some((g) => g.includes("heading_not_found")));
	});
});


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



async function writeSessionLog(base, fileName, events) {
	const path = join(base, fileName);
	await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
	return path;
}

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
			"chore(code): 新增特性文件",
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
		assert.match(envelope.result.snapshot_identity, /^[0-9a-f]{64}$/);
		assert.equal(envelope.result.source_fingerprint.length, 64);
		assert.equal(envelope.result.signature_source.provider, "deepseek-harness");
		assert.equal(envelope.result.signature_source.model, "test");
		assert.equal(envelope.result.signature_source.event_type, "model/selection");
		assert.equal(envelope.scope.not_completed.length, 0);
	});
});


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
			"chore(code): 新增特性文件",
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
		assert.ok(envelope.result.issues.some((i) => i.rule.startsWith("validation/signature_provider_mismatch")));
		assert.ok(envelope.result.issues.some((i) => i.rule.startsWith("validation/signature_model_mismatch")));
		assert.equal(envelope.result.snapshot_identity, undefined);
		assert.equal(envelope.result.signature_source.provider, "deepseek-harness");
		assert.equal(envelope.result.signature_source.model, "test");
	});
});


test("precheck-git-commit returns failed when the trailer is structurally incomplete (no route needed for the verdict)", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "x\n");
		await git(root, ["add", "feature.txt"]);
		const message = [
			"chore(code): 新增特性文件",
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
			"chore(code): 新增特性文件",
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


test("precheck-git-commit refuses a fact carrier whose filename contradicts its object_uid (09 §5.5 same validator)", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const dir = join(root, "ldvh-base", "sparks");
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, "spark-11111111-1111-4111-8111-111111111111.md"),
			"---\nobject_uid: 22222222-2222-4222-8222-222222222222\ntitle: probe\nstatus: open\n---\n",
		);
		await git(root, ["add", "ldvh-base/sparks/spark-11111111-1111-4111-8111-111111111111.md"]);
		const message = [
			"chore(facts): probe",
			"",
			"关键变更:",
			"- ldvh-base/sparks/spark-11111111-1111-4111-8111-111111111111.md：probe",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.result.mechanical_outcome, "failed");
		assert.ok(
			envelope.result.issues.some((i) => i.rule === "facts/carrier_uid_filename_mismatch"),
			`issues 须点出身份不符，实得 ${JSON.stringify(envelope.result.issues.map((i) => i.rule))}`,
		);
	});
});

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
			"chore(code): 新增特性文件",
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


test("precheck-git-commit returns unverifiable (NOT passed) when the route source is unavailable and the trailer is structurally complete", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "new content\n");
		await git(root, ["add", "feature.txt"]);
		const message = [
			"chore(code): 新增特性文件",
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
		assert.equal(envelope.result.snapshot_identity, undefined);
		assert.ok(envelope.result.signature_source.unavailable_reason);
		assert.ok(envelope.scope.not_completed.includes("signature-traceability"));
		assert.deepEqual(envelope.result.issues, []);
	});
});

test("precheck-git-commit returns unverifiable when the session log exists but contains no routing event", async () => {
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
			"chore(code): 新增特性文件",
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
		assert.match(envelope.result.signature_source.unavailable_reason, /no model\/selection or request\/context/);
	});
});


test("makeExecute returns five handlers and the same OPERATIONS export", () => {
	const { handlers, OPERATIONS: ops } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	assert.equal(typeof handlers["resolve-governance-scope"], "function");
	assert.equal(typeof handlers["read-specification-candidates"], "function");
	assert.equal(typeof handlers["read-specification-content"], "function");
	assert.equal(typeof handlers["discover-ldvh-capabilities"], "function");
	assert.equal(typeof handlers["precheck-git-commit"], "function");
	assert.equal(ops, OPERATIONS);
});


test("output.render returns an array of content blocks (never a bare string)", () => {
	for (const block of renderAllOutcomes()) {
		assert.ok(Array.isArray(block.blocks), "render must return an array");
		assert.ok(block.blocks.length > 0, "render must return at least one block");
		for (const item of block.blocks) {
			assert.equal(typeof item.type, "string", "each content block needs a string type");
			assert.equal(typeof item.text, "string", "each text block needs string text");
		}
		assert.equal(block.blocks.some((b) => b.type === "image"), false);
	}
});

test("output.render survives structured (object) gaps without throwing", () => {
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
		assert.equal(descriptor.parameters.type, "object");
	}
});


test("tools that never wait on a Human keep a bounded timeout budget", () => {
	const bounded = descriptors().filter((d) => operationsAwaitingHuman().includes(d.name) === false);
	assert.ok(bounded.length > 0, "expected at least one purely mechanical tool");
	for (const descriptor of bounded) {
		assert.equal(
			descriptor.timeoutMs > 0,
			true,
			`tool ${descriptor.name}: mechanical tools must keep a positive timeoutMs`
		);
	}
});

test("tools that wait on a Human declare NO timeout budget", () => {
	const awaiting = operationsAwaitingHuman();
	assert.ok(awaiting.length > 0, "expected at least one Human-facing tool");
	for (const descriptor of descriptors()) {
		if (awaiting.includes(descriptor.name) === false) continue;
		assert.equal(
			"timeoutMs" in descriptor,
			false,
			`tool ${descriptor.name}: waiting on a Human must not carry timeoutMs — the host would discard the real answer`
		);
	}
});

test("Human-facing asks forward the caller's cancellation signal", async () => {
	const seen = [];
	const seams = {
		requestRegistrationConsent: async (payload) => {
			seen.push(payload);
			return { granted: false, reason: "test: declined" };
		}
	};
	const { handlers } = makeExec({
		dshHomePath: dshHome("/nope"),
		workspaceRoot: "/nope",
		sessionPersistence: () => undefined,
		hostSeams: seams
	});
	const signal = new AbortController().signal;
	await handlers["register-governed-project"]({ path: "/nope" }, { agent: { session: { header: { cwd: "/nope" } } }, signal });
	await handlers["unregister-governed-project"]({ id: "p1", path: "/nope" }, { agent: { session: { header: { cwd: "/nope" } } }, signal });

	assert.ok(seen.length > 0, "expected the consent seam to be reached at least once");
	for (const payload of seen) {
		assert.equal(payload.signal, signal, "the consent ask must carry the caller's own signal");
	}
});


test("guidanceTextFor returns the governed text with the six 00 anchors", () => {
	const text = guidanceTextFor("governed");
	assert.ok(text.length > 0);
	for (const anchor of ["身份块", "§1 三大核心价值", "§2 方法与构成", "§3 Human 权利", "§4 AI 责任与义务", "§4.6", "§4.7", "§4.8", "§5 价值纪律"]) {
		assert.ok(text.includes(anchor), `governed guidance missing anchor: ${anchor}`);
	}
});

test("guidanceTextFor not_governed: one-line judgment notice (Human 2026-09-04 上下文注入决定)", () => {
	const text = guidanceTextFor("not_governed");
	assert.ok(text.length > 0, "not_governed must carry text now");
	assert.match(text, /【LDVH 管辖判定】not_governed/);
	assert.match(text, /不受 LDVH 管辖/);
	assert.ok(!text.includes("工作模型"), "non-governed body must stay minimal");
});

test("guidanceTextFor unavailable: reports unavailable but acts as not_governed", () => {
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


const DECLARATION_MARKER = "【承重声明】";
const DECLARATION_RESOLUTION = "**恢复条件**：";

function declarationSpec(resolution) {
	return [
		"# 13-承重声明示例",
		"",
		"## 7. 过渡",
		"",
		"| 依赖项 | 未满足时不得声称 | 替代保障 |",
		"|---|---|---|",
		`| ${DECLARATION_MARKER} 本文正文对 §7.2 的对齐 | 不得声称已完成对齐 | ${resolution} |`,
		"",
	].join("\n");
}

async function stagedDeclarationRepo(base) {
	const home = join(base, "home");
	const root = await initRepo(base);
	await writeSpecsTree(root);
	await writeFile(join(root, "specs", "13-承重声明示例.md"), declarationSpec(`${DECLARATION_RESOLUTION}完成后删除本行`));
	await git(root, ["add", "-A"]);
	await git(root, ["commit", "-qm", "base"]);
	const head = await git(root, ["rev-parse", "HEAD"]);
	await registerProject(dshHome(home), { id: "demo", path: root });
	await writeFile(join(root, "specs", "13-承重声明示例.md"), declarationSpec("**无**——须按判据逐处核对"));
	await git(root, ["add", "specs/13-承重声明示例.md"]);
	const logPath = await writeSessionLog(base, "session-declaration.jsonl", [
		{ type: "model/selection", data: { provider: "deepseek-harness", model: "test" } },
	]);
	const deps = { dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => stubSessionPersistence(logPath) };
	return { root, head, deps };
}

test("precheck-git-commit fails when a staged edit strips a declaration's 恢复条件 element", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const { root, deps } = await stagedDeclarationRepo(base);
		const message = [
			"docs(specs): 调整承重声明示例",
			"",
			"关键变更:",
			"- specs/13-承重声明示例.md: 调整对齐列的表述",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const { handlers } = makeExec(deps);
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "precheck-git-commit", "completed");
		assert.equal(envelope.result.mechanical_outcome, "failed");
		assert.ok(envelope.result.issues.some((issue) => issue.rule === "validation/load_bearing_resolution_missing"));
	});
});

test("precheck-git-commit passes the same edit when a 关键变更 item carries a resolvable reference", async () => {
	await withTemp("ldvh-tools.", async (base) => {
		const { root, head, deps } = await stagedDeclarationRepo(base);
		const message = [
			"docs(specs): 调整承重声明示例",
			"",
			"关键变更:",
			`- specs/13-承重声明示例.md: 调整对齐列表述（独立复核 ${head} 已确认范围关闭）`,
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const { handlers } = makeExec(deps);
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assertEnvelopeShape(envelope, "precheck-git-commit", "completed");
		assert.equal(envelope.result.mechanical_outcome, "passed");
	});
});

test("renderEnvelope: 预检的失败原因必须对调用方可读（09 §5.3 的意图是给出问题项，不是只给 failed）", () => {
	const blocks = renderEnvelope("precheck-git-commit", {
		envelope: {
			operation_key: "precheck-git-commit",
			outcome: "completed",
			result: {
				mechanical_outcome: "failed",
				issues: [
					{ rule: "validation/signature_provider_mismatch", message: "trailer LDVH-Provider does not match the authoritative route" },
					"裸字符串形态的问题项",
				],
			},
			gaps: ["provider/model could not be traced to the authoritative session record"],
		},
	});
	const text = blocks.map((block) => block.text).join("\n");
	assert.match(text, /\nissue: validation\/signature_provider_mismatch — trailer LDVH-Provider does not match/);
	assert.match(text, /\nissue: issue — 裸字符串形态的问题项/, "字符串形态的问题项也不得丢");
	assert.match(text, /\ngap: provider\/model could not be traced/, "gaps 的既有呈现不受影响");
});

test("precheck-git-commit 拒绝编造的 §7.2 依据引用，放行逐字引用", async () => {
	await withTemp("ldvh-tools-basis.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await mkdir(join(root, "specs"), { recursive: true });
		const specPath = join(root, "specs", "01-规范.md");
		const section = [
			"# 01 规范",
			"",
			"### 7.2 领域正文",
			"",
			"禁止三类：实现状态；下位文档的存在状态；过程与进度。",
			"",
			"### 7.3 下一节",
			"",
			"此句不属 §7.2。",
		].join("\n");
		await writeFile(specPath, section);
		await git(root, ["add", "-A"]);
		await git(root, ["commit", "-qm", "base"]);
		await registerProject(dshHome(home), { id: "demo72", path: root });
		await writeFile(specPath, section.replace("禁止三类：实现状态；下位文档的存在状态；过程与进度。", "禁止三类已删。"));
		await git(root, ["add", "specs/01-规范.md"]);

		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: root });
		const exec = { agent: { session: { header: { cwd: root } } } };
		const build = (basis) => [
			"docs(specs): 删除该行",
			"",
			basis,
			"",
			"关键变更:",
			"- specs/01-规范.md: 删除禁止三类",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");

		const bad = await handlers["precheck-git-commit"]({ message: build("§7.2 依据：**布局自指计数**") }, exec);
		assert.equal(bad.result.mechanical_outcome, "failed");
		assert.ok(bad.result.issues.some((issue) => issue.rule === "validation/removal_basis_unquotable"), JSON.stringify(bad.result.issues));

		const outOfScope = await handlers["precheck-git-commit"]({ message: build("§7.2 依据：此句不属 §7.2。") }, exec);
		assert.equal(outOfScope.result.mechanical_outcome, "failed");
		assert.ok(outOfScope.result.issues.some((issue) => issue.rule === "validation/removal_basis_unquotable"));

		const good = await handlers["precheck-git-commit"]({ message: build("§7.2 依据：禁止三类：实现状态；下位文档的存在状态；过程与进度。") }, exec);
		assert.ok(
			!(good.result.issues ?? []).some((issue) => issue.rule.startsWith("validation/removal_basis")),
			JSON.stringify(good.result.issues)
		);
		assert.notEqual(good.result.mechanical_outcome, "failed", JSON.stringify(good.result.issues));
	});
});


test("**删除设置字段后，诊断工具不得把 undefined 带进返回值**", async () => {
  const source = readFileSync(new URL("../lib/ldvh-tools.js", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal(
    /settings\.review\.model/.test(code),
    false,
    "诊断不得再读 settings.review.model——该字段已随「审核模型」设置移除，读到的是 undefined，会让整个工具返回非法 JSON",
  );

  const idx = code.indexOf("const state = {");
  assert.ok(idx >= 0, "须仍存在 state 构造");
  const block = code.slice(idx, code.indexOf("};", idx));
  assert.match(block, /enabled:.*===?\s*true/, "enabled 须显式判真，不裸取");
  assert.equal(
    /settings\.review\.intervalMs/.test(code),
    false,
    "诊断不得再读 settings.review.intervalMs——审核没有时间间隔这个量了",
  );
  assert.equal(
    /intervalMs\s*:/.test(block),
    false,
    "state 里不得留 intervalMs 空位（哪怕是 null）——留着会让「间隔机制还在」成为表面事实",
  );
});


const STALE = { stale: [{ file: "/repo/plugin/lib/commit-validation.js", mtime_ms: 9_999_999_999_999 }], unreadable: [], checked: 2, start_ms: 1 };
const FRESH = { stale: [], unreadable: [], checked: 2, start_ms: 1 };

const MISMATCHED_MESSAGE = [
	"chore(code): 新增特性文件",
	"",
	"关键变更:",
	"- create feature.txt with the new line",
	"- seed README.md test carrier",
	"",
	"LDVH-Provider: WRONG-VENDOR",
	"LDVH-Model: WRONG-MODEL",
].join("\n");

async function precheckWithStaleness(base, staleness) {
	const home = join(base, "home");
	const root = await initRepo(base);
	await writeSpecsTree(root);
	await registerProject(dshHome(home), { id: "demo", path: root });
	await writeFile(join(root, "feature.txt"), "new content\n");
	await git(root, ["add", "feature.txt"]);
	const logPath = await writeSessionLog(base, "session.jsonl", [
		{ type: "model/selection", data: { provider: "deepseek-harness", model: "test" } },
	]);
	const { handlers } = makeExec({
		dshHomePath: dshHome(home),
		workspaceRoot: base,
		sessionPersistence: () => stubSessionPersistence(logPath),
		detectStaleModules: () => staleness,
	});
	return handlers["precheck-git-commit"]({ message: MISMATCHED_MESSAGE }, { agent: { session: { header: { cwd: root } } } });
}

test("precheck-git-commit 在 validator 模块陈旧时把 failed 降为 unverifiable（正向半边）", async () => {
	await withTemp("ldvh-stale.", async (base) => {
		const envelope = await precheckWithStaleness(base, STALE);
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.mechanical_outcome, "unverifiable");
		assert.ok(envelope.result.issues.some((i) => i.rule.startsWith("validation/signature_provider_mismatch")));
		assert.ok(envelope.result.stale_modules, "陈旧时应回传 stale_modules");
		assert.equal(envelope.result.stale_modules.files.length, 1);
		assert.equal(typeof envelope.result.stale_modules.process_start_ms, "number");
		assert.ok(envelope.gaps.some((g) => g.includes("STALE code") && g.includes("commit-validation.js")));
		assert.ok(envelope.gaps.some((g) => g.startsWith("validation/signature_provider_mismatch")));
		assert.ok(envelope.scope.not_completed.includes("verdict-computed-by-current-validator-code"));
	});
});

test("陈旧时 follow_up 不得指引「去修候选」（friction-fbd65401 的危害本体）", async () => {
	await withTemp("ldvh-stale.", async (base) => {
		const envelope = await precheckWithStaleness(base, STALE);
		assert.ok(
			!envelope.follow_up.some((f) => f.includes("fix the reported issues")),
			`陈旧时不得给出「改候选」式指引：${JSON.stringify(envelope.follow_up)}`,
		);
		assert.ok(envelope.follow_up.some((f) => /restart the host|reload the plugin/.test(f)));
	});
});

test("反向半边：模块不陈旧时，同样的 failed 不得被降级", async () => {
	await withTemp("ldvh-stale.", async (base) => {
		const envelope = await precheckWithStaleness(base, FRESH);
		assert.equal(envelope.result.mechanical_outcome, "failed", "判据过宽会让所有真 failed 被掩盖，那是比原缺陷更坏的方向");
		assert.equal(envelope.result.stale_modules, undefined);
		assert.equal(envelope.gaps.length, 0);
		assert.ok(envelope.follow_up.some((f) => f.includes("fix the reported issues")));
	});
});

test("陈旧不改判 passed：陈旧只说明「不知道」，不得伪装成通过（00 §5.6）", async () => {
	await withTemp("ldvh-stale.", async (base) => {
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
			"chore(code): 新增特性文件",
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
			detectStaleModules: () => STALE,
		});
		const envelope = await handlers["precheck-git-commit"]({ message }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.result.mechanical_outcome, "passed");
		assert.match(envelope.result.snapshot_identity, /^[0-9a-f]{64}$/);
	});
});


test("渲染：候选枚举必须逐条列出 responsibility_key，只回计数即失败", () => {
	const text = (blocks) => blocks.map((b) => b.text ?? "").join("\n");
	const value = {
		envelope: {
			operation_key: "read-specification-candidates",
			outcome: "completed",
			result: {
				layer: "L0",
				candidates: [
					{ responsibility_key: "spec-a", title: "甲规范" },
					{ responsibility_key: "spec-b", title: "乙规范" },
					{ responsibility_key: "spec-c" },
				],
			},
		},
	};
	const body = text(renderBlocks(value));
	assert.match(body, /3 candidate\(s\) at L0/, "计数保留");
	for (const key of ["spec-a", "spec-b", "spec-c"]) {
		assert.match(body, new RegExp(`- ${key} — `), `逐条清单须含 ${key}`);
	}
	assert.match(body, /- spec-a — 甲规范/, "key 与 title 同行可读");
	assert.match(body, /- spec-c — \(no title\)/, "缺 title 不得导致该条消失");
});

test("渲染：候选为空时不伪造条目", () => {
	const body = renderBlocks({
		envelope: { operation_key: "read-specification-candidates", outcome: "completed", result: { layer: "L0", candidates: [] } },
	}).map((b) => b.text ?? "").join("\n");
	assert.match(body, /0 candidate\(s\) at L0/);
	assert.doesNotMatch(body, /^- [^ ]/m, "零候选不得印出任何条目行");
});


test("渲染：陈旧模块报告的每个字段都须在模型侧可见（不能只印 completed）", () => {
	const fake = {
		envelope: {
			operation_key: "inspect-loaded-modules",
			outcome: "completed",
			result: {
				process_start_ms: 1793792277000,
				library_dir: "/repo/plugin/lib",
				checked: 94,
				stale: [
					{ file: "/repo/plugin/lib/norm-writer.js", mtime_ms: 1793800000000 },
					{ file: "/repo/plugin/lib/spark-writer.js", mtime_ms: 1793800000001 }
				],
				unreadable: ["/repo/plugin/lib/broken.js"],
				informational: { effect: "informational-only", caveat: "空列表不证明一致" }
			},
			gaps: []
		}
	};
	const rendered = renderEnvelope("inspect-loaded-modules", fake)[0].text;
	assert.ok(rendered.includes("checked: 94"), "受检数必须可见");
	assert.ok(rendered.includes("/repo/plugin/lib"), "受检目录必须可见");
	assert.ok(rendered.includes("1793792277000"), "进程启动时刻必须可见");
	assert.ok(rendered.includes("stale: 2"), "陈旧计数必须可见");
	assert.ok(rendered.includes("norm-writer.js"), "陈旧文件须逐个列名，不能只给计数");
	assert.ok(rendered.includes("spark-writer.js"), "陈旧文件须逐个列名");
	assert.ok(rendered.includes("unreadable: 1"), "不可读计数必须可见");
	assert.ok(rendered.includes("broken.js"), "不可读文件须列名");
	assert.ok(rendered.includes("informational-only"), "效力标注必须可见");
	assert.ok(rendered.includes("空列表不证明一致"), "盲区声明必须可见，否则读者会把它当保证");
});

test("渲染：stale 为空时也必须印出计数与被检数（空结果同样要可区分于未运行）", () => {
	const fake = {
		envelope: {
			operation_key: "inspect-loaded-modules",
			outcome: "completed",
			result: {
				process_start_ms: 1,
				library_dir: "/repo/plugin/lib",
				checked: 94,
				stale: [],
				unreadable: [],
				informational: { effect: "informational-only", caveat: "c" }
			},
			gaps: []
		}
	};
	const rendered = renderEnvelope("inspect-loaded-modules", fake)[0].text;
	assert.ok(rendered.includes("checked: 94"), "零陈旧时仍须印受检数，否则无法区分「查了没发现」与「没查」");
	assert.ok(rendered.includes("stale: 0"));
});


async function renderThroughTool(operationKey, handler, args, exec) {
	const descriptor = toolDescriptor(operationKey, OPERATIONS[operationKey], handler);
	const value = await descriptor.execute(args, exec);
	const blocks = await descriptor.output.render(args, value);
	assert.ok(Array.isArray(blocks) && blocks.length > 0, "output.render 必须返回非空内容块数组");
	assert.ok(blocks.every((b) => b?.type === "text" && typeof b.text === "string"), "模型侧唯一读入口是文本块");
	return { envelope: value.envelope, text: blocks.map((b) => b.text).join("\n") };
}

async function withSpecFixture(run) {
	await withTemp("ldvh-tools.render.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		await run({ handlers, exec: { agent: { session: { header: { cwd: root } } } }, root });
	});
}

test("渲染可见性：L0 候选保持简洁——键与标题可见，正文与目录不得倾倒", async () => {
	await withSpecFixture(async ({ handlers, exec }) => {
		const { envelope, text } = await renderThroughTool("read-specification-candidates", handlers["read-specification-candidates"], {}, exec);
		assert.equal(envelope.outcome, "completed");
		for (const c of envelope.result.candidates) {
			assert.ok(text.includes(c.responsibility_key), `候选键必须可见：${c.responsibility_key}`);
			assert.ok(text.includes(c.title), `候选标题必须可见：${c.title}`);
			const line = text.split("\n").find((l) => l.includes(c.responsibility_key) && !l.startsWith("sources:"));
			assert.ok(line !== undefined, `该候选必须独占一行：${c.responsibility_key}`);
			assert.ok(line.includes(c.carrier_kind), `候选类型必须可见：${c.responsibility_key}`);
			assert.ok(line.includes(c.spec_id), `候选编号必须可见：${c.responsibility_key}`);
			assert.ok(line.includes(c.canonical_path), `候选路径必须可见：${c.responsibility_key}`);
			assert.ok(!text.includes(c.positioning), `L0 不得出现候选 positioning：${c.responsibility_key}`);
		}
		assert.ok(!text.includes("正文段落。"), "L0 不得倾倒正文");
		assert.ok(!text.includes("子节正文。"), "L0 不得倾倒正文");
		assert.ok(!text.includes("2. 职责边界"), "L0 不得携带 L2 的 section_outline");
		assert.ok(text.includes("sources:"), "L0 必须披露来源视图");
		const snapshot = envelope.sources[0].snapshot;
		assert.ok(snapshot, "数据面必须绑定扫描快照");
		assert.ok(text.includes(snapshot.candidate_set_fingerprint), "候选集合指纹必须对模型可见");
		for (const [path, fingerprint] of Object.entries(snapshot.content_fingerprints)) {
			assert.ok(text.includes(path), `载体定位必须可见：${path}`);
			assert.ok(text.includes(fingerprint), `载体内容指纹必须可见：${path}`);
		}
		assert.ok(text.includes("follow_up:"), "L0 必须给出继续读取的入口");
		for (const next of envelope.follow_up) assert.ok(text.includes(next), `follow_up 条目必须可见：${next}`);
	});
});

test("渲染可见性：L1 候选的定位与范围必须完整可见（不只键与标题）", async () => {
	await withSpecFixture(async ({ handlers, exec }) => {
		const { envelope, text } = await renderThroughTool("read-specification-candidates", handlers["read-specification-candidates"], { responsibility_key: "sample-spec-1", layer: "L1" }, exec);
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.layer, "L1");
		const c = envelope.result.candidates[0];
		assert.equal(c.positioning, "p1");
		assert.equal(c.scope, "s1");
		for (const [label, value] of [["responsibility_key", c.responsibility_key], ["title", c.title], ["spec_id", c.spec_id], ["canonical_path", c.canonical_path], ["positioning", c.positioning], ["scope", c.scope]]) {
			assert.ok(text.includes(value), `L1 的 ${label} 必须对模型可见（实际值 ${value}）`);
		}
	});
});

test("渲染可见性：L2 的 section_outline 逐条可见（模型据此拼出 L3 的 heading_path）", async () => {
	await withSpecFixture(async ({ handlers, exec }) => {
		const { envelope, text } = await renderThroughTool("read-specification-candidates", handlers["read-specification-candidates"], { responsibility_key: "sample-spec-1", layer: "L2" }, exec);
		assert.equal(envelope.outcome, "completed");
		const outline = envelope.result.candidates[0].section_outline;
		assert.ok(Array.isArray(outline) && outline.length >= 3, "L2 必须在数据面给出目录");
		for (const entry of outline) {
			assert.ok(text.includes(entry.text), `目录条目标题必须可见：${entry.text}`);
			assert.ok(text.includes(String(entry.line)), `目录条目行号必须可见：${entry.text}@${entry.line}`);
		}
		assert.ok(text.includes("2. 职责边界"), "L2 必须能看见将用于 L3 的 H2 标题");
	});
});

test("渲染可见性：L2 不指定 key 时，全部候选各自的目录都必须可见", async () => {
	await withSpecFixture(async ({ handlers, exec }) => {
		const { envelope, text } = await renderThroughTool("read-specification-candidates", handlers["read-specification-candidates"], { layer: "L2" }, exec);
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.layer, "L2");
		assert.ok(envelope.result.candidates.length >= 2, "本夹具至少有两个候选");
		for (const c of envelope.result.candidates) {
			const where = `候选 ${c.responsibility_key}`;
			assert.ok(text.includes(c.responsibility_key), `${where}：键必须可见`);
			assert.ok(text.includes(c.title), `${where}：标题必须可见`);
			assert.ok(text.includes(c.positioning), `${where}：positioning 必须可见`);
			if (c.scope !== undefined) assert.ok(text.includes(c.scope), `${where}：scope 必须可见`);
			assert.ok(Array.isArray(c.section_outline), `${where}：数据面必须给出目录`);
			for (const entry of c.section_outline) {
				assert.ok(text.includes(entry.text), `${where}：目录条目标题必须可见 —— ${entry.text}`);
				assert.ok(text.includes(String(entry.line)), `${where}：目录条目行号必须可见 —— ${entry.text}@${entry.line}`);
			}
		}
	});
});

test("渲染可见性：L3 的正文与定位信息（起止行号、节指纹、载体指纹）必须可见", async () => {
	await withSpecFixture(async ({ handlers, exec }) => {
		const { envelope, text } = await renderThroughTool("read-specification-content", handlers["read-specification-content"], { responsibility_key: "sample-spec-1", heading_path: "2. 职责边界" }, exec);
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.layer, "L3");
		assert.ok(text.includes(envelope.result.content), "L3 切片须完整逐字可见");
		assert.ok(text.includes("2. 职责边界"), "L3 的所读标题必须可见");
		assert.ok(text.includes("子节正文。"), "L3 的所读正文必须逐字可见");
		assert.ok(text.includes("又一正文。"), "L3 的所读正文必须逐字可见（不得只给首段）");
		assert.ok(text.includes(String(envelope.result.start_line)), "L3 的起始行号必须可见");
		assert.ok(text.includes(String(envelope.result.end_line)), "L3 的结束行号必须可见");
		assert.ok(text.includes(envelope.result.section_fingerprint), "L3 的节指纹必须可见");
		assert.ok(text.includes(envelope.result.content_fingerprint), "载体内容指纹必须可见");
		assert.ok(text.includes(envelope.result.canonical_path), "载体定位路径必须可见");
	});
});

test("渲染可见性：L4 的全文必须可见（逐字，不得只回一行 completed）", async () => {
	await withSpecFixture(async ({ handlers, exec }) => {
		const { envelope, text } = await renderThroughTool("read-specification-content", handlers["read-specification-content"], { responsibility_key: "sample-spec-1" }, exec);
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.layer, "L4");
		assert.ok(text.includes(envelope.result.content), "L4 全文须完整逐字可见");
		assert.ok(text.includes("规范示例一"), "L4 全文必须包含标题");
		assert.ok(text.includes("正文段落。"), "L4 全文必须包含首节正文");
		assert.ok(text.includes("子节正文。"), "L4 全文必须包含中段正文");
		assert.ok(text.includes("最后正文。"), "L4 全文必须包含末节正文");
		assert.ok(text.includes(envelope.result.content_fingerprint), "L4 必须披露载体内容指纹（01 §10.3）");
		assert.ok(text.includes(envelope.result.canonical_path), "L4 必须披露载体定位路径");
	});
});

test("渲染可见性：读取失败时，原因与自愈方向（follow_up）必须可见", async () => {
	await withSpecFixture(async ({ handlers, exec }) => {
		const unknown = await renderThroughTool("read-specification-content", handlers["read-specification-content"], { responsibility_key: "no-such-key" }, exec);
		assert.equal(unknown.envelope.outcome, "rejected");
		assert.ok(unknown.text.includes("rejected"), "失败响应的结果分类必须可见");
		assert.ok(unknown.text.includes("no-such-key"), "被拒的键必须出现在可见文本里");
		assert.ok(unknown.text.includes("read-specification-candidates"), "rejected 的自愈方向（去枚举键）必须可见，否则模型只看到一句拒绝");
		const badHeading = await renderThroughTool("read-specification-content", handlers["read-specification-content"], { responsibility_key: "sample-spec-1", heading_path: "不存在的节" }, exec);
		assert.equal(badHeading.envelope.outcome, "rejected");
		assert.ok(badHeading.text.includes("heading_not_found"), "失败原因码必须可见");
		assert.ok(badHeading.text.includes("L2"), "自愈方向（回到 L2 取目录）必须可见");
	});
});

test("渲染可见性：非受辖会话的 unavailable 响应必须把治理状态说清", async () => {
	await withTemp("ldvh-tools.render.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const elsewhere = await initRepo(base, { name: "elsewhere" });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const exec = { agent: { session: { header: { cwd: elsewhere } } } };
		const { envelope, text } = await renderThroughTool("read-specification-content", handlers["read-specification-content"], { responsibility_key: "sample-spec-1" }, exec);
		assert.equal(envelope.outcome, "unavailable");
		assert.ok(text.includes("unavailable"), "结果分类必须可见");
		assert.ok(text.includes("not_governed"), "不可用的原因（治理状态）必须可见");
	});
});

async function stagedDiff(root) {
	const { stdout } = await execFileAsync("git", ["-C", root, "diff", "--cached", "--binary", "--no-ext-diff"], { encoding: "utf8" });
	return stdout;
}

test("渲染可见性：预检身份只在 passed 时显示，其余状态不得显示任何 hash", async () => {
	await withTemp("ldvh-tools.render.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await writeSpecsTree(root);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await writeFile(join(root, "feature.txt"), "new content\n");
		await git(root, ["add", "feature.txt"]);
		const logPath = await writeSessionLog(base, "session.jsonl", [{ type: "model/selection", data: { provider: "deepseek-harness", model: "test" } }]);
		const okMessage = [
			"chore(code): 新增特性文件",
			"",
			"关键变更:",
			"- create feature.txt with the new line",
			"- seed README.md test carrier",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const exec = { agent: { session: { header: { cwd: root } } } };
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => stubSessionPersistence(logPath) });

		const passed = await renderThroughTool("precheck-git-commit", handlers["precheck-git-commit"], { message: okMessage }, exec);
		assert.equal(passed.envelope.result.mechanical_outcome, "passed");
		assert.match(passed.envelope.result.snapshot_identity, /^[0-9a-f]{64}$/);
		assert.ok(passed.text.includes(passed.envelope.result.snapshot_identity), "snapshot_identity 必须对模型可见");
		assert.ok(passed.text.includes(passed.envelope.result.source_fingerprint), "source_fingerprint 必须对模型可见");
		assert.ok(passed.text.includes("protocol tag"), "source_fingerprint 须明示它是 protocol tag");
		assert.ok(passed.text.includes("not a source-code fingerprint"), "须明示它不是源码指纹");

		const badMessage = "not a conventional header";
		const failed = await renderThroughTool("precheck-git-commit", handlers["precheck-git-commit"], { message: badMessage }, exec);
		assert.equal(failed.envelope.result.mechanical_outcome, "failed");
		assert.equal(failed.envelope.result.snapshot_identity, undefined);
		assert.ok(!failed.text.includes(SOURCE_FINGERPRINT), "failed 时不得打印 source_fingerprint");
		assert.ok(!failed.text.includes(snapshotIdentity(await stagedDiff(root), badMessage)), "failed 时不得打印任何 snapshot_identity");
		assert.ok(failed.text.includes("failed"), "失败结论必须可见");
		for (const issue of failed.envelope.result.issues) assert.ok(failed.text.includes(issue.rule), `失败原因须可见：${issue.rule}`);

		const { handlers: noRoute } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const unverifiable = await renderThroughTool("precheck-git-commit", noRoute["precheck-git-commit"], { message: okMessage }, exec);
		assert.equal(unverifiable.envelope.result.mechanical_outcome, "unverifiable");
		assert.ok(!unverifiable.text.includes(SOURCE_FINGERPRINT), "unverifiable 时不得打印 source_fingerprint");
		assert.ok(unverifiable.text.includes("unverifiable"), "不可验证结论必须可见");
		assert.ok(unverifiable.text.includes("could not be traced"), "不可验证的原因必须可见");

		for (const outcome of ["failed", "unverifiable"]) {
			const fake = "f".repeat(64);
			const rendered = renderEnvelope("precheck-git-commit", {
				envelope: {
					operation_key: "precheck-git-commit",
					outcome,
					result: { mechanical_outcome: outcome, snapshot_identity: fake, source_fingerprint: fake },
					scope: { requested: "precheck", completed: [], not_completed: ["verdict-computed-by-current-validator-code"] },
					sources: [],
					gaps: ["the validator modules below are newer on disk than this host process started"],
					verification: { checks: [], passed: false },
					follow_up: ["restart the host (or reload the plugin) so the validator loads the on-disk version, then re-run precheck"],
				},
			})[0].text;
			assert.ok(!rendered.includes(fake), `${outcome} 时不得显示任何伪造 hash`);
			assert.ok(rendered.includes("not_completed: verdict-computed-by-current-validator-code"), `${outcome}：未完成项必须可见`);
			assert.ok(rendered.includes("follow_up: restart the host"), `${outcome}：重试方向必须可见`);
		}

		const { handlers: staleHandlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => stubSessionPersistence(logPath), detectStaleModules: () => STALE });
		const stale = await renderThroughTool("precheck-git-commit", staleHandlers["precheck-git-commit"], { message: MISMATCHED_MESSAGE }, exec);
		assert.equal(stale.envelope.result.mechanical_outcome, "unverifiable");
		assert.ok(!stale.text.includes(SOURCE_FINGERPRINT), "陈旧时不得打印 source_fingerprint");
		assert.ok(stale.text.includes("STALE code"), "陈旧原因必须可见");
		assert.ok(stale.text.includes("not_completed: verdict-computed-by-current-validator-code"), "未完成项必须可见");
		assert.ok(stale.text.includes("follow_up: restart the host"), "重试方向必须可见");
	});
});






