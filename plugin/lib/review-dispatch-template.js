/**
 * dsh-ldvh — 两份代理派发模板：**行动前审查**与**行动后复核**。
 *
 * ## 为什么要有模板（实证来源）
 *
 * Human 2026-11-13 指出「复核就是主回话把控，通过新建代理，主回话提供上下文
 * 就可以了，这个经常做」，并给了实证会话 `session-b93adc39`。该会话里实际做的
 * 是一次独立代码复核，派发参数为 `subagent({ name: "reviewer", description:
 * "Independent code review", prompt: <4294 字> })`——**零上下文**（不是 fork）、
 * prompt 手工写全。
 *
 * 那份 prompt 的五块结构是有作用的，且**它抓到了真实的 BLOCKER**：主对话当时
 * 已经报了「完成」，复核体读宿主源码后指出 `turn/end` 期间调 `followup` 会被
 * `dsh-session` 的重入保护拒绝（`session append cannot reenter while another
 * append is being published`），于是那条「自动续轮」机制实际是空转——扣预算、
 * 装监听、触发、抛错、记日志，一条都没排进去。主对话拿到结论后的第一句是
 * 「审查代理发现一个 BLOCKER，而且我确实没有在真宿主上验证新机制就报告完成」。
 *
 * 结论：**这套形态值得固化**。模板的作用不是教人写 prompt，而是把「上次侥幸
 * 想全了的那五块」变成默认形状——尤其是「声明的主张要逐条列出」与「必须自己
 * 去读代码验证，不许信作者」，这两条正是抓到 BLOCKER 的原因。
 *
 * ## 为什么分两份（Human 2026-11-13 决定）
 *
 * 审查与复核的**对象与时点不同**，一份模板盖不住：
 *
 * | | 行动前审查 | 行动后复核 |
 * |---|---|---|
 * | 对象 | 还没取得效力的**候选/方案** | 已经发生的**工作与结果** |
 * | 时点 | 动手前 | 收口前 |
 * | 要问的 | 「这个方案哪里想错了、漏了什么前提」 | 「实际做了什么、与声称的差在哪」 |
 * | 主要失效 | 想错方向、漏掉约束、方案本身不可行 | 报了完成但没做到、测试形同虚设、文档与代码不一致 |
 * | 证据形态 | 规范条文、既有事实、方案内部一致性 | `git diff`、测试输出、运行观察 |
 *
 * 两者共用同一条纪律（零上下文、只读、可反驳、必须给证据、结论分级），但**追问
 * 的方向相反**：审查是「往后推演会不会出问题」，复核是「往前核对是不是真做了」。
 *
 * ## 如实声明边界（00 §4.6）
 *
 * **模板不是机械保障。** 它不保证：
 * - 主控真的用了它（可以自己写 prompt，也可以根本不派）；
 * - 派出去的代理真的独立（零上下文是对**主控**的要求，机械层不知道它是否用
 *   `subagent_fork` 派发的——fork 会继承全部上下文，独立性即不成立）；
 * - 结论被采纳（是否改、改成什么，仍是主控与 Human 的判断）。
 *
 * 它只做一件事：**把「该提供的上下文」与「该问的问题」变成一份可复制的默认形状**，
 * 使主控不必每次临时设计，也使 Human 能核对「这次的代理到底被要求查什么」。
 */

import { REVIEW_ASK_POINTS } from "./review-ask.js";

/**
 * 两份模板共用的纪律块（逐字复用，避免两份漂移）。
 *
 * 这几条不是装饰：实证会话里「Be skeptical and specific. Do NOT assume the
 * author is right.」与「Read-only, DO NOT modify any file」都是原文，且前者
 * 直接决定了复核体敢不敢否定作者的判断。
 */
const COMMON_DISCIPLINE = [
  "## 硬性约束",
  "",
  "- **只读**：不得修改任何文件，不得运行会改变状态的 git 命令（no stash/checkout/commit/reset）。可以跑测试、可以在 /tmp 写一次性脚本验证猜想，但不要往仓库里留文件。",
  "- **不要假设作者是对的**：你的任务是找真实缺陷，不是肯定作者的工作。如果某个地方没查出问题，明确说「这里我查了什么、为什么认为没问题」，不要用「已确认无误」这类空结论。",
  "- **每条结论都要给证据**：具体到文件:行号、代码片段，或一次可复现的观察结果。没有证据的怀疑可以提，但要标明那是猜测。",
  "- **按严重度分级**，不要把所有问题平铺：BLOCKER（不改就不能交付）/ MAJOR（会造成错误行为）/ MINOR（可改进）/ NIT（琐碎）。",
  "- **不确定就说不确定**：查不到、看不懂、缺前提时如实说明，不要用看起来完整的推断填空。",
];

