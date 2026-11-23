# 载体变更独立审核（撤 carries、补缺口、新增 controlled-commit）

- 审核对象：工作树 `plugin-specs/` 下 18 份已跟踪载体的改动 ＋ 新增未跟踪载体 `plugin-specs/controlled-commit.yaml`
- 审核基线：工作树版本 `specs/11-插件规范载体规范.md`（354 行）、`specs/09`、`specs/03`、`specs/00`、`specs/02`、`specs/36` 现行条文
- 审核角色：独立审核代理（不参与实施）
- 时间：2026-11-22
- 只读核对：`plugin/lib/runtime-carrier-validator.js`（未修改）、`plugin/lib/commit-validation.js`（未修改）
- 本审核未修改 `plugin-specs/`、`specs/`、`plugin/`、`ldvh-base/` 任何文件；未执行 `git add` / `commit` / `stash`

---

## 一、结论

**不通过。**

机械层（甲类 1–8 项与结构闭集）全部通过：19 份载体、521 条条目、validator 语料判定 `pass`，error/hint/gap 均为 0。但乙类语义审核有 6 处命中，按 `specs/11 §6.4 第 5 项`，**乙类命中不作不合格，但该次改动不得声明通过，须回退命中条目并重审**。此外有 2 处遗漏（曾由 `carries` 登记、现在无载体承载的运行期要求）与 9 处建议。

| 计数 | 数量 |
|---|---|
| 必须改（须回退命中条目并重审） | **6** |
| 建议改 | **9** |
| 遗漏（曾承接但现无载体承载） | **2** |
| 甲类命中 | 0 |
| 体量越界 | 0 |

---

## 二、机械核对结果（只读调用 validator）

语料：19 份载体 ＋ `specs/` 26 份开发规范（`buildDevelopmentSpecCorpus`：accepted 26、parseFailed 0、kindMismatch 0）。

```
carrierCount 19 · verdict pass · errorCount 0 · hintCount 0 · gapCount 0 · routerCount 0
```

逐份复核（独立于 validator 的 YAML 解析）：

- 19/19 顶层只有 `ldvh_spec`；六项身份字段齐备；`spec_kind` 均为 `spec`；`canonical_path` 逐字等于 `plugin-specs/<spec_key>.yaml` 且等于实际文件名。
- 19/19 无 `carries`、无 `spec_id`、无 `supersedes`/`parent_spec`/`relation`/`related_specs` 等关系类字段；无 `role`。
- 521/521 条目只有 `id`/`title`/`text`；`id` 文件内唯一、全部小写 kebab-case；无缺 `title` 或 `text`。

### 甲类第 3 项边界核对（实现 vs 文本）

`specs/11 §5.5 甲类第 3 项`：`§` 字符；或「第」＋一个或多个阿拉伯数字＋「章」「条」「节」，数字两侧可有空白。中文数字、全角数字、带小数点的编号归乙类第 14 项。

实现 `SECTION_PATTERN = /§|第\s*[0-9]+\s*[章节条]/g`（`runtime-carrier-validator.js`）。逐例探针（合成载体，只读调用）：

| 输入 | 期望 | 实际命中 |
|---|---|---|
| `第 12 条` | 命中 | ✅ 命中 |
| `第12章` | 命中 | ✅ 命中 |
| `§3.2` | 命中 | ✅ 命中 |
| `第\t7\t节`（数字两侧空白） | 命中 | ✅ 命中 |
| `第3.2节` | 不命中（乙类） | ✅ 不命中 |
| `第三条` | 不命中（乙类） | ✅ 不命中 |
| `第３条`（全角） | 不命中（乙类） | ✅ 不命中 |
| `见 3.2 节` / `（三）` / `Section 3` | 不命中（乙类） | ✅ 不命中 |

**判定：实现与文本一致。** 语料侧 0 命中；本审核另以补充正则扫描中文数字、全角数字、小数点编号、`见 N.N 节`、`（三）`、`Section N` 形态，521 条正文同样 0 命中。

---

## 三、19 份载体核验表

`条目数` / `字节` 为文件实测 UTF-8 字节（含注释与结尾换行）；`单条最长` 取 validator 的 `maxTextCodePoints`（已剔除结尾换行；本审核按含结尾换行另算亦全部 ≤ 600，最大差 1 码点）；`自足命中` 为甲类 1–6 命中数（含本审核补充的乙类 9/10/11/14 形态余项）。

