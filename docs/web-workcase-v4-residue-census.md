# Web WorkCase 页 v4 残留偏差普查

> 目的：查清 Web 中 WorkCase tab 上 `priority`、`progress_group` 两组概念与 v5 规范（尤以 20/21 号）的偏差，标出**可删**、**有消费方不可直接删**与**需要 Human 裁定**三类，为后续 Code 改动提供依据。
> 性质：**调研记录，不具规范效力**，不构成对 20/21/10 号的任何修订，也不预设处置结论。规范冲突一律以规范源原文为准。
> 状态：**第一批调整已落地（tab 筛选层，2026-09-13）**；认知中心待办链的规范地位仍未定，未改动。
> 日期：2026-09-13

## 0.1 第一批调整落地记录（2026-09-13）

按 Human 裁定「只改 tab 筛选：删 priority + progress 回三态，认知中心不动」执行。

**已改：**

| 项 | 结果 |
|---|---|
| WorkCase/Spark 两侧 priority 筛选 | **已删除**（列表筛选、卡片徽标、`?priority=` 参数、`priorityOptions` 投影、WorkCase 契约登记项） |
| `ObjectPriorityFilter.tsx` | **已删除**（改动后成为孤儿） |
| WorkCase 列表分组 | **五值 → 21 §160 三态** `draft`/`open`/`closed`（`WORKCASE_STATUS_ORDER`、`WORKCASE_LIST_STATUS_ORDER`） |
| `WorkCaseListGroup` 类型 | 收敛为 `'draft' \| 'open' \| 'closed'` |
| `?progress=discarded` 等 v4 分组 | 现返回 400 并说明 21 §160 三态 |

**未改（按裁定保留）：**

- `cognition.ts` 的 `progress_group` 消费链（`InboxKind`、`priorityRank`、待办分派）——认知中心本体不动。
- 卡片级 `progress_group` 投影（`workcasePresentationContract`）——认知中心与卡片共用，非列表筛选维度。
- `src/utils/objectSignals.ts`、`PriorityIcon.tsx` 及详情页/认知中心的 `PriorityIcon` 调用——超出 tab 范围，见 §6。

**验证：** 268/268 测试通过；`tsc -b` 无错；`vite build` 成功；eslint 问题数改动前后一致（49 problems / 23 errors，全部为既有问题，未新增）。

**测试断言同步修正（3 文件）：** `lifecycle-status-tabs-contract`（原断言要求 priority 必须存在——正是把残留写成合同）、`commit-dto`（progressOptions 五值 + priorityOptions）、`workcase-card-lifecycle-contract`（断言筛选器必须隐藏 termination_cleanup）。新增 `fact-field-contract` 的 WorkCase 侧守卫。

## 0. 触发与结论摘要

触发：Human 提出「WorkCase tab 还有优先级概念，应一并改为 SG」，随后追加「进展分组的概念应该也不对了，一起调整掉」。

普查结论：**这两项不是同一类问题，且都不能直接"改成 SG"。**

| 项 | 现状位置 | v5 规范依据 | 判定 |
|---|---|---|---|
| `priority`（P0–P3）筛选 | WorkCase tab 专属 | **21 §8 字段闭集无此字段**；20 §289 明确 v4 priority 不迁入 | **无规范依据**，且事实源无数据。技术上可删，但见 §4 的理由不宜单独删 |
| `progress_group`（五值分组） | WorkCase tab + 认知中心 | **21 §9 状态闭集仅三值** `draft`/`open`/`closed`；10 号无 progress 概念 | **无规范依据，但有活跃消费方**（认知中心待办链）→ **不可直接删** |
| `serves`/SG | 仅 Spark tab | **20 §8 与 21 §8 均有此字段** | **有规范依据**。WorkCase 侧并非缺少 SG，而是 UI 未提供筛选入口 |

关键纠正：**"WorkCase 的 SG"不是一个待补的属性**。WorkCase 早已有 `serves` 字段（21 §8），其 SG 维度由字段承载、由 `WorkCaseProgressFilter` 位置上的状态筛选相邻呈现。**把 priority 筛选"改成 SG"在语义上是把两个不同层次（优先级 vs 归属锚点）互换，不成立。**

---

## 1. `priority` 项

### 1.1 代码位置

- `plugin/web/src/pages/ObjectList.tsx:1760` — `const supportsPriorityNavigation = currentType === 'workcase'`
- `plugin/web/src/pages/ObjectList.tsx:1764` — `isPriorityApplicable`，排除 `closed`/`discarded`
- `plugin/web/src/pages/ObjectList.tsx:2111-2121` — 渲染 `ObjectPriorityFilter`
- `plugin/web/src/components/ObjectPriorityFilter.tsx:6-7` — `PRIORITY_ORDER = ['P0','P1','P2','P3']`
- `plugin/web/src/components/PriorityIcon.tsx` — 卡片与详情页的优先级徽标
- `plugin/web/api/routes/objects.ts:168-169` — `priorityOptions` 由 `item.priority` 聚合
- `plugin/web/api/routes/objects.ts:214-215, 240, 255-258` — `?priority=` 查询参数与组内过滤

