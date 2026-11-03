/**
 * 帮助页（`/help`）呈现契约守卫。
 *
 * **这页是什么**：给 Human 的一份使用引导（LDVH 怎么运作、每个入口看什么、AI 何时
 * 停下来找你）。它不是事实页面，因此不消费任何事实源，也没有任何写入口。
 *
 * **守卫守的是什么**（都是「改一次就会悄悄漂掉、且没有第二处能发现」的性质）：
 * 1. **不得退回营销式英雄区**：原实现是「渐变 hero + 装饰光晕」，与全站「面板 + 边框 +
 *    语义排版类」的语言不合（`docs/01` §1.8.1「不使用营销式大留白或英雄区」、
 *    §1.10「密度和响应式」第 1 条）。
 * 2. **旧流程不得复活**：原「Vibe 开发步骤 7 步」里引用了**已删除的讨论业务系统**
 *    （Human 2026-10 决定把「把 Human 意图收敛为方案」归主控本职），续着写就是
 *    拿一个不存在的系统教人做事。词条一并撤除，防止复活。
 * 3. **中英词条必须一一对应**：帮助页是全站文案量最大的静态页，漏一个英译在英文态
 *    直接露出 key。
 * 4. **对象地图必须与左侧导航的对象族一一对应**：少一类＝有一个入口没被解释；多一类
 *    ＝在讲不存在的东西。
 * 5. **图标走集中映射**：对象类型图标走 `ObjectTypeIcon`，导航入口图标走 `NAV_ICONS`，
 *    业务系统图标走 `SYSTEM_ICONS`（09 §8「图标映射集中在 SemanticIcon.tsx，页面不得自行
 *    散落图标选择」）。
 * 6. **不得用视口断点类、不得用任意字号、不得用单侧粗边框**（§1.6.1 第 3 条、
 *    §1.4、§1.10「色彩和状态」第 7 条）。
 * 7. **零数据请求**：本页是静态引导，不读事实源。
 * 8. **英文文案的引号用弯引号**：直双引号在英文态会读成「代码里的引号」，与中文侧的
 *    `「 」` 不对位（本仓 `settings.removeConfirm` 已有先例）。
 * 9. **系统清单必须与规范源一一对应**：帮助页讲的「七大业务系统」是 `specs/03` §9.1–§9.7
 *    的七节，多一个是在讲不存在的系统，少一个是有一个系统没被解释。这条**读规范源**，
 *    不写死名单——规范改了，守卫跟着改，页面必须同步改。
 * 10. **整页必须是单一 tab 容器**：先前是「上方两块常显概览 + 下方分区切换」的双层
 *     结构，两套组织范式挤在一页，常显正文越长、切换区离得越远，tab「一次只呈现
 *     一件事」的价值就被抵消。概览必须收进分区之内，声明必须在切换区之上。
 * 11. **呈现件必须按类型登记，每类只有一种壳**：本页共九类呈现件（声明条、对照表、
 *     形态卡、条目卡、行式清单、标签阵列、信任阶梯、提示条、步骤清单），每类的根元素带
 *     `data-presentation` 标记并由一个组件产出。登记清单与实现必须一一对应，同一类型
 *     不得出现第二处定义点或第二种根元素。上一轮的旧口径（「全页只有一种卡片壳 +
 *     一种行式列表」）会把本页真正需要的形态判死——症状与机制是一一对应，用对照表
 *     才准确；七个否定项是短句，用标签阵列才一屏扫得完；「如何开始」的两步有来源
 *     已成立的先后顺序，用有序列表才准。要防的是**同一类东西出现两套写法**，不是
 *     **出现多种类**。
 * 12. **标题层级必须 h1 → h2 → h3**：h1 是页头，h2 是分区标题，h3 是条目标题。分组
 *     标签是普通文本行，不占标题层级；不得出现 h4 及更深，也不得跳级。
 *
 * **保证边界（如实登记）**：本守卫是**源码级**的——它证明页面的结构与取用方式符合
 * 上述约定，不证明页面上每句话与规范源逐字一致（那句话由人工与规范评审承担）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

/**
 * 规范源目录（仓库根 `specs/`）。从本文件位置反解，不依赖进程 cwd——
 * 同一份守卫无论从 `plugin/web` 还是仓库根跑，读到的都是同一批规范源。
 */
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

