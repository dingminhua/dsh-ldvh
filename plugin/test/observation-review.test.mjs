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

/**
 * 夹具的管辖项目 id。11 §12bis 载体段（2026-10 修订）要求缓冲按管辖项目分文件；
 * `reviewPendingEntries` 缺 `projectId` 会拒绝（否则会读到所有项目的材料）。
 */
const FIXTURE_PROJECT_ID = "fixture-project";

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
  const appended = await appendBufferEntry(home, validEntry(overrides), { projectId: FIXTURE_PROJECT_ID });
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
  const read = await readBufferEntries(home, { projectId: FIXTURE_PROJECT_ID });
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

test("审核段常量：七段取自 23 §8；产出配额已废止（2026-10-27 修订）", () => {
  assert.deepEqual([...REVIEW_REQUIRED_BODY_SECTIONS], ["症状", "触发条件", "根因", "解决", "规避", "验证", "影响与适用范围"]);
  // 11 §12bis「主要是症状/触发条件/验证三段」——引证复制的主承重段。
  assert.deepEqual([...EVIDENCE_COPY_REQUIRED_SECTIONS], ["症状", "触发条件", "验证"]);
  assert.equal(MIN_VERBATIM_FRAGMENT_LENGTH, 8);
  // 11 §10.2（2026-10-27 修订）：一次派发逐条判定全部待审条目，**没有产出配额**。
  // 常量保留只为兼容导入，值为 null——任何「按它限条数」的写法会立刻失效，而不是
  // 悄悄恢复「每轮 1 条」（那正是积压永远清不完的根因）。
  assert.equal(MAX_CANDIDATES_PER_RUN, null);
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
      const settled = await settleBufferEntry(home, consumedId, { status: "consumed", consumedBy: "uid-existing", projectId: FIXTURE_PROJECT_ID });
      assert.equal(settled.ok, true, JSON.stringify(settled.error));

      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        // 2026-10-27 修订：交出的每一条都必须有判定——「没给提案就默认留 pending」
        // 这个形态已删除（它使待审数永远清不完）。故这里必须给 pending 条目结论。
        proposals: [{ entry_id: pendingId, insufficient: { reason: `材料只有一句 ${EVIDENCE_LINE}，写不出根因与验证两段。` } }],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.formed, null);
      assert.deepEqual(result.value.discarded, [pendingId]);
      assert.equal(result.value.remaining_pending, 0);
      assert.equal(result.value.fail_closed, null);

      const consumed = await readEntry(home, consumedId);
      assert.equal(consumed.status, "consumed");
      assert.equal(consumed.consumed_by, "uid-existing");
      const pending = await readEntry(home, pendingId);
      assert.equal(pending.status, "discarded");
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
        projectId: FIXTURE_PROJECT_ID,
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
        projectId: FIXTURE_PROJECT_ID,
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
        projectId: FIXTURE_PROJECT_ID,
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
        projectId: FIXTURE_PROJECT_ID,
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
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [{ object_uid: uid, status: "active" }],
        proposals: [noDedupe],
        sessionSignature: TEST_SIGNATURE,
      });
      // 2026-10-27 语义变更：单条校验失败**不再整轮拒绝**，只让该条不落地。
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true, "该条未落地 → 整轮须如实标 partial");
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/dedup_not_recorded"),
        `须记下该条未结算的原因：${JSON.stringify(result.value.unsettled)}`,
      );
      // 未形成候选：条目仍 pending，不得被顺手结算。
      assert.equal((await readEntry(home, entryId)).status, "pending");
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 2);
    });
  });
});

// ── 第 2 项：查重已执行（2026-10-27 判据更正）────────────────────────────
//
// 原用例断言「compared 未覆盖全部 active 与 draft → 拒绝」。**该判据已撤销**：
// 规范把这一项定为 **AI 语义审核**（11 §18 该行「校验方式：AI 语义审核」，且
// 未验证范围明写「不证明同机制确不存在」），23 §6.2 正文也没有 `compared` 字段、
// 没有「须枚举全部 object_uid」的表述——那是实现自加的强度。实测后果：执行体如实
// 给出它真比对过的 2–4 个对象，被整体拒绝，审核停在第一条，24 条缓冲永不清空。
//
// 现在校验的是**可机械判定的那一部分**：写过对象是否真取自对照集（不得编造）、
// 对照集非空时不得「一个都没比」。故原用例改写为下面两条。

