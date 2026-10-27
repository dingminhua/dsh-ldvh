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

test("lifecycle 写入的字段须能区分各结局（stage 的完整性）", async () => {
  const raw = await readFile(join(LIB, "lifecycle.js"), "utf8");
  // **扫描全部 recordRun 调用点**，不只第一处。
  //
  // 本测试原先把 `indexOf("await recordRun(dshHomePath, {")` 当唯一写入点，于是
  // 只管到第一处调用。2026-10 新增「派发准入闸」在更早的位置写了
  // `stage: "throttled"` 与另一处 `stopped`——该测试随即**失败**（它以为
  // stage 集合不全），而实际是它只看了一处。判据须覆盖所有写入点，否则
  // 「新增一个结局」会被误报成「漏了一个结局」。
  const calls = [];
  let from = 0;
  for (;;) {
    const start = raw.indexOf("await recordRun(dshHomePath, {", from);
    if (start < 0) break;
    calls.push(raw.slice(start, raw.indexOf("});", start)));
    from = start + 1;
  }
  assert.ok(calls.length >= 2, `至少应有两处运行痕迹写入点（找到 ${calls.length}）`);
  const all = calls.join("\n");

  // 每个结局都必须能表达，且**landed 与 skipped 必须可区分**（那正是本模块存在的理由）。
  for (const stage of ["stopped", "landed", "land-failed", "not-implemented", "skipped", "throttled"]) {
    assert.ok(all.includes(stage), `stage 须能表达「${stage}」——否则该结局不可分辨`);
  }
  assert.ok(all.includes("landed") && all.includes("skipped"), "landed 与 skipped 须可区分");

  // `throttled` 与 `stopped` 的区分是本闸的直接理由：前者是机制按配置歇着（下次
  // 仍会看），后者是坏了。故断言两者**出现在不同的调用点**，而非同一处二选一。
  const throttled = calls.filter((c) => c.includes("throttled"));
  const stopped = calls.filter((c) => c.includes('stage: "stopped"'));
  assert.ok(throttled.length >= 1, "须有一处专门的节流痕迹");
  assert.ok(stopped.length >= 1, "须有一处专门的停止痕迹");
  assert.ok(
    throttled.every((c) => !c.includes('stage: "stopped"')),
    "节流与停止不得同一处二选一——那会让两者在痕迹里无从区分",
  );
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
  // 落地失败、落地成功两条分支各自的可分辨痕迹
  assert.match(raw, /landedAction = "failed"/, "落地失败须被记录");
  assert.match(raw, /landedAction = landed\.value\.action/, "落地成功须被记录");
  assert.match(raw, /advancedTurn = pendingTurn/, "水位推进须被记录");
  // **`no-signature` 这个结局已删除**（2026-10-27 二次修订）：署名门槛按任务分别，
  // 缺署名不再阻止「不写事实对象」的落地，因此不再有「整块因缺签名不落地」这一
  // 结局可记。它改记为活动痕迹 `session/checkpoint/signature-unavailable`——
  // 那是「有判断产出却取不到署名」的诊断，不是一种落地结局。
  assert.match(
    raw,
    /session\/checkpoint\/signature-unavailable/,
    "取不到署名仍须留下可回读的诊断痕迹（它不再是落地结局，但仍不得静默）",
  );
  assert.equal(
    /landedAction = "no-signature"/.test(raw),
    false,
    "不得再有「整块缺签名不落地」这个结局——署名只对写事实对象的那一步前置",
  );
});
