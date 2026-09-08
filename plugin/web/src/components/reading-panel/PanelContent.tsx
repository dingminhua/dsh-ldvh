import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, FileText, ExternalLink } from 'lucide-react';
import type { PanelContent } from '@/utils/panelContext';
import MarkdownPreview from '@/components/MarkdownPreview';
import CommitBreakingBadge from '@/components/CommitBreakingBadge';
import CommitPushStatusBadge from '@/components/CommitPushStatusBadge';
import CommitSignatureMeta from '@/components/CommitSignatureMeta';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import { useI18n } from '@/i18n/context';
import {
  FactReadFailureContent,
  FactReadingContent,
  ObjectIdentityHeader,
  getAuxiliaryMetaEntries,
  getObjectHeaderStatus,
} from '@/pages/ObjectDetail';
import { getCommitDetailLabels, getLocalizedObjectTitle, getObjectStatusLocale, getToggleLabel, getTypeLabel, type CommitDetailLabels } from '@/i18n/locales';
import { normalizeSignature } from '../../../shared/signature';
import { fetchDocContent, fetchObjectDetail, type CommitDetailPanelData, type CommitSignature, type DocContent, type ObjectDetail as ApiObjectDetail } from '@/utils/api';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { getCommitScopeLabel, getCommitTypeLabel } from '@/utils/commitLabels';
import { formatDateTime } from '@/utils/dateFormat';
import { getFactReadMeta, isReadableFact, type FactReadMeta } from '@/utils/factReadMeta';
import { getObjectUpdatedAt } from '@/utils/factChangeLog';
import {
  getCommitBodySectionsForReading,
  getCommitNodeNextState,
  isCommitDetailPanelData,
  parseCommitStat,
  stripCommitSignatureTrailers,
  type ParsedCommitStat,
} from '@/components/reading-panel/commitModel';

export function EmptyPanelPreview() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="ldvh-body-muted">{t('readingPanel.empty')}</p>
    </div>
  );
}

export function PanelContentRenderer({ content }: { content: PanelContent }) {
  switch (content.type) {
    case 'object': return <ObjectPreview content={content} />;
    case 'doc': return <DocPreview content={content} />;
    case 'web': return <WebPreview content={content} />;
    case 'yaml': return <YamlPreview content={content} />;
    case 'evidence': return <EvidencePreview content={content} />;
    case 'diff': return <DiffPreview content={content} />;
    default:
      return (
        <EmptyPanelPreview />
      );
  }
}

function WebPreview({ content }: { content: PanelContent }) {
  const { t } = useI18n();
  const { url } = content;
  if (!url) return <EmptyPanelPreview />;
  const openLabel = t('readingPanel.openNewTab');

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-ldvh-border bg-ldvh-panel px-3 py-2">
        <span className="ldvh-meta-primary min-w-0 flex-1 truncate">{url}</span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="ldvh-chip inline-flex shrink-0 items-center gap-1 rounded-md border border-ldvh-border bg-ldvh-bg px-2 py-1 text-ldvh-text-primary hover:border-ldvh-accent hover:text-ldvh-accent"
        >
          <ExternalLink size={12} />
          <span>{openLabel}</span>
        </a>
      </div>
      <iframe
        title={url}
        src={url}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer"
        className="min-h-0 flex-1 rounded-lg border border-ldvh-border bg-white"
      />
    </div>
  );
}

