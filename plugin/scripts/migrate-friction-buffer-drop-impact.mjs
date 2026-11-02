/**
 * 一次性存量迁移：清除宿主侧**摩擦观察缓冲**条目上的 `impact` 字段。
 *
 * ## 为什么需要独立脚本
 *
 * `migrate-friction-drop-impact.mjs`（2026-11-02）只处理 `ldvh-base/frictions/` 下的
 * **事实对象**（68 份账本）。摩擦观察缓冲是**宿主侧载体**（`~/.dsh/ldvh/friction-observations/`），
 * 不属事实源、不走受控写入，因此那份脚本完全没有触及它——于是出现「规范改了、代码改了、
 * 账本迁了，运行态载体没迁」的漏项。
 *
 * 后果是硬停摆：`FRICTION_OBSERVATION_FIELDS`（lib/friction-observation-buffer.js:117）
 * 已不含 `impact`，`validateStoredEntry`（同文件 :495）把「闭集之外的字段」判 invalid，
 * `parseCarrierText` 于是把带 impact 的条目全丢进 invalid，
 * `loadObservationDedupCandidates`（lib/friction-discovery.js）见到 invalid 非空即返回
 * `friction_observation/dedup_input_incomplete`，`runIdleCheckpoint` 按 11 §12 第 6 条
 * fail-closed 停止——**摩擦发现通道因读不出自己的缓冲而每轮停摆**。
 *
 * ## 授权（本脚本的前提，不可省略）
 *
 * 11 §12bis.1 的两段「迁移与存量」只覆盖 observing 清零与 2026-10-30 扩项清零，**没有
 * 字段撤销后存量条目如何处置的条款**；而 11:559 的载体纪律写的是「内容字段一经写入不得
 * 就地修改」。因此就地删键必须先有一次 Human 的一次性授权。本脚本把该授权记录在
 * `HUMAN_AUTHORIZATION` 常量里，并在运行时把它写进迁移痕迹，使「凭什么改」可回读。
 *
 * 授权范围**如实限定**：仅删 `impact` 一个键，其余 14 个字段逐字保留，不新增条目、
 * 不改 status、不重排、不删除任何行。
 *
 * ## 为什么整文件改写而非逐条追加
 *
 * 11:559 的「追加 + 状态结算」针对的是**条目内容**的演进（新观察追加为新条目、状态变化
 * 写 settle 行）。字段撤销是**载体格式迁移**，与「淘汰按容量与保留期整条移除，移除不是
 * 修改」同源——本脚本属于格式迁移，不动任何语义字段。迁移后 `validateStoredEntry` 对
 * 每条返回 null，即「迁移后载体重新合法」是机械可判的完成判据。
 *
 * 用法：
 *   node scripts/migrate-friction-buffer-drop-impact.mjs [--dry-run] [--project=<id>]
 *
 * 退出码：0 = 全部成功或无需迁移；1 = 存在失败（逐条列出，不静默）。
 */
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import {
  frictionObservationPath,
  validateStoredEntry,
} from '../lib/friction-observation-buffer.js';

/**
 * Human 授权记录。逐字写进迁移痕迹（`<载体>.migration.json`），使「凭什么就地删键」
 * 在事后可回读，且范围与脚本行为一一对应。
 */
const HUMAN_AUTHORIZATION =
  'Human（老丁）2026-11-03 会话内的明确授权：「两处存量数据迁移是否现在授权？'
  + '缓冲 59 条删 impact（先备份）」选择「授权两处迁移，先备份」。'
  + '授权范围：dsh-ldvh 项目的摩擦观察缓冲，仅删除已退出 §12bis.1 闭集的 impact 键，'
  + '其余字段逐字保留、不新增条目、不改 status。依据为 2026-11-02 Human 裁定撤销影响'
  + '评级分级制度（26 §8 / §12bis.1 字段闭集 15→14）；11 §12bis.1 无对应存量处置条款，'
  + '故本授权是一次性的、只覆盖本次迁移。';

const DRY = process.argv.includes('--dry-run');
const PROJECT = (process.argv.find((a) => a.startsWith('--project=')) ?? '').slice('--project='.length) || 'dsh-ldvh';

