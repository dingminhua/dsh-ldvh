// Tests for plugin/lib/governed-projects.js:
// - strict Git root checks (resolveGitRoot)
// - ldvh-base five-directory fact-source initialization and states
// - registration file atomic creation + first-project default
// - full installProject flow and failure rollback
// - uninstallHook delegation
//
// Registration lives under a throwaway DSH home (a function of a temp path),
// and every repository is created and removed inside withTemp().
import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	HOOK_BUNDLE_VERSION,
	initializeFactSource,
	inspectCandidate,
	installProject,
	readGovernedProjects,
	registerProject,
	resolveGitRoot,
	uninstallHook,
	unregisterProject,
} from "../lib/governed-projects.js";
import { realpath } from "node:fs/promises";
import { git, initRepo, runnerPath, withTemp } from "./helpers.mjs";

const FACT_DIRECTORIES = ["sparks", "workcases", "adrs", "pitfalls", "studies"];

/** Build a dshHomePath-style function rooted at an arbitrary temp dir. */
const dshHome = (home) => (...segments) => join(home, ...segments);

// ---------------------------------------------------------------------------
// Git root strict check
// ---------------------------------------------------------------------------

test("resolveGitRoot rejects non-absolute, non-directory, subdirectory, and bare inputs", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		await assert.rejects(resolveGitRoot("relative/path"), /non-empty absolute path/);
		await assert.rejects(resolveGitRoot(join(base, "missing")), (error) => error?.code === "ENOENT");

		const file = join(base, "plain-file");
		await writeFile(file, "x\n");
		await assert.rejects(resolveGitRoot(file), /must be a directory/);

		const root = await initRepo(base);
		await mkdir(join(root, "sub"));
		await assert.rejects(resolveGitRoot(join(root, "sub")), /must be the Git root, not a subdirectory/);

		await git(base, ["init", "-q", "--bare", join(base, "bare.git")]);
		await assert.rejects(resolveGitRoot(join(base, "bare.git")), /work tree/);
	});
});

test("inspectCandidate fails closed on an invalid candidate", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const result = await inspectCandidate(join(base, "not-a-repo"));
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "candidate_invalid");
	});
});

test("inspectCandidate reports fact source and hook state for a fresh repo", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const result = await inspectCandidate(root);
		assert.equal(result.ok, true);
		// resolveGitRoot canonicalizes symlinked path components (e.g. /var -> /private/var)
		assert.equal(result.value.projectRoot, await realpath(root));
		assert.equal(result.value.factSource.state, "absent");
		assert.equal(result.value.hook.state, "absent");
	});
});

// ---------------------------------------------------------------------------
// ldvh-base five-directory initialization
// ---------------------------------------------------------------------------

test("initializeFactSource creates the five fact directories and reports ready", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const status = await initializeFactSource(root);
		assert.equal(status.state, "ready");
		assert.deepEqual(FACT_DIRECTORIES, ["sparks", "workcases", "adrs", "pitfalls", "studies"]);
		for (const name of FACT_DIRECTORIES) {
			const stat = await lstat(join(root, "ldvh-base", name));
			assert.ok(stat.isDirectory(), `${name} must be a directory inside ldvh-base`);
		}
		const inspected = await inspectCandidate(root);
		assert.equal(inspected.value.factSource.state, "ready");
	});
});

test("fact source is incomplete when a directory is missing", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		await initializeFactSource(root);
		await rm(join(root, "ldvh-base", "studies"), { recursive: true, force: true });
		const inspected = await inspectCandidate(root);
		assert.equal(inspected.value.factSource.state, "incomplete");
		assert.match(inspected.value.factSource.detail, /studies/);
	});
});