| # | 载体 | 身份字段 | 条目数 | 字节 | 余量 | 单条最长 | 自足命中 |
|---|---|---|---|---|---|---|---|
| 1 | controlled-commit | 齐备 | 26 | 13943 | 6537 | 273 | 0 |
| 2 | experience-accumulation-system-foundation | 齐备 | 30 | 18439 | 2041 | 411 | 0 |
| 3 | fact-model-common | 齐备 | 30 | 17830 | 2650 | 316 | 0 |
| 4 | friction-fact-type | 齐备 | 30 | 20017 | **463** | 390 | 0 |
| 5 | friction-settlement-system-foundation | 齐备 | 30 | 19954 | **526** | 425 | 0 |
| 6 | gate-consult-system-foundation | 齐备 | 30 | 16893 | 3587 | 393 | 0 |
| 7 | goal-fact-type | 齐备 | 29 | 11872 | 8608 | 175 | 0 |
| 8 | goal-planning-system-foundation | 齐备 | 30 | 15355 | 5125 | 222 | 0 |
| 9 | ldvh-root | 齐备 | 29 | 17837 | 2643 | 349 | 0 |
| 10 | norm-fact-type | 齐备 | 25 | 14311 | 6169 | 289 | 0 |
| 11 | pitfall-fact-type | 齐备 | 30 | 15872 | 4608 | 253 | 0 |
| 12 | report-fact-type | 齐备 | 19 | 16201 | 4279 | 429 | 0 |
| 13 | research-system-foundation | 齐备 | 30 | 16295 | 4185 | 269 | 0 |
| 14 | rule-compliance-recall | 齐备 | 19 | 13925 | 6555 | 325 | 0 |
| 15 | rule-compliance-verification | 齐备 | 20 | 14901 | 5579 | 330 | 0 |
| 16 | service-contract | 齐备 | 27 | 9964 | 10516 | 118 | 0 |
| 17 | spark-fact-type | 齐备 | 30 | 17510 | 2970 | 302 | 0 |
| 18 | spark-record-system-foundation | 齐备 | 30 | 14294 | 6186 | 347 | 0 |
| 19 | subgoal-fact-type | 齐备 | 27 | 13688 | 6792 | 241 | 0 |

- 条目总数 **521**（与报备一致：26+30+30+30+30+30+29+30+29+25+30+19+30+19+20+27+30+30+27）。
- 体量最紧三份：`friction-fact-type`（余 463 B）、`friction-settlement-system-foundation`（余 526 B）、`experience-accumulation-system-foundation`（余 2041 B）。前两份已无再增条目的空间，后续补缺口必须走拆分或替换。
- 单条正文全部远低于 600 码点（最大 429 码点，`report-fact-type`）。
- 条目数上限 30：有 10 份正好 30 条（fact-model-common、experience-accumulation、friction-fact-type、friction-settlement、gate-consult、goal-planning、pitfall、research、spark-fact-type、spark-record），已满额，不能以「新增条目」补缺口。

### 自足性候选命中清单（逐条判定）

机械层 0 命中。本审核另以补充正则找出以下候选，逐条判定后**均不构成命中**，记录以备复核：

| 载体 :: 条目 | 候选形态 | 判定 |
|---|---|---|
| controlled-commit `docs-reference` | `docs/`、`plugin/web/docs/` 路径 | 不命中（乙类第 11 项）：这是该要求自身的规制对象，不是指向开发期材料的出处 |
| controlled-commit `git-gate-scope` | `README.md` | 不命中：受保护文档名，不是评审记录/计划/草稿/代码/测试文件 |
| norm-fact-type `carrier`、pitfall-fact-type `carrier`、report-fact-type `carrier` | `ldvh-base/...` 路径 | 不命中：事实源运行期路径，非开发期材料 |
| report-fact-type `internal-forms`、`not-report` | `docs/` 路径 | 不命中：同上，为规制对象 |
| friction-settlement `human-gate`、norm-fact-type `positioning-two-lines` | 「上述各项」「上述形态」 | 不命中（乙类第 9 项）：回指对象在同一条目内部、紧邻上文，非同文件他条目指引；仍建议重述（见建议 8） |
| 多份载体 | 「插件规范」「方向规范」「事实规范」 | 不命中（乙类第 10 项）：这些是跨两类文本的第三类名称（插件内规范规则／事实类型的类型名），未被用于单独指代「开发规范」或「运行时机制」之一 |
| controlled-commit `what-counts` | 「规范文本：插件侧的运行规则文本与需求文本」 | 不命中（乙类第 10 项）：未单独用「规范」指代其中一类，且两种文本已并列写明；但未使用契约用名，见建议 3 |
| report-fact-type `action-form` | 「参照其步骤与结论」 | 不命中：普通动词，非指向文本的指引语 |

