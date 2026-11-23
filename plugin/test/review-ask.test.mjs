import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COMPLEXITY_CRITERIA,
  GATE_POINT_EXCLUSIONS,
  REVIEW_ASK_ANSWERS,
  REVIEW_ASK_POINTS,
  askEnabledFor,
  composeReviewAsk,
  findReviewAskDecision,
  recordReviewAskDecision,
  resolveReviewAskSettings,
  reviewAskFingerprint,
  reviewAskMode,
  silentRunNotice,
} from "../lib/review-ask.js";
import { selfReviewDispatchTemplate } from "../lib/review-dispatch-template.js";

test("resolveReviewAskSettings：两代宿主取值形态都认，缺省按关", () => {
  const both = resolveReviewAskSettings({ preActionReviewAskEnabled: true, postWorkReviewAskEnabled: false });
  assert.equal(both.preAction, true);
  assert.equal(both.postWork, false);
  assert.equal(both.preActionKnown, true);
  assert.equal(both.postWorkKnown, true);
  assert.equal(both.silentRun, false);
  assert.equal(both.silentRunKnown, false);
  const silentOn = resolveReviewAskSettings({ reviewAskSilentRunEnabled: true });
  assert.equal(silentOn.silentRun, true);
  assert.equal(silentOn.silentRunKnown, true);
  assert.equal(resolveReviewAskSettings({ preActionReviewAskEnabled: { get: () => true } }).preAction, true);
  const none = resolveReviewAskSettings({});
  assert.equal(none.preAction, false);
  assert.equal(none.preActionKnown, false, "配置面取不到时不得假装是 Human 关掉的");
  assert.equal(resolveReviewAskSettings(null).postWork, false);
});

test("Config 字段 reviewAskTimeoutEnabled/Seconds：有闭集合约束且缺省 30", async () => {
  const { Config } = await import("../lib/index.js");
  const parsed = Config({});
  const val = (k) => (parsed?.[k] && typeof parsed[k].get === "function" ? parsed[k].get() : parsed?.[k]);
  assert.equal(val("reviewAskTimeoutEnabled"), false, "倒计时开关缺省关");
  assert.equal(val("reviewAskTimeoutSeconds"), 30, "秒数缺省 30");
  const set = Config({ reviewAskTimeoutEnabled: true, reviewAskTimeoutSeconds: 60 });
  assert.equal(set.reviewAskTimeoutSeconds.get(), 60, "合法秒数 60 须被接受");
});

test("resolveReviewAskSettings：倒计时开关缺省关、秒数缺省 30，只认 10/30/60", () => {
  const none = resolveReviewAskSettings({});
  assert.equal(none.timeoutEnabled, false, "倒计时开关缺省关");
  assert.equal(none.timeoutSeconds, 30, "秒数缺省 30");
  const on = resolveReviewAskSettings({ reviewAskTimeoutEnabled: true, reviewAskTimeoutSeconds: 60 });
  assert.equal(on.timeoutEnabled, true);
  assert.equal(on.timeoutSeconds, 60);
  assert.equal(resolveReviewAskSettings({ reviewAskTimeoutEnabled: { get: () => true } }).timeoutEnabled, true, "两代宿主取值形态都认");
  assert.equal(resolveReviewAskSettings({ reviewAskTimeoutSeconds: 25 }).timeoutSeconds, 30, "非闭集秒数退回缺省，不猜");
  assert.equal(resolveReviewAskSettings({ reviewAskTimeoutSeconds: "10" }).timeoutSeconds, 10, "字符串形态的合法秒数可认");
  assert.equal(resolveReviewAskSettings({ reviewAskTimeoutEnabled: true }).timeoutSeconds, 30);
});

test("askEnabledFor：未知位置一律 false（不猜）", () => {
  const settings = { preAction: true, postWork: false };
  assert.equal(askEnabledFor(settings, REVIEW_ASK_POINTS.PRE_ACTION), true);
  assert.equal(askEnabledFor(settings, REVIEW_ASK_POINTS.POST_WORK), false);
  assert.equal(askEnabledFor(settings, "something-else"), false);
  assert.equal(askEnabledFor(null, REVIEW_ASK_POINTS.PRE_ACTION), false);
});

test("两个开关互相独立：只开一个时另一个仍为关", () => {
  const onlyPre = resolveReviewAskSettings({ preActionReviewAskEnabled: true });
  assert.equal(onlyPre.preAction, true);
  assert.equal(onlyPre.postWork, false, "Human 只说做成两个开关——不得因开了前一个就顺手开后一个");
  const onlyPost = resolveReviewAskSettings({ postWorkReviewAskEnabled: true });
  assert.equal(onlyPost.preAction, false);
  assert.equal(onlyPost.postWork, true);
});

test("COMPLEXITY_CRITERIA：每条都带规范出处，不新增判据", () => {
  assert.ok(Array.isArray(COMPLEXITY_CRITERIA) && COMPLEXITY_CRITERIA.length > 0);
  for (const item of COMPLEXITY_CRITERIA) {
    assert.equal(typeof item.key, "string");
    assert.equal(typeof item.label, "string");
    assert.match(item.source, /^gate-consult-system-foundation 的 complex-task 条目/, `${item.key} 的出处须回指载体的 complex-task 条目，实际 ${item.source}`);
  }
});

