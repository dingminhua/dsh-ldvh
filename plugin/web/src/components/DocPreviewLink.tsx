import { FileText, ExternalLink } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { getPreviewableDocPath } from '@/utils/fieldFormats';

interface DocPreviewLinkProps {
  docs: string[];
  variant?: 'card' | 'plain';
}

export default function DocPreviewLink({ docs, variant = 'card' }: DocPreviewLinkProps) {
  const { t } = useI18n();
  const readLabel = t('common.read');

  if (docs.length === 0) return null;

  const handleClick = (docPath: string) => {
    // Emit custom event for right panel consumption
    const event = new CustomEvent('ldvh:doc-preview', {
      detail: { path: docPath },
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {docs.map((doc, i) => {
        const isExternal = doc.startsWith('http');
        const previewPath = getPreviewableDocPath(doc);
        const itemClassName = variant === 'plain'
          ? 'ldvh-body flex w-full items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-ldvh-border/25'
          : 'ldvh-body flex w-full items-center gap-2 rounded-lg border border-ldvh-border bg-ldvh-bg px-3 py-2 text-left transition-colors hover:bg-ldvh-border/30';
        return (
          <button
            key={i}
            onClick={() => handleClick(previewPath)}
            className={itemClassName}
          >
            {isExternal ? (
              <ExternalLink size={13} className="shrink-0 text-ldvh-accent" />
            ) : (
              <FileText size={13} className="shrink-0 text-ldvh-accent" />
            )}
            <span className="ldvh-meta-primary min-w-0 flex-1 truncate">
              {doc}
            </span>
            {isExternal && <span className="ldvh-caption shrink-0">{readLabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
