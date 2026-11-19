import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  renderSvgBlocks?: boolean;
  blockRemoteImages?: boolean;
}

type MarkdownSegment =
  | { type: 'markdown'; content: string }
  | { type: 'svg'; content: string };

const SVG_BLOCK_PATTERN = /<svg\b[\s\S]*?<\/svg>/gi;

function getSvgDataUrl(content: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
}

function getSvgAlt(content: string): string {
  const ariaLabel = content.match(/\baria-label=(["'])(.*?)\1/i)?.[2];
  const role = content.match(/\brole=(["'])(.*?)\1/i)?.[2];
  return ariaLabel || role || 'SVG preview';
}

function splitSvgBlocks(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(SVG_BLOCK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ type: 'markdown', content: content.slice(cursor, index) });
    }
    segments.push({ type: 'svg', content: match[0] });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({ type: 'markdown', content: content.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', content }];
}

function isInlinePreviewImage(src: string | undefined): boolean {
  return Boolean(src && /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);base64,/i.test(src));
}

export default function MarkdownPreview({
  content,
  className,
  renderSvgBlocks = false,
  blockRemoteImages = false,
}: MarkdownPreviewProps) {
  if (!renderSvgBlocks) {
    return (
      <div className={cn('markdown-body ldvh-markdown-preview', className)}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={blockRemoteImages ? {
            img: ({ src, alt }) => isInlinePreviewImage(src)
              ? <img src={src} alt={alt || ''} />
              : <span className="ldvh-caption">[{alt || 'image'}]</span>,
          } : undefined}
        >
          {content}
        </Markdown>
      </div>
    );
  }

  return (
    <div className={cn('markdown-body ldvh-markdown-preview', className)}>
      {splitSvgBlocks(content).map((segment, index) => (
        segment.type === 'svg' ? (
          <div
            key={`svg-${index}`}
            className="my-4 flex min-w-0 justify-center overflow-auto rounded-md border border-ldvh-border/70 bg-ldvh-panel/70 p-3"
          >
            <img
              src={getSvgDataUrl(segment.content)}
              alt={getSvgAlt(segment.content)}
              className="max-h-[32rem] max-w-full object-contain"
            />
          </div>
        ) : segment.content.trim() ? (
          <Markdown key={`markdown-${index}`} remarkPlugins={[remarkGfm]}>
            {segment.content}
          </Markdown>
        ) : null
      ))}
    </div>
  );
}