/**
 * 输出格式块（两份共用，故复核与审查的结论可互相比较、可汇总）。
 */
const OUTPUT_FORMAT = [
  "## 输出格式",
  "",
  "按严重度排序的清单。每条包含：",
  "",
  "- **严重度**：BLOCKER / MAJOR / MINOR / NIT",
  "- **位置**：文件:行号，或规范条目编号；方案类问题写「哪一条主张」",
  "- **问题**：一句话说清哪里不对",
  "- **证据**：代码片段、diff 片段、测试输出，或规范原文",
  "- **建议**：怎么改（给方向即可，不必写完整补丁）",
  "",
  "结尾给一句总体结论：**能不能往下走**，以及**必须先修什么**。简洁，但不要为了省篇幅漏掉真问题。",
];

/** 把主控给的改动/方案描述收进模板；缺内容时明确说缺，不虚构。 */
function describeSubject({ subject, claims, evidence, task } = {}) {
  const lines = [];
  lines.push("## 本次要审的对象");
  lines.push("");
  // 对象描述优先取 subject；没有时**退到 task 那句话再退到明说缺**。
  // 为什么不直接写「未提供」：单工具调用里主控往往只填 task，而 task 那句
  // 通常已经把「改了什么」说清了。此时再让代理「不知道要审什么」是自造缺口
  // ——但**绝不编造**：两句都没有时才明说缺。
  const subjectText = typeof subject === "string" && subject.trim().length > 0
    ? subject.trim()
    : (typeof task === "string" && task.trim().length > 0 ? task.trim() : null);
  lines.push(subjectText ?? "（主控未提供对象描述——若你也看不到，直接指出这一点，不要凭空推断要做的是什么）");
  lines.push("");
  const claimList = Array.isArray(claims) ? claims.filter((c) => typeof c === "string" && c.trim().length > 0) : [];
  if (claimList.length > 0) {
    lines.push("### 主控声称做到/打算做到的事（逐条核对，不要预设成立）");
    lines.push("");
    claimList.forEach((claim, index) => lines.push(`${index + 1}. ${claim.trim()}`));
    lines.push("");
  }
  if (typeof evidence === "string" && evidence.trim().length > 0) {
    lines.push("### 可取的证据入口");
    lines.push("");
    lines.push(evidence.trim());
    lines.push("");
  }
  return lines;
}

/**
 * 行动前审查模板——对象是**尚未取得效力的候选**。
 *
 * 追问方向：这个方案在想什么层面可能错？漏了哪些前提？有没有更简单的做法？
 * 依据是否真的支持结论？边界有没有说清？
 *
 * **不对它问「该不该做」**：需求裁夺归 Human（21 §14 对审核体的同一条边界，
 * 此处沿用理由——审核体不知道 Human 的取舍权重，问它等于让它替 Human 决定）。
 */
export function composePreActionReviewPrompt({ subject, claims, evidence, task } = {}) {
  const lines = [];
  lines.push("# 独立审查请求（行动前 · 对候选方案主动找错）");
  lines.push("");
  lines.push("你是一位独立审查者。**你没有参与这份方案的形成**，所以你的判断有意义。");
  lines.push("请对下面这份**还没开始执行**的方案做一次对抗性审查——目标是**在动手之前**找出它会在哪里出错。");
  lines.push("");
  // 「任务背景」只在另有 subject 时才加——否则 task 就是对象描述本身，
  // 写两遍会让代理以为这是两条不同的信息。
  if (typeof subject === "string" && subject.trim().length > 0
    && typeof task === "string" && task.trim().length > 0) {
    lines.push(`任务背景：${task.trim()}`);
    lines.push("");
  }
  lines.push(...describeSubject({ subject, claims, evidence, task }));
  lines.push("## 请重点查这几面");
  lines.push("");
  lines.push("1. **方向是否成立**：这份方案要解决的问题，真的是它声称要解决的那个吗？有没有更根本的解法被跳过？");
  lines.push("2. **前提是否齐备**：方案成立依赖哪些前提（规范条文、既有实现、宿主能力、数据现状）？逐条核对它们**现在真的成立吗**——不要接受「据说」「应该」这类表述，去看原文与代码。");
  lines.push("3. **约束是否被遗漏**：现行规范、既有决策（ADR）、已知踩坑（Pitfall）里有没有与本方案冲突或对其设限的条目？有就给编号与原文。");
  lines.push("4. **失效面**：这个方案在什么条件下会失败、静默失效、或产生「看起来成功其实没做」的结果？**这是最有价值的一类发现**——实证过的例子是「机制扣了预算、装了监听、触发、抛错、记日志，但一条实际动作都没发生，而外面看起来像成功了」。");
  lines.push("5. **边界与代价**：方案说明了它不做什么吗？代价（性能、复杂度、维护成本、对其它功能的影响）有没有被低估？");
  lines.push("6. **可验证性**：方案里的每一步，事后能不能用证据判定「做到了」？哪几步只能靠自述？把这些指出来。");
  lines.push("");
  lines.push("## 你不需要做的");
  lines.push("");
  lines.push("- **不要裁决「该不该做」**：需求取舍归 Human。你可以说「按这个目标，方案 A 比 B 更稳」，但不要输出「这件事不该做」。");
  lines.push("- 不要重写整份方案。指出问题与方向即可。");
  lines.push("");
  lines.push(...COMMON_DISCIPLINE);
  lines.push("");
  lines.push(...OUTPUT_FORMAT);
  return lines.join("\n");
}

