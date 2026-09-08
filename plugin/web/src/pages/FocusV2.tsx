/**
 * 聚焦 v2 · 蓝图首页（测试页 / dev 载体）。
 *
 * 目的：在保留原「聚焦」(CognitionCenter) 之上的提案预览，让 Human 对照与修复。
 * 结构自上而下：
 *   1. 顶部新增「长期意图区」——Goal(25) 真实投影（fetchCognitionGoal 读 goal.md）
 *      + Initiative(26) mock 占位（initiatives/ 目录尚未存在，spec26 未落地对象）。
 *   2. 下方原样嵌入 <CognitionCenter />，其内实现一行不改（含自身数据获取与五模块）。
 *
 * 只读、无写入口；蓝图区仅是目标/专项的可视投影，不构成第二事实源（00 §3.3）。
 * 本页为讨论载体（docs/blueprint-web-presentation-discussion.md），未裁决为正式首页。
 */
import { useEffect, useState } from 'react';
import { FlaskConical, Target, Layers, ChevronRight } from 'lucide-react';
import CognitionCenter from '@/pages/CognitionCenter';
import { fetchCognitionGoal, ApiRequestError } from '@/utils/api';
import { useI18n } from '@/i18n/context';

/** 单例冻结锚的项目级内聚色（与类型色分离，仅供本预览页作语义标记，不进入 CATEGORY_COLORS）。 */
const GOAL_TINT = 'rgb(20 184 166)';
const INIT_TINT = 'rgb(249 115 22)';

/** mock Initiative 占位：spec26 类型已定但 initiatives/ 目录尚未创建任何对象。
 *  这些仅用于预览版面，非事实源、非 AI 断言，须在真实 Initiative 落地后移除。 */
const MOCK_INITIATIVES = {
  current: [
    { id: 'I-01', name: '蓝图首页 Web 呈现', serves: 'SG-3', state: 'progressing' },
    { id: 'I-02', name: '调研系统实现里程碑', serves: 'SG-2', state: 'progressing' },
  ],
  next: [
    { id: 'I-03', name: 'Initiative 进对象系统', serves: 'SG-3', state: 'pending', dep: '依赖 I-02' },
    { id: 'I-04', name: 'spec10 蓝图投影章节', serves: 'SG-3', state: 'pending', dep: '依赖 I-03' },
  ],
  done: [
    { id: 'I-05', name: '工作模型重构', serves: 'SG-1', state: 'done' },
    { id: 'I-06', name: 'Research 类型落地', serves: 'SG-2', state: 'done' },
  ],
  open: [
    { id: 'Q1', name: 'D1 长期意图区版面位置', state: 'open' },
    { id: 'Q2', name: 'spec10 蓝图受保护与否', state: 'open' },
  ],
} as const;

export default function FocusV2() {
  const { t } = useI18n();
  const [goal, setGoal] = useState<{ title: string; status: string; sub_goals: { id: string; text: string }[] } | null>(null);
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

      {/* ============ 顶部长期意图区（提案新增） ============ */}
      <section className="mb-5 overflow-hidden rounded-xl border border-teal-400/25 bg-gradient-to-br from-[#0e1f24] via-ldvh-panel to-[#111a2e] p-4 dark:border-teal-400/25">
        <div className="mb-3 flex items-center gap-2">
          <Target size={14} style={{ color: GOAL_TINT }} aria-hidden="true" />
          <span className="ldvh-section-title" style={{ color: GOAL_TINT }}>{t('focusV2.blueprint')}</span>
          <span className="ml-auto hidden font-mono text-[11px] text-ldvh-text-secondary/70 sm:inline">{t('focusV2.blueprintNote')}</span>
        </div>

        {/* Goal 卡 */}
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
          {goalMissing && <p className="mt-1 text-xs text-ldvh-text-secondary">{t('focusV2.goalMissing')}</p>}
          {goalError && <p className="mt-1 text-xs text-red-400">{goalError}</p>}
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

        {/* Initiative 四栏（mock 占位） */}
        <div className="ldvh-section-grid mt-3">
          {[
            { title: t('focusV2.currentInit'), items: MOCK_INITIATIVES.current, tint: INIT_TINT },
            { title: t('focusV2.nextSteps'), items: MOCK_INITIATIVES.next, tint: '#7aa7ff' },
            { title: t('focusV2.completed'), items: MOCK_INITIATIVES.done, tint: '#a8b3cc' },
            { title: t('focusV2.openQuestions'), items: MOCK_INITIATIVES.open, tint: '#eab308' },
          ].map((col) => (
            <div key={col.title} className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ldvh-text-secondary">
                {col.title}
              </div>
              <div className="divide-y divide-ldvh-border/60">
                {col.items.map((item) => (
                  <div key={item.id} className="flex min-w-0 items-center gap-2 py-1.5 text-sm">
                    <span className="shrink-0 text-[11px]" style={{ color: col.tint }}>{item.id}</span>
                    <span className="min-w-0 flex-1 truncate text-ldvh-text-primary">{item.name}</span>
                    <ChevronRight size={12} className="shrink-0 text-ldvh-text-secondary/50" aria-hidden="true" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ldvh-text-secondary/80">{t('focusV2.mockNote')}</p>
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
