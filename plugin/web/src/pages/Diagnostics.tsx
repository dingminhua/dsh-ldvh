/**
 * 运行时诊断页（`/diagnostics`）。
 *
 * 这不是事实源页面，也不参与 LDVH 的业务裁决。它只回答一类问题：**机制本身在
 * 实际使用中哪里在失效、失效成什么形态**——这类信息此前不在任何载体里，因此
 * 「哪条规则最常拦人」「哪个工具一直在坏」从来没被回答过。
 *
 * 两页数据来源不同，页面必须把它们分开呈现，不能混成一个「健康度」：
 * - 写入关卡：宿主会话日志里的 LDVH 工具调用实况（跨出 LDVH 载体的读取）；
 * - 闲时辅助：`~/.dsh/ldvh/` 下插件自己落的队列与运行记录。
 *
 * 只读：本页不发任何写请求，也不提供操作按钮。
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { useI18n } from '@/i18n/context';
import {
  fetchCleanupPreview,
  fetchFrictionObservationReport,
  fetchExperienceBufferReport,
  fetchGateReport,
  fetchIdleReport,
  runCleanup,
  type CleanupPlan,
  type FrictionObservationReport,
  type ExperienceBufferReport,
  type GateReport,
  type IdleReport,
} from '@/utils/api';
import { LDVH_ERROR_TEXT_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';
import type { LocaleKey } from '@/i18n/locales';

type Tab = 'gate' | 'idle' | 'observations' | 'cleanup';

/** 与 i18n context 的 `t` 同签名（可带插值参数）。 */
type Translation = (key: LocaleKey, params?: Record<string, string>) => string;

/** 失败类别的显示名走 i18n；未知类别如实回落为原值，不假装认识它。 */
const CATEGORY_LABEL_KEYS = {
  missing_arguments: 'diagnostics.category.missingArguments',
  audit_summary_shape: 'diagnostics.category.auditSummaryShape',
  carrier_validation: 'diagnostics.category.carrierValidation',
  object_not_found: 'diagnostics.category.objectNotFound',
  shape_and_concurrency: 'diagnostics.category.shapeAndConcurrency',
  other: 'diagnostics.category.other',
  subagent_stopped: 'diagnostics.category.subagentStopped',
  observation_gap: 'diagnostics.category.observationGap',
  quote_not_in_window: 'diagnostics.category.quoteNotInWindow',
  quote_too_short: 'diagnostics.category.quoteTooShort',
  carrier_ineffective: 'diagnostics.category.carrierIneffective',
  title_too_long: 'diagnostics.category.titleTooLong',
  dispatch_unavailable: 'diagnostics.category.dispatchUnavailable',
} as const satisfies Record<string, LocaleKey>;

const FAILURE_STATUS_LABEL_KEYS = {
  rejected: 'diagnostics.status.rejected',
  invalid_request: 'diagnostics.status.invalidRequest',
  completed: 'diagnostics.status.completed',
  unknown: 'diagnostics.status.unknown',
} as const satisfies Record<string, LocaleKey>;

function categoryLabel(t: Translation, category: string): string {
  const key = (CATEGORY_LABEL_KEYS as Record<string, LocaleKey | undefined>)[category];
  return key ? t(key) : category;
}

function statusLabel(t: Translation, status: string): string {
  const key = (FAILURE_STATUS_LABEL_KEYS as Record<string, LocaleKey | undefined>)[status];
  return key ? t(key) : status;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '—';
  const date = new Date(parsed);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 占比条：只表达分布，不做「健康/不健康」判断——阈值不在这页定义。 */
function ShareBar({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ldvh-border">
      <div className="h-full rounded-full bg-ldvh-accent" style={{ width: `${percent}%` }} />
    </div>
  );
}

function MetricCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'error' | 'warning' }) {
  const toneClass = tone === 'error' ? LDVH_ERROR_TEXT_CLASS : tone === 'warning' ? LDVH_WARN_TITLE_CLASS : 'text-ldvh-text-primary';
  return (
    <div className="min-w-0 rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
      <p className="ldvh-meta-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="ldvh-meta-muted mt-1">{hint}</p>}
    </div>
  );
}

