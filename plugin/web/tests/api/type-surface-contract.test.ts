import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const webRoot = path.resolve(import.meta.dirname, '..', '..');

function read(relativePath: string): Promise<string> {
  return readFile(path.join(webRoot, relativePath), 'utf8');
}

/**
 * 类型色语义面的呈现契约（Human 定案 2026-11-02）。
 *
 * ## 立此契约的由来
 *
 * Human 指着两张截图里被圈出的卡体主块说：「圈出来的要和类型的颜色对上，也就是
 * 同一个色系的」。
 *
 * - 子目标卡：卡头类型 chip 与次序 icon 是 lime `#84cc16`，被圈的主块却是**蓝面**
 *   （`WORKCASE_CRITERIA_SURFACE_CLASS`）；
 * - 开发日志卡：卡头类型 chip 是 magenta `#ca21a0`（该类型色 2026-11-03 已改为青绿
 *   `#2c9e43`，这里留的是定案当时的事实），被圈的主块**同样是蓝面**。
 *
 * 同一个蓝被贴到两个不同类型上，说明当时被当成「判据面通用色」的其实是 **WorkCase
 * 自己的类型色**。起因可查：2026-11-02 早先的定案是「子目标判据框样式对齐 workcase
 * 的」，照抄时把整面（含蓝）抄了过来，而那次定案要的是**几何**对齐。
 *
 * ## 本契约守什么
 *
 * 1. 类型色语义面有**单一来源**（`utils/typeSurface.ts` 的 `getTypeSurfaceTint`），
 *    色相从 `CATEGORY_COLORS` 取——即与卡头 chip 同一张色表，不存在第二张。
 * 2. 消费方**面和正文成对**取用：只贴面会让正文沿用中性近黑，色相面与正文分家
 *    （`docs/01` §1.6 要求同色相）。
 * 3. 消费方**不得**再整面复用 `WORKCASE_CRITERIA_SURFACE_CLASS`——那会把 WorkCase 的
 *    类型色当成通用色，正是本次要修的病。几何仍可复用
 *    `WORKCASE_SURFACE_GEOMETRY_CLASS`（2026-11-02「对齐 workcase」的几何对齐继续成立）。
 *
 * ## 不保证什么（如实声明）
 *
 * - 不保证真机视觉与对比度：混合比例各类型色逐一实测属未覆盖项（登记在 `docs/11`）。
 * - 不保证 `color-mix()` 在旧浏览器的降级形态——本契约只锁源码形态。
 */

