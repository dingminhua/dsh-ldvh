import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSparkObject, updateSparkObject } from '../lib/spark-writer.js';
import { authoritativeSignature } from '../lib/signature-channel.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const FACT_SOURCE_ROOT = join(REPO, 'ldvh-base');
const SPARKS = join(FACT_SOURCE_ROOT, 'sparks');
const DRY = process.argv.includes('--dry-run');

const ASSIGNMENTS = {
  'Norm 承载层补建': 'P0',

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

  const raw = await readFile(join(SPARKS, file), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) {
    failures.push(`${title}: 无法解析 frontmatter`);
    continue;
  }
  const [, fmText, rawBody] = m;
  const body = rawBody.replace(/^\s*#\s+.*\n/, '');
  const nextFmText = insertPriority(fmText, priority);

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
