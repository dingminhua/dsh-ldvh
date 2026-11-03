/**
 * 审核段转写入口（11 §10.2 第 5 项、§9 第 2 项「审核层转写」段，2026-11-01 B 方案）。
 *
 * 守的是**带隙被补上**这件事，而不是实现细节：
 * - 「出了错、还没修」的材料被判 discarded 时，**不该就此消失**——它的材料搬到摩擦
 *   观察缓冲，由摩擦侧继续攒阈值；
 * - 转写**不改变**经验条目的结算状态（它仍然不是 Pitfall 候选）；
 * - 转写**不重复计数**：同一证据已在摩擦缓冲里（任何状态）就跳过；
 * - 转写是机械校验的：五项语义字段缺一即拒，机械侧不代填。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { testSignature, withTemp } from "./helpers.mjs";
import {
  appendBufferEntry,
  readBufferEntries,
} from "../lib/observation-buffer.js";
import {
  appendFrictionObservation,
  readFrictionObservations,
  settleGroupPromoted,
} from "../lib/friction-observation-buffer.js";
import { createFrictionObject } from "../lib/friction-writer.js";
import {
  transferDiscardedEntryToFriction,
  validateTransferProposal,
  evidenceSubject,
  TRANSFER_REQUIRED_FIELDS,
} from "../lib/friction-transfer.js";

const PROJECT = "dsh-ldvh";

function home(root) {
  return () => join(root, "dsh-home");
}

/** 一条已成 discarded 的经验条目（转写的来源）。 */
function discardedEntry(overrides = {}) {
  return {
    id: "entry-1",
    at: "2026-11-01T00:00:00.000Z",
    session: "sess-1",
    anchor: "turn 12..18",
    phenomenon: "并发执行回归测试时出现两条失败，单独运行同一测试时全部通过",
    evidence: "两条失败：`port 3000 already in use`、`temp dir EEXIST`（会话 sess-1 turn 15）",
    candidate_question: "并发跑测试为什么偶发失败？",
    status: "discarded",
    consumed_by: null,
    ...overrides,
  };
}

/** 一份形状合法的转写提案。 */
function transfer(overrides = {}) {
  return {
    title: "并发测试共享临时端口与目录",
    basis: "同一现象反复出现；归因：测试夹具共用固定端口与临时目录；修了会改善。",
    attribution: "测试夹具",
    group: "concurrent-test-temp-dir-interference",
    ...overrides,
  };
}

test("转写：discarded 条目的材料落到摩擦观察缓冲，且证据逐字未走样", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    const entry = discardedEntry();

    const moved = await transferDiscardedEntryToFriction({
      dshHomePath: h,
      projectId: PROJECT,
      entry,
      transfer: transfer(),
    });
    assert.ok(moved.ok, JSON.stringify(moved.error));
    assert.equal(moved.value.written, true);

    const read = await readFrictionObservations(h, PROJECT);
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.items.length, 1);
    const item = read.value.items[0];
    // **证据逐字**：不得改写、截断或重拼（02 §6.1 第 3 条）。
    assert.equal(item.evidence, entry.evidence);
    assert.equal(item.phenomenon, entry.phenomenon);
    assert.equal(item.session, entry.session);
    assert.equal(item.anchor, entry.anchor);
    assert.equal(item.group, "concurrent-test-temp-dir-interference");
    assert.equal(item.status, "pending");
    assert.equal(item.target_uid, null);
  });
});

test("转写：来源条目不是 discarded 即拒绝——转写不是清 pending 的便道", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    for (const status of ["pending", "consumed", "evicted"]) {
      const moved = await transferDiscardedEntryToFriction({
        dshHomePath: h,
        projectId: PROJECT,
        entry: discardedEntry({ status }),
        transfer: transfer(),
      });
      assert.equal(moved.ok, false, `status=${status} must be refused`);
      assert.equal(moved.error.code, "friction_transfer/source_not_discarded");
    }
    const read = await readFrictionObservations(h, PROJECT);
    assert.ok(read.ok);
    assert.equal(read.value.items.length, 0, "nothing may be written when the gate refuses");
  });
});

