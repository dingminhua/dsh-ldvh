import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface EvidenceBlockProps {
  value: string;
  /** 是否在结构化卡片内部（减少嵌套样式） */
  embedded?: boolean;
}

interface EvidenceRow {
  label: string;
  content: string;
}

interface EvidenceSection {
  title: string;
  rows: EvidenceRow[];
}

const markdownComponents: Components = {
  code: ({ className, children, ...props }) => {
    const text = String(children);
    const isCommand = /^(python3?|npx|npm|yarn|pip|cargo|go\s+(?:run|test|build))\s/.test(text);
    const isPath = /^(docs\/|specs\/|src\/|tools\/|web\/|config\/|\.\/|\/)/.test(text);

    if (isCommand || isPath) {
      return (
        <code
          className="rounded bg-ldvh-accent/15 px-1.5 py-0.5 font-mono text-xs text-ldvh-accent"
          {...props}
        >
          {children}
        </code>
      );
    }

    if (!className) {
      return (
        <code className="rounded bg-ldvh-border/50 px-1 py-0.5 font-mono text-xs" {...props}>
          {children}
        </code>
      );
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre
      className="rounded-lg border border-ldvh-accent/20 bg-ldvh-accent/5 p-3 overflow-x-auto"
      {...props}
    >
      {children}
    </pre>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="ldvh-section-title mt-3 mb-1 first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="ldvh-card-title mt-2 mb-1" {...props}>
      {children}
    </h3>
  ),
};

export default function EvidenceBlock({ value, embedded = false }: EvidenceBlockProps) {
  const structured = parseEvidenceSections(value);

  // 嵌入模式：不额外包裹边框和背景，因为外层已有容器
  if (embedded) {
    return (
      <div className="ldvh-inline-markdown max-w-none">
        {structured ? <StructuredEvidence sections={structured} /> : <EvidenceMarkdown value={value} />}
      </div>
    );
  }

  // 独立模式：带边框和背景
  return (
    <div className="rounded-lg border border-ldvh-accent/20 bg-ldvh-accent/5 p-3">
      <div className="ldvh-inline-markdown max-w-none">
        {structured ? <StructuredEvidence sections={structured} /> : <EvidenceMarkdown value={value} />}
      </div>
    </div>
  );
}

function EvidenceMarkdown({ value }: { value: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {value}
    </Markdown>
  );
}

function StructuredEvidence({ sections }: { sections: EvidenceSection[] }) {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <div key={section.title} className="min-w-0 overflow-hidden rounded-md border border-ldvh-border bg-ldvh-bg/45">
          <div className="ldvh-caption-strong border-b border-ldvh-border bg-ldvh-border/20 px-3 py-2 text-ldvh-text-primary">
            {section.title}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-36" />
                <col />
              </colgroup>
              <tbody>
                {section.rows.map((row, index) => (
                  <tr key={`${row.label}-${index}`} className="border-t border-ldvh-border/70 first:border-t-0">
                    <th scope="row" className="ldvh-caption-strong align-top bg-ldvh-border/10 px-3 py-2 text-ldvh-text-secondary">
                      {row.label}
                    </th>
                    <td className="min-w-0 px-3 py-2 align-top text-ldvh-text-primary">
                      <EvidenceMarkdown value={row.content} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function parseEvidenceSections(value: string): EvidenceSection[] | null {
  const lines = value.split('\n');
  const sections: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }

  if (sections.length === 0) return null;

  const parsed = sections
    .map((section) => ({
      title: section.title,
      rows: parseEvidenceRows(section.title, section.body.join('\n')),
    }))
    .filter((section) => section.rows.length > 0);

  return parsed.length > 0 ? parsed : null;
}

function parseEvidenceRows(sectionTitle: string, body: string): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const bulletLines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const isBulletBlock = bulletLines.length > 0 && bulletLines.every((line) => /^[-*]\s+/.test(line));

    if (isBulletBlock) {
      bulletLines.forEach((line) => {
        rows.push({
          label: getEvidenceDefaultLabel(sectionTitle),
          content: line.replace(/^[-*]\s+/, '').trim(),
        });
      });
      continue;
    }

    const dateMatch = block.match(/^(\d{4}-\d{2}-\d{2})\s+([\s\S]+)$/);
    if (dateMatch) {
      rows.push({
        label: dateMatch[1],
        content: dateMatch[2].trim(),
      });
      continue;
    }

    rows.push({
      label: getEvidenceDefaultLabel(sectionTitle),
      content: block,
    });
  }

  return rows;
}

function getEvidenceDefaultLabel(sectionTitle: string): string {
  if (sectionTitle.includes('计划')) return '计划';
  if (sectionTitle.includes('结果')) return '结果';
  if (sectionTitle.includes('结论')) return '结论';
  return '记录';
}
