/**
 * 聚焦 v2 · 蓝图首页（测试页 / dev 载体）。
 *
 * 目的：在保留原「聚焦」(CognitionCenter) 之上的提案预览，让 Human 对照与修复。
 * 结构自上而下：
 *   1. 「目标」区（goal.md 陈述+子目标投影）+「规划」区（goal.md 规划区投影），
 *      各带复制提示词按钮（一句话触发 AI 对话——方法论在 AI 内部，提示词只是触发器）。
 *   2. 下方原样嵌入 <CognitionCenter />（当前状态）。
 *   2. 下方原样嵌入 <CognitionCenter />，其内实现一行不改（含自身数据获取与五模块）。
 *
 * 只读、无写入口；蓝图区仅是目标的可视投影，不构成第二事实源（00 §3.3）。
 * 本页为讨论载体（docs/blueprint-web-presentation-discussion.md），未裁决为正式首页。
 */
import { useEffect, useState } from 'react';
import { FlaskConical, Target, Layers, ListTodo, Compass } from 'lucide-react';
import CognitionCenter from '@/pages/CognitionCenter';
import CopyPathButton from '@/components/CopyPathButton';
import { fetchCognitionGoal, ApiRequestError } from '@/utils/api';
import { useI18n } from '@/i18n/context';

/** 单例冻结锚的项目级内聚色（与类型色分离，仅供本预览页作语义标记，不进入 CATEGORY_COLORS）。 */
const GOAL_TINT = 'rgb(20 184 166)';

export default function FocusV2() {
  const { t } = useI18n();
  const [goal, setGoal] = useState<{ title: string; status: string; statement: string; method: string; sub_goals: { id: string; text: string }[]; plan_items: { text: string; serves: string | null }[] } | null>(null);
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
      <section className="mb-4 overflow-hidden rounded-xl border border-teal-400/25 bg-gradient-to-br from-[#0e1f24] via-ldvh-panel to-[#111a2e] p-4 dark:border-teal-400/25">
        <div className="mb-3 flex items-center gap-2">
          <Target size={14} style={{ color: GOAL_TINT }} aria-hidden="true" />
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
        <div className="rounded-lg border border-ldvh-border bg-ldvh-panel/70 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ldvh-text-primary">
              {goalError ? t('focusV2.goalMissing') : goal ? goal.title : '…'}
            </span>
            {goal && (
              <span
                className="rounded-md px-1.5 py-px text-[11px] font-semibold"
                style={{ background: 'rgba(20,184,166,.15)', color: GOAL_TINT }}
              >
                {goal.status}
              </span>
            )}
          </div>
          {goalMissing && (
            <div className="mt-2">
              <p className="text-xs text-ldvh-text-secondary">{t('focusV2.goalEmptyHint')}</p>
              <CopyPathButton
                path={t('focusV2.promptSetGoal')}
                label={t('focusV2.btnSetGoal')}
                copiedLabel={t('focusV2.btnCopied')}
                size="md"
              />
            </div>
          )}
          {goalError && <p className="mt-1 text-xs text-red-400">{goalError}</p>}
          {goal?.statement && <p className="mt-2 text-sm leading-relaxed text-ldvh-text-secondary">{goal.statement}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {(goal ? goal.sub_goals : []).map((sg) => (
              <span
                key={sg.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ldvh-border bg-ldvh-panel px-2 py-1 text-xs text-ldvh-text-primary"
              >
                <span className="font-semibold" style={{ color: GOAL_TINT }}>{sg.id}</span>
                <span className="max-w-[16rem] truncate">{sg.text}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 方法区 ============ */}
      <section className="mb-4 overflow-hidden rounded-xl border border-purple-400/20 bg-ldvh-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Compass size={14} className="text-purple-400" aria-hidden="true" />
          <span className="ldvh-section-title text-purple-400">{t('focusV2.methodTitle')}</span>
          <span className="ml-auto flex items-center gap-2">
            {goal && (
              <CopyPathButton
                path={t('focusV2.promptAdjustMethod')}
                label={t('focusV2.btnAdjustMethod')}
                copiedLabel={t('focusV2.btnCopied')}
                size="md"
              />
            )}
          </span>
        </div>
        {goal?.method ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-ldvh-text-secondary">{goal.method}</div>
        ) : (
          <p className="py-1 text-xs text-ldvh-text-secondary">{goal ? t('focusV2.methodEmptyHint') : '…'}</p>
        )}
      </section>

      {/* ============ 规划区 ============ */}
      <section className="mb-5 overflow-hidden rounded-xl border border-blue-400/20 bg-ldvh-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <ListTodo size={14} className="text-blue-400" aria-hidden="true" />
          <span className="ldvh-section-title text-blue-400">{t('focusV2.planTitle')}</span>
          <span className="ml-auto flex items-center gap-2">
            {goal && (goal.plan_items?.length ?? 0) > 0 && (
              <CopyPathButton
                path={t('focusV2.promptAdjustPlan')}
                label={t('focusV2.btnAdjustPlan')}
                copiedLabel={t('focusV2.btnCopied')}
                size="md"
              />
            )}
            {goal && (goal.plan_items?.length ?? 0) === 0 && (
              <CopyPathButton
                path={t('focusV2.promptCreatePlan')}
                label={t('focusV2.btnCreatePlan')}
                copiedLabel={t('focusV2.btnCopied')}
                size="md"
              />
            )}
          </span>
        </div>
        {(goal && (goal.plan_items?.length ?? 0) > 0) ? (
          <ol className="divide-y divide-ldvh-border/60">
            {goal.plan_items.map((item, idx) => (
              <li key={idx} className="flex min-w-0 items-center gap-2 py-1.5 text-sm">
                <span className="shrink-0 text-[11px] font-semibold text-ldvh-text-secondary">{idx + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-ldvh-text-primary">{item.text}</span>
                {item.serves && (
                  <span className="shrink-0 rounded-md border border-teal-400/30 bg-teal-500/10 px-1.5 py-px text-[11px] font-semibold" style={{ color: GOAL_TINT }}>{item.serves}</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-1 text-xs text-ldvh-text-secondary">{goal ? t('focusV2.planEmptyHint') : '…'}</p>
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
