import { CheckSquare, Square } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChecklistCardProps {
  value: string;
}

interface ChecklistItem {
  checked: boolean;
  text: string;
}

function parseChecklist(value: string): ChecklistItem[] {
  const lines = value.split('\n');
  const items: ChecklistItem[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*- \[([ xX])\]\s*(.*)/);
    if (m) {
      items.push({ checked: m[1].toLowerCase() === 'x', text: m[2] });
    }
  }
  return items;
}

export default function ChecklistCard({ value }: ChecklistCardProps) {
  const items = parseChecklist(value);
  const doneCount = items.filter(i => i.checked).length;
  const totalCount = items.length;

  if (items.length === 0) {
    return <MarkdownText value={value} />;
  }

  const ratio = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Progress header */}
      <div className="flex items-center gap-2">
        <span className="ldvh-chip text-ldvh-accent">
          {doneCount}/{totalCount}
        </span>
        <div className="h-1.5 flex-1 rounded-full bg-ldvh-border overflow-hidden">
          <div
            className="h-full rounded-full bg-ldvh-accent transition-all"
            style={{ width: `${ratio}%` }}
          />
        </div>
        <span className="ldvh-caption">{ratio}%</span>
      </div>

      {/* Checklist items */}
      <div className="flex flex-col gap-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            {item.checked ? (
              <CheckSquare size={14} className="mt-0.5 shrink-0 text-ldvh-text-secondary" />
            ) : (
              <Square size={14} className="mt-0.5 shrink-0 text-ldvh-accent" />
            )}
            <span
              className={`ldvh-body ${
                item.checked
                  ? 'text-ldvh-text-secondary line-through opacity-60'
                  : 'text-ldvh-text-primary'
              }`}
            >
              <InlineMarkdown value={item.text} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineMarkdown({ value }: { value: string }) {
  return (
    <span className="ldvh-inline-markdown inline max-w-none">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span>{children}</span>,
        }}
      >
        {value}
      </Markdown>
    </span>
  );
}

function MarkdownText({ value }: { value: string }) {
  return (
    <div className="ldvh-inline-markdown max-w-none">
      <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
    </div>
  );
}
