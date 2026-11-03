// ============================================================
// 状态词汇表 — 仅作未被类型投影覆盖时的显示后备，不定义状态闭集或状态机。
// 类型来源定义了不同语义时，必须通过 OBJECT_STATUS_LOCALES 覆盖本表。
// ============================================================
export const STATUS_LOCALES: Record<string, { zh: string; en: string }> = {
  // WorkCase / ADR
  draft: { zh: '草稿', en: 'Draft' },
  proposed: { zh: '已提议', en: 'Proposed' },
  accepted: { zh: '已采纳', en: 'Accepted' },
  retired: { zh: '已废弃', en: 'Retired' },
  rejected: { zh: '已拒绝', en: 'Rejected' },
  deprecated: { zh: '已废弃', en: 'Deprecated' },
  archived: { zh: '已归档', en: 'Archived' },
  active: { zh: '活跃', en: 'Active' },
  pending: { zh: '待处理', en: 'Pending' },
  in_progress: { zh: '进行中', en: 'In Progress' },
  blocked: { zh: '已阻塞', en: 'Blocked' },
  completed: { zh: '已完成', en: 'Completed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
  suspended: { zh: '已暂停', en: 'Suspended' },
  executing: { zh: '执行中', en: 'Executing' },
  human_plan_confirming: { zh: '方案待确认', en: 'Plan Confirmation' },
  plan_revising: { zh: '方案修订中', en: 'Plan Revision' },
  controller_checking: { zh: '主控自检中', en: 'Controller Self-check' },
  independent_reviewing: { zh: '结果复核中', en: 'Result Review' },
  closure_preparing: { zh: '主控收敛中', en: 'Controller Synthesis' },
  human_closure_confirming: { zh: '关闭待确认', en: 'Closure Confirmation' },
  termination_preparing: { zh: '终止善后中', en: 'Termination Cleanup' },
  plan_confirmation: { zh: '方案待确认', en: 'Plan Confirmation' },
  progressing: { zh: '推进中', en: 'In Progress' },
  termination_cleanup: { zh: '终止善后中', en: 'Termination Cleanup' },
  closure_confirmation: { zh: '关闭待确认', en: 'Closure Confirmation' },
  closed: { zh: '已关闭', en: 'Closed' },
  gate1_waiting: { zh: '等待 Gate 1', en: 'Waiting for Gate 1' },
  plan_revision_in_progress: { zh: '方案修订中', en: 'Plan revision in progress' },
  item_execution_in_progress: { zh: '工作项执行中', en: 'Work item execution in progress' },
  result_projection_preparing: { zh: '正在形成结果投影', en: 'Preparing result projection' },
  independent_result_review_in_progress: { zh: '独立结果复核中', en: 'Independent result review in progress' },
  closure_proposal_preparing: { zh: '正在形成关闭提案', en: 'Preparing closure proposal' },
  termination_cleanup_in_progress: { zh: '终止善后中', en: 'Termination cleanup in progress' },
  gate2_waiting: { zh: '等待 Gate 2', en: 'Waiting for Gate 2' },
  blocked_at_current_position: { zh: '当前位置受阻', en: 'Blocked at current position' },
  gate2_position_blocked: { zh: '关闭位置受阻', en: 'Blocked at closure position' },
  open: { zh: '未关闭', en: 'Open' },
  routed: { zh: '已分流', en: 'Routed' },
  implemented: { zh: '已关闭', en: 'Implemented' },
  degraded: { zh: '受限', en: 'Limited' },
  needs_human_gate: { zh: '需确认', en: 'Needs Gate' },
  pass: { zh: '通过', en: 'Pass' },
  pass_with_followups: { zh: '通过但有后续项', en: 'Pass with follow-ups' },
  fail: { zh: '不通过', en: 'Fail' },
  unknown: { zh: '未知', en: 'Unknown' },
  // Spark
  resolved: { zh: '已分流', en: 'Routed' },
  discarded: { zh: '已废弃', en: 'Discarded' },
  deleted: { zh: '已删除', en: 'Deleted' },
};

export function getStatusLocale(status: string, locale: string): string {
  const entry = STATUS_LOCALES[status];
  if (!entry) return status;
  return locale === 'en' ? entry.en : entry.zh;
}

// 状态码可在不同事实对象中复用，但展示语义不必相同。Spark 的 `open`
// 表示「尚待判断或分流」，不是 WorkCase 式的「未关闭」。
//
// 本表是**类型专属展示词条的唯一来源**：徽标（StatusBadge ← getObjectStatusLocale）、
// 列表卡、详情身份头部、联邦与热点图都经 getObjectStatusLocale 取词条。筛选器的
// 分组标签亦由此派生（见 WORKCASE_GROUP_STATUSES / getWorkCaseGroupLabel），
// 不得在 UI_LOCALES 里再登记一份同义词条——两处登记必然漂移。
const OBJECT_STATUS_LOCALES: Record<string, Record<string, { zh: string; en: string }>> = {
  workcase: {
    discarded: { zh: '已废弃', en: 'Discarded' },
    // 21 号三态直读的四个**派生分组**（不是来源 status，也不写回对象）。
    // 此前本表缺这四条，回退到 STATUS_LOCALES 时只有 executing 与 closed 命中，
    // pending_gate1 / awaiting_gate2 则原值直出——徽标显示 `pending_gate1` 这样的
    // raw snake_case，违反 docs/01 §1.3「枚举值必须通过语义映射本地化」（缺陷 D7）。
    pending_gate1: { zh: '待批准执行', en: 'Pending Gate 1' },
    executing: { zh: '执行中', en: 'Executing' },
    awaiting_gate2: { zh: '待批准关闭', en: 'Awaiting Gate 2' },
    closed: { zh: '已关闭', en: 'Closed' },
    unknown: { zh: '状态未知', en: 'Unknown status' },
  },
  adr: {
    retired: { zh: '已废弃', en: 'Retired' },
  },
  spark: {
    // 20 §9 状态闭集：open（待处理——尚待召回、判断、拆分或分流；Human 定案
    // 2026-09-13 改称，原「悬置中」）/ implemented（落实或交接，只结束入口
    // 职责，不代表下游完成）/ discarded（废弃或被合并/拆分）。
    open: { zh: '待处理', en: 'Pending' },
    implemented: { zh: '已落实', en: 'Implemented' },
    discarded: { zh: '已废弃', en: 'Discarded' },
  },
  pitfall: {
    // 23 §9 状态闭集两值（2026-11-03 Human 决定取消 `draft` 待确认态）。
    active: { zh: '活跃', en: 'Active' },
    discarded: { zh: '已废弃', en: 'Discarded' },
  },
  research: {
    active: { zh: '活跃', en: 'Active' },
    retired: { zh: '已废弃', en: 'Retired' },
  },
  friction: {
    // 26 §9 状态闭集四值（2026-10 修订，Human 决定：观察不进事实源；2026-10 新增 accepted）：
    // open（待修）/ resolved（已销账，informs 指向解药）/ voided（已废弃）/
    // accepted（已接受——阻碍真实但不可清偿，记录一次即不再报告）。
    // 原第四值 `observing`（留观）已退出闭集——观察材料改由 11 §12bis.1 的
    // 摩擦观察缓冲承载（非事实对象、不进事实源），故此处不再有留观词条。
    open: { zh: '待修', en: 'Open' },
    resolved: { zh: '已销账', en: 'Resolved' },
    // 与其余事实对象（Pitfall/Spark 的 discarded、ADR/Research 的 retired）统一
    // 用「已废弃」，Human 扫读不必记忆类型专属词（2026-11 Human 裁定）。
    voided: { zh: '已废弃', en: 'Voided' },
    // accepted 是「记对了但清偿不了」，与 voided（记错了）是不同结论，故不复用
    // 「已废弃」；用「已接受」标明它是 Human 的接受决定，不是废弃。
    accepted: { zh: '已接受', en: 'Accepted' },
  },
  norm: {
    // 27 号 §9 状态闭集：active（生效中）/ retired（已退役，终态不重开）。
    active: { zh: '生效中', en: 'Active' },
    retired: { zh: '已退役', en: 'Retired' },
  },
  goal: {
    // 25 号 §7 状态闭集：active（项目存续期常态）/ achieved（收官判定，
    // 全部 sub-goal 达成后 Human 终局判定；冻结为历史档案）。
    active: { zh: '生效中', en: 'Active' },
    achieved: { zh: '已达成', en: 'Achieved' },
  },
  subgoal: {
    // 28 号 §9 状态闭集：active（推进中）→ achieved（已达成）/ retired（已作废）。
    // 后两者均为终态且不重开；「已达成」与 Goal 的 achieved 同词，但判定主体
    // 不同（子目标是逐条判据，Goal 是全量收官），故两处都保留而不合并。
    active: { zh: '推进中', en: 'Active' },
    achieved: { zh: '已达成', en: 'Achieved' },
    retired: { zh: '已作废', en: 'Retired' },
  },
  devlog: {
    // 29 号 §9 状态闭集：active（结论仍承重）→ absorbed（已被承接，正文压缩为
    // 两段）/ superseded（被推翻，全文保留）/ dropped（不再承重且无可指向承接物，
    // 全文保留）。三个终态均不可重开。
    //
    // 「已被承接」与「被推翻」**必须不同词**：前者是结论还在、只是搬到承接物
    // 那里（正向），后者是结论失去地位（负向）。两处都经 `change_log` 与正文
    // 形态可核，合并成一个「已收起」会把这条关键区分抹掉。
    active: { zh: '承重中', en: 'Active' },
    absorbed: { zh: '已被承接', en: 'Absorbed' },
    superseded: { zh: '已被推翻', en: 'Superseded' },
    dropped: { zh: '不再承重', en: 'Dropped' },
  },
};

export function getObjectStatusLocale(type: string, status: string, locale: string): string {
  const objectEntry = OBJECT_STATUS_LOCALES[type]?.[status];
  if (objectEntry) return locale === 'en' ? objectEntry.en : objectEntry.zh;
  return getStatusLocale(status, locale);
}

/**
 * WorkCase 派生分组的筛选五档顺序（含「全部」）。
 *
 * 分组展示词条由 `getObjectStatusLocale('workcase', group, locale)` 给出——
 * 与徽标、列表卡、详情身份头部共用**同一张表**（单一来源，防口径漂移）。
 */
export const WORKCASE_GROUP_STATUSES = [
  'pending_gate1',
  'executing',
  'awaiting_gate2',
  'closed',
] as const;

/** 派生分组（或 'unknown'）的本地化词条——筛选器、徽标与详情同源。 */
export function getWorkCaseGroupLabel(group: string, locale: string): string {
  return getObjectStatusLocale('workcase', group, locale);
}

/**
 * 「待批准执行」徽标的**建前审核后缀**（21 §8 `pre_reviews`，2026-10-16 建立）。
 *
 * 形态（Human 2026-10-16 定）：已审保持原词「待批准执行」不动；未审追加
 * 「· 待审核」。**不新增颜色、不新增派生组**——draft 的派生组仍是 `pending_gate1`，
 * 唯一变化是徽标文字，使 Human 一眼看出「这份审了没」。
 *
 * 判据只读 `pre_audit_passed`（由投影层按「存在一条 verdict=pass 的条目」给出），
 * 本函数不自行判定——单一来源，防口径漂移。
 */
export function getWorkCasePendingGate1Label(locale: string, preAuditPassed: boolean | undefined): string {
  const base = getObjectStatusLocale('workcase', 'pending_gate1', locale);
  if (preAuditPassed === true) return base;
  return locale === 'en' ? `${base} · Awaiting audit` : `${base} · 待审核`;
}

/**
 * **状态徽标文案的唯一入口**（含建前审核后缀）：任何呈现面要显示某个对象的状态词，
 * 都调本函数，不要直接调 `getObjectStatusLocale`。
 *
 * ## 为什么必须收敛到一处（2026-10-17）
 *
 * 后缀最初只加在**列表卡**（`ObjectList` 的 `cardStatusLabel`），聚焦页的四处徽标
 * 仍各自直调 `getObjectStatusLocale`，于是同一张工单在列表卡上显示
 * 「待批准执行 · 待审核」、在聚焦收件箱里却只显示「待批准执行」——**同一事实两处
 * 说法不同**。Human 为此直接指出「聚焦栏的 card 表现要同步」。
 *
 * 根因不是漏改某一处，而是**判据没有单一来源**：只要后缀的拼接逻辑住在某个页面的
 * 局部 const 里，任何新增的呈现面都必然再漏一次。故收敛到这里，各处只传数据。
 *
 * @param type 对象类型（只有 workcase 的 pending_gate1 有后缀）
 * @param status 派生分组或状态值
 * @param preAuditPassed 该对象的建前审核是否已取得通过结论（非 workcase 传 undefined）
 */
export function getObjectStatusDisplayLabel(
  type: string,
  status: string,
  locale: string,
  preAuditPassed?: boolean,
): string {
  if (type === 'workcase' && status === 'pending_gate1') {
    return getWorkCasePendingGate1Label(locale, preAuditPassed);
  }
  return getObjectStatusLocale(type, status, locale);
}

// `TYPE_DESCRIPTION_LOCALES` / `getTypeDescription` 已删除（2026-11-02）。
//
// 它们是**类型定义的复述**表（「工单——需要持续保存…（21 §1）」「事实规范——一个工程
// 方向的成体系规则体系（27 §1）」……），迁自 v4。全部 11 条里，**只有 `norm` 一条曾
// 真正上屏**——规范卡卡体的类型说明行。那一行随方向键块一并撤除后，本表再无消费方，
// 即「11 条里 10 条自始是死的、最后 1 条也死了」。
//
// 不保留的理由就是呈现收窄的落点纪律（`docs/11` §4quater）：撤掉呈现却留着词表，
// 「不呈现」这个决定就没有落点，下一轮读者会把它当成「本该呈现、只是暂时没接上」。
// 类型定义本身仍在各规范 §1 与 `TYPE_LOCALES` 的类型名里，不因删表而丢失。
//
// `objectList.normDirectionKeyMissing`（「方向键缺失 / Direction key missing」）随
// 详情面方向键节点一并删除：缺 `direction_key` 属**载体不合规**，读取层已按字段契约
// 产出 `field_issues`（`missing`）并由 `FieldIssuesSection` 如实报出，页面另写一句
// 提示是同一事实的第二处呈现。

// ============================================================
// 对象类型 / 字段名 / 字段枚举值 中英映射（显式 mapping 表）
// 来源：docs/01-全局设计约束 §1.3 — 字段名与枚举值必须经显式映射本地化
// 这些表集中维护于此，组件经下方 get*Label 函数读取，
// 不得在组件内用 locale === 'en' ? ... : ... 内联分支。
// ============================================================

/** 对象类型中英映射 */
export const TYPE_LOCALES: Record<string, { zh: string; en: string }> = {
  workcase: { zh: '工单', en: 'WorkCase' },
  adr: { zh: '决策', en: 'ADR' },
  pitfall: { zh: '经验', en: 'Pitfall' },
  spark: { zh: '火花', en: 'Spark' },
  research: { zh: '调研', en: 'Research' },
  friction: { zh: '摩擦', en: 'Friction' },
  norm: { zh: '规范', en: 'Norm' },
  goal: { zh: '目标', en: 'Goal' },
  subgoal: { zh: '子目标', en: 'Sub-goal' },
  devlog: { zh: '开发日志', en: 'DevLog' },
  change: { zh: '提交', en: 'Commit' },
};

export function getTypeLabel(type: string, locale: string): string {
  const entry = TYPE_LOCALES[type];
  if (!entry) return type;
  return locale === 'en' ? entry.en : entry.zh;
}

export function getLocalizedObjectTitle(
  item: { id?: string; title?: string; title_en?: string; title_zh?: string },
  locale: string,
  fallback = '—',
): string {
  if (locale === 'en') return item.title_en || item.title || fallback;
  return item.title_zh || item.title || item.title_en || fallback;
}

export function getLocaleListSeparator(locale: string): string {
  return locale === 'zh' ? '，' : ', ';
}

export function getOppositeLocale(locale: Locale): Locale {
  return locale === 'zh' ? 'en' : 'zh';
}

export function getLanguageSwitchKey(locale: Locale): 'language.switchToEnglish' | 'language.switchToChinese' {
  return locale === 'zh' ? 'language.switchToEnglish' : 'language.switchToChinese';
}

export function getOppositeLanguageNameKey(locale: Locale): 'language.english' | 'language.chinese' {
  return locale === 'zh' ? 'language.english' : 'language.chinese';
}

/** 字段名中英映射 */
export const FIELD_LABEL_LOCALES: Record<string, { zh: string; en: string }> = {
  id: { zh: 'ID', en: 'ID' },
  type: { zh: '类型', en: 'Type' },
  title: { zh: '标题', en: 'Title' },
  title_en: { zh: '英文标题', en: 'English Title' },
  title_zh: { zh: '中文标题', en: 'Chinese Title' },
  status: { zh: '状态', en: 'Status' },
  created: { zh: '创建时间', en: 'Created' },
  updated: { zh: '更新时间', en: 'Updated' },
  date: { zh: '日期', en: 'Date' },
  source: { zh: '来源', en: 'Source' },
  relations: { zh: '事实对象关系', en: 'Fact Relations' },
  associated_materials: { zh: '关联材料', en: 'Associated Materials' },
  fact_associations: { zh: '关联', en: 'Related' },
  fact_relations: { zh: '事实对象关系', en: 'Fact Relations' },
  project_materials: { zh: '项目内材料', en: 'Project Materials' },
  external_inputs: { zh: '外部资料与输入', en: 'External Sources and Inputs' },
  evidence_materials: { zh: '证据材料', en: 'Evidence Materials' },
  associated_documents: { zh: '文档', en: 'Docs' },
unresolved_materials: { zh: '未解析材料', en: 'Unresolved Materials' },
  relation_routed_to: { zh: '分流到', en: 'Routed To' },
  relation_related_to: { zh: '关联到', en: 'Related To' },
  relation_depends_on: { zh: '依赖', en: 'Depends On' },
  relation_contributed_to: { zh: '贡献了', en: 'Contributed To' },
  relation_informs: { zh: '提供参考', en: 'Informs' },
  relation_inspired_by: { zh: '受启发于', en: 'Inspired By' },
  // 20 §11：Spark 关系闭集仅合并/拆分两键（目标必须可解析且为 open）。
  relation_merged_into: { zh: '合并入', en: 'Merged Into' },
  relation_split_into: { zh: '拆分为', en: 'Split Into' },
  user_intent: { zh: '用户意图', en: 'User Intent' },
  // 20 §8：intent = 保留理由与后续方向（为什么值得保留 + 后续判断方向）。
  intent: { zh: '保留意图', en: 'Intent' },
  description: { zh: '描述', en: 'Description' },
  evolution: { zh: '演变记录', en: 'Evolution' },
  change_log: { zh: '修改流水', en: 'Change Log' },
  routing: { zh: '分流', en: 'Routing' },
  trigger_signal: { zh: '触发信号', en: 'Trigger Signal' },
  disposition_summary: { zh: '处置', en: 'Disposition' },
  // 20 §8：Spark 终态去向与理由（implemented/discarded 时必填）。
  disposition: { zh: '去向', en: 'Disposition' },
  termination: { zh: '终止善后', en: 'Termination Cleanup' },
  initiated_at: { zh: '中止发起时间', en: 'Termination Initiated At' },
  source_status: { zh: '起始状态', en: 'Source Status' },
  source_content_fingerprint: { zh: '起始内容指纹', en: 'Source Content Fingerprint' },
  item_snapshots: { zh: '工作项起始现场', en: 'Work Item Snapshots' },
  retained_scope: { zh: '保留范围', en: 'Retained Scope' },
  discarded_scope: { zh: '丢弃范围', en: 'Discarded Scope' },
  unverified_scope: { zh: '未验证范围', en: 'Unverified Scope' },
  relationship_impacts: { zh: '关系影响', en: 'Relationship Impacts' },
  quality_steps: { zh: '质量步骤', en: 'Quality Steps' },
  cleanup_status: { zh: '善后状态', en: 'Cleanup Status' },
  cleanup_summary: { zh: '善后摘要', en: 'Cleanup Summary' },
  filename: { zh: '文件名', en: 'Filename' },
  media_type: { zh: '媒体类型', en: 'Media Type' },
  size_bytes: { zh: '文件大小', en: 'Size' },
  content_sha256: { zh: '内容 SHA-256', en: 'Content SHA-256' },
  signature: { zh: '纳入签名', en: 'Ingestion Signature' },
  report_metadata: { zh: '报告信息', en: 'Report Information' },
  report_kind: { zh: '报告类型', en: 'Report Type' },
  input_refs: { zh: '输入来源', en: 'Input Sources' },
  kind: { zh: '来源类型', en: 'Source Kind' },
  locator: { zh: '定位', en: 'Locator' },
  version: { zh: '版本', en: 'Version' },
  observed_at: { zh: '观察时间', en: 'Observed At' },
  signer_type: { zh: '签名主体', en: 'Signer Type' },
  agent_id: { zh: 'Agent 标识', en: 'Agent ID' },
  host_environment: { zh: '宿主环境', en: 'Host Environment' },
  deleted_at: { zh: '删除时间', en: 'Deleted At' },
  recovery: { zh: '恢复定位', en: 'Recovery Locator' },
  commit: { zh: '提交', en: 'Commit' },
  blob_oid: { zh: 'Blob OID', en: 'Blob OID' },
  research_question: { zh: '研究问题', en: 'Research Question' },
  research_purpose: { zh: '调研目的', en: 'Research Purpose' },
  // 20 §8：Spark 悬置问题字段——question（单句待答）/scope_boundary（何时停止）/
  // current_understanding（summary 正文节的展示名）。`serves` 在此保留标签只为
  // 字段语义登记（28 §12.3：它的值是 SubGoal 的 object_uid，不是 SG-n）；
  // 它已无呈现面（2026-11-01 撤除），不再有组件读本条目。
  question: { zh: '调查问题', en: 'Question' },
  scope_boundary: { zh: '调查边界', en: 'Investigation Boundary' },
  serves: { zh: '服务子目标', en: 'Serves Sub-goal' },
  // 03 §7.2 关联引用型 / 20 §8：refs 为关联的事实对象引用，列表卡与详情头
  // 以 chip 呈现，使 Human 无需读全文即可看到本议题与哪些对象相关。
  refs: { zh: '关联对象', en: 'Related Objects' },
  current_understanding: { zh: '当前理解', en: 'Current Understanding' },
  stopping_reason: { zh: '停止原因', en: 'Stopping Reason' },
  confirmed_statements: { zh: '已证实声明', en: 'Confirmed Statements' },
  uncertain: { zh: '未证实', en: 'Uncertain' },
  gaps: { zh: '缺口', en: 'Gaps' },
  implications: { zh: '启发', en: 'Implications' },
  clarification_log: { zh: '澄清记录', en: 'Clarification Log' },
  finding_ref: { zh: '发现引用', en: 'Finding Ref' },
  implication: { zh: '启示', en: 'Implication' },
  issue: { zh: '疑点', en: 'Issue' },
  answered_by: { zh: '回答方', en: 'Answered By' },
  retirement_reason: { zh: '退出原因', en: 'Retirement Reason' },
  retired_at: { zh: '退出时间', en: 'Retired At' },
  research_intent: { zh: '意图', en: 'Intent' },
  abstract: { zh: '摘要', en: 'Abstract' },
  recommendation_summary: { zh: '建议', en: 'Recommendation' },
  validation_summary: { zh: '验证', en: 'Validation Notes' },
  body: { zh: '正文', en: 'Body' },
  report_body: { zh: '正文', en: 'Body' },
  // 21 §8：gist 是给 Human 扫读的一句话要点，与 summary（给执行者的完整快照）
  // 分工不同（10 §5.5）。词条须与 summary 可区分，不得同译。
  gist: { zh: '要点', en: 'Gist' },
  summary: { zh: '摘要', en: 'Summary' },
  conclusion: { zh: '结论', en: 'Conclusion' },
  details: { zh: '详情', en: 'Details' },
  background: { zh: '背景', en: 'Background' },
  motivation: { zh: '动机', en: 'Motivation' },
  outcome: { zh: '结果', en: 'Outcome' },
  next_steps: { zh: '后续步骤', en: 'Next Steps' },
  lessons: { zh: '经验教训', en: 'Lessons' },
  success_criteria: { zh: '成功标准', en: 'Success Criteria' },
  // `plan[].done_criteria`（21 §8）。此前**未登记**，`getFieldLabel` 遂回退到
  // `fieldKey.replace(/_/g, ' ')`，使中文界面里直接显示英文原始字段名
  // 「done criteria」且每条计划步骤重复一次。词取 21 §8 原文「逐条完成判据」的简称。
  done_criteria: { zh: '完成判据', en: 'Done criteria' },
  constraints: { zh: '约束', en: 'Constraints' },
  acceptance: { zh: '验收标准', en: 'Acceptance' },
  verification: { zh: '验证', en: 'Verification' },
  notes: { zh: '备注', en: 'Notes' },
  symptoms: { zh: '现象', en: 'Symptoms' },
  trigger_conditions: { zh: '触发', en: 'Trigger Conditions' },
  root_cause: { zh: '根因', en: 'Root Cause' },
  avoidance: { zh: '规避', en: 'Avoidance' },
  scope_of_impact: { zh: '影响', en: 'Impact Scope' },
  applicability: { zh: '范围', en: 'Applicability' },
  rationale: { zh: '理由', en: 'Rationale' },
  decision_question: { zh: '问题', en: 'Decision Question' },
  context: { zh: '背景', en: 'Context' },
  consequences: { zh: '影响', en: 'Consequences' },
  observation: { zh: '观察', en: 'Observation' },
  analysis: { zh: '分析', en: 'Analysis' },
  mitigation: { zh: '缓解措施', en: 'Mitigation' },
  resolution: { zh: '方案', en: 'Resolution' },
  // v5 Pitfall（23 号）正文七段阅读布局标题（正文段标题与 v4 字段名解耦）。
  pitfall_symptoms: { zh: '症状', en: 'Symptoms' },
  pitfall_triggers: { zh: '触发条件', en: 'Trigger Conditions' },
  pitfall_resolution: { zh: '解决', en: 'Resolution Applied' },
  pitfall_scope_section: { zh: '影响与适用范围', en: 'Impact & Applicability' },
  workcase: { zh: '工单', en: 'WorkCase' },
  // 21 定义的单一当前 WorkCase 字段；不存在历史形状显示分支。
  goal: { zh: '目标', en: 'Goal' },
  // 21 §8 闭集无 `phase`：v5 用派生分组 `group`（pending_gate1/awaiting_gate2/
  // executing/closed）表达生命周期位置，故 `phase` 词条已移除。
  resume_from: { zh: '恢复入口', en: 'Resume From' },
  waiting_on: { zh: '等待对象', en: 'Waiting On' },
  blocking_summary: { zh: '阻塞说明', en: 'Blocking Summary' },
  work_item_blocking_summary: { zh: '工作项阻塞说明', en: 'Work Item Blocking Notes' },
  success_criterion_definitions: { zh: '成功标准定义', en: 'Success Criterion Definitions' },
  success_criterion_results: { zh: '成功标准结果', en: 'Success Criterion Results' },
  criterion_id: { zh: '标准标识', en: 'Criterion ID' },
  statement: { zh: '标准陈述', en: 'Statement' },
  plan_version: { zh: '计划版本', en: 'Plan Version' },
  work_items: { zh: '工作项', en: 'Work Items' },
  item_id: { zh: '工作项标识', en: 'Item ID' },
  expected_result: { zh: '预期结果', en: 'Expected Result' },
  depends_on: { zh: '前置工作项', en: 'Depends On' },
  approach_summary: { zh: '方法边界', en: 'Approach Summary' },
  template_keys: { zh: '行动模板', en: 'Action Templates' },
  template_deviation_summary: { zh: '模板偏离说明', en: 'Template Deviation' },
  current_summary: { zh: '当前情况', en: 'Current Summary' },
  creation_reviews: { zh: '方案复核', en: 'Plan Reviews' },
  execution_authorization: { zh: '执行授权边界', en: 'Execution Authorization Boundary' },
  authorized_actions: { zh: '已授权行动', en: 'Authorized Actions' },
  action_id: { zh: '行动标识', en: 'Action ID' },
  target_scope: { zh: '目标范围', en: 'Target Scope' },
  effect_scope: { zh: '影响范围', en: 'Effect Scope' },
  risk_summary: { zh: '风险摘要', en: 'Risk Summary' },
  rollback_summary: { zh: '回滚摘要', en: 'Rollback Summary' },
  rule_refs: { zh: '规则引用', en: 'Rule References' },
  action_ceiling: { zh: '行动上限', en: 'Action Ceiling' },
  prohibited_actions: { zh: '禁止行动', en: 'Prohibited Actions' },
  allowed_adjustments: { zh: '允许的调整', en: 'Allowed Adjustments' },
  verification_and_rollback: { zh: '验证与回滚', en: 'Verification and Rollback' },
  out_of_bounds_handling: { zh: '越界处置', en: 'Out-of-bounds Handling' },
  human_prerequisites: { zh: 'Human 前置条件', en: 'Human Prerequisites' },
  assurance_gap: { zh: '保证差距', en: 'Assurance Gap' },
  human_disclosure_summary: { zh: '向 Human 披露', en: 'Human Disclosure' },
  human_disclosed_at: { zh: '披露时间', en: 'Disclosed At' },
  execution_approval: { zh: '执行批准', en: 'Execution Approval' },
  baseline_fingerprint: { zh: '批准基线指纹', en: 'Approval Baseline Fingerprint' },
  result_version: { zh: '结果版本', en: 'Result Version' },
  result_summary: { zh: '总体结果', en: 'Overall Result' },
  work_item_result_summary: { zh: '工作项结果', en: 'Work Item Result' },
  controller_check_summary: { zh: '主控自检总结', en: 'Controller Check Summary' },
  result_reviews: { zh: '结果复核', en: 'Result Reviews' },
  actual_method: { zh: '实际复核方法', en: 'Actual Review Method' },
  capability_evidence: { zh: '当次能力证据', en: 'Current Capability Evidence' },
  closure_proposal: { zh: '关闭提案', en: 'Closure Proposal' },
  proposed_outcome: { zh: '拟议关闭分类', en: 'Proposed Closure Outcome' },
  proposed_disposition_summary: { zh: '拟议责任处置', en: 'Proposed Disposition' },
  residual_decisions: { zh: '剩余责任处置建议', en: 'Residual Decisions' },
  residual_id: { zh: '剩余责任标识', en: 'Residual ID' },
  proposed_disposition: { zh: '拟议处置方向', en: 'Proposed Disposition' },
  route_target: { zh: '拟分流目标快照', en: 'Proposed Route Target Snapshot' },
  spark_suggestion_id: { zh: 'Spark 建议标识', en: 'Spark Suggestion ID' },
  spark_suggestions: { zh: 'Spark 建议', en: 'Spark Suggestions' },
  suggestion_kind: { zh: '建议类型', en: 'Suggestion Kind' },
  restriction_reason: { zh: '受限原因', en: 'Constraint Reason' },
  impact_summary: { zh: '影响', en: 'Impact' },
  resume_condition: { zh: '恢复条件', en: 'Resume Condition' },
  follow_up_summary: { zh: '后续定位', en: 'Follow-up' },
  governed_project_id: { zh: '管辖项目', en: 'Governed Project' },
  fact_type_key: { zh: '事实类型', en: 'Fact Type' },
  object_id: { zh: '对象标识', en: 'Object ID' },
  content_fingerprint: { zh: '内容指纹', en: 'Content Fingerprint' },
  reviewer: { zh: '复核者', en: 'Reviewer' },
  reviewed_at: { zh: '复核时间', en: 'Reviewed At' },
  subject_version: { zh: '绑定版本', en: 'Subject Version' },
  feedback: { zh: '复核反馈', en: 'Review Feedback' },
  controller_resolution: { zh: '主控处置', en: 'Controller Resolution' },
  approved_at: { zh: '批准时间', en: 'Approved At' },
  source_refs: { zh: '批准输入引用', en: 'Approval Input References' },
  closure_outcome: { zh: '关闭分类', en: 'Closure Outcome' },
  residual_responsibilities: { zh: '接受停止的剩余责任', en: 'Accepted-stop Residual Responsibilities' },
  options: { zh: '选项', en: 'Options' },
  decision: { zh: '决策', en: 'Decision' },
  scope: { zh: '范围', en: 'Scope' },
  // v5 ADR（22 号）正文五段 + 证据条件段的阅读布局标题。
  decision_context: { zh: '决策背景', en: 'Decision Context' },
  alternatives: { zh: '备选与理由', en: 'Alternatives & Rationale' },
  decision_consequences: { zh: '后果', en: 'Consequences' },
  evidence: { zh: '证据', en: 'Evidence' },
  // 26 §8 的 friction `impact`（轻/中/重影响评级）已于 2026-11-02 撤销分级制度，
  // 词条随之删除——留着「词条在、字段不在」正是本仓反复纠正的漂移形态。
  // v5 Friction（26 号）阅读布局标题。
  phenomenon: { zh: '现象', en: 'Phenomenon' },
  attribution: { zh: '归因', en: 'Attribution' },
  friction_basis: { zh: '入账依据', en: 'Ledger Basis' },
  friction_disposition: { zh: '处置', en: 'Disposition' },
  // v5 Norm（27 号）阅读布局标题：direction_key 是机器方向标识（唯一性/索引），
  // 正文四段固定 H2 骨架（方向定位与适用范围/核心规则体系/约束与反模式/
  // 验证与遵从性检查）。
  direction_key: { zh: '方向键', en: 'Direction Key' },
  norm_positioning: { zh: '方向定位与适用范围', en: 'Direction Positioning & Scope' },
  norm_rules: { zh: '核心规则体系', en: 'Core Rule System' },
  norm_constraints: { zh: '约束与反模式', en: 'Constraints & Anti-patterns' },
  norm_compliance: { zh: '验证与遵从性检查', en: 'Verification & Compliance' },
  // v5 Goal（25 号）详情阅读布局标题：目标陈述（冻结区——为什么 + 要实现什么）
  // 与子目标（28 号对象，按 parent_goal 反查派生，不在本载体存储）。
  goal_statement: { zh: '目标陈述', en: 'Goal Statement' },
  goal_sub_goals: { zh: '子目标', en: 'Sub-goals' },
  // v5 SubGoal（28 号）阅读布局与卡片标题：身份由 object_uid 承担、显示次序由
  // 可选 `order` 承担（§7，2026-11-01 废止 SG-n），criterion/criterion_kind/
  // alignment 是本类型存在的理由（§8）。
  subgoal_order: { zh: '次序', en: 'Order' },
  // `parent_goal` 的词条已撤（2026-11-02 Human 定案「圈出来的不用显示」）。它曾以
  // 裸键登记（而非 subgoal_ 前缀）——因为身份头辅助元信息行按 **frontmatter 键名**
  // 取标签，前缀命不中就会退化成 `parent goal`。现在那一行整体撤除，词条失去唯一
  // 消费方；留着它等于「不呈现」这个决定没有落点（与 `serves` 2026-11-01 出列、
  // `anchor` 2026-11-01 废止时同一条纪律）。字段本身仍在对象上，只是没有面板渲染。
  subgoal_criterion: { zh: '达成条件', en: 'Criterion' },
  subgoal_criterion_kind: { zh: '判据类型', en: 'Criterion Kind' },
  // Human 2026-11-02：「这个地方只保留判法即可」——详情面不再显示判据类型的
  // **词**，只显示它的判法。判法自成一个阅读节点，标题即「判法」，故上面三条
  // 判法说明文案不再自带「判法：」前缀（否则同一行出现两次同名）。
  subgoal_kind_hint: { zh: '判法', en: 'How it is judged' },
  subgoal_alignment: { zh: '对齐说明', en: 'Alignment' },
  subgoal_disposition: { zh: '作废去向', en: 'Disposition' },
  // v5 DevLog（29 号 §8）阅读节点与卡片标题。正文五段固定 H2 也在此登记
  // （29 §8 的骨架即本类型的阅读节序）。
  // `occurred_at` 与 `created_at` 的**语义分工仍然成立**（§10.4：前者是「做这件事
  // 的时间」，后者是「条目形成的时间」，不得互相冒充），但二者的**并排呈现**已于
  // 2026-11-02 撤除——详见下方删除说明。
  // `devlog_occurred_at` / `devlog_created_at` 两个字段标签**已删除**（2026-11-02，
  // Human 定案「圈出来的部分不用显示」）：它们唯一的消费方是详情页的时间轴节点，
  // 该节点整块撤除后无消费方。列表卡头那枚 `occurred_at` 徽章也于同日撤除
  // （`objectList.devlogOccurredLabel` / `...Absent` 随之无消费方，见下），故
  // `occurred_at` 现在**没有任何单卡呈现面**——它的回查职责由**按 `occurred_at`
  // 排序的条目清单**承担（29 §12.1「时间线回查」）。
  devlog_summary: { zh: '当前结论', en: 'Current Conclusion' },
  devlog_disposition: { zh: '退出理由', en: 'Disposition' },
  devlog_background: { zh: '背景', en: 'Background' },
  devlog_approach: { zh: '做法', en: 'Approach' },
  devlog_measurements: { zh: '实测', en: 'Measurements' },
  devlog_conclusion: { zh: '结论与边界', en: 'Conclusion & Boundary' },
  devlog_destination: { zh: '去向', en: 'Destination' },
  category: { zh: '分类', en: 'Category' },
  priority: { zh: '优先级', en: 'Priority' },
  assignee: { zh: '执行者', en: 'Assignee' },
  path: { zh: '路径', en: 'Path' },
  project_name: { zh: '项目名称', en: 'Project Name' },
  project_kind: { zh: '项目类型', en: 'Project Kind' },
  project_path: { zh: '项目路径', en: 'Project Path' },
  ldvh_base_path: { zh: '事实实例路径', en: 'LDVH Base Path' },
  docs_path: { zh: '文档路径', en: 'Docs Path' },
  governance_scope: { zh: '管辖范围', en: 'Governance Scope' },
  language: { zh: '语言', en: 'Language' },
  framework: { zh: '框架', en: 'Framework' },
  urls: { zh: '网址', en: 'URLs' },
  at: { zh: '时间', en: 'At' },
  from: { zh: '前状态', en: 'From' },
  to: { zh: '后状态', en: 'To' },
  actor: { zh: '执行者', en: 'Actor' },
  reason: { zh: '原因', en: 'Reason' },
};

/**
 * 字段标签。`type` 为可选参数：**同名 frontmatter 字段在不同类型下语义不同**时，
 * 按类型取专属词条（与 getObjectStatusLocale 同形的分派）。
 *
 * 先例是 `disposition`：spark 的（20 §8 终态去向）与 friction 的（26 §8 废弃
 * 去向说明）**同名字段、不同语义**——不按类型分派会让摩擦界面显示 spark 的
 * 「去向」。未命中类型专属词条时回落到通用表，故既有调用方无需改动。
 */
export function getFieldLabel(fieldKey: string, locale: string, type?: string): string {
  if (type) {
    const typed = TYPE_FIELD_LABEL_LOCALES[type]?.[fieldKey];
    if (typed) return locale === 'en' ? typed.en : typed.zh;
  }
  const entry = FIELD_LABEL_LOCALES[fieldKey];
  if (!entry) return fieldKey.replace(/_/g, ' ');
  return locale === 'en' ? entry.en : entry.zh;
}

/** 类型专属的字段标签覆盖表（先命中者优先于通用表）。仅在**同名字段语义不同**
 * 时登记——否则徒增第二处来源（10 §5.5 单一来源）。 */
export const TYPE_FIELD_LABEL_LOCALES: Record<string, Record<string, { zh: string; en: string }>> = {
  // 26 §8：摩擦的 disposition 专述**终态去向**（voided 的废弃理由或 accepted 的
  // 不可清偿理由），与 spark 的终态去向（20 §8）同名字段不同语义——Human 裁定
  // 中文为「去向说明」。
  friction: {
    disposition: { zh: '去向说明', en: 'Disposition' },
    occurrence: { zh: '重复观察', en: 'Occurrence' },
  },
};

/** 字段枚举值中英映射 */
export const FIELD_VALUE_LOCALES: Record<string, Record<string, { zh: string; en: string }>> = {
  // 28 §10.2 判据类型闭集：材料形态决定判据怎么判——指标（存在一个可回读的
  // 数值并与阈值比较）、闭环记录（需要若干条可回指的记录同时在场）、可执行
  // 校验（跑一次命令或脚本，看退出码或输出）。不映射则界面直出 metric /
  // closure-records / executable-check 这类 raw 值（docs/01 §1.3）。
  criterion_kind: {
    metric: { zh: '指标', en: 'Metric' },
    'closure-records': { zh: '闭环记录', en: 'Closure records' },
    'executable-check': { zh: '可执行校验', en: 'Executable check' },
  },
  read_status: {
    readable: { zh: '可读取', en: 'Readable' },
    unreadable: { zh: '无法读取', en: 'Unreadable' },
  },
  outcome: {
    satisfied: { zh: '已满足', en: 'Satisfied' },
    not_satisfied: { zh: '未满足', en: 'Not Satisfied' },
    not_verified: { zh: '未验证', en: 'Not Verified' },
  },
  conclusion: {
    pass: { zh: '通过', en: 'Pass' },
    pass_with_followups: { zh: '通过但有后续项', en: 'Pass with Follow-ups' },
    changes_required: { zh: '需要修改', en: 'Changes Required' },
    blocked: { zh: '存在阻塞', en: 'Blocked' },
  },
  actual_method: {
    'subagent-read-only': { zh: '只读 subagent 复核', en: 'Read-only subagent review' },
    'same-ai-switched-role-read-only': { zh: '同一 AI 切换只读视角（低保证）', en: 'Same-AI switched read-only role (lower assurance)' },
  },
  closure_outcome: {
    completed: { zh: '完成', en: 'Completed' },
    partial: { zh: '部分完成', en: 'Partial' },
    'not-achieved': { zh: '未达成', en: 'Not Achieved' },
    cancelled: { zh: '已取消', en: 'Cancelled' },
  },
  proposed_outcome: {
    completed: { zh: '目标达成', en: 'Achieved' },
    partial: { zh: '部分达成', en: 'Partial' },
    'not-achieved': { zh: '未达成', en: 'Not achieved' },
    cancelled: { zh: '取消', en: 'Cancel' },
  },
  proposed_disposition: {
    route_existing: { zh: '路由到已有对象', en: 'Route to existing object' },
    suggest_spark: { zh: '建议后续建立 Spark', en: 'Suggest a follow-up Spark' },
    accept_stop: { zh: '接受停止', en: 'Accept stop' },
  },
  suggestion_kind: {
    constrained_responsibility: { zh: '受限责任', en: 'Constrained responsibility' },
    follow_up_opportunity: { zh: '后续机会', en: 'Follow-up opportunity' },
  },
  reviewer: {
    'independent-result-review-subagent': { zh: '结果复核 Reviewer', en: 'Result Review Reviewer' },
    workcase_creation_review: { zh: '方案复核 Reviewer', en: 'Plan Review Reviewer' },
  },
  category: {
    question: { zh: '问题', en: 'Question' },
    discovery: { zh: '发现', en: 'Discovery' },
    gap: { zh: '缺口', en: 'Gap' },
    reminder: { zh: '提醒', en: 'Reminder' },
    preference: { zh: '偏好', en: 'Preference' },
  },
  priority: {
    P0: { zh: 'P0', en: 'P0' },
    P1: { zh: 'P1', en: 'P1' },
    P2: { zh: 'P2', en: 'P2' },
    P3: { zh: 'P3', en: 'P3' },
    high: { zh: '高', en: 'High' },
    medium: { zh: '中', en: 'Medium' },
    low: { zh: '低', en: 'Low' },
  },
  stopping_reason: {
    sufficient: { zh: '证据充分收敛', en: 'Sufficient' },
    'no-gain': { zh: '零增益收敛', en: 'No Gain' },
    'round-cap': { zh: '轮次上限收敛', en: 'Round Cap' },
  },
  // 24 §8 退出原因闭集（与 plugin/lib/research-writer.js RETIREMENT_REASONS 同源；ADR 复用本表，另含 absorbed / abolished —
  // 见 22 §9.2，二者在 Research 侧不可出现）。abolished 是「记录不再保留、已产生的影响保留」，与「内容作废」不同形。
  retirement_reason: {
    outdated: { zh: '已过时', en: 'Outdated' },
    superseded: { zh: '已被取代', en: 'Superseded' },
    'out-of-scope': { zh: '超出范围', en: 'Out of Scope' },
    absorbed: { zh: '已被规范承接', en: 'Absorbed' },
    abolished: { zh: '记录已移除', en: 'Abolished' },
    rejected: { zh: '已否决', en: 'Rejected' },
  },
  signer_type: {
    human: { zh: 'Human', en: 'Human' },
    'ai-agent': { zh: 'AI Agent', en: 'AI Agent' },
  },
  report_kind: {
    external_research: { zh: '外部调研', en: 'External Research' },
    internal_audit: { zh: '内部审计', en: 'Internal Audit' },
    technical_assessment: { zh: '技术评估', en: 'Technical Assessment' },
    comparison: { zh: '方案比较', en: 'Comparison' },
  },
};

export function getFieldValueLabel(fieldKey: string, value: string, locale: string): string {
  const entry = FIELD_VALUE_LOCALES[fieldKey]?.[value];
  if (!entry) return value;
  return locale === 'en' ? entry.en : entry.zh;
}

const PROJECT_FILE_KIND_LOCALES: Record<string, { zh: string; en: string }> = {
  directory: { zh: '目录', en: 'Directory' },
  markdown: { zh: 'Markdown', en: 'Markdown' },
  yaml: { zh: 'YAML', en: 'YAML' },
  svg: { zh: 'SVG', en: 'SVG' },
  text: { zh: '文本', en: 'Text' },
  binary: { zh: '二进制', en: 'Binary' },
};

const GIT_STATUS_LOCALES: Record<string, { zh: string; en: string }> = {
  '??': { zh: '未跟踪', en: 'Untracked' },
  M: { zh: '已修改', en: 'Modified' },
  A: { zh: '新增', en: 'Added' },
  D: { zh: '删除', en: 'Deleted' },
  R: { zh: '重命名', en: 'Renamed' },
  C: { zh: '复制', en: 'Copied' },
  U: { zh: '冲突', en: 'Conflict' },
};

export function getProjectFileKindLabel(kind: string, locale: string): string {
  const entry = PROJECT_FILE_KIND_LOCALES[kind];
  if (!entry) return kind;
  return locale === 'en' ? entry.en : entry.zh;
}

export function getGitStatusLabel(status: string, locale: string): string {
  const trimmed = status.trim();
  const key = trimmed === '??' ? '??' : trimmed.replace(/\s/g, '').charAt(0);
  const entry = GIT_STATUS_LOCALES[key];
  if (!entry) return status;
  return locale === 'en' ? entry.en : entry.zh;
}

export function getToggleLabel(title: string, nextState: 'collapsed' | 'expanded', locale: string): string {
  const action = nextState === 'collapsed'
    ? (locale === 'en' ? 'Collapse' : '收拢')
    : (locale === 'en' ? 'Expand' : '展开');
  return locale === 'en' ? `${action} ${title}` : `${action}${title}`;
}

export type CommitDetailLabels = {
  category: string;
  type: string;
  scope: string;
  commit: string;
  time: string;
  summary: string;
  files: string;
  insertions: string;
  deletions: string;
  commitBody: string;
  changedFiles: string;
  noFiles: string;
  raw: string;
  copyHash: string;
  copiedHash: string;
  signature: string;
  modelName: string;
  environmentName: string;
};

const COMMIT_DETAIL_LABELS: Record<string, CommitDetailLabels> = {
  zh: {
    category: '分类', type: '类型', scope: '范围', commit: '提交', time: '提交',
    summary: '变更统计', files: '文件', insertions: '新增', deletions: '删除',
    commitBody: '关键变更', changedFiles: '改动文件', noFiles: '没有可展示的文件统计',
    raw: '原始信息', copyHash: '复制提交 hash', copiedHash: '已复制提交 hash',
    signature: '署名信息', modelName: '模型', environmentName: '供应商',
  },
  en: {
    category: 'Category', type: 'Type', scope: 'Scope', commit: 'Commit', time: 'Commit',
    summary: 'Change summary', files: 'Files', insertions: 'Insertions', deletions: 'Deletions',
    commitBody: 'Commit notes', changedFiles: 'Changed files', noFiles: 'No file stat available',
    raw: 'Original info', copyHash: 'Copy commit hash', copiedHash: 'Commit hash copied',
    signature: 'Signature', modelName: 'Model', environmentName: 'Provider',
  },
};

export function getCommitDetailLabels(locale: string): CommitDetailLabels {
  return COMMIT_DETAIL_LABELS[locale === 'en' ? 'en' : 'zh'];
}

const CATEGORY_LABEL_LOCALES: Record<string, { zh: string; en: string }> = {
  feat: { zh: '功能', en: 'Feature' }, fix: { zh: '修复', en: 'Fix' },
  docs: { zh: '文档', en: 'Docs' }, style: { zh: '样式', en: 'Style' },
  refactor: { zh: '重构', en: 'Refactor' }, test: { zh: '测试', en: 'Test' },
  chore: { zh: '杂项', en: 'Chore' }, perf: { zh: '性能', en: 'Perf' },
  merge: { zh: '合并', en: 'Merge' }, release: { zh: '发布', en: 'Release' },
  ci: { zh: 'CI', en: 'CI' }, build: { zh: '构建', en: 'Build' },
  spec: { zh: '规范', en: 'Spec' }, rule: { zh: '规则', en: 'Rule' },
  adr: { zh: '决策', en: 'ADR' }, other: { zh: '其他', en: 'Other' },
};

const COMMIT_TYPE_ZH: Record<string, string> = {
  feat: '新增功能', fix: '问题修复', docs: '文档修改', style: '格式调整',
  refactor: '代码重构', perf: '性能优化', test: '测试修改', build: '构建系统',
  ci: '持续集成', chore: '维护杂项', merge: '合并提交', release: '版本发布', revert: '回退变更',
};

const COMMIT_SCOPE_LOCALES: Record<string, { zh: string; en: string }> = {
  specs: { zh: 'Specs', en: 'Specs' }, docs: { zh: '文档', en: 'Docs' },
  rules: { zh: '规则', en: 'Rules' }, runtime: { zh: '运行时', en: 'Runtime' },
  code: { zh: 'Code', en: 'Code' }, web: { zh: 'Web', en: 'Web' },
  tests: { zh: 'Tests', en: 'Tests' }, config: { zh: '配置', en: 'Config' },
  workcase: { zh: '工单', en: 'WorkCase' }, adr: { zh: '决策', en: 'ADR' },
  spark: { zh: '火花', en: 'Spark' }, research: { zh: '调研', en: 'Research' },
  pitfall: { zh: '经验', en: 'Pitfall' },
  friction: { zh: '摩擦', en: 'Friction' },
  norm: { zh: '规范', en: 'Norm' },
};

export function getCategoryLabel(category: string, locale: string): string {
  const entry = CATEGORY_LABEL_LOCALES[category];
  if (!entry) return category;
  return locale === 'en' ? entry.en : entry.zh;
}

export function getCommitTypeLocale(type: string | undefined, locale: string): string {
  if (!type) return '';
  return locale === 'en' ? type : (COMMIT_TYPE_ZH[type] ?? type);
}

export function getCommitScopeLocale(scope: string | undefined, locale: string): string {
  if (!scope) return '';
  const entry = COMMIT_SCOPE_LOCALES[scope];
  if (!entry) return scope;
  return locale === 'en' ? entry.en : entry.zh;
}

export const STATUS_HINT_LOCALES: Record<string, { zh: string; en: string }> = {
  active: { zh: '进行中', en: 'In progress' },
  in_progress: { zh: '进行中', en: 'In progress' },
  blocked: { zh: '已阻塞', en: 'Blocked' },
  executing: { zh: '执行中', en: 'Executing' },
  human_plan_confirming: { zh: '等待 Human 确认方案', en: 'Waiting for human plan confirmation' },
  plan_revising: { zh: '主控正在修订当前方案', en: 'The controller is revising the current plan' },
  controller_checking: { zh: '主控正在自检当前结果', en: 'The controller is checking the current result' },
  independent_reviewing: { zh: '结果复核中', en: 'Result Review' },
  closure_preparing: { zh: '主控正在收敛关闭报告与分流建议', en: 'The controller is preparing the closure report and routing recommendations' },
  human_closure_confirming: { zh: '等待 Human 确认关闭', en: 'Waiting for human closure confirmation' },
  termination_preparing: { zh: '正在按 Human 中止指令完成善后', en: 'Completing cleanup under the human termination instruction' },
  plan_confirmation: { zh: '等待 Human 确认方案', en: 'Waiting for human plan confirmation' },
  progressing: { zh: '工单正在推进', en: 'Work is progressing' },
  termination_cleanup: { zh: '工单已停止原计划，正在完成终止善后', en: 'The original plan has stopped and termination cleanup is in progress' },
  closure_confirmation: { zh: '等待 Human 确认关闭', en: 'Waiting for human closure confirmation' },
  draft: { zh: '草稿中', en: 'In draft' },
  pending: { zh: '待分流处理', en: 'Pending routing' },
  proposed: { zh: '提案中', en: 'Proposed' },
  closed: { zh: '已关闭', en: 'Closed' },
};

export function getStatusHint(status: string, locale: string): string {
  const entry = STATUS_HINT_LOCALES[status];
  if (!entry) return '';
  return locale === 'en' ? entry.en : entry.zh;
}

export function getObjectStatusHint(type: string, status: string, locale: string): string {
  if (type === 'adr' && status === 'active') {
    return locale === 'en'
      ? 'Current effective decision'
      : '当前有效决策';
  }
  // 21 号三态直读派生分组：徽标的 title 必须说清「这是呈现派生组、不是来源
  // status」，否则 Human 会把 pending_gate1 误当成对象上的字段值。四组语义
  // 依 specs/10 §5.5 登记的派生判据（draft → 待批准执行；open ∧ 正文含
  // ## 结果 节 → 待批准关闭；open → 执行中；closed → 已关闭）。
  if (type === 'workcase') {
    if (status === 'pending_gate1') {
      return locale === 'en'
        ? 'Derived group: status=draft, awaiting Gate 1 approval (not a source status)'
        : '派生分组：status=draft、待 Gate 1 批准（不是来源 status 取值）';
    }
    if (status === 'executing') {
      return locale === 'en'
        ? 'Derived group: status=open and the body has no ## Result section yet'
        : '派生分组：status=open 且正文尚未出现「## 结果」节';
    }
    if (status === 'awaiting_gate2') {
      return locale === 'en'
        ? 'Derived group: status=open with a ## Result section, awaiting Gate 2 closure'
        : '派生分组：status=open 且正文已含「## 结果」节，待 Gate 2 关闭';
    }
    if (status === 'closed') {
      return locale === 'en'
        ? 'Derived group: status=closed; the outcome badge carries the four-value terminal state'
        : '派生分组：status=closed；终态由 outcome 四值徽标承载';
    }
  }
  // 20 §1/§9：implemented 只结束 Spark 入口职责，不代表下游完成——终态语义
  // 在提示层显式限定，防「交了就当完成」的自欺。
  if (type === 'spark') {
    if (status === 'open') {
      return locale === 'en'
        ? 'Still suspended: pending recall, judgement, split, or routing'
        : '仍在悬置：尚待召回、判断、拆分或分流';
    }
    if (status === 'implemented') {
      return locale === 'en'
        ? 'Fulfilled or handed over; only closes this entry, not downstream work'
        : '已落实或已交接——只结束本入口职责，不代表下游完成';
    }
    if (status === 'discarded') {
      return locale === 'en'
        ? 'No longer tracked, or merged/split into other sparks'
        : '不再跟踪，或已被合并/拆分到其他火花'
    }
  }
  // 26 §9：账目语义限定——open 是待修的账（参与攒账与度量），resolved 由
  // informs 指向解药，voided 是记错了的账目（不参与查重、度量与迭代决策输入），
  // accepted 是记对了但不可清偿的账（参与查重、命中静默；不参与 open 计数与解决率）。
  // （2026-10 修订：原第四值 observing 已退出闭集，观察材料改由 11 §12bis.1 的
  // 摩擦观察缓冲承载，非事实对象，故此处不再有留观的语义限定文案。）
  if (type === 'friction') {
    if (status === 'open') {
      return locale === 'en'
        ? 'An unpaid ledger entry: pending fix, counted toward accumulation and metrics'
        : '待修的账：参与攒账与度量，尚待修复';
    }
    if (status === 'resolved') {
      return locale === 'en'
        ? 'Fixed and settled; the remedy is traceable via its informs relation'
        : '已修复销账：解药经 informs 关系可追溯';
    }
    if (status === 'voided') {
      return locale === 'en'
        ? 'Misfiled entry: kept for traceability, but out of dedup, metrics and decision inputs'
        : '已废弃：载体保留可追溯，但不参与查重、度量与迭代决策输入';
    }
    if (status === 'accepted') {
      return locale === 'en'
        ? 'Accepted as unpayable: real obstacle with no elimination path; recorded once and no longer reported'
        : '已接受（不可清偿）：阻碍真实但消除途径不存在或不在可动范围；记录一次，不再重复报告';
    }
  }
  // 27 号 §9：active 是当前生效规则（同 ADR active 语义限定）；retired 终态不重开。
  if (type === 'norm') {
    if (status === 'active') {
      return locale === 'en'
        ? 'Currently effective norm for its direction'
        : '该方向当前生效的规范';
    }
    if (status === 'retired') {
      return locale === 'en'
        ? 'Retired; kept as read-only history, not reopened'
        : '已退役：保留为只读历史档案，不重开';
    }
  }
  // 28 号 §9：子目标三态语义限定。achieved 的证据是**判据材料**，不是
  // 「名下工单都关了」——后者是本类型最主要的误读（28 §18 红线 3），
  // 故提示层显式否定它。
  if (type === 'subgoal') {
    if (status === 'active') {
      return locale === 'en'
        ? 'In progress: its criterion has not yet been satisfied by evidence'
        : '推进中：判据尚未被证据满足';
    }
    if (status === 'achieved') {
      return locale === 'en'
        ? 'Criterion satisfied by evidence — not implied by closing its work cases'
        : '判据已由证据满足——不由名下工单关闭推出';
    }
    if (status === 'retired') {
      return locale === 'en'
        ? 'Retired and not reopened; its SG number is never reused'
        : '已作废且不重开；锚点编号不复用';
    }
  }
  // 25 号 §7：active 是项目存续期常态；achieved 是全部 sub-goal 达成后的
  // Human 终局判定——冻结为历史档案。
  if (type === 'goal') {
    if (status === 'active') {
      return locale === 'en'
        ? 'The current frozen anchor all work is measured against'
        : '当前生效的项目目标锚——全部前向工作的统一引用顶点';
    }
    if (status === 'achieved') {
      return locale === 'en'
        ? 'All sub-goals achieved and closed out; frozen as history'
        : '全部子目标达成并收官：冻结为历史档案';
    }
  }
  return getStatusHint(status, locale);
}

export const UI_LOCALES = {
  zh: {
    'logo.tagline': '让 Vibe Coding 更高效、更稳定、更可控',

    'nav.cognition': '聚焦',    'nav.projectFiles': '目录',
    'nav.workcases': '工单',
    'nav.adrs': '决策',
    'nav.pitfalls': '经验',
    'nav.sparks': '火花',
    'nav.studies': '调研',
    'nav.frictions': '摩擦',
    'nav.norms': '规范',
    'nav.subgoals': '子目标',
    'nav.devlogs': '开发日志',

    'goalDetail.openDetail': '查看目标详情',
    'goalDetail.subGoals': '子目标',
    'goalDetail.subGoalLegacy': '该行仍来自 goal.md 已移出的子目标段——属于待迁移，不构成第二条权威（28 §14.2）',
    'objectList.subGoalAchievedNote': '该子目标的达成条件已由证据满足——由判据判定，不由名下工作全部关闭推出（28 §18 红线 3）。',
    'objectList.subGoalOrderLabel': '次序',
    'objectList.subGoalOrderAbsent': '未定次序',
    // 子目标卡的关联区（28 §8.1 名下工作派生）：按类型分层、每层先展固定条数。
    //
    // 「每层先展 N 条」是**扫读预算**，不是收窄：超出部分必须可展开，且展开后
    // 条目与折叠时逐条相同、次序相同——只改变可见条数，不改变内容。
    'objectList.subGoalServingWork': '名下的工作',
    'objectList.subGoalServingEmpty': '未声明或未拆解——名下没有任何 serves 指向本条子目标（28 §8.1；这不是进度 0%）',
    'objectList.subGoalServingUnreadable': '读不到，不能当作「没有」',
    'objectList.subGoalServingExpand': '展开其余 {count} 条',
    'objectList.subGoalServingCollapse': '收起',
    // 28 号子目标卡的「火花落实」比值（Human 定案 2026-11-02）。四句「算不出」的各
    // 自原因见 utils/servingSparkProgress.ts——它们下一步动作不同，不能合成一句「暂无」。
    'objectList.subGoalSparkProgress': '火花落实',
    'objectList.subGoalSparkProgressEmpty': '名下没有火花——分母为空，不是 0%',
    'objectList.subGoalSparkProgressAllDiscarded': '名下火花均已废弃，不再计入分母（已废弃＝被合并或拆分，不代表这件事少了一件）',
    'objectList.subGoalSparkProgressUnavailable': '火花读取失败，无法算出这个比值——读不到不等于没有（00 §5.6）',
    'objectList.subGoalSparkProgressUnknown': '{count} 条火花状态在闭集外，未计入分母',
    // 聚焦页目标区的**行内**短词（Human 定案 2026-11-02「目标块的 sg 都要附带进度条」）。
    // 行内只有 20px 高，长句会把子目标标题挤成两行；完整理由仍由上面四条承载并挂
    // title。短词必须与完整说明**同时**给出——只给短词会让「读不到」看起来像状态。
    'focusV2.subGoalProgressEmpty': '未拆解',
    'focusV2.subGoalProgressAllDiscarded': '已处置',
    'focusV2.subGoalProgressUnavailable': '读不到',
    // 聚焦页目标区的子目标行（2026-11-03 改版）：除标题外默认收起，点击展开。
    //
    // 「展开」只写一个词：展开后是**判据面 + 名下的工作**两块，与子目标卡同形，
    // 不再另加小标题——「达成条件」「对齐说明」两个小标题已撤（Human 2026-11-03
    // 圈出）：判据面自带类型色，小标题是复述；对齐说明是理由不是判定，留在详情页读。
    'focusV2.subGoalExpand': '展开',
    'focusV2.subGoalCollapse': '收起',
    // 进度摘要的两档标签**不在此处登记**：它们由 `getObjectStatusLocale('spark', …)`
    // 给出（待处理／已落实），与子目标卡、详情页同源。单独登记一份会在两处漂移——
    // 「已落实」在本仓库是跨类型的状态词，不该有第二个出处。
    'objectList.subGoalSparkProgressOpen': '待处理',
    'objectList.subGoalSparkProgressImplemented': '已落实',
    // 29 号 DevLog 列表卡与详情面的界面词条。
    // `objectList.devlogNoTopic` **已删除**（2026-11-02，Human 定案「圈出来的部分
    // 不用显示」）：空集提示与两时间行同住详情页的一个 `<section>`，整块撤除。
    // 撤除的依据不是「这句话不好」，而是 `serves` 自 2026-11-01 起已不在本类型任何
    // 呈现面出现（29 §12.1），空集提示只是该字段缺席的推断而非条目内容；规范 29
    // §8.1/§14.1 已同步修订（不再要求呈现面标注）。**29 号字段 `serves` 本身未撤销**，
    // 它的非呈现消费方（召回精确引用、承接核对）照旧。
    'objectList.devlogCompressedBody': '已被承接，正文压缩为「结论与边界」与「去向」两段（29 §9.1）',
    'objectList.devlogConclusionMissing': '当前结论缺失——29 §8 要求 summary 非空且逐字出现在「结论与边界」段',
    // `objectDetail.subGoalOrderAbsent` 已删除（2026-11-02 晚）：它唯一的消费方是
    // 子目标详情面顶部那个锚点块，该块已随「只保留判法」整体撤除。缺失态文案改由
    // `objectList.subGoalOrderAbsent` 承担——卡头与身份头用的是同一枚
    // `SubGoalOrderBadge`，本来就不该有第二份。留着两个同名键，改一处就会漏另一处。
    'objectDetail.subGoalCriterionDetail': '达成条件（展开）',
    'objectDetail.subGoalAlignmentDetail': '对齐说明（展开）',
    'objectDetail.subGoalServingWork': '名下的工作',
    'objectDetail.subGoalServingEmpty': '未声明或未拆解——名下没有任何 serves 指向本条子目标。这两种情形在机械层不可区分：可能真的还没拆解，也可能拆解了但下游没写 serves（28 §8.1）。这不是进度 0%。',
    'objectDetail.subGoalServingUnreadable': '以下类型读不到，不能当作「名下没有工作」',
    'objectDetail.subGoalKindHint.metric': '存在一个可回读的数值，与阈值比较即知是否达成',
    'objectDetail.subGoalKindHint.closure-records': '需要若干条可回指的记录同时在场，缺一条即未达成',
    'objectDetail.subGoalKindHint.executable-check': '跑一次命令或脚本，按退出码或输出判定',
    'goalDetail.missingTitle': '项目目标尚未创建',
    'goalDetail.missingBody': 'goal.md 不存在——Goal 事实对象尚未创建（项目初始化前的合法状态）。创建走 AI 受控写入路径，Web 是纯呈现层。',
    'nav.changes': '变更',
    'nav.changelog': '提交',
    'nav.help': '帮助',

    'nav.diagnostics': '诊断',
    'diagnostics.title': '运行时诊断',
    'diagnostics.subtitle': '只读观察机制自身的失效形态——这里的数据不写回任何事实源。',
    'diagnostics.loadFailed': '数据加载失败',
    'diagnostics.tab.gate': '写入关卡',
    'diagnostics.tab.idle': '闲时辅助',
    'diagnostics.tab.observations': '摩擦观察',
    'diagnostics.tab.experience': '经验观察',
    'diagnostics.tab.cleanup': '日志清理',
    'diagnostics.cleanup.retention': '保留期限',
    'diagnostics.cleanup.retentionHint': '早于该期限的记录会被清理。删除前会自动备份。',
    'diagnostics.cleanup.keepDays': '保留近 {n} 天',
    'diagnostics.cleanup.targets': '清理范围',
    'diagnostics.cleanup.targetsHint': '各类日志默认只勾流水类；观察材料丢了就是丢证据，须显式勾选。',
    'diagnostics.cleanup.t.pendingQueue': '待处置队列',
    'diagnostics.cleanup.n.pendingQueue': '失败与缺口的登记流水（append-only）。',
    'diagnostics.cleanup.t.idleRuns': '运行痕迹',
    'diagnostics.cleanup.n.idleRuns': '每次检查点的结局（环形，本就只留最近 50 条）。',
    'diagnostics.cleanup.t.queueBackups': '队列备份文件',
    'diagnostics.cleanup.n.queueBackups': '清理前留的 .bak-* 备份，按文件修改时间判定。',
    'diagnostics.cleanup.t.experienceBuffer': '经验观察',
    'diagnostics.cleanup.n.experienceBuffer': '待审核的经验素材——清理后未审核过的将永久失去。',
    'diagnostics.cleanup.t.frictionObservations': '摩擦观察',
    'diagnostics.cleanup.n.frictionObservations': '未达阈值的观察条目——清理会重置「攒到几分」的进度。',
    'diagnostics.cleanup.removeCount': '删 {count}',
    'diagnostics.cleanup.keepCount': '留 {count}',
    'diagnostics.cleanup.preview': '预览将删除的条数',
    'diagnostics.cleanup.clean': '执行清理',
    'diagnostics.cleanup.working': '处理中…',
    'diagnostics.cleanup.willRemove': '早于 {cutoff} 的记录将被删除，合计 {count} 条',
    'diagnostics.cleanup.doneDetail': '已清理 {count} 条，备份存于 {path}',
    'diagnostics.cleanup.backupAt': '备份位置',
    'diagnostics.cleanup.notListed': '不在清理范围的内容',
    'diagnostics.cleanup.notListedHint': '水位（friction-discovery-watermarks）刻意不可清理：删它会让机制重新观察已处理内容并重复入账。事实源（ldvh-base/）也不在此处——它不受日志清理影响。',
    // ── 经验观察（11 §12bis）：与摩擦观察并列，故文案也并列放置 ──────────
    'diagnostics.experience.title': '经验观察',
    'diagnostics.experience.subtitle': '代理在对话里摘下的经验材料，等审核段判断能否成文。这些不是事实对象，也不是候选。',
    'diagnostics.experience.pendingHint': '等下一次审核段逐条判定',
    'diagnostics.experience.discarded': '判定不构成经验',
    'diagnostics.experience.discardedHint': '已判为不值得成文：留痕不入事实对象，随后由日志清理带走',
    'diagnostics.experience.entries': '材料条目',
    'diagnostics.experience.pending': '待审核',
    'diagnostics.experience.oldest': '最老一条',
    'diagnostics.experience.oldestNone': '暂无待审核材料',
    'diagnostics.experience.projects': '按 {count} 个项目分区',
    'diagnostics.experience.entriesTitle': '最近摘下的材料',
    'diagnostics.experience.entriesHint': '只显示现象、时间、来源与状态四项。逐字引证与待审核问题不在本页显示——它们属材料内容，不属运行状态。',
    'diagnostics.experience.empty': '暂无材料。',
    'diagnostics.experience.noBufferDir': '还没有观察载体',
    'diagnostics.experience.noBufferDirHint': '这是正常初态：还没有任何经验材料被摘下。等捕获段跑过一次，这里就会出现内容。',
    'diagnostics.observations.entries': '观察条目',
    'diagnostics.observations.projects': '按管辖项目分载：{count} 个文件',
    'diagnostics.observations.groups': '观察组',
    'diagnostics.observations.threshold': '达 {n} 条即晋升为待修账目',
    'diagnostics.observations.ready': '已达阈值',
    'diagnostics.observations.pending': '待攒中',
    'diagnostics.observations.groupsTitle': '观察组：同一阻碍被看过几次',
    'diagnostics.observations.groupsHint': '观察材料不是事实对象，此处只作「攒到几分」的进度呈现，不构成账目、不可点入详情。',
    'diagnostics.observations.recentTitle': '最近的观察条目',
    'diagnostics.observations.recentHint': '仅呈现现象／时间／来源／状态四项（11 §12bis.1 第 2 条）；证据全文与晋升目标不在呈现面内。',
    'diagnostics.observations.readyBadge': '可晋升',
    'diagnostics.observations.empty': '暂无条目',
    'diagnostics.observations.noBufferDir': '观察目录尚未建立',
    'diagnostics.observations.noBufferDirHint': '这是正常初态：还没有任何观察落地。摩擦发现首次写入观察时会自动建立该目录。',
    'diagnostics.gate.calls': '工具调用',
    'diagnostics.gate.failed': '被拒次数',
    'diagnostics.gate.failureRate': '失败率 {rate}%',
    'diagnostics.gate.worstTool': '失败最多的工具',
    'diagnostics.gate.sessions': '已扫描会话',
    'diagnostics.gate.byCategory': '失败按性质分类',
    'diagnostics.gate.byTool': '各工具调用与失败',
    'diagnostics.gate.recentFailures': '逐条失败记录',
    'diagnostics.gate.toolColumn': '工具',
    'diagnostics.gate.empty': '没有记录。',
    'diagnostics.idle.unresolved': '未处置登记',
    'diagnostics.idle.total': '累计 {count} 条',
    'diagnostics.idle.over24h': '超 24 小时未处置',
    'diagnostics.idle.runs': '运行轮次',
    'diagnostics.idle.stopped': '异常停止',
    'diagnostics.idle.stoppedHint': '跑完未落地的轮次',
    'diagnostics.idle.byCategory': '未处置登记按原因分类',
    'diagnostics.idle.recentRuns': '最近运行',
    'diagnostics.idle.queueRecent': '最近未处置登记',
    'diagnostics.idle.settled': '已核查结案',
    'diagnostics.idle.settledHint': '结案通道被使用过的次数',
    'diagnostics.idle.settledRecent': '最近结案',
    'diagnostics.idle.settledRecentNote': '结案说明是核查的产物；没有说明的结案不是核查产物。',
    'diagnostics.idle.settledEmpty': '从未结案——结案通道存在，但没有人用过。',
    'diagnostics.idle.settledNoNote': '这条结案没有留下核查说明。',
    'diagnostics.idle.runQueueKey': '队列登记 {id}',
    'diagnostics.idle.empty': '没有记录。',
    'diagnostics.category.missingArguments': '缺必填参数',
    'diagnostics.category.auditSummaryShape': '审核摘要不规范',
    'diagnostics.category.carrierValidation': '正文/载体校验未过',
    'diagnostics.category.objectNotFound': '查不到对象或键',
    'diagnostics.category.shapeAndConcurrency': '形态与并发',
    'diagnostics.category.other': '其他',
    'diagnostics.category.subagentStopped': '子代理异常停止',
    'diagnostics.category.observationGap': '观察区间缺口',
    'diagnostics.category.quoteNotInWindow': '引证不在窗口',
    'diagnostics.category.quoteTooShort': '引证过短',
    'diagnostics.category.carrierIneffective': '载体内聚失败',
    'diagnostics.category.titleTooLong': '标题过长',
    'diagnostics.category.dispatchUnavailable': '派发不可用',
    'diagnostics.status.rejected': '拒绝',
    'diagnostics.status.invalidRequest': '请求不合法',
    'diagnostics.status.completed': '完成',
    'diagnostics.status.unknown': '未知',

    'nav.settings': '设置',
    'nav.collapseSidebar': '收起侧栏',
    'nav.expandSidebar': '展开侧栏',
    'nav.refreshReading': '刷新页面数据',
    'nav.openInBrowser': '在浏览器中打开当前页面',
    'projectSwitcher.label': '管辖项目',
    'projectSwitcher.choose': '选择项目',
    'projectSwitcher.scopeHint': '全局项目范围',
    'projectSwitcher.worktreeScopeHint': '选择管辖项目下的工作树与分支',
    'projectSwitcher.projectCount': '{count} 个项目',
    'projectSwitcher.worktreeCount': '{count} 个工作树',
    'projectSwitcher.mainWorktree': '主工作区',
    'projectSwitcher.detached': '游离 HEAD',
    'projectSwitcher.refresh': '刷新 worktree 列表',
    'projectSwitcher.loading': '正在读取项目',
    'projectSwitcher.loadFailed': '项目读取失败',
    'projectSwitcher.noProjects': '没有可选择的管辖项目',
    'settings.title': '设置',
    'settings.subtitle': '管理工作区的管辖项目配置',
    'settings.managementScope': '管理范围',
    'settings.configOnly': '这里只管理 LDVH-GOVERNED-PROJECTS.yaml 中的项目登记；不修改项目事实、Git 分支或执行状态。',
    'settings.verificationBoundary': '验证边界',
    'settings.gitNotice': '无需填写 Git 远程地址。每个本地路径在保存时必须能现场验证为有效 Git 工作区；远程地址、分支和 HEAD 不参与管辖项目判定。',
    'settings.governedProjects': '管辖项目',
    'settings.verifyCurrent': '验证当前配置',
    'settings.verifying': '正在验证…',
    'settings.savedVerified': '保存成功，当前项目登记已通过 Git 工作区验证。',
    'settings.currentVerified': '当前全部项目登记均已通过 Git 工作区验证。',
    'settings.defaultProject': '默认项目',
    'settings.saveDefault': '保存默认项目',
    'settings.defaultExplicit': '启动时默认选中此项目。',
    'settings.defaultFallback': '当前按配置列表首项临时选中。',
    'settings.addProject': '添加项目',
    'settings.stableId': '稳定 ID',
    'settings.localWorktreePath': '本地 Git 工作区路径',
    'settings.nickname': '简称',
    'settings.addAndVerify': '添加并验证 Git 项目',
    'settings.projectId': 'ID',
    'settings.projectPath': '路径',
    'settings.saveNickname': '保存简称',
    'federation.title': '全部管辖',
    'federation.subtitle': '所有管辖项目的只读汇总；进入单项目视图请在项目卡上选择「进入项目」。',
    'federation.refresh': '刷新',
    'federation.retry': '重试',
    'federation.noProjects': '当前没有登记的管辖项目。',
    'federation.defaultProject': '默认',
    'federation.sparkOpen': '悬置',
    'federation.activeWorkCases': '推进中',
    'federation.pendingDecisions': '待决定',
    'federation.lastActivity': '最后动态',
    'federation.projectIssues': '部分数据不可用',
    'federation.enterProject': '进入项目',
    'federation.crossSparks': '跨项目悬置（按优先级与陈旧度）',
    'federation.objectsTitle': '全部管辖',
    'federation.objectsSubtitle': '全部管辖项目的对象聚合列表；打开对象将进入其所属项目的详情视图。',
    'federation.unsupportedType': '不支持的对象类型。',
    'federation.loading': '读取中…',
    'federation.noObjects': '当前筛选条件下没有对象。',
    'federation.projectFilter': '项目',
    'federation.allProjects': '全部',
    'federation.singleProjectOnly': '该页面需要进入单个管辖项目后使用',
    'projectSwitcher.allProjects': '全部管辖',
    'settings.projectColor': '项目颜色',
    'settings.readOnlyHint': '管辖配置为只读：请在 DSH 插件设置卡（LDVH）修改登记；项目颜色可在本页或插件设置卡设置。',
    'settings.colorAuto': '自动（按 ID 稳定取色）',
    'settings.removeProject': '移除项目',
    'settings.removeConfirm': '移除管辖项目“{project}”？这只会修改工作区配置。',
    'settings.retryLoad': '重新读取',
    'settings.workspaceWorktrees': '当前工作区 Worktree',
    'settings.workspaceWorktreesHint': '按当前工作区的项目目录只读扫描 Git worktree，查看分支与未提交状态；扫描不会改变管辖配置。',
    'settings.refreshWorktrees': '刷新 Worktree',
    'settings.noWorktrees': '当前工作区未发现 Git worktree。',
    'settings.detachedHead': '分离 HEAD',
    'settings.mainWorktree': '主工作区',
    'settings.worktreeStatus': '暂存 {staged} · 未暂存 {unstaged} · 未跟踪 {untracked} · 冲突 {conflicted}',
    'settings.worktreeStatusUnavailable': '当前无法读取工作区状态。',
    'settings.worktreeRegistered': '已登记：{id}',
    'settings.worktreeGovernedBy': '隶属管辖项目：{id}',
    'settings.addWorktree': '加入管辖',
    'theme.system': '跟随系统',
    'theme.light': '浅色模式',
    'theme.dark': '深色模式',
    'language.switchToEnglish': '切换到英文',
    'language.switchToChinese': '切换到中文',
    'language.english': 'English',
    'language.chinese': '中文',

    'focusV2.goalTitle': '目标',
    'focusV2.hintCreateGoal': '在对话中与AI沟通创建并分解目标',
    'focusV2.hintCreateExample': '比如说：我要创建目标',
    'focusV2.collapseSection': '收起目标',
    'focusV2.expandSection': '展开目标',
    'focusV2.btnCopied': '已复制',
    'focusV2.promptSetGoal': '我要创建目标',

    'cognition.title': '聚焦',
    'cognition.derivedView': '派生视图',
    'cognition.inbox.title': '待决定事项',
    'cognition.inbox.empty': '当前没有待你决定的事项',
    'cognition.inbox.truncated': '共 {total} 项待决定，按排序显示前 {shown} 项，{hidden} 项未显示',
    'cognition.inbox.showAll': '显示全部',
    'cognition.inbox.collapse': '收起',
    'cognition.inbox.expandSection': '展开待决定事项',
    'cognition.inbox.collapseSection': '收起待决定事项',
    // 26 §12：已接受成本单列计数（accepted 不进待决定事项，只作度量观测量）。
    'cognition.frictionLedger.accepted': '已接受（不可清偿）{count} 笔',
    'cognition.inbox.unavailable': '本模块部分数据不可用',
    'cognition.active.title': '推进中事项',
    'cognition.active.empty': '当前没有推进中的工单',
    'cognition.active.truncated': '共 {total} 项推进中事项，按排序显示前 {shown} 项，{hidden} 项未显示',
    'cognition.active.showAll': '显示全部',
    'cognition.active.collapse': '收起',
    'cognition.active.expandSection': '展开推进中事项',
    'cognition.active.collapseSection': '收起推进中事项',
    'cognition.active.unavailable': '推进中事项部分数据不可用',
    'cognition.active.copyModuleSummary': '复制模块摘要',
    'cognition.active.copiedModuleSummary': '已复制模块摘要',
    'cognition.kind.plan_confirmation': '待批准计划',
    'cognition.kind.closure_confirmation': '待确认关闭',
    'cognition.kind.friction_repair': '待修摩擦',
    'cognition.copyModuleSummary': '复制模块摘要',
    'cognition.copiedModuleSummary': '已复制模块摘要',
    'cognition.updatedAt': '更新于 {time}',
    'cognition.recent.title': '近期动态',
    'cognition.recent.empty': '该时间范围内没有可观察到的对象动态',
    'cognition.recent.created': '新建',
    'cognition.recent.updated': '更新',
    'cognition.recent.windowLabel': '近期动态时间范围',
    'cognition.recent.window.1d': '最近 1 天',
    'cognition.recent.window.3d': '最近 3 天',
    'cognition.recent.window.7d': '最近 1 周',
    'cognition.recent.truncated': '共 {total} 个事实对象，显示前 {shown} 个，{hidden} 个未显示',
    'cognition.recent.showAll': '显示全部',
    'cognition.recent.showMore': '显示更多',
    'cognition.recent.showRemaining': '显示其余 {count} 项事实对象',
    'cognition.recent.showRemainingUsage': '显示其余 {count} 项署名统计',
    'cognition.recent.collapse': '收起',
    'cognition.recent.activityCount': '{count} 条动态',
    // 26 §8 occurrence（重复观察次数 = 频次的机械权威源）：卡头眼睛图标 chip 的悬浮说明。
    // 措辞与「修改次数」明确区分——前者是「被观察到几次」，后者是「改过几次」；
    // 二者是不同的量，混同会误导阈值判断。
    'cognition.recent.occurrenceCount': '重复观察 {count} 次（26 §8 频次的机械权威源）',
    'cognition.recent.modelUsage': '模型',
    'cognition.recent.environmentUsage': '供应商',
    'cognition.recent.expandSection': '展开近期动态',
    'cognition.recent.collapseSection': '收起近期动态',
    'cognition.recent.copyModuleSummary': '复制模块摘要',
    'cognition.recent.copiedModuleSummary': '已复制模块摘要',
    'cognition.recent.loading': '正在更新…',
    'cognition.sparkHealth.title': 'Spark 健康度',
    'cognition.sparkHealth.empty': '当前筛选条件下没有待处理 Spark',
    'cognition.sparkHealth.unavailable': 'Spark 健康度数据不可用',
    'cognition.sparkHealth.ageFilter': '时间',
    'cognition.sparkHealth.ageFilter.all': '全部',
    'cognition.sparkHealth.ageFilter.3d': '超过 3 天',
    'cognition.sparkHealth.ageFilter.7d': '超过一周',
    'cognition.sparkHealth.settled': '已收敛 {count}',
    'cognition.sparkHealth.pending': '待处理 {count}',
    'cognition.sparkHealth.silentDays': '{days} 天未更新',
    'cognition.sparkHealth.showRemaining': '显示其余 {count} 项待处理火花',
    'cognition.sparkHealth.collapseList': '收起静默项',
    'cognition.sparkHealth.expandSection': '展开 Spark 健康度',
    'cognition.sparkHealth.collapseSection': '收起 Spark 健康度',
    'cognition.sparkHealth.copyModuleSummary': '复制模块摘要',
    'cognition.sparkHealth.copiedModuleSummary': '已复制模块摘要',

    // 空态分两句（Human 定案 2026-11-02）：此前只有一句「未找到 {type} 对象」，且 {type}
    // 传的是**原始类型键**（norm / devlog），于是中文界面里会冒出英文键名。两句的分工是
    // **读者的问题不同**，不是措辞偏好：
    // · `noObjects` —— 这个类型**本来就没有**任何对象（目录都没建过也算），下一步是去建；
    // · `noObjectsUnderFilter` —— 对象**有**，只是当前筛选没命中，下一步是放宽筛选。
    // 而 `typeNotIntegrated` 不再作为空态文案出现：目录缺失已按零对象处理（见
    // `api/services/localFactReader.ts` 的 `emptyTypeDirectory`）；该键仍保留，因为
    // `coverage_status=type_not_integrated` 这条前端契约还在（三个筛选器的 `—` 计数与
    // 上方覆盖警示条按它工作），只是后台已不会因「目录不存在」产出它。
    'objectList.noObjects': '还没有{type}对象',
    'objectList.noObjectsUnderFilter': '当前筛选条件下没有{type}对象',
    'objectList.searchLabel': '搜索对象',
    'objectList.searchPlaceholder': '搜索标题或完整对象 ID',
    'objectList.searchNoResults': '未找到匹配的对象',
    'objectList.typeNotIntegrated': '该事实类型尚未接入',
    'objectList.all': '全部',
    'objectList.statusFilter': '状态筛选',
    'objectList.reportKindFilter': '报告类型',
    'objectList.lifecycleFilter': '生命周期',
    'objectList.progressGroupFilter': '进展分组',
    'objectList.priorityFilter': '优先级',
    'objectList.sort': '排序',
    'objectList.sortUpdatedDesc': '最后更新 ↓',
    'objectList.sortCreatedDesc': '创建时间 ↓',
    'objectList.sortPriorityAsc': '处置次序 ↑',
    'objectList.priorityNotApplicable': '终态对象不适用优先级。',
    'objectList.relatedPlans': '关联工单',
    'objectList.planCount': '{count} 个工单',
    'objectList.activePlanCount': '活跃工单',
    'objectList.humanConfirmPlanCount': '待确认工单',
    'objectList.closedPlanCount': '已闭合工单',
    'objectList.closeDecision': '关闭判断',
    'objectList.closureIssue': '收口异常',
    'objectList.planExecutionQueue': '执行队列',
    'objectList.planExecutionItems': '执行项',
    'objectList.executionItemCount': '{count} 个执行项',
    'objectList.planExecutionRisk': '风险',
    'objectList.executionFlowPending': '待处理',
    'objectList.executionFlowInProgress': '进行中',
    'objectList.executionFlowBlocked': '已阻塞',
    'objectList.executionFlowCompleted': '已完成',
    'objectList.executionFlowCancelled': '已取消',
    'objectList.executionFlowRisk': '异常',
    'objectList.executionFlowOther': '其他',
    'objectList.executionFlowCount': '{status} {count} 个',
    'objectList.activeCount': '{count} 进行中',
    'objectList.reviewCount': '{count} 待关闭',
    'objectList.riskCount': '{count} 有风险',
    'objectList.noPlans': '暂无关联工单',
    'objectList.noExecutionItems': '暂无执行项',
    'objectList.morePlans': '还有 {count} 个工单',
    'objectList.moreExecutionItems': '还有 {count} 个执行项',
    'objectList.successCriteria': '成功标准',
    'objectList.planConfirmedAt': '方案确认',
    'objectList.reviewRequestedAt': '请求确认',
    'objectList.closureRequestedAt': '请求关闭',
    'objectList.completionEvidence': '完成证据',
    'objectList.verificationEvidence': '验证证据',
    'objectList.closureEvidence': '关闭证据',
    'objectList.hasRecord': '已记录',
    'objectList.missingRecord': '未完成',
    'objectList.disposition': '处置说明',
    'objectList.missingReason': '原因缺失',
    'objectList.missingReasonText': '该非活跃对象必须在事实源中记录原因。',
    'objectList.updated': '更新 {time}',
    'objectList.noRouteTarget': '未记录事实对象目标',
    'objectList.routed': '已分流',
    'objectList.target': '目标',
    'objectList.time': '时间',
    'objectList.dispositionMissing': '处置说明缺失。',
    'objectList.associationUnavailable': '关联信息不可用。',
    'objectList.sourceBranch': '来自 {branch} 分支',
    'objectList.mainWorktreeDiffers': '主工作区有差异',
    'objectList.associationState.pending': '待处理',
    'objectList.associationState.closed': '已关闭',
    'objectList.associationState.discarded': '已废弃',
    'objectList.associationState.progressing': '推进中',
    'objectList.associationState.active': '活跃',
    'objectList.discarded': '已废弃',
    'objectList.reason': '原因',
    'objectList.workcaseStateDynamic': '正在推进',
    'objectList.workcaseStateWaiting': '等待 Human 处理',
    'objectList.workcaseStateClosed': '工单已关闭',
    'objectList.workcaseProgressUnavailable': '进展信息不可判定',
    'objectList.workcaseProgressGroupUnavailable': '未能形成进展分组。',
    // 10 §5.5「呈现降级」：gist 在 closed 时缺失合法（21 §8 终态只读）。卡面
    // 如实降级，不以 summary 静默替代、也不留白。
    'objectList.workcaseGistMissing': '（本对象未登记要点）',
    'objectList.workcaseStageUnavailable': '当前环节不可判定',
    'objectList.workcasePlanRevising': '方案修订中',
    'objectList.workcaseOutsideProgressTrack': '四步轨迹之外',
    'objectList.workcaseItemsUnavailable': '工作项进展不可判定',
    'objectList.workcaseGoal': '目标',
    'objectList.workcaseContributions': '后续贡献',
    'objectList.workcaseTargetReading': '读取中',
    'objectList.workcaseSparkSuggestions': 'Spark 建议',
    'objectList.workcaseRestrictionReason': '受限原因',
    'objectList.workcaseImpactSummary': '影响',
    'objectList.workcaseResumeCondition': '恢复条件',
    'objectList.workcaseFollowUpSummary': '后续定位',
    'objectList.workcaseClosureDecisionInput': '关闭判断输入',
    'objectList.workcaseClosureProposal': '关闭提案',
    'objectList.workcaseTerminalDisposition': '终态处置',
    'objectList.workcaseProposedOutcome': '关闭结论（提议）',
    'objectList.workcaseDispositionSummary': '处置摘要',
    'objectList.workcaseResidualDecisions': '遗留事项处置建议',
    'objectList.workcaseClosureProposalMissing': '关闭提案缺失或结构不符，无法形成关闭判断输入。',
    'objectList.workcaseItemProgress': '已完成 {done}/{total}',
    'objectList.workcaseItemsCancelled': '另有 {count} 项取消',
    'objectList.workcaseItems': '工作项',
    'objectList.workcaseCurrentItems': '当前工作项',
    'objectList.workcaseNoCurrentItems': '尚无进行中工作项',
    'objectList.workcaseItemCompleted': '已完成',
    // 21 号三态直读 + 派生分组（WC-0002 呈现契约；派生规则：待批准关闭 = open ∧ 正文含 ## 结果 节）
    'objectList.workcaseOutcome.completed': '已完成',
    'objectList.workcaseOutcome.partial': '部分达成',
    'objectList.workcaseOutcome.not-achieved': '未达成',
    'objectList.workcaseOutcome.cancelled': '已取消',
    // 已关闭卡的**合并徽标**用词（状态词 + 中心圆点 + 结论词，Human 裁定 2026-09-30）。
    // 与上面的 `workcaseOutcome.*` 分开：那套是**结论词单独出现**时的词（已完成／部分达成
    // ／未达成／已取消，用于详情面与独立徽标），本套是**与状态词并排出现**时的短词——
    // 「已关闭 · 已完成」这类双重「已」字重复，故此处用短式。
    'objectList.workcaseClosedOutcome.completed': '完成',
    'objectList.workcaseClosedOutcome.partial': '部分完成',
    'objectList.workcaseClosedOutcome.not-achieved': '未完成',
    'objectList.workcaseClosedOutcome.cancelled': '取消',
    'objectList.workcaseGate1': 'Gate 1 授权 · {approver} · {approvedAt}',
    'objectList.workcaseAttemptController': '执行者',
    // 变更流水（卡片主体）：关键行动用二字标出（Human 2026-09-23）。
    // 不呈现阶段标签——状态显示恒为 21 号状态机的真实值。见 WorkCaseExecFlow。
    'objectList.workcaseFlowMore': '更早 {count} 条',
    'objectList.workcaseFlowCollapse': '收起',
    // 整块级收起（已关闭卡默认收起，Human 2026-10-17）。与上面的条目级
    // 「更早 N 条 / 收起」是两级不同粒度，措辞须能区分：这里是「显示/收起变更流水」。
    'objectList.workcaseFlowShow': '显示 {count} 条变更流水',
    'objectList.workcaseFlowHide': '收起变更流水',
    'objectList.workcaseFlowMark.review': '复核',
    'objectList.workcaseFlowMark.revise': '修订',
    'objectList.workcaseFlowMark.adjustment-approved': '已批准',
    'objectList.workcaseFlowMark.adjustment-rejected': '已拒绝',
    'objectList.workcaseAdjustment.pending': '待批调整',
    'objectList.workcaseAdjustment.pendingLine': '已申请追加 {count} 项',
    'objectList.workcaseAdjustment.awaitingHuman': '（等 Human 决定）',
    // 「待批准关闭」的核对与建议（21 §8 结果节解析所得）
    'objectList.workcaseCheck.achieved': '达成',
    'objectList.workcaseCheck.partial': '部分达成',
    'objectList.workcaseCheck.not-achieved': '未达成',
    'objectList.workcaseCheck.unrecorded': '未记录',
    // 去向词（21 §8 建议段）。前两条为闭集二词；后两条是 2026-09-28 撤销的存量词，
    // 仅为既有载体继续可读而保留（§15.3 存量不溯及）——受控写入已拒绝这两词。
    'objectList.workcaseAdvice.另立工单': '另立工单',
    'objectList.workcaseAdvice.接受现状': '接受现状',
    'objectList.workcaseAdvice.转入 Spark': '转入 Spark',
    'objectList.workcaseAdvice.直接行动': '直接行动',
    'objectList.workcaseAdvice.unclassified': '未归类',
    // 「已关闭」卡的结论行与残留块（Human 2026-09-24 方案 A）
    'objectList.workcaseCheckTally': '核对 {achieved}/{total} 达成',
    // 「已关闭」卡的取消记录（21 §8，仅 outcome=cancelled）
    'objectList.workcaseNotExecuted': '未执行任何计划步骤',
    // Human 裁定 2026-10-01：标记词由「理由」改为「取消理由」——它是**块首标题**（形态同去向分区），
    // 因此须自足地说明「这是取消的理由」，不能只写半个词。
    'objectList.workcaseCancelReason': '取消理由',
    // 残留计数（`workcaseResidualTally`/`workcaseResidualNone`）已随 2026-09-28 二次修订
    // 从「已关闭」卡结论行移除（决定 A：关闭后只呈现去向）。**词条保留**：它们是
    // 「待批准关闭」期的可复用词条，且历史对象/其它呈现面仍可能引用——删词条会让
    // 引用点变成缺词，属静默破坏而非收敛。
    'objectList.workcaseResidualTally': '残留 {count} 条',
    'objectList.workcaseResidualTag': '残留',
    'objectList.workcaseResidualNone': '无残留',
    // 「转入 Spark」去向的目标关联行（10 §5.5「已关闭」卡表：就地渲染为关联行）。
    'objectList.workcaseRoutedToUnavailable': '目标不可读',
    // 21 §13 / 03 §7.2：反向 refs 只显示声明引用来源，不暗示建议已履行或已闭环。
    'objectList.workcaseRefSourceUnavailable': '引用来源不可用',
    'objectList.workcaseRefSourceStatus': '状态：{status}',
    'objectList.workcaseRefSourceUid': '对象 UID：{uid}',
    'objectDetail.workcaseServes': '服务子目标',
    'objectDetail.workcaseScope': '授权范围',
    'objectDetail.workcasePlan': '计划与完成判据',
    'objectDetail.workcaseAmendmentStep': '增量批准',
    'objectDetail.workcaseAttempt': '执行现场',
    'objectDetail.workcaseReviews': '复核记录',
    // 复核记录 `summary` 的七要素（21 §8 引 02 §16）。原文按此七项书写，
    // 详情面据此分块呈现（此前整段输出，546 字一段无法阅读）。
    'objectDetail.reviewElementEmpty': '（未记录）',
    'objectDetail.reviewElement.对象': '对象',
    'objectDetail.reviewElement.基线': '基线',
    'objectDetail.reviewElement.方法': '方法',
    'objectDetail.reviewElement.覆盖': '覆盖',
    'objectDetail.reviewElement.未覆盖': '未覆盖',
    'objectDetail.reviewElement.发现': '发现',
    'objectDetail.reviewElement.保证边界': '保证边界',
    'objectDetail.workcaseAttemptController': '执行者',
    'objectDetail.workcaseAttemptId': 'attempt',
    'objectDetail.workcaseAttemptStartedAt': '开始时间',
    'objectDetail.workcaseAttemptHeartbeat': '心跳',
    'objectDetail.workcaseResultDraft': '结果草稿',
    // 正文 H2 节（21 §8 闭集）：`执行` 与 `结果` 两节**无字段承载**，
    // 故详情页各设一个节点。标签用节名本身（执行 / 结果节），不用其它词条的近义表述——
    // 「执行项」是另一实体（工作项），「结果草稿」指关闭提案，均非本节点。
    'objectDetail.workcaseBodyExecutionSection': '执行',
    'objectDetail.workcaseBodyResultSection': '结果',
    'objectDetail.workcaseOutcome': '终态判定',
    'objectDetail.workcaseOutcome.completed': '已完成',
    'objectDetail.workcaseOutcome.partial': '部分达成',
    'objectDetail.workcaseOutcome.notAchieved': '未达成',
    'objectDetail.workcaseOutcome.cancelled': '已取消',
    'objectDetail.workcaseResultChecks': '判据逐条核对',
    'objectDetail.workcaseAchievedScope': '已证实范围',
    'objectDetail.workcaseResidual': '残留责任',
    // 去向（21 §8 残留段的去向子项）：决定 A 收窄后详情面唯一保留的一侧（10 §5.5）。
    // 中性表述——§10.2 明写批准对象只有「关闭」与 outcome，去向不因关闭而成为承诺。
    'objectDetail.workcaseDirections': '去向',
    'objectDetail.workcaseGate1': 'Gate 1 授权',
    'objectDetail.workcaseGate1Approver': '批准人',
    'objectDetail.workcaseGate1ApprovedAt': '批准时间',
    'objectList.workcaseItemInProgress': '进行中',
    'objectList.workcaseItemBlocked': '阻塞',
    'objectList.workcaseItemPending': '未执行',
    'objectList.workcaseItemCancelled': '已取消',
    'objectList.workcaseItemStageMismatch': '工作项状态与当前环节不一致',
    'objectList.workcaseCriteriaCount': '{count} 项',
    'objectList.workcaseFieldMissing': '未记录',
    'objectList.frictionPhenomenonMissing': '现象缺失',
    'objectList.workcaseGateFieldMalformed': '结构不完整或不合法',
    'objectList.workcaseAuthorizedActionCount': '{count} 项允许动作',
    'objectList.workcaseProhibitedActionCount': '{count} 项禁止项',
    'objectList.workcasePrerequisiteCount': '{count} 项前置条件',
    'objectList.workcaseIndependentSubagentUnavailable': 'Sub Agent',
    'objectList.workcaseIndependentSubagentUnavailableHint': '独立 subagent 不可用',
    'objectList.workcaseCoveragePartial': '工单读取范围不完整；以下卡片只来自已取得且通过机械校验、可以呈现的对象，不能据此判断项目中只有这些对象。',
    'objectList.workcaseCoverageUnavailable': '当前技术条件不足，无法可靠确定工单列表的读取范围；页面不会把它显示成完整空列表。',
    'objectList.workcaseObjectProblems': '工单读取范围完整，但部分候选未通过机械校验，无法作为可呈现对象使用；相应正文不会呈现。',
    'objectList.workcaseCoverageProblemCount': '查看 {count} 项读取或覆盖诊断',
    'objectList.workcaseCoverageCollectionScope': '工单对象集合',
    'objectList.workcaseCoverageUnavailableEmpty': '工单列表读取不可用，不能判断当前是否存在对象。',
    'objectList.workcaseCoveragePartialEmpty': '已观察范围内没有可呈现卡片，但读取范围不完整，不能判断当前没有工单。',
    'objectList.workcaseObjectProblemsEmpty': '读取范围中发现了工单候选，但没有候选通过机械校验并形成可呈现对象；请查看上方诊断。',
    'objectList.objectProblems': '读取范围完整，但部分候选存在问题，无法呈现；请查看诊断。',
    'objectList.coveragePartial': '读取范围不完整；以下卡片只来自已取得且可以呈现的对象，不能据此判断项目中只有这些对象。',
    'objectList.coverageUnavailable': '当前技术条件不足，无法可靠确定列表的读取范围；页面不会把它显示成完整空列表。',
    'objectList.coverageProblemCount': '查看 {count} 项读取或覆盖诊断',
    'objectList.coverageCollectionScope': '对象集合',
    'objectList.coverageUnavailableEmpty': '列表读取不可用，不能判断当前是否存在对象。',
    'objectList.coveragePartialEmpty': '已观察范围内没有可呈现卡片，但读取范围不完整，不能判断当前没有对象。',
    'objectList.objectProblemsEmpty': '读取范围中发现了候选，但没有候选形成可呈现对象；请查看上方诊断。',
    'objectList.workcaseDynamicStages': '推进环节',
    'objectList.workcaseStageExecute': '工作项执行',
    'objectList.workcaseStageSelfCheck': '主控自检',
    'objectList.workcaseStageResultReview': '结果复核',
    'objectList.workcaseStageSynthesis': '主控收敛',

    'objectDetail.back': '返回',
    'objectDetail.fieldIssues': '来源字段问题',
    'objectDetail.unparsedStructures': '未解析结构',
    // `scope` / `summary` 书写结构问题（21 §8）。写入口已校验，但此前结果到不了
    // 呈现面（mechanical_issues 在投影与前端两侧各 0 处命中），读者只看得到
    // 「读不了」而看不到原因。
    'objectDetail.structuredTextIssue': '书写结构不合规',
    'objectDetail.structuredTextIssueHint': '（21 §8：仅判形态，不判内容是否名副其实）',
    'objectDetail.fieldMissing': '缺失',
    'objectDetail.fieldTypeMismatch': '类型不符',
    'objectDetail.fieldIdentityMismatch': '身份不符',
    'objectDetail.fieldExpected': '预期 {expected}',
    'objectDetail.content': '内容',
    'objectDetail.fileContent': '文件内容',
    'objectDetail.previewFile': '预览文件',
    'objectDetail.fileInformation': '文件信息',
    'objectDetail.contentIdentity': '内容标识',
    'objectDetail.deletionRecord': '删除记录',
    'objectDetail.yamlSource': 'YAML 数据',
    'objectDetail.id': 'ID',
    'objectDetail.type': '类型',
    'objectDetail.status': '状态',
    'objectDetail.created': '创建时间',
    'objectDetail.updated': '更新时间',
    'objectDetail.createdShort': '创建',
    'objectDetail.updatedShort': '更新',
    'objectDetail.expand': '展开',
    'objectDetail.collapse': '收起',
    'objectDetail.aggregatedDeliverables': '聚合产出',
    'objectDetail.aggregatedDocs': '聚合文档',
    'objectDetail.editStatus': '点击修改状态',
    'objectDetail.editAcceptance': '点击编辑验收标准',
    'objectDetail.goal': '目标',
    'objectDetail.noDescription': '未记录描述',
    'objectDetail.workPlan': '所属工单',
    'objectDetail.executionStatus': '执行状态',
    'objectDetail.currentState': '当前状态',
    'objectDetail.waitingFor': '等待对象',
    'objectDetail.acceptance': '验收标准',
    'objectDetail.verification': '验证方式',
    'objectDetail.verificationEvidence': '验证证据',
    'objectDetail.closureEvidence': '关闭证据',
    'objectDetail.noAcceptance': '未记录验收标准',
    'objectDetail.noVerification': '未记录验证方式',
    'objectDetail.noClosureEvidence': '尚未记录关闭证据',
    'objectDetail.relatedDocs': '关联文档',
    'objectDetail.related': '关联',
    'objectDetail.affectedDocs': '影响文档',
    'objectDetail.dependencies': '前置依赖',
    'objectDetail.otherFields': '其他字段',
    'objectDetail.emptyValue': '空',
    'objectDetail.planGoal': '工单目标',
    'objectDetail.planDescription': '工单描述',
    'objectDetail.noPlanGoal': '未记录工单目标',
    'objectDetail.noPlanDescription': '未记录工单描述',
    'objectDetail.planExecution': '执行队列',
    'objectDetail.workcaseProgress': '工单进度',
    'objectDetail.workcaseCloseout': '收口与未完成事项',
    'objectDetail.noWorkcaseCloseout': '尚未形成收口记录',
    'objectDetail.workcaseHumanOverview': '工单总览',
    'objectDetail.workcaseHumanContext': 'Human 视图',
    'objectDetail.workcaseAiContext': 'AI 上下文',
    'objectDetail.workcaseAiCore': '核心上下文',
    'objectDetail.workcaseAiReviewContext': '复核上下文',
    'objectDetail.executionReferences': '执行引用',
    'objectDetail.lifecycleStage': '推进阶段',
    'objectDetail.lifecycleDraft': '目标确认',
    'objectDetail.lifecyclePlanConfirming': '方案确认',
    'objectDetail.lifecycleActive': '执行中',
    'objectDetail.lifecycleBlocked': '阻塞处理',
    'objectDetail.lifecycleVerification': '验证整理',
    'objectDetail.lifecycleResultReview': '独立结果复核',
    'objectDetail.lifecycleReview': '关闭待确认',
    'objectDetail.lifecycleClosed': '已关闭',
    'objectDetail.successCriteriaProgress': '成功标准',
    'objectDetail.executionItemProgress': '执行项',
    'objectDetail.workcaseExecution': '执行项',
    'objectDetail.executionItemsLoading': '正在读取执行项态势',
    'objectDetail.workcaseReview': '复核、处置与批准',
    'objectDetail.planReview': '创建前计划复核',
    'objectDetail.resultReview': '独立结果复核',
    'objectDetail.reviewPolicy': '复核策略',
    'objectDetail.reviewItems': '复核条目',
    'objectDetail.controllerResolution': '主控处置',
    'objectDetail.humanPlanConfirmation': '方案确认',
    'objectDetail.humanClosureConfirmation': '关闭确认',
    'objectDetail.reviewConclusion': '结论',
    'objectDetail.controllerSelfCheck': '主控自检',
    'objectDetail.specialistReview': '独立结果复核',
    'objectDetail.humanClosureReview': '关闭确认',
    'objectDetail.reviewRequirement': '要求',
    'objectDetail.required': '需要',
    'objectDetail.notRequired': '不需要',
    'objectDetail.reviewRole': '角色',
    'objectDetail.expectedOutput': '预期输出',
    'objectDetail.noSuccessCriteria': '未记录成功标准',
    'objectDetail.planCloseReview': '关闭判断',
    'objectDetail.closeDecisionReady': '满足关闭条件',
    'objectDetail.closeDecisionReadyHint': '成功标准和完成证据均已确认。',
    'objectDetail.closeDecisionPending': '关闭条件尚未满足',
    'objectDetail.closeDecisionPendingHint': '仍有成功标准或完成证据需要确认，不能直接视为可关闭。',
    'objectDetail.closeDecisionPendingItems': '待确认项',
    'objectDetail.closeDecisionNoPendingItems': '暂无待确认项',
    'objectDetail.closeDecisionRecordState': '记录状态',
    'objectDetail.noCompletionEvidence': '尚未记录完成证据',
    'objectDetail.noVerificationEvidence': '尚未记录验证证据',
    'objectDetail.planMaterials': '产出与文档',
    'objectDetail.relatedMaterials': '关联材料',
    'objectDetail.workcaseResponsibility': '目标',
    'objectDetail.workcaseCurrentSnapshot': '当前情况',
    'objectDetail.workcaseCurrentSnapshotUnavailableHint': '当前读取未形成可用状态投影，暂不显示推进轨迹和下一必经动作。',
    'objectDetail.workcaseNextRequiredControlStep': '下一必经动作',
    'objectDetail.workcaseNextRequiredControlStepBoundary': '仅表示结构上的下一控制步骤，不代表授权、能力、优先级或完成判断。',
    'objectDetail.workcaseNextControlStepHumanDecision': '等待 Human 决策',
    'objectDetail.workcaseNextControlStepUnavailable': '当前不可判定',
    'objectDetail.workcaseNextControlStep.human_gate_1': '等待 Human Gate 1',
    'objectDetail.workcaseNextControlStep.form_current_plan': '形成当前完整方案',
    'objectDetail.workcaseNextControlStep.advance_current_work_item': '推进当前工作项',
    'objectDetail.workcaseNextControlStep.form_complete_result_projection': '形成完整结果投影',
    'objectDetail.workcaseNextControlStep.complete_independent_result_review': '完成结果复核',
    'objectDetail.workcaseNextControlStep.form_closure_proposal': '形成关闭提案',
    'objectDetail.workcaseNextControlStep.human_gate_2': '等待 Human Gate 2',
    'objectDetail.workcaseNextControlStep.termination_cleanup': '完成终止善后',
    'objectDetail.workcaseNextControlStep.none': '无后续必经控制步骤',
    'objectDetail.workcaseTerminationCleanup': '终止善后',
    'objectDetail.workcaseTerminationCleanupBoundary': '只展示 Human 主动中止后的起始现场、实际保留/丢弃/未验证范围、关系影响与质量降级；不表示普通结果链或 Gate 2 已完成。',
    'objectDetail.workcaseTerminationSummary': '终止说明',
    'objectDetail.workcaseTerminationStopped': '工单已终止',
    'objectDetail.workcaseSuccessCriteria': '成功标准',
    'objectDetail.workcaseCriteriaCount': '{count} 项',
    'objectDetail.workcaseCriterionResultSummary': '结果摘要',
    'objectDetail.workcasePlanAndItems': '当前计划与工作项',
    'objectDetail.workcaseCreationReviews': '方案复核',
    'objectDetail.workcaseCreationReviewsBoundary': '展示当前计划复核的实际方法和保证边界；同一 AI 切换视角不是独立 subagent，复核判断也不等于 Human 的执行决定。',
    'objectDetail.workcaseExecutionAuthorization': '执行授权边界',
    'objectDetail.workcaseExecutionAuthorizationBoundary': '定义本次批准允许执行什么、上限与禁止项、可调整范围、验证回滚方式和越界处置；超出边界必须回到 Human。',
    'objectDetail.workcaseAuthorizationCount': '{count} 项',
    'objectDetail.workcaseAuthorizationConstraints': '授权约束',
    'objectDetail.workcaseGateFieldMissingOrMalformed': '字段缺失或结构不合法，无法形成可信授权边界。',
    'objectDetail.workcaseExecutionApproval': '执行批准',
    'objectDetail.workcaseExecutionApprovalBoundary': '仅记录 Human 对所绑定计划版本的执行批准；不表示技术结果、验证或关闭已经成立。',
    'objectDetail.workcaseApprovalSummary': '批准范围与条件',
    'objectDetail.workcaseResultAndValidation': '结果与验证',
    'objectDetail.workcaseControllerCheck': '主控自检',
    'objectDetail.workcaseControllerCheckBoundary': '记录主控的技术自检；不等于 Reviewer 结果复核或 Human 验收。',
    'objectDetail.workcaseResultReviews': '结果复核',
    'objectDetail.workcaseResultReviewsBoundary': '展示当前结果复核的实际方法和保证边界；同一 AI fallback 不冒充独立 subagent，主控的反馈处置另行记录。',
    'objectDetail.workcaseReviewScope': '复核范围',
    'objectDetail.workcaseReviewConclusion': '复核判断',
    'objectDetail.workcaseClosureProposal': '关闭提案',
    'objectDetail.workcaseClosureProposalBoundary': '主控依据当前结果与验证形成技术分类和责任处置；该提案不是既成终态或关闭批准。Human 只决定是否接受该分类与责任处置，并据此停止当前工单；Human 不改写技术事实，也不为其真实性背书。',
    'objectDetail.workcaseUrls': '外部网址',
    'objectDetail.workcaseTerminalDisposition': '终态处置',
    'objectDetail.workcaseTerminalDispositionBoundary': '记录工单停止后的分类与责任去向；分流关系不表示目标已经接受、开始或完成责任。',

    'projectFiles.title': '项目文件',
    'projectFiles.showHiddenFiles': '显示隐藏文件',
    'projectFiles.fileBrowser': '项目文件浏览',
    'projectFiles.preview': '文件预览',
    'projectFiles.loading': '加载中',
    'projectFiles.noProjects': '没有读取到管辖项目。',
    'projectFiles.chooseProjectGlobally': '请先从左上角的全局项目选择器选择一个管辖项目。',
    'projectFiles.noEntries': '当前目录没有可展示文件。',
    'projectFiles.chooseFile': '选择左侧文件后在这里阅读。',
    'projectFiles.binary': '这是二进制文件，Web 仅展示路径和大小。',
    'projectFiles.truncated': '内容已按安全上限截断。',

    'changes.title': '工作区变更',
    'changes.files': '变更文件',
    'changes.otherBranches': '其他分支',
    'changes.otherBranchesClean': '无待提交变更',
    'changes.otherBranchesChanges': '个文件变更',
    'changes.otherBranchesLoading': '正在读取其他分支变更…',
    'changes.diff': '文件差异',
    'changes.noProjects': '没有读取到管辖项目。',
    'changes.noProject': '选择项目后，这里将显示工作区中的 staged、unstaged 和 untracked 文件。',
    'changes.chooseFile': '选择变更文件后在这里查看差异。',
    'changes.loading': '正在读取项目变更…',
    'changes.loadingDiff': '正在读取文件差异…',
    'changes.noChanges': '当前项目没有待提交变更。',
    'changes.diffMode': '差异显示方式',
    'changes.unifiedDiff': '统一',
    'changes.splitDiff': '并排',
    'changes.before': '旧内容',
    'changes.after': '新内容',

    'readingPanel.truncated': '内容已截断',
    'readingPanel.close': '关闭',
    'readingPanel.title': '扩展阅读',
    'readingPanel.previous': '上一个访问对象',
    'readingPanel.next': '下一个访问对象',
    'readingPanel.empty': '选择一个对象或文档以在此预览',
    'readingPanel.loadFailed': '加载失败',
    'readingPanel.docLoadFailed': '文档加载失败',
    'readingPanel.filePreviewUnavailable': '文件预览不可用',
    'readingPanel.noEvidence': '暂无证据信息',
    'readingPanel.changeDetail': '提交详情',
    'readingPanel.openNewTab': '新标签',
    'objectDetail.humanGateTip': '此工单待 Human 确认关闭',
    'objectDetail.openReadingPanel': '扩展阅读',
    'objectDetail.researchBody.question': '研究问题',
    'objectDetail.researchBody.inputs': '输入与边界',
    'objectDetail.researchBody.investigation': '调查阶段',
    'objectDetail.researchBody.findings': '关键发现',
    'objectDetail.researchBody.unverified': '未证实与缺口',
    'objectDetail.researchBody.recommendations': '建议',
    'objectDetail.researchBody.routing': '后续分流',
    'objectDetail.researchBody.findingUnits': '发现单元',
    'objectDetail.researchBody.provenance': '溯源',
    'objectDetail.researchBody.noProvenance': '未标注溯源锚点',
    'objectDetail.researchBody.retiredNotice': '本对象已退出，不作为当前证据输入；如需引用须先完成 F4 来源复核并按结果收紧声明。',
    'objectDetail.researchBody.unknownSection': '补充内容',
    'objectDetail.reportBody': '报告正文',
    'objectDetail.readUnavailable': '对象正文不可呈现',
    'objectDetail.readType': '对象',
    'objectDetail.readStatus': '读取状态',
    'objectDetail.observedAt': '观察时间',
    'objectDetail.expectedPath': '预期位置',
    'objectDetail.readIssue': '读取问题',

    'changelog.allTypes': '全部类型',
    'changelog.allScopes': '全部范围',
    'changelog.recentCount': '最近 {count}',
    'changelog.commit': '提交',
    'changelog.noMatches': '没有匹配的提交',
    'changelog.copyContext': '复制提交上下文',
    'changelog.copiedContext': '已复制提交上下文',
    'changelog.loadFailed': '加载提交失败',
    'changelog.detailFailed': '加载提交详情失败',
    'changelog.closeDetails': '收起详情',
    'changelog.openDetails': '展开详情',
    'changelog.commitAt': '提交 {time}',
    'changelog.breakingChange': '不兼容变更',
    'changelog.pushed': '已推送',
    'changelog.unpushed': '未推送',
    'changelog.incoming': '待同步',

    'common.loading': '加载中...',
    'common.loadFailed': '加载失败',
    'common.language': '语言',
    'common.true': '是',
    'common.false': '否',
    'common.empty': '空',
    'common.null': '—',
    'common.copyPath': '复制路径',
    'common.copiedPath': '已复制路径',
    'common.copyObjectPath': '复制对象路径',
    'common.copiedObjectPath': '已复制对象路径',
    'common.copyObjectId': '复制对象引用',
    'common.copiedObjectId': '已复制对象引用',
    'common.copyDocPath': '复制文档路径',
    'common.copiedDocPath': '已复制文档路径',
    'common.copyUrl': '复制链接',
    'common.copiedUrl': '已复制链接',
    'common.copyReference': '复制引用',
    'common.copiedReference': '已复制引用',
    'common.read': '阅读',

    'help.title': '帮助',
    'help.subtitle': 'LDVH 是什么、怎么开始、怎么运作，各个入口看什么，以及 AI 会在什么时候停下来找你。',

    'help.tab.start': '如何开始',
    'help.panel.start.title': '如何开始：先定项目，再立目标',
    'help.start.lead': '两步。先把你要管的那个项目定下来，再把目标立起来——后面所有对象、提交与检查都长在这个项目下面。',
    'help.start.step1.title': '第一步：选定管辖项目',
    'help.start.step1.body': '用侧栏顶部的项目切换器选一个管辖项目。切换器里列的是已登记的项目；选定之后，页面上的对象、提交记录和检查结论都只属于它——管辖范围不跨项目。',
    'help.start.step1.hintTitle': '切换器里没有这个项目？',
    'help.start.step1.hint': '那说明它还没被登记为管辖项目。到那个项目的目录里对 AI 说一句「把这个项目设为 LDVH 管辖」：它会先把项目标识和路径摆给你确认，你确认之后才写进登记文件，写完它才会出现在切换器里。',
    'help.start.step2.title': '第二步：把目标立起来',
    'help.start.step2.body': '目标不是自己写进去的：你说清楚要什么，AI 把它收敛成可判定的目标陈述，再展开成带达成条件的子目标，然后逐条摆给你确认。确认之后才落盘——目标先落，子目标后落。',
    'help.start.branchLabel': '按项目是新是旧，起点不一样',
    'help.start.new.title': '新项目：先把要做的事说清楚',
    'help.start.new.body': '直接告诉 AI 你要什么、做到什么样算成了。它会把这句话收敛成可判定的目标陈述，再展开成带达成条件的子目标候选，逐条等你确认——你确认之前不会落盘。',
    'help.start.old.title': '老项目：先把现有文档吸收掉',
    'help.start.old.body': '它还不掌握你的项目。先让它把现有文档调研成一份调研对象，产出已证实、未证实与缺口三态证据；再基于这份认识收敛目标、展开子目标。跳过这一步，子目标就会按它自己的猜测写。',
    'help.start.nextTitle': '立起来之后',
    'help.start.next': '目标定下来，主线才开始——想法、调研、决策和工单都挂在目标下面。想看九类对象各是什么，切到「有哪些东西」；想知道事情怎么往下走，切到「事情怎么推进」；想知道它什么时候会停下来问你，切到「什么时候该你出面」。',

    'help.overview.title': '这套系统解决什么',
    'help.overview.lead': 'AI 和人各有一半的短板：单独看都还能对付，凑在一起就互相放大。LDVH 的每一项机制都对应其中一个缺口。',
    'help.overview.symptomLabel': '典型表现',
    'help.overview.answerLabel': '对应机制',
    'help.overview.shortcomingLabel': '短板',
    'help.overview.ai.title': 'AI 靠不住',
    'help.overview.ai.symptom': 'AI 的输出是概率推理：上下文缺了会猜、过载会稀释、冲突时会采信错的一方；同一问题两次回答可能不同，跨会话也不会记事。',
    'help.overview.ai.answer': '所以规则要有源、事实要有锚、动作要有校验——规范源给边界，事实源给依据，主控自查、代理审核和机械校验三层兜底。',
    'help.overview.human.title': '人接不住也留不住',
    'help.overview.human.symptom': '长期规划越做越模糊，临时想法转头就忘，多个任务并行就接不上，做过的决定和踩过的坑随对话一起散掉。',
    'help.overview.human.answer': '所以每样东西都有一个对象——目标、想法、调研、决策、工单、经验和摩擦各有承载，打开看得见，回来接得上。',
    'help.overview.friction.title': '双方互相放大误差',
    'help.overview.friction.symptom': 'AI 的笃定人接不住，人含糊的意思 AI 又猜不准；它不会停在「我没懂」的地方，会先把空缺补全，再卖力执行到底。',
    'help.overview.friction.answer': '所以该你定的必须问你——你的决定权不能被 AI、规范、事实或工具替代；依据不足时它会停下来，而不是硬答。',

    'help.spine.title': '与 AI 配合的主线',
    'help.spine.lead': '不是必须照走的流水线，但每一段都有明确的产物和落点。项目内容会落成下面这几种形态。',
    'help.spine.goal.title': '目标',
    'help.spine.goal.body': '项目要达成什么，被冻结成一个可回指的锚；目标再往下拆成带可判定达成条件的子目标。',
    'help.spine.idea.title': '想法',
    'help.spine.idea.body': '任何值得跨行动推进的事——一个想法、一个方向、一个还没收敛的问题——都从火花出生；火花同时是方向主线。',
    'help.spine.research.title': '调研',
    'help.spine.research.body': '围绕还没掌握的问题搜证据，直到不再产生新的确认认识；结论按发现单元组织，每条都带溯源锚点。',
    'help.spine.decision.title': '决定',
    'help.spine.decision.body': '把一次取舍固定成可回溯的记录：当时选了什么、依据是什么、代价是什么。',
    'help.spine.execution.title': '执行',
    'help.spine.execution.body': '只有经你批准的工单才动；工单带目标、成功标准、授权边界和验证方式，走完复核与关闭判断才落终态。',
    'help.spine.learning.title': '积累',
    'help.spine.learning.body': '踩过的坑写成经验，待修的系统性阻碍记成摩擦账，成体系的方向写成规范，收敛的过程结论写成开发日志——下次能直接复用。',
    'help.spine.recallTitle': '动手前它还会做一次双源召回：',
    'help.spine.recall': '从规范源和事实源找回「当前该遵守什么、该依据什么、哪些事必须停下来问你」，并把召回到的东西落实成实际动作。这一步不留独立对象，但决定了它接下来怎么动。',

    'help.tab.overview': '这是什么',
    'help.tab.objects': '有哪些东西',
    'help.tab.systems': '事情怎么推进',
    'help.tab.gates': '什么时候该你出面',
    'help.tab.entries': '去哪儿看',
    'help.tab.trust': '怎么判断可信',

    'help.panel.overview.title': '这是什么：LDVH 的构成与运作方式',
    'help.panel.objects.title': '有哪些东西：九类事实对象',
    'help.panel.systems.title': '事情怎么推进：七大业务系统',
    'help.panel.gates.title': '什么时候该你出面：五类交互入口与必停情形',
    'help.panel.entries.title': '去哪儿看：左边导航里的非对象入口',
    'help.panel.trust.title': '怎么判断可信：声明的三层与退回去的信号',

    'help.objects.lead': '每个事实对象都有确定的边界和生命周期。下面按「它是什么 / 什么时候产生 / 你去看什么」列出全部对象类型。',
    'help.tabLabel': '帮助分区',
    'help.objects.whatLabel': '它是什么',
    'help.objects.whenLabel': '什么时候产生',
    'help.objects.lookLabel': '你去看什么',
    'help.gates.triggerLabel': '什么时候会来问你',
    'help.gates.respondLabel': '你需要回什么',
    'help.objects.subgoal.what': '目标层的下级锚点：一条子目标带稳定身份、可选的显示次序，和一条可判定的达成条件。',
    'help.objects.subgoal.when': '把项目目标拆到「走到哪算成」的时候。',
    'help.objects.subgoal.look': '它的达成条件、名下的工作，以及它挂在总目标的哪一处。',
    'help.objects.spark.what': '一切值得跨行动推进之事的出生地，也是方向主线的入口。',
    'help.objects.spark.when': '出现一个想法、一个方向，或一个还没收敛的问题时。',
    'help.objects.spark.look': '它当前的理解、还没定下来的部分，以及演进到了哪一步。',
    'help.objects.workcase.what': '已批准工单及其结果审计的唯一载体，带状态与生命周期、授权语义和执行记录。',
    'help.objects.workcase.when': '某个方向被拆成可执行、可验收的动作时。',
    'help.objects.workcase.look': '当前情况、目标与成功标准、当前计划与工作项、复核与批准、结果与验证。',
    'help.objects.research.what': '外部对象的深度调研产物，调查与分析一体；每个发现单元独立可讨论，并带溯源锚点。',
    'help.objects.research.when': '缺证据，或者结论必须落到具体来源上时。',
    'help.objects.research.look': '每个发现单元的声明、观察事实、对项目的价值判断和溯源锚点。',
    'help.objects.adr.what': '已定决策的回溯记录：选了什么、依据、代价、影响范围。',
    'help.objects.adr.when': '一次取舍被定下来，而且以后会被反复引用时。',
    'help.objects.adr.look': '决定本身、当时的备选与理由，以及它关联的目标和工单。',
    'help.objects.pitfall.what': '已验证踩坑经验的回溯记录：失败机制与规避办法。',
    'help.objects.pitfall.when': '同一个坑第二次出现，或教训已经被验证可用时。',
    'help.objects.pitfall.look': '失败机制、触发条件、规避做法，以及它已被哪些工作复用。',
    'help.objects.friction.what': '待修系统性阻碍的改进账本；按账目状态累积证据与度量。',
    'help.objects.friction.when': '发现一个「每次都会被它绊住」的结构性问题时。',
    'help.objects.friction.look': '它卡住什么、已经堵过多少次、现在处于账目的哪个状态。',
    'help.objects.norm.what': '管辖项目里成体系的方向规范，约束与度量并存。',
    'help.objects.norm.when': '某条做法已经稳定到值得对整个项目生效时。',
    'help.objects.norm.look': '这条规范说了什么、它约束哪些方向、有没有反重复机制。',
    'help.objects.devlog.what': '一次已收敛的过程性工作的结论条目：做了什么、实测到什么、结论与适用边界。',
    'help.objects.devlog.when': '一段工作告一段落，结论值得被下一次引用时。',
    'help.objects.devlog.look': '那次做了什么、实测结果，以及结论在什么范围内成立。',

    'help.gates.lead': '有几类事不会由 AI 替你定。它们各有明确的触发条件，和一份给你的响应契约。',
    'help.gates.inquiry.title': '结构化问询',
    'help.gates.inquiry.trigger': 'AI 需要你判断、选一个或补信息时，问题已整理成带选项、影响和风险的形式。',
    'help.gates.inquiry.respond': '你回应的内容要能定住三件事：对象、范围、处理结论。',
    'help.gates.plan.title': '计划审查',
    'help.gates.plan.trigger': 'AI 呈交候选计划，等你审查或批准时。',
    'help.gates.plan.respond': '会呈上计划的依据、范围、步骤与风险；批准执行时还附上建前独立审核的结论。你批、拒，或要求修改。',
    'help.gates.authorization.title': '授权流',
    'help.gates.authorization.trigger': 'AI 需要你的授权才能执行或继续某项受控操作时。',
    'help.gates.authorization.respond': '会呈上授权对象、范围与边界。你授予、拒绝或限制；越出授权的动作会被机械拒绝。',
    'help.gates.handover.title': '验收交还',
    'help.gates.handover.trigger': 'AI 做完了当前工作，呈交验收结果时。',
    'help.gates.handover.respond': '会呈上当前状态、判断依据、已证实与未证实的范围、残留风险，以及待你决定的事项。你验收、退回，或要求补充。',
    'help.gates.registration.title': '登记管理',
    'help.gates.registration.trigger': '你在 Web 里发起或取消项目登记时。',
    'help.gates.registration.respond': '会呈上登记对象、项目路径与综合就绪状态；未就绪项分项给原因，可修的给修复入口，不可修的只说原因。',
    'help.gates.stop.title': '这些情况下它会停下来，而不是继续',
    'help.gates.stop.1': '该由你决定的事，还没拿到你作用范围清楚的回应',
    'help.gates.stop.2': '规则的适用、效力或权威关系说不清',
    'help.gates.stop.3': '已经适用的强制要求、受控入口、验证或回写满足不了',
    'help.gates.stop.4': '依据不足，却准备宣布状态成立或工作完成',
    'help.gates.stop.5': '继续下去会越过规范、事实或授权边界',
    'help.gates.stop.note': '停下来之后，它要先补上原因才恢复；同一个原因再次触发，不会自己恢复，会再回来问你。',

    'help.entries.lead': '左边导航里那些不指向事实对象的入口，分别是什么、什么时候看。',
    'help.entries.whatLabel': '它是什么',
    'help.entries.goLabel': '去看看',
    'help.entries.focus.title': '聚焦',
    'help.entries.focus.body': '一屏看全局：目标区、待决定事项、近期动态、近期热点关系、Spark 健康度。回到项目、或不知道从哪看起时，先开这一页。',
    'help.entries.directory.title': '目录',
    'help.entries.directory.body': '项目文件树，直接读规范源与事实源的文件。想确认某条规则或某个对象在源里究竟怎么写的时候。',
    'help.entries.changes.title': '变更',
    'help.entries.changes.body': '工作树里还没提交的改动。想确认 AI 这轮改了什么、动过哪些文件的时候。',
    'help.entries.commits.title': '提交',
    'help.entries.commits.body': '已提交的历史，每条可回读上下文。想追溯某个结论是哪次提交带来的时。',
    'help.entries.diagnostics.title': '诊断',
    'help.entries.diagnostics.body': '机制本身在实际使用中哪里在失效、失效成什么形态；只读。「它怎么老是拦我」「哪个工具一直在坏」这类问题看这里。',
    'help.entries.federation.title': '全部项目',
    'help.entries.federation.body': '跨项目的汇总视图，覆盖登记列表里的所有管辖项目。同时盯着多个项目时看这里。',

    'help.trust.lead': '它说「做完了」，这句话本身不构成证据。按下面三件事来核。',

    'help.systems.lead': '七大业务系统各管一段业务过程，结论落在对象上。下面逐个说清四件事：它管什么、你怎么用、结论落到哪里、它不保证什么。',
    'help.systems.dutyLabel': '它管什么',
    'help.systems.usageLabel': '你怎么用',
    'help.systems.landingLabel': '落到哪里',
    'help.systems.limitLabel': '它不保证什么',

    'help.systems.goalPlanning.title': '目标规划',
    'help.systems.goalPlanning.duty': '把你的长期意图确立为可回指、可核对的项目目标，再往下拆出带可判定达成条件的子目标。',
    'help.systems.goalPlanning.usage': '你把要达成什么说清楚，它把它冻结成一个可回指的锚；往下拆的每条子目标都带着「走到哪算成」，之后每轮都能拿回来核对，不必凭印象重解释一遍。',
    'help.systems.goalPlanning.limit': '目标存在、状态是 active，不证明目标定得对，也不证明子目标拆得够。',

    'help.systems.sparkRecord.title': '火花记录',
    'help.systems.sparkRecord.duty': '承接对话里值得跨行动推进的想法、议题与未决问题，给它们一个出生地和主线入口。',
    'help.systems.sparkRecord.usage': '讨论到一半冒出的另一种做法、反复提到却没定论的疑问，当场记下来才有地方放；换个会话再想起来时能按原样找到，而不是重新发现一遍。',
    'help.systems.sparkRecord.limit': '登记下来了，不等于这个想法值得推进，也不等于对它的理解已经充分。',

    'help.systems.workOrder.title': '工单执行',
    'help.systems.workOrder.duty': '执行已经批准的工单，并承接完整的工作包生命周期：批准 → 执行 → 复核 → 关闭 → 交还。',
    'help.systems.workOrder.usage': '你批了它才动。执行前后各有一道关卡——开工前要你批，做完要你验收交还；中途断了能从当前状态接着跑，不必从头再来。',
    'help.systems.workOrder.limit': '它不会自己扩大授权范围；子任务跑完不等于整件事做完，执行完成也不等于复核通过。',

    'help.systems.researchAbsorb.title': '调研吸收',
    'help.systems.researchAbsorb.duty': '围绕你还掌握不了的问题搜集证据，直到不再产生新的确认认识，产出已证实、未证实与缺口三态证据。',
    'help.systems.researchAbsorb.usage': '把「这个我还没搞明白」交给它，它去找证据，每条结论都带来源锚点；搜到不再冒出新认识时它才停，而不是硬凑一个答案。',
    'help.systems.researchAbsorb.limit': '调研产出的是事实证据，不自动等于行动授权，也不等于任务完成；结论要进事实源，还得再过准入。',

    'help.systems.dualRecall.title': '双源召回',
    'help.systems.dualRecall.duty': '每次动手之前，从规范源和事实源召回当前相关的候选，弄清该守什么、该依据什么、哪些事必须停下来问你。',
    'help.systems.dualRecall.usage': '你不用手动调它——它横切其余六个系统，每次行动前都做一遍；召回只交付候选，「哪一条适用」是召回之后才作的判断。',
    'help.systems.dualRecall.landing': '不留独立对象——它决定的是接下来怎么动。',
    'help.systems.dualRecall.limit': '召回命中不等于适用；规则读到了、预检做完了，也不等于行动完成。',

    'help.systems.experience.title': '经验积累',
    'help.systems.experience.duty': '留存和取回项目的经验认识——哪些值得留下、沉到哪里去、什么时候该回头看它是不是还成立。',
    'help.systems.experience.usage': '踩过的坑、验证过的失败机制写成经验，下次遇到能直接复用、照着避开；只是偶然出现过一次的现象不会被当成经验收下。方向与未决问题仍归火花。',
    'help.systems.experience.limit': '留存下来不自动变成规则或授权；反思的结论也不自动生效，得落到规范或事实里，并且经你决定。',

    'help.systems.friction.title': '摩擦销账',
    'help.systems.friction.duty': '把「应当修但还没修」的系统性阻碍入账，按账目状态累积它的证据与度量。',
    'help.systems.friction.usage': '它自己会发现并记账——同一个阻碍每重复出现一次，就多一笔证据；修好了要留下可回指的解药证据，实在修不了就留下可复审的接受记录。',
    'help.systems.friction.limit': '入账不等于立项——该不该修、什么时候修由你决定；立项之后的执行归工单执行。',
    'help.trust.layers.title': '它的声明分三层',
    'help.trust.layers.confirmed.title': '已证实',
    'help.trust.layers.confirmed.hint': '可以当依据',
    'help.trust.layers.confirmed.body': '有可回读的依据：写后回读、机械校验通过、代理审核的执行记录，以及你的批准或关闭依据。',
    'help.trust.layers.unconfirmed.title': '未证实',
    'help.trust.layers.unconfirmed.hint': '别当结论',
    'help.trust.layers.unconfirmed.body': '还没拿到依据，或者依据只到了一部分。',
    'help.trust.layers.residual.title': '残留风险',
    'help.trust.layers.residual.hint': '单独列出来',
    'help.trust.layers.residual.body': '已知但没消除的东西。它会单独列出来，而不是藏进「完成」两个字里。',
    'help.trust.notproof.title': '这些都不能单独证明它做完了',
    'help.trust.notproof.1': '文件或对象存在',
    'help.trust.notproof.2': '工具调用成功',
    'help.trust.notproof.3': '测试通过',
    'help.trust.notproof.4': '页面能打开、内容看着对',
    'help.trust.notproof.5': '提交创建成功',
    'help.trust.notproof.6': '对象数量对得上',
    'help.trust.notproof.7': '你批准过',
    'help.trust.pushback.title': '这些时候该把它退回去',
    'help.trust.pushback.1': '它宣布完成，却没给出可回读的依据',
    'help.trust.pushback.2': '它把「已证实」和「未证实」揉进了同一句话',
    'help.trust.pushback.3': '有残留风险，却没提',
    'help.trust.pushback.4': '它引用的依据你回读不到',

    'help.disclaimer': '本页是给你看的使用引导，说明这套系统怎么运作，不构成规则源——规则以规范源为准，事实以事实源为准。内容随规范演化更新。',

  },
  en: {
    'logo.tagline': 'Making Vibe Coding more efficient, stable, and controllable',

    'nav.cognition': 'Focus',    'nav.projectFiles': 'Directory',
    'nav.workcases': 'Work Cases',
    'nav.adrs': 'ADRs',
    'nav.pitfalls': 'Pitfalls',
    'nav.sparks': 'Sparks',
    'nav.studies': 'Research',
    'nav.frictions': 'Frictions',
    'nav.norms': 'Norms',
    'nav.subgoals': 'Sub-goals',
    'nav.devlogs': 'DevLogs',

    'goalDetail.openDetail': 'Open goal detail',
    'goalDetail.subGoals': 'Sub-goals',
    'goalDetail.subGoalLegacy': 'This row still comes from the migrated-away sub-goal section in goal.md — it is pending migration, not a second authority (28 §14.2)',
    'objectList.subGoalAchievedNote': 'This sub-goal\'s criterion has been satisfied by evidence — judged by the criterion itself, not inferred from all its work being closed (28 §18 red line 3).',
    'objectList.subGoalOrderLabel': 'Order',
    'objectList.subGoalOrderAbsent': 'No order',
    'objectList.subGoalServingWork': 'Work serving this sub-goal',
    'objectList.subGoalServingEmpty': 'Not declared or not decomposed — no serves points at this sub-goal (28 §8.1; this is not 0% progress)',
    'objectList.subGoalServingUnreadable': 'Unreadable — must not be read as "none"',
    'objectList.subGoalServingExpand': 'Show the remaining {count}',
    'objectList.subGoalServingCollapse': 'Collapse',
    'objectList.subGoalSparkProgress': 'Sparks implemented',
    'objectList.subGoalSparkProgressEmpty': 'No sparks serving this sub-goal — the denominator is empty, not 0%',
    'objectList.subGoalSparkProgressAllDiscarded': 'All serving sparks are discarded and excluded from the denominator (discarded means merged or split, not that the work went away)',
    'objectList.subGoalSparkProgressUnavailable': 'Sparks could not be read, so this ratio cannot be computed — unreadable is not the same as none (00 §5.6)',
    'objectList.subGoalSparkProgressUnknown': '{count} spark(s) have a status outside the closed set and are excluded',
    'focusV2.subGoalProgressEmpty': 'Not broken down',
    'focusV2.subGoalProgressAllDiscarded': 'All settled',
    'focusV2.subGoalProgressUnavailable': 'Unreadable',
    // 聚焦页目标区的子目标行（2026-11-03 改版）：除标题外默认收起，点击展开。
    // 展开区是判据面 + 名下的工作两块（与子目标卡同形），不再有小标题——
    // 见中文侧同条注释。
    'focusV2.subGoalExpand': 'Expand',
    'focusV2.subGoalCollapse': 'Collapse',
    'objectList.subGoalSparkProgressOpen': 'Pending',
    'objectList.subGoalSparkProgressImplemented': 'Implemented',
    'objectList.devlogCompressedBody': 'Absorbed — the body is compressed to the two sections "Conclusion & Boundary" and "Destination" (29 §9.1)',
    'objectList.devlogConclusionMissing': 'Current conclusion missing — 29 §8 requires a non-empty `summary` appearing verbatim in the "Conclusion & Boundary" section',
    'objectDetail.subGoalCriterionDetail': 'Criterion (expanded)',
    'objectDetail.subGoalAlignmentDetail': 'Alignment (expanded)',
    'objectDetail.subGoalServingWork': 'Work serving this sub-goal',
    'objectDetail.subGoalServingEmpty': 'Not declared or not decomposed — no serves points at this sub-goal. These two cases are indistinguishable mechanically: it may genuinely not be decomposed yet, or it may be decomposed with no downstream serves declared (28 §8.1). This is not "0% progress".',
    'objectDetail.subGoalServingUnreadable': 'Unreadable types — must not be read as "no work serving it"',
    'objectDetail.subGoalKindHint.metric': 'A readable numeric value compared against a threshold',
    'objectDetail.subGoalKindHint.closure-records': 'Several traceable records must all be present; one missing means not achieved',
    'objectDetail.subGoalKindHint.executable-check': 'Run a command or script and read its exit code or output',
    'goalDetail.missingTitle': 'The project goal has not been created yet',
    'goalDetail.missingBody': 'goal.md does not exist — the Goal fact object has not been created (a legal state before project initialization). Creation goes through the AI controlled-write path; the Web is a pure presentation layer.',
    'nav.changes': 'Changes',
    'nav.changelog': 'Commit Records',
    'nav.help': 'Help',

    'nav.diagnostics': 'Diagnostics',
    'diagnostics.title': 'Runtime Diagnostics',
    'diagnostics.subtitle': 'Read-only observation of how the mechanism itself fails. Nothing here writes back to any fact source.',
    'diagnostics.loadFailed': 'Failed to load data',
    'diagnostics.tab.gate': 'Write Gate',
    'diagnostics.tab.idle': 'Idle Assist',
    'diagnostics.tab.observations': 'Friction Observations',
    'diagnostics.tab.experience': 'Experience Observations',
    'diagnostics.tab.cleanup': 'Log Cleanup',
    'diagnostics.cleanup.retention': 'Retention window',
    'diagnostics.cleanup.retentionHint': 'Records older than this are removed. A backup is taken first.',
    'diagnostics.cleanup.keepDays': 'Keep last {n} day(s)',
    'diagnostics.cleanup.targets': 'What to clean',
    'diagnostics.cleanup.targetsHint': 'Only append-only logs are checked by default; observation material is evidence once deleted, so it must be selected explicitly.',
    'diagnostics.cleanup.t.pendingQueue': 'Pending queue',
    'diagnostics.cleanup.n.pendingQueue': 'Append-only log of failures and gaps.',
    'diagnostics.cleanup.t.idleRuns': 'Run traces',
    'diagnostics.cleanup.n.idleRuns': 'Outcome of each checkpoint (ring buffer, last 50 by design).',
    'diagnostics.cleanup.t.queueBackups': 'Queue backup files',
    'diagnostics.cleanup.n.queueBackups': 'Pre-cleanup .bak-* files, judged by file mtime.',
    'diagnostics.cleanup.t.experienceBuffer': 'Experience observations',
    'diagnostics.cleanup.n.experienceBuffer': 'Material awaiting review — unreviewed items are lost permanently once cleaned.',
    'diagnostics.cleanup.t.frictionObservations': 'Friction observations',
    'diagnostics.cleanup.n.frictionObservations': 'Observations below threshold — cleaning resets accumulation progress.',
    'diagnostics.cleanup.removeCount': '−{count}',
    'diagnostics.cleanup.keepCount': '+{count}',
    'diagnostics.cleanup.preview': 'Preview removals',
    'diagnostics.cleanup.clean': 'Clean now',
    'diagnostics.cleanup.working': 'Working…',
    'diagnostics.cleanup.willRemove': 'Records older than {cutoff} will be removed — {count} total',
    'diagnostics.cleanup.doneDetail': 'Removed {count} records; backup at {path}',
    'diagnostics.cleanup.backupAt': 'Backup location',
    'diagnostics.cleanup.notListed': 'Not in cleanup scope',
    'diagnostics.cleanup.notListedHint': 'Watermarks are deliberately not cleanable: removing them makes the mechanism re-observe already-processed content and double-count. The fact source (ldvh-base/) is also untouched by log cleanup.',
    'diagnostics.experience.title': 'Experience observations',
    'diagnostics.experience.subtitle': 'Experience material the agent picked out of conversations, waiting for the review stage to judge whether it can be written up. These are neither fact objects nor candidates.',
    'diagnostics.experience.pendingHint': 'Judged one by one at the next review pass',
    'diagnostics.experience.discarded': 'Judged not to be experience',
    'diagnostics.experience.discardedHint': 'Settled as not worth writing up: traced here, never a fact object, and taken away by log cleanup',
    'diagnostics.experience.entries': 'Material entries',
    'diagnostics.experience.pending': 'Awaiting review',
    'diagnostics.experience.oldest': 'Oldest',
    'diagnostics.experience.oldestNone': 'Nothing awaiting review',
    'diagnostics.experience.projects': 'Partitioned across {count} project(s)',
    'diagnostics.experience.entriesTitle': 'Recently captured material',
    'diagnostics.experience.entriesHint': 'Only phenomenon, time, source and status are shown. Verbatim quotes and the pending question are not shown here — they are material content, not runtime state.',
    'diagnostics.experience.empty': 'No material yet.',
    'diagnostics.experience.noBufferDir': 'No observation carrier yet',
    'diagnostics.experience.noBufferDirHint': 'This is the normal initial state: nothing has been captured yet. Content appears here once the capture stage has run.',
    'diagnostics.observations.entries': 'Observations',
    'diagnostics.observations.projects': 'Per-project carriers: {count} file(s)',
    'diagnostics.observations.groups': 'Observation groups',
    'diagnostics.observations.threshold': 'Promoted to a ledger entry at {n}',
    'diagnostics.observations.ready': 'At threshold',
    'diagnostics.observations.pending': 'Accumulating (pending)',
    'diagnostics.observations.groupsTitle': 'Observation groups: how many times one obstacle was seen',
    'diagnostics.observations.groupsHint': 'Observation material is not a fact object. This is progress toward the threshold only — not a ledger entry, and not openable as a detail page.',
    'diagnostics.observations.recentTitle': 'Recent observations',
    'diagnostics.observations.recentHint': 'Only phenomenon / time / source / status are shown (11 §12bis.1 item 2). Evidence text and promotion target are outside the presentation surface.',
    'diagnostics.observations.readyBadge': 'Ready',
    'diagnostics.observations.empty': 'No entries',
    'diagnostics.observations.noBufferDir': 'The observation directory does not exist yet',
    'diagnostics.observations.noBufferDirHint': 'This is the normal initial state: no observation has landed yet. The directory is created when friction discovery first writes one.',
    'diagnostics.gate.calls': 'Tool calls',
    'diagnostics.gate.failed': 'Rejected',
    'diagnostics.gate.failureRate': '{rate}% failure rate',
    'diagnostics.gate.worstTool': 'Most-failing tool',
    'diagnostics.gate.sessions': 'Sessions scanned',
    'diagnostics.gate.byCategory': 'Failures by nature',
    'diagnostics.gate.byTool': 'Calls and failures per tool',
    'diagnostics.gate.recentFailures': 'Individual failures',
    'diagnostics.gate.toolColumn': 'Tool',
    'diagnostics.gate.empty': 'No records.',
    'diagnostics.idle.unresolved': 'Unresolved entries',
    'diagnostics.idle.total': '{count} total',
    'diagnostics.idle.over24h': 'Unresolved over 24h',
    'diagnostics.idle.runs': 'Runs',
    'diagnostics.idle.stopped': 'Abnormal stops',
    'diagnostics.idle.stoppedHint': 'Runs that never landed anything',
    'diagnostics.idle.byCategory': 'Unresolved entries by reason',
    'diagnostics.idle.recentRuns': 'Recent runs',
    'diagnostics.idle.queueRecent': 'Recent unresolved entries',
    'diagnostics.idle.settled': 'Settled',
    'diagnostics.idle.settledHint': 'How often the settlement channel was used',
    'diagnostics.idle.settledRecent': 'Recent settlements',
    'diagnostics.idle.settledRecentNote': 'A settlement note is the product of an examination; a settlement without one is not.',
    'diagnostics.idle.settledEmpty': 'Never settled — the channel exists, but nobody has used it.',
    'diagnostics.idle.settledNoNote': 'This settlement left no examination note.',
    'diagnostics.idle.runQueueKey': 'Queue entry {id}',
    'diagnostics.idle.empty': 'No records.',
    'diagnostics.category.missingArguments': 'Missing required arguments',
    'diagnostics.category.auditSummaryShape': 'Audit summary not verbatim',
    'diagnostics.category.carrierValidation': 'Body or carrier validation',
    'diagnostics.category.objectNotFound': 'Object or key not found',
    'diagnostics.category.shapeAndConcurrency': 'Shape and concurrency',
    'diagnostics.category.other': 'Other',
    'diagnostics.category.subagentStopped': 'Subagent stopped abnormally',
    'diagnostics.category.observationGap': 'Observation gap',
    'diagnostics.category.quoteNotInWindow': 'Quote outside window',
    'diagnostics.category.quoteTooShort': 'Quote too short',
    'diagnostics.category.carrierIneffective': 'Carrier coherence failed',
    'diagnostics.category.titleTooLong': 'Title too long',
    'diagnostics.category.dispatchUnavailable': 'Dispatch unavailable',
    'diagnostics.status.rejected': 'Rejected',
    'diagnostics.status.invalidRequest': 'Invalid request',
    'diagnostics.status.completed': 'Completed',
    'diagnostics.status.unknown': 'Unknown',

    'nav.settings': 'Settings',
    'nav.collapseSidebar': 'Collapse sidebar',
    'nav.expandSidebar': 'Expand sidebar',
    'nav.refreshReading': 'Refresh page data',
    'nav.openInBrowser': 'Open current page in browser',
    'projectSwitcher.label': 'Governed project',
    'projectSwitcher.choose': 'Select project',
    'projectSwitcher.scopeHint': 'Global project scope',
    'projectSwitcher.worktreeScopeHint': 'Choose a worktree and branch within a governed project',
    'projectSwitcher.projectCount': '{count} projects',
    'projectSwitcher.worktreeCount': '{count} worktrees',
    'projectSwitcher.mainWorktree': 'Main worktree',
    'projectSwitcher.detached': 'Detached HEAD',
    'projectSwitcher.refresh': 'Refresh worktree list',
    'projectSwitcher.loading': 'Loading projects',
    'projectSwitcher.loadFailed': 'Failed to load projects',
    'projectSwitcher.noProjects': 'No governed projects available',
    'settings.title': 'Settings',
    'settings.subtitle': 'Manage the workspace governed-project configuration',
    'settings.managementScope': 'Management scope',
    'settings.configOnly': 'This page only manages registrations in LDVH-GOVERNED-PROJECTS.yaml. It does not modify project facts, Git branches, or execution state.',
    'settings.verificationBoundary': 'Verification boundary',
    'settings.gitNotice': 'No Git remote URL is needed. Each local path must be verified as a Git worktree when saved; remote URLs, branches, and HEAD do not determine governance.',
    'settings.governedProjects': 'Governed projects',
    'settings.verifyCurrent': 'Verify current configuration',
    'settings.verifying': 'Verifying…',
    'settings.savedVerified': 'Saved and verified the current project registrations as Git worktrees.',
    'settings.currentVerified': 'All current project registrations passed Git worktree verification.',
    'settings.defaultProject': 'Default project',
    'settings.saveDefault': 'Save default project',
    'settings.defaultExplicit': 'This project is selected by default on startup.',
    'settings.defaultFallback': 'The first configured project is selected temporarily.',
    'settings.addProject': 'Add project',
    'settings.stableId': 'Stable ID',
    'settings.localWorktreePath': 'Local Git worktree path',
    'settings.nickname': 'Nickname',
    'settings.addAndVerify': 'Add and verify Git project',
    'settings.projectId': 'ID',
    'settings.projectPath': 'Path',
    'settings.saveNickname': 'Save nickname',
    'federation.title': 'All Governed Projects',
    'federation.subtitle': 'Read-only summary across all governed projects; enter a single project view via "Enter project".',
    'federation.refresh': 'Refresh',
    'federation.retry': 'Retry',
    'federation.noProjects': 'No governed projects are registered.',
    'federation.defaultProject': 'Default',
    'federation.sparkOpen': 'Open',
    'federation.activeWorkCases': 'Active',
    'federation.pendingDecisions': 'Pending',
    'federation.lastActivity': 'Last activity',
    'federation.projectIssues': 'Some data unavailable',
    'federation.enterProject': 'Enter project',
    'federation.crossSparks': 'Cross-project open sparks (by priority and staleness)',
    'federation.objectsTitle': 'All governed projects',
    'federation.objectsSubtitle': 'Aggregated object list across all governed projects; opening an object enters its project detail view.',
    'federation.unsupportedType': 'Unsupported object type.',
    'federation.loading': 'Loading…',
    'federation.noObjects': 'No objects under the current filter.',
    'federation.projectFilter': 'Project',
    'federation.allProjects': 'All',
    'federation.singleProjectOnly': 'This page requires entering a single governed project',
    'projectSwitcher.allProjects': 'All governed projects',
    'settings.projectColor': 'Project color',
    'settings.readOnlyHint': 'Governed projects are read-only here: manage registration in the DSH plugin settings card (LDVH); project colors can be set here or there.',
    'settings.colorAuto': 'Auto (stable by ID)',
    'settings.removeProject': 'Remove project',
    'settings.removeConfirm': 'Remove governed project “{project}”? This only changes the workspace configuration.',
    'settings.retryLoad': 'Retry loading',
    'settings.workspaceWorktrees': 'Current workspace worktrees',
    'settings.workspaceWorktreesHint': 'Read-only scan of Git worktrees reachable from the current workspace project directories, including branch and uncommitted status. Scanning does not change governance.',
    'settings.refreshWorktrees': 'Refresh worktrees',
    'settings.noWorktrees': 'No Git worktrees were found in the current workspace.',
    'settings.detachedHead': 'Detached HEAD',
    'settings.mainWorktree': 'Main worktree',
    'settings.worktreeStatus': 'Staged {staged} · Unstaged {unstaged} · Untracked {untracked} · Conflicts {conflicted}',
    'settings.worktreeStatusUnavailable': 'The worktree status is unavailable.',
    'settings.worktreeRegistered': 'Registered: {id}',
    'settings.worktreeGovernedBy': 'Governed by: {id}',
    'settings.addWorktree': 'Add to governance',
    'theme.system': 'System theme',
    'theme.light': 'Light mode',
    'theme.dark': 'Dark mode',
    'language.switchToEnglish': 'Switch to English',
    'language.switchToChinese': 'Switch to Chinese',
    'language.english': 'English',
    'language.chinese': '中文',

    'focusV2.goalTitle': 'Goal',
    'focusV2.hintCreateGoal': 'Discuss with AI in the conversation to create and decompose the goal',
    'focusV2.hintCreateExample': 'e.g., "I want to create a goal"',
    'focusV2.collapseSection': 'Collapse goal',
    'focusV2.expandSection': 'Expand goal',
    'focusV2.btnCopied': 'Copied',
    'focusV2.promptSetGoal': 'I want to create a goal',

    'cognition.title': 'Focus',
    'cognition.derivedView': 'Derived view',
    'cognition.inbox.title': 'Pending Decisions',
    'cognition.inbox.empty': 'Nothing is waiting for your decision right now',
    'cognition.inbox.truncated': '{total} pending decisions in total; showing the first {shown} by order, {hidden} not shown',
    'cognition.inbox.showAll': 'Show all',
    'cognition.inbox.collapse': 'Collapse',
    'cognition.inbox.expandSection': 'Expand pending decisions',
    'cognition.inbox.collapseSection': 'Collapse pending decisions',
    'cognition.frictionLedger.accepted': '{count} accepted as unpayable',
    'cognition.inbox.unavailable': 'Some data for this module is unavailable',
    'cognition.active.title': 'Work in Progress',
    'cognition.active.empty': 'No WorkCase is currently in progress',
    'cognition.active.truncated': '{total} active items in total; showing the first {shown} by order, {hidden} not shown',
    'cognition.active.showAll': 'Show all',
    'cognition.active.collapse': 'Collapse',
    'cognition.active.expandSection': 'Expand work in progress',
    'cognition.active.collapseSection': 'Collapse work in progress',
    'cognition.active.unavailable': 'Some work-in-progress data is unavailable',
    'cognition.active.copyModuleSummary': 'Copy module summary',
    'cognition.active.copiedModuleSummary': 'Module summary copied',
    'cognition.kind.plan_confirmation': 'Plan awaiting approval',
    'cognition.kind.closure_confirmation': 'Closure awaiting confirmation',
    'cognition.kind.friction_repair': 'Friction awaiting repair',
    'cognition.copyModuleSummary': 'Copy module summary',
    'cognition.copiedModuleSummary': 'Module summary copied',
    'cognition.updatedAt': 'Updated {time}',
    'cognition.recent.title': 'Recent Activity',
    'cognition.recent.empty': 'No observable object activity in this time range',
    'cognition.recent.created': 'Created',
    'cognition.recent.updated': 'Updated',
    'cognition.recent.windowLabel': 'Recent activity time range',
    'cognition.recent.window.1d': 'Past day',
    'cognition.recent.window.3d': 'Past 3 days',
    'cognition.recent.window.7d': 'Past week',
    'cognition.recent.truncated': '{total} fact objects; showing the first {shown}, {hidden} not shown',
    'cognition.recent.showAll': 'Show all',
    'cognition.recent.showMore': 'Show more',
    'cognition.recent.showRemaining': 'Show {count} more fact objects',
    'cognition.recent.showRemainingUsage': 'Show {count} more attribution entries',
    'cognition.recent.collapse': 'Collapse',
    'cognition.recent.activityCount': '{count} activity entries',
    'cognition.recent.occurrenceCount': 'Observed {count} time(s) — the mechanical authority for frequency (26 §8)',
    'cognition.recent.modelUsage': 'Model',
    'cognition.recent.environmentUsage': 'Provider',
    'cognition.recent.expandSection': 'Expand recent activity',
    'cognition.recent.collapseSection': 'Collapse recent activity',
    'cognition.recent.copyModuleSummary': 'Copy module summary',
    'cognition.recent.copiedModuleSummary': 'Module summary copied',
    'cognition.recent.loading': 'Updating…',
    'cognition.sparkHealth.title': 'Spark Health',
    'cognition.sparkHealth.empty': 'No pending Sparks match this filter',
    'cognition.sparkHealth.unavailable': 'Spark health data is unavailable',
    'cognition.sparkHealth.ageFilter': 'Time',
    'cognition.sparkHealth.ageFilter.all': 'All',
    'cognition.sparkHealth.ageFilter.3d': 'Over 3 days',
    'cognition.sparkHealth.ageFilter.7d': 'Over a week',
    'cognition.sparkHealth.settled': '{count} settled',
    'cognition.sparkHealth.pending': '{count} pending',
    'cognition.sparkHealth.silentDays': 'Inactive for {days} days',
    'cognition.sparkHealth.showRemaining': 'Show {count} more pending Sparks',
    'cognition.sparkHealth.collapseList': 'Collapse silent items',
    'cognition.sparkHealth.expandSection': 'Expand Spark health',
    'cognition.sparkHealth.collapseSection': 'Collapse Spark health',
    'cognition.sparkHealth.copyModuleSummary': 'Copy module summary',
    'cognition.sparkHealth.copiedModuleSummary': 'Module summary copied',

    'objectList.noObjects': 'No {type} objects yet',
    'objectList.noObjectsUnderFilter': 'No {type} objects under the current filter',
    'objectList.searchLabel': 'Search objects',
    'objectList.searchPlaceholder': 'Search title or full object ID',
    'objectList.searchNoResults': 'No matching objects found',
    'objectList.typeNotIntegrated': 'This fact type is not integrated',
    'objectList.all': 'All',
    'objectList.statusFilter': 'Status filter',
    'objectList.reportKindFilter': 'Report Type',
    'objectList.lifecycleFilter': 'Lifecycle',
    'objectList.progressGroupFilter': 'Progress group',
    'objectList.priorityFilter': 'Priority',
    'objectList.sort': 'Sort',
    'objectList.sortUpdatedDesc': 'Last updated ↓',
    'objectList.sortCreatedDesc': 'Created ↓',
    'objectList.sortPriorityAsc': 'Disposition order ↑',
    'objectList.priorityNotApplicable': 'Priority does not apply to terminal objects.',
    'objectList.relatedPlans': 'Related WorkCases',
    'objectList.planCount': '{count} WorkCases',
    'objectList.activePlanCount': 'Active WorkCases',
    'objectList.humanConfirmPlanCount': 'WorkCases awaiting confirmation',
    'objectList.closedPlanCount': 'Closed WorkCases',
    'objectList.closeDecision': 'Close Decision',
    'objectList.closureIssue': 'Closure Issue',
    'objectList.planExecutionQueue': 'Execution Queue',
    'objectList.planExecutionItems': 'Execution Items',
    'objectList.executionItemCount': '{count} execution items',
    'objectList.planExecutionRisk': 'Risk',
    'objectList.executionFlowPending': 'Pending',
    'objectList.executionFlowInProgress': 'In progress',
    'objectList.executionFlowBlocked': 'Blocked',
    'objectList.executionFlowCompleted': 'Completed',
    'objectList.executionFlowCancelled': 'Cancelled',
    'objectList.executionFlowRisk': 'Risk',
    'objectList.executionFlowOther': 'Other',
    'objectList.executionFlowCount': '{status}: {count}',
    'objectList.activeCount': '{count} active',
    'objectList.reviewCount': '{count} pending close',
    'objectList.riskCount': '{count} at risk',
    'objectList.noPlans': 'No related WorkCases',
    'objectList.noExecutionItems': 'No execution items',
    'objectList.morePlans': '{count} more WorkCases',
    'objectList.moreExecutionItems': '{count} more execution items',
    'objectList.successCriteria': 'Success Criteria',
    'objectList.planConfirmedAt': 'Plan Confirmed',
    'objectList.reviewRequestedAt': 'Review Request',
    'objectList.closureRequestedAt': 'Closure Requested',
    'objectList.completionEvidence': 'Completion Evidence',
    'objectList.verificationEvidence': 'Verification Evidence',
    'objectList.closureEvidence': 'Closure Evidence',
    'objectList.hasRecord': 'Recorded',
    'objectList.missingRecord': 'Incomplete',
    'objectList.disposition': 'Disposition',
    'objectList.missingReason': 'Missing reason',
    'objectList.missingReasonText': 'This non-active object must record a reason in its fact source.',
    'objectList.updated': 'Updated {time}',
    'objectList.noRouteTarget': 'No fact-object target recorded',
    'objectList.routed': 'Routed',
    'objectList.target': 'Target',
    'objectList.time': 'Time',
    'objectList.dispositionMissing': 'Disposition missing.',
    'objectList.associationUnavailable': 'Related information unavailable.',
    'objectList.sourceBranch': 'From branch {branch}',
    'objectList.mainWorktreeDiffers': 'Differs from main worktree',
    'objectList.associationState.pending': 'Pending',
    'objectList.associationState.closed': 'Closed',
    'objectList.associationState.discarded': 'Discarded',
    'objectList.associationState.progressing': 'In progress',
    'objectList.associationState.active': 'Active',
    'objectList.discarded': 'Discarded',
    'objectList.reason': 'Reason',
    'objectList.workcaseStateDynamic': 'In progress',
    'objectList.workcaseStateWaiting': 'Waiting for Human',
    'objectList.workcaseStateClosed': 'WorkCase closed',
    'objectList.workcaseProgressUnavailable': 'Progress unavailable',
    'objectList.workcaseProgressGroupUnavailable': 'Unable to form a progress group from source status/phase.',
    'objectList.workcaseGistMissing': '(no gist recorded)',
    'objectList.workcaseStageUnavailable': 'Current step unavailable',
    'objectList.workcasePlanRevising': 'Plan revision',
    'objectList.workcaseOutsideProgressTrack': 'Outside the four-step track',
    'objectList.workcaseItemsUnavailable': 'Work item progress unavailable',
    'objectList.workcaseGoal': 'Goal',
    'objectList.workcaseContributions': 'Follow-up contributions',
    'objectList.workcaseTargetReading': 'Reading',
    'objectList.workcaseSparkSuggestions': 'Spark suggestions',
    'objectList.workcaseRestrictionReason': 'Constraint',
    'objectList.workcaseImpactSummary': 'Impact',
    'objectList.workcaseResumeCondition': 'Resume condition',
    'objectList.workcaseFollowUpSummary': 'Follow-up',
    'objectList.workcaseClosureDecisionInput': 'Closure decision input',
    'objectList.workcaseClosureProposal': 'Closure proposal',
    'objectList.workcaseTerminalDisposition': 'Terminal disposition',
    'objectList.workcaseProposedOutcome': 'Proposed outcome',
    'objectList.workcaseDispositionSummary': 'Disposition summary',
    'objectList.workcaseResidualDecisions': 'Residual disposition proposals',
    'objectList.workcaseClosureProposalMissing': 'Closure proposal is missing or malformed; closure decision input is unavailable.',
    'objectList.workcaseItemProgress': '{done}/{total} completed',
    'objectList.workcaseItemsCancelled': '{count} cancelled',
    'objectList.workcaseItems': 'Work items',
    'objectList.workcaseCurrentItems': 'Current work items',
    'objectList.workcaseNoCurrentItems': 'No work item is in progress yet',
    'objectList.workcaseItemCompleted': 'Completed',
    // v5 lifecycle groups (21 §9 + WC-0002 presentation contract; awaiting-gate2 = open ∧ body has ## 结果)
    'objectList.workcaseOutcome.completed': 'Completed',
    'objectList.workcaseOutcome.partial': 'Partial',
    'objectList.workcaseOutcome.not-achieved': 'Not achieved',
    'objectList.workcaseOutcome.cancelled': 'Cancelled',
    'objectList.workcaseClosedOutcome.completed': 'Completed',
    'objectList.workcaseClosedOutcome.partial': 'Partially completed',
    'objectList.workcaseClosedOutcome.not-achieved': 'Not completed',
    'objectList.workcaseClosedOutcome.cancelled': 'Cancelled',
    'objectList.workcaseGate1': 'Gate 1 authorization \u00b7 {approver} \u00b7 {approvedAt}',
    'objectList.workcaseAttemptController': 'Controller',
    // Change flow (card body): key actions marked with a word (Human 2026-09-23).
    'objectList.workcaseFlowMore': '{count} earlier',
    'objectList.workcaseFlowCollapse': 'Collapse',
    'objectList.workcaseFlowShow': 'Show {count} changelog entries',
    'objectList.workcaseFlowHide': 'Hide changelog',
    'objectList.workcaseFlowMark.review': 'Review',
    'objectList.workcaseFlowMark.revise': 'Revise',
    'objectList.workcaseFlowMark.adjustment-approved': 'Adjustment approved',
    'objectList.workcaseFlowMark.adjustment-rejected': 'Adjustment rejected',
    'objectList.workcaseAdjustment.pending': 'Pending adjustment',
    'objectList.workcaseAdjustment.pendingLine': '{count} item(s) requested',
    'objectList.workcaseAdjustment.awaitingHuman': '(awaiting Human)',
    // Awaiting-closure checks and advice (parsed from the 21 §8 result section)
    'objectList.workcaseCheck.achieved': 'Achieved',
    'objectList.workcaseCheck.partial': 'Partial',
    'objectList.workcaseCheck.not-achieved': 'Not achieved',
    'objectList.workcaseCheck.unrecorded': 'Unrecorded',
    // Advice directions (21 §8 advice section). The first two are the current
    // closed set; the next two were retired on 2026-09-28 and are kept only so
    // existing carriers stay readable (§15.3 存量不溯及) — the write path
    // rejects them.
    'objectList.workcaseAdvice.另立工单': 'New WorkCase',
    'objectList.workcaseAdvice.接受现状': 'Accept',
    'objectList.workcaseAdvice.转入 Spark': 'Spark suspension',
    'objectList.workcaseAdvice.直接行动': 'Direct action',
    'objectList.workcaseAdvice.unclassified': 'Unclassified',
    // Closed-card conclusion line and residual block (Human 2026-09-24, option A)
    'objectList.workcaseCheckTally': '{achieved}/{total} achieved',
    // Closed-card cancellation record (21 §8, outcome=cancelled only)
    'objectList.workcaseNotExecuted': 'No plan step executed',
    'objectList.workcaseCancelReason': 'Cancellation reason',
    // The residual tally keys are kept after the 2026-09-28 revision removed the
    // residual count from the closed-card conclusion line (decision A: a closed
    // card shows directions only). Deleting them would turn any remaining
    // reference into a missing key, which is silent breakage rather than
    // convergence.
    'objectList.workcaseResidualTally': '{count} residual',
    'objectList.workcaseResidualTag': 'Residual',
    'objectList.workcaseResidualNone': 'No residual',
    // Routed-to direction target row (10 §5.5 closed card: rendered in place as an
    // association row).
    'objectList.workcaseRoutedToUnavailable': 'Target unreadable',
     // 21 §13 / 03 §7.2: reverse refs show declared sources only; they do not imply fulfilment or closure.
     'objectList.workcaseRefSourceUnavailable': 'Reference source unavailable',
     'objectList.workcaseRefSourceStatus': 'Status: {status}',
     'objectList.workcaseRefSourceUid': 'Object UID: {uid}',
    'objectDetail.workcaseServes': 'Serves sub-goal',
    'objectDetail.workcaseScope': 'Authorization scope',
    'objectDetail.workcasePlan': 'Plan & done criteria',
    'objectDetail.workcaseAmendmentStep': 'Amendment',
    'objectDetail.workcaseAttempt': 'Execution',
    'objectDetail.workcaseReviews': 'Reviews',
    'objectDetail.reviewElementEmpty': '(not recorded)',
    'objectDetail.reviewElement.对象': 'Subject',
    'objectDetail.reviewElement.基线': 'Baseline',
    'objectDetail.reviewElement.方法': 'Method',
    'objectDetail.reviewElement.覆盖': 'Covered',
    'objectDetail.reviewElement.未覆盖': 'Not covered',
    'objectDetail.reviewElement.发现': 'Findings',
    'objectDetail.reviewElement.保证边界': 'Assurance boundary',
    'objectDetail.workcaseAttemptController': 'Controller',
    'objectDetail.workcaseAttemptId': 'attempt',
    'objectDetail.workcaseAttemptStartedAt': 'Started at',
    'objectDetail.workcaseAttemptHeartbeat': 'Heartbeat',
    'objectDetail.workcaseResultDraft': 'Result draft',
    'objectDetail.workcaseBodyExecutionSection': 'Execution',
    'objectDetail.workcaseBodyResultSection': 'Result',
    'objectDetail.workcaseOutcome': 'Outcome',
    'objectDetail.workcaseOutcome.completed': 'Completed',
    'objectDetail.workcaseOutcome.partial': 'Partial',
    'objectDetail.workcaseOutcome.notAchieved': 'Not achieved',
    'objectDetail.workcaseOutcome.cancelled': 'Cancelled',
    'objectDetail.workcaseResultChecks': 'Criteria checks',
    'objectDetail.workcaseAchievedScope': 'Achieved scope',
    'objectDetail.workcaseResidual': 'Residual',
    // Directions (21 §8 residual-section direction sub-items): the only side the
    // detail face keeps after decision A's narrowing (10 §5.5). Neutral wording —
    // §10.2 states only closure and outcome are approved.
    'objectDetail.workcaseDirections': 'Directions',
    'objectDetail.workcaseGate1': 'Gate 1 authorization',
    'objectDetail.workcaseGate1Approver': 'Approver',
    'objectDetail.workcaseGate1ApprovedAt': 'Approved at',
    'objectList.workcaseItemInProgress': 'In progress',
    'objectList.workcaseItemBlocked': 'Blocked',
    'objectList.workcaseItemPending': 'Not started',
    'objectList.workcaseItemCancelled': 'Cancelled',
    'objectList.workcaseItemStageMismatch': 'Work item states do not match the current step',
    'objectList.workcaseCriteriaCount': '{count} criteria',
    'objectList.workcaseFieldMissing': 'Not recorded',
    'objectList.frictionPhenomenonMissing': 'Phenomenon missing',
    'objectList.workcaseGateFieldMalformed': 'Incomplete or malformed structure',
    'objectList.workcaseAuthorizedActionCount': '{count} authorized actions',
    'objectList.workcaseProhibitedActionCount': '{count} prohibitions',
    'objectList.workcasePrerequisiteCount': '{count} Human prerequisites',
    'objectList.workcaseIndependentSubagentUnavailable': 'Sub Agent',
    'objectList.workcaseIndependentSubagentUnavailableHint': 'Independent subagent unavailable',
    'objectList.workcaseCoveragePartial': 'WorkCase read coverage is incomplete. The cards shown come only from consumable mechanical reads; this does not prove these are the only WorkCases in the project.',
    'objectList.workcaseCoverageUnavailable': 'Technical conditions did not produce a reliable WorkCase list scope. The page will not present this as a complete empty list.',
    'objectList.workcaseObjectProblems': 'WorkCase read coverage is complete, but some candidates did not form consumable mechanically valid objects. Their content is not presented.',
    'objectList.workcaseCoverageProblemCount': 'View {count} read or coverage diagnostics',
    'objectList.workcaseCoverageCollectionScope': 'WorkCase object collection',
    'objectList.workcaseCoverageUnavailableEmpty': 'The WorkCase list is unavailable, so object presence cannot be determined.',
    'objectList.workcaseCoveragePartialEmpty': 'No cards are displayable in the observed range, but coverage is incomplete; this does not mean there are no WorkCases.',
    'objectList.workcaseObjectProblemsEmpty': 'WorkCase candidates were found in the completed read scope, but none formed a displayable mechanically valid object. Review the diagnostics above.',
    'objectList.objectProblems': 'Read coverage is complete, but some candidates have issues and cannot be displayed. Review the diagnostics.',
    'objectList.coveragePartial': 'Read coverage is incomplete. The cards shown come only from successfully read objects; this does not prove these are the only objects in the project.',
    'objectList.coverageUnavailable': 'Technical conditions did not produce a reliable list scope. The page will not present this as a complete empty list.',
    'objectList.coverageProblemCount': 'View {count} read or coverage diagnostics',
    'objectList.coverageCollectionScope': 'Object collection',
    'objectList.coverageUnavailableEmpty': 'The list is unavailable, so object presence cannot be determined.',
    'objectList.coveragePartialEmpty': 'No cards are displayable in the observed range, but coverage is incomplete; this does not mean there are no objects.',
    'objectList.objectProblemsEmpty': 'Candidates were found in the completed read scope, but none formed a displayable object. Review the diagnostics above.',
    'objectList.workcaseDynamicStages': 'Progress step',
    'objectList.workcaseStageExecute': 'Item execution',
    'objectList.workcaseStageSelfCheck': 'Controller self-check',
    'objectList.workcaseStageResultReview': 'Independent review',
    'objectList.workcaseStageSynthesis': 'Controller synthesis',

    'objectDetail.back': 'Back',
    'objectDetail.fieldIssues': 'Source field issues',
    'objectDetail.unparsedStructures': 'Unparsed structures',
    'objectDetail.fieldMissing': 'Missing',
    'objectDetail.structuredTextIssue': 'Writing-structure issue',
    'objectDetail.structuredTextIssueHint': '(21 §8: form only; content accuracy is not judged)',
    'objectDetail.fieldTypeMismatch': 'Type mismatch',
    'objectDetail.fieldIdentityMismatch': 'Identity mismatch',
    'objectDetail.fieldExpected': 'Expected {expected}',
    'objectDetail.content': 'Content',
    'objectDetail.fileContent': 'File Content',
    'objectDetail.previewFile': 'Preview File',
    'objectDetail.fileInformation': 'File Information',
    'objectDetail.contentIdentity': 'Content Identity',
    'objectDetail.deletionRecord': 'Deletion Record',
    'objectDetail.yamlSource': 'YAML Data',
    'objectDetail.id': 'ID',
    'objectDetail.type': 'Type',
    'objectDetail.status': 'Status',
    'objectDetail.created': 'Created',
    'objectDetail.updated': 'Updated',
    'objectDetail.createdShort': 'Created',
    'objectDetail.updatedShort': 'Updated',
    'objectDetail.expand': 'Expand',
    'objectDetail.collapse': 'Collapse',
    'objectDetail.aggregatedDeliverables': 'Aggregated Deliverables',
    'objectDetail.aggregatedDocs': 'Aggregated Docs',
    'objectDetail.editStatus': 'Click to change status',
    'objectDetail.editAcceptance': 'Click to edit acceptance criteria',
    'objectDetail.goal': 'Goal',
    'objectDetail.noDescription': 'No description recorded',
    'objectDetail.workPlan': 'WorkCase',
    'objectDetail.executionStatus': 'Execution Status',
    'objectDetail.currentState': 'Current State',
    'objectDetail.waitingFor': 'Waiting For',
    'objectDetail.acceptance': 'Acceptance',
    'objectDetail.verification': 'Verification',
    'objectDetail.verificationEvidence': 'Verification Evidence',
    'objectDetail.closureEvidence': 'Closure Evidence',
    'objectDetail.noAcceptance': 'No acceptance criteria recorded',
    'objectDetail.noVerification': 'No verification recorded',
    'objectDetail.noClosureEvidence': 'No closure evidence recorded',
    'objectDetail.relatedDocs': 'Related Docs',
    'objectDetail.related': 'Related',
    'objectDetail.affectedDocs': 'Affected Docs',
    'objectDetail.dependencies': 'Dependencies',
    'objectDetail.otherFields': 'Other Fields',
    'objectDetail.emptyValue': 'Empty',
    'objectDetail.planGoal': 'WorkCase Goal',
    'objectDetail.planDescription': 'WorkCase Description',
    'objectDetail.noPlanGoal': 'No WorkCase goal recorded',
    'objectDetail.noPlanDescription': 'No WorkCase description recorded',
    'objectDetail.planExecution': 'Execution Queue',
    'objectDetail.workcaseProgress': 'WorkCase Progress',
    'objectDetail.workcaseCloseout': 'Closeout and Remaining Responsibilities',
    'objectDetail.noWorkcaseCloseout': 'No closeout record is available',
    'objectDetail.workcaseHumanOverview': 'WorkCase Overview',
    'objectDetail.workcaseHumanContext': 'Human View',
    'objectDetail.workcaseAiContext': 'AI Context',
    'objectDetail.workcaseAiCore': 'Core Context',
    'objectDetail.workcaseAiReviewContext': 'Review Context',
    'objectDetail.executionReferences': 'Execution References',
    'objectDetail.lifecycleStage': 'Lifecycle Stage',
    'objectDetail.lifecycleDraft': 'Goal alignment',
    'objectDetail.lifecyclePlanConfirming': 'Plan confirmation',
    'objectDetail.lifecycleActive': 'Executing',
    'objectDetail.lifecycleBlocked': 'Blocked',
    'objectDetail.lifecycleVerification': 'Verification',
    'objectDetail.lifecycleResultReview': 'Result review',
    'objectDetail.lifecycleReview': 'Closure confirmation',
    'objectDetail.lifecycleClosed': 'Closed',
    'objectDetail.successCriteriaProgress': 'Success criteria',
    'objectDetail.executionItemProgress': 'Execution items',
    'objectDetail.workcaseExecution': 'Execution Items',
    'objectDetail.executionItemsLoading': 'Loading execution item posture',
    'objectDetail.workcaseReview': 'Reviews, Dispositions, and Approvals',
    'objectDetail.planReview': 'Pre-creation Plan Review',
    'objectDetail.resultReview': 'Result Review',
    'objectDetail.reviewPolicy': 'Review Policy',
    'objectDetail.reviewItems': 'Review Items',
    'objectDetail.controllerResolution': 'Controller Disposition',
    'objectDetail.humanPlanConfirmation': 'Plan Confirmation',
    'objectDetail.humanClosureConfirmation': 'Closure Confirmation',
    'objectDetail.reviewConclusion': 'Conclusion',
    'objectDetail.controllerSelfCheck': 'Controller self-check',
    'objectDetail.specialistReview': 'Result Review',
    'objectDetail.humanClosureReview': 'Human Closure Confirmation',
    'objectDetail.reviewRequirement': 'Requirement',
    'objectDetail.required': 'Required',
    'objectDetail.notRequired': 'Not required',
    'objectDetail.reviewRole': 'Role',
    'objectDetail.expectedOutput': 'Expected output',
    'objectDetail.noSuccessCriteria': 'No success criteria recorded',
    'objectDetail.planCloseReview': 'Close Decision',
    'objectDetail.closeDecisionReady': 'Ready to close',
    'objectDetail.closeDecisionReadyHint': 'Success criteria and completion evidence are confirmed.',
    'objectDetail.closeDecisionPending': 'Close conditions not met',
    'objectDetail.closeDecisionPendingHint': 'Some success criteria or completion evidence still needs confirmation.',
    'objectDetail.closeDecisionPendingItems': 'Pending confirmations',
    'objectDetail.closeDecisionNoPendingItems': 'No pending confirmations',
    'objectDetail.closeDecisionRecordState': 'Record state',
    'objectDetail.noCompletionEvidence': 'No completion evidence recorded',
    'objectDetail.noVerificationEvidence': 'No verification evidence recorded',
    'objectDetail.planMaterials': 'Deliverables and Docs',
    'objectDetail.relatedMaterials': 'Related Materials',
    'objectDetail.workcaseResponsibility': 'Goal',
    'objectDetail.workcaseCurrentSnapshot': 'Current Snapshot',
    'objectDetail.workcaseCurrentSnapshotUnavailableHint': 'The current read did not produce a usable state projection, so the progress track and next required control step are not shown.',
    'objectDetail.workcaseNextRequiredControlStep': 'Next Required Control Step',
    'objectDetail.workcaseNextRequiredControlStepBoundary': 'This is only the next structural control step; it does not establish authorization, capability, priority, or completion.',
    'objectDetail.workcaseNextControlStepHumanDecision': 'Human decision required',
    'objectDetail.workcaseNextControlStepUnavailable': 'Currently unavailable',
    'objectDetail.workcaseNextControlStep.human_gate_1': 'Wait for Human Gate 1',
    'objectDetail.workcaseNextControlStep.form_current_plan': 'Form the complete current plan',
    'objectDetail.workcaseNextControlStep.advance_current_work_item': 'Advance the current work item',
    'objectDetail.workcaseNextControlStep.form_complete_result_projection': 'Form the complete result projection',
    'objectDetail.workcaseNextControlStep.complete_independent_result_review': 'Complete result review',
    'objectDetail.workcaseNextControlStep.form_closure_proposal': 'Form the closure proposal',
    'objectDetail.workcaseNextControlStep.human_gate_2': 'Wait for Human Gate 2',
    'objectDetail.workcaseNextControlStep.termination_cleanup': 'Complete termination cleanup',
    'objectDetail.workcaseNextControlStep.none': 'No further required control step',
    'objectDetail.workcaseTerminationCleanup': 'Termination Cleanup',
    'objectDetail.workcaseTerminationCleanupBoundary': 'Shows only the frozen starting point, actual retained/discarded/unverified scope, relationship impacts, and quality degradation after a Human-initiated termination. It does not imply the normal result chain or Gate 2 completed.',
    'objectDetail.workcaseTerminationSummary': 'Termination Summary',
    'objectDetail.workcaseTerminationStopped': 'Work has stopped',
    'objectDetail.workcaseSuccessCriteria': 'Success Criteria',
    'objectDetail.workcaseCriteriaCount': '{count} criteria',
    'objectDetail.workcaseCriterionResultSummary': 'Result Summary',
    'objectDetail.workcasePlanAndItems': 'Current Plan and Work Items',
    'objectDetail.workcaseCreationReviews': 'Plan Reviews',
    'objectDetail.workcaseCreationReviewsBoundary': 'Shows the actual method and assurance boundary for the current plan review. A same-AI switched role is not an independent subagent, and a review judgment is not the Human execution decision.',
    'objectDetail.workcaseExecutionAuthorization': 'Execution Authorization Boundary',
    'objectDetail.workcaseExecutionAuthorizationBoundary': 'Defines authorized actions, ceilings and prohibitions, permitted adjustments, verification and rollback, and out-of-bounds handling. Anything outside this boundary returns to Human.',
    'objectDetail.workcaseAuthorizationCount': '{count} items',
    'objectDetail.workcaseAuthorizationConstraints': 'Authorization Constraints',
    'objectDetail.workcaseGateFieldMissingOrMalformed': 'The field is missing or malformed, so a trustworthy authorization boundary cannot be formed.',
    'objectDetail.workcaseExecutionApproval': 'Execution Approval',
    'objectDetail.workcaseExecutionApprovalBoundary': 'This records Human approval to execute the bound plan version only; it does not establish technical results, validation, or closure.',
    'objectDetail.workcaseApprovalSummary': 'Approved Scope and Conditions',
    'objectDetail.workcaseResultAndValidation': 'Result and Validation',
    'objectDetail.workcaseControllerCheck': 'Controller Self-check',
    'objectDetail.workcaseControllerCheckBoundary': 'This records the Controller technical self-check; it is neither a Reviewer result review nor Human acceptance.',
    'objectDetail.workcaseResultReviews': 'Result Reviews',
    'objectDetail.workcaseResultReviewsBoundary': 'Shows the actual method and assurance boundary for the current result review. A same-AI fallback is not presented as an independent subagent; the Controller response is recorded separately.',
    'objectDetail.workcaseReviewScope': 'Review Scope',
    'objectDetail.workcaseReviewConclusion': 'Review Judgment',
    'objectDetail.workcaseClosureProposal': 'Closure Proposal',
    'objectDetail.workcaseClosureProposalBoundary': 'The Controller derives the technical classification and responsibility disposition from the current result and validation. The proposal is not an established terminal state or closure approval. Human only decides whether to stop on that basis; Human neither rewrites the technical facts nor attests to their truth.',
    'objectDetail.workcaseUrls': 'External URLs',
    'objectDetail.workcaseTerminalDisposition': 'Terminal Disposition',
    'objectDetail.workcaseTerminalDispositionBoundary': 'This records how the WorkCase stopped and where responsibility went; a routed relation does not mean the target accepted, started, or completed it.',

    'projectFiles.title': 'Project Files',
    'projectFiles.showHiddenFiles': 'Show hidden files',
    'projectFiles.fileBrowser': 'Project File Browser',
    'projectFiles.preview': 'File Preview',
    'projectFiles.loading': 'Loading',
    'projectFiles.noProjects': 'No governed projects found.',
    'projectFiles.chooseProjectGlobally': 'Choose a governed project from the global selector in the upper-left corner.',
    'projectFiles.noEntries': 'No displayable files in this directory.',
    'projectFiles.chooseFile': 'Select a file on the left to read it here.',
    'projectFiles.binary': 'This is a binary file; the web view only shows path and size.',
    'projectFiles.truncated': 'Content was truncated at the safety limit.',

    'changes.title': 'Workspace Changes',
    'changes.files': 'Changed Files',
    'changes.otherBranches': 'Other Branches',
    'changes.otherBranchesClean': 'No pending changes',
    'changes.otherBranchesChanges': 'file(s) changed',
    'changes.otherBranchesLoading': 'Loading other branches…',
    'changes.diff': 'File Diff',
    'changes.noProjects': 'No governed projects found.',
    'changes.noProject': 'After a project is selected, staged, unstaged, and untracked files will appear here.',
    'changes.chooseFile': 'Select a changed file to inspect its diff here.',
    'changes.loading': 'Loading project changes…',
    'changes.loadingDiff': 'Loading file diff…',
    'changes.noChanges': 'The current project has no pending changes.',
    'changes.diffMode': 'Diff display mode',
    'changes.unifiedDiff': 'Unified',
    'changes.splitDiff': 'Split',
    'changes.before': 'Before',
    'changes.after': 'After',

    'readingPanel.truncated': 'Content truncated',
    'readingPanel.close': 'Close',
    'readingPanel.title': 'Extended Reading',
    'readingPanel.previous': 'Previous visited object',
    'readingPanel.next': 'Next visited object',
    'readingPanel.empty': 'Select an object or document to preview here',
    'readingPanel.loadFailed': 'Failed to load',
    'readingPanel.docLoadFailed': 'Failed to load document',
    'readingPanel.filePreviewUnavailable': 'File preview is unavailable',
    'readingPanel.noEvidence': 'No evidence available',
    'readingPanel.changeDetail': 'Commit Detail',
    'readingPanel.openNewTab': 'New Tab',
    'objectDetail.humanGateTip': 'This WorkCase is pending Human closure confirmation',
    'objectDetail.openReadingPanel': 'Open in reading panel',
    'objectDetail.researchBody.question': 'Research Question',
    'objectDetail.researchBody.inputs': 'Inputs & Boundaries',
    'objectDetail.researchBody.investigation': 'Investigation Phase',
    'objectDetail.researchBody.findings': 'Key Findings',
    'objectDetail.researchBody.unverified': 'Uncertain & Gaps',
    'objectDetail.researchBody.recommendations': 'Recommendations',
    'objectDetail.researchBody.routing': 'Follow-up Routing',
    'objectDetail.researchBody.findingUnits': 'finding units',
    'objectDetail.researchBody.provenance': 'Source',
    'objectDetail.researchBody.noProvenance': 'No provenance anchor',
    'objectDetail.researchBody.retiredNotice': 'This object is retired and is not current evidence input; citing it requires an F4 source re-check with claims tightened accordingly.',
    'objectDetail.researchBody.unknownSection': 'Additional Notes',
    'objectDetail.reportBody': 'Report body',
    'objectDetail.readUnavailable': 'Object content is not displayable',
    'objectDetail.readType': 'Object',
    'objectDetail.readStatus': 'Read status',
    'objectDetail.observedAt': 'Observed at',
    'objectDetail.expectedPath': 'Expected path',
    'objectDetail.readIssue': 'Read issue',

    'changelog.allTypes': 'All types',
    'changelog.allScopes': 'All scopes',
    'changelog.recentCount': 'Latest {count}',
    'changelog.commit': 'Commit',
    'changelog.noMatches': 'No matching commits',
    'changelog.copyContext': 'Copy commit context',
    'changelog.copiedContext': 'Commit context copied',
    'changelog.loadFailed': 'Failed to load commits',
    'changelog.detailFailed': 'Failed to load commit detail',
    'changelog.closeDetails': 'Close details',
    'changelog.openDetails': 'Open details',
    'changelog.commitAt': 'Commit {time}',
    'changelog.breakingChange': 'Breaking change',
    'changelog.pushed': 'Pushed',
    'changelog.unpushed': 'Not pushed',
    'changelog.incoming': 'Sync pending',

    'common.loading': 'Loading...',
    'common.loadFailed': 'Failed to load',
    'common.language': 'Language',
    'common.true': 'Yes',
    'common.false': 'No',
    'common.empty': 'Empty',
    'common.null': '—',
    'common.copyPath': 'Copy path',
    'common.copiedPath': 'Path copied',
    'common.copyObjectPath': 'Copy object path',
    'common.copiedObjectPath': 'Object path copied',
    'common.copyObjectId': 'Copy object reference',
    'common.copiedObjectId': 'Object reference copied',
    'common.copyDocPath': 'Copy document path',
    'common.copiedDocPath': 'Document path copied',
    'common.copyUrl': 'Copy link',
    'common.copiedUrl': 'Link copied',
    'common.copyReference': 'Copy reference',
    'common.copiedReference': 'Reference copied',
    'common.read': 'Read',

    'help.title': 'Help',
    'help.subtitle': 'What LDVH is, how to start, how it runs, what each entry is for, and when the AI stops to ask you.',

    'help.tab.start': 'How to start',
    'help.panel.start.title': 'How to start: pick the project, then set the goal',
    'help.start.lead': 'Two steps. Settle which project you are running, then get the goal in place — everything after that, objects and commits and checks alike, hangs off that project.',
    'help.start.step1.title': 'Step 1: Choose the governed project',
    'help.start.step1.body': 'Pick a governed project from the switcher at the top of the sidebar. The switcher lists the registered projects; once you pick one, every object on the page, every commit record and every check conclusion belongs to it — the governed scope does not span projects.',
    'help.start.step1.hintTitle': 'Not in the switcher?',
    'help.start.step1.hint': 'That means it is not registered for governance yet. In that project’s directory, tell the AI “set this project under LDVH governance”: it puts the project identity and path in front of you first, and writes the registry only after you confirm. The project joins the switcher once that is done.',
    'help.start.step2.title': 'Step 2: Get the goal in place',
    'help.start.step2.body': 'The goal is not something you write in yourself: you say what you want, the AI tightens it into a decidable goal statement, expands it into sub-goals with success conditions, and lays them out for you to confirm one by one. Only after you confirm does anything land — the goal first, the sub-goals after it.',
    'help.start.branchLabel': 'A new project and an existing project start from different places',
    'help.start.new.title': 'New project: say what you want first',
    'help.start.new.body': 'Just tell the AI what you want and what “done” looks like. It tightens that into a decidable goal statement, expands it into sub-goals with success conditions, and lays them out for you to confirm one by one — nothing lands before that.',
    'help.start.old.title': 'Existing project: absorb what is already there first',
    'help.start.old.body': 'It does not know your project yet. Have it absorb the existing documents into a research object first, which yields confirmed, unconfirmed and gap evidence; then tighten the goal and expand the sub-goals on top of that. Skip this and the sub-goals get written from its own guesswork.',
    'help.start.nextTitle': 'Once the goal is in place',
    'help.start.next': 'With the goal set, the main line begins — ideas, research, decisions and work orders all hang from it. For what the nine object types are, switch to “What things exist”; for how work moves forward, “How work moves forward”; for when it stops and asks you, “When it needs you”.',

    'help.overview.title': 'What this system solves',
    'help.overview.lead': 'AI and Human each have half of the weaknesses. On their own they are manageable; together they magnify each other. Every mechanism in LDVH answers one of those gaps.',
    'help.overview.symptomLabel': 'Typical failure',
    'help.overview.answerLabel': 'What the mechanism does',
    'help.overview.shortcomingLabel': 'Shortcoming',
    'help.overview.ai.title': 'The AI is not dependable',
    'help.overview.ai.symptom': 'AI output is probabilistic reasoning: missing context gets guessed at, overloaded context dilutes constraints, and conflicting context may not even be noticed. The same question can get two answers, and nothing carries across sessions.',
    'help.overview.ai.answer': 'So rules need a source, facts need an anchor, and actions need checking: the specification source sets the boundaries, the fact source supplies the grounds, and self-check, peer review and mechanical verification cover it three times over.',
    'help.overview.human.title': 'Human cannot absorb it, and cannot keep it',
    'help.overview.human.symptom': 'Long-term direction blurs as the project grows, ideas evaporate within minutes, parallel work cannot be picked back up, and decisions made and pitfalls hit scatter once the conversation closes.',
    'help.overview.human.answer': 'So every kind of thing gets an object: goal, idea, research, decision, work case, lesson and friction each have a carrier you can open, read, and pick up from later.',
    'help.overview.friction.title': 'The two sides magnify each other\u2019s errors',
    'help.overview.friction.symptom': 'Human cannot check the AI\u2019s confident tone, and the AI cannot read a vague intention. It will not stop at “I did not get that”; it fills the gap in first, then executes hard on its own reading.',
    'help.overview.friction.answer': 'So what is yours to decide must reach you. Your decision right cannot be replaced by the AI, the specifications, the facts, or any tool — and when the grounds are thin it stops instead of answering anyway.',

    'help.spine.title': 'The spine of working with the AI',
    'help.spine.lead': 'Not a pipeline you have to follow, but every stage has a defined product and a home. Project content takes the shapes below.',
    'help.spine.goal.title': 'Goal',
    'help.spine.goal.body': 'What the project is meant to achieve, frozen into an anchor you can point back to; the goal is then broken down into sub-goals that each carry a decidable criterion.',
    'help.spine.idea.title': 'Idea',
    'help.spine.idea.body': 'Anything worth carrying across actions — an idea, a direction, a question that has not converged — is born as a Spark; the Spark is also the main thread of the direction.',
    'help.spine.research.title': 'Research',
    'help.spine.research.body': 'Gather evidence around what is not yet known, until no new confirming understanding appears; findings are organised as independent units, each carrying a traceability anchor.',
    'help.spine.decision.title': 'Decision',
    'help.spine.decision.body': 'Fix one trade-off as a record you can look back on: what was chosen, on what grounds, and at what cost.',
    'help.spine.execution.title': 'Execution',
    'help.spine.execution.body': 'Only a work case you approved moves; it carries goal, success criteria, authorization boundary and verification method, and reaches a terminal state only after review and closure judgment.',
    'help.spine.learning.title': 'Accumulation',
    'help.spine.learning.body': 'Pitfalls become lessons, systemic blockers become entries in the friction ledger, settled directions become norms, and converged process conclusions become dev logs — all reusable the next time round.',
    'help.spine.recallTitle': 'Before acting it also runs one dual-source recall:',
    'help.spine.recall': 'It fetches back from the specification source and the fact source what currently applies, what the grounds are, and what has to stop for you — then turns what it recalled into actual changes. This step leaves no object of its own, but it decides how it acts next.',

    'help.tab.overview': 'What this is',
    'help.tab.objects': 'What things exist',
    'help.tab.systems': 'How work moves forward',
    'help.tab.gates': 'When it needs you',
    'help.tab.entries': 'Where to look',
    'help.tab.trust': 'How to judge it',

    'help.panel.overview.title': 'What this is: how LDVH is put together and how it runs',
    'help.panel.objects.title': 'What things exist: the nine kinds of fact objects',
    'help.panel.systems.title': 'How work moves forward: the seven business systems',
    'help.panel.gates.title': 'When it needs you: the five interaction gates and the hard stops',
    'help.panel.entries.title': 'Where to look: the navigation entries that are not objects',
    'help.panel.trust.title': 'How to judge it: the three layers of claims and the signals to push back',

    'help.objects.lead': 'Every fact object has a defined boundary and lifecycle. Below: what each one is, when it appears, and what to read there.',
    'help.tabLabel': 'Help sections',
    'help.objects.whatLabel': 'What it is',
    'help.objects.whenLabel': 'When it appears',
    'help.objects.lookLabel': 'What to read there',
    'help.gates.triggerLabel': 'When it comes to you',
    'help.gates.respondLabel': 'What you have to answer',
    'help.objects.subgoal.what': 'The anchor one level below the goal: a sub-goal with a stable identity, an optional display order, and one decidable criterion.',
    'help.objects.subgoal.when': 'When the project goal is broken down to the point where “reaching here counts”.',
    'help.objects.subgoal.look': 'Its criterion, the work under it, and which part of the overall goal it serves.',
    'help.objects.spark.what': 'The birthplace of anything worth carrying across actions, and the entry to the main thread of a direction.',
    'help.objects.spark.when': 'When an idea, a direction, or a question that has not converged shows up.',
    'help.objects.spark.look': 'Its current understanding, what is still open, and how far the evolution has gone.',
    'help.objects.workcase.what': 'The single carrier of an approved work case and its result audit, with status and lifecycle, authorization semantics and execution records.',
    'help.objects.workcase.when': 'When a direction is broken down into actions that can be executed and accepted.',
    'help.objects.workcase.look': 'Current situation, goal and success criteria, current plan and work items, review and approval, result and verification.',
    'help.objects.research.what': 'A deep research product about an external subject, investigation and analysis in one; each finding unit stands on its own and carries a traceability anchor.',
    'help.objects.research.when': 'When evidence is missing, or a conclusion has to land on specific sources.',
    'help.objects.research.look': 'Each finding unit: its claim, the observed facts, the value judgment for the project, and the traceability anchor.',
    'help.objects.adr.what': 'A look-back record of a settled decision: what was chosen, the grounds, the cost, the reach.',
    'help.objects.adr.when': 'When a trade-off is settled and will be cited over and over afterwards.',
    'help.objects.adr.look': 'The decision itself, the alternatives and the reasoning at the time, plus the goals and work cases it relates to.',
    'help.objects.pitfall.what': 'A look-back record of a verified lesson: the failure mechanism and the way to avoid it.',
    'help.objects.pitfall.when': 'When the same pitfall shows up a second time, or a lesson has been verified as usable.',
    'help.objects.pitfall.look': 'The failure mechanism, its trigger conditions, the workaround, and which work has already reused it.',
    'help.objects.friction.what': 'The improvement ledger of systemic blockers still to be fixed; evidence and measurement accumulate per ledger state.',
    'help.objects.friction.when': 'When you hit something structural that trips you up every single time.',
    'help.objects.friction.look': 'What it blocks, how many times it has already been unblocked, and where it stands in the ledger.',
    'help.objects.norm.what': 'Systematic direction norms of the governed project, where constraint and measurement live together.',
    'help.objects.norm.when': 'When a practice has become stable enough to bind the whole project.',
    'help.objects.norm.look': 'What the norm says, which directions it constrains, and whether it carries an anti-duplication rule.',
    'help.objects.devlog.what': 'An entry for a converged piece of process work: what was done, what was measured, the conclusion and its boundary of validity.',
    'help.objects.devlog.when': 'When a stretch of work concludes and the conclusion is worth citing next time.',
    'help.objects.devlog.look': 'What was done that time, the measurements, and the range within which the conclusion holds.',

    'help.gates.lead': 'A few kinds of thing are never decided by the AI for you. Each has a defined trigger and a response contract addressed to you.',
    'help.gates.inquiry.title': 'Structured inquiry',
    'help.gates.inquiry.trigger': 'When the AI needs you to judge, choose or supply information, the question has been organised into options with their impact and risk.',
    'help.gates.inquiry.respond': 'Your reply has to settle three things: the object, the scope, and the conclusion on how to handle it.',
    'help.gates.plan.title': 'Plan review',
    'help.gates.plan.trigger': 'When the AI hands over a candidate plan for you to review or approve.',
    'help.gates.plan.respond': 'It shows the grounds, scope, steps and risk of the plan, and when you approve execution it attaches the pre-execution independent review conclusion. You approve, reject, or ask for changes.',
    'help.gates.authorization.title': 'Authorization',
    'help.gates.authorization.trigger': 'When the AI needs your authorization to perform or continue a controlled operation.',
    'help.gates.authorization.respond': 'It shows the authorized object, scope and boundary. You grant, refuse or restrict; actions beyond the authorization are mechanically rejected.',
    'help.gates.handover.title': 'Acceptance handover',
    'help.gates.handover.trigger': 'When the AI has finished the current work and hands over the result for acceptance.',
    'help.gates.handover.respond': 'It shows the current state, the grounds for judgment, what is confirmed and what is not, the residual risks, and what still awaits your decision. You accept, send back, or ask for more.',
    'help.gates.registration.title': 'Registration management',
    'help.gates.registration.trigger': 'When you start or cancel a project registration in the Web.',
    'help.gates.registration.respond': 'It shows the registration object, the project path and the overall readiness, with each unready item given its own reason: repairable ones get a repair entry, unrepairable ones only get the reason.',

    'help.gates.stop.title': 'In these situations it stops instead of continuing',
    'help.gates.stop.1': 'Something that is yours to decide has not received a reply from you whose scope is clear',
    'help.gates.stop.2': 'The applicability, effect or authority relation of a rule cannot be established',
    'help.gates.stop.3': 'An already applicable mandatory requirement, controlled entry, verification or write-back cannot be satisfied',
    'help.gates.stop.4': 'The grounds are insufficient, yet it is about to declare the state established or the work complete',
    'help.gates.stop.5': 'Continuing would cross a boundary of specification, fact or authorization',
    'help.gates.stop.note': 'After stopping, it has to make the triggering reason good first. The same trigger firing again is not something it resumes on its own — it comes back to you.',

    'help.entries.lead': 'The entries in the left navigation that do not point at a fact object — what they are and when to look.',
    'help.entries.whatLabel': 'What it is',
    'help.entries.goLabel': 'Go there',
    'help.entries.focus.title': 'Focus',
    'help.entries.focus.body': 'The whole project on one screen: the goal section, pending decisions, recent activity, recent relations, and Spark health. Open this first when you come back to the project, or when you do not know where to start.',
    'help.entries.directory.title': 'Directory',
    'help.entries.directory.body': 'The project file tree, reading the files of the specification source and the fact source directly. Use it when you want to see how a rule or an object is actually written in the source.',
    'help.entries.changes.title': 'Changes',
    'help.entries.changes.body': 'What has not been committed in the work tree yet. Use it to check what the AI changed this round and which files it touched.',
    'help.entries.commits.title': 'Commit records',
    'help.entries.commits.body': 'Committed history, each entry with its context readable. Use it to trace which commit a conclusion came from.',
    'help.entries.diagnostics.title': 'Diagnostics',
    'help.entries.diagnostics.body': 'Where the mechanisms themselves fail in actual use and what shape that failure takes; read-only. This is where to look for “why does it keep blocking me” or “which tool keeps breaking”.',
    'help.entries.federation.title': 'All projects',
    'help.entries.federation.body': 'A cross-project aggregate view covering every governed project in the registry. Look here when you are watching several projects at once.',

    'help.trust.lead': 'When it says “done”, that sentence is not evidence by itself. Check it against the three things below.',

    'help.systems.lead': 'The seven business systems each carry one stretch of the business process, and their results land on objects. For each one: what it is in charge of, how you use it, where its result lands, and what it does not guarantee.',
    'help.systems.dutyLabel': 'What it is in charge of',
    'help.systems.usageLabel': 'How you use it',
    'help.systems.landingLabel': 'Where it lands',
    'help.systems.limitLabel': 'What it does not guarantee',

    'help.systems.goalPlanning.title': 'Goal planning',
    'help.systems.goalPlanning.duty': 'Turns your long-term intent into a project goal you can point back to and check, then breaks it down into sub-goals whose completion can be decided.',
    'help.systems.goalPlanning.usage': 'You say what you are trying to achieve; it freezes that into an anchor you can point back to. Every sub-goal carries “done means this”, so any later round can check against it instead of re-interpreting the goal from memory.',
    'help.systems.goalPlanning.limit': 'A goal existing, or being active, does not prove the goal was set well or the sub-goals were broken down enough.',

    'help.systems.sparkRecord.title': 'Spark recording',
    'help.systems.sparkRecord.duty': 'Takes in the ideas, questions and open issues from a conversation that are worth carrying across actions, and gives them a birthplace and an entry point on the main line.',
    'help.systems.sparkRecord.usage': 'When another approach surfaces halfway through a discussion, or a question keeps coming back without an answer, get it written down while it is still clear. It then has a place to be found in a later session, instead of being discovered all over again.',
    'help.systems.sparkRecord.limit': 'Being written down does not mean the idea deserves to be pushed forward, nor that it has been understood well enough.',

    'help.systems.workOrder.title': 'Work order execution',
    'help.systems.workOrder.duty': 'Executes work orders that have already been approved, and carries the whole work-package lifecycle: approved → executed → reviewed → closed → handed back.',
    'help.systems.workOrder.usage': 'It only moves once you approve it. There is a gate on each side of the work — one before it starts, one where you accept the result and take it back. If it is interrupted, it resumes from the current state rather than starting over.',
    'help.systems.workOrder.limit': 'It does not widen its own authorization; a sub-task finishing is not the whole thing finishing, and execution done is not review passed.',

    'help.systems.researchAbsorb.title': 'Research absorption',
    'help.systems.researchAbsorb.duty': 'Gathers evidence on a question you do not yet know, until it stops producing new confirmations, and returns it as three kinds: confirmed, unconfirmed, and gaps.',
    'help.systems.researchAbsorb.usage': 'Hand it the part you do not understand; it goes looking for evidence, and every claim carries an anchor back to its source. It stops when the search stops turning up new understanding, instead of forcing an answer.',
    'help.systems.researchAbsorb.limit': 'Research yields facts, not authorization and not completion; a conclusion still has to pass admission before it enters the fact source.',

    'help.systems.dualRecall.title': 'Dual-source recall',
    'help.systems.dualRecall.duty': 'Before every action, recalls the currently relevant candidates from the specification source and the fact source, so it knows what to obey, what to rely on, and what has to stop and ask you.',
    'help.systems.dualRecall.usage': 'You never call it by hand — it cuts across the other six systems and runs before every action. Recall only delivers candidates; whether one of them applies is judged after the recall, not during it.',
    'help.systems.dualRecall.landing': 'It leaves no object of its own — what it decides is how everything else acts next.',
    'help.systems.dualRecall.limit': 'A hit is not the same as applicability; having read the rules and completed the pre-check does not mean the action is done.',

    'help.systems.experience.title': 'Experience accumulation',
    'help.systems.experience.duty': 'Keeps and retrieves what the project has learned — what is worth keeping, where it should settle, and when to look back and ask whether it still holds.',
    'help.systems.experience.usage': 'A pitfall you fell into, or a failure mechanism you have verified, is written down so the next time can reuse it and steer around it. A one-off coincidence is not taken in as experience. Directions and open questions still go to Sparks.',
    'help.systems.experience.limit': 'Keeping it does not turn it into a rule or an authorization on its own, and a reflection does not take effect by itself — it has to land in a specification or a fact, and be decided by you.',

    'help.systems.friction.title': 'Friction settlement',
    'help.systems.friction.duty': 'Books the systemic obstacles that should be fixed but are not yet, accumulating the evidence and the measures against each account.',
    'help.systems.friction.usage': 'It finds and books them on its own — the same obstacle coming back once more adds another piece of evidence. Once fixed, it has to leave a traceable antidote behind; when it genuinely cannot be fixed, it leaves a reviewable record of acceptance instead.',
    'help.systems.friction.limit': 'Booking it is not the same as approving the work — whether and when to fix it is your call, and the work itself then goes to work order execution.',
    'help.trust.layers.title': 'Its claims come in three layers',
    'help.trust.layers.confirmed.title': 'Confirmed',
    'help.trust.layers.confirmed.hint': 'Can be relied on',
    'help.trust.layers.confirmed.body': 'There is a readable ground: a write-back read, a passed mechanical check, the record of a peer review, and the evidence of your approval or closure.',
    'help.trust.layers.unconfirmed.title': 'Not confirmed',
    'help.trust.layers.unconfirmed.hint': 'Not a conclusion',
    'help.trust.layers.unconfirmed.body': 'No ground yet, or the ground only reaches part of the way.',
    'help.trust.layers.residual.title': 'Residual risk',
    'help.trust.layers.residual.hint': 'Listed on its own',
    'help.trust.layers.residual.body': 'Things that are known but not eliminated. It lists them separately instead of folding them into the word “done”.',
    'help.trust.notproof.title': 'None of these proves on its own that it finished',
    'help.trust.notproof.1': 'The file or object exists',
    'help.trust.notproof.2': 'The tool call succeeded',
    'help.trust.notproof.3': 'The tests passed',
    'help.trust.notproof.4': 'The page opens and the content looks right',
    'help.trust.notproof.5': 'The commit was created',
    'help.trust.notproof.6': 'The object count matches',
    'help.trust.notproof.7': 'You approved it',
    'help.trust.pushback.title': 'Send it back in these cases',
    'help.trust.pushback.1': 'It declared completion without giving a readable ground',
    'help.trust.pushback.2': 'It mixed “confirmed” and “not confirmed” into one sentence',
    'help.trust.pushback.3': 'There is residual risk and it did not mention it',
    'help.trust.pushback.4': 'You cannot read back the ground it cites',

    'help.disclaimer': 'This page is a usage guide for you, explaining how the system works; it is not a source of rules — the rules live in the specification source and the facts in the fact source. Its content follows the evolution of the specifications.',

  },
} as const;

export type Locale = keyof typeof UI_LOCALES;
export type LocaleKey = keyof typeof UI_LOCALES.zh;