test("第 2 项：compared 只列**实际比对过的部分**对象 → 放行（不要求枚举完备，23 §6.2 为语义审核）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const [uid] = await seedExistingPitfalls(factSourceRoot);
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        // 对照集里有 2 个对象，但执行体只比对了其中 1 个并如实记录——这**是**合规的。
        existingPitfalls: [{ object_uid: uid, status: "active" }, { object_uid: "uid-draft-uncompared", status: "draft" }],
        proposals: [newCandidateProposal(entryId, {
          dedupe: { checked: true, compared: [uid], conclusion: "new" },
        })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(
        result.ok, true,
        `只比对一部分对象不得被拒（该判据已撤销）：${JSON.stringify(result.error)}`,
      );
    });
  });
});

test("第 2 项：compared 里出现**对照集之外**的 uid → 拒绝（可机械判定的那一部分：不得编造比对对象）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const [uid] = await seedExistingPitfalls(factSourceRoot);
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [{ object_uid: uid, status: "active" }],
        proposals: [newCandidateProposal(entryId, {
          // uid-does-not-exist 不在对照集里——说明它没真读对照集。
          dedupe: { checked: true, compared: [uid, "uid-does-not-exist"], conclusion: "new" },
        })],
        sessionSignature: TEST_SIGNATURE,
      });
      // 2026-10-27：单条校验失败不再整轮拒绝——该条不落地，其余照常，整轮标 partial。
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true, "编造比对对象须使该条不落地");
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/dedup_not_recorded" && /not in the active\/draft comparison set/.test(u.message)),
        `须记下该条未结算的真实原因：${JSON.stringify(result.value.unsettled)}`,
      );
      assert.equal((await readEntry(home, entryId)).status, "pending");
    });
  });
});

test("第 2 项：对照集非空却 compared 为空 → 拒绝（那不是查重，是空过）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const [uid] = await seedExistingPitfalls(factSourceRoot);
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [{ object_uid: uid, status: "active" }],
        proposals: [newCandidateProposal(entryId, {
          dedupe: { checked: true, compared: [], conclusion: "new" },
        })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true, "一个都没比 → 该条不得成文");
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/dedup_not_recorded" && /compared is empty/.test(u.message)),
        `须记下「一个都没比」：${JSON.stringify(result.value.unsettled)}`,
      );
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
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId, { body })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true, "正文不合规 → 该条不得成文");
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/body_invalid"),
        `须记下正文不合规：${JSON.stringify(result.value.unsettled)}`,
      );
      assert.ok(
        result.value.unsettled.some(
          (u) => u.message.includes("buffer:<id>") || u.message.includes("cannot be pointed back"),
        ),
        `message should name the violated rule: ${JSON.stringify(result.value.unsettled)}`,
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
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId, { body: missing })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(short.ok, true, JSON.stringify(short.error));
      assert.equal(short.value.partial, true, "缺一段 → 该条不得成文");
      assert.ok(
        short.value.unsettled.some((u) => u.code === "observation_review/body_invalid"),
        `须记下正文缺段：${JSON.stringify(short.value.unsettled)}`,
      );

      const placeholderBody = goodBody({ symptom: `编辑 config 时出现 ${EVIDENCE_LINE}，待查明。` });
      const withPlaceholder = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId, { body: placeholderBody })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(withPlaceholder.ok, true, JSON.stringify(withPlaceholder.error));
      assert.equal(withPlaceholder.value.partial, true, "含占位符 → 该条不得成文");
      assert.ok(
        withPlaceholder.value.unsettled.some(
          (u) => u.code === "observation_review/body_invalid" && /placeholder/.test(u.message),
        ),
        `须记下占位符：${JSON.stringify(withPlaceholder.value.unsettled)}`,
      );
    });
  });
});

test("第 3 项：缺署名 → signature_unavailable，不写任何对象（03 §6.1 / 06 §6）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId)],
        sessionSignature: null,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true, "缺署名 → 该条不得成文");
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/signature_unavailable" && /REPORT TO HUMAN/.test(u.message)),
        `须记下缺署名并上报：${JSON.stringify(result.value.unsettled)}`,
      );
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
        projectId: FIXTURE_PROJECT_ID,
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
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [{ entry_id: entryId, insufficient: { reason: "看起来没什么用。" } }],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true, "处置理由不可追溯 → 该条不得结算");
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/discard_reason_untraced"),
        `须记下理由不可追溯：${JSON.stringify(result.value.unsettled)}`,
      );
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
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [{ entry_id: entryId, insufficient: {} }],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true, "声明不足却无理由 → 该条不得结算");
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/discard_reason_missing"),
        `须记下缺理由：${JSON.stringify(result.value.unsettled)}`,
      );
      assert.equal((await readEntry(home, entryId)).status, "pending");
    });
  });
});