/**
 * 行动后复核模板——对象是**已经发生的工作与结果**。
 *
 * 追问方向：声称做了什么 vs 实际做了什么？判据真的达到了吗？测试是真的在测
 * 还是形同虚设？文档与代码一致吗？
 *
 * 这份直接脱胎于实证会话 `session-b93adc39` 的那次独立代码复核——它的
 * 「改动声称做到的事，逐条核对」与「测试是不是形同虚设」两段是抓到真缺陷的
 * 关键，故保留同样的锋利度。
 */
export function composePostWorkReviewPrompt({ subject, claims, evidence, task } = {}) {
  const lines = [];
  lines.push("# 独立复核请求（行动后 · 对已发生的工作逐条核对）");
  lines.push("");
  lines.push("你是一位独立复核者。**你没有参与这项工作**，也没有读过主控的推理过程——这正是你的价值所在：你只能看到结果与声称，必须自己去核实。");
  lines.push("主控认为这项工作已经完成。你的任务是**核对它是否真的做到了**。");
  lines.push("");
  // 「任务背景」只在另有 subject 时才加——否则 task 就是对象描述本身，
  // 写两遍会让代理以为这是两条不同的信息。
  if (typeof subject === "string" && subject.trim().length > 0
    && typeof task === "string" && task.trim().length > 0) {
    lines.push(`任务背景：${task.trim()}`);
    lines.push("");
  }
  lines.push(...describeSubject({ subject, claims, evidence, task }));
  lines.push("## 请重点查这几面");
  lines.push("");
  lines.push("1. **声称 vs 实际**：上面「主控声称做到的事」逐条核对。**以代码/diff/运行结果为准，不以说法为准**。有一条做不到就明确指出来——这是本复核的第一要务。");
  lines.push("2. **是否真的验证过**：「跑过测试」「验证通过」这类声称，去看它到底跑了什么、覆盖了什么。**在真实环境上验证过，还是在模拟/夹具上验证过？**这两者的差别经常就是缺陷藏身处——实证过的例子是：改动在单元测试夹具里全绿，在真宿主上因为一个重入保护而完全不生效，而当时已经报了完成。");
  lines.push("3. **测试是不是形同虚设**：新加的测试真的钉住了行为吗？还是过度的 mock 使其在缺陷重现时依然通过？问一句：如果把那个 bug 重新引入，哪条测试会红？答不出来就是没钉住。");
  lines.push("4. **边界与副作用**：改动有没有影响其它路径？错误路径、并发、重入、清理失败时分别会怎样？有没有新增的未处理异常、泄漏、死锁可能？");
  lines.push("5. **文档与代码是否一致**：注释、CHANGELOG、README 里的描述，与代码实际行为对得上吗？**任何代码里不成立的声称都要指出**——文档说了做不到的事，比没写更糟。");
  lines.push("6. **遗留与半成品**：有没有留下没清干净的旧代码、失效的注释、说了一半的设计、被注释掉的调试残留？");
  lines.push("");
  lines.push("## 你不需要做的");
  lines.push("");
  lines.push("- 不要重写实现，也不要在仓库里留任何修改。");
  lines.push("- 不要因为「作者显然很用心」就降低标准——用心与做对是两件事。");
  lines.push("");
  lines.push(...COMMON_DISCIPLINE);
  lines.push("");
  lines.push(...OUTPUT_FORMAT);
  return lines.join("\n");
}

/**
 * 按询问位置取对应的派发模板。
 *
 * @param {"pre-action"|"post-work"} point
 * @returns {{point: string, prompt: string, kind: string}}
 */
export function reviewDispatchTemplate(point, inputs = {}) {
  if (point === REVIEW_ASK_POINTS.PRE_ACTION) {
    return { point, kind: "pre-action-review", prompt: composePreActionReviewPrompt(inputs) };
  }
  if (point === REVIEW_ASK_POINTS.POST_WORK) {
    return { point, kind: "post-work-review", prompt: composePostWorkReviewPrompt(inputs) };
  }
  return { point, kind: "unknown", prompt: "" };
}
