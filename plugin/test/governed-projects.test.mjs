import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
	ensureRegistrationCarrier,
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

const FACT_DIRECTORIES = ["sparks", "pitfalls", "reports", "frictions", "norms"];

const dshHome = (home) => (...segments) => join(home, ...segments);


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
		assert.equal(result.value.projectRoot, await realpath(root));
		assert.equal(result.value.factSource.state, "absent");
		assert.equal(result.value.hook.state, "absent");
	});
});


test("initializeFactSource creates the five fact directories and reports ready", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const status = await initializeFactSource(root);
		assert.equal(status.state, "ready");
		assert.deepEqual(FACT_DIRECTORIES, ["sparks", "pitfalls", "reports", "frictions", "norms"]);
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
		await rm(join(root, "ldvh-base", "reports"), { recursive: true, force: true });
		const inspected = await inspectCandidate(root);
		assert.equal(inspected.value.factSource.state, "incomplete");
		assert.match(inspected.value.factSource.detail, /reports/);
	});
});

test("fact source conflicts when ldvh-base is not a regular directory", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "repo-a" });
		await writeFile(join(rootA, "ldvh-base"), "not a directory");
		let inspected = await inspectCandidate(rootA);
		assert.equal(inspected.value.factSource.state, "conflict");
		assert.match(inspected.value.factSource.detail, /not a regular directory/);

		const rootB = await initRepo(base, { name: "repo-b" });
		await mkdir(join(base, "real-base"));
		await symlink(
			join(base, "real-base"),
			join(rootB, "ldvh-base"),
			process.platform === "win32" ? "junction" : undefined,
		);
		inspected = await inspectCandidate(rootB);
		assert.equal(inspected.value.factSource.state, "conflict");
	});
});


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

		const registrationFile = join(home, "ldvh", "governed-projects.yaml");
		const stat = await lstat(registrationFile);
		if (process.platform === "win32") {
			assert.ok(stat.isFile(), "the carrier must be written as a regular file");
		} else {
			assert.equal(stat.mode & 0o777, 0o600);
		}
		const ldvhDirEntries = await readdir(join(home, "ldvh"));
		assert.deepEqual(ldvhDirEntries.filter((entry) => entry.endsWith(".tmp")), []);
		const raw = await readFile(registrationFile, "utf8");
		assert.match(raw, /default_project_id: proj-a/);

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

		const second = await registerProject(dshHome(home), { id: "b", path: rootB, expectedFingerprint: fingerprint });
		assert.equal(second.ok, true, second.error?.message);

		const stale = await registerProject(dshHome(home), { id: "c", path: rootC, expectedFingerprint: fingerprint });
		assert.equal(stale.ok, false);
		assert.equal(stale.error.code, "conflict");
		assert.match(stale.error.message, /refresh before retrying/);
		assert.equal((await readGovernedProjects(dshHome(home))).value.projects.length, 2);
	});
});


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


test("installProject rolls back the fact source when the Hook preflight fails", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const result = await installProject(dshHome(home), { id: "p", path: root }, { runnerPath: join(base, "missing-runner.js"), workspaceRoot: base });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "installation_failed");
		assert.deepEqual(result.error.details.rollback, []);

		await assert.rejects(lstat(join(root, "ldvh-base")), (error) => error?.code === "ENOENT");
		await assert.rejects(readFile(join(root, ".git", "hooks", "commit-msg")), (error) => error?.code === "ENOENT");
		assert.equal((await readGovernedProjects(dshHome(home))).value.initialized, false);
	});
});

