# 事故记录：FACT_DIRECTORIES 沿用 v4 目录名导致管辖项目永远「未就绪」

> 性质：开发备忘（故障与教训），非规范、非事实对象。
> 发现：2026-09-08，Human 在 DSH 插件设置卡（管辖项目配置）查看 dsh-ldvh 状态时发现——红点 +「未就绪：missing fact directories: studies」。

## 现象

设置卡显示 dsh-ldvh「未就绪」，错误信息为 `missing fact directories: studies`，而磁盘上 `ldvh-base/` 实际内容为：

```
sparks / workcases / adrs / pitfalls / researches
```

五目录齐全（按 v5 类型系统），但就绪检查仍在找 v4 的 `studies/`——永远找不到，红点永不消除。

## 事实经过

1. v5 架构定案（2026-09-07/08，commit c538ba6+41cccb4）：撤销 Investigation、Study 更名 **Research**，24 号规范落地，`research-writer.js` 的事实对象写入 `ldvh-base/researches/`——目录已在磁盘上。
2. 但 `plugin/lib/governed-projects.js:12` 的常量未随架构定案更新：

   ```js
   const FACT_DIRECTORIES = ["sparks", "workcases", "adrs", "pitfalls", "studies"];
   ```

3. `inspectCandidate` 用该常量做就绪检查（governed-projects.js:124-128）：逐目录 lstat，缺 `studies` 即报 incomplete → 设置卡红点。
4. 测试文件 `plugin/test/governed-projects.test.mjs:30` **硬编码了同一个 v4 值**并在用例中断言 `studies`（:81-103）——测试与实现同步过时，所以 362/362 全绿没有暴露问题。

## 为什么「更新」按钮会把问题修得更错

设置卡的「更新」按钮跑幂等安装事务 `installProject`（client.js:425），其中 `initializeFactSource`（governed-projects.js:269-271）会按 `FACT_DIRECTORIES` **创建缺失目录**。点「更新」的结果是：

- 磁盘上多出一个 v5 架构下**不存在**的 `studies/` 空目录；
- 红点消除、状态变绿——**规范-实现偏差被固化为磁盘状态**，还制造了一个将来要清理的孤儿目录。

即：修复动作本身在按过时常量制造新偏差。

## 根因

这不是简单的「忘改一行」。它是**架构定案与机械常量之间缺一条同步链**的实例：

- 类型更名（Study→Research）走了完整质量链：规范候选 → 对抗审核 → Human 终审 → 受控提交（c538ba6）+ 落盘器实现（research-writer.js）+ 对象落盘（researches/）；
- 但 `FACT_DIRECTORIES` 是散落在管辖安装层的**独立副本**，没有任何规范条目或提交检查要求它跟随类型定案更新——两处事实（类型名、目录名）各改各的，漏了一处。

与 p0-incident-tool-render-contract 同型：**契约副本散落多处时，一处演进其余静默过时**。

## 修复（本次）

最小对齐：`studies` → `researches`（两处：lib 常量 + 测试硬编码），与磁盘现状及 24 号规范一致。`initiatives` / goal 等未落地类型**不预建目录**——等 25/26 号规范定稿、落盘器存在时再扩 FACT_DIRECTORIES（wc-56 教训：不为未实现的类型预建机械）。

## 教训（可吸收项）

类型定案的连带清单里应包含「目录名/常量副本」的盘点：架构更名时 grep 全库旧名（本次 grep `studies` 即可发现两处）。此教训适用于后续 initiatives/goal 落地批次。
