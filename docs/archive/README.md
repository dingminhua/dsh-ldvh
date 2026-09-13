# docs/archive/ 归档索引

> **性质**：归档区索引。本目录存放**已过期或已由后续工作取代**的 `docs/` 文档。
> **建立**：2026-09-12（Human 指示：「docs 下建立归档文件夹，将一些过期的文档转移其中，部分过期的文档，可以重新收敛为新文档」）
> **移动方式**：已跟踪文件一律 `git mv`（git 历史保留）；未跟踪文件为直接移动（本无 git 历史）。
> **效力**：本目录内容**不具规范效力**（`specs/01-规范模型基础规范.md` §9.1 候选路径只含 `specs/` 与 `specs/attachments/`）。归档**不是删除**，仍可 `git log`／直接读取。

---

## 〇、2026-09-13 第二批归档（8 份 · 依清理对照表方案 A）

**背景**：Human 2026-09-13 目标——「把 docs 里需要推进的工作都转入 spark，之后 docs 目录要进行大量的清理」。转入完成后（事实源 Spark 3 → 24），依 `docs/docs-cleanup-retention-table.md` **方案 A** 执行第二批归档。

| 文件 | 行 | 归档依据 |
|---|---|---|
| `v4-v5-spec-migration-matrix.md` | 118 | **Human 裁定 2026-09-13：不存在迁移了**；ADR `1aad60bc`「v4 存量零迁移」 |
| `v4-web-migration-survey.md` | 297 | Web 已迁入插件（`plugin/web/` 已存在），盘点使命完成 |
| `trae-memory-analysis.md` | 88 | 已由 Spark `b8cd2268`「LDVH 记忆系统」的调研依据链承载 |
| `workbuddy-memory-analysis.md` | 79 | 同上 |
| `concept-systems-and-institutions-2026-09-11.md` | 631 | §12.5 已终局裁定「六系统，无缺口」；已由 Spark `2916e3d5` 覆盖 |
| `business-systems-overview.md` | 162 | 00 §3.1 已定六系统（其自述「00 §3.1 仍是唯一权威」） |
| `00-hierarchy-check-2026-09-11.md` | 112 | §4.2 待裁定项**已闭合**（00 §2 制度条款已补入，经核） |
| `dsh-current-version-and-market-gap.md` | 128 | 已由 Spark `76ee7b7b`「上游 DSH 能力变化的吸收」覆盖 |

**纪律说明**：
1. 本批**全部为 `git mv`**（8 份均为真重命名，git 历史保留；零删除）；
2. **归档 ≠ 判断其内容无价值**——其中多份的内容已转入事实源 Spark，但 Spark 的 `summary` 是语义快照，原文含更完整细节（推导、行业对照、字段清单），故**归档保留而非删除**；
3. 完整的逐份「可删/应留」判据见 `docs/docs-cleanup-retention-table.md`（该表建议保留在根，理由：是清理决策自身依据）。

**第二部分（已执行）**：对照表方案 B 所列 7 份「已由 Spark 覆盖」的归档候选（`read-dimension-understanding`、`restructure-decision-list`、`deliberation-input-restructure`、`execution-usage-mapping-draft`、`deliberation-usage-mapping-draft`、`team-control-foundation-draft`、`analysis-upper-spec-size-and-ownership`）**已全部归档**，见下方「〇之一」节与 `docs/docs-cleanup-retention-table.md` §方案 B。（本句原记「未执行／待 Human 逐项勾选」，与本文件同批次的执行记录矛盾，2026-09-13 据实更正。）

**核验命令**：

```bash
cd /Users/dmh2002/DshProject/dsh-ldvh
ls docs/*.md | wc -l            # 76（原 88；方案 A+B 后 73，本批 3 份归档后含新增普查/提案类为 76）
ls docs/archive/*.md | wc -l    # 52（原 34）
git status --porcelain | grep -c '^R'   # 18（三批真重命名累计）
git status --porcelain | grep '^D'      # 空（零删除）
```

