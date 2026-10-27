// friction-fbd65401：长驻宿主进程内的模块陈旧检测。
//
// 这条判据的全部价值在于「区分不可判定与确认未通过」，故测试必须钉住两侧：
//   * mtime 晚于进程启动 → 判陈旧（否则 precheck 会把旧代码的 failed 当真）；
//   * mtime 早于/等于进程启动 → 不判陈旧（否则每次正常提交都会误报 unverifiable）；
//   * 文件读不到 → 记 unreadable，不判陈旧（否则正常仓库也会误报）。
//
// 反例侧的守护尤其重要：本模块只会「把 failed 降为 unverifiable」，一旦判据过宽，
// 所有真失败都会被降级掩盖——那是比原缺陷更坏的方向。
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { detectStaleModules, detectStaleValidatorModules, processStartMs, statMtimeOrNull } from "../lib/module-freshness.js";

test("processStartMs 由 uptime 反推，可注入时钟", () => {
  // 生产路径：不注入时取真实进程值，必为正且早于现在。
  const real = processStartMs();
  assert.ok(real > 0 && real <= Date.now(), `进程启动时刻应落在过去：${real}`);

  // 注入路径：给定 now 与 uptime 应得确定的启动时刻。
  assert.equal(processStartMs({ nowMs: 1_000_000, uptimeSec: 100 }), 900_000);
  assert.equal(processStartMs({ nowMs: 1_000_000, uptimeSec: 0 }), 1_000_000);
});

test("mtime 晚于进程启动 → 判陈旧；早于 → 不判", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ldvh-freshness-"));
  const older = join(dir, "older.js");
  const newer = join(dir, "newer.js");
  await writeFile(older, "// v1\n");
  await writeFile(newer, "// v2\n");

  const startMs = Date.now();
  const statMtimeMs = (file) => (file === older ? startMs - 60_000 : startMs + 60_000);
  const result = detectStaleModules({ files: [older, newer], startMs, statMtimeMs });

  assert.deepEqual(result.stale.map((entry) => entry.file), [newer], "只有 mtime 晚于启动的那个模块算陈旧");
  assert.deepEqual(result.unreadable, []);
  assert.equal(result.checked, 2);
});

test("mtime 与进程启动同毫秒 → 不判陈旧（宁可漏报，不可误报）", () => {
  const startMs = 5_000_000;
  const result = detectStaleModules({ files: ["/x.js"], startMs, statMtimeMs: () => startMs });
  assert.deepEqual(result.stale, [], "同一毫秒无法区分先后，按未陈旧处理");
});

test("读不到的模块记 unreadable，不当作陈旧", () => {
  const startMs = Date.now();
  const result = detectStaleModules({
    files: ["/missing.js"],
    startMs,
    statMtimeMs: () => null,
  });
  assert.deepEqual(result.stale, [], "不可读 ≠ 陈旧——把它当陈旧会让每次正常提交都报错");
  assert.deepEqual(result.unreadable, ["/missing.js"]);
});

test("statMtimeOrNull 对不存在的路径返回 null 而不抛", () => {
  assert.equal(statMtimeOrNull("/definitely/not/here/nope.js"), null);
});

test("真实仓库：刚加载的 validator 模块不得被判陈旧（反向守护）", () => {
  // 进程若在模块落盘之后启动（正常情形），这里必须是 0 条陈旧——否则 precheck 会把
  // 所有真实 failed 都降级成 unverifiable，把缺陷换个方向放大。
  const result = detectStaleValidatorModules();
  assert.equal(result.checked, 2, "受检查的是 commit-validation.js 与 ldvh-tools.js 两个模块");
  assert.deepEqual(result.unreadable, [], `模块应可读：${JSON.stringify(result.unreadable)}`);
  assert.deepEqual(result.stale, [], `正常启动的进程不应判陈旧：${JSON.stringify(result.stale)}`);
  assert.ok(result.start_ms > 0);
});
