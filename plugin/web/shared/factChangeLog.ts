import { toRfc3339Text } from './timestamp.js'
import { normalizeSignature } from './signature.js'

export interface ChangeLogSignature {
  productName?: string
  modelName?: string
  provider?: string
  model?: string
}

export function toChangeLogAtText(value: unknown): string | undefined {
  return toRfc3339Text(value)
}

export function getLatestChangeLogAt(changeLog: unknown): string | undefined {
  if (!Array.isArray(changeLog)) return undefined
  for (let index = changeLog.length - 1; index >= 0; index -= 1) {
    const entry = changeLog[index]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const at = toChangeLogAtText((entry as Record<string, unknown>).at)
    if (at !== undefined) return at
  }
  return undefined
}

export function readChangeLogEntrySignature(entry: unknown): ChangeLogSignature | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const record = entry as Record<string, unknown>
  const signature = record.signature
  const signatureRecord = signature && typeof signature === 'object' && !Array.isArray(signature)
    ? signature as Record<string, unknown>
    : null
  if (signatureRecord) {
    const { productName, modelName } = normalizeSignature({
      productName: signatureRecord.product_name,
      modelName: signatureRecord.model_name,
    })
    if (productName || modelName) {
      return {
        ...(productName ? { productName } : {}),
        ...(modelName ? { modelName } : {}),
      }
    }
  }
  const provider = typeof record.provider === 'string' && record.provider.trim().length > 0
    ? record.provider.trim()
    : undefined
  const model = typeof record.model === 'string' && record.model.trim().length > 0
    ? record.model.trim()
    : undefined
  if (provider || model) {
    return {
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    }
  }
  return undefined
}

export function getLatestChangeLogSignature(changeLog: unknown): ChangeLogSignature | undefined {
  if (!Array.isArray(changeLog)) return undefined
  for (let index = changeLog.length - 1; index >= 0; index -= 1) {
    const signature = readChangeLogEntrySignature(changeLog[index])
    if (signature) return signature
  }
  return undefined
}

export function countChangeLogEntries(changeLog: unknown): number {
  if (!Array.isArray(changeLog)) return 0
  return changeLog.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    return toChangeLogAtText((entry as Record<string, unknown>).at) !== undefined
  }).length
}
