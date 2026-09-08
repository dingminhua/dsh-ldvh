import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { copyText } from '@/utils/clipboard';

interface CopyPathButtonProps {
  path?: string;
  className?: string;
  toneClassName?: string;
  toneStyle?: CSSProperties;
  label?: string;
  copiedLabel?: string;
  size?: 'sm' | 'md';
}

export default function CopyPathButton({ path, className = '', toneClassName, toneStyle, label: labelOverride, copiedLabel, size = 'sm' }: CopyPathButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!path) return null;

  const label = copied ? (copiedLabel || t('common.copiedPath')) : (labelOverride || t('common.copyPath'));
  const buttonClassName = copied
    ? 'bg-emerald-500/10 text-emerald-400'
    : toneClassName ?? 'bg-transparent text-ldvh-text-secondary/70 hover:bg-ldvh-border/30 hover:text-ldvh-accent';
  const sizeClass = size === 'md' ? 'h-8 w-8' : 'h-7 w-7';

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setShowTooltip(false);
    event.currentTarget.blur();

    await copyText(path);
    setCopied(true);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className={`relative inline-flex shrink-0 ${className}`} onMouseLeave={() => setShowTooltip(false)}>
      <button
        type="button"
        onMouseEnter={() => setShowTooltip(true)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        onClick={handleClick}
        className={`inline-flex ${sizeClass} shrink-0 items-center justify-center rounded-md border border-transparent transition-colors focus-visible:border-ldvh-accent/50 focus-visible:outline-none ${buttonClassName}`}
        style={copied ? undefined : toneStyle}
        aria-label={label}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {showTooltip && !copied && (
        <span
          aria-hidden="true"
          className="ldvh-caption pointer-events-none absolute bottom-full right-0 z-50 mb-1 whitespace-nowrap rounded-md border border-ldvh-border bg-ldvh-panel px-2 py-1 text-ldvh-text-primary shadow-lg shadow-black/10"
        >
          {label}
        </span>
      )}
    </span>
  );
}
