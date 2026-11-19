import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const webRoot = path.resolve(import.meta.dirname, '..', '..');

function read(relativePath: string): Promise<string> {
  return readFile(path.join(webRoot, relativePath), 'utf8');
}


test('类型色语义面有单一来源，色相取自类型色而非另立色表', async () => {
  const source = await read('src/utils/typeSurface.ts');

  assert.match(source, /export function getTypeSurfaceTint/, '须导出 getTypeSurfaceTint');
  assert.match(source, /function typeColorOf\(type: string\): string \{[\s\S]{0,160}getCategoryColor\(type\)/,
    '类型色必须经 getCategoryColor 取——那是卡头 chip 用的同一张表，不得另立第二张');
  for (const name of ['TYPE_SURFACE_BORDER_MIX', 'TYPE_SURFACE_BACKGROUND_MIX', 'TYPE_SURFACE_TEXT_MIX']) {
    assert.match(source, new RegExp(`export const ${name} = \\d+`), `${name} 须导出为常量`);
  }
  assert.match(source, /color: `color-mix\(in oklab, \$\{color\} \$\{TYPE_SURFACE_TEXT_MIX\}%, rgb\(var\(--ldvh-text-primary\)\)\)`/,
    '正文色须与 --ldvh-text-primary 混合，才能在两主题下各自读得清');
});

test('子目标判据面按本类型色上色，且面与正文成对', async () => {
  const subGoalParts = await read('src/components/SubGoalCardParts.tsx');

  const subGoalCard = subGoalParts.slice(
    subGoalParts.indexOf('export function SubGoalCriterionSurface'),
    subGoalParts.indexOf('export function SubGoalDisclosureButton'),
  );
  assert.ok(subGoalCard.length > 0, '应能定位 SubGoalCriterionSurface');
  assert.match(subGoalCard, /getTypeSurfaceTint\(type\)/, '子目标判据面须按本类型色上色');
  assert.match(subGoalCard, /style=\{tint\.surface\}/);
  assert.match(subGoalCard, /style=\{tint\.body\}/);
  assert.doesNotMatch(subGoalCard, /border-blue-400\/20 bg-blue-500/,
    '子目标判据面不得整面复用另一类型的判据面色');
  assert.match(subGoalCard, /min-w-0 rounded-lg border px-3 py-2/,
    '几何仍取统一形态，不得自写一套');
});

test('类型色语义面不与左色条家族混用（几何四边同宽、无 border-l）', async () => {
  const source = await read('src/utils/typeSurface.ts');
  assert.doesNotMatch(source, /border-l-/, '类型色语义面不得引入左色条（四边同宽是既有定案）');
  assert.doesNotMatch(source, /className/, '本模块只给 CSS 属性，不拼 class 串');
});

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
function mixOklab(
  first: [number, number, number],
  second: [number, number, number],
  firstWeight: number,
): [number, number, number] {
  return oklabToLinear(
    first.map((v, i) => v * firstWeight + second[i] * (1 - firstWeight)) as [number, number, number],
  );
}

test('八类类型色 × 两主题的正文都过 4.5:1（混合比例由本判据兜住）', async () => {
  const { CATEGORY_COLORS } = await import('../../src/utils/categoryColors.ts');
  const tint = await read('src/utils/typeSurface.ts');

  const readMix = (name: string): number => {
    const m = new RegExp(`export const ${name} = (\\d+)`).exec(tint);
    assert.ok(m, `未取到 ${name}`);
    return Number(m[1]) / 100;
  };
  const backgroundMix = readMix('TYPE_SURFACE_BACKGROUND_MIX');
  const textMix = readMix('TYPE_SURFACE_TEXT_MIX');

  const css = await read('src/index.css');

  const factTypes = ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal'];

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
      const background = color.map((c, i) => c * backgroundMix + panel[i] * (1 - backgroundMix)) as [number, number, number];
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