---

## 四、新增与扩写条目的语义核对（乙类第 4、5、6 项）

本轮新增 19 条、扩写 3 处。逐条对照 `specs/00`、`specs/02`、`specs/03`、`specs/36`：

| 载体 :: 条目 | 对应条文 | 判定 |
|---|---|---|
| fact-model-common `type-routing-order` | 02 §6.4 | 相符（次序、门槛高者先命中、判据 4/5 不取第一个成立、多项分别落位、非本判断对象均覆盖）；**但漏「进入规则源须经人决定」这一门禁**（见建议 5） |
| fact-model-common `common-field-adoption` | 02 §7.1 | 相符（采用面登记、缺省不得伪造、公共语义一致、改动评估全部类型与消费者、无统一关键词字段） |
| fact-model-common `object-designation` | 02 §9.3 | 相符（最小形态、紧随标题、完整标识、不可解析不得补前缀、路径不是指称、同形不构成证据、单例例外、机械边界） |
| fact-model-common `read-path-kinds` | 02 §10.2 | 相符（四类能力范围、机械有效边界） |
| fact-model-common `consumption-four-conclusions` | 02 §9、§9.2 | 相符（四结论、候选/机械/命中不能替代语义消费、进入条件、中间产物不进候选） |
| ldvh-root `proxy-review-arrangement` | 00 §2.5 | 相符（代理审核/复核的执行体、非必经、两处请示、安排即按该类办、结论不构成授权或完成凭据、不减免强制门禁） |
| ldvh-root `review-modes` | 00 §2.5 | 相符（两种复核形态、分歧未处置不得声明通过、视角按风险取最小充分组合、两者不互替） |
| ldvh-root `protected-content` | 00 §3.3 | 相符（五类受保护内容、四项程序、非实质修正不减免） |
| ldvh-root `carrier-establishment` | 00 §2.9、§4.4 | 相符（人决定＋决定前独立审核＋修复真问题＋取得准入方生效；三条禁止） |
| ldvh-root `execution-layers` | 03 §5.5 | 相符（三层内容与互不替代、两层不等于价值、三种分层不混用）；归属见建议 5 |
| ldvh-root `value-material` 扩写 | 00 §5.2（第 299、302 行） | 相符（两侧证据链不可替代不可折算、核对面各自的判据、未发起即未产出） |
| rule-compliance-verification `evasion-signals` | 03 §5.3 | 相符（五类来源、只聚合、不另建审计或外部账本、触发即停止或降级）；范围归属见建议 4 |
| rule-compliance-verification `record-reuse` | 03 §7.3 | 相符（三条件、不成立须重做受影响部分、不得无差别重扫） |
| rule-compliance-verification `degradation-order` | 03 §8.1 | 相符（四步次序、不得直接降为更轻路径、重分类依据入记录、能力不足不是风险降低证明） |
| rule-compliance-verification `degradation-declaration` | 03 §8.2 ＋ §8.3 | **语义相符但一条装两件事**：前段是「降级声明」，后两段是「降级禁止」，动作对象与判据不同，按 §5.3 拆分判据应拆成两条 → 乙类第 4 项命中（见必须改 6） |
| rule-compliance-verification `entry-exit-contract` | 03 §5.1 | 相符（六件事、缺一不成立、候选不证明适用、不得猜着执行） |
| rule-compliance-verification `conclusion-gate` | 03 §5.4 | 相符（六条件、静态存在/打勾/工具成功/人已回应/提交创建不单独替代） |
| rule-compliance-verification `verdict-not-exploration` | 03 §6.3（a)(b)(c) | 相符（探索与求解可留快通道、带取舍倾向的结论须走标准路径、不得临时切分、不得宽到只剩写入、边界不清按整个系统） |
| rule-compliance-verification `record-format` | 03 §7.2 | 相符；**但以「至少写这几部分」列出记录字段面，接近字段契约**，且与 03 §7.2 的格式块同源复制（见建议 2） |
| rule-compliance-verification `fast-path-declaration` | 03 §6.2 | 相符（五件事、不得声称不属于任何风险层、不得自设中间层） |
| friction-settlement `buffer-what` 扩写 | 36 §8.8、§14「写入合法」「到期淘汰的登记」两行 | **语义有出处，形态违规**：新增段落把 14 项条目字段以「固定闭集」列出，并写「状态初值只有待晋升」——属字段契约与取值闭集，按 §5.4 第 3 项、乙类第 6 项不得写入条目正文（见必须改 1） |
| friction-settlement `fail-closed` 扩写 | 36 §14「运行完成」行 | **语义有出处，形态与归属违规**：新增「取值只有通过、不过、不可判三种」属取值闭集；且「一次运行如何判定完成」与「校验不过就停下」是两件事，装进同一条（见必须改 2） |