---

## 〇之一、2026-09-13 第二批之二归档（7 份 · 依清理对照表方案 B）

**背景**：方案 A 归档 8 份后，Human 指示执行方案 B——把「已由 Spark 覆盖、且不属效力证据」的 7 份一并归档。

| 文件 | 行 | 覆盖它的 Spark |
|---|---|---|
| `read-dimension-understanding.md` | 148 | `47396b7f`「读维认知小结的落地」、`64ae68ac`「管辖判定操作的名实错配」 |
| `restructure-decision-list-2026-09-10.md` | 149 | `dbffddd2`「执行系统（单元执行）的建立」、`64754323`「Git Gate 的 fail-open 通路」、`2e79939a`「21 号 WorkCase 规范立项」 |
| `deliberation-input-restructure-2026-09-10.md` | 128 | `dbffddd2`「执行系统（单元执行）的建立」 |
| `execution-usage-mapping-draft.md` | 156 | `a1209317`「底座两用法映射的落地」 |
| `deliberation-usage-mapping-draft.md` | 98 | `a1209317`「底座两用法映射的落地」 |
| `team-control-foundation-draft.md` | 204 | `a1209317`「底座两用法映射的落地」 |
| `analysis-upper-spec-size-and-ownership.md` | 167 | `f2287321`「上层规范体量与归属」 |

**判据**：这 7 份**不属 `01 §9.2` 第 8 项（独立审核记录）的载体**，其内容已由事实源 Spark 承载，故归档不影响任何规范成立条件。

**纪律**：本批同样**全部 `git mv`**，零删除。归档后正文与 Spark 的 `summary` 并存——Spark 是语义快照，原文细节（完整推导、字段清单、行业对照）仍可回读。

**累计效果**：docs 根目录 **88 → 73**（两批共归档 15 份），`archive/` 34 → 49。

---

## 〇之二、2026-09-14 第三批归档（3 份 · docs 清理收尾）

**背景**：docs 清理收尾批次——两份候选稿的前提已失效、一份调查记录已完成修复，均归档保留完整过程。

| 文件 | 行 | 归档依据 |
|---|---|---|
| `spec-candidate-30-goal-decomposition.md` | 47 | 候选前提**已失效**：自述「30 号段（业务系统段）尚未建立」，而 30 号已建成 `specs/30-调研系统规范.md`（调研系统，`1fbc862`／`6438652` 号段化）；「行动模板」概念已随 00 重构退役（`3b1e3e6`），其 `parent_spec: action-template-foundation` 无上位依据；对应方向已由 Spark `2916e3d5` 处置 |
| `HANDOVER-04-business-system-foundation.md` | — | 移交文档使命完成：04 已**改造**为 `specs/04-业务系统基础规范.md`（`spec_key: business-system-foundation`，`supersedes: action-template-foundation`，`bb026e7`），任务已实现 |
| `ci-plugin-job-node-version-investigation.md` | 132 | 调查记录，正文自述「仅调查，未修复」，但修复已随 `92d1fed`（2026-09-13，CI Node 20 → 22.19 对齐宿主）落地；保留全文以承载调查与验证过程（726/726、269/269） |

**判据**：`spec-candidate-30` 属「候选前提失效」（非效力证据载体）；HANDOVER-04 属「移交完成」（任务已实现）；ci-investigation 属「调查记录，修复已落地」（过程证据保留）。

**纪律**：本批**全部 `git mv`**，零删除。

**累计效果**：第三批归档 3 份后实测——docs 根目录 **76** 份、`archive/` **52** 份（方案 A＋B 后根为 73，其后新增普查/清理/提案类文档至 79，本批再减 3 至 76）。

---

## 〇之三、2026-09-14 第四批归档（1 份 · 机制被取代）

**背景**：Human 指示「直接归档」。本文为一次性运行产物，其主张的机制已由 Human 裁定取代。

