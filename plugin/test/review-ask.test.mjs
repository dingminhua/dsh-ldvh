// Tests for plugin/lib/review-ask.js + 两处把关询问的行为面 —
// Human 2026-11-13 决定：改为「要不要安排代理审查／复核」两问，
// 各由一个设置开关控制，打开才有。
//
// ## 为什么这层要单测
//
// 三个断言都是有代价的：
//
// 1. **开关关时不得提问** —— 错成「照问」会让 Human 每轮被无关弹窗打断，而他
//    明明关掉了开关；
// 2. **开关开时不得静默** —— 错成「不问」使机制形同不存在，且从外面看不出来
//    （本仓「闸只拒绝、不推动」那次教训的同型：没有推动，开关等于空转）；
// 3. **同一内容不得重问** —— 重试必重问是路由答复账目头注记录的
//    实测失效，此处是新载体，须独立钉住。
//
// 另外钉住一条**如实声明**：本机制不构成机械保障（00 §4.6）。单测能证明的是
// 「开关读了、答复留了、指纹不重问」，**不能**证明主控真的去调用了——那条边界
// 写进注释，不写成断言。
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

// ---------------------------------------------------------------------------
// 开关读取
// ---------------------------------------------------------------------------

test("resolveReviewAskSettings：两代宿主取值形态都认，缺省按关", () => {
  // **不再用 deepEqual 覆盖整个返回对象**（2026-11-13 晚）：新增静默执行字段后，
  // 全等断言会把「新增一个字段」判成回归，逼着每次扩字段都来改这条断言。
  // 逐项断言只钉住语义（这正是这条测试要守的东西），字段增减不再误伤。
  const both = resolveReviewAskSettings({ preActionReviewAskEnabled: true, postWorkReviewAskEnabled: false });
  assert.equal(both.preAction, true);
  assert.equal(both.postWork, false);
  assert.equal(both.preActionKnown, true);
  assert.equal(both.postWorkKnown, true);
  // 静默执行缺省关，且 **known=false**（没配置 ≠ Human 关掉）
  assert.equal(both.silentRun, false);
  assert.equal(both.silentRunKnown, false);
  // 显式配置时才 known=true
  const silentOn = resolveReviewAskSettings({ reviewAskSilentRunEnabled: true });
  assert.equal(silentOn.silentRun, true);
  assert.equal(silentOn.silentRunKnown, true);
  // volatile { get() } 形态（0.1.7+）
  assert.equal(resolveReviewAskSettings({ preActionReviewAskEnabled: { get: () => true } }).preAction, true);
  // 全缺：按关，且 known=false 使「没配置」与「Human 关掉」可区分
  const none = resolveReviewAskSettings({});
  assert.equal(none.preAction, false);
  assert.equal(none.preActionKnown, false, "配置面取不到时不得假装是 Human 关掉的");
  assert.equal(resolveReviewAskSettings(null).postWork, false);
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

// ---------------------------------------------------------------------------
// 判据清单：必须可回指出处，且不是新造
// ---------------------------------------------------------------------------

test("COMPLEXITY_CRITERIA：每条都带规范出处，不新增判据", () => {
  assert.ok(Array.isArray(COMPLEXITY_CRITERIA) && COMPLEXITY_CRITERIA.length > 0);
  for (const item of COMPLEXITY_CRITERIA) {
    assert.equal(typeof item.key, "string");
    assert.equal(typeof item.label, "string");
    // 出处必须是既有规范，且不得是「本模块自创」——判据留在规范里是这条设计的前提。
    assert.match(item.source, /^specs\/(04|21) /, `${item.key} 的出处须回指 04 §6.1 或 21 §6.3，实际 ${item.source}`);
  }
});

// ---------------------------------------------------------------------------
// 点位排除（2026-11-14 Human 决定，specs/32 §4.2）
// ---------------------------------------------------------------------------

test("GATE_POINT_EXCLUSIONS：三类都有承接面、出处与反向边界，且属 32 号不属 04 号", () => {
  assert.ok(Array.isArray(GATE_POINT_EXCLUSIONS) && GATE_POINT_EXCLUSIONS.length === 3,
    "点位排除恰为三类（32 §4.2），不得就地增删——增删属 Human 决定");
  for (const item of GATE_POINT_EXCLUSIONS) {
    for (const field of ["key", "label", "carried", "source", "notExcluded"]) {
      assert.equal(typeof item[field], "string", `${item.key} 缺 ${field}`);
      assert.ok(item[field].trim().length > 0, `${item.key} 的 ${field} 不得为空`);
    }
    // **出处必须是 32 号**：这三类是「何时不请示」的点位排除，权威在 specs/32 §4.2。
    // 若有人把它改标成 specs/04，等于把 32 的规则写成 04 的判据——32 §19 第 5 项
    // 明禁两张清单互相顶替，而这条一旦混读，「含一段调研」会被推成「不算复杂任务」。
    assert.match(item.source, /^specs\/32 §4\.2/, `${item.key} 的出处须回指 specs/32 §4.2，实际 ${item.source}`);
    // carried 是**承接面引用**，不是「已核对」的结论：必须带条文号，供回指原文。
    assert.match(item.carried, /§/, `${item.key} 的承接面须写明条文号，不得只写机制名`);
  }
});

test("点位排除与判据清单必须是两份数据、不得合并（32 §19 第 5 项）", () => {
  // 破法很具体：有人觉得「反正都是不请示的理由」，把三类塞进 COMPLEXITY_CRITERIA
  // 省得渲染两块。那一步同时犯三件事——改了 04 的判据条数（本文无权）、把
  // 「不算复杂」与「不必问」压成一句、并让方案收敛自查随排除一起被免掉。
  const criteriaKeys = new Set(COMPLEXITY_CRITERIA.map((i) => i.key));
  for (const item of GATE_POINT_EXCLUSIONS) {
    assert.ok(!criteriaKeys.has(item.key), `${item.key} 不得进 COMPLEXITY_CRITERIA：那是 04 §6.1 的编译产物`);
  }
  // 反向：判据清单里也不得出现点位排除的字（同一理由，方向相反）
  for (const item of COMPLEXITY_CRITERIA) {
    assert.doesNotMatch(item.label, /调研取证与报告|受控提交与推送|既有事实对象的操作/,
      `04 侧判据「${item.key}」不得内嵌 32 侧点位排除的条目`);
    assert.doesNotMatch(item.source, /specs\/32/, `04 侧判据「${item.key}」的出处不得指向 32 号`);
  }
});

// ---------------------------------------------------------------------------
// 点位排除与规范原文的漂移面（2026-11-14 行动后复核 MINOR-5）
// ---------------------------------------------------------------------------

test("GATE_POINT_EXCLUSIONS：三类名称与承接条文须能在 specs/32 原文逐字找到", async () => {
  // 权威：01 §11.4「不得由 Code、测试、索引或页面先行制造事实上的第二规则源」。
  // 本模块把 32 §4.2 的三类写成了常量，规范改某类的名称或所引条文而代码不跟，
  // 代码就成了第二份规则源——且没有任何既有测试会红。故逐字回指原文。
  //
  // **方向是「代码里的每个值在原文中存在」**，不查「原文里的每个值在代码中存在」：
  // 后者需要解析规范结构，越出机械层边界（同 precheck-record.spec-drift.test.mjs
  // 的刻意不对称）。故规范新增一类而代码没跟上，本用例查不出；代码凭空多一条
  // 或改错名，查得出。
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  let spec;
  try {
    spec = await readFile(join(import.meta.dirname, "..", "..", "specs/32-把关请示系统规范.md"), "utf8");
  } catch {
    assert.fail(`语料不可读：specs/32-把关请示系统规范.md（发布包内无语料时须如实失败，不得静默通过）`);
  }
  const drifted = [];
  for (const item of GATE_POINT_EXCLUSIONS) {
    // 类别名（label 的粗体小标题部分，即「纯…」那一段）须逐字在原文
    const categoryName = item.label.split("（")[0];
    if (!spec.includes(categoryName)) drifted.push(`${item.key}: 类别名「${categoryName}」`);
    // 每条 source 指向的条文号（specs/32 §4.2）须存在
    if (!spec.includes("### 4.2 明确排除与证明边界")) drifted.push(`${item.key}: 32 §4.2 节标题`);
    // 承接面里的条文号须能在原文找到（只查 §编号串，不查散文）
    for (const sec of item.carried.match(/(?:09|02|33) §[0-9.]+[a-z]?/g) ?? []) {
      const [specNo, secNo] = [sec.slice(0, 2), sec.slice(3)];
      const file = { "09": "09", "02": "02", "33": "33" }[specNo];
      if (!file) continue;
      // 33 号交付合同的编号在本仓原文里是 §14（正文编号）；此处只验 §编号在
      // 对应规范的目录里出现过——按原文的 H 行查找。
      const { readFile: rf2 } = await import("node:fs/promises");
      const text = await rf2(join(import.meta.dirname, "..", "..", `specs/${file}-` + {
        "09": "受控提交与机械守护规范.md",
        "02": "事实源与事实模型基础规范.md",
        "33": "调研吸收系统规范.md",
      }[specNo]), "utf8").catch(() => null);
      if (text === null) { drifted.push(`${item.key}: 语料不可读 specs/${file}`); continue; }
      const head = secNo.split("/")[0];
      if (!new RegExp(`^#+\\s+${head.replace(".", "\\.")}\\s`, "m").test(text)) {
        drifted.push(`${item.key}: 承接条文 ${sec} 在 specs/${file} 无对应标题`);
      }
    }
  }
  assert.deepEqual(drifted, [], `点位排除常量与规范原文漂移（01 §11.4 禁第二规则源）：\n${drifted.join("\n")}`);
});

test("设置页 hint 与工具参数说明：须写明行动前那处的时点，且不得承诺「答复后才动手」", async () => {
  // 2026-11-14 Human 指出「主控还没有自己意见的时候，怎么会有审查这个说法」。
  // 根因不止注入行：面向 Human 的设置页 hint、面向模型的参数 description 都只写
  // 「动手前」，读起来就是「任务第一秒」；而规范的进入信号是 32 §6.1「尚未开始
  // 产生副作用」。这两面各自是独立的措辞面，改一处不漏另一处才是本条要守的。
  //
  // **本条刻意分两个文件各取一次**：它们不由同一常量渲染（那不是单一来源，
  // 是两份副本），所以任一侧回退都须单独红一次。
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const lib = join(import.meta.dirname, "..", "lib");

  const client = await readFile(join(lib, "client.js"), "utf8");
  const tool = await readFile(join(lib, "review-ask-tool.js"), "utf8");

  const failures = [];

  // ① 设置页中文 hint：须说清「还没方案时不问」，且须说清答复不拦行动。
  const zhStart = client.indexOf('"row.reviewAskPreHint": "');
  const zhEnd = client.indexOf('"', zhStart + '"row.reviewAskPreHint": "'.length);
  const zh = client.slice(zhStart, zhEnd);
  if (!/候选方案/.test(zh)) failures.push("row.reviewAskPreHint 中文侧未写「已形成候选方案」这个时点条件");
  if (!/还没有任何方案时不会问|没有可核对的对象/.test(zh)) failures.push("row.reviewAskPreHint 中文侧未说明还没有方案时不问");
  if (!/答与不答都不拦住/.test(zh)) failures.push("row.reviewAskPreHint 中文侧未说明答复不拦行动（00 §2.5）");
  if (/取得明确答复后才/.test(zh)) failures.push("row.reviewAskPreHint 中文侧出现了「取得明确答复后才」（00 §2.5 明禁）");

  // ② 设置页英文 hint：同一口径，英文侧不得落后。
  const enStart = client.indexOf('"row.reviewAskPreHint": "', zhEnd);
  const enEnd = client.indexOf('"', enStart + '"row.reviewAskPreHint": "'.length);
  const en = client.slice(enStart, enEnd);
  if (enStart === -1 || !/candidate plan/.test(en)) failures.push("row.reviewAskPreHint 英文侧未写 candidate plan 这个时点条件");
  if (!/does not hold it back/.test(en)) failures.push("row.reviewAskPreHint 英文侧未说明答复不拦行动");

  // ③ 工具参数说明：这是模型决定传什么参数时读到的最近一行，最容易被漏改。
  const pointDesc = /point: \{[^}]*?description: "([^"]*)"/s.exec(tool)?.[1] ?? "";
  if (!/方案已有候选/.test(pointDesc)) failures.push("point 参数 description 未写明「方案已有候选」这个时点");
  if (/动手前的审查询问/.test(pointDesc)) failures.push("point 参数 description 仍是旧口径「动手前的审查询问」");

  assert.deepEqual(failures, [], `时点措辞未补全：\n${failures.join("\n")}`);
});

