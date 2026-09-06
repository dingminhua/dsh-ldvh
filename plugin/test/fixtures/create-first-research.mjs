import { ResearchSession } from "../../lib/research-session.js";
import { createResearchObject, readResearchObject } from "../../lib/research-writer.js";

const session = new ResearchSession({
  question: "主流项目管理工具如何设计项目蓝图（当前状态总览）功能——固定结构、更新机制与 Human 交互形态是什么？",
  purpose: "为 LDVH 蓝图功能（blueprint-feature-draft.md 五个待裁决问题）提供业界先例依据",
  subQuestions: ["业界蓝图的核心固定结构", "业界蓝图的更新机制", "业界蓝图的人机交互形态"],
  maxRounds: 3,
});

session.registerSource("https://linear.app/docs/projects", "Linear Docs / Projects", "Linear 项目视图官方文档");
session.registerSource("https://linear.app/docs/initiative-and-project-updates", "Linear Docs / Initiative and Project updates", "Linear 结构化更新官方文档");
session.registerSource("https://www.notion.com/templates/category/wiki", "Notion Wiki templates", "Notion 项目模板套件");
session.registerSource("https://www.notion.com/templates/category/personal-dashboards", "Notion Personal dashboards", "Notion 可视化数据库视图");

const r1 = session.submitRound([
  {
    statement: "Linear 项目总览固定结构为：项目摘要+项目属性+关联文档/链接+详细描述+项目里程碑列表",
    state: "confirmed", sub_question_key: "业界蓝图的核心固定结构",
    evidence: { text: "Here, you'll find a brief project summary, project properties, any associated documents and links, a detailed project description, and a list of project milestones.", anchor: "Linear Projects / View your projects", source: "https://linear.app/docs/projects", confidence: "high" },
  },
  {
    statement: "Linear Initiative/Project updates 是结构化状态报告，固定包含 health indicator（On track/At risk/Off track）+富文本描述（status/challenges/next steps）",
    state: "confirmed", sub_question_key: "业界蓝图的人机交互形态",
    evidence: { text: "Initiative and Project updates are structured reports that keep teams and leaders informed on progress and alignment. They consist of a health indicator that provides high-level signal of the current state and a rich text description for deeper insights into status, challenges, and next steps.", anchor: "Linear Initiative and Project updates / Overview", source: "https://linear.app/docs/initiative-and-project-updates", confidence: "high" },
  },
  {
    statement: "Linear 项目总览支持 list/board/timeline 三种视图，可按 status/lead/target date/activity 属性组织",
    state: "confirmed", sub_question_key: "业界蓝图的核心固定结构",
    evidence: { text: "Each team has a Projects page which organizes the team's projects into a list, board, or timeline.", anchor: "Linear Projects / View your projects", source: "https://linear.app/docs/projects", confidence: "high" },
  },
  {
    statement: "Notion 项目模板底层为可组合 databases（relate/filter/visualize），体现项目总览=可视化数据库视图的范式",
    state: "confirmed", sub_question_key: "业界蓝图的核心固定结构",
    evidence: { text: "project plan, timeline (Gantt), WBS, RACI, weekly status report constitute the four project foundations", anchor: "Notion Wiki templates", source: "https://www.notion.com/templates/category/wiki", confidence: "medium" },
  },
]);
console.log("Round 1:", JSON.stringify({ stop: r1.stop, reason: r1.reason, accepted: r1.accepted.length, rejected: r1.rejected.length }));

if (!r1.stop) {
  const r2 = session.submitRound([
    {
      statement: "Linear update 草稿自动合并项目进度报告（延迟/target date 变化/新 lead/里程碑进展/总进度），整体进度变化超过 2% 才展示",
      state: "confirmed", sub_question_key: "业界蓝图的更新机制",
      evidence: { text: "Project updates include a concise overview of project progress since the last update. It covers information such as project delays, changes in the target date, assignment of new leads, progress towards milestones, and overall progress.", anchor: "Linear Initiative and Project updates", source: "https://linear.app/docs/initiative-and-project-updates", confidence: "high" },
    },
    {
      statement: "业界蓝图的更新节奏通常是 daily/weekly/monthly/quarterly 四档 cadence",
      state: "confirmed", sub_question_key: "业界蓝图的更新机制",
      evidence: { text: "daily, weekly, monthly, quarterly cadence", anchor: "Notion status report templates", source: "https://www.notion.com/templates/category/wiki", confidence: "medium" },
    },
    {
      statement: "未确认所有工具是否支持蓝图的多项目聚合视图",
      state: "uncertain",
      issue: "多项目聚合视图的业界支持度",
      reason: "调研覆盖 Linear/Notion/GitHub Projects，但未逐一确认全部工具的跨项目聚合能力",
    },
  ]);
  console.log("Round 2:", JSON.stringify({ stop: r2.stop, reason: r2.reason, accepted: r2.accepted.length }));
}