### 1.2 规范依据核对

- 21 §8 frontmatter 闭集：**无 `priority`**。
- 21 §9 状态闭集：`draft` → `open` → `closed`。**无优先级维度。**
- 20 §289：`v4 priority 不迁入（v5 无此字段）`——**同类字段已在 Spark 侧被明确否决过**。
- 22 §271 / 23 §252 / 26 §258：同类"装饰字段"红线——`priority`/`severity`/`tags` **不设**，理由为"重要性由消费点引用体现"。
- 03 §11.3 第 4 条：字段扩展必须**说明消费方**……不因 Code 已存在而反向取得规范效力。

### 1.3 数据现状

- `ldvh-base/workcases/` — **0 个文件**（**2026-09-13 修正**：原记「目录为空」失实——当时目录**不存在**；已补建，仍无对象）。
- 全量 `workcases/*.md` 中 `priority` 出现次数：**0**。
- 结论：**该筛选器当前无任何数据可筛**，呈现恒空。

### 1.4 代码自我声明

代码注释已自认为过渡态：

- `ObjectList.tsx:1757` — `优先级导航仅 WorkCase 保留（v4 字段，21 号定稿前不动）`
- `ObjectPriorityFilter.tsx:6` — `WorkCase 优先级档位（v4 字段，21 号定稿前保留；Spark 已按 20 号移除 priority）`

**注意**：注释引用的"21 号定稿前"——21 号现已有成文 §8/§9 字段与状态闭集，**该前提条件实际已不成立**。

---

## 2. `progress_group` 项（比 priority 严重）

### 2.1 五值分组定义

`plugin/web/shared/workcaseStatus.ts:20-26`：

```
plan_confirmation | progressing | termination_cleanup | closure_confirmation | closed
```

另有 `WORKCASE_PROGRESS_STEP_ORDER`（`item_execution`/`controller_self_check`/`independent_review`/`controller_synthesis`）。

### 2.2 规范依据核对

- 21 §9：**状态闭集三值**，无"进展分组"层。
- 21 §8：字段闭集中**无 `progress_group`**，亦无 `progress_step`。
- 10 号（Web 呈现）：`grep progress/priority/进展` — **0 命中**。10 号未定义任何进展分组呈现契约。
- **`specs/` 全库 `grep 认知|收件箱|inbox|Cognition` — 0 命中。**

> **重大发现**：**认知中心（Cognition Center）与其收件箱（inbox）概念在整个 specs/ 中没有任何规范依据。** 而它是 `progress_group` 的最大消费方。这意味着 progress_group 的偏差**不止是 UI 层**，而是一条从投影到待办、完全建立在规范外概念上的链路。

### 2.3 活跃消费方（为什么不能直接删）

`progress_group` **不是纯 UI 装饰**，它驱动认知中心的待办分类：

- `plugin/web/api/routes/cognition.ts:44` — `InboxKind = 'plan_confirmation' | 'closure_confirmation' | 'blocked_resolution' | 'pitfall_confirmation'`
- `cognition.ts:234-242` — `plan_confirmation` + `gate1_waiting` → 待 Human **批准计划**（Gate 1）
- `cognition.ts:241-242` — `closure_confirmation` + `gate2_waiting` → 待 Human **确认关闭**（Gate 2）
- `cognition.ts:766-793` — 按 `progress_group` 分派入收件箱与「推进中事项」
- `cognition.ts:602-603, 940` — 排序与条目构建依赖 `progress_group`
- `objects.ts:45-47` — 把投影值**压回**三态呈现：
  ```
  if (item.progress_group === 'closed' && item.closure_outcome === 'cancelled') return 'discarded'
  if (typeof item.progress_group !== 'string') return undefined
  return item.progress_group === 'termination_cleanup' ? 'closed' : item.progress_group
  ```

因此：`plan_confirmation`/`closure_confirmation` **背后连着 Gate 1 / Gate 2 的 Human 待办链路**。直接删除会打断"待批准"的呈现，属**功能性破坏**，不是清理残留。

### 2.4 UI 已在隐藏后端仍返回的值

`plugin/web/src/components/WorkCaseProgressFilter.tsx:32`：

```
options.filter(({ group }) => group !== 'termination_cleanup')
```

后端仍返回 `termination_cleanup`，UI 自行隐藏。这是**规-码-UI 三方不一致**的直接证据。

---

## 3. `serves`/SG 项（纠正 Human 的初始假设）

- 20 §8：Spark `serves` — "轻量归属引用，**不参与 goal 修订级联**（25 §11 豁免）"。
- 21 §8：WorkCase `serves` — 锚点型字段，指向 `goal.md` 的 SG-n。
- 21 §234：明确 `serves` **不是 `relations` 条目**（锚点无 `object_uid`）。
- 25 §149：级联"机械扫描 `serves` 受影响 sub-goal 的 active WC……**只到 active 对象；Spark 豁免**"。
- 03 §200：锚点型字段**命名纪律**——同一锚点家族应**统一字段名**（`serves` 即统一登记名）。

