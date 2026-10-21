// Tests for plugin/lib/observation-review.js + the two 11 §12ter 公开操作。
//
// Every case is derived from specs/11 (the single authority):
//   §10.2 审核段六项闭集、每次运行上限、「不得做的事」；
//   §12bis 留观缓冲（唯一消费者、证据不留在缓冲、条目只追加）；
//   §12ter.1/§12ter.2 公开操作的输入与结果契约；
//   §18 验证表：经验候选的七段完整、查重已执行、缓冲不可写/不可回读。
// 以及 specs/23 §6.2（查重对照 title 与症状/根因）、§8（七段）、§9.1、§16（入档 Human Gate）。
//
// 断言按规范原文写；实现与规范不一致时在回报里如实报告，不用改断言来“修好”它。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { testSignature, withTemp } from "./helpers.mjs";

import {
  reviewPendingEntries,
  collectExistingPitfalls,
  verifyEvidenceCopy,
  REVIEW_REQUIRED_BODY_SECTIONS,
  EVIDENCE_COPY_REQUIRED_SECTIONS,
  MIN_VERBATIM_FRAGMENT_LENGTH,
  MAX_CANDIDATES_PER_RUN,
} from "../lib/observation-review.js";
import {
  appendBufferEntry,
  readBufferEntries,
  settleBufferEntry,
  bufferEntryPath,
  BUFFER_REQUIRED_FIELDS,
} from "../lib/observation-buffer.js";
import {
  createPitfallObject,
  readPitfallObject,
  listPitfallObjects,
} from "../lib/pitfall-writer.js";

const TEST_SIGNATURE = testSignature();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 证据必须是轮次材料中的逐字片段 + 来源引用（11 §12bis）。 */
const EVIDENCE_LINE = "EACCES: permission denied, open '/tmp/ldvh/config.json'";
const EVIDENCE_SOURCE = "来源：session sess-2026-03-01-abc turn-014";
const EVIDENCE = `${EVIDENCE_LINE}\n${EVIDENCE_SOURCE}`;

/** scope 须逐字出现在「影响与适用范围」段（23 §8 载体内聚）。 */
const GOOD_SCOPE = "适用于插件 hook 写文件的场景；经验可信于同挂载配置。";

const GOOD_TITLE = "hook 写配置时 EACCES 失败";

async function withHome(fn) {
  const base = await mkdtemp(join(tmpdir(), "observation-review-"));
  const home = (...segments) => join(base, ...segments);
  home.base = base;
  return fn(home);
}

/** 造一条合法的待审核条目（11 §12bis 字段闭集）。 */
function validEntry(overrides = {}) {
  return {
    session: "sess-2026-03-01-abc",
    anchor: "turn 14..14",
    phenomenon: "编辑 config 时插件在 hook 阶段以只读身份写文件而失败。",
    evidence: EVIDENCE,
    candidate_question: "hook 是以什么身份写文件的？",
    ...overrides,
  };
}

async function appendEntry(home, overrides = {}) {
  const appended = await appendBufferEntry(home, validEntry(overrides));
  assert.equal(appended.ok, true, `appendBufferEntry failed: ${JSON.stringify(appended.error)}`);
  return appended.value.entry_id;
}

/**
 * 七段正文（23 §8）：每段都含 evidence 的 ≥8 字逐字片段（11 §10.2 第 3 项
 * 「逐段可回指」），并把来源标识逐字复制进正文（§12bis「证据不留在缓冲」）。
 */
function goodBody({ scope = GOOD_SCOPE, symptom = `编辑 config 时出现 ${EVIDENCE_LINE}，写入失败。` } = {}) {
  return [
    `## 症状\n${symptom}`,
    "## 触发条件\n首次运行归档读取流程、插件尝试写 /tmp/ldvh/config.json 时触发。",
    `## 根因\nhook 以只读挂载身份运行，于是出现 ${EVIDENCE_LINE}。`,
    `## 解决\n以可写身份运行 hook；成功信号是不再出现 ${EVIDENCE_LINE}。`,
    `## 规避\n改配置前先确认 hook 身份；命中 ${EVIDENCE_LINE} 时先查挂载。`,
    `## 验证\nsession sess-2026-03-01-abc turn-014 显示连续 3 次成功，不再出现 ${EVIDENCE_LINE}。`,
    `## 影响与适用范围\n${scope}\n展开：何时可能踩到、经验何时可信（${EVIDENCE_LINE}）。`,
  ].join("\n\n");
}

