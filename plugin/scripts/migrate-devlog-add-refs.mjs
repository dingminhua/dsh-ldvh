/**
 * 一次性存量迁移：为 8 份 DevLog 条目补登记 `refs`（内容关联）。
 *
 * 背景（02 §7.1 / §8.2、29 §8 / §11 / §12.3bis，Human 裁定 2026-11-02）：
 * `refs` 原先是 `spark` 采用额关联引用型字段（条目侧登记
 * 自己与哪些事实对象有内容依据／输入／相关），`devlog` 明文不采用。Human 裁定把
 * 采用面扩到 `devlog`——DevLog 承载「脱离执行载体仍承重的结论」，其结论的来源依据、
 * 输入对象与相关事项同样需要一个可解析的承载位，否则卡片上永远看不到关联。
 *
 * 存量处置口径：逐条据**该条正文的「去向」段与实测段**判定关联对象，由本脚本
 * 驱动、每条仍走各自的受控写入（CAS + 机械校验 + Code 署名 change_log）——
 * 与 2026-10 撤 `serves`、2026-11-02 撤 `impact` 时同一纪律。
 *
 * 覆盖范围如实限定：本次只**新增** `refs` 字段，正文逐字继承，状态判定不变。
 * `d5187ddf` 无可解析的关联对象——它的承接物是规范正文（`specs/11 §6.1`）与一个
 * 明文登记「未落档」的 Pitfall，两者都不是事实对象，按 29 §8「不存在时省略」的
 * 口径不写 `refs`（写空数组会伪造条件字段，03 §6.1）。
 *
 * 用法：node scripts/migrate-devlog-add-refs.mjs [--dry-run] [--uid=<uuid>]
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDevLogObject, updateDevLogObject } from '../lib/devlog-writer.js';
import { shellAuthoritativeSignature } from '../lib/session-signature.js';

// `URL.pathname` 不是文件系统路径（Windows 上给出 `/D:/...`），用 fileURLToPath。
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
/** 事实源根：writer 在 factSourceRoot 下拼 devlogs/，故取 ldvh-base。 */
const FACT_SOURCE_ROOT = join(REPO, 'ldvh-base');
const DEVLOGS = join(FACT_SOURCE_ROOT, 'devlogs');

const DRY = process.argv.includes('--dry-run');
const ONLY_UID = (process.argv.find((a) => a.startsWith('--uid=')) ?? '').slice('--uid='.length) || null;

/**
 * 逐条的关联对象登记表。每条都注明**判定依据**（该条正文的哪一段）——
 * `refs` 是内容关联，不是生命周期关系（02 §8.2 分工纪律），所以每一条都必须
 * 能从该条自身的事实里读出来，不能凭印象配对。
 */
const REFS_BY_UID = new Map([
  // 正文「背景」段：「源文档……（2026-10-18 形成）」
  ['302ee25a-630b-4a3f-94f0-1e1947cdd176', {
    targets: ['996e207a-3ca2-494b-bcbe-3f00d7c0c3b7'],
    basis: '正文「背景」段指明源文档（内容依据）',
  }],
  // 正文「做法/实测」段：该条的实测对象是「经验积累审核链路」，承接物为七个
  // Pitfall（§4.1、§4.2、§4.3、§4.4(a)、§4.4(b)、§4.4(c)、§4.5 各落一个），
  // 七个根因与该条实测一一对应。
  ['304ec293-d4f7-40fe-baf7-3b4111533ccf', {
    targets: [
      '4a8fcb7c-76a4-42bf-8ccb-6de07d59c4aa',
      '25fb24b7-99fd-443e-a2eb-ecb24934e1e6',
      '318bd274-888e-46e0-b22f-4d4cecf4fe8e',
      '2236bdbb-a55a-4907-824c-df989987e704',
      '773b7d1d-d259-4bd2-99bc-958b5592f8a9',
      '96d189b5-4854-40a5-9111-9aac4820531f',
      '6fa942d7-e4e9-419f-ad70-87c9ca91df31',
    ],
    basis: '正文「去向」段登记的七个承接 Pitfall（§4.1–§4.5 各一处，根因与本条实测一一对应）',
  }],
  // 正文「做法」段：「关系边容量无公共契约（归 spark-cdc8bf7d）」
  ['3a7701c2-c9a6-49b1-9647-85eb8d8b6544', {
    targets: ['cdc8bf7d-f38f-4616-8cde-5c9bd50a8b0b'],
    basis: '正文指认关系边容量无公共契约，归 spark-cdc8bf7d',
  }],
  // 正文「做法」段：「与 pitfall-f4504267 的否定式守卫变异纪律同源」
  ['b322b2dc-bcda-4868-b97f-8b21028b3a43', {
    targets: ['f4504267-a2fa-4a12-a1e1-028c1e7bda46'],
    basis: '正文指认与 pitfall-f4504267 的否定式守卫变异纪律同源',
  }],
  // 正文「实测」段：审计条数与结论逐条对照这两份交付件
  ['bc4ba39a-8b3a-4a98-b62d-cf1a06948d21', {
    targets: [
      '996e207a-3ca2-494b-bcbe-3f00d7c0c3b7',
      'c36b0208-cdcf-423d-94e1-e1c735562897',
    ],
    basis: '正文「实测」段逐条对照这两份交付件的审计条数与结论',
  }],
  // 正文「背景」段称源文档是交付件；实测段另有
  // spark-2074408b（refs 目标退化渲染）。
  ['caf4287c-05d8-4a6a-981f-a1cd742269b2', {
    targets: [
      '996e207a-3ca2-494b-bcbe-3f00d7c0c3b7',
      '2074408b-6fc4-441b-aeaf-ee78f9678fd7',
    ],
    basis: '正文「背景」段指明源文档是交付件，实测段另涉 spark-2074408b',
  }],
  // 正文反复以交付件编号指称候选来源。
  ['fe069cc7-f235-4a90-9680-74466e09301c', {
    targets: ['996e207a-3ca2-494b-bcbe-3f00d7c0c3b7'],
    basis: '正文反复以交付件编号指称候选来源',
  }],
]);

