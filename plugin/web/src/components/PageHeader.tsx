import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  compact?: boolean;
}

/** Unified page header for all middle-area pages. */
export default function PageHeader({ title, subtitle, children, compact = false }: PageHeaderProps) {
  return (
    <div className={compact ? 'min-w-0' : 'mb-6'}>
      <h1 className="ldvh-page-title">{title}</h1>
      {subtitle && <p className="ldvh-page-subtitle mt-1">{subtitle}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
