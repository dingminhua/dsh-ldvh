import type {
  ProjectFileContentData,
  ProjectFileEntry,
} from '@/utils/api';

export type FilePanelState = {
  data: ProjectFileContentData | null;
  loading: boolean;
  error: string | null;
};

export type DiffViewMode = 'unified' | 'split';

export type SplitDiffCell = {
  kind: 'context' | 'delete' | 'add' | 'empty';
  lineNumber?: number;
  text?: string;
};

export type SplitDiffRow =
  | { kind: 'meta' | 'hunk'; text: string }
  | { kind: 'line'; oldCell: SplitDiffCell; newCell: SplitDiffCell };

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function getFileName(filePath?: string): string {
  if (!filePath) return '';
  const parts = filePath.split('/').filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

export function isHiddenRelativePath(filePath: string): boolean {
  return filePath.split('/').some((part) => part.startsWith('.') && part.length > 1);
}

export function getSvgDataUrl(content: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
}

export function getDiffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-ldvh-text-secondary';
  if (line.startsWith('+')) return 'text-emerald-400';
  if (line.startsWith('-')) return 'text-red-400';
  if (line.startsWith('@@')) return 'text-ldvh-accent';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'text-sky-700 dark:text-sky-300';
  return 'text-ldvh-text-primary';
}

export function getSplitDiffCellClass(cell: SplitDiffCell): string {
  if (cell.kind === 'delete') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (cell.kind === 'add') return 'bg-emerald-500/10 text-emerald-300';
  if (cell.kind === 'empty') return 'bg-ldvh-panel/60 text-ldvh-text-secondary';
  return 'text-ldvh-text-primary';
}

export function parseSplitDiff(diff: string): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let oldLineNumber: number | null = null;
  let newLineNumber: number | null = null;
  let pendingDeletes: SplitDiffCell[] = [];

  const flushDeletes = () => {
    pendingDeletes.forEach((oldCell) => {
      rows.push({ kind: 'line', oldCell, newCell: { kind: 'empty' } });
    });
    pendingDeletes = [];
  };

  diff.split('\n').forEach((line) => {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      flushDeletes();
      oldLineNumber = Number(hunkMatch[1]);
      newLineNumber = Number(hunkMatch[2]);
      rows.push({ kind: 'hunk', text: line });
      return;
    }

    if (oldLineNumber === null || newLineNumber === null) {
      flushDeletes();
      rows.push({ kind: 'meta', text: line });
      return;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      pendingDeletes.push({ kind: 'delete', lineNumber: oldLineNumber, text: line.slice(1) });
      oldLineNumber += 1;
      return;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      const newCell: SplitDiffCell = { kind: 'add', lineNumber: newLineNumber, text: line.slice(1) };
      newLineNumber += 1;
      const oldCell = pendingDeletes.shift() ?? { kind: 'empty' };
      rows.push({ kind: 'line', oldCell, newCell });
      return;
    }

    flushDeletes();
    const text = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({
      kind: 'line',
      oldCell: { kind: 'context', lineNumber: oldLineNumber, text },
      newCell: { kind: 'context', lineNumber: newLineNumber, text },
    });
    oldLineNumber += 1;
    newLineNumber += 1;
  });

  flushDeletes();
  return rows;
}

export type ProjectFileEntryKind = ProjectFileEntry['kind'];