/**
 * 明知无可解析关联对象、故不写 `refs` 的条目（29 §8「不存在时省略」）。
 * 它的承接物是规范正文与一个明文登记「未落档」的 Pitfall——都不是事实对象，
 * 按 02 §8.2 的目标可解析要求，登记一个解析不了的 uid 只会被机械层拒绝，
 * 登记空数组又会伪造条件字段（03 §6.1）。故如实不写。
 */
const NO_TARGET_BY_UID = new Map([
  ['d5187ddf-e7db-47d5-8e07-4b7bb4d9af0f', '承接物为规范正文（specs/11 §6.1）与一个明文登记「未落档」的 Pitfall，无可解析的事实对象 uid'],
]);

const CHANGE_SUMMARY_PREFIX =
  '登记内容关联 refs（29 §8 / §11 / §12.3bis，2026-11-02 Human 裁定扩采用面）：'
  + '条目侧登记自己与哪些事实对象有内容关联——';

const files = (await readdir(DEVLOGS)).filter((f) => f.endsWith('.md')).sort();
const signature = DRY ? null : await shellAuthoritativeSignature();
if (!DRY && signature === null) {
  console.error('ABORT: 权威签名不可得（非 DSH shell 子进程会话）。'
    + '不带签名的写入会落无署名 change_log（09 路由不可用的既定形态），'
    + '但存量迁移属受控写入，应在有署名条件下执行。');
  process.exit(1);
}

let ok = 0;
let skipped = 0;
const failures = [];

for (const name of files) {
  const file = join(DEVLOGS, name);
  const raw = await readFile(file, 'utf8');
  const m = raw.match(/^object_uid:\s*(\S+)\s*$/m);
  const uid = m ? m[1] : null;
  if (!uid) { failures.push({ name, code: 'local/uid_unresolvable', message: '文件内无 object_uid 行' }); continue; }
  // --uid 是单条试跑用：只处理该条。若不门控而只替换读取目标，循环会把同一条
  // 读 8 遍（首轮试跑实测如此——第一次写成功后其余全报「已登记」，那是巧合
  // 不是设计）。
  if (ONLY_UID && uid !== ONLY_UID) continue;

  const plan = REFS_BY_UID.get(uid);
  const noTarget = NO_TARGET_BY_UID.get(uid);
  if (!plan && !noTarget) {
    failures.push({ name, code: 'local/no_plan', message: '无逐条判定方案——不得凭印象配对（02 §8.2）' });
    continue;
  }

  const read = await readDevLogObject({ factSourceRoot: FACT_SOURCE_ROOT, objectUid: uid });
  if (!read.ok) { failures.push({ name, code: read.error.code, message: read.error.message }); continue; }

  if (!plan) {
    skipped += 1;
    console.log(`skip  ${name}  ${noTarget}——不写 refs（29 §8「不存在时省略」）`);
    continue;
  }

  const existing = read.value.frontmatter.refs;
  if (Array.isArray(existing) && existing.length > 0) {
    skipped += 1;
    console.log(`skip  ${name}  已登记 refs（${existing.length} 项），不动`);
    continue;
  }

  const refs = plan.targets.map((object_uid) => ({ object_uid }));

  if (DRY) {
    console.log(`plan  ${name}  →  refs ${refs.length} 项  ${plan.targets.join(', ')}`);
    console.log(`      依据：${plan.basis}`);
    continue;
  }

  // 正文原样传回（含 H1——29 §9 的 H1 由 Code 从 title 生成，写入侧按载体原样
  // 承载；本脚本不改一个字）。
  const result = await updateDevLogObject({
    factSourceRoot: FACT_SOURCE_ROOT,
    objectUid: uid,
    expectedFingerprint: read.value.fingerprint,
    frontmatterAfter: { refs },
    frontmatterRemovals: null,
    bodyMarkdownAfter: read.value.body,
    changeSummary: `${CHANGE_SUMMARY_PREFIX}${plan.basis}。正文与状态判定逐字不变。`,
    sessionSignature: signature,
  });

  if (result.ok) {
    ok += 1;
    console.log(`done  ${name}  refs ${refs.length} 项  →  ${result.value.fingerprint}`);
  } else {
    failures.push({ name, code: result.error.code, message: result.error.message });
    console.log(`FAIL  ${name}  ${result.error.code}: ${result.error.message}`);
  }
}

console.log(`\n${DRY ? 'DRY-RUN' : 'APPLIED'}: 补登记 refs ${ok} 条，跳过 ${skipped} 条，失败 ${failures.length}`);
if (failures.length > 0) {
  console.log('失败清单（逐条如实，不静默）：');
  for (const f of failures) console.log(`  ${f.name}  ${f.code}: ${f.message}`);
  process.exitCode = 1;
}
