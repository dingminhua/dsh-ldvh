# docs/archive/ 归档索引

> **性质**：归档区索引。本目录存放**已过期或已由后续工作取代**的 `docs/` 文档。
> **建立**：2026-09-12（Human 指示：「docs 下建立归档文件夹，将一些过期的文档转移其中，部分过期的文档，可以重新收敛为新文档」）
> **移动方式**：已跟踪文件一律 `git mv`（git 历史保留）；未跟踪文件为直接移动（本无 git 历史）。
> **效力**：本目录内容**不具规范效力**（`specs/01-规范模型基础规范.md` §9.1 候选路径只含 `specs/` 与 `specs/attachments/`）。归档**不是删除**，仍可 `git log`／直接读取。

---

## 一、为什么归档而不是删除

| 理由 | 说明 |
|---|---|
| 保留决策溯源 | 候选稿记录了「当时考虑过什么、为何没选另一方案」，这类信息**只在此处** |
| git 历史不丢 | `git mv` 保留完整历史，随时可 `git log --follow` 回溯 |
| 降低误删风险 | 「过期」≠「无用」；过期的是**口径**，不是**决策过程** |
| 目录可读性 | 根目录从 46+33 份降为 46 份，当前有效文档更易定位 |

---

## 二、归档清单（33 份）

### A. 候选稿 —— 目标规范均已建成或定稿（20 份）

这些候选稿的用途是「供 Human 审阅后决定是否采纳」；**目标已定稿，使命完成**。且其主张的内容已被正式规范取代，留存根目录易造成「两处口径并存」。

| 文件 | 目标 | 取代者 |
|---|---|---|
| `spec-candidate-00-business-system-roster-2026-09-10.md` | 00 | `specs/00`（`ca89742`/`77d3703`/`3b1e3e6` 定稿） |
| `spec-candidate-00-ch2-audit-2026-09-11.md` | 00 | 同上 |
| `spec-candidate-00-ch2-only-2026-09-11.md` | 00 | 同上 |
| `spec-candidate-00-ch2-responsibility-2026-09-11.md` | 00 | 同上 |
| `spec-candidate-00-ch2ch3-2026-09-11.md` | 00 | 同上 |
| `spec-candidate-00-chapter2-2026-09-11.md` | 00 | 同上 |
| `spec-candidate-00-function-plane-2026-09-10.md` | 00 | 同上 |
| `spec-candidate-00-work-model-restructure.md` | 00 | 同上 |
| `00-revision-candidate-2026-09-10.md` | 00 | 同上 |
| `00-revision-candidate-2026-09-10-r2.md` | 00 | 同上（r2 自述「**未写入 00**」） |
| `00-revision-candidate-2026-09-10-r3.md` | 00 | 同上 |
| `00-revision-candidate-2026-09-10-r4.md` | 00 | 同上 |
| `00-revision-candidate-2026-09-10-r5.md` | 00 | 同上 |
| `spec-candidate-05-outcome-drift-2026-09-10.md` | 05 | `specs/05-LDVH CLI规范.md` |
| `spec-candidate-06-signature-source-scope-2026-09-10.md` | 06 | `specs/06-事实源与信息溯源规范.md` |
| `spec-candidate-11-research-system.md` | 11 | `specs/11-调研系统规范.md` |
| `spec-candidate-24-research-fact-type.md` | 24 | `specs/24-Research-调研报告.md` |
| `spec-candidate-25-goal-fact-type.md` | 25 | `specs/25-Goal-项目目标.md` |
| `spec-candidate-2026-09-03-action-visibility.md` | 行动可见性 | 已由 `specs/02`/`10` 相关条文承接（**未逐条核实**） |
| `spec-candidate-2026-09-06-handover-three-state-envelope.md` | 交还 envelope | 已由 `specs/05`/`08` 承接（**未逐条核实**） |

**⚠️ 唯一未归档的候选稿**：`spec-candidate-30-goal-decomposition.md` —— 目标是 **30 号段（业务系统段），尚未建立**，保留在 `docs/` 根以备后续使用。

### B. v4/v5 迁移遗留（4 份）

