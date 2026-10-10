// 投影保真守卫的**合成载体夹具**（2026-10）。
//
// 为什么需要它：本目录下一组守卫（`workcase-projection-fidelity` 与
// `workcase-gist-presentation-contract`）刻意对**真实载体**断言——它们要证明
// 「投影不丢字段」这件事在真实仓库里也成立，因此不满足于只测构造对象。
//
// 但真实载体的状态分布是**生命周期副产品**，不是守卫的设计输入：仓库里可能
// 一度全为 closed（工单全部收口后即是此形），于是「至少核对一个 open / 带 reviews
// 的 open / 带 attempt.session_id 的对象」这类**判别力自检**会触发，整个守卫空转
// ——它既不校验任何东西，也不告诉人它没在校验。这种失败是最坏形态：绿灯。
//
// 故此夹具提供一条不依赖仓库状态的判别力来源：把合成载体写进临时事实源根，按真实
// 读取层 `readLocalFact` 的路径与 id 规则组装，走与真实载体完全相同的管道。
// 真实载体扫描**仍然保留**（那是守卫的真正目的），夹具只补足判别力下限。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readLocalFact, type LocalFactScope } from '../../api/services/localFactReader.ts'

const PROJECT_ID = 'ldvh-projection-fixture'

/** 为一个合成 id 生成符合 FACT_OBJECT_ID_PATTERN 的 WorkCase id。 */
export function fixtureId(index: number): string {
  const hex = index.toString(16).padStart(8, '0')
  return `workcase-00000000-0000-4000-8000-${hex.padEnd(12, '0').slice(0, 12)}`
}

function frontmatterOf(fields: Record<string, unknown>): string {
  const lines = Object.entries(fields).map(([key, value]) => {
    if (value === null || value === undefined) return `${key}: null`
    if (Array.isArray(value)) return `${key}: ${JSON.stringify(value)}`
    if (typeof value === 'object') return `${key}: ${JSON.stringify(value)}`
    const text = String(value)
    // YAML 裸标量：值内含特殊字符时加引号，避免被解析成别的类型
    return /^[\w一-鿿][\w一-鿿 ./:()\-—、，。；：]*$/.test(text) && !text.includes(': ')
      ? `${key}: ${text}`
      : `${key}: ${JSON.stringify(text)}`
  })
  return lines.join('\n')
}

/** 写一份载体到临时事实源根，返回 { id, scope, root, cleanup }。 */
export function writeFixtureCarriers(
  carriers: Array<{ id: string; frontmatter: Record<string, unknown>; body: string }>,
): { ids: string[]; scope: LocalFactScope; root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ldvh-wc-projection-fixture-'))
  const dir = path.join(root, 'ldvh-base', 'workcases')
  fs.mkdirSync(dir, { recursive: true })
  for (const carrier of carriers) {
    const content = `---\n${frontmatterOf(carrier.frontmatter)}\n---\n\n${carrier.body.trim()}\n`
    fs.writeFileSync(path.join(dir, `${carrier.id}.md`), content, 'utf8')
  }
  return {
    ids: carriers.map((c) => c.id),
    root,
    scope: { worktreeLocator: root, governedProjectId: PROJECT_ID },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

/** 读一份合成载体（走与真实载体相同的读取层管道）。 */
export async function readFixture(id: string, scope: LocalFactScope) {
  return readLocalFact('workcase', id, scope)
}

/** 判断载体文件名（而非 bare id）——读取层按 `<id>.md` 定位。 */
export function fixtureCarrierName(id: string): string {
  return `${id}.md`
}