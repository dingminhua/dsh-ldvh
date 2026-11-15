/**
 * Norm「方向定位与适用范围」段的确定性提取（27 §8 书写契约的**唯一机械实现**）。
 *
 * ── 为什么单独成模块 ─────────────────────────────────────────────────────
 *
 * 同一段文字有两个消费面，它们**必须同源同形**，否则必然漂移：
 *
 *   1. `ldvh_norm_list` 的投影（27 §10 F1 卡片）——AI 主动查询时看到；
 *   2. 行动前注入面的常驻枚举行（27 §10「注入面另按 F1 常驻枚举」、34 §8.4）
 *      ——每回合被动在场。
 *
 * 提取器原先住在 `norm-writer.js`（写入侧）且未导出。注入面在
 * `source-recall.js`，从写入器反向 import 是错的依赖方向，复制一份解析
 * 逻辑则会出现「list 说合契约、注入面说不合」的第二实现漂移。故抽到本
 * 模块：两个消费面 import 同一函数、同一形状、同一 fail-closed 语义。
 *
 * ── 提取的是什么（27 §8，Human 2026-11-15 决定）──────────────────────────
 *
 * 该段**恰好两个标注段**，每段一条语句：
 *
 *   · `**管什么**：…`   ≤60 字，职责定位（本方向管什么）
 *   · `**何时查阅**：…` ≤60 字，须展开本规范的行动场景（什么情形下先读它）
 *
 * 旧契约只取「管什么」首句。改动的理由：注入行只有标题与方向键时，AI
 * 无从判断「哪份规范在管当次事项」，只能凭标题猜或额外调一次
 * `ldvh_norm_list`——实测（docs/recall-consumption-pilot-2026-11-11.md）
 * 「真正稳定起作用的是常驻索引／基线层」，而索引行不含定位内容就等于把
 * 判断材料留在了需要主动取的一侧。两句合起来给出 what + when：前者说明
 * 管辖面，后者说明触发场景。
 *
 * ── fail-closed（不截断、不回退）─────────────────────────────────────────
 *
 * 任一条不合契约 → `available: false` 且两句均为空串，**绝不**回退到
 * 「取整段首段」或「截断到 60 字」：
 *
 *   · 回退整段会把脱离上下文的半句当成定位外发。实证：存量载体
 *     「上游更新跟进规程」旧写法第二段是「…AI 无须另行请示即可按本规程
 *     跟进」——那是**授权语句**，回退即把授权每回合注入上下文。
 *   · 截断会产生读不通的半句（27 §8：不合契约时不外发摘录，而非截断后外发）。
 *
 * 不可用时注入面仍出「标题（方向键）」行（标题必出，见
 * `planL0Enumeration` 的两段装填），并由 `positioning_status` /
 * `unavailable_reason` 显式告知不可用与原因（34 §12 三态：读不到／让位／
 * 为空必须可分辨，「定位不可导出」同样不得静默）。
 */

import { sectionContent } from "./markdown-structure.js";

/** 该段的固定 H2 标题（27 §8 正文骨架第一段）。 */
const POSITIONING_SECTION_TITLE = "方向定位与适用范围";

/** 每条语句的长度上限（27 §8 第 4 条；按剥除 markdown 标记后的 UTF-16 码元计）。 */
const POSITIONING_MAX_CHARS = 60;

/**
 * 两条语句共用的**授权措辞**拦截（27 §8 第 2 条点名的词）。
 *
 * 定位句是「本方向管什么／何时该读」，不是授权面。混入「无须请示」
 * 「可直接」「免于」会把一句授权当成定位抛给 AI——存量载体已实证过
 * 这种写法（见模块头注释），故确定性拦下。
 *
 * 只认规范点名的形态，不把「不必／无须」等泛词独立拦下（会误伤正常
 * 定位句，如「不必读全文即可判断」）。
 */
const AUTHORIZATION_WORDING = /无须.*请示|无需.*请示|不必.*请示|免予.*请示|免于.*请示|可直接|免予|免于/;

/**
 * 「何时查阅」句**额外**禁止的适用性断言形态。
 *
 * 该句的职责是描述**行动场景**（什么时候该来读），不是宣告**适用结论**。
 * 写成「本规范适用于 X」会让注入面出现一句可被直接读成「已判定适用」
 * 的话，与 34 §13（索引不得读成结论）、34 §8.4 第 3 项（须自证未判定
 * 适用）冲突。合规写法是「做 X 前／出现 X 时查阅本规范」。
 */
const APPLICABILITY_ASSERTION = /本规范适用|适用于|视同适用|即适用/;

