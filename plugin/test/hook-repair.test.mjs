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

/**
 * A registered governed project with NO Hooks installed.
 *
 * Registration is done through the raw `registerProject` primitive rather than
 * the guarded `registerProjectFromEntry`: these tests are about the startup
 * repair, not about the consent flow, so going through the consent path would
 * test something else.
 */
async function governedProject(base) {
  const home = join(base, "home");
  const repo = await initRepo(base);
  const registered = await registerProject(dshHome(home), { id: "demo", path: repo });
  assert.equal(registered.ok, true, JSON.stringify(registered));
  // The registration stores the REAL path: `inspectCandidate` resolves the
  // repository root through Git, which on macOS answers `/private/var/...`
  // for a path under the `/var` symlink. Comparing against the pre-resolution
  // `initRepo` path would fail on that alone, for reasons unrelated to Hooks.
  return { home, repo, canonical: await realpath(repo) };
}

/** Install both Hooks so a follow-up repair has something to consider current. */
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
    // Rewrite ONLY the pre-commit half against a previous bundle version, the
    // exact shape a dev.2 -> dev.3 upgrade produces on a real installation.
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
    // The bytes are the whole point: LVH has no standing to delete another
    // tool's gate, and "reported" is only honest if nothing was written.
    assert.equal(await readFile(foreign, "utf8"), "#!/bin/sh\necho someone-else\n");
  });
});

test("a directory that is no longer a Git repository is skipped, not 'repaired'", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo } = await governedProject(base);
    await writeFile(join(repo, ".git", "HEAD"), "garbage\n");

    const summary = await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });

    assert.equal(summary.repaired.length, 0);
    // Either a skip (unavailable Hook) or a recorded failure (inspection failed)
    // is acceptable; silently reporting "nothing to do" is not.
    assert.equal(summary.skipped.length + summary.failed.length >= 1, true, JSON.stringify(summary));
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
    // Break the first project's Hook so its repair fails, and prove the loop
    // still reaches the second one. A repair pass that aborts on the first
    // failure would leave every project after it silently unmaintained.
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

test("a repaired Hook set passes the real Git Gate for its stage", async () => {
  await withTemp("ldvh-hr.", async (base) => {
    const { home, repo } = await governedProject(base);
    // **改用 `git()`（非零退出即抛），不用 `gitOk()`**（2026-10-30 修）：
    // `gitOk` 的设计是**不抛错**、返回 `{ok:false}`——它供「预期失败」的路径使用。
    // 本用例要断言的恰恰是「这些 git 步骤**必须成功**」，用 `gitOk` 则失败被静默
    // 吞掉：即使 Hook 没装上、commit 被 Gate 拒绝，用例照样绿。
    //
    // 该缺陷由零检测力扫描器发现（见 plugin/scripts/test-lint.mjs 的形态 3
    // 候选）：本块内此前没有任何 `assert.`，而 gitOk 也不抛错——**整条用例无断言**。
    // 它此前之所以还绿，是因为注释声称「asserted end-to-end through git itself」，
    // 而 git 本身**不构成断言**，除非失败被抛出。
    await git(repo, ["commit", "-qm", "base"]);
    await repairHooksOnStartup({ dshHomePath: dshHome(home), runnerPath, workspaceRoot: pluginRoot });
    // The pre-commit Hook this repair installed must refuse an empty Index and
    // accept a real one — asserted end-to-end through git itself, not through
    // inspectHook, because "managed" only means the bytes match.
    await writeFile(join(repo, "second.txt"), "x\n");
    await git(repo, ["add", "second.txt"]);
    const message = ["chore(test): 冒烟", "", "关键变更:", "- add second.txt", "", "LDVH-Provider: test-provider", "LDVH-Model: test-model", ""].join("\n");
    // **用 `-m` 直传消息，不写消息文件再 `-F`**（2026-10-30 修）：写文件就得把它
    // `git add` 进 Index 才能被 `-F` 读到，于是 `msg.txt` 自身成了已暂存改动——
    // Git Gate 要求「关键变更」逐条点名每个已暂存路径，测试消息却只说了
    // `second.txt`，commit 因此被 `validation/staged_path_uncovered` 拒绝。
    //
    // 该失败此前**一直存在却从未暴露**：原用例用 `gitOk`（非零退出不抛、只返回
    // `{ok:false}`），失败被静默吞掉，用例恒绿——它注释里声称的
    // 「asserted end-to-end through git itself」当时并不成立。改用会抛错的 `git()`
    // 后立刻转红，才暴露出这个真问题。
    //
    // 与兄弟测试（hook-manager.test.mjs 等）一致：`-m` 直传。
    // The commit runs BOTH Hooks: pre-commit (lint) then commit-msg.
    // `git()` 在 Gate 拒绝时**抛错**——这才是本用例的断言：提交必须通过。
    await git(repo, ["commit", "-m", message], { env: { ...process.env, LDVH_WORKSPACE_ROOT: pluginRoot } });
  });
});
