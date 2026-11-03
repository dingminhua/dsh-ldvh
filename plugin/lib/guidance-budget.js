// 引导面体量预算的机械承载（specs/10 §5.3）
//
// 权威：`specs/10 §5.3`「引导面」原文——
//
//   「**在宿主提供注入预算计量 API 之前**，预算控制由 LDVH 侧承担——引导文本
//     单一权威源，体量以**固定常量**承载，变更走受控提交」
//
// 现状（2026-10-23 核实）：`plugin/lib/guidance-text.js` 里**没有任何体量常量**，
// 也没有任何校验。即该条要求此前无机械承载：引导文本可以任意增长而无人发现。
//
// ## 本模块做什么
//
// 把三个 state 的引导正文体量钉成**显式常量**，并在超限时**拒绝**返回文本
// （返回 `ok: false`），而不是静默截断——截断会让 AI 收到半句话，比不注入更糟。
//
// ## 为什么是「拒绝」而非「截断」
//
// `10 §10.1` 第 3 项把「超出预算或与单一权威来源不一致」列为**必停**情形。
// 截断后继续注入等于把必停情形变成静默降级。故此处按必停语义处理。
//
// ## 常量的取值来源与边界
//
// 取值 = **当前实际体量向上取整**（2026-10-23 实测），故它首先是「防漂移的基线」，
// 而不是「Human 批准过的预算」。若日后要放宽，须改变更走受控提交（`10 §5.3` 原文
// 要求）——本模块不提供运行时调参入口，这是刻意的。
//
// ## 本模块**不能**证明什么
//
// - 不证明这些常量是「正确的」预算。它们只是当前基线；`10 §5.3` 未给出具体数值。
// - 不证明宿主侧计量（token）与字符预算等价——`10 §5.3` 明说宿主预算计量 API
//   尚未提供，故此处按字符计量是**权宜**，须如实披露（见 `billingBasis`）。
// - 不覆盖 `not_governed` 与 `unavailable` 之外的 state。

import { guidanceTextFor } from "./guidance-text.js";

/**
 * 各 state 的引导正文体量上限（UTF-16 码元，与仓内既有 200 字符预算同口径）。
 *
 * 2026-10-23 实测值向上取整 + 小量余量。**改动须走受控提交**（`10 §5.3`）。
 */
export const GUIDANCE_CHAR_BUDGET = Object.freeze({
  // 实测 1052（governed 全文含判定行；2026-10-25 受保护文本压缩后由 1288 降至
  // 1052——工单/提请三行压为两行、去掉语料依赖的 specs/21 指针，纪律本身未删）。
  // 常量 1500 保持不变：余量从 212 增至 448，压缩不该反向收紧上限。
  governed: 1500,
  // 实测远小于此；留足余量以免误拦。
  unavailable: 800,
  // not_governed 是一句话，预算宽松但仍有上限。
  not_governed: 400,
});

/**
 * 引导体量的**预警带**（实现自选阈值，非规范数值）。
 *
 * ## 为什么需要它（2026-11-03，friction-f9a66474 的处置）
 *
 * 早前的守卫把「governed 引导体量」钉成**具体码元数**（1288 → 1052）。该断言与
 * `00 §4.3`「受保护文档须形成只含该文档的独立提交」构成**程序死锁**：改动
 * `plugin/lib/guidance-text.js` 必然让那条断言转红，而同步断言的文件又不能进入
 * 同一个提交——两者在同一改动上无法同时满足，每次引导文本改动都要停下来请
 * Human 三选一（`friction-f9a66474`）。
 *
 * 拆开的方式：**受保护载体不再与某个精确数字绑定**。这里只保留两个判据——
 *   1. **硬上限**由 `GUIDANCE_CHAR_BUDGET` 承担（超出即 `ok:false`，必停语义），
 *      该常量与受保护文本分处两个文件，其值由 Human 在受控提交里定；
 *   2. **预警带**（本常量）只作提前量：体量逼近上限时先转红一次，让「要不要放宽
 *      预算」这个 Human 决定在越界之前被提出，而不是越界之后才被动触发必停。
 *
 * 于是一次**在带内的**受保护文本改动不再需要动任何测试文件，独立提交即可全绿；
 * 越过预警带才需要与 Human 讨论预算，那是 `10 §5.3`／`§9.1` 第 2 项本来就要求
 * Human 决定的事，不是本守卫额外制造的停顿。
 *
 * 0.9 是**本实现选定的提前量**，规范未规定数值：它把「还剩 10% 余量」作为预警
 * 线，既给出一次成规模改动仍可安全落盘的空间，又不至于让上限形同虚设。
 */
export const GUIDANCE_EARLY_WARNING_RATIO = 0.9;

