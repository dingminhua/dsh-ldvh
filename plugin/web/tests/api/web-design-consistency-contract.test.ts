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
  const objectList = read('src/pages/ObjectList.tsx');

  // Compact 断点：**复算**两处是否同值，而不是钉死字面数字（Human 2026-10-16：640 → 1024）。
  //
  // 为什么复算：本仓的缺陷形态正是「同一个断点被写成两处，改一处漏一处」。此前
  // ReadingPanel 用 `MOBILE_BREAKPOINT = 640`、Layout 用 Tailwind `sm:`（=640），
  // 二者靠一句注释维持一致；改值时若只改一边，就会拼出「展开侧栏 + 底部抽屉」或
  // 「图标栏 + 右侧面板」的错配组合——而断言 `= 640` 这种写法既拦不住错配，又会
  // 在每次调值时强制改测试（把「测试跟着实现走」变成惯例）。
  // 现改为：从两侧各自读出**当前取值**再比对，改值只需两处同步改，测试自动跟随。
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

  // 抽屉的触摸命中区必须**只在高断点以上**才收窄：导航按钮从 h-11/w-11（44px，抽屉内
  // 触摸尺寸）降为 h-7/w-7（28px，桌面尺寸）。若该降档发生在 Compact 断点**之下**，
  // 抽屉在平板宽度上就会用 28px 按钮——而 docs/01 §1.6 明确把抽屉命中区列为
  // 「唯一允许的控件尺寸例外」。故此处要求两侧取**同一个前缀**。
  //
  // 覆盖口径（独立复核 2026-10-16 指出的两处漏洞，均已修）：
  // ① `h-7` 与 `w-7` 的**两个**前缀都要取出来比——只比 h-7 时，
  //    `lg:h-7 sm:w-7` 这类不对称写法会漏检（宽高取不同断点，视觉上是畸形按钮）；
  // ② 用 `matchAll` 遍历**全部**导航按钮——原实现 `.exec` 只命中第一个（goBack），
  //    goForward 漏检。两处按钮当前写法相同，但「相同」应由断言保证而非靠人工同步。
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
  // 期望值来源：ReadingPanel 的导航按钮恰好两个（上一个 / 下一个）。
  // 断言条数写死在此，避免「新增第三个按钮但忘了让它受检」时静默通过。
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
  // 业务组件不得在 Compact 断点上分岔（docs/01 §1.6.1 第 3 条）。
  //
  // 前缀集合随 Compact 断点走：Compact = 1024（`lg:`）之后，落在该边界上的前缀是
  // `lg:`，而 `sm:`（640）/ `md:`（768）反而成了**边界内部**的次级分支——两者都属
  // 「页面与通用业务组件建 Compact 专属结构」。`xl:` 不在此列：docs/01 §1.6 末段允许
  // `xl` 等宽屏工作台增强，它不反向引入 Compact 专属呈现。
  //
  // **扫描口径：全仓 `src/`，不是抽样**（独立复核 2026-10-16 指出：原实现只采样
  // copyButton/objectDetail/cognitionCenter/objectList 四个文件，却宣称「全仓业务组件
  // 对 lg: 使用为零」——宣称超出断言覆盖，属 00 §5.6 意义上的超范围声明）。现改为
  // 遍历 `src/**/*.{ts,tsx}`，并按「壳层文件」排除**仅有的两处**合法使用点：
  // `Layout.tsx`（图标栏切换）与 `ReadingPanel.tsx`（抽屉切换 + 命中区降档），
  // 即 docs/01 §1.6.1 第 1 条唯一许可的两个位置。排除面写死在下方数组里，
  // 新增豁免须同时改本数组——不设通配式豁免。
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
        // 剥离行注释后再判：注释里的 `sm:` / `md:` / `lg:` 是**沿革记载与说明文字**
        // （本仓惯例要求如实保留改动的来龙去脉），不是渲染。不剥离会拒掉诚实记录。
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
  // 2026-09-30 修订：改用「status 的取值来自 presentedStatus」——见同批 nonactive 契约
  // 的同款修订（WorkCase 已关闭卡的 status 现为三元表达式）。
  assert.match(objectList, /<ObjectIdentityActions[\s\S]{0,400}status=\{[^}]*presentedStatus[^}]*\}/);
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
  // 2026-09-30 修订：窗口由 460 放宽到 1200——卡框新增了 `statusBadge`（WorkCase 已关闭卡
  // 的合并徽标）一段，原窗口量不到 `compact`。意图不变：**列表卡须用 compact 变体**。
  assert.match(cardFrame, /<ObjectIdentityActions[\s\S]{0,1200}compact/);
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
  // 短标识 chip（优先级、状态）不得显式设**任何**字体族：全站 chip 一律继承 `:root`
  // 的无衬线栈。原断言写 `font-sans font-medium`——意图是「不许用等宽」，但把 Tailwind
  // 的 `font-sans`（`ui-sans-serif`）一并钉进了期望值，于是这些 chip 与其余 chip 继承的
  // `:root`（`-apple-system`）分岔，同一行出现两种字体族（2026-10-05 在插件页面实测：
  // 「工单 / SG-3 / 1」为 -apple-system，「待批准执行」为 ui-sans-serif）。
  // 这与 `structure-single-source-contract` 里「把 border-l-2 写进期望值即单方面判定争议」
  // 是同一类错误：断言把**实现细节**当成了**契约**。现只锁意图。
  assert.match(priorityIcon, /font-medium/);
  assert.doesNotMatch(priorityIcon, /font-mono|font-sans/);
  assert.match(statusBadge, /font-medium/);
  assert.doesNotMatch(statusBadge, /font-mono|font-sans/);
  assert.match(capabilityBadge, /ldvh-chip-sm/);
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
  // 2026-09-30 修订：新增「只替换、不叠加」的 `statusBadge` 口后，状态徽标的分支变为
  // `{statusBadge ?? (status && (…))}`；断言随之更新，仍钉住**块序**：前导徽标 → 状态 → actionBadges。
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

