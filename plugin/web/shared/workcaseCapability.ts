function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function hasUnavailableIndependentSubagentReview(
  source: unknown,
): boolean {
  if (!isRecord(source)) return false;
  if (source.independentSubagentUnavailable === true) return true;
  return ['creation_reviews', 'result_reviews'].some(
    (key) =>
      Array.isArray(source[key]) &&
      source[key].some(
        (review) =>
          isRecord(review) &&
          review.actual_method === 'same-ai-switched-role-read-only',
      ),
  );
}
