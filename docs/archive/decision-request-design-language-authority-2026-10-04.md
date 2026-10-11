# 提请：`docs/01 §1.4` 与 `docs/04 §4` 的字号权威冲突（一项 Human 决定）

> **性质**：**提请材料**——供 Human 裁决字号档位的权威归属。非规范、非事实对象；**未改动 `specs/` 与 `plugin/web/docs/` 任何文件**。
> **为何单独成文**：该冲突是「唯一权威」声明与一处既有域内档位之间的记账矛盾，涉及两份规范文档的效力关系，超出 AI 可自行判定的范围（改动规范效力归属属 Human 决定权）。故只列事实与选项，不代替决定。
> **背景载体**：`docs/design-language-unification-demo.html`（演示页，提交 `e4d8167`，其 §5 五档待批清单第①项即本项）；机械守卫 `plugin/web/tests/api/web-design-consistency-contract.test.ts`。
> **证据分级**：**[亲验]** ＝本会话可复现；**[既有]** ＝仓库既有材料；**[推断]** ＝我的判断。

---

## 1. 问题

两处规范对**字号档位的唯一权威**给出不同指向，而代码与机械守卫站在少数一侧。[既有]

| 项 | 内容 | 出处 |
|---|---|---|
| 权威声明 | 「完整字号系统以 `docs/01` §1.4 为**唯一权威**」 | `plugin/web/docs/11-v5Web开发增量.md:18` |
| 权威表实际内容 | 18 档；**无 13px/22px、无 14px/22px** | `plugin/web/docs/01-全局设计约束.md` §1.4（表体 `:86-103`，含表头分隔共 `:83-104`） |
| 冲突来源 | 定义 ObjectDetail 详情内页「标题 14px/22px、正文 13px/22px」两级 | `plugin/web/docs/04-ObjectDetail.md`（`:74`、`:76`、`:78`） |
| 代码落地 | `.ldvh-detail-semantic-title` = 14px/22px；`.ldvh-detail-semantic-body` = 13px/22px | `plugin/web/src/index.css` |
| 守卫站位 | 机械守卫按 **`docs/04`** 断言上述两档 | `plugin/web/tests/api/web-design-consistency-contract.test.ts:246-257` |

**关键细节（[亲验]）**：`docs/01` §1.4 表内最接近的档是 `ldvh-card-decision-title`，值是 **13px / 20px**——行距是 20 而非 22。故这**不是「同档不同名」，而是表里确实没有这两个档位**。

---

## 2. 为何这是真冲突而非疏漏

两份文档在各自语境下均自洽 [既有]：

- `docs/01` §1.4 面向「全站语义排版类总表」，其 18 档是**跨页面共用**的档位集。
- `docs/04` §4 面向「ObjectDetail 详情内页」，为详情内页专门定了**更紧凑的两级**（14/22 ＋ 13/22），并明文禁止回退到通用档。

`docs/11:18` 的「唯一权威」句若字面执行，`docs/04` §4 的这两档**无表可依**；若要保住这两档，则须承认 §1.4 存在一个**未登记的域**（详情内页专用档）。

---

## 3. 三个选项（供裁决）

### 甲 · 把两档补进 `docs/01` §1.4（承认详情内页专用档）

- **做法**：在 §1.4 表内新增 `ldvh-detail-semantic-title`（14px/22px）与 `ldvh-detail-semantic-body`（13px/22px）两行，注明「仅 ObjectDetail 详情内页使用」。
- **代价**：§1.4 从 18 档变 20 档；「唯一权威」句成立，`docs/04` 变为引用方。
- **风险**：低。**不动代码、不动守卫**，只让权威表覆盖既有事实。

### 乙 · 声明 `docs/04` §4 为域内权威（承认双权威）

- **做法**：在 `docs/11:18` 的「唯一权威」句后补一句「ObjectDetail 详情内页的字号档位以 `docs/04` §4 为准」。
- **代价**：「唯一权威」变成「唯一权威 ＋ 一个具名例外」。
- **风险**：低，但削弱单权威原则；日后新增页面时须判断归哪一侧。

### 丙 · 改代码与守卫，向 §1.4 收敛

- **做法**：废弃 13/22、14/22 两档，详情内页改用 §1.4 既有档位（如 13/20 ＋ 14/24）。
- **代价**：**视觉会实际变化**——WorkCase 详情内页整体行距变松或变紧，需重新走查三个 WorkCase 节点面。
- **风险**：高。且与 `docs/04` §4「不得在这些语义块中回退到通用正文」直接冲突，等于要一并改 `docs/04` 的多处明文。

---

## 4. AI 倾向（供参考，不代替决定）

倾向**甲**。[推断] 理由：冲突的实质是「权威表未覆盖一个已存在的域」，而非「代码做错了」。甲以最小改动让权威声明变为真，不动任何视觉、不动守卫，避免把一次记账问题升级成一次视觉改版。乙次之（代价可接受，但保留一个需长期判断的例外）。丙不建议——它把记账问题转化成视觉改版，并须连带推翻 `docs/04` 多处明文。

---

## 5. 若采纳甲的精确改动（待批准后执行）

