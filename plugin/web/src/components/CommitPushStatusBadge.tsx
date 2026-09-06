import { CloudDownload } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/i18n/context';
import type { GitPushStatus } from '@/utils/api';

export default function CommitPushStatusBadge({
  status,
  className = '',
}: {
  status: GitPushStatus;
  className?: string;
}) {
  const { t } = useI18n();
  const [showTooltip, setShowTooltip] = useState(false);

  if (status === 'unknown') return null;

  const label = t(status === 'incoming' ? 'changelog.incoming' : `changelog.${status}`);

  // Shared commits do not need per-row decoration. Only surface commits that
  // require a push or a synchronization action.
  if (status === 'pushed') return null;

  const isIncoming = status === 'incoming';

  return (
    <span className={`${className} relative inline-flex shrink-0`}>
      <span
        aria-label={label}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/45 ${isIncoming ? 'text-violet-600 dark:text-violet-400' : 'text-rose-600 dark:text-rose-400'}`}
        onBlur={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        role="img"
        tabIndex={0}
      >
        {isIncoming ? (
          <CloudDownload aria-hidden="true" size={17} strokeWidth={2} />
        ) : (
          <svg
            aria-hidden="true"
            className="h-[18px] w-[18px]"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="M17.5 20H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
            <path
              d="M12 14V3m-3.5 3.5L12 3l3.5 3.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        )}
      </span>
      {showTooltip ? (
        <span
          className="pointer-events-none absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border border-ldvh-border bg-ldvh-panel px-2 py-1 text-[10px] font-medium leading-4 text-ldvh-text-primary shadow-md"
          role="tooltip"
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
