---
title: 自写类名扫描器未剥前缀致假阳性
status: draft
scope: 适用于一切以「类名/样式是否已定义」为判据的静态扫描场景（Tailwind 主题 token、变体前缀、复合类名）；本次观察材料因长度上限被截断，仅覆盖该六类阅读布局普查的所见部分，未覆盖其他 surface 是否存在同类误报。
object_uid: fdeff12d-de5a-4779-8f03-71bdb632c90d
fact_type_key: pitfall
created_at: 2026-10-19T17:20:55.538Z
change_log:
  - at: 2026-10-19T17:20:55.538Z
    provider: workbuddy
    model: space-bunny
    summary: 闲时辅助经验积累（机械通道）于 2026-10-19T17:20:27.426Z 形成候选
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

复制守卫后 `missing = []`、拼写形态异常 `ldh-* = []`；独立 Python 复刻同样 `TOTAL missing: []`，并识别出先前所报项实为 `tailwind.config.js:10-18` 的 `colors.ldvh.*` 主题 token。基线 `npm run test:web:api` 514 pass / 0 fail，说明该修正未引入回归。

## 影响与适用范围

适用于一切以「类名/样式是否已定义」为判据的静态扫描场景（Tailwind 主题 token、变体前缀、复合类名）；本次观察材料因长度上限被截断，仅覆盖该六类阅读布局普查的所见部分，未覆盖其他 surface 是否存在同类误报。