test("转写：同一证据已在摩擦缓冲里即跳过——否则同一现象被重复计数、虚增到阈值", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    const entry = discardedEntry();
    // 先由发现层记过一次（pending）。
    const first = await appendFrictionObservation(h, {
      project: PROJECT,
      session: entry.session,
      anchor: entry.anchor,
      phenomenon: entry.phenomenon,
      evidence: entry.evidence,
      group: "concurrent-test-temp-dir-interference",
      title: "并发测试共享临时端口与目录",
      basis: "发现层已记。",
      attribution: "测试夹具",
    });
    assert.ok(first.ok, JSON.stringify(first.error));

    const moved = await transferDiscardedEntryToFriction({
      dshHomePath: h,
      projectId: PROJECT,
      entry,
      transfer: transfer(),
    });
    assert.ok(moved.ok, JSON.stringify(moved.error));
    // **跳过不是失败**：该观察已记过，正是期望的结果。
    assert.equal(moved.value.written, false);
    assert.equal(moved.value.reason, "already-recorded");
    assert.equal(moved.value.existing_id, first.value.entry_id);

    const read = await readFrictionObservations(h, PROJECT);
    assert.ok(read.ok);
    assert.equal(read.value.items.length, 1, "no second entry may be appended");
  });
});

test("转写：已在账目里的观察（promoted）同样跳过——晋升后的证据已复制进账目", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    const entry = discardedEntry();

    // **真的把它晋升掉**（2026-11-01 审核 F2 修）：早先这一例只 append 了一条
    // `pending` 条目就断言「已晋升」，于是「幂等只查 pending」的变异**照样全绿**——
    // 那条用例钉的是 pending，不是 promoted。要钉住「任何状态含已 promoted」，
    // 必须走完 settle。
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const appended = await appendFrictionObservation(h, {
        project: PROJECT,
        session: entry.session,
        anchor: entry.anchor,
        phenomenon: i === 0 ? entry.phenomenon : `${entry.phenomenon}（第 ${i + 1} 次观察）`,
        // 第 1 条用来源条目的整串 evidence，其余用同一主体 + 不同来源行——
        // 这样既造出「已晋升组」，又让转写那条与组内第 1 条的主体相同。
        evidence: i === 0 ? entry.evidence : `${entry.evidence}\n（来源：turn ${i + 20}..${i + 22}）`,
        group: "concurrent-test-temp-dir-interference",
        title: "并发测试共享临时端口与目录",
        basis: "发现层已记。",
        attribution: "测试夹具",
      });
      assert.ok(appended.ok, JSON.stringify(appended.error));
      ids.push(appended.value.entry_id);
    }

    const promoted = await settleGroupPromoted(h, PROJECT, ids, "11111111-1111-4111-8111-111111111111");
    assert.ok(promoted.ok, JSON.stringify(promoted.error));

    // 前置事实：该组确已不再是 pending——否则下面的断言证明不了「查了全状态」。
    const pendingNow = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.ok(pendingNow.ok, JSON.stringify(pendingNow.error));
    assert.equal(pendingNow.value.items.length, 0, "the group must have left the pending set");

    const moved = await transferDiscardedEntryToFriction({
      dshHomePath: h,
      projectId: PROJECT,
      entry,
      transfer: transfer(),
    });
    assert.ok(moved.ok, JSON.stringify(moved.error));
    assert.equal(moved.value.written, false);
    assert.equal(moved.value.reason, "already-recorded");
    assert.equal(moved.value.existing_status, "promoted");
  });
});

test("转写：发现层已记过的观察（来源行形态不同）同样跳过——比对键是引证主体", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    const entry = discardedEntry();

    // 发现层写 evidence 的形态：`${quote}\n（来源：${anchor}）`（全角括号）。
    // 转写来源是经验条目的形态：`${quote}\n来源：${session} …`（无括号）。
    // 两者**逐字永不相等**，但指向同一次观察——这正是需要挡住的场景。
    const discoveryForm = await appendFrictionObservation(h, {
      project: PROJECT,
      session: entry.session,
      anchor: entry.anchor,
      phenomenon: entry.phenomenon,
      evidence: `${entry.evidence}\n（来源：${entry.anchor}）`,
      group: "concurrent-test-temp-dir-interference",
      title: "并发测试共享临时端口与目录",
      basis: "发现层已记。",
      attribution: "测试夹具",
    });
    assert.ok(discoveryForm.ok, JSON.stringify(discoveryForm.error));

    const moved = await transferDiscardedEntryToFriction({
      dshHomePath: h,
      projectId: PROJECT,
      entry,
      transfer: transfer(),
    });
    assert.ok(moved.ok, JSON.stringify(moved.error));
    assert.equal(moved.value.written, false, "同一引证主体不得被记第二次");
    assert.equal(moved.value.reason, "already-recorded");

    const read = await readFrictionObservations(h, PROJECT);
    assert.ok(read.ok);
    assert.equal(read.value.items.length, 1, "count must not be inflated across the two paths");
  });
});

