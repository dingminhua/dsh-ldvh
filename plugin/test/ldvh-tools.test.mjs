import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guidanceTextFor, GUIDANCE_SECTION_NAME, GUIDANCE_SECTION_ORDER } from "../lib/guidance-text.js";
import { makeExecute, OPERATIONS, renderEnvelope, toolDescriptor } from "../lib/ldvh-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { snapshotIdentity, SOURCE_FINGERPRINT } from "../lib/commit-validation.js";
import { execFileAsync, git, initRepo, sessionPersistenceWithRoutingLog, withTemp } from "./helpers.mjs";

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
	return renderEnvelope("resolve-governance-scope", value);
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

test("discover-ldvh-capabilities enumerates every registered capability", async () => {
	const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	const envelope = await handlers["discover-ldvh-capabilities"]({}, {});
	assertEnvelopeShape(envelope, "discover-ldvh-capabilities", "completed");
	const keys = envelope.result.operations.map((o) => o.operation_key).sort();
	for (const key of [
		"discover-ldvh-capabilities",
		"precheck-git-commit",
		"register-governed-project",
		"resolve-governance-scope",
		"unregister-governed-project",
		"review-ask",
		"research-consult",
	]) {
		assert.ok(keys.includes(key), `能力发现必须能发现 ${key}`);
	}
	const layers = await Promise.all([
		import("../lib/goal-tools.js"),
		import("../lib/subgoal-tools.js"),
		import("../lib/spark-tools.js"),
		import("../lib/norm-tools.js"),
		import("../lib/report-tools.js"),
		import("../lib/pitfall-tools.js"),
		import("../lib/friction-tools.js"),
		import("../lib/research-consult-tools.js"),
	]);
	for (const layer of layers) {
		for (const key of Object.keys(layer.OPERATIONS)) {
			assert.ok(keys.includes(key), `能力发现必须能发现工具层操作 ${key}`);
		}
	}
	for (const op of envelope.result.operations) {
		assert.ok(typeof op.dsh_tool_name === "string" && op.dsh_tool_name.startsWith("ldvh_"));
		assert.match(op.availability, /^(当次可调用|不可用|已声明|已实现)$/);
	}
});

test("discover-ldvh-capabilities：声明来源不可用时报「不可用」+ 诊断，且不给出任何手写契约位置", async () => {
	const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	const envelope = await handlers["discover-ldvh-capabilities"]({ operation_key: "research-consult" }, {});
	assert.equal(envelope.outcome, "completed");
	const op = envelope.result.operations[0];
	assert.equal(op.operation_key, "research-consult");
	assert.equal(op.availability, "不可用");
	assert.equal(op.declaration, null);
	assert.equal(op.service_contract, undefined, "手写契约定位列已删除：契约位置只由随包声明文件供给，声明缺失时不得再给一份");
	assert.ok(envelope.gaps.some((gap) => /未在随包公开操作声明中登记/.test(gap)));
	assert.ok(envelope.gaps.some((gap) => /声明来源：/.test(gap)), "诊断里须能看出声明来源的 tier");
	assert.equal(envelope.result.declaration_source.tier, "package-data");
	assert.match(envelope.result.declaration_source.label, /包内数据文件/);
	assert.ok(envelope.result.declaration_source.file.endsWith("operation-declarations.bundle.json"));
});

