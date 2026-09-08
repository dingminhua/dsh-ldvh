/**
 * 聚焦 v2 · 目标页（测试页 / dev 载体）。
 *
 * 目的：在保留原「聚焦」(CognitionCenter) 之上的提案预览，让 Human 对照与修复。
 * 结构自上而下：
 *   1. 目标区已作为第一个模块移入原聚焦页（components/GoalSection.tsx），本页不再单独渲染，避免两份实现漂移；下方嵌入的 CognitionCenter 即带目标模块。
 *      SG-n 列表。样式与交互对齐原聚焦页模块（ldvh-panel/ldvh-border/区头 ldvh-section-title
 *      + 可点击折叠 + 列表 divide-y），带复制提示词按钮（一句话触发 AI 对话——方法论由
 *      30 号行动模板承载，提示词只是触发器）。方法与规划两区已移除（后续重新设计）。
 *   2. 下方原样嵌入 <CognitionCenter embedded />——embedded 去掉其自带 p-6，避免被套进
 *      本页 p-6 容器后双重内边距（下方模块间距变大且左右不对齐的根因）。
 *
 * 只读、无写入口；本区仅是目标的可视投影，不构成第二事实源（00 §3.3）。
 * 本页为讨论载体（docs/blueprint-web-presentation-discussion.md），未裁决为正式首页。
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { FlaskConical, Layers } from 'lucide-react';
import CognitionCenter from '@/pages/CognitionCenter';
import { useI18n } from '@/i18n/context';

export default function FocusV2() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-full flex-col p-6">
      {/* 测试页横幅：明确本页身份，提示原页未动 */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/[0.05] px-3 py-2 text-sm text-amber-200/90">
        <FlaskConical size={15} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
        <span>{t('focusV2.banner')}</span>
      </div>

      <div className="mb-4">
        <h1 className="ldvh-page-title">{t('focusV2.title')}</h1>
        <p className="ldvh-page-subtitle mt-1">{t('focusV2.subtitle')}</p>
      </div>

      {/* 下方 = 原聚焦页（原样嵌入，embedded 去自带 p-6） */}
      <div className="mb-3 flex items-center gap-2 text-xs text-emerald-400/90">
        <Layers size={13} aria-hidden="true" />
        <span>{t('focusV2.below')}</span>
      </div>

      <CognitionCenter hideCommitHotspots embedded />
    </div>
  );
}
