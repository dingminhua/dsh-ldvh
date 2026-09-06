/**
 * Rebuild the blueprint research per the v4-form spec (commit 77a562b):
 * thin frontmatter index + v4-style research body (findings with
 * observation + judgment + trace anchors; recommendations with
 * acceptance criteria; routing with signals).
 */
import { createResearchObject, readResearchObject, updateResearchObject } from "../../lib/research-writer.js";

const ROOT = "/Users/dmh2002/DshProject/dsh-ldvh/ldvh-base";
const PREV_UID = "75547e46-77fb-45ad-98d7-341bf4f864b8";

const LINEAR = "https://linear.app/docs/initiative-and-project-updates";
const GH_ABOUT = "https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects";
const GH_ROADMAP = "https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout";
const GH_UPDATES = "https://docs.github.com/en/issues/planning-and-tracking-with-projects/sharing-project-updates";
const JIRA = "https://www.atlassian.com/software/jira/guides/advanced-roadmaps/overview";

const urls = [
  { ref: LINEAR, title: "Initiative and Project updates – Linear Docs", summary: "Linear update 的固定结构、三档健康状态、提醒、2% 阈值进度报告、Write with Agent、Slack 分发" },
  { ref: GH_ABOUT, title: "About Projects - GitHub Docs", summary: "GitHub Projects 布局、数据自动同步、内置工作流" },
  { ref: GH_ROADMAP, title: "Customizing the roadmap layout - GitHub Docs", summary: "roadmap 布局的时间线定位" },
  { ref: GH_UPDATES, title: "Sharing project updates - GitHub Docs", summary: "status update 结构、侧栏位置、默认沿用上一条" },
  { ref: JIRA, title: "Introduction to Jira Advanced Planning | Atlassian", summary: "Jira Plans 的 Summary 视图、Initiative 层级、沙箱+Review changes、Program Board" },
];

const analysisBody = `## 研究问题
LDVH 蓝图的六区块设计（当前目标/当前阶段/已完成/进行中/下一步/悬而未决）在业界有无先例？主流工具的固定结构、更新机制与人机交互形态对 LDVH 蓝图有什么可吸收的模式？

## 输入与边界
读取三个产品的官方文档（Linear Initiative and Project updates 一页、GitHub About Projects/roadmap layout/sharing updates 三页、Atlassian Jira Advanced Planning 一页），经 read_page 桥逐字抓取，观察时点 2026-09-08。分析视角：LDVH 蓝图是项目级活文档、AI 主导维护、Human 随时查看——与业界工具的 Human owner+团队协作用途有本质差异。不覆盖 Notion/Airtable（无实际抓取来源）与 Linear Initiatives 独立页。

## 关键发现

### F1 三家共识：健康指示灯 + 自由文本，无一家做枚举式区块

Linear 的 update 固定为「一个健康指示灯（On track/At risk/Off track 三档枚举）+ 一段富文本描述（status/challenges/next steps 由人自由写）」；GitHub 的 status update 固定为「状态枚举 + 开始日期 + 目标日期 + Markdown 消息」；Jira Plans 的 Summary 视图是跨团队进度快照。三家的"机器管枚举、人类管叙述"分工完全一致——没有任何一家把已完成/进行中/下一步做成枚举式固定区块，这些内容全部由自由文本承载。

**对 LDVH 的价值**：这是对六区块蓝图最重要的负结果——业界无先例不是业界没想到，而是业界判断"区块枚举的维护成本高于自由文本的读取成本"。LDVH 的六区块设计需要正面回答"为什么 AI 维护能翻转这个成本判断"，否则将重蹈"结构比内容先死"的覆辙。G-SC 锚点（见蓝图设计）部分回答了这个问题：锚点使区块内容有机械来源而非手写。

溯源：https://linear.app/docs/initiative-and-project-updates（Overview 与 Create Initiative and Project updates 章节）

### F2 更新机制呈三级成熟度光谱：自动同步 → agent 起草 → 人工闸门

GitHub 是全自动端：数据随 issue/PR 变更自动双向同步进项目（视图与图表无需手动更新），内置工作流可在条目变更时自动设字段。Linear 是半自动端：周期性提醒督促 owner 发布 update、自动生成进度报告且变化超 2% 才显示细节、提供 Write with Agent（agent 审查变更与 Slack 消息起草草稿供人细化）。Jira 是人工闸门端：Plans 以沙箱方式工作，所有改动停留在 plan 内直到用户主动 Review changes 提交。

**对 LDVH 的价值**：三级光谱对应三种维护责任分配——GitHub 把维护交给数据源、Linear 把起草交给 agent 把裁决交给人、Jira 把全部交给计划者。LDVH 蓝图（AI 维护+Human 验收）天然落在 Linear 与 GitHub 之间：区块的投影部分（已完成/进行中）应学 GitHub 从事实源机械投影，authored 部分（下一步/悬而未决）应学 Linear 由 AI 起草经 Human 验收。Jira 的沙箱模式对应 LDVH 已有的 CAS 受控更新——先例成立。

溯源：https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects（Staying up-to-date 与 Automating your projects 章节）

### F3 交互共识：最新置顶 + 历史可溯 + 降低重复填报

Linear 最新一条 update 展示在概览页、历史通过 Updates 标签页按时间顺序查看，update 可推送到 Slack 频道并支持 emoji 反应。GitHub 的 status update 位于项目侧栏（最新在最上方、历史在其下依次排列），且新建表单默认沿用上一条的状态与日期以降低重复填报。变更记录（target date、成员、里程碑变化）与 update 按时间顺序同列。

**对 LDVH 的价值**：最新置顶+历史可溯对 LDVH 蓝图直接适用——蓝图是单页活文档（永远是"最新"），历史由 Git commit 与 change_log 承载，不需要业界那种独立的历史 tab。"默认沿用上一条"的模式可用于 AI 起草蓝图更新时减少 diff 噪声——只改变化的区块。

溯源：https://docs.github.com/en/issues/planning-and-tracking-with-projects/sharing-project-updates（About status updates 与 Adding new status updates 章节）

## 未证实与缺口
- 缺口（medium）：业界无六区块先例意味着无外部参照验证其可维护性——LDVH 上线后需在第一个真实 feature 周期里观察区块更新频率与腐烂速度
- 缺口（medium）：Linear Initiatives 独立文档页与 Jira 单项目 roadmap 页未抓取正文
- 缺口（low）：Notion/Airtable 项目 dashboard 模板无实际抓取来源

## 建议
A1 蓝图区块采用混合维护模式：已完成/进行中区块从事实源机械投影（学 GitHub 自动同步），下一步/悬而未决区块由 AI 起草经 Human 验收（学 Linear Write with Agent 分工）。可被蓝图实现 WorkCase 直接承接——验收条件：投影区块零手写、authored 区块每次更新有 change_log。判断依据：F2 光谱显示这是成熟度最优组合。
A2 六区块设计需内置防腐机制再上线：为每个区块定义"数据来源"（哪个事实源字段投影）与"腐烂信号"（多久未更新触发复核）。可被蓝图功能候选稿承接。判断依据：F1 显示业界不做区块枚举的原因是维护成本，LDVH 必须用机械来源正面化解。
A3 更新触发采用变化阈值+定期双通道：事实源变更超阈值（如 3 个对象变化）触发即时更新，无变更时按周期（如每 feature 完成）兜底刷新。判断依据：F2 中 Linear 的 2% 阈值证明阈值可防噪声，LDVH 场景需重定义阈值语义。

## 后续分流
- A1/A3 → 蓝图实现 WorkCase 的设计输入；信号：蓝图 §5 五个待裁决问题经 Human 裁决后进入实现阶段时。
- A2 → 蓝图功能候选稿（docs/blueprint-feature-draft.md）修订时吸收；信号：该文档下次受控更新时。
- 无需为"业界调研结论"本身创建新对象——本 Research 即承载；监测条件：若上线后区块腐烂速度超预期，回本对象 F1 的负结果重新评估。`;

