// 接线验证：检查点的**结局**须被持久化（本轮新增的可观测性）。
//
// 背景：修复期间反复撞上同一盲区——「机制跑了但没发现东西」与「机制根本没跑」
// 从外部无从分辩（水位在两种情形下都会推进；activity 只存内存、重启即失）。
// 本测试守护那层可观测性的接线：每个结局分支都必须写一条运行痕迹。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

test("lifecycle 须在检查点路径上写运行痕迹（否则可观测性缺失）", async () => {
  const raw = await readFile(join(LIB, "lifecycle.js"), "utf8");
  assert.match(raw, /await recordRun\(dshHomePath, \{/, "检查点路径须写入运行痕迹");
});

test("lifecycle 写入的字段须能区分五种结局（stage 的完整性）", async () => {
  const raw = await readFile(join(LIB, "lifecycle.js"), "utf8");
  const start = raw.indexOf("await recordRun(dshHomePath, {");
  assert.ok(start >= 0, "未找到运行痕迹写入点");
  const call = raw.slice(start, raw.indexOf("});", start));
  for (const stage of ["stopped", "landed", "land-faild", "land-failed", "not-implemented", "skipped"]) {
    if (stage === "land-faild") continue; // 拼写陷阱，防手滑
    assert.ok(call.includes(stage), `stage 须能表达「${stage}」——否则该结局不可分辨`);
  }
  // 关键：landed 与 skipped 必须**可区分**（那正是本模块存在的理由）
  assert.ok(call.includes("landed") && call.includes("skipped"), "landed 与 skipped 须可区分");
});

test("运行痕迹的字段不得引用未定义的标识符（曾把 `at` 写成裸标识符）", async () => {
  const raw = await readFile(join(LIB, "lifecycle.js"), "utf8");
  const start = raw.indexOf("await recordRun(dshHomePath, {");
  const call = raw.slice(start, raw.indexOf("});", start));
  // `at,` 这种简写会在该作用域没有 at 时抛 ReferenceError——而它只在运行时暴露
  assert.ok(
    !/\bat\s*,/.test(call),
    "运行痕迹的 at 须显式给出（new Date().toISOString()），不得用简写引用作用域外的变量",
  );
  assert.match(call, /at:\s*new Date\(\)\.toISOString\(\)/);
});

test("每个结局分支都须给结局变量赋值（否则痕迹会缺失该结局）", async () => {
  const raw = await readFile(join(LIB, "lifecycle.js"), "utf8");
  // 落地失败、落地成功、无签名三条分支各自的可分辨痕迹
  assert.match(raw, /landedAction = "failed"/, "落地失败须被记录");
  assert.match(raw, /landedAction = landed\.value\.action/, "落地成功须被记录");
  assert.match(raw, /landedAction = "no-signature"/, "缺签名不落地须被记录");
  assert.match(raw, /advancedTurn = pendingTurn/, "水位推进须被记录");
});