test("设置页中英文 hint：同 key 双侧须都提到点位排除（MINOR-2 的复发面）", async () => {
  // 中文补了、英文漏了——这是 2026-11-14 行动后复核抓到的真实失真。纯文本面，
  // 没有任何既有测试覆盖。转红判据：删掉任一侧的排除句，本用例红。
  //
  // **取法不猜区块边界**：client.js 里同一个 key 在 zh/en 两套词条各出现一次，
  // 直接取该 key 的**每一次**出现并读出其 value 字符串，再按「是否存在含关键词
  // 的那一次」判定。这样不依赖「zh 在前 en 在后」或任何切片起点——那些写法在
  // 词条顺序变动时会假绿或假红。
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const src = await readFile(join(import.meta.dirname, "..", "lib", "client.js"), "utf8");

  /** 取出某个词条 key 的全部 value 字符串（按出现顺序）。 */
  function valuesOf(source, key) {
    const out = [];
    const needle = `"${key}": "`;
    for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
      const start = i + needle.length;
      // value 是双引号串，内部不含未转义的双引号；扫到下一个未转义 " 为止。
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
    // 结构前提：中英两套词条，每个 key 恰好两次；次数变了说明词条表被改，这是
    // 另一类漂移，须报错而非静默按「找到的那一次」判定。
    if (values.length !== 2) {
      failures.push(`${key} 出现 ${values.length} 次（预期中英各 1），无法判定是否双侧同步`);
      continue;
    }
    // 关键词集合**双语并列**，故不依赖出现顺序、也不依赖语种判定：任一侧没提到
    // 点位排除，那一次就不匹配，即报出该侧。顺序假设在词条表重排时会假绿。
    const mentions = /点位排除|三类情况不问|point-level exclusion|not asked/i;
    values.forEach((v, idx) => {
      if (!mentions.test(v)) {
        const lang = /[㐀-䶿一-鿿]/.test(v) ? "中文" : "英文";
        failures.push(`${key} 的${lang}侧未提到点位排除（该侧第 ${idx + 1} 次出现）`);
      }
    });
  }
  assert.deepEqual(failures, [], `设置页文案中英不同步（行动后复核 MINOR-2 的复发面）：\n${failures.join("\n")}`);
});

