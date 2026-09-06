import type { CommitSignature } from '@/utils/api';
import { normalizeSignature } from '../../shared/signature';

/**
 * Returns the newest complete attribution carried by a fact's update log.
 *
 * This intentionally reads only the immutable update-log carrier.  Header
 * attribution is therefore never inferred from the object itself or from a
 * partial signature record.
 */
export function getLatestFactChangeSignature(value: unknown): CommitSignature | undefined {
  if (!Array.isArray(value)) return undefined;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    const entry = value[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const signature = (entry as Record<string, unknown>).signature;
    if (!signature || typeof signature !== 'object' || Array.isArray(signature)) continue;
    const signatureRecord = signature as Record<string, unknown>;

    const { productName, modelName } = normalizeSignature({
      productName: signatureRecord.product_name,
      modelName: signatureRecord.model_name,
    });
    if (productName || modelName) {
      return {
        ...(productName ? { productName } : {}),
        ...(modelName ? { modelName } : {}),
      };
    }
  }

  return undefined;
}
