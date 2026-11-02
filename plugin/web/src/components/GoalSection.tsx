/**
 * 目标区（Goal Section）——聚焦页的第一个模块。
 *
 * 承载 Goal(25) 真实投影：目标陈述 + 子目标列表（28 号对象，按 `parent_goal`
 * 反查派生——不在 goal.md 内存副本，28 §8.1）。
 * 样式与交互对齐原聚焦页其它模块（ldvh-panel/ldvh-border + 区头 ldvh-section-title
 * + 可点击折叠 + 列表 divide-y），带复制提示词按钮（一句话触发 AI 对话——方法论由
 * 30 号行动模板承载，提示词只是触发器）。
 *
 * 只读、无写入口；本区仅是目标的可视投影，不构成第二事实源（00 §3.3）。
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchCognitionGoal, ApiRequestError, type ServingWorkItem } from '@/utils/api';
import { useI18n } from '@/i18n/context';
import { copyText } from '@/utils/clipboard';
import { LDVH_ERROR_TEXT_CLASS } from '@/utils/semanticColors';
import ServingSparkProgressBar from '@/components/ServingSparkProgressBar';

/** 区头键盘可达的展开/收起（与原聚焦页 CognitionCenter 区头一致的交互）。 */
function toggleOnKeyboard(event: KeyboardEvent<HTMLDivElement>, toggle: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggle();
}