test("GATE_POINT_EXCLUSIONS：三类都有承接面、出处与反向边界，且属 32 号不属 04 号", () => {
  assert.ok(Array.isArray(GATE_POINT_EXCLUSIONS) && GATE_POINT_EXCLUSIONS.length === 3,
    "点位排除恰为三类（32 §4.2），不得就地增删——增删属 Human 决定");
  for (const item of GATE_POINT_EXCLUSIONS) {
    for (const field of ["key", "label", "carried", "source", "notExcluded"]) {
      assert.equal(typeof item[field], "string", `${item.key} 缺 ${field}`);
      assert.ok(item[field].trim().length > 0, `${item.key} 的 ${field} 不得为空`);
    }
    assert.match(item.source, /^gate-consult-system-foundation 的 point-exclusions 条目（第 [1-3] 类）$/, `${item.key} 的出处须回指载体的 point-exclusions 条目，实际 ${item.source}`);
    assert.match(item.carried, /\S+ 的 [a-z][a-z-]+(?:／[a-z][a-z-]+)* 条目/, `${item.key} 的承接面须点名承接它的载体条目，不得只写机制名`);
    assert.doesNotMatch(item.carried, /§|specs\//, `${item.key} 的承接面不得再引规范章节号（运行期规则只来自载体）`);
  }
});

test("点位排除与判据清单必须是两份数据、不得合并（32 §19 第 5 项）", () => {
  const criteriaKeys = new Set(COMPLEXITY_CRITERIA.map((i) => i.key));
  for (const item of GATE_POINT_EXCLUSIONS) {
    assert.ok(!criteriaKeys.has(item.key), `${item.key} 不得进 COMPLEXITY_CRITERIA：那是复杂任务判据的编译产物`);
  }
  for (const item of COMPLEXITY_CRITERIA) {
    assert.doesNotMatch(item.label, /调研取证与报告|受控提交与推送|既有事实对象的操作|逐条转承/,
      `04 侧判据「${item.key}」不得内嵌 32 侧点位排除的条目`);
    assert.doesNotMatch(item.source, /point-exclusions/, `复杂任务判据「${item.key}」的出处不得指向点位排除条目`);
  }
});

test("GATE_POINT_EXCLUSIONS：类别名与承接条目须能在载体原文逐条找到", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const carriersDir = join(import.meta.dirname, "..", "..", "plugin-specs");
  const pointExclusions = join(carriersDir, "gate-consult-system-foundation.yaml");
  let gateCarrier;
  try {
    gateCarrier = await readFile(pointExclusions, "utf8");
  } catch {
    assert.fail(`载体不可读：plugin-specs/gate-consult-system-foundation.yaml（运行期来源缺失时须如实失败，不得静默通过）`);
  }
  const drifted = [];
  const entryIdsOf = (text) => new Set([...text.matchAll(/^\s+- id: ([a-z][a-z0-9-]*)$/gm)].map((match) => match[1]));
  const categoryPhrase = {
    "pure-research": "止于取得证据并形成调研结论",
    "pure-commit": "只是把已经形成的改动按提交契约落盘并推送",
    "pure-controlled-object-op": "只是对既有事实对象做状态转换、补充记录、勘误级更新或受控退休",
  };
  for (const item of GATE_POINT_EXCLUSIONS) {
    const phrase = categoryPhrase[item.key];
    if (phrase === undefined) drifted.push(`${item.key}: 测试未登记该类的载体判据语句（新增类别须同时补测试，不得静默跳过）`);
    else if (!gateCarrier.includes(phrase)) drifted.push(`${item.key}: 载体判据语句「${phrase}」不在 point-exclusions 载体里`);
    const carriedRefs = [...item.carried.matchAll(/([a-z][a-z0-9-]*) 的 ([a-z][a-z0-9-]*(?:／[a-z][a-z0-9-]*)*) 条目/g)];
    if (carriedRefs.length === 0) {
      drifted.push(`${item.key}: 承接面没有点名任何载体条目`);
      continue;
    }
    for (const [, carrierKey, ids] of carriedRefs) {
      let text;
      try {
        text = await readFile(join(carriersDir, `${carrierKey}.yaml`), "utf8");
      } catch {
        drifted.push(`${item.key}: 承接面点名的载体 ${carrierKey} 不可读`);
        continue;
      }
      const known = entryIdsOf(text);
      for (const id of ids.split("／")) {
        if (!known.has(id)) drifted.push(`${item.key}: 承接面点名的条目 ${carrierKey}/${id} 不存在`);
      }
    }
  }
  assert.deepEqual(drifted, [], `点位排除常量与载体原文漂移（禁第二规则源）：\n${drifted.join("\n")}`);
});

test("工具描述：点位排除的每个 label **全文**须出现在 ldvh_review_ask 的 summary 里", async () => {
  const { REVIEW_ASK_OPERATION } = await import("../lib/review-ask-tool.js");
  const summary = REVIEW_ASK_OPERATION.summary;
  const missing = GATE_POINT_EXCLUSIONS
    .filter((item) => !summary.includes(item.label))
    .map((item) => item.key);
  assert.deepEqual(
    missing, [],
    `工具描述缺下列类别的 label 全文（模型会把这类工作判错）：${missing.join(", ")}`,
  );
});

test("设置页 hint 与工具参数说明：须写明行动前那处的时点，且不得承诺「答复后才动手」", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const lib = join(import.meta.dirname, "..", "lib");

  const client = await readFile(join(lib, "client.js"), "utf8");
  const tool = await readFile(join(lib, "review-ask-tool.js"), "utf8");

  const failures = [];

  const zhStart = client.indexOf('"row.reviewAskPreHint": "');
  const zhEnd = client.indexOf('"', zhStart + '"row.reviewAskPreHint": "'.length);
  const zh = client.slice(zhStart, zhEnd);
  if (!/第一次给出方案后/.test(zh)) failures.push("row.reviewAskPreHint 中文侧未写「第一次给出方案后」这个时点条件");
  if (!/候选方案/.test(zh)) failures.push("row.reviewAskPreHint 中文侧未写「候选方案」这个前提");
  if (!/审核|审查/.test(zh)) failures.push("row.reviewAskPreHint 中文侧未说明问的是独立子代理审核/审查");
  if (/取得明确答复后才/.test(zh)) failures.push("row.reviewAskPreHint 中文侧出现了「取得明确答复后才」（00 §2.5 明禁）");

  const enStart = client.indexOf('"row.reviewAskPreHint": "', zhEnd);
  const enEnd = client.indexOf('"', enStart + '"row.reviewAskPreHint": "'.length);
  const en = client.slice(enStart, enEnd);
  if (enStart === -1 || !/after the first plan is given/i.test(en)) failures.push("row.reviewAskPreHint 英文侧未写 after the first plan is given 这个时点条件");
  if (!/candidate plan/.test(en)) failures.push("row.reviewAskPreHint 英文侧未写 candidate plan 这个前提");

  const pointDesc = /point: \{[^}]*?description: "([^"]*)"/s.exec(tool)?.[1] ?? "";
  if (!/方案已有候选/.test(pointDesc)) failures.push("point 参数 description 未写明「方案已有候选」这个时点");
  if (/动手前的审查询问/.test(pointDesc)) failures.push("point 参数 description 仍是旧口径「动手前的审查询问」");

  const postStart = client.indexOf('"row.reviewAskPostHint": "');
  const postEnd = client.indexOf('"', postStart + '"row.reviewAskPostHint": "'.length);
  const postZh = client.slice(postStart, postEnd);
  if (!/执行完成后/.test(postZh)) failures.push("row.reviewAskPostHint 中文侧未写「执行完成后」这个时点条件");
  if (!/复核/.test(postZh)) failures.push("row.reviewAskPostHint 中文侧未说明问的是复核");
  const postEnStart = client.indexOf('"row.reviewAskPostHint": "', postEnd);
  const postEnEnd = client.indexOf('"', postEnStart + '"row.reviewAskPostHint": "'.length);
  const postEn = client.slice(postEnStart, postEnEnd);
  if (postEnStart === -1 || !/after execution completes/i.test(postEn)) failures.push("row.reviewAskPostHint 英文侧未写 after execution completes 这个时点条件");

  const silentStart = client.indexOf('"row.reviewAskSilentHint": "');
  const silentEnd = client.indexOf('"', silentStart + '"row.reviewAskSilentHint": "'.length);
  const silentZh = client.slice(silentStart, silentEnd);
  if (!/直接派代理审核\/复核/.test(silentZh)) failures.push("row.reviewAskSilentHint 中文侧未写「直接派代理审核/复核」这个静默行为");
  if (!/静默痕迹/.test(silentZh)) failures.push("row.reviewAskSilentHint 中文侧未写留「静默痕迹」");
  const silentEnStart = client.indexOf('"row.reviewAskSilentHint": "', silentEnd);
  const silentEnEnd = client.indexOf('"', silentEnStart + '"row.reviewAskSilentHint": "'.length);
  const silentEn = client.slice(silentEnStart, silentEnEnd);
  if (silentEnStart === -1 || !/directly arranges the review/i.test(silentEn)) failures.push("row.reviewAskSilentHint 英文侧未写 directly arranges the review");

  if (/向 Human 报告并等待/.test(tool)) failures.push("review-ask-tool.js 仍出现「向 Human 报告并等待」（32 §3.4 明禁暂停）");
  if (/按 00 §4\.7 不得把沉默当作许可/.test(tool)) failures.push("review-ask-tool.js 仍把两处请示的错误归到 00 §4.7（应引 32 §9.1）");
  if (!/不放行也不暂停|也不得据此暂停/.test(tool)) failures.push("review-ask-tool.js 未写明未取得答复「不暂停」这一边界");

  assert.deepEqual(failures, [], `时点措辞未补全：\n${failures.join("\n")}`);
});

