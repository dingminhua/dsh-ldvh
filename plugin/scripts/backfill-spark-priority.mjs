/**
 * 一次性回填脚本：为 21 条 open Spark 补 priority 字段（20 §8，Human 裁定 A）。
 *
 * 走受控写入（updateSparkObject）：CAS + change_log + 精确回读。
 * 分档取自 docs/spark-priority-backfill-proposal.md（Human 确认按计划推进，
 * 保留随时临时调整的权力）。
 *
 * 用法：node scripts/backfill-spark-priority.mjs [--dry-run]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSparkObject, updateSparkObject } from '../lib/spark-writer.js';
import { authoritativeSignature } from '../lib/signature-channel.js';

const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
/** 事实源根：writer 在 factSourceRoot 下拼 sparks/，故取 ldvh-base。 */
const FACT_SOURCE_ROOT = join(REPO, 'ldvh-base');
const SPARKS = join(FACT_SOURCE_ROOT, 'sparks');
const DRY = process.argv.includes('--dry-run');

/** title → priority（来自已确认的回填建议表）。 */
const ASSIGNMENTS = {
  'Norm 与 WorkCase 承载层补建': 'P0',

  'Git Gate 的 fail-open 通路': 'P1',
  '启动引导对 specs/ 的悬空假定': 'P1',
  '关闭与复核的机械校验缺口': 'P1',
  '总纲落点失实与外部接入缺口': 'P1',
  '任务勾选框形态是否入规范': 'P1',
  'ADR → Norm 转向机制缺口': 'P1',
  '读维认知小结的落地': 'P1',
  '上游 DSH 能力变化的吸收': 'P1',
  '生命周期验证的 Windows 覆盖': 'P1',
  '插件绑定计划与落地的差距': 'P1',

  'LDVH 写入未纳入版本守卫': 'P2',
  'dimensions 七元组表达力缺口': 'P2',
  '执行系统（单元执行）的建立': 'P2',
  'pre-step 预热的规范授权缺口': 'P2',
  '事实对象关联五环节': 'P2',
  '底座两用法映射的落地': 'P2',
  '新事实类型候选准入': 'P2',

  '蓝图功能的最终形态': 'P3',
  'LDVH 记忆系统': 'P3',
  '行动可见性候选停摆': 'P3',
};

const sig = authoritativeSignature({ provider: 'workbuddy', model: 'deepseek-v4.1-flash' });

/** 在 frontmatter 文本中插入 priority 行（紧随 serves 之后；无 serves 则紧随 summary 段末）。 */
function insertPriority(frontmatterText, priority) {
  const lines = frontmatterText.split('\n');
  const servesIdx = lines.findIndex((l) => /^serves:/.test(l));
  const statusIdx = lines.findIndex((l) => /^status:/.test(l));
  const at = servesIdx >= 0 ? servesIdx + 1 : statusIdx;
  lines.splice(at, 0, `priority: ${priority}`);
  return lines.join('\n');
}

async function listOpenSparks() {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(SPARKS)).filter((f) => f.endsWith('.md'));
  const out = [];
  for (const f of files) {
    const text = await readFile(join(SPARKS, f), 'utf8');
    const uid = /^object_uid:\s*(\S+)/m.exec(text)?.[1];
    const status = /^status:\s*(\S+)/m.exec(text)?.[1];
    const title = /^title:\s*(.+)$/m.exec(text)?.[1];
    if (uid && status === 'open') out.push({ uid, title, file: f });
  }
  return out;
}

const openSparks = await listOpenSparks();
console.log(`open Spark: ${openSparks.length} 条`);
console.log(`分档表: ${Object.keys(ASSIGNMENTS).length} 条`);
if (openSparks.length !== Object.keys(ASSIGNMENTS).length) {
  console.error('数量不匹配，中止（避免误写）');
  process.exit(1);
}

let ok = 0;
let skipped = 0;
const failures = [];

for (const { uid, title, file } of openSparks) {
  const priority = ASSIGNMENTS[title];
  if (!priority) {
    failures.push(`${title}: 分档表无此项`);
    continue;
  }

  const current = await readSparkObject({ factSourceRoot: FACT_SOURCE_ROOT, objectUid: uid });
  if (!current.ok) {
    failures.push(`${title}: 读取失败 ${current.error?.code} ${current.error?.message}`);
    continue;
  }
  const fm = current.value.frontmatter ?? {};
  if (fm.priority !== undefined) {
    console.log(`跳过（已有 priority=${fm.priority}）: ${title}`);
    skipped += 1;
    continue;
  }

  // 重建完整 frontmatter：按既有键序插入 priority 后再拼回正文。
  const raw = await readFile(join(SPARKS, file), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) {
    failures.push(`${title}: 无法解析 frontmatter`);
    continue;
  }
  const [, fmText, rawBody] = m;
  // writer 的 assembleBody 会用 title 重新拼 H1，故传入的 body 须从 H2 起
  // （与 create/update 的既有契约一致；带上 H1 会触发 body_invalid）。
  const body = rawBody.replace(/^\s*#\s+.*\n/, '');
  const nextFmText = insertPriority(fmText, priority);

  // 解析新 frontmatter 为对象（交由 writer 校验闭集与状态互斥）。
  const { parse: parseYaml } = await import('yaml');
  const parsed = parseYaml(nextFmText);

  if (DRY) {
    console.log(`[dry-run] ${priority} → ${title}`);
    ok += 1;
    continue;
  }

  const res = await updateSparkObject({
    factSourceRoot: FACT_SOURCE_ROOT,
    objectUid: uid,
    expectedFingerprint: current.value.fingerprint,
    frontmatterAfter: parsed,
    bodyMarkdownAfter: body,
    changeSummary: `回填 priority=${priority}（20 §8 新增字段，Human 裁定 A；AI 出初值，Human 可随时调整）`,
    sessionSignature: sig,
  });

  if (!res.ok) {
    failures.push(`${title}: ${res.error?.code} ${res.error?.message}`);
    continue;
  }
  // 精确回读
  const back = await readSparkObject({ factSourceRoot: FACT_SOURCE_ROOT, objectUid: uid });
  const got = back.ok ? back.value.frontmatter?.priority : undefined;
  if (got !== priority) {
    failures.push(`${title}: 回读不一致 (期望 ${priority}, 得到 ${got})`);
    continue;
  }
  console.log(`✔ ${priority} → ${title}`);
  ok += 1;
}

console.log(`\n完成: ${ok} 写入, ${skipped} 跳过, ${failures.length} 失败`);
if (failures.length) {
  console.log('失败明细:');
  for (const f of failures) console.log('  -', f);
  process.exit(1);
}
