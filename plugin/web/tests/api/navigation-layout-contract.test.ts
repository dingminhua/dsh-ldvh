import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('compact viewport keeps the primary navigation as an icon rail', () => {
  const layout = fs.readFileSync(path.resolve('src/components/Layout.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8');

  assert.match(layout, /className="flex flex-shrink-0 sm:hidden"\s*>\s*<Sidebar collapsed compact \/>/);
  assert.match(layout, /className="hidden flex-shrink-0 sm:block"\s*>\s*<Sidebar collapsed=\{sidebarCollapsed\}/);
  assert.match(sidebar, /const isCollapsed = compact \|\| collapsed;/);
  assert.match(sidebar, /isCollapsed \? 'w-14' : 'w-\[186px\]'/);
  assert.match(sidebar, /flex h-full min-h-0 flex-shrink-0/);
  assert.match(sidebar, /isCollapsed && !compact \? 'overflow-visible' : 'overscroll-contain overflow-x-hidden overflow-y-auto'/);
  assert.match(sidebar, /!compact && onToggle && \(/);
});

test('the application shell owns scrolling without letting sidebar wheel input move the document', () => {
  const layout = fs.readFileSync(path.resolve('src/components/Layout.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve('src/index.css'), 'utf8');

  assert.match(layout, /className="flex h-screen min-w-\[375px\] overflow-hidden bg-ldvh-bg"/);
  assert.match(layout, /ldvh-main-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain/);
  assert.match(styles, /html,\s*body,\s*#root\s*\{\s*height: 100%;\s*overflow: clip;/s);
  assert.match(styles, /#root\s*\{\s*position: fixed;\s*inset: 0;/s);
});

test('studies are followed by the ordered directory, workspace changes, and commit records navigation group', () => {
  const app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8');

  assert.match(app, /<Route path="\/changes" element=\{<Changes \/>\} \/>/);
  assert.match(
    sidebar,
    /\{ to: '\/objects\/research'.*\},\s*\{ to: '\/project-files'/s,
  );
  assert.match(sidebar, /title=\{isCollapsed \? getNavItemLabel\(item, t\) : undefined\}/);
  assert.match(sidebar, /position \? 'fixed' : 'absolute left-full top-1\/2 ml-2'/);
  assert.match(
    sidebar,
    /\{ to: '\/project-files', labelKey: 'nav\.projectFiles'.*\},\s*\{ to: '\/changes', labelKey: 'nav\.changes'.*\},\s*\{ to: '\/changelog', labelKey: 'nav\.changelog'/s,
  );
  const locales = fs.readFileSync(path.resolve('src/i18n/locales.ts'), 'utf8');
  assert.match(locales, /'nav\.projectFiles': '目录'/);
});

test('settings has no web surface — registration and colors live in the DSH plugin settings card', () => {
  // Human 2026-09-08 决策：Web 内的设置页移除。管辖登记与项目颜色的唯一管理面
  // 是 DSH 插件设置卡（07 规范登记面）；Web 是纯呈现层。
  const app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8');
  assert.doesNotMatch(app, /<Route path="\/settings"/);
  assert.doesNotMatch(sidebar, /to: '\/settings'/);
  assert.doesNotMatch(sidebar, /'nav\.settings'/);
  assert.equal(fs.existsSync(path.resolve('src/pages/Settings.tsx')), false, 'Settings page must be deleted');
});

test('the governed project switcher lives beside the brand in global navigation', () => {
  const app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8');

  assert.match(app, /<ProjectScopeProvider>\s*<AppRoutes \/>\s*<\/ProjectScopeProvider>/);
  assert.match(sidebar, /<BrandMark \/>[\s\S]*<ProjectSwitcher collapsed=\{isCollapsed\} \/>/);
});

test('global project selection uses the configured default when no valid Human selection remains', () => {
  const context = fs.readFileSync(path.resolve('src/utils/projectContext.tsx'), 'utf8');

  assert.match(context, /result\.defaultProjectId/);
  assert.match(context, /nextProjects\.some\(\(project\) => project\.id === current\)/);
});

test('project switcher changes worktree scope and only refreshes its worktree list on demand', () => {
  const switcher = fs.readFileSync(path.resolve('src/components/ProjectSwitcher.tsx'), 'utf8');

  assert.match(switcher, /selectProject\(project\.id, worktree\.path\);/);
  assert.match(switcher, /onClick=\{\(\) => reloadProjects\(\)\}/);
  assert.doesNotMatch(switcher, /useManualFactRefresh|refreshFacts|setInterval|visibilitychange/);
});

test('workspace changes reads status and diffs for the globally selected project', () => {
  const changes = fs.readFileSync(path.resolve('src/pages/Changes.tsx'), 'utf8');
  const controller = fs.readFileSync(path.resolve('src/pages/changes/useWorkspaceChanges.ts'), 'utf8');

  assert.match(changes, /const projectId = selectedProject\?\.id \?\? '';/);
  assert.match(changes, /useWorkspaceChanges\(projectId, refreshKey\)/);
  assert.match(controller, /fetchProjectGitStatus\(projectId\)/);
  assert.match(controller, /fetchProjectGitDiff\(entry\.projectId, entry\.path, entry\.status\)/);
});

test('workspace changes defaults to split on wide screens and unified below xl', () => {
  const changes = fs.readFileSync(path.resolve('src/pages/Changes.tsx'), 'utf8');

  assert.match(changes, /WIDE_DIFF_LAYOUT_QUERY = '\(min-width: 1280px\)'/);
  assert.match(changes, /mediaQuery\.matches \? 'split' : 'unified'/);
  assert.match(changes, /useState<DiffViewMode>\(getDefaultDiffViewMode\)/);
  assert.match(changes, /diffViewModeWasSelected\.current = true/);
});

test('project files is a focused browser without nested Git views or eager Git reads', () => {
  const filesPage = fs.readFileSync(path.resolve('src/pages/ProjectFiles.tsx'), 'utf8');
  const controller = fs.readFileSync(path.resolve('src/pages/project-files/useProjectFilesController.ts'), 'utf8');

  assert.doesNotMatch(filesPage, /role="tablist"|quickDirs|projectFiles\.(changesTab|historyTab|quickRoots)/);
  assert.match(controller, /fetchProjectFileEntries\(projectId, nextDir, nextShowHidden\)/);
  assert.doesNotMatch(controller, /fetchProjectGit(Status|Diff|Commits|CommitDetail|CommitFileDiff)/);
});

test('files and changes share a compact divided page toolbar without application refresh controls', () => {
  const filesPage = fs.readFileSync(path.resolve('src/pages/ProjectFiles.tsx'), 'utf8');
  const changesPage = fs.readFileSync(path.resolve('src/pages/Changes.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve('src/index.css'), 'utf8');

  for (const page of [filesPage, changesPage]) {
    assert.match(page, /ldvh-page-toolbar mb-4/);
    assert.match(page, /<PageHeader[^>]* compact \/>/);
    // Human 2026-09-11 UI 收敛：四页（聚焦/项目文件/变更/帮助）头部只保留
    // 标题与分割线——toolbar badge（只读标识）与副标题均移除。
    assert.doesNotMatch(page, /ldvh-page-toolbar-badge/);
    assert.doesNotMatch(page, /subtitle=/);
    assert.doesNotMatch(page, /ldvh-page-toolbar-action|RefreshCcw|changes\.reload|projectFiles\.reload/);
  }
  assert.match(styles, /\.ldvh-page-toolbar \{\s*@apply[^;]*border-b[^;]*pb-4;/s);
  assert.doesNotMatch(changesPage, /changes\.(activeProject|activeProjectHint|projectScopeHint)/);
});

test('the sidebar footer stacks the language on its own row above the icon row, with refresh last', () => {
  const sidebar = fs.readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8');
  const locales = fs.readFileSync(path.resolve('src/i18n/locales.ts'), 'utf8');
  const refresh = fs.readFileSync(path.resolve('src/hooks/useReadingRefresh.tsx'), 'utf8');
  const layout = fs.readFileSync(path.resolve('src/components/Layout.tsx'), 'utf8');

  // Human 2026-09-18 指令：语言独占一行，三个图标（主题 / 收起 / 刷新）独占一行；
  // 收起态把刷新放在该区域最后一个。
  assert.match(sidebar, /RefreshCw/);
  assert.match(sidebar, /'nav\.refreshReading'/);
  assert.match(sidebar, /refreshLabel = t\('nav\.refreshReading'\)/);
  const footer = sidebar.slice(sidebar.indexOf('border-t border-ldvh-border'));
  assert.ok(footer.indexOf("showTooltip('language'") < footer.indexOf("showTooltip('theme'"), '语言行必须在图标行之前');
  assert.ok(footer.indexOf("showTooltip('theme'") < footer.indexOf("showTooltip('sidebar-toggle'"), '图标行内主题在收起之前');
  assert.ok(footer.indexOf("showTooltip('sidebar-toggle'") < footer.indexOf("showTooltip('refresh'"), '刷新必须是该区域最后一个图标');
  // 收起态（compact）在移动端与桌面折叠态共用同一图标区：语言行与图标行都必须能
  // 退化为居中 rail（语言行整行居中 + 图标行竖排居中，刷新仍是竖排里最后一个）；
  // 展开态两行都靠左对齐（Human 2026-09-19 指令），不得改为右收口。
  assert.match(sidebar, /isCollapsed \? 'flex flex-col items-center gap-1' : 'flex flex-col gap-1\.5'/);
  assert.match(sidebar, /isCollapsed \? 'justify-center' : 'w-full'/);
  assert.match(sidebar, /isCollapsed \? 'flex-col' : 'justify-start'/);
  assert.doesNotMatch(sidebar, /justify-end/);
  assert.match(locales, /'nav\.refreshReading': '刷新页面数据'/);
  assert.match(locales, /'nav\.refreshReading': 'Refresh page data'/);

  // 刷新是「重新读取当前页」，不是整页 reload：档位由 Context 承载并驱动重取。
  assert.match(refresh, /createContext<ReadingRefreshValue \| null>\(null\)/);
  assert.match(refresh, /requestRefresh: \(\) => setRefreshKey\(\(current\) => current \+ 1\)/);
  assert.doesNotMatch(sidebar, /window\.location\.reload/);
  assert.match(layout, /<RefreshScopeProvider>/);
  assert.match(layout, /key=\{`page-\$\{selectedProjectId\}-\$\{selectedWorktreePath\}-\$\{refreshKey\}`\}/);
});