// ---------------------------------------------------------------------------
// 指纹：同一件事不重问，改一点就重问
// ---------------------------------------------------------------------------

test("reviewAskFingerprint：同输入同指纹、异输入异指纹、位置参与指纹", () => {
  const base = { point: "pre-action", task: "改开关", scope: "plugin/lib" };
  assert.equal(reviewAskFingerprint(base), reviewAskFingerprint({ ...base }), "同一件事重试须得到同一指纹（否则重试必重问）");
  assert.notEqual(reviewAskFingerprint(base), reviewAskFingerprint({ ...base, task: "改开关2" }), "描述变了就是另一件事");
  assert.notEqual(reviewAskFingerprint(base), reviewAskFingerprint({ ...base, point: "post-work" }), "审查与复核不得共用一个指纹");
  assert.notEqual(reviewAskFingerprint(base), reviewAskFingerprint({ point: "pre-action" }), "缺字段不得与有字段撞指纹");
  assert.match(reviewAskFingerprint(base), /^[a-f0-9]{64}$/);
});

// ---------------------------------------------------------------------------
// 呈报内容：标题有界、判据进 detail
// ---------------------------------------------------------------------------

test("composeReviewAsk：只写「要做什么」与「要不要审」，不产出 detail 且不出现判据", () => {
  // Human 2026-11-13 的明确要求：「对话框里写的太啰嗦了，判据不用写，
  // 只写要做什么而是否需要审核」。
  //
  // 这不是措辞偏好。判据是 AI 用来**决定要不要问**的输入，问出来时已经用过
  // 一次了；再摆给 Human，等于让他复核 AI 的推理，而不是回答那个待决问题。
  const pre = composeReviewAsk({ point: REVIEW_ASK_POINTS.PRE_ACTION, task: "重构召回注入" });
  // ① 要做什么必须在标题里（Human 一眼扫过的那一行）
  assert.match(pre.question, /重构召回注入/, "标题须写明要做什么");
  assert.match(pre.question, /审查/);
  assert.ok(pre.question.length <= 80, `标题须有界（实际 ${pre.question.length}）`);
  // ② 判据不得出现在任何一处
  assert.doesNotMatch(pre.question, /specs\//, "标题区不得出现规范指针");
  assert.doesNotMatch(pre.question, /判据/, "判据不得进入标题");
  assert.doesNotMatch(pre.question, /§6\.1/, "规范条目号不得进入标题");
  // ③ **不产出 detail**（Human 2026-11-13 截图指认）：detail 与两个选项说的是
  //    同一件事，卡片上于是三处重复。宿主契约里 detail 是 optional，缺省即不渲染。
  assert.equal(pre.detail, undefined, "卡片不得带 detail 块——选项已说明后果");
  assert.ok(!("detail" in pre), "detail 键须整个不存在，不得传空串");

  const post = composeReviewAsk({ point: REVIEW_ASK_POINTS.POST_WORK, task: "重构召回注入" });
  assert.match(post.question, /复核/);
  assert.notEqual(pre.question, post.question, "两处询问的问句须可区分");
  // 缺任务描述时不虚构，退化成中性占位而非空串
  assert.match(composeReviewAsk({ point: REVIEW_ASK_POINTS.PRE_ACTION }).question, /当次任务/);
  // 两处询问的问句须可区分（审查 vs 复核）
  assert.match(composeReviewAsk({ point: REVIEW_ASK_POINTS.PRE_ACTION }).question, /审查/);
  assert.match(composeReviewAsk({ point: REVIEW_ASK_POINTS.POST_WORK }).question, /复核/);
});

test("composeReviewAsk：任务描述过长时截断，不让标题挤成多行", () => {
  const longTask = "为「行动前审查／行动后复核」的触发判据定方向：规范里没有正面准入判据，只有 21 §6.3 的四条排除项；此前一直靠我私下把排除项取反当准入".repeat(2);
  const out = composeReviewAsk({ point: REVIEW_ASK_POINTS.PRE_ACTION, task: longTask });
  assert.ok(out.question.length <= 90, `标题须有界（实际 ${out.question.length}）`);
  assert.match(out.question, /…/, "超长须以省略号收尾，不得静默截断");
});

test("开关只认布尔真值：非布尔一律按关（不确定就当关）", () => {
  // 原实现 `raw !== false` 把 "false"、0、"" 全部解析为开启。这条路径通向
  // 「询问 Human」，方向必须保守：默认关闭是 Human 明确的期望，一旦配置面
  // 传来非布尔值就无故开启，比少问一次危险得多。
  for (const value of ["false", "true", 0, 1, "", "yes", {}, []]) {
    const r = resolveReviewAskSettings({ preActionReviewAskEnabled: value, postWorkReviewAskEnabled: value });
    assert.equal(r.preAction, false, `${JSON.stringify(value)} 不得被当作开启`);
    assert.equal(r.postWork, false, `${JSON.stringify(value)} 不得被当作开启`);
    assert.equal(r.preActionKnown, true, "非空值仍算「读到了」，只是判为关");
  }
  // 真布尔照常
  assert.equal(resolveReviewAskSettings({ preActionReviewAskEnabled: true }).preAction, true);
  assert.equal(resolveReviewAskSettings({ preActionReviewAskEnabled: false }).preAction, false);
  // 缺省与 null 是「取不到」，与「关掉了」可区分
  for (const value of [undefined, null]) {
    const r = resolveReviewAskSettings({ preActionReviewAskEnabled: value });
    assert.equal(r.preAction, false);
    assert.equal(r.preActionKnown, false, "缺省须报 unknown，不得假装 Human 关掉了");
  }
});

// ---------------------------------------------------------------------------
// 答复载体：只有明确答复才入载体，读不出来不等于没问过
// ---------------------------------------------------------------------------

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

    // 一次都没写成功 → 载体仍为空，读回的仍是 null
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

// ---------------------------------------------------------------------------
// 工具面：开关关闭时不提问（Human 原话「打开才有」）
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 静默执行（2026-11-13 晚 Human 确认 A1：不问即做）
// ---------------------------------------------------------------------------

test("reviewAskMode：静默只在询问开关开着时有对象；关着询问时静默不越过它", () => {
  // 三态：ask / silent / off——「静默」与「目标位置不存在」不是一回事
  assert.equal(reviewAskMode({ preAction: true, silentRun: false }, "pre-action").mode, "ask");
  assert.equal(reviewAskMode({ preAction: true, silentRun: true }, "pre-action").mode, "silent");
  // **核心断言**：询问开关关着时，静默开着也不派代理。
  // 关掉询问开关的语义是「这一处不必有人盯着」；静默若能越过它，关开关就
  // 失去了「省掉这次核对」的意思。Human 原话是「打开后才自动执行而不请示」
  // ——静默是询问的替代形态，不是询问的取消。
  assert.equal(reviewAskMode({ preAction: false, silentRun: true }, "pre-action").mode, "off");
  assert.equal(reviewAskMode({ postWork: false, silentRun: true }, "post-work").mode, "off");
  // 未知位置不猜（与 askEnabledFor 同纪律）
  assert.equal(reviewAskMode({ preAction: true, silentRun: true }, "whenever").mode, "off");
  // 静默开关取不到时如实标记（调用方须报告，不假装是 Human 关的）
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
  // 不问——这是静默的全部意义
  assert.equal(asked, 0, "静默开着就不得走到 Human 询问");
  assert.equal(env.outcome, "completed");
  assert.equal(env.result.decision, "silent");
  assert.equal(env.result.asked, false);
  assert.equal(env.result.silent_run, true);
  // A1 的核心：**免掉询问，不免掉核对**——必须给出派发模板
  assert.ok(env.result.review_template?.prompt?.length > 0, "静默执行必须给派发模板（A1：不问即做）");
  assert.match(env.result.review_template.prompt, /## 本次要审的对象/);
  // 静默不等于无痕：痕迹行必须存在，且可被原样引用
  assert.match(env.result.notice, /静默执行/);
  assert.match(env.result.notice, /重构召回注入/);
  // 这一支没有经过任何宿主服务，sources 须如实留空
  assert.deepEqual(env.sources, []);
  // 不给「reused」这类会造成误读的字段
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
  // 静默的全部意义正是绕开那个人工接缝：把它排在 seam 检查之后，会让
  // 「宿主没有 userQuestions 服务」把静默一并判成 unavailable。
  const env = await executeReviewAsk(
    { point: "pre-action", task: "某任务" },
    { agent: null },
    { getReviewAskSettings: () => ({ preAction: true, silentRun: true }), hostSeams: {} },
  );
  assert.equal(env.outcome, "completed", "没有询问通道时静默仍须成立");
  assert.equal(env.result.decision, "silent");
});

test("executeReviewAsk：静默开关取不到时保守退回询问，并如实报告", async () => {
  // **本条改过一次，方向反了**（2026-11-13 独立复核 MAJOR-4）。
  //
  // 原写法喂 `{ silentRun: true, silentRunKnown: false }` 并断言「按开处理、
  // 不重复打扰」——但真实读取器里 `silentRun = silent === true`、
  // `silentRunKnown = silent !== undefined`，**这个组合永远不可能出现**。
  // 那条测试钉住的是它自己捏的状态，而且与 lifecycle 侧另一条
  // 「按关处理」互相矛盾。真相是：取不到时 mode 落进 `ask`，即**照旧询问**。
  //
  // 保守退回本身是对的（不知道就别擅自免掉询问），缺陷在于不报告——那会让
  // 「配了静默却不生效」与「我本来没开」不可区分。故本条钉的是**退回 + 报告**。
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  let asked = 0;
  const env = await executeReviewAsk(
    { point: "pre-action", task: "某任务" },
    { agent: null },
    {
      // 真实读取器的形态：静默键缺失 → silentRun=false、silentRunKnown=false
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
  // 用**真实**的 resolveReviewAskSettings 驱动，而不是手捏一个对象——
  // 这正是上一条测试曾经翻车的地方（构造了不可达状态）。
  const fromReal = resolveReviewAskSettings({ preActionReviewAskEnabled: true });
  assert.equal(fromReal.silentRun, false);
  assert.equal(fromReal.silentRunKnown, false, "配置里没有静默键");
  const mode = reviewAskMode(fromReal, "pre-action");
  assert.equal(mode.mode, "ask", "取不到 → 保守退回询问");
  assert.equal(mode.silentUnknown, true, "取不到须可辨认，否则「没配」与「关掉」不可区分");
  // 配了 true 时才真静默
  const on = reviewAskMode(resolveReviewAskSettings({ preActionReviewAskEnabled: true, reviewAskSilentRunEnabled: true }), "pre-action");
  assert.equal(on.mode, "silent");
  assert.equal(on.silentUnknown, false);
  // 配了 false（Human 显式关掉）→ 询问，且**不是**「取不到」
  const off = reviewAskMode(resolveReviewAskSettings({ preActionReviewAskEnabled: true, reviewAskSilentRunEnabled: false }), "pre-action");
  assert.equal(off.mode, "ask");
  assert.equal(off.silentUnknown, false, "显式关掉不是取不到，不得混为一谈");
});

// ---------------------------------------------------------------------------
// 派发模板：两份、方向相反、共用纪律
// ---------------------------------------------------------------------------

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
    // 这两条是实证会话里抓到真缺陷的关键，不得丢
    assert.match(t.prompt, /只读/, "只读约束");
    assert.match(t.prompt, /不要假设作者是对的|不以说法为准/, "对抗性要求");
  }
});

test("两份模板追问方向相反：审查往后推演，复核往前核对", async () => {
  const { composePreActionReviewPrompt, composePostWorkReviewPrompt } = await import("../lib/review-dispatch-template.js");
  const pre = composePreActionReviewPrompt({ task: "t" });
  const post = composePostWorkReviewPrompt({ task: "t" });
  // 审查：对象尚未发生，应问方向/前提/失效面
  assert.match(pre, /还没开始执行/);
  assert.match(pre, /方向是否成立/);
  assert.match(pre, /前提是否齐备/);
  // 复核：对象已发生，应问声称vs实际/测试是否形同虚设
  assert.match(post, /已经发生|核对它是否真的做到了/);
  assert.match(post, /声称 vs 实际|声称做到的事/);
  assert.match(post, /形同虚设/);
  // 审查不得对审核体问「该不该做」（需求裁夺归 Human）
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
  // 提示不得鼓励 fork（fork 继承上下文，独立性不成立）
  assert.ok(reviewed.follow_up.some((f) => /零上下文/.test(f)));
  assert.ok(reviewed.follow_up.some((f) => /不要用 subagent_fork/.test(f)));

  const skipped = await executeReviewAsk(
    { point: "post-work", task: "改开关" }, { agent: null }, mk("skip"));
  assert.equal(skipped.result.decision, "skip");
  assert.equal(skipped.result.review_template, undefined, "跳过时给模板是噪声，还可能诱导照派");
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

  // 两个都没有时才明说缺——绝不编造
  const neither = composePostWorkReviewPrompt({});
  assert.match(neither, /主控未提供对象描述/);
});

// ---------------------------------------------------------------------------
// 2026-11-13 独立审核抓出的缺陷（BLOCKER #1 / MAJOR #2 #3）
// ---------------------------------------------------------------------------

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

  // 三种状态必须**可区分**——原实现三者渲染逐字相同（都是 "completed"）
  assert.notEqual(reviewed, skipped, "review 与 skip 不得渲染成同一段文本");
  assert.notEqual(skipped, none, "skip 与未决策不得渲染成同一段文本");
  assert.match(reviewed, /decision: review/);
  assert.match(skipped, /decision: skip/);
  assert.match(none, /decision: null/);
  // 模板必须**整段**给出：它就是派发给子代理的正文，截断即不可用
  assert.match(reviewed, /review_template\.kind: post-work-review/);
  assert.match(reviewed, /# 独立复核/, "模板正文须逐字渲染");
  assert.match(reviewed, /请逐条核对。/, "模板尾部不得被截断");
  // skip 时不得渲染模板（没安排就没有模板）
  assert.doesNotMatch(skipped, /review_template/);
});