/** 一条「形成新候选」的完整提案（查重已执行、对照集覆盖空集）。 */
function newCandidateProposal(entryId, overrides = {}) {
  return {
    entry_id: entryId,
    dedupe: { checked: true, compared: [], conclusion: "new" },
    title: GOOD_TITLE,
    scope: GOOD_SCOPE,
    body: goodBody(),
    ...overrides,
  };
}

/** 把两条既有 Pitfall（active + draft）写进临时事实源，返回它们的 object_uid。 */
async function seedExistingPitfalls(factSourceRoot) {
  const bodies = (scope) => [
    `## 症状\n升级后出现重复的解析失败。`,
    `## 触发条件\n升级 SG-4 后首次运行归档读取流程。`,
    `## 根因\n缓存键变更导致重复命中失败路径。`,
    `## 解决\n清理缓存并重建索引。`,
    `## 规避\n升级前先比对缓存键语义。`,
    `## 验证\n已在测试环境观察 3 次连续成功。`,
    `## 影响与适用范围\n${scope}`,
  ].join("\n\n");

  const active = await createPitfallObject({
    factSourceRoot,
    frontmatterDraft: {
      title: "SG-4 升级后重复解析失败",
      status: "active",
      scope: "适用于依赖升级场景。",
      change_summary: "测试种子（active）",
    },
    bodyMarkdown: bodies("适用于依赖升级场景。"),
    sessionSignature: TEST_SIGNATURE,
  });
  assert.equal(active.ok, true, JSON.stringify(active.error));

  const draft = await createPitfallObject({
    factSourceRoot,
    frontmatterDraft: {
      title: "归档读取流程的缓存残留",
      status: "draft",
      scope: "适用于归档读取场景。",
      change_summary: "测试种子（draft）",
    },
    bodyMarkdown: bodies("适用于归档读取场景。"),
    sessionSignature: TEST_SIGNATURE,
  });
  assert.equal(draft.ok, true, JSON.stringify(draft.error));

  return [active.value.object_uid, draft.value.object_uid];
}

async function readEntry(home, entryId) {
  const read = await readBufferEntries(home);
  assert.equal(read.ok, true, JSON.stringify(read.error));
  return read.value.items.find((item) => item.id === entryId) ?? null;
}

async function listPitfallFiles(factSourceRoot) {
  const listed = await listPitfallObjects({ factSourceRoot, statusFilter: ["active", "draft", "discarded"], limit: 200 });
  assert.equal(listed.ok, true, JSON.stringify(listed.error));
  return listed.value.items;
}

// ---------------------------------------------------------------------------
// 常量与模块边界
// ---------------------------------------------------------------------------

test("审核段常量：七段取自 23 §8，配额是模块内不可调常量", () => {
  assert.deepEqual([...REVIEW_REQUIRED_BODY_SECTIONS], ["症状", "触发条件", "根因", "解决", "规避", "验证", "影响与适用范围"]);
  // 11 §12bis「主要是症状/触发条件/验证三段」——引证复制的主承重段。
  assert.deepEqual([...EVIDENCE_COPY_REQUIRED_SECTIONS], ["症状", "触发条件", "验证"]);
  assert.equal(MIN_VERBATIM_FRAGMENT_LENGTH, 8);
  // 11 §10.2：一次运行至多形成 1 条候选，且「配额不接受调用方放大」（§12ter.1）。
  assert.equal(MAX_CANDIDATES_PER_RUN, 1);
});