| 文件 | 行 | 归档依据 |
|---|---|---|
| `spark-next-action-triage-2026-09-13.md` | 107 | **判读基数过期 + 机制被取代**：本文记「23 条 open Spark」，实际为 21 条（`80e9524` 已将两条转终态，发生在本文判读之后）；其主张「用可执行性 + 被指向数替代优先级」已被 Human 2026-09-13 裁定取代——**直接引入 `priority` 字段**（20 §8），21 条 open 已全部回填，Web 提供三联过滤（priority + serves + 生命周期），见 `aa12604`。**保留价值**：文中 §0.1「被指向数衡量顺序而非价值」与 §3 的 4 处分类误差自我更正，仍可作为该指标的使用边界参考 |

**判据**：属「机制被取代」——非前提失实，而是同一问题已由 Human 裁定的另一方案解决。

**纪律**：`git mv`，零删除；文首已加过期警示（含三项过期原因与现行依据指向）。

**累计效果**：本批后实测——docs 根目录 **75** 份、`archive/` **53** 份。

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
| `spec-candidate-2026-09-03-action-visibility.md` | 行动可见性 | ❌ **未承接（原判误，2026-09-13 核实更正）**——见下方 §二之一 |
| `spec-candidate-2026-09-06-handover-three-state-envelope.md` | 交还 envelope | ⚠️ **部分承接**——见下方 §二之一 |

**⚠️ ~~唯一未归档的候选稿~~（2026-09-14 已归档）**：`spec-candidate-30-goal-decomposition.md` —— 原注「目标是 **30 号段（业务系统段），尚未建立**」的前提现已失效：`specs/30-调研系统规范.md` 已建立（30 号段＝调研系统），「行动模板」概念已退役。该候选已随第三批归档（见上方「〇之二」）。

### 二之一、两份候选的「已承接」判断经核实更正（2026-09-13）

上表原将两份候选记为「已由 specs 承接（未逐条核实）」。经**逐条机械核验**，该判断对一份为**误判**、对另一份**不完整**：

#### ① `spec-candidate-2026-09-03-action-visibility.md` —— 误判，**从未应用**

| 核验项 | 命令/依据 | 结果 |
|---|---|---|
| `specs/` 是否含该术语 | `grep -rn '行动可见性' specs/` | **零命中** |
| `08` 是否新增 §5.7「行动可见性」 | 读 `08` 章节目录 | **无 §5.7**（章节止于 §6「机械守护部署」） |
| `10` 是否新增 §7.1「会话内管辖与行动标记」 | 读 `10` 章节目录 | **无 §7.1**（现 §7 为「管辖登记与项目切换」） |

该候选经**两轮独立对抗审核**后停在中途：复审（`review-report-2026-09-04b-*`）判定 13 项均已落点，但新发现 R1–R6 未处置（R1 能力夸大、R2 核对缺口均为 high），建议「进入 Human 终审前由主控处理」——**流程停在此处，未进终审、未应用**。

**处置**：已建为 Spark「行动可见性候选停摆」，方向未被承接，须由 Human 决定继续修复应用或正式退出。**原「归档=口径已被取代」的记述对该文件不成立**（其口径从未生效）。

#### ② `spec-candidate-2026-09-06-handover-three-state-envelope.md` —— 部分承接

已承接：`specs/05` 定义了共同 envelope、`gaps` 字段与 `partial/unavailable/rejected/invalid_request/exec_error` 响应状态（§8 区域，见 05:186/193/231/238）；`specs/08:60` 明确「传输 envelope 归 05」。

**未承接**：该候选的核心贡献是**三态（已证实/未证实/残留风险）的属性字段**（置信度、优先级、验证方法、溯源）——其 §1.1 自述「00 §7.4 只有自然语言描述，**没有属性字段**——实现者无法机械区分『未证实』与『残留风险』」。此结构化字段定义在 `specs/05` 中**未见对应条文**。

**处置**：该候选属**部分承接**；其未承接部分（三态属性字段）是否仍需落地，待 Human 判断。本次未另建 Spark（承接判定证据不足以支撑一条独立方向），如实登记于此。

