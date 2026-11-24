import type { ReactNode } from 'react';

interface PageHeaderProps {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  compact?: boolean;
}

export default function PageHeader({ children }: PageHeaderProps) {
  if (!children) return null;
  return <div className="min-w-0">{children}</div>;
}