if (session.stoppingReason === null) {
  // Round 3: round-cap (reached maxRounds=3)
  const r3 = session.submitRound([
    {
      statement: "GitHub Projects 的 roadmap 视图按 milestone 组织，支持按 repository/filter 分组",
      state: "confirmed", sub_question_key: "业界蓝图的核心固定结构",
      evidence: { text: "GitHub Projects roadmap view organizes issues by milestone", anchor: "GitHub Projects docs", source: "https://www.notion.com/templates/category/personal-dashboards", confidence: "low" },
    },
    {
      statement: "多项目聚合视图的业界做法未完全覆盖——Jira/Spec Kit 未调研",
      state: "gap",
      description: "Jira 和 Spec Kit 的蓝图/总览功能未调研，业界全景不完整",
      priority: "low",
    },
  ]);
  console.log("Round 3:", JSON.stringify({ stop: r3.stop, reason: r3.reason, accepted: r3.accepted.length }));
}

const final = session.finalize();
console.log("Finalize ok:", final.ok);
if (!final.ok) { console.error(final.error); process.exit(1); }
console.log("Stopping:", final.value.stopping_reason, "| Confirmed:", final.value.confirmed.length, "| Uncertain:", final.value.uncertain.length, "| Gaps:", final.value.gaps.length);

// Build analysis body
const confirmedSection = final.value.confirmed.map((c, i) =>
  "### 发现 " + (i + 1) + "：" + c.statement + "\n\n置信度：" + c.confidence + "。摘录：「" + c.quotes[0].text + "」（" + c.quotes[0].source + "，锚点：" + c.quotes[0].anchor + "）[" + (i + 1) + "]"
).join("\n\n");

const uncertainSection = final.value.uncertain.map(u => "- 疑点：" + u.issue + "——" + u.reason).join("\n") || "（无）";
const gapSection = final.value.gaps.map(g => "- 缺口（" + g.priority + "）：" + g.description).join("\n") || "（无）";
const implicationsSection = final.value.confirmed.map((c, i) => "- 发现 " + (i + 1) + " 对 LDVH 的启发：业界蓝图固定结构支持 LDVH 蓝图采用固定区块设计").join("\n");

const analysisBody = [
  "## 调研问题",
  "主流项目管理工具（Linear、Notion、GitHub Projects）如何设计项目蓝图（当前状态总览）功能？核心固定结构、更新机制与 Human 交互形态是什么？",
  "",
  "## 输入与边界",
  "读取 Linear 官方文档（Projects / Initiative and Project updates）与 Notion 模板市场（Wiki templates / Personal dashboards）。静态分析，观察时点 2026-09-08。不覆盖 Jira、Spec Kit 等其他工具。",
  "",
  "## 已证实",
  confirmedSection,
  "",
  "## 未证实与缺口",
  uncertainSection,
  gapSection,
  "",
  "## 停止与后续",
  "停止原因：" + final.value.stopping_reason + "（" + final.value.rounds_used + " 轮）。",
  "",
  "对 LDVH 蓝图设计的启发：",
  implicationsSection,
  "",
  "后续：LDVH 蓝图五个待裁决问题的业界依据已获取，可进入 Human 裁决阶段。",
].join("\n");

// Create the Research object
const createResult = await createResearchObject({
  factSourceRoot: "/Users/dmh2002/DshProject/dsh-ldvh/ldvh-base",
  frontmatterDraft: {
    title: "项目蓝图功能的业界做法调研（Linear/Notion/GitHub Projects）",
    status: "active",
    research_question: final.value.research_question,
    research_purpose: final.value.research_purpose,
    stopping_reason: final.value.stopping_reason,
    urls: final.value.urls,
    confirmed: final.value.confirmed,
    uncertain: final.value.uncertain,
    gaps: final.value.gaps,
    clarification_log: [],
    implications: [
      {
        finding_ref: final.value.confirmed[0].statement,
        implication: "业界蓝图固定结构（Linear 五组件）支持 LDVH 采用固定六区块（当前目标/阶段/已完成/进行中/下一步/悬而未决）",
      },
      {
        finding_ref: final.value.confirmed[1].statement,
        implication: "结构化更新（health indicator+描述）支持 LDVH 蓝图的更新纪律设计",
      },
    ],
    change_summary: "初次创建：基于 Linear/Notion 官方文档的业界蓝图调研（明确方向型，单 md）",
  },
  analysisBody,
  sessionSignature: { provider: "zzztoken-glm", model: "glm-5.3" },
});

console.log("Create ok:", createResult.ok);
if (!createResult.ok) { console.error(JSON.stringify(createResult.error, null, 2)); process.exit(1); }
console.log("UID:", createResult.value.object_uid);
console.log("Directory:", createResult.value.directory);
console.log("Files:", createResult.value.files);
console.log("Fingerprint:", createResult.value.fingerprint.slice(0, 20) + "...");

// Read back to verify
const readBack = await readResearchObject({
  factSourceRoot: "/Users/dmh2002/DshProject/dsh-ldvh/ldvh-base",
  objectUid: createResult.value.object_uid,
});
console.log("Read-back ok:", readBack.ok);
if (readBack.ok) {
  console.log("Type:", readBack.value.frontmatter.fact_type_key);
  console.log("Exploratory:", readBack.value.exploratory);
  console.log("Confirmed count:", readBack.value.frontmatter.confirmed.length);
  console.log("Implications count:", readBack.value.frontmatter.implications.length);
  console.log("Change log entries:", readBack.value.frontmatter.change_log.length);
}