test("evidenceSubject：只剥尾部署名行，引证主体一字不动", () => {
  const quote = "两条失败：`port 3000 already in use`、`temp dir EEXIST`";
  assert.equal(evidenceSubject(`${quote}\n（来源：turn 12..18）`), quote);
  assert.equal(evidenceSubject(`${quote}\n来源：session s-1 turn-014`), quote);
  assert.equal(evidenceSubject(`${quote}\n（来源：turn 12..18）\n\n`), quote);
  // 引证主体内部以「来源：」开头的行**不该被删**——只剥尾部。
  assert.equal(evidenceSubject(`来源：这是引证的开头\n第二行\n（来源：turn 1..2）`), "来源：这是引证的开头\n第二行");
  // 没有署名行时原样返回。
  assert.equal(evidenceSubject(quote), quote);
});

test("转写：五项语义字段缺一即拒——机械侧不代填 group 与账目正文", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    for (const field of TRANSFER_REQUIRED_FIELDS) {
      const bad = transfer();
      delete bad[field];
      const moved = await transferDiscardedEntryToFriction({
        dshHomePath: h,
        projectId: PROJECT,
        entry: discardedEntry(),
        transfer: bad,
      });
      assert.equal(moved.ok, false, `missing ${field} must be refused`);
      assert.equal(moved.error.code, "friction_transfer/proposal_incomplete");
    }
    const read = await readFrictionObservations(h, PROJECT);
    assert.ok(read.ok);
    assert.equal(read.value.items.length, 0);
  });
});

// ---------------------------------------------------------------------------
// target_uid 可解析性校验（2026-11-04，11 §12bis.1）
//
// 此前转写入口对 target_uid 只查「非空字符串」，不判它能否解析到账目——
// 那是本单修的第一处缺口。以下三例钉住新校验的三个分支。
// ---------------------------------------------------------------------------

test("转写：带 target_uid 但缺 factSourceRoot → 拒绝（不静默跳过校验）", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    const moved = await transferDiscardedEntryToFriction({
      dshHomePath: h,
      projectId: PROJECT,
      entry: discardedEntry({ evidence: "另一段逐字引证（会话 sess-1 turn 20）" }),
      transfer: transfer({ target_uid: "9d1c1b6e-1111-4222-8333-444455556666" }),
      // 故意不传 factSourceRoot
    });
    assert.ok(!moved.ok, "缺 factSourceRoot 时必须拒绝——跳过校验等于让本闸静默失效");
    assert.equal(moved.error.code, "friction_transfer/target_uid_unresolvable");
    const read = await readFrictionObservations(h, PROJECT);
    assert.ok(read.ok);
    assert.equal(read.value.items.length, 0, "被拒时不得写入缓冲");
  });
});

test("转写：target_uid 解析不到账目 → 拒绝（这正是把条目永久卡死的形态）", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    const factSourceRoot = join(root, "facts");
    const moved = await transferDiscardedEntryToFriction({
      dshHomePath: h,
      projectId: PROJECT,
      entry: discardedEntry({ evidence: "另一段逐字引证（会话 sess-1 turn 20）" }),
      // 真实事故里这两个 uid 只差两个字符（da7d vs da9d）
      transfer: transfer({ target_uid: "6c6ea207-da7d-4527-957a-9b46775ecfd4" }),
      factSourceRoot,
    });
    assert.ok(!moved.ok, "解析不到的 target_uid 必须拒绝");
    assert.equal(moved.error.code, "friction_transfer/target_uid_unresolvable");
    assert.equal(moved.error.target_uid, "6c6ea207-da7d-4527-957a-9b46775ecfd4");
    const read = await readFrictionObservations(h, PROJECT);
    assert.ok(read.ok);
    assert.equal(read.value.items.length, 0, "被拒时不得写入缓冲");
  });
});

test("转写：带 target_uid 且账目真实存在 → 放行（正控制，证明校验不误伤）", async () => {
  await withTemp("friction-transfer.", async (root) => {
    const h = home(root);
    const factSourceRoot = join(root, "facts");
    const created = await createFrictionObject({
      factSourceRoot,
      frontmatterDraft: {
        title: "转写目标账目（测试夹具）",
        phenomenon: "夹具账目用于证明 target_uid 可解析时放行",
        occurrence: { count: 1, first_at: "2026-10-16T00:00:00.000Z", last_at: "2026-10-16T00:00:00.000Z" },
      },
      bodyMarkdown: "## 现象\n夹具账目用于证明 target_uid 可解析时放行。\n\n## 入账依据\n测试。\n",
      sessionSignature: testSignature(),
    });
    assert.equal(created.ok, true, "夹具创建失败: " + JSON.stringify(created.error));
    const target = created.value.object_uid;

    const moved = await transferDiscardedEntryToFriction({
      dshHomePath: h,
      projectId: PROJECT,
      entry: discardedEntry({ evidence: "另一段逐字引证（会话 sess-1 turn 20）" }),
      transfer: transfer({ target_uid: target }),
      factSourceRoot,
    });
    assert.ok(moved.ok, `解析得到时必须放行：${JSON.stringify(moved.error)}`);
    const read = await readFrictionObservations(h, PROJECT);
    assert.ok(read.ok);
    assert.equal(read.value.items[0].target_uid, target);
  });
});

