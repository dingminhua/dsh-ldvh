// LDVH minimal rule-guidance text (candidate pending Human confirmation).
//
// Status: this text is the "插件 AI 面向语义文本" protected class (08 §7.6,
// decision #14). It ships as a CANDIDATE in this batch and must be confirmed
// by the Human (逐段同意) before any release; committing it inside the P0
// implementation commit marks it as implemented-as-candidate, not confirmed.
//
// Contract (specs/01 §10.4): the minimal guidance names the seven 00 anchors
// — identity block, §2 root scheme, §3.1 work model, §4 Human decision
// rights, §5 AI responsibilities, §6 dual-track values, §7 anti-self-deception/
// Stop/handover — WITHOUT copying rule text (no second rule source, 08 §5.3
// single-authority red line). Anchor names calibrate to the current 00 text.

export const GUIDANCE_SECTION_NAME = "ldvh:minimal-guidance";
export const GUIDANCE_SECTION_ORDER = 1550;

/**
 * One-line governance judgment notice (Human 2026-09-04: "上下文注入告知
 * 判定结果", the dsh-subagent-default-model notice pattern). This is the
 * explicit statement of WHAT LDVH judged for the current session — every
 * state gets one, including not_governed (which previously returned "" and
 * left the AI with no LDVH trace at all; that zero-interference shape is
 * superseded by this Human decision, pending live verification).
 */
/**
 * Full judgment notice for the visible context-injection row (Human
 * 2026-09-04: "显示的不够完整" — one line was not enough). Builds the
 * complete card from the resolved scope: state, project identity, judgment
 * basis and what governance means for THIS session. Falls back to the bare
 * judgment line when the scope carries no project (not_governed / a
 * hand-made scope in tests).
 */
export function noticeTextFor(scope) {
  const state = scope?.state;
  const line = judgmentLineFor(state);
  if (state !== "governed") return scope?.detail ? `${line}\n原因：${scope.detail}` : line;
  const project = scope.project ?? {};
  const rows = [
    line,
    "",
    `项目：${project.name ?? project.id ?? "（未命名）"}（${project.path ?? "路径未知"}）`,
    `判定依据：会话工作目录命中登记项目（ldvh/governed-projects.yaml）`,
    `登记指纹：${scope.registrationFingerprint ?? "未知"}`,
    "",
    "管辖效果：",
    "- ldvh_* 工具已注册（管辖判定 / 规范读取 / 能力发现 / 提交预检 / 子代理回收）",
    "- 最小规则引导每回合注入（specs/00 七锚点）",
    "- 受控提交经 Git Gate 机械校验",
    "- 完整规则以规范源原文为准（ldvh_read_specification_content 读取 L0–L4）"
  ];
  if (project.description) rows.splice(2, 0, `描述：${project.description}`);
  return rows.join("\n");
}

/**
 * Inline summary for the collapsed context-injection row (renders next to
 * "上下文注入 · dsh-ldvh ·" — Human 2026-09-04 external title format).
 */
export function noticeSummaryFor(state) {
  if (state === "governed") return "本会话受 LDVH 管辖";
  if (state === "unavailable") return "管辖登记不可读";
  return "本会话不受 LDVH 管辖";
}

export function judgmentLineFor(state) {
  if (state === "governed") return "【LDVH 管辖判定】governed —— 本会话受 LDVH 管辖。";
  if (state === "unavailable") return "【LDVH 管辖判定】unavailable —— 登记不可读，按不受辖处理。";
  return "【LDVH 管辖判定】not_governed —— 本会话不受 LDVH 管辖，LDVH 工具不注册。";
}

/**
 * Migration notice when the judgment CHANGES mid-session (the "已切换到"
 * event-notice pattern): a one-line statement of the transition, so the AI
 * knows its earlier context may be stale (tools registered earlier may have
 * disappeared, guidance anchors no longer apply, etc.).
 */
export function migrationLineFor(fromState, toState) {
  return `【LDVH 管辖状态变更】${fromState ?? "未知"} → ${toState} —— 本回合起按新状态执行，此前上下文中的 LDVH 信息可能已失效。`;
}

const GOVERNED_GUIDANCE = `本会话工作锚点（specs/00-理念与构成.md）：
1. 身份块——每个 specs/ 载体首部 ldvh_spec/ldvh_attachment 声明身份、依据与关系
2. §2 根方案——能力承载与业务系统构成的工作模型 + 两类语义构成要素 + 规范源（元规范与事实规范两级承载）/事实源 + 插件四种价值交付
3. §3.1 工作模型——能力承载（LDVH CLI 确定性服务/宿主原生机制）+ 业务系统（调研/讨论/工单执行/规则遵守/目标与蓝图/记忆与反思）+ 制度（复核）
4. §4 Human 决定权——根决定清单、Human Gate 与受保护文档
5. §5 AI 责任——主控发起的行动由单一主控 AI 最终负责、宿主闲置发起的辅助任务由机械校验保障、非全知、委派不转责、反稀释
6. §6 双轨价值——V1–V8 / HV1–HV5
7. §7 防自欺、Stop Conditions 与交还——机械锚点、暂停条件、最小交还结构
规则读取：ldvh_read_specification_candidates / ldvh_read_specification_content（L0–L4 渐进披露）；
能力发现：ldvh_discover_capabilities；受控提交前：ldvh_precheck_git_commit；
管辖状态：ldvh_resolve_governance_scope。完整规则以规范源原文为准，本引导不复制规则正文。`;

const UNAVAILABLE_GUIDANCE = `LDVH 管辖登记当前不可读取。本项目暂按不受管辖处理（与 not_governed 一致），但状态确为「不可用」而非「不受辖」，不得据此认定本项目不受辖。
- 行动：与不受辖一致——不启用 LDVH 受控操作，不声明本项目受辖；
- 原因与处理：检查 DSH 用户配置根下的 ldvh/governed-projects.yaml 是否可读且格式正确（可能原因见 specs/07 §5.3：配置根不可用、登记载体不可读、权限未核验、访问被拒或 Schema 无效），或在 DSH 设置页的管辖项目页查看具体原因。
完整规则以规范源原文为准，本引导不复制规则正文。`;

const NOT_GOVERNED_GUIDANCE = `本会话无 LDVH 工作要求；如被问及 LDVH，据实回答本会话不受管辖。`;

/**
 * Guidance text for a governance state: judgment line first, then the
 * state-specific body. not_governed now carries a one-line judgment +
 * minimal body (Human 2026-09-04 上下文注入决定) — the former "" (zero
 * interference) shape is superseded; see judgmentLineFor note.
 */
export function guidanceTextFor(state) {
  const line = judgmentLineFor(state);
  if (state === "governed") return `${line}\n${GOVERNED_GUIDANCE}`;
  if (state === "unavailable") return `${line}\n${UNAVAILABLE_GUIDANCE}`;
  return `${line}\n${NOT_GOVERNED_GUIDANCE}`;
}
