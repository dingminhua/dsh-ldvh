// Tests for plugin/lib/triggers.js 的**采集侧**（§18「发起不构成执行完成」「主控发起的观察频次如实登记」）。
//
// ## 2026-11-17：本文件由「计时器清理采集」改为**机制删除守卫**
//
// 原文件测的是「计时器被清理时，`handleCleared` 是否如实反映真实清理」——那套
// 采集是为 11 §6.1 的安静期计时器服务的（第五轮复核用变异证明过它没有回归护栏，
// 故当时专门补了 `judgeClear` 的真实采集用例）。
//
// 计时器随触发锚改为「主控发起」而删除后，`judgeClear` / `clearSilenceTimer` 这套
// 采集**没有输入可采**：没有计时器就没有「被清理的句柄」，也就没有「采集是否自证」
// 这个问题。继续保留那些用例只会产生噪声或假通过。
//
// 故本文件改为守卫：断言那套采集**已随机制一并移除**，且 §18 的两条机械行仍在
// （它们描述的是「主控发起」下的新语义，不是计时器语义）。
import { test } from "node:test";
import assert from "node:assert/strict";

import * as triggers from "../lib/triggers.js";
import { MECHANICAL_ROWS } from "../lib/verification-run.js";

test("2026-11-17：计时器清理采集已随机制删除——`judgeClear` 不得再导出", () => {
  // 该函数唯一的语义是「判断计时器句柄是否真被清理」。没有计时器，它无从判断，
  // 留着一个恒真或恒假的实现会让读者以为清理仍被采集。
  assert.equal(triggers.judgeClear, undefined, "judgeClear 不得再存在（计时器已删除）");
});

test("§18 的两条机械行已按新语义改名（主控发起，而非计时器到期）", () => {
  // 这两行是 11 §18 表格与 verification-run 的机械对应项。改名不是文案偏好：
  // 旧名「延迟的取消」「二次确认空闲」描述的是计时器语义，留着会让复核者以为
  // 那两条判据仍在生效。
  const ids = MECHANICAL_ROWS.map((row) => row.id ?? row.key ?? row.name ?? row);
  assert.ok(
    ids.some((id) => String(id).includes("发起不构成执行完成")),
    "须有「发起不构成执行完成」这一行",
  );
  assert.ok(
    ids.some((id) => String(id).includes("主控发起的观察频次如实登记")),
    "须有「主控发起的观察频次如实登记」这一行",
  );
  for (const gone of ["延迟的取消", "二次确认空闲"]) {
    assert.ok(
      !ids.some((id) => String(id).includes(gone)),
      `旧行名「${gone}」不得残留（计时器语义）`,
    );
  }
});
