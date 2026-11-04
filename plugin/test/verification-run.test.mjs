// Tests for plugin/lib/verification-run.js —
// 运行侧机械审核门（11 §18）。核心承诺有两条，本文件逐条钉住：
//   ① 「完成」不再是「落地被调用」，而是「逐行核对过、且没有未声明的缺口」；
//   ② 不可判的行必须显式声明——闭集里没有它的位置时最自然的处置就是填 pass，
//      而那正是要消除的失效形态。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  VERDICTS,
  NOT_CHECKABLE_ROWS,
  MECHANICAL_ROWS,
  deriveRowId,
  parseVerificationRowIds,
  declaredVerificationIds,
  readVerificationRowIds,
  verifyRun,
  DEFERRED_ROWS,
  DEFERRED_STRICT,
} from "../lib/verification-run.js";

// **必须用 fileURLToPath，不能用 url.pathname**（2026-11-04 修，Windows 专属）。
// `new URL(...).pathname` 在 Windows 上给出 `/D:/DshProject/dsh-ldvh`——带一个前导
// 斜杠；再经 `path.join` 拼接就变成 `D:\D:/DshProject/...`，`readFile` 报 ENOENT，
// 于是本文件两条一致性用例在本机恒红，且报错里那个重复盘符极易被误读成产品缺陷。
// POSIX 上 pathname 恰好可用，所以这个写法长期没被发现。
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// ---------------------------------------------------------------------------
// id 派生规则：四种首列形态
// ---------------------------------------------------------------------------

test("id 派生：去 Markdown 粗体", () => {
  assert.equal(deriveRowId("**阈值晋升**"), "阈值晋升");
  assert.equal(deriveRowId("**摩擦观察条目的写入合法**"), "摩擦观察条目的写入合法");
});

test("id 派生：去日期括注", () => {
  assert.equal(deriveRowId("**转写条目的合法性（2026-11-01）**"), "转写条目的合法性");
});

test("id 派生：去非日期括注", () => {
  assert.equal(deriveRowId("延迟的取消（回合开始即清掉计时）"), "延迟的取消");
});

test("id 派生：全角斜线原样保留，不归一", () => {
  // 归一会让 id 与规范原文对不上，回读时无法定位回哪一行
  assert.equal(deriveRowId("缓冲条目不可写／不可回读"), "缓冲条目不可写／不可回读");
  assert.notEqual(deriveRowId("缓冲条目不可写／不可回读"), "缓冲条目不可写/不可回读");
});

test("id 派生：中段括注属行名本身，不剥", () => {
  assert.equal(deriveRowId("fail-closed 处置"), "fail-closed 处置");
});

// ---------------------------------------------------------------------------
// 与规范的一致性：22 行、无碰撞、集合相等
// ---------------------------------------------------------------------------