/**
 * 体量是否仍在预警带内（含边界）。
 *
 * 抽成函数而非在断言里重复算式：预警带既是实现自选的阈值，就必须能被**用合成
 * 数值**独立验证——若只能在真实引导文本上调，则本判据的检测力永远无法与语料
 * 解耦（`06 §5` 形状断言须有单项变异可转红）。
 */
export function isWithinEarlyWarningBand(length, budget) {
  if (typeof length !== "number" || typeof budget !== "number" || budget <= 0) return false;
  return length <= budget * GUIDANCE_EARLY_WARNING_RATIO;
}

/** 超预算时的错误码（`10 §10.1` 第 3 项的必停语义）。 */
export const GUIDANCE_BUDGET_EXCEEDED_CODE = "guidance/budget_exceeded";

/**
 * 纯函数形式的体量判定——**不读任何模块状态**，故可用合成数值直接验证。
 *
 * 此前体量判定整体埋在 `buildGuidance` 里，超限路径只能靠「读源码文本匹配
 * `ok: false`」这种间接手段证明（`06 §5`「源码文本断言只能证明该形态当前存在」
 * ——它证明不了「超预算时真的拒绝而不是截断」）。抽出本函数后，拒绝路径与预警
 * 路径都能用**自造数值**直接断言，守卫的检测力不再依赖真实语料。
 *
 * @param {number} length 实测体量（UTF-16 码元）
 * @param {number} budget 该 state 的常量预算
 * @param {string} [stateLabel] 仅用于错误文案
 */
export function evaluateGuidanceSize(length, budget, stateLabel = "引导") {
  if (typeof length !== "number" || !Number.isFinite(length)
    || typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) {
    return {
      ok: false,
      error: {
        code: "guidance/invalid_measurement",
        message: `体量与预算须为正有限数值（实测 ${String(length)}，预算 ${String(budget)}）`,
      },
      length,
      budget,
    };
  }
  if (length > budget) {
    return {
      ok: false,
      error: {
        code: GUIDANCE_BUDGET_EXCEEDED_CODE,
        message: `引导体量 ${length} 超出 ${stateLabel} 的常量预算 ${budget}（10 §5.3 要求体量以固定常量承载；10 §10.1 第 3 项把超预算列为必停情形）`,
      },
      length,
      budget,
      overBy: length - budget,
    };
  }
  return {
    ok: true,
    length,
    budget,
    remaining: budget - length,
    earlyWarningCeiling: Math.floor(budget * GUIDANCE_EARLY_WARNING_RATIO),
    withinEarlyWarning: isWithinEarlyWarningBand(length, budget),
  };
}

/** 计量口径的如实披露。 */
export const GUIDANCE_BILLING_BASIS = Object.freeze({
  unit: "UTF-16 code unit",
  // 10 §5.3 原文：在宿主提供注入预算计量 API 之前，预算控制由 LDVH 侧承担。
  hostMeteringAvailable: false,
  note: "按字符计量是权宜；宿主 token 计量 API 尚未提供（10 §5.3）",
});

/**
 * **体量记录值**——只作漂移报警的**参照**，不是断言的期望值。
 *
 * ## 为什么它不是断言期望值（2026-11-03，friction-f9a66474 的处置）
 *
 * 若把它当作测试断言的期望值，则「改动 `plugin/lib/guidance-text.js`（受保护
 * 文本）」与「同步该期望值」必然落在两个提交里——`00 §4.3` 要求受保护文本的改动
 * 形成**只含该文档的独立提交**，测试文件不能进同一个提交，于是两者互斥、每次
 * 改动都停在「需 Human 三选一」（`friction-f9a66474`）。
 *
 * 故本记录**只用于运行时报警**：实测体量与记录值不一致时，把差异报出来
 * （`guidance.js` 写日志并挂 `scope.guidanceLengthDrift`），**不阻断**本次改动。
 * 于是一次带内的受保护文本改动可以独立成一个提交且全绿；记录值的同步是随后的
 * 普通提交（不必与受保护提交合并），落后期间由报警如实显示「记录 1052 → 实测 X」。
 *
 * 更新本记录属普通（非受保护）文件改动，不受 `00 §4.3` 约束。
 */
export const GUIDANCE_MEASURED_LENGTH = Object.freeze({
  // 2026-11-03 实测（基线提交见该次同步提交）：1052（此前 1288，2026-10-25
  // 受保护文本压缩所致）。
  governed: 1052,
  unavailable: 323,
  not_governed: 90,
});

/**
 * 纯函数：把「实测体量」与「记录体量」作差，返回漂移结论。
 *
 * 抽成纯函数是为了能用**合成数值**验证其判定逻辑（`06 §5` 形状断言须有单项
 * 变异可转红），不与真实语料耦合。
 *
 * @returns {{drifted: boolean, measured: number, recorded: number|null, delta: number|null}}
 */
