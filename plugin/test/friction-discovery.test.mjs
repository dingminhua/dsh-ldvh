// Tests for plugin/lib/friction-discovery.js — the §8.4 自动动作闭集.
//
// Every case is derived from specs/36 §9 (the single authority) and specs/26
// (the ledger contract). Where the implementation diverges from the spec the
// failure is reported, never "fixed" by bending the assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadDedupCandidates,
  supplementOccurrence,
  createObserving,
  meetsThreshold,
  promoteIfThresholdMet,
  verifyThresholdAvailable,
  stripLeadingH1,
  FRICTION_THRESHOLD_N,
  MAX_CREATES_PER_RUN,
} from "../lib/friction-discovery.js";
import { readFrictionObject, listFrictionObjects } from "../lib/friction-writer.js";
import { testSignature } from "./helpers.mjs";

const TEST_SIGNATURE = testSignature();

async function withRoot(fn) {
  const base = await mkdtemp(join(tmpdir(), "friction-discovery-"));
  await fn(base);
}

/** 造一条账目：先 createObserving，再按需要补 count。 */
async function seed(base, { count = 1, humanReturnAt = null, title = "重复出现的阻碍" } = {}) {
  const created = await createObserving({
    factSourceRoot: base,
    title,
    phenomenon: "CI 在无缓存时平均耗时 8 分钟。",
    impact: "medium",
    basis: "重复出现多次；归因：CI 配置未缓存依赖层；修了会改善：构建时间明显缩短。",
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  const uid = created.value.object_uid;
  if (count > 1) {
    const read = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    // 直接落一条目标 count 的账（避免逐次递增的测试开销）
    const { updateFrictionObject } = await import("../lib/friction-writer.js");
    const updated = await updateFrictionObject({
      factSourceRoot: base,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        occurrence: { ...read.value.frontmatter.occurrence, count, human_return_at: humanReturnAt },
      },
      bodyMarkdownAfter: stripLeadingH1(read.value.body),
      changeSummary: "测试：直接设定 count",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(updated.ok, JSON.stringify(updated.error));
  }
  return uid;
}

// ---------------------------------------------------------------------------
// N 的固定性（§8.4「阈值 N」：不可配置）
// ---------------------------------------------------------------------------

test("36 §9：N 固定为 3 且不经任何配置载体", () => {
  assert.equal(FRICTION_THRESHOLD_N, 3, "N is pinned to 3 by 36 §9");
  assert.equal(MAX_CREATES_PER_RUN, 1, "§8.4 每次运行上限：至多创建 1 条");
});

test("36 §9：阈值求值可用（N 固定后该校验不再恒不可用）", () => {
  const check = verifyThresholdAvailable();
  assert.ok(check.ok, JSON.stringify(check.error));
  assert.equal(check.value.threshold, 3);
});

// ---------------------------------------------------------------------------
// 第 1 项（读取部分）：候选集
// ---------------------------------------------------------------------------

test("§8.4 第 1 项：候选只含 open 与 observing，终态不入查重范围（26 §12）", async () => {
  await withRoot(async (base) => {
    const observing = await seed(base, { title: "留观中的阻碍" });
    const open = await seed(base, { count: 3, title: "待修的阻碍" });
    await promoteIfThresholdMet({ factSourceRoot: base, objectUid: open, sessionSignature: TEST_SIGNATURE });

    const loaded = await loadDedupCandidates(base);
    assert.ok(loaded.ok, JSON.stringify(loaded.error));
    const uids = loaded.value.candidates.map((c) => c.object_uid);
    assert.ok(uids.includes(observing), "observing is a dedup candidate");
    assert.ok(uids.includes(open), "open is a dedup candidate");
    assert.equal(loaded.value.candidates.length, 2);
    assert.equal(loaded.value.invalid.length, 0);
  });
});

test("§8.4 第 1 项：空账本是合法的空候选，不是失败", async () => {
  await withRoot(async (base) => {
    const loaded = await loadDedupCandidates(base);
    assert.ok(loaded.ok, JSON.stringify(loaded.error));
    assert.deepEqual(loaded.value.candidates, []);
  });
});

// ---------------------------------------------------------------------------
// 第 2 项：补充级更新
// ---------------------------------------------------------------------------

test("§8.4 第 2 项：count 递增 1、last_at 更新、status 不变", async () => {
  await withRoot(async (base) => {
    const uid = await seed(base, { count: 1 });
    const before = await readFrictionObject({ factSourceRoot: base, objectUid: uid });

    const result = await supplementOccurrence({
      factSourceRoot: base,
      objectUid: uid,
      observation: "同一次 CI 卡顿再次出现",
      observationAt: "2026-11-02T00:00:00.000Z",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.count_before, 1);
    assert.equal(result.value.count_after, 2);
    assert.equal(result.value.status, "observing", "supplement must not change status");

    const after = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence.count, 2);
    assert.equal(after.value.frontmatter.occurrence.last_at, "2026-11-02T00:00:00.000Z");
    assert.equal(after.value.frontmatter.occurrence.first_at, before.value.frontmatter.occurrence.first_at, "first_at is immutable evidence");
    assert.ok(after.value.body.includes("同一次 CI 卡顿再次出现"), "the phenomenon section records this sighting");
  });
});

test("§8.4 第 2 项：计数与现象段扩展在同一次更新内完成（26 §9.3）", async () => {
  await withRoot(async (base) => {
    const uid = await seed(base, { count: 1 });
    await supplementOccurrence({
      factSourceRoot: base,
      objectUid: uid,
      observation: "观察记录",
      sessionSignature: TEST_SIGNATURE,
    });
    const after = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    // 二者同源：count 变了，现象段也必有本次记录——不存在只增其一的结果。
    assert.equal(after.value.frontmatter.occurrence.count, 2);
    assert.ok(after.value.body.includes("观察记录"));
  });
});

test("§8.4 第 2 项：终态账目拒绝补充（26 §9.3 计数冻结）", async () => {
  await withRoot(async (base) => {
    const uid = await seed(base, { count: 1 });
    // 转到终态 voided（须带 disposition）
    const { updateFrictionObject } = await import("../lib/friction-writer.js");
    const read = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    const voided = await updateFrictionObject({
      factSourceRoot: base,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "voided", disposition: "根本不是系统性阻碍" },
      bodyMarkdownAfter: `${stripLeadingH1(read.value.body)}\n\n## 处置\n归因错误，废弃。`,
      changeSummary: "测试：转 voided",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(voided.ok, JSON.stringify(voided.error));

    const result = await supplementOccurrence({
      factSourceRoot: base,
      objectUid: uid,
      observation: "不应写入",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!result.ok, "a terminal record's count is frozen");
  });
});

// ---------------------------------------------------------------------------
// 第 3 项：创建 observing
// ---------------------------------------------------------------------------

test("§8.4 第 3 项：创建初态为 observing、count=1、first_at=last_at、human_return_at=null", async () => {
  await withRoot(async (base) => {
    const result = await createObserving({
      factSourceRoot: base,
      title: "机械通道创建",
      phenomenon: "每次全量测试都要 8 分钟。",
      impact: "light",
      basis: "重复出现；归因暂缺，原因：尚未定位到具体子系统；修了会改善：迭代速度。",
      observationAt: "2026-11-01T00:00:00.000Z",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.status, "observing");
    assert.equal(result.value.count, 1);

    const read = await readFrictionObject({ factSourceRoot: base, objectUid: result.value.object_uid });
    assert.equal(read.value.frontmatter.status, "observing");
    assert.equal(read.value.frontmatter.occurrence.count, 1);
    assert.equal(read.value.frontmatter.occurrence.first_at, "2026-11-01T00:00:00.000Z");
    assert.equal(read.value.frontmatter.occurrence.last_at, "2026-11-01T00:00:00.000Z");
    assert.equal(read.value.frontmatter.occurrence.human_return_at, null);
  });
});

test("§8.4 第 3 项：创建**不**要求已达阈值（26 §7 明文：observing 是入口态）", async () => {
  await withRoot(async (base) => {
    const result = await createObserving({
      factSourceRoot: base,
      title: "首次看见",
      phenomenon: "第一次遇到该阻碍。",
      impact: "light",
      basis: "重复出现；归因暂缺，原因：仅见一次；修了会改善：未知。",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, "count=1 即可入账——阈值管的是流转，不是创建");
    assert.equal(result.value.count, 1);
  });
});

// ---------------------------------------------------------------------------
// 第 4 项：阈值流转
// ---------------------------------------------------------------------------

test("§8.4 第 4 项：meetsThreshold 是电平条件——count=3/5 均满足，不要求恰好跨过", () => {
  const base = { status: "observing", occurrence: { count: 3, human_return_at: null } };
  assert.equal(meetsThreshold(base), true, "count == 3 matches");
  assert.equal(meetsThreshold({ ...base, occurrence: { count: 5, human_return_at: null } }), true, "count > 3 also matches (§8.4 电平条件)");
  assert.equal(meetsThreshold({ ...base, occurrence: { count: 2, human_return_at: null } }), false);
  assert.equal(meetsThreshold({ ...base, status: "open" }), false, "already open: idempotent skip");
});

test("§8.4 第 4 项：human_return_at 非空则跳过——Human 的放回留观不得被机械通道撤销（26 §9.2）", () => {
  const guarded = {
    status: "observing",
    occurrence: { count: 5, human_return_at: "2026-11-05T00:00:00.000Z" },
  };
  assert.equal(meetsThreshold(guarded), false, "a Human 放回留观 decision must survive a count ≥ N");
});

test("§8.4 第 4 项：满足条件时 observing → open 并精确回读", async () => {
  await withRoot(async (base) => {
    const uid = await seed(base, { count: 3 });
    const result = await promoteIfThresholdMet({ factSourceRoot: base, objectUid: uid, sessionSignature: TEST_SIGNATURE });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.promoted, true);
    assert.equal(result.value.status, "open");

    const read = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(read.value.frontmatter.status, "open");
    assert.equal(read.value.frontmatter.occurrence.count, 3, "count is preserved across the transition");
  });
});

test("§8.4 第 4 项：未达阈值时不流转，且**不是失败**", async () => {
  await withRoot(async (base) => {
    const uid = await seed(base, { count: 2 });
    const result = await promoteIfThresholdMet({ factSourceRoot: base, objectUid: uid, sessionSignature: TEST_SIGNATURE });
    assert.ok(result.ok, "an unmet threshold is a normal skip, not an error");
    assert.equal(result.value.promoted, false);

    const read = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(read.value.frontmatter.status, "observing");
  });
});

test("§8.4 第 4 项：幂等——对已是 open 的账目重复运行无副作用", async () => {
  await withRoot(async (base) => {
    const uid = await seed(base, { count: 3 });
    const first = await promoteIfThresholdMet({ factSourceRoot: base, objectUid: uid, sessionSignature: TEST_SIGNATURE });
    assert.equal(first.value.promoted, true);
    const fpAfterFirst = first.value.fingerprint;

    const second = await promoteIfThresholdMet({ factSourceRoot: base, objectUid: uid, sessionSignature: TEST_SIGNATURE });
    assert.ok(second.ok, JSON.stringify(second.error));
    assert.equal(second.value.promoted, false, "already open → no match");

    const read = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(read.value.fingerprint, fpAfterFirst, "a repeat run leaves the carrier byte-identical");
  });
});

test("§8.4 第 4 项：human_return_at 非空的账目，即使 count ≥ 3 也不被流转", async () => {
  await withRoot(async (base) => {
    const uid = await seed(base, { count: 5, humanReturnAt: "2026-11-05T00:00:00.000Z" });
    const result = await promoteIfThresholdMet({ factSourceRoot: base, objectUid: uid, sessionSignature: TEST_SIGNATURE });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.promoted, false);

    const read = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(read.value.frontmatter.status, "observing", "Human's 放回留观 stands");
  });
});

// ---------------------------------------------------------------------------
// 边界：机械通道不扩张（§8.4 + §8.2 第 3 条）
// ---------------------------------------------------------------------------

test("§8.4：机械通道不创建 open，也不写终态——创建只产出 observing", async () => {
  await withRoot(async (base) => {
    const result = await createObserving({
      factSourceRoot: base,
      title: "边界检查",
      phenomenon: "检查创建不会越界。",
      impact: "light",
      basis: "重复出现；归因暂缺，原因：测试；修了会改善：无。",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.status, "observing", "§8.4 第 3 项 only creates observing");

    const listed = await listFrictionObjects({ factSourceRoot: base });
    assert.equal(listed.value.items.length, 1);
    assert.equal(listed.value.items[0].status, "observing");
    assert.equal(listed.value.items[0].disposition, undefined, "no terminal field is written by the discovery path");
  });
});

// ---------------------------------------------------------------------------
// 读-写契约不对称的回归守卫（2026-10-12 实测缺陷）
//
// 缺陷形态：`readFrictionObject().body` **含**写入侧生成的 `# <title>`，而
// `updateFrictionObject({bodyMarkdownAfter})` 要的是**不含** H1 的正文（写入侧
// `assembleBody` 会再前置一次）。读-改-写路径若把前者直接回传，每写一次多一个 H1。
//
// 真实影响：账本实测 3 条中招（3048937d H1=3、545cca82 H1=2、bf73fad4 H1=2），
// 且**每次写入都返回成功**——`validateFrictionBodyStructure` 不数 H1 个数、
// §8.4 第 5 项回读只比对 count/last_at，两条通道都给绿灯。
//
// 以下守卫按本仓纪律写成「故意引入即失败」的形态：任一处回退，对应断言即红。
// ---------------------------------------------------------------------------

/** 数正文里的 H1 个数（26 §8：恰好一个，由 title 生成）。 */
function h1CountOf(body) {
  return (body.match(/^ {0,3}#(?!#)[ \t]+\S.*$/gm) ?? []).length;
}

test("回归：补充级更新不得叠加 H1——连跑三次 H1 恒为 1", async () => {
  await withRoot(async (base) => {
    const created = await createObserving({
      factSourceRoot: base,
      title: "H1 叠加回归",
      phenomenon: "补充级更新会重复前置 H1。",
      impact: "medium",
      basis: "重复出现；归因：写入路径；修了会改善：载体结构恢复。",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const uid = created.value.object_uid;

    const before = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(h1CountOf(before.value.body), 1, "创建后的初始 H1 必须恰好一个");

    for (let i = 1; i <= 3; i++) {
      const r = await supplementOccurrence({
        factSourceRoot: base,
        objectUid: uid,
        observation: `第 ${i} 次补充观察。`,
        observationAt: `2026-10-12T0${i}:00:00.000Z`,
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(r.ok, `第 ${i} 次补充须成功：${JSON.stringify(r.error)}`);
      const now = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
      assert.equal(h1CountOf(now.value.body), 1, `第 ${i} 次补充后 H1 仍须恰好一个（叠加即损坏载体，26 §8）`);
      assert.equal(now.value.frontmatter.occurrence.count, i + 1, "计数须照常递增——修复不得以牺牲计数为代价");
    }

    // 载体内聚与结构同时仍成立：内容扩展真的写进去了，而不是「拒绝写入」冒充成功。
    const final = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.ok(final.value.body.includes("第 3 次补充观察"), "现象段须真被扩展");
    assert.ok(final.value.body_valid, `结构须合法：${JSON.stringify(final.value.issues ?? [])}`);
  });
});

test("回归：写入侧拒绝自带 H1 的 bodyMarkdownAfter（契约须被强制，而非只写在文案里）", async () => {
  await withRoot(async (base) => {
    const created = await createObserving({
      factSourceRoot: base,
      title: "契约强制回归",
      phenomenon: "写入侧声称正文不含 H1，但从不校验。",
      impact: "medium",
      basis: "重复出现；归因：写入侧校验缺位；修了会改善：误解当场暴露。",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const uid = created.value.object_uid;
    const read = await readFrictionObject({ factSourceRoot: base, objectUid: uid });

    const { updateFrictionObject } = await import("../lib/friction-writer.js");
    const rejected = await updateFrictionObject({
      factSourceRoot: base,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: read.value.frontmatter,
      // 故意把含 H1 的 body 回传——这正是真实缺陷的形态
      bodyMarkdownAfter: read.value.body,
      changeSummary: "回归：回传含 H1 的正文",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!rejected.ok, "写入侧必须拒绝自带 H1 的正文，不得静默拼接");
    assert.equal(rejected.error?.code, "invalid_request");
    assert.match(rejected.error.message, /must NOT carry the generated H1/, "拒绝理由须指明是 H1 重复，而非泛泛的格式错误");

    // 反向：剥掉 H1 后同一内容必须放行——拒绝的是形态，不是内容。
    const accepted = await updateFrictionObject({
      factSourceRoot: base,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: read.value.frontmatter,
      bodyMarkdownAfter: stripLeadingH1(read.value.body),
      changeSummary: "回归：剥掉 H1 后放行",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(accepted.ok, `剥掉 H1 后须放行：${JSON.stringify(accepted.error)}`);
    const after = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(h1CountOf(after.value.body), 1, "放行后 H1 仍恰好一个");
  });
});

test("回归：阈值流转（observing → open）不得叠加 H1", async () => {
  await withRoot(async (base) => {
    const uid = await seed(base, { count: FRICTION_THRESHOLD_N });
    const promoted = await promoteIfThresholdMet({
      factSourceRoot: base,
      objectUid: uid,
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(promoted.ok, JSON.stringify(promoted.error));
    assert.equal(promoted.value.promoted, true, "达到阈值须流转");
    const after = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(after.value.frontmatter.status, "open");
    assert.equal(h1CountOf(after.value.body), 1, "阈值流转同属读-改-写路径，H1 不得叠加");
  });
});

test("stripLeadingH1：只剥第一个 H1，正文里作为字面内容的 # 行不受影响", () => {
  assert.equal(stripLeadingH1("# 标题\n\n## 现象\n正文\n"), "## 现象\n正文\n");
  assert.equal(stripLeadingH1("\n\n# 标题\n\n## 现象\n"), "## 现象\n");
  // 无 H1：原样返回（只做减法，不替调用方编造 H1）
  assert.equal(stripLeadingH1("## 现象\n正文\n"), "## 现象\n正文\n");
  // 正文里字面出现的 "# " 行（如引用的规范片段）不得被剥
  assert.equal(stripLeadingH1("# 标题\n\n## 现象\n引用：\n# 这是正文里的字面行\n"), "## 现象\n引用：\n# 这是正文里的字面行\n");
  assert.equal(stripLeadingH1(""), "");
  assert.equal(stripLeadingH1(null), "");
});
