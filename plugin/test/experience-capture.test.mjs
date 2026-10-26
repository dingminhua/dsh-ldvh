// Tests for 11 §10.1（经验积累·捕获段）的两个实现切片：
//   - lib/experience-capture-contract.js（提示词段 / 输出 schema / 落地前校验）
//   - lib/experience-landing.js（机械通道的落地：只写一条留观缓冲条目）
//
// 权威：specs/11 §10.1（捕获段）与 §12bis（留观缓冲）。
// 断言的是规范行为；实现与规范不符时在任务报告里如实登记，不靠改断言「修正」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { testSignature, withTemp } from "./helpers.mjs";
import {
  CAPTURE_VERDICTS,
  REQUIRED_BODY_SECTIONS,
  buildCapturePromptSection,
  captureOutputSchema,
  validateCaptureBody,
  validateCaptureVerdict,
} from "../lib/experience-capture-contract.js";
import { landCaptureVerdict, residualFromCaptureError } from "../lib/experience-landing.js";
import {
  BUFFER_CAPACITY, BUFFER_REQUIRED_FIELDS, bufferEntryPath, readBufferEntries,
} from "../lib/observation-buffer.js";

const SCOPE = "适用范围：本仓库依赖升级场景；经验可信于同版本组合，跨大版本需重审。";
const WINDOW = "本次材料原文：升级后解析失败反复出现，清理缓存后恢复。";
const EVIDENCE = "升级后解析失败反复出现";
const SOURCE = "session-abc turn 12 / 归档读取流程的输出";

function goodVerdict(overrides = {}) {
  return {
    verdict: "failure-observed",
    phenomenon: "归档读取流程在升级后连续报同一种解析失败",
    evidence: EVIDENCE,
    source: SOURCE,
    candidate_question: "依赖升级与缓存未失效叠加时，解析失败是由哪一层机制触发的",
    quote: EVIDENCE,
    reason: "材料里有一处失败实际发生过",
    ...overrides,
  };
}

/** 六段固定正文（仅为复用 `validateCaptureBody` 的回归断言，捕获段不产出正文）。 */
function goodBody(scope = SCOPE) {
  return [
    "## 症状", "升级后出现重复的解析失败，报错指向同一异常签名。",
    "## 触发条件", "升级依赖到新大版本后首次运行归档读取流程时触发。",
    "## 根因", "依赖内部缓存键变更，旧缓存未失效导致重复命中失败路径。",
    "## 解决", "升级后清理缓存并重建索引；成功信号是读取流程连续通过。",
    "## 规避", "后续升级前先比对缓存键语义；升级批次内同步清理。",
    "## 验证", "已在测试环境观察 3 次连续成功；未覆盖多租户并发升级场景。",
    "## 影响与适用范围", `${scope}\n展开：何时可能踩到、经验何时可信。`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// 契约：闭集与 schema
// ---------------------------------------------------------------------------

test("11 §10.1：判定态是闭集两值——只表达「有无失败现象」，不表达任何入档判断", () => {
  assert.deepEqual([...CAPTURE_VERDICTS], ["failure-observed", "no-failure"]);
});

test("11 §10.1：输出 schema 面向缓冲条目，且不再携带四前提陈述字段", () => {
  const schema = captureOutputSchema();
  // 四前提已按 23 §10 重定位为 draft→active 前置，捕获段不核对。
  for (const f of ["failure_observed", "root_cause_known", "resolution_adopted", "verification_observed"]) {
    assert.equal(schema.properties[f], undefined, `${f} 是四前提陈述，捕获段不得再采集`);
  }
  // 缓冲条目字段齐备。
  for (const f of ["phenomenon", "evidence", "source", "candidate_question", "quote", "reason"]) {
    assert.ok(schema.properties[f] !== undefined, `${f} 须在 schema 内`);
  }
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required], ["verdict", "quote", "reason"]);
});

test("11 §10.1：提示词段自足——只判有无失败，且明确禁止判重复/根因/入档", () => {
  const section = buildCapturePromptSection();
  for (const kw of ["有没有一个失败", "failure-observed", "no-failure", "逐字", "phenomenon", "candidate_question"]) {
    assert.ok(section.includes(kw), `提示词段须说明「${kw}」`);
  }
  assert.ok(section.includes("不判根因"), "须明确不判根因");
  assert.ok(section.includes("重复"), "须明确不判是否重复");
  assert.ok(section.includes("不创建任何经验对象"), "须明确捕获段不建事实对象");
  // 不判重复 ⇒ 不再把既有 Pitfall 列表交给捕获段。
  assert.ok(!section.includes("查重比对对象"), "捕获段不得再收到查重比对对象");
});

