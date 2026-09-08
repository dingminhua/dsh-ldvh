/**
 * 聚焦 v2 · 目标页（测试页 / dev 载体）。
 *
 * 目的：在保留原「聚焦」(CognitionCenter) 之上的提案预览，让 Human 对照与修复。
 * 结构自上而下：
 *   1. 目标区——Goal(25) 真实投影（fetchCognitionGoal 读 goal.md）：目标陈述 + 子目标
 *      SG-n 列表。样式与原聚焦页模块一致（ldvh-panel/ldvh-border/区头 ldvh-section-title
 *      + 列表 divide-y），带复制提示词按钮（一句话触发 AI 对话——方法论由 30 号行动模板
 *      承载，提示词只是触发器）。方法与规划两区已移除（后续重新设计）。
 *   2. 下方原样嵌入 <CognitionCenter />，其内实现一行不改（含自身数据获取与五模块）。
 *
 * 只读、无写入口；本区仅是目标的可视投影，不构成第二事实源（00 §3.3）。
 * 本页为讨论载体（docs/blueprint-web-presentation-discussion.md），未裁决为正式首页。
 */
import { useEffect, useState } from 'react';
import { FlaskConical, Target, Layers } from 'lucide-react';
import CognitionCenter from '@/pages/CognitionCenter';
import CopyPathButton from '@/components/CopyPathButton';
import { fetchCognitionGoal, ApiRequestError } from '@/utils/api';
import { useI18n } from '@/i18n/context';

export default function FocusV2() {
  const { t } = useI18n();
  const [goal, setGoal] = useState<{ title: string; status: string; statement: string; sub_goals: { id: string; text: string }[] } | null>(null);
  const [goalMissing, setGoalMissing] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCognitionGoal()
      .then((data) => {
        if (cancelled || !data.goal) return;
        setGoal(data.goal);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.code === 'goal_missing') setGoalMissing(true);
        else if (err instanceof ApiRequestError) setGoalError(err.message);
        else setGoalError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

      {/* ============ 目标区（样式对齐原聚焦页模块） ============ */}
      <section className="mb-4 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
        {/* 区头：图标 + ldvh-section-title + 右侧复制按钮（与原页一致） */}
        <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
          <Target size={16} className="shrink-0 text-ldvh-accent" aria-hidden="true" />
          <h3 className="ldvh-section-title min-w-0">{t('focusV2.goalTitle')}</h3>
          {goal && (
            <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{goal.status}</span>
          )}
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            {goal && (
              <CopyPathButton
                path={t('focusV2.promptAdjustGoal')}
                label={t('focusV2.btnAdjustGoal')}
                copiedLabel={t('focusV2.btnCopied')}
                size="md"
              />
            )}
          </span>
        </div>

        {/* 目标卡：标题 + 状态 + 陈述（用原页 object-title-tray 类似的中性托盘） */}
        <div className="min-w-0 rounded-md border border-ldvh-border/45 bg-ldvh-bg/40 px-3 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="ldvh-card-title min-w-0 font-semibold">
              {goalError ? t('focusV2.goalMissing') : goal ? goal.title : '…'}
            </span>
            {goal && (
              <span className="ldvh-chip ldvh-chip-sm shrink-0 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent">
                {goal.status}
              </span>
            )}
          </div>
          {goalMissing && (
            <div className="mt-2">
              <p className="ldvh-caption min-w-0 text-ldvh-text-secondary/70">{t('focusV2.goalEmptyHint')}</p>
              <div className="mt-2">
                <CopyPathButton
                  path={t('focusV2.promptSetGoal')}
                  label={t('focusV2.btnSetGoal')}
                  copiedLabel={t('focusV2.btnCopied')}
                  size="md"
                />
              </div>
            </div>
          )}
          {goalError && <p className="mt-1 text-xs text-red-400">{goalError}</p>}
          {goal?.statement && (
            <p className="mt-2 text-sm leading-relaxed text-ldvh-text-secondary">{goal.statement}</p>
          )}
        </div>

        {/* 子目标列表（原页列表风格：divide-y） */}
        {goal && goal.sub_goals.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="ldvh-caption min-w-0 text-ldvh-text-secondary/70">{t('focusV2.subGoalTitle')}</span>
              <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{goal.sub_goals.length}</span>
            </div>
            <ul className="divide-y divide-ldvh-border/70">
              {goal.sub_goals.map((sg) => (
                <li key={sg.id} className="flex min-w-0 items-start gap-2 py-2">
                  <span className="ldvh-chip ldvh-chip-sm shrink-0 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent">
                    {sg.id}
                  </span>
                  <span className="ldvh-card-title min-w-0 flex-1 leading-relaxed">{sg.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 下方 = 原聚焦页（原样嵌入） */}
      <div className="mb-3 flex items-center gap-2 text-xs text-emerald-400/90">
        <Layers size={13} aria-hidden="true" />
        <span>{t('focusV2.below')}</span>
      </div>

      <CognitionCenter hideCommitHotspots />
    </div>
  );
}
