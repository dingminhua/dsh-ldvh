import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Code2, ExternalLink, FileText, History } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ChecklistCard from '@/components/ChecklistCard';
import ReferenceCard from '@/components/ReferenceCard';
import SummaryText from '@/components/SummaryText';
import DocPreviewLink from '@/components/DocPreviewLink';
import EvidenceBlock from '@/components/EvidenceBlock';
import CopyPathButton from '@/components/CopyPathButton';
import ObjectReferenceCopyButton from '@/components/ObjectReferenceCopyButton';
import ObjectIdentityActions from '@/components/ObjectIdentityActions';
import WorkCaseCapabilityStatusBadge from '@/components/WorkCaseCapabilityStatusBadge';
import { hasUnavailableIndependentSubagentReview } from '@/shared/workcaseCapability';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import PriorityIcon from '@/components/PriorityIcon';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { fetchObjectDetail, type ObjectDetail, type WorkCaseDetailData } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import {
  getFieldLabel as getLocalizedFieldLabel,
  getFieldValueLabel,
  getLocalizedObjectTitle,
  getObjectStatusLocale,
  getToggleLabel,
  getTypeLabel,
} from '@/i18n/locales';
import { CATEGORY_COLORS } from '@/utils/categoryColors';
import { formatDateTime } from '@/utils/dateFormat';
import { getSignalClassName, getSignalText, isSignalField } from '@/utils/objectSignals';
import { usePanel } from '@/utils/panelContext';
import { useProjectScope } from '@/utils/projectContext';
import { getFactReadMeta, isReadableFact, reconstructFactYaml, type FactCarrier, type FactReadMeta } from '@/utils/factReadMeta';
import { isResolvedWorkCasePresentationProjection } from '@/shared/workcaseStatus';
import { WorkCaseReadingLayout } from '@/pages/object-detail/WorkCaseReadingLayout';
import { AdrReadingLayout, ChangeLogReadingNode, PitfallReadingLayout, PitfallTextNodeContent, SparkReadingLayout } from '@/pages/object-detail/FactReadingLayouts';
import { FactAssociationsSection } from '@/pages/object-detail/FactAssociationsSection';
import { fieldIssue } from '@/pages/object-detail/fieldIssues';
import {
  CHECKLIST_COMPAT_FIELDS,
  COLLAPSIBLE_FIELDS,
  DOC_LINK_FIELDS,
  EVIDENCE_FIELDS,
  PATH_TEXT_FIELDS,
  REFERENCE_FIELDS,
  SUMMARY_TEXT_FIELDS,
  getPreviewableDocPath,
  hasChecklist,
  isObjectRef,
  isPreviewablePathForField,
} from '@/utils/fieldFormats';
import {
  AUXILIARY_META_KEYS_BY_TYPE,
  COMMON_AUXILIARY_META_KEYS,
  getObjectDetailContentEntries,
  sortRelatedContentEntries,
  splitRelatedContentEntries,
  type RelatedContentEntry,
} from '@/pages/object-detail/model';

export {
  getObjectDetailContentEntries,
  sortRelatedContentEntries,
  splitRelatedContentEntries,
};
export type { RelatedContentEntry };
export { WorkCaseReadingLayout } from '@/pages/object-detail/WorkCaseReadingLayout';
export { AdrReadingLayout, PitfallReadingLayout, SparkReadingLayout } from '@/pages/object-detail/FactReadingLayouts';

const STUDY_READING_NODE_FIELDS = new Set([
  'research_intent', 'research_question', 'abstract', 'recommendation_summary', 'report_body',
  'report_kind', 'input_refs', 'change_log',
]);
const FORMAL_ASSOCIATION_FIELDS = new Set(['relations']);
export type ReadingNodeState = 'collapsed' | 'expanded';
type RelatedAssociationValue = {
  ref: string;
  title?: string;
  summary?: string;
};

