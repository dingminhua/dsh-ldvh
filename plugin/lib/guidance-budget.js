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

/** 计量口径的如实披露。 */
export const GUIDANCE_BILLING_BASIS = Object.freeze({
  unit: "UTF-16 code unit",
  // 10 §5.3 原文：在宿主提供注入预算计量 API 之前，预算控制由 LDVH 侧承担。
  hostMeteringAvailable: false,
  note: "按字符计量是权宜；宿主 token 计量 API 尚未提供（10 §5.3）",
});

/**
 * 取引导文本并核对体量。
 *
 * @returns {{ok: true, text: string, length: number, budget: number, remaining: number}}
 *       或 `{ok: false, error: {code, message}, length, budget}`——超限即拒绝注入，
 *       对应 `10 §10.1` 第 3 项的必停语义，不静默截断。
 */
export function buildGuidance(state) {
  const key = GUIDANCE_CHAR_BUDGET[state] === undefined ? "not_governed" : state;
  const budget = GUIDANCE_CHAR_BUDGET[key];
  const text = guidanceTextFor(state);
  const length = text.length;
  if (length > budget) {
    return {
      ok: false,
      error: {
        code: "guidance/budget_exceeded",
        message: `引导体量 ${length} 超出 ${key} 的常量预算 ${budget}（10 §5.3 要求体量以固定常量承载；10 §10.1 第 3 项把超预算列为必停情形）`,
      },
      length,
      budget,
      overBy: length - budget,
    };
  }
  return { ok: true, text, length, budget, remaining: budget - length };
}