test("validateTransferProposal：非对象与空串一律拒绝，不做「清洗后放行」", () => {
  for (const bad of [null, [], "x", 42]) {
    const out = validateTransferProposal(bad);
    assert.equal(out.ok, false);
  }
  const blank = transfer({ title: "   " });
  const out = validateTransferProposal(blank);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "friction_transfer/proposal_incomplete");
});

// ---------------------------------------------------------------------------
// §20.1 第 11 项 / §18「摩擦观察条目到期淘汰的登记」
//
// 这一组守的是「淘汰不得静默」：保留期或容量把 pending 条目清掉时，若没先把它
// 「攒到 N 条就差一步」的事实登记进待处置队列，§18 该行的失败处置是**不得淘汰**。
// 此前实现把登记义务写进注释、没有任何调用方履行，淘汰一直是静默的。
// ---------------------------------------------------------------------------

/**
 * **真正拼接路径段**的 dshHomePath。
 *
 * 文件顶部的 `home()` 是 `() => join(root, "dsh-home")`——它丢弃全部段，因为转写用例
 * 只用到缓冲分区那一条路径。淘汰用例不同：缓冲载体与待处置队列是两个**不同**的文件，
 * 用丢弃段的 joiner 会把两者写到同一个路径上，队列于是永远读不到登记。这个坑在
 * 首次写这两条用例时踩过一次，记在这里。
 */
function pathJoiner(root) {
  return (...segments) => join(root, "dsh-home", ...segments);
}

/** 造一条 at 在 `daysAgo` 天前的观察条目。 */
async function appendAgedObservation(home, { id, group, daysAgo, now }) {
  const at = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const appended = await appendFrictionObservation(home, {
    project: PROJECT,
    session: `session-${id}`,
    anchor: `turn ${id}`,
    phenomenon: `第 ${id} 次观察到同一阻碍返回空结果`,
    evidence: `evidence-${id} 的逐字片段\n（来源：turn ${id}）`,
    group,
    title: "保留期淘汰测试",
    basis: "入账依据（测试用）",
    attribution: "friction-observation-buffer.js 的保留期淘汰路径",
    at,
  });
  assert.equal(appended.ok, true, `append failed: ${JSON.stringify(appended.error)}`);
  return appended.value.entry_id;
}

test("保留期淘汰 pending 条目时**先登记待处置队列**，且登记写明了差几次成账（§20.1 第 11 项）", async () => {
  await withTemp("friction-evict-retention-", async (root) => {
    const dshHome = pathJoiner(root);
    // 固定「现在」，使 age 计算可复现。
    const now = new Date("2026-11-01T00:00:00.000Z");
    // 两条同组、都已超过 90 天保留期——攒到 2/3 就差一次。
    await appendAgedObservation(dshHome, { id: "a", group: "evict-group", daysAgo: 120, now });
    await appendAgedObservation(dshHome, { id: "b", group: "evict-group", daysAgo: 110, now });

    const read = await readFrictionObservations(dshHome, PROJECT, { now });
    assert.equal(read.ok, true, JSON.stringify(read.error));
    // 两条都被判淘汰。
    assert.equal(read.value.evicted_pending.length, 2, "两条超期条目都应进入 evicted_pending");
    // 登记真的写了。
    assert.equal(read.value.eviction_registrations.length, 1, "同组两条合并为一条登记");
    assert.equal(typeof read.value.eviction_registrations[0], "string");
    assert.equal(read.value.eviction_registration_error, null);

    // 队列里必须能找到那条登记，且内容写明了组、差几次。
    const { readPendingQueue } = await import("../lib/pending-queue.js");
    const queue = await readPendingQueue(dshHome);
    assert.equal(queue.ok, true);
    const entry = queue.value.items.find((e) => e.residual.some((r) => r.includes("evict-group")));
    assert.ok(entry, "待处置队列里应有该组的淘汰登记");
    assert.equal(entry.task, "friction-discovery");
    assert.match(entry.reason, /保留期到期被淘汰/);
    assert.match(entry.reason, /2\/3/);
    assert.match(entry.reason, /剩 0 条/, "须写明同组是否还有存活条目");
    const joined = entry.residual.join(" | ");
    assert.match(joined, /未达晋升阈值（2\/3）/, "须写明淘汰时的计数");
    assert.match(joined, /只差 1 次观察/, "须写明差几次成账");
  });
});

