import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeExecute, resolveSpecSourceRoot } from "../lib/ldvh-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, pluginRoot, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

const ROOT_CARRIER = `---
ldvh_spec:
  spec_key: "ldvh-root"
  spec_id: "00"
  spec_kind: "spec"
  title: "理念与构成"
  authority: "active"
  canonical_path: "specs/00-理念与构成.md"
  parent_spec: ""
  relation: ""
  positioning: "根定位"
  scope: "根范围"
  basis: []
  related_specs: []
  code_consumption: ["dsh-ldvh"]
---

# 理念与构成

## 1. 根

根正文。
`;

const ORDINARY_CARRIER = (key, specId, title) => `---
ldvh_spec:
  spec_key: "${key}"
  spec_id: "${specId}"
  spec_kind: "spec"
  title: "${title}"
  canonical_path: "specs/${specId}-${title}.md"
  parent_spec: "ldvh-root"
  relation: "refines"
  positioning: "定位"
  scope: "范围"
  basis: []
---

# ${title}

## 1. 节

正文。
`;

function makeExec(deps) {
	const { handlers } = makeExecute(deps);
	return { handlers };
}


test("resolveSpecSourceRoot probes in order and reports every location on failure", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const resolved = await resolveSpecSourceRoot(join(base, "project"), join(base, "pkg"));
		assert.equal(resolved.ok, false);
		assert.match(resolved.reason, /governed-project/);
		assert.match(resolved.reason, /dev-checkout/);
		assert.match(resolved.reason, /plugin-bundle/);
	});
});

test("resolveSpecSourceRoot identifies a dev checkout by the root carrier, not the bare directory name", async () => {
	await withTemp("spec-fallback.", async (base) => {
		await mkdir(join(base, "specs"), { recursive: true });
		const resolved = await resolveSpecSourceRoot(join(base, "project"), join(base, "pkg"));
		assert.equal(resolved.ok, false);
	});
});


test("read-specification-candidates falls back to the plugin bundle when the project has no specs", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const pkg = join(base, "pkg");
		await mkdir(join(pkg, "specs"), { recursive: true });
		await writeFile(join(pkg, "specs", "11-语料甲.md"), ORDINARY_CARRIER("corpus-a", "11", "语料甲"));
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: pkg, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.sources[0].kind, "plugin-bundle");
		assert.equal(envelope.sources[0].path, await realpath(pkg));
		const keys = envelope.result.candidates.map((c) => c.responsibility_key);
		assert.deepEqual(keys, ["corpus-a"]);
	});
});

test("read-specification-candidates prefers the dev checkout over the plugin bundle and never mixes levels", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: root });
		await mkdir(join(base, "specs"), { recursive: true });
		await writeFile(join(base, "specs", "00-理念与构成.md"), ROOT_CARRIER);
		await writeFile(join(base, "specs", "11-语料甲.md"), ORDINARY_CARRIER("corpus-a", "11", "语料甲"));
		const pkg = join(base, "pkg");
		await mkdir(join(pkg, "specs"), { recursive: true });
		await writeFile(join(pkg, "specs", "12-语料乙.md"), ORDINARY_CARRIER("corpus-b", "12", "语料乙"));
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: pkg, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.sources[0].kind, "dev-checkout");
		assert.equal(envelope.sources[0].path, await realpath(base));
		const keys = envelope.result.candidates.map((c) => c.responsibility_key).sort();
		assert.deepEqual(keys, ["corpus-a", "ldvh-root"]);
	});
});

test("read-specification-candidates prefers the project's own specs over every fallback", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await mkdir(join(root, "specs"), { recursive: true });
		await writeFile(join(root, "specs", "13-项目语料.md"), ORDINARY_CARRIER("corpus-project", "13", "项目语料"));
		await registerProject(dshHome(home), { id: "demo", path: root });
		await mkdir(join(base, "specs"), { recursive: true });
		await writeFile(join(base, "specs", "00-理念与构成.md"), ROOT_CARRIER);
		const pkg = join(base, "pkg");
		await mkdir(join(pkg, "specs"), { recursive: true });
		await writeFile(join(pkg, "specs", "12-语料乙.md"), ORDINARY_CARRIER("corpus-b", "12", "语料乙"));
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: pkg, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.sources[0].kind, "governed-project");
		assert.equal(envelope.sources[0].path, await realpath(root));
		const keys = envelope.result.candidates.map((c) => c.responsibility_key);
		assert.deepEqual(keys, ["corpus-project"]);
	});
});

test("read-specification-candidates reports every probed location when no source resolves", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const pkg = join(base, "pkg");
		await mkdir(pkg, { recursive: true });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: pkg, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({}, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "unavailable");
		assert.match(envelope.gaps[0], /governed-project/);
		assert.match(envelope.gaps[0], /dev-checkout/);
		assert.match(envelope.gaps[0], /plugin-bundle/);
	});
});


test("membership evidence is reported not-applicable when the corpus comes from a fallback source", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const pkg = join(base, "pkg");
		await mkdir(join(pkg, "specs"), { recursive: true });
		await writeFile(join(pkg, "specs", "11-语料甲.md"), ORDINARY_CARRIER("corpus-a", "11", "语料甲"));
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: pkg, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-candidates"]({ evidence: true }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.membership_evidence.applicable, false);
		assert.match(envelope.result.membership_evidence.reason, /plugin-bundle/);
		assert.match(envelope.result.membership_evidence.reason, /01 §10\.3/);
		assert.deepEqual(envelope.gaps, []);
	});
});


test("read-specification-content reads the fallback corpus with honest source tagging", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const pkg = join(base, "pkg");
		await mkdir(join(pkg, "specs"), { recursive: true });
		await writeFile(join(pkg, "specs", "11-语料甲.md"), ORDINARY_CARRIER("corpus-a", "11", "语料甲"));
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: pkg, sessionPersistence: () => undefined });
		const envelope = await handlers["read-specification-content"]({ responsibility_key: "corpus-a" }, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		assert.equal(envelope.result.layer, "L4");
		assert.equal(envelope.result.canonical_path, "specs/11-语料甲.md");
		assert.equal(envelope.sources[0].kind, "plugin-bundle");
		assert.equal(envelope.sources[0].path, join(await realpath(pkg), "specs", "11-语料甲.md"));
	});
});


test("discover-ldvh-capabilities parses declarations from the dev checkout of this repository", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: root });
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: pluginRoot, sessionPersistence: () => undefined });
		const envelope = await handlers["discover-ldvh-capabilities"]({}, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		for (const operation of envelope.result.operations) {
			assert.notEqual(operation.declaration, null, `${operation.operation_key} must carry a parsed declaration resolved from the dev-checkout corpus`);
			assert.match(operation.availability, /^(当次可调用|已声明)$/, `${operation.operation_key} must have a valid availability`);
			if (operation.result?.pending_inputs || operation.pending_inputs) {
				assert.equal(operation.availability, "已声明", `${operation.operation_key} needs inputs, must not claim callable`);
			}
		}
		const content = envelope.result.operations.find((o) => o.operation_key === "read-specification-content");
		assert.ok(content, "read-specification-content must be discovered");
		assert.equal(content.availability, "已声明", "with no responsibility_key supplied it must be 已声明 + pending input, not 当次可调用 (05 §6.2)");
		assert.match(content.pending_inputs, /responsibility_key/);
	});
});
