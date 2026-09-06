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
    /\{ to: '\/objects\/study'.*\},\s*\{ to: '\/project-files'/s,
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

test('settings is the final navigation entry and only exposes governed-project configuration', () => {
  const app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8');
  const settings = fs.readFileSync(path.resolve('src/pages/Settings.tsx'), 'utf8');
  const locales = fs.readFileSync(path.resolve('src/i18n/locales.ts'), 'utf8');

  assert.match(app, /<Route path="\/settings" element=\{<Settings \/>\} \/>/);
  assert.match(sidebar, /\{ to: '\/changelog'[\s\S]*\{ to: '\/settings', labelKey: 'nav\.settings'[\s\S]*\];/);
  assert.match(settings, /t\('settings\.configOnly'\)/);
  assert.match(settings, /useI18n/);
  assert.match(settings, /t\('settings\.gitNotice'\)/);
  assert.match(settings, /t\('settings\.defaultProject'\)/);
  assert.match(settings, /t\('settings\.saveDefault'\)/);
  assert.match(locales, /'settings\.title': '设置'/);
  assert.match(locales, /'settings\.title': 'Settings'/);
  assert.doesNotMatch(settings, /fetchProjectGit|fetchObject|saveObject/);
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
  assert.match(changes, /useWorkspaceChanges\(projectId\)/);
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
    assert.match(page, /ldvh-page-toolbar-badge/);
    assert.doesNotMatch(page, /ldvh-page-toolbar-action|RefreshCcw|changes\.reload|projectFiles\.reload/);
  }
  assert.match(styles, /\.ldvh-page-toolbar \{\s*@apply[^;]*border-b[^;]*pb-4;/s);
  assert.match(styles, /\.ldvh-page-toolbar-(?:badge|action) \{\s*@apply[^;]*h-8/s);
  assert.doesNotMatch(changesPage, /changes\.(activeProject|activeProjectHint|projectScopeHint)/);
});
