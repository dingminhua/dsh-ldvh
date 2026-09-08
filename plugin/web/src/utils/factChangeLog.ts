import type { CommitSignature } from '@/utils/api';
import { getLatestChangeLogAt, getLatestChangeLogSignature } from '../../shared/factChangeLog';

/**
 * Returns the newest complete attribution carried by a fact's update log.
 *
 * This intentionally reads only the immutable update-log carrier.  Header
 * attribution is therefore never inferred from the object itself or from a
 * partial signature record.  v5 扁平 provider/model 与 v4 嵌套 signature
 * 两种流水形态均可读（单一实现在 shared/factChangeLog）。
 */
export function getLatestFactChangeSignature(value: unknown): CommitSignature | undefined {
  return getLatestChangeLogSignature(value);
}

/** 03 §6.1：变更时间由 change_log 末条有效流水 at 承担。 */
export function getLatestFactChangeAt(value: unknown): string | undefined {
  return getLatestChangeLogAt(value);
}

/**
 * 事实落款的最近更新时刻。03 §6.1 不保留公共 updated_at：
 * v4 归档对象的 updated_at/updated 字段优先（保持既有显示），
 * v5 对象（无公共 updated_at/updated）回退到 change_log 末条流水 at——
 * 规范定义的变更时间权威承载。
 */
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