test("renderEnvelope：能力发现把声明来源的 tier 打给模型（否则 Tier 只活在字段里）", () => {
	const blocks = renderEnvelope("discover-ldvh-capabilities", {
		envelope: {
			operation_key: "discover-ldvh-capabilities",
			outcome: "completed",
			result: {
				operations: [{ operation_key: "demo-op", availability: "不可用", summary: "s", declaration: null }],
				declaration_source: { tier: "package-data", label: "包内数据文件（构建期由开发仓的声明生成源产出，运行期不读规范源）", declared_operations: 36 },
			},
			scope: { requested: "all", completed: ["demo-op"], not_completed: [] },
			sources: [],
			gaps: [],
			verification: { checks: [], passed: false },
			follow_up: [],
		},
	});
	const text = blocks.map((block) => block.text).join("\n");
	assert.match(text, /declaration source: 包内数据文件/);
	assert.match(text, /\[package-data\]/);
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

test("precheck-git-commit 参数 schema 暴露 message:string，与执行体读取的字段一致", async () => {
	const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	const descriptor = toolDescriptor("precheck-git-commit", OPERATIONS["precheck-git-commit"], handlers["precheck-git-commit"]);
	const messageSpec = descriptor.parameters?.properties?.message;
	assert.ok(messageSpec, "schema 必须声明 message 字段，否则宿主无法传 message、工具恒返回 invalid_request");
	assert.equal(messageSpec.type, "string");
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

test("precheck-git-commit 不再因 §7.2 依据引用不存在而 failed（旧检查已撤）", async () => {
	await withTemp("ldvh-tools-basis-retired.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await mkdir(join(root, "specs"), { recursive: true });
		const specPath = join(root, "specs", "01-规范.md");
		const body = [
			"# 01 规范",
			"",
			"### 7.2 领域正文",
			"",
			"禁止三类：实现状态；过程与进度。",
			"",
			"### 7.3 下一节",
			"",
			"此句不属 §7.2。",
			"",
		].join("\n");
		await writeFile(specPath, body);
		await git(root, ["add", "-A"]);
		await git(root, ["commit", "-qm", "base"]);
		await registerProject(dshHome(home), { id: "demo72retired", path: root });
		await writeFile(specPath, body.replace("禁止三类：实现状态；过程与进度。", "禁止三类已删。"));
		await git(root, ["add", "specs/01-规范.md"]);
		const logPath = await writeSessionLog(base, "session.jsonl", [
			{ type: "model/selection", data: { provider: "deepseek-harness", model: "test" } },
		]);
		const message = [
			"docs(specs): 删除该行",
			"",
			"§7.2 依据：**布局自指计数**",
			"",
			"关键变更:",
			"- specs/01-规范.md: 删除禁止三类",
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
		assert.equal(envelope.result.mechanical_outcome, "passed", JSON.stringify(envelope.result.issues));
		assert.deepEqual((envelope.result.issues ?? []).filter((issue) => String(issue.rule).startsWith("validation/removal_basis")), []);
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

test("makeExecute returns the core handlers and the same OPERATIONS export", () => {
	const { handlers, OPERATIONS: ops } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
	assert.equal(typeof handlers["resolve-governance-scope"], "function");
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
			operation_key: "resolve-governance-scope",
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

test("guidanceTextFor returns the governed text with the anchor set（分流后：开发期文本带 00 锚点，运行期文本只给载体定位）", () => {
	const text = guidanceTextFor("governed", "dev");
	assert.ok(text.length > 0);
	const anchors = ["身份块", "§1 核心价值", "对齐 Vibe", "协调 Coding", "§2 方法与构成", "§3 Human 权利", "§4 AI 责任与义务", "§4.6", "§4.7", "§4.8", "§5 价值纪律"];
	for (const anchor of anchors) {
		assert.ok(text.includes(anchor), `governed guidance missing anchor: ${anchor}（依据：specs/01-规范源与规范模型基础规范.md §10.4 最小规则引导；锚点取自 specs/00-理念与构成.md 各级标题、§1 的两个价值面与 specs/01 §6.1 身份块）`);
	}
	assert.equal(text.includes("§1 三大核心价值"), false, "旧漂移锚点不得与 §1 核心价值并存（依据：specs/00-理念与构成.md §1 现行标题为「LDVH 的核心价值」，specs/attachments/01.Att.01-LDVH双语术语表.md 中「三大核心价值」已被「核心价值」取代）");
});

test("guidanceTextFor governed 运行期文本：只给载体定位，不带 00 锚点", () => {
	const text = guidanceTextFor("governed");
	assert.ok(text.length > 0);
	assert.ok(text.includes("运行时机制："), "运行期文本须说明召回段的「运行时机制：」定位");
	assert.ok(text.includes("ldvh-root"), "运行期文本须指出底线载体");
	assert.ok(text.includes("plugin-specs"), "运行期文本须指出运行期规则随包");
	assert.equal(text.includes("§1 核心价值"), false, "运行期文本不得再以 specs/00 章节号为锚点");
	assert.equal(text.includes("本会话工作锚点"), false, "运行期文本不承载开发约定锚点");
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

test("陈旧不改判 passed：陈旧只说明「不知道」，不得伪装成通过（00 §4.6）", async () => {
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


async function withShellSignatureEnv(overrides, fn) {
	const keys = ["DSH_SESSION_JSONL", "DSH_HOME", "DSH_SESSION_ID"];
	const saved = {};
	for (const key of keys) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
	try {
		return await fn();
	} finally {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	}
}

test("session-signature envelope exposes an unbranded authoritative provider/model and copy-paste trailers", async () => {
	await withTemp("ldvh-sig.", async (base) => {
		await withShellSignatureEnv({}, async () => {
			const { handlers } = makeExec({
				dshHomePath: dshHome("/nope"),
				workspaceRoot: base,
				sessionPersistence: sessionPersistenceWithRoutingLog(base, { provider: "workbuddy", model: "hy4flash-free" }),
			});
			const exec = { agent: { session: { header: {} } }, env: {} };
			const env = await handlers["session-signature"]({}, exec);
			assert.equal(env.outcome, "completed");
			assert.equal(env.result.provider, "workbuddy");
			assert.equal(env.result.model, "hy4flash-free");
			assert.equal(env.result.source_channel, "host_channel");
			assert.deepEqual(env.result.trailers, ["LDVH-Provider: workbuddy", "LDVH-Model: hy4flash-free"]);
			assert.equal(typeof env.result.authoritative, "object");
			assert.equal(env.result.authoritative.provider, undefined, "the branded carrier must not be mistaken for the readable value");
			assert.equal(env.verification.passed, true);
		});
	});
});

test("session-signature renderEnvelope shows provider/model, trailers and 'how to get' guidance", async () => {
	await withTemp("ldvh-sig.", async (base) => {
		await withShellSignatureEnv({}, async () => {
			const { handlers } = makeExec({
				dshHomePath: dshHome("/nope"),
				workspaceRoot: base,
				sessionPersistence: sessionPersistenceWithRoutingLog(base, { provider: "workbuddy", model: "hy4flash-free" }),
			});
			const exec = { agent: { session: { header: {} } }, env: {} };
			const env = await handlers["session-signature"]({}, exec);
			const text = renderEnvelope("session-signature", { envelope: env })[0].text;
			assert.match(text, /authoritative provider: workbuddy/);
			assert.match(text, /authoritative model: hy4flash-free/);
			assert.match(text, /LDVH-Provider: workbuddy/);
			assert.match(text, /LDVH-Model: hy4flash-free/);
			assert.match(text, /usage（如何拿署名）:/);
			assert.match(text, /Copy these two lines verbatim/);
			assert.match(text, /verification\.passed: true/);
			assert.ok(text.split("\n").length > 5, "rendered output must carry the result fields, not just the first line");
		});
	});
});

test("session-signature outcome is unavailable when both channels fail, with no trailers", async () => {
	await withShellSignatureEnv({}, async () => {
		const { handlers } = makeExec({ dshHomePath: dshHome("/nope"), workspaceRoot: "/nope", sessionPersistence: () => undefined });
		const env = await handlers["session-signature"]({}, {});
		assert.equal(env.outcome, "unavailable");
		assert.equal(env.result.provider ?? null, null);
		assert.deepEqual(env.result.trailers, []);
		assert.equal(env.verification.passed, false);
		assert.ok(env.gaps.some((gap) => /do NOT fill commit trailers by guessing/.test(gap)));
		const text = renderEnvelope("session-signature", { envelope: env })[0].text;
		assert.match(text, /authoritative provider: \(unavailable\)/);
		assert.match(text, /禁止猜值填 trailer/);
	});
});

test("session-signature 在随包声明文件生成后可被定位且锚点可解析", async () => {
	await withTemp("ldvh-sig-decl.", async (base) => {
		const { copyBundles, cleanBundles } = await import("../scripts/specs-bundle.mjs");
		const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
		const packageRoot = join(base, "pkg");
		await copyBundles({ repoRoot, packageRoot });
		try {
			const { loadOperationDeclarationsBundle } = await import("../lib/spec-registry.js");
			const bundlePath = join(packageRoot, "lib", "operation-declarations.bundle.json");
			const table = await loadOperationDeclarationsBundle(bundlePath);
			assert.equal(table.ok, true, JSON.stringify(table.reason));
			const row = table.declarations.get("session-signature");
			assert.ok(row, "session-signature 须在随包声明文件中");
			assert.equal(row.anchor_errors.length, 0, "声明锚点须可解析");
		} finally {
			await cleanBundles({ packageRoot });
		}
	});
});
