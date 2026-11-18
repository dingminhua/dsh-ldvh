import type { ServingWorkItem } from '@/utils/api';

export type ServingSparkProgress =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'empty' }
  | { kind: 'allDiscarded'; sparkTotal: number }
  | {
    kind: 'ratio';
    sparkTotal: number;
    open: number;
    implemented: number;
    denominator: number;
    unknownStatus: number;
  };

const SPARK_STATUSES = ['open', 'implemented', 'discarded'] as const;

export function summarizeServingSparkProgress(
  rows: readonly Pick<ServingWorkItem, 'type' | 'status'>[],
  unreadable: readonly string[] = [],
): ServingSparkProgress {
  const sparkFailure = unreadable.find((entry) => entry.startsWith('spark'));
  if (sparkFailure) return { kind: 'unavailable', reason: sparkFailure };

  const sparks = rows.filter((row) => row.type === 'spark');
  if (sparks.length === 0) return { kind: 'empty' };

  let open = 0;
  let implemented = 0;
  let unknownStatus = 0;
  for (const spark of sparks) {
    const status = typeof spark.status === 'string' ? spark.status.trim() : '';
    if (status === 'open') open += 1;
    else if (status === 'implemented') implemented += 1;
    else if (status !== 'discarded') unknownStatus += 1;
  }

  if (open + implemented === 0 && unknownStatus === 0) {
    return { kind: 'allDiscarded', sparkTotal: sparks.length };
  }
  if (open + implemented === 0) {
    return {
      kind: 'ratio',
      sparkTotal: sparks.length,
      open,
      implemented,
      denominator: 0,
      unknownStatus,
    };
  }

  return {
    kind: 'ratio',
    sparkTotal: sparks.length,
    open,
    implemented,
    denominator: open + implemented,
    unknownStatus,
  };
}

export const SERVING_SPARK_STATUSES = SPARK_STATUSES;