// ---------------------------------------------------------------------------
// 一次派发逐条判定（11 §10.2，2026-10-27 修订：没有产出配额）
// ---------------------------------------------------------------------------

test("逐条判定：两条合格条目**都**形成候选，不留下没人判的 pending", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const first = await appendEntry(home);
      const second = await appendEntry(home, {
        phenomenon: "另一处以只读身份写配置同样失败。",
        candidate_question: "只读挂载是默认值吗？",
      });
      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(first), newCandidateProposal(second)],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      // 单值字段仍取第一条（兼容既有呈现），完整清单在 formed_all。
      assert.equal(result.value.formed.entry_id, first);
      assert.deepEqual(result.value.formed_all.map((item) => item.entry_id), [first, second]);
      assert.equal(result.value.remaining_pending, 0, "一次派发要把交出的条目全部判完");
      assert.equal((await readEntry(home, first)).status, "consumed");
      assert.equal((await readEntry(home, second)).status, "consumed");
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 2);
    });
  });
});

test("逐条判定：有的成文、有的不足 → 同一次派发各自落地，不留 pending", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const keep = await appendEntry(home);
      const drop = await appendEntry(home, {
        phenomenon: "另一处以只读身份写配置同样失败。",
        candidate_question: "只读挂载是默认值吗？",
      });
      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [
          newCandidateProposal(keep),
          { entry_id: drop, insufficient: { reason: `只有一句 ${EVIDENCE_LINE}，构不成完整机制。` } },
        ],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.deepEqual(result.value.formed_all.map((item) => item.entry_id), [keep]);
      assert.deepEqual(result.value.discarded, [drop]);
      assert.equal(result.value.remaining_pending, 0);
      assert.equal((await readEntry(home, drop)).status, "discarded");
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 1, "被弃的条目不建任何对象");
    });
  });
});

test("交出却没给判定 → **已判定的照常落地、缺判定的留待下次**（2026-10-27：逐条落地）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const first = await appendEntry(home);
      const second = await appendEntry(home, {
        phenomenon: "另一处以只读身份写配置同样失败。",
        candidate_question: "只读挂载是默认值吗？",
      });
      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        // 只给第一条结论：第二条被交出却没有判定。
        proposals: [newCandidateProposal(first)],
        sessionSignature: TEST_SIGNATURE,
      });
      // 2026-10-27：缺判定的条目**不再连累整轮**——已判定的照常落地，缺的那条
      // 留在 pending 下次重交付，整轮标 partial 并把它记进 unsettled。
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true);
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/unjudged_entry" && new RegExp(second).test(u.message)),
        `须点名是哪一条没判：${JSON.stringify(result.value.unsettled)}`,
      );
      // **2026-10-27 语义反转（本用例的名字与断言都已改）**：旧口径是「缺一条即
      // 整轮不成立、零写入」。现口径是**判一条落一条、已落的保留**——故这里的正确
      // 期望正好相反：已判定的第一条**必须**已落地，缺判定的第二条**必须**仍 pending
      // 并在下次重新交付。这正是 Human 2026-10-27 的要求：
      // 「一个一个审核，要么草稿要么作废，相同问题不能审核第二次」。
      assert.equal((await readEntry(home, first)).status, "consumed", "已判定的那条必须已结算（不得因别人没判而作废）");
      assert.equal((await readEntry(home, second)).status, "pending", "缺判定的那条留待下次，不得被顺手结算");
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 1, "已判定成文的那一条须真的写成 draft");
    });
  });
});

test("逐条判定不引入新的放大口子：传 maxCandidates/quota/limit 不改变任何行为", async () => {
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
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: ids.map((id) => newCandidateProposal(id)),
        // 这三个参数都不在入参闭集里；传了也改变不了任何东西（既不放宽也不限流）。
        maxCandidates: 1,
        quota: 1,
        limit: 1,
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.remaining_pending, 0);
      assert.equal(result.value.formed_all.length, 3);
      assert.equal((await listPitfallFiles(factSourceRoot)).length, 3);
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
      projectId: FIXTURE_PROJECT_ID,
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
    assert.equal(bufferEntryPath(home, FIXTURE_PROJECT_ID).endsWith("fixture-project.jsonl"), true);
  });
});