在 `plugin/web/docs/01-全局设计约束.md` §1.4 表内、`ldvh-card-decision-title` 行之后插入两行：

```
| 详情内页标题 | `ldvh-detail-semantic-title` | 14px / 22px | 500 | 仅 ObjectDetail 详情内页使用（`docs/04` §4）；其余页面用 `ldvh-card-title` |
| 详情内页正文 | `ldvh-detail-semantic-body` | 13px / 22px | 400 | 仅 ObjectDetail 详情内页使用（`docs/04` §4）；不得用于卡片或列表扫描窗口 |
```

并在 §1.4 表后补一句：

> 上表为全站字号唯一权威（`docs/11:18`）。`ldvh-detail-semantic-title` / `ldvh-detail-semantic-body` 两档是 ObjectDetail 详情内页专用档，其使用边界与理由见 `docs/04` §4；其余页面不得引用这两档。

---

## 6. 附带事实：两条机械守卫互相矛盾，且都自称在守本条规则

本项同源审核中另发现一处**更强的证据**，它不属于字号档位之争，而是直接说明「守卫可以互相打架」。**未作改动，仅登记。**

### 6.1 两条守卫对同一个类名给出相反要求

`plugin/web/src/components/WorkCaseCriteriaList.tsx:159` 的详情面正文分支无条件套用 `ldvh-card-decision-body`（`index.css:49-51` ＝ `text-xs leading-5` ＝ 12px/20px）。两条守卫对它的态度相反 [亲验]：

| 守卫 | 位置 | 断言 | 效果 |
|---|---|---|---|
| A | `tests/api/workcase-design-language-contract.test.ts:210`（test 名 `detail prose uses the detail reading level, not the 12px card scan level`，:198 起） | `assert.doesNotMatch(classNames, /ldvh-card-decision-body/, '详情正文不得复用 12px 卡片扫描层级——须用详情阅读层级')` | **禁止**详情正文用该类 |
| B | `tests/api/web-design-consistency-contract.test.ts:256` | `assert.match(layout, /ldvh-card-decision-body/)` | **要求**详情布局含该类 |

两条都引用**同一条规则**——A 的注释原文即 `docs/01` §1.4 约束第 4 条（`plugin/web/docs/01-全局设计约束.md:119`）：「卡片判断项标题和正文只用于 Card 的有限行数扫描窗口；详情页和阅读面板仍使用各自正文层级，不得随之缩小」。

### 6.2 两条都在断言同一个错对象，因而都恒绿

A 断言对象是 `layout` ＝ `WorkCaseReadingLayout.tsx` **单文件**（`:199` 读入），且其 `classNames` 只从该文件的 `className=` 提取后 join（`:204-206`）。B 同样断言该文件的源码串。关键事实 [亲验]：

- 12px 实际出现在**另一个文件**：`WorkCaseCriteriaList.tsx:159`；`WorkCaseReadingLayout.tsx:349` 只是 `<WorkCaseCriteriaList tone="residual" …/>` 的调用方，**该文件自身的 `className` 中并无此串**（`grep 'className=' … | grep -c` ＝ 0）。
- 故 **A 恒真**（永远绿），12px 从 `WorkCaseCriteriaList.tsx` 进入详情面**无人拦**。
- **B 也恒真**——因为该文件 `:152` 的注释文本里就写着这个类名，`assert.match` 只看源码是否含该串，注释同样命中。

### 6.3 为什么这值得单列

两处都不是「守卫写得不对」，而是**断言对象选错了**——都在断言 `WorkCaseReadingLayout.tsx`，而真正的承载点在 `WorkCaseCriteriaList.tsx`。结果是：同一条规则被两条守卫同时「守护」，两条都绿，规则被违反。B 更是把注释当成了证据——一条以「守护设计语言」为名的断言，实际只证明了「这个文件里有人写过这个词」。

这与 §1 的冲突**同型**：`docs/11:18` 说 `docs/01` §1.4 是唯一权威，`docs/04` §4 却另立了两档，而**守卫站在后者一侧**。两处合起来说明：本项目的机械守卫体系存在「**声明与执行者不是同一个**」的系统性缺口，而不只是单个遗漏。

**（本节不改任何文件，也不请求决定；如需处置，它与「发现 G」可合并为一项。）**

---

## 7. 附带事实（同源审核发现，一并备查）

以下三项与本项同由规范↔代码一致性审核得出，**已由提交 `682391b` 处置或在别处登记**，此处只作备查，不另请决定：

1. `docs/10` §4.2.3 的节点名与详情面实渲染曾有 4 处逐字不一致 —— 已同步（提交 `682391b`）。
2. 决策块壳的 `border-l-2` 与 `specs/10:298` 「语义块四边同为 1px」的关系 —— 机械守卫对它的锁定已摘除（提交 `682391b`），**争议本身仍未决**，见 `docs/design-language-unification-demo.html` §4。
3. 详情面正文掉到卡面扫描档（发现 G）——**未决**，见同演示页 §2；其守卫侧的完整证据见上文 §6。

---

**本文档不改动**：`plugin/web/docs/01`、`plugin/web/docs/04`、`plugin/web/docs/11`、`specs/` 任何文件、任何源码与测试。
