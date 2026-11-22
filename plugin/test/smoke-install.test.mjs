import test from "node:test";
import assert from "node:assert/strict";
import { isIgnoredBuildsError, resolveTarball, pollHealth, classifyChildExit } from "../scripts/smoke-install.mjs";

test("isIgnoredBuildsError 命中真实 pnpm 11 审批门文案（正控制）", () => {
  const real = "[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2\nRun \"pnpm approve-builds\".";
  assert.equal(isIgnoredBuildsError(real), true);
});

test("isIgnoredBuildsError 对正常安装输出为假（否定式，防过度匹配）", () => {
  assert.equal(isIgnoredBuildsError("+ dsh-ldvh 1.0.3\nDone in 16s"), false);
});

test("resolveTarball 显式路径优先，且解析为绝对路径", () => {
  const p = resolveTarball("/tmp/x/dsh-ldvh-1.0.3.tgz", "/ignored", () => []);
  assert.equal(p, "/tmp/x/dsh-ldvh-1.0.3.tgz");
});

test("resolveTarball 恰好一个候选时选中", () => {
  const p = resolveTarball(undefined, "/plugin", () => ["dsh-ldvh-1.0.3.tgz", "README.md"]);
  assert.equal(p, "/plugin/dsh-ldvh-1.0.3.tgz");
});

test("resolveTarball 零个或多个候选时拒绝（防假匹配）", () => {
  assert.throws(() => resolveTarball(undefined, "/plugin", () => ["README.md"]), /须恰好 1 个/);
  assert.throws(
    () => resolveTarball(undefined, "/plugin", () => ["dsh-ldvh-1.0.2.tgz", "dsh-ldvh-1.0.3.tgz"]),
    /须恰好 1 个/,
  );
});

test("pollHealth 健康端点返回 200 时通过", async () => {
  const ok = await pollHealth(1234, {
    fetchImpl: async () => ({ status: 200 }),
    sleep: async () => {},
    tries: 3,
  });
  assert.equal(ok, true);
});

test("pollHealth 始终非 200 时超时判失败（有限重试）", async () => {
  let calls = 0;
  const ok = await pollHealth(1234, {
    fetchImpl: async () => { calls += 1; return { status: 503 }; },
    sleep: async () => {},
    tries: 5,
  });
  assert.equal(ok, false);
  assert.equal(calls, 5);
});

test("classifyChildExit 区分早退与运行中", () => {
  assert.equal(classifyChildExit(true, null), "early-exit");
  assert.equal(classifyChildExit(false, 3), "early-exit");
  assert.equal(classifyChildExit(false, null), "running");
});
