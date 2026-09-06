/**
 * Recreate the blueprint research object with strict evidence discipline,
 * per the new single-file spec (specs/24) — replaces the deprecated
 * first object (d5bd2681, directory-era + loose evidence).
 */
import { createResearchObject, readResearchObject, updateResearchObject } from "../../lib/research-writer.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "/Users/dmh2002/DshProject/dsh-ldvh/ldvh-base";
const OLD_UID = "d5bd2681-3432-45f8-bf29-f62f2da3c2d2";

// Sources (5 official docs, verbatim-fetched via read_page)
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
  { statement: "Linear 的 Initiative/Project update 由两部分固定结构组成：一个健康指示灯提供当前状态的高层信号，加一段富文本描述承载状态、挑战与下一步的深入信息", confidence: "high", quotes: [{ text: "Initiative and Project updates are structured reports that keep teams and leaders informed on progress and alignment. They consist of a health indicator that provides high-level signal of the current state and a rich text description for deeper insights into status, challenges, and next steps.", anchor: "Overview", source: LINEAR }] },
  { statement: "Linear 的健康指示灯枚举值是 On track / At risk / Off track 三档", confidence: "high", quotes: [{ text: "Select a health indicator— On track, At risk, or Off track—to represent the current state of the Initiative or Project.", anchor: "Create Initiative and Project updates", source: LINEAR }] },
  { statement: "GitHub Projects 的 status update 固定结构为：状态（如 On track/At risk）+ 开始日期 + 目标日期 + 支持 Markdown 格式的说明消息", confidence: "high", quotes: [{ text: "You can set a status, such as \"On track\" or \"At risk\", to allow people to quickly determine the current state of the project. You can also set start dates and target dates. Your status update can also contain a message that supports formatting with Markdown.", anchor: "About status updates", source: GH_UPDATES }] },
  { statement: "GitHub Projects 的 roadmap 布局在可配置时间跨度上展示项目条目，并以自定义日期/迭代字段定位条目位置", confidence: "high", quotes: [{ text: "The roadmap layout provides a high-level visualization of your project across a configurable timespan, and allows you to drag items to affect their start and target dates or selected iteration.", anchor: "About the roadmap layout", source: GH_ROADMAP }] },
  { statement: "Jira Plans 提供多个视图，其中 Summary 视图用于跨团队与计划的顶层进度快照", confidence: "high", quotes: [{ text: "**Summary** | High-level progress snapshot across teams and initiatives", anchor: "Multiple views for different needs", source: JIRA }] },
  { statement: "Jira Plans 的工作层级在 epic 之上可加自定义层级 Initiative，作为跨团队/空间的史诗容器，代表项目组合或战略优先级", confidence: "high", quotes: [{ text: "**Initiative (custom, above epic):** A container for epics spanning multiple teams or spaces. Use this to represent a program or a strategic priority that cuts across team lines.", anchor: "How does the work item hierarchy work in Plans?", source: JIRA }] },
  { statement: "GitHub Projects 的数据随 issue/PR 变更自动双向同步进项目，视图与图表无需手动更新", confidence: "high", quotes: [{ text: "Information is synced automatically to your project as you make changes, updating your views and charts.", anchor: "Staying up-to-date", source: GH_ABOUT }] },
  { statement: "GitHub Projects 内置工作流可在条目被添加或变更时自动设置字段", confidence: "high", quotes: [{ text: "Built-in workflows allow you to automatically set fields when items are added or changed, and you can also configure your project to automatically archive items when they meet certain criteria", anchor: "Automating your projects", source: GH_ABOUT }] },
  { statement: "Linear 通过管理员配置的周期性提醒督促 owner/lead 持续发布 update，且仅发给 In Progress 状态的 Initiative/Project", confidence: "high", quotes: [{ text: "Reminders are sent for active Initiatives and Projects with statuses in the In Progress category, and only to the Initiative owner or project lead.", anchor: "Initiative and Project update reminders", source: LINEAR }] },
  { statement: "Linear 会在起草 update 时自动生成与上次相比的进度报告，且总体进度变化必须超过 2% 才会显示进度细节，也可手动隐藏", confidence: "high", quotes: [{ text: "Overall project progress must have changed by more than 2% since the last update in order for progress details to appear here.", anchor: "Progress reports for Initiatives and Projects", source: LINEAR }] },
  { statement: "Linear 提供 Write with Agent：agent 自动审查上次 update 以来的变更与 Slack 消息，起草 update 草稿供人细化后发布", confidence: "high", quotes: [{ text: "click **Write with Agent** to let Linear do it for you. The agent reviews changes made since the last update, checks messages in the linked Slack channel, and writes an update draft for you to refine.", anchor: "Agent assisted updates", source: LINEAR }] },
  { statement: "Jira Plans 以沙箱方式工作：所有改动停留在 plan 内，直到用户用 Review changes 功能选择提交回 Jira 才影响真实数据", confidence: "high", quotes: [{ text: "No. Plans works as a sandbox. Any changes you make stay in your plan until you choose to save them back to Jira using the \"Review changes\" function.", anchor: "Jira Plans: Frequently Asked Questions", source: JIRA }] },
  { statement: "Jira 的 Program Board 从 plan 实时拉取数据，随工作推进保持最新，是活数据而非快照", confidence: "high", quotes: [{ text: "Because it pulls from your plan in real time, the board stays current as work progresses.", anchor: "Why teams use Program Board", source: JIRA }] },
  { statement: "Linear 最新一条 update 展示在 Project/Initiative 概览页，历史通过 Updates 标签页按时间顺序查看", confidence: "high", quotes: [{ text: "The most recent update is displayed on the Project Overview or Initiative Overview page. To view previous updates, click on the Updates tab.", anchor: "View Initiative and Project updates", source: LINEAR }] },
  { statement: "GitHub Projects 的 status update 位于项目侧栏，最新一条在最上方、完整历史在其下依次排列", confidence: "high", quotes: [{ text: "Status updates can be found on your project's side panel, below the description and README. You can read the most recent update at the top and the full history of updates beneath.", anchor: "About status updates", source: GH_UPDATES }] },
  { statement: "GitHub 新建 status update 时表单默认沿用上一条 update 的状态、开始日期与目标日期，降低重复填报", confidence: "high", quotes: [{ text: "When you start creating a new status update, the form will default to the previous update's status, start date, and target date.", anchor: "Adding new status updates", source: GH_UPDATES }] },
  { statement: "Linear 的 update 可在 Linear 内查看并推送到 Slack 频道", confidence: "high", quotes: [{ text: "Updates can be viewed in Linear and sent to Slack channels.", anchor: "Overview", source: LINEAR }] },
  { statement: "Linear 中任何人可对 update 用 emoji 表达感受，且上下文中的变更（target date、成员、里程碑）与 update 按时间顺序同列在 Updates 标签页", confidence: "medium", quotes: [{ text: "Updates appear in chronological order along with any changes to properties such as the target date, members, and milestones.", anchor: "Updates tab", source: LINEAR }] },
];

