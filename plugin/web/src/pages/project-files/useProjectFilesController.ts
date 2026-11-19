import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchProjectFileContent,
  fetchProjectFileEntries,
  type ProjectFileEntry,
} from '@/utils/api';
import {
  isHiddenRelativePath,
  type FilePanelState,
} from '@/pages/project-files/model';
import { useProjectScope } from '@/utils/projectContext';

export function useProjectFilesController() {
  const {
    projects,
    selectedProjectId: projectId,
    loading: projectsLoading,
    error: projectsError,
  } = useProjectScope();
  const [currentDir, setCurrentDir] = useState('');
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [filePanel, setFilePanel] = useState<FilePanelState>({ data: null, loading: false, error: null });
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const entriesRequestId = useRef(0);
  const fileRequestId = useRef(0);

  const loadEntries = useCallback((nextDir: string, nextShowHidden: boolean) => {
    if (!projectId) return;
    const requestId = entriesRequestId.current + 1;
    entriesRequestId.current = requestId;
    setEntriesLoading(true);
    setEntriesError(null);

    fetchProjectFileEntries(projectId, nextDir, nextShowHidden)
      .then((result) => {
        if (entriesRequestId.current !== requestId) return;
        setEntries(result.entries ?? []);
        setCurrentDir(result.dir ?? nextDir);
      })
      .catch((reason) => {
        if (entriesRequestId.current === requestId) {
          setEntriesError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (entriesRequestId.current === requestId) setEntriesLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    entriesRequestId.current += 1;
    fileRequestId.current += 1;
    setCurrentDir('');
    setEntries([]);
    setEntriesError(null);
    setShowHiddenFiles(false);
    setFilePanel({ data: null, loading: false, error: null });
    if (projectId) loadEntries('', false);
  }, [loadEntries, projectId]);

  const handleNavigateDir = (nextDir: string) => {
    fileRequestId.current += 1;
    setFilePanel({ data: null, loading: false, error: null });
    loadEntries(nextDir, showHiddenFiles);
  };

  const handleOpenEntry = (entry: ProjectFileEntry) => {
    if (entry.type === 'directory') {
      handleNavigateDir(entry.path);
      return;
    }

    const requestId = fileRequestId.current + 1;
    fileRequestId.current = requestId;
    setFilePanel({ data: null, loading: true, error: null });
    fetchProjectFileContent(projectId, entry.path, showHiddenFiles)
      .then((data) => {
        if (fileRequestId.current === requestId) setFilePanel({ data, loading: false, error: null });
      })
      .catch((reason) => {
        if (fileRequestId.current === requestId) {
          setFilePanel({ data: null, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
        }
      });
  };

  const handleShowHiddenChange = (nextShowHidden: boolean) => {
    setShowHiddenFiles(nextShowHidden);
    fileRequestId.current += 1;
    setFilePanel({ data: null, loading: false, error: null });
    const nextDir = !nextShowHidden && isHiddenRelativePath(currentDir) ? '' : currentDir;
    loadEntries(nextDir, nextShowHidden);
  };

  return {
    projects,
    projectId,
    projectsLoading,
    projectsError,
    currentDir,
    entries,
    entriesLoading,
    entriesError,
    filePanel,
    showHiddenFiles,
    handleNavigateDir,
    handleOpenEntry,
    handleShowHiddenChange,
  };
}
