import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { CommitDetailContent, CommitDetailIdentity } from '@/components/ReadingPanel';
import { useI18n } from '@/i18n/context';
import { fetchCommitDetail, type ChangelogEntry } from '@/utils/api';

export default function ChangelogDetail() {
  const { hash } = useParams<{ hash: string }>();
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const [entry, setEntry] = useState<ChangelogEntry | undefined>();
  const [stat, setStat] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    setEntry(undefined);
    setStat('');
    setError(null);

    fetchCommitDetail(hash, locale)
      .then((result) => {
        if (cancelled) return;
        setEntry(result.entry ? { ...result.entry, body: result.body || result.entry.body } : undefined);
        setStat(result.stat);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [hash, locale]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle size={32} className="mx-auto mb-2 text-red-400" />
          <p className="ldvh-body-muted">{t('changelog.detailFailed')}</p>
          <p className="ldvh-meta text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!hash || (!entry && !stat)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ldvh-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto rounded-none transition-[margin] duration-300">
        <div className="mx-auto max-w-4xl p-6">
          <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 border-b border-ldvh-border bg-ldvh-bg/95 px-6 pb-4 pt-4 backdrop-blur">
            <button
              type="button"
              onClick={() => navigate('/changelog')}
              className="ldvh-body-muted mb-3 flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-ldvh-border/50 hover:text-ldvh-text-primary"
            >
              <ArrowLeft size={14} />
              {t('objectDetail.back')}
            </button>
            <CommitDetailIdentity
              entry={entry}
              stat={stat}
              title={entry?.description || entry?.message || hash}
            />
          </div>

          <CommitDetailContent
            entry={entry}
            stat={stat}
            title={entry?.description || entry?.message || hash}
            showIdentity={false}
          />
        </div>
      </div>
    </div>
  );
}