test("installProject rolls back the Hook and fact source when registration fails", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const blocker = join(base, "blocker");
		await writeFile(blocker, "not a directory\n");
		const badHome = (...segments) => join(blocker, ...segments);

		const result = await installProject(badHome, { id: "p", path: root }, { runnerPath, workspaceRoot: base });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "installation_failed");

		await assert.rejects(readFile(join(root, ".git", "hooks", "commit-msg")), (error) => error?.code === "ENOENT");
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

		const second = await installProject(dshHome(home), { id: "p", path: await realpath(rootA) }, { runnerPath, workspaceRoot: base });
		assert.equal(second.ok, true, JSON.stringify(second.error ?? second));
		const afterRepair = await inspectCandidate(rootA);
		assert.equal(afterRepair.value.hook.state, "managed", "repair install must keep the existing Hook");
		assert.equal(afterRepair.value.factSource.state, "ready", "repair install must keep the existing fact source");
		const registered = await readGovernedProjects(dshHome(home));
		assert.equal(registered.value.projects.length, 1, "repair install must not duplicate the registration");
		assert.equal(registered.value.defaultProjectId, "p");

		const third = await installProject(dshHome(home), { id: "p", path: rootB }, { runnerPath, workspaceRoot: base });
		assert.equal(third.ok, false);
		assert.equal(third.error.code, "installation_failed");
		assert.match(third.error.message, /already registered to another entry/);
		assert.equal((await readGovernedProjects(dshHome(home))).value.projects.length, 1);
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


test("uninstallHook removes only the managed Hook", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		await installProject(dshHome(home), { id: "p", path: root }, { runnerPath, workspaceRoot: base });

		const removed = await uninstallHook(root);
		assert.equal(removed.ok, true);
		assert.equal(removed.value.state, "absent");
		assert.equal((await inspectCandidate(root)).value.hook.state, "absent");

		await writeFile(join(root, ".git", "hooks", "commit-msg"), "#!/bin/sh\necho third-party\nexit 0\n", { mode: 0o755 });
		const refused = await uninstallHook(root);
		assert.equal(refused.ok, false);
		assert.equal(refused.error.code, "hook_conflict");
	});
});


test("unregisterProject removes the managed Hook, keeps the fact source, and drops the registration", async () => {
	await withTemp("ldvh-gp.", async (base) => {
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
		await registerProject(dsh, { id: "beta", path: rootB });
		await registerProject(dsh, { id: "alpha", path: rootA });

		const result = await unregisterProject(dsh, { id: "beta", path: rootB });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "default_required");
		assert.match(result.error.message, /nextDefaultProjectId/);
		assert.equal((await readGovernedProjects(dsh)).value.projects.length, 2);
	});
});