test("载体不存在是合法初态：返回空集合而非错误（§12ter.2）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
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
      //
      // 载体是**追加事件日志**（2026-10-26）：条目在 `{kind:"entry", record}` 的
      // `record` 里。改坏它须改到 record 上，否则改的是事件外壳、测不到读取侧复核。
      const carrierPath = bufferEntryPath(home, FIXTURE_PROJECT_ID);
      const raw = await readFile(carrierPath, "utf8");
      const lines = raw.trim().split("\n").map((line) => {
        const event = JSON.parse(line);
        if (event.kind === "entry" && event.record.id === entryId) event.record.evidence = "";
        return JSON.stringify(event);
      });
      await writeFile(carrierPath, `${lines.join("\n")}\n`, "utf8");

      const result = await reviewPendingEntries({
        dshHomePath: home,
        projectId: FIXTURE_PROJECT_ID,
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
      projectId: FIXTURE_PROJECT_ID,
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
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [newCandidateProposal(entryId, { body: foreignBody })],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(result.value.partial, true, "正文不回指缓冲证据 → 该条不得成文");
      assert.ok(
        result.value.unsettled.some((u) => u.code === "observation_review/body_invalid" && /cannot be pointed back/.test(u.message)),
        `须记下正文不回指：${JSON.stringify(result.value.unsettled)}`,
      );
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
        projectId: FIXTURE_PROJECT_ID,
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

// ── 同题不二审（2026-10-27 逐条落地后的机械形态）──────────────────────────
//
// Human 2026-10-27：「一个一个审核，要么草稿要么作废，相同问题不能审核第二次」。
// 最后半句的机械形态不是「去重记忆」，而是**状态推进**：审核只读 `status=pending`
// 的条目，故一旦判成 consumed 或 discarded，该条就不再出现在候选集里，不可能被
// 二次审核。本用例把这条性质钉住——它比任何去重表都可靠（去重表会漂移，状态不会）。
test("同题不二审：已结算的条目不再进入下一次候选集（靠状态推进，不靠去重记忆）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      const entryId = await appendEntry(home);
      // `withHome` 传进来的就是 joiner 本身（不是路径），不要二次包装。
      const dshHomePath = home;

      // 第一次：判为「不足以成文」→ discarded
      const first = await reviewPendingEntries({
        dshHomePath,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        // 处置理由须与条目 evidence 有 ≥8 字逐字交集，故直接引证夹具的证据行。
        proposals: [{ entry_id: entryId, insufficient: { reason: `材料只有这一行报错：${EVIDENCE_LINE}` } }],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(first.ok, true, JSON.stringify(first.error));
      assert.deepEqual(first.value.discarded, [entryId], "第一次须结算为 discarded");

      // 第二次：不带任何提案，该条不应再被交付
      const second = await reviewPendingEntries({
        dshHomePath,
        projectId: FIXTURE_PROJECT_ID,
        factSourceRoot,
        existingPitfalls: [],
        proposals: [],
        sessionSignature: TEST_SIGNATURE,
      });
      assert.equal(second.ok, true, JSON.stringify(second.error));
      assert.equal(second.value.discarded.length, 0, "已结算条目不得被再次判定");
      assert.equal(second.value.formed, null, "已结算条目不得再成文");
      assert.equal(second.value.unsettled.length, 0, "已结算条目不应出现在 unsettled 里");

      const pendingAfter = await readBufferEntries(dshHomePath, { status: "pending", projectId: FIXTURE_PROJECT_ID });
      assert.equal(pendingAfter.value.items.length, 0, "结算后该条不再是 pending");
    });
  });
});

