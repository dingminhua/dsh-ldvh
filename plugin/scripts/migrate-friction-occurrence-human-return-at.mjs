import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrictionObject, correctFrictionObject } from '../lib/friction-writer.js';
import { stripLeadingH1 } from '../lib/friction-discovery.js';
import { shellAuthoritativeSignature } from '../lib/session-signature.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const FACT_SOURCE_ROOT = join(REPO, 'ldvh-base');
const FRICTIONS = join(FACT_SOURCE_ROOT, 'frictions');

const DRY = process.argv.includes('--dry-run');
const ONLY_UID = (process.argv.find((a) => a.startsWith('--uid=')) ?? '').slice('--uid='.length) || null;

const HUMAN_AUTHORIZATION =
  'Human（老丁）2026-11-03 会话内明确授权：「两处存量数据迁移是否现在授权？」选择「授权两处迁移，'
  + '先备份」，授权范围含「23 份终态账目删 occurrence.human_return_at（走 correct，三值不变）」。'
  + '依据：该子件已于 2026-10 随「放回留观」流转退出 26 §8 闭集（validateOccurrenceShape 只认 '
  + 'count/first_at/last_at），终态对象无法经受控更新触及，correct 的 removals+additions 是唯一'
  + '受控清除途径。本条授权仅覆盖删除该嵌套子件并原值回填三值，正文与终态判定逐字不变。';

const SUMMARY_BASE =
  '清除 occurrence 内的已退出子件 human_return_at（26 §8 闭集收缩存量处置）：'
  + '该子件随 2026-10「放回留观」流转退出闭集，终态对象经受控更正显式删除 occurrence '
  + '并以同值回填 count／first_at／last_at 三项——非改值、非计数，正文与终态判定逐字不变。';

function makeCommitResolver(cwd) {
  return async (hash) => {
    if (typeof hash !== 'string' || !/^[0-9a-f]{40}$/i.test(hash)) return false;
    return new Promise((resolve) => {
      execFile('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd }, (err) => resolve(!err));
    });
  };
}
const gitCommitResolver = makeCommitResolver(REPO);

async function uidOf(file) {
  const text = await readFile(file, 'utf8');
  const m = text.match(/^object_uid:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

const files = (await readdir(FRICTIONS)).filter((f) => f.endsWith('.md')).sort();
const signature = DRY ? null : await shellAuthoritativeSignature();
if (!DRY && signature === null) {
  console.error('ABORT: 权威签名不可得（非 DSH shell 子进程会话）。'
    + '不带签名的写入会落无署名 change_log（09 路由不可用的既定形态），'
    + '但存量迁移属受控写入，应在有署名条件下执行。');
  process.exit(1);
}

let scanned = 0;
let ok = 0;
let alreadyClean = 0;
const failures = [];

for (const name of files) {
  const file = join(FRICTIONS, name);
  const raw = await readFile(file, 'utf8');
  if (!/human_return_at/.test(raw)) continue;

  const uid = await uidOf(file);
  if (!uid) { failures.push({ name, code: 'local/uid_unresolvable', message: '文件内无 object_uid 行' }); continue; }
  if (ONLY_UID && uid !== ONLY_UID) continue;

  const read = await readFrictionObject({ factSourceRoot: FACT_SOURCE_ROOT, objectUid: uid });
  if (!read.ok) { failures.push({ name, code: read.error.code, message: read.error.message }); continue; }

  const fm = read.value.frontmatter;
  const occ = fm?.occurrence;
  if (occ === null || typeof occ !== 'object' || !Object.prototype.hasOwnProperty.call(occ, 'human_return_at')) {
    alreadyClean += 1;
    continue;
  }
  scanned += 1;

  const before = { count: occ.count, first_at: occ.first_at, last_at: occ.last_at };
  const carried = occ.human_return_at;

  if (DRY) {
    console.log(`plan  ${name}  status=${fm.status}  count=${before.count}  human_return_at=${JSON.stringify(carried)}  →  correct(removals+additions)`);
    continue;
  }

  const carriedNote = carried === null || carried === undefined
    ? '（该子件原值为 null，无信息损失。）'
    : `（该子件原有取值 ${JSON.stringify(carried)}，随删除不再保留于 frontmatter，此处如实登记以免静默丢失。）`;

  const result = await correctFrictionObject({
    factSourceRoot: FACT_SOURCE_ROOT,
    objectUid: uid,
    expectedFingerprint: read.value.fingerprint,
    bodyMarkdownAfter: stripLeadingH1(read.value.body),
    frontmatterRemovals: ['occurrence'],
    frontmatterAdditions: { occurrence: before },
    changeSummary: `${SUMMARY_BASE}${carriedNote}`,
    humanAuthorization: HUMAN_AUTHORIZATION,
    sessionSignature: signature,
    gitCommitResolver,
  });

  if (!result.ok) {
    failures.push({ name, code: result.error.code, message: result.error.message });
    console.log(`FAIL  ${name}  status=${fm.status}  ${result.error.code}: ${result.error.message}`);
    continue;
  }

  const after = await readFrictionObject({ factSourceRoot: FACT_SOURCE_ROOT, objectUid: uid });
  if (!after.ok) {
    failures.push({ name, code: 'local/readback_failed', message: after.error.message });
    console.log(`FAIL  ${name}  readback: ${after.error.message}`);
    continue;
  }
  const occAfter = after.value.frontmatter.occurrence ?? {};
  const same = occAfter.count === before.count
    && occAfter.first_at === before.first_at
    && occAfter.last_at === before.last_at;
  const gone = !Object.prototype.hasOwnProperty.call(occAfter, 'human_return_at');
  if (!same || !gone) {
    failures.push({
      name,
      code: 'local/postcondition_failed',
      message: `three-values-intact=${same} human_return_at-removed=${gone} after=${JSON.stringify(occAfter)}`,
    });
    console.log(`FAIL  ${name}  后置条件不满足：三值不变=${same}，子件已删=${gone}`);
    continue;
  }

  ok += 1;
  console.log(`done  ${name}  status=${fm.status}  count=${before.count}  →  ${result.value.fingerprint}`);
}

console.log(`\n${DRY ? 'DRY-RUN' : 'APPLIED'}: occurrence 内命中 human_return_at ${scanned} 份，成功 ${ok}，仅正文提及 ${alreadyClean}，失败 ${failures.length}`);
if (failures.length > 0) {
  console.log('失败清单（逐条如实，不静默）：');
  for (const f of failures) console.log(`  ${f.name}  ${f.code}: ${f.message}`);
  process.exitCode = 1;
}