test("reviewPendingEntries 拒绝非函数形态的 dshHomePath（缓冲句柄不可推测）", async () => {
  const result = await reviewPendingEntries({ dshHomePath: "/tmp/nope", factSourceRoot: "/tmp/nope" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "observation_review/invalid_request");
});

// ---------------------------------------------------------------------------
// 第 1 项：只读 status=pending 的缓冲条目
// ---------------------------------------------------------------------------

test("第 1 项：只处理 pending 条目——已结算条目不再进入审核", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const pendingId = await appendEntry(home, { phenomenon: "第一次以只读身份写配置失败。" });
      const consumedId = await appendEntry(home, { phenomenon: "第二次以只读身份写配置失败。" });
      const settled = await settleBufferEntry(home, consumedId, { status: "consumed", consumedBy: "uid-existing" });
      assert.equal(settled.ok, true, JSON.stringify(settled.error));

      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      // 没有提案 → 不形成候选、也不判 discarded（条目原样留 pending）。
      assert.equal(result.value.formed, null);
      assert.deepEqual(result.value.discarded, []);
      assert.equal(result.value.remaining_pending, 1);
      assert.equal(result.value.fail_closed, null);

      const consumed = await readEntry(home, consumedId);
      assert.equal(consumed.status, "consumed");
      assert.equal(consumed.consumed_by, "uid-existing");
      const pending = await readEntry(home, pendingId);
      assert.equal(pending.status, "pending");
    });
  });
});

test("第 1 项：entry_id 定向——只处理指定条目，其余留 pending", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const first = await appendEntry(home, { phenomenon: "第一条以只读身份写配置失败。" });
      const second = await appendEntry(home, { phenomenon: "第二条以只读身份写配置失败。" });
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        entryId: second,
        existingPitfalls: [],
        proposals: [newCandidateProposal(second)],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.formed.entry_id, second);
      assert.equal(result.value.remaining_pending, 1);
      assert.equal((await readEntry(home, first)).status, "pending");
      assert.equal((await readEntry(home, second)).status, "consumed");
    });
  });
});

test("第 1 项：entry_id 指向不存在的条目 → entry_not_found（不猜、不顺手处理别的条目）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        entryId: "no-such-entry",
        existingPitfalls: [],
        proposals: [],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "observation_review/entry_not_found");
    });
  });
});

// ---------------------------------------------------------------------------
// 第 2–4 项：查重 → 建 draft → 精确回读 → 结算 consumed
// ---------------------------------------------------------------------------

test("第 3–4 项：形成一条 draft 候选，并把条目置 consumed 指向该候选", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId)],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      const formed = result.value.formed;
      assert.equal(formed.entry_id, entryId);
      assert.match(formed.object_uid, /^[0-9a-f-]{36}$/i);
      assert.equal(result.value.duplicate, null);
      assert.deepEqual(result.value.discarded, []);
      assert.equal(result.value.remaining_pending, 0);

      // 候选初态只能是 draft（23 §13 / 11 §10.2：建 active 属 Human Gate，不在此）。
      const readBack = await readPitfallObject({ factSourceRoot, objectUid: formed.object_uid });
      assert.equal(readBack.ok, true, JSON.stringify(readBack.error));
      assert.equal(readBack.value.frontmatter.status, "draft");
      assert.equal(readBack.value.frontmatter.disposition, undefined);
      assert.equal(readBack.value.body_valid, true);
      // 逐字引证与来源标识必须已复制进正文（§12bis「证据不留在缓冲」）。
      assert.ok(readBack.value.body.includes(EVIDENCE_LINE));
      assert.ok(readBack.value.body.includes("session sess-2026-03-01-abc"));
      // 不得只写 buffer:<id> 而不带引证。
      assert.equal(/\bbuffer:[0-9a-zA-Z._:-]+/.test(readBack.value.body), false);
      // change_log 由 Code 署名（03 §6.1），summary 指明审核段入口。
      const entry = readBack.value.frontmatter.change_log.at(-1);
      assert.equal(entry.provider, "test-provider");
      assert.equal(entry.model, "test-model");
      assert.match(entry.summary, /审核段/);

      // 条目已结算：consumed + consumed_by = 候选 object_uid。
      const settledEntry = await readEntry(home, entryId);
      assert.equal(settledEntry.status, "consumed");
      assert.equal(settledEntry.consumed_by, formed.object_uid);
      // 悬空检查：consumed_by 指向的对象真实存在。
      const pointed = await readPitfallObject({ factSourceRoot, objectUid: settledEntry.consumed_by });
      assert.equal(pointed.ok, true);
    });
  });
});