const HOME = (...parts) => join(resolveDshHome(), ...parts);
const carrier = frictionObservationPath(HOME, PROJECT);

/**
 * 授权只覆盖一个键。脚本**不**删除任何其他越界键——即便载体里还有别的越界字段，
 * 也不在本授权范围内，应作为失败报出交给 Human，而不是顺手清掉。
 */
const AUTHORIZED_DROP = 'impact';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').replace('Z', '');
}

async function main() {
  let raw;
  try {
    raw = await readFile(carrier, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.log(`载体不存在，无需迁移：${carrier}`);
      return 0;
    }
    throw error;
  }

  const lines = raw.split('\n');
  const rewritten = [];
  let total = 0;
  let changed = 0;
  const failures = [];

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      rewritten.push(line);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      // 残缺行原样保留：它们的处置不属于本次授权（授权只覆盖删 impact 键）。
      failures.push({ line: index + 1, code: 'local/unparsable', message: String(error?.message ?? error) });
      rewritten.push(line);
      continue;
    }
    total += 1;
    if (!Object.prototype.hasOwnProperty.call(parsed, AUTHORIZED_DROP)) {
      rewritten.push(line);
      continue;
    }
    // 只删授权覆盖的那一个键，其余键序与值逐字保留（不重建对象、不排序）。
    const next = {};
    for (const key of Object.keys(parsed)) {
      if (key === AUTHORIZED_DROP) continue;
      next[key] = parsed[key];
    }
    // `settled_at` 是 §12bis.1 明文允许的记账字段（friction-observation-buffer.js:171
    // 的 STORED_FIELDS = 语义闭集 ∪ {settled_at}），故删 impact 后仍会通过校验；
    // 若校验不过，说明还有其他越界键——那不在本次授权范围内，如实报失败、不顺手清。
    const problem = validateStoredEntry(next);
    if (problem !== null) {
      failures.push({ line: index + 1, code: 'local/still_invalid', message: problem });
      rewritten.push(line);
      continue;
    }
    changed += 1;
    rewritten.push(JSON.stringify(next));
  }

  console.log(`载体：${carrier}`);
  console.log(`条目总数 ${total}，需要迁移 ${changed} 条，越界键：${changed > 0 ? AUTHORIZED_DROP : '（无）'}`);

  if (DRY) {
    console.log('\nDRY-RUN：未写入任何字节。');
    return failures.length > 0 ? 1 : 0;
  }
  if (changed === 0) {
    console.log('无需迁移（载体已合规），未写入任何字节。');
    return failures.length > 0 ? 1 : 0;
  }

  // 迁移前备份（完成判据之一：备份在 ~/.dsh/ldvh/ 下且可由文件名追溯本次迁移）。
  const backup = join(dirname(carrier), `${PROJECT}.jsonl.bak-before-drop-impact-${stamp()}`);
  await copyFile(carrier, backup);
  console.log(`备份：${backup}`);

  // 原子替换：临时文件 + rename，读者不会看到半截载体。
  const temp = `${carrier}.tmp-${randomUUID()}`;
  await writeFile(temp, rewritten.join('\n'), 'utf8');
  await rename(temp, carrier);

  // 迁移痕迹（不是事实对象，不参与受控写入）——记下授权依据与影响面。
  const tracePath = `${carrier}.migration.json`;
  const previous = await readFile(tracePath, 'utf8').then((t) => JSON.parse(t)).catch(() => null);
  const record = {
    carrier,
    at: new Date().toISOString(),
    dropped_fields: changed > 0 ? [AUTHORIZED_DROP] : [],
    entries_total: total,
    entries_migrated: changed,
    backup,
    human_authorization: HUMAN_AUTHORIZATION,
    spec_basis: '11 §12bis.1（2026-11-02 字段闭集 15→14，impact 撤销）；26 §8',
    previous: previous ?? null,
  };
  await writeFile(tracePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`痕迹：${tracePath}`);
  console.log(`\nAPPLIED：迁移 ${changed} 条，失败 ${failures.length} 条。`);
  if (failures.length > 0) {
    console.log('失败清单（逐条如实，不静默）：');
    for (const f of failures) console.log(`  line ${f.line}  ${f.code}: ${f.message}`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
