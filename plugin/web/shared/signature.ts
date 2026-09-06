export interface SignatureInput {
  productName?: unknown
  modelName?: unknown
}

export interface NormalizedSignature {
  productName: string
  modelName: string
}

function signatureIdentityKey(name: string): string {
  return name.replace(/[\s_-]/g, '').toLocaleLowerCase()
}

function normalizeModelName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const model = trimmed.slice(trimmed.lastIndexOf('/') + 1).trim()
  return model.replace(/(?:\s*\[[^\[\]]*\]\s*)+$/, '').trim()
}

/** Product name retains its spelling after an uppercase initial. */
function normalizeProductName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (signatureIdentityKey(trimmed) === 'deepseekharness') return 'DeepSeek Harness'
  if (signatureIdentityKey(trimmed) === 'codexdesktop') return 'Codex'
  if (signatureIdentityKey(trimmed).includes('trae')) return 'Trae'
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

/**
 * One presentation dispatcher for the two LDVH signature fields.
 * agent_runtime_name retired per workcase-01M08D6XAKF3FSTMETTGKEK7T7.
 */
export function normalizeSignature(value: SignatureInput): NormalizedSignature {
  return {
    productName: normalizeProductName(value.productName),
    modelName: normalizeModelName(value.modelName),
  };
}
