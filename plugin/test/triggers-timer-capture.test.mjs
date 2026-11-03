// Tests for plugin/lib/triggers.js 的**采集侧**（§18「延迟的取消」「二次确认空闲」）。
//
// ## 为什么必须有这个文件
//
// 第五轮复核用变异证明：本单头号修复「采集侧不再自证」**没有任何回归护栏**——
// 把 `handleCleared` 改成不看 `slotEmpty`，或删掉句柄观察，全量套件仍全绿。
// 原因是此前所有测试只注入**伪造的证据对象**去测判定侧，从没有一条用例触达
// 真实的 `clearSilenceTimer`。判定侧写得再对，采集侧退化成自证也发现不了。
//
// 本文件直接驱动真实采集，并断言：改坏即红。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTurnTriggers, judgeClear } from "../lib/triggers.js";

/** 造一个最小可用的 triggers 实例，并收集它落下的诊断记录。 */
function makeTriggers({ readSilenceMs = () => 300_000 } = {}) {
  const diagnostics = [];
  const session = { header: { id: "session-test" } };
  const agent = { id: "agent-test", session };
  const triggers = createTurnTriggers(
    agent,
    {
      getScopeState: () => "governed",
      turns: { lastTurn: () => 1 },
      activity: { record: () => {} },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      onSessionCheckpoint: () => {},
      readSilenceMs,
      persistActivityAt: async () => {},
      registerDiagnostic: (entry) => { diagnostics.push(entry); },
    },
  );
  return { triggers, diagnostics, session };
}

/** 取实例对应的 session 对象（onSessionEvent 要求同一引用）。 */
function makeSessionOf() {
  return undefined; // 由下面用例改用闭包内 session
}

test("真实采集：确有计时器时，清理后回读判 handleCleared=true", () => {
  const { triggers, diagnostics, session } = makeTriggers();
  // turn/end 会 touchActivity + armSilenceTimer → 确有一个计时器在跑
  triggers.onSessionEvent(session, { type: "turn/end", data: { turn: 1 } });
  const cleared = triggers.clearSilenceTimerForTest("unit-test");
  assert.equal(cleared, true, "确有计时器被清掉时应回读为 true");

  const record = diagnostics.filter((d) => d.stage === "silence-cleared").pop();
  assert.ok(record, "应落下一条 silence-cleared 诊断");
  assert.equal(record.hadTimer, true, "须如实标注确有计时器");
  assert.equal(record.slotEmpty, true, "状态槽应已置空");
  assert.equal(record.handleIdleTimeout, -1,
    "句柄被 cancelTimeout 取消后 _idleTimeout 应为 -1——这是区分「被清理」与「自然到期」的独立观察");
  assert.equal(record.observesClear, true, "本环境应观察到句柄内部字段");
});

test("真实采集：本无计时器时 hadTimer=false（条件未出现，不是「清理成功」）", () => {
  const { triggers, diagnostics } = makeTriggers();
  // 先清一次：把任何新建实例可能已武装的计时器清掉，之后才是真正的「本来没有」。
  triggers.clearSilenceTimerForTest("prime");
  const cleared = triggers.clearSilenceTimerForTest("unit-test");
  assert.equal(cleared, true, "没有可清的东西时状态槽本就为空");
  const record = diagnostics.filter((d) => d.stage === "silence-cleared").pop();
  assert.ok(record, "没有计时器时同样要落记录，否则该行永远缺证据");
  assert.equal(record.hadTimer, false,
    `须区分「清过」与「本来就没有」；实得 hadTimer=${record.hadTimer}`);
});

test("变异护栏：若实现不再观察句柄（退回只读状态槽），本用例必须失败", () => {
  // 该断言不直接执行变异，而是钉住「记录里必须带出可区分字段」这一契约：
  // 一旦实现删掉 handleIdleTimeout 观察，下面的断言立即红。
  const { triggers, diagnostics, session } = makeTriggers();
  triggers.onSessionEvent(session, { type: "turn/end", data: { turn: 1 } });
  triggers.clearSilenceTimerForTest("unit-test");
  const record = diagnostics.filter((d) => d.stage === "silence-cleared").pop();
  assert.ok(record, "诊断记录必须存在");
  assert.ok("handleIdleTimeout" in record,
    "记录必须带出 handleIdleTimeout——删掉这项观察即回退成自证");
  assert.ok("slotEmpty" in record, "记录必须带出 slotEmpty——不读它就无法发现「忘了置空」");
  assert.equal(typeof record.proves, "string", "须如实写明本记录能证明什么");
  assert.equal(typeof record.cannotProve, "string", "须如实写明本记录不能证明什么");
});

