import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDateTime } from '@/utils/dateFormat';
import { useI18n } from '@/i18n/context';
import { getFieldLabel, getObjectStatusLocale } from '@/i18n/locales';
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
  StudyTextNodeContent,
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
    const normalizedSignature = normalizeSignature({
      productName: signatureRecord?.product_name,
      modelName: signatureRecord?.model_name,
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

const ADR_READING_NODES: Array<{ field: string; kind?: 'date' }> = [
  { field: 'decision_question' },
  { field: 'decision' },
  { field: 'applicability' },
  { field: 'trigger_signal' },
  { field: 'rationale' },
  { field: 'consequences' },
  { field: 'disposition_summary' },
];

export function AdrReadingLayout({
  obj,
  relatedEntries,
  locale,
}: {
  obj: Record<string, unknown>;
  relatedEntries: RelatedContentEntry[];
  locale: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-5">
      {ADR_READING_NODES.map((node) => (
        <AdrReadingNode
          key={node.field}
          title={getFieldLabel(node.field, locale)}
          value={obj[node.field]}
          issue={fieldIssue(obj, node.field)}
          locale={locale}
          kind={node.kind}
        />
      ))}
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

function AdrReadingNode({
  title,
  value,
  issue,
  locale,
  kind,
}: {
  title: string;
  value: unknown;
  issue?: FieldPresentationIssue;
  locale: string;
  kind?: 'date';
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  if (!hasDetailContent(value) && !issue) return null;

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? <FieldProblem issue={issue} /> : kind === 'date' ? (
        <span className="ldvh-definition-text">{formatDateTime(String(value))}</span>
      ) : (
        <StudyTextNodeContent value={value} />
      )}
    </ReadingNodeSection>
  );
}

const PITFALL_READING_NODES: Array<{ field: string }> = [
  { field: 'symptoms' },
  { field: 'trigger_conditions' },
  { field: 'scope_of_impact' },
  { field: 'applicability' },
  { field: 'validation_summary' },
  { field: 'root_cause' },
  { field: 'resolution' },
  { field: 'avoidance' },
  { field: 'disposition_summary' },
];

export function PitfallReadingLayout({
  obj,
  relatedEntries,
  locale,
}: {
  obj: Record<string, unknown>;
  relatedEntries: RelatedContentEntry[];
  locale: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-5">
      {PITFALL_READING_NODES.map((node) => (
        <PitfallReadingNode
          key={node.field}
          title={getFieldLabel(node.field, locale)}
          value={obj[node.field]}
          issue={fieldIssue(obj, node.field)}
          locale={locale}
        />
      ))}
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

function PitfallReadingNode({
  title,
  value,
  issue,
  locale,
}: {
  title: string;
  value: unknown;
  issue?: FieldPresentationIssue;
  locale: string;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  if (!hasDetailContent(value) && !issue) return null;

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? <FieldProblem issue={issue} /> : <PitfallTextNodeContent value={value} />}
    </ReadingNodeSection>
  );
}

export function PitfallTextNodeContent({ value }: { value: unknown }) {
  return (
    <div className="ldvh-study-node-content">
      <div className="ldvh-inline-markdown max-w-none">
        <Markdown remarkPlugins={[remarkGfm]}>{String(value)}</Markdown>
      </div>
    </div>
  );
}

const SPARK_READING_NODES: Array<{
  field: string;
  labelKey?: string;
  kind: 'intent' | 'summary' | 'evolution' | 'terminal';
}> = [
  { field: 'intent', kind: 'intent' },
  { field: 'summary', labelKey: 'current_summary', kind: 'summary' },
  { field: 'evolution', kind: 'evolution' },
  { field: 'terminal', labelKey: 'routing', kind: 'terminal' },
];
type SparkEvolutionEntry = { key: string; at: string; summary: string };

export function SparkReadingLayout({
  obj,
  locale,
}: {
  obj: Record<string, unknown>;
  locale: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-5">
      {SPARK_READING_NODES.map((node) => (
        <SparkReadingNode
          key={node.field}
          title={getSparkReadingNodeTitle(node, obj, locale)}
          obj={obj}
          locale={locale}
          kind={node.kind}
          issue={fieldIssue(obj, node.field)}
        />
      ))}
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

function getSparkReadingNodeTitle(
  node: (typeof SPARK_READING_NODES)[number],
  obj: Record<string, unknown>,
  locale: string,
) {
  if (node.kind === 'terminal') {
    if (obj.status === 'implemented' || obj.status === 'discarded') {
      return getObjectStatusLocale('spark', String(obj.status), locale);
    }
  }
  return getFieldLabel(node.labelKey ?? node.field, locale);
}

function SparkReadingNode({
  title,
  obj,
  locale,
  kind,
  issue,
}: {
  title: string;
  obj: Record<string, unknown>;
  locale: string;
  kind: 'intent' | 'summary' | 'evolution' | 'terminal';
  issue?: FieldPresentationIssue;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const hasContent = kind === 'intent'
    ? hasDetailContent(obj.intent)
    : kind === 'summary'
    ? hasDetailContent(obj.summary)
    : kind === 'evolution'
      ? hasDetailContent(obj.evolution)
      : hasSparkTerminalContent(obj);

  if (!hasContent && !issue) return null;

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {issue ? <FieldProblem issue={issue} /> : <>
      {kind === 'intent' && <StudyTextNodeContent value={obj.intent} className="ldvh-spark-reading-prose" />}
      {kind === 'summary' && <SparkSummaryNode value={obj.summary} />}
      {kind === 'evolution' && <SparkEvolutionNode value={obj.evolution} />}
      {kind === 'terminal' && <SparkTerminalNode obj={obj} />}
      </>}
    </ReadingNodeSection>
  );
}

function SparkSummaryNode({ value }: { value: unknown }) {
  return (
    <StudyTextNodeContent
      value={value}
      className="ldvh-spark-reading-prose"
    />
  );
}

function SparkEvolutionNode({ value }: { value: unknown }) {
  if (!Array.isArray(value)) return <StudyTextNodeContent value={value} />;
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
          <StudyTextNodeContent value={entry.summary} compact />
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

function SparkTerminalNode({ obj }: { obj: Record<string, unknown> }) {
  const updatedAt = typeof obj.updated_at === 'string' && obj.updated_at.trim().length > 0 ? obj.updated_at : null;
  const disposition = typeof obj.disposition_summary === 'string' && obj.disposition_summary.trim().length > 0
    ? obj.disposition_summary
    : null;

  return (
    <div className="min-w-0 rounded-md border border-ldvh-border/45 bg-ldvh-bg/45 px-3 py-2">
      {updatedAt && (
        <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ldvh-accent" aria-hidden="true" />
          <SparkTerminalTime value={updatedAt} />
        </div>
      )}
      {disposition && <StudyTextNodeContent value={disposition} compact />}
    </div>
  );
}

function SparkTerminalTime({ value }: { value: string }) {
  const [date, time] = formatDateTime(value).split(' ');
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono tabular-nums">
      <span className="ldvh-caption-strong min-w-0 break-words text-ldvh-text-secondary">{date}</span>
      {time && <span className="ldvh-meta-muted min-w-0 break-words leading-4">{time}</span>}
    </div>
  );
}

function hasSparkTerminalContent(obj: Record<string, unknown>) {
  const status = typeof obj.status === 'string' ? obj.status : '';
  return status === 'implemented'
    || status === 'discarded'
    || hasDetailContent(obj.disposition_summary);
}