export default function ObjectDetail() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, locale } = useI18n();

  // 保留上一次成功渲染的详情，仅当路由与缓存对象一致时复用（前进/后退/面板往返），
  // 避免全屏空白闪烁；切到不同对象时不展示旧内容，改走骨架加载
  const lastDetailRef = useRef<{ key: string; value: ObjectDetail } | null>(null);
  useEffect(() => {
    if (detail) {
      lastDetailRef.current = { key: `${detail.summary.type}/${detail.summary.id}`, value: detail };
    }
  }, [detail]);

  const currentKey = type && id ? `${type}/${id}` : null;
  const cached = currentKey && lastDetailRef.current?.key === currentKey ? lastDetailRef.current.value : null;
  const displayDetail = detail ?? cached;
  const isStale = !detail && displayDetail !== null;



  useEffect(() => {
    if (!type || !id) return;
    let cancelled = false;
    // 不再 setDetail(null)：保留旧详情做占位，新数据到达再替换，消除全屏空白闪烁
    setError(null);

    fetchObjectDetail(type, id)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-ldvh-text-secondary">{t('common.loadFailed')}</p>
          <p className="ldvh-meta text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  // 仅当连缓存都没有（首次进入）才显示全屏 spinner；
  // 路由切换加载期间沿用旧内容，由下方 isStale 轻提示代替
  if (!displayDetail) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ldvh-accent border-t-transparent" />
      </div>
    );
  }

  const obj = displayDetail.data;
  const objId = displayDetail.summary.id;
  const objType = displayDetail.summary.type;
  const readMeta = getFactReadMeta(obj);
  const objStatus = typeof displayDetail.summary.status === 'string'
    ? displayDetail.summary.status
    : undefined;
  const headerStatus = getObjectHeaderStatus(objType, objStatus, obj);
  const typeColor = CATEGORY_COLORS[objType] || CATEGORY_COLORS.other;
  const reportKind = typeof obj.report_kind === 'string' ? obj.report_kind : undefined;
  const reportKindColor = reportKind ? (CATEGORY_COLORS[reportKind] || CATEGORY_COLORS.other) : undefined;
  const reportKindBadge = reportKind && reportKindColor ? (
    <span
      className="ldvh-chip inline-flex h-[18px] shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-medium leading-3"
      style={{ backgroundColor: `${reportKindColor}18`, borderColor: `${reportKindColor}55`, color: reportKindColor }}
    >
      {getFieldValueLabel('report_kind', reportKind, locale)}
    </span>
  ) : undefined;
  const listSearch = searchParams.toString();
  const listPath = `/objects/${objType}${listSearch ? `?${listSearch}` : ''}`;
  const currentPath = `${location.pathname}${location.search}`;
  const returnPath = getReturnPath(location.state, currentPath) ?? listPath;

  if (!isReadableFact(readMeta)) {
    return <FactReadFailurePage returnPath={returnPath} type={objType} id={objId} meta={readMeta} />;
  }

  const displayTitle = getLocalizedObjectTitle(obj as LocalizedTitleItem, locale, objId);
  const auxiliaryMetaEntries = getAuxiliaryMetaEntries(obj, objType);
  const copyTarget = readMeta.canonicalPath;

  return (
    <div className="flex h-full">
      {/* Main content area */}
      <div className="flex-1 overflow-y-auto rounded-none transition-[margin] duration-300">
        {/* 切换加载中的细进度条：保留旧内容时给出轻提示 */}
        {isStale && (
          <div className="sticky top-0 z-30 h-0.5 w-full overflow-hidden bg-ldvh-border/40">
            <div className="h-full w-1/3 animate-pulse bg-ldvh-accent" />
          </div>
        )}
        <div className={`mx-auto max-w-4xl p-6 transition-opacity duration-150 ${isStale ? 'opacity-60' : 'opacity-100'}`}>
          <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 border-b border-ldvh-border bg-ldvh-bg/95 px-6 pb-4 pt-4 backdrop-blur">
          {/* Header */}
          <div>
            <button
              onClick={() => navigate(returnPath)}
              className="ldvh-body-muted mb-3 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-ldvh-border/50 hover:text-ldvh-text-primary"
            >
              <ArrowLeft size={14} />
              {t('objectDetail.back')}
            </button>
              <ObjectIdentityHeader
                title={displayTitle}
                id={objId}
                target={objId}
                objectType={objType}
                typeColor={typeColor}
                typeLabel={getTypeLabel(objType, locale)}
                status={headerStatus}
                statusLabel={headerStatus ? getObjectStatusLocale(objType, headerStatus, locale) : undefined}
                source={obj}
                locale={locale}
                updated={<ObjectUpdatedMeta source={obj} updatedAt={(obj.updated_at ?? obj.updated) as string | undefined} />}
                auxiliaryMetaEntries={auxiliaryMetaEntries}
                customMetaEntries={[]}
                extraBadges={reportKindBadge}
                copyLabel={t('common.copyObjectId')}
                copiedLabel={t('common.copiedObjectId')}
              />
              {(obj.mainWorktreeDiffers === true || (typeof obj.sourceBranch === 'string' && obj.sourceBranch.length > 0)) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {obj.mainWorktreeDiffers === true && (
                    <span className="ldvh-chip inline-flex h-[22px] shrink-0 items-center justify-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 text-[11px] font-medium leading-3 text-sky-600 dark:text-sky-400">
                      {t('objectList.mainWorktreeDiffers')}
                    </span>
                  )}
                  {typeof obj.sourceBranch === 'string' && obj.sourceBranch.length > 0 && (
                    <span className="ldvh-chip inline-flex h-[22px] shrink-0 items-center justify-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 text-[11px] font-medium leading-3 text-amber-600 dark:text-amber-400">
                      {t('objectList.sourceBranch', { branch: obj.sourceBranch })}
                    </span>
                  )}
                </div>
              )}
          </div>
          </div>

          <FactReadingContent
            obj={obj}
            objType={objType}
            locale={locale}
            objectPath={copyTarget}
            carrier={readMeta.carrier}
          />
        </div>
      </div>

      {/* Right reading panel */}
    </div>
  );
}

/**
 * The fact-reading body is intentionally shared by the full detail page and
 * secondary reading.  Only navigation and surrounding reading chrome differ.
 */
export function FactReadingContent({
  obj,
  objType,
  locale,
  objectPath,
  carrier,
}: {
  obj: Record<string, unknown>;
  objType: string;
  locale: string;
  objectPath?: string;
  carrier?: FactCarrier;
}) {
  const { t } = useI18n();
  const contentEntries = getObjectDetailContentEntries(obj, objType);
  const { primaryEntries, relatedEntries } = splitRelatedContentEntries(contentEntries);

  return (
    <>
      {objType === 'workcase' ? (
        <WorkCaseReadingLayout obj={obj as WorkCaseDetailData} locale={locale} />
      ) : objType === 'research' ? (
        <StudyReadingLayout
          obj={obj}
          extraEntries={primaryEntries}
          relatedEntries={relatedEntries}
          locale={locale}
          objectPath={objectPath}
          carrier={carrier}
        />
      ) : objType === 'adr' ? (
        <AdrReadingLayout obj={obj} relatedEntries={relatedEntries} locale={locale} />
      ) : objType === 'pitfall' ? (
        <PitfallReadingLayout obj={obj} relatedEntries={relatedEntries} locale={locale} />
      ) : objType === 'spark' ? (
        <SparkReadingLayout obj={obj} locale={locale} />
      ) : (
        <div className="mb-6 flex flex-col gap-5">
          {primaryEntries.map(([key, value]) => (
            <ContentField
              key={key}
              fieldKey={key}
              value={value}
              locale={locale}
              objType={objType}
              objectPath={objectPath}
            />
          ))}
          <RelatedContentSection entries={relatedEntries} locale={locale} />
        </div>
      )}

      <FieldIssuesSection value={obj.field_issues} />
      <UnparsedStructuresSection value={obj.unparsed_structures} />

      {(carrier === 'yaml' || objType === 'research') && (
        <YamlDataNode
          yamlSource={reconstructFactYaml(obj)}
          title={t('objectDetail.yamlSource')}
        />
      )}
    </>
  );
}

