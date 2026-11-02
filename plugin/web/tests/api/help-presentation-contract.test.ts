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
 * 5. **图标走集中映射**：对象类型图标走 `ObjectTypeIcon`，导航入口图标走 `NAV_ICONS`
 *    （09 §8「图标映射集中在 SemanticIcon.tsx，页面不得自行散落图标选择」）。
 * 6. **不得用视口断点类、不得用任意字号、不得用单侧粗边框**（§1.6.1 第 3 条、
 *    §1.4、§1.10「色彩和状态」第 7 条）。
 * 7. **零数据请求**：本页是静态引导，不读事实源。
 * 8. **英文文案的引号用弯引号**：直双引号在英文态会读成「代码里的引号」，与中文侧的
 *    `「 」` 不对位（本仓 `settings.removeConfirm` 已有先例）。
 *
 * **保证边界（如实登记）**：本守卫是**源码级**的——它证明页面的结构与取用方式符合
 * 上述约定，不证明页面上每句话与规范源逐字一致（那句话由人工与规范评审承担）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
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
  assert.match(help, /ldvh-subgrid/, '帮助页的主线格须走 ldvh-subgrid 网格 token');
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

  // 四个分区与页脚声明必须在两侧都在。
  for (const key of [
    'help.tab.objects',
    'help.tab.gates',
    'help.tab.entries',
    'help.tab.trust',
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
