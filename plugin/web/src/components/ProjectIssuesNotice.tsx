import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { LDVH_WARN_SURFACE_STRONG_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';


export const PROJECT_ISSUES_EMBEDDED_GEOMETRY_CLASS = 'rounded-md px-2.5 py-2';
export const PROJECT_ISSUES_PAGE_GEOMETRY_CLASS = 'rounded-lg p-3';

export default function ProjectIssuesNotice({
  issues,
  variant,
  className = '',
}: {
  issues: string[];
  variant: 'embedded' | 'page';
  className?: string;
}) {
  const { t } = useI18n();
  if (issues.length === 0) return null;
  return (
    <div
      className={`border ${
        variant === 'embedded' ? PROJECT_ISSUES_EMBEDDED_GEOMETRY_CLASS : PROJECT_ISSUES_PAGE_GEOMETRY_CLASS
      } ${LDVH_WARN_SURFACE_STRONG_CLASS} ${className}`}
    >
      <p className={`ldvh-caption-strong flex items-center gap-1.5 ${LDVH_WARN_TITLE_CLASS}`}>
        <AlertTriangle size={12} />{t('federation.projectIssues')}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {issues.map((issue) => <li key={issue} className={`ldvh-caption ${LDVH_WARN_TITLE_CLASS}`}>{issue}</li>)}
      </ul>
    </div>
  );
}
