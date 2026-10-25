/**
 * LocalFactReader 的字段契约判定：`expected: 'object'` 必须真的核对象形态
 * （workcase-54d4d176 独立复核发现 3）。
 *
 * 缺陷形态：`matchesExpectation` 对 `'object'` 只做 `isRecord(value)`——任何
 * 非数组的普通对象都算通过，于是 `{ garbage_key: 1 }` 与 `{}` 都能被当作
 * attribution_ref 的合法承载**原样投影**，`field_issues` 全空。与 CLI 侧
 * `normalizeAttributionRef`（坏对象 → undefined，即不投影）形成同一载体两套
 * 读法。
 *
 * 这里钉住 web 侧的行为：`friction.attribution_ref` 登记了 `object_uid` 这个
 * 必备身份键，故缺 key / 非字符串 / 空串都必须如实报 field issue，而不是
 * 静默进投影。注意这是**能力发现**——契约若只写 `expected: 'object'`，读侧
 * 无从知道「什么样的对象才算数」，正是本条要补的那一层。
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';

const FRICTION_UID = '0198f1c7-8a2b-4c3d-9e4f-987654321fed';

function carrier(refYaml: string): string {
  return `---
object_uid: ${FRICTION_UID}
fact_type_key: friction
title: Shape fixture
status: open
impact: light
phenomenon: "fixture phenomenon"
attribution_ref:
${refYaml}
occurrence:
  count: 1
  first_at: "2026-11-01T00:00:00.000Z"
  last_at: "2026-11-01T00:00:00.000Z"
change_log: []
---

## 现象

fixture phenomenon

## 入账依据

fixture basis
`;
}

async function readWith(refYaml: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-attrsrc-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const dir = path.join(root, 'ldvh-base', 'frictions');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `friction-${FRICTION_UID}.md`), carrier(refYaml), 'utf8');
    const result = await showObject(`friction-${FRICTION_UID}`, scope);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    return result.data as Record<string, unknown>;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const BAD_SHAPES: Array<[string, string]> = [
  ['missing object_uid', '  garbage_key: 1'],
  ['empty object', '  {}'],
  ['object_uid is not a string', '  object_uid: 42'],
  ['object_uid is an empty string', '  object_uid: ""'],
];

for (const [label, refYaml] of BAD_SHAPES) {
  test(`malformed attribution_ref (${label}) is reported, never projected as canonical`, async () => {
    const data = await readWith(refYaml);
    assert.equal(
      'attribution_ref' in data,
      false,
      `${label}: a malformed anchor must not enter the projection (CLI projects nothing here either — one shape, one read law)`,
    );
    const fieldIssues = (data.field_issues ?? []) as Array<Record<string, unknown>>;
    assert.ok(
      fieldIssues.some((issue) => issue.path === 'attribution_ref'),
      `${label}: the reader must say why; got ${JSON.stringify(fieldIssues)}`,
    );
  });
}
