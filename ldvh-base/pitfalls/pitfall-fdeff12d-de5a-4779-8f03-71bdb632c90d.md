---
title: 自写类名扫描器未剥前缀致假阳性
status: active
scope: 适用于一切以「类名/样式是否已定义」为判据的静态扫描场景（Tailwind 主题 token、变体前缀、复合类名）；本次观察材料因长度上限被截断，仅覆盖该六类阅读布局普查的所见部分，未覆盖其他 surface 是否存在同类误报。
object_uid: fdeff12d-de5a-4779-8f03-71bdb632c90d
fact_type_key: pitfall
created_at: 2026-10-19T17:20:55.538Z
change_log:
  - at: 2026-10-19T17:20:55.538Z
    provider: workbuddy
    model: space-bunny
    summary: 闲时辅助经验积累（机械通道）于 2026-10-19T17:20:27.426Z 形成候选
  - at: 2026-10-27T18:23:10.893Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 独立复现验证通过（隔离子代理 6ce22439，不同模型/独立上下文）：朴素判据重扫复现 41 条假阳性、既有守卫 29 项通过、独立 Python 复刻交叉复核 missing 为空；并注明 test:web:api 基线已由 514 增长为 551。据 Human 2026-10-28「验证属实即入档」逐条验收指示，draft→active 入档。
  - at: 2026-10-27T18:40:02.027Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: 机械化承载盘点登记（2026-10-28）：workcase-design-language-contract.test.ts:63 的类名守卫；状态与 scope 不变（23 §9.3 补充级更新）。
---

# 自写类名扫描器未剥前缀致假阳性

## 症状

自写扫描脚本报告核心 `ldvh-*` 主题类名「未定义」，例如 `focus-visible:ring-ldvh-accent` 等被判为引用了不存在的类；若据此结论，六类阅读布局会被误判为大面积样式断裂。

## 触发条件

不复用既有守卫判据、而是自行拼装类名扫描器时：判据未区分 Tailwind 变体前缀（`focus-visible:` 等）与主题色 token 的配置来源（`tailwind.config.js` 的 `colors.ldvh.*`），于是把「token 定义」当成「字面类名定义」去找。

## 根因

判据层缺少「类名到设计 token」的映射规则：把 token 化颜色/间距的最终类名形态当作普通 CSS 字面量做存在性匹配，前缀剥离与 token 解析两步都缺位，因此凡带变体前缀的 token 类名一律报缺失。

## 解决

不修正自写扫描器，改为逐字复制既有判据（`workcase-design-language-contract.test.ts:63` 的类名守卫），只替换 surface 列表；再用一份独立的 Python 复刻（含 WorkCase 5 面）作交叉复核。

## 规避

凡涉及「引用了未定义类名」这类形态判据，不自行重写扫描逻辑，一律取既有守卫原文再换被检面；跨面复核用第二种独立实现，避免同一判据自证。

## 验证

复制守卫后 `missing = []`、拼写形态异常 `ldh-* = []`；独立 Python 复刻同样 `TOTAL missing: []`，并识别出先前所报项实为 `tailwind.config.js:10-18` 的 `colors.ldvh.*` 主题 token。基线 `npm run test:web:api` 514 pass / 0 fail，说明该修正未引入回归；该基线现为 551 项（套件已增长，514 是当时值）。

独立复现验证（2026-10-28，入档前置）：复现主体为隔离子代理（独立上下文 session 6ce22439-6bdc-48a9-837b-35cf4be92d8b，未参与本候选形成）；独立性边界为不同模型（本次路由 dsh-opencode-go/deepseek-v4.1-flash，形成者记录为 space-bunny / provider workbuddy）、上下文隔离、非形成主体。复现做法与观察结果：按「不剥前缀、只查字面类名」的朴素判据重扫 WorkCase 五面，得 41 条 / 28 个不同 token 的「未定义」假阳性，含 `focus-visible:ring-ldvh-accent`；实跑既有守卫 `tests/api/workcase-design-language-contract.test.ts`（29 项通过），再以独立 Python 复刻（剥变体/工具前缀 + 解析 `colors.ldvh.*`）交叉复核，两路 `missing` 均为空，所报项确为 `tailwind.config.js:10-18` 的主题色 token；`npm run test:web:api` 现为 551 项全通过。复现未覆盖：既有守卫对带变体前缀的类（`focus-visible:*`）是整类跳过而非解析，故 `missing=[]` 不证明这些类已定义；原自写扫描器原文与六面普查材料不可复得；514 基线不可复现（套件已增长）。


**机械化承载（2026-10-28 盘点）**：`plugin/web/tests/api/workcase-design-language-contract.test.ts:63` 的类名守卫已把本条的规避实现为机械判据：它按 `TAILWIND_UTILITY_PREFIXES` 剥工具前缀与不透明度修饰符后比对 `index.css` 的定义集，在 WorkCase 五个呈现面上断言 `missing = []`（注入一个不存在的 `ldvh-*` 类即转红）。覆盖边界：只覆盖 WorkCase 五个面——六类阅读布局所在的 `FactReadingLayouts.tsx` 不在名单内（在其中注入不存在的 `ldvh-*` 类仍全绿）；带变体前缀的类（`focus-visible:*` 等）是整类跳过而非解析，故 `missing = []` 不证明这些类已定义。

## 影响与适用范围

适用于一切以「类名/样式是否已定义」为判据的静态扫描场景（Tailwind 主题 token、变体前缀、复合类名）；本次观察材料因长度上限被截断，仅覆盖该六类阅读布局普查的所见部分，未覆盖其他 surface 是否存在同类误报。
