/**
 * 项目色彩标识体系（全部管辖计划 Step 2）。
 *
 * 设计原则（docs 锚点：spark-workcase-rebuild Web 迁移线）：
 * - 项目色是第三正交维度，不侵占类型色（categoryColors）与状态色（statusColors）；
 * - 只承载「来自哪个项目」一个语义；
 * - 存储形态为色板键名（如 `emerald`），不是色值——亮暗主题由 CSS 变量换算；
 * - 未显式选色的项目按项目 ID 稳定哈希取色（同一 ID 永远同色，跨会话稳定）；
 * - 本模块位于 shared/：api 侧（校验与 YAML 读写）与 src 侧（渲染）共用同一闭集。
 */

export const PROJECT_COLOR_KEYS = [
  'emerald',
  'sky',
  'violet',
  'amber',
  'rose',
  'cyan',
  'indigo',
  'orange',
  'teal',
  'fuchsia',
] as const;

export type ProjectColorKey = (typeof PROJECT_COLOR_KEYS)[number];

export function isProjectColorKey(value: unknown): value is ProjectColorKey {
  return typeof value === 'string' && (PROJECT_COLOR_KEYS as readonly string[]).includes(value);
}

/** 渲染用 CSS 变量名（--ldvh-pj-<key>，亮暗值定义于 index.css）。 */
export function projectColorVar(key: ProjectColorKey): string {
  return `var(--ldvh-pj-${key})`;
}

/** FNV-1a 32 位哈希——对项目 ID 稳定，跨进程跨会话一致（无 Math.random/Date 依赖）。 */
export function hashProjectColorKey(projectId: string): ProjectColorKey {
  let hash = 0x811c9dc5;
  for (let index = 0; index < projectId.length; index += 1) {
    hash ^= projectId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PROJECT_COLOR_KEYS[hash % PROJECT_COLOR_KEYS.length];
}

/** 最终生效色：显式选择优先，否则按 ID 哈希兜底。 */
export function resolvedProjectColorKey(color: string | undefined, projectId: string): ProjectColorKey {
  return isProjectColorKey(color) ? color : hashProjectColorKey(projectId);
}
