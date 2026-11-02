/**
 * 一次性存量迁移：清除 23 份终态摩擦账目 `occurrence` 内的历史子件 `human_return_at`。
 *
 * ## 背景
 *
 * `human_return_at` 随 2026-10 的「放回留观」流转一并退出 26 §8 闭集
 * （`validateOccurrenceShape` 只认 `{ count, first_at, last_at }`，
 * friction-writer.js:142）。但 `migrate-friction-drop-impact.mjs`（2026-11-02）
 * 只对 **open** 存量顺手清了这一子件（其 `updateFrictionObject` 走整体 frontmatter
 * 校验，不清就会被拒），**终态存量没有对应处置**——终态经 `update` 只读，
 * 只有 `correct` 能触及，而当时无人补这一步。
 *
 * 后果不是停摆而是**落地失败**：审核层对 open 账目做补充级更新时，写入侧对**整个**
 * frontmatter 重跑机械校验，`occurrence` 里残留的 `human_return_at` 令校验失败、
 * 整条更新被拒。pending-queue 里 47 条
 * 「闭集落地失败（supplement）：11 §9 第 4 项（补充级更新）失败：updated frontmatter
 * failed mechanical checks」，残留逐字为
 * `occurrence field "human_return_at" is outside the §8 closed set { count, first_at, last_at }`，
 * 区间 2026-10-27T05:53:18.306Z ~ 2026-10-29T20:45:20.561Z。
 *
 * ## 通道
 *
 * 终态对象（resolved/voided/accepted）走 `correctFrictionObject`，在**同一次调用内**
 * 先 `frontmatterRemovals: ["occurrence"]` 再 `frontmatterAdditions: { occurrence: {...} }`
 * —— removals 循环在 additions 之前（friction-writer.js:1211 → :1252），且 additions
 * 有「已存在即拒绝」闸（:1267），两段必须同批，分两次调用会因第二次时字段已存在被拒。
 *
 * ## 三条不可让步的约束
 *
 * 1. **三值逐字不变**：`count`/`first_at`/`last_at` 取原载值原样回填，脚本逐条断言
 *    迁移前后相等，任一不等即判该条失败。
 * 2. **被删子件的值不静默消失**：实测 23 份里 20 份 `human_return_at` 为 `null`，
 *    另有 **3 份带真实时间戳**（`2026-10-11T22:31:56.000Z`）。带值者的原值逐条写进
 *    本次 change_log 摘要——这不是「保留字段」，而是让「删掉了什么」事后可查。
 * 3. **逐对象走受控入口**：每条各自 CAS、各自机械校验、各自一条 change_log，本脚本
 *    只作批处理驱动（26 §14.2「无批量迁移入口」的如实重申）。单条失败不阻断其余。
 *
 * 用法：node scripts/migrate-friction-occurrence-human-return-at.mjs [--dry-run] [--uid=<uuid>]
 */
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

/**
 * Human 授权记录（correct 强制要求，且会逐字写进 change_log）。
 * 范围如实限定：只删 `occurrence` 内的 `human_return_at` 子件，三值原样回填。
 */
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

/** 从文件内 `object_uid:` 行取 uid（文件名与 uid 可能不同步）。 */
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
  // 快速筛：frontmatter 里出现该词才继续（正文/change_log 提到不算——故下面还要解析复核）。
  if (!/human_return_at/.test(raw)) continue;

  const uid = await uidOf(file);
  if (!uid) { failures.push({ name, code: 'local/uid_unresolvable', message: '文件内无 object_uid 行' }); continue; }
  if (ONLY_UID && uid !== ONLY_UID) continue;

  const read = await readFrictionObject({ factSourceRoot: FACT_SOURCE_ROOT, objectUid: uid });
  if (!read.ok) { failures.push({ name, code: read.error.code, message: read.error.message }); continue; }

  const fm = read.value.frontmatter;
  const occ = fm?.occurrence;
  if (occ === null || typeof occ !== 'object' || !Object.prototype.hasOwnProperty.call(occ, 'human_return_at')) {
    // 只在正文或 change_log 里提到该词——不是本脚本的目标，不计入命中。
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

  // 带真实时间戳的子件：把原值写进摘要，使「删掉了什么」事后可查（约束 2）。
  const carriedNote = carried === null || carried === undefined
    ? '（该子件原值为 null，无信息损失。）'
    : `（该子件原有取值 ${JSON.stringify(carried)}，随删除不再保留于 frontmatter，此处如实登记以免静默丢失。）`;

  const result = await correctFrictionObject({
    factSourceRoot: FACT_SOURCE_ROOT,
    objectUid: uid,
    // CAS：读到的指纹就是基线，期间任何他人写入都会令本条失败而非覆盖。
    expectedFingerprint: read.value.fingerprint,
    bodyMarkdownAfter: stripLeadingH1(read.value.body),
    // 同一次调用内：先删 occurrence，再以同值补回三项（顺序有机械保证）。
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

  // 读回断言：三值逐字不变、human_return_at 已不存在（约束 1，机械可判）。
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