test('类型色语义面有单一来源，色相取自类型色而非另立色表', async () => {
  const source = await read('src/utils/typeSurface.ts');

  assert.match(source, /export function getTypeSurfaceTint/, '须导出 getTypeSurfaceTint');
  assert.match(source, /function typeColorOf\(type: string\): string \{[\s\S]{0,160}getCategoryColor\(type\)/,
    '类型色必须经 getCategoryColor 取——那是卡头 chip 用的同一张表，不得另立第二张');
  // 三个比例常量必须导出：它们是调档入口，散在消费方里就等于把「多深」拆成多份答案。
  for (const name of ['TYPE_SURFACE_BORDER_MIX', 'TYPE_SURFACE_BACKGROUND_MIX', 'TYPE_SURFACE_TEXT_MIX']) {
    assert.match(source, new RegExp(`export const ${name} = \\d+`), `${name} 须导出为常量`);
  }
  // 正文色必须与 text-primary 混合：只混类型色会得到浅色/暗色下都读不清的中间调。
  assert.match(source, /color: `color-mix\(in oklab, \$\{color\} \$\{TYPE_SURFACE_TEXT_MIX\}%, rgb\(var\(--ldvh-text-primary\)\)\)`/,
    '正文色须与 --ldvh-text-primary 混合，才能在两主题下各自读得清');
});

test('两张卡的卡体主块都按本类型色上色，且面与正文成对', async () => {
  const objectList = await read('src/pages/ObjectList.tsx');

  // ① DevLog 卡体（`summary` 承载块）
  const devlogCard = objectList.slice(
    objectList.indexOf('export function DevLogCardContent'),
    objectList.indexOf('const SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT'),
  );
  assert.ok(devlogCard.length > 0, '应能定位 DevLogCardContent');
  assert.match(devlogCard, /getTypeSurfaceTint\(obj\.type\)/, 'DevLog 卡体须按本类型色上色');
  assert.match(devlogCard, /style=\{tint\.surface\}/, '承载面色相须贴在面上');
  // 正文色走 `SummaryText` 的 `bodyStyle` 口，**不能**只设外层 `style.color`：
  // Markdown 渲染出的 `<p>` 由 `github-markdown-css` 着色、不继承外层 color。
  // 2026-11-02 实测正是如此——外层已生效、块内正文仍是近黑。
  assert.match(devlogCard, /bodyStyle=\{tint\.body\}/,
    'DevLog 正文色须经 SummaryText 的 bodyStyle 传入（Markdown 的 p 不继承外层 color）');
  assert.doesNotMatch(devlogCard, /WORKCASE_CRITERIA_SURFACE_CLASS/,
    'DevLog 卡体不得再整面复用 WorkCase 判据面（蓝是 WorkCase 的类型色）');

  // ② 子目标判据面
  const subGoalCard = objectList.slice(
    objectList.indexOf('function SubGoalActiveCardBody'),
    objectList.indexOf('export default function ObjectList()'),
  );
  assert.ok(subGoalCard.length > 0, '应能定位 SubGoalActiveCardBody');
  assert.match(subGoalCard, /getTypeSurfaceTint\(obj\.type\)/, '子目标判据面须按本类型色上色');
  assert.match(subGoalCard, /style=\{tint\.surface\}/);
  assert.match(subGoalCard, /style=\{tint\.body\}/);
  assert.doesNotMatch(subGoalCard, /WORKCASE_CRITERIA_SURFACE_CLASS/,
    '子目标判据面不得再整面复用 WorkCase 判据面');
  // 几何仍与 WorkCase 同源：2026-11-02「对齐 workcase」定案在几何上继续成立，
  // 本契约只改色相，不允许顺手把几何另写一份。
  assert.match(subGoalCard, /WORKCASE_SURFACE_GEOMETRY_CLASS/,
    '几何仍取自单一来源常量，不得自写一套');
});

test('WorkCase 自己的判据面保持蓝面（类型色未变，不因本次改动被泛化）', async () => {
  const criteria = await read('src/components/WorkCaseCriteriaList.tsx');
  // 反向断言：本契约不是「所有判据面都染类型色」，而是「WorkCase 的面本来就是它自己的
  // 类型色」。若有人把 WorkCase 判据面也改成中性或另一套，这条会红。
  assert.match(criteria, /WORKCASE_CRITERIA_SURFACE_CLASS =\s*\n?\s*`\$\{WORKCASE_SURFACE_GEOMETRY_CLASS\} border-blue-400\/20 bg-blue-500\/\[0\.025\] dark:bg-blue-950\/20`/,
    'WorkCase 判据面须保持蓝（那是它自己的类型色，这次不动）');
});

test('类型色语义面不与左色条家族混用（几何四边同宽、无 border-l）', async () => {
  const source = await read('src/utils/typeSurface.ts');
  // 本模块只产出 CSS 属性，不产出 Tailwind 类串——故它不可能引入 `border-l-2`。
  // 这条断言防的是将来有人把它改成「返回 class 串」的实现，顺手带上左色条。
  assert.doesNotMatch(source, /border-l-/, '类型色语义面不得引入左色条（四边同宽是既有定案）');
  assert.doesNotMatch(source, /className/, '本模块只给 CSS 属性，不拼 class 串');
});

/**
 * ## 对比度：九类类型色 × 两主题都必须过正文可读线
 *
 * 与 `workcase-design-language-contract` 里那两条 Gate 色相断言同一套算法
 * （oklab 混合 → 相对亮度 → WCAG 对比度），但**基准不同**：那里比的是页面底色
 * `--ldvh-bg`，这里必须比**卡片底色 + 5% 类型色叠加后的实际背景**——正文就压在
 * 那个面上。用页面底色当基准会算出偏高的值（实测：卡片是 `--ldvh-panel`，浅色下
 * 是纯白而非 `#f8f9fb`）。
 *
 * 阈值取 **4.5:1**：判据正文是 12px（`ldvh-card-decision-body`），属小字号正文，
 * 不能按 3:1 的大字号/非正文线放宽。
 *
 * 这条断言的意义：混合比例（30/5/58）是**实现自选值**，不是人类定案——它必须由
 * 这个可复算的判据来兜住，否则下一次「把正文调深一点」就可能让某一类读不清。
 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function hexToLinear(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  return [r, g, b];
}
function linearToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToLinear([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}
function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** oklab 空间线性混合（与 CSS `color-mix(in oklab, …)` 同算法）。 */
function mixOklab(
  first: [number, number, number],
  second: [number, number, number],
  firstWeight: number,
): [number, number, number] {
  return oklabToLinear(
    first.map((v, i) => v * firstWeight + second[i] * (1 - firstWeight)) as [number, number, number],
  );
}

test('九类类型色 × 两主题的正文都过 4.5:1（混合比例由本判据兜住）', async () => {
  const { CATEGORY_COLORS } = await import('../../src/utils/categoryColors.ts');
  const tint = await read('src/utils/typeSurface.ts');

  const readMix = (name: string): number => {
    const m = new RegExp(`export const ${name} = (\\d+)`).exec(tint);
    assert.ok(m, `未取到 ${name}`);
    return Number(m[1]) / 100;
  };
  const backgroundMix = readMix('TYPE_SURFACE_BACKGROUND_MIX');
  const textMix = readMix('TYPE_SURFACE_TEXT_MIX');

  // 背景取**本仓库真实的**卡片底色与正文主色（`index.css` 的 --ldvh-panel /
  // --ldvh-text-primary 两档），不用白/黑这类仓库外假设。
  const css = await read('src/index.css');

  // 事实类型九类（CATEGORY_COLORS 里还混着 conventional commit scope 色，不属于事实对象）。
  const factTypes = ['workcase', 'adr', 'pitfall', 'spark', 'research', 'friction', 'norm', 'subgoal', 'devlog'];

  const failures: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const block = mode === 'light'
      ? css.slice(css.indexOf(':root {'), css.indexOf(':root.dark'))
      : css.slice(css.indexOf(':root.dark'), css.indexOf('/* 项目色彩标识'));
    const channels = (name: string): string => {
      const m = new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(block);
      assert.ok(m, `未取到 --${name}（${mode}）`);
      const toHex = (v: string) => Number(v).toString(16).padStart(2, '0');
      return `#${toHex(m![1])}${toHex(m![2])}${toHex(m![3])}`;
    };
    const panel = hexToLinear(channels('ldvh-panel'));
    const textPrimary = hexToLinear(channels('ldvh-text-primary'));

    for (const type of factTypes) {
      const hex = CATEGORY_COLORS[type];
      assert.match(hex ?? '', /^#[0-9a-f]{6}$/, `CATEGORY_COLORS.${type} 须为 6 位 hex`);
      const color = hexToLinear(hex);
      // 背景 = 卡片底色 + backgroundMix 的类型色叠加。
      const background = color.map((c, i) => c * backgroundMix + panel[i] * (1 - backgroundMix)) as [number, number, number];
      // 正文 = 类型色与 text-primary 在 oklab 混合。
      const body = mixOklab(linearToOklab(color), linearToOklab(textPrimary), textMix);
      const ratio = contrastRatio(body, background);
      if (ratio < 4.5) failures.push(`${mode}/${type} = ${ratio.toFixed(2)}:1`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `以下类型 × 主题的组合正文低于 4.5:1（12px 正文可读线）——调 typeSurface.ts 的比例常量，不要改单个消费方：\n${failures.join('\n')}`,
  );
});
