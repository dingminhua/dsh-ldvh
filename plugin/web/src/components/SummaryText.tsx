import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '@/i18n/context';

interface SummaryTextProps {
  value: string;
  collapseThreshold?: number;
  previewLines?: number;
  className?: string;
}

const COLLAPSE_THRESHOLD = 150;

/** 按段落/行截断 Markdown 文本，避免一个长段落或长列表吞掉预览区。 */
function truncateByParagraph(text: string, maxChars: number, maxLines?: number): string {
  const linePreview = truncateByLines(text, maxChars, maxLines);
  if (linePreview) return linePreview;
  if (text.length <= maxChars) return text;

  const paragraphs = text.split(/\n\n+/);
  let result = '';
  for (const para of paragraphs) {
    const next = result ? `${result}\n\n${para}` : para;
    if (next.length > maxChars) {
      if (result) break;
      return truncateLongBlock(para, maxChars);
    }
    result = next;
  }
  return result || truncateLongBlock(text, maxChars);
}

function truncateByLines(text: string, maxChars: number, maxLines?: number): string {
  if (!maxLines) return '';

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= maxLines && text.length <= maxChars) return text;
  return clampToChars(lines.slice(0, maxLines).join('\n'), maxChars);
}

function truncateLongBlock(text: string, maxChars: number): string {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  let result = '';
  for (const line of lines) {
    const next = result ? `${result}\n${line}` : line;
    if (next.length > maxChars) {
      if (result) break;
      break;
    }
    result = next;
  }

  if (result) return result;

  const sentence = text.match(/^(.+?[。.!?])\s/);
  if (sentence?.[1] && sentence[1].length <= maxChars) return sentence[1];

  return clampToChars(text, maxChars);
}

function clampToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text.trimEnd();
  return text.slice(0, maxChars).trimEnd();
}

export default function SummaryText({
  value,
  collapseThreshold = COLLAPSE_THRESHOLD,
  previewLines,
  className,
}: SummaryTextProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const collapsedText = useMemo(
    () => truncateByParagraph(value, collapseThreshold, previewLines),
    [value, collapseThreshold, previewLines]
  );
  const needsTruncation = collapsedText.trim() !== value.trim();
  const displayText = expanded ? value : collapsedText;

  return (
    <div>
      <div className={`ldvh-inline-markdown max-w-none ${className ?? ''}`}>
        <Markdown remarkPlugins={[remarkGfm]}>
          {needsTruncation && !expanded ? displayText + '…' : value}
        </Markdown>
      </div>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="ldvh-caption mt-1.5 flex items-center gap-1 text-ldvh-accent transition-colors hover:text-ldvh-accent/80"
        >
          {expanded ? (
            <>
              <ChevronUp size={12} />
              {t('objectDetail.collapse')}
            </>
          ) : (
            <>
              <ChevronDown size={12} />
              {t('objectDetail.expand')}
            </>
          )}
        </button>
      )}
    </div>
  );
}
