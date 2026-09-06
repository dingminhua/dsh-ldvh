import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** LDVH 项目根目录 */
export const LDVH_ROOT = process.env.LDVH_ROOT || path.resolve(__dirname, '../../..')

/** 安装或使用 LDVH 的工作区根目录 */
export const LDVH_WORKSPACE_ROOT = process.env.LDVH_WORKSPACE_ROOT || path.dirname(LDVH_ROOT)

/** 当前工作对象类型 */
export const OBJECT_TYPES = ['workcase', 'adr', 'pitfall', 'spark', 'study'] as const
export type ObjectType = (typeof OBJECT_TYPES)[number]
