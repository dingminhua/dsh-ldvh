import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { FactCarrier } from '@/utils/factReadMeta';

export type PanelContentType = 'object' | 'doc' | 'web' | 'yaml' | 'evidence' | 'diff' | 'empty';

export interface PanelContent {
  type: PanelContentType;
  title?: string;
  objectType?: string;
  objectId?: string;
  docPath?: string;
  /** Optional, source-declared presentation for a document reading surface. */
  docVariant?: 'study-report';
  carrier?: FactCarrier;
  url?: string;
  data?: unknown;
}

interface PanelContextValue {
  isOpen: boolean;
  content: PanelContent | null;
  canGoBack: boolean;
  canGoForward: boolean;
  openPanel: (content: PanelContent) => void;
  goBack: () => void;
  goForward: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

interface PanelState {
  isOpen: boolean;
  content: PanelContent | null;
  history: PanelContent[];
  historyIndex: number;
}

const PanelContext = createContext<PanelContextValue>({
  isOpen: false,
  content: null,
  canGoBack: false,
  canGoForward: false,
  openPanel: () => {},
  goBack: () => {},
  goForward: () => {},
  closePanel: () => {},
  togglePanel: () => {},
});

export function PanelProvider({ children }: { children: ReactNode }) {
  const closeTimerRef = useRef<number | null>(null);
  const [panelState, setPanelState] = useState<PanelState>({
    isOpen: false,
    content: null,
    history: [],
    historyIndex: -1,
  });

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPanel = useCallback((c: PanelContent) => {
    clearCloseTimer();
    setPanelState((prev) => {
      const current = prev.historyIndex >= 0 ? prev.history[prev.historyIndex] : null;
      if (current && getPanelContentKey(current) === getPanelContentKey(c)) {
        const history = [...prev.history];
        history[prev.historyIndex] = c;
        return { ...prev, isOpen: !prev.isOpen, content: c, history };
      }

      const history = prev.history.slice(0, prev.historyIndex + 1);
      history.push(c);
      return {
        isOpen: true,
        content: c,
        history,
        historyIndex: history.length - 1,
      };
    });
  }, [clearCloseTimer]);

  const goBack = useCallback(() => {
    clearCloseTimer();
    setPanelState((prev) => {
      if (prev.historyIndex <= 0) return prev;
      const historyIndex = prev.historyIndex - 1;
      const content = prev.history[historyIndex];
      if (!content) return prev;
      return { ...prev, isOpen: true, content, historyIndex };
    });
  }, [clearCloseTimer]);

  const goForward = useCallback(() => {
    clearCloseTimer();
    setPanelState((prev) => {
      if (prev.historyIndex < 0 || prev.historyIndex >= prev.history.length - 1) return prev;
      const historyIndex = prev.historyIndex + 1;
      const content = prev.history[historyIndex];
      if (!content) return prev;
      return { ...prev, isOpen: true, content, historyIndex };
    });
  }, [clearCloseTimer]);

  const { isOpen, content, history, historyIndex } = panelState;
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;

  const closePanel = useCallback(() => {
    clearCloseTimer();
    setPanelState((prev) => ({ ...prev, isOpen: false }));
    closeTimerRef.current = window.setTimeout(() => {
      setPanelState((prev) => (prev.isOpen ? prev : { ...prev, content: null }));
      closeTimerRef.current = null;
    }, 200);
  }, [clearCloseTimer]);

  const togglePanel = useCallback(() => {
    clearCloseTimer();
    setPanelState((prev) => {
      if (prev.isOpen) return { ...prev, isOpen: false };
      if (!prev.content) return prev;
      return { ...prev, isOpen: true };
    });
  }, [clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <PanelContext.Provider value={{ isOpen, content, canGoBack, canGoForward, openPanel, goBack, goForward, closePanel, togglePanel }}>
      {children}
    </PanelContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePanel() {
  return useContext(PanelContext);
}

function getPanelContentKey(content: PanelContent) {
  if (content.type === 'object') return `object:${content.objectType ?? ''}:${content.objectId ?? ''}`;
  if (content.type === 'doc') return `doc:${content.docPath ?? ''}`;
  if (content.type === 'web') return `web:${content.url ?? ''}`;
  return `${content.type}:${content.title ?? ''}`;
}