test("容量淘汰同样先登记（§20.1 第 11 项不区分淘汰原因）", async () => {
  await withTemp("friction-evict-capacity-", async (root) => {
    const dshHome = pathJoiner(root);
    const now = new Date("2026-11-01T00:00:00.000Z");
    // 容量给 1：第二条写入会把第一条挤掉。
    await appendFrictionObservation(dshHome, {
      project: PROJECT, session: "s-1", anchor: "turn 1",
      phenomenon: "第一条", evidence: "证据一\n（来源：turn 1）",
      group: "capacity-group", title: "容量淘汰", basis: "依据", attribution: "缓冲容量",
      at: new Date(now.getTime() - 3600_000).toISOString(),
    }, { capacity: 1, now });
    const second = await appendFrictionObservation(dshHome, {
      project: PROJECT, session: "s-2", anchor: "turn 2",
      phenomenon: "第二条", evidence: "证据二\n（来源：turn 2）",
      group: "capacity-group", title: "容量淘汰", basis: "依据", attribution: "缓冲容量",
      at: now.toISOString(),
    }, { capacity: 1, now });

    assert.equal(second.ok, true, JSON.stringify(second.error));
    assert.equal(second.value.evicted_pending.length, 1, "第一条应被容量淘汰");
    assert.equal(second.value.eviction_registrations.length, 1, "容量淘汰同样须登记");

    const { readPendingQueue } = await import("../lib/pending-queue.js");
    const queue = await readPendingQueue(dshHome);
    const entry = queue.value.items.find((e) => e.reason.includes("容量上限被淘汰"));
    assert.ok(entry, "容量淘汰须在待处置队列留痕，措辞须与保留期淘汰可区分");
  });
});

test("**已达阈值却被容量淘汰**时，登记不得说成「未达阈值」——那是更严重的信号（自查补）", async () => {
  // 构造：容量 2，同组连写 3 条 → 第 3 条写入时淘汰最旧一条，而该组此刻已有 3 条 pending。
  // 这正是「账目本可晋升、却先被容量清掉」的情形：登记若一律写「未达晋升阈值（3/3）」，
  // 会印出自相矛盾的句子，并把「晋升节奏跟不上写入节奏」这个更该被看见的事实藏起来。
  await withTemp("friction-evict-at-threshold-", async (root) => {
    const dshHome = pathJoiner(root);
    const now = new Date("2026-11-01T00:00:00.000Z");
    const entry = (n) => ({
      project: PROJECT, session: `s-${n}`, anchor: `turn ${n}`,
      phenomenon: `第 ${n} 次观察到同一阻碍`,
      evidence: `证据 ${n}\n（来源：turn ${n}）`,
      group: "hot-group", title: "已达阈值却遭淘汰", basis: "依据",
      attribution: "缓冲容量",
      at: new Date(now.getTime() - (10 - n) * 60_000).toISOString(),
    });
    // 前两条正常写入（容量 2 之内）。
    for (const n of [1, 2]) {
      const r = await appendFrictionObservation(dshHome, entry(n), { capacity: 2, now });
      assert.equal(r.ok, true, JSON.stringify(r.error));
      assert.equal(r.value.evicted_pending.length, 0, "容量未超，不应淘汰");
    }
    // 第 3 条：该组 pending 达 3（=阈值），同时触发容量淘汰最旧一条。
    const third = await appendFrictionObservation(dshHome, entry(3), { capacity: 2, now });
    assert.equal(third.ok, true, JSON.stringify(third.error));
    assert.equal(third.value.evicted_pending.length, 1, "应淘汰一条");
    assert.equal(
      third.value.evicted_pending[0].pending_count_at_eviction,
      3,
      "淘汰前的计数须是 3（含刚写入那条），否则「是否已达阈值」判错",
    );

    const { readPendingQueue } = await import("../lib/pending-queue.js");
    const queue = await readPendingQueue(dshHome);
    const reg = queue.value.items.find((e) => e.reason.includes("hot-group"));
    assert.ok(reg, "该组须有淘汰登记");
    assert.match(reg.reason, /已达晋升阈值（3\/3）/, "已达阈值时须如实说「已达」，不得说「未达」");
    assert.doesNotMatch(reg.reason, /未达晋升阈值/, "两种情况措辞必须互斥");
    assert.match(reg.reason, /剩 2 条/, "须写明还有几条存活");
    assert.match(reg.residual.join(" | "), /仍有 2 条 pending 条目在攒/, "须说明该组仍可继续晋升");
  });
});