**结论**：两侧**同名同义、级联行为相反**，这是刻意设计而非错位。WorkCase 的 SG 维度**已经存在**，缺的只是 tab 上的筛选入口（Spark 侧由 `ServesSgFilter` 承载，`ObjectList.tsx:1767` 限定 `currentType === 'spark'`）。

---

## 4. 影响面清单（若决定推进清理）

### 4.1 前端

- `plugin/web/src/pages/ObjectList.tsx`（1760-1768、2111-2163）
- `plugin/web/src/components/ObjectPriorityFilter.tsx`
- `plugin/web/src/components/PriorityIcon.tsx`
- `plugin/web/src/components/WorkCaseProgressFilter.tsx`
- `plugin/web/src/components/ServesSgFilter.tsx`（若扩展至 WorkCase）
- `plugin/web/src/utils/objectSignals.ts`（`SIGNAL_FIELDS = ['priority']`）
- `plugin/web/src/utils/api.ts`（多处 `priority?`、`WorkCaseProgressGroup`）
- `plugin/web/src/i18n/locales.ts`（419、497、1016、1021、1250）
- `plugin/web/src/pages/ObjectDetail.tsx:656`、`object-detail/*`

### 4.2 后端

- `plugin/web/api/routes/objects.ts`（45-47、94-104、168-169、214-258）
- `plugin/web/api/routes/cognition.ts`（78-80、90-137、184、234-242、313-325、528-545、602-603、686、766-793、940）
- `plugin/web/api/routes/federation.ts:136`
- `plugin/web/shared/workcaseStatus.ts`、`workcasePresentationContract.generated.ts`

### 4.3 测试（11 个文件涉及，删改前须逐份核对）

`lifecycle-status-tabs-contract`、`workcase-current-snapshot-projection-contract`、`workcase-card-lifecycle-contract`、`workcase-presentation-spec-contract`、`cognition-inbox-contract`、`web-design-consistency-contract`、`fact-field-contract`、`commit-dto`、`spark-serves-filter-contract`、`workcase-detail-current-contract`、`research-reading-contract`

### 4.4 验证障碍

**`ldvh-base/workcases/` 为空（0 对象）** → 任何改动**无真实数据可验证**，只能靠测试断言。这与 03 §11.3 第 6 条"类型规范进入 Human 确认前，必须用至少一个有效对象、一个边界反例和一个失败/部分结果样例核对"的要求存在张力。

### 4.5 第一批调整后仍未处置（第二批候选）

1. **认知中心的规范地位**——`cognition.ts` 的 `InboxKind`/`priorityRank`/待办分派仍消费 `progress_group` 与 `priority`；`specs/` 对其零依据（见 §2.2）。**属 00 §4 根决定。**
2. **`src/utils/objectSignals.ts`**——仍以 `priority` 为唯一 SignalField，服务详情页与认知中心徽标。
3. **`PriorityIcon.tsx` 及其三个调用点**——`ObjectDetail.tsx:656`、`CognitionCenter.tsx:418/501`、`CommitHotspotGraph.tsx:440`。
4. **`FactAssociationsSection.tsx` 的条件 Hook 调用**（eslint 3 处 error）——既有问题，与本次改动无关。
5. **`docs/spark-workcase-rebuild.md` §11 第 2 条**仍登记「priority 字段去留」为开放；第一批已按规范删除实现，该条宜同步改写为已裁定。

---

## 5. 处置建议（供 Human 裁定，非结论）

- **A. 不宜单独删 priority 而留 progress_group**——二者同源于 `progressProjection`（`objects.ts:94`），单独摘其一会留下半迁移状态，比现状更难理解。
- **B. progress_group 的处置必须先定认知中心的规范地位**——若认知中心在 v5 确有位置，应先在规范中为其登记依据（当前 `specs/` 零命中）；若取消，则 Gate 1/Gate 2 的待办呈现需另找承载体。**此属 00 §4 根决定范畴，不应由 Code 先行。**
- **C. "WorkCase 加 SG 筛选"是独立的新功能**，与清理残留不是同一件事，建议分开裁定。
- **D. 若决定不引入 priority**，建议把 `docs/spark-workcase-rebuild.md` §11 第 2 条由"开放"改写为已裁定（理由引 03 §11.3-4 与 22/23/26 先例），避免重复讨论。

---

## 6. 本节自认未验证范围

1. 未运行应用实测，`priority` 恒空系依据事实源为空 + 代码路径推断，**非运行时实测**。
2. 未逐一通读 11 个测试文件，仅按 `grep` 命中判定其受影响。
3. 认知中心是否有 specs/ 之外的授权依据（如 Human 决定记录、docs/ 设计文档）**未穷尽排查**；本报告"零规范依据"仅指 `specs/` 正文。
4. `plugin/web/dist/` 为构建产物，未纳入影响面。
