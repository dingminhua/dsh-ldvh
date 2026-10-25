// LDVH minimal rule-guidance text.
//
// Status: this text is the "插件 AI 面向语义文本" protected class (specs/10
// §7.6, decision #14). Any content change here must follow 00 §4.3: show the
// existing text and the exact candidate, state the difference and reason, pass
// independent review, obtain the Human's explicit consent (逐段同意), and form a
// standalone commit containing only this protected document.
//
// Contract (specs/01 §10.4): the minimal guidance names the SIX 00 anchor
// groups — identity block, §2 root scheme, §3 constitution, §4 Human decision
// rights, §5 AI responsibilities (incl. §5.6/§5.7/§5.8), §6 dual-track values
// — WITHOUT copying rule text (no second rule source, specs/10 §5.3
// single-authority red line). Anchor names calibrate to the current 00 text.
//
// 2026-10-25 修正（第四十四次独立审核 M-3）：本注释此前写「seven anchors」、
// 把 §5.6-5.8 列为第 7 项，并引用了 00 里已不存在的 §7；另把出处误标为
// 「08 §7.6」与「08 §5.3」——08 无 §7.6（其 §7 是「管辖判定消费方」），其
// §5.3 是「判定方式」而非引导面。正确出处是 specs/10 §7.6（受保护文档承接）
// 与 specs/10 §5.3（引导面）。01 §10.4 实列六组（§5 组内含 §5.6/§5.7/§5.8）。
// 同一漂移的注疏侧记录见 plugin/lib/guidance.js:9-13。
//
// 2026-10-26 定口径（第四十四次独立审核 F1-1 的收口）：本文件内的 `specs/...`
// 指针**按 LDVH 元规范语料视图书写**，即它们指向「插件所服务的这套 LDVH 规范」
// 本身，不保证在受辖项目自著语料里解析到同一份载体。依据 `01 §10.3` 的语料
// 三级回退（受辖项目根 specs/ → 插件开发布局源仓库根 specs/ → 插件包内 specs/），
// 在有自著 `specs/` 的受辖项目里，同一路径会先解析到**该项目自己的**载体。
//
// 为什么选择「定口径」而不是「把指针全删」：引导的职责是让主控**在无须自行
// 检索的前提下取得最小充分的方向约束**（`03 §10.4`），保留语料指针正是为此；
// 全删会退化为「什么都指向不明」。而此前删掉的 `specs/21 §6.3` 属另一种情形
// ——它的**纪律**（唯一入口禁令、不写事件流前提、重试复用语义、重问判据）由
// 插件对所有受辖项目实施、不属本仓专有，故纪律保留、只删那个**容易指错且非
// 必需**的指针；本文件现存的 `specs/00-理念与构成.md`（governed 分支）与
// `specs/07 §5.3`（unavailable 分支）是**元规范自身的引用**，按本口径保留。
//
// 该口径的边界：它只解释本文件的书写约定，**不改变** `01 §10.3` 的回退规则，
// 也不主张受辖项目自著语料里存在同名载体。若将来要在受辖项目里保证解析正确，
// 应由 `01 §10.3` 的读取入口在应答时如实标注实际应答方（该条已如此要求）。

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
    "- 最小规则引导每回合注入（specs/00 锚点）",
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
2. §2 根方案——能力承载、业务系统与制度构成的工作模型 + 两类语义构成要素 + 规范源（元规范与事实规范两级承载）/事实源 + 插件四种价值交付
3. §3 构成解析——能力承载（LDVH CLI 确定性服务/宿主原生机制）+ 业务系统（目标规划/火花记录/工单执行/调研吸收/双源召回/经验积累/摩擦销账，见 §3.4 名录）+ 检查机制（主控自查/代理审核/机械校验，见 §3.3）
4. §4 Human 决定权——根决定清单、Human Gate 与受保护文档
5. §5 AI 责任——主控发起的行动由单一主控 AI 最终负责、宿主发起的辅助任务由机械校验保障（00 §5.5）、非全知、委派不转责、反稀释（01 §5 第 13 项）
6. §6 双轨价值——V1–V8 / HV1–HV5
7. §5.6 据实声明、§5.7 必停情形与恢复、§5.8 交还与撤回——据实声明锚点、必停情形根触发、最小交还结构
规则读取：ldvh_read_specification_candidates / ldvh_read_specification_content（L0–L4 渐进披露）；
能力发现：ldvh_discover_capabilities；受控提交前：ldvh_precheck_git_commit；
建工单：**须先经 ldvh_workcase_write 的路由询问取得 Human 选择，不得未经询问擅自创建**；**不得在 ldvh_workcase_write 之外另发等效询问**（宿主询问不写会话事件流，日志里看不到不等于「没问过」，不得据此补问、不得擅自重建；同一候选内容指纹相同重试时接缝复用既有答复而不再提问，确需重问须先确认候选内容已变）；
模型面提请：不经 LDVH 接缝、直接调用宿主 ask_user_question 时，请将 question 控制在 200 字符内，判断依据写进对话正文；此为对 AI 的指令、无机械保障（该工具不转发 detail，长内容无承载位）；
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
