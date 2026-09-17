import type { LocaleKey } from '@/i18n/locales';

/** 只需要「取词条」这一能力的翻译函数形态（避免把 i18n context 带进工具层）。 */
type Translator = (key: LocaleKey) => string;

/**
 * WorkCase 判据核对状态 → 可读词条的三态映射。
 *
 * 21 §9.3：`result.criteria_checks[].satisfied` 是**布尔**判定，缺失即「未记录」
 * （不是 false——两者语义不同，必须可区分）。10 §12.8 要求状态不由颜色或图标
 * 单独承载，故三态各有一个可读词条。
 *
 * 这里是该映射的**唯一实现**（09 §6 单一实现）：详情
 * （WorkCaseReadingLayout 的 ResultChecksNode）、列表卡（ObjectList）与认知中心
 * 收件箱（CognitionCenter）共用它。此前列表与收件箱把布尔直接插值进字符串
 * （`` `${c.satisfied} · ${c.evidence}` ``），页面上因此显示裸 `true`/`false`，
 * 且 `satisfied` 缺失时显示空串（WorkCase 呈现保真缺陷 D6）。
 */
export const WORKCASE_CHECK_STATE_KEYS = {
  satisfied: 'objectDetail.workcaseCheckSatisfied',
  unsatisfied: 'objectDetail.workcaseCheckUnsatisfied',
  unknown: 'objectDetail.workcaseCheckUnknown',
} as const satisfies Record<string, LocaleKey>;

export type WorkCaseCheckState = keyof typeof WORKCASE_CHECK_STATE_KEYS;

/** 布尔（或缺失）→ 三态名。 */
export function workCaseCheckState(satisfied: boolean | undefined): WorkCaseCheckState {
  if (satisfied === true) return 'satisfied';
  if (satisfied === false) return 'unsatisfied';
  return 'unknown';
}

/** 布尔（或缺失）→ 本地化可读文本。 */
export function workCaseCheckStateLabel(satisfied: boolean | undefined, t: Translator): string {
  return t(WORKCASE_CHECK_STATE_KEYS[workCaseCheckState(satisfied)]);
}

/** 三态 chip 的形态类（颜色只作辅助——文字已独立承载语义，见 10 §12.8）。 */
export function workCaseCheckChipClass(satisfied: boolean | undefined): string {
  return {
    satisfied: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    unsatisfied: 'border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    unknown: 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary',
  }[workCaseCheckState(satisfied)];
}

/**
 * 列表卡与收件箱的紧凑判据行：「可读状态 · 依据」。
 * 详情走 chip + 依据的完整形态；两处共享同一状态映射，不各自拼字符串。
 */
export function workCaseCheckStatement(
  check: { satisfied?: boolean; evidence?: string },
  t: Translator,
): string {
  const label = workCaseCheckStateLabel(check.satisfied, t);
  const evidence = typeof check.evidence === 'string' ? check.evidence.trim() : '';
  return evidence ? `${label} · ${evidence}` : label;
}
