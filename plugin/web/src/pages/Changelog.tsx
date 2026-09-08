import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import CopyPathButton from '@/components/CopyPathButton';
import CommitBreakingBadge from '@/components/CommitBreakingBadge';
import CommitPushStatusBadge from '@/components/CommitPushStatusBadge';
import ObjectUpdatedMeta from '@/components/ObjectUpdatedMeta';
import { ObjectTypeIcon } from '@/components/SemanticIcon';
import { fetchChangelog, type ChangelogEntry } from '@/utils/api';
import { getCommitScopeLabel, getCommitTypeLabel } from '@/utils/commitLabels';
import { useI18n } from '@/i18n/context';
import { CATEGORY_COLORS } from '@/utils/categoryColors';

const CHANGELOG_COUNT_OPTIONS = [50, 100, 200] as const;
type ChangelogCount = typeof CHANGELOG_COUNT_OPTIONS[number];
const COMMIT_COPY_BODY_PREVIEW_LIMIT = 180;

function getCommitFilterOptions(entries: ChangelogEntry[], field: 'category' | 'scope'): string[] {
  return [...new Set(entries.map((entry) => entry[field]).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b));
}

function CommitFilterGroup({
  allLabel,
  options,
  activeValue,
  onChange,
  getLabel,
  getOptionColor,
}: {
  allLabel: string;
  options: string[];
  activeValue: string | null;
  onChange: (value: string | null) => void;
  getLabel: (value: string) => string;
  getOptionColor?: (value: string) => string | undefined;
}) {
  return (
    <div className="ldvh-tab-list min-w-0">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`ldvh-tab-button ${activeValue === null ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
      >
        {allLabel}
      </button>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          style={getOptionColor ? { color: getOptionColor(option) } : undefined}
          className={`ldvh-tab-button ${activeValue === option ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
        >
          {getLabel(option)}
        </button>
      ))}
    </div>
  );
}

function CommitCountGroup({
  activeValue,
  onChange,
  labelForCount,
}: {
  activeValue: ChangelogCount;
  onChange: (value: ChangelogCount) => void;
  labelForCount: (value: ChangelogCount) => string;
}) {
  return (
    <div className="ldvh-tab-list min-w-0">
      {CHANGELOG_COUNT_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`ldvh-tab-button ${activeValue === option ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
        >
          {labelForCount(option)}
        </button>
      ))}
    </div>
  );
}

function getCommitCopyContext(entry: ChangelogEntry): string {
  const body = entry.body?.trim() ?? '';
  const bodyPreview = body.length > COMMIT_COPY_BODY_PREVIEW_LIMIT
    ? `${body.slice(0, COMMIT_COPY_BODY_PREVIEW_LIMIT).trimEnd()}\n[truncated; fetch full body/stat by hash]`
    : body;

  return [
    'LDVH Commit',
    `hash: ${entry.hash}`,
    `type: ${entry.category || '-'}`,
    `scope: ${entry.scope || '-'}`,
    `description: ${entry.description || entry.message || '-'}`,
    `detail: /changelog/${entry.hash}`,
    ...(bodyPreview ? [`body:\n${bodyPreview}`] : []),
  ].join('\n');
}

export default function Changelog() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [logCount, setLogCount] = useState<ChangelogCount>(50);

  const typeOptions = useMemo(
    () => getCommitFilterOptions(entries, 'category')
      .sort((a, b) => getCommitTypeLabel(a, locale).localeCompare(getCommitTypeLabel(b, locale))),
    [entries, locale],
  );
  const filteredEntries = useMemo(() => entries.filter((entry) => {
    if (activeType && entry.category !== activeType) return false;
    return true;
  }), [activeType, entries]);

  useEffect(() => {
    let cancelled = false;
    setEntries([]);
    setError(null);

    fetchChangelog(logCount, locale)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [locale, logCount]);

  const openCommitPage = (entry: ChangelogEntry) => {
    navigate(`/changelog/${entry.hash}`);
  };

  const handleKeyboardOpen = (event: KeyboardEvent<HTMLDivElement>, open: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle size={32} className="mx-auto mb-2 text-red-400" />
          <p className="ldvh-body-muted">{t('changelog.loadFailed')}</p>
          <p className="ldvh-meta text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ldvh-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="ldvh-page-frame">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-4 flex flex-col gap-2 border-b border-ldvh-border bg-ldvh-bg/95 px-6 py-3 backdrop-blur">
        <CommitCountGroup
          activeValue={logCount}
          onChange={(value) => {
            setLogCount(value);
          }}
          labelForCount={(value) => t('changelog.recentCount', { count: String(value) })}
        />
        <CommitFilterGroup
          allLabel={t('changelog.allTypes')}
          options={typeOptions}
          activeValue={activeType}
          onChange={(value) => {
            setActiveType(value);
          }}
          getLabel={(value) => getCommitTypeLabel(value, locale)}
          getOptionColor={(value) => CATEGORY_COLORS[value] || CATEGORY_COLORS.other}
        />
        {/* 范围的筛选已移除（2026-08-22） */}
      </div>

      <div className="ldvh-section-grid">
        {filteredEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ldvh-border bg-ldvh-panel px-4 py-8 text-center">
            <p className="ldvh-body-muted">{t('changelog.noMatches')}</p>
          </div>
        ) : filteredEntries.map((entry) => {
          const typeColor = CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.other;
          return (
            <div
              key={entry.hash}
              role="button"
              tabIndex={0}
              className="group/card flex w-full min-w-0 flex-col gap-2 rounded-lg border border-ldvh-border bg-ldvh-panel p-3 text-left transition-colors hover:border-ldvh-accent/40 hover:bg-ldvh-panel/95"
              onClick={() => openCommitPage(entry)}
              onKeyDown={(event) => handleKeyboardOpen(event, () => openCommitPage(entry))}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className="ldvh-chip-sm border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary"
                  >
                    {t('changelog.commit')}
                  </span>
                  <span
                    className="ldvh-chip-sm"
                    style={{ backgroundColor: `${typeColor}18`, borderColor: `${typeColor}55`, color: typeColor }}
                  >
                    {getCommitTypeLabel(entry.category, locale)}
                  </span>
                  {entry.isBreaking && (
                    <CommitBreakingBadge />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <CommitPushStatusBadge status={entry.pushStatus} />
                  <CopyPathButton
                    path={getCommitCopyContext(entry)}
                    label={t('changelog.copyContext')}
                    copiedLabel={t('changelog.copiedContext')}
                  />
                </div>
              </div>
              <div className="ldvh-object-title-tray -mx-1 flex min-w-0 items-center gap-1.5 px-2.5 py-2 text-left transition-colors group-hover/card:bg-ldvh-bg/55">
                <ObjectTypeIcon type="changelog" size={14} className="flex-shrink-0 text-ldvh-text-secondary" />
                <div className="min-w-0 flex-1">
                  <h2 className="ldvh-card-title whitespace-normal break-words">
                    {entry.description || entry.message}
                  </h2>
                </div>
              </div>
              <div className="flex min-w-0 items-center justify-end pt-0.5 text-right">
                <ObjectUpdatedMeta source={{}} updatedAt={entry.date} signature={entry.signature} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
