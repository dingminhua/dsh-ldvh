import { ReactNode, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import ReadingPanel from './ReadingPanel';
import { PanelProvider, usePanel } from '@/utils/panelContext';
import { useProjectScope } from '@/utils/projectContext';

const SIDEBAR_STORAGE_KEY = 'ldvh-sidebar-collapsed';
// Default: expanded. Only collapse when user has explicitly chosen to.
const SIDEBAR_DEFAULT_EXPANDED = false;

interface LayoutProps {
  children: ReactNode;
}

/** Inner layout that consumes panel context */
function LayoutInner({ children }: LayoutProps) {
  const { isOpen: panelOpen, closePanel, openPanel } = usePanel();
  const { selectedProjectId, selectedWorktreePath } = useProjectScope();
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

  // Listen for Escape to close right panel
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
    // Entering a list starts with a closed reader, but opening a relation from
    // that list must not immediately close the reader again.
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
      {/* 左侧导航 — 可折叠 */}
      <div className="flex flex-shrink-0 sm:hidden">
        <Sidebar collapsed compact />
      </div>
      <div className="hidden flex-shrink-0 sm:block">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      </div>

      {/* 中间主内容 */}
      <main className="ldvh-main-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
        {/* 项目切换时重建当前路由页，触发数据重取；contents 保证不引入额外布局盒 */}
        <div key={`page-${selectedProjectId}-${selectedWorktreePath}`} className="contents">{children}</div>
      </main>

      {/* 右侧扩展阅读区随项目切换重建。 */}
      <ReadingPanel key={`panel-${selectedProjectId}-${selectedWorktreePath}`} />
    </div>
  );
}

export default function Layout({ children }: LayoutProps) {
  return (
    <PanelProvider>
      <LayoutInner>{children}</LayoutInner>
    </PanelProvider>
  );
}