test("第 2 项：查重命中 → 不新建、条目 consumed 指向既有对象", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const [existingUid] = await seedExistingPitfalls(factSourceRoot);
      const before = (await listPitfallFiles(factSourceRoot)).length;
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [{ object_uid: existingUid, status: "active" }],
        proposals: [{
          entry_id: entryId,
          dedupe: { checked: true, compared: [existingUid], conclusion: "duplicate", duplicate_of: existingUid },
        }],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.formed, null);
      assert.deepEqual(result.value.duplicate, { entry_id: entryId, object_uid: existingUid });
      assert.equal((await listPitfallFiles(factSourceRoot)).length, before, "查重命中不得新建任何对象");
      const entry = await readEntry(home, entryId);
      assert.equal(entry.status, "consumed");
      assert.equal(entry.consumed_by, existingUid);
      assert.equal(result.value.remaining_pending, 0);
    });
  });
});

test("第 2 项：查重未登记 → fail-closed（不得在无对照记录时形成候选）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const [uid] = await seedExistingPitfalls(factSourceRoot);
      const entryId = await appendEntry(home);
      const base = newCandidateProposal(entryId);
      const noDedupe = { entry_id: base.entry_id, title: base.title, scope: base.scope, body: base.body };
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [{ object_uid: uid, status: "active" }],
        proposals: [noDedupe],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "observation_review/dedup_not_recorded");
      assert.equal(result.error.stage, "verify-dedup");
      assert.equal(result.error.fail_closed.code, "observation_review/dedup_not_recorded");
      // 未形成候选：条目仍 pending，不得被顺手结算。
      assert.equal((await readEntry(home, entryId)).status, "pending");
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 2);
    });
  });
});

test("第 2 项：对照集未覆盖全部 active 与 draft → 拒绝（23 §6.2 含 draft）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const [uid] = await seedExistingPitfalls(factSourceRoot);
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [{ object_uid: uid, status: "active" }, { object_uid: "uid-draft-uncompared", status: "draft" }],
        proposals: [newCandidateProposal(entryId, {
          dedupe: { checked: true, compared: [uid], conclusion: "new" },
        })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "observation_review/dedup_not_recorded");
      assert.match(result.error.message, /does not cover every active\/draft/);
      assert.equal((await readEntry(home, entryId)).status, "pending");
    });
  });
});

test("第 3 项：正文只写 buffer:<id> 而不复制逐字引证 → 拒绝创建，条目仍 pending", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const body = [
        `## 症状\n依据 buffer:${entryId}。`,
        "## 触发条件\n编辑 config 时触发。",
        "## 根因\nhook 以只读挂载身份运行。",
        "## 解决\n以可写身份运行 hook。",
        "## 规避\n改配置前先确认 hook 身份。",
        "## 验证\n连续 3 次成功。",
        `## 影响与适用范围\n${GOOD_SCOPE}`,
      ].join("\n\n");
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId, { body })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "observation_review/body_invalid");
      assert.equal(result.error.stage, "verify-body");
      assert.ok(
        result.error.message.includes("buffer:<id>") || result.error.message.includes("cannot be pointed back"),
        `message should name the violated rule: ${result.error.message}`,
      );
      // 拒绝发生在 createPitfallObject 之前：未建任何对象。
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 0);
      assert.equal((await readEntry(home, entryId)).status, "pending");
    });
  });
});

test("第 3 项：正文缺一段 / 含占位符 → 拒绝创建（23 §9.1、11 §18）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const missing = goodBody().replace("## 规避\n改配置前先确认 hook 身份；命中 " + EVIDENCE_LINE + " 时先查挂载。\n\n", "");
      const short = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId, { body: missing })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(short.ok, false);
      assert.equal(short.error.code, "observation_review/body_invalid");

      const placeholderBody = goodBody({ symptom: `编辑 config 时出现 ${EVIDENCE_LINE}，待查明。` });
      const withPlaceholder = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId, { body: placeholderBody })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(withPlaceholder.ok, false);
      assert.equal(withPlaceholder.error.code, "observation_review/body_invalid");
      assert.match(withPlaceholder.error.message, /placeholder/);
    });
  });
});