test("§18 解析出 23 行且 id 无碰撞（2026-11-03 增「运行完成」后 22→23）", async () => {
  const read = await readVerificationRowIds(REPO_ROOT);
  assert.equal(read.ok, true, read.ok ? "" : JSON.stringify(read.error));
  const ids = read.value.ids;
  assert.equal(ids.length, 23, `§18 数据行应为 23 行，实测 ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, "去括注后 id 出现碰撞");
});

test("模块声明的 id 集合与 §18 实测集合相等（规范加行而模块不加行时失败）", async () => {
  const read = await readVerificationRowIds(REPO_ROOT);
  assert.equal(read.ok, true);
  const specIds = new Set(read.value.ids);
  const moduleIds = new Set(declaredVerificationIds());

  const missingInModule = [...specIds].filter((id) => !moduleIds.has(id));
  const extraInModule = [...moduleIds].filter((id) => !specIds.has(id));
  assert.deepEqual(missingInModule, [], `§18 有而这些行模块未声明：${missingInModule.join("、")}`);
  assert.deepEqual(extraInModule, [], `模块声明了 §18 里不存在的行：${extraInModule.join("、")}`);
});

test("机械行与不可判行不重叠，且合计 23", () => {
  const mechanical = new Set(MECHANICAL_ROWS);
  const notCheckable = new Set(Object.keys(NOT_CHECKABLE_ROWS));
  const overlap = [...mechanical].filter((id) => notCheckable.has(id));
  assert.deepEqual(overlap, [], `同一行不能既机械可核对又不可判：${overlap.join("、")}`);
  assert.equal(mechanical.size + notCheckable.size, 23);
});

test("四道机械可核对行不得登记为 not-checkable", () => {
  // 11 §18 该四行的验证入口是回读、对照与核对——登记为不可判等于免掉四道闸门
  for (const id of ["延迟的取消", "二次确认空闲", "路径约定落实", "无主控预检落实"]) {
    assert.equal(id in NOT_CHECKABLE_ROWS, false, `${id} 属机械可核对行，不得列入 NOT_CHECKABLE_ROWS`);
    assert.ok(MECHANICAL_ROWS.includes(id), `${id} 应出现在 MECHANICAL_ROWS`);
  }
});

test("派发准入以 not-checkable 声明且带理由（防止默认填 pass）", () => {
  assert.ok("派发准入" in NOT_CHECKABLE_ROWS, "派发准入必须显式声明为不可判");
  const reason = NOT_CHECKABLE_ROWS["派发准入"];
  assert.match(reason, /本行当前不产生判定/);
});

// ---------------------------------------------------------------------------
// verifyRun：landed 的成立条件
// ---------------------------------------------------------------------------

/** 造一份「全部可核对行 pass、不可判行已声明」的齐备输入。 */
function completeRows() {
  // 已知缺口行（deferred）必须报 not-checkable —— 它们按定义「本轮没采集到证据」，
  // 填 pass 会被门禁当「默认通过」拦下（2026-11-03 第三次复核修）。
  const rows = MECHANICAL_ROWS.map((id) => ({
    id,
    verdict: DEFERRED_ROWS[id] ? "not-checkable" : "pass",
    evidence: DEFERRED_ROWS[id] ?? `${id} 的证据`,
  }));
  for (const id of Object.keys(NOT_CHECKABLE_ROWS)) {
    rows.push({ id, verdict: "not-checkable", evidence: NOT_CHECKABLE_ROWS[id] });
  }
  return rows;
}

test("(a) 全部可核对行 pass、语义行与无判定行均已声明 → landed", () => {
  const r = verifyRun({ rows: completeRows() });
  assert.equal(r.ok, true);
  assert.equal(r.stage, "landed");
  assert.deepEqual(r.fail, []);
  assert.deepEqual(r.undeclared, []);
});

test("(b) 任一可核对行 fail → 不为 landed，且带出该行 id 与 evidence", () => {
  const rows = completeRows();
  const target = rows.find((r) => r.id === "逐字引证");
  target.verdict = "fail";
  target.evidence = "引证不在窗口内";
  const r = verifyRun({ rows });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "blocked");
  assert.deepEqual(r.fail, ["逐字引证"]);
  const recorded = r.rows.find((x) => x.id === "逐字引证");
  assert.equal(recorded.verdict, "fail");
  assert.equal(recorded.evidence, "引证不在窗口内");
});

test("(c) 存在未声明的 not-checkable 行 → 不为 landed", () => {
  const rows = completeRows();
  rows.push({ id: "某条未被声明的行", verdict: "not-checkable" });
  const r = verifyRun({ rows });
  assert.equal(r.stage, "blocked");
  assert.deepEqual(r.undeclared, ["某条未被声明的行"]);
});

test("(d) 已声明的 not-checkable 不阻断", () => {
  const r = verifyRun({ rows: completeRows() });
  assert.equal(r.stage, "landed");
  assert.ok(r.declared.includes("派发准入"));
});

test("(e) 把已声明为不可判的行填成 pass → 阻断（这就是「默认通过」）", () => {
  // 第一版实现的漏洞：只拦「未声明的 not-checkable」，于是把「派发准入」
  //（成立条件明写「本行当前不产生判定」）填成 pass 时照样 landed——
  // 而它根本没被核对过。该用例正是钉住这个漏洞。
  const rows = completeRows().map((r) => (r.id === "派发准入" ? { ...r, verdict: "pass" } : r));
  const r = verifyRun({ rows });
  assert.equal(r.ok, false, "已声明不可判的行被填 pass 时必须阻断");
  assert.equal(r.stage, "blocked");
  assert.deepEqual(r.misreported, ["派发准入"]);
  const recorded = r.rows.find((x) => x.id === "派发准入");
  assert.match(String(recorded.reason), /unverifiable|not-checkable/);
});

test("(e2) 派发准入完全缺席 → 阻断（缺席既非 pass 也非声明）", () => {
  // 2026-11-03 复核第二轮 D 项：此前只对机械可核对行查缺席，于是「派发准入」
  // 完全不报也能 landed。§18「按本表逐行产出结论」要求它必须出现（以
  // not-checkable 出现），缺席是报告不完整。
  const rows = completeRows().filter((r) => r.id !== "派发准入");
  const r = verifyRun({ rows });
  assert.equal(r.stage, "blocked");
  assert.deepEqual(r.missing, ["派发准入"]);
});

test("闭集外的 verdict 一律按阻断处置，不静默通过", () => {
  const rows = completeRows();
  rows.push({ id: "某行", verdict: "passed" });
  const r = verifyRun({ rows });
  assert.equal(r.stage, "blocked");
  assert.ok(r.fail.includes("某行"));
});

test("VERDICTS 闭集恰为三值（无第四值）", () => {
  assert.deepEqual([...VERDICTS], ["pass", "fail", "not-checkable"]);
});

test("rows 非数组时返回 blocked 而不是伪装成通过", () => {
  const r = verifyRun({ rows: null });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "blocked");
  assert.equal(r.error.code, "verification/invalid_rows");
});

test("增行不同步必然失败：在解析出的行里加一行而模块不跟进 → 集合不等", () => {
  // 这条不依赖真实规范状态，直接验证「集合相等」这一判据本身有效：
  // 若规范多出一行而模块没声明，missingInModule 非空。
  const fakeIds = [...declaredVerificationIds(), "某个新增但未声明的行"];
  const moduleIds = new Set(declaredVerificationIds());
  const missingInModule = fakeIds.filter((id) => !moduleIds.has(id));
  assert.deepEqual(missingInModule, ["某个新增但未声明的行"]);
});

test("改行名而数量不变也会失败：id 集合相等不是数量比较", () => {
  const ids = declaredVerificationIds();
  const renamed = ["某个改名后的行", ...ids.slice(1)];
  const moduleIds = new Set(ids);
  const missing = renamed.filter((id) => !moduleIds.has(id));
  // 只断言条数会放过「丢一个、多一个」的互换；必须指出丢的是哪一个。
  assert.deepEqual(missing, ["某个改名后的行"], "改行名后数量不变，但集合相等判据必须发现它");
});

// ---------------------------------------------------------------------------
// 完整性：缺席不是「没有问题」，是「没有证据」
// ---------------------------------------------------------------------------

test("空报告不得 landed（全不报 ≠ 全通过）", () => {
  const r = verifyRun({ rows: [] });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "blocked");
  assert.ok(r.missing.length >= MECHANICAL_ROWS.length, "所有机械可核对行都应被列为缺席");
  assert.ok(r.missing.includes("派发准入"), "已声明不可判的行同样必须出现，缺席也算不完整");
});

test("少报一行可核对行即阻断", () => {
  const rows = completeRows().filter((r) => r.id !== "逐字引证");
  const r = verifyRun({ rows });
  assert.equal(r.stage, "blocked");
  assert.deepEqual(r.missing, ["逐字引证"]);
});

test("缺席行的 reason 明确说明「缺席不等于通过」", () => {
  const r = verifyRun({ rows: [] });
  const one = r.rows.find((x) => x.id === "逐字引证");
  assert.equal(one.verdict, "fail");
  assert.match(String(one.reason), /absence is not evidence of passing/);
});

test("完整报告仍 landed（完整性检查不误伤）", () => {
  const r = verifyRun({ rows: completeRows() });
  assert.equal(r.stage, "landed");
  assert.deepEqual(r.missing, []);
});

// ---------------------------------------------------------------------------
// 已知缺口（DEFERRED_ROWS）与「没有判定可作」（NOT_CHECKABLE_ROWS）必须可分
// ---------------------------------------------------------------------------

test("DEFERRED_ROWS 与 NOT_CHECKABLE_ROWS 不重叠，且与机械行互补成全集", () => {
  const mechanical = new Set(MECHANICAL_ROWS);
  const deferred = new Set(Object.keys(DEFERRED_ROWS));
  const notCheckable = new Set(Object.keys(NOT_CHECKABLE_ROWS));
  for (const id of deferred) {
    assert.equal(notCheckable.has(id), false, `${id} 不能既「无采集点」又「无判定可作」`);
    assert.equal(mechanical.has(id), true, `${id} 应属机械可核对行（只是本轮无采集点）`);
  }
  // 机械行 = 有采集点的 + 已知缺口 + 「无判定可作」的语义行。
  // 有采集点者不在任何声明表里（它们本来就该报 pass），故用不等式：声明表只能更小。
  assert.ok(deferred.size + notCheckable.size <= mechanical.size, "声明表不应超出机械行集合");
  assert.ok(deferred.size > 0, "已知缺口清单不应为空（否则「没采集点」会被误当「没这回事」）");
});

test("已声明的已知缺口不阻断，但必须随痕迹带出（不许静默消失）", () => {
  const rows = MECHANICAL_ROWS.map((id) => ({
    id,
    verdict: DEFERRED_ROWS[id] ? "not-checkable" : "pass",
  }));
  for (const id of Object.keys(NOT_CHECKABLE_ROWS)) rows.push({ id, verdict: "not-checkable" });
  const r = verifyRun({ rows });
  assert.equal(r.stage, "landed");
  assert.deepEqual(r.undeclared, []);
  assert.ok(r.deferredRows.length > 0, "已知缺口必须列出，否则「没核对」就不出现在痕迹里");
  assert.equal(r.deferredRows.length, Object.keys(DEFERRED_ROWS).length);
});

test("未声明的 not-checkable 仍阻断（已知缺口清单不是万能免责）", () => {
  const rows = MECHANICAL_ROWS.map((id) => ({
    id,
    verdict: DEFERRED_ROWS[id] ? "not-checkable" : "pass",
  }));
  for (const id of Object.keys(NOT_CHECKABLE_ROWS)) rows.push({ id, verdict: "not-checkable" });
  rows.push({ id: "趁隙冒充的行", verdict: "not-checkable" });
  const r = verifyRun({ rows });
  assert.equal(r.stage, "blocked");
  assert.deepEqual(r.undeclared, ["趁隙冒充的行"]);
});

// ---------------------------------------------------------------------------
// 严格缺口 vs 条件式行：两类「不可核对」的拦截规则不同
// ---------------------------------------------------------------------------

test("严格缺口行填 pass → 阻断（本轮确实没证据，填 pass 即谎报）", () => {
  const rows = completeRows().map((r) => (r.id === "水位推进" ? { ...r, verdict: "pass" } : r));
  const r = verifyRun({ rows });
  assert.equal(r.stage, "blocked");
  assert.deepEqual(r.misreported, ["水位推进"]);
});

test("条件式行填 pass → 不阻断（条件出现时本就该给真结论）", () => {
  // 「延迟的取消」等四行是条件式：有证据时应能给出 pass，不得被一并拦下。
  const rows = completeRows().map((r) => (r.id === "延迟的取消" ? { ...r, verdict: "pass" } : r));
  const r = verifyRun({ rows });
  assert.equal(r.stage, "landed", `fail=${JSON.stringify(r.fail)} misreported=${JSON.stringify(r.misreported)}`);
});

test("缺口表内的行现在全部是严格缺口（四行条件式已有真采集点，已移出）", () => {
  // 2026-11-03：Human 选「补真正的采集点」后，延迟的取消／二次确认空闲／
  // 路径约定落实／无主控预检落实 四行都有了可证伪的采集点，故**不再**登记为
  // 缺口（scope 第 5 条也明令不得登记）。留下的应全部是严格缺口。
  const entries = Object.entries(DEFERRED_ROWS);
  assert.ok(entries.length > 0, "缺口表不应为空");
  for (const [id, v] of entries) {
    assert.ok(String(v).startsWith(DEFERRED_STRICT), `${id} 应为严格缺口（带标记）`);
  }
  for (const id of ["延迟的取消", "二次确认空闲", "路径约定落实", "无主控预检落实"]) {
    assert.equal(DEFERRED_ROWS[id], undefined, `${id} 已有采集点，不应再留在缺口表`);
  }
});

test("未知 id 填 pass → 阻断（闭集外的新行必须同步进模块，不得静默通过）", () => {
  const rows = [...completeRows(), { id: "某个未来才有的行", verdict: "pass" }];
  const r = verifyRun({ rows });
  assert.equal(r.stage, "blocked");
  assert.deepEqual(r.unknown, ["某个未来才有的行"]);
});
