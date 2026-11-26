import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import {
  fetchCleanupPreview,
  fetchFrictionObservationReport,
  fetchGateReport,
  runCleanup,
  type CleanupPlan,
  type FrictionObservationReport,
  type GateReport,
} from '@/utils/api';
import { LDVH_ERROR_TEXT_CLASS, LDVH_WARN_TITLE_CLASS } from '@/utils/semanticColors';
import type { LocaleKey } from '@/i18n/locales';

type Tab = 'gate' | 'observations' | 'cleanup';

type Translation = (key: LocaleKey, params?: Record<string, string>) => string;

const CATEGORY_LABEL_KEYS = {
  missing_arguments: 'diagnostics.category.missingArguments',
  audit_summary_shape: 'diagnostics.category.auditSummaryShape',
  carrier_validation: 'diagnostics.category.carrierValidation',
  object_not_found: 'diagnostics.category.objectNotFound',
  shape_and_concurrency: 'diagnostics.category.shapeAndConcurrency',
  other: 'diagnostics.category.other',
  spec_lookup_miss: 'diagnostics.category.specLookupMiss',
  host_param_validation: 'diagnostics.category.hostParamValidation',
  human_gate_pending: 'diagnostics.category.humanGatePending',
  partial_result: 'diagnostics.category.partialResult',
  business_precondition: 'diagnostics.category.businessPrecondition',
  subagent_stopped: 'diagnostics.category.subagentStopped',
  observation_gap: 'diagnostics.category.observationGap',
  quote_not_in_window: 'diagnostics.category.quoteNotInWindow',
  quote_too_short: 'diagnostics.category.quoteTooShort',
  carrier_ineffective: 'diagnostics.category.carrierIneffective',
  title_too_long: 'diagnostics.category.titleTooLong',
  dispatch_unavailable: 'diagnostics.category.dispatchUnavailable',
} as const satisfies Record<string, LocaleKey>;

const STATUS_LABEL_KEYS = {
  rejected: 'diagnostics.status.rejected',
  invalid_request: 'diagnostics.status.invalidRequest',
  completed: 'diagnostics.status.completed',
  unknown: 'diagnostics.status.unknown',
  partial: 'diagnostics.status.partial',
  unavailable: 'diagnostics.status.unavailable',
  execution_error: 'diagnostics.status.executionError',
} as const satisfies Record<string, LocaleKey>;

function categoryLabel(t: Translation, category: string): string {
  const key = (CATEGORY_LABEL_KEYS as Record<string, LocaleKey | undefined>)[category];
  return key ? t(key) : category;
}

function statusLabel(t: Translation, status: string): string {
  const key = (STATUS_LABEL_KEYS as Record<string, LocaleKey | undefined>)[status];
  return key ? t(key) : status;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '—';
  const date = new Date(parsed);
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return sameYear ? `${day} ${time}` : `${date.getFullYear()}-${day} ${time}`;
}

function ShareBar({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ldvh-border">
      <div className="h-full rounded-full bg-ldvh-accent" style={{ width: `${percent}%` }} />
    </div>
  );
}

function MetricCard({ label, value, hint, tone, wrap }: { label: string; value: string; hint?: string; tone?: 'error' | 'warning'; wrap?: boolean }) {
  const toneClass = tone === 'error' ? LDVH_ERROR_TEXT_CLASS : tone === 'warning' ? LDVH_WARN_TITLE_CLASS : 'text-ldvh-text-primary';
  return (
    <div className="min-w-0 rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
      <p className="ldvh-meta-muted">{label}</p>
      <p
        className={`mt-1 font-semibold ${toneClass} ${wrap ? 'break-all text-base' : 'text-xl'}`}
        title={value}
      >
        {value}
      </p>
      {hint && <p className="ldvh-meta-muted mt-1">{hint}</p>}
    </div>
  );
}

function ScopeNotice({ limits, generatedAt, cachedAt, t }: { limits: string[]; generatedAt?: string; cachedAt?: string; t?: Translation }) {
  if (limits.length === 0 && !generatedAt) return null;
  return (
    <div className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${LDVH_WARN_TITLE_CLASS}`} />
        <div className="min-w-0">
          <p className="ldvh-meta font-medium text-ldvh-text-primary">scope</p>
          {generatedAt && t ? (
            <p className="ldvh-meta-muted mt-1">
              {cachedAt
                ? t('diagnostics.gate.cachedAt', { at: formatTime(cachedAt) })
                : t('diagnostics.gate.freshAt', { at: formatTime(generatedAt) })}
            </p>
          ) : null}
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
          wrap
        />
        <MetricCard label={t('diagnostics.gate.sessions')} value={String(report.scope.sessionsScanned ?? 0)} />
      </div>

      <ScopeNotice
        limits={report.scope.limits ?? []}
        generatedAt={report.generatedAt}
        cachedAt={report.scope.cachedAt}
        t={t}
      />

      { }
      <section className="rounded-lg border border-ldvh-border bg-ldvh-panel p-3">
        <h2 className="ldvh-card-title">{t('diagnostics.gate.byStatus')}</h2>
        <p className="ldvh-meta mt-1 text-ldvh-text-secondary">{t('diagnostics.gate.byStatusHint')}</p>
        <div className="mt-3 flex flex-col gap-2">
          {(report.byStatus ?? []).length === 0 ? (
            <p className="ldvh-body-muted">{t('diagnostics.gate.empty')}</p>
          ) : (report.byStatus ?? []).map((row) => (
            <div key={row.status} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2">
              <span className="ldvh-meta truncate text-ldvh-text-primary">{statusLabel(t, row.status)}</span>
              <ShareBar value={row.count} total={report.totals.calls} />
              <span className="ldvh-meta font-mono text-right text-ldvh-text-secondary">{row.count}</span>
            </div>
          ))}
        </div>
      </section>

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

      { }
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
                  {group.lastAt ? ` · ${formatTime(group.lastAt)}` : ''}
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
                {formatTime(row.at)}
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
    'checkpoint-runs': true,
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
            <div className="flex flex-col gap-2">
              {[
                { id: 'checkpoint-runs', label: t('diagnostics.cleanup.t.checkpointRuns'), note: t('diagnostics.cleanup.n.checkpointRuns') },
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
  const [gate, setGate] = useState<GateReport | null>(null);
  const [observations, setObservations] = useState<FrictionObservationReport | null>(null);
  const [cleanup, setCleanup] = useState<CleanupPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (tab === 'cleanup') {
      setCleanup(null);
      return () => { cancelled = true; };
    }
    if (tab === 'observations') {
      fetchFrictionObservationReport()
        .then((value) => setObservations(value))
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
        });
      return () => { cancelled = true; };
    }
    fetchGateReport()
      .then((result) => {
        if (cancelled) return;
        setGate(result as GateReport);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const current = tab === 'gate' ? gate : tab === 'observations' ? observations : (cleanup ?? true);
  const tabs = useMemo(() => ([
    { key: 'gate' as Tab, label: t('diagnostics.tab.gate') },
    { key: 'observations' as Tab, label: t('diagnostics.tab.observations') },
    { key: 'cleanup' as Tab, label: t('diagnostics.tab.cleanup') },
  ]), [t]);

  return (
    <div className="ldvh-page-frame">
      <div className="ldvh-page-topbar mb-4 flex flex-wrap items-center gap-2">
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
      ) : tab === 'observations' && observations ? (
        <ObservationPanel report={observations} t={t} />
      ) : tab === 'cleanup' ? (
        <CleanupPanel report={cleanup} setReport={setCleanup} t={t} />
      ) : null}
    </div>
  );
}