**乙类第 5 项（可判定）**：新增 19 条均能回答「某次具体行动是否满足它」，除 `record-format`（「至少写这几部分」可判，但「该格式可以扩展」使边界依赖读者判断）外无不可判定条目。

**乙类第 6 项（只写要求）**：命中 3 处——`buffer-what`（字段闭集）、`fail-closed`（取值闭集）、`controlled-commit` 的 `precheck-checks`/`docs-reference`/`fact-carrier-identity`（外部检查清单整条复制，见第五节）。

---

## 五、`controlled-commit.yaml` 26 条逐条对应与问题

与 `specs/09` 现行条文逐条对照（该载体内容取自被删除前版本，本轮只删 `carries`、删头部注释、改一处指称）：

| # | 条目 | 对应 09 条文 | 判定 / 问题 |
|---|---|---|---|
| 1 | what-counts | §5.5 分派落点 | 对应；类别改用「运行规则文本／需求文本」，未用契约用名（建议 3） |
| 2 | message-header | §5.1 Header | 对应；但删去「过渡期兼容 `type(scope)`」及终止条件，把作者侧「不得新写」写成绝对禁令，与 09 现行过渡期条文口径不完全相同 |
| 3 | message-body | §5.1 Body | 对应 |
| 4 | message-diff-match | §5.1 防自欺核心规则 | 对应 |
| 5 | message-trailer | §5.1 Trailer | 对应 |
| 6 | trailer-unavailable | §5.1 路由不可得 | 对应（预检三值 vs 提交缝阻断的刻意差异写明） |
| 7 | message-reference | §5.1 message 指称 | 对应但弱化：「人能回读定位到那一个对象的样子」不可判定，09 明确按 02 §9.3 的形态（建议 9） |
| 8 | precheck-when | §5.3 触发时机 | 对应 |
| 9 | precheck-result | §5.4 三值 | 对应 |
| 10 | **precheck-checks** | §5.3 第 1–4 项 | **问题**：逐项照抄外部机械检查清单（Header/Body/列表匹配/路径覆盖/Trailer），乙类第 6 项命中；且「不带括号 scope 段」与实现 `HEADER_PATTERN`（接受 `type(scope)`）矛盾 |
| 11 | **docs-reference** | §5.3 第 5 项 | **问题**：照抄检查清单；并把检查范围收窄为「候选里新增或修改的规则载体」，漏掉 09 明列的**事实载体**与 `README.md`/`plugin/README.md`；实现 `commit-validation.js` 的 `isCarrierDocPath` 实际含 `ldvh-base/`、`README.md`、`plugin/README.md` → 载体被自身实现推翻 |
| 12 | **fact-carrier-identity** | §5.3 第 8 项 | **问题**：把四项判定条件（不一致/重复/不可读/文件名不含身份）整条复制，乙类第 6 项命中 |
| 13 | git-gate | §5.5 同一 validator、非 passed 即阻断 | 对应 |
| 14 | git-gate-scope | §5.5 分派、README 分叉、Index 为空 | 对应（实现 `isGovernedCommitPath` 只含 `ldvh-base/`、`specs/`、`plugin-specs/`，与「README-only 放行」一致） |
| 15 | snapshot-consistency | §5.5 快照一致性 | 对应 |
| 16 | stage | §5.7 第 1 步 | 对应（含路径限定不等于授权范围的边界） |
| 17 | create-commit | §5.7 第 2 步 | 对应 |
| 18 | readback | §5.7 第 3 步 | 对应 |
| 19 | readback-both-directions | §5.7「多出」「漏掉」 | 对应 |
| 20 | self-report-list | §5.7 自报清单独立性 | 对应 |
| 21 | ownership | §5.7 共享工作区归属 | 对应 |
| 22 | worktree-safety | §5.7 工作树整体改写禁令 | 对应 |
| 23 | evidence-boundary | §5.1/§7 证明边界 | 对应 |
| 24 | stop | §9.1 | 对应；**缺第 5 项**（机械扫描成员集合与 01 §9.2 条件不一致）——该条是否属受控提交域内必停，需 Human 判断 |
| 25 | stop-allowed | §9.2、§9.3 | 对应 |
| 26 | protected-merge | §5.6 | 对应（4 项机械识别、Merge-Touched 申报、只覆盖本地 Merge） |

