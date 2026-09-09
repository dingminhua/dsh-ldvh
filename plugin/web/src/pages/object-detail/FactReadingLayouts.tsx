import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDateTime } from '@/utils/dateFormat';
import { useI18n } from '@/i18n/context';
import { getFieldLabel, getFieldValueLabel, getObjectStatusLocale } from '@/i18n/locales';
import { normalizeSignature } from '../../../shared/signature';
import { FactAssociationsSection } from '@/pages/object-detail/FactAssociationsSection';
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
  hasDetailContent,
  type ReadingNodeState,
} from '@/pages/ObjectDetail';

export function FieldProblem({ issue }: { issue?: FieldPresentationIssue }) {
  const { t } = useI18n();
  if (!issue) return null;
  const text = issue.reason === 'missing'
    ? t('objectDetail.fieldMissing')
    : issue.reason === 'type_mismatch'
      ? t('objectDetail.fieldTypeMismatch')
      : t('objectDetail.fieldIdentityMismatch');
  return <p className="ldvh-meta rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-amber-700 dark:text-amber-300">{text}</p>;
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
        variant="spark"
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
