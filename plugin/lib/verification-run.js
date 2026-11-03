/**
 * dsh-ldvh — 运行侧机械审核门（specs/11 §18）
 *
 * ## 本模块解决什么
 *
 * 运行痕迹里 `landed` 的语义一直是「**落地已调用**」（`idle-runlog.js:123`），
 * 不是「校验通过」。于是出现这类形态：一次运行每天都撞同一个错误（实测
 * 2026-11-03 的 `friction/object_not_found` 连续 8 次），而痕迹里 6 次记 `landed`
 * ——因为「落地被调用了」为真。**报的是调用事实，读的人却当成完成。**
 *
 * 本模块把「完成」改为**须过校验**：按 §18 逐行产出判定，`landed` 仅在
 * 「无 fail 且不存在未声明的 not-checkable」时成立。
 *
 * ## 三种 verdict，以及为什么必须有第三种
 *
 * `pass` / `fail` / `not-checkable`。第三值不是便利，是**防止默认通过**：
 * §18 有行（如「派发准入」）成立条件本身写着「本行当前不产生判定」——它既不是
 * 可核对，也不是判错，若闭集里没有它的位置，落地时最自然的处置就是填 `pass`。
 * 那正是本模块要消除的失效形态。
 *
 * **声明载体是 `NOT_CHECKABLE_ROWS`**：不可判的行必须**显式列入**并附理由，
 * 未列入者一律按 fail 之外的「阻断」处置。这样「声明为缺口」与「核对通过」在
 * 产物上分辨得出，而不取决于某次运行的善意。
 *
 * ## id 派生规则
 *
 * §18 表**没有 id 列**，首列同时含三种形态：
 *   - Markdown 粗体：`**阈值晋升**`；
 *   - 日期括注：`**转写条目的合法性（2026-11-01）**`；
 *   - 非日期括注：`延迟的取消（回合开始即清掉计时）`；
 *   - 全角斜线：`缓冲条目不可写／不可回读`。
 *
 * 规则是**去粗体、去括注、其余原样**（含全角斜线不归一——归一会让 id 与原文
 * 对不上，回读时无法定位回哪一行）。去括注后现有 22 行无碰撞（见测试）。
 *
 * ## 与 §18「验证时机」的关系（如实声明边界）
 *
 * §18 有些行的时机是「每次判断执行时」「每次写入后」——那是**动作点采集**，
 * 本模块在**运行结束时**核对，取的是该次运行留下的证据。故本模块证明的是
 * 「运行结束时这些行拿到了证据或已被声明为不可判」，**不证明**动作点上真的
 * 逐次采集过。该边界写在这里，不靠读者自行推断。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** verdict 闭集（§18 三值；第四值不存在，故本模块也不提供）。 */
export const VERDICTS = Object.freeze(["pass", "fail", "not-checkable"]);

/**
 * §18 中**不可机械判定**的行：id → 理由。
 *
 * 只有两类进这里：
 *   1. 成立条件本身写明「本行当前不产生判定」的（条件式空行）；
 *   2. 「验证入口」列写「AI 语义审核」的（语义判断，机械层不得代为裁决）。
 *
 * **机械可核对的四行不得列入**（「延迟的取消」「二次确认空闲」「路径约定落实」
 * 「无主控预检落实」）——它们的验证入口是回读、对照与核对，登记为 not-checkable
 * 等于免掉四道本可核对的闸门。该禁止同时写在工单 scope 与测试里。
 */
export const NOT_CHECKABLE_ROWS = Object.freeze({
  "派发准入": "本行当前不产生判定（§18 条件式）：§6.2 现不设任何准入约束，派发的准入由 §6.1 的进入契约界定；§6.2 重新引入约束时该行恢复效力",
  "经验对象的查重已执行": "验证入口为「AI 语义审核」（§18 该行原文）：查重结论属语义判断，机械层不代判（02 §9.2 不建立相似度自动裁决）",
});