### 与实现的其它漂移（不归载体，但须如实登记）

1. `HEADER_PATTERN` 只接受 `feat|fix|docs|refactor|test|chore|build|ci|perf|style` 闭集，09 §5.1 与载体只要求「小写 ASCII 单词」——实现比规范更严，属既有实现漂移。
2. 实现另有 `validation/header_not_chinese`（描述须含中文），09 与载体均无此要求，实现自认「implementation gap 2026-10-19」。
3. 实现接受 `type(scope)` 双段形式，09 过渡期可接受，载体第 2 条写作「不写」，第 10 条写作「预检判不带 scope」——第 10 条与实现直接矛盾。

### 是否仍以「开发规范」为规则源指称

全文已无「开发规范」字样；但第 1 条改称「需求文本」，属自造对名。按 11 §5.4 第 10 项**不构成命中**（未单独用「规范」指代其一，且两类别已并列写明），但建议回到契约用名（建议 3）。

---

## 六、同题不同口径

### 6.1 frontmatter 与正文是否要求逐字一致

- `specs/20 §14.1`（Goal）要求**载体内聚**：`title`、`scope`（若采用）等 frontmatter 权威字段与正文对应段逐字一致，frontmatter 为唯一权威文本。
- `specs/22`、`25`、`26` 明确**取消**「载体内聚」（Human 决定），`specs/23` 明确「不要求正文逐字复现文件头标量」。

载体侧：

| 载体 | 载体侧口径 |
|---|---|
| goal-fact-type `body-structure` | 「一级标题只有一个、与标题一致」——覆盖 `title`↔H1 逐字这一层；`scope` 未采用故不适用。未写出「frontmatter 为唯一权威文本，正文只展开」 |
| spark-fact-type `carrier-structure` | 「字段区是索引与摘要、正文是展开，两者不要求逐字一致」 |
| pitfall-fact-type `carrier` | 「文件头与正文不要求逐字一致；差异如实报告，不阻断写入」 |
| norm-fact-type `carrier` | 「不要求正文逐字复现文件头标量」 |
| friction-fact-type | **无对应条目**（26 §164「不要求逐字一致」未承载） |

**判断**：载体侧没有对同一要求给出两种相反口径——Goal 是单列类型、其余类型取消义务，属不同领域边界，不构成跨载体分歧。**但**：(a) Goal 侧只写到 H1 一层，未写「唯一权威文本」；(b) friction 侧整条缺失。两者都是覆盖不全，不是口径冲突。覆盖率核对表把 Goal §14.1 记为「部分」并称「两处口径相抵」，本审核认为**不构成相抵**，但「部分」的结论成立。

### 6.2 摩擦发现派发的准入口径

- `specs/36 §7.6`：触发锚为「主控判定出现阻碍现象」，上下文供给段写明「原文材料及其定位信息（**缺失或不可核时不得执行自动动作**）」——这实际上是一条准入条件。
- `specs/36 §14`「派发准入」行：称「§7.6 现不设任何准入约束——本行当前不产生判定」，又说「派发的准入由 §7.6 的进入契约界定」——**36 号自身前后不一致**。

载体侧：`friction-settlement-system-foundation::discovery-trigger` 写「判定出现了阻碍现象时……派一个隔离子代理去跑那套动作」；`discovery-context` 写「缺了或核不到，就不许跑那套动作」。

**判断**：载体采的是 §7.6 的实质口径（材料缺失不得派发），与 §7.6 一致；与 §14「本行当前不产生判定」在字面上不同。**这不是载体侧的同题两口径**，而是开发规范自身的内部矛盾。建议交还 Human 裁定后修正 36 §14 的该行表述，不应由载体单方面择一。

### 6.3 其它抽查

- 受保护内容清单：`ldvh-root::protected-content` 与 `controlled-commit::protected-merge` 列举一致（总纲、仓库说明、AI 面向语义文本、许可文本、版本声明点）。
- 风险分层：`rule-compliance-verification::risk-tier`（默认标准路径、纯读取可快通道、授权边界判断不得产自快通道）与 `verdict-not-exploration`、`fast-path-declaration` 一致。
- 无另发现两份载体对同一要求给出两种口径。

---

