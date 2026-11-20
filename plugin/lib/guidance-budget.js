
import { guidanceTextFor } from "./guidance-text.js";

export const GUIDANCE_CHAR_BUDGET = Object.freeze({
  governed: 4096,
  unavailable: 800,
  not_governed: 400,
});

export const GUIDANCE_EARLY_WARNING_RATIO = 0.9;

export function isWithinEarlyWarningBand(length, budget) {
  if (typeof length !== "number" || typeof budget !== "number" || budget <= 0) return false;
  return length <= budget * GUIDANCE_EARLY_WARNING_RATIO;
}

export const GUIDANCE_BUDGET_EXCEEDED_CODE = "guidance/budget_exceeded";

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

export const GUIDANCE_BILLING_BASIS = Object.freeze({
  unit: "UTF-16 code unit",
  hostMeteringAvailable: false,
  note: "按字符计量是权宜；宿主 token 计量 API 尚未提供（10 §5.3）",
});

export const GUIDANCE_MEASURED_LENGTH = Object.freeze({
  governed: 2153,
  unavailable: 323,
  not_governed: 90,
});

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