// ── 并发双写不得产生重复 draft（2026-10-27 实测缺陷的守卫）──────────────────
//
// ## 缺陷
//
// 实测（2026-10-27）：**并发**跑两次审核同一批条目，产出**重复 draft**——
// 3 个条目出了 5 个文件，其中两个标题各出现两次（`createPitfallObject` 用
// `randomUUID()` 分配身份，故每次重复都是一个新对象，事后无法自动认出）。
// 且两次都报 `ok:true`，外面完全看不出来。串行重跑是安全的（结算后条目退出
// 候选集），**只有并发才漏**。
//
// 根因有两层，缺一不可：
//   ① `读 pending → 判 → 写 draft → 写 settle` 之间没有互斥；
//   ② `pending` 是**本轮开始时的快照**，并发的另一方可能在快照之后才结算，
//      于是「锁已释放 + 快照仍显示 pending」叠加，照样重复。
//
// 修法：创建前**先重新核对该条是否仍 pending**，再用 `open(...,"wx")` 原子认领，
// 认领**持有到结算完成**（早先版本在创建成功后就释放，实测仍残留 1 例重复）。
//
// ## 为什么必须用并发测
//
// 串行跑一万次都不会暴露这个缺陷。只有 `Promise.all` 同时起两路、且共用同一
// 缓冲载体与同一事实源根，才能压出那个窗口。
test("并发两次审核同一批条目 → 不得产生重复 draft（3 条目必须恰好 3 个文件）", async () => {
  await withHome(async (home) => {
    await withTemp("observation-review-facts-", async (factSourceRoot) => {
      // 三条各自合法的条目（正文每段都回指 evidence）。
      const ids = [];
      for (const n of [1, 2, 3]) {
        ids.push(await appendEntry(home, {
          phenomenon: `第 ${n} 处以只读身份写配置失败：${EVIDENCE_LINE}`,
          candidate_question: `第 ${n} 次的挂载身份是什么？`,
        }));
      }
      const proposals = ids.map((id, index) => newCandidateProposal(id, {
        title: ["并发守卫证据甲", "并发守卫证据乙", "并发守卫证据丙"][index],
      }));

      const [first, second] = await Promise.all([
        reviewPendingEntries({
          dshHomePath: home, projectId: FIXTURE_PROJECT_ID, factSourceRoot,
          existingPitfalls: [], proposals, sessionSignature: TEST_SIGNATURE,
        }),
        reviewPendingEntries({
          dshHomePath: home, projectId: FIXTURE_PROJECT_ID, factSourceRoot,
          existingPitfalls: [], proposals, sessionSignature: TEST_SIGNATURE,
        }),
      ]);

      // `listPitfallFiles` 返回的是**对象数组**（含 object_uid/status/title），不是路径
      // 字符串——第一版对元素调 `.endsWith` 直接抛 TypeError。
      const files = await listPitfallFiles(factSourceRoot);
      assert.equal(
        files.length, 3,
        `3 个条目必须恰好形成 3 个 draft，实际 ${files.length} 个（多于 3 即重复成文）`,
      );

      // 两路合计成文数也不得超过条目数——多于说明同一条被写成两遍。
      const formedTotal =
        (first.value?.formed_all?.length ?? 0) + (second.value?.formed_all?.length ?? 0);
      assert.equal(formedTotal, 3, `两路合计成文数应为 3，实际 ${formedTotal}`);

      // 落败的那一路必须如实说出「这条被别人处理了」，而不是静默成功。
      const skipped = [
        ...(first.value?.unsettled ?? []),
        ...(second.value?.unsettled ?? []),
      ].filter((u) => ["observation_review/entry_claimed_elsewhere", "observation_review/already_settled"].includes(u.code));
      assert.ok(skipped.length > 0, `被跳过的一路须如实登记原因：${JSON.stringify([first.value?.unsettled, second.value?.unsettled])}`);
    });
  });
});

// ---------------------------------------------------------------------------
// 转写入口（11 §10.2 第 5 项、§9 第 2 项「审核层转写」段，2026-11-01 B 方案）
//
// 守的是**带隙被补上**：一条「出了错、还没修」的材料被判 discarded 时，材料不该
// 就此消失——它要搬到摩擦观察缓冲去继续攒阈值。而「该不该转」是语义判断，由提案
// 中的 `transfer` 承载；机械侧只校验形状与幂等。
// ---------------------------------------------------------------------------

import {
  readFrictionObservations,
} from "../lib/friction-observation-buffer.js";

/** 一条「机制已清楚、只是还没解决」的 discarded 提案。 */
function transferProposal(entryId, overrides = {}) {
  return {
    entry_id: entryId,
    insufficient: {
      reason: `材料说清了失败现象「${EVIDENCE_LINE}」，但没有任何修复动作或验证记录——它还没解决，不是没看懂。`,
    },
    transfer: {
      title: "hook 以只读身份写配置必失败",
      basis: "同一现象反复出现；归因：插件 hook 以只读挂载身份运行；修了会改善。",
      attribution: "插件 hook 运行身份",
      impact: "medium",
      group: "readonly-hook-write-failure",
    },
    ...overrides,
  };
}

