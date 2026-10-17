// Tests for the specs/01 §10.3 规范语料三级回退 (corpus source-resolution
// chain): governed-project specs/ → dev-checkout specs/ → plugin-bundle specs/.
//
// The production wiring passes workspaceRoot = the plugin package root, so a
// link/dev install resolves level 2 (the repository that authors the corpus)
// and an npm install resolves level 3 (the copy made by prepack). These tests
// build both layouts as throwaway trees and drive the real handlers through
// makeExecute(deps), asserting BOTH the served corpus content (no cross-level
// mixing) and the honest source tagging (sources[].kind) that 01 §10.3
// requires. The dev-checkout integration case uses this repository's real
// plugin root, because that is exactly the link-install shape being verified.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeExecute, resolveSpecSourceRoot } from "../lib/ldvh-tools.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, pluginRoot, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

// A minimal but mechanically VALID root carrier (01.Att.02 §3 root profile:
// fixed title/spec_id/canonical_path, empty parent/relation, authority active,
// code_consumption non-empty, related_specs present and possibly empty).
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

/** An ordinary spec carrier whose file name must equal its canonical_path. */
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

// ---------------------------------------------------------------------------
// resolveSpecSourceRoot (unit level)
// ---------------------------------------------------------------------------

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
		// A sibling directory literally named "specs" WITHOUT the canonical root
		// carrier must NOT be mistaken for the dev checkout (a dependency named
		// "specs" sitting next to the package in node_modules).
		await mkdir(join(base, "specs"), { recursive: true });
		const resolved = await resolveSpecSourceRoot(join(base, "project"), join(base, "pkg"));
		assert.equal(resolved.ok, false);
	});
});

// ---------------------------------------------------------------------------
// read-specification-candidates (fallback levels, priority, honest tagging)
// ---------------------------------------------------------------------------

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
		// The resolver normalises through realpath (8.3-safe); align expectations
		// with the same resolver (DEVELOPMENT.md Windows platform notes).
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
		// dev layout: <base>/specs is the authoring corpus; <base>/pkg is the
		// plugin package carrying a (possibly stale) bundled copy.
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
		// corpus-b lives ONLY in the bundle — its absence proves no cross-level mixing.
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
		// Level 1 does not re-normalise; the registered project path is already
		// canonical (registration pre-resolves realpath).
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

// ---------------------------------------------------------------------------
// membership evidence (01 §10.3: not-applicable for fallback corpora)
// ---------------------------------------------------------------------------

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
		// The consuming project's git silence must not be turned into gaps.
		assert.deepEqual(envelope.gaps, []);
	});
});

// ---------------------------------------------------------------------------
// read-specification-content (reads from the fallback corpus)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// discover-ldvh-capabilities (05 §6.1 mechanical obligation over the corpus)
// ---------------------------------------------------------------------------

test("discover-ldvh-capabilities parses declarations from the dev checkout of this repository", async () => {
	await withTemp("spec-fallback.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: root });
		// The REAL plugin root: dirname(pluginRoot) is this repository, whose
		// specs/ carries the canonical root carrier — exactly the link-install
		// shape the user reported. A governed project without its own specs
		// must get fully declared, callable operations from that corpus.
		const { handlers } = makeExec({ dshHomePath: dshHome(home), workspaceRoot: pluginRoot, sessionPersistence: () => undefined });
		const envelope = await handlers["discover-ldvh-capabilities"]({}, { agent: { session: { header: { cwd: root } } } });
		assert.equal(envelope.outcome, "completed");
		for (const operation of envelope.result.operations) {
			assert.equal(operation.availability, "当次可调用", `${operation.operation_key} must be callable via the dev-checkout corpus`);
			assert.notEqual(operation.declaration, null, `${operation.operation_key} must carry a parsed declaration`);
		}
	});
});
