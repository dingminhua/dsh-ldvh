import { ReactNode, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import ReadingPanel from './ReadingPanel';
import { PanelProvider, usePanel } from '@/utils/panelContext';
import { useProjectScope } from '@/utils/projectContext';
import { RefreshScopeProvider, useRefreshKey } from '@/hooks/useReadingRefresh';

const SIDEBAR_STORAGE_KEY = 'ldvh-sidebar-collapsed';
const SIDEBAR_DEFAULT_EXPANDED = false;

interface LayoutProps {
  children: ReactNode;
}

function LayoutInner({ children }: LayoutProps) {
  const { isOpen: panelOpen, closePanel, openPanel } = usePanel();
  const { selectedProjectId, selectedWorktreePath } = useProjectScope();
  const refreshKey = useRefreshKey();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored === null) return SIDEBAR_DEFAULT_EXPANDED;
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return SIDEBAR_DEFAULT_EXPANDED;
    }
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panelOpen) {
        closePanel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panelOpen, closePanel]);

  useEffect(() => {
    if (/^\/objects\/[^/]+\/?$/.test(location.pathname)) closePanel();
  }, [location.pathname, closePanel]);

  useEffect(() => {
    const onRefPreview = (event: Event) => {
      const { refType, refId, title } = (event as CustomEvent<{ refType?: string; refId?: string; title?: string }>).detail ?? {};
      if (!refType || !refId) return;
      event.preventDefault();
      openPanel({ type: 'object', title: title || refId, objectType: refType, objectId: refId });
    };
    document.addEventListener('ldvh:ref-preview', onRefPreview);
    return () => document.removeEventListener('ldvh:ref-preview', onRefPreview);
  }, [openPanel]);

  useEffect(() => {
    const onDocPreview = (event: Event) => {
      const { path } = (event as CustomEvent<{ path?: string }>).detail ?? {};
      if (!path) return;
      event.preventDefault();
      if (path.startsWith('http://') || path.startsWith('https://')) {
        openPanel({ type: 'web', title: path, url: path });
        return;
      }
      openPanel({ type: 'doc', title: path, docPath: path });
    };
    document.addEventListener('ldvh:doc-preview', onDocPreview);
    return () => document.removeEventListener('ldvh:doc-preview', onDocPreview);
  }, [openPanel]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch (error) {
        void error;
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen min-w-[375px] overflow-hidden bg-ldvh-bg">
      { }
      <div className="flex flex-shrink-0 lg:hidden">
        <Sidebar collapsed compact />
      </div>
      <div className="hidden flex-shrink-0 lg:block">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      </div>

      { }
      <main className="ldvh-main-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
        { }
        <div key={`page-${selectedProjectId}-${selectedWorktreePath}-${refreshKey}`} className="contents">{children}</div>
      </main>

      { }
      <ReadingPanel key={`panel-${selectedProjectId}-${selectedWorktreePath}`} />
    </div>
  );
}

export default function Layout({ children }: LayoutProps) {
  return (
    <RefreshScopeProvider>
      <PanelProvider>
        <LayoutInner>{children}</LayoutInner>
      </PanelProvider>
    </RefreshScopeProvider>
  );
}
