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
  goal: '#10b981',       // emerald —— 与前端 CATEGORY_COLORS.goal 一致（25 号项目目标，近期动态行用后端色）
  subgoal: '#84cc16',    // lime —— 与前端 CATEGORY_COLORS.subgoal 一致（28 号子目标：目标层的下级锚点，
                         //         取绿色族以表明与 goal 同属目标层、又浅一档以示从属）
  devlog: '#2c9e43',     // 青绿色（green 偏 teal）—— 与前端 CATEGORY_COLORS.devlog 一致（29 号开发日志）。
                         //         色相 132°：Human 定案改用冷色系（此前为 magenta
                         //         #ca21a0 / 315°）。冷色带里只有绿色带可用——青色带
                         //         （≈195°）距状态天蓝 #0284c7(200°) 仅 5°、靛蓝带
                         //         （≈238°）距独立复核 #818cf8(235°) 仅 3°，都会与状态色
                         //         同屏撞读。本值距最近类型色 goal（160°）28°、距状态绿
                         //         #059669（161°）29°，均留足间隔（契约阈值 20°）。
                         //         **不用中性灰**——灰已被终态/收敛状态族占用（closed/voided/
                         //         已废弃），类型色借灰会把「这是什么类型」与「它处于什么
                         //         状态」混成同一信号。对比度按本仓库真实底色：浅 #f8f9fb 上
                         //         3.28:1、暗 #0a0a0f 上 5.72:1，两模式均过非正文文本
                         //         3:1 可读线；卡内正文按 oklab 混色（类型色 58% + 正文字色）
                         //         后浅 7.00:1 / 暗 6.96:1，过正文 4.5:1 判据。
  study: '#06b6d4',      // cyan（v4 遗留词汇，归档兼容）
  default: '#6b7280',   // gray
}

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.default
}
