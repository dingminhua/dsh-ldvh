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
import GoalDetail from '@/pages/GoalDetail';
import ObjectDetail from '@/pages/ObjectDetail';
import Changelog from '@/pages/Changelog';
import ChangelogDetail from '@/pages/ChangelogDetail';
import Help from '@/pages/Help';
import Diagnostics from '@/pages/Diagnostics';
import { ProjectScopeProvider, useProjectScope } from '@/utils/projectContext';

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
        { }
        <Route path="/goal" element={<GoalDetail />} />
        <Route path="/objects/:type/:id" element={<ObjectDetail />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/changelog/:hash" element={<ChangelogDetail />} />
        <Route path="/help" element={<Help />} />
        { }
        <Route path="/diagnostics" element={<Diagnostics />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env?.BASE_URL}>
      <I18nProvider>
        <ProjectScopeProvider>
          { }
          <RouteMemoryReporter />
          <AppRoutes />
        </ProjectScopeProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}

function RouteMemoryReporter() {
  const location = useLocation();
  const { selectedProjectId } = useProjectScope();
  useEffect(() => {
    try {
      if (window.parent !== window) {
        const base = import.meta.env?.BASE_URL ?? '/';
        window.parent.postMessage({
          type: 'ldvh:navigate',
          pathname: `${base}${location.pathname}`.replace('//', '/'),
          projectId: selectedProjectId || null,
        }, '*');
      }
    } catch {
      void 0;
    }
  }, [location.pathname, selectedProjectId]);
  return null;
}
