// Tests for plugin/lib/verification-run.js —
// 运行侧机械审核门（11 §18）。核心承诺有两条，本文件逐条钉住：
//   ① 「完成」不再是「落地被调用」，而是「逐行核对过、且没有未声明的缺口」；
//   ② 不可判的行必须显式声明——闭集里没有它的位置时最自然的处置就是填 pass，
//      而那正是要消除的失效形态。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VERDICTS,
  NOT_CHECKABLE_ROWS,
  MECHANICAL_ROWS,
  deriveRowId,
  parseVerificationRowIds,
  declaredVerificationIds,
  readVerificationRowIds,
  verifyRun,
} from "../lib/verification-run.js";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

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
  const rows = MECHANICAL_ROWS.map((id) => ({ id, verdict: "pass", evidence: `${id} 的证据` }));
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
  assert.match(String(recorded.reason), /not-checkable/);
});

test("(e2) 派发准入缺席时不阻断，但它必须以 not-checkable 出现或缺席，不得为 pass", () => {
  const rows = completeRows().filter((r) => r.id !== "派发准入");
  const noRow = verifyRun({ rows });
  assert.equal(noRow.stage, "landed", "该行缺席不影响结论（它无判定可作）");
  assert.ok("派发准入" in NOT_CHECKABLE_ROWS, "派发准入必须在声明表内，调用方据此填 not-checkable");
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
  assert.equal(missing.length, 1, "改行名后数量不变，但集合相等判据必须发现它");
});

// ---------------------------------------------------------------------------
// 完整性：缺席不是「没有问题」，是「没有证据」
// ---------------------------------------------------------------------------

test("空报告不得 landed（全不报 ≠ 全通过）", () => {
  const r = verifyRun({ rows: [] });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "blocked");
  assert.equal(r.missing.length, MECHANICAL_ROWS.length, "所有机械可核对行都应被列为缺席");
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