/** 两个标签（粗体 + 中文冒号，27 §8 第 1 条）。 */
const LABELS = Object.freeze({
  governs: "**管什么**：",
  whenToRead: "**何时查阅**：",
});

/** 剥标记后的等价标签（用于定位正文起点）。 */
const BARE_LABELS = Object.freeze({
  governs: "管什么：",
  whenToRead: "何时查阅：",
});

/**
 * 不可用原因（确定性、可编程判定；调用方据此写披露语，不得静默）。
 * 取值即契约的一部分——`ldvh_norm_list` 的 `positioning_status` 与注入面
 * 的段尾披露都直接引用它们。
 */
const POSITIONING_UNAVAILABLE = Object.freeze({
  NO_SECTION: "no-section",
  EXTRA_PARAGRAPHS: "extra-paragraphs",
  EMPTY_PARAGRAPH: "empty-paragraph",
  LABEL_MISSING_GOVERNS: "label-missing:管什么",
  LABEL_MISSING_WHEN: "label-missing:何时查阅",
  TOO_LONG_GOVERNS: "too-long:管什么",
  TOO_LONG_WHEN: "too-long:何时查阅",
  AUTHORIZATION_GOVERNS: "authorization-wording:管什么",
  AUTHORIZATION_WHEN: "authorization-wording:何时查阅",
  ASSERTION_WHEN: "applicability-assertion:何时查阅",
  MULTI_SENTENCE_GOVERNS: "multi-sentence:管什么",
  MULTI_SENTENCE_WHEN: "multi-sentence:何时查阅",
});

/**
 * 剥除 markdown 强调标记与反引号后折叠空白。
 *
 * 计长与切句都在**剥标记后**的字符串上做（27 §8「首句边界与机械范围」）：
 * 正文里的 `**…**` 粗体不应把字数算多。实测「发布门槛」的
 * `**发布前必须通过的检查清单**` 曾致 63 > 60。
 *
 * 标签形态判定则在**原样折叠空白**的字符串上做——粗体与中文冒号是契约
 * 要求的形式，剥掉标记就无法判「是否真的写成了 `**管什么**：`」。
 */
