// `plugin/lib` 全量陈旧检测的契约测试（workcase-e487cdf4 计划步骤 4）。
//
// 钉住四件事：①全量清单覆盖目录下全部 .js 且排除自身；②precheck 专用子集仍是
// 原样 2 个文件（扩面不得连带改变预检行为）；③五种情形（一致／单文件改动／新增
// 文件／删除文件／文件不可读）各有确定结果；④结论不参与判定——`detectStaleValidatorModules`
// 的既有语义未被改动。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, statSync, utimesSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  VALIDATOR_MODULE_FILES,
  detectStaleModules,
  detectStaleLibraryModules,
  detectStaleValidatorModules,
  listLibraryModuleFiles,
  processStartMs,
} from "../lib/module-freshness.js";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "mf-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 把文件 mtime 设为指定毫秒。 */
function setMtime(file, ms) {
  const sec = ms / 1000;
  utimesSync(file, sec, sec);
}

// ---------------------------------------------------------------------------
// 1. 清单覆盖面
// ---------------------------------------------------------------------------

test("listLibraryModuleFiles 覆盖目录下全部 .js，且排除本模块自身", () => {
  const files = listLibraryModuleFiles();
  assert.ok(files.length > 50, `应覆盖整个目录，实际 ${files.length}`);
  assert.ok(
    files.every((file) => file.endsWith(".js")),
    "清单里不应出现非 .js 文件",
  );
  assert.ok(
    !files.some((file) => file.endsWith("/module-freshness.js")),
    "本模块自身必须排除：它陈旧时判据仍成立，算进去会在每次改它后自我误报",
  );
  // 路径不得出现重复分隔符（曾因 URL 尾斜杠拼出 lib//x.js 导致自身排除失效）
  assert.ok(
    files.every((file) => !file.includes("//")),
    "路径必须规范化：出现 // 会让自身排除与去重失效",
  );
});

test("清单是运行时枚举而非写死：临时目录新增文件会被收进来", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "a.js"), "// a\n");
    writeFileSync(join(dir, "b.js"), "// b\n");
    writeFileSync(join(dir, "readme.md"), "not js\n");
    const files = listLibraryModuleFiles(dir).map((f) => f.split("/").pop()).sort();
    assert.deepEqual(files, ["a.js", "b.js"]);
  });
});

// ---------------------------------------------------------------------------
// 2. precheck 专用子集不得被扩面连带改变
// ---------------------------------------------------------------------------

test("VALIDATOR_MODULE_FILES 仍是 2 个文件（扩面不得改变预检行为）", () => {
  assert.equal(VALIDATOR_MODULE_FILES.length, 2);
  assert.ok(VALIDATOR_MODULE_FILES.some((f) => f.endsWith("/commit-validation.js")));
  assert.ok(VALIDATOR_MODULE_FILES.some((f) => f.endsWith("/ldvh-tools.js")));
});

test("detectStaleValidatorModules 默认仍只检那 2 个文件", () => {
  const report = detectStaleValidatorModules({ clock: { nowMs: 1_000_000, uptimeSec: 0 } });
  assert.equal(report.checked, 2);
});

// ---------------------------------------------------------------------------
// 3. 五种情形
// ---------------------------------------------------------------------------

test("情形一：全部一致（mtime 早于进程启动）→ 无陈旧", () => {
  withTempDir((dir) => {
    const file = join(dir, "x.js");
    writeFileSync(file, "// x\n");
    setMtime(file, 1_000);
    const report = detectStaleModules({
      files: [file],
      startMs: 5_000,
      statMtimeMs: (f) => {
        try { return statSync(f).mtimeMs; } catch { return null; }
      },
    });
    assert.equal(report.stale.length, 0);
    assert.equal(report.checked, 1);
  });
});

test("情形二：单文件改动（mtime 晚于进程启动）→ 报陈旧", () => {
  const report = detectStaleModules({
    files: ["/a.js", "/b.js"],
    startMs: 5_000,
    statMtimeMs: (f) => (f === "/b.js" ? 9_000 : 1_000),
  });
  assert.equal(report.stale.length, 1);
  assert.equal(report.stale[0].file, "/b.js");
  assert.equal(report.stale[0].mtime_ms, 9_000);
});

test("情形三：新增文件（在进程启动之后才出现）→ 报陈旧", () => {
  withTempDir((dir) => {
    const fresh = join(dir, "new.js");
    writeFileSync(fresh, "// new\n");
    const nowMs = Date.now();
    setMtime(fresh, nowMs);
    const report = detectStaleLibraryModules({
      libraryDir: dir,
      clock: { nowMs: nowMs - 60_000, uptimeSec: 0 },
    });
    assert.equal(report.checked, 1);
    assert.equal(report.stale.length, 1, "启动后新增的模块必然比进程新");
  });
});

test("情形四：文件被删除 → 不进清单（清单枚举的是现存文件）", () => {
  withTempDir((dir) => {
    const file = join(dir, "gone.js");
    writeFileSync(file, "// gone\n");
    assert.equal(listLibraryModuleFiles(dir).length, 1);
    unlinkSync(file);
    assert.equal(listLibraryModuleFiles(dir).length, 0, "删除后不再被枚举，也不会被报陈旧");
  });
});

test("情形五：文件不可读 → 记进 unreadable，不当作陈旧", () => {
  const report = detectStaleModules({
    files: ["/ok.js", "/unreadable.js"],
    startMs: 5_000,
    statMtimeMs: (f) => (f === "/unreadable.js" ? null : 1_000),
  });
  assert.deepEqual(report.unreadable, ["/unreadable.js"]);
  assert.equal(report.stale.length, 0, "读不到 ≠ 陈旧：把它当陈旧会在每次正常提交时报错");
  assert.equal(report.checked, 2);
});

// ---------------------------------------------------------------------------
// 4. 判据边界（不得读作更强的保证）
// ---------------------------------------------------------------------------

test("mtime 未变的情形检不出——这是已声明的盲区，不是缺陷", () => {
  const report = detectStaleModules({
    files: ["/edited-but-mtime-preserved.js"],
    startMs: 5_000,
    statMtimeMs: () => 1_000,
  });
  assert.equal(report.stale.length, 0, "mtime 规则看不到保留 mtime 的改动");
});

test("mtime 与进程启动同毫秒时按未陈旧处理（宁可漏报一次也不误报）", () => {
  const report = detectStaleModules({
    files: ["/same-ms.js"],
    startMs: 5_000,
    statMtimeMs: () => 5_000,
  });
  assert.equal(report.stale.length, 0);
});

test("全量检测报告带 start_ms 与 library_dir，便于调用方如实披露", () => {
  const report = detectStaleLibraryModules({ clock: { nowMs: 10_000_000, uptimeSec: 100 } });
  assert.equal(report.start_ms, 9_900_000);
  assert.ok(typeof report.library_dir === "string" && report.library_dir.endsWith("lib"));
});

test("processStartMs 由 now 减 uptime 反推（跨平台，不依赖 /proc）", () => {
  assert.equal(processStartMs({ nowMs: 10_000, uptimeSec: 3 }), 7_000);
});
