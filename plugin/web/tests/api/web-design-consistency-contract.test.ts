import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

function collectSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(filePath);
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [filePath] : [];
  });
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
  assert.match(copyButton, /inline-flex h-7 w-7/);
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

  assert.match(cardFrame, /ldvh-chip inline-flex h-\[18px\] shrink-0 items-center justify-center rounded-md border px-1\.5 text-\[10px\] font-medium leading-3/);
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
  assert.match(capabilityBadge, /h-\[18px\][\s\S]*text-\[10px\] font-sans font-medium leading-3/);
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

  assert.match(identityHeader, /const titleFontSize = compact \? 16 : 20/);
  assert.match(identityHeader, /const titleIconSize = Math\.round\(titleFontSize \* 1\.25\)/);
  assert.match(identityHeader, /const activityCount = Array\.isArray\(source\.change_log\) \? source\.change_log\.length : 0/);
  assert.match(identityHeader, /ldvh-chip inline-flex h-\[18px\] shrink-0 items-center justify-center rounded-md border px-1\.5 text-\[10px\] font-medium leading-3/);
  assert.match(identityHeader, /<History size=\{12\} aria-hidden="true" \/>[\s\S]{0,80}<span>\{activityCount\}<\/span>/);
  assert.match(identityHeader, /showCopyAction=\{showCopyAction\}[\s\S]{0,80}compact/);
  assert.match(identityHeader, /translate-y-0\.5 items-start gap-2[\s\S]{0,220}<ObjectTypeIcon type=\{objectType\} size=\{titleIconSize\} className="mt-0\.5 shrink-0"/);
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

  assert.match(identityRow, /\{extraBadges\}[\s\S]*<PriorityIcon[\s\S]*className="ml-auto shrink-0"[\s\S]*<ObjectIdentityActions/);
  const identityActions = read('src/components/ObjectIdentityActions.tsx');
  assert.match(identityActions, /\{statusLeadingBadges\}[\s\S]{0,120}\{status && \([\s\S]{0,320}\{actionBadges\}/);
  assert.doesNotMatch(identityHeader, /&& compact[\s\S]{0,180}<ObjectIdentityActions/);
});

test('fact reading labels use the central locale registry', () => {
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const associations = read('src/pages/object-detail/FactAssociationsSection.tsx');

  assert.match(layouts, /getFieldLabel\(node\.field, locale\)/);
  assert.match(layouts, /getObjectStatusLocale\('spark'/);
  assert.doesNotMatch(layouts, /locale === 'en'/);
  assert.match(associations, /getLocalizedObjectTitle\(source, locale\)/);
});

test('five fact types use distinct stable hue assignments', () => {
  const colors = read('src/utils/categoryColors.ts');
  const typeColors = ['#3b82f6', '#a855f7', '#ef4444', '#eab308', '#14b8a6'];
  assert.equal(new Set(typeColors).size, 5);
  for (const color of typeColors) assert.match(colors, new RegExp(`'${color}'|\\\"${color}\\\"`));
});

test('prominent card title follows the documented 16px by 24px hierarchy', () => {
  const styles = read('src/index.css');
  assert.match(styles, /\.ldvh-card-title-prominent[\s\S]*text-base font-semibold leading-6/);
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
  assert.match(graph, /ldvh-chip inline-flex h-\[18px\] items-center justify-center gap-1 rounded-md border border-ldvh-accent\/25 bg-ldvh-accent\/5 px-\[5px\] text-\[10px\] font-medium leading-3 text-ldvh-accent/);
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
  assert.match(cognitionApi, /discardedWorkCase[\s\S]*closure_outcome === 'cancelled'/);
  assert.match(cognitionApi, /item\.status !== undefined \? \{ status: item\.status \}/);
  assert.match(cognition, /workcase: new Set\(\['closed', 'discarded'\]\)/);
  assert.match(graph, /const status = node\.status \?\? \(node\.type === 'workcase' \? node\.progress_group : undefined\)/);
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
  assert.match(layout, /const WORKCASE_DETAIL_SEMANTIC_ICON_SIZE = 14/);
  assert.doesNotMatch(layout, /className=\{`ldvh-body \$\{styles\.body\}`\}/);
});

test('fact reading unordered-list markers stay centered on the first text line', () => {
  const styles = read('src/index.css');
  const markerRule = styles.slice(
    styles.indexOf('.ldvh-study-node-content .ldvh-inline-markdown :where(ul > li)::before'),
    styles.indexOf('.ldvh-study-node-content .ldvh-inline-markdown :where(ol > li)::marker'),
  );

  assert.match(markerRule, /top: calc\(0\.875em - 1px\);/);
  assert.match(markerRule, /transform: translateY\(-50%\);/);
  assert.match(styles, /\.ldvh-study-node-content\.ldvh-spark-reading-prose[\s\S]{0,180}top: 12px;/);
});
