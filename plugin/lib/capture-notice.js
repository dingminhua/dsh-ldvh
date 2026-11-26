
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
    "本行把「什么时候该动手」的判据摆到手边。每轮结束把「本轮有无可回指材料（原文＋定位）」作为固定自查项过一遍：有材料就当场派生零上下文代理，不预判它会不会成立、不因「判不准」而跳过；「有材料」只指原文与定位可回指，不含成立判定，成立与否是执行体的事。无材料则如实说明本轮无可记项。自查是每轮都做的本职（required-checks），不是定时器、不靠周期或静置检查点驱动；触发派发的是「有可回指材料」，不是「又过了一轮」。执行体当场派生，不转投其它既有会话。",
  ];
  if (experienceEnabled === true) {
    lines.push(
      "",
      "- 经验：每轮自查发现可回指材料（已查明验证、可能重现的失败机制，或待判去向的认识——when-it-applies）时，即整理有界上下文、当场派生零上下文代理辅助任务执行体（context-supply / delegate-draft），不预判它是否成立；派完即撒手，执行体经统一受控入口落笔并写后回读、把结果回执主控，回执自动到达时顺手转告 Human 一句，未到达则不等不追、交还里也不提结果未知。材料须可回指、适用范围须说得出来（entry-prerequisite）；归不了类时登记待决定，不先创建对象。",
    );
  }
  if (frictionEnabled === true) {
    lines.push(
      "",
      "- 摩擦：每轮自查发现可回指材料（阻碍现象的原文＋定位）时，即由主控当场整理有界材料、派隔离子代理跑发现动作（discovery-trigger / discovery-context / discovery-closed-set），不预判它是否满足三条件、不因「判不准」而跳过——同源查重与成立判定是执行体的事。缺了材料原文与定位就不许跑那套动作；不靠计时器、周期调度或静置检查点驱动，不向别的会话投递。",
      "  **派发时须把执行体的工具面说清**：该执行体只被授予 `ldvh_friction_record_observation`（记一条观察条目），**没有 `ldvh_friction_write`**——建账不是它的动作。载体要求的三件事（写观察、达阈值晋升新账、补充级更新）全在同一次 `record_observation` 调用内部完成：记完观察后由机制自行尝试晋升，结果经返回值的 `promotion` 字段交回（`promoted`／`skipped`／`failed` 及 `residual`）。故派发文案只能要求它「记录这条阻碍的观察材料」，**不得要求它「登记/创建摩擦账目」**——那样它会因手里没有写账工具而停下，把一次可完成的观察记成失败。晋升未发生（未达阈值或 `residual` 报错）不是执行体的失败，如实回执即可。",
    );
  }
  lines.push(
    "",
    "- 失败按默认不放行（fail-closed）：停止该次任务、保留已发生的副作用、如实登记，不自行重试，也不把部分写入当作完成（" + CAPTURE_ENTRY_POINTS.failure + "）。登记时区分两类：意外损耗（外部/不可控，如并发冲突、宿主工作树隔离）按现状留痕、可由人接受；系统性故障（在执行体职责内、本该写入却没写入）是 bug，除留痕外须作为待修候选交出摩擦发现，由发现通道按既有规则处理（写观察、查重、达阈值晋升），是否值得修、是否立项由人决定，不得当作运气接受掉；归属判不了时作为待定项交还。",
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
