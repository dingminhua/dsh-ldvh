// Tests for plugin/lib/governance-scope.js: three-state judgement
// (governed / not_governed / unavailable) for a session cwd.
//
// Authority: specs/07 §5. The contract is fail-closed: a broken carrier
// must NEVER be guessed into governed or not_governed.
//
// Test construction: a throwaway DSH home + a throwaway Git root, then
// register the root through the existing governed-projects registration
// path. We deliberately do NOT install hooks (the scope resolver only
// consumes the registration reader).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveGovernanceScope } from "../lib/governance-scope.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

async function writeCorruptRegistration(home) {
	// A non-parsable YAML carrier: governed-scope must surface
	// registration_unavailable, not guess into either governed or
	// not_governed.
	await mkdir(join(home, "ldvh"), { recursive: true });
	await writeFile(join(home, "ldvh", "governed-projects.yaml"), ":\n  this is: : not yaml\n  [broken");
}

// ---------------------------------------------------------------------------
// dshHomePath / cwd preconditions
// ---------------------------------------------------------------------------

test("resolveGovernanceScope returns unavailable when dshHomePath is not a function", async () => {
	const result = await resolveGovernanceScope("/not/a/function", "/some/cwd");
	assert.equal(result.state, "unavailable");
	assert.match(result.detail, /DSH user configuration root/);
});

test("resolveGovernanceScope returns unavailable when cwd is an empty string", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const result = await resolveGovernanceScope(dshHome(home), "");
		assert.equal(result.state, "unavailable");
		assert.match(result.detail, /working directory/);
	});
});

test("resolveGovernanceScope returns unavailable when cwd is not a string", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const result = await resolveGovernanceScope(dshHome(home), null);
		assert.equal(result.state, "unavailable");
	});
});

// ---------------------------------------------------------------------------
// Fail-closed on a broken registration
// ---------------------------------------------------------------------------

test("resolveGovernanceScope returns unavailable when the registration is unparseable (fail-closed)", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		await writeCorruptRegistration(home);
		const cwd = join(base, "anywhere");
		const result = await resolveGovernanceScope(dshHome(home), cwd);
		assert.equal(result.state, "unavailable");
		assert.match(result.detail, /governed-projects registration unavailable/);
		// fail-closed: must NOT guess into either governed or not_governed
		assert.equal(result.state === "governed", false);
		assert.equal(result.state === "not_governed", false);
	});
});

test("resolveGovernanceScope returns not_governed when the registration is empty and cwd is a real path", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		// An initialized-but-empty registration: a brand-new carrier is
		// `uninitialized: true` with `projects: []`. That's a valid state —
		// no project to match, every cwd is not_governed.
		await mkdir(join(home, "ldvh"), { recursive: true });
		await writeFile(
			join(home, "ldvh", "governed-projects.yaml"),
			"schema_version: 1\ngovernance_instance_name: empty\nproduct_description: empty\nprojects: []\ndefault_project_id: \"\"\n",
		);
		const cwd = join(base, "anywhere");
		await mkdir(cwd, { recursive: true });
		const result = await resolveGovernanceScope(dshHome(home), cwd);
		assert.equal(result.state, "not_governed");
		assert.match(result.detail, /not inside a registered governed project/);
	});
});

// ---------------------------------------------------------------------------
// Governed
// ---------------------------------------------------------------------------

test("resolveGovernanceScope returns governed when cwd is the registered Git root", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		const reg = await registerProject(dshHome(home), { id: "demo", path: root });
		assert.equal(reg.ok, true, reg.error?.message);
		const result = await resolveGovernanceScope(dshHome(home), root);
		assert.equal(result.state, "governed");
		assert.equal(result.project.id, "demo");
		assert.equal(result.project.name, null);
		assert.equal(result.project.description, null);
		assert.ok(typeof result.registrationFingerprint === "string" && result.registrationFingerprint.length > 0);
	});
});

test("resolveGovernanceScope returns governed when cwd is a subdirectory of the registered Git root", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		const reg = await registerProject(dshHome(home), { id: "demo", path: root });
		assert.equal(reg.ok, true, reg.error?.message);
		const sub = join(root, "deep", "sub");
		await mkdir(sub, { recursive: true });
		const result = await resolveGovernanceScope(dshHome(home), sub);
		assert.equal(result.state, "governed");
		assert.equal(result.project.id, "demo");
	});
});

test("resolveGovernanceScope propagates the project's name and description when registered", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		const reg = await registerProject(dshHome(home), { id: "demo", path: root, name: "Demo Project", description: "for tests" });
		assert.equal(reg.ok, true, reg.error?.message);
		const result = await resolveGovernanceScope(dshHome(home), root);
		assert.equal(result.state, "governed");
		assert.equal(result.project.name, "Demo Project");
		assert.equal(result.project.description, "for tests");
	});
});

// ---------------------------------------------------------------------------
// Not governed
// ---------------------------------------------------------------------------

test("resolveGovernanceScope returns not_governed when cwd is outside the registered root", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		const reg = await registerProject(dshHome(home), { id: "demo", path: root });
		assert.equal(reg.ok, true, reg.error?.message);
		const elsewhere = join(base, "elsewhere");
		await mkdir(elsewhere, { recursive: true });
		const result = await resolveGovernanceScope(dshHome(home), elsewhere);
		assert.equal(result.state, "not_governed");
		assert.equal(result.project, undefined);
	});
});

test("resolveGovernanceScope returns not_governed when the cwd path resembles the registered root but is not inside it", async () => {
	// A path that shares a prefix with the registered root but is in a
	// different directory (e.g. "/repo-evil" vs "/repo") must NOT be
	// reported as governed. The containment check uses a trailing slash.
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		// registered: <base>/realrepo
		// look-alike sibling: <base>/realrepo-evil
		const real = await initRepo(base, { name: "realrepo" });
		const evil = await initRepo(base, { name: "realrepo-evil" });
		const reg = await registerProject(dshHome(home), { id: "demo", path: real });
		assert.equal(reg.ok, true, reg.error?.message);
		const result = await resolveGovernanceScope(dshHome(home), evil);
		assert.equal(result.state, "not_governed");
	});
});

test("resolveGovernanceScope returns unavailable when cwd does not exist and cannot be realpath'd", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const result = await resolveGovernanceScope(dshHome(home), join(base, "missing-dir"));
		assert.equal(result.state, "unavailable");
		assert.match(result.detail, /working directory/);
	});
});

// ---------------------------------------------------------------------------
// Skipped projects
// ---------------------------------------------------------------------------

test("resolveGovernanceScope skips a project whose status is error (not a match candidate)", async () => {
	// We register a valid Git root first, then unregister its underlying
	// directory to make inspectCandidate fail. The scope resolver must
	// skip that project and report not_governed (no other project to match).
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		const reg = await registerProject(dshHome(home), { id: "demo", path: root });
		assert.equal(reg.ok, true, reg.error?.message);
		// Wipe the registered path so inspectCandidate fails on the next
		// readGovernedProjects. The registration still points at it.
		const { rm } = await import("node:fs/promises");
		await rm(root, { recursive: true, force: true });
		// cwd must be a real path that exists; we use another real Git
		// root under the same base so the cwd realpath succeeds.
		const otherCwd = await initRepo(base, { name: "other" });
		const result = await resolveGovernanceScope(dshHome(home), otherCwd);
		assert.equal(result.state, "not_governed");
	});
});
