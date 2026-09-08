export interface SignatureInput {
  productName?: unknown
  modelName?: unknown
  /** v5 扁平署名词汇：change_log 条目的 provider/model 与 LDVH-Provider/LDVH-Model trailer。 */
  provider?: unknown
  model?: unknown
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
 *
 * v5 provider（specs/09 权威会话路由值）优先且逐字呈现——与「签名值零清理
 * 原则」对齐，供应商 id 不套首字母大写等产品名美化；v4 product_name 保持
 * 既有归一（首字母大写/平台映射，契约测试钉住的归档数据显示契约）。
 */
export function normalizeSignature(value: SignatureInput): NormalizedSignature {
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  return {
    productName: provider || normalizeProductName(value.productName),
    modelName: normalizeModelName(model || value.modelName),
  };
}