/**
 * 对象标题必须落在标题带（`ldvh-object-title-tray`）内——`docs/01` §1.10「统一要求」
 * 第 4 条与 §1.8.1 的组件契约：卡片标题带使用弱背景、内圈边框与完整标题。
 *
 * 为什么设这条守卫：标题带**不是由标题类自带的**，而是调用方在外层容器上另加的一个类。
 * 于是「同一个 `ldvh-card-title`，A 处包了带、B 处漏了」在源码与类型上都合法，只能靠
 * 逐处人工比对发现——2026-10-05 实测聚焦页两处（近期动态行、Spark 健康度行）即漏。
 * 漏掉的那两行在整页里表现为「只有这两张卡的标题没有背景框」。
 *
 * **保证边界（如实登记，实测修正）**：
 * - 本守卫只覆盖 `CognitionCenter`（该文件内标题与标题带应一一对应）。跨文件的
 *   「哪些 `ldvh-card-title` 属于对象卡片」无法从字形判定（同一个类也用于导航项、
 *   下拉选择项、按钮、错误提示与工具页文件名），故不设全域断言——不设能力以外的保证。
 * - 形态级：只识别类名，**不判定「这处标题是否真的视觉成带」**。两种偏差各有表现：
 *   · 改以 inline style 表达标题带 → 该类名计数减少 → **被判为「缺失」并报红**
 *     （2026-10-05 变异 3 实测）。注意这是**假阳性式的拦截**：拦住的理由是「类名
 *     不见了」，不是「带没画出来」，故不得据此宣称语义级防护；
 *   · 反之，同一文件内把标题与标题带**同时**换名（比例仍 1:1）→ **逃逸**。
 *   故本守卫给的是「同类标题漏配」的回归网，不是标题带存在性的语义证明。
 * - 计数前剥离注释，使沿革记载不触发误报（变异 2 实测）。
 */
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
 * ② 行宽：原对行文元素取 40em，**已由 Human 裁定 2026-09-22 撤销**（选择器挂在六类
 *    阅读面共用的壳上、且对短字段只产生留白）。现行纪律是「不设行宽上限」，并留有
 *    反回退守卫；表格与代码块始终是滚动容器，不涉本项。
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