test("fact source conflicts when ldvh-base is not a regular directory", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		// a regular file where the directory should be
		const rootA = await initRepo(base, { name: "repo-a" });
		await writeFile(join(rootA, "ldvh-base"), "not a directory");
		let inspected = await inspectCandidate(rootA);
		assert.equal(inspected.value.factSource.state, "conflict");
		assert.match(inspected.value.factSource.detail, /not a regular directory/);

		// a symlink where the directory should be
		const rootB = await initRepo(base, { name: "repo-b" });
		await mkdir(join(base, "real-base"));
		await symlink(join(base, "real-base"), join(rootB, "ldvh-base"));
		inspected = await inspectCandidate(rootB);
		assert.equal(inspected.value.factSource.state, "conflict");
	});
});

// ---------------------------------------------------------------------------
// Registration: atomic creation and first-project default
// ---------------------------------------------------------------------------

test("registerProject atomically creates the registration and makes the first project default", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");

		const first = await registerProject(dshHome(home), { id: "proj-a", path: rootA });
		assert.equal(first.ok, true, first.error?.message);
		assert.equal(first.value.exists, true);
		assert.equal(first.value.document.default_project_id, "proj-a");
		assert.equal(first.value.document.projects.length, 1);
		assert.equal(first.value.document.projects[0].path, await realpath(rootA));
		assert.ok(typeof first.value.fingerprint === "string" && first.value.fingerprint.length > 0);

		// atomic write: file exists with mode 0600, no leftover temp files
		const registrationFile = join(home, "ldvh", "governed-projects.yaml");
		const stat = await lstat(registrationFile);
		assert.equal(stat.mode & 0o777, 0o600);
		const ldvhDirEntries = await readdir(join(home, "ldvh"));
		assert.deepEqual(ldvhDirEntries.filter((entry) => entry.endsWith(".tmp")), []);
		const raw = await readFile(registrationFile, "utf8");
		assert.match(raw, /default_project_id: proj-a/);

		// second project keeps the first one as default
		const second = await registerProject(dshHome(home), { id: "proj-b", path: rootB });
		assert.equal(second.ok, true, second.error?.message);
		assert.equal(second.value.document.default_project_id, "proj-a");
		assert.equal(second.value.document.projects.length, 2);
	});
});

test("readGovernedProjects reports an empty registration when none exists", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const home = join(base, "home");
		const result = await readGovernedProjects(dshHome(home));
		assert.equal(result.ok, true);
		assert.equal(result.value.initialized, false);
		assert.deepEqual(result.value.projects, []);
		assert.equal(result.value.defaultProjectId, "");
		assert.equal(result.value.fingerprint, null);
	});
});

test("readGovernedProjects reflects registered projects and the default", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");
		await registerProject(dshHome(home), { id: "first", path: rootA });
		await registerProject(dshHome(home), { id: "second", path: rootB });

		const result = await readGovernedProjects(dshHome(home));
		assert.equal(result.ok, true);
		assert.equal(result.value.initialized, true);
		assert.equal(result.value.defaultProjectId, "first");
		assert.equal(result.value.projects.length, 2);
		assert.equal(result.value.projects[0].id, "first");
		assert.equal(result.value.projects[0].status.hook.state, "absent");
	});
});

test("registerProject rejects duplicate ids and paths", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");
		await registerProject(dshHome(home), { id: "proj-a", path: rootA });

		const dupId = await registerProject(dshHome(home), { id: "proj-a", path: rootB });
		assert.equal(dupId.ok, false);
		assert.equal(dupId.error.code, "conflict");
		assert.match(dupId.error.message, /already registered/);

		const dupPath = await registerProject(dshHome(home), { id: "proj-c", path: rootA });
		assert.equal(dupPath.ok, false);
		assert.match(dupPath.error.message, /already registered/);
	});
});

