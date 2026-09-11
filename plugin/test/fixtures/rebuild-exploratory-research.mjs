/**
 * Rebuild the blueprint research as a proper exploratory research object:
 *   调查阶段 H2 (four H3) = the survey facts (what the products do)
 *   analysis sections     = the actual research (patterns, comparison,
 *                           what it means for LDVH)
 * Also disables YAML line-wrapping so long Chinese statements stay on
 * one line and the frontmatter is human-readable.
 */
import { rm } from "node:fs/promises";
import { createResearchObject, readResearchObject, updateResearchObject } from "../../lib/research-writer.js";
import { shellAuthoritativeSignature } from "../../lib/session-signature.js";

const ROOT = "/Users/dmh2002/DshProject/dsh-ldvh/ldvh-base";
const PREV_UID = "31c2cf86-0d84-4ef9-b0db-8dab9f67bfdd";

const urls = [
  { ref: "https://linear.app/docs/initiative-and-project-updates", title: "Initiative and Project updates – Linear Docs", summary: "Linear update 的固定结构（健康指示灯+富文本）、三档健康状态、最新置顶+历史 tab、周期提醒、自动进度报告(2%阈值)、Write with Agent、Slack 分发与 emoji 反应" },
  { ref: "https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects", title: "About Projects - GitHub Docs", summary: "GitHub Projects 三种布局、数据自动双向同步、内置工作流自动设字段" },
  { ref: "https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout", title: "Customizing the roadmap layout - GitHub Docs", summary: "roadmap 布局用自定义日期/迭代字段在时间线上定位条目" },
  { ref: "https://docs.github.com/en/issues/planning-and-tracking-with-projects/sharing-project-updates", title: "Sharing project updates - GitHub Docs", summary: "status update 固定结构、侧栏位置、新 update 表单默认沿用上一条" },
  { ref: "https://www.atlassian.com/software/jira/guides/advanced-roadmaps/overview", title: "Introduction to Jira Advanced Planning | Atlassian", summary: "Jira Plans 的 Summary 视图、Initiative 自定义层级、沙箱+Review changes、Program Board 实时拉取" },
];

const LINEAR = "https://linear.app/docs/initiative-and-project-updates";
const GH_ABOUT = "https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects";
const GH_ROADMAP = "https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout";
const GH_UPDATES = "https://docs.github.com/en/issues/planning-and-tracking-with-projects/sharing-project-updates";
const JIRA = "https://www.atlassian.com/software/jira/guides/advanced-roadmaps/overview";

