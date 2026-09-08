/**
 * 目标区（Goal Section）——聚焦页的第一个模块。
 *
 * 承载 Goal(25) 真实投影：目标陈述 + 子目标 SG-n 列表。
 * 样式与交互对齐原聚焦页其它模块（ldvh-panel/ldvh-border + 区头 ldvh-section-title
 * + 可点击折叠 + 列表 divide-y），带复制提示词按钮（一句话触发 AI 对话——方法论由
 * 30 号行动模板承载，提示词只是触发器）。
 *
 * 只读、无写入口；本区仅是目标的可视投影，不构成第二事实源（00 §3.3）。
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Target } from 'lucide-react';
import { fetchCognitionGoal, ApiRequestError } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { copyText } from '@/utils/clipboard';

/** 区头键盘可达的展开/收起（与原聚焦页 CognitionCenter 区头一致的交互）。 */
function toggleOnKeyboard(event: KeyboardEvent<HTMLDivElement>, toggle: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggle();
}

export default function GoalSection() {
  const { t } = useI18n();
  const [goal, setGoal] = useState<{ title: string; status: string; statement: string; sub_goals: { id: string; text: string }[] } | null>(null);
  const [goalMissing, setGoalMissing] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalExpanded, setGoalExpanded] = useState(true);
  const [copied, setCopied] = useState<'adjust' | 'create' | null>(null);

  async function handleCopy(text: string, kind: 'adjust' | 'create') {
    await copyText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500);
  }

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
    <section className="mb-4 rounded-xl border border-ldvh-border bg-ldvh-panel p-4">
      {/* 区头：可点击折叠 + 图标 + 标题 + 右侧复制按钮 */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={goalExpanded}
        aria-controls="cognition-goal-content"
        onClick={() => setGoalExpanded((expanded) => !expanded)}
        onKeyDown={(event) => toggleOnKeyboard(event, () => setGoalExpanded((expanded) => !expanded))}
        className={`-mx-1 flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 transition-colors hover:bg-ldvh-bg/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50 ${goalExpanded ? 'mb-4' : ''}`}
      >
        <Target size={16} className="shrink-0 text-ldvh-accent" aria-hidden="true" />
        <h3 className="ldvh-section-title min-w-0">{t('focusV2.goalTitle')}</h3>
        <span className="ml-auto flex min-w-0 shrink-0 items-center">
          <button
            type="button"
            aria-expanded={goalExpanded}
            aria-controls="cognition-goal-content"
            onClick={(event) => {
              event.stopPropagation();
              setGoalExpanded((expanded) => !expanded);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ldvh-text-secondary transition-colors hover:bg-ldvh-bg hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50"
            title={t(goalExpanded ? 'focusV2.collapseSection' : 'focusV2.expandSection')}
          >
            {goalExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            <span className="sr-only">{t(goalExpanded ? 'focusV2.collapseSection' : 'focusV2.expandSection')}</span>
          </button>
        </span>
      </div>

      {/* 目标卡 + 子目标列表：仅在展开时渲染 */}
      {goalExpanded && (
        <div id="cognition-goal-content">
          <div className="min-w-0 rounded-md border border-ldvh-border/45 bg-ldvh-bg/40 px-3 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="ldvh-card-title min-w-0 font-semibold">
                {goalError ? t('focusV2.goalMissing') : goal ? goal.title : '…'}
              </span>
            </div>
            {goalMissing && (
              <button
                type="button"
                onClick={() => void handleCopy(t('focusV2.promptSetGoal'), 'create')}
                className="mt-2 block w-full rounded-md text-left transition-colors hover:bg-ldvh-bg/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
                title={t('focusV2.promptSetGoal')}
              >
                <span className="ldvh-caption block text-ldvh-text-secondary/80">{t('focusV2.hintCreateGoal')}</span>
                <span className="mt-0.5 block text-[11px] text-ldvh-text-secondary/50">
                  {copied === 'create' ? t('focusV2.btnCopied') : t('focusV2.hintCreateExample')}
                </span>
              </button>
            )}
            {goalError && <p className="mt-1 text-xs text-red-400">{goalError}</p>}
            {goal?.statement && (
              <p className="mt-2 text-sm leading-relaxed text-ldvh-text-secondary">{goal.statement}</p>
            )}
          </div>

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
        </div>
      )}
    </section>
  );
}
