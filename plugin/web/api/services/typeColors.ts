
export const TYPE_COLORS: Record<string, string> = {
  pitfall: '#ef4444',
  spark: '#eab308',
  research: '#14b8a6',
  friction: '#f97316',
  norm: '#8b5cf6',
  goal: '#10b981',
  subgoal: '#84cc16',
  study: '#06b6d4',
  default: '#6b7280',
}

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.default
}
