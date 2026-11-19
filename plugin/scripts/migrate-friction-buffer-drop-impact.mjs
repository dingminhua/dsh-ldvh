import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import {
  frictionObservationPath,
  validateStoredEntry,
} from '../lib/friction-observation-buffer.js';

const HUMAN_AUTHORIZATION =
  'Human（老丁）2026-11-03 会话内的明确授权：「两处存量数据迁移是否现在授权？'
  + '缓冲 59 条删 impact（先备份）」选择「授权两处迁移，先备份」。'
  + '授权范围：dsh-ldvh 项目的摩擦观察缓冲，仅删除已退出 §12bis.1 闭集的 impact 键，'
  + '其余字段逐字保留、不新增条目、不改 status。依据为 2026-11-02 Human 裁定撤销影响'
  + '评级分级制度（26 §8 / §12bis.1 字段闭集 15→14）；36 §8.8 无对应存量处置条款，'
  + '故本授权是一次性的、只覆盖本次迁移。';

const DRY = process.argv.includes('--dry-run');
const PROJECT = (process.argv.find((a) => a.startsWith('--project=')) ?? '').slice('--project='.length) || 'dsh-ldvh';

const HOME = (...parts) => join(resolveDshHome(), ...parts);
const carrier = frictionObservationPath(HOME, PROJECT);

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
      failures.push({ line: index + 1, code: 'local/unparsable', message: String(error?.message ?? error) });
      rewritten.push(line);
      continue;
    }
    total += 1;
    if (!Object.prototype.hasOwnProperty.call(parsed, AUTHORIZED_DROP)) {
      rewritten.push(line);
      continue;
    }
    const next = {};
    for (const key of Object.keys(parsed)) {
      if (key === AUTHORIZED_DROP) continue;
      next[key] = parsed[key];
    }
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

  const backup = join(dirname(carrier), `${PROJECT}.jsonl.bak-before-drop-impact-${stamp()}`);
  await copyFile(carrier, backup);
  console.log(`备份：${backup}`);

  const temp = `${carrier}.tmp-${randomUUID()}`;
  await writeFile(temp, rewritten.join('\n'), 'utf8');
  await rename(temp, carrier);

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
    spec_basis: '36 §8.8（2026-11-02 字段闭集 15→14，impact 撤销）；26 §8',
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
