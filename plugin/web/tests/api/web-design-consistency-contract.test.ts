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
  const objectList = read('src/pages/ObjectList.tsx')
    + read('src/components/FactAssociationRows.tsx');

  const TAILWIND_SCREEN_PX: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280 };

  const breakpointDecl = /const COMPACT_BREAKPOINT = (\d+);/.exec(readingPanel);
  assert.ok(breakpointDecl, 'ReadingPanel 须以 COMPACT_BREAKPOINT 常量声明 Compact 断点');
  const compactPx = Number(breakpointDecl![1]);

  const railSwitch = /className="flex flex-shrink-0 (sm|md|lg|xl):hidden"/.exec(layout);
  assert.ok(railSwitch, 'Layout 的图标栏切换须使用 Tailwind 断点前缀');
  const layoutPrefix = railSwitch![1];
  assert.equal(
    TAILWIND_SCREEN_PX[layoutPrefix],
    compactPx,
    `Layout 的 \`${layoutPrefix}:\`（${TAILWIND_SCREEN_PX[layoutPrefix]}px）与 ReadingPanel 的 ` +
      `COMPACT_BREAKPOINT（${compactPx}px）不同值——两处断点必须同值，否则会出现` +
      `「展开侧栏 + 底部抽屉」或「图标栏 + 右侧面板」的错配组合（docs/01 §1.6）。`,
  );
  assert.match(readingPanel, /if \(isCompact\)[\s\S]*fixed bottom-0 left-0 right-0/);

  const navHitDecls = [...readingPanel.matchAll(
    /disabled:opacity-35 ((?:sm|md|lg|xl):h-7) ((?:sm|md|lg|xl):w-7)/g,
  )];
  assert.ok(navHitDecls.length > 0, 'ReadingPanel 导航按钮须以 Tailwind 断点前缀控制桌面命中区尺寸');
  for (const [index, decl] of navHitDecls.entries()) {
    const hPrefix = decl[1].split(':')[0];
    const wPrefix = decl[2].split(':')[0];
    assert.equal(
      hPrefix,
      wPrefix,
      `第 ${index + 1} 个导航按钮的 h-7/w-7 前缀不一致（${decl[1]} vs ${decl[2]}）——` +
        `宽高须取同一断点，否则按钮在某区间是畸形尺寸。`,
    );
    assert.equal(
      hPrefix,
      layoutPrefix,
      `第 ${index + 1} 个导航按钮命中区降档前缀 \`${hPrefix}:\` 须与 Compact 断点 \`${layoutPrefix}:\` 同值——` +
        `否则抽屉在其自身区间内会失去触摸尺寸（docs/01 §1.6）。`,
    );
  }
  assert.equal(
    navHitDecls.length,
    2,
    `期望 ReadingPanel 恰有 2 个导航按钮受本项检查，实际命中 ${navHitDecls.length} 个——` +
      `新增导航按钮时须同步确认它是否也需要桌面命中区降档。`,
  );
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
  const COMPACT_SHELL_FILES = ['src/components/Layout.tsx', 'src/components/ReadingPanel.tsx'];
  const compactPrefixesOutsideShell = /\b(?:sm|md|lg):/;
  const sourceFiles: string[] = [];
  const walkSrc = (dir: string): void => {
    for (const entry of fs.readdirSync(path.resolve(dir), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walkSrc(child);
      else if (/\.tsx?$/.test(entry.name)) sourceFiles.push(child);
    }
  };
  walkSrc('src');
  assert.ok(sourceFiles.length > 0, 'src/ 下应扫到源码文件');

  const compactViolations: string[] = [];
  for (const rel of sourceFiles) {
    if (COMPACT_SHELL_FILES.includes(rel)) continue;
    read(rel)
      .split('\n')
      .forEach((line, index) => {
        const code = line.replace(/(^|[^:])\/\/.*$/, '$1');
        if (compactPrefixesOutsideShell.test(code)) {
          compactViolations.push(`${rel}:${index + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
  }
  assert.equal(
    compactViolations.length,
    0,
    `页面与通用业务组件不得使用 sm: / md: / lg: 建立 Compact 专属结构（docs/01 §1.6.1 第 3 条）：\n` +
      `${compactViolations.join('\n')}`,
  );
});

test('mobile reading panel identifies the current object and terminal cards retain status identity', () => {
  const readingPanel = read('src/components/ReadingPanel.tsx');
  const objectList = read('src/pages/ObjectList.tsx');

  assert.match(readingPanel, /ldvh-card-title w-full truncate text-center">{panelTitle}/);
  assert.match(objectList, /<ObjectIdentityActions[\s\S]{0,400}status=\{[^}]*presentedStatus[^}]*\}/);
  assert.doesNotMatch(objectList, /showStatusBadge/);
});

test('object list cards use the compact metadata shared by reading surfaces', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const priorityIcon = read('src/components/PriorityIcon.tsx');
  const statusBadge = read('src/components/StatusBadge.tsx');
  const identityActions = read('src/components/ObjectIdentityActions.tsx');
  const cardFrame = objectList.slice(
    objectList.indexOf('export function ObjectCardFrame'),
    objectList.indexOf('function hasSparkResolvedFact'),
  );

  assert.match(cardFrame, /ldvh-chip-sm/);
  assert.match(cardFrame, /const activityCount = Array\.isArray\(obj\.change_log\) \? obj\.change_log\.length : 0/);
  assert.match(cardFrame, /<History size=\{12\} aria-hidden="true" \/>[\s\S]{0,80}<span>\{activityCount\}<\/span>/);
  assert.match(cardFrame, /<ObjectIdentityActions[\s\S]{0,1200}compact/);
  assert.match(cardFrame, /items-center gap-1\.5[\s\S]{0,220}<ObjectTypeIcon type=\{obj\.type\} size=\{14\} className="shrink-0"/);
  assert.match(cardFrame, /ldvh-object-title-tray ldvh-object-title-tray-compact/);
  assert.match(cardFrame, /<h2 className="ldvh-card-title min-w-0 flex-1 whitespace-normal break-words">/);
  assert.match(
    read('src/components/FactAssociationRows.tsx'),
    /isDiscarded \? 'text-slate-400\/65 dark:text-slate-500\/60' : 'text-ldvh-text-secondary\/95 group-hover:text-ldvh-accent'/,
  );
  assert.match(cardFrame, /mt-1 flex min-w-0 items-center justify-end(?: pt-0\.5)? text-right opacity-70[\s\S]{0,80}<ObjectUpdatedMeta/);
  assert.match(objectList, /const \[objectSearch, setObjectSearch\] = useState\(''\)/);
  assert.match(objectList, /getLocalizedObjectTitle\(item, locale\)\.toLowerCase\(\)[\s\S]{0,280}objectId\.includes\(normalizedObjectSearch\)/);
  assert.match(objectList, /const \[isObjectSearchOpen, setIsObjectSearchOpen\] = useState\(false\)/);
  assert.match(objectList, /<SegmentedControl[\s\S]*objectList\.sortCreatedDesc/);
  assert.match(objectList, /renderObjectSearch\(\)[\s\S]*<SegmentedControl/);
  assert.match(objectList, /type="search"[\s\S]*objectList\.searchPlaceholder/);
  assert.match(objectList, /<div className="relative h-7 w-8 shrink-0">[\s\S]*<label className="absolute right-0 top-0 z-30 flex w-60/);
  assert.match(objectList, /onClick=\{\(\) => setIsObjectSearchOpen\(true\)\}[\s\S]{0,240}aria-expanded=\{false\}/);
  assert.match(priorityIcon, /font-medium/);
  assert.doesNotMatch(priorityIcon, /font-mono|font-sans/);
  assert.match(statusBadge, /font-medium/);
  assert.doesNotMatch(statusBadge, /font-mono|font-sans/);
  assert.match(objectList, /filteredItems\.map\(\(obj\) => renderObjectCard\(obj\)\)/);
  assert.match(identityActions, /compact\?: boolean/);
  assert.match(identityActions, /variant=\{compact \? 'compact' : undefined\}/);
});

test('object detail headers use compact metadata and title-scaled type icons', () => {  const objectDetail = read('src/pages/ObjectDetail.tsx');
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

  assert.match(identityRow, /<PriorityIcon[\s\S]*\{extraBadges\}[\s\S]*className="ml-auto shrink-0"[\s\S]*<ObjectIdentityActions/);
  assert.doesNotMatch(identityRow, /<ServesSgBadge/,
    'serves chip 不得回到详情头——2026-11-01 已撤除其 Web 呈现（`serves` 字段本身保留）');
  const identityActions = read('src/components/ObjectIdentityActions.tsx');
  assert.match(identityActions, /\{statusLeadingBadges\}[\s\S]{0,120}\{statusBadge \?\? \(status && \([\s\S]{0,320}\{actionBadges\}/);
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

test('prominent card title follows the documented 16px by 24px hierarchy', () => {
  const styles = read('src/index.css');
  assert.match(styles, /\.ldvh-card-title-prominent[\s\S]*text-base font-semibold leading-6/);
  assert.match(styles, /\.ldvh-inline-markdown\.ldvh-card-decision-body[\s\S]*text-xs leading-5/);
});

test('聚焦页对象标题必须落在标题带内：ldvh-card-title 与 title tray 成对', () => {
  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const cognitionCenter = strip(read('src/pages/CognitionCenter.tsx'));
  const titles = (cognitionCenter.match(/ldvh-card-title(?!-prominent)/g) ?? []).length;
  const trays = (cognitionCenter.match(/ldvh-object-title-tray-compact/g) ?? []).length;
  assert.equal(
    trays,
    titles,
    `CognitionCenter 内 ldvh-card-title（${titles} 处）与 ldvh-object-title-tray-compact` +
      `（${trays} 处）必须一一对应——对象标题缺少标题带时，该卡在整页里会显得与其它卡不一致。`,
  );
});

test('对象卡框单源：列表卡、近期动态行与 Spark 健康度行共用 ldvh-object-card-frame', () => {
  const styles = read('src/index.css');
  const objectList = read('src/pages/ObjectList.tsx');
  const cognitionCenter = read('src/pages/CognitionCenter.tsx');

  assert.match(
    styles,
    /\.ldvh-object-card-frame\s*\{[^}]*rounded-lg border border-ldvh-border/,
    '对象卡框须带边框与圆角（否则「有个外框」不成立）',
  );
  assert.match(styles, /\.ldvh-object-card-frame\s*\{[^}]*bg-ldvh-panel/, '对象卡框须有底色');

  assert.match(objectList, /className="ldvh-object-card-frame"/, '对象列表卡须用共享卡框类');
  const recentRow = cognitionCenter.slice(
    cognitionCenter.indexOf('function RecentActivityRow'),
    cognitionCenter.indexOf('function RecentActivityUsageBars'),
  );
  const sparkRow = cognitionCenter.slice(
    cognitionCenter.indexOf('function SparkHealthRow'),
    cognitionCenter.indexOf('function openOnKeyboard'),
  );
  assert.match(recentRow, /<li className="ldvh-object-card-frame">/, '近期动态行须用共享卡框类');
  assert.match(sparkRow, /<li className="ldvh-object-card-frame">/, 'Spark 健康度行须用共享卡框类');

  assert.match(recentRow, /ldvh-object-title-tray ldvh-object-title-tray-compact/);
  assert.match(sparkRow, /ldvh-object-title-tray ldvh-object-title-tray-compact/);

  assert.doesNotMatch(cognitionCenter, /divide-y divide-ldvh-border\/70"/, '有卡框后不得再用分隔线代替卡间距');
});

test('Spark 健康度池结构区块只保留上边框：下边框与首卡上边框叠成「框外的框」', () => {
  const cognitionCenter = read('src/pages/CognitionCenter.tsx');

  const poolBlock = cognitionCenter.slice(
    cognitionCenter.indexOf('{sparkHealth && sparkHealth.total > 0 && ('),
    cognitionCenter.indexOf('visibleSparkItems.map'),
  );
  assert.ok(poolBlock.length > 0, '须能定位到池结构比例条区块');

  assert.match(
    poolBlock,
    /className="border-t border-ldvh-border\/70 py-4"/,
    '池结构区块须保留上边框（与模块标题栏分节）',
  );
  assert.doesNotMatch(poolBlock, /border-y/, '池结构区块不得再带下边框（border-y）');
  assert.doesNotMatch(
    cognitionCenter,
    /border-y border-ldvh-border\/70/,
    '聚焦页不得再出现 border-y 的池结构区块',
  );
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

  assert.match(federation, /ldvh-section-grid/);
  assert.match(federationObjects, /ldvh-section-grid/);
  assert.doesNotMatch(federation, /sm:grid-cols|md:grid-cols|xl:grid-cols/);
  assert.doesNotMatch(federationObjects, /sm:grid-cols|md:grid-cols|xl:grid-cols/);

  assert.match(federation, /ldvh-body-muted\s+py-20\s+text-center/);
  assert.match(federationObjects, /ldvh-body-muted\s+py-20\s+text-center/);
  assert.match(federation, /ldvh-body-muted\s+flex\s+justify-center\s+py-20/);
  assert.match(federationObjects, /ldvh-body-muted\s+flex\s+justify-center\s+py-20/);
  assert.doesNotMatch(federation, /rounded-xl border border-ldvh-border bg-ldvh-panel p-8/);
  assert.doesNotMatch(federationObjects, /rounded-xl border border-ldvh-border bg-ldvh-panel p-8/);

  assert.match(federation, /ldvh-page-toolbar-action/);
  assert.match(federationObjects, /ldvh-page-toolbar-action/);
  assert.doesNotMatch(federation, /rounded-md border border-ldvh-border px-3 py-2 text-ldvh-text-secondary/);
  assert.doesNotMatch(federationObjects, /rounded-md border border-ldvh-border px-3 py-2 text-ldvh-text-secondary/);
});

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

function readToken(styles: string, name: string, dark: boolean): number[] {
  const scope = dark ? styles.slice(styles.indexOf(':root.dark')) : styles;
  const match = new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(scope);
  assert.ok(match, `index.css 必须定义令牌 --${name}${dark ? '（:root.dark）' : ''}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

test('阅读节点的正文取色达到 4.5:1 —— 两个主题都复算，不只断言写法', () => {
  const styles = read('src/index.css');

  const blend = (fg: number[], bg: number[], alpha: number) =>
    fg.map((channel, index) => channel * alpha + bg[index] * (1 - alpha));

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

test('阅读节点的 H3 标题须与正文可区分，且两个主题都达 4.5:1（Human 裁定 2026-09-22）', () => {
  const styles = read('src/index.css');

  const headingRule =
    /\.ldvh-research-node-content \.ldvh-inline-markdown :where\(h2, h3, h4, h5, h6\)\s*\{([^}]*)\}/;
  const rule = headingRule.exec(styles);
  assert.ok(rule, '阅读节点须有 H2–H6 标题的取色规则');

  const colorMatch = /color:\s*rgb\(var\(--(ldvh-text-[a-z]+)\)\)/.exec(rule![1]);
  assert.ok(colorMatch, `标题取色须用令牌（便于复算对比度），实际：${rule![1].trim().slice(0, 120)}`);

  const bodyRule =
    /\.ldvh-research-node-content \.ldvh-inline-markdown\s*\{\s*color:\s*rgb\(var\(--(ldvh-text-[a-z]+)\)\);/;
  const bodyToken = bodyRule.exec(styles);
  assert.ok(bodyToken, '阅读节点须有正文取色规则');

  assert.notEqual(
    colorMatch[1],
    bodyToken![1],
    `H3 标题取色不得与正文相同（二者同为 --${colorMatch[1]} 时读者看不出层级）`,
  );

  const blend = (fg: number[], bg: number[], alpha: number) =>
    fg.map((channel, index) => channel * alpha + bg[index] * (1 - alpha));
  for (const dark of [false, true]) {
    const shell = blend(readToken(styles, 'ldvh-bg', dark), readToken(styles, 'ldvh-panel', dark), 0.4);
    const ratio = contrastRatio(readToken(styles, colorMatch[1], dark), shell);
    const label = dark ? '暗色' : '浅色';
    assert.ok(
      ratio >= 4.5,
      `${label}阅读节点标题对比度 ${ratio.toFixed(2)}:1 低于正文 4.5:1 线（令牌 ${colorMatch[1]}）`,
    );
  }
});

test('阅读节点不设行宽上限 —— 撤销 40em 的反回退守卫', () => {
  const styles = read('src/index.css');

  assert.doesNotMatch(
    styles,
    /\.ldvh-research-node-content \.ldvh-inline-markdown :where\([^)]*\)\s*\{\s*max-width:\s*\d+(?:\.\d+)?em;/,
    '阅读节点不得对行文元素设行宽上限（Human 裁定 2026-09-22 已撤销 40em）',
  );

  assert.match(
    styles,
    /\.ldvh-research-node-content \.ldvh-inline-markdown \{\s*color: rgb\(var\(--ldvh-text-secondary\)\);/,
    '撤销行宽不应波及取色规则——正文取色须保持无 alpha',
  );

  assert.match(styles, /\.ldvh-inline-markdown :where\(table\)\s*\{\s*display: block;\s*max-width: 100%;\s*overflow-x: auto;/);
});

test('chip 不得与显式字体族同行出现：一律继承 :root 的无衬线栈', () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.resolve(dir), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(child));
      else if (/\.tsx?$/.test(entry.name)) out.push(child);
    }
    return out;
  };
  const stripComments = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, ' '));
  const violations: string[] = [];
  for (const rel of walk('src')) {
    stripComments(fs.readFileSync(path.resolve(rel), 'utf8')).split('\n').forEach((line, index) => {
      if (/ldvh-chip/.test(line) && /font-(sans|mono)\b/.test(line)) {
        violations.push(`${rel}:${index + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.equal(
    violations.length,
    0,
    `chip 类与显式字体族不得同行出现——该 chip 会脱离全局字体栈，与同行其它 chip 分岔：\n${violations.join('\n')}`,
  );
});