test("第 3 项：缺署名 → signature_unavailable，不写任何对象（03 §6.1 / 06 §6）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId)],
        sessionSignature: null,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "observation_review/signature_unavailable");
      assert.equal(result.error.stage, "signature");
      assert.match(result.error.message, /REPORT TO HUMAN/);
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 0);
      assert.equal((await readEntry(home, entryId)).status, "pending");
    });
  });
});

// ---------------------------------------------------------------------------
// 第 5 项：条目不足以成文 → discarded（不是否决经验）
// ---------------------------------------------------------------------------

test("第 5 项：声明条目不足 → discarded，且理由须带证据片段（可追溯的处置）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const reason = `材料里只有一句 ${EVIDENCE_LINE}，不足以写出根因与验证两段。`;
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [{ entry_id: entryId, insufficient: { reason } }],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.deepEqual(result.value.discarded, [entryId]);
      assert.equal(result.value.formed, null);
      const entry = await readEntry(home, entryId);
      assert.equal(entry.status, "discarded");
      assert.equal(entry.consumed_by, null);
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 0, "discarded 不得顺手建档");
    });
  });
});

test("第 5 项：discarded 理由与证据毫无逐字关联 → 拒绝（处置本身须可追溯）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [{ entry_id: entryId, insufficient: { reason: "看起来没什么用。" } }],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "observation_review/discard_reason_untraced");
      assert.equal((await readEntry(home, entryId)).status, "pending");
    });
  });
});

test("第 5 项：声明不足却没给理由 → 拒绝（不得用缺省代替如实登记）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [{ entry_id: entryId, insufficient: {} }],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "observation_review/discard_reason_missing");
      assert.equal((await readEntry(home, entryId)).status, "pending");
    });
  });
});

// ---------------------------------------------------------------------------
// 每次运行上限：至多 1 条候选，其余留 pending（不得静默丢料）
// ---------------------------------------------------------------------------

test("每次运行上限：两条合格条目也至多形成 1 条候选，第二条留 pending", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const first = await appendEntry(home);
      const second = await appendEntry(home, {
        phenomenon: "另一处以只读身份写配置同样失败。",
        candidate_question: "只读挂载是默认值吗？",
      });
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(first), newCandidateProposal(second)],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.formed.entry_id, first);
      assert.equal(result.value.remaining_pending, 1);
      // 未处理者不是被移除、也不是被判 discarded——它仍 pending 等下次运行。
      assert.equal((await readEntry(home, second)).status, "pending");
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 1);
    });
  });
});

test("每次运行上限：配额的入参无法放大（传 proposals 数量不改变上限）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const ids = [];
      for (const n of [1, 2, 3]) {
        ids.push(await appendEntry(home, {
          phenomenon: `第 ${n} 处以只读身份写配置失败。`,
          candidate_question: `第 ${n} 次的挂载身份是什么？`,
        }));
      }
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: ids.map((id) => newCandidateProposal(id)),
        // 试图用参数放大配额——模块内没有任何入参能改写 MAX_CANDIDATES_PER_RUN。
        maxCandidates: 3,
        quota: 3,
        limit: 3,
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.remaining_pending, 2);
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// fail-closed：缓冲不可读 / 回读不完整都不得返回成功形状
// ---------------------------------------------------------------------------

test("§12bis 纪律 4：缓冲不可读 → fail-closed，不返回成功形状、不降级", async () => {
  await withTemp("observation-review-unreadable-", async (base) => {
    // 在 <base>/ldvh 处放一个普通文件：其下的 observation-buffer.jsonl 路径
    // 必然 ENOTDIR，读不出来——用来构造「载体不可读」而不依赖权限位。
    await writeFile(join(base, "ldvh"), "not a directory\n", "utf8");
    const home = (...segments) => join(base, ...segments);
    const result = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot: join(base, "ldvh-base"),
      existingPitfalls: [],
      proposals: [],
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "observation_buffer/unreadable");
    assert.equal(result.error.stage, "read-pending");
    assert.equal(result.error.fail_closed.code, "observation_buffer/unreadable");
    assert.equal(typeof result.error.fail_closed.message, "string");
    // 成功形状的字段一个都不许有——不得「返回空集合冒充成功」。
    assert.equal("value" in result, false);
    assert.equal(bufferEntryPath(home).endsWith("observation-buffer.jsonl"), true);
  });
});