test("设置页中英文 hint：同 key 双侧须都提到点位排除（MINOR-2 的复发面）", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const src = await readFile(join(import.meta.dirname, "..", "lib", "client.js"), "utf8");

  function valuesOf(source, key) {
    const out = [];
    const needle = `"${key}": "`;
    for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
      const start = i + needle.length;
      let j = start;
      while (j < source.length) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === '"') break;
        j += 1;
      }
      out.push(source.slice(start, j));
      i = j;
    }
    return out;
  }

  const failures = [];
  for (const key of ["row.reviewAskPreHint", "row.reviewAskPostHint", "row.reviewAskSilentHint"]) {
    const values = valuesOf(src, key);
    if (values.length !== 2) {
      failures.push(`${key} 出现 ${values.length} 次（预期中英各 1），无法判定是否双侧同步`);
      continue;
    }
    const numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    const expected = GATE_POINT_EXCLUSIONS.length;
    values.forEach((v, idx) => {
      const lang = /[㐀-䶿一-鿿]/.test(v) ? "中文" : "英文";

      for (const m of v.matchAll(/([零一二三四五六七八九十]|[0-9]+)类(?:情况不问|点位排除)/g)) {
        const raw = m[1];
        const got = /^[0-9]+$/.test(raw) ? Number(raw) : numerals.indexOf(raw);
        if (got !== expected) {
          failures.push(`${key} 的${lang}侧写了「${m[0]}」，但当前点位排除为 ${expected} 类（过期条数）`);
        }
      }
      for (const m of v.matchAll(/([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten) (?:cases are not asked|point-level exclusions)/gi)) {
        const raw = m[1].toLowerCase();
        const got = /^[0-9]+$/.test(raw) ? Number(raw) : words.indexOf(raw) + 1;
        if (got !== expected) {
          failures.push(`${key} 的${lang}侧写了「${m[0]}」，但当前点位排除为 ${expected} 类（过期条数）`);
        }
      }
    });
  }
  assert.deepEqual(failures, [], `设置页文案中英不同步（行动后复核 MINOR-2 的复发面）：\n${failures.join("\n")}`);
});

test("reviewAskFingerprint：同输入同指纹、异输入异指纹、位置参与指纹", () => {
  const base = { point: "pre-action", task: "改开关", scope: "plugin/lib" };
  assert.equal(reviewAskFingerprint(base), reviewAskFingerprint({ ...base }), "同一件事重试须得到同一指纹（否则重试必重问）");
  assert.notEqual(reviewAskFingerprint(base), reviewAskFingerprint({ ...base, task: "改开关2" }), "描述变了就是另一件事");
  assert.notEqual(reviewAskFingerprint(base), reviewAskFingerprint({ ...base, point: "post-work" }), "审查与复核不得共用一个指纹");
  assert.notEqual(reviewAskFingerprint(base), reviewAskFingerprint({ point: "pre-action" }), "缺字段不得与有字段撞指纹");
  assert.match(reviewAskFingerprint(base), /^[a-f0-9]{64}$/);
});

