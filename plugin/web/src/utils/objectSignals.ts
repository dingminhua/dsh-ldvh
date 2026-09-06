import { getFieldLabel, getFieldValueLabel } from '../i18n/locales.ts';

type SignalField = 'priority';

export type ObjectSignalSource = Partial<Record<SignalField, unknown>>;
export type SignalObjectType = 'workcase' | 'adr' | 'pitfall' | 'spark' | 'study' | 'change' | string;

export const SIGNAL_FIELDS: SignalField[] = ['priority'];

const SIGNAL_CLASSES: Partial<Record<SignalField, Record<string, string>>> = {
  priority: {
    P0: 'border-rose-500/35 bg-rose-500/10 text-rose-700/90 font-medium dark:text-rose-300/90',
    P1: 'border-orange-600/35 bg-orange-500/10 text-orange-700/90 font-medium dark:text-orange-300/90',
    P2: 'border-yellow-500/35 bg-yellow-400/10 text-yellow-700/90 font-medium dark:text-yellow-300/90',
    P3: 'border-zinc-500/20 bg-transparent text-ldvh-text-secondary font-medium',
  },
};

const PRIORITY_ICON_CLASSES: Record<string, string> = {
  P0: 'border-rose-400/65 bg-rose-500/15 text-rose-700 dark:text-rose-300',
  P1: 'border-orange-500/65 bg-orange-500/15 text-orange-700 dark:text-orange-300',
  P2: 'border-yellow-500/65 bg-yellow-400/15 text-yellow-700 dark:text-yellow-300',
  P3: 'border-zinc-400/35 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
};

function normalizeSignalValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function isSignalField(field: string): field is SignalField {
  return SIGNAL_FIELDS.includes(field as SignalField);
}

export function getSignalText(field: string, value: unknown, locale: string): string | null {
  if (!isSignalField(field)) return null;
  const normalized = normalizeSignalValue(value);
  if (!normalized) return null;
  const localized = getFieldValueLabel(field, normalized, locale);
  return localized === normalized ? normalized.replace(/_/g, ' ') : localized;
}

export function getObjectPriority(source: ObjectSignalSource, type?: SignalObjectType): string | null {
  if (type !== 'workcase' && type !== 'spark') return null;
  return normalizeSignalValue(source.priority);
}

export function getPriorityLabel(value: unknown, locale: string): string | null {
  const normalized = normalizeSignalValue(value);
  if (!normalized) return null;
  const fieldLabel = getFieldLabel('priority', locale);
  const valueLabel = getFieldValueLabel('priority', normalized, locale);
  return `${fieldLabel}: ${valueLabel}`;
}

export function getPriorityIconClassName(value: unknown): string {
  const normalized = normalizeSignalValue(value);
  if (!normalized) return 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary';
  return PRIORITY_ICON_CLASSES[normalized] ?? 'border-ldvh-border bg-ldvh-bg text-ldvh-text-secondary';
}

export function getSignalClassName(field: string, value: unknown): string {
  if (!isSignalField(field)) return 'border-ldvh-border bg-ldvh-bg text-ldvh-text-primary';
  const normalized = normalizeSignalValue(value);
  if (!normalized) return 'border-ldvh-border bg-ldvh-bg text-ldvh-text-primary';
  return SIGNAL_CLASSES[field]?.[normalized] ?? 'border-ldvh-border bg-ldvh-bg text-ldvh-text-primary';
}
