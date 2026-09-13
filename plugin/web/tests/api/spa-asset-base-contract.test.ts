import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const webRoot = path.resolve(import.meta.dirname, '../..')
const distIndex = path.join(webRoot, 'dist', 'index.html')

/**
 * LDVH SPA 挂在 /ldvh 前缀下（plugin/lib/index.js 的 SPA_PREFIX），与 DSH 宿主
 * 共存于同一端口。若构建时未带 --base=/ldvh/，产物会引用 /assets/... —— 该路径
 * 不属于 LDVH，请求会落回宿主根路径，页面因取不到 JS/CSS 而整页空白。
 *
 * 错误构建本身不报错（vite 正常输出 "✓ built"），只在浏览器里表现为白屏，因此
 * 需要机械拦截：改用 `pnpm build:dsh`（= vite build --base=/ldvh/ + gzip 后处理）。
 *
 * dist/ 是 gitignore 的构建产物，CI 中不存在；不存在时跳过（不误报失败）。
 */
test('built SPA assets resolve under the /ldvh prefix (guard against a base-less vite build)', () => {
  if (!fs.existsSync(distIndex)) return

  const html = fs.readFileSync(distIndex, 'utf8')
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
  assert.ok(references.length > 0, 'dist/index.html 应至少引用一个资产')

  // 站外绝对 URL 不参与前缀校验。
  const localRefs = references.filter((ref) => !/^(https?:)?\/\//.test(ref))
  const offenders = localRefs.filter((ref) => !ref.startsWith('/ldvh/'))

  assert.deepEqual(
    offenders,
    [],
    `dist/index.html 存在未挂 /ldvh 前缀的资产引用：${offenders.join(', ')}。` +
      '这会使 /ldvh 页面白屏——请用 `pnpm build:dsh`（vite build --base=/ldvh/）重新构建。',
  )
})
