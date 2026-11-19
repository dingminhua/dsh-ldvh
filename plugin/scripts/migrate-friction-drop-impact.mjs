import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readFrictionObject,
  updateFrictionObject,
  correctFrictionObject,
} from '../lib/friction-writer.js';
import { stripLeadingH1 } from '../lib/friction-discovery.js';
import { shellAuthoritativeSignature } from '../lib/session-signature.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const FACT_SOURCE_ROOT = join(REPO, 'ldvh-base');
const FRICTIONS = join(FACT_SOURCE_ROOT, 'frictions');

const DRY = process.argv.includes('--dry-run');
const ONLY_UID = (process.argv.find((a) => a.startsWith('--uid=')) ?? '').slice('--uid='.length) || null;

const HUMAN_AUTHORIZATION =
  'Human（老丁）2026-11-02 会话指令「摩擦取消 中 轻 重 这种分级制度」，'
  + '经 26 §8 撤销 impact 字段、§14.2 登记存量处置口径；'
  + '本条授权仅覆盖删除该 frontmatter 字段，正文与终态判定逐字不变。';

function makeCommitResolver(cwd) {
  return async (hash) => {
    if (typeof hash !== 'string' || !/^[0-9a-f]{40}$/i.test(hash)) return false;
    return new Promise((resolve) => {
      execFile('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd }, (err) => resolve(!err));
    });
  };
}
const gitCommitResolver = makeCommitResolver(REPO);

const OPEN_SUMMARY =
  '撤销影响评级（26 §8 2026-11-02）：删除 impact 字段——分级制度经 Human 裁定取消，'
  + '本对象为 open 存量，经受控更新显式删除，其余字段与正文逐字继承。';

const TERMINAL_SUMMARY =
  '删除 impact 字段（26 §14.2 2026-11-02 存量处置）：影响评级分级制度经 Human 裁定取消，'
  + '本对象为终态存量，经受控更正显式删除，正文与终态判定逐字不变。';

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
let withoutField = 0;
let ok = 0;
const failures = [];

for (const name of files) {
  const file = join(FRICTIONS, name);
  const raw = await readFile(file, 'utf8');
  if (!/^impact:/m.test(raw)) continue;
  scanned += 1;

  const uid = await uidOf(file);
  if (!uid) { failures.push({ name, code: 'local/uid_unresolvable', message: '文件内无 object_uid 行' }); continue; }
  if (ONLY_UID && uid !== ONLY_UID) continue;

  const read = await readFrictionObject({ factSourceRoot: FACT_SOURCE_ROOT, objectUid: uid });
  if (!read.ok) { failures.push({ name, code: read.error.code, message: read.error.message }); continue; }
  if (!Object.prototype.hasOwnProperty.call(read.value.frontmatter, 'impact')) {
    withoutField += 1;
    console.log(`skip  ${name}  status=${read.value.frontmatter.status}  （已无 impact 字段）`);
    continue;
  }
  const status = read.value.frontmatter.status;

  if (DRY) {
    console.log(`plan  ${name}  status=${status}  impact=${read.value.frontmatter.impact}  →  ${status === 'open' ? '受控更新' : '终态更正'}`);
    continue;
  }

  const bodyMarkdownAfter = stripLeadingH1(read.value.body);
  const common = {
    factSourceRoot: FACT_SOURCE_ROOT,
    objectUid: uid,
    expectedFingerprint: read.value.fingerprint,
    bodyMarkdownAfter,
    sessionSignature: signature,
    gitCommitResolver,
  };
  const occ = read.value.frontmatter.occurrence;
  const carriesRetiredNestedKey = occ !== null && typeof occ === 'object'
    && Object.prototype.hasOwnProperty.call(occ, 'human_return_at');
  const occurrenceCarry = carriesRetiredNestedKey
    ? { count: occ.count, first_at: occ.first_at, last_at: occ.last_at }
    : null;

  const result = status === 'open'
    ? await updateFrictionObject({
      ...common,
      frontmatterAfter: occurrenceCarry ? { occurrence: occurrenceCarry } : null,
      frontmatterRemovals: ['impact'],
      changeSummary: OPEN_SUMMARY
        + (occurrenceCarry
          ? '另显式承载 occurrence 的 count／first_at／last_at 三件，值与原载逐字相同'
            + '（仅不再携带 2026-10 已退出闭集的历史子件 human_return_at），非改值、非计数。'
          : ''),
    })
    : await correctFrictionObject({
      ...common,
      frontmatterRemovals: ['impact'],
      changeSummary: TERMINAL_SUMMARY,
      humanAuthorization: HUMAN_AUTHORIZATION,
    });

  if (result.ok) {
    ok += 1;
    console.log(`done  ${name}  status=${status}  →  ${result.value.fingerprint}`);
  } else {
    failures.push({ name, code: result.error.code, message: result.error.message });
    console.log(`FAIL  ${name}  status=${status}  ${result.error.code}: ${result.error.message}`);
  }
}

console.log(`\n${DRY ? 'DRY-RUN' : 'APPLIED'}: 命中 impact 字段 ${scanned} 份，成功 ${ok}，已无该字段 ${withoutField}，失败 ${failures.length}`);
if (failures.length > 0) {
  console.log('失败清单（逐条如实，不静默）：');
  for (const f of failures) console.log(`  ${f.name}  ${f.code}: ${f.message}`);
  process.exitCode = 1;
}
