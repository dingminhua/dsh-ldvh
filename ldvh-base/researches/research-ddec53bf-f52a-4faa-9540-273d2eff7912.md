---
title: 2026-09 DSH 社区深度研究编排器现状刷新（open-deep-research 新编排器/源调用纪律/合成纪律；dsh-research 市场新形态）
status: active
research_question: 2026-09 时点 DSH 社区深度研究编排器现状（dsh-open-deep-research/dsh-research 等相对 v4 调研的 deep-research/socrates/industry-research 三件的新项目与新形态）——有哪些新项目、各自机制、对 LDVH 调研系统（specs/11）是否有新参考
research_purpose: 刷新 v4 调研三项目（deep-research/socrates/industry-research）之后 2026-09 社区深度研究编排器现状，确认是否有新项目/大版本改变结论，为 specs/11 调研系统提供最新外部依据
stopping_reason: sufficient
confirmed_statements:
  - F1 open-deep-research 新编排器
  - F2 多研究单元规划
  - F3 源调用纪律
  - F4 合成纪律
  - F5 dsh-research 市场新形态
uncertain: []
gaps:
  - description: open-deep-research 基于旧基线 0.1.0-rc.8，在 0.1.2-rc.1 下运行效果未实测
    priority: low
implications:
  - finding_ref: F1 open-deep-research 新编排器
    implication: 2026-09 社区出现新深度研究编排器，v4 三项目不是唯一路线
  - finding_ref: F2 多研究单元规划
    implication: 多研究单元拆分与合并是规划阶段可借鉴机制
  - finding_ref: F3 源调用纪律
    implication: 源调用次数上限与 URL 复制纪律比 v4 更细
  - finding_ref: F4 合成纪律
    implication: 分类性结论标注 observed sample 与防自欺同构
  - finding_ref: F5 dsh-research 市场新形态
    implication: 研究插件市场是编排器之外的生态形态
urls:
  - ref: https://github.com/songyang0603/dsh-open-deep-research/blob/main/README.md
    summary: open-deep-research 定位：深度研究 agent + TS 框架，三入口
    title: dsh-open-deep-research README
  - ref: https://github.com/songyang0603/dsh-open-deep-research/blob/main/src/prompt.ts
    summary: open-deep-research 规划/源调用/合成纪律提示词
    title: dsh-open-deep-research prompt.ts
  - ref: https://github.com/literaf/dsh-research/blob/main/README.md
    summary: dsh-research 研究插件市场：定位与四重护栏
    title: dsh-research README
object_uid: ddec53bf-f52a-4faa-9540-273d2eff7912
fact_type_key: research
created_at: 2026-09-08T22:34:09.014Z
change_log:
  - at: 2026-09-08T22:34:09.014Z
    provider: trae
    model: DeepSeek-V4-Flash-Official
    summary: 受控创建 Research 对象（补缺清单6：2026-09 DSH 社区深度研究编排器现状刷新；open-deep-research 新编排器+源调用纪律+合成纪律、dsh-research 市场新形态；5 confirmed + 1 low gap，sufficient 收敛）
---

## 研究问题

2026-09 时点 DSH 社区深度研究编排器现状（dsh-open-deep-research/dsh-research 等相对 v4 调研的 deep-research/socrates/industry-research 三件的新项目与新形态）——有哪些新项目、各自机制、对 LDVH 调研系统（specs/11）是否有新参考

本调研刷新 v4 调研三项目（deep-research/socrates/industry-research）之后 2026-09 社区深度研究编排器现状，确认是否有新项目/大版本改变结论，为 specs/11 调研系统提供最新外部依据。方法：web_search 发现 + clone 取证 dsh-open-deep-research 与 dsh-research。

## 输入与边界

输入：dsh-open-deep-research 0.1.0-alpha.5（songyang0603，本机 clone，README + src/prompt.ts）；dsh-research（literaf，本机 clone，README）；对照 v4 三项目（deep-research 0.1.0/socrates 0.1.0/industry-research 0.3.5，清单1/2 已核对）。

边界：本调研聚焦 2026-09 新出现的深度研究编排器项目与新形态；不重新调研 v4 三项目（清单1/2 已核对版本无行为变化）；不实测 open-deep-research 运行效果（旧基线）。

对照框架：v4 三项目为基线，识别新项目、新机制、新形态。

## 关键发现

### F1 open-deep-research 新编排器

dsh-open-deep-research 0.1.0-alpha.5 是 2026-09 新出现的深度研究编排器（接受问题→带引用链接 Markdown 报告，CLI/DSH Tool/程序化 API 三入口，未发布 npm 仅 GitHub Releases）。

溯源：https://github.com/songyang0603/dsh-open-deep-research/blob/main/README.md（定位）

### F2 多研究单元规划

open-deep-research 规划阶段：brief→多研究单元（units）拆分，单元必须互不重复且覆盖所有请求维度——与 v4 deep-research 的 scope/dimensions 同构但强调单元合并。

溯源：https://github.com/songyang0603/dsh-open-deep-research/blob/main/src/prompt.ts（规划）

### F3 源调用纪律

open-deep-research 源调用纪律：≤4 次源调用（第五次恢复例外）+ URL 从工具结果复制不猜测 + 页面身份核对（mismatch 丢弃记 limitation）——比 v4 deep-research 更细的溯源纪律。

溯源：https://github.com/songyang0603/dsh-open-deep-research/blob/main/src/prompt.ts（源调用）

### F4 合成纪律

open-deep-research 合成纪律：保留不确定性/限制、不超证据强度陈述、分类性结论标注为 observed sample 分析、源支持事实与分析分离——与 LDVH 防自欺同构。

溯源：https://github.com/songyang0603/dsh-open-deep-research/blob/main/src/prompt.ts（合成）

### F5 dsh-research 市场新形态

dsh-research 不是编排器而是研究插件市场（Settings 侧栏精选研究插件页 + 安装按钮 + allowlist/same-origin/one-at-a-time 四重护栏）——新形态。

溯源：https://github.com/literaf/dsh-research/blob/main/README.md（定位）

## 未证实与缺口

未证实：（无——本轮五项已证实，sufficient 收敛）

缺口：
- open-deep-research 基于旧基线 0.1.0-rc.8，在 0.1.2-rc.1 下运行效果未实测（GA1, low）。

## 建议

A1 源调用纪律补入 specs/11：≤N 次源调用上限（当前 specs/11 无源调用次数约束）+ URL 从工具结果复制不猜测 + 页面身份核对（mismatch 丢弃记 limitation）；验收条件：specs/11 有源调用纪律条目。判断依据：F3。可被调研系统承接。
A2 分类性结论标注补入 specs/11 交付合同：market-gap/成熟度/优越性等分类性结论必须标注为 observed sample 分析而非事实；验收条件：specs/11 交付合同有分类性结论标注要求。判断依据：F4。可被调研系统交付合同承接。
A3 研究插件市场形态参考：LDVH 调研系统如需对外提供插件生态，dsh-research 的 allowlist/same-origin/one-at-a-time 四重护栏可参考；验收条件：插件市场设计有安装护栏。判断依据：F5。可被 08 接入承接。

## 后续分流

- A1/A2 → specs/11；信号：调研系统修订时。
- A3 → 08 接入；信号：插件生态设计时。
- 本对象与清单1（research-e9949813）、清单2（research-1e54b069）互补：清单1/2 核对 v4 三项目承接，本对象刷新 2026-09 新项目。
- 监测条件：open-deep-research 转正式版或发布 npm、或社区出现新编排器时需更新。
