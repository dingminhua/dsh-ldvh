import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

function source(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8')
}

test('Changelog reports a Git log failure without suppressing field-level facts', () => {
  const changelog = source('api/routes/changelog.ts')

  // git 日志失败必须如实上抛，不得静默吞掉为成功空结果
  assert.match(changelog, /ok: false, error/)
  assert.doesNotMatch(changelog, /getGitLog\([\s\S]*?\)\.catch\(\(\) => \[\]\)/)
})

test('Git status and historical file diffs do not turn command failures into successful emptiness', () => {
  const routes = source('api/routes/project-files.ts')

  assert.doesNotMatch(routes, /git', \['show',[\s\S]*?\.catch\(\(\) => ''\)/)
  assert.doesNotMatch(routes, /catch \{\s*\/\/ 非 Git 管辖项目不阻塞其它项目。[\s\S]*?\}/)
})