test("载体不存在是合法初态：返回空集合而非错误（§12ter.2）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.formed, null);
      assert.equal(result.value.duplicate, null);
      assert.deepEqual(result.value.discarded, []);
      assert.equal(result.value.remaining_pending, 0);
      assert.equal(result.value.fail_closed, null);
    });
  });
});

test("条目字段闭集不齐 / status 不是 pending → fail-closed（缓冲写入合法性读取侧复核）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      // 手工把 evidence 抹成空串：模拟一个「载体上存在但字段闭集不合法」的条目。
      const carrierPath = bufferEntryPath(home);
      const raw = await readFile(carrierPath, "utf8");
      const lines = raw.trim().split("\n").map((line) => {
        const record = JSON.parse(line);
        if (record.id === entryId) record.evidence = "";
        return JSON.stringify(record);
      });
      await writeFile(carrierPath, `${lines.join("\n")}\n`, "utf8");

      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId)],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, false);
      // settleBufferEntry/readBufferEntries 的存储侧校验先拦下（entry 进 invalid，
      // complete=false），或审核段自己的 carriage 校验拦下——两条都必须 fail-closed。
      assert.ok(
        ["observation_review/buffer_read_incomplete", "observation_review/entry_carriage_invalid"].includes(result.error.code),
        `expected a fail-closed code, got ${result.error.code}`,
      );
      assert.notEqual(result.error.fail_closed, undefined);
    });
  });
});

// ---------------------------------------------------------------------------
// 「不读实时对话」的机械形态
// ---------------------------------------------------------------------------

test("入参闭集：传 messages/transcript/history 不改变任何行为（结构上读不到）", async () => {
  const run = async (extra) => withHome(async (home) => withTemp("observation-review-facts-", async (factSourceRoot) => {
    const entryId = await appendEntry(home);
    const result = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot,
      existingPitfalls: [],
      proposals: [newCandidateProposal(entryId)],
      sessionSignature: TEST_SIGNATURE,
      ...extra,
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const stored = await readPitfallObject({ factSourceRoot, objectUid: result.value.formed.object_uid });
    return {
      // 条目 id 与 object_uid 是随机 UUID（每次运行必然不同），不参与比对；
      // 关键是「这次运行是否只处理了这一条、结果形状是否一致」。
      formedEntryIsThePendingEntry: result.value.formed.entry_id === entryId,
      duplicate: result.value.duplicate,
      discarded: result.value.discarded,
      remaining_pending: result.value.remaining_pending,
      status: stored.value.frontmatter.status,
      title: stored.value.frontmatter.title,
      scope: stored.value.frontmatter.scope,
      // 会话正文若真被读到，最可能渗进正文——把它一并纳入比对。
      body: stored.value.body,
    };
  }));

  const plain = await run({});
  const tainted = await run({
    messages: [{ role: "user", content: "会话正文里的另一段材料：完全无关的对话内容" }],
    transcript: "user: 别的对话\nassistant: 别的回答",
    history: { turns: 99 },
    conversation: "不该进入审核段的材料",
  });
  assert.deepEqual(tainted, plain, "这些字段在模块里没有任何读取点——传进来必须毫无作用");
});

test("材料只有一条通路：提案里的正文段落若不回指缓冲证据 → 拒绝（不得引用缓冲外材料）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      // 七段结构齐、但内容来自「别处」（不含任何缓冲证据片段）。
      const foreignBody = [
        "## 症状\n构建脚本在 CI 上偶发超时。",
        "## 触发条件\n并发任务数超过 8 时出现。",
        "## 根因\n调度器队列长度无上限。",
        "## 解决\n给队列加长度上限。",
        "## 规避\n并发数保持在 4 以下。",
        "## 验证\n观察 5 次未再超时。",
        `## 影响与适用范围\n${GOOD_SCOPE}`,
      ].join("\n\n");
      const result = await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId, { body: foreignBody })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "observation_review/body_invalid");
      assert.match(result.error.message, /cannot be pointed back/);
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// verifyEvidenceCopy 的单元级正反向
// ---------------------------------------------------------------------------

