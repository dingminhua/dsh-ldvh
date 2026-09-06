import type { CommitDetailPanelData } from '@/utils/api';

export interface CommitStatFile {
  path: string;
  stat: string;
  additions: number;
  deletions: number;
}

export interface ParsedCommitStat {
  commit?: string;
  author?: string;
  date?: string;
  files: CommitStatFile[];
  summary?: {
    filesChanged?: number;
    insertions?: number;
    deletions?: number;
    raw: string;
  };
}

export function isCommitDetailPanelData(value: unknown): value is CommitDetailPanelData {
  return Boolean(
    value
      && typeof value === 'object'
      && 'entry' in value
      && 'stat' in value
      && typeof (value as { stat?: unknown }).stat === 'string',
  );
}

export function parseCommitStat(stat: string): ParsedCommitStat {
  const parsed: ParsedCommitStat = { files: [] };

  stat.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith('commit ')) {
      parsed.commit = line.replace(/^commit\s+/, '').slice(0, 12);
      return;
    }
    if (line.startsWith('Author:')) {
      parsed.author = line.replace(/^Author:\s*/, '');
      return;
    }
    if (line.startsWith('Date:')) {
      parsed.date = line.replace(/^Date:\s*/, '');
      return;
    }

    const summaryMatch = line.match(/(?:(\d+)\s+files?\s+changed)?(?:,\s*)?(?:(\d+)\s+insertions?\(\+\))?(?:,\s*)?(?:(\d+)\s+deletions?\(-\))?/);
    if (summaryMatch && (summaryMatch[1] || summaryMatch[2] || summaryMatch[3])) {
      parsed.summary = {
        filesChanged: summaryMatch[1] ? Number(summaryMatch[1]) : undefined,
        insertions: summaryMatch[2] ? Number(summaryMatch[2]) : undefined,
        deletions: summaryMatch[3] ? Number(summaryMatch[3]) : undefined,
        raw: line,
      };
      return;
    }

    const separatorIndex = rawLine.lastIndexOf('|');
    if (separatorIndex === -1) return;
    const path = rawLine.slice(0, separatorIndex).trim();
    const fileStat = rawLine.slice(separatorIndex + 1).trim();
    if (!path || !fileStat) return;
    parsed.files.push({
      path,
      stat: fileStat,
      additions: (fileStat.match(/\+/g) || []).length,
      deletions: (fileStat.match(/-/g) || []).length,
    });
  });

  return parsed;
}

export function getCommitNodeNextState(state: 'collapsed' | 'expanded') {
  return state === 'collapsed' ? 'expanded' : 'collapsed';
}

// specs/03 §9.8 固定提交正文小标题集；渲染必须忠实，不得增删或改义。
const COMMIT_BODY_SECTION_TITLES = new Set(['关键变更', '动机', '验证结论', '影响边界', '风险与后续']);
const COMMIT_SIGNATURE_TRAILER = /(?:^|\n)\s*(?:LDVH-Product-Name|LDVH-Model-Name|Session-ID|Signer-Type|Agent-ID|Host-Environment|Model-ID|Agent-Workbench|Workbench-Name):\s*/i;

/**
 * Keep signature trailers out of the prose sections they follow.
 * Their readable fields are rendered as dedicated commit metadata instead.
 */
export function stripCommitSignatureTrailers(value: string): string {
  const match = value.match(COMMIT_SIGNATURE_TRAILER);
  return match?.index === undefined ? value.trim() : value.slice(0, match.index).trim();
}

function formatCommitBodyForReading(value: string) {
  return value.trim().split('\n').map((line) => {
    const match = line.match(/^([^\S\r\n]*)([^:：\n]+)\s*[:：]\s*$/);
    if (!match) return line;
    const [, indent, rawTitle] = match;
    const title = rawTitle.trim();
    if (indent || !COMMIT_BODY_SECTION_TITLES.has(title)) return line;
    return `### ${title}`;
  }).join('\n');
}

export type CommitBodySection = { key: string; title: string; content: string };

export function getCommitBodySectionsForReading(value: string, fallbackTitle: string): CommitBodySection[] {
  const formatted = formatCommitBodyForReading(value);
  const sections: CommitBodySection[] = [];
  let currentTitle = fallbackTitle;
  let current: string[] = [];

  formatted.split('\n').forEach((line) => {
    const headingMatch = line.match(/^###\s+(.+?)\s*$/);
    if (headingMatch) {
      if (current.some((item) => item.trim())) {
        sections.push({ key: `${sections.length}:${currentTitle}`, title: currentTitle, content: current.join('\n').trim() });
      }
      currentTitle = headingMatch[1].trim();
      current = [];
      return;
    }
    current.push(line);
  });

  if (current.some((line) => line.trim())) {
    sections.push({ key: `${sections.length}:${currentTitle}`, title: currentTitle, content: current.join('\n').trim() });
  }
  return sections.length > 0 ? sections : formatted ? [{ key: 'commit-body', title: fallbackTitle, content: formatted }] : [];
}
