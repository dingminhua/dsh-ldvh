/**
 * 对象类型颜色映射
 */

export const TYPE_COLORS: Record<string, string> = {
  workcase: '#0ea5e9',  // sky
  adr: '#a855f7',       // purple
  pitfall: '#ef4444',   // red
  spark: '#eab308',      // yellow
  study: '#06b6d4',      // cyan
  default: '#6b7280',   // gray
}

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.default
}
