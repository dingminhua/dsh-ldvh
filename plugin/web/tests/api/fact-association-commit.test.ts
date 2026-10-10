import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { showObject } from '../../api/services/facts.ts';
import { type LocalFactScope } from '../../api/services/localFactReader.ts';

/**
 * 02 §8.1「commit 形态」在读取层的回归。
 *
 * 缺陷形态：解药是一次受控提交（target 直接取 commit、无对象身份）时，
 * `projectFactAssociationTarget` 返回 null → 整条被判 available:false →
 * 列表卡片与详情页都显示「关联信息不可用」。提交明明可用（写侧已用
 * `git cat-file -e` 核过），却被读成了「不可用」，这是两件不同的事。
 */

const FRICTION_UID = '0198f1c7-8a2b-4c3d-9e4f-123456789abc';
const COMMIT = 'e4e178fd7e3293f47003ed0150ab1128cc6ae0ef';

function frictionWithRelation(targetYaml: string): string {
  return `---
object_uid: ${FRICTION_UID}
fact_type_key: friction
title: Fixture friction
status: resolved
impact: light
phenomenon: "fixture phenomenon"
relations:
  - relation_key: informs
    target:
${targetYaml}
---

## 现象

fixture phenomenon

## 入账依据

fixture basis

## 处置

fixture disposition
`;
}

async function readFriction(targetYaml: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-web-commitassoc-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    const dir = path.join(root, 'ldvh-base', 'frictions');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `friction-${FRICTION_UID}.md`), frictionWithRelation(targetYaml), 'utf8');
    const result = await showObject(`friction-${FRICTION_UID}`, scope);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    return result.data;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('commit-form target projects as an AVAILABLE association (02 §8.1)', async () => {
  const data = await readFriction(`      commit: ${COMMIT}`);
  const associations = data.factAssociations as Array<Record<string, unknown>>;
  assert.equal(associations.length, 1);
  assert.equal(associations[0].available, true, 'a commit remedy is available — it must not read as 「关联信息不可用」');
  assert.equal(associations[0].relationKey, 'informs');
  assert.deepEqual(associations[0].target, { commit: COMMIT });
  assert.equal(associations[0].shortHash, COMMIT.slice(0, 7));
});

test('malformed commit targets stay unavailable rather than rendering as commits', async () => {
  // 短 hash / 非 hex / ref 名 / 混带 object_uid —— 形状纪律在读取层同样成立：
  // 不得被渲染成一个「像 commit」的目标（写侧已拒，读取侧不得放宽）。
  const cases: Array<[string, string]> = [
    ['short hash', '      commit: abc1234'],
    ['non-hex', '      commit: ' + 'z'.repeat(40)],
    ['ref name', '      commit: refs/heads/main'],
    ['mixed with object_uid', `      object_uid: ${FRICTION_UID}\n      commit: ${COMMIT}`],
  ];
  for (const [label, targetYaml] of cases) {
    const data = await readFriction(targetYaml);
    const associations = (data.factAssociations ?? []) as Array<Record<string, unknown>>;
    // 既有关闭设计：解析失败的关系**保留**但标 available:false（可见性优先，
    // 让读者知道存在一条指不出处的关联）。故此处不断言条目消失，只断言它
    // **不得被当成一个 commit 目标**——否则界面上会出现一个点不开或跳错
    // 地方的「像提交」的目标。
    for (const association of associations) {
      assert.notEqual(association.available, true, `${label} must not read as an available commit association`);
      assert.ok(
        !('commit' in ((association.target ?? {}) as Record<string, unknown>)),
        `${label} must not project a commit target`,
      );
    }
  }
});