test("composeReviewAsk：只写「要做什么」与三选一问句，不产出 detail 且不出现判据", () => {
  const pre = composeReviewAsk({ point: REVIEW_ASK_POINTS.PRE_ACTION, task: "重构召回注入" });
  assert.match(pre.question, /重构召回注入/, "标题须写明要做什么");
  assert.match(pre.question, /审查/);
  assert.ok(pre.question.length <= 80, `标题须有界（实际 ${pre.question.length}）`);
  assert.doesNotMatch(pre.question, /specs\//, "标题区不得出现规范指针");
  assert.doesNotMatch(pre.question, /判据/, "判据不得进入标题");
  assert.doesNotMatch(pre.question, /§6\.1/, "规范条目号不得进入标题");
  assert.equal(pre.detail, undefined, "卡片不得带 detail 块——选项已说明后果");
  assert.ok(!("detail" in pre), "detail 键须整个不存在，不得传空串");

  const post = composeReviewAsk({ point: REVIEW_ASK_POINTS.POST_WORK, task: "重构召回注入" });
  assert.match(post.question, /复核/);
  assert.notEqual(pre.question, post.question, "两处询问的问句须可区分");
  assert.match(composeReviewAsk({ point: REVIEW_ASK_POINTS.PRE_ACTION }).question, /当次任务/);
  assert.match(composeReviewAsk({ point: REVIEW_ASK_POINTS.PRE_ACTION }).question, /审查/);
  assert.match(composeReviewAsk({ point: REVIEW_ASK_POINTS.POST_WORK }).question, /复核/);
  assert.match(pre.question, /做不做、由谁做/, "题面须问三选一（做不做、由谁做），不得退回「要不要安排代理」的二值框架");
  assert.doesNotMatch(pre.question, /要不要安排/);
});

test("composeReviewAsk：任务描述过长时截断，不让标题挤成多行", () => {
  const longTask = "为「行动前审查／行动后复核」的触发判据定方向：规范里没有正面准入判据，只有 21 §6.3 的四条排除项；此前一直靠我私下把排除项取反当准入".repeat(2);
  const out = composeReviewAsk({ point: REVIEW_ASK_POINTS.PRE_ACTION, task: longTask });
  assert.ok(out.question.length <= 90, `标题须有界（实际 ${out.question.length}）`);
  assert.match(out.question, /…/, "超长须以省略号收尾，不得静默截断");
});

test("开关只认布尔真值：非布尔一律按关（不确定就当关）", () => {
  for (const value of ["false", "true", 0, 1, "", "yes", {}, []]) {
    const r = resolveReviewAskSettings({ preActionReviewAskEnabled: value, postWorkReviewAskEnabled: value });
    assert.equal(r.preAction, false, `${JSON.stringify(value)} 不得被当作开启`);
    assert.equal(r.postWork, false, `${JSON.stringify(value)} 不得被当作开启`);
    assert.equal(r.preActionKnown, true, "非空值仍算「读到了」，只是判为关");
  }
  assert.equal(resolveReviewAskSettings({ preActionReviewAskEnabled: true }).preAction, true);
  assert.equal(resolveReviewAskSettings({ preActionReviewAskEnabled: false }).preAction, false);
  for (const value of [undefined, null]) {
    const r = resolveReviewAskSettings({ preActionReviewAskEnabled: value });
    assert.equal(r.preAction, false);
    assert.equal(r.preActionKnown, false, "缺省须报 unknown，不得假装 Human 关掉了");
  }
});

async function withHome(fn) {
  const dir = await mkdtemp(join(tmpdir(), "ldvh-review-ask-"));
  try {
    return await fn((...parts) => join(dir, ...parts));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("载体：ENOENT 是合法初态（未问过），写入后可按指纹读回", async () => {
  await withHome(async (home) => {
    const fp = reviewAskFingerprint({ point: "pre-action", task: "x" });
    const before = await findReviewAskDecision(home, fp);
    assert.equal(before.ok, true);
    assert.equal(before.value, null, "从未问过 → null（调用方据此才提请）");

    const wrote = await recordReviewAskDecision(home, {
      fingerprint: fp,
      point: "pre-action",
      answer: REVIEW_ASK_ANSWERS.SKIP,
      task: "x",
    });
    assert.equal(wrote.ok, true);

    const after = await findReviewAskDecision(home, fp);
    assert.equal(after.ok, true);
    assert.equal(after.value.answer, "skip", "skip 是明确答复，不是未决策");
    assert.equal(after.value.point, "pre-action");
  });
});

test("载体：self-review 是合法答复值，按点位留痕", async () => {
  await withHome(async (home) => {
    const fp = reviewAskFingerprint({ point: "pre-action", task: "z" });
    const rec = await recordReviewAskDecision(home, { fingerprint: fp, point: "pre-action", answer: REVIEW_ASK_ANSWERS.SELF, task: "z" });
    assert.equal(rec.ok, true);
    assert.equal(rec.value.answer, "self-review");
    const found = await findReviewAskDecision(home, fp);
    assert.equal(found.value.answer, "self-review");
  });
});

test("selfReviewDispatchTemplate：自审/自查不称「独立」，带实做与交付硬要求", () => {
  const pre = selfReviewDispatchTemplate(REVIEW_ASK_POINTS.PRE_ACTION, { task: "重构召回" });
  assert.equal(pre.kind, "pre-action-self-review");
  assert.match(pre.prompt, /主控自审/);
  assert.doesNotMatch(pre.prompt, /你是一位独立审查者/);
  assert.match(pre.prompt, /实做一遍/);
  assert.match(pre.prompt, /逐条写出核对了什么/);
  const post = selfReviewDispatchTemplate(REVIEW_ASK_POINTS.POST_WORK, { task: "迁移" });
  assert.equal(post.kind, "post-work-self-review");
  assert.match(post.prompt, /主控自查/);
  assert.match(post.prompt, /不得称为「独立审查结论」或「独立复核结论」/);
});

test("载体：空答复与非法闭集一律拒绝写入（未决策不得写成决定）", async () => {
  await withHome(async (home) => {
    const fp = reviewAskFingerprint({ point: "post-work", task: "y" });
    const empty = await recordReviewAskDecision(home, { fingerprint: fp, point: "post-work", answer: "" });
    assert.equal(empty.ok, false, "空答复是「未决策」，写成记录会让下次误以为问过了");

    const bogus = await recordReviewAskDecision(home, { fingerprint: fp, point: "post-work", answer: "maybe" });
    assert.equal(bogus.ok, false);

    const badPoint = await recordReviewAskDecision(home, { fingerprint: fp, point: "later", answer: "skip" });
    assert.equal(badPoint.ok, false);

    const noFp = await recordReviewAskDecision(home, { point: "post-work", answer: "skip" });
    assert.equal(noFp.ok, false);

    assert.equal((await findReviewAskDecision(home, fp)).value, null);
  });
});

test("载体：同指纹重复记录以最近一次为准（不累加多条）", async () => {
  await withHome(async (home) => {
    const fp = reviewAskFingerprint({ point: "pre-action", task: "z" });
    await recordReviewAskDecision(home, { fingerprint: fp, point: "pre-action", answer: "review", task: "z" });
    await recordReviewAskDecision(home, { fingerprint: fp, point: "pre-action", answer: "skip", task: "z" });
    const found = await findReviewAskDecision(home, fp);
    assert.equal(found.value.answer, "skip", "同一件事的最近答复才是 Human 最新的意思");
  });
});

test("载体：损坏不按空处理（读不出来 ≠ 没问过）", async () => {
  await withHome(async (home) => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const path = home("ldvh", "review-ask-decisions.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{not json", "utf8");
    const read = await findReviewAskDecision(home, "whatever");
    assert.equal(read.ok, false, "损坏须报 failure——当成「没问过」会导致重复提问");
    assert.equal(read.error.code, "review-ask/malformed");
  });
});

test("载体：无 home resolver 时 fail-closed，不静默当空", async () => {
  const read = await findReviewAskDecision(undefined, "fp");
  assert.equal(read.ok, false);
  assert.equal(read.error.code, "review-ask/unavailable");
});

test("executeReviewAsk：开关关闭时**不得**提问，且如实标注这是设计不是失败", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  let asked = 0;
  const env = await executeReviewAsk(
    { point: "pre-action", task: "某任务" },
    { agent: null },
    {
      getReviewAskSettings: () => ({ preAction: false, postWork: false }),
      hostSeams: { requestReviewAsk: async () => { asked += 1; return { decision: null, asked: false }; } },
    },
  );
  assert.equal(asked, 0, "开关关着就不得走到询问——这是本设计的核心断言");
  assert.equal(env.result.decision, null);
  assert.equal(env.result.switch_enabled, false);
  assert.ok(env.gaps.some((g) => /switch_off/.test(g)), "须说明「未安排」是配置行为，不是失败");
});

test("executeReviewAsk：非法 point 一律拒绝（闭集）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  let asked = 0;
  const env = await executeReviewAsk(
    { point: "whenever" },
    { agent: null },
    { getReviewAskSettings: () => ({ preAction: true, postWork: true }), hostSeams: { requestReviewAsk: async () => { asked += 1; return {}; } } },
  );
  assert.equal(env.outcome, "rejected");
  assert.equal(asked, 0);
});

test("executeReviewAsk：seam 不可用时 fail-closed，不假装已安排", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const env = await executeReviewAsk(
    { point: "post-work", task: "某任务" },
    { agent: null },
    { getReviewAskSettings: () => ({ preAction: true, postWork: true }), hostSeams: {} },
  );
  assert.equal(env.outcome, "unavailable");
  assert.equal(env.result.decision, null, "不可用时不得推出「跳过」——那会让未发生的询问看起来像有了答复");
});

test("executeReviewAsk：skip 是合法答复（不得当成拒绝/失败）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const env = await executeReviewAsk(
    { point: "pre-action", task: "某任务" },
    { agent: null },
    {
      getReviewAskSettings: () => ({ preAction: true, postWork: false }),
      hostSeams: { requestReviewAsk: async () => ({ decision: "skip", asked: true, fingerprint: "f".repeat(64) }) },
    },
  );
  assert.equal(env.result.decision, "skip");
  assert.equal(env.outcome, "completed", "skip 是明确答复，不是失败");
  assert.equal(env.verification.passed, true);
});

test("reviewAskMode：静默只在询问开关开着时有对象；关着询问时静默不越过它", () => {
  assert.equal(reviewAskMode({ preAction: true, silentRun: false }, "pre-action").mode, "ask");
  assert.equal(reviewAskMode({ preAction: true, silentRun: true }, "pre-action").mode, "silent");
  assert.equal(reviewAskMode({ preAction: false, silentRun: true }, "pre-action").mode, "off");
  assert.equal(reviewAskMode({ postWork: false, silentRun: true }, "post-work").mode, "off");
  assert.equal(reviewAskMode({ preAction: true, silentRun: true }, "whenever").mode, "off");
  assert.equal(reviewAskMode({ preAction: true, silentRun: true, silentRunKnown: false }, "pre-action").silentUnknown, true);
});

