/**
 * 待处置队列的「核查解除」受控入口（11 §12 第 5 条）。
 *
 * ## 背景：缺少的是入口，不是能力
 *
 * `plugin/lib/pending-queue.js:168` 的 `resolvePendingEntry` 早就写好，是队列上
 * **唯一**允许修改既有登记的入口（只写 `resolved_at`，可附 `resolution_note`）。
 * 但它此前的调用方只有 `friction-observation-buffer.js:668` 与 `:928`，两处都是
 * 「保留期淘汰」场景——**没有任何调用方为『执行失败』类登记写 resolved_at**。
 * 实测 2026-11-02：`~/.dsh/ldvh/pending-queue.jsonl` 269 条登记，`resolved_at`
 * 非空 **0** 条。
 *
 * 11 §12 第 5 条的原文是：「核查与解除：登记由接管的主控或 Human 核查后写入
 * `resolved_at`；核查前受影响对象不得被当作稳定事实消费」。缺了入口，这条纪律
 * 就只剩「不得当作稳定事实消费」这半个约束——队列只增不减，读它的人无法区分
 * 「已核查、已修好」与「从未有人看过」。
 *
 * ## 为什么是脚本而不是新的 CLI 公开操作
 *
 * 11 §12ter 只声明了 `observation-buffer-list` 与 `observation-buffer-review`
 * 两个公开操作，**队列本身没有操作声明**；05 §6.1 要求新增操作先有其规范声明
 * （`arguments_contract`／`result_contract` 须回指规范章节），否则
 * `discover-ldvh-capabilities` 会把它当成无来源声明。故本次不改规范、不新增
 * 公开操作，而是把既有能力接到一个可执行的受控入口上——纯本地脚本，不改任何
 * 事实对象，只动宿主侧运行状态（§12 第 1 条：队列不进入事实源）。
 *
 * ## 三条不可让步的约束
 *
 * 1. **必须给核查依据**（`--note`）：解除不是「清掉」，而是「已经核查过」。没有
 *    依据的批量解除会把这半个纪律也一并废掉。故 `--note` 缺失即拒绝执行。
 * 2. **不提供批量解除**：一次一个 `--entry=<entry_id>`，或 `--all-verified=<file>`
 *    显式给出逐个 entry_id 与依据的清单。没有「把未核查的全清掉」这种形态。
 * 3. **逐条回读**：写完重新读队列，断言目标行 `resolved_at` 非空、其内容字段
 *    （`at`／`task`／`reason`／`residual`）逐字未变。解除只加一个时间戳，不改
 *    登记内容（§12 第 3 条「仅追加不修改既有登记」在语义上仍成立——记录核查
 *    完成是新增事实，不是改写原登记）。
 *
 * 用法：
 *   node scripts/resolve-pending-entry.mjs --entry=<entry_id> --note="核查依据"
 *   node scripts/resolve-pending-entry.mjs --list [--unresolved-only]
 *   node scripts/resolve-pending-entry.mjs --all-verified=<plan.json> [--dry-run]
 *
 * `plan.json` 形状：`{ "note": "本次核查的总体依据", "entry_ids": ["...", "..."] }`，
 * 或 `{ "items": [{ "entry_id": "...", "note": "该条的依据" }] }`。两种都要求逐条
 * 具名——脚本拒绝任何「按条件选取」的形态。
 *
 * 退出码：0 = 全部成功（或只列出）；1 = 存在失败（逐条列出，不静默）。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { readPendingQueue, resolvePendingEntry } from '../lib/pending-queue.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIST = args.includes('--list');
const UNRESOLVED_ONLY = args.includes('--unresolved-only');
const ENTRY = valueOf('--entry=');
const NOTE = valueOf('--note=');
const PLAN_PATH = valueOf('--all-verified=');

const HOME = (...parts) => join(resolveDshHome(), ...parts);

function valueOf(prefix) {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
}

function fail(message) {
  console.error(`拒绝执行：${message}`);
  process.exit(1);
}

/**
 * 逐条回读断言：`resolved_at` 非空，且登记内容字段逐字未变。
 * 内容字段只比这四项——`resolution_note` 是本次新增的，`resolved_at` 是本次写的。
 */
const CONTENT_FIELDS = ['at', 'task', 'reason', 'residual'];

function contentOf(entry) {
  return JSON.stringify(CONTENT_FIELDS.map((key) => entry?.[key] ?? null));
}