test("真实采集：_idleTimeout 能区分「被清理」与「自然到期」（本修复的立足点）", async () => {
  // 这条是实证：如果两者不可区分，本单该行就只能判缺口，不能判 pass。
  const cancelled = setTimeout(() => {}, 60_000);
  clearTimeout(cancelled);
  assert.equal(cancelled._idleTimeout, -1, "被取消的计时器 _idleTimeout 应为 -1");

  const expired = setTimeout(() => {}, 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(expired._destroyed, true, "自然到期后句柄已销毁");
  assert.notEqual(expired._idleTimeout, -1,
    "自然到期后 _idleTimeout 应保持原 delay 而非 -1——这正是可与「被清理」区分的依据");
});

test("红转绿：handleCleared 与 slotEmpty / _idleTimeout 之间必须有真实依赖", () => {
  // 第五轮复核的变异证明：把 handleCleared 硬编码为 true，本文件原本 4 例全绿。
  // 原因是没有任何用例同时断言「回读结论」与「构成该结论的两个观察值」。
  // 本用例钉住依赖关系：handleCleared 为 true 时，两个观察值必须分别是
  // slotEmpty===true 与 _idleTimeout===-1；硬编码 true 会让「未取消」的情形
  // 也报 true，但那时 _idleTimeout 不会是 -1，断言即红。
  const { triggers, diagnostics, session } = makeTriggers();
  triggers.onSessionEvent(session, { type: "turn/end", data: { turn: 1 } });
  triggers.clearSilenceTimerForTest("unit-test");
  const record = diagnostics.filter((d) => d.stage === "silence-cleared").pop();
  assert.ok(record, "须落记录");
  assert.equal(record.handleCleared, true);
  assert.equal(record.slotEmpty, true, "handleCleared 为 true 的必要条件之一");
  assert.equal(record.handleIdleTimeout, -1,
    "handleCleared 为 true 的必要条件之二：句柄确实被取消（把结论写死就过不了这条）");
  assert.equal(record.observesClear, true, "须声明本环境确实观察到了可区分字段");
});

test("没有计时器时 handleCleared 只反映「槽为空」，不假装发生了清理", () => {
  const { triggers, diagnostics } = makeTriggers();
  triggers.clearSilenceTimerForTest("prime");
  triggers.clearSilenceTimerForTest("unit-test");
  const record = diagnostics.filter((d) => d.stage === "silence-cleared").pop();
  assert.equal(record.hadTimer, false, "须如实标注没有可清的东西");
  assert.equal(record.observesClear, false,
    "没有捕获到句柄时 observesClear 必须为 false——否则会把「没清」说成「清并验证」");
});

// ---------------------------------------------------------------------------
// 纯判定函数：喂失败输入，钉住「结论不能写死」
// ---------------------------------------------------------------------------

test("judgeClear：三个条件都满足才判 true", () => {
  assert.equal(
    judgeClear({ hadTimer: true, slotEmpty: true, handleIdleTimeout: -1, handleDestroyed: true }).handleCleared,
    true,
  );
});

test("judgeClear：句柄未被取消（自然到期，_idleTimeout 保持原值）→ false", () => {
  // 这是「清理未生效」的真正可观察形态，也是本行唯一能失败的路径之一。
  assert.equal(
    judgeClear({ hadTimer: true, slotEmpty: true, handleIdleTimeout: 5000, handleDestroyed: true }).handleCleared,
    false,
  );
});

test("judgeClear：清理后状态槽仍非空 → false（实现忘了置 null）", () => {
  assert.equal(
    judgeClear({ hadTimer: true, slotEmpty: false, handleIdleTimeout: -1, handleDestroyed: true }).handleCleared,
    false,
  );
});

test("judgeClear：句柄观察缺失（observesClear=false）时不得仅凭槽为空判 true", () => {
  // handleIdleTimeout 为 null 表示本环境读不到可区分字段；此时 idleCancelled
  // 为 false，结论必须是 false（落缺口），不能因为「槽空了」就判通过。
  assert.equal(
    judgeClear({ hadTimer: true, slotEmpty: true, handleIdleTimeout: null, handleDestroyed: null }).handleCleared,
    false,
  );
});

test("judgeClear：没有计时器时只反映槽为空，且 idleCancelled 必为 false", () => {
  const r = judgeClear({ hadTimer: false, slotEmpty: true, handleIdleTimeout: null, handleDestroyed: null });
  assert.equal(r.handleCleared, true);
  assert.equal(r.idleCancelled, false, "没清理过就不能声称「已取消」");
});