test("executeReviewAsk：静默开着时**不问**，直接给派发模板与痕迹行（A1）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  let asked = 0;
  const env = await executeReviewAsk(
    { point: "pre-action", task: "重构召回注入" },
    { agent: null },
    {
      getReviewAskSettings: () => ({ preAction: true, postWork: true, silentRun: true }),
      hostSeams: { requestReviewAsk: async () => { asked += 1; return { decision: "review", asked: true }; } },
    },
  );
  assert.equal(asked, 0, "静默开着就不得走到 Human 询问");
  assert.equal(env.outcome, "completed");
  assert.equal(env.result.decision, "silent");
  assert.equal(env.result.asked, false);
  assert.equal(env.result.silent_run, true);
  assert.ok(env.result.review_template?.prompt?.length > 0, "静默执行必须给派发模板（A1：不问即做）");
  assert.match(env.result.review_template.prompt, /## 本次要审的对象/);
  assert.match(env.result.notice, /静默执行/);
  assert.match(env.result.notice, /重构召回注入/);
  assert.deepEqual(env.sources, []);
  assert.equal(env.result.reused, undefined);
});

test("executeReviewAsk：静默不得越过询问开关（关着时既不问也不派）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  let asked = 0;
  const env = await executeReviewAsk(
    { point: "post-work", task: "某任务" },
    { agent: null },
    {
      getReviewAskSettings: () => ({ preAction: true, postWork: false, silentRun: true }),
      hostSeams: { requestReviewAsk: async () => { asked += 1; return { decision: "review", asked: true }; } },
    },
  );
  assert.equal(asked, 0);
  assert.equal(env.result.decision, null, "询问开关关着时静默没有作用对象——不得派代理");
  assert.equal(env.result.review_template, undefined, "这一支不得给模板，否则等于替 Human 开了那次核对");
  assert.ok(env.gaps.some((g) => /switch_off/.test(g)));
});

test("executeReviewAsk：静默不依赖询问通道（宿主无 userQuestions 也能静默）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const env = await executeReviewAsk(
    { point: "pre-action", task: "某任务" },
    { agent: null },
    { getReviewAskSettings: () => ({ preAction: true, silentRun: true }), hostSeams: {} },
  );
  assert.equal(env.outcome, "completed", "没有询问通道时静默仍须成立");
  assert.equal(env.result.decision, "silent");
});

test("executeReviewAsk：静默开关取不到时保守退回询问，并如实报告", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  let asked = 0;
  const env = await executeReviewAsk(
    { point: "pre-action", task: "某任务" },
    { agent: null },
    {
      getReviewAskSettings: () => ({ preAction: true, silentRun: false, silentRunKnown: false }),
      hostSeams: { requestReviewAsk: async () => { asked += 1; return { decision: "skip", asked: true }; } },
    },
  );
  assert.equal(asked, 1, "取不到静默开关时须照旧询问——不得擅自免掉核对");
  assert.equal(env.result.decision, "skip");
  assert.ok(
    env.gaps.some((g) => /silent-run switch could not be read/.test(g)),
    "退回询问须如实报告，否则「配了静默却不生效」看不出来（00 §4.6）",
  );
});

test("reviewAskMode：静默键缺失时退回 ask 并标记 silentUnknown（真实 resolver 可达）", () => {
  const fromReal = resolveReviewAskSettings({ preActionReviewAskEnabled: true });
  assert.equal(fromReal.silentRun, false);
  assert.equal(fromReal.silentRunKnown, false, "配置里没有静默键");
  const mode = reviewAskMode(fromReal, "pre-action");
  assert.equal(mode.mode, "ask", "取不到 → 保守退回询问");
  assert.equal(mode.silentUnknown, true, "取不到须可辨认，否则「没配」与「关掉」不可区分");
  const on = reviewAskMode(resolveReviewAskSettings({ preActionReviewAskEnabled: true, reviewAskSilentRunEnabled: true }), "pre-action");
  assert.equal(on.mode, "silent");
  assert.equal(on.silentUnknown, false);
  const off = reviewAskMode(resolveReviewAskSettings({ preActionReviewAskEnabled: true, reviewAskSilentRunEnabled: false }), "pre-action");
  assert.equal(off.mode, "ask");
  assert.equal(off.silentUnknown, false, "显式关掉不是取不到，不得混为一谈");
});

