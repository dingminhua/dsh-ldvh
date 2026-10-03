import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { LDVH_WARN_SURFACE_STRONG_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';

/**
 * 联邦项目 issues 警示列表——Federation（卡内嵌）与 FederationObjects（页级）双消费共用。
 * 收敛前为两份手抄（批次C）。空数组渲染 null。
 */

/** 卡内嵌几何（联邦项目卡：与卡内统计小盒 px-2.5 py-2 同密度）。 */
export const PROJECT_ISSUES_EMBEDDED_GEOMETRY_CLASS = 'rounded-md px-2.5 py-2';
/** 页面级几何（联邦对象列表页：页面盒 p-3 密度）。 */
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