**核验命令**：

```bash
cd /Users/dmh2002/DshProject/dsh-ldvh
grep -rn '行动可见性' specs/ | wc -l          # 0
grep -n '^### 5\.7\|^## 5\.7' specs/08-*.md   # 无输出
grep -n '^### 7\.1' specs/10-*.md             # 无输出
grep -n 'gaps' specs/05-*.md | head           # 有（已承接部分）
```

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

> 本节所列「保留在根」条目以本索引建立时（2026-09-12）的状态为准；其后方案 A／B（2026-09-13）与第三批（2026-09-14）已把部分原列条目归档——已在行内以删除线标注。归档明细以上方各批表为权威。

| 类 | 文件 | 保留理由 |
|---|---|---|
| **事故/P0 记录** | `p0-*`（4）、`incident-fact-directories-v4-legacy.md` | **唯一记录**；事故与复现步骤是历史事实依据 |
| **评审报告** | `review-*`（4） | 独立审核记录，是 `specs/01` §12 效力溯源的证据 |
| **执行记录** | `spec-sync-batch1-log.md`、`00-ch3-5-review-disposition-*.md`、~~`00-hierarchy-check-*.md`~~（已归档，方案 A） | 记录「何时、因何做了何变更」 |
| **决定溯源** | `dev-memo.md`、`concept-systems-and-institutions-2026-09-11.md`、`pending-human-decisions-2026-09-11.md`、`action-plan-2026-09-10.md`、~~`restructure-decision-list-2026-09-10.md`~~（已归档，方案 B） | 含 Human 决定编号与理由 |
| **未完成输入** | ~~`spec-candidate-30-goal-decomposition.md`~~（已归档，2026-09-14：30 号段已建成、行动模板退役，前提失效）、`memory-system-design-prompt.md`、`blueprint-*`、~~`team-control-foundation-draft.md`~~（已归档，方案 B） | 目标尚未建立，可能仍被消费（spec-candidate-30 例外，见 §〇之二） |
| **迁移依据** | ~~`v4-v5-spec-migration-matrix.md`~~、~~`v4-web-migration-survey.md`~~（均已归档，方案 A） | 原「可能仍被引用（未核实）」——方案 A 已据「不存在迁移了」归档（ADR `1aad60bc`） |
| **本轮产出** | `fact-norm-design-consolidated.md`、`docs-cleanup-assessment.md` | 结论尚未全部落地 |

---

## 四、复核命令

```bash
cd /Users/dmh2002/DshProject/dsh-ldvh
ls docs/archive/*.md | wc -l              # 53（含本目录 README）
ls docs/*.md | wc -l                      # 75
git status --porcelain | grep -c '^R'     # 重命名数（随批次变化）
git status --porcelain | grep '^D'        # 空（无删除）
git log --follow docs/archive/spec-candidate-11-research-system.md   # 历史保留
```

**计数口径**：`ls docs/archive/*.md` 含本索引 `README.md` 自身；上述数字为 2026-09-14 第四批归档后的实测值。根目录与归档区计数随每批变动，**以实测为准**，本节数字仅作对照。

---

## 五、注意事项

1. **本索引须与实际内容一致**：新增归档时同步更新本文件。
2. **归档不等于失效判断**：某文档被归档仅表示「其口径已被取代或任务已完成」，不表示其内容无价值。
3. **`docs/` 整体不具规范效力**：任何归档/恢复动作都不改变 `specs/` 的当前规则源。
4. **残留不确定**：~~`spec-candidate-2026-09-03-action-visibility.md` 与 `spec-candidate-2026-09-06-handover-three-state-envelope.md` 的「已被取代」判断**未逐条核实**~~ → **已于 2026-09-13 核实并更正**，见 §二之一；`v4-v5-spec-migration-matrix.md`／`v4-web-migration-survey.md` 是否仍被引用**未核实**。