test("两份模板：kind 可区分，且都含五块结构与硬性约束", async () => {
  const { reviewDispatchTemplate } = await import("../lib/review-dispatch-template.js");
  const pre = reviewDispatchTemplate("pre-action", { task: "t", claims: ["c1"] });
  const post = reviewDispatchTemplate("post-work", { task: "t", claims: ["c1"] });
  assert.equal(pre.kind, "pre-action-review");
  assert.equal(post.kind, "post-work-review");
  assert.notEqual(pre.prompt, post.prompt, "两份必须是不同模板——合一就盖不住两种对象");

  for (const t of [pre, post]) {
    assert.match(t.prompt, /## 本次要审的对象/);
    assert.match(t.prompt, /## 硬性约束/);
    assert.match(t.prompt, /## 输出格式/);
    assert.match(t.prompt, /BLOCKER \/ MAJOR \/ MINOR \/ NIT/);
    assert.match(t.prompt, /只读/, "只读约束");
    assert.match(t.prompt, /不要假设作者是对的|不以说法为准/, "对抗性要求");
  }
});

test("两份模板追问方向相反：审查往后推演，复核往前核对", async () => {
  const { composePreActionReviewPrompt, composePostWorkReviewPrompt } = await import("../lib/review-dispatch-template.js");
  const pre = composePreActionReviewPrompt({ task: "t" });
  const post = composePostWorkReviewPrompt({ task: "t" });
  assert.match(pre, /还没开始执行/);
  assert.match(pre, /方向是否成立/);
  assert.match(pre, /前提是否齐备/);
  assert.match(post, /已经发生|核对它是否真的做到了/);
  assert.match(post, /声称 vs 实际|声称做到的事/);
  assert.match(post, /形同虚设/);
  assert.match(pre, /不要裁决「该不该做」/);
});

test("模板：claims 逐条编号进入 prompt；缺失时明确说缺而不虚构", async () => {
  const { composePostWorkReviewPrompt } = await import("../lib/review-dispatch-template.js");
  const withClaims = composePostWorkReviewPrompt({ task: "t", claims: ["甲做到了", "乙做到了"] });
  assert.match(withClaims, /1\. 甲做到了/);
  assert.match(withClaims, /2\. 乙做到了/);
  assert.match(withClaims, /逐条核对，不要预设成立/);

  const noSubject = composePostWorkReviewPrompt({});
  assert.match(noSubject, /主控未提供对象描述/, "缺内容要明说，不得让代理凭空推断");
  assert.doesNotMatch(noSubject, /不要预设成立/);
});

test("模板：未知 point 不产出 prompt（不猜）", async () => {
  const { reviewDispatchTemplate } = await import("../lib/review-dispatch-template.js");
  const bogus = reviewDispatchTemplate("whenever", {});
  assert.equal(bogus.kind, "unknown");
  assert.equal(bogus.prompt, "");
});

test("工具：决定「安排」时返回对应模板，「跳过」时不返回", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const mk = (decision) => ({
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
    hostSeams: { requestReviewAsk: async () => ({ decision, asked: true }) },
  });

  const reviewed = await executeReviewAsk(
    { point: "post-work", task: "改开关", claims: ["测试全过"], evidence: "cd plugin && node --test" },
    { agent: null }, mk("review"));
  assert.equal(reviewed.result.decision, "review");
  assert.ok(reviewed.result.review_template, "给「安排」才给模板");
  assert.equal(reviewed.result.review_template.kind, "post-work-review");
  assert.match(reviewed.result.review_template.prompt, /1\. 测试全过/);
  assert.match(reviewed.result.review_template.prompt, /cd plugin && node --test/);
  assert.ok(reviewed.follow_up.some((f) => /零上下文/.test(f)));
  assert.ok(reviewed.follow_up.some((f) => /不要用 subagent_fork/.test(f)));

  const skipped = await executeReviewAsk(
    { point: "post-work", task: "改开关" }, { agent: null }, mk("skip"));
  assert.equal(skipped.result.decision, "skip");
  assert.equal(skipped.result.review_template, undefined, "跳过时给模板是噪声，还可能诱导照派");
});

test("工具：决定「主控自己做」时返回 self_review_template 且不给代理模板", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const deps = {
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
    hostSeams: { requestReviewAsk: async () => ({ decision: "self-review", asked: true }) },
  };
  for (const point of ["pre-action", "post-work"]) {
    const out = await executeReviewAsk(
      { point, task: "改开关", claims: ["测试全过"] },
      { agent: null }, deps);
    assert.equal(out.result.decision, "self-review");
    assert.equal(out.result.review_template, undefined, "主控自做时不该给代理派发模板");
    assert.ok(out.result.self_review_template, `point=${point} 必须有自做模板`);
    assert.match(out.result.self_review_template.kind, /self-review/);
    assert.match(out.result.self_review_template.prompt, /主控自审|主控自查/);
    assert.match(out.result.self_review_template.prompt, /硬性约束/);
    assert.match(out.result.self_review_template.prompt, /输出格式/);
    assert.match(out.result.self_review_template.prompt, /1\. 测试全过/);
    assert.ok(out.follow_up.some((f) => /不派 subagent/.test(f)));
    assert.ok(out.follow_up.some((f) => /如实标注/.test(f)));
  }
});

test("工具：pre-action 与 post-work 各自返回自己的模板", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const deps = {
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
    hostSeams: { requestReviewAsk: async () => ({ decision: "review", asked: true }) },
  };
  const pre = await executeReviewAsk({ point: "pre-action", task: "t" }, { agent: null }, deps);
  const post = await executeReviewAsk({ point: "post-work", task: "t" }, { agent: null }, deps);
  assert.equal(pre.result.review_template.kind, "pre-action-review");
  assert.equal(post.result.review_template.kind, "post-work-review");
  assert.notEqual(pre.result.review_template.prompt, post.result.review_template.prompt);
});

