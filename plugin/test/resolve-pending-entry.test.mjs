// 契约测试：待处置队列的「核查解除」受控入口（plugin/scripts/resolve-pending-entry.mjs）。
//
// 为什么必须有它：这个脚本是 11 §12 第 5 条「核查与解除」在生产路径上的**唯一**
// 入口。它此前只有手工端到端验收——而手工验收不会阻止后来的人把「必须给核查
// 依据」「不提供批量按条件解除」「解除不得改写登记内容」这三条约束改掉。
// 这三条各自失守的后果都不报错，只是让队列重新变成「只增不减」。
//
// 失效方向：宁可因环境差异红，不可因断言缺失而假通过。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runNode, withTemp } from "./helpers.mjs";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "resolve-pending-entry.mjs");

/** 造一个隔离的 DSH_HOME，里面放 `ldvh/pending-queue.jsonl`，并在其中跑 fn。 */
async function withQueue(entries, fn) {
  return withTemp("resolve-pending", async (home) => {
    await mkdir(join(home, "ldvh"), { recursive: true });
    const queuePath = join(home, "ldvh", "pending-queue.jsonl");
    await writeFile(queuePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    await fn({ home, queuePath });
  });
}

/** 与脚本同形的一条登记（内容字段齐全，缺一即被判不可读）。 */
function entry(id, overrides = {}) {
  return {
    entry_id: id,
    at: "2026-11-02T00:00:00.000Z",
    task: "friction-discovery",
    reason: "执行体失败（样例）",
    residual: ["错误码：sample"],
    resolved_at: null,
    ...overrides,
  };
}

/** 以隔离的 DSH_HOME 跑脚本。 */
function runScript(home, args) {
  return runNode([SCRIPT, ...args], { env: { ...process.env, DSH_HOME: home } });
}

/** 读回队列里的全部条目（供逐字比对）。 */
async function readQueue(queuePath) {
  const raw = await readFile(queuePath, "utf8");
  return raw.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
}

test("缺 --note 时拒绝执行（解除须留下核查依据）", async () => {
  await withQueue([entry("aaaaaaaa-1111-4111-8111-111111111111")], async ({ home, queuePath }) => {
    const result = await runScript(home, ["--entry=aaaaaaaa-1111-4111-8111-111111111111"]);
    assert.equal(result.ok, false, "缺核查依据时脚本须以非零码退出");
    assert.match(
      result.stdout + result.stderr,
      /--note/,
      `拒绝理由须点明缺的是 --note，实测：${JSON.stringify(result.stdout + result.stderr)}`,
    );
    const [row] = await readQueue(queuePath);
    assert.equal(row.resolved_at, null, "拒绝执行时队列不得被改动");
  });
});

test("成功解除：写 resolved_at 与核查依据，且内容字段逐字未变", async () => {
  const id = "bbbbbbbb-2222-4222-8222-222222222222";
  const seeded = entry(id, { reason: "观察缓冲不可读或残缺（样例）", residual: ["a", "b"] });
  await withQueue([seeded], async ({ home, queuePath }) => {
    const result = await runScript(home, [`--entry=${id}`, "--note=核查后确认该登记已修复"]);
    assert.equal(result.ok, true, `解除应成功，实测 stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`);

    const [row] = await readQueue(queuePath);
    assert.ok(
      typeof row.resolved_at === "string" && row.resolved_at.length > 0,
      `resolved_at 须写成时间戳，实测 ${JSON.stringify(row.resolved_at)}`,
    );
    assert.equal(row.resolution_note, "核查后确认该登记已修复", "核查依据须落盘，否则解除不可追溯");
    // 内容字段逐字未变——这是「解除不是清掉」的机械判据。
    assert.equal(row.entry_id, seeded.entry_id);
    assert.equal(row.at, seeded.at);
    assert.equal(row.task, seeded.task);
    assert.equal(row.reason, seeded.reason);
    assert.deepEqual(row.residual, seeded.residual);
  });
});

test("重复解除被拒绝，且不覆盖已有核查记录", async () => {
  const id = "cccccccc-3333-4333-8333-333333333333";
  const stamp = "2026-11-02T10:00:00.000Z";
  await withQueue([entry(id, { resolved_at: stamp, resolution_note: "首次核查" })], async ({ home, queuePath }) => {
    const result = await runScript(home, [`--entry=${id}`, "--note=第二次核查"]);
    assert.equal(result.ok, false, "已核查的登记不得被再次解除");
    assert.match(
      result.stdout + result.stderr,
      /已是核查状态|已核查/,
      `拒绝理由须点明已核查，实测：${JSON.stringify(result.stdout + result.stderr)}`,
    );
    const [row] = await readQueue(queuePath);
    assert.equal(row.resolved_at, stamp, "已有核查时刻不得被覆盖");
    assert.equal(row.resolution_note, "首次核查", "已有核查依据不得被覆盖");
  });
});

test("未知 entry_id 被拒绝，且队列一字未改", async () => {
  const id = "dddddddd-4444-4444-8444-444444444444";
  await withQueue([entry(id)], async ({ home, queuePath }) => {
    const before = await readFile(queuePath, "utf8");
    const result = await runScript(home, ["--entry=eeeeeeee-5555-4555-8555-555555555555", "--note=核查"]);
    assert.equal(result.ok, false, "未知 entry_id 须拒绝");
    assert.equal(await readFile(queuePath, "utf8"), before, "拒绝时载体须逐字未变");
  });
});

test("批量清单里有一条已核查时整体拒绝（全有或全无）", async () => {
  const freshId = "ffffffff-6666-4666-8666-666666666666";
  const doneId = "99999999-7777-4777-8777-777777777777";
  await withQueue(
    [entry(freshId), entry(doneId, { resolved_at: "2026-11-02T09:00:00.000Z" })],
    async ({ home, queuePath }) => {
      const planPath = join(home, "plan.json");
      await writeFile(
        planPath,
        JSON.stringify({ note: "批量核查", entry_ids: [freshId, doneId] }),
        "utf8",
      );
      const result = await runScript(home, [`--all-verified=${planPath}`]);
      assert.equal(result.ok, false, "含已核查项的清单须整体拒绝，避免半成品");
      const rows = await readQueue(queuePath);
      const fresh = rows.find((r) => r.entry_id === freshId);
      assert.equal(
        fresh.resolved_at,
        null,
        "整体拒绝时，清单里那条本来可解除的也不得被写——否则会留下半成品，且第二次重跑会因『已是核查状态』卡住",
      );
    },
  );
});

test("--list 如实报数：未核查数与不可读行数", async () => {
  const id = "12121212-8888-4888-8888-888888888888";
  await withQueue(
    [entry(id), entry("13131313-9999-4999-8999-999999999999", { resolved_at: "2026-11-02T09:00:00.000Z" })],
    async ({ home }) => {
      const result = await runScript(home, ["--list", "--unresolved-only"]);
      assert.equal(result.ok, true, `--list 应成功，实测 ${JSON.stringify(result.stderr)}`);
      const text = result.stdout + result.stderr;
      assert.match(text, /未核查 1 条/, `未核查条数须如实（种子 2 条中 1 条已核查），实测：${JSON.stringify(text)}`);
    },
  );
});
