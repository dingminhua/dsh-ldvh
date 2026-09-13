# docs/ 清理对照表（逐份「可删 / 应留」）

> **性质**：清理决策输入（**只读产出，未执行任何删除或移动**）。供 Human 逐项勾选后执行。
> **目的**：Human 2026-09-13 目标——「把 docs 里需要推进的工作都转入 spark，之后 docs 目录要进行大量的清理」。本表回答：**转入已完成（24 条 Spark），现在哪些可以清、哪些必须留、凭什么。**
> **基准**：`dev` 分支工作树，2026-09-13；docs/ 根 86 份 + `archive/` 34 份 + `audit/` 8 份 + 本表 1 份 = 129 份。
> **纪律**：本表**不执行**删除（`docs-cleanup-assessment.md`：删除也是机制变更，须说明收益与风险）。跟踪状态：**86 份根目录文档全部已被 git 跟踪**（`docs-to-spark-census.md` 未跟踪）——删除均可 `git log` 回溯。
> **基准后更正（2026-09-14 补记）**：本表为 2026-09-13 早间的决策输入快照；其后方案 A＋B 共 15 份已按本表 E 类归档（根 86 → 73，`archive/` 34 → 49，见 `docs/archive/README.md` §〇／§〇之一），且 `docs-to-spark-census.md` **已随普查提交入库（不再未跟踪，G 类失效）**。本批（2026-09-14）另归档 3 份（`spec-candidate-30-goal-decomposition.md`、`HANDOVER-04-business-system-foundation.md`、`ci-plugin-job-node-version-investigation.md`），根 .md 现 76、`archive/` 现 52（见 archive README §〇之二）。下表各分类仍按原基准陈述，归档明细以 archive README 为最新权威。

---

## 0. 速览

| 分类 | 份数 | 建议 | 理由 |
|---|---|---|---|
| **A · 效力证据**（`review-*`） | 43 | 🛑 **保留** | `01 §12` 规范效力溯源的证据 |
| **B · 唯一记录**（P0/事故） | 5 | 🛑 **保留** | 事故与复现步骤是唯一记录 |
| **C · 决定与执行溯源** | 8 | 🛑 **保留** | 含 Human 决定编号、变更依据 |
| **D · Spark 唯一来源** | 12 | ⚠️ **保留（建议）** | 已转入 Spark，但本表登记为可归档候选 |
| **E · 已被取代/已闭合** | 15 | ✅ **可归档** | 目标已建成或口径已被取代 |
| **F · 本表与普查** | 2 | 🛑 **保留** | 清理决策自身依据 |
| **G · 未跟踪** | 1 | ⚠️ **先 git add** | 删则真丢失 |

**保守结论**：真正**建议归档**的仅 **E 类 15 份**；其余 71 份建议保留。这与 `docs-cleanup-assessment.md` 的「分层处置、先归档后清理」一致。

---

## A · 效力证据 —— 🛑 保留（43 份）

`review-*` 独立对抗审核报告。是 `01 §12`（规范独立对抗审核）的**效力溯源证据**：规范「经过审核」这一事实由这些报告承载。删除会削弱规范效力溯源。

| 子类 | 份数 | 例 |
|---|---|---|
| 十维独立对抗审核（10d 系列） | 11 | `review-10d-00` … `review-10d-10` |
| 累积轮次审核 | 6 | `review-round2` … `review-round6`、`review-round2-fixes` |
| 跨规范一致性审核 | 12 | `review-00-01-mutual-consistency`、`review-03-vs-00-01` 等 |
| 单提交复审 | 6 | `review-2379c8c`、`review-25871e1`、`review-7d5ba4c` 等 |
| action-visibility 系列 | 4 | `review-brief-*`、`review-report-*` ×3 |
| 汇总/其它 | 4 | `review-upper-chain-summary`、`review-21-workcase`、`review-27-norm` |

**注**：action-visibility 4 份虽属「未应用的候选审核」，但正是它们记录了 R1–R6 未处置的状态，是 Spark「行动可见性候选停摆」的证据，**一并保留**。

---

## B · 唯一记录（P0/事故） —— 🛑 保留（5 份）

| 文件 | 行 | 理由 |
|---|---|---|
| `p0-incident-cli-sideeffect.md` | 42 | 库模块 CLI 副作用致插件装载崩溃——故障与复现步骤唯一记录 |
| `p0-incident-tool-render-contract.md` | 88 | 工具渲染契约事故——同上 |
| `p0-restart-verification.md` | 122 | 重启验证实测留档 |
| `p0-spec-inconsistency-note.md` | 27 | 规范不一致条目（自述「待 Human 决定后删除或转入正式记录」——**该决定未做**） |
| `incident-fact-directories-v4-legacy.md` | 52 | 事实目录 v4 遗留事故 |