test('阅读节点的 H3 标题须与正文可区分，且两个主题都达 4.5:1（Human 裁定 2026-09-22）', () => {
  const styles = read('src/index.css');

  // 21 §8 的 H3 骨架（bf9b37b）让摘要**结构上**分节；若标题与正文同色，则
  // **视觉上**仍未分层——读者看到的是一行行同色文字，分节收益被抵消。本用例守住
  // 「已登记的结构在呈现层真的可见」这一环。
  //
  // 与正文取色那条同款：**复算对比度**而非只断言 CSS 字符串——断言字符串发现不了
  // 「换一个同样够淡的颜色」。
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

  // ① 可区分：标题令牌不得与正文相同（同色即「视觉上没分层」）。
  assert.notEqual(
    colorMatch[1],
    bodyToken![1],
    `H3 标题取色不得与正文相同（二者同为 --${colorMatch[1]} 时读者看不出层级）`,
  );

  // ② 达线：两个主题下标题对壳底的对比度都须 ≥ 4.5:1。
  //    这条守的是「不许为了好看而牺牲可读性」——accent 在浅色下仅 3.58:1，会被本项拒绝。
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

  // Human 裁定 2026-09-22 撤销原 40em 行宽规则。撤销理由（实测）：
  //   ① 选择器挂在六类阅读面**共用**的壳上（ADR/Pitfall/Spark/Research/Friction/Norm
  //      与 WorkCase 全部走它），而动机只是 WorkCase 的长摘要——等于给所有类型一并收窄；
  //   ② 壳内文本列约 792px，40em ≈ 560px，右侧留出约 29% 空白；阅读节点里大多是
  //      短字段，收窄不产生可读性收益，留白本身反成视觉缺陷。
  // 「舒适行宽」是连续长文的经验值，不能不加区分地施加到任意字段上。
  assert.doesNotMatch(
    styles,
    /\.ldvh-research-node-content \.ldvh-inline-markdown :where\([^)]*\)\s*\{\s*max-width:\s*\d+(?:\.\d+)?em;/,
    '阅读节点不得对行文元素设行宽上限（Human 裁定 2026-09-22 已撤销 40em）',
  );

  // 紧随其后的**取色**规则不受本次撤销影响：正文仍须达 4.5:1（见下方对比度用例）。
  assert.match(
    styles,
    /\.ldvh-research-node-content \.ldvh-inline-markdown \{\s*color: rgb\(var\(--ldvh-text-secondary\)\);/,
    '撤销行宽不应波及取色规则——正文取色须保持无 alpha',
  );

  // 表格与代码块仍是滚动容器（与本项无关的既有形态，保留断言防被顺手改动）。
  assert.match(styles, /\.ldvh-inline-markdown :where\(table\)\s*\{\s*display: block;\s*max-width: 100%;\s*overflow-x: auto;/);
});

/**
 * chip 不得与显式字体族同行出现——全站 chip 一律继承 `:root` 的无衬线栈。
 *
 * 为什么设这条守卫：字体族的**显式覆盖**会把一处 chip 从全局栈里摘出去。实测
 * （2026-10-05，插件页面）：`StatusBadge` 与 `PriorityIcon` 带着 `font-sans`
 * （Tailwind 默认 `ui-sans-serif`），而其余 chip 继承 `:root` 的 `-apple-system`——
 * 同一张卡头里「工单 / SG-3 / 1」与「待批准执行」是两种字体，字号与盒高却完全一致，
 * 因此肉眼只能看出「说不出的不一样」。这类分歧在**度量上不可见**（fontSize / height /
 * padding / radius 全同），只能靠查 `font-family` 发现。
 *
 * **保证边界（如实登记，含变异实测）**：
 * - 只查「同一行内同时出现 chip 类与字体族类」这一**形态**，不做 CSS 层叠推算——
 *   经由父容器或样式表间接覆盖字体族的情形不在覆盖内；
 * - **换表达手段会逃逸**：改用 inline style（`style={{ fontFamily }}`）时本守卫全绿
 *   （变异 3 实测）——本守卫只具备**形态级**保证，不是「chip 字体必统一」的语义证明；
 * - 计数前剥离注释：注释里的类名是沿革记载而非渲染，不剥离会把「此处曾写 …」一句
 *   判为违规（变异 2 实测，属拒掉诚实输入的反向激励）；
 * - `.tsx`/`.ts` 源码级，不覆盖第三方组件内部的字体设置。
 */
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
  // 剥离注释后再判：注释里的类名是**沿革记载**（本仓惯例要求如实保留改动的来龙去脉），
  // 不是渲染。变异 2 实测：不剥离时一句「此处曾写 ldvh-chip-sm 搭配 font-sans」即被误判——
  // 拒掉诚实记录属反向激励（docs/12 §2 第 2 项）。
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