| 文件 | 归档原因 |
|---|---|
| `v4-governance-git-gate-migration-checklist.md` | Git Gate 已实际运行，迁移清单完成 |
| `v4-problem-ledger.md` | v4 问题账；v5 已重构，问题已分流为 Friction/Pitfall |
| `v5-rebuild-plan.md` | 计划期产物；v5 已进入实现 |
| `v5-handoff.md` | 移交已完成 |

**⚠️ 保留在根的 2 份**（可能仍被引用为迁移依据，**未核实，故不归档**）：
- `v4-v5-spec-migration-matrix.md`
- `v4-web-migration-survey.md`

### C. 事实规范设计过程的原始文档（9 份）—— **已收敛**

这 9 份已**收敛为 `docs/fact-norm-design-consolidated.md`**（635 行，13 个 H2）。收敛原则：保留结论与依据、保留未决项、保留关键机械证据；丢弃已被推翻的中途过程（仅记为「已撤回设计」）。原件归档以保留完整过程。

| 文件 | 收敛去向 |
|---|---|
| `proposal-fact-norm-foundation.md` | consolidated §1、§2、§8 |
| `adversarial-fact-norm-necessity.md` | consolidated §1、§7、§12 |
| `design-fact-norm-in-fact-source.md` | consolidated §2–§6、§7（含其附录 A 的撤回） |
| `design-one-direction-one-norm.md` | consolidated §4、§9 |
| `survey-dual-read-channels.md` | consolidated §9 |
| `survey-spec-distribution-boundary.md` | consolidated §1、§9 |
| `research-adr-to-norm-boundary.md` | consolidated §6、§8 |
| `survey-software-directions.md` | consolidated §8（方向清单） |
| `spec-drift-inventory-2026-09-11.md` | consolidated §11（收敛时点漂移复核） |

**映射详见** `docs/fact-norm-design-consolidated.md` §10「原件映射」。

---

## 三、保留在 `docs/` 根的内容（未归档）

| 类 | 文件 | 保留理由 |
|---|---|---|
| **事故/P0 记录** | `p0-*`（4）、`incident-fact-directories-v4-legacy.md` | **唯一记录**；事故与复现步骤是历史事实依据 |
| **评审报告** | `review-*`（4） | 独立审核记录，是 `specs/01` §12 效力溯源的证据 |
| **执行记录** | `spec-sync-batch1-log.md`、`00-ch3-5-review-disposition-*.md`、`00-hierarchy-check-*.md` | 记录「何时、因何做了何变更」 |
| **决定溯源** | `dev-memo.md`、`concept-systems-and-institutions-2026-09-11.md`、`pending-human-decisions-2026-09-11.md`、`action-plan-2026-09-10.md`、`restructure-decision-list-2026-09-10.md` | 含 Human 决定编号与理由 |
| **未完成输入** | `spec-candidate-30-goal-decomposition.md`、`memory-system-design-prompt.md`、`blueprint-*`、`team-control-foundation-draft.md` | 目标尚未建立，可能仍被消费 |
| **迁移依据** | `v4-v5-spec-migration-matrix.md`、`v4-web-migration-survey.md` | 可能仍被引用（未核实） |
| **本轮产出** | `fact-norm-design-consolidated.md`、`docs-cleanup-assessment.md` | 结论尚未全部落地 |

---

## 四、复核命令

```bash
cd /Users/dmh2002/DshProject/dsh-ldvh
ls docs/archive/*.md | wc -l              # 33
ls docs/*.md | wc -l                      # 46
git status --porcelain | grep -c '^R'     # 24（已跟踪文件的真实重命名）
git status --porcelain | grep '^D'        # 空（无删除）
git log --follow docs/archive/spec-candidate-11-research-system.md   # 历史保留
```

---

## 五、注意事项

1. **本索引须与实际内容一致**：新增归档时同步更新本文件。
2. **归档不等于失效判断**：某文档被归档仅表示「其口径已被取代或任务已完成」，不表示其内容无价值。
3. **`docs/` 整体不具规范效力**：任何归档/恢复动作都不改变 `specs/` 的当前规则源。
4. **残留不确定**：`spec-candidate-2026-09-03-action-visibility.md` 与 `spec-candidate-2026-09-06-handover-three-state-envelope.md` 的「已被取代」判断**未逐条核实**；`v4-v5-spec-migration-matrix.md`／`v4-web-migration-survey.md` 是否仍被引用**未核实**。
