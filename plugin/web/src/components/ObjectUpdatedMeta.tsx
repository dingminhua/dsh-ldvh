import CommitSignatureMeta from '@/components/CommitSignatureMeta';
import type { CommitSignature } from '@/utils/api';
import { formatDateTime } from '@/utils/dateFormat';
import { getLatestFactChangeSignature } from '@/utils/factChangeLog';

/**
 * The single update-attribution presentation used by fact cards and headers.
 * The attribution is deliberately derived from the latest complete
 * change_log signature, never inferred from other fact fields.
 */
export default function ObjectUpdatedMeta({
  source,
  updatedAt,
  signature: explicitSignature,
}: {
  source?: { change_log?: unknown };
  updatedAt?: string;
  /** Used by commit evidence, which has a direct signature rather than a fact change_log. */
  signature?: CommitSignature;
}) {
  const updated = formatDateTime(updatedAt);
  const signature = explicitSignature ?? getLatestFactChangeSignature(source?.change_log);

  return (
    <span className="ldvh-meta-muted inline-flex min-w-0 items-center truncate leading-4 text-ldvh-text-secondary">
      <span className="inline-flex h-4 shrink-0 items-center leading-4">{updated}</span>
      {signature && <CommitSignatureMeta signature={signature} />}
    </span>
  );
}