/** 数据边界声明：页面存在的意义就是区分「没看到」与「没有」，所以这段必须常驻。 */
function ScopeNotice({ limits }: { limits: string[] }) {
  if (limits.length === 0) return null;
  return (
    <div className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${LDVH_WARN_TITLE_CLASS}`} />
        <div className="min-w-0">
          <p className="ldvh-meta font-medium text-ldvh-text-primary">scope</p>
          <ul className="mt-1 space-y-1">
            {limits.map((limit) => (
              <li key={limit} className="ldvh-meta-muted">{limit}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function GatePanel({ report, t }: { report: GateReport; t: Translation }) {
  const failureRate = report.totals.calls > 0 ? Math.round((report.totals.failed / report.totals.calls) * 100) : 0;
  const worstTool = report.byTool.find((row) => row.failed > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="ldvh-metric-grid">
        <MetricCard label={t('diagnostics.gate.calls')} value={String(report.totals.calls)} />
        <MetricCard
          label={t('diagnostics.gate.failed')}
          value={String(report.totals.failed)}
          hint={t('diagnostics.gate.failureRate', { rate: String(failureRate) })}
          tone={report.totals.failed > 0 ? 'error' : undefined}
        />
        <MetricCard
          label={t('diagnostics.gate.worstTool')}
          value={worstTool ? worstTool.tool : '—'}
          hint={worstTool ? `${worstTool.failed}/${worstTool.calls}` : undefined}
          tone="warning"
        />
        <MetricCard label={t('diagnostics.gate.sessions')} value={String(report.scope.sessionsScanned ?? 0)} />
      </div>

      <ScopeNotice limits={report.scope.limits ?? []} />

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.gate.byCategory')}</h2>
        <div className="mt-3 flex flex-col gap-2">
          {report.byCategory.length === 0 ? (
            <p className="ldvh-body-muted">{t('diagnostics.gate.empty')}</p>
          ) : report.byCategory.map((row) => (
            <div key={row.category} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2">
              <span className="ldvh-meta truncate text-ldvh-text-primary">{categoryLabel(t, row.category)}</span>
              <ShareBar value={row.count} total={report.totals.failed} />
              <span className="ldvh-meta font-mono text-right text-ldvh-text-secondary">{row.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.gate.byTool')}</h2>
        <table className="mt-2 w-full table-fixed text-left">
          <thead>
            <tr className="ldvh-meta-muted border-b border-ldvh-border">
              <th className="w-[55%] py-1 font-normal">{t('diagnostics.gate.toolColumn')}</th>
              <th className="w-[20%] py-1 text-right font-normal">{t('diagnostics.gate.calls')}</th>
              <th className="w-[25%] py-1 text-right font-normal">{t('diagnostics.gate.failed')}</th>
            </tr>
          </thead>
          <tbody>
            {report.byTool.map((row) => (
              <tr key={row.tool} className="border-b border-ldvh-border/50 last:border-0">
                <td className="font-mono truncate py-1.5 text-[12px] text-ldvh-text-primary">{row.tool}</td>
                <td className="font-mono py-1.5 text-right text-[12px] text-ldvh-text-secondary">{row.calls}</td>
                <td className={`font-mono py-1.5 text-right text-[12px] ${row.failed > 0 ? LDVH_ERROR_TEXT_CLASS : 'text-ldvh-text-secondary'}`}>
                  {row.failed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.gate.recentFailures')}</h2>
        <div className="mt-2 flex flex-col">
          {report.recentFailures.length === 0 ? (
            <p className="ldvh-body-muted py-2">{t('diagnostics.gate.empty')}</p>
          ) : report.recentFailures.map((row, index) => (
            <details key={`${row.at ?? 'na'}-${row.tool}-${index}`} className="border-b border-ldvh-border/50 py-1.5 last:border-0">
              <summary className="flex cursor-pointer list-none items-center gap-2">
                <ChevronRight size={12} className="shrink-0 text-ldvh-text-secondary" />
                <span className="font-mono w-[5.5rem] shrink-0 text-[11px] text-ldvh-text-secondary">{formatTime(row.at)}</span>
                <span className="font-mono min-w-0 flex-1 truncate text-[12px] text-ldvh-text-primary">{row.tool}</span>
                <span className={`ldvh-chip-sm shrink-0 ${LDVH_ERROR_TEXT_CLASS}`}>{statusLabel(t, row.status)}</span>
              </summary>
              <pre className="font-mono mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-ldvh-bg p-2 text-[11px] text-ldvh-text-secondary">
                {row.detail || '—'}
              </pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function IdlePanel({ report, t }: { report: IdleReport; t: Translation }) {
  const stopped = report.runs.byStage.find((row) => row.stage === 'stopped');
  return (
    <div className="flex flex-col gap-4">
      <div className="ldvh-metric-grid">
        <MetricCard
          label={t('diagnostics.idle.unresolved')}
          value={String(report.queue.unresolved)}
          hint={t('diagnostics.idle.total', { count: String(report.queue.total) })}
          tone="warning"
        />
        <MetricCard label={t('diagnostics.idle.over24h')} value={String(report.queue.over24h)} tone="error" />
        <MetricCard label={t('diagnostics.idle.runs')} value={String(report.runs.total)} />
        <MetricCard
          label={t('diagnostics.idle.stopped')}
          value={String(stopped?.count ?? 0)}
          hint={stopped ? t('diagnostics.idle.stoppedHint') : undefined}
        />
      </div>

      <ScopeNotice limits={report.scope.limits ?? []} />

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.idle.byCategory')}</h2>
        <div className="mt-3 flex flex-col gap-2">
          {report.queue.byCategory.length === 0 ? (
            <p className="ldvh-body-muted">{t('diagnostics.idle.empty')}</p>
          ) : report.queue.byCategory.map((row) => (
            <div key={row.category} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2">
              <span className="ldvh-meta truncate text-ldvh-text-primary">{categoryLabel(t, row.category)}</span>
              <ShareBar value={row.count} total={report.queue.unresolved} />
              <span className="font-mono text-right text-[12px] text-ldvh-text-secondary">{row.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.idle.recentRuns')}</h2>
        <div className="mt-2 flex flex-col">
          {report.runs.recent.length === 0 ? (
            <p className="ldvh-body-muted py-2">{t('diagnostics.idle.empty')}</p>
          ) : report.runs.recent.map((run, index) => (
            <div key={`${run.at ?? 'na'}-${index}`} className="flex items-center gap-2 border-b border-ldvh-border/50 py-1.5 last:border-0">
              <span className="font-mono w-[5.5rem] shrink-0 text-[11px] text-ldvh-text-secondary">{formatTime(run.at)}</span>
              <span className={`ldvh-chip-sm shrink-0 ${run.stage === 'stopped' ? LDVH_ERROR_TEXT_CLASS : ''}`}>{run.stage}</span>
              <span className="ldvh-meta min-w-0 flex-1 truncate text-ldvh-text-secondary">{run.task ?? run.code ?? '—'}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.idle.queueRecent')}</h2>
        <div className="mt-2 flex flex-col">
          {report.queue.recent.length === 0 ? (
            <p className="ldvh-body-muted py-2">{t('diagnostics.idle.empty')}</p>
          ) : report.queue.recent.map((entry, index) => (
            <details key={`${entry.at ?? 'na'}-${index}`} className="border-b border-ldvh-border/50 py-1.5 last:border-0">
              <summary className="flex cursor-pointer list-none items-center gap-2">
                <ChevronRight size={12} className="shrink-0 text-ldvh-text-secondary" />
                <span className="font-mono w-[5.5rem] shrink-0 text-[11px] text-ldvh-text-secondary">{formatTime(entry.at)}</span>
                <span className="ldvh-chip-sm shrink-0">{categoryLabel(t, entry.category ?? 'other')}</span>
                <span className="ldvh-meta min-w-0 flex-1 truncate text-ldvh-text-secondary">{entry.task ?? '—'}</span>
              </summary>
              <pre className="font-mono mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-ldvh-bg p-2 text-[11px] text-ldvh-text-secondary">
                {entry.reason || '—'}
              </pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * 摩擦观察缓冲面板（11 §12bis.1）。
 *
 * ## 这里为什么没有「点进去看详情」
 *
 * 缓冲条目**不是事实对象**——没有对象身份、不在事实源里。故本面板刻意不提供
 * 任何进入详情页的入口：给了入口就等于暗示「它是一个对象」。这与「诊断页只读」
 * 是同一条纪律的两个面。
 *
 * ## 为什么只显示四项
 *
 * 11 §12bis.1 第 2 条（Human 决定 2026-10）明写只可呈现现象/时间/来源/状态，
 * 不得呈现 `evidence` 全文。本面板严格遵守——不是信息缺失，是规范边界。
 */
function ObservationPanel({ report, t }: { report: FrictionObservationReport; t: Translation }) {
  const ready = report.groups.filter((group) => group.promotionReady).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="ldvh-metric-grid">
        <MetricCard
          label={t('diagnostics.observations.entries')}
          value={String(report.totals.entries)}
          hint={t('diagnostics.observations.projects', { count: String(report.totals.projects) })}
        />
        <MetricCard
          label={t('diagnostics.observations.groups')}
          value={String(report.groups.length)}
          hint={t('diagnostics.observations.threshold', { n: String(report.scope.threshold) })}
        />
        <MetricCard
          label={t('diagnostics.observations.ready')}
          value={String(ready)}
          tone={ready > 0 ? 'warning' : undefined}
        />
        <MetricCard
          label={t('diagnostics.observations.pending')}
          value={String(report.totals.byStatus.find((row) => row.status === 'pending')?.count ?? 0)}
        />
      </div>

      <ScopeNotice limits={report.scope.limits ?? []} />

      {/* 目录不存在是**正常初态**（还没有任何观察落地），须说清楚，否则读者会
          以为功能坏了。这与「读失败」必须区分开。 */}
      {!report.scope.bufferDirExists ? (
        <div className="rounded-lg border border-dashed border-ldvh-border bg-ldvh-panel px-4 py-6 text-center">
          <p className="ldvh-body-muted">{t('diagnostics.observations.noBufferDir')}</p>
          <p className="ldvh-meta mt-1 font-mono text-ldvh-text-secondary">{report.scope.bufferDir}</p>
          <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.observations.noBufferDirHint')}</p>
        </div>
      ) : null}

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.observations.groupsTitle')}</h2>
        <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.observations.groupsHint')}</p>
        <div className="mt-3 flex flex-col gap-2">
          {report.groups.length === 0 ? (
            <p className="ldvh-body-muted">{t('diagnostics.observations.empty')}</p>
          ) : report.groups.map((group) => (
            <div
              key={group.group}
              className="grid grid-cols-[minmax(0,1fr)_5.5rem_5rem] items-center gap-2 border-b border-ldvh-border/40 pb-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="ldvh-meta truncate text-ldvh-text-primary">
                  {group.latestPhenomenon ?? group.group}
                </p>
                <p className="ldvh-meta truncate font-mono text-[11px] text-ldvh-text-secondary">
                  {group.group}
                  {group.lastAt ? ` · ${group.lastAt}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <ShareBar value={group.pendingCount} total={report.scope.threshold} />
                <span className="font-mono text-[12px] text-ldvh-text-secondary">
                  {group.pendingCount}/{report.scope.threshold}
                </span>
              </div>
              <div className="text-right">
                {group.promotionReady ? (
                  <span className={`ldvh-chip-sm ${LDVH_WARN_TITLE_CLASS}`}>
                    {t('diagnostics.observations.readyBadge')}
                  </span>
                ) : (
                  <span className="ldvh-meta text-ldvh-text-secondary">—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.observations.recentTitle')}</h2>
        <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.observations.recentHint')}</p>
        <div className="mt-2 flex flex-col">
          {report.recent.length === 0 ? (
            <p className="ldvh-body-muted py-2">{t('diagnostics.observations.empty')}</p>
          ) : report.recent.map((row, index) => (
            <div
              key={`${row.at ?? ''}-${index}`}
              className="grid grid-cols-[9.5rem_minmax(0,1fr)_5.5rem] items-start gap-2 border-b border-ldvh-border/40 py-1.5 last:border-0"
            >
              <span className="ldvh-meta font-mono text-[11px] text-ldvh-text-secondary">
                {row.at ?? '—'}
              </span>
              <div className="min-w-0">
                <p className="ldvh-meta truncate text-ldvh-text-primary">{row.phenomenon ?? '—'}</p>
                <p className="ldvh-meta truncate font-mono text-[11px] text-ldvh-text-secondary">
                  {row.anchor ?? '—'}
                </p>
              </div>
              <span className="ldvh-meta text-right text-[11px] text-ldvh-text-secondary">
                {row.status ?? '—'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * 经验留观区面板（11 §12bis）。
 *
 * ## 与摩擦面板（`ObservationPanel`）的三处刻意差异
 *
 * 1. **没有「攒到几分」**：经验缓冲没有聚合键与阈值（§12bis 闭集 9 项没有 `group`）。
 *    经验不需要攒够次数才成立——给它画一个进度条就是凭空造出一个规范里不存在的判据。
 * 2. **多出「待审核」与「最老一条」**：读者最关心的是「还有多少等着被审、最老的等了
 *    多久」。摩擦侧关心的是「哪组快攒够了」，两边的核心问题不同。
 * 3. **条目列表只四列**（时间/现象/来源/状态）：与摩擦侧同口径，且**不含** `evidence`
 *    （属内容）、不含 `candidate_question`（属判断输入）、不含对象身份。
 *
 * ## 不得做的事（规范红线，不是遗漏）
 *
 * 不提供「点击进入详情」——条目没有对象身份；不提供导出/复制/搜索——那等于把非事实
 * 材料搬出诊断面（§12bis 读取纪律第 2 条）。
 */
function ExperienceBufferPanel({ report, t }: { report: ExperienceBufferReport; t: Translation }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="ldvh-card-title">{t('diagnostics.experience.title')}</h2>
        <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.experience.subtitle')}</p>
      </div>

      <div className="ldvh-metric-grid">
        <MetricCard
          label={t('diagnostics.experience.entries')}
          value={String(report.totals.entries)}
          hint={t('diagnostics.experience.projects', { count: String(report.totals.projects) })}
        />
        <MetricCard
          label={t('diagnostics.experience.pending')}
          value={String(report.pendingCount)}
          tone={report.pendingCount > 0 ? 'warning' : undefined}
        />
        <MetricCard
          label={t('diagnostics.experience.oldest')}
          value={report.oldestPendingAt ? report.oldestPendingAt.slice(0, 10) : '—'}
          hint={report.oldestPendingAt ?? t('diagnostics.experience.oldestNone')}
        />
        <MetricCard
          label={t('diagnostics.experience.projects').replace('{count}', String(report.totals.projects))}
          value={String(report.totals.projects)}
        />
      </div>

      <ScopeNotice limits={report.scope.limits ?? []} />

      {/* 目录不存在是**正常初态**（还没有任何观察落地）。须与「读失败」区分开。 */}
      {!report.scope.bufferDirExists ? (
        <div className="rounded-lg border border-dashed border-ldvh-border bg-ldvh-panel px-4 py-6 text-center">
          <p className="ldvh-body-muted">{t('diagnostics.experience.noBufferDir')}</p>
          <p className="ldvh-meta mt-1 font-mono text-ldvh-text-secondary">{report.scope.bufferDir}</p>
          <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.experience.noBufferDirHint')}</p>
        </div>
      ) : null}

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.experience.entriesTitle')}</h2>
        <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.experience.entriesHint')}</p>
        <div className="mt-2 flex flex-col">
          {report.recent.length === 0 ? (
            <p className="ldvh-body-muted py-2">{t('diagnostics.experience.empty')}</p>
          ) : report.recent.map((row, index) => (
            <div
              key={`${row.at ?? ''}-${index}`}
              className="grid grid-cols-[9.5rem_minmax(0,1fr)_5.5rem] items-start gap-2 border-b border-ldvh-border/40 py-1.5 last:border-0"
            >
              <span className="ldvh-meta font-mono text-[11px] text-ldvh-text-secondary">
                {row.at ?? '—'}
              </span>
              <div className="min-w-0">
                <p className="ldvh-meta truncate text-ldvh-text-primary">{row.phenomenon ?? '—'}</p>
                <p className="ldvh-meta truncate font-mono text-[11px] text-ldvh-text-secondary">
                  {row.anchor ?? '—'}
                </p>
              </div>
              <span className="ldvh-meta text-right text-[11px] text-ldvh-text-secondary">
                {row.status ?? '—'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * 运行账清理面板。
 *
 * ## 为什么每个目标都要单独勾选，而不是一个「全部清理」按钮
 *
 * 这几类东西性质不同（见后端 logsCleanup.ts 文件头）：流水可以丢，**观察材料
 * 丢了就是丢证据**。一个「全部清理」的按钮会让后者被顺手带走。故默认只勾最安全
 * 的一类，观察材料须显式勾。
 *
 * ## 为什么先预览再删
 *
 * 删除不可逆（除自动备份）。预览与真删走后端**同一条**计算路径，故「将删除 N 条」
 * 就是真删的条数——这条由测试钉住。用户看过数字再决定。
 *
 * ## 水位为什么不在列表里
 *
 * 后端 `LOGGABLE_TARGETS` 刻意不含它：删水位会让机制重新观察已处理内容并重复
 * 入账。本面板在页面底部把这条写明，免得用户以为「没列出来 = 忘了做」。
 */
function CleanupPanel({
  report,
  setReport,
  t,
}: {
  report: CleanupPlan | null;
  setReport: (plan: CleanupPlan | null) => void;
  t: Translation;
}) {
  const [days, setDays] = useState<number>(3);
  const [selected, setSelected] = useState<Record<string, boolean>>({
    // 默认只勾「流水」类——观察材料须显式勾选（丢了就是丢证据）。
    'pending-queue': true,
    'idle-runs': true,
    'queue-backups': false,
    'experience-buffer': false,
    'friction-observations': false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const chosen = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const totalRemoving = report?.targets.reduce((sum, row) => sum + row.removing, 0) ?? 0;

  const preview = async () => {
    setBusy(true); setError(null); setDone(null);
    try {
      const plan = await fetchCleanupPreview(days, chosen);
      setReport(plan);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const clean = async () => {
    // 破坏性操作：让用户再看一眼要删多少条（预览已给过数字时不重复弹窗）。
    setBusy(true); setError(null); setDone(null);
    try {
      const result = await runCleanup(days, chosen);
      setReport(result);
      const removed = result.applied?.reduce((sum, row) => sum + row.removed, 0) ?? 0;
      setDone(
        t('diagnostics.cleanup.doneDetail', {
          count: String(removed),
          path: result.backupPath ?? '—',
        }),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.cleanup.retention')}</h2>
        <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.cleanup.retentionHint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[1, 3, 7].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => { setDays(option); setReport(null); setDone(null); }}
              className={`ldvh-tab-button ${days === option ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
            >
              {t('diagnostics.cleanup.keepDays', { n: String(option) })}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.cleanup.targets')}</h2>
        <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.cleanup.targetsHint')}</p>
        <div className="mt-3 flex flex-col gap-2">
          {(report?.targets ?? []).length === 0 && !report ? (
            // 尚未预览：给出静态的目标清单（让用户先知道能清什么再点预览）。
            <div className="flex flex-col gap-2">
              {[
                { id: 'pending-queue', label: t('diagnostics.cleanup.t.pendingQueue'), note: t('diagnostics.cleanup.n.pendingQueue') },
                { id: 'idle-runs', label: t('diagnostics.cleanup.t.idleRuns'), note: t('diagnostics.cleanup.n.idleRuns') },
                { id: 'queue-backups', label: t('diagnostics.cleanup.t.queueBackups'), note: t('diagnostics.cleanup.n.queueBackups') },
                { id: 'experience-buffer', label: t('diagnostics.cleanup.t.experienceBuffer'), note: t('diagnostics.cleanup.n.experienceBuffer') },
                { id: 'friction-observations', label: t('diagnostics.cleanup.t.frictionObservations'), note: t('diagnostics.cleanup.n.frictionObservations') },
              ].map((row) => (
                <label key={row.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected[row.id] === true}
                    onChange={(e) => { setSelected({ ...selected, [row.id]: e.target.checked }); setReport(null); }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="ldvh-meta block text-ldvh-text-primary">{row.label}</span>
                    <span className="ldvh-meta block text-[11px] text-ldvh-text-secondary">{row.note}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            report?.targets.map((row) => (
              <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-2 border-b border-ldvh-border/40 pb-2 last:border-0">
                <div className="min-w-0">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected[row.id] === true}
                      onChange={(e) => { setSelected({ ...selected, [row.id]: e.target.checked }); setReport(null); }}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="ldvh-meta block text-ldvh-text-primary">{row.label}</span>
                      <span className="ldvh-meta block text-[11px] text-ldvh-text-secondary">{row.note}</span>
                    </span>
                  </label>
                </div>
                <span className={`ldvh-meta text-right text-[12px] ${row.removing > 0 ? LDVH_WARN_TITLE_CLASS : 'text-ldvh-text-secondary'}`}>
                  {t('diagnostics.cleanup.removeCount', { count: String(row.removing) })}
                </span>
                <span className="ldvh-meta text-right text-[12px] text-ldvh-text-secondary">
                  {t('diagnostics.cleanup.keepCount', { count: String(row.keeping) })}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={preview}
            className="ldvh-tab-button ldvh-tab-button-idle disabled:opacity-50"
          >
            {busy ? t('diagnostics.cleanup.working') : t('diagnostics.cleanup.preview')}
          </button>
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={clean}
            className="ldvh-tab-button ldvh-tab-button-active disabled:opacity-50"
          >
            {t('diagnostics.cleanup.clean')}
          </button>
          {report ? (
            <span className="ldvh-meta text-[12px] text-ldvh-text-secondary">
              {t('diagnostics.cleanup.willRemove', { count: String(totalRemoving), cutoff: report.cutoff.slice(0, 10) })}
            </span>
          ) : null}
        </div>

        {error ? <p className={`ldvh-meta mt-2 ${LDVH_ERROR_TEXT_CLASS}`}>{error}</p> : null}
        {done ? <p className="ldvh-meta mt-2 text-ldvh-text-primary">{done}</p> : null}
        {report?.backupPath ? (
          <p className="ldvh-meta mt-2 font-mono text-[11px] text-ldvh-text-secondary">
            {t('diagnostics.cleanup.backupAt')}: {report.backupPath}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-dashed border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.cleanup.notListed')}</h2>
        <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.cleanup.notListedHint')}</p>
      </section>
    </div>
  );
}

export default function Diagnostics() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('gate');
  // 经验留观区（11 §12bis）。与摩擦区同页签并列——Human 2026-10-26：「留观区一样
  // 出现在诊断 tab 里，和摩擦一样」。两者是两个载体，故各取各的报告。
  const [experienceBuffer, setExperienceBuffer] = useState<ExperienceBufferReport | null>(null);
  const [gate, setGate] = useState<GateReport | null>(null);
  const [idle, setIdle] = useState<IdleReport | null>(null);
  const [observations, setObservations] = useState<FrictionObservationReport | null>(null);
  const [cleanup, setCleanup] = useState<CleanupPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 采集时机就是进入本页与切换标签：离开页面即卸载，再进来一定重采。
  // 因此不设单独的「重新采集」按钮——它没有独立的刷新语义（2026-10-18 实测确认）。
  useEffect(() => {
    let cancelled = false;
    setError(null);
    // 清理页不自动预览：预览要传保留天数，由用户选。
    if (tab === 'cleanup') {
      setCleanup(null);
      return () => { cancelled = true; };
    }
    // observations 页签要**两份**报告（摩擦 + 经验）。两载体各自独立读取：一个读失败
    // 不该让另一个也空白——所以用 allSettled 而不是 all，失败的一份留空并由页面
    // 如实说明，另一份照常显示。
    if (tab === 'observations') {
      Promise.allSettled([fetchFrictionObservationReport(), fetchExperienceBufferReport()])
        .then(([frictionResult, experienceResult]) => {
          if (cancelled) return;
          if (frictionResult.status === 'fulfilled') setObservations(frictionResult.value);
          else setError(frictionResult.reason instanceof Error ? frictionResult.reason.message : String(frictionResult.reason));
          if (experienceResult.status === 'fulfilled') setExperienceBuffer(experienceResult.value);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
        });
      return () => { cancelled = true; };
    }
    const load =
      tab === 'gate'
        ? fetchGateReport()
        : fetchIdleReport();
    load
      .then((result) => {
        if (cancelled) return;
        if (tab === 'gate') setGate(result as GateReport);
        else setIdle(result as IdleReport);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const current = tab === 'gate' ? gate : tab === 'idle' ? idle : tab === 'observations' ? observations : (cleanup ?? true);
  const tabs = useMemo(() => ([
    { key: 'gate' as Tab, label: t('diagnostics.tab.gate') },
    { key: 'idle' as Tab, label: t('diagnostics.tab.idle') },
    { key: 'observations' as Tab, label: t('diagnostics.tab.observations') },
    { key: 'cleanup' as Tab, label: t('diagnostics.tab.cleanup') },
  ]), [t]);

  return (
    <div className="ldvh-page-frame">
      <PageHeader title={t('diagnostics.title')} subtitle={t('diagnostics.subtitle')}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="ldvh-tab-list">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`ldvh-tab-button ${tab === item.key ? 'ldvh-tab-button-active' : 'ldvh-tab-button-idle'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      {error ? (
        <div className="rounded-lg border border-dashed border-ldvh-border bg-ldvh-panel px-4 py-8 text-center">
          <p className="ldvh-body-muted">{t('diagnostics.loadFailed')}</p>
          <p className={`ldvh-meta ${LDVH_ERROR_TEXT_CLASS}`}>{error}</p>
        </div>
      ) : !current ? (
        <div className="flex justify-center py-10">
          <div className="ldvh-spinner" />
        </div>
      ) : tab === 'gate' && gate ? (
        <GatePanel report={gate} t={t} />
      ) : tab === 'idle' && idle ? (
        <IdlePanel report={idle} t={t} />
      ) : tab === 'observations' && observations ? (
        <div className="flex flex-col gap-8">
          <ObservationPanel report={observations} t={t} />
          {experienceBuffer ? <ExperienceBufferPanel report={experienceBuffer} t={t} /> : null}
        </div>
      ) : tab === 'cleanup' ? (
        <CleanupPanel report={cleanup} setReport={setCleanup} t={t} />
      ) : null}
    </div>
  );
}
