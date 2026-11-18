import { test } from "node:test";
import assert from "node:assert/strict";

import * as triggers from "../lib/triggers.js";
import { MECHANICAL_ROWS } from "../lib/verification-run.js";

test("2026-11-17：计时器清理采集已随机制删除——`judgeClear` 不得再导出", () => {
  assert.equal(triggers.judgeClear, undefined, "judgeClear 不得再存在（计时器已删除）");
});

test("§18 的两条机械行已按新语义改名（主控发起，而非计时器到期）", () => {
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