test("registerProject detects a stale expected fingerprint", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const rootC = await initRepo(base, { name: "c" });
		const home = join(base, "home");

		const first = await registerProject(dshHome(home), { id: "a", path: rootA });
		const fingerprint = first.value.fingerprint;
		assert.ok(typeof fingerprint === "string" && fingerprint.length > 0);

		// a concurrent writer moved the document forward
		const second = await registerProject(dshHome(home), { id: "b", path: rootB, expectedFingerprint: fingerprint });
		assert.equal(second.ok, true, second.error?.message);

		// the original fingerprint is now stale -> conflict, nothing written
		const stale = await registerProject(dshHome(home), { id: "c", path: rootC, expectedFingerprint: fingerprint });
		assert.equal(stale.ok, false);
		assert.equal(stale.error.code, "conflict");
		assert.match(stale.error.message, /refresh before retrying/);
		assert.equal((await readGovernedProjects(dshHome(home))).value.projects.length, 2);
	});
});

// ---------------------------------------------------------------------------
// installProject: full flow
// ---------------------------------------------------------------------------

test("installProject initializes fact source, installs the Hook, and registers", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const result = await installProject(
			dshHome(home),
			{ id: "proj-1", path: root, name: "First Project" },
			{ runnerPath, workspaceRoot: base },
		);
		assert.equal(result.ok, true, JSON.stringify(result.error ?? result));
		assert.equal(result.value.status.factSource.state, "ready");
		assert.equal(result.value.status.hook.state, "managed");
		assert.equal(result.value.status.hook.hookBundleVersion, HOOK_BUNDLE_VERSION);
		assert.equal(result.value.registration.document.default_project_id, "proj-1");

		const readBack = await readGovernedProjects(dshHome(home));
		assert.equal(readBack.value.initialized, true);
		assert.equal(readBack.value.projects.length, 1);
		assert.equal(readBack.value.projects[0].name, "First Project");
		assert.equal(readBack.value.projects[0].status.hook.state, "managed");
	});
});

test("installProject rejects a third-party Hook without touching the project", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const thirdParty = "#!/bin/sh\necho third-party\nexit 0\n";
		await writeFile(join(root, ".git", "hooks", "commit-msg"), thirdParty, { mode: 0o755 });
		const home = join(base, "home");

		const result = await installProject(dshHome(home), { id: "p", path: root }, { runnerPath, workspaceRoot: base });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "hook_conflict");

		// nothing was created or overwritten
		assert.equal(await readFile(join(root, ".git", "hooks", "commit-msg"), "utf8"), thirdParty);
		await assert.rejects(lstat(join(root, "ldvh-base")), (error) => error?.code === "ENOENT");
		assert.equal((await readGovernedProjects(dshHome(home))).value.initialized, false);
	});
});

test("installProject rejects a bare repository", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		await git(base, ["init", "-q", "--bare", join(base, "bare.git")]);
		const home = join(base, "home");
		const result = await installProject(dshHome(home), { id: "b", path: join(base, "bare.git") }, { runnerPath, workspaceRoot: base });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "candidate_invalid");
	});
});

// ---------------------------------------------------------------------------
// installProject: failure rollback
// ---------------------------------------------------------------------------

test("installProject rolls back the fact source when the Hook preflight fails", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		// No staged change -> installHook preflight rejects a valid message,
		// so the whole install fails after ldvh-base was created.
		const root = await initRepo(base, { stage: false });
		const home = join(base, "home");
		const result = await installProject(dshHome(home), { id: "p", path: root }, { runnerPath, workspaceRoot: base });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "installation_failed");
		assert.deepEqual(result.error.details.rollback, []);

		// the newly created fact source was removed again
		await assert.rejects(lstat(join(root, "ldvh-base")), (error) => error?.code === "ENOENT");
		await assert.rejects(readFile(join(root, ".git", "hooks", "commit-msg")), (error) => error?.code === "ENOENT");
		assert.equal((await readGovernedProjects(dshHome(home))).value.initialized, false);
	});
});