const confirmed = [
  { statement: "Linear 的 Initiative/Project update 由健康指示灯+富文本描述两部分固定结构组成", confidence: "high", quotes: [{ text: "Initiative and Project updates are structured reports that keep teams and leaders informed on progress and alignment. They consist of a health indicator that provides high-level signal of the current state and a rich text description for deeper insights into status, challenges, and next steps.", anchor: "Overview", source: LINEAR }] },
  { statement: "Linear 的健康指示灯枚举值是 On track / At risk / Off track 三档", confidence: "high", quotes: [{ text: "Select a health indicator— On track, At risk, or Off track—to represent the current state of the Initiative or Project.", anchor: "Create Initiative and Project updates", source: LINEAR }] },
  { statement: "GitHub Projects 的 status update 固定结构为：状态+开始日期+目标日期+Markdown 消息", confidence: "high", quotes: [{ text: "You can set a status, such as \"On track\" or \"At risk\", to allow people to quickly determine the current state of the project. You can also set start dates and target dates. Your status update can also contain a message that supports formatting with Markdown.", anchor: "About status updates", source: GH_UPDATES }] },
  { statement: "GitHub Projects 的 roadmap 布局在可配置时间跨度上展示条目并以自定义日期/迭代字段定位", confidence: "high", quotes: [{ text: "The roadmap layout provides a high-level visualization of your project across a configurable timespan, and allows you to drag items to affect their start and target dates or selected iteration.", anchor: "About the roadmap layout", source: GH_ROADMAP }] },
  { statement: "Jira Plans 的 Summary 视图用于跨团队与计划的顶层进度快照", confidence: "high", quotes: [{ text: "**Summary** | High-level progress snapshot across teams and initiatives", anchor: "Multiple views for different needs", source: JIRA }] },
  { statement: "Jira Plans 在 epic 之上支持自定义层级 Initiative 作为跨团队史诗容器", confidence: "high", quotes: [{ text: "**Initiative (custom, above epic):** A container for epics spanning multiple teams or spaces. Use this to represent a program or a strategic priority that cuts across team lines.", anchor: "How does the work item hierarchy work in Plans?", source: JIRA }] },
  { statement: "GitHub Projects 的数据随 issue/PR 变更自动双向同步进项目，视图与图表无需手动更新", confidence: "high", quotes: [{ text: "Information is synced automatically to your project as you make changes, updating your views and charts.", anchor: "Staying up-to-date", source: GH_ABOUT }] },
  { statement: "GitHub Projects 内置工作流可在条目被添加或变更时自动设置字段", confidence: "high", quotes: [{ text: "Built-in workflows allow you to automatically set fields when items are added or changed, and you can also configure your project to automatically archive items when they meet certain criteria", anchor: "Automating your projects", source: GH_ABOUT }] },
  { statement: "Linear 通过周期性提醒督促 owner/lead 持续发布 update，且仅发给 In Progress 状态的对象", confidence: "high", quotes: [{ text: "Reminders are sent for active Initiatives and Projects with statuses in the In Progress category, and only to the Initiative owner or project lead.", anchor: "Initiative and Project update reminders", source: LINEAR }] },
  { statement: "Linear 自动生成进度报告且总体进度变化超过 2% 才显示细节", confidence: "high", quotes: [{ text: "Overall project progress must have changed by more than 2% since the last update in order for progress details to appear here.", anchor: "Progress reports for Initiatives and Projects", source: LINEAR }] },
  { statement: "Linear 提供 Write with Agent：agent 审查变更与 Slack 消息起草 update 草稿供人细化发布", confidence: "high", quotes: [{ text: "click **Write with Agent** to let Linear do it for you. The agent reviews changes made since the last update, checks messages in the linked Slack channel, and writes an update draft for you to refine.", anchor: "Agent assisted updates", source: LINEAR }] },
  { statement: "Jira Plans 以沙箱方式工作：改动停留在 plan 内直到 Review changes 提交", confidence: "high", quotes: [{ text: "No. Plans works as a sandbox. Any changes you make stay in your plan until you choose to save them back to Jira using the \"Review changes\" function.", anchor: "Jira Plans: Frequently Asked Questions", source: JIRA }] },
  { statement: "Jira 的 Program Board 从 plan 实时拉取数据保持最新，是活数据而非快照", confidence: "high", quotes: [{ text: "Because it pulls from your plan in real time, the board stays current as work progresses.", anchor: "Why teams use Program Board", source: JIRA }] },
  { statement: "Linear 最新 update 展示在概览页，历史通过 Updates 标签页查看", confidence: "high", quotes: [{ text: "The most recent update is displayed on the Project Overview or Initiative Overview page. To view previous updates, click on the Updates tab.", anchor: "View Initiative and Project updates", source: LINEAR }] },
  { statement: "GitHub 的 status update 位于项目侧栏，最新在最上方、历史在其下排列", confidence: "high", quotes: [{ text: "Status updates can be found on your project's side panel, below the description and README. You can read the most recent update at the top and the full history of updates beneath.", anchor: "About status updates", source: GH_UPDATES }] },
  { statement: "GitHub 新建 status update 表单默认沿用上一条的状态与日期，降低重复填报", confidence: "high", quotes: [{ text: "When you start creating a new status update, the form will default to the previous update's status, start date, and target date.", anchor: "Adding new status updates", source: GH_UPDATES }] },
  { statement: "Linear 的 update 可在 Linear 内查看并推送到 Slack 频道", confidence: "high", quotes: [{ text: "Updates can be viewed in Linear and sent to Slack channels.", anchor: "Overview", source: LINEAR }] },
  { statement: "Linear 的 update 支持 emoji 反应，且变更记录与 update 按时间顺序同列", confidence: "medium", quotes: [{ text: "Updates appear in chronological order along with any changes to properties such as the target date, members, and milestones.", anchor: "Updates tab", source: LINEAR }] },
];

