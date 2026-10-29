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
        {/* 25 号 Goal 单例：无 tab 无 card，详情直读路由承载（/api/cognition/goal）。 */}
        <Route path="/goal" element={<GoalDetail />} />
        <Route path="/objects/:type/:id" element={<ObjectDetail />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/changelog/:hash" element={<ChangelogDetail />} />
        <Route path="/help" element={<Help />} />
        {/* 运行时诊断：只读观察机制自身的失效形态，不参与业务裁决。 */}
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
          {/* 必须在 Provider 之内：上报要带当前选中的项目 id（路径归属），
              Provider 之外读不到 useProjectScope。 */}
          <RouteMemoryReporter />
          <AppRoutes />
        </ProjectScopeProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}

/**
 * 侧栏 iframe 位置记忆：路由或选中项目变化时通知宿主（better-sidebar 切 tab 会
 * 重挂 iframe 回到初始 src——宿主记录本路径后，重建的 iframe 直接落回用户停留
 * 的页面）。沙箱允许 postMessage；独立浏览器窗口里 parent===window 时静默跳过。
 *
 * `projectId` 是**路径归属**（07 §7 会话跟随，Human 裁定 2026-10-29）：记忆里
 * 存的可能是 `/ldvh/objects/spark/<uid>` 这类项目内的深链接，宿主换项目时若照
 * 原样沿用，新开的只会是「对象不存在」。宿主据此只在归属一致时沿用记忆路径，
 * 换了项目就落回该项目首页。上报的是 pathname（不带 query）：项目参数由宿主
 * 每次现拼，这里回传只会造成一份陈旧副本。
 */
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
    } catch { /* 跨域或沙箱异常：记忆特性静默降级 */ }
    // selectedProjectId 必须在依赖里：页内切项目时 pathname 常常不变（如两处都停在
    // 首页），漏报归属会让宿主把这条路径记在旧项目名下，下次重挂即被当成跨项目。
  }, [location.pathname, selectedProjectId]);
  return null;
}