test("installProject rolls back the Hook and fact source when registration fails", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base); // staged -> Hook install succeeds
		// Force registration to fail: point the DSH home under a regular file,
		// so mkdir(<home>/ldvh) fails with ENOTDIR.
		const blocker = join(base, "blocker");
		await writeFile(blocker, "not a directory\n");
		const badHome = (...segments) => join(blocker, ...segments);

		const result = await installProject(badHome, { id: "p", path: root }, { runnerPath, workspaceRoot: base });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "installation_failed");

		// the installed Hook was rolled back...
		await assert.rejects(readFile(join(root, ".git", "hooks", "commit-msg")), (error) => error?.code === "ENOENT");
		// ...and the newly created fact source was removed
		await assert.rejects(lstat(join(root, "ldvh-base")), (error) => error?.code === "ENOENT");
	});
});

test("installProject is idempotent for the same id and realpath and rejects the same id elsewhere", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");

		const first = await installProject(dshHome(home), { id: "p", path: rootA }, { runnerPath, workspaceRoot: base });
		assert.equal(first.ok, true, JSON.stringify(first.error ?? first));

		// same id + same realpath -> idempotent repair install succeeds and
		// preserves the existing Hook and fact source (macOS /var vs /private/var)
		const second = await installProject(dshHome(home), { id: "p", path: await realpath(rootA) }, { runnerPath, workspaceRoot: base });
		assert.equal(second.ok, true, JSON.stringify(second.error ?? second));
		const afterRepair = await inspectCandidate(rootA);
		assert.equal(afterRepair.value.hook.state, "managed", "repair install must keep the existing Hook");
		assert.equal(afterRepair.value.factSource.state, "ready", "repair install must keep the existing fact source");
		const registered = await readGovernedProjects(dshHome(home));
		assert.equal(registered.value.projects.length, 1, "repair install must not duplicate the registration");
		assert.equal(registered.value.defaultProjectId, "p");

		// same id on a different repo -> conflict, nothing torn down
		const third = await installProject(dshHome(home), { id: "p", path: rootB }, { runnerPath, workspaceRoot: base });
		assert.equal(third.ok, false);
		assert.equal(third.error.code, "installation_failed");
		assert.match(third.error.message, /already registered to another entry/);
		assert.equal((await readGovernedProjects(dshHome(home))).value.projects.length, 1);
		// rootB's freshly created Hook and fact source were rolled back
		await assert.rejects(readFile(join(rootB, ".git", "hooks", "commit-msg")), (error) => error?.code === "ENOENT");
		await assert.rejects(lstat(join(rootB, "ldvh-base")), (error) => error?.code === "ENOENT");
	});
});

test("registerProject is idempotent for the same id and path", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const first = await registerProject(dshHome(home), { id: "p", path: root });
		const fingerprint = first.value.fingerprint;
		const second = await registerProject(dshHome(home), { id: "p", path: root, expectedFingerprint: fingerprint });
		assert.equal(second.ok, true, JSON.stringify(second.error ?? second));
		assert.equal(second.value.document.projects.length, 1);
		assert.equal(second.value.fingerprint, fingerprint, "idempotent success must not rewrite the file");
	});
});

// ---------------------------------------------------------------------------
// uninstallHook delegation
// ---------------------------------------------------------------------------

test("uninstallHook removes only the managed Hook", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		await installProject(dshHome(home), { id: "p", path: root }, { runnerPath, workspaceRoot: base });

		const removed = await uninstallHook(root);
		assert.equal(removed.ok, true);
		assert.equal(removed.value.state, "absent");
		assert.equal((await inspectCandidate(root)).value.hook.state, "absent");

		// a third-party Hook is refused, matching hook-manager semantics
		await writeFile(join(root, ".git", "hooks", "commit-msg"), "#!/bin/sh\necho third-party\nexit 0\n", { mode: 0o755 });
		const refused = await uninstallHook(root);
		assert.equal(refused.ok, false);
		assert.equal(refused.error.code, "hook_conflict");
	});
});

// ---------------------------------------------------------------------------
// unregisterProject
// ---------------------------------------------------------------------------

