# 审计记录：08 §7.6 受保护文档映射的更正（2026-09-12）

> **性质**：**审计与更正过程记录（历史事实）**。原为 `specs/08-DSH环境接入与插件发布规范.md` §7.6 的一段落，依 Human 决定（2026-09-12）移出规范正文。
> **移出理由**：它是「记录原文写错、已于某日更正」的历史说明，不构成对读者的要求。规范正文只承载要求，状态与更正史移入 `docs/`（无规范效力）。

## 事由

`08 §7.6` 原登记的受保护文档映射中，「插件 AI 面向语义文本」一项的承载位置记为 **`systemPrompt.section` 与模板路由文本**。

## 核验发现

该全局注入通道**已被 Human 决定移除**（2026-09-03）。证据：`plugin/lib/guidance.js` 与 `plugin/lib/index.js` 的注释载明「the former global systemPrompt.section was removed by Human decision 2026-09-03」，现行唯一引导注入点为 `system-prompt/assemble` waterfall，段名为 `ldvh:minimal-guidance`（`plugin/lib/guidance-text.js:14`）。「模板路由」亦随行动模板退役而不再作为机制名（`2cb26b3` 前后）。

## 更正内容

`08 §7.6` 的该映射项改为「经 `system-prompt/assemble` 注入的 `ldvh:minimal-guidance` 段，文本源为 `plugin/lib/guidance-text.js`」。

## 更正的性质与边界

**只修正登记位置，不改变保护对象**——受保护文本仍是同一份「插件 AI 面向语义文本」，只是其承载位置登记改为实际存在的通道。受保护文件清单本身未变，故未触发 `00 §4.3` 的清单变更程序；该更正已由 Human 同意（2026-09-12）。

## 处置链

- `903aa30`：首次更正（当时在规范正文内附更正记录）
- 本次：将更正记录移出规范正文到本文件，规范正文只保留更正后的正确表述