async function listEntries() {
  const read = await readPendingQueue(HOME, { includeResolved: !UNRESOLVED_ONLY });
  if (!read.ok) fail(`队列不可读：${read.error?.message ?? 'unknown'}`);
  const { items, total, unresolved, invalid, carrier } = read.value;
  console.log(`载体：${carrier}`);
  console.log(`总计 ${total} 条，未核查 ${unresolved} 条，不可读行 ${Array.isArray(invalid) ? invalid.length : invalid} 条`);
  for (const entry of items) {
    const mark = entry.resolved_at === null ? '未核查' : `已核查 ${entry.resolved_at}`;
    console.log(`- ${entry.entry_id}  [${mark}]  ${entry.at}  ${entry.task}`);
    console.log(`  ${String(entry.reason ?? '').slice(0, 200)}`);
  }
  return items;
}

async function planFromArgs() {
  if (PLAN_PATH !== undefined) {
    let plan;
    try {
      plan = JSON.parse(await readFile(PLAN_PATH, 'utf8'));
    } catch (error) {
      fail(`无法读取清单 ${PLAN_PATH}：${String(error?.message ?? error)}`);
    }
    if (Array.isArray(plan?.items)) {
      return plan.items.map((item) => ({
        entryId: String(item?.entry_id ?? ''),
        note: String(item?.note ?? plan.note ?? ''),
      }));
    }
    if (Array.isArray(plan?.entry_ids)) {
      return plan.entry_ids.map((id) => ({ entryId: String(id ?? ''), note: String(plan?.note ?? '') }));
    }
    fail('清单须为 { note, entry_ids: [...] } 或 { items: [{ entry_id, note }] }——不支持按条件选取的形态');
  }
  if (ENTRY === undefined) {
    fail('须给 --entry=<entry_id> --note="核查依据"，或 --list 查看，或 --all-verified=<plan.json>');
  }
  if (NOTE === undefined || NOTE.trim().length === 0) {
    fail('须给 --note="核查依据"：解除不是清掉，而是记录「已经核查过」；无依据的解除不得写入');
  }
  return [{ entryId: ENTRY, note: NOTE }];
}

async function main() {
  if (LIST) {
    await listEntries();
    return;
  }

  const plan = await planFromArgs();
  for (const item of plan) {
    if (item.entryId.trim().length === 0) fail('清单里存在空的 entry_id');
    if (item.note.trim().length === 0) fail(`条目 ${item.entryId} 缺少核查依据`);
  }

  const before = await readPendingQueue(HOME, { includeResolved: true });
  if (!before.ok) fail(`队列不可读：${before.error?.message ?? 'unknown'}`);
  const byId = new Map(before.value.items.map((entry) => [entry.entry_id, entry]));

  // 先全量校验，后逐条写入：任一条 id 不存在或已核查即整体不做，
  // 避免「改了一半」的半成品状态。
  for (const { entryId } of plan) {
    const entry = byId.get(entryId);
    if (entry === undefined) fail(`队列里没有 entry_id=${entryId}`);
    if (entry.resolved_at !== null) fail(`entry_id=${entryId} 已是核查状态（${entry.resolved_at}）`);
  }

  if (DRY) {
    console.log(`DRY：将解除 ${plan.length} 条（未写入）`);
    for (const { entryId } of plan) console.log(`- ${entryId}`);
    return;
  }

  let failed = 0;
  for (const { entryId, note } of plan) {
    const original = byId.get(entryId);
    const resolved = await resolvePendingEntry(HOME, entryId, { note });
    if (!resolved.ok) {
      failed += 1;
      console.log(`失败 ${entryId}：${resolved.error?.code} ${resolved.error?.message}`);
      continue;
    }
    // 逐条回读断言：只加了时间戳，内容字段逐字未变。
    const after = await readPendingQueue(HOME, { includeResolved: true });
    if (!after.ok) {
      failed += 1;
      console.log(`失败 ${entryId}：写入后队列不可读`);
      continue;
    }
    const reread = after.value.items.find((entry) => entry.entry_id === entryId);
    const problems = [];
    if (reread === undefined) problems.push('回读找不到该条');
    else {
      if (reread.resolved_at !== resolved.value.resolved_at) problems.push(`resolved_at 回读不符（期望 ${resolved.value.resolved_at}，实得 ${reread.resolved_at}）`);
      if (contentOf(reread) !== contentOf(original)) problems.push('登记内容字段被改动（只允许写 resolved_at 与 resolution_note）');
    }
    if (problems.length > 0) {
      failed += 1;
      console.log(`失败 ${entryId}：${problems.join('；')}`);
      continue;
    }
    console.log(`已解除 ${entryId}  ${resolved.value.resolved_at}`);
  }

  const after = await readPendingQueue(HOME, { includeResolved: false });
  if (after.ok) console.log(`剩余未核查 ${after.value.unresolved} 条（此前 ${before.value.unresolved} 条）`);
  if (failed > 0) {
    console.log(`存在 ${failed} 条失败`);
    process.exit(1);
  }
}

await main();