test("11 §10.1：提示词段显式声明「宁可多记不可漏记」（失效方向被限定为漏记）", () => {
  const section = buildCapturePromptSection();
  assert.ok(section.includes("不可漏记"));
  assert.ok(section.includes("不可漏记") && section.includes("觉得这条没用"), "须点名「觉得没用」这一具体失效");
});

// ---------------------------------------------------------------------------
// 契约：落地前校验
// ---------------------------------------------------------------------------

test("11 §10.1：合法捕获通过，并合成缓冲载体字段（evidence 附来源引用）", () => {
  const r = validateCaptureVerdict(goodVerdict(), { windowText: WINDOW });
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.verdict, "failure-observed");
  assert.equal(r.value.entry.phenomenon, goodVerdict().phenomenon);
  assert.ok(r.value.entry.evidence.startsWith(EVIDENCE), "evidence 须以逐字片段开头");
  assert.ok(r.value.entry.evidence.includes(SOURCE), "§12bis：evidence 须附来源引用");
  assert.equal(r.value.entry.candidate_question, goodVerdict().candidate_question);
});

test("11 §10.1：非空材料下「无失败」也必须引证（否则恒报无失败不可见）", () => {
  const r = validateCaptureVerdict({ verdict: "no-failure", quote: "", reason: "r" }, { windowText: WINDOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "capture/quote_missing");
});

test("11 §10.1：no-failure 态通过但不产出条目", () => {
  const r = validateCaptureVerdict(
    { verdict: "no-failure", quote: EVIDENCE, reason: "材料里没有失败现象" },
    { windowText: WINDOW },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.entry, null);
});

test("11 §10.1：引证必须真在材料内（不得取自材料外）", () => {
  const r = validateCaptureVerdict(goodVerdict({ quote: "这段话不在材料里", evidence: "这段话不在材料里" }), { windowText: WINDOW });
  assert.equal(r.ok, false, "引证不在材料内须被拒");
  assert.equal(r.error.code, "discovery/quote_not_in_window");
});

test("11 §10.1：缺任一缓冲字段即不通过", () => {
  for (const f of ["phenomenon", "evidence", "source", "candidate_question"]) {
    const r = validateCaptureVerdict(goodVerdict({ [f]: "" }), { windowText: WINDOW });
    assert.equal(r.ok, false, `${f} 为空须被拒`);
    assert.equal(r.error.code, `capture/${f}_missing`);
  }
});

test("11 §12bis：phenomenon 必须是一句话的描述（多句被拒）", () => {
  const r = validateCaptureVerdict(
    goodVerdict({ phenomenon: "升级后报解析失败。清理缓存后恢复。" }),
    { windowText: WINDOW },
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "capture/phenomenon_not_one_sentence");
});

test("11 §12bis：evidence 必须含逐字引证（转述式的 evidence 被拒）", () => {
  const r = validateCaptureVerdict(
    goodVerdict({ evidence: "升级之后会出现反复的解析失败现象" }),
    { windowText: WINDOW },
  );
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "capture/evidence_quote_mismatch");
});

test("11 §12bis：字段长度上限（超出即越界）", () => {
  const r = validateCaptureVerdict(goodVerdict({ source: "s".repeat(257) }), { windowText: WINDOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "capture/source_too_long");
});

test("11 §10.1：判定态越界即拒绝（旧两态 new-experience/no-capture 已不在闭集）", () => {
  for (const verdict of ["new-experience", "no-capture"]) {
    const r = validateCaptureVerdict(goodVerdict({ verdict }), { windowText: WINDOW });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "capture/verdict_out_of_set");
  }
});

// ---------------------------------------------------------------------------
// 契约：七段结构校验仍导出（供审核段复用，捕获段不调用）
// ---------------------------------------------------------------------------

test("23 §8：七段结构校验仍在（审核段复用），且缺段/空段/占位符/H1 都被拒", () => {
  assert.deepEqual([...REQUIRED_BODY_SECTIONS], ["症状", "触发条件", "根因", "解决", "规避", "验证", "影响与适用范围"]);
  assert.ok(validateCaptureBody(goodBody()).ok);

  const missing = validateCaptureBody(goodBody().replace("## 规避", "## 别的"));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "capture/body_section_missing");

  const empty = validateCaptureBody(goodBody().replace("依赖内部缓存键变更，旧缓存未失效导致重复命中失败路径。", ""));
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "capture/body_section_empty");

  const placeholder = validateCaptureBody(goodBody().replace("依赖内部缓存键变更，旧缓存未失效导致重复命中失败路径。", "待查明"));
  assert.equal(placeholder.ok, false);
  assert.equal(placeholder.error.code, "capture/body_placeholder");

  const h1 = validateCaptureBody(`# 标题\n\n${goodBody()}`);
  assert.equal(h1.ok, false);
  assert.equal(h1.error.code, "capture/body_has_h1");
});