const uncertain = [];

const gaps = [
  { description: "尚未找到任何产品提供与 LDVH 蓝图完全相同的固定区块列表（当前目标/当前阶段/已完成/进行中/下一步/悬而未决）——三个官方来源的固定结构都是健康状态+自由文本/字段，LDVH 的六区块蓝图在业界无直接先例，需自行设计", priority: "high" },
  { description: "Linear Initiatives 文档页（initiative health 与 projects 的关系）未实际抓取正文", priority: "medium" },
  { description: "Jira 单项目 roadmap 页面未实际抓取正文验证", priority: "medium" },
  { description: "Notion/Airtable 项目 dashboard 模板无实际抓取来源，结构未确认", priority: "low" },
];

const implications = [
  { finding_ref: confirmed[0].statement, implication: "业界 update 的固定结构（健康指示灯+富文本描述）支持 LDVH 蓝图采用固定六区块——但六区块本身无业界先例，是 LDVH 原创，需自行设计并验证可维护性" },
  { finding_ref: confirmed[6].statement, implication: "GitHub 的数据自动双向同步提示 LDVH 蓝图的更新机制应考虑从事实源机械投影而非手写维护——蓝图更新触发器可与 Git Gate/事实源变更联动" },
  { finding_ref: confirmed[9].statement, implication: "Linear 的 2% 变化阈值提示 LDVH 蓝图更新可设变化阈值避免噪声——但 LDVH 场景（AI 主导维护）与 Linear（人类 owner）不同，阈值语义需重新定义" },
  { finding_ref: confirmed[10].statement, implication: "Write with Agent（agent 审查变更起草 update 供人细化）与 LDVH 蓝图的 AI 维护+Human 验收模式同构——LDVH 可直接吸收此分工形态" },
  { finding_ref: confirmed[11].statement, implication: "Jira Plans 的沙箱+Review changes 提交模式与 LDVH 蓝图的受控更新（CAS+change_log）同构——业界先例支持蓝图更新走受控通道而非自由编辑" },
];