test("转写：discarded 且带 transfer 时，材料落到摩擦观察缓冲，discarded 结算不变", async () => {
  await withTemp("observation-transfer.", async (root) => {
    const home = (...segments) => join(root, "dsh-home", ...segments);
    const factSourceRoot = join(root, "fact-source");
    const entryId = await appendEntry(home);

    const reviewed = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot,
      entryIds: [entryId],
      proposals: [transferProposal(entryId)],
      sessionSignature: TEST_SIGNATURE,
      projectId: FIXTURE_PROJECT_ID,
    });
    assert.ok(reviewed.ok, JSON.stringify(reviewed.error));

    // **discarded 的结算不变**：转写不是晋升，它仍然不是 Pitfall 候选。
    assert.deepEqual(reviewed.value.discarded, [entryId]);
    assert.equal(reviewed.value.formed, null);

    // 材料搬到了摩擦缓冲，且证据逐字未走样。
    const friction = await readFrictionObservations(home, FIXTURE_PROJECT_ID);
    assert.ok(friction.ok, JSON.stringify(friction.error));
    assert.equal(friction.value.items.length, 1);
    const item = friction.value.items[0];
    assert.equal(item.evidence, EVIDENCE);
    assert.equal(item.group, "readonly-hook-write-failure");
    assert.equal(item.status, "pending");
    assert.equal(item.impact, "medium");

    assert.equal(reviewed.value.transferred.length, 1);
    assert.equal(reviewed.value.transferred[0].entry_id, entryId);
    assert.deepEqual(reviewed.value.transfer_failed, []);
  });
});

test("转写：不给 transfer 就不转——机械侧不代替执行体判「该不该转」", async () => {
  await withTemp("observation-transfer.", async (root) => {
    const home = (...segments) => join(root, "dsh-home", ...segments);
    const factSourceRoot = join(root, "fact-source");
    const entryId = await appendEntry(home);

    const reviewed = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot,
      entryIds: [entryId],
      proposals: [{
        entry_id: entryId,
        insufficient: { reason: `材料里只有 ${EVIDENCE_LINE}，没有失败机制可写。` },
      }],
      sessionSignature: TEST_SIGNATURE,
      projectId: FIXTURE_PROJECT_ID,
    });
    assert.ok(reviewed.ok, JSON.stringify(reviewed.error));
    assert.deepEqual(reviewed.value.discarded, [entryId]);
    assert.deepEqual(reviewed.value.transferred, []);

    const friction = await readFrictionObservations(home, FIXTURE_PROJECT_ID);
    assert.ok(friction.ok);
    assert.equal(friction.value.items.length, 0, "no transfer must be written without an explicit transfer proposal");
  });
});

test("转写：transfer 字段不全时计入 transfer_failed，但 discarded 结算不回滚", async () => {
  await withTemp("observation-transfer.", async (root) => {
    const home = (...segments) => join(root, "dsh-home", ...segments);
    const factSourceRoot = join(root, "fact-source");
    const entryId = await appendEntry(home);

    const bad = transferProposal(entryId);
    delete bad.transfer.attribution; // 归因是 §18 明写的必填（不得写「暂缺」）。

    const reviewed = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot,
      entryIds: [entryId],
      proposals: [bad],
      sessionSignature: TEST_SIGNATURE,
      projectId: FIXTURE_PROJECT_ID,
    });
    assert.ok(reviewed.ok, JSON.stringify(reviewed.error));

    // discarded 结算照旧（它确实没成为候选，这是对的）。
    assert.deepEqual(reviewed.value.discarded, [entryId]);
    // 但「想转没转成」必须可见——否则又是一处静默（§17）。
    assert.deepEqual(reviewed.value.transferred, []);
    assert.equal(reviewed.value.transfer_failed.length, 1);
    assert.equal(reviewed.value.transfer_failed[0].entry_id, entryId);
    assert.equal(reviewed.value.transfer_failed[0].code, "friction_transfer/proposal_incomplete");

    const friction = await readFrictionObservations(home, FIXTURE_PROJECT_ID);
    assert.ok(friction.ok);
    assert.equal(friction.value.items.length, 0);
  });
});

