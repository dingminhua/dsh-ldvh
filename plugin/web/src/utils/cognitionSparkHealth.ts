import type { CognitionSparkHealthItem } from './api';

export type SparkHealthAgeFilter = 'all' | '3d' | '7d';

export function getDefaultSparkHealthAgeFilter(
  openItems: Pick<CognitionSparkHealthItem, 'silentDays'>[],
): SparkHealthAgeFilter {
  if (openItems.some((item) => item.silentDays >= 7)) return '7d';
  if (openItems.some((item) => item.silentDays >= 3)) return '3d';
  return 'all';
}