function stripMarkup(text) {
  return text.replace(/\*\*/g, "").replace(/`/g, "");
}

/**
 * 解析一个标注段：返回 `{ labelOk, text }`。
 *
 * `labelOk` 为假表示标签形态不合契约（缺粗体／用半角冒号／标签写错）；
 * `text` 是剥标记后的语句正文，到第一个 `。` 或 `；` 为止（与旧「首句」
 * 口径一致），无句末标点时取整段折叠结果。
 */
function parseLabeledParagraph(paragraph, key) {
  const folded = paragraph.replace(/\s+/g, " ").trim();
  // 按字面标签判定：粗体两星 + 标签词 + 中文冒号（拒半角冒号／无粗体）。
  const startsWithLabel = folded.startsWith(LABELS[key]);
  const flat = stripMarkup(folded);
  const bare = BARE_LABELS[key];
  if (!flat.startsWith(bare)) return { labelOk: startsWithLabel, text: "", multiSentence: false };
  const rest = flat.slice(bare.length).trim();
  const sentence = /^(.+?[。；])/.exec(rest);
  // **段内是否还有第二句**（2026-11-15，独立复核 MINOR-5）：契约要求「每段一条
  // 语句」。原实现只取第一句、**其余静默丢弃**且仍报 ok——一个 150 字的第二句
  // 不会出现在注入面，机械层却看不出任何异常。改为：检出多句即判不合契约
  // （fail-closed），由调用方给出点名判定项。
  const leftover = sentence ? rest.slice(sentence[1].length).trim() : "";
  return {
    labelOk: startsWithLabel,
    text: (sentence ? sentence[1] : rest).trim(),
    multiSentence: leftover !== "",
  };
}

/**
 * 从 Norm 载体原文提取「方向定位与适用范围」段的两句定位。
 *
 * @param {string} raw Norm 载体的完整原文（含 frontmatter）
 * @returns {{
 *   available: boolean,
 *   governs: string,
 *   whenToRead: string,
 *   unavailable_reason: string|null,
 * }} `available` 为假时两句均为空串、`unavailable_reason` 非空
 */
export function normPositioningOf(raw) {
  const unavailable = (reason) => ({
    available: false,
    governs: "",
    whenToRead: "",
    unavailable_reason: reason,
  });
  if (typeof raw !== "string" || raw.trim() === "") return unavailable(POSITIONING_UNAVAILABLE.NO_SECTION);

  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const section = sectionContent(body, POSITIONING_SECTION_TITLE);
  if (section === null || section.trim() === "") return unavailable(POSITIONING_UNAVAILABLE.NO_SECTION);

  // 契约要求**恰好两段**：多出的段落（不管什么清单、双源声明、沿革等）在
  // 2026-11-15 契约下须迁入「核心规则体系」或「约束与反模式」。这里不按
  // 「取前两段」宽容处理——宽容会让「段里还塞着别的东西」静默通过，而那
  // 正是本次要消除的冗余形态。
  const paragraphs = section.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "");
  if (paragraphs.length !== 2) return unavailable(POSITIONING_UNAVAILABLE.EXTRA_PARAGRAPHS);

  const first = parseLabeledParagraph(paragraphs[0], "governs");
  const second = parseLabeledParagraph(paragraphs[1], "whenToRead");
  if (!first.labelOk) return unavailable(POSITIONING_UNAVAILABLE.LABEL_MISSING_GOVERNS);
  if (!second.labelOk) return unavailable(POSITIONING_UNAVAILABLE.LABEL_MISSING_WHEN);
  if (first.text === "") return unavailable(POSITIONING_UNAVAILABLE.EMPTY_PARAGRAPH);
  if (second.text === "") return unavailable(POSITIONING_UNAVAILABLE.EMPTY_PARAGRAPH);
  // **每段恰好一句**（契约硬要求，机械层据此 fail-closed）：段内多句即不合契约。
  if (first.multiSentence) return unavailable(POSITIONING_UNAVAILABLE.MULTI_SENTENCE_GOVERNS);
  if (second.multiSentence) return unavailable(POSITIONING_UNAVAILABLE.MULTI_SENTENCE_WHEN);

  if (first.text.length > POSITIONING_MAX_CHARS) return unavailable(POSITIONING_UNAVAILABLE.TOO_LONG_GOVERNS);
  if (second.text.length > POSITIONING_MAX_CHARS) return unavailable(POSITIONING_UNAVAILABLE.TOO_LONG_WHEN);

  if (AUTHORIZATION_WORDING.test(first.text)) return unavailable(POSITIONING_UNAVAILABLE.AUTHORIZATION_GOVERNS);
  if (AUTHORIZATION_WORDING.test(second.text)) return unavailable(POSITIONING_UNAVAILABLE.AUTHORIZATION_WHEN);
  // 适用性断言只对「何时查阅」判：「管什么」句本就是职责陈述，
  // 「本方向管…」不含「适用于」形态，无需重复拦。
  if (APPLICABILITY_ASSERTION.test(second.text)) return unavailable(POSITIONING_UNAVAILABLE.ASSERTION_WHEN);

  return { available: true, governs: first.text, whenToRead: second.text, unavailable_reason: null };
}

/**
 * 注入面与工具投影共用的**摘录行**格式（单一来源，两处不得各写一份）。
 *
 * 形态刻意与候选卡的 `↳ ` 摘录引导行同构，使读者一眼认出「这是派生摘录，
 * 不是规则正文」；分隔用全角竖线，与既有注入面风格一致。
 *
 * @param {{governs: string, whenToRead: string}} positioning 已判定 available 的两句
 * @returns {string} 形如 `  ↳ 管什么：… ｜ 何时查阅：…`；输入不完整时返回空串
 */
export function positioningExcerptLine(positioning) {
  const governs = typeof positioning?.governs === "string" ? positioning.governs.trim() : "";
  const whenToRead = typeof positioning?.whenToRead === "string" ? positioning.whenToRead.trim() : "";
  if (governs === "" || whenToRead === "") return "";
  return `${POSITIONING_EXCERPT_PREFIX}${governs}${POSITIONING_EXCERPT_SEPARATOR}${whenToRead}`;
}

/**
 * 摘录行的**格式常量**（引导前缀与分隔符）。
 *
 * **如实说明（2026-11-15，独立复核 MINOR-4）**：原注释称本常量「供预算规划
 * 区分标题行与摘录行」——**该用途并不存在**：预算规划（`planL0Enumeration`）
 * 拿到的是「标题行数组」与「摘录行数组」两个分开的数据面，不靠前缀嗅探，
 * 故它从不读这两个常量。原注释描述的是一个想象出来的消费者，属**注释说了
 * 不存在的事**（比没写更糟）。
 *
 * 今后的定位：**摘录行的格式单一来源**——拼接由 `positioningExcerptLine`
 * 完成（它用这两个常量拼行），任何再写一份 `  ↳ 管什么：… ｜ 何时查阅：…`
 * 字面量的地方都是第二份格式定义。渲染侧当前按整行接收（前缀由数据层拼好），
 * 仍以本处为格式权威。
 */
export const POSITIONING_EXCERPT_PREFIX = "  ↳ 管什么：";
export const POSITIONING_EXCERPT_SEPARATOR = " ｜ 何时查阅：";
