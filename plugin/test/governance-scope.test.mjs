import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveGovernanceScope } from "../lib/governance-scope.js";
import { registerProject } from "../lib/governed-projects.js";
import { initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

async function writeCorruptRegistration(home) {
	await mkdir(join(home, "ldvh"), { recursive: true });
	await writeFile(join(home, "ldvh", "governed-projects.yaml"), ":\n  this is: : not yaml\n  [broken");
}


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


test("resolveGovernanceScope returns unavailable when the registration is unparseable (fail-closed)", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		await writeCorruptRegistration(home);
		const cwd = join(base, "anywhere");
		const result = await resolveGovernanceScope(dshHome(home), cwd);
		assert.equal(result.state, "unavailable");
		assert.match(result.detail, /governed-projects registration unavailable/);
		assert.equal(result.state === "governed", false);
		assert.equal(result.state === "not_governed", false);
	});
});

test("resolveGovernanceScope returns not_governed when the registration is empty and cwd is a real path", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
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
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
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


test("resolveGovernanceScope skips a project whose status is error (not a match candidate)", async () => {
	await withTemp("ldvh-gs.", async (base) => {
		const home = join(base, "home");
		const root = await initRepo(base);
		const reg = await registerProject(dshHome(home), { id: "demo", path: root });
		assert.equal(reg.ok, true, reg.error?.message);
		const { rm } = await import("node:fs/promises");
		await rm(root, { recursive: true, force: true });
		const otherCwd = await initRepo(base, { name: "other" });
		const result = await resolveGovernanceScope(dshHome(home), otherCwd);
		assert.equal(result.state, "not_governed");
	});
});


test("withinRoot holds under BOTH path semantics — the win32 regression that killed the hot path", async () => {
	const { withinRoot } = await import("../lib/governance-scope.js");
	const { posix, win32 } = await import("node:path");

	const truths = [
		["C:\\repo", "C:\\repo\\sub", true],
		["C:\\repo", "C:\\repo\\a\\b", true],
		["C:\\repo", "C:\\repo", true],
		["C:\\repo", "C:\\repoX", false],
		["C:\\repo", "D:\\other", false],
		["C:\\repo", "C:\\repo\\..\\outside", false],
		["\\\\srv\\share\\p", "\\\\srv\\share\\p\\x", true],
		["\\\\srv\\share\\p", "\\\\srv\\share\\other", false],
	];
	for (const [root, candidate, expected] of truths) {
		assert.equal(withinRoot(root, candidate, win32), expected, `win32: ${root} ⊃ ${candidate}`);
	}

	const posixTruths = [
		["/a/b", "/a/b/c", true],
		["/a/b", "/a/b", true],
		["/a/b", "/a/bc", false],
		["/a/b", "/a/b/../x", false],
		["/a/b", "/x", false],
	];
	for (const [root, candidate, expected] of posixTruths) {
		assert.equal(withinRoot(root, candidate, posix), expected, `posix: ${root} ⊃ ${candidate}`);
	}
});

test("withinRoot treats a '..'-prefixed child as inside, not as an escape", async () => {
	const { withinRoot } = await import("../lib/governance-scope.js");
	assert.equal(withinRoot("/a/b", "/a/b/..foo"), true);
	assert.equal(withinRoot("/a/b", "/a/b/../x"), false);
});
