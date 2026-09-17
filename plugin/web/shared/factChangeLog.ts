import { toRfc3339Text } from './timestamp.js'
import { normalizeSignature } from './signature.js'

/** change_log 流水署名的呈现形态（与 api.ts 的 CommitSignature 同构）。 */
export interface ChangeLogSignature {
  productName?: string
  modelName?: string
  /** v5 扁平署名原词（specs/09 provider/model）——逐字携键到显示层，不折叠进
   *  productName/modelName：下游 normalizeSignature 二次归一会把 provider 大写化，
   *  区分必须存活整条管道（供应商 id 逐字呈现）。 */
  provider?: string
  model?: string
}

/**
 * 流水 at 的文本形态。YAML 未加引号的 ISO 时间戳会被 js-yaml 解析成 Date 实例
 * （HTTP 层序列化回字符串，进程内保持 Date），读取时统一归一为文本。
 * 字符串须为完整 RFC 3339 形态才算有效，与 cognition 原有判据一致。
 *
 * 归一实现唯一落在 `shared/timestamp.ts` 的 `toRfc3339Text`（09 §6 单一实现）——
 * 读取层、投影层与本函数共用同一份，不得各自重写。
 */
export function toChangeLogAtText(value: unknown): string | undefined {
  return toRfc3339Text(value)
}

/**
 * 03 §6.1：不保留公共 updated_at，变更时间由 change_log[].at 承担。
 * 取末条有效流水的 at 作为权威最近更新时刻；无有效流水时返回 undefined
 * （调用方按缺失处理，不回退到 created_at 或 Git 提交时间）。
 */
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

/**
 * 单条流水署名：v5 扁平 provider/model（specs/09 权威会话路由值）与 v4 嵌套
 * signature 形态均可读，且以**区分键**返回——v4 归一为 productName/modelName
 * （下游二次归一幂等），v5 原词保留 provider/model（显示层经 normalizeSignature
 * 逐字呈现，供应商 id 不美化）。一条流水只由一代写入方产生：嵌套形态存在且
 * 有效时按 v4 消费，否则读扁平字段。两者皆无/不完整时返回 undefined。
 */
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

/** 倒序取最新一条完整事实流水署名，不以对象头字段补造（与 ObjectUpdatedMeta 同源）。 */
export function getLatestChangeLogSignature(changeLog: unknown): ChangeLogSignature | undefined {
  if (!Array.isArray(changeLog)) return undefined
  for (let index = changeLog.length - 1; index >= 0; index -= 1) {
    const signature = readChangeLogEntrySignature(changeLog[index])
    if (signature) return signature
  }
  return undefined
}

/** 只统计带有效发生时刻的对象修改流水；未解析成员不作为修改数。 */
export function countChangeLogEntries(changeLog: unknown): number {
  if (!Array.isArray(changeLog)) return 0
  return changeLog.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    return toChangeLogAtText((entry as Record<string, unknown>).at) !== undefined
  }).length
}