test("模板：只有 task 时它作为对象描述出现且**只出现一次**；另有 subject 时才多一段任务背景", async () => {
  const { composePostWorkReviewPrompt } = await import("../lib/review-dispatch-template.js");
  const onlyTask = composePostWorkReviewPrompt({ task: "给工具加两份模板" });
  assert.equal(onlyTask.split("给工具加两份模板").length - 1, 1, "同一句话不得写两遍，否则代理会当成两条不同信息");
  assert.doesNotMatch(onlyTask, /主控未提供对象描述/);

  const both = composePostWorkReviewPrompt({ task: "背景X", subject: "对象Y" });
  assert.match(both, /任务背景：背景X/);
  assert.match(both, /## 本次要审的对象\n\n对象Y/);

  const neither = composePostWorkReviewPrompt({});
  assert.match(neither, /主控未提供对象描述/);
});

test("renderEnvelope 必须把答复与模板渲染给模型（BLOCKER：原实现恒为 completed）", async () => {
  const { renderEnvelope } = await import("../lib/ldvh-tools.js");
  const mk = (decision, template) => ({
    envelope: {
      operation_key: "review-ask",
      outcome: "completed",
      result: { point: "post-work", decision, asked: true, switch_enabled: true, fingerprint: "abc", review_template: template },
      gaps: [], scope: { not_completed: [] }, follow_up: [],
    },
  });
  const reviewed = renderEnvelope("review-ask", mk("review", { kind: "post-work-review", prompt: "# 独立复核\n请逐条核对。" }))[0].text;
  const skipped = renderEnvelope("review-ask", mk("skip", undefined))[0].text;
  const none = renderEnvelope("review-ask", mk(null, undefined))[0].text;

  assert.notEqual(reviewed, skipped, "review 与 skip 不得渲染成同一段文本");
  assert.notEqual(skipped, none, "skip 与未决策不得渲染成同一段文本");
  assert.match(reviewed, /decision: review/);
  assert.match(skipped, /decision: skip/);
  assert.match(none, /decision: null/);
  assert.match(reviewed, /review_template\.kind: post-work-review/);
  assert.match(reviewed, /# 独立复核/, "模板正文须逐字渲染");
  assert.match(reviewed, /请逐条核对。/, "模板尾部不得被截断");
  assert.doesNotMatch(skipped, /review_template/);

  const selfEnv = {
    envelope: {
      operation_key: "review-ask",
      outcome: "completed",
      result: {
        point: "pre-action",
        decision: "self-review",
        asked: true,
        self_review_template: { kind: "pre-action-self-review", prompt: "# 主控自审\n逐面核对。" },
      },
      gaps: [], scope: { not_completed: [] }, follow_up: [],
    },
  };
  const selfText = renderEnvelope("review-ask", selfEnv)[0].text;
  assert.match(selfText, /decision: self-review/);
  assert.match(selfText, /self_review_template\.kind: pre-action-self-review/);
  assert.match(selfText, /# 主控自审/, "自做模板正文须逐字渲染给模型");

  const selfResearchEnv = {
    envelope: {
      operation_key: "review-ask",
      outcome: "completed",
      result: {
        point: "research",
        decision: "self-review",
        asked: true,
        self_research_template: { kind: "self-research", prompt: "# 主控自调查\n逐条记录来源。" },
      },
      gaps: [], scope: { not_completed: [] }, follow_up: [],
    },
  };
  const selfResearchText = renderEnvelope("review-ask", selfResearchEnv)[0].text;
  assert.match(selfResearchText, /decision: self-review/);
  assert.match(selfResearchText, /self_research_template\.kind: self-research/);
  assert.match(selfResearchText, /# 主控自调查/);
});

test("renderEnvelope 必须把 silent 与 notice 渲染给模型（独立复核 BLOCKER）", async () => {
  const { renderEnvelope } = await import("../lib/ldvh-tools.js");
  const { silentRunNotice } = await import("../lib/review-ask.js");
  const notice = silentRunNotice({ point: "pre-action", task: "改开关" });
  const env = {
    envelope: {
      operation_key: "review-ask",
      outcome: "completed",
      result: {
        point: "pre-action",
        task: "改开关",
        decision: "silent",
        asked: false,
        switch_enabled: true,
        silent_run: true,
        notice,
        review_template: { kind: "pre-action-review", prompt: "# 独立审查\n请看方案。" },
      },
      gaps: [], scope: { not_completed: [] }, follow_up: [],
    },
  };
  const text = renderEnvelope("review-ask", env)[0].text;
  assert.doesNotMatch(text, /未发起询问/, "silent 不得落进 null 分支的文案");
  assert.doesNotMatch(text, /decision: null/, "silent 不是 null");
  assert.match(text, /decision: silent/);
  assert.match(text, /不是 Human 的答复/);
  assert.ok(text.includes(notice), "notice 须逐字渲染，否则「静默不等于无痕」不可执行");
  assert.match(text, /review_template\.kind: pre-action-review/);
  assert.match(text, /# 独立审查/);
});

test("开关状态读不到时不得报成「开关关闭」（MAJOR #3）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const exec = { agent: null, signal: undefined };
  const missing = await executeReviewAsk({ point: "pre-action" }, exec, { hostSeams: {}, getReviewAskSettings: undefined });
  assert.equal(missing.outcome, "unavailable", "取不到开关状态须报 unavailable，不得报 completed");
  assert.equal(missing.result.switch_enabled, null, "不得声称开关是关的");
  assert.equal(missing.verification.passed, false);
  assert.match(missing.gaps.join(" "), /unavailable|not wired/i);
  const boom = await executeReviewAsk({ point: "pre-action" }, exec, {
    hostSeams: {}, getReviewAskSettings: () => { throw new Error("config boom"); },
  });
  assert.equal(boom.outcome, "unavailable");
  assert.match(boom.gaps.join(" "), /config boom/);
  let asks = 0;
  const off = await executeReviewAsk({ point: "pre-action" }, exec, {
    hostSeams: { requestReviewAsk: async () => { asks += 1; return { decision: null, asked: false }; } },
    getReviewAskSettings: () => ({ preAction: false, postWork: false }),
  });
  assert.equal(off.outcome, "completed", "明确关掉是正常状态，不是不可用");
  assert.equal(off.result.switch_enabled, false);
  assert.equal(asks, 0, "开关关闭时不得提问");
});

test("指纹须含会话/项目范围，否则跨项目静默复用（MAJOR #2）", () => {
  const a = reviewAskFingerprint({ point: "pre-action", task: null, scope: "session:s1|cwd:/p/a" });
  const b = reviewAskFingerprint({ point: "pre-action", task: null, scope: "session:s2|cwd:/p/b" });
  assert.notEqual(a, b, "不同会话/项目不得共用指纹");
  const c = reviewAskFingerprint({ point: "pre-action", task: "修复登录bug", scope: "session:s1|cwd:/p/a" });
  const d = reviewAskFingerprint({ point: "pre-action", task: "修复登录bug", scope: "session:s1|cwd:/p/a" });
  assert.equal(c, d, "同一会话同一任务应复用（不重复提问）");
});

test("操作声明：effect 必须是 may_change_state（本工具会写答复载体）", async () => {
	const { REVIEW_ASK_OPERATION } = await import("../lib/review-ask-tool.js");
	assert.equal(REVIEW_ASK_OPERATION.effect, "may_change_state", "本工具写载体，不得声明为只读");
});

test("操作声明：awaitsHumanDecision 不得是死字段（须在注册处生效）", async () => {
	const { REVIEW_ASK_OPERATION } = await import("../lib/review-ask-tool.js");
	const { readFile } = await import("node:fs/promises");
	const tools = await readFile(new URL("../lib/ldvh-tools.js", import.meta.url), "utf8");
	assert.equal(REVIEW_ASK_OPERATION.awaitsHumanDecision, true, "本工具阻塞在 Human 答复上");
	assert.match(
		tools,
		/REVIEW_ASK_OPERATION\.awaitsHumanDecision === true \? \{\} : \{ timeoutMs: 30000 \}/,
		"注册处须按该声明决定是否设墙钟期限",
	);
});

test("开关分派只有一处副本（工具面不得另写一遍）", async () => {
	const { readFile } = await import("node:fs/promises");
	const tool = await readFile(new URL("../lib/review-ask-tool.js", import.meta.url), "utf8");
	assert.doesNotMatch(
		tool,
		/settings\?\.preAction === true \? settings\?\.postWork/,
		"开关分派须走 askEnabledFor，不得在工具面另写副本",
	);
	assert.match(tool, /askEnabledFor\(settings, point\)/);
});

test("弱约束：行动前交还判断依据，且它不改变 decision/outcome", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const exec = { agent: { id: "a1" } };
  const deps = {
    hostSeams: { requestReviewAsk: async () => ({ decision: "skip", asked: true }) },
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
    readCurrentTurnText: () => ({ ok: true, turn: 3, assistant: "我打算先改 A，再改 B。", truncated: false }),
  };
  const res = await executeReviewAsk(
    { point: "pre-action", task: "改 A", claims: ["先改 A", "再改 B"] },
    exec, deps,
  );
  assert.ok(res.result.candidate_basis, "行动前必须交还判断依据");
  const basis = res.result.candidate_basis;
  assert.equal(basis.available, true);
  assert.equal(basis.turn_text_chars, 13, "正文长度须按归一化后口径报");
  assert.equal(basis.claims_present, true);
  assert.equal(basis.claims_count, 2);
  assert.deepEqual(basis.claims_in_turn_text, [true, true]);
  assert.equal(basis.claims_in_turn_text_count, 2);
  assert.doesNotMatch(JSON.stringify(basis), /"decision"/, "依据不是裁决，不得带 decision");
  assert.match(basis.note, /不说明它是合格候选/);
  assert.equal(res.result.decision, "skip");
  assert.equal(res.outcome, "completed");
});

test("弱约束：正文里找不到 claims 时如实报 false，且**不拦**这次询问", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  let asks = 0;
  const deps = {
    hostSeams: { requestReviewAsk: async () => { asks += 1; return { decision: "review", asked: true }; } },
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
    readCurrentTurnText: () => ({ ok: true, turn: 2, assistant: "让我先把规范原文查清楚。", truncated: false }),
  };
  const res = await executeReviewAsk(
    { point: "pre-action", task: "改 A", claims: ["方案是先把 A 换成 B"] },
    { agent: { id: "a1" } }, deps,
  );
  assert.equal(res.result.candidate_basis.claims_in_turn_text_count, 0);
  assert.deepEqual(res.result.candidate_basis.claims_in_turn_text, [false]);
  assert.equal(asks, 1, "claims 不在正文里不得阻断询问（06 §5：形式不可分，不得机械强制）");
  assert.equal(res.result.decision, "review");
  assert.equal(res.outcome, "completed");
});

test("弱约束：本轮一个字都没写时 turn_text_empty 为真（依据仍交还，不拦）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  let asks = 0;
  const deps = {
    hostSeams: { requestReviewAsk: async () => { asks += 1; return { decision: "skip", asked: true }; } },
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
    readCurrentTurnText: () => ({ ok: true, turn: 1, assistant: "", truncated: false }),
  };
  const res = await executeReviewAsk({ point: "pre-action", task: "t" }, { agent: { id: "a1" } }, deps);
  assert.equal(res.result.candidate_basis.turn_text_empty, true);
  assert.equal(res.result.candidate_basis.turn_text_chars, 0);
  assert.equal(asks, 1, "空正文同样不阻断（本层只交还依据，不判定对错）");
  assert.equal(res.result.decision, "skip");
});

test("弱约束：读取器缺失/抛错/取不到时如实报 available:false，**不得假装是空正文**", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const exec = { agent: { id: "a1" } };
  const base = {
    hostSeams: { requestReviewAsk: async () => ({ decision: "skip", asked: true }) },
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
  };
  const missing = await executeReviewAsk({ point: "pre-action", task: "t" }, exec, base);
  assert.equal(missing.result.candidate_basis.available, false);
  assert.match(missing.result.candidate_basis.reason, /not wired/);
  assert.equal(missing.result.candidate_basis.turn_text_chars, undefined, "取不到时不得给出一个长度值——那会被读成「正文是空的」");
  const boom = await executeReviewAsk({ point: "pre-action", task: "t" }, exec, {
    ...base, readCurrentTurnText: () => { throw new Error("live stream gone"); },
  });
  assert.equal(boom.result.candidate_basis.available, false);
  assert.match(boom.result.candidate_basis.reason, /live stream gone/);
  assert.match(boom.result.candidate_basis.reason, /do not read this as/);
  const notArmed = await executeReviewAsk({ point: "pre-action", task: "t" }, exec, {
    ...base, readCurrentTurnText: () => ({ ok: false, reason: "no live turn accumulator in this process" }),
  });
  assert.equal(notArmed.result.candidate_basis.available, false);
  assert.match(notArmed.result.candidate_basis.reason, /no live turn accumulator/);
  assert.equal(missing.outcome, "completed");
  assert.equal(boom.outcome, "completed");
  assert.equal(notArmed.outcome, "completed");
});

