import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { withTemp, initRepo, pluginRoot, git, gitOk } from "./helpers.mjs";
import { registerProject } from "../lib/governed-projects.js";
import { repairHooksOnStartup } from "../lib/hook-repair.js";
import { inspectHook, renderHook, HOOK_BUNDLE_VERSION, MANAGED_HOOKS } from "../lib/hook-manager.js";

const dshHome = (home) => (...segments) => join(home, ...segments);
const runnerPath = join(pluginRoot, "lib", "git-gate-runner.js");

async function governedProject(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  const registered = await registerProject(dshHome(home), { id: "demo", path: repo });
  assert.equal(registered.ok, true, JSON.stringify(registered));
  return { home, repo, canonical: await realpath(repo) };
}

async function installCurrentHooks(repo) {
  const { installHook } = await import("../lib/hook-manager.js");
  const result = await installHook({ projectRoot: repo, runnerPath, workspaceRoot: pluginRoot });
  assert.equal(result.ok, true, JSON.stringify(result));
}

test("repairs a project whose Hooks are absent", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo, canonical } = await governedProject(base);
    const before = await inspectHook(repo);
    assert.equal(before.state, "absent");

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.equal(summary.checked, 1);
    assert.deepEqual(summary.repaired, [canonical]);
    assert.equal(summary.failed.length, 0);
    assert.equal((await inspectHook(repo)).state, "managed");
  });
});

test("a project whose Hooks are already current is checked but not rewritten", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo } = await governedProject(base);
    await installCurrentHooks(repo);
    const hookPath = join(repo, ".git", "hooks", "pre-commit");
    const before = await readFile(hookPath, "utf8");

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.equal(summary.checked, 1);
    assert.deepEqual(summary.repaired, []);
    assert.equal(await readFile(hookPath, "utf8"), before);
  });
});

test("repairs an outdated Hook set without touching a current one", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo, canonical } = await governedProject(base);
    await installCurrentHooks(repo);
    await writeFile(
      join(repo, ".git", "hooks", "pre-commit"),
      renderHook({ runnerPath, workspaceRoot: pluginRoot, bundleVersion: "1.0.0-dev.2", hookName: "pre-commit" }),
      { mode: 0o755 }
    );
    const before = await inspectHook(repo);
    assert.equal(before.state, "outdated");

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.deepEqual(summary.repaired, [canonical]);
    assert.equal((await inspectHook(repo)).state, "managed");
    const body = await readFile(join(repo, ".git", "hooks", "pre-commit"), "utf8");
    assert.match(body, new RegExp(`ldvh-hook-bundle-version: ${HOOK_BUNDLE_VERSION}`));
  });
});

test("a foreign Hook is reported, never overwritten", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo } = await governedProject(base);
    const foreign = join(repo, ".git", "hooks", "pre-commit");
    await mkdir(join(repo, ".git", "hooks"), { recursive: true });
    await writeFile(foreign, "#!/bin/sh\necho someone-else\n", { mode: 0o755 });

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.equal(summary.repaired.length, 0);
    assert.equal(summary.skipped.length, 1);
    assert.equal(summary.skipped[0].state, "conflict");
    assert.equal(await readFile(foreign, "utf8"), "#!/bin/sh\necho someone-else\n");
  });
});

test("a directory that is no longer a Git repository is skipped, not 'repaired'", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo } = await governedProject(base);
    await writeFile(join(repo, ".git", "HEAD"), "garbage\n");

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.equal(summary.repaired.length, 0);
    assert.ok(
      summary.skipped.length + summary.failed.length >= 1,
      `须留下 skip 或 failure 的痕迹，实得 ${JSON.stringify(summary)}`,
    );
  });
});

test("an unreadable registration is reported as a failure, not as zero repairs", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const home = join(base, "home");
    await mkdir(join(home, "ldvh"), { recursive: true });
    await writeFile(join(home, "ldvh", "governed-projects.yaml"), "projects: [unclosed\n");

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.equal(summary.checked, 0);
    assert.equal(summary.failed.length >= 1, true, JSON.stringify(summary));
  });
});

test("never throws when dshHomePath itself fails", async () => {
  const summary = await repairHooksOnStartup({
    dshHomePath: () => { throw new Error("no home"); },
    runnerPath,
    workspaceRoot: pluginRoot,
  });
  assert.equal(summary.checked, 0);
  assert.equal(summary.failed.length, 1);
});

test("repairing one project does not prevent repairing the next", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const home = join(base, "home");
    const first = await initRepo(base, { name: "first" });
    const second = await initRepo(base, { name: "second" });
    await registerProject(dshHome(home), { id: "first", path: first });
    await registerProject(dshHome(home), { id: "second", path: second });
    await mkdir(join(first, ".git", "hooks"), { recursive: true });
    await writeFile(join(first, ".git", "hooks", "commit-msg"), "#!/bin/sh\nforeign\n", { mode: 0o755 });

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.equal(summary.checked, 2);
    assert.deepEqual(summary.repaired, [await realpath(second)]);
    assert.equal(summary.skipped.length, 1);
  });
});

test("the bundle owns exactly the two Hooks the repair iterates", () => {
  assert.deepEqual(MANAGED_HOOKS.map((hook) => hook.name), ["commit-msg", "pre-commit"]);
  assert.equal(HOOK_BUNDLE_VERSION, "1.0.0-dev.3");
});

test("startup repair rewrites a digest-matching hook whose runner path is dead (issue #10)", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo, canonical } = await governedProject(base);
    const deadRunner = join(base, "old-profile", "git-gate-runner.js");
    await writeFile(join(repo, ".git", "hooks", "commit-msg"), renderHook({ runnerPath: deadRunner, workspaceRoot: pluginRoot }), { mode: 0o755 });
    await writeFile(join(repo, ".git", "hooks", "pre-commit"), renderHook({ runnerPath: deadRunner, workspaceRoot: pluginRoot, hookName: "pre-commit" }), { mode: 0o755 });
    assert.equal((await inspectHook(repo)).state, "outdated");

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.deepEqual(summary.repaired, [canonical]);
    assert.equal(summary.failed.length, 0);
    assert.equal((await inspectHook(repo)).state, "managed");
    const body = await readFile(join(repo, ".git", "hooks", "commit-msg"), "utf8");
    assert.ok(body.includes(runnerPath), "repaired hook must point at the live runner");
    assert.doesNotMatch(body, /old-profile/);
  });
});

test("a repaired Hook set passes the real Git Gate for its stage", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo } = await governedProject(base);
    await git(repo, ["commit", "-qm", "base"]);
    await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });
    assert.equal((await inspectHook(repo, { hookName: "pre-commit" })).state, "managed");
    assert.equal((await inspectHook(repo, { hookName: "commit-msg" })).state, "managed");
    await writeFile(join(repo, "second.txt"), "x\n");
    await git(repo, ["add", "second.txt"]);
    const message = ["chore(test): 冒烟", "", "关键变更:", "- add second.txt", "", "LDVH-Provider: test-provider", "LDVH-Model: test-model", ""].join("\n");
    await git(repo, ["commit", "-m", message], { env: { ...process.env, LDVH_WORKSPACE_ROOT: pluginRoot } });
  });
});