## 七、撤除 `carries` 是否丢了信息（抽样 12 份）

原 120 条锚点分布在 18 份已跟踪载体（另 `controlled-commit` 旧版 7 条，合计 127）。抽核 12 份，逐条回查其 `carries` 指向节的实质条文在载体条目中的落点（依据 = 逐节读原规范正文 ＋ 与载体条目正文对照）：

| 载体 | 抽核的 carries 目标节 | 结论 |
|---|---|---|
| fact-model-common | 02 §6.1、§7.1、§8.1、§8.2、§10.1、§10.5 | 均有条目对应 |
| fact-model-common | 02 **§15.1** | **不完整**：第 2 项（以目录/Schema/代码/工具响应替代类型权威）、第 13 项（发现与上位或人已定决策冲突）无对应条目；第 7 项（分层混用）由 `ldvh-root::execution-layers` 部分覆盖 |
| goal-fact-type | 21/20 §8、§9、§10、§12、§13、§17 | 均有条目对应 |
| goal-fact-type | 20 **§14.1 载体内聚** | **部分**：仅 `body-structure` 覆盖 title↔H1；「frontmatter 为唯一权威文本」未写出 |
| spark-fact-type | 22 §8、§9.1、§9.4、§12、§13、§14.1、§16 | 均有条目对应 |
| subgoal-fact-type | 21 §6.2、§6.3、§7、§8、§13、§17、§18 | 均有条目对应 |
| norm-fact-type | 23 §5、§6.1、§8.1、§10、§11、§14、§15.2 | 均有条目对应 |
| report-fact-type | 24 §5、§7、§8、§12、§13、§17.1、§18 | 均有条目对应 |
| pitfall-fact-type | 25 §6.2、§9.3、§9.4、§10、§12、§13、§17 | 均有条目对应 |
| friction-fact-type | 26 §4.2、§9.2、§9.3、§9.4、§11、§12、§13 | 均有条目对应 |
| friction-settlement | 36 §7.5、§7.6、§8.2、§8.6、§8.7、§8.8、§9.4 | 均有条目对应 |
| rule-compliance-verification | 34 §8.1、§12、§16.1、§17 | 均有条目对应；本轮补齐 03 §5–§8 公共机制 |
| service-contract | 05 §5.2、§6.1、§6.2、§7、§8、§9.3、§12.1 | 均有条目对应 |
| ldvh-root | 00 §2.4、§2.5、§2.9、§3.4、§4.5、§4.7、§5.2 | 条目对应，§2.5 本轮补齐 |
| controlled-commit（旧版） | 09 §5.1、§5.3、§5.5、§5.6、§5.7、§6、§9.1 | §5.x/§9.1 有对应；**09 §6 规则源成员的生效与退出无对应条目**（该节属开发规范面成员管理，是否需运行期载体承载待 Human 判断） |

**结论**：

1. **`carries` 是登记，不是内容。** 撤除它没有删除任何条目正文，因此「运行期要求本身」没有因撤除而消失。
2. **但它抹掉了唯一一处「哪一节曾由哪份载体承接」的对应关系。** 撤除后，覆盖核对只能靠人工逐节重做，§5.4 第 5 项的「不重复规则」也失去可比对的对象。这是信息损失，且是设计上接受的损失（`specs/11 §6.3` 已规定载体面不设替代/关系字段）。
3. **抽样发现 2 处「曾承接但现在承载不完整」**（02 §15.1 第 2、13 项；20 §14.1 的权威文本层），另有 1 处属开发规范面成员管理（09 §6）需 Human 判断是否需要运行期承载。它们不是撤除造成的，但撤除后**不再有任何登记能提示它们存在**——按本审核口径列为遗漏。

---

## 八、载体里多出来的要求（规范中无出处）

对「有出处疑点」的条目逐条回查（本轮新增 19 条、扩写 3 处全部覆盖，另抽核 6 份载体的 10 条既有条目）：

