export const META_KEYS = [
  'id',
  'object_uid',
  'object_id',
  'type',
  'fact_type_key',
  'status',
  'created',
  'created_at',
  'updated',
  // 03 §6.1：不保留公共 updated_at，变更时间由 change_log 条目的 at 承担。
  'title',
  'title_en',
  'title_zh',
  'path',
  'object_ref',
  'canonical_path',
  'absolute_path',
  'carrier',
  'content_fingerprint',
  'coverage_status',
  'read_status',
  'field_issues',
  'unparsed_structures',
  'observed_at',
  'read_issues',
  'fact_read_failure',
  'factAssociations',
  // 03 §7.2 关联引用型 / 20 §8：factRefs 是 refs 的精确读取投影，由
  // 「关联对象」阅读节点消费（与 relations 节点并列、语义互不并入）；
  // 列入 META_KEYS 以免作为未映射字段落入通用字段区重复呈现。
  'factRefs',
  // 03 §7.2 / 21 §13：factRefSources 是实时反查得到的普通引用来源，
  // 仅用于关闭后召回可见性，不是对象自身字段或生命周期关系。
  'factRefSources',
  'refs',
];

export const COMMON_AUXILIARY_META_KEYS = ['priority'];
export const AUXILIARY_META_KEYS_BY_TYPE: Record<string, string[]> = {
  // priority 已随 v5 移除。
  //
  // `serves` 曾登记在本表的 spark 行（20 §8：子目标锚点在元信息行呈现）。
  // 2026-11-01（Human 定案）随「serves 不再参与 Web 呈现」一并出列：本表是
  // **呈现登记**——列在这里 = 以辅助元信息形态呈现、并同时从兜底字段区排除；
  // 撤掉呈现就不该继续留着它，否则「不呈现」这个决定没有落点。
  //
  // 出列后 `serves` 落回 `getObjectDetailContentEntries` 的兜底字段区。它不会
  // 因此冒出来：spark 等类型的详情都走专属阅读布局，均不消费 `extraEntries`。
  // **字段仍在对象上**，
  // 只是没有任何面板渲染它——这正是本次要的形态。
  spark: [],
  pitfall: [],
  // 26 §8：friction 无元信息行辅助字段——phenomenon/attribution/occurrence 等
  // 由身份头部标签区与阅读布局消费。impact（轻/中/重影响评级）已于 2026-11-02
  // 随分级制度撤销（26 §8 字段表），serves 早于 2026-10 删除（§12 四个消费点无一
  // 使用，§18 第 1 条禁装饰字段）。
  friction: [],
  // 28 §8：`parent_goal` **不再呈现**（Human 定案 2026-11-02，附截图圈出身份头
  // 底部的「服务目标 project-goal」——「圈出来的不用显示」）。
  //
  // 它此前住在子目标详情面顶部的锚点块里，本轮先被移到身份头辅助元信息行，
  // 现在整行撤除。理由与 `serves` 2026-11-01 出列同源：读者打开一条子目标，
  // 要回答的是「这条怎么算达成」；「它属于哪个目标」在单例项目里恒为
  // `project-goal` 一个值，四次出现四次相同，不携带可分辨的信息（28 §18 第 1 条
  // 禁装饰字段）。归属关系本身没有丢——它由 `parent_goal` 字段与 28 §8.1 的
  // 反查派生承载，目标区的子目标列表就是它的可见形态。
  //
  // 撤呈现就必须同时从本表出列：留在表里等于「登记为已呈现」，而它已不呈现。
  // 出列后它会落回 `getObjectDetailContentEntries` 的兜底字段区——但不会因此
  // 冒出来，因为 subgoal 详情走专属阅读布局 `SubGoalReadingLayout`，它不消费
  // `extraEntries`（与 `serves` 出列时的处境完全相同）。
  subgoal: [],
};

