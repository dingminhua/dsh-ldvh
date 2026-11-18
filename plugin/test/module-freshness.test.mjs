
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, statSync, utimesSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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

function setMtime(file, ms) {
  const sec = ms / 1000;
  utimesSync(file, sec, sec);
}


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
    const files = listLibraryModuleFiles(dir).map((f) => basename(f)).sort();
    assert.deepEqual(files, ["a.js", "b.js"]);
  });
});


test("VALIDATOR_MODULE_FILES 覆盖全部影响 precheck 结论的模块（扩面不得改变预检行为）", () => {
  assert.equal(VALIDATOR_MODULE_FILES.length, 3);
  assert.ok(VALIDATOR_MODULE_FILES.some((f) => basename(f) === "commit-validation.js"));
  assert.ok(VALIDATOR_MODULE_FILES.some((f) => basename(f) === "ldvh-tools.js"));
  assert.ok(VALIDATOR_MODULE_FILES.some((f) => basename(f) === "spec-registry.js"));
});

test("detectStaleValidatorModules 默认只检 VALIDATOR_MODULE_FILES 集合", () => {
  const report = detectStaleValidatorModules({ clock: { nowMs: 1_000_000, uptimeSec: 0, timeOriginMs: 1_000_000 } });
  assert.equal(report.checked, VALIDATOR_MODULE_FILES.length);
});


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
      clock: { nowMs: nowMs - 60_000, uptimeSec: 0, timeOriginMs: nowMs - 60_000 },
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
  const report = detectStaleLibraryModules({ clock: { nowMs: 10_000_000, uptimeSec: 100, timeOriginMs: 9_900_000 } });
  assert.equal(report.start_ms, 9_900_000);
  assert.ok(typeof report.library_dir === "string" && report.library_dir.endsWith("lib"));
});

test("复现 2026-11-15 的假陈旧：uptime 反推偏早 83 分钟时，新模块不得被判陈旧", () => {
  const realStart = 1_000_000_000;
  const skewMs = 4972 * 1000;
  const nowMs = realStart + 300_000;
  const moduleMtime = realStart - 10_000;

  const skewedUptime = (nowMs - (realStart - skewMs)) / 1000;
  const broken = processStartMs({ nowMs, uptimeSec: skewedUptime, timeOriginMs: null });
  assert.equal(broken, realStart - skewMs, "夹具须真的复现「反推值偏早」");
  assert.ok(moduleMtime > broken,
    "夹具须能复现「mtime 晚于反推值」这个误判前提：反推值偏早到把启动前的模块也判成陈旧");

  const fixed = processStartMs({ nowMs, uptimeSec: 300 + 4972, timeOriginMs: realStart });
  assert.equal(fixed, realStart, "须取到真实启动时刻");
  assert.ok(moduleMtime < fixed, "启动后改过的模块不得被判陈旧");
});

test("processStartMs 优先信任 timeOrigin（uptime 反推只在它缺失时兜底）", () => {
  assert.equal(processStartMs({ nowMs: 10_000, uptimeSec: 3, timeOriginMs: 9_500 }), 9_500,
    "两源都在时取较晚者");
  assert.equal(processStartMs({ nowMs: 10_000, uptimeSec: 3, timeOriginMs: 6_000 }), 7_000,
    "timeOrigin 更早时取 uptime 反推——偏早会制造假陈旧，故不让它胜出");
  assert.equal(processStartMs({ nowMs: 10_000, uptimeSec: 3, timeOriginMs: null }), 7_000,
    "timeOrigin 缺失时回退到 uptime 反推（跨平台兜底）");
  assert.equal(processStartMs({ nowMs: 10_000, uptimeSec: 3, timeOriginMs: Number.NaN }), 7_000,
    "timeOrigin 非法时同样回退，不抛");
});