test("弱约束：post-work 不交还 candidate_basis（那里没有「候选是否已写出」这回事）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const deps = {
    hostSeams: { requestReviewAsk: async () => ({ decision: "skip", asked: true }) },
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
    readCurrentTurnText: () => ({ ok: true, turn: 5, assistant: "做完了。", truncated: false }),
  };
  const res = await executeReviewAsk({ point: "post-work", task: "t", claims: ["做完了"] }, { agent: { id: "a1" } }, deps);
  assert.equal(res.result.candidate_basis, undefined, "post-work 不得出现 candidate_basis");
  const pre = await executeReviewAsk({ point: "pre-action", task: "t" }, { agent: { id: "a1" } }, deps);
  assert.ok(pre.result.candidate_basis);
});

test("弱约束：静默档与开关关闭时也交还依据（32 §6.2 第 2 项：免掉的是询问，不是核对）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const reader = () => ({ ok: true, turn: 4, assistant: "候选：按 A 做。", truncated: false });
  const silent = await executeReviewAsk({ point: "pre-action", task: "t" }, { agent: { id: "a1" } }, {
    hostSeams: { requestReviewAsk: async () => ({ decision: "silent", asked: false }) },
    getReviewAskSettings: () => ({ preAction: true, postWork: true, silentRun: true, silentRunKnown: true }),
    readCurrentTurnText: reader,
  });
  assert.equal(silent.result.silent_run, true, "必须真的走到静默分支（否则本用例守不住静默档的交还）");
  assert.equal(silent.result.decision, "silent");
  assert.ok(silent.result.candidate_basis, "静默档同样可能无候选可核对，须交还依据");
  assert.equal(silent.result.candidate_basis.available, true);
  const off = await executeReviewAsk({ point: "pre-action", task: "t" }, { agent: { id: "a1" } }, {
    hostSeams: { requestReviewAsk: async () => ({ decision: "skip", asked: true }) },
    getReviewAskSettings: () => ({ preAction: false, postWork: false }),
    readCurrentTurnText: reader,
  });
  assert.equal(off.result.switch_enabled, false);
  assert.ok(off.result.candidate_basis, "开关关闭分支同样交还依据");
});

test("弱约束：归一化口径对形状差异宽容、对内容差异严格（依据不得把排版差异当内容差异）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const deps = {
    hostSeams: { requestReviewAsk: async () => ({ decision: "skip", asked: true }) },
    getReviewAskSettings: () => ({ preAction: true, postWork: true }),
  };
  const run = async (assistant) => (await executeReviewAsk(
    { point: "pre-action", task: "t", claims: ["先改 A 再改 B"] },
    { agent: { id: "a1" } },
    { ...deps, readCurrentTurnText: () => ({ ok: true, turn: 1, assistant, truncated: false }) },
  )).result.candidate_basis.claims_in_turn_text[0];
  assert.equal(await run("我打算 **先改 A**\n再改 B。"), true, "Markdown 装饰与换行不得被判为内容差异");
  assert.equal(await run("先改 A 再改 C。"), false, "换了一个字就该为 false");
  assert.equal(await run("先改 B 再改 A。"), false, "顺序不同就该为 false");
});

test("renderEnvelope 必须把 candidate_basis 渲染给模型（信封里写了而渲染漏掉 = 没交还）", async () => {
  const { renderEnvelope } = await import("../lib/ldvh-tools.js");
  const mk = (basis) => ({
    envelope: {
      operation_key: "review-ask",
      outcome: "completed",
      result: { point: "pre-action", decision: "skip", asked: true, switch_enabled: true, candidate_basis: basis },
      gaps: [], scope: { not_completed: [] }, follow_up: [],
    },
  });
  const full = renderEnvelope("review-ask", mk({
    available: true, turn: 3, turn_text_chars: 42, turn_text_empty: false, truncated: false,
    claims_present: true, claims_count: 2, claims_in_turn_text: [true, false], claims_in_turn_text_count: 1,
    note: "不说明它是合格候选",
  }))[0].text;
  assert.match(full, /candidate_basis（判断依据，不构成裁决/, "须标明这是依据不是裁决");
  assert.match(full, /本轮正文 42 字/);
  assert.match(full, /带了 2 条，其中 1 条出现在本轮正文里/);
  assert.match(full, /claim\[1\]: 出现在正文/);
  assert.match(full, /claim\[2\]: \*\*未出现在正文\*\*/);
  assert.match(full, /不说明它是合格候选/, "口径说明须一并渲染，否则被读成「为真即合格」");

  const empty = renderEnvelope("review-ask", mk({
    available: true, turn_text_chars: 0, turn_text_empty: true, truncated: false,
    claims_present: false, claims_count: 0,
  }))[0].text;
  assert.match(empty, /一个字都没写/);
  assert.match(empty, /未带 claims/);

  const unavailable = renderEnvelope("review-ask", mk({
    available: false, reason: "the live turn accumulator is not wired", claims_present: false, claims_count: 0,
  }))[0].text;
  assert.match(unavailable, /candidate_basis: unavailable/);
  assert.match(unavailable, /not wired/);

  const noBasis = renderEnvelope("review-ask", {
    envelope: { operation_key: "review-ask", outcome: "completed", result: { point: "post-work", decision: "skip", asked: true, switch_enabled: true }, gaps: [], scope: { not_completed: [] }, follow_up: [] },
  })[0].text;
  assert.doesNotMatch(noBasis, /candidate_basis/);

  for (const text of [full, empty, unavailable]) {
    assert.doesNotMatch(text, /可以问|不能问|允许发问|禁止发问/);
  }
});
