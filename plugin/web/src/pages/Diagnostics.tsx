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
  fetchFrictionObservationReport,
  fetchGateReport,
  fetchIdleReport,
  type FrictionObservationReport,
  type GateReport,
  type IdleReport,
} from '@/utils/api';
import { LDVH_ERROR_TEXT_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';
import type { LocaleKey } from '@/i18n/locales';

type Tab = 'gate' | 'idle' | 'observations';

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

export default function Diagnostics() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('gate');
  const [gate, setGate] = useState<GateReport | null>(null);
  const [idle, setIdle] = useState<IdleReport | null>(null);
  const [observations, setObservations] = useState<FrictionObservationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 采集时机就是进入本页与切换标签：离开页面即卸载，再进来一定重采。
  // 因此不设单独的「重新采集」按钮——它没有独立的刷新语义（2026-10-18 实测确认）。
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const load =
      tab === 'gate'
        ? fetchGateReport()
        : tab === 'idle'
          ? fetchIdleReport()
          : fetchFrictionObservationReport();
    load
      .then((result) => {
        if (cancelled) return;
        if (tab === 'gate') setGate(result as GateReport);
        else if (tab === 'idle') setIdle(result as IdleReport);
        else setObservations(result as FrictionObservationReport);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const current = tab === 'gate' ? gate : tab === 'idle' ? idle : observations;
  const tabs = useMemo(() => ([
    { key: 'gate' as Tab, label: t('diagnostics.tab.gate') },
    { key: 'idle' as Tab, label: t('diagnostics.tab.idle') },
    { key: 'observations' as Tab, label: t('diagnostics.tab.observations') },
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
      ) : observations ? (
        <ObservationPanel report={observations} t={t} />
      ) : null}
    </div>
  );
}