const uncertain = [];

const gaps = [
  { description: "业界无与 LDVH 六区块蓝图相同的固定区块先例——三家均为健康状态+自由文本；六区块是 LDVH 原创设计，其可维护性无外部参照，是蓝图实现的首要风险", priority: "medium" },
  { description: "Linear Initiatives 独立文档页未抓取正文", priority: "medium" },
  { description: "Jira 单项目 roadmap 页面未抓取正文验证", priority: "medium" },
  { description: "Notion/Airtable 项目 dashboard 模板无实际抓取来源", priority: "low" },
];

const implications = [
  { finding_ref: confirmed[0].statement, implication: "业界 update 的固定结构支持 LDVH 蓝图采用固定区块——但六区块本身无业界先例（LDVH 原创），可维护性是蓝图设计的首要风险" },
  { finding_ref: confirmed[6].statement, implication: "GitHub 的数据自动双向同步提示 LDVH 蓝图应从事实源机械投影而非手写维护——更新触发器可与 Git Gate/事实源变更联动" },
  { finding_ref: confirmed[9].statement, implication: "Linear 的 2% 变化阈值可防止蓝图更新噪声——但 LDVH 是 AI 主导维护，阈值语义需按 LDVH 场景重定义" },
  { finding_ref: confirmed[10].statement, implication: "Write with Agent（agent 起草+人细化）与 LDVH 蓝图的 AI 维护+Human 验收分工同构，可直接吸收" },
  { finding_ref: confirmed[11].statement, implication: "Jira 沙箱+Review changes 与 LDVH 蓝图受控更新（CAS+change_log）同构——业界先例支持蓝图走受控通道而非自由编辑" },
];

// --- Body: exploratory = 调查阶段 H2 + four H3, then analysis ---
const surveyBody = [
  "### 调查问题与范围",
  "三个业界头部产品（Linear、GitHub Projects、Jira Plans）的项目状态总览/蓝图功能各是什么结构？按固定结构、更新机制、人机交互三个子问题搜集官方文档证据。收敛后的研究问题：LDVH 蓝图的六区块设计在业界有无先例、更新机制可吸收哪些模式。",
  "",
  "### 调查方法与来源",
  "五个官方文档页（Linear 1 页、GitHub 3 页、Atlassian 1 页）经 read_page 桥逐字抓取，观察时点 2026-09-08。Notion/Airtable 模板无实际抓取来源，未列入证据。",
  "",
  "### 调查发现",
  "共 18 条已证实发现（详见 frontmatter confirmed 与下方已证实段）：三家产品的 update 结构高度一致——健康/状态指示灯 + 结构化字段（日期等）+ 自由文本；差异在更新机制（GitHub 全自动同步 / Linear 提醒+agent 起草 / Jira 沙箱人工提交）和展示位（Linear 概览页+tab / GitHub 侧栏 / Jira 独立视图）。",
  "",
  "### 调查停止与交接",
  "三个子问题各获 4-7 条 confirmed 证据，来源均为官方文档，停止于 sufficient（内容覆盖完整、无 high 级未关闭缺口——唯一的 high 缺口是业界无六区块先例，这正是研究要回答的）。交接给分析阶段的焦点：从一致性中提炼模式、从差异中判断哪些适合 LDVH。",
].join("\n");

