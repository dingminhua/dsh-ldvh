/**
 * 帮助页（Help）——LDVH Web 的静态引导页。
 *
 * 当前承载「Vibe 开发步骤」流程说明：与 AI 沟通设立项目目标 → 围绕目标展开
 * 调研 → 使用讨论模块讨论得出分解目标 → 再次调研分解目标 → 讨论出可行动的
 * WorkCase → 进入执行阶段 → 过程中想法记录到 Spark。
 *
 * 版式：主题横幅（渐变 hero）→ 图标轨步骤列表（编号徽标 + 虚线连接）→ 循环
 * 提示卡。纯静态、只读、无数据请求；所有可见文案走 i18n（docs/01 §1.3）。
 * 流程为 Human 提供的描述性引导，不构成第二事实源（00 §3.3）。
 */
import type { ElementType } from 'react';
import {
  ClipboardList,
  Lightbulb,
  MessagesSquare,
  RefreshCw,
  Repeat,
  Rocket,
  Search,
  Sparkles,
  Target,
  Workflow,
  type LucideProps,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { useI18n } from '@/i18n/context';
import type { LocaleKey } from '@/i18n/locales';

type StepIcon = ElementType<LucideProps>;

/** Vibe 开发步骤的图标映射（组件引用，与文案解耦；顺序即步骤顺序）。 */
const STEP_ICONS: StepIcon[] = [Target, Search, MessagesSquare, Repeat, ClipboardList, Rocket, Lightbulb];

function stepKey(index: number, suffix: 'title' | 'body'): LocaleKey {
  return `help.step.${index + 1}.${suffix}` as LocaleKey;
}

export default function Help() {
  const { t } = useI18n();
  const stepCount = STEP_ICONS.length;

  return (
    <div className="ldvh-page-frame">
      <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} />

      {/* 主题横幅：Vibe 开发步骤的循环流程概览 */}
      <div className="relative mb-5 overflow-hidden rounded-xl border border-ldvh-accent/20 bg-gradient-to-br from-ldvh-accent/12 via-ldvh-accent/5 to-transparent px-4 py-5 sm:px-5">
        {/* 装饰光晕 */}
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-ldvh-accent/10 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -left-8 h-36 w-36 rounded-full bg-ldvh-accent/5 blur-2xl" />

        <div className="relative flex flex-col gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ldvh-accent/25 bg-ldvh-panel/70 text-ldvh-accent shadow-sm shadow-black/5">
              <Workflow size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="ldvh-section-title">{t('help.vibeSteps.title')}</h2>
              <p className="ldvh-caption-strong mt-0.5 text-ldvh-accent">{t('help.vibeSteps.tagline')}</p>
            </div>
          </div>
          <p className="ldvh-body-muted max-w-2xl">{t('help.vibeSteps.subtitle')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ldvh-chip-sm shrink-0 border-ldvh-accent/25 bg-ldvh-accent/10 text-ldvh-accent">
              {t('help.vibeSteps.steps', { count: String(stepCount) })}
            </span>
            <span className="ldvh-chip-sm shrink-0 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent">
              {t('help.vibeSteps.loopChip')}
            </span>
          </div>
        </div>
      </div>

      {/* 步骤列表：图标轨 + 编号徽标 + 虚线连接 */}
      <section className="rounded-xl border border-ldvh-border bg-ldvh-panel p-4 sm:p-5">
        <ol className="flex flex-col">
          {STEP_ICONS.map((Icon, index) => {
            const isLast = index === STEP_ICONS.length - 1;
            return (
              <li key={index} className="flex min-w-0 gap-3 sm:gap-4">
                <div className="flex flex-col items-center">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ldvh-accent/25 bg-ldvh-accent/10 text-ldvh-accent">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  {!isLast && <span className="my-1.5 w-px flex-1 border-l border-dashed border-ldvh-border/80" aria-hidden="true" />}
                </div>
                <div className="min-w-0 flex-1 pb-6 last:pb-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 pt-0.5">
                    <span className="ldvh-chip-sm shrink-0 border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent">
                      {index + 1}
                    </span>
                    <h3 className="ldvh-card-title-prominent min-w-0">{t(stepKey(index, 'title'))}</h3>
                  </div>
                  <p className="ldvh-body-muted mt-1.5 max-w-[52rem]">{t(stepKey(index, 'body'))}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Spark 承载说明：对话中未能收敛的想法记录为 Spark，新对话可从某个 Spark 开始 */}
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-ldvh-border bg-ldvh-panel px-3.5 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ldvh-accent/25 bg-ldvh-accent/10 text-ldvh-accent">
          <Sparkles size={14} aria-hidden="true" />
        </span>
        <p className="ldvh-body-muted">{t('help.sparkNote')}</p>
      </div>

      {/* 循环提示：流程可迭代，执行中沉淀的 Spark 可再次进入调研与讨论 */}
      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-ldvh-accent/25 bg-ldvh-accent/5 px-3.5 py-3">
        <RefreshCw size={15} className="mt-0.5 shrink-0 text-ldvh-accent" aria-hidden="true" />
        <p className="ldvh-caption text-ldvh-text-secondary">{t('help.vibeSteps.loopHint')}</p>
      </div>
    </div>
  );
}
