/**
 * Re-export the shared Spark `implemented` presentation projection so the
 * UI imports from one location while the API layer can consume the same
 * implementation under `shared/`.
 */
export {
  hasSparkOpenAssociation,
  getSparkImplementedPresentationStatus,
  isSparkPresentationStatus,
  type SparkImplementedPresentation,
} from '../../shared/sparkImplementationStatus';