**理由**（`00 §1` 痛点 4「历史经验无法积累」正指此类）：过期 ≠ 无用；事故记录是历史事实依据。

---

## C · 决定与执行溯源 —— 🛑 保留（8 份）

| 文件 | 行 | 保留理由 |
|---|---|---|
| `dev-memo.md` | 257 | **决策 #1–#32 编号 + §5 待定项 1–32**——决定溯源主档；#11 已建 Spark |
| `pending-human-decisions-2026-09-11.md` | 248 | 待 Human 决定清单（批 5 / 批 2.5）——**决定尚未做完** |
| `action-plan-2026-09-10.md` | 120 | 执行计划；阶段 3–6 **未标完成** |
| `spec-sync-plan-2026-09-11.md` | 186 | 执行批次 1–7；**批 7 未执行**（已建 Spark） |
| `spec-sync-batch1-log.md` | 205 | 批 1/2/3/6 执行记录（含「流程失败」如实记录） |
| `00-audit.md` | 186 | 审计入口与提交链（新会话续接指引的入口） |
| `00-ch3-5-review-disposition-2026-09-11.md` | 84 | 审核处置记录 |
| `governed-project-lifecycle-verification.md` | 38 | 生命周期验证记录（macOS 10 项实测）——已建 Spark |

**注**：`00-audit.md` 被 `dev-memo.md` 列为「新会话续接指引 ③」，属**入口文档**，删之会断链。

---

## D · Spark 唯一来源 —— ⚠️ 保留（建议）（12 份）

这些文档的内容**已转入 Spark**，本身可作为归档候选。但**建议保留**，理由：Spark 的 `summary` 是**语义快照**，原文含 Spark 不承载的细节（完整推导、行业对照、字段清单）；`20 §6.4` 要求结晶物提取到各自窄容器，而**提取尚未发生**（Spark 全部 `open`）。

| 文件 | 行 | 对应 Spark | 备注 |
|---|---|---|---|
| `technical-framework-mnemon-base.md` | 232 | `e173488d`、`56a5ed45` | 含实施批次、新类型候选 |
| `architecture-dialogue-2026-09-03-mnemon-base.md` | 95 | `e173488d` | 含 §6 四项待拍板 |
| `dsh-plugin-binding-plan.md` | 471 | `af3f5fd7` | 候选，待审核与确认 |
| `ldvh-plugin-implementation-plan.md` | 167 | `af3f5fd7` | 方案已定待实施 |
| `investigation-report-dsh-subagent-default-model.md` | 768 | `af3f5fd7` | §10 有剩余开放项 |
| `memory-system-design-prompt.md` | 308 | `b8cd2268` | 设计全文（Spark 自述「不承载设计全文」） |
| `spark-workcase-rebuild.md` | 497 | `3acec019` | **自述「唯一讨论锚点」** |
| `HANDOVER-04-business-system-foundation.md` | 199 | `ed934616` | 移交任务说明（接手者需读全文） |
| `fact-norm-design-consolidated.md` | 635 | `351a0b17`、`89df677f`、`6f5adc82` | 汇总文档，含 §0 十三项结论表 |
| `blueprint-feature-draft.md` | 113 | `5862b615` | 含 Human 原话与需求 |
| `blueprint-web-presentation-discussion.md` | 75 | `5862b615` | 含 D1/D5 待决细节 |
| `spec-candidate-30-goal-decomposition.md` | 178 | `2916e3d5` | ~~30 号段未建立，是有效输入~~ —— **前提已失效，2026-09-14 归档**（30 号已建成 `specs/30-调研系统规范.md`；行动模板退役） |

**关键**：`spark-workcase-rebuild.md` 自述是 20/21/25 重建的**唯一讨论锚点**（Human 指令），**强烈建议保留**。

---

## E · 已被取代 / 已闭合 —— ✅ 可归档（15 份）

**判据**：目标规范已建成、或口径已被正式规范取代、或结论已闭合，且**其内容已由 specs/ 或既有文档完整承载**。