export function guidanceLengthDrift(measured, recorded) {
  if (typeof recorded !== "number" || !Number.isFinite(recorded)) {
    return { drifted: false, measured, recorded: null, delta: null };
  }
  if (typeof measured !== "number" || !Number.isFinite(measured)) {
    return { drifted: false, measured, recorded, delta: null };
  }
  const delta = measured - recorded;
  return { drifted: delta !== 0, measured, recorded, delta };
}

/**
 * 汇总某个 state 的体量体检报告：预算判定 + 漂移报警。
 *
 * @returns {{state: string, length: number, budget: number, ok: boolean,
 *   error?: object, remaining?: number, withinEarlyWarning?: boolean,
 *   earlyWarningCeiling?: number, drift: {drifted: boolean, measured: number,
 *   recorded: number|null, delta: number|null}}}
 */
export function reportGuidanceSize(state) {
  const key = GUIDANCE_CHAR_BUDGET[state] === undefined ? "not_governed" : state;
  const budget = GUIDANCE_CHAR_BUDGET[key];
  const length = guidanceTextFor(state).length;
  const verdict = evaluateGuidanceSize(length, budget, key);
  const drift = guidanceLengthDrift(length, GUIDANCE_MEASURED_LENGTH[key]);
  if (!verdict.ok) {
    return { state: key, length, budget, ok: false, error: verdict.error, drift };
  }
  return {
    state: key,
    length,
    budget,
    ok: true,
    remaining: verdict.remaining,
    withinEarlyWarning: verdict.withinEarlyWarning,
    earlyWarningCeiling: verdict.earlyWarningCeiling,
    drift,
  };
}

/**
 * 把体量体检报告转成**告警项**（纯函数，故可用合成数值直接验证）。
 *
 * 两类告警，**都不阻断注入**：
 *   · `drift`：实测体量与记录值不一致——提醒同步 `GUIDANCE_MEASURED_LENGTH`；
 *   · `nearBudget`：体量越过预警线但未越硬上限——提醒 Human 复核预算常量。
 *
 * 唯一阻断的是**越过硬上限**（`ok:false`，`10 §10.1` 第 3 项必停）。
 *
 * 为什么告警不阻断：受保护文本（`plugin/lib/guidance-text.js`）的合法改动若因
 * 任何体量判据而无法独立成一个绿提交，就等于把 `00 §4.3` 与守卫又绑回一起
 * （friction-f9a66474 的同一个死结）。真正必须停的是「注入内容超预算」，
 * 那已经在 `ok:false` 路径上。
 *
 * @param {object} report `reportGuidanceSize` 的返回值
 * @returns {{drift?: object, nearBudget?: object}}
 */
export function guidanceSizeAlerts(report) {
  const alerts = {};
  const drift = report?.drift;
  if (drift?.drifted === true) {
    alerts.drift = {
      state: report.state,
      measured: drift.measured,
      recorded: drift.recorded,
      delta: drift.delta,
      message: `引导体量漂移：${report.state} 实测 ${drift.measured}，记录 ${drift.recorded}（差 ${drift.delta}）。记录值仅作报警参照，不阻断注入；请在后续普通提交中同步 GUIDANCE_MEASURED_LENGTH。`,
    };
  }
  if (report?.ok === true && report.withinEarlyWarning === false) {
    alerts.nearBudget = {
      state: report.state,
      length: report.length,
      budget: report.budget,
      earlyWarningCeiling: report.earlyWarningCeiling,
      message: `引导体量逼近预算上限：${report.state} 实测 ${report.length} / 预算 ${report.budget}（预警线 ${report.earlyWarningCeiling}）。尚未越限，注入照常；是否放宽预算常量须经 Human 决定（10 §5.3）。`,
    };
  }
  return alerts;
}

/**
 * 取引导文本并核对体量。
 *
 * @returns {{ok: true, text: string, length: number, budget: number, remaining: number,
 *        withinEarlyWarning: boolean, earlyWarningCeiling: number}}
 *       或 `{ok: false, error: {code, message}, length, budget}`——超限即拒绝注入，
 *       对应 `10 §10.1` 第 3 项的必停语义，不静默截断。
 */
export function buildGuidance(state) {
  const key = GUIDANCE_CHAR_BUDGET[state] === undefined ? "not_governed" : state;
  const budget = GUIDANCE_CHAR_BUDGET[key];
  const text = guidanceTextFor(state);
  const length = text.length;
  const verdict = evaluateGuidanceSize(length, budget, key);
  if (!verdict.ok) return verdict;
  return {
    ok: true,
    text,
    length,
    budget,
    remaining: verdict.remaining,
    earlyWarningCeiling: verdict.earlyWarningCeiling,
    withinEarlyWarning: verdict.withinEarlyWarning,
  };
}
