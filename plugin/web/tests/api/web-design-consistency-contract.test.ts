import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('compact width only changes the shell navigation and secondary reading placement', () => {
  const styles = read('src/index.css');
  const layout = read('src/components/Layout.tsx');
  const copyButton = read('src/components/CopyPathButton.tsx');
  const readingPanel = read('src/components/ReadingPanel.tsx');
  const cognitionCenter = read('src/pages/CognitionCenter.tsx');
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const objectList = read('src/pages/ObjectList.tsx');

  assert.match(layout, /className="flex flex-shrink-0 sm:hidden"[\s\S]*<Sidebar collapsed compact \/>/);
  assert.match(readingPanel, /const MOBILE_BREAKPOINT = 640/);
  assert.match(readingPanel, /if \(isMobile\)[\s\S]*fixed bottom-0 left-0 right-0/);
  assert.match(styles, /\.ldvh-page-frame\s*\{\s*@apply p-6;/);
  assert.match(styles, /\.ldvh-tab-button\s*\{\s*@apply inline-flex min-w-0[\s\S]*?\}/);
  assert.doesNotMatch(styles, /\.ldvh-tab-button[\s\S]*min-h-11|\.ldvh-tab-list[\s\S]*min-h-11/);
  assert.doesNotMatch(objectList, /onClick=\{\(\) => onOpen\(obj\.id\)\}[\s\S]{0,180}min-h-11/);
  assert.match(copyButton, /sizeClass = size === 'md' \? 'h-8 w-8' : 'h-7 w-7'/);
  assert.match(copyButton, /className=\{`inline-flex \$\{sizeClass\}/);
  assert.match(cognitionCenter, /cursor-pointer flex-wrap items-center[\s\S]{0,500}cognition\.sparkHealth\.title/);
  assert.match(cognitionCenter, /function RecentActivityRow[\s\S]*role="button"[\s\S]*onClick=\{open\}[\s\S]*onKeyDown=\{\(event\) => openOnKeyboard\(event, open\)\}/);
  assert.match(cognitionCenter, /function SparkHealthRow[\s\S]*role="button"[\s\S]*onClick=\{open\}[\s\S]*onKeyDown=\{\(event\) => openOnKeyboard\(event, open\)\}/);
  assert.doesNotMatch(cognitionCenter, /cognition\.sparkHealth\.title[\s\S]{0,220}\btruncate\b/);
  assert.doesNotMatch(copyButton, /\b(?:sm|md):/);
  assert.doesNotMatch(objectDetail, /\b(?:sm|md):/);

  const compactBranchesOutsideShell = [cognitionCenter, objectDetail, objectList, copyButton].join('\n');
  assert.doesNotMatch(compactBranchesOutsideShell, /\b(?:sm|md):/);
});

test('mobile reading panel identifies the current object and terminal cards retain status identity', () => {
  const readingPanel = read('src/components/ReadingPanel.tsx');
  const objectList = read('src/pages/ObjectList.tsx');

  assert.match(readingPanel, /ldvh-card-title w-full truncate text-center">{panelTitle}/);
  assert.match(objectList, /<ObjectIdentityActions[\s\S]{0,160}status={presentedStatus}/);
  assert.doesNotMatch(objectList, /showStatusBadge/);
});

test('object list cards use the compact metadata shared by reading surfaces', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const priorityIcon = read('src/components/PriorityIcon.tsx');
  const statusBadge = read('src/components/StatusBadge.tsx');
  const capabilityBadge = read('src/components/WorkCaseCapabilityStatusBadge.tsx');
  const identityActions = read('src/components/ObjectIdentityActions.tsx');
  const cardFrame = objectList.slice(
    objectList.indexOf('export function ObjectCardFrame'),
    objectList.indexOf('function hasSparkResolvedFact'),
  );

  assert.match(cardFrame, /ldvh-chip-sm/);
  assert.match(cardFrame, /const activityCount = Array\.isArray\(obj\.change_log\) \? obj\.change_log\.length : 0/);
  assert.match(cardFrame, /<History size=\{12\} aria-hidden="true" \/>[\s\S]{0,80}<span>\{activityCount\}<\/span>/);
  assert.match(cardFrame, /<ObjectIdentityActions[\s\S]{0,460}compact/);
  assert.match(cardFrame, /items-center gap-1\.5[\s\S]{0,220}<ObjectTypeIcon type=\{obj\.type\} size=\{14\} className="shrink-0"/);
  assert.match(cardFrame, /ldvh-object-title-tray ldvh-object-title-tray-compact/);
  assert.match(cardFrame, /<h2 className="ldvh-card-title min-w-0 flex-1 whitespace-normal break-words">/);
  assert.match(objectList, /isDiscarded \? 'text-slate-400\/65 dark:text-slate-500\/60' : 'text-ldvh-text-secondary\/95 group-hover:text-ldvh-accent'/);
  assert.match(cardFrame, /mt-1 flex min-w-0 items-center justify-end(?: pt-0\.5)? text-right opacity-70[\s\S]{0,80}<ObjectUpdatedMeta/);
  assert.match(objectList, /const \[objectSearch, setObjectSearch\] = useState\(''\)/);
  assert.match(objectList, /getLocalizedObjectTitle\(item, locale\)\.toLowerCase\(\)[\s\S]{0,280}objectId\.includes\(normalizedObjectSearch\)/);
  assert.match(objectList, /const \[isObjectSearchOpen, setIsObjectSearchOpen\] = useState\(false\)/);
  assert.match(objectList, /<SegmentedControl[\s\S]*objectList\.sortCreatedDesc/);
  assert.match(objectList, /renderObjectSearch\(\)[\s\S]*<SegmentedControl/);
  assert.match(objectList, /type="search"[\s\S]*objectList\.searchPlaceholder/);
  assert.match(objectList, /<div className="relative h-7 w-8 shrink-0">[\s\S]*<label className="absolute right-0 top-0 z-30 flex w-60/);
  assert.match(objectList, /onClick=\{\(\) => setIsObjectSearchOpen\(true\)\}[\s\S]{0,240}aria-expanded=\{false\}/);
  assert.match(priorityIcon, /font-sans font-medium/);
  assert.doesNotMatch(priorityIcon, /font-mono/);
  assert.match(statusBadge, /font-sans font-medium/);
  assert.doesNotMatch(statusBadge, /font-mono/);
  assert.match(capabilityBadge, /ldvh-chip-sm/);
  assert.match(objectList, /filteredItems\.map\(\(obj\) => renderObjectCard\(obj\)\)/);
  assert.match(identityActions, /compact\?: boolean/);
  assert.match(identityActions, /variant=\{compact \? 'compact' : undefined\}/);
});

test('object detail headers use compact metadata and title-scaled type icons', () => {
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const identityHeader = objectDetail.slice(
    objectDetail.indexOf('export function ObjectIdentityHeader'),
    objectDetail.indexOf('function HeaderDateMeta'),
  );

  assert.match(identityHeader, /const titleFontSize = 18/);
  assert.match(identityHeader, /const titleIconSize = Math\.round\(titleFontSize \* 1\.15\)/);
  assert.match(identityHeader, /const activityCount = Array\.isArray\(source\.change_log\) \? source\.change_log\.length : 0/);
  assert.match(identityHeader, /ldvh-chip-sm/);
  assert.match(identityHeader, /<History size=\{12\} aria-hidden="true" \/>[\s\S]{0,80}<span>\{activityCount\}<\/span>/);
  assert.match(identityHeader, /showCopyAction=\{showCopyAction\}[\s\S]{0,80}compact/);
  // Human 2026-09-09：标题缩 2 级后多行标题图标垂直居中（items-center，去掉 mt-0.5）。
  assert.match(identityHeader, /translate-y-0\.5 items-center gap-2[\s\S]{0,220}<ObjectTypeIcon type=\{objectType\} size=\{titleIconSize\} className="shrink-0"/);
  assert.match(identityHeader, /mb-1\.5 flex min-w-0 flex-wrap items-center/);
  assert.match(identityHeader, /mt-1\.5 flex min-w-0 flex-wrap items-center justify-end/);
  assert.match(identityHeader, /showDefaultDates && <span className="opacity-70"><HeaderDateMeta value=\{updated\} \/><\/span>/);
});

test('detail identity header keeps status immediately before its copy control', () => {
  const objectDetail = read('src/pages/ObjectDetail.tsx');
  const identityHeader = objectDetail.slice(
    objectDetail.indexOf('export function ObjectIdentityHeader'),
    objectDetail.indexOf('function HeaderDateMeta'),
  );
  const identityRow = identityHeader.slice(
    identityHeader.indexOf('className="mb-1.5 flex min-w-0 flex-wrap items-center'),
    identityHeader.indexOf('<div className="flex min-w-0 flex-wrap items-center gap-x-3'),
  );

  // Human 定案 2026-09-13：标签序与列表卡头一致——类型 → 优先级 → SG →
  // 修改次数（extraBadges 随后；状态与复制控件保持行尾）。
  assert.match(identityRow, /<PriorityIcon[\s\S]*<ServesSgBadge[\s\S]*\{extraBadges\}[\s\S]*className="ml-auto shrink-0"[\s\S]*<ObjectIdentityActions/);
  const identityActions = read('src/components/ObjectIdentityActions.tsx');
  assert.match(identityActions, /\{statusLeadingBadges\}[\s\S]{0,120}\{status && \([\s\S]{0,320}\{actionBadges\}/);
  assert.doesNotMatch(identityHeader, /&& compact[\s\S]{0,180}<ObjectIdentityActions/);
});

test('fact reading labels use the central locale registry', () => {
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const associations = read('src/pages/object-detail/FactAssociationsSection.tsx');

  assert.match(layouts, /title=\{getFieldLabel\('[^']+', locale\)\}/);
  assert.match(layouts, /getObjectStatusLocale\('spark'/);
  assert.doesNotMatch(layouts, /locale === 'en'/);
  assert.match(associations, /getLocalizedObjectTitle\(source, locale\)/);
});

test('five fact types use distinct stable hue assignments', () => {
  const colors = read('src/utils/categoryColors.ts');
  const typeColors = ['#3b82f6', '#a855f7', '#ef4444', '#eab308', '#14b8a6'];
  assert.equal(new Set(typeColors).size, 5);
  for (const color of typeColors) assert.match(colors, new RegExp(`'${color}'|"${color}"`));
});

test('prominent card title follows the documented 14px by 20px hierarchy', () => {
  const styles = read('src/index.css');
  assert.match(styles, /\.ldvh-card-title-prominent[\s\S]*text-sm font-semibold leading-5/);
  assert.match(styles, /\.ldvh-inline-markdown\.ldvh-card-decision-body[\s\S]*text-xs leading-5/);
});

test('recent hotspots keep a compact relationship overview and a focused one-hop mind map', () => {
  const graph = read('src/pages/cognition/CommitHotspotGraph.tsx');
  assert.match(graph, /export function nodeKey\(node: CognitionRecentHotspotNode\)/);
  assert.match(graph, /node\.object_uid \? `uid:\$\{node\.object_uid\}` : `legacy:\$\{node\.type\}:\$\{node\.id\}`/);
  const cognitionCenter = read('src/pages/CognitionCenter.tsx');
  const styles = read('src/index.css');

  assert.match(graph, /relatedWorkItems\(cluster\.relations\)/);
  assert.match(graph, /const items = new Map<string, RelatedWork>\(\)/);
  assert.match(graph, /const COMPACT_WORK_LIMIT = 5/);
  assert.match(graph, /const primarySize = \{ width: Math\.max\(96, width - horizontalPadding \* 2\), height: 108 \}/);
  assert.match(graph, /const relatedSize = \{ width: primarySize\.width \* 0\.75, height: 108 \}/);
  assert.match(graph, /className="flex h-full min-w-0 flex-col items-center justify-center gap-2 px-3 py-2\.5"/);
  assert.match(graph, /className={`block min-w-0 max-w-full overflow-hidden break-words text-center/);
  assert.match(graph, /data-hotspot-node-header className="flex min-w-0 shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1"/);
  assert.match(graph, /getTypeLabel\(node\.type, locale\)/);
  assert.match(graph, /<PriorityIcon source=\{node\} type=\{node\.type\} locale=\{locale\} size="xs" \/>/);
  assert.match(graph, /node\.activityRefs\.length > 0[\s\S]*<History size=\{12\} aria-hidden="true" \/>/);
  assert.match(graph, /<StatusBadge status=\{status\} statusLabel=\{getObjectStatusLocale\(node\.type, status, locale\)\} objectType=\{node\.type\} size="xs" variant="compact" \/>/);
  assert.doesNotMatch(graph, /data-hotspot-node-meta/);
  assert.match(graph, /ldvh-object-title-tray flex min-w-0 w-full items-center justify-center px-3 py-2 text-center[\s\S]*inline-grid min-w-0 max-w-full grid-cols-\[auto_minmax\(0,1fr\)\] items-center gap-2[\s\S]*<ObjectTypeIcon[\s\S]*className="shrink-0"[\s\S]*data-hotspot-node-title/);
  assert.match(graph, /data-hotspot-node-title[\s\S]*text-center/);
  assert.match(graph, /const relatedSize = \{ width: primarySize\.width \* 0\.75, height: 132 \}/);
  assert.match(graph, /position: \{ x: width \/ 2, y: firstRelatedY \+ index \* rowGap \}/);
  assert.doesNotMatch(graph, /supportedColumns|indexInRow|nodesInRow/);
  assert.doesNotMatch(graph, /Math\.min\((272|320|420|440|460),/);
  assert.match(graph, /function compactLayout/);
  assert.match(graph, /function compactMultiRoutePath/);
  assert.match(graph, /function expandedLayout/);
  assert.match(graph, /function splitMindMapSides/);
  assert.match(graph, /function expandedMindMapAnchors/);
  assert.match(graph, /mode === 'expanded' && layout\.edgeOrientation === 'horizontal'[\s\S]*expandedMindMapAnchors/);
  assert.match(graph, /x: primaryPosition\.x \+ \(relatedOnLeft \? -primarySize\.width \/ 2 : primarySize\.width \/ 2\)/);
  assert.match(graph, /x: relatedPosition\.x \+ \(relatedOnLeft \? relatedSize\.width \/ 2 : -relatedSize\.width \/ 2\)/);
  assert.match(graph, /function CompactHotspotDiagram/);
  assert.match(graph, /function ExpandedHotspotMindMap/);
  assert.match(graph, /function DiagramEdges/);
  assert.match(graph, /function AccessibleRelationList/);
  assert.match(graph, /cognition\.commitHotspots\.workRelation\.related/);
  assert.match(graph, /getFieldLabel\(`relation_\$\{relationKey\.replace/);
  assert.match(graph, /className="ml-auto flex min-w-0 flex-wrap items-center justify-end/);
  assert.match(graph, /ldvh-chip-sm/);
  assert.match(graph, /<History size=\{12\}/);
  assert.match(graph, /mode === 'expanded'/);
  assert.match(graph, /markerStart=\{directions\.incoming/);
  assert.match(graph, /markerEnd=\{directions\.outgoing/);
  assert.match(graph, /highlightedKey !== null && highlightedKey !== key/);
  assert.match(graph, /mode="compact" layout=\{layout\} highlightedKey=\{highlightedKey\}/);
  assert.match(graph, /mode === 'compact' && layout\.edgeOrientation === 'vertical'[\s\S]*compactMultiRoutePath/);
  assert.match(graph, /mode="compact"[\s\S]*dimmed=\{highlightedKey !== null && highlightedKey !== key\}[\s\S]*onHighlight=\{\(active\) => setHighlightedKey/);
  assert.match(graph, /aria-label=\{`\$\{roleLabel\}: \$\{title\}[\s\S]*cognition\.commitHotspots\.commitRefs/);
  assert.doesNotMatch(graph, /title=\{labels\.join\(' · '\)\}/);
  assert.match(graph, /data-hotspot-node-header[\s\S]*node\.activityRefs\.length[\s\S]*status/);
  const cognition = read('src/pages/CognitionCenter.tsx');
  const cognitionApi = read('api/routes/cognition.ts');
  // v5：cancelled 是 closed 的 outcome 四值之一，不再映射 v4 的 discarded 组。
  assert.doesNotMatch(cognitionApi, /discardedWorkCase|closure_outcome/);
  assert.match(cognitionApi, /item\.status !== undefined \? \{ status: item\.status \}/);
  assert.match(cognition, /workcase: new Set\(\['closed'\]\)/);
  assert.match(graph, /const status = node\.status \?\? \(node\.type === 'workcase' \? node\.group : undefined\)/);
  assert.match(graph, /const titleFontSize = primary \? \(expanded \? 18 : 16\) : 14/);
  assert.match(graph, /const titleIconSize = titleFontSize/);
  assert.match(graph, /size=\{titleIconSize\}/);
  assert.match(graph, /primary \? \(expanded \? 'text-lg font-semibold leading-6' : 'text-base font-semibold leading-\[22px\]'\) : 'text-sm font-medium leading-5'/);
  assert.match(graph, /gridColumn: '1 \/ -1'/);
  assert.match(graph, /data-hotspot-mode=\{expanded \? 'expanded' : 'compact'\}/);
  assert.match(graph, /cognition\.commitHotspots\.expandClusterWidth/);
  assert.match(graph, /cognition\.commitHotspots\.restoreClusterWidth/);
  assert.match(graph, /aria-expanded=\{expanded\}/);
  assert.match(graph, /aria-controls=\{contentId\}/);
  assert.match(graph, /canExpand &&/);
  assert.match(cognitionCenter, /const clusterKey = nodeKey\(cluster\.primary\)/);
  assert.match(cognitionCenter, /expandedHotspotKey === clusterKey/);
  assert.doesNotMatch(graph, /forceSimulation|d3-force|semanticSimilarity|multiHop/);
  assert.match(cognitionCenter, /ldvh-hotspot-grid min-w-0 items-start/);
  assert.match(cognitionCenter, /type RecentHotspotStatusFilter = 'all' \| 'progressing' \| 'decision' \| 'settled'/);
  assert.match(cognitionCenter, /useState<RecentHotspotStatusFilter>\('progressing'\)/);
  assert.match(cognitionCenter, /getRecentHotspotStatusGroup\(cluster\.primary\) === recentHotspotStatusFilter/);
  assert.match(cognitionCenter, /RECENT_HOTSPOT_STATUS_FILTERS\.map/);
  assert.match(cognitionCenter, /aria-pressed=\{recentHotspotStatusFilter === filter\}/);
  assert.match(cognitionCenter, /setExpandedHotspotKey\(null\)/);
  assert.match(cognitionCenter, /filteredRecentHotspotClusters\.map/);
  assert.match(cognitionCenter, /cognition\.commitHotspots\.filterEmpty/);
  assert.match(styles, /\.ldvh-hotspot-grid[\s\S]*width: 100%[\s\S]*max\(22rem, calc\(\(100% - 6rem\) \/ 5\)\)/);
  assert.doesNotMatch(styles, /\.ldvh-hotspot-grid[\s\S]{0,180}max-width/);
  assert.match(cognitionCenter, /expandedHotspotKey/);
  assert.match(cognitionCenter, /canExpand=\{cluster\.relations\.length > 0\}/);
  assert.match(cognitionCenter, /expanded=\{expandedHotspotKey ===/);
  assert.doesNotMatch(cognitionCenter, /cognition-commit-hotspots-content" className="flex min-h-0 flex-1/);
  assert.doesNotMatch(graph, /<section className="flex h-full/);
});

test('WorkCase semantic blocks keep the compact 14/13px by 22px hierarchy', () => {
  const styles = read('src/index.css');
  const layout = read('src/pages/object-detail/WorkCaseReadingLayout.tsx');
  assert.match(styles, /\.ldvh-detail-semantic-title[\s\S]*text-sm font-semibold[\s\S]*line-height: 1\.375rem/);
  assert.match(styles, /\.ldvh-detail-semantic-body[\s\S]*font-size: 0\.8125rem[\s\S]*line-height: 1\.375rem/);
  assert.match(styles, /\.ldvh-inline-markdown\.ldvh-detail-semantic-body[\s\S]*font-size: 0\.8125rem[\s\S]*line-height: 1\.375rem/);
  // v5：语义块的字号层级由 styles 承载（上面三条 CSS 断言）；布局层不再
  // 持有 v4 的图标尺寸常量与 styles.body 形态。
  assert.doesNotMatch(layout, /WORKCASE_DETAIL_SEMANTIC_ICON_SIZE/);
  assert.doesNotMatch(layout, /className=\{`ldvh-body \$\{styles\.body\}`\}/);
  assert.match(layout, /ldvh-card-decision-body/);
});

test('fact reading unordered-list markers stay centered on the first text line', () => {
  const styles = read('src/index.css');
  const markerRule = styles.slice(
    styles.indexOf('.ldvh-research-node-content .ldvh-inline-markdown :where(ul > li)::before'),
    styles.indexOf('.ldvh-research-node-content .ldvh-inline-markdown :where(ol > li)::marker'),
  );

  assert.match(markerRule, /top: calc\(0\.875em - 1px\);/);
  assert.match(markerRule, /transform: translateY\(-50%\);/);
  assert.match(styles, /\.ldvh-research-node-content\.ldvh-spark-reading-prose[\s\S]{0,180}top: 12px;/);
});


test('Federation pages reuse the shared layout grammar and do not invent viewport grid variants', () => {
  const federation = read('src/pages/Federation.tsx');
  const federationObjects = read('src/pages/FederationObjects.tsx');

  // 卡片列表必须使用容器驱动网格（design-consistency 01 §1.5），不可用 sm:/md:/xl: 断点列数。
  assert.match(federation, /ldvh-section-grid/);
  assert.match(federationObjects, /ldvh-section-grid/);
  assert.doesNotMatch(federation, /sm:grid-cols|md:grid-cols|xl:grid-cols/);
  assert.doesNotMatch(federationObjects, /sm:grid-cols|md:grid-cols|xl:grid-cols/);

  // 空态与加载态沿用 v4 无框 py-20 + 居中弱文本语法；不能发明盒式空态。
  assert.match(federation, /ldvh-body-muted\s+py-20\s+text-center/);
  assert.match(federationObjects, /ldvh-body-muted\s+py-20\s+text-center/);
  assert.match(federation, /ldvh-body-muted\s+flex\s+justify-center\s+py-20/);
  assert.match(federationObjects, /ldvh-body-muted\s+flex\s+justify-center\s+py-20/);
  assert.doesNotMatch(federation, /rounded-xl border border-ldvh-border bg-ldvh-panel p-8/);
  assert.doesNotMatch(federationObjects, /rounded-xl border border-ldvh-border bg-ldvh-panel p-8/);

  // 刷新工具按钮必须复用设计系统令牌，不可手搓独立样式。
  assert.match(federation, /ldvh-page-toolbar-action/);
  assert.match(federationObjects, /ldvh-page-toolbar-action/);
  assert.doesNotMatch(federation, /rounded-md border border-ldvh-border px-3 py-2 text-ldvh-text-secondary/);
  assert.doesNotMatch(federationObjects, /rounded-md border border-ldvh-border px-3 py-2 text-ldvh-text-secondary/);
});

/**
 * 阅读节点的正文可读性（两处实测缺陷，2026-09-20）。
 *
 * ① 对比度：正文取色原为 `rgb(var(--ldvh-text-secondary) / 0.92)`。alpha 并非
 *    中性——它把文本色向底色混合，浅色壳底上实测 4.05:1，**低于本仓库既有的
 *    「正文 4.5:1 线」**（该线由 WorkCaseGistLine 对框线/正文分取值的登记确立，
 *    并已用于把 `${color}dd` 判为不可读）。去掉 alpha 后浅色 4.74:1、暗色 7.46:1。
 *
 *    本用例**复算对比度**，而不是只断言 CSS 字符串：断言字符串无法发现「换一个
 *    同样带 alpha 的写法」，而复算能。色值从 index.css 的 token 读出，避免两边漂移。
 *
 * ② 行宽：长文正文一行容纳过多字符会串行。实测壳内文本列宽约 792px，14px 字号下
 *    汉字约 57 字/行，超出中文正文舒适区（约 25–40 字/行）约 1.4 倍。已对行文元素
 *    取 40em；表格与代码块是滚动容器，不得一并收窄。
 */
function relativeLuminance([r, g, b]: number[]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: number[], bg: number[]): number {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** 从 index.css 的 `--name: r g b` 读 token（浅色取 :root，暗色取 :root.dark）。 */
function readToken(styles: string, name: string, dark: boolean): number[] {
  const scope = dark ? styles.slice(styles.indexOf(':root.dark')) : styles;
  const match = new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(scope);
  assert.ok(match, `index.css 必须定义令牌 --${name}${dark ? '（:root.dark）' : ''}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

test('阅读节点的正文取色达到 4.5:1 —— 两个主题都复算，不只断言写法', () => {
  const styles = read('src/index.css');

  // 壳底 = --ldvh-bg 的 40% 叠在 --ldvh-panel（卡片底）上，与 .ldvh-research-node-content 一致。
  const blend = (fg: number[], bg: number[], alpha: number) =>
    fg.map((channel, index) => channel * alpha + bg[index] * (1 - alpha));

  // 规则本身不得带 alpha——alpha 会把文本色拉向底色，是本次缺陷的成因。
  assert.match(
    styles,
    /\.ldvh-research-node-content \.ldvh-inline-markdown\s*\{\s*color:\s*rgb\(var\(--ldvh-text-secondary\)\);/,
    '阅读节点正文取色不得带 alpha（alpha 叠加曾使浅色下只有 4.05:1）',
  );

  for (const dark of [false, true]) {
    const panel = readToken(styles, 'ldvh-panel', dark);
    const bg = readToken(styles, 'ldvh-bg', dark);
    const text = readToken(styles, 'ldvh-text-secondary', dark);
    const shell = blend(bg, panel, 0.4);
    const ratio = contrastRatio(text, shell);
    const label = dark ? '暗色' : '浅色';
    assert.ok(
      ratio >= 4.5,
      `${label}阅读节点正文对比度 ${ratio.toFixed(2)}:1 低于正文 4.5:1 线（壳底 ${shell.map(Math.round).join(',')}）`,
    );
  }
});

test('长文正文取舒适行宽，且不波及表格与代码块', () => {
  const styles = read('src/index.css');

  // 行文元素收窄到 40em（随字号缩放）。
  const prose = /\.ldvh-research-node-content \.ldvh-inline-markdown :where\(([^)]*)\)\s*\{\s*max-width:\s*40em;/;
  const match = prose.exec(styles);
  assert.ok(match, '阅读节点的行文元素必须有 40em 行宽上限（实测 792px 约 57 字/行，超出舒适区）');
  for (const selector of ['p', 'li', 'blockquote', 'h2']) {
    assert.ok(
      match![1].split(',').map((part) => part.trim()).includes(selector),
      `行宽规则须覆盖 ${selector}（行文元素），实际为 ${match![1]}`,
    );
  }

  // 表格与代码块不得进入行宽规则：二者已是 max-width:100% + overflow-x:auto 的
  // 滚动容器，收窄会在窄列里挤压它们。
  const covered = match![1].split(',').map((part) => part.trim());
  assert.ok(!covered.includes('table'), '表格不得被行宽规则收窄（它是滚动容器）');
  assert.ok(!covered.includes('pre'), '代码块不得被行宽规则收窄（它是滚动容器）');
  assert.match(styles, /\.ldvh-inline-markdown :where\(table\)\s*\{\s*display: block;\s*max-width: 100%;\s*overflow-x: auto;/);
});