function ObjectPreview({ content }: { content: PanelContent }) {
  const { objectType, objectId, data } = content;
  const { locale, t } = useI18n();
  const [detail, setDetail] = useState<ApiObjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const obj = (data as Record<string, unknown> | undefined) ?? detail?.data;
  const readMeta = getFactReadMeta(obj);
  const readable = Boolean(obj && isReadableFact(readMeta));
  const status = readable ? detail?.summary.status ?? (obj?.status as string | undefined) : undefined;
  const headerStatus = getObjectHeaderStatus(objectType || '', status, obj || {});
  const title = getObjectTitle(obj, objectId, locale);
  const targetPath = readable ? readMeta.canonicalPath : undefined;
  const loading = !obj && !error && Boolean(objectType && objectId);
  const typeColor = objectType ? (CATEGORY_COLORS[objectType] || CATEGORY_COLORS.other) : CATEGORY_COLORS.other;

  useEffect(() => {
    if (data || !objectType || !objectId) {
      setDetail(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchObjectDetail(objectType, objectId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [data, objectType, objectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-ldvh-accent border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3">
        <p className="ldvh-body text-red-700 dark:text-red-300">{t('readingPanel.loadFailed')}</p>
        <p className="ldvh-meta mt-1 text-red-700/80 dark:text-red-300/80">{error}</p>
      </div>
    );
  }

  if (obj && !readable) {
    return <FactReadFailureNotice objectType={objectType} objectId={objectId} meta={readMeta} />;
  }

  return (
    <div className="space-y-4">
      <ObjectIdentityHeader
        objectType={objectType || ''}
        id={objectId || ''}
        title={title}
        target={objectId}
        typeColor={typeColor}
        typeLabel={getObjectTypeLabel(objectType, locale)}
        status={headerStatus}
        statusLabel={headerStatus ? getObjectStatusLocale(objectType || '', headerStatus, locale) : undefined}
        source={obj || {}}
        locale={locale}
        updated={<ObjectUpdatedMeta source={obj || {}} updatedAt={getObjectUpdatedAt(obj)} />}
        auxiliaryMetaEntries={obj ? getAuxiliaryMetaEntries(obj, objectType || '') : []}
        copyLabel={t('common.copyObjectId')}
        copiedLabel={t('common.copiedObjectId')}
        compact
      />
      {obj && readable && (
        <FactReadingContent
          obj={obj}
          objType={objectType || ''}
          locale={locale}
          objectPath={targetPath}
          carrier={readMeta.carrier}
        />
      )}
    </div>
  );
}

function FactReadFailureNotice({
  objectType,
  objectId,
  meta,
}: {
  objectType?: string;
  objectId?: string;
  meta: FactReadMeta;
}) {
  return (
    <div className="space-y-3 rounded-md border border-red-500/20 bg-red-500/10 p-3">
      <FactReadFailureContent type={objectType} id={objectId} meta={meta} />
    </div>
  );
}

function getObjectTitle(obj: Record<string, unknown> | undefined, objectId: string | undefined, locale: string) {
  if (!obj) return objectId || '—';
  return getLocalizedObjectTitle(obj as { title?: string; title_en?: string; title_zh?: string }, locale, objectId || '—');
}

function getObjectTypeLabel(objectType: string | undefined, locale: string) {
  if (!objectType) return '—';
  return getTypeLabel(objectType, locale);
}

function DocPreview({ content }: { content: PanelContent }) {
  const { t } = useI18n();
  const { docPath, data, carrier, docVariant } = content;
  const [doc, setDoc] = useState<DocContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docContent = typeof data === 'string' ? data : doc?.content ?? '';
  const truncated = doc?.truncated ?? false;
  const isMarkdown = carrier === 'markdown' || (!carrier && Boolean(docPath && /\.(md|markdown)$/i.test(docPath)));

  useEffect(() => {
    if (typeof data === 'string' || !docPath) {
      setDoc(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setDoc(null);
    setError(null);
    fetchDocContent(docPath)
      .then((result) => {
        if (!cancelled) setDoc(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [data, docPath]);

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3">
          <p className="ldvh-body text-red-700 dark:text-red-300">{t('readingPanel.docLoadFailed')}</p>
          <p className="ldvh-meta mt-1 text-red-700/80 dark:text-red-300/80">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!docContent ? (
        <div className="flex items-center justify-center rounded-md bg-ldvh-bg py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-ldvh-accent border-t-transparent" />
        </div>
      ) : isMarkdown ? (
        <article className="rounded-lg border border-ldvh-border bg-ldvh-panel px-4 py-4 shadow-sm shadow-black/10">
          <MarkdownPreview
            content={docContent}
            className={docVariant === 'research-report' ? 'ldvh-research-report-preview' : undefined}
          />
          {truncated && <p className="ldvh-caption mt-3">{t('readingPanel.truncated')}</p>}
        </article>
      ) : (
        <div className="rounded-md bg-ldvh-bg p-3">
          <pre className="ldvh-meta-primary whitespace-pre-wrap">
            {docContent}
          </pre>
          {truncated && <p className="ldvh-caption mt-3">{t('readingPanel.truncated')}</p>}
        </div>
      )}
    </div>
  );
}

function YamlPreview({ content }: { content: PanelContent }) {
  const { data } = content;
  const yamlText = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <div className="space-y-3">
      <div className="rounded-md bg-ldvh-bg p-3">
        <pre className="ldvh-meta-primary max-h-[600px] overflow-y-auto whitespace-pre-wrap">
          {yamlText}
        </pre>
      </div>
    </div>
  );
}

function EvidencePreview({ content }: { content: PanelContent }) {
  const { t } = useI18n();
  const { title, data } = content;
  const items = (data as Array<{ label: string; value: string }>) || [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-ldvh-text-secondary" />
        <h4 className="ldvh-card-title">{title || t('objectDetail.closureEvidence')}</h4>
      </div>
      {items.length === 0 ? (
        <p className="ldvh-caption">{t('readingPanel.noEvidence')}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="rounded-md bg-ldvh-bg p-3">
              <p className="ldvh-caption-strong mb-1">{item.label}</p>
              <p className="ldvh-meta-primary whitespace-pre-wrap">{item.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'add' | 'delete';
}) {
  const toneClass = tone === 'add'
    ? 'text-emerald-300'
    : tone === 'delete'
      ? 'text-red-700 dark:text-red-300'
      : 'text-ldvh-text-primary';

  return (
    <div className="rounded-md border border-ldvh-border bg-ldvh-bg px-3 py-2 text-center">
      <div className={`ldvh-stat-value font-mono leading-tight ${toneClass}`}>{value}</div>
      <div className="ldvh-caption mt-0.5">{label}</div>
    </div>
  );
}

function CommitReadingNodeSection({
  title,
  state,
  locale,
  onToggle,
  children,
}: {
  title: string;
  state: 'collapsed' | 'expanded';
  locale: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  const StateIcon = state === 'collapsed' ? ChevronDown : ChevronUp;
  const nextState = getCommitNodeNextState(state);
  const actionLabel = getToggleLabel(title, nextState, locale);

  return (
    <section className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      <button
        type="button"
        onClick={onToggle}
        aria-label={actionLabel}
        className={`ldvh-section-title flex w-full min-w-0 items-center gap-2 text-left transition-colors hover:text-ldvh-accent ${state === 'collapsed' ? '' : 'mb-3'}`}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ldvh-accent" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <StateIcon size={14} className="shrink-0 text-ldvh-text-secondary/80" aria-hidden="true" />
      </button>
      {state !== 'collapsed' && children}
    </section>
  );
}

function CommitSignatureSection({
  signature,
  labels,
}: {
  signature: CommitSignature;
  labels: CommitDetailLabels;
}) {
  const { productName, modelName } = normalizeSignature(signature);
  const identityEntries = [
    { label: labels.modelName, value: modelName },
    { label: labels.environmentName, value: productName },
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry.value));
  if (identityEntries.length === 0) return null;

  return (
    <section className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      <div className="ldvh-section-title mb-3 flex w-full min-w-0 items-center gap-2 text-left">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ldvh-accent" />
        <span className="min-w-0 flex-1 truncate">{labels.signature}</span>
      </div>
      <dl className="grid grid-cols-1 gap-y-3">
        {identityEntries.map((entry) => (
          <div key={entry.label} className="min-w-0">
            <dt className="ldvh-caption-strong">{entry.label}</dt>
            <dd className="ldvh-detail-semantic-body mt-1 break-words rounded-md border border-ldvh-border bg-ldvh-bg/40 px-3 py-2 font-mono">
              {entry.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CommitIdentitySection({
  entry,
  parsed,
  title,
  labels,
  locale,
}: {
  entry?: CommitDetailPanelData['entry'];
  parsed: ParsedCommitStat;
  title: string;
  labels: CommitDetailLabels;
  locale: string;
}) {
  const commitColor = entry?.category
    ? (CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.other)
    : CATEGORY_COLORS.other;
  const commitValue = entry?.shortHash || parsed.commit || '—';
  const copyValue = entry?.hash || commitValue;
  const timeText = entry?.date ? formatDateTime(entry.date) : parsed.date || '—';
  const timeValue = entry?.signature ? (
    <span className="ldvh-meta-muted min-w-0 truncate text-ldvh-text-secondary">
      {timeText}<CommitSignatureMeta signature={entry.signature} />
    </span>
  ) : timeText;
  const typeLabel = labels.commit;
  const headerMetaItems = [
    entry?.category ? getCommitTypeLabel(entry.category, locale) : '',
  ].filter(Boolean);
  const categoryMeta = headerMetaItems.length > 0 ? (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="ldvh-chip-sm border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary"
      >
        {labels.commit}
      </span>
      <span
        className="ldvh-chip-sm"
        style={{ backgroundColor: `${commitColor}18`, borderColor: `${commitColor}55`, color: commitColor }}
      >
        {headerMetaItems[0]}
      </span>
    </span>
  ) : null;

  return (
    <ObjectIdentityHeader
      title={title}
      id={headerMetaItems.join(' · ')}
      target={copyValue}
      objectType="changelog"
      typeColor={CATEGORY_COLORS.other} // 图标用中性色，与"提交"徽章一致；类别色只体现在 category badge 上
      typeLabel={typeLabel}
      source={{}}
      locale={locale}
      updated=""
      showDefaultDates={false}
      showTypeBadge={false}
      showActivityCount={false}
      // Human 2026-09-09：落款不显示「提交」label——时间/署名本身已自明。
      titleMetaEntries={[{ label: '', value: timeValue }]}
      titleMetaAlign="footerEnd"
      copyLabel={labels.copyHash}
      copiedLabel={labels.copiedHash}
      extraBadges={(
        <>
          {categoryMeta}
          {entry?.isBreaking && (
            <CommitBreakingBadge />
          )}
        </>
      )}
      actionBadges={entry?.pushStatus ? <CommitPushStatusBadge status={entry.pushStatus} /> : undefined}
    />
  );
}

export function CommitDetailIdentity({
  entry,
  stat,
  title,
}: {
  entry?: CommitDetailPanelData['entry'];
  stat: string;
  title?: string;
}) {
  const { locale, t } = useI18n();
  const parsed = parseCommitStat(stat);
  const displayTitle = entry?.description || entry?.message || title || t('readingPanel.changeDetail');
  const labels = getCommitDetailLabels(locale);

  return (
    <CommitIdentitySection
      entry={entry}
      parsed={parsed}
      title={displayTitle}
      labels={labels}
      locale={locale}
    />
  );
}

export function CommitDetailContent({
  entry,
  stat,
  title,
  showIdentity = true,
}: {
  entry?: CommitDetailPanelData['entry'];
  stat: string;
  title?: string;
  showIdentity?: boolean;
}) {
  const { locale, t } = useI18n();
  const [bodySectionStates, setBodySectionStates] = useState<Record<string, 'collapsed' | 'expanded'>>({});
  const [filesState, setFilesState] = useState<'collapsed' | 'expanded'>('collapsed');
  const [rawState, setRawState] = useState<'collapsed' | 'expanded'>('collapsed');
  const diffText = stat;
  const commitBody = entry?.body?.trim() ?? '';
  const readableCommitBody = stripCommitSignatureTrailers(commitBody);
  const parsed = parseCommitStat(diffText);
  const displayTitle = entry?.description || entry?.message || title || t('readingPanel.changeDetail');
  const labels = getCommitDetailLabels(locale);
  const summary = parsed.summary;
  const filesChanged = summary?.filesChanged ?? parsed.files.length;
  const insertions = summary?.insertions ?? parsed.files.reduce((total, file) => total + file.additions, 0);
  const deletions = summary?.deletions ?? parsed.files.reduce((total, file) => total + file.deletions, 0);
  const lines = diffText.split('\n');
  const commitBodySections = readableCommitBody ? getCommitBodySectionsForReading(readableCommitBody, labels.commitBody) : [];

  useEffect(() => {
    setBodySectionStates({});
  }, [entry?.hash, commitBody]);

  return (
    <div className="mb-6 flex flex-col gap-5">
      {showIdentity && (
        <CommitIdentitySection
          entry={entry}
          parsed={parsed}
          title={displayTitle}
          labels={labels}
          locale={locale}
        />
      )}

      <section className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
        <div className="ldvh-section-title mb-3 flex w-full min-w-0 items-center gap-2 text-left">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ldvh-accent" />
          <span className="min-w-0 flex-1 truncate">{labels.summary}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <CommitMetric label={labels.files} value={filesChanged} />
          <CommitMetric label={labels.insertions} value={insertions} tone="add" />
          <CommitMetric label={labels.deletions} value={deletions} tone="delete" />
        </div>
      </section>

      {commitBody && commitBodySections.map((section) => {
        const sectionState = bodySectionStates[section.key] ?? 'expanded';
        return (
          <CommitReadingNodeSection
            key={section.key}
            title={section.title}
            state={sectionState}
            locale={locale}
            onToggle={() => {
              setBodySectionStates((current) => ({
                ...current,
                [section.key]: getCommitNodeNextState(sectionState),
              }));
            }}
          >
            <div className="ldvh-research-node-content">
              <MarkdownPreview
                content={section.content}
                className="ldvh-inline-markdown ldvh-commit-body-markdown max-w-none"
              />
            </div>
          </CommitReadingNodeSection>
        );
      })}

      {/* {entry?.signature && <CommitSignatureSection signature={entry.signature} labels={labels} />} */}

      <CommitReadingNodeSection
        title={labels.changedFiles}
        state={filesState}
        locale={locale}
        onToggle={() => setFilesState((current) => getCommitNodeNextState(current))}
      >
        {parsed.files.length === 0 ? (
          <p className="ldvh-body-muted">{labels.noFiles}</p>
        ) : (
          <div className="divide-y divide-ldvh-border/70 rounded-lg border border-ldvh-border bg-ldvh-bg/40">
            {parsed.files.map((file) => (
              <div key={`${file.path}:${file.stat}`} className="px-3 py-2">
                <div className="ldvh-meta-primary break-all font-mono">{file.path}</div>
                <div className="ldvh-caption mt-1 font-mono text-ldvh-text-secondary">{file.stat}</div>
              </div>
            ))}
          </div>
        )}
      </CommitReadingNodeSection>

      <CommitReadingNodeSection
        title={labels.raw}
        state={rawState}
        locale={locale}
        onToggle={() => setRawState((current) => getCommitNodeNextState(current))}
      >
        {diffText ? (
          <pre className="ldvh-meta-primary max-h-[360px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-ldvh-border bg-ldvh-bg/40 px-3 py-2">
            {lines.map((line, i) => {
              let cls = 'text-ldvh-text-primary';
              if (line.startsWith('+')) cls = 'text-emerald-400';
              else if (line.startsWith('-')) cls = 'text-red-400';
              else if (line.startsWith('@@')) cls = 'text-ldvh-accent';
              return <div key={i} className={cls}>{line}</div>;
            })}
          </pre>
        ) : (
          <p className="ldvh-body-muted">{labels.noFiles}</p>
        )}
      </CommitReadingNodeSection>
      </div>
  );
}

function DiffPreview({ content }: { content: PanelContent }) {
  const { title, data } = content;
  const commitData = isCommitDetailPanelData(data) ? data : null;

  return (
    <CommitDetailContent
      entry={commitData?.entry}
      stat={commitData?.stat ?? (typeof data === 'string' ? data : '')}
      title={title}
    />
  );
}