| 文件 | 行 | 取代者 / 闭合依据 |
|---|---|---|
| `v4-v5-spec-migration-matrix.md` | 118 | **Human 裁定 2026-09-13：不存在迁移了**；ADR `1aad60bc` v4 存量零迁移 |
| `v4-web-migration-survey.md` | 297 | Web 已迁入插件（`plugin/web/` 已存在） |
| `trae-memory-analysis.md` | 88 | 已由 `b8cd2268` 的「调研依据链」承载 |
| `workbuddy-memory-analysis.md` | 79 | 同上 |
| `concept-systems-and-institutions-2026-09-11.md` | 631 | §12.5 已终局裁定「六系统，无缺口」，已由 Spark `2916e3d5` 覆盖 |
| `business-systems-overview.md` | 162 | 00 §3.1 已定六系统（其自述「00 §3.1 仍是唯一权威」） |
| `deliberation-input-restructure-2026-09-10.md` | 128 | 已定项 A/B 已落；已由 `dbffddd2` 覆盖 |
| `restructure-decision-list-2026-09-10.md` | 149 | 已由 `dbffddd2`、`64754323` 覆盖 |
| `read-dimension-understanding.md` | 148 | 已由 `47396b7f`、`64ae68ac` 覆盖 |
| `execution-usage-mapping-draft.md` | 156 | 已由 `a1209317` 覆盖 |
| `deliberation-usage-mapping-draft.md` | 98 | 已由 `a1209317` 覆盖 |
| `team-control-foundation-draft.md` | 204 | 底座 v5 原则层已 Human 终审；已由 `a1209317` 覆盖 |
| `analysis-upper-spec-size-and-ownership.md` | 167 | 已由 `f2287321` 覆盖 |
| `00-hierarchy-check-2026-09-11.md` | 112 | §4.2 待裁定项**已闭合**（00 §2 制度条款已补入，本表已核） |
| `dsh-current-version-and-market-gap.md` | 128 | 已由 `76ee7b7b` 覆盖 |

**⚠️ 注意**：E 类中多数**已由 Spark 覆盖**（与 D 类性质相近）。建议**先归档不删除**，理由同 D：Spark 为语义快照，原文细节未提取。

**E 类中的强可归档**（目标确已建成，无剩余开放项）：`v4-v5-spec-migration-matrix`、`v4-web-migration-survey`、`trae-memory-analysis`、`workbuddy-memory-analysis`、`concept-systems-and-institutions-2026-09-11`、`business-systems-overview`、`00-hierarchy-check`、`dsh-current-version-and-market-gap`（8 份）。

---

## F · 本表与普查 —— 🛑 保留（2 份）

| 文件 | 理由 |
|---|---|
| `docs-to-spark-census.md` | 转入普查的完整记录（24 条来源与判据） |
| `docs-cleanup-assessment.md` | 先前清理评估，含「归档而非删除」原则与风险分析 |

---

## G · 未跟踪 —— ⚠️ 先 git add（1 份）

`docs-to-spark-census.md` 当前**未跟踪**。若清理会真丢失（无 git 历史）——已在 F 类建议保留，但**应先 `git add`**。

---

## 3. 建议执行方案

### 方案 A（推荐）：只归档 8 份强可归档

```
git mv docs/v4-v5-spec-migration-matrix.md        docs/archive/
git mv docs/v4-web-migration-survey.md            docs/archive/
git mv docs/trae-memory-analysis.md               docs/archive/
git mv docs/workbuddy-memory-analysis.md          docs/archive/
git mv docs/concept-systems-and-institutions-2026-09-11.md docs/archive/
git mv docs/business-systems-overview.md          docs/archive/
git mv docs/00-hierarchy-check-2026-09-11.md      docs/archive/
git mv docs/dsh-current-version-and-market-gap.md docs/archive/
```

**效果**：根目录 86 → 78；历史全保留；风险最低。同步更新 `archive/README.md` 索引。

### 方案 B：归档 E 类全部 15 份 —— ✅ **已执行（2026-09-13）**

在 A 基础上，另加已由 Spark 覆盖的 7 份（`read-dimension`、`restructure-decision-list`、`deliberation-input-restructure`、`execution-usage-mapping`、`deliberation-usage-mapping`、`team-control-foundation-draft`、`analysis-upper-spec-size`）。

**执行结果**：方案 A（8 份）+ 方案 B（7 份）= **15 份已归档**，docs 根目录 **88 → 73**；`archive/` 34 → 49；全部 `git mv`，零删除。详见 `docs/archive/README.md` §〇/§〇之一。

### 方案 C（不推荐）：删除

`docs-cleanup-assessment.md` §六已analysed：收益是「目录整洁」，风险是「不知道要找回什么才是真风险」。**收益与风险不对称，故不建议删除。**

---

## 4. 本表未做 / 未核实

- **未执行**任何删除或移动（Human 勾选后才做）
- 未逐份核 `review-*` 43 份的**内容**（按类型+性质声明判定，未读全文）
- 未核 `p0-spec-inconsistency-note.md` 自述的「待 Human 决定后删除或转入正式记录」——**该决定未做**，本表未替其决定
- 未核 R 类（`dev-memo` 等）中是否另有 Spark 未捕获的开放项（`dev-memo` §5 已逐项对照，其余未逐行）
- `archive/` 34 份与 `audit/` 8 份**未纳入本表**（前者已归档，后者有 Human 决定在先）