const FIELD_ORDER_BY_TYPE: Record<string, string[]> = {
  // v5 各类型的 frontmatter 闭集 + 正文承载。此表只作 ContentField
  // v5 ADR（22 号规范）：阅读布局按字段契约序消费（decision → scope →
  // trigger_signal → 终态 retirement_reason/retired_at/relations），正文
  // report_body 由布局按 H2 五段（决策背景/决定/备选与理由/后果/适用范围
  // +条件证据）分节呈现——此处只做 ContentField 兜底排序。
  adr: [
    'decision', 'scope', 'trigger_signal', 'report_body',
    'retirement_reason', 'retired_at', 'change_log', 'urls', 'relations',
  ],
  // v5 Pitfall（23 号规范）：阅读布局按字段契约序消费（scope →
  // trigger_signal → 终态 disposition），正文 report_body 由布局按 H2 七段
  // （症状/触发条件/根因/解决/规避/验证/影响与适用范围+条件证据）分节呈现
  // ——此处只做 ContentField 兜底排序。
  pitfall: [
    'scope', 'trigger_signal', 'report_body',
    'disposition', 'change_log', 'urls',
  ],
  // v5 Friction（26 号规范）：阅读布局按字段契约序消费（phenomenon →
  // attribution → occurrence → 终态 relations），正文 report_body 由
  // 布局按 H2 三段（现象/入账依据+条件处置）分节呈现——此处只做 ContentField
  // 兜底排序。（impact 已于 2026-11-02 随分级制度撤销，26 §8。）
  friction: [
    'phenomenon', 'attribution', 'occurrence', 'disposition', 'report_body',
    'change_log', 'relations',
  ],
  // v5 Norm（27 号规范）：阅读布局按字段契约序消费（direction_key → 终态
  // retirement_reason/retired_at），正文 report_body 由布局按 H2 四段骨架
  //（方向定位与适用范围／核心规则体系／约束与反模式／验证与遵从性检查）
  // 分节呈现——此处只做 ContentField 兜底排序。norm 不使用 relations（§9）。
  norm: [
    'direction_key', 'report_body',
    'retirement_reason', 'retired_at', 'change_log',
  ],
  // v5 SubGoal（28 号规范）：阅读布局按字段契约序消费（order → parent_goal →
  // criterion + criterion_kind → alignment），正文 report_body 由布局按 H2
  // 两段（达成条件／对齐说明）分节呈现——此处只做 ContentField 兜底排序。
  // subgoal 不使用 relations/refs（§11：层级由 parent_goal 与 serves 反查派生）。
  // `order` 排在首位只因为它是读者扫读时最先要的那一项，它**不**承担身份（28 §7）。
  subgoal: [
    'order', 'parent_goal', 'criterion', 'criterion_kind', 'alignment',
    'report_body', 'disposition', 'change_log',
  ],
  // v5 DevLog（29 号规范）：阅读布局按**阅读次序**消费（summary 结论 → 去向 →
  // 背景/做法/实测 → relations → change_log），正文 report_body 由布局按 H2 分节
  // 呈现——此处只做 ContentField 兜底排序。
  // `occurred_at` / `created_at` **曾并列入表**（理由：29 §10.4 要求两个时间分开
  // 呈现）。2026-11-02 Human 定案「圈出来的部分不用显示」撤除详情页时间轴节点后，
  // 两字段的语义分工不变（§10.4 仍要求不得用 `created_at` 冒充发生时间），但**不再
  // 在详情页重复呈现**：2026-11-02 二次定案把列表卡头的 `occurred_at` 徽章也撤了
  // （29 §10.4 同步订正），`occurred_at` 现由**按 `occurred_at` 排序的条目清单**
  // 承担回查职责（29 §12.1「时间线回查」），`created_at` 走 change_log 首条与底部
  // YAML 原文。故二者**不再列入本表**——留着会让人以为详情页仍在显式渲染它们
  // （本表是兜底字段区的排序，DevLogReadingLayout 不消费它，但表的成员本身就是一份
  // 「该字段有呈现面」的声明）。
  // `refs` 于 2026-11-02 经 Human 决定并入 02 §8.2 采用面（29 §8/§11/§12.3bis）：
  // 内容关联由**列表卡关联区**承载（与 Spark 卡同一承载方式），详情页不另设一行——
  // 同一关联在两处各画一遍没有新信息。
  devlog: [
    'summary', 'disposition', 'report_body',
    'change_log', 'relations',
  ],
  // v5 Spark（20 号规范）：阅读布局按字段契约序消费（question → scope_boundary
  // → intent → summary → 演变 → 终态 disposition），正文 report_body 由布局按
  // H2 分节呈现——此处只做 ContentField 兜底排序。
  spark: [
    'question', 'scope_boundary', 'intent', 'summary', 'evolution', 'report_body',
    'change_log', 'relations', 'disposition',
  ],
  // v5 Research（24 号薄索引）：正文 report_body 由阅读布局按 H2 分节呈现，
  // 其余为 frontmatter 概览/三态/启发字段的兜底排序。
  research: [
    'research_question', 'research_purpose', 'stopping_reason',
    'confirmed_statements', 'uncertain', 'gaps', 'implications', 'clarification_log',
    'report_body', 'change_log', 'urls', 'disposition_summary',
  ],
};

export type RelatedContentEntry = [string, unknown[]];

/** Current governed project identity from the read metadata, shared by association readers. */
export function getCurrentProjectId(obj: Record<string, unknown>): string | undefined {
  const ref = obj.object_ref;
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return undefined;
  const projectId = (ref as Record<string, unknown>).governed_project_id;
  return typeof projectId === 'string' ? projectId : undefined;
}

function isRelatedContentField(fieldKey: string) {
  return fieldKey === 'urls';
}

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
}

export function sortRelatedContentEntries(entries: RelatedContentEntry[]) {
  return [...entries].sort((a, b) => a[0].localeCompare(b[0], 'en'));
}

export function splitRelatedContentEntries(entries: Array<[string, unknown]>) {
  const primaryEntries: Array<[string, unknown]> = [];
  const relatedEntries: RelatedContentEntry[] = [];

  entries.forEach((entry) => {
    if (isRelatedContentField(entry[0])) {
      if (Array.isArray(entry[1]) && hasContent(entry[1])) {
        relatedEntries.push([entry[0], entry[1]]);
      }
    } else {
      primaryEntries.push(entry);
    }
  });

  return {
    primaryEntries,
    relatedEntries: sortRelatedContentEntries(relatedEntries),
  };
}

export function getObjectDetailContentEntries(obj: Record<string, unknown>, objType: string) {
  const auxiliaryMetaKeys = Array.from(new Set([...(AUXILIARY_META_KEYS_BY_TYPE[objType] || []), ...COMMON_AUXILIARY_META_KEYS]));
  const contentEntries = Object.entries(obj).filter(
    ([key]) => !META_KEYS.includes(key) && !auxiliaryMetaKeys.includes(key),
  );

  const fieldOrder = FIELD_ORDER_BY_TYPE[objType] || [];
  if (fieldOrder.length > 0) {
    contentEntries.sort((a, b) => {
      const aIdx = fieldOrder.indexOf(a[0]);
      const bIdx = fieldOrder.indexOf(b[0]);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return 0;
    });
  }

  return contentEntries;
}
