import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDateTime } from '@/utils/dateFormat';
import { useI18n } from '@/i18n/context';
import type { StructuredTextIssue } from '@/shared/workcaseTextStructure';
import { getFieldLabel, getFieldValueLabel, getObjectStatusLocale } from '@/i18n/locales';
import ServingSparkProgressBar from '@/components/ServingSparkProgressBar';
import { normalizeSignature } from '../../../shared/signature';
import { FactAssociationsSection } from '@/pages/object-detail/FactAssociationsSection';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { sortRelatedContentEntries, type RelatedContentEntry } from '@/pages/object-detail/model';
import {
  fieldIssue,
  type FieldPresentationIssue,
} from '@/pages/object-detail/fieldIssues';
import {
  ReadingNodeSection,
  RelatedContentSection,
  ResearchTextNodeContent,
  getReadingNodeNextState,
  type ReadingNodeState,
} from '@/pages/ObjectDetail';
import { LDVH_SUCCESS_CHIP_HUE_CLASS, LDVH_WARN_SURFACE_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';

/**
 * `scope` / `summary` 的**书写结构**问题就地显示（`21 §8`）。
 *
 * 与 `FieldProblem` 分开的原因：后者的 `reason` 闭集是 `missing` / `type_mismatch` /
 * `identity_mismatch`（字段级读取问题，来自 `field_issues`），而本组件呈现的是
 * **书写形态**问题（来自 `structured_text_issues`，规则见 `shared/workcaseTextStructure`）。
 * 两类问题来源不同、文案不同，合并会掩盖其中一类。
 *
 * 为什么必须显示：写入口**早已**算出这些违规，但那结果只留在写入路径上——读者看到的是
 * 「这个字段读不了」，而不是「它不合规、原因是 X」（Human 2026-09-24：「当前我看到的
 * 都要规范化，可检查，确保之后都要保持一样」）。
 */
export function StructuredTextProblems({
  issues,
  field,
}: {
  issues?: StructuredTextIssue[];
  field: 'scope' | 'summary';
}) {
  const { t } = useI18n();
  const mine = Array.isArray(issues) ? issues.filter((i) => i.field === field) : [];
  if (mine.length === 0) return null;
  return (
    <div className={`ldvh-meta rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-3 py-2 ${LDVH_WARN_TITLE_CLASS}`}>
      <div className="font-medium">
        {t('objectDetail.structuredTextIssue')}
        <span className="ml-1 font-normal opacity-75">{t('objectDetail.structuredTextIssueHint')}</span>
      </div>
      <ul className="mt-1 grid min-w-0 gap-0.5">
        {mine.map((issue, index) => (
          <li key={`${issue.kind}-${index}`} className="min-w-0 break-words">
            · {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldProblem({ issue }: { issue?: FieldPresentationIssue }) {
  const { t } = useI18n();
  if (!issue) return null;
  const text = issue.reason === 'missing'
    ? t('objectDetail.fieldMissing')
    : issue.reason === 'type_mismatch'
      ? t('objectDetail.fieldTypeMismatch')
      : t('objectDetail.fieldIdentityMismatch');
  return <p className={`ldvh-meta rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-3 py-2 ${LDVH_WARN_TITLE_CLASS}`}>{text}</p>;
}

type ChangeLogEntry = {
  key: string;
  at: string;
  summary: string;
  productName?: string;
  modelName?: string;
};

/**
 * `change_log` is a contracted field for every current fact type. Keep its
 * reading node shared so a detail layout cannot consume it in the API and then
 * accidentally omit it from the Human reading surface.
 */
export function ChangeLogReadingNode({
  value,
  issue,
  locale,
}: {
  value: unknown;
  issue?: FieldPresentationIssue;
  locale: string;
}) {
  const [state, setState] = useState<ReadingNodeState>('collapsed');
  const entries = parseChangeLogEntries(value);
  if (entries.length === 0 && !issue) return null;

  return (
    <ReadingNodeSection
      title={getFieldLabel('change_log', locale)}
      state={state}
      locale={locale}
      headerMeta={entries.length > 0 ? <span className="ldvh-meta-muted">{entries.length}</span> : undefined}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? <FieldProblem issue={issue} /> : (
        <div className="divide-y divide-ldvh-border/60">
          {entries.map((entry) => (
            <div key={entry.key} className="py-2.5 first:pt-0 last:pb-0">
              <div className="ldvh-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium text-ldvh-text-primary/80">
                <span aria-hidden="true" className="h-1 w-1 shrink-0 self-center rounded-full bg-ldvh-text-primary/55" />
                <span className="tabular-nums">
                  {formatDateTime(entry.at)}
                </span>
                {entry.modelName && <><span aria-hidden="true">·</span><span>{entry.modelName}</span></>}
                {entry.productName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{entry.productName}</span>
                  </>
                )}
              </div>
              <p className="mt-1 ldvh-meta text-ldvh-text-secondary/80">{entry.summary}</p>
            </div>
          ))}
        </div>
      )}
    </ReadingNodeSection>
  );
}

function parseChangeLogEntries(value: unknown): ChangeLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const at = typeof record.at === 'string' ? record.at.trim() : '';
    const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
    if (!at || !summary) return [];
    const signature = record.signature;
    const signatureRecord = signature && typeof signature === 'object' && !Array.isArray(signature)
      ? signature as Record<string, unknown>
      : null;
    // v5 扁平 provider/model 流水与 v4 嵌套 signature 形态均可读——
    // 扩展后的 normalizeSignature 让 provider 逐字落位 productName（供应商 id
    // 不美化），v4 product_name 保持既有归一；此处直接渲染，无二次归一。
    const normalizedSignature = normalizeSignature({
      productName: signatureRecord?.product_name,
      modelName: signatureRecord?.model_name,
      provider: record.provider,
      model: record.model,
    });
    const productName = normalizedSignature.productName || undefined;
    const modelName = normalizedSignature.modelName || undefined;
    return [{
      key: `${index}-${at}`,
      at,
      summary,
      productName,
      modelName,
    }];
  }).reverse();
}

/** 22 号规范 §8 的正文固定 H2（「证据」条件出现——urls 非空时必在）。 */
const ADR_BODY_SECTION_ORDER = ['决策背景', '决定', '备选与理由', '后果', '适用范围', '证据'] as const;

type AdrBodySection = { title: string; body: string };

/** 正文按固定 H2 分节（前端解析，跟随 spark 的 parseSparkBodySections 先例）。 */
function parseAdrBodySections(body: string): AdrBodySection[] {
  const lines = body.split('\n');
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }
  return sections
    .map((section) => ({ title: section.title, body: section.body.join('\n').trim() }))
    .filter((section) => section.body.length > 0 && section.title.length > 0)
    .sort((a, b) => {
      const aIndex = ADR_BODY_SECTION_ORDER.indexOf(a.title as (typeof ADR_BODY_SECTION_ORDER)[number]);
      const bIndex = ADR_BODY_SECTION_ORDER.indexOf(b.title as (typeof ADR_BODY_SECTION_ORDER)[number]);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
}

/** v5 ADR 阅读布局（22 §8）：正文固定 H2 五段（+条件证据）分节优先、
 * frontmatter 字段兜底，节序跟随字段契约（决策背景 → 决定 → 备选与理由
 * → 后果 → 适用范围 → 证据 → trigger_signal → 终态去向）。 */
export function AdrReadingLayout({
  obj,
  relatedEntries,
  locale,
}: {
  obj: Record<string, unknown>;
  relatedEntries: RelatedContentEntry[];
  locale: string;
}) {
  const bodySections = parseAdrBodySections(typeof obj.report_body === 'string' ? obj.report_body : '');
  const sectionOf = (title: string) => bodySections.find((section) => section.title === title);
  // 22 §8：正文是 decision/scope 的自然语言承载——正文节优先，缺失时以
  // frontmatter 字段兜底（同 spark 的先例）。
  const proseFrom = (sectionTitle: string, fieldValue: unknown): string => {
    const body = sectionOf(sectionTitle)?.body;
    if (body) return body;
    return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue.trim() : '';
  };

  const context = sectionOf('决策背景')?.body ?? '';
  const decision = proseFrom('决定', obj.decision);
  const alternatives = sectionOf('备选与理由')?.body ?? '';
  const consequences = sectionOf('后果')?.body ?? '';
  const scopeProse = proseFrom('适用范围', obj.scope);
  const evidence = sectionOf('证据')?.body ?? '';
  const triggerSignal = typeof obj.trigger_signal === 'string' && obj.trigger_signal.trim() ? obj.trigger_signal.trim() : '';

  return (
    <div className="mb-6 flex flex-col gap-5">
      <AdrProseNode title={getFieldLabel('decision_context', locale)} value={context} locale={locale} />
      <AdrProseNode title={getFieldLabel('decision', locale)} value={decision} locale={locale} issue={fieldIssue(obj, 'decision')} />
      <AdrProseNode title={getFieldLabel('alternatives', locale)} value={alternatives} locale={locale} />
      <AdrProseNode title={getFieldLabel('decision_consequences', locale)} value={consequences} locale={locale} />
      <AdrProseNode title={getFieldLabel('scope', locale)} value={scopeProse} locale={locale} issue={fieldIssue(obj, 'scope')} />
      <AdrProseNode title={getFieldLabel('evidence', locale)} value={evidence} locale={locale} />
      <AdrProseNode title={getFieldLabel('trigger_signal', locale)} value={triggerSignal} locale={locale} issue={fieldIssue(obj, 'trigger_signal')} />
      <AdrTerminalReadingNode obj={obj} locale={locale} />
      <FactAssociationsSection obj={obj} locale={locale} />
      <RelatedContentSection entries={relatedEntries} locale={locale} />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}

/** 22 §9 终态去向：retired 的 reason（本地化闭集）+ 退出时间 + 被谁替代。 */
function AdrTerminalReadingNode({ obj, locale }: { obj: Record<string, unknown>; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const isRetired = obj.status === 'retired';
  if (!isRetired) return null;

  const reason = typeof obj.retirement_reason === 'string' && obj.retirement_reason.trim()
    ? obj.retirement_reason.trim()
    : null;
  const supersededBy = Array.isArray(obj.relations)
    ? obj.relations.find((rel) => (rel as { relation_key?: string }).relation_key === 'superseded-by')
    : null;
  const supersededByUid = typeof supersededBy === 'object' && supersededBy !== null
    ? String((supersededBy as { target?: { object_uid?: string } }).target?.object_uid ?? '')
    : '';

  const reasonText = reason ? getFieldValueLabel('retirement_reason', reason, locale) || reason : t('objectList.dispositionMissing');
  const retiredAt = typeof obj.retired_at === 'string' && obj.retired_at ? formatDateTime(obj.retired_at) : '';
  const content = [
    `${getFieldLabel('retirement_reason', locale)}：${reasonText}`,
    retiredAt ? `${getFieldLabel('retired_at', locale)}：${retiredAt}` : '',
    supersededByUid ? `superseded-by → ${supersededByUid}` : '',
  ].filter(Boolean).join('\n');

  return (
    <ReadingNodeSection
      title={getObjectStatusLocale('adr', 'retired', locale)}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <ResearchTextNodeContent value={content} compact />
    </ReadingNodeSection>
  );
}

function AdrProseNode({
  title,
  value,
  locale,
  issue,
}: {
  title: string;
  value: string;
  locale: string;
  issue?: FieldPresentationIssue;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  if (!value && !issue) return null;

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? <FieldProblem issue={issue} /> : (
        <ResearchTextNodeContent value={value} />
      )}
    </ReadingNodeSection>
  );
}

/** 23 号规范 §8 的正文固定 H2（「证据」条件出现——urls 非空时必在）。 */
const PITFALL_BODY_SECTION_ORDER = ['症状', '触发条件', '根因', '解决', '规避', '验证', '影响与适用范围', '证据'] as const;

type PitfallBodySection = { title: string; body: string };

/** 正文按固定 H2 分节（前端解析，跟随 spark/adr 的分节先例）。 */
function parsePitfallBodySections(body: string): PitfallBodySection[] {
  const lines = body.split('\n');
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }
  return sections
    .map((section) => ({ title: section.title, body: section.body.join('\n').trim() }))
    .filter((section) => section.body.length > 0 && section.title.length > 0)
    .sort((a, b) => {
      const aIndex = PITFALL_BODY_SECTION_ORDER.indexOf(a.title as (typeof PITFALL_BODY_SECTION_ORDER)[number]);
      const bIndex = PITFALL_BODY_SECTION_ORDER.indexOf(b.title as (typeof PITFALL_BODY_SECTION_ORDER)[number]);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
}

/** v5 Pitfall 阅读布局（23 §8）：正文固定 H2 七段（+条件证据）分节优先、
 * frontmatter 字段兜底，节序跟随字段契约（症状 → 触发条件 → 根因 → 解决
 * → 规避 → 验证 → 影响与适用范围 → 证据 → trigger_signal → 终态处置）。 */
export function PitfallReadingLayout({
  obj,
  relatedEntries,
  locale,
}: {
  obj: Record<string, unknown>;
  relatedEntries: RelatedContentEntry[];
  locale: string;
}) {
  const bodySections = parsePitfallBodySections(typeof obj.report_body === 'string' ? obj.report_body : '');
  const sectionOf = (title: string) => bodySections.find((section) => section.title === title);
  // 23 §8：正文是 scope 的自然语言承载——正文节优先，缺失时以
  // frontmatter 字段兜底（同 spark/adr 先例）。
  const proseFrom = (sectionTitle: string, fieldValue: unknown): string => {
    const body = sectionOf(sectionTitle)?.body;
    if (body) return body;
    return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue.trim() : '';
  };

  const symptoms = sectionOf('症状')?.body ?? '';
  const triggers = sectionOf('触发条件')?.body ?? '';
  const rootCause = sectionOf('根因')?.body ?? '';
  const resolutionApplied = sectionOf('解决')?.body ?? '';
  const avoidance = sectionOf('规避')?.body ?? '';
  const validation = sectionOf('验证')?.body ?? '';
  const scopeProse = proseFrom('影响与适用范围', obj.scope);
  const evidence = sectionOf('证据')?.body ?? '';
  const triggerSignal = typeof obj.trigger_signal === 'string' && obj.trigger_signal.trim() ? obj.trigger_signal.trim() : '';

  return (
    <div className="mb-6 flex flex-col gap-5">
      <AdrProseNode title={getFieldLabel('pitfall_symptoms', locale)} value={symptoms} locale={locale} />
      <AdrProseNode title={getFieldLabel('pitfall_triggers', locale)} value={triggers} locale={locale} />
      <AdrProseNode title={getFieldLabel('root_cause', locale)} value={rootCause} locale={locale} />
      <AdrProseNode title={getFieldLabel('pitfall_resolution', locale)} value={resolutionApplied} locale={locale} />
      <AdrProseNode title={getFieldLabel('avoidance', locale)} value={avoidance} locale={locale} />
      <AdrProseNode title={getFieldLabel('validation_summary', locale)} value={validation} locale={locale} />
      <AdrProseNode title={getFieldLabel('pitfall_scope_section', locale)} value={scopeProse} locale={locale} issue={fieldIssue(obj, 'scope')} />
      <AdrProseNode title={getFieldLabel('evidence', locale)} value={evidence} locale={locale} />
      <AdrProseNode title={getFieldLabel('trigger_signal', locale)} value={triggerSignal} locale={locale} issue={fieldIssue(obj, 'trigger_signal')} />
      <PitfallTerminalReadingNode obj={obj} locale={locale} />
      <FactAssociationsSection obj={obj} locale={locale} />
      <RelatedContentSection entries={sortRelatedContentEntries(relatedEntries)} locale={locale} />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}

/** 23 §9 终态处置：discarded 的 disposition（去向与理由）。 */
function PitfallTerminalReadingNode({ obj, locale }: { obj: Record<string, unknown>; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const disposition = typeof obj.disposition === 'string' && obj.disposition.trim().length > 0
    ? obj.disposition.trim()
    : null;
  const isTerminal = obj.status === 'discarded';
  if (!isTerminal && !disposition) return null;

  const title = isTerminal
    ? getObjectStatusLocale('pitfall', String(obj.status), locale)
    : getFieldLabel('disposition', locale);
  // 终态必填去向（23 §8）：缺失时如实标注，不以空占位代替判断。
  const content = disposition ?? t('objectList.dispositionMissing');

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <PitfallTextNodeContent value={content} />
    </ReadingNodeSection>
  );
}

export function PitfallTextNodeContent({ value }: { value: unknown }) {
  return (
    <div className="ldvh-research-node-content">
      <div className="ldvh-inline-markdown max-w-none">
        <Markdown remarkPlugins={[remarkGfm]}>{String(value)}</Markdown>
      </div>
    </div>
  );
}

/** 20 号规范 §8 的正文固定 H2（「保留意图」无正文节，frontmatter 专属）。 */
const SPARK_BODY_SECTION_ORDER = ['当前理解', '调查问题', '调查边界', '演变'] as const;

type SparkBodySection = { title: string; body: string };

/** 正文按固定 H2 分节（前端解析，跟随 research 的 parseResearchBodySections 先例）。 */
function parseSparkBodySections(body: string): SparkBodySection[] {
  const lines = body.split('\n');
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }
  return sections
    .map((section) => ({ title: section.title, body: section.body.join('\n').trim() }))
    .filter((section) => section.body.length > 0 && section.title.length > 0)
    .sort((a, b) => {
      const aIndex = SPARK_BODY_SECTION_ORDER.indexOf(a.title as (typeof SPARK_BODY_SECTION_ORDER)[number]);
      const bIndex = SPARK_BODY_SECTION_ORDER.indexOf(b.title as (typeof SPARK_BODY_SECTION_ORDER)[number]);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
}

type SparkEvolutionEntry = { key: string; at: string; summary: string };

/** v5 Spark 阅读布局（20 §8）：正文固定 H2 分节优先、frontmatter 字段兜底，
 * 节序跟随字段契约（question → scope_boundary → intent → summary → 演变 → 终态）。 */
export function SparkReadingLayout({
  obj,
  locale,
}: {
  obj: Record<string, unknown>;
  locale: string;
}) {
  const bodySections = parseSparkBodySections(typeof obj.report_body === 'string' ? obj.report_body : '');
  const sectionOf = (title: string) => bodySections.find((section) => section.title === title);
  // 20 §8：正文是 question/scope_boundary/summary 的自然语言承载——正文节
  // 优先，缺失时以 frontmatter 字段兜底（同 research「研究问题」的先例）。
  const proseFrom = (sectionTitle: string, fieldValue: unknown): string => {
    const body = sectionOf(sectionTitle)?.body;
    if (body) return body;
    return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue.trim() : '';
  };

  const question = proseFrom('调查问题', obj.question);
  const boundary = proseFrom('调查边界', obj.scope_boundary);
  const intent = typeof obj.intent === 'string' && obj.intent.trim() ? obj.intent.trim() : '';
  const understanding = proseFrom('当前理解', obj.summary);
  const evolutionEntries = Array.isArray(obj.evolution) && obj.evolution.length > 0 ? obj.evolution : null;
  const evolutionProse = evolutionEntries === null ? sectionOf('演变')?.body ?? '' : '';

  return (
    <div className="mb-6 flex flex-col gap-5">
      <SparkProseNode title={getFieldLabel('question', locale)} value={question} locale={locale} issue={fieldIssue(obj, 'question')} />
      <SparkProseNode title={getFieldLabel('scope_boundary', locale)} value={boundary} locale={locale} issue={fieldIssue(obj, 'scope_boundary')} />
      <SparkProseNode title={getFieldLabel('intent', locale)} value={intent} locale={locale} issue={fieldIssue(obj, 'intent')} />
      <SparkProseNode title={getFieldLabel('current_understanding', locale)} value={understanding} locale={locale} issue={fieldIssue(obj, 'summary')} />
      <SparkEvolutionReadingNode entries={evolutionEntries} prose={evolutionProse} locale={locale} issue={fieldIssue(obj, 'evolution')} />
      <SparkTerminalReadingNode obj={obj} locale={locale} />
      <FactAssociationsSection
        obj={obj}
        locale={locale}
        title={getFieldLabel('fact_associations', locale)}
      />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}

function SparkProseNode({
  title,
  value,
  locale,
  issue,
}: {
  title: string;
  value: string;
  locale: string;
  issue?: FieldPresentationIssue;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  if (!value && !issue) return null;

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? <FieldProblem issue={issue} /> : (
        <ResearchTextNodeContent value={value} className="ldvh-spark-reading-prose" />
      )}
    </ReadingNodeSection>
  );
}

function SparkEvolutionReadingNode({
  entries,
  prose,
  locale,
  issue,
}: {
  entries: unknown[] | null;
  prose: string;
  locale: string;
  issue?: FieldPresentationIssue;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  // 20 §8：evolution 是 {at, summary} 结构化流水（关键转折，上限 20 项）；
  // 正文「演变」节是其行文承载，frontmatter 缺失时兜底。
  const hasContent = (entries !== null && entries.length > 0) || prose.length > 0;
  if (!hasContent && !issue) return null;

  return (
    <ReadingNodeSection
      title={getFieldLabel('evolution', locale)}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? <FieldProblem issue={issue} /> : entries !== null
        ? <SparkEvolutionNode value={entries} />
        : <ResearchTextNodeContent value={prose} className="ldvh-spark-reading-prose" />}
    </ReadingNodeSection>
  );
}

function SparkEvolutionNode({ value }: { value: unknown }) {
  if (!Array.isArray(value)) return <ResearchTextNodeContent value={value} />;
  const entries = value
    .map((item, index) => parseSparkEvolutionEntry(item, index))
    .filter((entry): entry is SparkEvolutionEntry => Boolean(entry))
    .reverse();

  if (entries.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {entries.map((entry) => (
        <div key={entry.key} className="min-w-0 rounded-md border border-ldvh-border/45 bg-ldvh-bg/45 px-3 py-2">
          <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ldvh-accent" aria-hidden="true" />
            <SparkEvolutionTime value={entry.at} />
          </div>
          <ResearchTextNodeContent value={entry.summary} compact />
        </div>
      ))}
    </div>
  );
}

function parseSparkEvolutionEntry(item: unknown, index: number): SparkEvolutionEntry | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const at = typeof record.at === 'string' ? record.at.trim() : '';
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  if (!at || !summary) return null;
  return {
    key: `${index}-${at}`,
    at,
    summary,
  };
}

function SparkEvolutionTime({ value }: { value: string }) {
  const [date, time] = formatDateTime(value).split(' ');
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono tabular-nums">
      <span className="ldvh-caption-strong min-w-0 break-words text-ldvh-text-secondary">{date}</span>
      {time && <span className="ldvh-meta-muted min-w-0 break-words leading-4">{time}</span>}
    </div>
  );
}

/** 20 §8/§9：disposition ⇔ 终态。终态节标题用状态语义（implemented ≠ 下游
 * 完成）；异常残留在 open 的 disposition 以字段名兜底呈现，不吞掉异常数据。 */
function SparkTerminalReadingNode({ obj, locale }: { obj: Record<string, unknown>; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const disposition = typeof obj.disposition === 'string' && obj.disposition.trim().length > 0
    ? obj.disposition.trim()
    : null;
  const isTerminal = obj.status === 'implemented' || obj.status === 'discarded';
  if (!isTerminal && !disposition) return null;

  const title = isTerminal
    ? getObjectStatusLocale('spark', String(obj.status), locale)
    : getFieldLabel('disposition', locale);
  // 终态必填去向（20 §8）：缺失时如实标注，不以空占位代替判断。
  const content = disposition ?? t('objectList.dispositionMissing');

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <ResearchTextNodeContent value={content} compact />
    </ReadingNodeSection>
  );
}

/** 26 号规范 §8 的正文固定 H2（「处置」条件出现——resolved/voided 时）。 */
const FRICTION_BODY_SECTION_ORDER = ['现象', '入账依据', '处置'] as const;

type FrictionBodySection = { title: string; body: string };

/** 正文按固定 H2 分节（前端解析，跟随 spark/adr/pitfall 的分节先例）。 */
function parseFrictionBodySections(body: string): FrictionBodySection[] {
  const lines = body.split('\n');
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }
  return sections
    .map((section) => ({ title: section.title, body: section.body.join('\n').trim() }))
    .filter((section) => section.body.length > 0 && section.title.length > 0)
    .sort((a, b) => {
      const aIndex = FRICTION_BODY_SECTION_ORDER.indexOf(a.title as (typeof FRICTION_BODY_SECTION_ORDER)[number]);
      const bIndex = FRICTION_BODY_SECTION_ORDER.indexOf(b.title as (typeof FRICTION_BODY_SECTION_ORDER)[number]);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
}

/** v5 Friction 阅读布局（26 §8）：正文三段（现象/入账依据+条件处置）分节
 * 优先、frontmatter 字段兜底；节序跟随字段契约（现象 → 归因 → 入账依据 →
 * 处置 → resolved 的 informs 解药）。
 *
 * （2026-11-02 注：原由 Human 裁定 2026-11「impact 不在本布局、改由卡头 chip
 * 呈现」的 impact 分级字段，已随 26 §8 撤销该制度而整体移除——本布局从未列它，
 * 故此处无需改动；保留这条注以免读者去旧文档找 chip 的出处。） */
export function FrictionReadingLayout({
  obj,
  relatedEntries,
  locale,
}: {
  obj: Record<string, unknown>;
  relatedEntries: RelatedContentEntry[];
  locale: string;
}) {
  const bodySections = parseFrictionBodySections(typeof obj.report_body === 'string' ? obj.report_body : '');
  const sectionOf = (title: string) => bodySections.find((section) => section.title === title);
  // 26 §8：正文是 phenomenon 的自然语言承载——正文节优先，缺失时以
  // frontmatter 字段兜底（同 spark/adr/pitfall 先例）。
  const proseFrom = (sectionTitle: string, fieldValue: unknown): string => {
    const body = sectionOf(sectionTitle)?.body;
    if (body) return body;
    return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue.trim() : '';
  };

  const phenomenon = proseFrom('现象', obj.phenomenon);
  const basis = sectionOf('入账依据')?.body ?? '';
  const disposition = sectionOf('处置')?.body ?? '';
  const attribution = typeof obj.attribution === 'string' && obj.attribution.trim() ? obj.attribution.trim() : '';
  const informsEdges = Array.isArray(obj.relations)
    ? obj.relations.filter((rel) => (rel as { relation_key?: string }).relation_key === 'informs')
    : [];
  const informsText = informsEdges.length > 0
    ? informsEdges.map((rel) => String((rel as { target?: { object_uid?: string } }).target?.object_uid ?? '')).filter(Boolean).join(' → ')
    : '';

  return (
    <div className="mb-6 flex flex-col gap-5">
      <AdrProseNode title={getFieldLabel('phenomenon', locale)} value={phenomenon} locale={locale} issue={fieldIssue(obj, 'phenomenon')} />
      <AdrProseNode title={getFieldLabel('attribution', locale)} value={attribution} locale={locale} issue={fieldIssue(obj, 'attribution')} />
      <AdrProseNode title={getFieldLabel('friction_basis', locale)} value={basis} locale={locale} />
      <AdrProseNode title={getFieldLabel('friction_disposition', locale)} value={disposition} locale={locale} />
      {informsText ? (
        <AdrProseNode title={getFieldLabel('relation_informs', locale)} value={`informs → ${informsText}`} locale={locale} />
      ) : null}
      <FactAssociationsSection obj={obj} locale={locale} />
      <RelatedContentSection entries={sortRelatedContentEntries(relatedEntries)} locale={locale} />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}

/** 27 号 §8 的正文固定 H2 四段骨架（方向定位与适用范围／核心规则体系／
 * 约束与反模式／验证与遵从性检查——创建时必须全部存在且各段非空）。 */
const NORM_BODY_SECTION_ORDER = ['方向定位与适用范围', '核心规则体系', '约束与反模式', '验证与遵从性检查'] as const;

type NormBodySection = { title: string; body: string };

/** 正文按固定 H2 分节（前端解析，跟随 spark/adr/pitfall/friction 的分节先例）。 */
function parseNormBodySections(body: string): NormBodySection[] {
  const lines = body.split('\n');
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }
  return sections
    .map((section) => ({ title: section.title, body: section.body.join('\n').trim() }))
    .filter((section) => section.body.length > 0 && section.title.length > 0)
    .sort((a, b) => {
      const aIndex = NORM_BODY_SECTION_ORDER.indexOf(a.title as (typeof NORM_BODY_SECTION_ORDER)[number]);
      const bIndex = NORM_BODY_SECTION_ORDER.indexOf(b.title as (typeof NORM_BODY_SECTION_ORDER)[number]);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
}

/** v5 Norm 阅读布局（27 号 §8）：正文固定 H2 四段分节呈现（核心规则体系可含 H3
 * 子节，直接渲染 markdown）；节序跟随字段契约，终态退出去向（retirement_reason +
 * retired_at）在末位。norm 不使用 relations（27 §9），无 FactAssociations。
 *
 * **`direction_key` 不上屏（Human 定案 2026-11-02）**：曾以「方向键节点」置顶呈现，
 * 连同缺失时的琥珀提示一起删除。理由与卡面同一件事：它是**唯一性公式与索引的机器
 * 作用域**，不是读者判断「这份规范管哪个方向」的依据——后者由标题与「方向定位与
 * 适用范围」节的散文回答。而缺方向键属**载体不合规**，读取层会按字段契约为它产出
 * `field_issues`（`missing`），由 `FieldIssuesSection` 如实报出；页面另写一句提示
 * 是同一事实的第二处呈现，且它把「字段缺失」伪装成了「该规律值得单独说一句」。
 *
 * 因此本布局的输入只剩 `report_body` / 终态两字段 / 流水——`direction_key` 既不被
 * 读取也不被消费。它仍留在 `model.ts` 的兜底字段序里，是因为该序只在走 `ContentField`
 * 兜底时才生效，而 norm 与其余各类型一样从不消费 `extraEntries`。 */
export function NormReadingLayout({
  obj,
  locale,
}: {
  obj: Record<string, unknown>;
  locale: string;
}) {
  const bodySections = parseNormBodySections(typeof obj.report_body === 'string' ? obj.report_body : '');
  const sectionOf = (title: string) => bodySections.find((section) => section.title === title);

  const positioning = sectionOf('方向定位与适用范围')?.body ?? '';
  const rules = sectionOf('核心规则体系')?.body ?? '';
  const constraints = sectionOf('约束与反模式')?.body ?? '';
  const compliance = sectionOf('验证与遵从性检查')?.body ?? '';

  return (
    <div className="mb-6 flex flex-col gap-5">
      <AdrProseNode title={getFieldLabel('norm_positioning', locale)} value={positioning} locale={locale} />
      <AdrProseNode title={getFieldLabel('norm_rules', locale)} value={rules} locale={locale} />
      <AdrProseNode title={getFieldLabel('norm_constraints', locale)} value={constraints} locale={locale} />
      <AdrProseNode title={getFieldLabel('norm_compliance', locale)} value={compliance} locale={locale} />
      <NormTerminalReadingNode obj={obj} locale={locale} />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}

/** 27 号 §9/§11 终态去向：retired 的 reason（本地化闭集，按 27 号自己的三值：
 * superseded/outdated/out-of-scope）+ 退役时间。retired 终态不重开。 */
function NormTerminalReadingNode({ obj, locale }: { obj: Record<string, unknown>; locale: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const isRetired = obj.status === 'retired';
  if (!isRetired) return null;

  const reason = typeof obj.retirement_reason === 'string' && obj.retirement_reason.trim()
    ? obj.retirement_reason.trim()
    : null;
  const retiredAt = typeof obj.retired_at === 'string' && obj.retired_at ? formatDateTime(obj.retired_at) : '';

  const reasonText = reason ? getFieldValueLabel('retirement_reason', reason, locale) || reason : t('objectList.dispositionMissing');
  const content = [
    `${getFieldLabel('retirement_reason', locale)}：${reasonText}`,
    retiredAt ? `${getFieldLabel('retired_at', locale)}：${retiredAt}` : '',
  ].filter(Boolean).join('\n');

  return (
    <ReadingNodeSection
      title={getObjectStatusLocale('norm', 'retired', locale)}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <ResearchTextNodeContent value={content} compact />
    </ReadingNodeSection>
  );
}

type ServingWorkRow = {
  object_uid?: string;
  type: string;
  id: string;
  title: string;
  status: string;
};

function parseSubGoalBodySections(body: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }
  return sections
    .map((section) => ({ title: section.title, body: section.body.join('\n').trim() }))
    .filter((section) => section.title.length > 0 && section.body.length > 0);
}

/**
 * v5 SubGoal 阅读布局（28 号 §8/§10/§12）。
 *
 * 三段结构，次序就是读者要回答的三个问题：
 *   ① 走到哪算达成（`criterion` 全文，正文段优先、字段兜底）
 *   ② 凭什么判（`criterion_kind` 对应的判法说明——Human 2026-11-02「只保留判法即可」）
 *   ③ 它凭什么属于这个项目目标（`alignment`）
 * 之后是名下的工作（由 `serves` 反查派生）与修订史。
 *
 * **次序与判据类型不再住这一屏的顶部锚点块**（Human 定案 2026-11-02）：
 * - `order` 移到**身份头**（与列表卡卡头同一枚 `SubGoalOrderBadge`）——它是跨条比较的
 *   扫读要素，与「优先级」同级（见 §4sexies）；
 * - `criterion_kind` 的**词**（「闭环记录」等）退出呈现，只留它的**判法说明**，且这条
 *   说明用与「达成条件」相同的正文节点承载、紧挨在达成条件之后、排在名下的工作之前。
 *   理由：读者要的是「这条怎么判」，不是「它属于哪个分类」——把闭集名摆在最上面，
 *   读者先看到的是一个分类标签，而答案在下面那行说明里。
 *
 * **名下的工作不是「进度」**：0 条不等于 0%，它是「未声明或未拆解」，这两种
 * 情形机械层不可区分（28 §8.1），故空集时显式标注歧义而不是画一个 0。
 * 同理 3 条已完成的工作也不推出「子目标已达成」——达成由判据判定（§18 红线 3）。
 */
export function SubGoalReadingLayout({
  obj,
  locale,
}: {
  obj: Record<string, unknown>;
  locale: string;
}) {
  const { t } = useI18n();
  const [servingState, setServingState] = useState<ReadingNodeState>('expanded');

  // 显示次序不是身份（28 §7）：身份是 object_uid，读者在这一屏不需要看到它——
  // 它在 URL 里、在引用里、在任何需要精确定位的地方，而不是阅读面。
  // `order` 不再在本屏消费：它已移到身份头（`ObjectDetail` 的 ObjectIdentityHeader，
   // 经同一枚 `SubGoalOrderBadge`）。此处不留一个「读了不用」的变量——留着会让后来者
   // 以为这一屏仍在呈现次序，改动两处之一就够。
  const criterionKind = typeof obj.criterion_kind === 'string' ? obj.criterion_kind.trim() : '';
  const criterion = typeof obj.criterion === 'string' ? obj.criterion.trim() : '';
  const alignment = typeof obj.alignment === 'string' ? obj.alignment.trim() : '';
  // `parent_goal` 不再在本屏消费，也**不再在任何一屏呈现**（Human 定案 2026-11-02，
  // 截图圈出身份头底部的「服务目标 project-goal」：「圈出来的不用显示」）。它上一轮
  // 从本屏移到身份头辅助元信息行，这一轮连那一行一起撤除——故
  // `AUXILIARY_META_KEYS_BY_TYPE.subgoal` 现为空表。同上，不留「读了不用」的变量。

  const bodySections = parseSubGoalBodySections(typeof obj.report_body === 'string' ? obj.report_body : '');
  const sectionOf = (title: string) => bodySections.find((section) => section.title === title)?.body ?? '';

  const servingWork = Array.isArray(obj.serving_work)
    ? obj.serving_work.flatMap((entry): ServingWorkRow[] => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.type !== 'string' || typeof record.id !== 'string') return [];
        return [{
          object_uid: typeof record.object_uid === 'string' ? record.object_uid : undefined,
          type: record.type,
          id: record.id,
          title: typeof record.title === 'string' ? record.title : record.id,
          status: typeof record.status === 'string' ? record.status : '',
        }];
      })
    : [];
  const servingUnreadable = Array.isArray(obj.serving_unreadable)
    ? obj.serving_unreadable.filter((entry): entry is string => typeof entry === 'string')
    : [];

  // 判法说明：`criterion_kind` 的**词**不上屏（Human 2026-11-02「只保留判法即可」），
  // 只留它对应的判法。闭集外的值没有判法可给——不猜含义、不用分类名冒充说明
  // （28 §18 红线：不以类推定替代），此时整节点不渲染。
  // 显式三分支而非模板串：`t()` 的键是字面量联合类型，模板串会让拼错的键
  // 逃过类型检查、在运行时静默显示原始 key。
  const kindHint = criterionKind === 'metric'
    ? t('objectDetail.subGoalKindHint.metric')
    : criterionKind === 'closure-records'
      ? t('objectDetail.subGoalKindHint.closure-records')
      : criterionKind === 'executable-check'
        ? t('objectDetail.subGoalKindHint.executable-check')
        : '';

  return (
    <div className="mb-6 flex flex-col gap-5">
      {/* 顶部锚点块已撤（Human 定案 2026-11-02「只保留判法即可」）。它此前同时装着
          次序、判据类型的词、服务目标与判法四样东西，而其中只有判法回答了读者打开
          这一屏的问题：这条怎么判。其余三样各有归属——
            · 次序 → 身份头（与列表卡卡头同一枚 SubGoalOrderBadge，见 §4sexies）；
            · 判据类型的词 → 不上屏，只留它的判法（分类名不是答案，答案在判法里）；
            · 服务目标 → 身份头辅助元信息（`AUXILIARY_META_KEYS_BY_TYPE.subgoal`），
              它是「这条属于哪个目标」的归属事实，不是阅读叙事的一段。 */}

      {/* 正文两块是 frontmatter 的**展开**（28 §8 不变量 1：字段必须逐字出现在
          正文对应段），所以正文段永远以字段原文开头、再补判定材料与理由。

          因此**不能**把字段与正文段各渲染一次——那会让同一段话在页面上出现两遍
          （实测：同一条子目标的达成条件与对齐说明整段重复出现过两遍）。惯例同 27 号 NormReadingLayout：
          只渲染正文分节，字段是机器权威、不单独上屏。

          正文缺失时才回落显示字段——那是载体不合规的形态，字段仍是唯一权威文本，
          不能因为正文没写就让读者看不到判据。 */}
      {sectionOf('达成条件') ? (
        <AdrProseNode
          title={getFieldLabel('subgoal_criterion', locale)}
          value={sectionOf('达成条件')}
          locale={locale}
        />
      ) : criterion ? (
        <AdrProseNode
          title={getFieldLabel('subgoal_criterion', locale)}
          value={criterion}
          locale={locale}
        />
      ) : null}
      {sectionOf('对齐说明') ? (
        <AdrProseNode
          title={getFieldLabel('subgoal_alignment', locale)}
          value={sectionOf('对齐说明')}
          locale={locale}
        />
      ) : alignment ? (
        <AdrProseNode
          title={getFieldLabel('subgoal_alignment', locale)}
          value={alignment}
          locale={locale}
        />
      ) : null}

      {/* 判法：`criterion_kind` 的判法说明，用与「达成条件」同一个正文节点渲染
          （Human 2026-11-02「只保留判法即可，样式和达成条件一样，放到名下工作上面」）。

          位置在名下的工作**正上方**而不是紧跟达成条件：它回答的是「这些工作按什么
          算齐了」，与紧接着要列出的名下工作同属一个判断动作——读者读完判法，下一眼
          就是「那条判法对着哪些工作看」。夹在达成条件与对齐说明之间则会把「凭什么归属
          这个目标」推到判法之后，打断归属叙事的连贯。

          闭集外的 `criterion_kind` 没有判法可给：不渲染本节点，也不退而显示分类名
          （28 §18 红线：不以类推定替代）。不合法本身由字段问题区如实报出。 */}
      {kindHint && (
        <AdrProseNode
          title={getFieldLabel('subgoal_kind_hint', locale)}
          value={kindHint}
          locale={locale}
        />
      )}

      <ReadingNodeSection
        title={t('objectDetail.subGoalServingWork')}
        state={servingState}
        locale={locale}
        headerMeta={<span className="ldvh-meta-muted">{servingWork.length}</span>}
        onToggle={() => setServingState((current) => getReadingNodeNextState(current))}
      >
        {/* 火花落实比值（Human 定案 2026-11-02），口径与卡面**同一处派生**：
            `utils/servingSparkProgress.ts` 单点算，卡与详情共用，不在两处各算一遍。

            **位置与卡面刻意相反**：卡面在行列表之后（先看有哪几条，再看其中多少已落实，
            代价只有 3 行）；这里在行列表**之前**——详情面的清单不折叠（实测一条子目标
            可到 48 行），把汇总放在末尾等于让它出现在没人会滚到的地方，那就不叫「先材料
            后结论」，叫「结论不可达」。同一份派生、两种排布，都是为了「结论与材料同屏」。

            空集时不画：上面那句空集歧义提示已经说清，同一件事说两遍会让读者以为其中
            一条是新信息。

            这里读的是 `obj.serving_work` 的**原始行**（带 `status`），不是下面渲染用的
            `servingWork` 投影——那一层把 `status` 换成了关联状态轴，拿它去数火花会
            得到 0 条（卡面第一版正是这么错的，2026-11-02 实测发现）。 */}
        {servingWork.length > 0 && (
          <div className="mb-2">
            <ServingSparkProgressBar
              rows={Array.isArray(obj.serving_work) ? obj.serving_work : []}
              unreadable={servingUnreadable}
              progressLabel={t('objectList.subGoalSparkProgress')}
              emptyLabel={t('objectList.subGoalSparkProgressEmpty')}
              allDiscardedLabel={t('objectList.subGoalSparkProgressAllDiscarded')}
              unavailableLabel={t('objectList.subGoalSparkProgressUnavailable')}
              unknownStatusLabel={(count) => t('objectList.subGoalSparkProgressUnknown', { count: String(count) })}
            />
          </div>
        )}
        {servingWork.length === 0 ? (
          // 28 §8.1：空集歧义必须显式标注。它不是「进度 0%」——真的还没拆解，
          // 与拆解了却没人写 serves，在机械层长得一模一样。
          <p className={`ldvh-meta rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-3 py-2 ${LDVH_WARN_TITLE_CLASS}`}>
            {t('objectDetail.subGoalServingEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-ldvh-border/70">
            {servingWork.map((row) => (
              <li key={`${row.type}-${row.id}`} className="flex min-w-0 items-center gap-2 py-2 first:pt-0 last:pb-0">
                <ObjectTypeIcon type={row.type} size={12} />
                <a
                  href={row.object_uid ? `#/objects/${row.type}/${row.object_uid}` : undefined}
                  className="ldvh-caption min-w-0 flex-1 truncate hover:underline"
                >
                  {row.title}
                </a>
                {row.status && (
                  <span className="ldvh-chip-sm shrink-0 border-ldvh-border bg-transparent text-ldvh-text-secondary">
                    {getObjectStatusLocale(row.type, row.status, locale)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {servingUnreadable.length > 0 && (
          // 读不到不等于没有（00 §4.6）：无法枚举的类型单列，绝不并进空集。
          <p className={`ldvh-meta mt-2 rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-3 py-2 ${LDVH_WARN_TITLE_CLASS}`}>
            {t('objectDetail.subGoalServingUnreadable')}：{servingUnreadable.join('；')}
          </p>
        )}
      </ReadingNodeSection>

      <SubGoalTerminalReadingNode obj={obj} locale={locale} />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}

/** 28 号 §9/§11 终态去向：retired 的 disposition（原位作废的去向与理由）。
 * achieved 不在此列——它不是「退出」，是判据被满足，语义由状态徽标承载。 */
function SubGoalTerminalReadingNode({ obj, locale }: { obj: Record<string, unknown>; locale: string }) {
  const { t } = useI18n();
  const isRetired = obj.status === 'retired';
  if (!isRetired) return null;
  const disposition = typeof obj.disposition === 'string' && obj.disposition.trim()
    ? obj.disposition.trim()
    : '';
  return (
    <AdrProseNode
      title={getFieldLabel('subgoal_disposition', locale) || t('objectList.dispositionMissing')}
      value={disposition || t('objectList.dispositionMissing')}
      locale={locale}
    />
  );
}

/** v5 Goal 阅读布局（25 号 §6）：单例冻结锚的详情阅读面——目标陈述（冻结区，
 * 为什么 + 要实现什么）→ 子目标（28 号对象，按 `parent_goal` 反查派生，各带可
 * 判定的达成条件）→ 修订史（change_log 是 HV5 演进链第一环，复用共享流水节点）。
 * Goal 无 relations/urls（25 §5 链顶无上游；路径即身份）。 */
export function GoalReadingLayout({
  obj,
  locale,
}: {
  obj: Record<string, unknown>;
  locale: string;
}) {
  const { t } = useI18n();
  const [subGoalsState, setSubGoalsState] = useState<ReadingNodeState>('expanded');
  const statement = typeof obj.statement === 'string' && obj.statement.trim()
    ? obj.statement.trim()
    : '';
  const subGoals = Array.isArray(obj.sub_goals)
    ? obj.sub_goals.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.id !== 'string' || !record.id.trim()) return [];
        if (typeof record.text !== 'string' || !record.text.trim()) return [];
        return [{
          id: record.id.trim(),
          text: record.text.trim(),
          // 28 §8：显示次序由可选 `order` 承担，身份由 `object_uid` 承担。
          // 这一屏给读者看的是次序，不是 identity（`id` 就是 uid）。
          order: typeof record.order === 'number' ? record.order : undefined,
          object_uid: typeof record.object_uid === 'string' ? record.object_uid : undefined,
          legacy: record.legacy === true,
        }];
      })
    : [];

  return (
    <div className="mb-6 flex flex-col gap-5">
      {/* 目标陈述（冻结区）：一段话，写给未来会话与新读者。 */}
      <AdrProseNode title={getFieldLabel('goal_statement', locale)} value={statement} locale={locale} />
      {/* 子目标：按 `parent_goal` 反查派生（28 §8.1，不在本载体存储）——
          与认知中心目标区同渲染语法（chip + 文本行）。次序取 `order`，
          缺失即「未定次序」；身份是 object_uid，读者在这一屏不需要它。 */}
      {subGoals.length > 0 && (
        <ReadingNodeSection
          title={getFieldLabel('goal_sub_goals', locale)}
          state={subGoalsState}
          locale={locale}
          headerMeta={<span className="ldvh-meta-muted">{subGoals.length}</span>}
          onToggle={() => setSubGoalsState((current) => getReadingNodeNextState(current))}
        >
          <ul className="divide-y divide-ldvh-border/70">
            {subGoals.map((subGoal) => (
              <li key={subGoal.id} className="flex min-w-0 items-start gap-2 py-2 first:pt-0 last:pb-0">
                <span className={`ldvh-chip ldvh-chip-sm shrink-0 ${LDVH_SUCCESS_CHIP_HUE_CLASS}`}>
                  {typeof subGoal.order === 'number' ? subGoal.order : '·'}
                </span>
                <span className="ldvh-caption min-w-0 flex-1">{subGoal.text}</span>
                {/* 迁移中的旧段行：显式标出，不与会话中的对象行混为一谈
                    （25 §7 / 28 §14.2）。它也没有可下钻的对象。 */}
                {subGoal.legacy && (
                  <span
                    className="ldvh-chip ldvh-chip-sm shrink-0 border-ldvh-border bg-transparent text-ldvh-text-secondary"
                    title={t('goalDetail.subGoalLegacy')}
                  >
                    legacy
                  </span>
                )}
              </li>
            ))}
          </ul>
        </ReadingNodeSection>
      )}
      <ChangeLogReadingNode
        value={obj.change_log}
        locale={locale}
      />
    </div>
  );
}

/** 29 §8 正文五块固定 H2（active 形态）；absorbed 是压缩形态（仅两段，§9.1）。 */
const DEVLOG_BODY_SECTION_ORDER = [
  '结论与边界', '去向', '背景', '做法', '实测',
] as const;

function parseDevLogBodySections(body: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }
  return sections
    .map((section) => ({ title: section.title, body: section.body.join('\n').trim() }))
    .filter((section) => section.title.length > 0)
    .sort((a, b) => {
      const aIndex = DEVLOG_BODY_SECTION_ORDER.indexOf(a.title as (typeof DEVLOG_BODY_SECTION_ORDER)[number]);
      const bIndex = DEVLOG_BODY_SECTION_ORDER.indexOf(b.title as (typeof DEVLOG_BODY_SECTION_ORDER)[number]);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
}

/**
 * v5 DevLog 阅读布局（29 号 §8/§9/§10/§11/§12）。
 *
 * ## 为什么节序是「结论与边界 → 去向 → 背景 → 做法 → 实测」而不是规范列出的次序
 *
 * 29 §8 把正文骨架列作「背景 / 做法 / 实测 / 结论与边界 / 去向」——那是**书写**
 * 次序（先讲为什么做、再讲怎么做、测到什么，最后收出结论与去向）。本布局是**阅读**
 * 次序，两者不是同一件事：读者打开一条已收敛的日志，最想先知道的是「结论是什么、
 * 它现在归到哪去了」，而不是重读一遍当年的做法。故 `summary`（结论与边界）与「去向」
 * 前置，背景/做法/实测作为**依据**排在后面。
 *
 * 这**不是**对规范的改动：字段与正文骨架都没动，H2 标题逐字照读；只改呈现次序。
 * `summary` 仍必须逐字出现在「结论与边界」段（§8 不变量 1），本布局把它按该段原文
 * 呈现，不做二次加工。
 *
 * ## 终态不谈「退出理由」，只有 `dropped` 例外
 *
 * `absorbed` / `superseded` 的去向在 `relations` 的承接/推翻边上（§11），由
 * `FactAssociationsSection` 的关联行呈现——那里能点开承接物，比一句文字更有用。
 * `dropped` 没有可指向的承接物（§9.1 的分界线正在此），它的理由只能写在
 * `disposition` 里，故只有这一档另起一个节点。
 *
 * ## 压缩形态要**说明**，不能静默少三段
 *
 * `absorbed` 的正文只剩两段（§9.1）。读者若不知道这条规则，会把「没有背景/做法/
 * 实测」读成「这篇文章写残了」。故压缩态显式给一句说明，并把「实测数字不再随对象
 * 可读」这个已知缺口如实写出来（§9.1 已登记该缺口，不掩盖）。
 */
export function DevLogReadingLayout({
  obj,
  locale,
}: {
  obj: Record<string, unknown>;
  locale: string;
}) {
  const { t } = useI18n();
  const status = typeof obj.status === 'string' ? obj.status : '';
  const isAbsorbed = status === 'absorbed';
  const isDropped = status === 'dropped';

  const bodySections = parseDevLogBodySections(typeof obj.report_body === 'string' ? obj.report_body : '');
  const sectionOf = (title: string) => bodySections.find((section) => section.title === title)?.body ?? '';

  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  const disposition = typeof obj.disposition === 'string' ? obj.disposition.trim() : '';

  // 正文段优先，字段兜底：`summary` 是机器权威、正文「结论与边界」是它的展开
  // （§8 不变量 1 要求逐字包含）。正文缺失时回落字段——那是载体不合规的形态，
  // 不能因为正文没写就让读者看不到那条结论。
  const conclusion = sectionOf('结论与边界') || summary;
  const destination = sectionOf('去向');
  const background = sectionOf('背景');
  const approach = sectionOf('做法');
  const measurements = sectionOf('实测');

  return (
    <div className="mb-6 flex flex-col gap-5">
      {/* 时间轴节点与主题空集提示已于 2026-11-02 撤除（Human 定案「圈出来的部分
          不用显示」）——两件事同住一个 `<section>`，整块移除：

          1. **两个时间**（`occurred_at` / `created_at`）：29 §10.4 当初要求分开
             呈现，理由是二者在存量并入时常相差很远。撤除后二者的区别仍由**字段
             权威**承担——`occurred_at` 由**按 `occurred_at` 排序的条目清单**承担
             回查职责（时间线回查入口，§12.1；列表卡头的那枚徽章已于 2026-11-02
             二次定案撤除，§10.4 同步订正），`created_at` 走 `change_log` 首条与底部
             YAML 原文。
             规范 29 §10.4/§14.1 已同步修订为「不在详情页重复呈现」。
          2. **无 `serves` 的空集提示**：29 §8.1 曾要求呈现面显式标注歧义。撤除的
             依据是：`serves` 自 2026-11-01 起已不在本类型任何呈现面出现
             （§12.1「不设呈现面与筛选面」），而无 `serves` 的提示只是该字段缺席
             的推断，不是条目内容——留着它等于用一个被撤销呈现面的字段反推出一个
             常驻告警。规范 29 §8.1/§14.1 已同步修订。

          详情页首屏因此直接从「结论」开始——本类型存在的理由。 */}
      {/* 结论（`summary` 的展开）——本类型存在的理由，排在正文之前。 */}
      <AdrProseNode
        title={getFieldLabel('devlog_conclusion', locale)}
        value={conclusion}
        locale={locale}
        issue={conclusion ? undefined : fieldIssue(obj, 'summary')}
      />

      {isAbsorbed && (
        // 压缩形态显式说明（§9.1）：少三段是规则不是残缺；实测数字不再随对象
        // 可读是已知缺口，不掩盖。
        <p className={`ldvh-meta rounded-md border ${LDVH_WARN_SURFACE_CLASS} px-3 py-2 ${LDVH_WARN_TITLE_CLASS}`}>
          {t('objectList.devlogCompressedBody')}
        </p>
      )}

      {/* 去向：仅 `dropped` 有 `disposition`（无可指向承接物的那一档）。
          absorbed/superseded 的去向在承接/推翻边上，由关联区呈现。 */}
      {isDropped && (
        <AdrProseNode
          title={getFieldLabel('devlog_disposition', locale)}
          value={disposition}
          locale={locale}
          issue={disposition ? undefined : fieldIssue(obj, 'disposition')}
        />
      )}

      {/* 正文「去向」段：未承接时说明为何仍承重（§8 对 active 的要求）。 */}
      <AdrProseNode
        title={getFieldLabel('devlog_destination', locale)}
        value={destination}
        locale={locale}
      />

      {/* 依据三段：书写次序（背景 → 做法 → 实测）原样保留，它们是读者核对结论
          可信度的材料，不重新排序——重排会让人以为这是另一条骨架。 */}
      <AdrProseNode title={getFieldLabel('devlog_background', locale)} value={background} locale={locale} />
      <AdrProseNode title={getFieldLabel('devlog_approach', locale)} value={approach} locale={locale} />
      <AdrProseNode title={getFieldLabel('devlog_measurements', locale)} value={measurements} locale={locale} />

      {/* `absorbed-into`（可指向 commit 形态）与 `superseded-by` 两条边在此呈现，
          是「结论现在在哪」的唯一可点入口（§11）。 */}
      <FactAssociationsSection obj={obj} locale={locale} />
      <ChangeLogReadingNode
        value={obj.change_log}
        issue={fieldIssue(obj, 'change_log')}
        locale={locale}
      />
    </div>
  );
}
