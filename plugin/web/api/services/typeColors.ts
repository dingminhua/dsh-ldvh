/**
 * 对象类型颜色映射
 */

export const TYPE_COLORS: Record<string, string> = {
  workcase: '#0ea5e9',  // sky
  adr: '#a855f7',       // purple
  pitfall: '#ef4444',   // red
  spark: '#eab308',      // yellow
  research: '#14b8a6',   // teal —— 与前端 CATEGORY_COLORS.research 一致（认知页类型图标用后端色）
  friction: '#f97316',   // orange —— 与前端 CATEGORY_COLORS.friction 一致（26 号摩擦账本）
  norm: '#8b5cf6',       // violet —— 与前端 CATEGORY_COLORS.norm 一致（27 号事实规范）
  study: '#06b6d4',      // cyan（v4 遗留词汇，归档兼容）
  default: '#6b7280',   // gray
}

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.default
}