test("登记失败即**整体放弃淘汰**——不得出现「已淘汰但无登记」（§18 该行：不得淘汰）", async () => {
  await withTemp("friction-evict-abort-", async (root) => {
    const base = join(root, "dsh-home");
    const now = new Date("2026-11-01T00:00:00.000Z");
    const good = (...segments) => join(base, ...segments);  // 同 pathJoiner 语义
    await appendAgedObservation(good, { id: "x", group: "abort-group", daysAgo: 200, now });

    // 让待处置队列不可写：把 `ldvh/pending-queue.jsonl` 造成**目录**，
    // 于是 appendFile 必 EISDIR（`ldvh` 本身须保持目录，缓冲在那里）。
    const { mkdir: mk } = await import("node:fs/promises");
    await mk(join(base, "ldvh", "pending-queue.jsonl"), { recursive: true });

    const broken = (...segments) => join(base, ...segments);
    const read = await readFrictionObservations(broken, PROJECT, { now });

    // 读本身仍成功（惰性结算失败不使整次读失败），但必须如实暴露：
    assert.equal(read.ok, true, "读不应整体失败——失败的是淘汰，不是读取");
    assert.ok(read.value.eviction_registration_error, "登记失败必须带出，不得静默");
    assert.equal(read.value.evicted_pending.length, 0, "登记失败时不得声称已淘汰任何条目");
    assert.equal(read.value.complete, false, "登记失败使读视图不完整——读者不能认为保留期已生效");

    // **关键**：条目必须还在，没有被改写成 evicted。
    const again = await readFrictionObservations(good, PROJECT, { now });
    assert.equal(again.value.by_status.pending, 1, "淘汰被整体放弃，条目仍为 pending");
    assert.equal(again.value.by_status.evicted ?? 0, 0, "不得出现「已淘汰但无登记」");
  });
});


test("容量路径：登记已写但载体回写失败时**销账**，不留「已淘汰」假记录（第四轮审核 F1）", async () => {
  await withTemp("friction-evict-writeback-", async (root) => {
    const base = join(root, "dsh-home");
    const now = new Date("2026-11-01T00:00:00.000Z");
    const good = (...segments) => join(base, ...segments);
    // 容量 1、同组两条 → 第二条写入触发容量淘汰。
    await appendFrictionObservation(good, {
      project: PROJECT, session: "s-1", anchor: "turn 1",
      phenomenon: "第一条", evidence: "证据一\n（来源：turn 1）",
      group: "wb-group", title: "回写失败", basis: "依据", attribution: "测试",
      at: new Date(now.getTime() - 3600_000).toISOString(),
    }, { capacity: 1, now });

    // 让**载体目录不可写**（改名走不动），但 `ldvh` 仍可写、队列仍可追加。
    const { chmod } = await import("node:fs/promises");
    const carrierDir = join(base, "ldvh", "friction-observations");
    await chmod(carrierDir, 0o500);
    let second;
    try {
      second = await appendFrictionObservation(good, {
        project: PROJECT, session: "s-2", anchor: "turn 2",
        phenomenon: "第二条", evidence: "证据二\n（来源：turn 2）",
        group: "wb-group", title: "回写失败", basis: "依据", attribution: "测试",
        at: now.toISOString(),
      }, { capacity: 1, now });
    } finally {
      await chmod(carrierDir, 0o700);
    }

    // ① 失败被如实报出，且**明说观察本身已写入**（F2）。
    assert.equal(second.ok, false, "回写失败必须报失败");
    assert.match(second.error.message, /WAS written and is in the carrier/,
      "须明说观察已落盘——否则调用方会重放、重复计入同一现象");
    assert.match(second.error.message, /did not take effect/, "须说明登记已销账且未生效");

    // ② 队列里那条登记必须被销账，不留「已淘汰」假记录。
    const { readPendingQueue } = await import("../lib/pending-queue.js");
    const unresolved = await readPendingQueue(good);
    assert.equal(unresolved.value.items.length, 0, "回写失败时登记须销账，未完成项应为 0");
    const all = await readPendingQueue(good, { includeResolved: true });
    const resolved = all.value.items.find((e) => e.reason.includes("wb-group"));
    assert.ok(resolved, "登记本身应存在（已写过）");
    assert.ok(resolved.resolved_at !== null, "须被销账");
    assert.match(resolved.note ?? resolved.resolution_note ?? "", /未生效/, "销账须写明「未生效」");
  });
});