export default function GoalSection() {
  const { t } = useI18n();
  const navigate = useNavigate();
  // Sub-goals are SubGoal OBJECTS now (28), not lines in goal.md: the projection
  // carries identity (`object_uid`), lifecycle (`status`) and the criterion kind,
  // so the list can show where each sub-goal stands without a drill-down. Rows
  // still recovered from the migrated-away section are flagged `legacy` so they
  // never read as a second authority (28 §14.2).
  const [goal, setGoal] = useState<{
    title: string;
    status: string;
    statement: string;
    sub_goals: {
      id: string;
      text: string;
      status?: string;
      criterion_kind?: string;
      object_uid?: string;
      /** 28 §8：可选显示次序（缺失合法，不承担身份）。 */
      order?: number;
      /** 名下工作行（`serves` 反查，28 §8.1 派生）——本行的火花落实比值取它。 */
      serving_work?: ServingWorkItem[];
      /** 反查时读不到的类型；「读不到」不得并入空集（00 §5.6）。 */
      serving_unreadable?: string[];
      legacy?: boolean;
    }[];
  } | null>(null);
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
      {/* 区头：可点击折叠 + 图标底托 + 标题（可点进详情页）+ 右侧折叠按钮。

          **2026-11-02（Human 定案）**：区头右侧那枚 `Maximize2` 详情图标**撤除**，
          详情入口改由**标题本身**承担——标题是「目标」这个词，读者想看目标的完整
          详情时，视线本来就在标题上；而一枚 14px 的图标按钮是「另一个入口」，
          需要额外的图标语义学习成本，且它与旁边的折叠箭头长得像（两枚同为
          `ldvh-icon-button`），容易读错。

          撤除它之后 **`/goal` 路由不能变成死页**：`navigate('/goal')` 全仓原本只有
          这一处调用，侧栏 `NAV_ITEMS` / `FEDERATION_NAV_ITEMS` 都没有 /goal 项。
          故标题改为可点（`goal` 存在时才可点——没有目标时没有详情可进），并且
          标题的 hover/focus 状态给出与其它可点区头一致的反馈。

          **区头视觉层次（2026-11-02「设计得好看一点」）**：图标从裸图标改为
          **底托**（`h-7 w-7` 圆角方框 + accent 描边与浅底，与 Help 页的说明块
          同一范式），标题右侧补一行**副标题**说明这个区是什么（目标陈述 +
          子目标），并在标题后给出**子目标条数**（`ldvh-meta`，与 Spark 池健康
          区头的计数同一规格）。三处都不引入新的信息——只是让「目标 / 副标题 /
          计数 / 折叠」四层在一条行里各自站得住。
      */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={goalExpanded}
        aria-controls="cognition-goal-content"
        onClick={() => setGoalExpanded((expanded) => !expanded)}
        onKeyDown={(event) => toggleOnKeyboard(event, () => setGoalExpanded((expanded) => !expanded))}
        className={`-mx-1 flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-md px-1 transition-colors hover:bg-ldvh-bg/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50 ${goalExpanded ? 'mb-4' : ''}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ldvh-accent/25 bg-ldvh-accent/10 text-ldvh-accent">
          <Target size={14} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <h3 className="ldvh-section-title min-w-0 truncate">
              <span
                role="link"
                tabIndex={goal ? 0 : -1}
                onClick={(event) => {
                  // 标题是详情入口；区头整行的点击是折叠，二者不同义——不让冒泡
                  // 把「进详情」折叠成「收起」。
                  event.stopPropagation();
                  if (!goal) return;
                  navigate('/goal');
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (!goal) return;
                  navigate('/goal');
                }}
                className={`rounded-sm transition-colors ${goal ? 'cursor-pointer hover:text-ldvh-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ldvh-accent/50' : ''}`}
                title={goal ? t('goalDetail.openDetail') : undefined}
              >
                {t('focusV2.goalTitle')}
              </span>
            </h3>
            {goal && (
              <span className="ldvh-meta shrink-0 text-ldvh-text-secondary/70">{goal.sub_goals.length}</span>
            )}
          </span>
          <span className="ldvh-caption min-w-0 truncate text-ldvh-text-secondary/70">{t('focusV2.goalSectionHint')}</span>
        </span>
        <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
          <button
            type="button"
            aria-expanded={goalExpanded}
            aria-controls="cognition-goal-content"
            onClick={(event) => {
              event.stopPropagation();
              setGoalExpanded((expanded) => !expanded);
            }}
            className="ldvh-icon-button"
            title={t(goalExpanded ? 'focusV2.collapseSection' : 'focusV2.expandSection')}
          >
            {goalExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            <span className="sr-only">{t(goalExpanded ? 'focusV2.collapseSection' : 'focusV2.expandSection')}</span>
          </button>
        </span>
      </div>

      {/* 目标内容 + 子目标列表：仅在展开时渲染（无标题，区块内直接是目标内容） */}
      {goalExpanded && (
        <div id="cognition-goal-content">
          {goalMissing && (
              <button
                type="button"
                onClick={() => void handleCopy(t('focusV2.promptSetGoal'), 'create')}
                className="mt-2 block w-full rounded-md text-left transition-colors hover:bg-ldvh-bg/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ldvh-accent/50"
                title={t('focusV2.promptSetGoal')}
              >
                <span className="ldvh-caption block text-ldvh-text-secondary/80">{t('focusV2.hintCreateGoal')}</span>
                <span className="ldvh-caption mt-0.5 block text-ldvh-text-secondary/50">
                  {copied === 'create' ? t('focusV2.btnCopied') : t('focusV2.hintCreateExample')}
                </span>
              </button>
            )}
            {goalError && <p className={`ldvh-caption mt-1 ${LDVH_ERROR_TEXT_CLASS}`}>{goalError}</p>}
            {goal?.statement && (
              <div className="rounded-md border border-ldvh-border/20 bg-ldvh-bg/20 px-2.5 py-2">
                <p className="ldvh-body text-ldvh-text-primary">{goal.statement}</p>
              </div>
            )}

          {goal && goal.sub_goals.length > 0 && (
            <div className="mt-3">
              <ul className="divide-y divide-ldvh-border/70">
                {goal.sub_goals.map((sg) => (
                  <li
                    key={sg.id}
                    // 28 号 §1 的 V1（从目标下钻到子目标、再下钻到名下工作）：
                    // 有 object_uid 的行可点进对象详情；legacy 行（旧段遗留、
                    // 尚无对象）不可点——它没有可下钻的详情页。
                    className={`min-w-0 py-2 ${sg.object_uid ? 'cursor-pointer rounded-md transition-colors hover:bg-ldvh-bg/60' : ''}`}
                    // 详情路由的 id 段是带类型前缀的 `subgoal-<uid>`（与列表页
                    // `obj.id` 同形，同 workcase 惯例）——只给裸 uid 会 404。
                    onClick={sg.object_uid
                      ? () => navigate(`/objects/subgoal/subgoal-${sg.object_uid}`)
                      : undefined}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {/* 显示次序，不是身份：`sg.id` 是 `object_uid`（28 §7 废止 SG-n
                          后它就是身份），把它渲染成 chip 会让目标区出现四串十六进制。
                          `order` 缺失是合法状态（§8），此时回落序号型空位而不是 uid。 */}
                      <span className="ldvh-chip ldvh-chip-sm shrink-0 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent">
                        {typeof sg.order === 'number' ? sg.order : '·'}
                      </span>
                      <span className="ldvh-caption min-w-0 flex-1">{sg.text}</span>
                      {/* 28 §9 状态 + §10.2 判据类型：让「走到哪里算成」在列表层就可读，
                          而不必逐条下钻。状态缺失（存量 legacy 行）时不渲染空 chip。 */}
                      {sg.status && sg.status !== 'active' && (
                        <span
                          className={`ldvh-chip ldvh-chip-sm shrink-0 ${
                            sg.status === 'achieved'
                              ? 'border-ldvh-accent/40 bg-ldvh-accent/10 text-ldvh-accent'
                              : 'border-ldvh-border bg-transparent text-ldvh-text-secondary'
                          }`}
                          title={sg.criterion_kind ? `${t('goalDetail.subGoals')} · ${sg.criterion_kind}` : undefined}
                        >
                          {sg.status}
                        </span>
                      )}
                      {/* 迁移中的旧段行：显式标出，不与会话中的对象行混为一谈（25 §7 / 28 §14.2）。 */}
                      {sg.legacy && (
                        <span
                          className="ldvh-chip ldvh-chip-sm shrink-0 border-ldvh-border bg-transparent text-ldvh-text-secondary"
                          title={t('goalDetail.subGoalLegacy')}
                        >
                          legacy
                        </span>
                      )}
                    </div>
                    {/* 火花落实比值（Human 定案 2026-11-02「目标块的 sg 都要附带进度条」）：
                        条用固定宽度、分数落在条尾旁边——四条子目标在同一把尺子上才可比。
                        口径与卡片、详情面**同一实现**（ServingSparkProgressBar），不另算。

                        legacy 行不给比值：它没有 object_uid，也就没有可反查的身份；
                        给它画一条空条等于把「还没有对象」说成「没有火花」。 */}
                    {sg.object_uid && (
                      <div className="mt-1.5 pl-7">
                        <ServingSparkProgressBar
                          rows={sg.serving_work ?? []}
                          unreadable={sg.serving_unreadable}
                          progressLabel={t('objectList.subGoalSparkProgress')}
                          emptyLabel={t('objectList.subGoalSparkProgressEmpty')}
                          allDiscardedLabel={t('objectList.subGoalSparkProgressAllDiscarded')}
                          unavailableLabel={t('objectList.subGoalSparkProgressUnavailable')}
                          unknownStatusLabel={(count) => t('objectList.subGoalSparkProgressUnknown', { count: String(count) })}
                          openLabel={t('objectList.subGoalSparkProgressOpen')}
                          implementedLabel={t('objectList.subGoalSparkProgressImplemented')}
                          variant="inline"
                          inlineLabels={{
                            empty: t('focusV2.subGoalProgressEmpty'),
                            allDiscarded: t('focusV2.subGoalProgressAllDiscarded'),
                            unavailable: t('focusV2.subGoalProgressUnavailable'),
                            emptyTitle: t('objectList.subGoalSparkProgressEmpty'),
                            allDiscardedTitle: t('objectList.subGoalSparkProgressAllDiscarded'),
                            unavailableTitle: t('objectList.subGoalSparkProgressUnavailable'),
                          }}
                        />
                      </div>
                    )}
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
