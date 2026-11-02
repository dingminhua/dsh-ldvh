/**
 * 一次性存量迁移：清除 68 份摩擦账本的 `impact` 字段。
 *
 * 背景（26 §8 / §14.2，Human 裁定 2026-11-02）：摩擦的影响评级（light/medium/heavy）
 * 分级制度整体撤销。字段已从 26 §8 闭集移除，故**任何仍带 impact 的存量都是闭集
 * 违规**，必须与本次撤销同批清除——否则撤销只改了规范与代码，账本自身不合法。
 *
 * 两条通道（26 §14.2 已写明口径，与 2026-10 撤 `serves` 时同一纪律的第二次执行）：
 *   - `open`（25 份）→ 受控更新 `updateFrictionObject` 的 `frontmatterRemovals: ["impact"]`
 *     （磁盘基线 + 显式删除，其余字段逐字继承，02 §10.5）。
 *   - 终态 `resolved`/`voided`/`accepted`（43 份）→ `correctFrictionObject` 的
 *     `frontmatterRemovals: ["impact"]`。终态对象经受控更新会被 `friction/status_terminal`
 *     直接拒绝（26 §9.2 终态只读），只有更正通道能触及；`impact` 已加入
 *     `CORRECT_REMOVABLE_FIELDS`（friction-writer.js:75）正是为此。
 *
 * 正文一律**原样传回**（剥掉生成的 H1，写入侧重建）：本脚本只删字段，不改一个字。
 * correct 的 no-op 闸（26 §13）靠 `removedFields` 非空通过，不产生假更正记录。
 *
 * 逐条执行、失败即报不静默（26 §14.2「当前无批量迁移入口，逐个执行」——本脚本是
 * 批处理驱动，每条仍走各自的受控写入：CAS + 机械校验 + Code 署名 change_log）。
 * 单条失败不阻断其余（2026-10-31 的同一教训：队首阻塞会让一批变成一条）。
 *
 * 用法：node scripts/migrate-friction-drop-impact.mjs [--dry-run] [--uid=<uuid>]
 */
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

// `URL.pathname` 不是文件系统路径（Windows 上给出 `/D:/...`），用 fileURLToPath。
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
/** 事实源根：writer 在 factSourceRoot 下拼 frictions/，故取 ldvh-base。 */
const FACT_SOURCE_ROOT = join(REPO, 'ldvh-base');
const FRICTIONS = join(FACT_SOURCE_ROOT, 'frictions');

const DRY = process.argv.includes('--dry-run');
const ONLY_UID = (process.argv.find((a) => a.startsWith('--uid=')) ?? '').slice('--uid='.length) || null;

/**
 * Human 授权记录（correct 强制要求，且会逐字写进 change_log）。
 * 覆盖范围如实限定：授权的是「撤销分级制度 + 清除存量字段」这一件事，
 * 不含任何正文或终态判定的改动。
 */
const HUMAN_AUTHORIZATION =
  'Human（老丁）2026-11-02 会话指令「摩擦取消 中 轻 重 这种分级制度」，'
  + '经 26 §8 撤销 impact 字段、§14.2 登记存量处置口径；'
  + '本条授权仅覆盖删除该 frontmatter 字段，正文与终态判定逐字不变。';

/**
 * commit 形态关系目标的核验器：writer 不自行执行 git，resolver 由调用方注入
 * （02 §8.1）。未注入时该核验 fail-closed——这正是上面一批 `resolved` 对象全被
 * `relation_target_unresolvable` 拒掉的原因，不是那些 commit 不存在。与
 * lib/friction-tools.js 注入给同一 writer 的是同一判据（git cat-file -e <hash>^{commit}）。
 */
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

/** 从文件名的 object_uid 行取 uid（不靠文件名——文件名与 uid 可能不同步）。 */
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
  if (!/^impact:/m.test(raw)) continue; // 不含该字段的对象不动
  scanned += 1;

  const uid = await uidOf(file);
  if (!uid) { failures.push({ name, code: 'local/uid_unresolvable', message: '文件内无 object_uid 行' }); continue; }
  // --uid 是单条试跑用：只处理该文件。若不门控而只替换读取目标，循环会把同一个
  // 对象读 68 遍（首轮试跑实测如此——第一次写成功后其余全报「已无该字段」，
  // 恰好只写一条，但那是巧合不是设计）。
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

  // 正文原样传回（剥 H1，写入侧 assembleBody 重建）。
  const bodyMarkdownAfter = stripLeadingH1(read.value.body);
  const common = {
    factSourceRoot: FACT_SOURCE_ROOT,
    objectUid: uid,
    expectedFingerprint: read.value.fingerprint,
    bodyMarkdownAfter,
    sessionSignature: signature,
    gitCommitResolver,
  };
  // 遗留历史子件：`occurrence.human_return_at` 已于 2026-10 随「放回留观」流转退出
  // 闭集，但 4 份 open 存量仍携带它（值为 null）。受控更新会对**整个** frontmatter
  // 重跑机械校验（validateOccurrenceShape 只认 { count, first_at, last_at }），故
  // 只删 impact 会被 `friction/frontmatter_invalid` 拒。既有先例（2026-10-28 若干条
  // change_log 已登记）的处置是：显式承载 occurrence 三件、值与原载逐字相同，仅不再
  // 携带该 null 子件——非改值、非计数，且该清除须在 change_summary 里如实留痕。
  const occ = read.value.frontmatter.occurrence;
  const carriesRetiredNestedKey = occ !== null && typeof occ === 'object'
    && Object.prototype.hasOwnProperty.call(occ, 'human_return_at');
  const occurrenceCarry = carriesRetiredNestedKey
    ? { count: occ.count, first_at: occ.first_at, last_at: occ.last_at }
    : null;

  const result = status === 'open'
    // open：磁盘基线 + 显式删除。不声明任何字段变更（impact 只出现在 removals 里，
    // 故它已出闭集不会被「显式声明集」那一步拒），仅在需要时显式承载 occurrence。
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
    // 终态：correct 通道，impact ∈ CORRECT_REMOVABLE_FIELDS。
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