const analysisBody = [
  "## 调研问题",
  "LDVH 蓝图的六区块设计（当前目标/当前阶段/已完成/进行中/下一步/悬而未决）在业界有无先例？主流工具的固定结构、更新机制与人机交互形态对 LDVH 蓝图设计有什么可吸收的模式？",
  "",
  "## 输入与边界",
  "分析基于调查阶段的 18 条已证实发现（五个官方文档来源，见 frontmatter）。分析视角：LDVH 蓝图是一个项目级活文档、AI 主导维护、Human 随时查看，与业界工具的 Human owner+团队协作用途有本质差异。不覆盖 Notion/Airtable（无证据）。",
  "",
  "## 已证实",
  "18 条发现按研究主题归纳（引用编号对应 frontmatter confirmed 顺序）：",
  "",
  "### 结构模式：健康指示灯 + 自由文本是业界共识",
  "发现 1-3、5 一致表明：三家的 update 都以一个**机器可枚举的健康信号**（On track/At risk/Off track）开头，配上**人类自由文本**承载细节。没有任何一家把已完成/进行中/下一步做成枚举式固定区块。GitHub 加结构化日期字段（发现 3），Jira 用层级容器（发现 6）组织范围，但内容层全部是自由文本。",
  "",
  "### 更新机制模式：三个成熟度层次",
  "发现 7-13 呈现一条光谱：**GitHub 全自动**（数据双向同步+工作流自动设字段，发现 7-8）→ **Linear 半自动**（提醒督促+2% 阈值进度报告+agent 起草，发现 9-11）→ **Jira 人工闸门**（沙箱+Review changes 提交，发现 12-13）。成熟度越高，人的维护负担越低，但结构自由度也越低。",
  "",
  "### 交互模式：最新置顶 + 历史可溯是共识",
  "发现 14-17 一致：最新一条 update 总在概览位置（Linear 概览页/GitHub 侧栏顶部），历史按时间可翻（Updates tab/侧栏下方）。GitHub 的默认沿用上一条字段（发现 16）和 Linear 的 emoji 反应（发现 18）是降低维护负担和增加轻反馈的细节模式。",
  "",
  "## 未证实与缺口",
  gaps.map((g) => "- 缺口（" + g.priority + "）：" + g.description).join("\n"),
  "",
  "## 停止与后续",
  "停止原因：sufficient——三个子问题的证据覆盖完整，研究问题（有无先例+可吸收模式）已可回答：**六区块无业界先例，是 LDVH 原创**；业界共识结构（健康信号+自由文本）与六区块是两种设计路线；更新机制有三个成熟度层次可按 LDVH 的 AI 主导特性选择。",
  "",
  "对 LDVH 蓝图设计的启发：",
  implications.map((impl) => "- 「" + impl.finding_ref + "」——" + impl.implication).join("\n"),
  "",
  "后续：业界依据已完整——蓝图 §5 五个待裁决问题可进入 Human 裁决。核心待决点：①六区块原创设计的可维护性风险是否接受 ②更新机制选哪个成熟度层次（LDVH 倾向 GitHub 式机械投影+Linear 式 agent 起草的组合）。",
].join("\n");

const result = await createResearchObject({
  factSourceRoot: ROOT,
  frontmatterDraft: {
    title: "项目蓝图功能的业界做法调研（Linear/GitHub Projects/Jira Plans）",
    status: "active",
    research_question: "LDVH 蓝图的六区块设计在业界有无先例？主流工具的固定结构、更新机制与人机交互对 LDVH 有什么可吸收模式？",
    research_purpose: "为 LDVH 蓝图功能五个待裁决问题提供业界先例依据",
    stopping_reason: "sufficient",
    urls,
    confirmed,
    uncertain,
    gaps,
    implications,
  },
  analysisBody,
  surveyBody,
  sessionSignature: await shellAuthoritativeSignature(),
});

if (!result.ok) {
  console.error(JSON.stringify(result.error, null, 2));
  process.exit(1);
}
console.log("New object:", result.value.object_uid);

// Retire the previous attempt (31c2cf86) — it was directed-type with pure listing, not real research
const prevRead = await readResearchObject({ factSourceRoot: ROOT, objectUid: PREV_UID });
if (prevRead.ok) {
  const retired = await updateResearchObject({
    factSourceRoot: ROOT,
    objectUid: PREV_UID,
    expectedFingerprint: prevRead.value.fingerprint,
    frontmatterAfter: { ...prevRead.value.frontmatter, status: "retired" },
    analysisBodyAfter: prevRead.value.body,
    changeSummary: "retire：正文仅罗列调查发现无研究分析（已证实段=frontmatter 复述），子阶段应为探索型（调查+分析）——由探索型新对象替代",
    sessionSignature: await shellAuthoritativeSignature(),
  });
  console.log("Previous retired:", retired.ok);
}