test("renderEnvelope 必须把 silent 与 notice 渲染给模型（独立复核 BLOCKER）", async () => {
  // 这是本次改动里**最要紧**的一条：quietly 的整条链路最终只在模型能读到
  // `decision: silent` 与 `notice` 时才成立。原实现只处理 review/skip，
  // silent 落进 else 被渲染成「未发起询问」，notice 从未被渲染——
  // 于是「每次须原样引用 notice」这句要求，在真实路径上无法执行。
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
  // ① 不得被渲染成「未发起询问」——那是把「按设置做了」说成「没做」
  assert.doesNotMatch(text, /未发起询问/, "silent 不得落进 null 分支的文案");
  assert.doesNotMatch(text, /decision: null/, "silent 不是 null");
  // ② 必须写明 silent，且说明它不是 Human 的答复
  assert.match(text, /decision: silent/);
  assert.match(text, /不是 Human 的答复/);
  // ③ **notice 必须逐字出现**——模型要原样把它写进交付说明
  assert.ok(text.includes(notice), "notice 须逐字渲染，否则「静默不等于无痕」不可执行");
  // ④ 模板仍要整段给出（A1：静默仍要做那次核对）
  assert.match(text, /review_template\.kind: pre-action-review/);
  assert.match(text, /# 独立审查/);
});

test("开关状态读不到时不得报成「开关关闭」（MAJOR #3）", async () => {
  const { executeReviewAsk } = await import("../lib/review-ask-tool.js");
  const exec = { agent: null, signal: undefined };
  // ① getter 缺失（装配漏传）
  const missing = await executeReviewAsk({ point: "pre-action" }, exec, { hostSeams: {}, getReviewAskSettings: undefined });
  assert.equal(missing.outcome, "unavailable", "取不到开关状态须报 unavailable，不得报 completed");
  assert.equal(missing.result.switch_enabled, null, "不得声称开关是关的");
  assert.equal(missing.verification.passed, false);
  assert.match(missing.gaps.join(" "), /unavailable|not wired/i);
  // ② getter 抛错
  const boom = await executeReviewAsk({ point: "pre-action" }, exec, {
    hostSeams: {}, getReviewAskSettings: () => { throw new Error("config boom"); },
  });
  assert.equal(boom.outcome, "unavailable");
  assert.match(boom.gaps.join(" "), /config boom/);
  // ③ 读到了但为假 —— 这才是真正的「Human 关掉了」
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
  // 无 task 时两次调用必须可区分（原实现共用 298fbda3…）
  const a = reviewAskFingerprint({ point: "pre-action", task: null, scope: "session:s1|cwd:/p/a" });
  const b = reviewAskFingerprint({ point: "pre-action", task: null, scope: "session:s2|cwd:/p/b" });
  assert.notEqual(a, b, "不同会话/项目不得共用指纹");
  // 同一 scope + 同一 task 才复用
  const c = reviewAskFingerprint({ point: "pre-action", task: "修复登录bug", scope: "session:s1|cwd:/p/a" });
  const d = reviewAskFingerprint({ point: "pre-action", task: "修复登录bug", scope: "session:s1|cwd:/p/a" });
  assert.equal(c, d, "同一会话同一任务应复用（不重复提问）");
});

// ---------------------------------------------------------------------------
// 操作声明的准确性（2026-11-13 独立审核 MINOR #7）
// ---------------------------------------------------------------------------

test("操作声明：effect 必须是 may_change_state（本工具会写答复载体）", async () => {
	const { REVIEW_ASK_OPERATION } = await import("../lib/review-ask-tool.js");
	// 原值 "read" 是错的：答复写进 ~/.dsh/ldvh/review-ask-decisions.json，
	// 那是状态变更。错值当时无人消费，但仍是错的。
	assert.equal(REVIEW_ASK_OPERATION.effect, "may_change_state", "本工具写载体，不得声明为只读");
});

test("操作声明：awaitsHumanDecision 不得是死字段（须在注册处生效）", async () => {
	const { REVIEW_ASK_OPERATION } = await import("../lib/review-ask-tool.js");
	const { readFile } = await import("node:fs/promises");
	const tools = await readFile(new URL("../lib/ldvh-tools.js", import.meta.url), "utf8");
	assert.equal(REVIEW_ASK_OPERATION.awaitsHumanDecision, true, "本工具阻塞在 Human 答复上");
	// 消费点必须存在：否则该声明只是注释
	assert.match(
		tools,
		/REVIEW_ASK_OPERATION\.awaitsHumanDecision === true \? \{\} : \{ timeoutMs: 30000 \}/,
		"注册处须按该声明决定是否设墙钟期限",
	);
});

test("开关分派只有一处副本（工具面不得另写一遍）", async () => {
	const { readFile } = await import("node:fs/promises");
	const tool = await readFile(new URL("../lib/review-ask-tool.js", import.meta.url), "utf8");
	// 此前工具面另写 `point === "pre-action" ? settings?.preAction === true : …`，
	// 与 review-ask.js 的 askEnabledFor 是两处副本。
	assert.doesNotMatch(
		tool,
		/settings\?\.preAction === true \? settings\?\.postWork/,
		"开关分派须走 askEnabledFor，不得在工具面另写副本",
	);
	assert.match(tool, /askEnabledFor\(settings, point\)/);
});
