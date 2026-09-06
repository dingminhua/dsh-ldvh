import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@/i18n/context';
import Layout from '@/components/Layout';
import CognitionCenter from '@/pages/CognitionCenter';
import ProjectFiles from '@/pages/ProjectFiles';
import Changes from '@/pages/Changes';
import ObjectList from '@/pages/ObjectList';
import ObjectDetail from '@/pages/ObjectDetail';
import Changelog from '@/pages/Changelog';
import ChangelogDetail from '@/pages/ChangelogDetail';
import Settings from '@/pages/Settings';
import { ProjectScopeProvider } from '@/utils/projectContext';

function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<CognitionCenter />} />
        <Route path="/project-files" element={<ProjectFiles />} />
        <Route path="/changes" element={<Changes />} />
        <Route path="/objects/:type" element={<ObjectList />} />
        <Route path="/objects/:type/:id" element={<ObjectDetail />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/changelog/:hash" element={<ChangelogDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <ProjectScopeProvider>
          <AppRoutes />
        </ProjectScopeProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