/** 计时两行在「本轮无延迟形态计时」时的缺口理由（条件式不适用）。 */
/** 配置两行在「本轮无快照」时的缺口理由（条件式不适用）。 */
/**
 * 严格缺口标记：该行**本轮确实没有采集到证据**，填 `pass` 即为谎报。
 *
 * 与「条件式行」区分：条件式行在条件出现时**应当**给出真结论（含 pass），
 * 不能一并拦下。见 `verifyRun` 里 `isStrictDeferred` 的用法。
 */
export const DEFERRED_STRICT = "no-evidence-this-run";

/**
 * 把「本轮确实没有采集到证据」的缺口理由包装为严格缺口值。
 *
 * 严格缺口：填 `pass` 即为谎报，门禁须拦下。
 * 与之相对的「条件式行」直接给理由字符串——条件出现时应给出真结论（含 pass），
 * 不得一并拦下。区分见 `verifyRun` 的 `isStrictDeferred`。
 */
function strictReason(reason) {
  return `${DEFERRED_STRICT}::${reason}`;
}

/**
 * §18 中**机械可核对、但运行结束时的痕迹不足以充当证据**的行：id → 缺口理由。
 *
 * 这些行的「验证时机」是**动作点采集**（「每次判断执行时」「每次写入后」
 * 「每次回合开始时」等）——要在动作发生的那一刻取证据，而不是在运行结束后
 * 从痕迹倒推。运行结束时它们只能是 `not-checkable`。
 *
 * **与 `NOT_CHECKABLE_ROWS` 的分工**（关键区别）：
 *   - `NOT_CHECKABLE_ROWS`：该行**根本没有判定可作**（条件式空行 / 语义判断）。
 *   - 本表：该行**有判定可作**，只是本轮没有采集点。这是**已知缺陷**，不是设计。
 *
 * 故本表是**待清偿的缺口清单**，不是免责声明：每清掉一项就删一行。把它与
 * `NOT_CHECKABLE_ROWS` 混在一起，会让「没实现采集」与「本就不该有判定」变得
 * 无法区分——那正是 §18「不可判须显式声明」要防的。
 */
export const DEFERRED_ROWS = Object.freeze({
  // **条件式不适用**（不是没实现）：这两行的核对发生在计时到期那一刻，由
  // `triggers.js` 的 `trace("silence-expiry", …)` 判定并落诊断记录。本轮若根本没有
  // 计时发生（静置未到期），条件未出现——此时记 `not-checkable` 并写明成因，
  // **不得记 pass**（那会把「没有计时」说成「清理已验证」）。
  // 有计时发生时，`verifyReviewRun` 会从诊断记录取回真判定，这两行随之给出真结论。
  "上下文供给的有界性": strictReason("需在运行前记录交付区间与水位取值；痕迹只留结果，未留切分依据"),
  "逐字引证": strictReason("需在每次判断执行时核对引文确在交付材料内；运行结束时材料窗口已推进"),
  "自动动作边界": strictReason("需在每次动作执行前比对 §9／§10 闭集；痕迹无逐动作的比对记录"),
  "阈值晋升": strictReason("需在观察到同源条目时复算 pending 计数与幂等；运行结束时该组可能已被改写"),
  "留观缓冲条目的写入合法": strictReason("需在写入后立刻做字段闭集解析与逐字一致性核对；痕迹未保留写入当时的缓冲快照"),
  "摩擦观察条目的写入合法": strictReason("同上（§12bis.1 十四字段闭集与写后回读）"),
  "摩擦观察条目到期淘汰的登记": strictReason("需在淘汰发生的那一刻核对登记与查重；读时惰性结算不留现场"),
  "摩擦缓冲的准入合法性": strictReason("需在任何读写之前回读管辖状态与分区自洽；痕迹未记录该前置读取"),
  "单条目不成文两次": strictReason("需在创建前按当下重读 pending 状态并用 wx 原子创建；痕迹无认领文件当前状态的记录"),
  "水位推进": strictReason("需在运行结束时回读水位取值并与推进结果比对；该取值未被记录"),
  "交还的接受": strictReason("需等被下一个主控或 Human 接受；接受发生在本轮之后，本轮无从判定"),
  // 该行本身可机械核对（七段即 pitfall-writer 的 BODY_H2_REQUIRED），但
  // reviewOutcome.formed 只带 {entry_id, object_uid, file}，不含 body_valid
  // 回读结果，故运行结束时无证据（第三轮复核发现）。要真核它须让生产者把
  // 回读结论带出来。
  "经验对象的七段完整": strictReason("该行可机械核对（七段即 pitfall-writer 的 BODY_H2_REQUIRED），但 formed 只带 entry_id/object_uid/file，不含 body_valid 回读结果；须由生产者把回读结论带出后才能核"),
  "运行完成": strictReason("本行是本模块自身的核对结论（自证）；它由调用方按 trace 填入，本模块不给自己判 pass"),
});