test("verifyEvidenceCopy：七段齐备且逐字回指 → 通过", () => {
  const verdict = verifyEvidenceCopy(goodBody(), { evidence: EVIDENCE });
  assert.equal(verdict.ok, true, verdict.issues.join(" | "));
});

test("verifyEvidenceCopy：H2 段序不符 → 拒绝（23 §8 固定序）", () => {
  const swapped = goodBody().replace("## 根因", "## 别的");
  const verdict = verifyEvidenceCopy(swapped, { evidence: EVIDENCE });
  assert.equal(verdict.ok, false);
  assert.match(verdict.issues.join(" | "), /expected 7 H2 sections/);
});

test("verifyEvidenceCopy：空段 → 拒绝（23 §9.1）", () => {
  const emptied = goodBody().replace(/## 解决\n[^\n]+/, "## 解决\n");
  const verdict = verifyEvidenceCopy(emptied, { evidence: EVIDENCE });
  assert.equal(verdict.ok, false);
  assert.match(verdict.issues.join(" | "), /is empty/);
});

test("verifyEvidenceCopy：未复制来源标识 → 拒绝（§12bis：引证连来源一起复制）", () => {
  // 七段都仍含引证，但把唯一的来源标识抹掉。
  const withoutSource = goodBody().replace("session sess-2026-03-01-abc turn-014 显示连续 3 次成功", "连续 3 次成功");
  const verdict = verifyEvidenceCopy(withoutSource, { evidence: EVIDENCE });
  assert.equal(verdict.ok, false);
  assert.match(verdict.issues.join(" | "), /source reference .* was copied into the body|no source reference/i);
});

// ---------------------------------------------------------------------------
// 查重对照集：active + draft 在范围内（23 §6.2）
// ---------------------------------------------------------------------------

test("collectExistingPitfalls：对照集含 active 与 draft，标出可比性", async () => {
  await withTemp("observation-review-facts-", async (factSourceRoot) => {
    const uids = await seedExistingPitfalls(factSourceRoot);
    const collected = await collectExistingPitfalls({ factSourceRoot });
    assert.equal(collected.ok, true, JSON.stringify(collected.error));
    const byUid = new Map(collected.value.items.map((item) => [item.object_uid, item]));
    for (const uid of uids) {
      assert.ok(byUid.has(uid), `对照集缺少 ${uid}（23 §6.2：active 与 draft 都须在范围内）`);
      const item = byUid.get(uid);
      assert.equal(item.comparable, true);
      assert.ok(item.title.length > 0);
      assert.ok(item.symptoms.length > 0, "症状正文取不到就无法做语义比对");
      assert.ok(item.root_cause.length > 0, "根因正文取不到就无法做语义比对");
    }
  });
});

test("collectExistingPitfalls：缺 factSourceRoot → invalid_request（不得返回空对照集冒充「已比对」）", async () => {
  const collected = await collectExistingPitfalls({});
  assert.equal(collected.ok, false);
  assert.equal(collected.error.code, "observation_review/invalid_request");
});

// ---------------------------------------------------------------------------
// 缓冲条目的字段闭集与只追加性
// ---------------------------------------------------------------------------

test("结算只改 status/consumed_by：条目其余字段逐字保持（§12bis 条目只追加）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const before = await readEntry(home, entryId);
      await reviewPendingEntries({
        dshHomePath: home,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId)],
        sessionSignature: TEST_SIGNATURE,
      });
      const after = await readEntry(home, entryId);
      for (const field of BUFFER_REQUIRED_FIELDS) {
        if (field === "status" || field === "consumed_by") continue;
        assert.deepEqual(after[field], before[field], `字段 ${field} 被改动了——条目只追加、不改写`);
      }
      assert.equal(after.status, "consumed");
    });
  });
});