test("保留期路径：载体回写失败后重读**不重复登记**，销账后可重新登记（第四轮审核 F1 幂等）", async () => {
  await withTemp("friction-evict-idem-", async (root) => {
    const base = join(root, "dsh-home");
    const now = new Date("2026-11-01T00:00:00.000Z");
    const good = (...segments) => join(base, ...segments);
    await appendAgedObservation(good, { id: "i1", group: "idem-group", daysAgo: 120, now });

    // 让载体目录不可写 → 登记成功、回写失败。
    const { chmod } = await import("node:fs/promises");
    const carrierDir = join(base, "ldvh", "friction-observations");
    await chmod(carrierDir, 0o500);
    let first;
    try {
      first = await readFrictionObservations(good, PROJECT, { now });
    } finally {
      await chmod(carrierDir, 0o700);
    }
    assert.equal(first.ok, true);
    assert.ok(first.value.eviction_registration_error, "回写失败须带出错误");
    assert.equal(first.value.complete, false);

    // 队列里不应残留未完成项（已销账）。
    const { readPendingQueue } = await import("../lib/pending-queue.js");
    const q1 = await readPendingQueue(good);
    assert.equal(q1.value.items.length, 0, "回写失败后不得留下未完成登记");

    // 权限恢复后重读：真的淘汰，重新登记恰好一条（不是两条）。
    const second = await readFrictionObservations(good, PROJECT, { now });
    assert.equal(second.ok, true);
    assert.equal(second.value.eviction_registration_error, null);
    assert.equal(second.value.evicted_pending.length, 1, "第二次应真的淘汰");
    const q2 = await readPendingQueue(good);
    assert.equal(q2.value.items.length, 1, "只应有一条登记——重复登记说明幂等失效");

    // 再读一次：已淘汰，不应再登记。
    const third = await readFrictionObservations(good, PROJECT, { now });
    assert.equal(third.value.evicted_pending.length, 0, "已淘汰的条目不应再次触发淘汰");
    const q3 = await readPendingQueue(good);
    assert.equal(q3.value.items.length, 1, "不得追加第二条登记");
  });
});

test("容量路径：登记失败即整体放弃淘汰——载体条目数不变（第四轮审核 F3，补容量侧钉桩）", async () => {
  await withTemp("friction-evict-capacity-abort-", async (root) => {
    const base = join(root, "dsh-home");
    const now = new Date("2026-11-01T00:00:00.000Z");
    const good = (...segments) => join(base, ...segments);
    await appendFrictionObservation(good, {
      project: PROJECT, session: "s-1", anchor: "turn 1",
      phenomenon: "第一条", evidence: "证据一\n（来源：turn 1）",
      group: "cap-abort", title: "容量中止", basis: "依据", attribution: "测试",
      at: new Date(now.getTime() - 3600_000).toISOString(),
    }, { capacity: 1, now });

    // 队列不可写（做成目录），容量 1 使第二条触发淘汰。
    const { mkdir: mk } = await import("node:fs/promises");
    await mk(join(base, "ldvh", "pending-queue.jsonl"), { recursive: true });

    const second = await appendFrictionObservation(good, {
      project: PROJECT, session: "s-2", anchor: "turn 2",
      phenomenon: "第二条", evidence: "证据二\n（来源：turn 2）",
      group: "cap-abort", title: "容量中止", basis: "依据", attribution: "测试",
      at: now.toISOString(),
    }, { capacity: 1, now });

    assert.equal(second.ok, false, "登记失败须使写入报失败");
    assert.equal(second.error.written, true, "须标记观察已写入");
    assert.equal(second.error.entry_id !== undefined, true, "须给出已写入的 id");
    assert.match(second.error.message, /the observation was written/);
    assert.match(second.error.message, /do not write it again/);

    // **关键**：淘汰被整体放弃——第一条仍是 pending，不是 evicted。
    const after = await readFrictionObservations(good, PROJECT, { now });
    assert.equal(after.value.by_status.evicted ?? 0, 0, "登记失败时不得出现「已淘汰但无登记」");
    assert.equal(after.value.by_status.pending, 2, "两条都应仍在 pending（含刚写入那条）");
  });
});