const result = await createResearchObject({
  factSourceRoot: ROOT,
  frontmatterDraft: {
    title: "项目蓝图功能的业界做法调研（Linear/GitHub Projects/Jira Plans）",
    status: "active",
    research_question: "LDVH 蓝图的六区块设计在业界有无先例？主流工具的固定结构、更新机制与人机交互对 LDVH 有什么可吸收模式？",
    research_purpose: "为 LDVH 蓝图功能五个待裁决问题提供业界先例依据",
    stopping_reason: "sufficient",
    urls,
    confirmed_statements: [
      "F1 三家共识：健康指示灯 + 自由文本，无一家做枚举式区块",
      "F2 更新机制呈三级成熟度光谱：自动同步 → agent 起草 → 人工闸门",
      "F3 交互共识：最新置顶 + 历史可溯 + 降低重复填报",
    ],
    uncertain: [],
    gaps: [
      { description: "业界无六区块先例意味着无外部参照验证其可维护性——上线后需观察区块更新频率与腐烂速度", priority: "medium" },
      { description: "Linear Initiatives 独立文档页与 Jira 单项目 roadmap 页未抓取正文", priority: "medium" },
      { description: "Notion/Airtable 项目 dashboard 模板无实际抓取来源", priority: "low" },
    ],
    implications: [
      { finding_ref: "F1 三家共识：健康指示灯 + 自由文本，无一家做枚举式区块", implication: "六区块是 LDVH 原创，需正面回答维护成本问题——G-SC 锚点+机械来源是回答路径" },
      { finding_ref: "F2 更新机制呈三级成熟度光谱：自动同步 → agent 起草 → 人工闸门", implication: "蓝图采用混合模式：投影区块学 GitHub 机械同步，authored 区块学 Linear agent 起草" },
      { finding_ref: "F3 交互共识：最新置顶 + 历史可溯 + 降低重复填报", implication: "蓝图单页活文档+Git 历史承载，AI 起草时只 diff 变化区块" },
    ],
  },
  analysisBody,
  sessionSignature: { provider: "zzztoken-glm", model: "glm-5.3" },
});

if (!result.ok) {
  console.error(JSON.stringify(result.error, null, 2));
  process.exit(1);
}
console.log("New object:", result.value.object_uid);

const readBack = await readResearchObject({ factSourceRoot: ROOT, objectUid: result.value.object_uid });
console.log("Read-back ok:", readBack.ok, "| body_valid:", readBack.ok && readBack.value.body_valid);

// Retire previous attempts
for (const uid of [PREV_UID]) {
  const prev = await readResearchObject({ factSourceRoot: ROOT, objectUid: uid });
  if (prev.ok && prev.value.frontmatter.status === "active") {
    const retired = await updateResearchObject({
      factSourceRoot: ROOT,
      objectUid: uid,
      expectedFingerprint: prev.value.fingerprint,
      frontmatterAfter: { ...prev.value.frontmatter, status: "retired" },
      analysisBodyAfter: prev.value.body,
      changeSummary: "retire：载体形态已迭代（规范 77a562b 回到 v4 研究形态）——由 v4 形态新对象替代",
      sessionSignature: { provider: "zzztoken-glm", model: "glm-5.3" },
    });
    console.log("Retired", uid.slice(0, 8) + ":", retired.ok);
  }
}