test("转写失败**登记进 §12 待处置队列**——只进本轮返回体则下一拍没人看得见", async () => {
  // 2026-11-01 审核 F6 用这一例钉住登记载体。转写失败时经验条目**已经**结算成
  // discarded（结算在前、转写在后），结算不可回滚——材料只剩一条「本该搬到摩擦侧
  // 却没搬成」的欠账。它必须在**下一次运行仍可见**，而返回体只在当拍有效。
  await withTemp("observation-transfer.", async (root) => {
    const home = (...segments) => join(root, "dsh-home", ...segments);
    const factSourceRoot = join(root, "fact-source");
    const entryId = await appendEntry(home);

    const bad = transferProposal(entryId);
    delete bad.transfer.attribution;

    const reviewed = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot,
      entryIds: [entryId],
      proposals: [bad],
      sessionSignature: TEST_SIGNATURE,
      projectId: FIXTURE_PROJECT_ID,
    });
    assert.ok(reviewed.ok, JSON.stringify(reviewed.error));
    assert.equal(reviewed.value.transfer_failed.length, 1);

    // 队列里必须有一条，且带残留范围（§8.3 第 2 条：「保留已发生的副作用并如实登记」）。
    const { readPendingQueue } = await import("../lib/pending-queue.js");
    const queue = await readPendingQueue(home);
    assert.ok(queue.ok, JSON.stringify(queue.error));
    const registered = queue.value.items.filter((item) => item.task === "experience-review");
    assert.equal(registered.length, 1, "转写失败必须落队列，不得只在返回体里");
    assert.match(registered[0].reason, /转写未完成/);
    assert.match(registered[0].reason, /friction_transfer\/proposal_incomplete/);
    assert.ok(
      registered[0].residual.some((line) => line.includes(entryId)),
      "残留范围须点名该条目",
    );
    // 返回体里也带出队列登记的 id，使当拍可核。
    assert.equal(reviewed.value.transfer_failed[0].pending_entry_id, registered[0].entry_id);
  });
});

test("fail-closed 出口带出 transferred / transfer_failed 两个键（形状契约）", async () => {
  // 2026-11-01 审核 F5：`failClosed()` 的 partial 早先只有四个具名键，于是
  // `stateSnapshot` 里的 transferred / transfer_failed 被整个丢弃，`ldvh-tools.js`
  // 的 unavailable 分支读到恒为空——一次已经写进摩擦缓冲的转写在失败返回里消失。
  //
  // **这一例只钉「键在不在」，不钉「值有没有传过来」——如实声明它的射程**
  // （2026-11-01 第二轮审核 N4 指出上一版把射程说大了）：
  // `failClosed` 的三处调用里，只有 `recount-pending` 发生在结算之后；另外两处
  // （`read-pending`、`buffer_read_incomplete`）都在任何写入之前，transferred 必然为空。
  // 而 `recount-pending` 的失败条件是「缓冲在运行中途变得不可读」，单线程测试里
  // 无法在不魔改实现的前提下构造（路径固定、`readBufferEntries` 是静态 import，
  // 不可注入）。故**「值经 stateSnapshot 展开传入 failClosed」这条链路没有回归守卫**，
  // 只由 `observation-review.js` 里 `{ stage: "recount-pending", ...stateSnapshot(state, null) }`
  // 这一行与本例的键形状共同保障。不得据本例主张「F5 已被测试钉住」。
  //
  // 本例如实只覆盖：两个键**存在且为数组** —— 它能抓住「键被整个删掉」
  // （这正是最初缺陷的一半），抓不住「值被置空」。
  await withTemp("observation-failclosed-", async (root) => {
    const base = join(root, "dsh-home");
    await mkdir(base, { recursive: true });
    // 在 <base>/ldvh 处放普通文件 → 其下路径必 ENOTDIR，读不出来。
    await writeFile(join(base, "ldvh"), "not a directory\n", "utf8");
    const home = (...segments) => join(base, ...segments);
    const result = await reviewPendingEntries({
      dshHomePath: home,
      projectId: FIXTURE_PROJECT_ID,
      factSourceRoot: join(root, "ldvh-base"),
      existingPitfalls: [],
      proposals: [],
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.fail_closed.code, "observation_buffer/unreadable");
    // **两个键必须在场**——即使是空数组。缺席即「副作用不可见」。
    assert.ok(Array.isArray(result.error.partial.transferred), "partial.transferred must be present");
    assert.ok(Array.isArray(result.error.partial.transfer_failed), "partial.transfer_failed must be present");
  });
});

test("fail-closed 出口**真的带出**已发生的转写失败——钉值，不只钉键（N4 补）", async () => {
  // 上一例只钉「键在不在」。本例把它钉死到**值**上，覆盖第二轮审核 N4 指出的空白。
  //
  // 构造手法：用一个**会观察调用序列**的 `dshHomePath` joiner——
  //   · 它先正常返回路径；
  //   · 一旦被问 `ldvh/pending-queue.jsonl`（这只在 `registerTransferFailure` 里发生，
  //     即「转写已失败并已登记」这一刻）就**上膛**；
  //   · 上膛之后任何对 `experience-buffers/<project>.jsonl` 的请求返回 ENOTDIR 路径，
  //     使 `recount-pending` 的重读失败。
  // 于是必然走到 `failClosed(..., { stage: "recount-pending", ...stateSnapshot(...) })`
  // ——那是**唯一一处**在转写已发生之后才 fail-closed 的调用点。若 `failClosed`
  // 仍把这两个值丢掉，`partial.transfer_failed` 会是空数组，本条断言即红。
  await withTemp("observation-failclosed-value-", async (root) => {
    const base = join(root, "dsh-home");
    await mkdir(base, { recursive: true });
    // 一个普通文件当「坏目录」：其下任何路径必 ENOTDIR。
    await writeFile(join(base, "broken"), "not a directory\n", "utf8");

    let armed = false;
    const home = (...segments) => {
      const joined = [...segments];
      if (joined.includes("pending-queue.jsonl")) {
        armed = true;
        return join(base, ...joined);
      }
      if (armed && joined.includes("experience-buffers")) {
        return join(base, "broken", ...joined);
      }
      return join(base, ...joined);
    };

    const entryId = await appendEntry(home);
    // 转写提案缺 attribution → 必然进 transfer_failed（§18 明写的必填）。
    const bad = transferProposal(entryId);
    delete bad.transfer.attribution;

    const reviewed = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot: join(root, "fact-source"),
      entryIds: [entryId],
      proposals: [bad],
      sessionSignature: TEST_SIGNATURE,
      projectId: FIXTURE_PROJECT_ID,
    });

    // 前置事实：确实走到了 recount-pending 才失败（不是别的 fail-closed）。
    assert.equal(reviewed.ok, false);
    assert.equal(reviewed.error.stage, "recount-pending", `expected recount-pending, got ${reviewed.error.stage}/${reviewed.error.code}`);

    // **值必须传过来**：一条真实的转写失败。
    const failed = reviewed.error.partial.transfer_failed;
    assert.equal(failed.length, 1, "transfer_failed 的值不得被 failClosed 丢弃");
    assert.equal(failed[0].entry_id, entryId);
    assert.equal(failed[0].code, "friction_transfer/proposal_incomplete");
    // 已结算的事实同样带出（discarded 早于转写发生）。
    assert.deepEqual(reviewed.error.partial.discarded, [entryId]);
    // 队列登记也做了（它在 recount 之前）。
    assert.ok(typeof failed[0].pending_entry_id === "string", "登记成功时须带出队列 id");
  });
});

