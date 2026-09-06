/**
 * Shared projection for splitting Spark `implemented` status into two
 * presentation-level lifecycle states: `settled` (已落实) and `unclosed`
 * (未闭环). The data model still stores `implemented`; this only controls
 * list filtering and display.
 */

export interface SparkAssociationLike {
  available?: boolean;
  status?: string;
  closureOutcome?: string;
  target?: {
    factTypeKey?: string;
  } | { objectUid: string };
}

/**
 * Returns true when at least one association target is still actively
 * carrying forwarded responsibility:
 *  - Spark target with status `open`
 *  - WorkCase target whose status is not `closed`
 */
export function hasSparkOpenAssociation(
  associations: SparkAssociationLike[] | undefined,
): boolean {
  if (!associations || associations.length === 0) return false;
  return associations.some((association) => {
    if (!association.available || !association.status) return false;
    const factType = association.target && 'factTypeKey' in association.target
      ? association.target.factTypeKey
      : undefined;
    if (factType === 'spark') {
      return association.status === 'open';
    }
    if (factType === 'workcase') {
      if (association.status === 'closed') return false;
      return true;
    }
    return false;
  });
}

export type SparkImplementedPresentation = 'settled' | 'unclosed';

export function getSparkImplementedPresentationStatus(
  associations: SparkAssociationLike[] | undefined,
): SparkImplementedPresentation {
  return hasSparkOpenAssociation(associations) ? 'unclosed' : 'settled';
}

/** Type guard for the two presentation statuses. */
export function isSparkPresentationStatus(value: unknown): value is SparkImplementedPresentation {
  return value === 'settled' || value === 'unclosed';
}
