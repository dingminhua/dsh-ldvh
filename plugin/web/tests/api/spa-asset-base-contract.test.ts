import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const webRoot = path.resolve(import.meta.dirname, '../..')
const distIndex = path.join(webRoot, 'dist', 'index.html')

test('built SPA assets resolve under the /ldvh prefix (guard against a base-less vite build)', () => {
  if (!fs.existsSync(distIndex)) return

  const html = fs.readFileSync(distIndex, 'utf8')
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
  assert.ok(references.length > 0, 'dist/index.html 应至少引用一个资产')

  const localRefs = references.filter((ref) => !/^(https?:)?\/\//.test(ref))
  const offenders = localRefs.filter((ref) => !ref.startsWith('/ldvh/'))

  assert.deepEqual(
    offenders,
    [],
    `dist/index.html 存在未挂 /ldvh 前缀的资产引用：${offenders.join(', ')}。` +
      '这会使 /ldvh 页面白屏——请用 `pnpm build:dsh`（vite build --base=/ldvh/）重新构建。',
  )
})