test("登记前先查重：队列里已有同一条未销账登记时**不重复追加**（第四轮审核 F1 幂等闸）", async () => {
  // 这条守的是「进程在登记之后、载体回写之前崩溃」这种真实形态：登记留在队列里没销账，
  // 下一次读取会再次判定同一批条目该淘汰。若无查重闸，队列会被同一事实反复追加，
  // 且每一条都永远不销账。
  await withTemp("friction-evict-dedup-", async (root) => {
    const base = join(root, "dsh-home");
    const now = new Date("2026-11-01T00:00:00.000Z");
    const good = (...segments) => join(base, ...segments);
    const id = await appendAgedObservation(good, { id: "d1", group: "dedup-group", daysAgo: 120, now });

    // 手工预置一条「上一轮已登记、尚未销账」的记录，登记键与本次判定将产生的键完全一致。
    const { appendPendingEntry } = await import("../lib/pending-queue.js");
    const seeded = await appendPendingEntry(good, {
      task: "friction-discovery",
      reason: "摩擦观察条目的淘汰：组 dedup-group 未达晋升阈值（1/3）即被淘汰",
      residual: ["组 dedup-group 未达晋升阈值（1/3）即被淘汰", `被淘汰条目 id：${id}`,
        "登记键：因保留期到期被淘汰|" + id],
      at: now.toISOString(),
    });
    assert.equal(seeded.ok, true, JSON.stringify(seeded.error));

    const read = await readFrictionObservations(good, PROJECT, { now });
    assert.equal(read.ok, true, JSON.stringify(read.error));
    // 淘汰照常发生（条目确实超期），但**登记不重复追加**。
    assert.equal(read.value.evicted_pending.length, 1, "条目仍应被淘汰");
    assert.equal(read.value.eviction_registrations.length, 0, "同一条登记已存在，不应新写");
    assert.equal(read.value.eviction_registration_error, null, "查重命中不是失败");

    const { readPendingQueue } = await import("../lib/pending-queue.js");
    const queue = await readPendingQueue(good, { includeResolved: true });
    assert.equal(queue.value.items.length, 1, "队列里仍只有那一条，不得追加");
  });
});

test("转写时容量淘汰失败：报「已落地、淘汰未生效」，不得报成「没能追加」（第五轮审核发现 ①）", async () => {
  // 构造：摩擦缓冲已被写满 200 条、且载体目录不可写 → 转写写入成功，但紧随的容量淘汰
  // 无法回写。`appendFrictionObservation` 会返回 `written: true`。
  await withTemp("friction-transfer-evict-", async (root) => {
    const base = join(root, "dsh-home");
    const now = new Date("2026-11-01T00:00:00.000Z");
    const dshHome = (...segments) => join(base, ...segments);

    // 先灌满到 200 条（容量上限），每条不同 group，避免触发晋升语义。
    for (let i = 0; i < 200; i += 1) {
      const r = await appendFrictionObservation(dshHome, {
        project: PROJECT, session: `s-${i}`, anchor: `turn ${i}`,
        phenomenon: `填充条目 ${i}`, evidence: `填充证据 ${i}\n（来源：turn ${i}）`,
        group: `fill-${i}`, title: "填充", basis: "依据", attribution: "测试",
        at: new Date(now.getTime() - (300 - i) * 60_000).toISOString(),
      }, { now });
      assert.equal(r.ok, true, `fill ${i}: ${JSON.stringify(r.error)}`);
    }

    // 让载体目录不可写：写入文件本身还能追加（文件已存在、可写），但 rename 走不动。
    const { chmod } = await import("node:fs/promises");
    const carrierDir = join(base, "ldvh", "friction-observations");
    const carrierFile = join(carrierDir, `${PROJECT}.jsonl`);
    await chmod(carrierDir, 0o500);
    let moved;
    try {
      moved = await transferDiscardedEntryToFriction({
        dshHomePath: dshHome,
        projectId: PROJECT,
        entry: {
          id: "exp-1", status: "discarded",
          phenomenon: "转写的现象", evidence: "转写证据\n来源：session x turn 1",
          session: "session-x", anchor: "turn 1",
        },
        transfer: { title: "转写标题", basis: "依据", attribution: "归因", group: "tx-group" },
        now: new Date(now.getTime() + 60_000),
      });
    } finally {
      await chmod(carrierDir, 0o700);
    }

    // ① 必须是「已落地」这一支，不得是「没能追加」。
    assert.equal(moved.ok, false, "淘汰失败时整体仍报失败（淘汰未生效）");
    assert.equal(moved.error.code, "friction_transfer/appended_with_eviction_pending",
      `应报「已落地、淘汰未生效」，实际 ${moved.error.code}`);
    assert.equal(moved.error.written, true, "须标记写入已生效");
    assert.equal(typeof moved.error.entry_id, "string", "须带出已写入的 id");
    // ② 消息不得自相矛盾——不能同时说「没能追加」与「已在载体里」。
    assert.doesNotMatch(moved.error.message, /could not be appended/, "不得说成没能追加");
    assert.match(moved.error.message, /WAS appended/, "须明说已追加");

    // ③ 该条目确实在载体里（写真的发生了）。
    const read = await readFrictionObservations(dshHome, PROJECT, { now: new Date(now.getTime() + 60_000) });
    assert.equal(read.ok, true, JSON.stringify(read.error));
    assert.ok(read.value.items.some((i) => i.id === moved.error.entry_id),
      "报「已落地」就必须真的落地，否则这个标记是新的假记录");
  });
});
