import { useEffect } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { I18nProvider } from '@/i18n/context';
import Layout from '@/components/Layout';
import CognitionCenter from '@/pages/CognitionCenter';
import Federation from '@/pages/Federation';
import FederationObjects from '@/pages/FederationObjects';
import ProjectFiles from '@/pages/ProjectFiles';
import Changes from '@/pages/Changes';
import ObjectList from '@/pages/ObjectList';
import ObjectDetail from '@/pages/ObjectDetail';
import Changelog from '@/pages/Changelog';
import ChangelogDetail from '@/pages/ChangelogDetail';
import Help from '@/pages/Help';
import { ProjectScopeProvider } from '@/utils/projectContext';

function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<CognitionCenter />} />
        <Route path="/federation" element={<Federation />} />
        <Route path="/federation/objects/:type" element={<FederationObjects />} />
        <Route path="/project-files" element={<ProjectFiles />} />
        <Route path="/changes" element={<Changes />} />
        <Route path="/objects/:type" element={<ObjectList />} />
        <Route path="/objects/:type/:id" element={<ObjectDetail />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/changelog/:hash" element={<ChangelogDetail />} />
        <Route path="/help" element={<Help />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env?.BASE_URL}>
      <RouteMemoryReporter />
      <I18nProvider>
        <ProjectScopeProvider>
          <AppRoutes />
        </ProjectScopeProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}

/** 侧栏 iframe 位置记忆：路由变化时通知宿主（better-sidebar 切 tab 重挂 iframe
 * 会回到初始 src——宿主记录本路径后，重建的 iframe 直接落回用户停留的页面）。
 * 沙箱允许 postMessage；独立浏览器窗口里 parent===window 时静默跳过。 */
function RouteMemoryReporter() {
  const location = useLocation();
  useEffect(() => {
    try {
      if (window.parent !== window) {
        const base = import.meta.env?.BASE_URL ?? '/';
        window.parent.postMessage({ type: 'ldvh:navigate', pathname: `${base}${location.pathname}`.replace('//', '/') }, '*');
      }
    } catch { /* 跨域或沙箱异常：记忆特性静默降级 */ }
  }, [location.pathname]);
  return null;
}
