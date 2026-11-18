import CommitSignatureMeta from '@/components/CommitSignatureMeta';
import type { CommitSignature } from '@/utils/api';
import { formatDateTime } from '@/utils/dateFormat';
import { getLatestFactChangeSignature } from '@/utils/factChangeLog';

export default function ObjectUpdatedMeta({
  source,
  updatedAt,
  signature: explicitSignature,
}: {
  source?: { change_log?: unknown };
  updatedAt?: string;
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
