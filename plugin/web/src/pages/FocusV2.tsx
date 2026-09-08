/**
 * 聚焦 v2 · 目标页（测试页 / dev 载体）。
 *
 * 目的：在保留原「聚焦」(CognitionCenter) 之上的提案预览，让 Human 对照与修复。
 * 结构自上而下：
 *   1. 目标区——Goal(25) 真实投影（fetchCognitionGoal 读 goal.md）：目标陈述 + 子目标
 *      SG-n 卡片网格。带复制提示词按钮（一句话触发 AI 对话——方法论由 30 号行动模板
 *      承载，提示词只是触发器）。方法与规划两区已移除（后续重新设计）。
 *   2. 下方原样嵌入 <CognitionCenter />，其内实现一行不改（含自身数据获取与五模块）。
 *
 * 只读、无写入口；本区仅是目标的可视投影，不构成第二事实源（00 §3.3）。
 * 本页为讨论载体（docs/blueprint-web-presentation-discussion.md），未裁决为正式首页。
 */
import { useEffect, useState } from 'react';
import { FlaskConical, Target, Layers, Sparkle } from 'lucide-react';
import CognitionCenter from '@/pages/CognitionCenter';
import CopyPathButton from '@/components/CopyPathButton';
import { fetchCognitionGoal, ApiRequestError } from '@/utils/api';
import { useI18n } from '@/i18n/context';

/** 单例冻结锚的项目级内聚色（与类型色分离，仅供本预览页作语义标记，不进入 CATEGORY_COLORS）。 */
const GOAL_TINT = 'rgb(20 184 166)';

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

      {/* ============ 目标区 ============ */}
      <section className="mb-5 overflow-hidden rounded-xl border border-teal-400/25 bg-gradient-to-br from-[#0e1f24] via-ldvh-panel to-[#111a2e] p-5 dark:border-teal-400/25">
        {/* 区头 */}
        <div className="mb-4 flex items-center gap-2">
          <Target size={15} style={{ color: GOAL_TINT }} aria-hidden="true" />
          <span className="ldvh-section-title" style={{ color: GOAL_TINT }}>{t('focusV2.goalTitle')}</span>
          <span className="ml-auto flex items-center gap-2">
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

        {/* 目标卡 */}
        <div className="rounded-lg border border-ldvh-border bg-ldvh-panel/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-ldvh-text-primary">
              {goalError ? t('focusV2.goalMissing') : goal ? goal.title : '…'}
            </span>
            {goal && (
              <span
                className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: 'rgba(20,184,166,.15)', color: GOAL_TINT }}
              >
                {goal.status}
              </span>
            )}
          </div>
          {goalMissing && (
            <div className="mt-3">
              <p className="text-xs text-ldvh-text-secondary">{t('focusV2.goalEmptyHint')}</p>
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
            <p className="mt-3 text-sm leading-relaxed text-ldvh-text-secondary">{goal.statement}</p>
          )}
        </div>

        {/* 子目标卡片网格 */}
        {goal && goal.sub_goals.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkle size={12} style={{ color: GOAL_TINT }} aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ldvh-text-secondary">
                {t('focusV2.subGoalTitle')}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {goal.sub_goals.map((sg) => (
                <div
                  key={sg.id}
                  className="rounded-lg border border-ldvh-border bg-ldvh-panel px-3 py-2.5 transition-colors hover:border-teal-400/40"
                >
                  <div
                    className="mb-1 text-xs font-bold"
                    style={{ color: GOAL_TINT }}
                  >
                    {sg.id}
                  </div>
                  <div className="text-xs leading-relaxed text-ldvh-text-primary">{sg.text}</div>
                </div>
              ))}
            </div>
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
