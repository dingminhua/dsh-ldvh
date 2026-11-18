import type { CommitSignature } from '@/utils/api';
import { getLatestChangeLogAt, getLatestChangeLogSignature } from '../../shared/factChangeLog';

export function getLatestFactChangeSignature(value: unknown): CommitSignature | undefined {
  return getLatestChangeLogSignature(value);
}

export function getLatestFactChangeAt(value: unknown): string | undefined {
  return getLatestChangeLogAt(value);
}

export function getObjectUpdatedAt(record: unknown): string | undefined {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const value = record as Record<string, unknown>;
  const legacyText = (input: unknown): string | undefined => (
    typeof input === 'string' && input.trim().length > 0 ? input : undefined
  );
  return legacyText(value.updated_at)
    ?? legacyText(value.updated)
    ?? getLatestChangeLogAt(value.change_log);
}