// ---------------------------------------------------------------------------
// 落地：机械通道只写缓冲条目（11 §10.1 第 2 项 / §12bis）
// ---------------------------------------------------------------------------

const OBSERVED_AT = "2026-10-20T00:00:00.000Z";

/** 与 `pending-queue.js` / `observation-buffer.js` 同形的 home 解析器。 */
function homeResolver(root) {
  return (...segments) => join(root, ...segments);
}

/**
 * 夹具的管辖项目 id。
 *
 * 11 §12bis 载体段（2026-10 修订）要求缓冲**按管辖项目分文件**；`landCaptureVerdict`
 * 缺 `projectId` 会拒绝写入（避免落进所有项目共用的旧全局载体）。夹具统一给一个固定
 * id，使各用例不必逐个传；验证「缺 projectId 即拒绝」的用例自行 overrides 掉它。
 */
const FIXTURE_PROJECT_ID = "fixture-project";

function landingArgs(dshHomePath, overrides = {}) {
  return {
    dshHomePath: homeResolver(dshHomePath),
    projectId: FIXTURE_PROJECT_ID,
    sessionId: "session-abc",
    anchor: "turn 4..12",
    observationAt: OBSERVED_AT,
    verdict: validateCaptureVerdict(goodVerdict(), { windowText: WINDOW }).value,
    ...overrides,
  };
}

test("11 §10.1：落地写一条缓冲条目，返回 entry_id，且不创建任何 Pitfall", async () => {
  await withTemp("experience-landing.", async (root) => {
    const landed = await landCaptureVerdict(landingArgs(root));
    assert.ok(landed.ok, JSON.stringify(landed.error));
    assert.equal(landed.value.action, "buffer-appended");
    assert.equal(typeof landed.value.entry_id, "string");

    const read = await readBufferEntries(homeResolver(root), { projectId: FIXTURE_PROJECT_ID });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.items.length, 1, "一条运行至多写 1 条（§12bis 纪律 1）");
    const item = read.value.items[0];
    assert.equal(item.status, "pending", "捕获段写入的条目初态必须是 pending");
    assert.equal(item.session, "session-abc");
    assert.equal(item.anchor, "turn 4..12");
    assert.equal(item.at, OBSERVED_AT);
    assert.ok(item.evidence.includes(EVIDENCE), "逐字引证须原样留在条目里");
    assert.ok(item.evidence.includes(SOURCE), "来源引用须留在条目里");
    assert.equal(item.consumed_by, null);

    // 载体字段闭集：多一个字段即越界（§12bis）。
    for (const key of Object.keys(item)) {
      if (key === "settled_at") continue; // 实现侧保留期记账字段，不承载语义
      assert.ok(BUFFER_REQUIRED_FIELDS.includes(key), `条目出现了闭集之外的字段 ${key}`);
    }
  });
});

test("11 §10.1：缓冲载体不存在时读到空集合（不是错误），且落地前不建任何目录外的对象", async () => {
  await withTemp("experience-landing.", async (root) => {
    const read = await readBufferEntries(homeResolver(root), { projectId: FIXTURE_PROJECT_ID });
    assert.ok(read.ok);
    assert.equal(read.value.total, 0);
    assert.equal(read.value.carrier, "absent");
    // 落一条之后载体才出现。
    const landed = await landCaptureVerdict(landingArgs(root));
    assert.ok(landed.ok, JSON.stringify(landed.error));
    const raw = await readFile(bufferEntryPath(homeResolver(root), FIXTURE_PROJECT_ID), "utf8");
    assert.ok(raw.trim().length > 0);
    assert.equal(BUFFER_CAPACITY, 200);
  });
});

test("11 §10.1：no-failure 不写条目（如实登记的「没观察到」，不是「确认没有」）", async () => {
  await withTemp("experience-landing.", async (root) => {
    const landed = await landCaptureVerdict(landingArgs(root, {
      verdict: { verdict: "no-failure", entry: null },
    }));
    assert.ok(landed.ok, JSON.stringify(landed.error));
    assert.equal(landed.value.action, "none");
    assert.equal((await readBufferEntries(homeResolver(root), { projectId: FIXTURE_PROJECT_ID })).value.total, 0, "no-failure 不得留下条目");
  });
});