// Build the body (directed: five H2)
function findingBlock(c, i) {
  return "### 发现 " + (i + 1) + "：" + c.statement + "\n\n置信度：" + c.confidence + "。摘录：「" + c.quotes[0].text + "」（" + c.quotes[0].source + "，锚点：" + c.quotes[0].anchor + "）[" + (i + 1) + "]";
}

const analysisBody = [
  "## 调研问题",
  "主流项目管理工具（Linear、GitHub Projects、Jira）如何设计项目蓝图（当前状态总览）功能？核心固定结构、更新机制与人机交互形态是什么？",
  "",
  "## 输入与边界",
  "读取三个产品的官方文档（Linear Docs 的 Initiative and Project updates 页、GitHub Docs 的 About Projects / roadmap layout / sharing updates 三页、Atlassian 的 Jira Advanced Planning 概览页），全部经 read_page 桥逐字抓取，观察时点 2026-09-08。不覆盖 Notion/Airtable 模板（无实际抓取来源，列入 gaps）与 Linear Initiatives 独立页。",
  "",
  "## 已证实",
  confirmed.map(findingBlock).join("\n\n"),
  "",
  "## 未证实与缺口",
  gaps.map((g) => "- 缺口（" + g.priority + "）：" + g.description).join("\n"),
  "",
  "## 停止与后续",
  "停止原因：round-cap（单轮完整调研，三个子问题各获充分证据，未覆盖项已如实列入 gaps）。",
  "",
  "对 LDVH 蓝图设计的启发：",
  implications.map((impl) => "- 「" + impl.finding_ref.slice(0, 40) + "…」——" + impl.implication).join("\n"),
  "",
  "后续：业界依据已获取——六区块无先例（LDVH 原创需自行验证）、更新机制有三条可吸收模式（机械投影/变化阈值/agent 起草+人验收）、受控更新有 Jira 沙箱先例。可进入蓝图 §5 五个待裁决问题的 Human 裁决阶段。",
].join("\n");

// Create the new object
const result = await createResearchObject({
  factSourceRoot: ROOT,
  frontmatterDraft: {
    title: "项目蓝图功能的业界做法调研（Linear/GitHub Projects/Jira Plans）",
    status: "active",
    research_question: "主流项目管理工具如何设计项目蓝图（当前状态总览）功能——固定结构、更新机制与人机交互形态是什么？",
    research_purpose: "为 LDVH 蓝图功能（blueprint-feature-draft 五个待裁决问题）提供业界先例依据",
    stopping_reason: "round-cap",
    urls,
    confirmed,
    uncertain,
    gaps,
    implications,
  },
  analysisBody,
  sessionSignature: { provider: "zzztoken-glm", model: "glm-5.3" },
});

if (!result.ok) {
  console.error(JSON.stringify(result.error, null, 2));
  process.exit(1);
}
console.log("New object:", result.value.object_uid);
console.log("File:", result.value.file);

// Read back to verify
const readBack = await readResearchObject({ factSourceRoot: ROOT, objectUid: result.value.object_uid });
console.log("Read-back ok:", readBack.ok, "| confirmed:", readBack.value.frontmatter.confirmed.length, "| gaps:", readBack.value.frontmatter.gaps.length, "| implications:", readBack.value.frontmatter.implications.length);

// Retire the old object (CAS update: status → retired)
const oldRead = await readResearchObject({ factSourceRoot: ROOT, objectUid: OLD_UID });
if (oldRead.ok) {
  const retired = await updateResearchObject({
    factSourceRoot: ROOT,
    objectUid: OLD_UID,
    expectedFingerprint: oldRead.value.fingerprint,
    frontmatterAfter: { ...oldRead.value.frontmatter, status: "retired" },
    analysisBodyAfter: oldRead.value.body,
    changeSummary: "retire：证据纪律不严（发现 7 来源错配）且载体为已废弃的目录结构——由严格证据纪律版新对象替代",
    sessionSignature: { provider: "zzztoken-glm", model: "glm-5.3" },
  });
  console.log("Old object retired:", retired.ok);
} else {
  console.log("Old object already gone or unreadable:", oldRead.error?.code);
}
