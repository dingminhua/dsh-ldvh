/**
 * 对象类型颜色映射
 */

export const TYPE_COLORS: Record<string, string> = {
  workcase: '#0ea5e9',  // sky
  adr: '#a855f7',       // purple
  pitfall: '#ef4444',   // red
  spark: '#eab308',      // yellow
  research: '#14b8a6',   // teal —— 与前端 CATEGORY_COLORS.research 一致（认知页类型图标用后端色）
  study: '#06b6d4',      // cyan（v4 遗留词汇，归档兼容）
  default: '#6b7280',   // gray
}

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.default
}
