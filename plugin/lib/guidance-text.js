
export const GUIDANCE_SECTION_NAME = "ldvh:minimal-guidance";
export const GUIDANCE_SECTION_ORDER = 1550;

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
    "- 最小规则引导每回合注入（specs/00 锚点）",
    "- 受控提交经 Git Gate 机械校验",
    "- 完整规则以规范源原文为准（ldvh_read_specification_content 读取 L0–L4）"
  ];
  if (project.description) rows.splice(2, 0, `描述：${project.description}`);
  return rows.join("\n");
}

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

export function migrationLineFor(fromState, toState) {
  return `【LDVH 管辖状态变更】${fromState ?? "未知"} → ${toState} —— 本回合起按新状态执行，此前上下文中的 LDVH 信息可能已失效。`;
}

const GOVERNED_GUIDANCE = `本会话工作锚点（specs/00-理念与构成.md）：
1. 身份块——每个 specs/ 载体首部 ldvh_spec/ldvh_attachment 声明身份、依据与关系
2. §1 三大核心价值与最终目标——项目可厘清（§1.1）、任务高效准确完成（§1.2）、经验与摩擦自动积累（§1.3）；三者关系与价值边界见 §1.5，三类问题见 §1.4
3. §2 方法与构成——根方案六条（§2.1）+ 能力承载（LDVH CLI 确定性服务/宿主原生机制，§2.3）+ 规范源与事实源（元规范与事实规范两级承载，§2.4）+ 检查机制（主控自查/代理审核/机械校验，§2.5）+ 业务系统（目标规划/火花记录/把关请示/调研吸收/双源召回/经验积累/摩擦销账，§2.6 名录）+ 技术与机械保障（§2.7）+ 插件四种价值交付（§2.8）+ 下位承接（§2.9）
4. §3 Human 权利——根决定清单（§3.2）、Human Gate、受保护内容（§3.3）、可决提请与回应效力（§3.4）
5. §4 AI 责任与义务——主控发起的行动由单一主控 AI 最终负责、代理辅助任务由机械校验保障（00 §4.5）、非全知、委派不转责（代理辅助任务除外，00 §4.3）、反稀释（01 §5 第 13 项）；§4.6 据实声明、§4.7 必停情形与恢复、§4.8 交还与撤回
6. §5 价值纪律——机制准入（§5.1）、价值不因材料存在而成立（§5.2）、冲突与变更（§5.3）
规则读取：ldvh_read_specification_candidates / ldvh_read_specification_content（L0–L4 渐进披露）；
能力发现：ldvh_discover_capabilities；受控提交前：ldvh_precheck_git_commit；
把关请示：在行动前与收口前两处向 Human 请示是否安排一次独立核对，答复留痕，答复不构成授权凭据、也不使行动在取得答复前暂停（§2.6）；两处各有开关，缺省关闭；关着只保证「不问」，不禁止 AI 按 04 §6.1 自行安排隔离视角；两处询问之上另有执行档位（征询／静默，缺省征询），静默时该处不逐次征询、按 Human 的预先答复直接安排那次核对并留执行痕迹，它只免征询不免核对、不越过该处的询问开关，且不外推到火花／管辖项目等 Human Gate 的提请；「算不算复杂」由 AI 判断，机械层不判定，故这不构成机械保障；
模型面提请：不经 LDVH 接缝、直接调用宿主 ask_user_question 时，请将 question 控制在 200 字符内，判断依据写进对话正文；此为对 AI 的指令、无机械保障（该工具不转发 detail，长内容无承载位）；
失败留痕：待处置队列已删除（Human 2026-11-17，36 §8.7）——代理辅助任务失败由执行体当次回执承载（主控按 00 §4.6 如实转述），另以运行痕迹跨会话可查（诊断页只读呈现）；不再有「接管前先读账」的义务，也不再有结案通道。
经验主动记录：主控在当次行动中发现已查明验证的失败机制时，按 23 §13 把该机制所需的上下文材料交给一个零上下文派生的代理起草发现记录，再由主控受控写入（子代理不写事实源）；**不继承主控对话**——材料由主控按该机制挑选（23 §13 上下文供给段）。通道边界、免事前确认与摩擦归属依 23 §13、23 §16；摩擦的发现同样由主控发起、交代理记录（依 36 号 §9 与 00 §4.5 的代理辅助任务），不属本行。
管辖状态：ldvh_resolve_governance_scope。完整规则以规范源原文为准，本引导不复制规则正文。`;

const UNAVAILABLE_GUIDANCE = `LDVH 管辖登记当前不可读取。本项目暂按不受管辖处理（与 not_governed 一致），但状态确为「不可用」而非「不受辖」，不得据此认定本项目不受辖。
- 行动：与不受辖一致——不启用 LDVH 受控操作，不声明本项目受辖；
- 原因与处理：检查 DSH 用户配置根下的 ldvh/governed-projects.yaml 是否可读且格式正确（可能原因见 specs/07 §5.3：配置根不可用、登记载体不可读、权限未核验、访问被拒或 Schema 无效），或在 DSH 设置页的管辖项目页查看具体原因。
完整规则以规范源原文为准，本引导不复制规则正文。`;

const NOT_GOVERNED_GUIDANCE = `本会话无 LDVH 工作要求；如被问及 LDVH，据实回答本会话不受管辖。`;

export function guidanceTextFor(state) {
  const line = judgmentLineFor(state);
  if (state === "governed") return `${line}\n${GOVERNED_GUIDANCE}`;
  if (state === "unavailable") return `${line}\n${UNAVAILABLE_GUIDANCE}`;
  return `${line}\n${NOT_GOVERNED_GUIDANCE}`;
}