| 条目 | 出处 | 判断 |
|---|---|---|
| `type-routing-order` | 02 §6.4 | 有对应条文（漏「进规则源须人决定」） |
| `common-field-adoption` | 02 §7.1 | 有对应条文 |
| `object-designation` | 02 §9.3 | 有对应条文 |
| `read-path-kinds` | 02 §10.2 | 有对应条文 |
| `consumption-four-conclusions` | 02 §9、§9.2 | 有对应条文 |
| `proxy-review-arrangement` | 00 §2.5 | 有对应条文 |
| `review-modes` | 00 §2.5 | 有对应条文 |
| `protected-content` | 00 §3.3 | 有对应条文 |
| `carrier-establishment` | 00 §2.9、§4.4 | 有对应条文 |
| `execution-layers` | 03 §5.5 | 有对应条文 |
| `evasion-signals` | 03 §5.3 | 有对应条文（少了「信号清单可增删」的弹性，属收紧，非自造） |
| `record-reuse` | 03 §7.3 | 有对应条文 |
| `degradation-order` | 03 §8.1 | 有对应条文 |
| `degradation-declaration` | 03 §8.2＋§8.3 | 有对应条文（两节合并成一条） |
| `entry-exit-contract` | 03 §5.1 | 有对应条文 |
| `conclusion-gate` | 03 §5.4 | 有对应条文 |
| `verdict-not-exploration` | 03 §6.3 | 有对应条文 |
| `record-format` | 03 §7.2 | 有对应条文 |
| `fast-path-declaration` | 03 §6.2 | 有对应条文 |
| `buffer-what` 新增段 | 36 §14「写入合法」行、§8.8 | 有对应条文（形态违规，见必须改 1） |
| `fail-closed` 新增段 | 36 §14「运行完成」行 | 有对应条文（形态与归属违规，见必须改 2） |
| `value-material` 新增两句 | 00 §5.2 | 有对应条文 |
| 抽核：`controlled-commit::snapshot-consistency`、`readback-both-directions`、`self-report-list`、`ownership`、`worktree-safety` | 09 §5.7 | 有对应条文 |
| 抽核：`service-contract::catalog-not-whitelist`、`callable-does-not-authorize`、`no-fake-receipt` | 05 §6.1、§6.2、§9.3 | 有对应条文 |
| 抽核：`spark-record::business-not-order`、`suspended-not-progress`、`stale-not-discard` | 31 §8 | 有对应条文 |
| 抽核：`gate-consult::silent-keeps-check`、`silent-not-expand`、`exclusion-beats-mode` | 32 §6.3、§9 | 有对应条文 |

**结论**：本轮改动**没有发现规范中无出处的自造要求**。问题全部在「把有出处的内容写成了不该写的形态」与「写漏了有出处的内容」。

---

## 九、必须改（6）

1. **`plugin-specs/friction-settlement-system-foundation.yaml:184`（`buffer-what`）**：新增段落以「条目字段落在固定闭集内……标识、时间、项目、会话、锚点、现象、证据、分组、目标对象、标题、依据、归因、状态、晋升去向」列出 14 项字段闭集，并写「状态初值只有待晋升」——字段契约与取值闭集进了条目正文，乙类第 6 项命中。应改为只用本领域的话写「写入必须齐备哪些意思、缺项即不合法且拒绝该条」，不列字段清单。
2. **`plugin-specs/friction-settlement-system-foundation.yaml:278`（`fail-closed`）**：新增「取值只有通过、不过、不可判三种」属取值闭集（乙类第 6 项）；且「一次运行结束如何判定整轮成立」与「校验不过就停下」是两个动作对象（乙类第 4 项）。应拆为两条，并把三值改为散文表述。
3. **`plugin-specs/controlled-commit.yaml:84`（`precheck-checks`）**：整条复制 09 §5.3 第 1–4 项的机械检查清单（标题即「预检逐项判什么」），违反 §5.4 第 5 项与乙类第 6 项。应改写成对提交者的行动要求（消息须满足什么、列表须与差异对应），不以「预检判什么」的清单形态列出外部检查项。
4. **`plugin-specs/controlled-commit.yaml:94`（`docs-reference`）**：同属复制检查清单；且检查范围收窄为「规则载体」，漏掉 09 §5.3 第 5 项明列的**事实载体**与 `README.md`、`plugin/README.md`；与 `plugin/lib/commit-validation.js` 的 `isCarrierDocPath`（含 `ldvh-base/`、`README.md`、`plugin/README.md`）矛盾，构成「被自身实现推翻」。须补全范围或改成不与实现冲突的表述。
5. **`plugin-specs/controlled-commit.yaml:102`（`fact-carrier-identity`）**：把 09 §5.3 第 8 项的四项判定（不一致/重复/不可读/文件名不含身份）整条复制为自己的条目，乙类第 6 项命中。
6. **`plugin-specs/rule-compliance-verification.yaml:163`（`degradation-declaration`）**：一条同时装「降级声明」与「降级禁止」，按 §5.3 拆分判据应拆两条（乙类第 4 项）。