test("unregisterProject switches the default when a valid next default is supplied", async () => {
	await withTemp("ldvh-gp.", async (base) => {
		const rootA = await initRepo(base, { name: "a" });
		const rootB = await initRepo(base, { name: "b" });
		const home = join(base, "home");
		const dsh = dshHome(home);
		await registerProject(dsh, { id: "beta", path: rootB });
		await registerProject(dsh, { id: "alpha", path: rootA });

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
		await registerProject(dsh, { id: "solo", path: root });

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
		await registerProject(dsh, { id: "beta", path: root });

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
			await registerProject(dsh, { id: "beta", path: rootB });
			const fingerprint = (await readGovernedProjects(dsh)).value.fingerprint;
			await registerProject(dsh, { id: "alpha", path: rootA });

			const result = await unregisterProject(dsh, { id: "beta", path: rootB, expectedFingerprint: fingerprint });
			assert.equal(result.ok, false);
			assert.equal(result.error.code, "conflict");
			assert.match(result.error.message, /refresh before retrying/);
		});
	});


	test("unregisterProject leaves the Hook installed when it refuses", async () => {
		await withTemp("ldvh-gp.", async (base) => {
			const rootA = await initRepo(base, { name: "a" });
			const rootB = await initRepo(base, { name: "b" });
			const home = join(base, "home");
			const dsh = dshHome(home);
			await installProject(dsh, { id: "beta", path: rootB }, { runnerPath, workspaceRoot: base });
			await installProject(dsh, { id: "alpha", path: rootA }, { runnerPath, workspaceRoot: base });
			const fingerprint = (await readGovernedProjects(dsh)).value.fingerprint;

			const refusals = [
				["conflict", { id: "beta", path: rootB, expectedFingerprint: "stale" + fingerprint }],
				["not_registered", { id: "ghost", path: rootB }],
				["default_required", { id: "beta", path: rootB }],
			];
			for (const [code, request] of refusals) {
				const refused = await unregisterProject(dsh, request);
				assert.equal(refused.ok, false, code + " must be refused");
				assert.equal(refused.error.code, code);
				assert.equal((await inspectCandidate(rootB)).value.hook.state, "managed", code + ": a refused call must leave the Hook installed");
				assert.equal((await readGovernedProjects(dsh)).value.projects.length, 2, code + ": the registration must be unchanged");
			}
		});
	});


	test("ensureRegistrationCarrier creates the carrier for an empty DSH home", async () => {
		await withTemp("ldvh-gp.", async (base) => {
			const home = join(base, "home");
			const dsh = dshHome(home);
			const carrierPath = dsh("ldvh", "governed-projects.yaml");

			const ensured = await ensureRegistrationCarrier(dsh);
			assert.equal(ensured.created, true);
			assert.ok(typeof ensured.fingerprint === "string" && ensured.fingerprint.length > 0);

			const stat = await lstat(carrierPath);
			assert.ok(stat.isFile(), "carrier must exist after ensureRegistrationCarrier");
			const raw = await readFile(carrierPath, "utf8");
			const document = parseYaml(raw);
			assert.equal(typeof document, "object");
			assert.equal(document.schema_version, 1);
			assert.deepEqual(document.projects, []);
			assert.equal(document.default_project_id, "");
			assert.equal(typeof document.governance_instance_name, "string");
			assert.ok(document.governance_instance_name.length > 0);
			assert.equal(typeof document.product_description, "string");
			assert.ok(document.product_description.length > 0);

			const result = await readGovernedProjects(dsh);
			assert.equal(result.ok, true);
			assert.equal(result.value.initialized, true);
			assert.deepEqual(result.value.projects, []);
		});
	});

	test("ensureRegistrationCarrier is idempotent and never rewrites an existing carrier", async () => {
		await withTemp("ldvh-gp.", async (base) => {
			const home = join(base, "home");
			const dsh = dshHome(home);
			const carrierPath = dsh("ldvh", "governed-projects.yaml");

			const first = await ensureRegistrationCarrier(dsh);
			assert.equal(first.created, true);

			const before = await readFile(carrierPath, "utf8");
			const second = await ensureRegistrationCarrier(dsh);
			assert.equal(second.created, false);
			assert.equal(second.fingerprint, first.fingerprint, "existing carrier must keep its fingerprint");
			const after = await readFile(carrierPath, "utf8");
			assert.equal(after, before, "existing carrier must not be rewritten byte-for-byte");
		});
	});

	test("ensureRegistrationCarrier fails closed on an invalid carrier and leaves it untouched", async () => {
		await withTemp("ldvh-gp.", async (base) => {
			const home = join(base, "home");
			const dsh = dshHome(home);
			const carrierPath = dsh("ldvh", "governed-projects.yaml");
			await mkdir(join(home, "ldvh"), { recursive: true });
			const invalid = "schema_version: 2\nprojects: []\n";
			await writeFile(carrierPath, invalid);

			await assert.rejects(ensureRegistrationCarrier(dsh), /schema_version/);
			const after = await readFile(carrierPath, "utf8");
			assert.equal(after, invalid, "invalid carrier must stay byte-for-byte unchanged");
		});
	});

	test("ensureRegistrationCarrier fails closed on a non-parsable carrier and leaves it untouched", async () => {
		await withTemp("ldvh-gp.", async (base) => {
			const home = join(base, "home");
			const dsh = dshHome(home);
			const carrierPath = dsh("ldvh", "governed-projects.yaml");
			await mkdir(join(home, "ldvh"), { recursive: true });
			const garbage = "not: [valid: yaml: {unclosed\n";
			await writeFile(carrierPath, garbage);

			await assert.rejects(ensureRegistrationCarrier(dsh));
			const after = await readFile(carrierPath, "utf8");
			assert.equal(after, garbage, "non-parsable carrier must stay byte-for-byte unchanged");
		});
	});