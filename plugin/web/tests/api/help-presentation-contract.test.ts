import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

const SPEC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'specs',
);

function readSpec(fileName: string) {
  return fs.readFileSync(path.join(SPEC_ROOT, fileName), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function classNameValues(code: string): string[] {
  const values: string[] = [];
  for (const m of code.matchAll(/className="([^"]*)"/g)) values.push(m[1]);
  for (const m of code.matchAll(/className=\{`([^`]*)`\}/g)) {
    values.push(m[1].replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' '));
  }
  return values;
}

const help = read('src/pages/Help.tsx');
const helpCode = stripComments(help);
const sidebar = read('src/components/Sidebar.tsx');
const sidebarCode = stripComments(sidebar);
const semanticIcon = read('src/components/SemanticIcon.tsx');
const indexCss = read('src/index.css');
const designBaseline = read('docs/01-全局设计约束.md');

test('帮助页不得退回营销式英雄区：面板 + 语义排版类，不做渐变与装饰光晕', () => {
  assert.doesNotMatch(
    helpCode,
    /bg-gradient/,
    '帮助页不得使用渐变英雄区（docs/01 §1.8.1「不使用营销式大留白或英雄区」）',
  );
  assert.doesNotMatch(
    helpCode,
    /blur-(2xl|3xl)|scale-\d/,
    '帮助页不得使用装饰性光晕（07 §12 第 6 条：不为营造效果加入装饰）',
  );

  assert.match(help, /ldvh-page-frame/, '帮助页须走 ldvh-page-frame 页面框架');
  assert.match(help, /ldvh-page-topbar/, '帮助页须走 sticky tab 工具条');
  assert.match(help, /ldvh-section-grid/, '帮助页的卡片网格须走 ldvh-section-grid（容器宽度驱动列数）');
  assert.match(help, /ldvh-tab-list/, '帮助页的分区切换须走 ldvh-tab-list');
  assert.match(help, /ldvh-tab-button-active/, '帮助页的分区切换须区分选中态与闲置态');
});

test('帮助页不得使用视口断点类、任意字号与单侧粗边框', () => {
  assert.doesNotMatch(
    helpCode,
    /\b(sm|md|lg):/,
    '帮助页不得使用视口断点类（docs/01 §1.6.1 第 3 条：列数由容器宽度决定，不按断点改结构）',
  );
  assert.doesNotMatch(
    helpCode,
    /text-\[\d+px\]/,
    '帮助页不得使用任意字号（docs/01 §1.4：文本角色一律走语义排版类）',
  );
  assert.doesNotMatch(
    helpCode,
    /border-l-/,
    '帮助页不得使用单侧粗边框（docs/01 §1.10 色彩和状态第 7 条：两族之外一律四边同宽）',
  );
});

test('对象类型图标与导航入口图标必须走集中映射', () => {
  assert.match(semanticIcon, /export const NAV_ICONS/, 'SemanticIcon 须导出导航入口图标映射 NAV_ICONS');
  for (const icon of ['LayoutDashboard', 'FolderTree', 'GitPullRequestArrow', 'MapPinned', 'Activity']) {
    assert.doesNotMatch(
      sidebarCode,
      new RegExp(`\\b${icon}\\b`),
      `Sidebar 不得直接引用 ${icon}，须经 NAV_ICONS 集中映射（09 §8）`,
    );
  }
  assert.match(sidebar, /NAV_ICONS\./, 'Sidebar 须经 NAV_ICONS 取导航入口图标');

  assert.match(help, /ObjectTypeIcon/, '帮助页须经 ObjectTypeIcon 取对象类型图标');
  for (const icon of [
    'Shovel',
    'Sparkles',
    'FileSignature',
    'Lightbulb',
    'Snail',
    'Ruler',
    'NotebookPen',
    'Milestone',
    'Target',
  ]) {
    assert.doesNotMatch(
      helpCode,
      new RegExp(`\\b${icon}\\b`),
      `帮助页不得内联对象类型图标 ${icon}，须经 ObjectTypeIcon 集中映射（09 §8）`,
    );
  }

  assert.match(semanticIcon, /export const SYSTEM_ICONS/, 'SemanticIcon 须导出业务系统图标映射 SYSTEM_ICONS');
  for (const icon of ['Waypoints', 'Sprout', 'Cog', 'Telescope', 'Combine', 'Library', 'Receipt']) {
    assert.doesNotMatch(
      helpCode,
      new RegExp(`\\b${icon}\\b`),
      `帮助页不得内联业务系统图标 ${icon}，须经 SYSTEM_ICONS 集中映射（09 §8）`,
    );
  }
  assert.match(help, /SYSTEM_ICONS\[/, '帮助页须经 SYSTEM_ICONS 取业务系统图标');

  const systemIconsBlock = semanticIcon.slice(
    semanticIcon.indexOf('export const SYSTEM_ICONS'),
    semanticIcon.indexOf('type SemanticIconProps'),
  );
  const registeredIcons = [...systemIconsBlock.matchAll(/^\s{2}(\w+):\s*\w+,/gm)].map((m) => m[1]);
  const systemMapBlock = help.slice(help.indexOf('const SYSTEM_MAP'), help.indexOf('const TRUST_LAYERS'));
  const usedIcons = [...systemMapBlock.matchAll(/icon: '(\w+)'/g)].map((m) => m[1]);

  assert.ok(usedIcons.length > 0, '须能从帮助页读出用到的业务系统图标键');
  const unregistered = usedIcons.filter((key) => !registeredIcons.includes(key));
  assert.deepEqual(
    unregistered,
    [],
    `SYSTEM_ICONS 未登记以下业务系统图标：${JSON.stringify(unregistered)}——图标取不到时页面静默塌成空白，不报错`,
  );
});

test('帮助页的对象地图必须覆盖活跃事实对象类型全集', () => {
  const facts = read('api/services/facts.ts');
  const registryBlock = facts.slice(facts.indexOf('export const ACTIVE_OBJECT_TYPES'), facts.indexOf('export type ObjectType'));
  const expectedTypes = [...new Set(
    [...registryBlock.matchAll(/'(\w+)'/g)].map((m) => m[1]),
  )].sort();
  assert.ok(expectedTypes.length > 0, '须能从 facts.ts 读出活跃事实对象类型全集');

  const mapBlock = help.slice(help.indexOf('const OBJECT_MAP'), help.indexOf('const GATES'));
  const mapTypes = [...mapBlock.matchAll(/type: '(\w+)'/g)].map((m) => m[1]).sort();

  assert.deepEqual(
    mapTypes,
    expectedTypes,
    '帮助页对象地图的类型集合必须等于活跃事实对象类型全集——' +
      '少一类等于有一个事实对象没被解释，多一类等于在讲不存在的东西',
  );

  assert.ok(expectedTypes.includes('subgoal'), 'subgoal 仍须在活跃事实对象类型全集里');
  assert.ok(mapTypes.includes('subgoal'), '子目标仍须在帮助页对象地图上');
  assert.doesNotMatch(sidebar, /to: '\/objects\/subgoal'/, '侧栏仍不设子目标入口');
});

test('帮助页的中英文案必须一一对应，且旧流程词条不得复活', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  const zhKeys = Object.keys(UI_LOCALES.zh).filter((key) => key.startsWith('help.'));
  const enKeys = Object.keys(UI_LOCALES.en).filter((key) => key.startsWith('help.'));

  assert.ok(zhKeys.length > 0, '须存在帮助页词条');
  assert.deepEqual(
    [...zhKeys].sort(),
    [...enKeys].sort(),
    '帮助页中英词条必须一一对应——漏一个英译会在英文态直接露出 key',
  );

  assert.doesNotMatch(
    zhKeys.join('\n'),
    /help\.vibeSteps|^help\.step\./m,
    '旧流程词条（help.vibeSteps / help.step.*）已撤除，不得复活',
  );
  assert.doesNotMatch(helpCode, /help\.(vibeSteps|step\.)/, '帮助页不得引用旧流程词条');

  for (const key of [
    'help.tab.start',
    'help.tab.overview',
    'help.tab.objects',
    'help.tab.systems',
    'help.tab.gates',
    'help.tab.entries',
    'help.tab.trust',
    'help.panel.start.title',
    'help.panel.overview.title',
    'help.panel.objects.title',
    'help.panel.systems.title',
    'help.panel.gates.title',
    'help.panel.entries.title',
    'help.panel.trust.title',
  ]) {
    assert.ok(zhKeys.includes(key), `帮助页须有词条 ${key}`);
    assert.ok(enKeys.includes(key), `帮助页须有词条 ${key}（英文侧）`);
  }
});

test('帮助页的英文文案不得使用直双引号', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  for (const [key, value] of Object.entries(UI_LOCALES.en)) {
    if (!key.startsWith('help.')) continue;
    assert.doesNotMatch(
      value,
      /"/,
      `英文 help 词条 ${key} 不得用直双引号，须用弯引号“ ”（与中文侧「 」对位）`,
    );
  }
});

test('帮助页讲的七大业务系统必须与 specs/03 §9 一一对应', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');

  const spec = readSpec('03-业务系统基础规范.md');
  const specSystems = [...spec.matchAll(/^###\s+9\.(\d+)\s+(.+?)\s*$/gm)].map((m) => m[2]);
  assert.equal(
    specSystems.length,
    7,
    'specs/03 §9 应当是七节（七大业务系统）——若规范改动此处，页面与本守卫须同步',
  );

  const pageSystems = Object.entries(UI_LOCALES.zh)
    .filter(([key]) => /^help\.systems\.[^.]+\.title$/.test(key))
    .map(([, value]) => value);

  assert.deepEqual(
    [...pageSystems].sort(),
    [...specSystems].sort(),
    '帮助页的系统清单必须与 specs/03 §9 的七大业务系统一一对应——多一个是在讲不存在的系统，少一个是有一个系统没被解释',
  );
});

test('帮助页不得硬编码中文文案，且不发起任何数据请求', () => {
  const literalTexts = [...help.matchAll(/>\s*([^<>{}\n][^<>{}]*)\s*</g)].map((m) => m[1]);
  for (const text of literalTexts) {
    assert.doesNotMatch(
      text,
      /[\u4e00-\u9fff]/,
      `帮助页不得硬编码中文文案（docs/01 §1.3）：发现「${text.trim().slice(0, 40)}」`,
    );
  }

  assert.doesNotMatch(
    helpCode,
    /fetch\(|axios|useQuery|XMLHttpRequest/,
    '帮助页是静态引导页，不读事实源、不发任何请求',
  );
});

test('帮助页必须是单一 tab 容器：概览不得常显，切换区之前无内容块', () => {
  const stickyCount = [...helpCode.matchAll(/ldvh-page-topbar/g)].length;
  assert.equal(stickyCount, 1, `帮助页只允许一处 sticky 切换区，发现 ${stickyCount} 处`);

  const tabMapCount = [...helpCode.matchAll(/TABS\.map\(/g)].length;
  assert.equal(tabMapCount, 1, `帮助页只允许一处分区切换区渲染点，发现 ${tabMapCount} 处`);

  const branchCount = [...helpCode.matchAll(/tab === '/g)].length;
  assert.equal(branchCount, 7, `帮助页须有七个分区条件渲染分支，发现 ${branchCount} 个`);

  const barIndex = helpCode.indexOf('ldvh-page-topbar');
  assert.ok(barIndex >= 0, '帮助页须有 sticky 切换区');
  const beforeBar = helpCode.slice(0, barIndex);
  assert.doesNotMatch(
    beforeBar,
    /<article\b|ldvh-section-grid|overflow-hidden rounded-xl/,
    '切换区之前不得有常显内容区块——概览必须收进分区之内，否则两套组织范式挤在同一页',
  );
});

test('帮助页的呈现件必须按类型登记，每类只有一种壳', () => {
  const PRESENTATION_REGISTRY: Record<string, string> = {
    compare: 'div',
    stage: 'article',
    'entry-card': 'article',
    rows: 'ul',
    chips: 'ul',
    ladder: 'div',
    hint: 'div',
    steps: 'ol',
  };

  const occurrences = [...helpCode.matchAll(/<\s*(\w+)[^>]*?data-presentation="([^"]+)"/g)];
  assert.ok(occurrences.length > 0, '须能从帮助页读出呈现件标记');

  const byType = new Map<string, { count: number; tags: Set<string> }>();
  for (const [, tag, type] of occurrences) {
    const entry = byType.get(type) ?? { count: 0, tags: new Set<string>() };
    entry.count += 1;
    entry.tags.add(tag);
    byType.set(type, entry);
  }

  assert.deepEqual(
    [...byType.keys()].sort(),
    Object.keys(PRESENTATION_REGISTRY).sort(),
    '帮助页的呈现件集合必须与登记清单一致——多一个是未经登记的呈现件，少一个是登记了却没用上',
  );

  for (const [type, entry] of byType) {
    assert.equal(
      entry.count,
      1,
      `呈现件 ${type} 只允许一处定义点（由一个组件产出），发现 ${entry.count} 处——同一类出现两套写法，读起来像几套页面拼在一起`,
    );
    assert.deepEqual(
      [...entry.tags],
      [PRESENTATION_REGISTRY[type]],
      `呈现件 ${type} 的根元素必须是 <${PRESENTATION_REGISTRY[type]}>`,
    );
  }

  assert.doesNotMatch(
    helpCode,
    /minmax\(/,
    '帮助页不得在页面内自定义网格列宽基准——列宽基准由 index.css 的语义 token 给，页面只引用',
  );
  assert.doesNotMatch(
    helpCode,
    /ldvh-panel-grid|ldvh-subgrid|ldvh-compact-grid|ldvh-mini-grid|ldvh-metric-grid/,
    '帮助页只允许一个网格基准（ldvh-section-grid）——多种列宽基准使同一页读起来没有统一的分栏',
  );
  assert.match(helpCode, /ldvh-section-grid/, '帮助页的卡片网格须走 ldvh-section-grid');
});

test('帮助页的标题层级必须是 h1 → h2 → h3，不得跳级或加深', () => {
  const h2Count = [...helpCode.matchAll(/<h2\b/g)].length;
  assert.equal(h2Count, 1, `帮助页只允许一个 h2（当前分区的标题），发现 ${h2Count} 个`);

  const h3Count = [...helpCode.matchAll(/<h3\b/g)].length;
  assert.ok(h3Count > 0, '帮助页的条目标题须用 h3');

  for (const tag of ['h4', 'h5', 'h6']) {
    assert.doesNotMatch(
      helpCode,
      new RegExp(`<${tag}\\b`),
      `帮助页不得出现 <${tag}>——标题层级固定为 h1（页头）→ h2（分区）→ h3（条目），分组标签是普通文本行不占层级`,
    );
  }
});

test('帮助页的可读性基线：分区标题用分区令牌、正文走主色、行长不超过 40rem', () => {

  const h2Tags = [...helpCode.matchAll(/<h2\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(h2Tags.length, 1, `帮助页只允许一个 h2，发现 ${h2Tags.length} 个`);
  assert.match(
    h2Tags[0],
    /ldvh-region-title/,
    '分区标题必须走 ldvh-region-title（20px/600）——它与页面标题 18px、条目标题 16px 构成三档，扫页才分得出「我在哪个分区」',
  );
  assert.doesNotMatch(
    h2Tags[0],
    /ldvh-card-title-prominent/,
    '分区标题不得借用 ldvh-card-title-prominent（docs/01 §1.5 第 3 条：那一档只用于「同一卡片承载多个 Human 判断区」的对象主标题）',
  );

  const h3Tags = [...helpCode.matchAll(/<h3\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(h3Tags.length > 0, '帮助页的条目标题须用 h3');
  for (const tag of h3Tags) {
    assert.doesNotMatch(
      tag,
      /ldvh-region-title|ldvh-page-title/,
      'h3 不得占用分区标题或页面标题的排版档——三级标题各自一档',
    );
  }

  assert.match(
    indexCss,
    /\.ldvh-region-title\s*\{[^}]*@apply[^}]*text-xl[^}]*font-semibold[^}]*\}/s,
    'index.css 须定义 .ldvh-region-title 为 20px（text-xl）/ 600（font-semibold）——分区标题的档位由令牌说了算，不在页面里临时写',
  );
  const typographySection = designBaseline.slice(
    designBaseline.indexOf('### 1.4 排版系统'),
    designBaseline.indexOf('### 1.5'),
  );
  assert.ok(typographySection.length > 0, '须能从 docs/01 定位到 §1.4 排版系统一节');
  assert.match(
    typographySection,
    /ldvh-region-title/,
    'docs/01 §1.4 排版系统表须登记 ldvh-region-title——新增排版档必须进登记表，否则下一个人不知道它存在',
  );

  const secondaryBlocks = [...helpCode.matchAll(/data-voice="secondary"[\s\S]*?<\/dl>/g)].map((m) => m[0]);
  assert.equal(
    secondaryBlocks.length,
    1,
    `本页只允许一处登记过的次级正文块（系统卡边界块），发现 ${secondaryBlocks.length} 处——新增次级正文须显式登记，不得悄悄开口子`,
  );
  assert.match(
    secondaryBlocks[0],
    /ldvh-body-muted/,
    '登记的次级正文块必须确实使用次级样式——登记锚点不得空转',
  );

  const outsideSecondary = helpCode.replace(/data-voice="secondary"[\s\S]*?<\/dl>/g, '');
  assert.doesNotMatch(
    outsideSecondary,
    /ldvh-body-muted/,
    '登记块之外的正文必须走主色 ldvh-body——此前整页正文几乎全是次级灰，长文读起来发飘',
  );

  assert.doesNotMatch(
    helpCode,
    /(?<![\w-])ldvh-caption(?![\w-])/,
    '帮助页不得用 12px 的 ldvh-caption 承载内容（docs/01 §1.5 第 5 条）——页面级实质限定此前用 caption 承载，是本页最重的一处可读性欠账',
  );

  const measures = [...helpCode.matchAll(/max-w-\[(\d+)rem\]/g)].map((m) => Number(m[1]));
  assert.ok(measures.length > 0, '须能从帮助页读出正文行长约束');
  for (const measure of measures) {
    assert.ok(
      measure <= 40,
      `正文行长 ${measure}rem 超出 40rem 上限——14px 中文每行超过 45 字后读起来串行（此前 46rem 约 52 字/行）`,
    );
  }
});

test('帮助页的图标与文字必须落在同一条基线上：容器等高、内部居中、不做微调', () => {
  const bodyLeading = /^\s*\.ldvh-body\s*\{[^}]*?leading-(\d+)/m.exec(indexCss);
  assert.ok(bodyLeading, '须能从 index.css 读出 .ldvh-body 的 leading——图标容器高度要以它为准');
  const bodyLineBoxPx = (Number(bodyLeading[1]) / 4) * 16;
  const expectedHeightClass = `h-${bodyLineBoxPx / 4}`;

  const containers = classNameValues(helpCode)
    .filter((c) => /\bh-(?:\d|\[)/.test(c) && /\bw-(?:\d|\[)/.test(c) && /\bshrink-0\b/.test(c));

  assert.ok(
    containers.length >= 6,
    `须能从帮助页读出图标/标记容器（当前 ${containers.length} 处）——规则不得空转`,
  );

  for (const container of containers) {
    const height = /\bh-(\d+)\b/.exec(container);
    assert.ok(
      height,
      `图标容器的高度必须写成 ${expectedHeightClass}（与行盒等高的约定写法），发现：${container}`,
    );
    assert.equal(
      height[1],
      expectedHeightClass.slice(2),
      `图标容器高度 ${height[1]}（${container}）必须等于相邻正文的行盒高度 ${bodyLineBoxPx}px（${expectedHeightClass}）——容器不等高，图标与文字就不在同一条基线上`,
    );
    assert.match(
      container,
      /\bitems-center\b/,
      `图标容器须内部居中：${container}`,
    );
    assert.doesNotMatch(
      container,
      /\bmt-[\d.]+/,
      `图标容器不得用 mt-N 微调对齐：${container}——微调是为某个字号试出来的，文字一改字号图标就歪；改为容器等高 + 内部居中`,
    );
  }

  const nudgedBoxes = classNameValues(helpCode)
    .filter((c) => /\bmt-[\d.]+/.test(c) && /\bh-(?:\d|\[)/.test(c));
  assert.deepEqual(
    nudgedBoxes,
    [],
    `帮助页不得用「mt-N + 固定尺寸盒」微调图标/标记对齐：${JSON.stringify(nudgedBoxes)}——微调是为某个字号试出来的，文字一改字号图标就歪；改为容器与行盒等高 + 内部居中`,
  );
});

test('帮助页的分组手段只有「纸」与「行」：不回退卡片地毯，标签栏固定成一条竖线', () => {
  // 2026-11-19 版式重构的核心：分组不再靠一张张等重的卡片（十四张卡同屏，
  // 眼睛分不出谁和谁一组），改为「一章一两张纸 + 纸上用发丝线分行」。这条
  // 守卫钉住两件事：页面里不得再出现卡片壳；纸与标签栏只在 index.css 定义。
  assert.doesNotMatch(
    helpCode,
    /rounded-(?:xl|lg)\b/,
    '帮助页不得再出现卡片壳（rounded-xl / rounded-lg）——白纸只由 .ldvh-help-sheet 给，' +
      '页面另写一套圆角边框就会退回「卡片地毯」：十几个等重盒子同屏，分组关系反而读不出来',
  );

  const sheetBlock = /\.ldvh-help-sheet\s*\{([^}]*)\}/.exec(indexCss);
  assert.ok(sheetBlock, 'index.css 须定义 .ldvh-help-sheet（一章里承载同类东西的那张纸）');
  for (const decl of ['border:', 'border-radius:', 'background:', 'overflow: hidden']) {
    assert.match(
      sheetBlock[1],
      new RegExp(decl),
      `.ldvh-help-sheet 须写出 ${decl.trim()}——纸是「一块有边的白面」，缺一条就读不成纸`,
    );
  }

  const columnBlock = /\.ldvh-help-column\s*\{([^}]*)\}/.exec(indexCss);
  assert.ok(columnBlock, 'index.css 须定义 .ldvh-help-column（一条文档列）');
  assert.match(
    columnBlock[1],
    /max-width:/,
    '文档列须有 max-width——整页铺满 1210px 时每行五十余汉字，眼睛要来回扫；' +
      '收在一列里，行宽才落在 40 字上下（与页面内 max-w-[40rem] 同一口径）',
  );

  const fieldsBlock = /\.ldvh-help-fields\s*\{([^}]*)\}/.exec(indexCss);
  assert.ok(fieldsBlock, 'index.css 须定义 .ldvh-help-fields（行内的标签栏 + 值两列）');
  assert.match(
    fieldsBlock[1],
    /grid-template-columns:\s*6\.5rem/,
    '标签栏宽度必须固定（6.5rem）——卡片网格里每条账各写一遍「它是什么」，标签对不齐；' +
      '固定成一列，七条账的标签才竖成一条竖线，能跨条目往下扫',
  );

  // 容器查询的「容器」必须是祖先：把 inline-size 挂在字段区自己身上，
  // 它查到的是自己的祖先，窄容器下永远不折（第一版就是这么错的）。
  const entryBlock = /\.ldvh-help-entry\s*\{([^}]*)\}/.exec(indexCss);
  assert.ok(entryBlock, 'index.css 须定义 .ldvh-help-entry（纸上的一行账）');
  assert.match(
    entryBlock[1],
    /container-type:\s*inline-size/,
    '行须是容器查询的容器（container-type: inline-size 挂在行上）——' +
      '行内的标签栏才能按这一行的宽度决定折不折',
  );
  assert.doesNotMatch(
    fieldsBlock[1],
    /container-type/,
    '标签栏自己不得做容器——它查的是祖先宽度，挂在自身上时窄容器下永远不会折',
  );
  assert.match(
    indexCss,
    /@container \(max-width: 27rem\)/,
    '窄容器的降级须走容器查询而不是视口断点（docs/01 §1.6.1 第 3 条）',
  );
});