/**
 * §18 的**可机械核对行**清单（20 行）。
 *
 * 与 `NOT_CHECKABLE_ROWS` 合起来共 22 行 = §18 数据行数。三者构成闭集：
 * 新增 §18 行而本模块不同步时，`verifyRunIds` 的集合相等测试会失败——这是
 * 有意的，使「规范加行而模块不加行」不可能静默发生。
 */
export const MECHANICAL_ROWS = Object.freeze([
  "延迟的取消",
  "二次确认空闲",
  "上下文供给的有界性",
  "逐字引证",
  "自动动作边界",
  "阈值晋升",
  "留观缓冲条目的写入合法",
  "摩擦观察条目的写入合法",
  "摩擦观察条目到期淘汰的登记",
  "摩擦缓冲的准入合法性",
  "缓冲条目不可写／不可回读",
  "转写条目的合法性",
  "经验对象的七段完整",
  "单条目不成文两次",
  "派发条目的判定完备",
  "fail-closed 处置",
  "水位推进",
  "路径约定落实",
  "无主控预检落实",
  "交还的接受",
  // 2026-11-03 增行：本表新增「运行完成」一行后行数由 22 变 23。
  // 这一行的核对对象就是本模块自身——它不能是 not-checkable（那是自证免检），
  // 也不该由本模块给自己判 pass（同样是自证）。故它列入机械行，由调用方
  // 填入基于运行痕迹的结论，本模块只负责确认它**出现过且未被误报**。
  "运行完成",
]);

/**
 * 从 §18 表格首列派生 id：去粗体、去括注、其余原样（含全角斜线不归一）。
 *
 * @param {string} raw - 表格首列原文（可含 `**` 与全角/半角括注）
 * @returns {string} 派生 id
 */
export function deriveRowId(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  // 去 Markdown 粗体：整串包裹或行内出现都剥掉
  s = s.replace(/\*\*/g, "");
  // 去括注：仅剥**尾部**的括注（全角或半角），中段括注属行名本身
  s = s.replace(/（[^（）]*）$/, "").replace(/\([^()]*\)$/, "");
  return s.trim();
}

/**
 * 解析 §18 表格，返回该表当前的 id 列表（顺序即表内顺序）。
 *
 * **为什么要解析规范而不是硬编码**：硬编码的 22 行会在规范增行时静默过期，
 * 而「规范加行、模块不加行」正是本模块要拦的形态之一。
 *
 * @param {string} specText - `specs/11-宿主辅助任务规范.md` 全文
 * @returns {string[]} id 列表
 */
export function parseVerificationRowIds(specText) {
  if (typeof specText !== "string") return [];
  const lines = specText.split("\n");
  // 定位 §18 的表格：表头含「验证对象」，随后是分隔行，再是数据行
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\|\s*验证对象\s*\|/.test(lines[i])) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return [];
  const ids = [];
  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\|/.test(line)) break;
    const firstCell = line.split("|")[1] ?? "";
    const id = deriveRowId(firstCell);
    if (id.length > 0) ids.push(id);
  }
  return ids;
}

/**
 * 逐行核对并给出运行结局。
 *
 * @param {object} args
 * @param {Array<{id:string, verdict:string, evidence?:string}>} args.rows - 本次运行收集到的逐行结论
 * @param {object} [args.notCheckable] - 声明为不可判的行（默认取 `NOT_CHECKABLE_ROWS`）
 * @returns {{ok:boolean, stage:"landed"|"blocked", rows:object[], fail:string[], undeclared:string[], declared:string[], misreported:string[], error?:object}}
 */