test("11 §12bis：缓冲不可写时 fail-closed——不得降级为内存或日志", async () => {
  await withTemp("experience-landing.", async (root) => {
    // 在 `<root>/ldvh` 处放一个普通文件：缓冲载体的父路径不是目录，写入必然失败
    // （ENOTDIR），读取也不会返回「空集合」这种成功形状。
    await (await import("node:fs/promises")).writeFile(join(root, "ldvh"), "x");
    const landed = await landCaptureVerdict(landingArgs(root));
    assert.equal(landed.ok, false, "写入失败不得被吞成成功");
    assert.equal(landed.error.stage, "buffer-append");
    assert.match(landed.error.code, /observation_buffer\//);

    // 没有第二处降级载体：既读不到条目，也不假装「读到空集合」。
    const read = await readBufferEntries(homeResolver(root), { projectId: FIXTURE_PROJECT_ID });
    assert.equal(read.ok, false, "载体不可读时不得返回成功形状");
    assert.equal(read.error.code, "observation_buffer/unreadable");
  });
});

test("11 §12bis：取不到来源会话/位置时不臆造——如实拒绝写入", async () => {
  await withTemp("experience-landing.", async (root) => {
    for (const [field, code] of [["sessionId", "capture/session_missing"], ["anchor", "capture/anchor_missing"]]) {
      const landed = await landCaptureVerdict(landingArgs(root, { [field]: "" }));
      assert.equal(landed.ok, false, `${field} 缺失须拒绝`);
      assert.equal(landed.error.code, code);
    }
    assert.equal((await readBufferEntries(homeResolver(root), { projectId: FIXTURE_PROJECT_ID })).value.total, 0);
  });
});

test("11 §10.1：缺失或未校验的 verdict 被拒（不得绕过契约直接落缓冲）", async () => {
  await withTemp("experience-landing.", async (root) => {
    // 这一条测的是 **verdict 缺失**，不是 projectId 缺失——故须把 projectId 补上，
    // 否则新加的必填校验会先命中，断言就从「verdict_missing」跳到「project_missing」，
    // 测的东西变了。
    const noVerdict = await landCaptureVerdict({ dshHomePath: homeResolver(root), projectId: FIXTURE_PROJECT_ID, sessionId: "s", anchor: "a" });
    assert.equal(noVerdict.ok, false);
    assert.equal(noVerdict.error.code, "capture/verdict_missing");

    const noEntry = await landCaptureVerdict(landingArgs(root, { verdict: { verdict: "failure-observed" } }));
    assert.equal(noEntry.ok, false);
    assert.equal(noEntry.error.code, "capture/verdict_unusable");
  });
});

test("11 §12bis：落缓冲不写署名（缓冲条目不是事实对象，字段闭集里没有署名位）", async () => {
  await withTemp("experience-landing.", async (root) => {
    const landed = await landCaptureVerdict(landingArgs(root));
    assert.ok(landed.ok, JSON.stringify(landed.error));
    const item = (await readBufferEntries(homeResolver(root), { projectId: FIXTURE_PROJECT_ID })).value.items[0];
    for (const forbidden of ["change_log", "provider", "model", "signature", "sessionSignature"]) {
      assert.equal(item[forbidden], undefined, `缓冲条目不得带 ${forbidden}（§12bis 字段闭集 9 项）`);
    }
  });
});

test("落地失败须保留完整诊断（issues 明细不得只留 message）", () => {
  const residual = residualFromCaptureError({
    code: "observation_buffer/unavailable",
    message: "carrier is not writable",
    cause: { details: { issues: ["字段 phenomenon 越界", "字段 source 越界"] } },
  });
  assert.ok(residual.some((l) => l.includes("observation_buffer/unavailable")));
  assert.ok(residual.some((l) => l.includes("字段 phenomenon 越界")), "逐条 issues 须保留");
});

// 保持 testSignature 依赖不失效：署名不在缓冲落地路径上，但签名通道仍是
// 事实写入的共用入口，这里断言它仍可取得（防止有人把签名通道一起删掉）。
test("09：签名通道仍可用（事实写入的共用入口，缓冲落地不使用它）", () => {
  const sig = testSignature();
  assert.equal(typeof sig, "object");
  assert.ok(sig !== null);
});