test("unregisterProject removes the managed Hook, keeps the fact source, and drops the registration", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		// register "beta" first so it becomes the default; "alpha" is non-default
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");
		const dsh = dshHome(home);
		await installProject(dsh, { id: "beta", path: rootB }, { runnerPath, workspaceRoot: base });
		await installProject(dsh, { id: "alpha", path: rootA }, { runnerPath, workspaceRoot: base });

		const result = await unregisterProject(dsh, { id: "alpha", path: rootA });
		assert.equal(result.ok, true, JSON.stringify(result.error ?? result));
		assert.equal(result.value.hook.state, "absent");
		assert.equal(result.value.factSourcePreserved, join(await realpath(rootA), "ldvh-base"));

		// fact source is preserved, the Hook is gone, the registration shrinks
		assert.ok((await lstat(join(rootA, "ldvh-base"))).isDirectory());
		await assert.rejects(readFile(join(rootA, ".git", "hooks", "commit-msg")), (error) => error?.code === "ENOENT");
		const readBack = await readGovernedProjects(dsh);
		assert.equal(readBack.value.projects.length, 1);
		assert.equal(readBack.value.projects[0].id, "beta");
		assert.equal(readBack.value.defaultProjectId, "beta");
	});
});

test("unregisterProject refuses to remove the default without a next default", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");
		const dsh = dshHome(home);
		await installProject(dsh, { id: "beta", path: rootB }, { runnerPath, workspaceRoot: base });
		await installProject(dsh, { id: "alpha", path: rootA }, { runnerPath, workspaceRoot: base });

		const result = await unregisterProject(dsh, { id: "beta", path: rootB });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "default_required");
		assert.match(result.error.message, /nextDefaultProjectId/);
		// registration is unchanged
		assert.equal((await readGovernedProjects(dsh)).value.projects.length, 2);
	});
});

test("unregisterProject switches the default when a valid next default is supplied", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");
		const dsh = dshHome(home);
		await installProject(dsh, { id: "beta", path: rootB }, { runnerPath, workspaceRoot: base });
		await installProject(dsh, { id: "alpha", path: rootA }, { runnerPath, workspaceRoot: base });

		const result = await unregisterProject(dsh, { id: "beta", path: rootB, nextDefaultProjectId: "alpha" });
		assert.equal(result.ok, true, JSON.stringify(result.error ?? result));
		const readBack = await readGovernedProjects(dsh);
		assert.equal(readBack.value.projects.length, 1);
		assert.equal(readBack.value.projects[0].id, "alpha");
		assert.equal(readBack.value.defaultProjectId, "alpha");
	});
});

test("unregisterProject clears the default when the only project is removed", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const dsh = dshHome(home);
		await installProject(dsh, { id: "solo", path: root }, { runnerPath, workspaceRoot: base });

		const result = await unregisterProject(dsh, { id: "solo", path: root });
		assert.equal(result.ok, true, JSON.stringify(result.error ?? result));
		const readBack = await readGovernedProjects(dsh);
		assert.equal(readBack.value.projects.length, 0);
		assert.equal(readBack.value.defaultProjectId, "");
	});
});

test("unregisterProject rejects an id/path that is not registered", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const dsh = dshHome(home);
		await installProject(dsh, { id: "beta", path: root }, { runnerPath, workspaceRoot: base });

		const result = await unregisterProject(dsh, { id: "ghost", path: root });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "not_registered");
		assert.match(result.error.message, /not registered/);
		assert.equal((await readGovernedProjects(dsh)).value.projects.length, 1);
	});
});

test("unregisterProject detects a stale expected fingerprint", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");
		const dsh = dshHome(home);
		await installProject(dsh, { id: "beta", path: rootB }, { runnerPath, workspaceRoot: base });
		const fingerprint = (await readGovernedProjects(dsh)).value.fingerprint;
		await installProject(dsh, { id: "alpha", path: rootA }, { runnerPath, workspaceRoot: base });

		const result = await unregisterProject(dsh, { id: "beta", path: rootB, expectedFingerprint: fingerprint });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "conflict");
		assert.match(result.error.message, /refresh before retrying/);
	});
});