/**
 * 剥掉注释，只留代码位。
 *
 * **为什么需要**：反向断言（"不得出现 X"）若扫全文，会被**解释为什么撤掉 X 的注释**
 * 判红——本仓已有同类事故：撤除类反向断言写成全文匹配，被注释里的历史记述误判
 * （docs/11 §4unvicies 追记）。故反向断言一律只查代码位。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const help = read('src/pages/Help.tsx');
const helpCode = stripComments(help);
const sidebar = read('src/components/Sidebar.tsx');
const sidebarCode = stripComments(sidebar);
const semanticIcon = read('src/components/SemanticIcon.tsx');

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

  // 反向：改版后必须仍由登记过的组件契约承载，而不是自写一套。
  assert.match(help, /ldvh-page-frame/, '帮助页须走 ldvh-page-frame 页面框架');
  assert.match(help, /ldvh-page-toolbar/, '帮助页须走 ldvh-page-toolbar 工具条');
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
  // 导航入口图标：集中到 SemanticIcon 的 NAV_ICONS，Sidebar 与帮助页共用一份。
  assert.match(semanticIcon, /export const NAV_ICONS/, 'SemanticIcon 须导出导航入口图标映射 NAV_ICONS');
  for (const icon of ['LayoutDashboard', 'FolderTree', 'GitPullRequestArrow', 'MapPinned', 'Activity']) {
    assert.doesNotMatch(
      sidebarCode,
      new RegExp(`\\b${icon}\\b`),
      `Sidebar 不得直接引用 ${icon}，须经 NAV_ICONS 集中映射（09 §8）`,
    );
  }
  assert.match(sidebar, /NAV_ICONS\./, 'Sidebar 须经 NAV_ICONS 取导航入口图标');

  // 对象类型图标：帮助页经 ObjectTypeIcon 取，不得内联 lucide 类型图标。
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

  // 业务系统图标：七大业务系统没有对象身份可继承对象类型图标，故另立 SYSTEM_ICONS；
  // 帮助页不得自行 import 那七个 lucide 图形。
  assert.match(semanticIcon, /export const SYSTEM_ICONS/, 'SemanticIcon 须导出业务系统图标映射 SYSTEM_ICONS');
  for (const icon of ['Waypoints', 'Sprout', 'Cog', 'Telescope', 'Combine', 'Library', 'Receipt']) {
    assert.doesNotMatch(
      helpCode,
      new RegExp(`\\b${icon}\\b`),
      `帮助页不得内联业务系统图标 ${icon}，须经 SYSTEM_ICONS 集中映射（09 §8）`,
    );
  }
  assert.match(help, /SYSTEM_ICONS\[/, '帮助页须经 SYSTEM_ICONS 取业务系统图标');

  // SYSTEM_ICONS 必须登记齐帮助页用到的全部系统键——少登记一个，那张卡的图标就是
  // undefined，页面静默塌成空白而不报错。
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

test('帮助页的对象地图必须与左侧导航的对象族一一对应', () => {
  // 左侧导航里指向**事实对象**的入口（`/objects/:type`）。`/changelog` 提交记录不
  // 计入——它不是事实对象，帮助页把它放在「入口地图」而非「对象地图」里。
  const navTypes = [...new Set([...sidebar.matchAll(/to: '\/objects\/(\w+)'/g)].map((m) => m[1]))].sort();
  assert.ok(navTypes.length > 0, '须能从 Sidebar 读出导航中的事实对象类型集合');

  const mapBlock = help.slice(help.indexOf('const OBJECT_MAP'), help.indexOf('const GATES'));
  const mapTypes = [...mapBlock.matchAll(/type: '(\w+)'/g)].map((m) => m[1]).sort();

  assert.deepEqual(
    mapTypes,
    navTypes,
    '帮助页对象地图的类型集合必须与左侧导航的事实对象族完全一致——少一类等于有一个入口没被解释，多一类等于在讲不存在的东西',
  );
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

  // 旧「Vibe 开发步骤 7 步」已撤除：其中的「讨论模块」所指的讨论业务系统已于
  // 2026-10 由 Human 决定删除，续着写就是拿不存在的系统教人做事。
  assert.doesNotMatch(
    zhKeys.join('\n'),
    /help\.vibeSteps|^help\.step\./m,
    '旧流程词条（help.vibeSteps / help.step.*）已撤除，不得复活',
  );
  assert.doesNotMatch(helpCode, /help\.(vibeSteps|step\.)/, '帮助页不得引用旧流程词条');

  // 七个分区与页脚声明必须在两侧都在。
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
    'help.disclaimer',
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

  // 规范源：03 §9.1–§9.7 的七节标题——这是「七大业务系统」的权威清单。
  // **读规范源而不是写死名单**：规范改名时守卫跟着变，页面必须同步改；写死名单则
  // 规范改了页面不改，两边悄悄分叉而无人察觉。
  const spec = readSpec('03-业务系统基础规范.md');
  const specSystems = [...spec.matchAll(/^###\s+9\.(\d+)\s+(.+?)\s*$/gm)].map((m) => m[2]);
  assert.equal(
    specSystems.length,
    7,
    'specs/03 §9 应当是七节（七大业务系统）——若规范改动此处，页面与本守卫须同步',
  );

  // 页面：help.systems.<key>.title 的中文值。
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

test('帮助页必须是单一 tab 容器：概览不得常显，声明必须在切换区之上', () => {
  // 切换区只能有一处。
  const stickyCount = [...helpCode.matchAll(/sticky top-0/g)].length;
  assert.equal(stickyCount, 1, `帮助页只允许一处 sticky 切换区，发现 ${stickyCount} 处`);

  const tabMapCount = [...helpCode.matchAll(/TABS\.map\(/g)].length;
  assert.equal(tabMapCount, 1, `帮助页只允许一处分区切换区渲染点，发现 ${tabMapCount} 处`);

  // 七个分区各自一个条件渲染分支。
  const branchCount = [...helpCode.matchAll(/tab === '/g)].length;
  assert.equal(branchCount, 7, `帮助页须有七个分区条件渲染分支，发现 ${branchCount} 个`);

  // **切换区之前不得有任何常显内容区块**——这一条直接判死「上方常显概览 + 下方分区
  // 切换」的双层结构。判据只认「切换区之前出现了内容渲染件」，不认组件叫什么，
  // 所以把概览换个组件名搬回常显区照样判红。
  const barIndex = helpCode.indexOf('sticky top-0');
  assert.ok(barIndex >= 0, '帮助页须有 sticky 切换区');
  const beforeBar = helpCode.slice(0, barIndex);
  assert.doesNotMatch(
    beforeBar,
    /<article\b|ldvh-section-grid|overflow-hidden rounded-xl/,
    '切换区之前不得有常显内容区块——概览必须收进分区之内，否则两套组织范式挤在同一页',
  );

  // 声明是页面级限定，须在切换区之上（页头正下方），不能压在长分区末尾等人滚到底。
  const disclaimer = helpCode.indexOf("t('help.disclaimer')");
  assert.ok(disclaimer >= 0, '帮助页须渲染页脚声明');
  assert.ok(
    disclaimer < barIndex,
    '声明必须在切换区之上——它是页面级限定，与分区内容无关',
  );
});

test('帮助页的呈现件必须按类型登记，每类只有一种壳', () => {
  /**
   * 呈现件登记表：**类型 → 根元素标签**。
   *
   * 每种呈现件的根元素带 `data-presentation="类型"`，由一个组件产出（全页恰好一处定义
   * 点）。守卫据此复算三件事：登记清单与实现一一对应、同一类型没有第二处定义点、根
   * 元素标签与登记一致。
   *
   * **为什么按类登记而不是「全页只有一种壳」**：上一轮的口径（一种卡片壳 + 一种行式
   * 列表）会把本页真正需要的形态判死——症状与机制是一一对应，用对照表才准确；七个
   * 否定项是短句，用标签阵列才一屏扫得完；「如何开始」的两步有来源已成立的先后
   * 顺序，用有序列表（ol）才准。要防的是**同一类东西出现两套写法**，不是**出现
   * 多种类**。
   */
  const PRESENTATION_REGISTRY: Record<string, string> = {
    notice: 'div',
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

  // ① 登记清单与实现必须一一对应：多一种是未经登记的呈现件，少一种是登记了却没用。
  assert.deepEqual(
    [...byType.keys()].sort(),
    Object.keys(PRESENTATION_REGISTRY).sort(),
    '帮助页的呈现件集合必须与登记清单一致——多一个是未经登记的呈现件，少一个是登记了却没用上',
  );

  // ② 每类只能有一个定义点：同一类出现两处，就是同一类东西有了两套写法。
  for (const [type, entry] of byType) {
    assert.equal(
      entry.count,
      1,
      `呈现件 ${type} 只允许一处定义点（由一个组件产出），发现 ${entry.count} 处——同一类出现两套写法，读起来像几套页面拼在一起`,
    );
    // ③ 根元素标签必须与登记一致：行式清单与标签阵列必须是列表（ul/li），步骤清单
    //    必须是有序列表（ol）——顺序本身就是信息，语义不留给读屏器猜。
    assert.deepEqual(
      [...entry.tags],
      [PRESENTATION_REGISTRY[type]],
      `呈现件 ${type} 的根元素必须是 <${PRESENTATION_REGISTRY[type]}>`,
    );
  }

  // ④ 网格基准唯一：卡片网格走 ldvh-section-grid，页面不得自写第二套列宽基准。
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
