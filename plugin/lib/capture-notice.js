
export const CAPTURE_NOTICE_SUMMARY = "经验与摩擦 · 当场判据";

export const CAPTURE_ENTRY_POINTS = Object.freeze({
  experience: "experience-accumulation-system-foundation 的 when-it-applies、entry-prerequisite、context-supply、delegate-draft",
  friction: "friction-settlement-system-foundation 的 discovery-trigger、discovery-context、discovery-closed-set",
  failure: "ldvh-root 的 proxy-auxiliary-failure",
});

export function buildCaptureNotice({ experienceEnabled = false, frictionEnabled = false } = {}) {
  if (experienceEnabled !== true && frictionEnabled !== true) return "";
  const lines = [
    "【经验与摩擦 · 当场判据】",
    "本行只把「什么时候该动手」的判据摆到手边，不触发记录、不派发代理、不设周期或静置检查点；是否满足判据由主控在当次行动里自行判定，用例外与交还纪律核对后决定。",
  ];
  if (experienceEnabled === true) {
    lines.push(
      "",
      "- 经验：当次行动中发现已查明验证、且可能重现的失败机制时（when-it-applies），由主控当场判定并整理上下文，派生零上下文代理辅助任务执行体（context-supply / delegate-draft），执行体经统一受控入口落笔并写后回读、把结果回执主控，主控转告 Human；材料须可回指、适用范围须说得出来（entry-prerequisite）。归不了类时登记待决定，不先创建对象。",
    );
  }
  if (frictionEnabled === true) {
    lines.push(
      "",
      "- 摩擦：当次行动中判定出现阻碍现象时，由主控当场整理有界材料、派隔离子代理跑发现动作（discovery-trigger / discovery-context / discovery-closed-set）；不靠计时器、周期调度或静置检查点驱动，不向别的会话投递。缺了材料原文与定位就不许跑那套动作。",
    );
  }
  lines.push(
    "",
    "- 失败按默认不放行（fail-closed）：停止该次任务、保留已发生的副作用、如实登记，不自行重试，也不把部分写入当作完成（" + CAPTURE_ENTRY_POINTS.failure + "）。",
  );
  return lines.join("\n");
}

export function resolveCaptureSwitches(idle) {
  if (idle === null || idle === undefined) return { experienceEnabled: false, frictionEnabled: false };
  const masterOn = idle.enabled !== false;
  return {
    experienceEnabled: masterOn && idle.tasks?.["experience-accumulation"] === true,
    frictionEnabled: masterOn && idle.tasks?.["friction-discovery"] === true,
  };
}

export function captureNoticeDigest(text) {
  return typeof text === "string" ? text : "";
}