/** Use the same collapsible source node in full detail and secondary reading. */
export function YamlDataNode({ yamlSource, title }: { yamlSource: string; title: string }) {
  const [showYaml, setShowYaml] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-ldvh-border bg-ldvh-panel">
      <button
        type="button"
        aria-expanded={showYaml}
        onClick={() => setShowYaml(!showYaml)}
        className="ldvh-body-muted flex w-full items-center gap-2 p-3 transition-colors hover:bg-ldvh-border/30 hover:text-ldvh-text-primary"
      >
        <Code2 size={14} />
        <span>{title}</span>
        <span className="ml-auto">{showYaml ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </button>
      {showYaml && (
        <div className="border-t border-ldvh-border">
          <SyntaxHighlighter
            language="yaml"
            style={oneDark}
            customStyle={{ margin: 0, borderRadius: 0, fontSize: '12px', maxHeight: '400px' }}
            showLineNumbers
          >
            {yamlSource}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}

type UnparsedStructure = { path: string; reason: string; raw_value?: unknown };
type FieldIssue = { path: string; reason: 'missing' | 'type_mismatch' | 'identity_mismatch'; expected: string; raw_value?: unknown };

function FieldIssuesSection({ value }: { value: unknown }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const entries = Array.isArray(value)
    ? value.filter((entry): entry is FieldIssue => Boolean(
      entry && typeof entry === 'object' && !Array.isArray(entry)
        && typeof (entry as Record<string, unknown>).path === 'string'
        && typeof (entry as Record<string, unknown>).reason === 'string'
        && typeof (entry as Record<string, unknown>).expected === 'string',
    ))
    : [];
  if (entries.length === 0) return null;
  const reasonLabel = (issue: FieldIssue) => {
    if (issue.reason === 'missing') return t('objectDetail.fieldMissing');
    if (issue.reason === 'type_mismatch') return t('objectDetail.fieldTypeMismatch');
    return t('objectDetail.fieldIdentityMismatch');
  };
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-amber-500/25 bg-amber-500/5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="ldvh-body-muted flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-amber-500/5"
      >
        <span>{t('objectDetail.fieldIssues')}</span>
        <span className="ldvh-meta-muted">{entries.length}</span>
        <span className="ml-auto">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-amber-500/20 px-4 py-3">
          {entries.map((entry) => (
            <div key={`${entry.path}-${entry.reason}`} className="ldvh-meta rounded-md border border-amber-500/15 bg-ldvh-bg/50 px-3 py-2">
              <span className="font-mono text-ldvh-text-primary">{entry.path}</span>
              <span className="mx-2 text-amber-700 dark:text-amber-300">{reasonLabel(entry)}</span>
              <span>{t('objectDetail.fieldExpected', { expected: entry.expected })}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UnparsedStructuresSection({ value }: { value: unknown }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const entries = Array.isArray(value)
    ? value.filter((entry): entry is UnparsedStructure => Boolean(
      entry && typeof entry === 'object' && !Array.isArray(entry)
        && typeof (entry as Record<string, unknown>).path === 'string'
        && typeof (entry as Record<string, unknown>).reason === 'string',
    ))
    : [];
  if (entries.length === 0) return null;
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-amber-500/25 bg-amber-500/5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="ldvh-body-muted flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-amber-500/5"
      >
        <span>{t('objectDetail.unparsedStructures')}</span>
        <span className="ldvh-meta-muted">{entries.length}</span>
        <span className="ml-auto">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-amber-500/20 px-4 py-3">
          {entries.map((entry) => (
            <div key={`${entry.path}-${entry.reason}`} className="rounded-md border border-amber-500/15 bg-ldvh-bg/50 p-3">
              <p className="ldvh-meta-primary break-all font-mono">{entry.path}</p>
              <p className="ldvh-meta mt-1">{entry.reason}</p>
              {Object.prototype.hasOwnProperty.call(entry, 'raw_value') && (
                <pre className="ldvh-meta-primary mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{safeJson(entry.raw_value)}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function getReturnPath(state: unknown, currentPath: string): string | null {
  if (!state || typeof state !== 'object') return null;
  const from = (state as { from?: unknown }).from;
  if (typeof from !== 'string' || from.length === 0) return null;
  if (from === currentPath) return null;
  if (!from.startsWith('/')) return null;
  return from;
}

function FactReadFailurePage({
  returnPath,
  type,
  id,
  meta,
}: {
  returnPath: string;
  type: string;
  id: string;
  meta: FactReadMeta;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-6">
          <button
            onClick={() => navigate(returnPath)}
            className="ldvh-body-muted mb-4 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-ldvh-border/50 hover:text-ldvh-text-primary"
          >
            <ArrowLeft size={14} />
            {t('objectDetail.back')}
          </button>
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
            <FactReadFailureContent type={type} id={id} meta={meta} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shared unavailable-fact body for full detail and secondary reading. */
export function FactReadFailureContent({
  type,
  id,
  meta,
}: {
  type?: string;
  id?: string;
  meta: FactReadMeta;
}) {
  const { t, locale } = useI18n();
  const status = meta.readStatus ?? 'unavailable';
  return (
    <>
      <p className="ldvh-body text-red-700 dark:text-red-300">{t('objectDetail.readUnavailable')}</p>
      <dl className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="ldvh-meta-muted">{t('objectDetail.readType')}</dt>
        <dd className="ldvh-meta-primary">{type ? getTypeLabel(type, locale) : '—'} · {id || '—'}</dd>
        <dt className="ldvh-meta-muted">{t('objectDetail.readStatus')}</dt>
        <dd className="ldvh-meta-primary">{getFieldValueLabel('read_status', status, locale)}</dd>
        {meta.canonicalPath && (
          <>
            <dt className="ldvh-meta-muted">{t('objectDetail.expectedPath')}</dt>
            <dd className="ldvh-meta-primary break-all font-mono">{meta.canonicalPath}</dd>
          </>
        )}
      </dl>
      {meta.issues.length > 0 && (
        <div className="mt-3 space-y-1">
          {meta.issues.map((issue, index) => (
            <p key={`${issue.category}-${issue.fieldPath ?? 'root'}-${index}`} className="ldvh-meta text-red-700/80 dark:text-red-300/80">
              {issue.fieldPath ? `${issue.fieldPath}：${issue.summary}` : issue.summary}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

type LocalizedTitleItem = {
  id: string;
  title?: string;
  title_en?: string;
  title_zh?: string;
};

export function getLocalizedTitle(item: LocalizedTitleItem, locale: string): string {
  return getLocalizedObjectTitle(item, locale, item.id);
}

export function getObjectHeaderStatus(
  objectType: string,
  status: string | undefined,
  source: Record<string, unknown>,
): string | undefined {
  if (objectType !== 'workcase') return status;
  if (!isResolvedWorkCasePresentationProjection(source.current_snapshot_projection)) return 'unknown';
  if (source.current_snapshot_projection.progress_group === 'closed' && source.closure_outcome === 'cancelled') return 'discarded';
  return source.current_snapshot_projection.progress_group;
}

export function ObjectIdentityHeader({
  title,
  id: _id,
  target,
  objectType,
  typeColor,
  typeLabel,
  status,
  statusLabel,
  source,
  locale,
  updated,
  auxiliaryMetaEntries = [],
  extraBadges,
  actionBadges,
  titleMetaEntries = [],
  customMetaEntries = [],
  copyLabel,
  copiedLabel,
  titleMetaAlign = 'content',
  showDefaultDates = true,
  showCopyAction = true,
  showTypeBadge = true,
  showActivityCount = true,
  compact = false,
}: {
  title: string;
  id: string;
  target?: string;
  objectType: string;
  typeColor: string;
  typeLabel: string;
  status?: string;
  statusLabel?: string;
  source: Record<string, unknown>;
  locale: string;
  updated: ReactNode;
  auxiliaryMetaEntries?: Array<[string, unknown]>;
  extraBadges?: ReactNode;
  actionBadges?: ReactNode;
  titleMetaEntries?: Array<{ label: string; value: ReactNode }>;
  customMetaEntries?: Array<{ label: string; value: ReactNode }>;
  copyLabel?: string;
  copiedLabel?: string;
  titleMetaAlign?: 'content' | 'actions' | 'footerEnd';
  showDefaultDates?: boolean;
  showCopyAction?: boolean;
  showTypeBadge?: boolean;
  showActivityCount?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { selectedProjectId } = useProjectScope();
  const TitleTag = compact ? 'h3' : 'h1';
  const titleClassName = compact ? 'ldvh-reading-title' : 'ldvh-page-title';
  const titleFontSize = compact ? 16 : 20;
  const titleIconSize = Math.round(titleFontSize * 1.25);
  const activityCount = Array.isArray(source.change_log) ? source.change_log.length : 0;
  const remainingAuxiliaryMetaEntries = auxiliaryMetaEntries.filter(([key]) => key !== 'priority');
  const hasFooterMeta = showDefaultDates
    || remainingAuxiliaryMetaEntries.length > 0
    || customMetaEntries.length > 0;
  const inlineTitleMeta = titleMetaAlign === 'content' ? titleMetaEntries : [];
  const actionAlignedTitleMeta = titleMetaAlign === 'actions' ? titleMetaEntries : [];
  const footerEndTitleMeta = titleMetaAlign === 'footerEnd' ? titleMetaEntries : [];
  const capabilityStatusBadge = hasUnavailableIndependentSubagentReview(source)
    ? <WorkCaseCapabilityStatusBadge source={source} />
    : null;
  return (
    <div className={compact ? 'min-w-0' : 'rounded-lg border border-ldvh-border bg-ldvh-panel px-4 py-3'}>
      <div className="min-w-0">
        <div className="min-w-0">
          <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {showTypeBadge && (
              <span
                className="ldvh-chip inline-flex h-[18px] shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-medium leading-3"
                style={{ backgroundColor: `${typeColor}18`, borderColor: `${typeColor}55`, color: typeColor }}
              >
                {typeLabel}
              </span>
            )}
            {extraBadges}
            <PriorityIcon source={source} type={objectType} locale={locale} size="xs" />
            {showActivityCount && (
              <span
                className="ldvh-chip inline-flex h-[18px] shrink-0 items-center justify-center gap-1 rounded-md border border-ldvh-accent/25 bg-ldvh-accent/5 px-[5px] text-[10px] font-medium leading-3 text-ldvh-accent"
                title={t('cognition.recent.activityCount', { count: String(activityCount) })}
              >
                <History size={12} aria-hidden="true" />
                <span>{activityCount}</span>
              </span>
            )}
            {(capabilityStatusBadge || status || actionBadges || showCopyAction) && (
              <div className="ml-auto shrink-0">
                <ObjectIdentityActions
                  status={status}
                  statusLabel={statusLabel}
                  objectType={objectType}
                  projectId={selectedProjectId}
                  target={target}
                  statusLeadingBadges={capabilityStatusBadge}
                  actionBadges={actionBadges}
                  copyLabel={copyLabel}
                  copiedLabel={copiedLabel}
                  showCopyAction={showCopyAction}
                  compact
                />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <TitleTag className={`${titleClassName} ldvh-object-title-tray flex min-w-0 flex-1 basis-full translate-y-0.5 items-start gap-2 break-words px-2.5 py-2`}>
              <ObjectTypeIcon type={objectType} size={titleIconSize} className="mt-0.5 shrink-0" style={{ color: typeColor }} />
              <span className="min-w-0">{title}</span>
            </TitleTag>
            {inlineTitleMeta.length > 0 && (
              <div className="ml-auto flex min-w-0 basis-full flex-wrap items-center justify-end gap-x-4 gap-y-1 text-right">
                {inlineTitleMeta.map((entry) => (
                  <HeaderDateMeta key={entry.label} label={entry.label} value={entry.value} />
                ))}
              </div>
            )}
          </div>
          {actionAlignedTitleMeta.length > 0 && (
            <div className="mt-1 flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-right">
              {actionAlignedTitleMeta.map((entry) => (
                <HeaderDateMeta key={entry.label} label={entry.label} value={entry.value} />
              ))}
            </div>
          )}
        </div>
      </div>
      {hasFooterMeta && (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-right">
          {showDefaultDates && <span className="opacity-70"><HeaderDateMeta value={updated} /></span>}
          {remainingAuxiliaryMetaEntries.map(([key, value]) => (
            <HeaderDateMeta
              key={key}
              label={getFieldLabel(key, locale)}
              value={formatAuxiliaryMetaValue(key, value, locale)}
            />
          ))}
          {customMetaEntries.map((entry) => (
            <HeaderDateMeta key={entry.label} label={entry.label} value={entry.value} />
          ))}
        </div>
      )}
      {footerEndTitleMeta.length > 0 && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-right">
          {footerEndTitleMeta.map((entry) => (
            <HeaderDateMeta key={entry.label} label={entry.label} value={entry.value} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Shared object-header update line for full details and secondary reading. */
function HeaderDateMeta({ label, value, align = 'end' }: { label?: string; value: ReactNode; align?: 'start' | 'end' }) {
  const valueClassName = typeof value === 'string'
    ? 'ldvh-meta-muted min-w-0 truncate text-ldvh-text-secondary'
    : 'min-w-0';
  const alignClassName = align === 'start' ? 'justify-start text-left' : 'justify-end text-right';
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${alignClassName}`}>
      {label && <span className="ldvh-caption shrink-0 leading-4">{label}</span>}
      <span className={`${valueClassName} leading-4`}>{value}</span>
    </span>
  );
}

export function MaterialRow({
  fieldKey,
  value,
  locale,
  referenceVariant = 'card',
}: {
  fieldKey: string;
  value: unknown;
  locale: string;
  referenceVariant?: 'card' | 'plain';
}) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <div className="grid grid-cols-[5.625rem_minmax(0,1fr)] gap-2 py-3 first:pt-0 last:pb-0">
      <div className="ldvh-caption-strong text-ldvh-text-secondary">{getMaterialLabel(fieldKey, locale)}</div>
      <MaterialValue fieldKey={fieldKey} value={value} locale={locale} referenceVariant={referenceVariant} />
    </div>
  );
}

function MaterialValue({
  fieldKey,
  value,
  locale,
  referenceVariant = 'card',
}: {
  fieldKey: string;
  value: unknown[];
  locale: string;
  referenceVariant?: 'card' | 'plain';
}) {
  return (
    <div className="min-w-0">
      {DOC_LINK_FIELDS.includes(fieldKey) && typeof value[0] === 'string'
        ? <DocumentOrTextList items={value as string[]} fieldKey={fieldKey} variant={referenceVariant} />
        : REFERENCE_FIELDS.includes(fieldKey) && typeof value[0] === 'string'
          ? <ReferenceCard refs={value as string[]} showType={false} showStatus={false} variant={referenceVariant} />
          : <FieldValue fieldKey={fieldKey} value={value} depth={0} locale={locale} />}
    </div>
  );
}

function RelatedMaterialValue({
  fieldKey,
  value,
  locale,
}: {
  fieldKey: string;
  value: unknown[];
  locale: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((item, index) => {
        const reference = parseRelatedAssociationValue(item);
        return reference ? (
          <RelatedAssociationRow key={`${fieldKey}-${index}-${reference.ref}`} fieldKey={fieldKey} reference={reference} locale={locale} />
        ) : (
          <FieldValue key={`${fieldKey}-${index}`} fieldKey={fieldKey} value={item} depth={0} locale={locale} />
        );
      })}
    </div>
  );
}

function parseRelatedAssociationValue(item: unknown): RelatedAssociationValue | null {
  if (typeof item === 'string') return { ref: item };
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (typeof record.ref !== 'string' || record.ref.trim().length === 0) return null;
  return {
    ref: record.ref,
    title: typeof record.title === 'string' && record.title.trim() ? record.title : undefined,
    summary: typeof record.summary === 'string' && record.summary.trim() ? record.summary : undefined,
  };
}

function RelatedAssociationRow({ fieldKey, reference, locale }: { fieldKey: string; reference: RelatedAssociationValue; locale: string }) {
  const { t } = useI18n();
  const { selectedProjectId } = useProjectScope();
  const { isOpen: panelOpen, content: panelContent, openPanel } = usePanel();
  const [objectInfo, setObjectInfo] = useState<{ type: string; title: string } | null>(null);
  const [objectMissing, setObjectMissing] = useState(false);
  const value = reference.ref;
  const objectType = parseRefType(value);
  const objectColor = objectType ? (CATEGORY_COLORS[objectType] || CATEGORY_COLORS.other) : CATEGORY_COLORS.other;
  const isExternal = value.startsWith('http://') || value.startsWith('https://');
  const isDocPreview = DOC_LINK_FIELDS.includes(fieldKey) && isPreviewablePathForField(fieldKey, value);
  const previewDocPath = isDocPreview ? getPreviewableDocPath(value) : value;
  const fallbackTitle = objectType
    ? t('common.loading')
    : value;
  const displayTitle = reference.title || objectInfo?.title || (objectMissing ? value : fallbackTitle);
  const copyValue = value;
  const copyLabel = objectType
    ? t('common.copyObjectId')
    : isExternal
      ? t('common.copyUrl')
      : isDocPreview
        ? t('common.copyDocPath')
        : t('common.copyReference');
  const copiedLabel = objectType
    ? t('common.copiedObjectId')
    : isExternal
      ? t('common.copiedUrl')
      : isDocPreview
        ? t('common.copiedDocPath')
        : t('common.copiedReference');
  const previewLabel = t('objectDetail.openReadingPanel');
  const isCurrentPanelOpen = Boolean(
    panelOpen && (
      (objectType && panelContent?.type === 'object' && panelContent.objectType === objectType && panelContent.objectId === value)
      || (isExternal && panelContent?.type === 'web' && panelContent.url === value)
      || (!isExternal && isDocPreview && panelContent?.type === 'doc' && panelContent.docPath === previewDocPath)
      || (!isDocPreview && !objectType && panelContent?.type === 'doc' && panelContent.title === value)
    )
  );
  const PanelIcon = isCurrentPanelOpen ? ChevronLeft : ChevronRight;

  useEffect(() => {
    if (!objectType) {
      setObjectInfo(null);
      setObjectMissing(false);
      return;
    }

    let cancelled = false;
    setObjectInfo(null);
    setObjectMissing(false);
    fetchObjectDetail(objectType, value)
      .then((detail) => {
        if (cancelled) return;
        const obj = detail.data;
        const title = getLocalizedObjectTitle(obj as LocalizedTitleItem, locale, value);
        setObjectInfo({
          type: objectType,
          title,
        });
      })
      .catch(() => {
        if (!cancelled) setObjectMissing(true);
      });

    return () => {
      cancelled = true;
    };
  }, [locale, objectType, value]);

  const openRelatedPreview = () => {
    if (objectType) {
      openPanel({ type: 'object', title: displayTitle, objectType, objectId: value });
      return;
    }
    if (isExternal) {
      openPanel({ type: 'web', title: displayTitle, url: value });
      return;
    }
    if (isDocPreview) {
      openPanel({ type: 'doc', title: displayTitle, docPath: previewDocPath });
      return;
    }
    openPanel({ type: 'doc', title: displayTitle, data: reference.summary ? `${displayTitle}\n\n${reference.summary}\n\n${value}` : value });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openRelatedPreview();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openRelatedPreview}
      onKeyDown={handleKeyDown}
      title={previewLabel}
      className="ldvh-body group flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
    >
      {objectType ? (
        <ObjectTypeIcon type={objectType} size={13} className="shrink-0" style={{ color: objectColor }} />
      ) : isExternal ? (
        <ExternalLink size={13} className="shrink-0 text-ldvh-accent" />
      ) : (
        <FileText size={13} className="shrink-0 text-ldvh-accent" />
      )}
      <div className="min-w-0 flex-1">
        <div className="ldvh-meta-primary truncate">{displayTitle}</div>
        {reference.summary && (
          <div className="ldvh-caption mt-1 whitespace-pre-wrap text-ldvh-text-secondary/70">{reference.summary}</div>
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-1">
        {objectType
          ? <ObjectReferenceCopyButton projectId={selectedProjectId} objectId={value} label={copyLabel} copiedLabel={copiedLabel} />
          : <CopyPathButton path={copyValue} label={copyLabel} copiedLabel={copiedLabel} />}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openRelatedPreview();
          }}
          title={previewLabel}
          aria-label={previewLabel}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-ldvh-text-secondary/70 transition-colors hover:bg-ldvh-border/30 hover:text-ldvh-accent focus-visible:border-ldvh-accent/50 focus-visible:outline-none"
        >
          <PanelIcon size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function getMaterialLabel(fieldKey: string, locale: string) {
  return getFieldLabel(fieldKey, locale);
}

export function hasDetailContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
}

const EVIDENCE_NODE_ORDER = ['验证计划', '验证命令', '验证结果', '结论'];

export function EvidenceReadingNodes({ value }: { value: string }) {
  const sections = parseEvidenceReadingSections(value);
  if (sections.length === 0) {
    return <PitfallTextNodeContent value={value} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.title} className="min-w-0">
          <div className="ldvh-caption-strong mb-1.5 flex items-center gap-2 text-ldvh-text-secondary">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ldvh-text-secondary/45" aria-hidden="true" />
            <span>{section.title}</span>
          </div>
          <div className="ldvh-research-node-content pl-3">
            <div className="ldvh-inline-markdown max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>{section.body}</Markdown>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function parseEvidenceReadingSections(value: string): Array<{ title: string; body: string }> {
  const lines = value.split('\n');
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

  if (sections.length === 0) return [];
  return sections
    .sort((a, b) => {
      const aIndex = EVIDENCE_NODE_ORDER.indexOf(a.title);
      const bIndex = EVIDENCE_NODE_ORDER.indexOf(b.title);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    })
    .map((section) => ({ title: section.title, body: section.body.join('\n').trim() }))
    .filter((section) => section.body.length > 0);
}

export function RelatedContentSection({
  entries,
  locale,
  title,
}: {
  entries: RelatedContentEntry[];
  locale: string;
  title?: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('collapsed');
  if (entries.length === 0) return null;
  return (
    <ReadingNodeSection
      title={title ?? t('objectDetail.related')}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <div className="divide-y divide-ldvh-border/60">
        {entries.map(([fieldKey, value]) => (
          <div key={fieldKey} className="py-3 first:pt-0 last:pb-0">
            <div className="ldvh-caption-strong mb-2">{getMaterialLabel(fieldKey, locale)}</div>
            <RelatedMaterialValue fieldKey={fieldKey} value={value} locale={locale} />
          </div>
        ))}
      </div>
    </ReadingNodeSection>
  );
}

export function getAuxiliaryMetaEntries(obj: Record<string, unknown>, objType: string) {
  const keys = Array.from(new Set([...(AUXILIARY_META_KEYS_BY_TYPE[objType] || []), ...COMMON_AUXILIARY_META_KEYS]));
  return keys
    .filter((key) => key !== 'priority' || (objType !== 'spark' && objType !== 'workcase'))
    .filter((key) => key !== 'scope' || objType !== 'workcase')
    .map((key) => [key, obj[key]] as [string, unknown])
    .filter(([, value]) => value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0));
}

export function getFieldLabel(fieldKey: string, locale: string) {
  return getLocalizedFieldLabel(fieldKey, locale);
}

function localizeMetaValue(fieldKey: string, rawValue: string, locale: string) {
  if (isSignalField(fieldKey)) {
    return getSignalText(fieldKey, rawValue, locale) || rawValue.trim();
  }
  const normalized = rawValue.trim();
  const localized = getFieldValueLabel(fieldKey, normalized, locale);
  return localized === normalized ? normalized.replace(/_/g, ' ') : localized;
}

function MetaValueChip({ fieldKey, value, children }: { fieldKey?: string; value?: unknown; children: ReactNode }) {
  const signalClass = fieldKey && isSignalField(fieldKey)
    ? getSignalClassName(fieldKey, value)
    : 'border-ldvh-border bg-ldvh-bg text-ldvh-text-primary';
  return (
    <span className={`ldvh-chip rounded-md border px-2 py-0.5 font-sans ${signalClass}`}>
      {children}
    </span>
  );
}

function formatAuxiliaryMetaValue(fieldKey: string, value: unknown, locale: string): ReactNode {
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {value.map((item, index) => (
          <MetaValueChip key={`${fieldKey}-${index}`} fieldKey={fieldKey} value={item}>
            {localizeMetaValue(fieldKey, String(item), locale)}
          </MetaValueChip>
        ))}
      </span>
    );
  }

  return (
    <MetaValueChip fieldKey={fieldKey} value={value}>
      {localizeMetaValue(fieldKey, String(value), locale)}
    </MetaValueChip>
  );
}

export function DetailSection({
  title,
  tone,
  icon,
  children,
}: {
  title: string;
  tone: 'primary' | 'checklist' | 'evidence' | 'docs' | 'default';
  icon?: ReactNode;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const [state, setState] = useState<ReadingNodeState>('expanded');
  const StateIcon = getReadingNodeIcon(state);
  const toneClass = {
    primary: 'border-ldvh-border bg-ldvh-panel',
    checklist: 'border-ldvh-border bg-ldvh-panel',
    evidence: 'border-ldvh-border bg-ldvh-panel',
    docs: 'border-ldvh-border bg-ldvh-panel',
    default: 'border-ldvh-border bg-ldvh-panel',
  }[tone];

  return (
    <section className={`rounded-xl border p-4 ${toneClass}`}>
      <button
        type="button"
        onClick={() => setState((current) => getReadingNodeNextState(current))}
        aria-label={getReadingNodeAriaLabel(title, state, locale)}
        className={`ldvh-section-title flex w-full min-w-0 items-center gap-2 text-left transition-colors hover:text-ldvh-accent ${state === 'collapsed' ? '' : 'mb-3'}`}
      >
        {icon ?? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ldvh-accent" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <StateIcon size={14} className="shrink-0 text-ldvh-text-secondary/80" aria-hidden="true" />
      </button>
      {state !== 'collapsed' && children}
    </section>
  );
}

export function getReadingNodeNextState(state: ReadingNodeState): ReadingNodeState {
  return state === 'collapsed' ? 'expanded' : 'collapsed';
}

function getReadingNodeIcon(state: ReadingNodeState) {
  if (state === 'collapsed') return ChevronDown;
  return ChevronUp;
}

function getReadingNodeAriaLabel(title: string, state: ReadingNodeState, locale: string) {
  const nextState = getReadingNodeNextState(state);
  return getToggleLabel(title, nextState, locale);
}

export function ReadingNodeSection({
  title,
  state,
  locale,
  headerMeta,
  children,
  onToggle,
}: {
  title: string;
  state: ReadingNodeState;
  locale: string;
  headerMeta?: ReactNode;
  children: ReactNode;
  onToggle: () => void;
}) {
  const StateIcon = getReadingNodeIcon(state);

  return (
    <section className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      <button
        type="button"
        onClick={onToggle}
        aria-label={getReadingNodeAriaLabel(title, state, locale)}
        className={`ldvh-section-title flex w-full min-w-0 items-center gap-2 text-left transition-colors hover:text-ldvh-accent ${state === 'collapsed' ? '' : 'mb-3'}`}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ldvh-accent" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {headerMeta}
        <StateIcon size={14} className="shrink-0 text-ldvh-text-secondary/80" aria-hidden="true" />
      </button>
      {state !== 'collapsed' && children}
    </section>
  );
}

export function DetailInlineField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.625rem_minmax(0,1fr)] gap-2 py-3 first:pt-0 last:pb-0">
      <div className="ldvh-caption-strong text-ldvh-text-secondary">{label}</div>
      <div className="min-w-0">{value}</div>
    </div>
  );
}

export function DetailDocGroup({ label, docs }: { label: string; docs?: string[] }) {
  if (!docs || docs.length === 0) return null;
  return (
    <div className="rounded-lg border border-ldvh-border bg-ldvh-bg/40 p-3">
      <div className="ldvh-caption-strong mb-2">{label}</div>
      <DocPreviewLink docs={docs} />
    </div>
  );
}

function PathText({ value }: { value: string }) {
  return (
    <span className="ldvh-meta-primary break-all rounded-md border border-ldvh-border bg-ldvh-bg px-2 py-1">
      {value}
    </span>
  );
}

export function StringList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={i} className="ldvh-chip rounded-md border border-ldvh-border bg-ldvh-bg px-2 py-0.5 text-ldvh-text-primary">
          {item}
        </span>
      ))}
    </div>
  );
}

function DocumentOrTextList({ items, fieldKey, variant = 'card' }: { items: string[]; fieldKey: string; variant?: 'card' | 'plain' }) {
  const docs = items.filter((item) => isPreviewablePathForField(fieldKey, item));
  const rest = items.filter((item) => !isPreviewablePathForField(fieldKey, item));
  return (
    <div className="flex flex-col gap-2">
      {docs.length > 0 && <DocPreviewLink docs={docs} variant={variant} />}
      {rest.length > 0 && <StringList items={rest} />}
    </div>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return <span className="ldvh-body-muted">{text}</span>;
}

/** 内容字段：根据字段类型选择渲染方式和样式 */
function basename(path: string) {
  return path.split('/').filter(Boolean).pop() || path;
}

const STUDY_READING_NODES: Array<{ field: string; kind: 'text' | 'report' }> = [
  { field: 'research_intent', kind: 'text' },
  { field: 'abstract', kind: 'text' },
  { field: 'recommendation_summary', kind: 'text' },
  { field: 'report_body', kind: 'report' },
];

function StudyInputRefsNode({ obj, locale }: { obj: Record<string, unknown>; locale: string }) {
  const inputRefs = Array.isArray(obj.input_refs)
    ? obj.input_refs.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
    : [];
  const [state, setState] = useState<ReadingNodeState>('collapsed');
  if (inputRefs.length === 0) return null;

  return (
    <ReadingNodeSection
      title={getFieldLabel('input_refs', locale)}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      <div className="divide-y divide-ldvh-border/60">
        {inputRefs.map((ref, index) => {
          const meta = [
            typeof ref.kind === 'string' ? ref.kind : null,
            typeof ref.version === 'string' ? ref.version : null,
            typeof ref.observed_at === 'string' ? formatDateTime(ref.observed_at) : null,
          ].filter((value): value is string => Boolean(value));

          return (
            <div key={`${String(ref.kind)}-${String(ref.locator)}-${index}`} className="min-w-0 py-2.5 first:pt-0 last:pb-0">
              {meta.length > 0 && (
                <div className="ldvh-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium text-ldvh-text-primary/80">
                  <span aria-hidden="true" className="h-1 w-1 shrink-0 self-center rounded-full bg-ldvh-text-primary/55" />
                  {meta.map((value, metaIndex) => (
                    <span key={`${value}-${metaIndex}`} className="inline-flex items-center gap-x-1.5">
                      {metaIndex > 0 && <span aria-hidden="true">·</span>}
                      <span>{value}</span>
                    </span>
                  ))}
                </div>
              )}
              {typeof ref.locator === 'string' && (
                <p className="mt-1 ldvh-meta break-words text-ldvh-text-secondary/80">{ref.locator}</p>
              )}
            </div>
          );
        })}
      </div>
    </ReadingNodeSection>
  );
}

export function StudyReadingLayout({
  obj,
  extraEntries,
  relatedEntries,
  locale,
  objectPath,
  carrier,
}: {
  obj: Record<string, unknown>;
  extraEntries: Array<[string, unknown]>;
  relatedEntries: RelatedContentEntry[];
  locale: string;
  objectPath?: string;
  carrier?: FactCarrier;
}) {
  const extraPrimaryEntries = extraEntries.filter(
    ([fieldKey]) => !STUDY_READING_NODE_FIELDS.has(fieldKey) && !FORMAL_ASSOCIATION_FIELDS.has(fieldKey),
  );

  return (
    <div className="mb-6 flex flex-col gap-5">
      {STUDY_READING_NODES.map((node) => (
        <StudyReadingNode
          key={node.field}
          title={getFieldLabel(node.field, locale)}
          value={obj[node.field]}
          locale={locale}
          kind={node.kind}
          objectPath={objectPath}
          carrier={carrier}
        />
      ))}
      {extraPrimaryEntries.map(([fieldKey, value]) => (
        <ContentField
          key={fieldKey}
          fieldKey={fieldKey}
          value={value}
          locale={locale}
          objType="research"
          objectPath={objectPath}
        />
      ))}
      <FactAssociationsSection obj={obj} locale={locale} />
      <RelatedContentSection entries={relatedEntries} locale={locale} />
      <StudyInputRefsNode obj={obj} locale={locale} />
      <ChangeLogReadingNode value={obj.change_log} issue={fieldIssue(obj, 'change_log')} locale={locale} />
    </div>
  );
}

function StudyReadingNode({
  title,
  value,
  locale,
  kind,
  objectPath,
  carrier,
}: {
  title: string;
  value: unknown;
  locale: string;
  kind: 'text' | 'report';
  objectPath?: string;
  carrier?: FactCarrier;
}) {
  const [state, setState] = useState<ReadingNodeState>('expanded');
  if (!hasDetailContent(value)) return null;

  return (
    <ReadingNodeSection
      title={title}
      state={state}
      locale={locale}
      onToggle={() => setState((current) => getReadingNodeNextState(current))}
    >
      {kind === 'report' ? (
        <StudyReportBodyEntry value={value} objectPath={objectPath} carrier={carrier} />
      ) : (
        <StudyTextNodeContent value={value} />
      )}
    </ReadingNodeSection>
  );
}

function StudyReportBodyEntry({
  value,
  objectPath,
  carrier,
}: {
  value: unknown;
  objectPath?: string;
  carrier?: FactCarrier;
}) {
  const { t } = useI18n();
  const { openPanel } = usePanel();
  const docPath = objectPath;
  const title = objectPath ? basename(objectPath) : t('objectDetail.reportBody');
  const openLabel = t('objectDetail.openReadingPanel');
  const openReportBody = () => {
    if (!docPath || carrier !== 'markdown') return;
    openPanel({
      type: 'doc',
      title,
      docPath,
      data: String(value),
      carrier,
      docVariant: 'study-report',
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openReportBody();
  };

  if (!docPath || carrier !== 'markdown') return null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openReportBody}
      onKeyDown={handleKeyDown}
      title={openLabel}
      className="ldvh-body group flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-ldvh-border/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
    >
      <FileText size={13} className="shrink-0 text-ldvh-accent" />
      <span className="ldvh-meta-primary min-w-0 flex-1 truncate">{title}</span>
      <ChevronRight size={14} className="shrink-0 text-ldvh-text-secondary/70" />
    </div>
  );
}

export function StudyTextNodeContent({
  value,
  compact = false,
  className = '',
}: {
  value: unknown;
  compact?: boolean;
  className?: string;
}) {
  const text = String(value);

  return (
    <div className={`ldvh-research-node-content min-w-0 ${compact ? 'ldvh-research-node-content-compact' : ''} ${className}`}>
      <div className="ldvh-inline-markdown max-w-none min-w-0 overflow-hidden break-words">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    </div>
  );
}

export function ContentField({ fieldKey, value, locale }: { fieldKey: string; value: unknown; locale: string; objType?: string; objectPath?: string }) {
  const isCollapsible = COLLAPSIBLE_FIELDS.includes(fieldKey);
  const [collapsed, setCollapsed] = useState(Boolean(isCollapsible));

  if (value === null || value === undefined) return null;
  if (value === '') return null;

  // 字段名国际化
  const label = getLocalizedFieldLabel(fieldKey, locale);

  return (
    <div className="rounded-lg border border-ldvh-border bg-ldvh-panel p-4">
      <div
        className={`mb-2 flex items-center gap-2 ${isCollapsible ? 'cursor-pointer select-none focus:outline-none' : ''}`}
        onClick={isCollapsible ? () => setCollapsed(c => !c) : undefined}
      >
        <FileText size={13} className="text-ldvh-accent" />
        <h4 className="ldvh-caption-strong">{label}</h4>
        {isCollapsible && (
          <span className="ml-auto text-ldvh-text-secondary">
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </span>
        )}
      </div>
      {!collapsed && <FieldValue fieldKey={fieldKey} value={value} depth={0} locale={locale} />}
    </div>
  );
}

function FieldValue({ fieldKey, value, depth, locale }: { fieldKey: string; value: unknown; depth: number; locale: string }) {
  const { t } = useI18n();
  if (value === null || value === undefined) {
    return <span className="ldvh-caption italic">{t('common.null')}</span>;
  }

  // 字符串
  if (typeof value === 'string') {
    // 空字符串不显示
    if (value === '') return null;

    // acceptance 字段使用 ChecklistCard 组件
    if (fieldKey === 'acceptance') {
      return <ChecklistCard value={value} />;
    }

    if (CHECKLIST_COMPAT_FIELDS.includes(fieldKey) && hasChecklist(value)) {
      return <ChecklistCard value={value} />;
    }

    if (DOC_LINK_FIELDS.includes(fieldKey) && isPreviewablePathForField(fieldKey, value)) {
      return <DocPreviewLink docs={[value]} />;
    }

    if (PATH_TEXT_FIELDS.includes(fieldKey)) {
      return <PathText value={value} />;
    }

    if (EVIDENCE_FIELDS.includes(fieldKey)) {
      return <EvidenceBlock value={value} embedded />;
    }

    // 长文本字段使用 SummaryText 组件
    if (SUMMARY_TEXT_FIELDS.includes(fieldKey)) {
      return <SummaryText value={value} />;
    }

    // 单字符串引用字段使用 ReferenceCard
    if (REFERENCE_FIELDS.includes(fieldKey) && parseRefType(value)) {
      return <ReferenceCard refs={[value]} />;
    }

    // 长文本（含换行）使用 SummaryText
    if (value.includes('\n') || value.length > 200) {
      return <SummaryText value={value} />;
    }

    // 短文本
    return <span className="ldvh-body">{value}</span>;
  }

  // 布尔值
  if (typeof value === 'boolean') {
    return (
      <span className={`ldvh-chip rounded px-1.5 py-0.5 ${value ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
        {value ? t('common.true') : t('common.false')}
      </span>
    );
  }

  // 数字
  if (typeof value === 'number') {
    return <span className="ldvh-meta-primary text-ldvh-accent">{value}</span>;
  }

  // 数组
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="ldvh-caption italic">{t('common.empty')}</span>;
    }

    // 字符串数组
    if (typeof value[0] === 'string') {
      // related_docs 字段使用 DocPreviewLink 组件
      if (DOC_LINK_FIELDS.includes(fieldKey)) {
        return <DocumentOrTextList items={value as string[]} fieldKey={fieldKey} />;
      }
      // 引用字段使用 ReferenceCard 组件
      if (REFERENCE_FIELDS.includes(fieldKey)) {
        return <ReferenceCard refs={value as string[]} />;
      }
      return <StringList items={value as string[]} />;
    }

    // 对象数组
    return (
      <div className="flex flex-col gap-2">
        {value.map((item, i) => (
          <div key={i} className="rounded-md border border-ldvh-border bg-ldvh-bg p-3">
            <FieldValue fieldKey={fieldKey} value={item} depth={depth + 1} locale={locale} />
          </div>
        ))}
      </div>
    );
  }

  // 对象
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className={`flex flex-col gap-2 ${depth > 0 ? '' : ''}`}>
        {entries.map(([k, v]) => {
          const displayKey = getLocalizedFieldLabel(k, locale);
          return (
            <div key={k} className="flex gap-2">
              <span className="ldvh-caption shrink-0 rounded border border-ldvh-border bg-ldvh-bg px-1.5 py-0.5">
                {displayKey}
              </span>
              <div className="min-w-0 flex-1">
                <FieldValue fieldKey={k} value={v} depth={depth + 1} locale={locale} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return <span className="ldvh-body">{String(value)}</span>;
}

/** 从引用 ID 解析对象类型（如 workcase-0001 → workcase） */
function parseRefType(refId: string): string | null {
  if (!isObjectRef(refId)) return null;
  const m = refId.match(/^([a-z]+)-\d+$/);
  return m ? m[1] : null;
}