## 十、建议改（9）

1. `controlled-commit::precheck-checks`「Header 是小写 type 加一句描述，不带括号 scope 段」与实现 `HEADER_PATTERN`（接受 `type(scope)`）矛盾，也与 09 §5.1 的过渡期兼容条文冲突；建议删去「不带括号 scope 段」的机械判定表述，只保留作者侧「不得新写」。
2. `rule-compliance-verification::record-format` 用「至少写这几部分」列出记录字段面，接近字段契约且与 03 §7.2 的格式块同源复制；建议只写「记录须随交还呈现且覆盖已确认来源、授权、召回、未验证范围与快慢路径依据」这类要求，不复刻格式清单。
3. `controlled-commit::what-counts` 用「运行规则文本／需求文本」替代契约用名「运行时机制／开发规范」；虽不命中 11 §5.4 第 10 项，建议回到契约用名，避免第三套对名。
4. 03 §5.1–§5.5、§6、§7、§8 是**业务系统公共要求**，本轮全部落进 `rule-compliance-verification`（双源召回·核对面）一份载体；其余六个业务系统载体不承载，读者只读各自载体时读不到这些公共机制。建议明确这类公共机制由哪份载体统一承载（或声明该载体为公共机制入口），否则归属面偏窄。
5. `ldvh-root::execution-layers` 承载的是 03 §5.5「业务系统执行分层」，却放在总纲载体（定位为「所有行动」）；文本已限定「一次系统执行」，尚可接受，但建议在 `positioning`/`scope` 或条目上明示其适用面为系统执行。
6. `fact-model-common::type-routing-order` 漏「进入规则源须经人决定」，使「门槛高者先命中」的理由缺了门禁层；建议补一句。
7. `goal-fact-type::body-structure` 只写 H1 与标题一致，未写「frontmatter 为唯一权威文本、正文只展开」；建议补这层（`scope` 未采用可说明）。
8. `friction-settlement::human-gate`「上述各项」、`norm-fact-type::positioning-two-lines`「上述形态」建议改为就地重述要点，避免回指式措辞。
9. `controlled-commit::message-reference` 把 02 §9.3 的指称形态弱化为「人能回读定位到那一个对象的样子」，不可判定；建议写成本领域可判的形态要件（类型短名＋前 8 位小写十六进制；需要辨认时紧随标题），不引用外部条文。

## 十一、遗漏（2）

1. **02 §15.1 第 2 项与第 13 项**：`fact-model-common` 原 `carries` 指向 02 §15.1，但载体无「不得以目录/Schema/代码/工具响应替代类型权威」「发现与上位规范或人已定决策冲突即停」的条目；第 7 项（分层混用）仅由 `ldvh-root::execution-layers` 部分覆盖。
2. **26「frontmatter 与正文不要求逐字一致」**：spark/pitfall/norm 三份载体各有明确条目，`friction-fact-type` 无对应条目（26 §164、§330）。建议补，但该载体只剩 463 B，须替换而非新增。

---

## 十二、如实声明

- 本审核**未逐条**核对 521 条中的全部既有条目：本轮新增 19 条与扩写 3 处逐条核过；既有条目按「有出处疑点」抽核 6 份载体 10 条，其余未审范围如实保留为未审。
- 覆盖核对表 `docs/reviews/2026-11-22-runtime-clause-coverage-table.md` 被本审核当作**线索**使用（其自述 374 条为「标题映射、未逐字核」），凡引用其结论处本审核均回到 `specs/` 原文复核；未复核其全部 737 行。
- 甲类第 3 项的边界核对是在合成载体上做的探针，只证明该正则对上述 10 个样例的判定，不证明全部形态；误伤量测未在新增语料上重做（本轮未改甲类口径，按 11 §5.5「误伤量测」只对新增/修改口径触发）。
- `controlled-commit` 是否属「复制外部检查清单」存在一处可争的读法：该载体正是受控提交领域的载体，09 §5.3 的检查项是其本领域内容。本审核按 11 §5.4 第 5 项字面判定为命中（载体应以本领域行动要求表述，而非以「预检逐项判什么」的清单形态复刻）；若 Human 认定该载体即为该清单的领域承载，第 5 节第 10–12 条可降为建议，但第 11 条的**范围收窄与实现矛盾**仍须修改。
- 本审核未运行 `plugin` 的测试套件；`commit-validation.js` 的结论来自源码阅读（`HEADER_PATTERN`、`isGovernedCommitPath`、`isCarrierDocPath`），未做运行时验证。