test("转写：同一证据已由发现层记过时跳过，不重复计数", async () => {
  await withTemp("observation-transfer.", async (root) => {
    const home = (...segments) => join(root, "dsh-home", ...segments);
    const factSourceRoot = join(root, "fact-source");
    const entryId = await appendEntry(home);

    // 发现层先记过一次（同一条逐字证据）。
    const { appendFrictionObservation } = await import("../lib/friction-observation-buffer.js");
    const first = await appendFrictionObservation(home, {
      project: FIXTURE_PROJECT_ID,
      session: "sess-2026-03-01-abc",
      anchor: "turn 14..14",
      phenomenon: "编辑 config 时插件在 hook 阶段以只读身份写文件而失败。",
      evidence: EVIDENCE,
      group: "readonly-hook-write-failure",
      title: "hook 以只读身份写配置必失败",
      basis: "发现层记。",
      attribution: "插件 hook 运行身份",
      impact: "medium",
    });
    assert.ok(first.ok, JSON.stringify(first.error));

    const reviewed = await reviewPendingEntries({
      dshHomePath: home,
      factSourceRoot,
      entryIds: [entryId],
      proposals: [transferProposal(entryId)],
      sessionSignature: TEST_SIGNATURE,
      projectId: FIXTURE_PROJECT_ID,
    });
    assert.ok(reviewed.ok, JSON.stringify(reviewed.error));

    assert.equal(reviewed.value.transferred.length, 1);
    assert.equal(reviewed.value.transferred[0].skipped, "already-recorded");
    assert.equal(reviewed.value.transferred[0].existing_id, first.value.entry_id);

    const friction = await readFrictionObservations(home, FIXTURE_PROJECT_ID);
    assert.ok(friction.ok);
    assert.equal(friction.value.items.length, 1, "the duplicate must not be appended a second time");
  });
});

