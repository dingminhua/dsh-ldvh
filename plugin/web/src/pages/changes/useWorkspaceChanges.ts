import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchProjectGitDiff,
  fetchProjectGitStatus,
  type ProjectGitDiffData,
  type ProjectGitStatusEntry,
} from '@/utils/api';
import { parseSplitDiff } from '@/pages/project-files/model';

type DiffState = {
  data: ProjectGitDiffData | null;
  loading: boolean;
  error: string | null;
};

export function useWorkspaceChanges(projectId: string) {
  const [entries, setEntries] = useState<ProjectGitStatusEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ProjectGitStatusEntry | null>(null);
  const [diff, setDiff] = useState<DiffState>({ data: null, loading: false, error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const diffRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    diffRequestId.current += 1;
    setEntries([]);
    setEntriesError(null);
    setSelectedEntry(null);
    setDiff({ data: null, loading: false, error: null });

    if (!projectId) {
      setEntriesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setEntriesLoading(true);
    fetchProjectGitStatus(projectId)
      .then((result) => {
        if (!cancelled) setEntries(result.entries ?? []);
      })
      .catch((reason) => {
        if (!cancelled) setEntriesError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  const openDiff = useCallback((entry: ProjectGitStatusEntry) => {
    const requestId = diffRequestId.current + 1;
    diffRequestId.current = requestId;
    setSelectedEntry(entry);
    setDiff({ data: null, loading: true, error: null });

    fetchProjectGitDiff(entry.projectId, entry.path, entry.status)
      .then((data) => {
        if (diffRequestId.current === requestId) setDiff({ data, loading: false, error: null });
      })
      .catch((reason) => {
        if (diffRequestId.current === requestId) {
          setDiff({ data: null, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
        }
      });
  }, []);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);
  const splitDiffRows = useMemo(() => (diff.data ? parseSplitDiff(diff.data.diff) : []), [diff.data]);

  return {
    entries,
    entriesLoading,
    entriesError,
    selectedEntry,
    diff,
    splitDiffRows,
    openDiff,
    reload,
  };
}