export function verifyRun({
  rows,
  notCheckable = NOT_CHECKABLE_ROWS,
  deferred = DEFERRED_ROWS,
  expectedMechanicalRows = MECHANICAL_ROWS,
} = {}) {
  if (!Array.isArray(rows)) {
    return {
      ok: false,
      stage: "blocked",
      rows: [],
      fail: [],
      undeclared: [],
      declared: [],
      misreported: [],
      missing: [],
      deferredRows: [],
      unknown: [],
      error: { code: "verification/invalid_rows", message: "rows must be an array of per-row verdicts" },
    };
  }

  const declaredSet = new Set(Object.keys(notCheckable ?? {}));
  // `deferred` 是**已知缺口清单**（有判定可作、但本轮无采集点）。它与
  // `notCheckable`（根本没有判定可作）在结论上必须区分：前者记入 `deferredRows`
  // 随痕迹带出，后者不阻断。两者都算「已声明」，故不落 undeclared——如实声明
  // 缺口不等于谎报通过。
  const deferredSet = new Set(Object.keys(deferred ?? {}));
  const mechanicalSet = new Set(expectedMechanicalRows);
  const normalized = [];
  const fail = [];
  const undeclared = [];
  const declared = [];
  /** 已声明「当前不产生判定」的行，却被填了 pass —— 这就是「默认通过」。 */
  const misreported = [];
  /** 闭集外的行 id —— 规范加了行而模块没同步时必经此处。 */
  const unknown = [];

  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const id = typeof row.id === "string" ? row.id : "";
    const verdict = typeof row.verdict === "string" ? row.verdict : "";
    if (id.length === 0) continue;
    if (!VERDICTS.includes(verdict)) {
      // 闭集外的 verdict 不得静默通过——它连「是什么」都说不清
      fail.push(id);
      normalized.push({ id, verdict: null, evidence: row.evidence ?? null, reason: "verdict is outside the closed set" });
      continue;
    }
    if (verdict === "fail") fail.push(id);
    if (verdict === "not-checkable") {
      if (declaredSet.has(id)) declared.push(id);
      else if (deferredSet.has(id)) declared.push(id);
      else undeclared.push(id);
    }
    // **「默认通过」的机械堵口**（2026-11-03 自查发现的第一版缺陷）：
    //
    // 第一版只拦「未声明的 not-checkable」，于是把「派发准入」这条明写
    // 「本行当前不产生判定」的行填成 `pass` 时，运行照样 landed——而它根本没被
    // 核对过。那正是本模块存在的理由被反过来用了。故：**已声明为不可判的行，
    // 若被填 pass，一律按 fail 处置**。它没有判定可作，填 pass 就是把「没核对」
    // 记成「核对通过」。
    // **「填 pass」的拦截必须同时覆盖 deferred 行**（2026-11-03 第三次复核）。
    //
    // 原只查 declaredSet，于是给 DEFERRED 行（同样「本轮没采集到证据」）填 pass
    // 仍判 landed——与给「派发准入」填 pass 是同一形态，却在门禁里漏掉。
    // DEFERRED 行按定义也是「声明为无法核对」，故与 NOT_CHECKABLE 同等拦截。
    // **未知 id 不得静默通过**（2026-11-03 第三次复核）：闭集外的新行若被填 pass
    // 而无声接受，就破坏了「新增 §18 行必须同步模块」这条约束——缺席检查只能
    // 发现「少报」，发现不了「多报」。此处把闭集外的 id 记为 fail。
    if (!declaredSet.has(id) && !deferredSet.has(id) && !mechanicalSet.has(id)) {
      unknown.push(id);
      fail.push(id);
      normalized.push({ id, verdict, evidence: row.evidence ?? null, reason: "this row id is not declared in the module's §18 row set; a new spec row must be synced into the module, not silently reported" });
      continue;
    }
    // **只对 NOT_CHECKABLE 拦「填 pass」**（2026-11-03 第三次复核后又修正）。
    //
    // DEFERRED 含两类，必须分开：
    //   ① 「本轮无采集点」——填 pass 是谎报，须拦；
    //   ② 「条件式行」——条件**出现**时本来就该给出真结论（含 pass）。
    // 一刀切会把②的正常结论也拦下（实测「二次确认空闲」在 turn-in-flight 时
    // 正确判 pass 却被误拦）。故由调用方通过 `deferred` 的取值区分：值为
    // `DEFERRED_STRICT` 的属①，其余属②。
    const isStrictDeferred = deferredSet.has(id) && String(deferred?.[id] ?? "").startsWith(DEFERRED_STRICT);
    if (verdict === "pass" && (declaredSet.has(id) || isStrictDeferred)) {
      misreported.push(id);
      fail.push(id);
    }
    normalized.push({
      id,
      verdict,
      evidence: typeof row.evidence === "string" ? row.evidence : (row.evidence ?? null),
      ...(verdict === "pass" && (declaredSet.has(id) || isStrictDeferred)
        ? { reason: "this row is declared unverifiable for this run (no verdict is producible); reporting it as pass would record an unchecked row as verified" }
        : {}),
    });
  }

  // **完整性堵口**（2026-11-03 复核自查发现的第二版缺陷）：
  //
  // 前两版只检查「报上来的行里有没有问题」，于是**把所有行都删掉**也能拿到
  // `landed`——一份空报告与一份全 pass 的报告在结论上无法区分，门禁形同虚设。
  // 这正是「默认通过」的另一种形态：不是把某行填成 pass，而是干脆不报。
  //
  // 故：**未被报告的可核对行视为未核对**，一律按 fail 处置。缺席不是「没有
  // 问题」，是「没有证据」。`missing` 带出具体缺了哪些行。
  // **缺席检查覆盖"应当被报"的全部行**（2026-11-03 复核第二轮 D 项）：
  // 不只是机械可核对行，也包含已声明不可判 / 已知缺口的行——它们同样必须
  // 以 `not-checkable` 出现。此前只查前者，于是「派发准入」这种已声明的行
  // 完全缺席时仍可 `landed`，与 §18「按本表逐行产出结论」不符。
  const reportedIds = new Set(normalized.map((r) => r.id));
  const expectedIds = [...new Set([...expectedMechanicalRows, ...declaredSet, ...deferredSet])];
  const missing = expectedIds.filter((id) => !reportedIds.has(id));
  for (const id of missing) {
    fail.push(id);
    normalized.push({
      id,
      verdict: "fail",
      evidence: null,
      reason: "no verdict was reported for this mechanically-checkable row; absence is not evidence of passing",
    });
  }

  // 已知缺口：本轮判为 not-checkable 且属 `deferred` 的行。随痕迹带出，
  // 使「本轮还有哪些行没真核对」在跑绿的同时也读得见——不许静默消失。
  const deferredRows = normalized.filter((r) => r.verdict === "not-checkable" && deferredSet.has(r.id)).map((r) => r.id);

  const ok = fail.length === 0 && undeclared.length === 0;
  return {
    ok,
    stage: ok ? "landed" : "blocked",
    rows: normalized,
    fail,
    undeclared,
    declared,
    misreported,
    missing,
    deferredRows,
    unknown,
  };
}

/**
 * 读取规范原文并返回 §18 的当前 id 列表（供测试与运行时一致性校验）。
 *
 * @param {string} projectPath - 仓库根
 * @returns {Promise<{ok:true, value:{ids:string[]}}|{ok:false, error:object}>}
 */
export async function readVerificationRowIds(projectPath) {
  try {
    const p = join(projectPath, "specs", "11-宿主辅助任务规范.md");
    const text = await readFile(p, "utf8");
    const ids = parseVerificationRowIds(text);
    if (ids.length === 0) {
      return { ok: false, error: { code: "verification/section_not_found", message: `§18 table not found in ${p}` } };
    }
    return { ok: true, value: { ids } };
  } catch (error) {
    return { ok: false, error: { code: "verification/spec_unreadable", message: String(error?.message ?? error) } };
  }
}

/**
 * 本模块声明的 id 集合（机械行 + 不可判行），供与 §18 实测集合比对。
 *
 * @returns {string[]}
 */
export function declaredVerificationIds() {
  return [...MECHANICAL_ROWS, ...Object.keys(NOT_CHECKABLE_ROWS)];
}
