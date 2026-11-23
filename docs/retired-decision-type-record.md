# ADR 事实类型清退 · 收口留痕（2026-11-16）

> **性质声明**：本文件是**临时文档**，不是规范载体或事实载体，不构成任何权威依据（`09 §5.3` 第 5 项）。它是本次清退的**执行记录**，供接手者核对「做了什么、口径是什么、例外有哪些、还差什么」。
>
> 权威顺序：各受控提交的实际 diff 与 message > git 历史 > 本文件。本文件的任何陈述与上述不符时，以上述为准。
>
> 本文件不新增规则、不改变任何规范的效力、不使任何未决事项取得结论。

---

## 1. 本次范围决定（Human 逐轮裁定）

| 轮次 | Human 裁定 | 作用范围 |
|---|---|---|
| 1 | 「ADR 要清退干净」 | 开启本任务 |
| 2 | 「B 全仓抹去 ADR 字样」 | 初始口径（后经第 4 轮重定） |
| 2 | 「授权删除，连归档也删」 | `ldvh-base/adrs/` 17 条 + `docs/adr-archive/` 18 份 |
| 2 | 「按受保护文本处理」（注入文案） | ② 走 `00 §3.3` 加严流程 |
| 3 | 「本批启动规范层根决定修订」 | 规范层另批 |
| 3 | 「全删，含两份临时文档」 | `docs/adr-retirement-batch2/3-*` |
| 4 | **「接受重定口径」** | **B 档收缩为：当前工作树 + 当前规则源的活机制/活文案/活载体退出 + 显式登记的字面例外 + git 历史不抹** |
| 4 | 「一次性根决定留痕（推荐）」 | **不新增 `00 §3.6` 常设通道**；规范层不做 16 处改写，只做逐处判定与留痕 |
| 4 | 「①+②+删原件/归档」 | 本批交付范围 |

**重定口径的理由（审核证成，非 AI 自决）**：独立审核（agent-6）证明「全仓字面零命中」在合法通道内不可达——
- `change_log[].summary` 是 Code 托管、只追加，无改写/删除通道（`02 §10.7` 禁直接普通编辑 canonical 载体）；
- `34 §8.4` 两处 Human 决定逐字引文，改写即「非原话却自称逐字」，违 `00 §4.6`；
- 外部真实专名（Nygard ADR、MADR、`ADR-FORMAT.md`、`ADR-0001/0002` 等）改写即对第三方事实作错误陈述；
- `24 §8` 不变量 7（`confirmed_statements` 与正文逐字对应）与 `26 §14.1`（resolved 必有 informs 且目标可解析）从机械层禁止改写。

故按 `00 §3.4`（决定作用范围变化须重新核对）回 Human 重定，Human 答「接受重定口径」。

---

## 2. 已完成（5 个受控提交，全部 precheck passed + Git Gate 通过）

| 提交 | 内容 | 文件 |
|---|---|---|
| `c9b236b6` | 代码层主批：注销 `registerAdrTools`、删 3 专属模块 + 4 专属测试、去召回/注入/Gate/解析全链路活 ADR 逻辑、45 测试同步 | 77（+879/−6404） |
| `4aef5842` | 注入面独立提交（`00 §3.3` 加严）：`GATE_POINT_EXCLUSIONS` 删第 4 类整条 → 点位排除回三类 | 3 |
| `c06beb85` | 面向 Human 文案：中英 6 条 hint 四→三、去 ADR 关口 | 2 |
| `d8d75e85` | 删除批：17 原件 + 18 归档 + 2 临时文档物理删除 | 37（36 D + 1 M） |
| `8c19db55` | 并行会话收口（非本任务提交，含 Web 层与召回侧） | 31 |

### 2.1 删除清单（不可逆，仅 git 历史回取）

| 对象 | 数量 | 删前核对 |
|---|---|---|
| `ldvh-base/adrs/adr-*.md` | 17 | 全部 `status: retired`；归档副本 17/17 与原件**逐字一致**（Python 字节级 `endswith` 比对） |
| `docs/adr-archive/*.md` | 18（17 副本 + README） | 同上；删除前 `specs/`、`ldvh-base/` 对该路径零活引用 |
| `docs/adr-retirement-batch2-decision-brief.md` | 1 | 承载 G1–G5 Human 裁定；删后留痕改由提交消息与 git 历史承载 |
| `docs/adr-retirement-batch3-plan.md` | 1（未跟踪） | 承载 H1–H6 Human 裁定；同上 |

**逐字证据的可核性减损（如实登记）**：上述内容不再在盘上，其逐字形态改由 git 历史承载（`git show <hash>:<path>`）。G1–G5 / H1–H6 裁定的逐字文本不再存于工作树。本条登记该减损，不以「已由提交承载」为由声称仓内可核性未变。

### 2.2 活机制退出（当前工作树可观察）

| 面 | 状态 | 证据 |
|---|---|---|
| 工具注册 | 已注销 | `grep -c registerAdrTools plugin/lib/ldvh-tools.js` → 0 |
| `ldvh_adr_*` 工具 | 无注册 | `grep -rhc "toolName:.*ldvh_adr" plugin/lib/*-tools.js` → 0 |
| ADR consent seam | 整段删除 | `grep -c ADR_CONSENT_QUESTION_ID plugin/lib/host-seams.js` → 0 |
| 决策基线整段 | 删除 | `decisionBaseline` / `adrTotal` / `ADR_BASELINE_BYTE_BUDGET` 无消费点 |
| 点位排除 | 三类 | `GATE_POINT_EXCLUSIONS` 长度 = 3 |
| 类型登记 | 六类 | `REGISTERED_FACT_TYPES` 无 `adr`；`L0_SEGMENT_ORDER = ["norm"]`；`REQUIRED_RECALL_TYPES = ["pitfall"]` |
| 预检「已召回」段 | 单级 | `RECALLED_SUB_LABELS = ["Pitfall"]`（对齐 `03 §7.2` 现行模板） |
| 注入判据 | 两键 | `DECISION_KEYS` 去 `baselinePresent`（恒假死键），保留「有候选，或有常驻索引内容」 |

---

## 3. 显式登记的字面例外（**不改写**，附依据）

### 3.1 `specs/` 16 处（8 文件）——撤回留痕 / Human 决定逐字引文 / 沿革注记

| 位置 | 性质 | 不改写依据 |
|---|---|---|
| `02:166` | 判据 2 废止留痕 + 编号冻结 | 承载 G1 裁定的减损登记与编号不复用；删则判据 8/9 引用链无锚 |
| `10:119` | 「原 ADR 决策基线索引段已随类型撤除而废止」 | 指向 `34 §8.4` 撤回留痕的指针 |
| `24:407` | 「如已撤除的 ADR 类型曾有的形态」 | 唯一参照；删则失去对照（审核建议重写参照而非删除，但改写仍属规范正文修改） |
| `27:36` | 历史文件名 `research-adr-to-norm-boundary.md` | 已标注「历史文件名，内容可自该提交回取」；删则失去说明对象 |
| `27:215` | `absorbed-into` 机制废止的如实声明 | 否定性披露本身即规范职责（`00 §4.6`） |
| `31:270` | 「ADR 去向于 2026-11-15 随类型撤除而废止」 | 判据去向沿革，与 DevLog 注记同格 |
| `32:96` | 「2026-11-15 随 ADR 撤除删除第 4 类」 | Human 决定的作用范围链（`00 §3.4`） |
| `32:101` | 第 4 类删除留痕（F8/F10） | F8 核对面去向 + F10 实现侧缺口登记，删则义务失去落点 |
| `34:266` | **Human 决定逐字引文 + 撤回留痕** | 改写即伪造引文（`00 §4.6`）；且 `34:312` 的论证链依赖此处的先行词 |
| `34:268` | **Human 决定逐字引文（旧的）** | 同上；该段自带「按当时原话逐字保留」的纪律 |
| `34:270` | 「原 ADR 决策基线随类型撤除而废止」 | 指向 266 的指针 |
| `34:274` | 「原三类比较中的 ADR」+ 实测「ADR 段 292 字节」 | 实测数据是论证支点；删则失去比较基准 |
| `34:299` | 「2026-11-15 随 ADR 撤除重述」 | 预算次序改述的作用范围链 |
| `34:312` | 「ADR 决策基线」根因论证 | 技术论证链枢纽；抹掉根因则「判据里不能有恒假项」的教训失去来历 |
| `34:324` | 「原 ADR 决策基线已随类型撤除而废止」 | `01 §11.3` 旧规则去向留痕 |
| `35:257` | 判据 2 废止留痕 | 与 `02:166` 同批，必须同口径 |

**统一依据**：`00 §3.4`（已登记决定的可核性）、`02 §6.1` 第 3 条（权威对象证据自足）、`34 §8.4` 撤回留痕、`01 §11.3`（旧规则去向必须说明）。

### 3.2 `ldvh-base/` 125 份事实对象（历史叙述）

| 类型 | 含该字样 | 总载体 |
|---|---|---|
| frictions | 50 | 125 |
| sparks | 36 | 87 |
| reports | 19 | 50 |
| pitfalls | 18 | 109 |
| norms | 2 | 5 |
| subgoals | 0 | 9 |

**不改写依据**：正文里的指称是**历史叙述与实测记录**（如「按 ADR `2a521398` 裁定」「`adr-writer.js:644` 行号级实测」「七类 311 个对象」），改写会——破坏证据自足（`02 §6.1` 第 3 条）、篡改历史计数、对第三方文档作错误陈述。且绝大多数为终态对象，逐份 `correct` 须逐份 `human_authorization`，而该字段是自报（`26 §13:313` 明写「不证明 Human 真的作过该授权」），替 Human 代填 125 次即不诚实。

### 3.3 `docs/` 13 份 + 测试合成夹具 3 处

- `docs/devlog-archive/` 8 份：DevLog 撤除批的逐字历史档案，改写即破坏其逐字性（`91b3d727` 先例）。
- `docs/governed-project-lifecycle-verification.md` 等 5 份：历史核验记录。
- `plugin/test/coherence-report.test.mjs:58,62` 的 `22 §8`、`plugin/test/recall-criteria.test.mjs:79-80` 的 `specs/22-ADR-决策.md` 夹具：**合成数据**，用于测解析器通用能力与「条款号由调用方原样透出」，不指向盘上真实文件；改动会削弱测试覆盖。

### 3.4 `plugin/lib` 撤回留痕引文与 Human 决定原话（9 处）

`recall-injection.js:276,882`、`source-recall.js:218,1003,1005,1032,3081,3608,3640`——逐字引用 `specs/34 §8.4` 的撤回留痕与 Human 决定原话。**不改写依据**：代码注释引用规范原文时，改写即与规范源不一致；`01 §11.4` 禁 Code 制造第二规则源。

### 3.5 依赖真实对象标题的字面量

`plugin/scripts/backfill-spark-priority.mjs:34` 的 `'ADR → Norm 转向机制缺口': 'P1'`——对应真实存在的 `spark-351a0b17` 标题，改动会使脚本对该对象失效。

### 3.6 git 历史

28 条含该字样的 commit subject（`git log --format=%s | grep -ci adr`）；全文检索 195 个提交。**不抹依据**：`09 §5.6` 第 6 项（v5 不定义 push/PR/远端 ref/pre-push）、`91b3d727` 已确立「git 历史承担证据」的先例；重写历史需 force-push 且无机械校验与 Human Gate，执行即越权。

---

## 4. 残余 gap（如实登记，不冒充已解决）

### 4.1 5 条入向关系边 —— 载体转历史只读

| 边 | 载体 | 载体状态 | 目标 |
|---|---|---|---|
| `informs` → `2a521398` | `friction-21472aca` | `resolved` | 已删 |
| `informs` → `6bddf3cd` | `friction-68606040` | `resolved` | 已删 |
| `refs` → `0b08523c` | `spark-71930c4a` | `implemented` | 已删 |
| `refs` → `2a521398` | `spark-4cd5986a` | `discarded` | 已删 |
| `refs` → `2a521398` | `spark-e92d4ebb` | `discarded` | 已删 |

按 `02 §8.2` 第 5 条与 H2 裁定（2026-11-15）**保留实际边、如实报告目标缺失**，不静默删改。后果：解析器去 `adrs` 后这些载体无法再受控写入。

`26 §14.1` 的「resolved 必有 1..n 条 `informs` 且目标可解析（**无例外**）」与该状态冲突。**实测范围（不低估）**：当前事实源 385 个对象中，`status: resolved` 且 `informs` 目标悬空的摩擦账共 **6 条**——其中 2 条指向本批删除的 ADR（`2a521398`、`6bddf3cd`），4 条指向更早撤除的 WorkCase（`562f75c1`、`59b4899d`、`c36b0208`、`88f3e568`）。后 4 条**先于本批存在**，不是本次引入；本批只是让 ADR 那 2 条加入同一形态。

**本条如实登记为残余 gap，不冒充已解决**；闭合路径（改 `26 §14.1` 开例外，或把「目标存在」改为写入前置条件 + 存量白名单）属规范层另批，须 `00 §3.2`（Human 决定）+ `00 §4.4`（独立审核）。

### 4.2 `specs/26:298` 机械值格式违规（**本批修复**）

`26 §11` 的 `informs` 目标类型在 G2 裁定（Human 2026-11-15「任一现存对象 + commit」）后写成中文「现存事实对象」，而 `02 §12.4` 要求该格形态为 `<relation_key>-><目标 fact_type_key，多个用 | 分隔>`、`fact_type_key` 取 `02 §7.1` 的小写 ASCII 值域。实测后果：`loadRecallCriteria("<repo>/specs")` 返回 `ok:false`，**friction 表整张停用**（`byType.size = 6`，缺 `friction`）；受影响的**可执行判据**是四项——默认候选状态、核心语义字段、类型词别名、关系展开。另两项（召回时机、F3/F4 展开、条数上限归属）机械值本就为空，属登记行、不存在「不可用」，此前表述有误，此处订正。

Code 侧 `TARGET_TYPE_RE` fail-closed 属**正确行为**（`01 §11.4` 禁 Code 迁就规范错写）。修法为把自然语言落成枚举，与 `02 §7.1` 值域及 G2 裁定一致。

**落盘形态必须用 `\|` 转义**（Markdown 表格的 `|` 是列分隔符）：实测裸 `|` 会命中更早的四列校验，报 `recall-criteria/bad_columns`，**比现状更糟**。正确写法（与 `24:397` 同集合同顺序）：

```
informs->spark\|norm\|pitfall\|report\|friction\|subgoal, paired-with->pitfall
```

**为什么六类恰为全集、不是自主收窄**：`goal` 是单例，声明不采用 `fact_type_key` 且免 `object_uid`；而关系 target 只有 `object_uid` 或 `commit` 两形。无 `object_uid` 即不可能成为 `informs` 目标，故六类 = 具备 `object_uid` 的类型全体 = G2「任一现存对象」的可枚举表达。`commit` 不入枚举：`26 §11` 明写它是 target **形态**例外、不是类型，`02 §12.4` 该格只收 `fact_type_key`。

**Human 决定依据（`01 §11.1` 第 7 项）**：本格不新设语义——语义已由 G2 裁定落进 `26 §11:266`（「现存事实对象」），本格只是把它补成合规的机械表达。按 `00 §3.4`「Human 已作出并进入稳定承载的决定，只要作用范围仍覆盖当前行动且未被撤回，AI 直接复用，不重复进入 Human Gate」，**复用 G2 裁定、不重复进 Gate**；G2 的仓内可核落点为 `26 §11:266` 与提交 `9ca5e423` 的 message。该项不属 `00 §3.2` 根决定事项（未新增/改写/扩张可强制执行规则）。独立审核（`00 §4.4`）已完成，须修订项已修复。

**修改完成后暴露的两处 Code 缺口（不属本格之过，按 `01 §11.4` 由 Code 补齐，不用规范迁就）**：
1. `plugin/lib/friction-writer.js` 的 `INFORMS_TARGET_DIRS` 只列 `sparks/pitfalls/reports/frictions/norms` **五项，缺 `subgoals`**——六类里唯一「机械值宣告可展开、但受控写入直接判不可解析」的一类。同型先例见 `spark-writer.js` 的 refs 目标表曾漏 `subgoals`。
2. `26:271` 与 `26 §18` 第 4 项写「不建 Friction 间关联边／不建 F-F 关系网络」，而机械值（正确地）列出 `friction` 可为目标。**读法**：该禁项禁的是「账与账织网」（F-F 关联边网络），`informs` 的「解药边」不在此禁；当前 0 条 F-F `informs` 实例，行为无差。

### 4.3 `32 §4.2:101` 的 F10 过渡缺口句（**已订正**）

原句登记「`review-ask.js` 的 `GATE_POINT_EXCLUSIONS`、`review-ask.test.mjs` 的 `length === 4`、`client.js` 的四类提示文案属代码层批次，本批登记为已知过渡缺口」。三处实现已随本任务同步（实测：`GATE_POINT_EXCLUSIONS` 三条、`length === 4` 残留 0、四类文案残留 0），该登记的对象消失，**本批删除该句**（属 `01 §11.1` 第 2 项的「更正表达」，非实质修改）。旧规则的去向由本节承载（`01 §11.3`）；`32 §4.2` 的正文清单本身仍是权威，代码须跟随（`review-ask.test.mjs` 有守卫）。

### 4.4 其它已查明但不属本批的漂移

- `plugin/lib/index.js:341` 的「07 §5.4/§5.7」：管辖项目登记的权威在 **08** 号，07 号 §5 是「四层阅读器」——独立引用漂移。
- `plugin/lib` 内 21 §8/§13/§14/§263 的 WorkCase 撤除遗留引用。
- `plugin/lib/norm-tools.js` 的 `22 §16`/`22 §14.1` 等注释（已改中性，但 `21 §` 未动）。
- `plugin/web/docs` 4 份文件的「四类事实对象」表述（决策=ADR 已撤除）。

---

## 5. 验证（可复现命令与结果）

```
# 活机制
grep -c registerAdrTools plugin/lib/ldvh-tools.js                       → 0
grep -c ADR_CONSENT_QUESTION_ID plugin/lib/host-seams.js                → 0
sed -n '/export const GATE_POINT_EXCLUSIONS/,/^]);/p' plugin/lib/review-ask.js | grep -c 'key: "'  → 3

# 载体
[ -d ldvh-base/adrs ] && echo exist || echo gone                        → gone
[ -d docs/adr-archive ] && echo exist || echo gone                      → gone

# 关系边保留
grep -rlE '2a521398|6bddf3cd|0b08523c' ldvh-base/frictions/ ldvh-base/sparks/ | wc -l  → 5

# git 历史可回取
git show 9ca5e423:specs/34-双源召回系统规范.md | grep -c 'ADR 和事实规范的索引不能减少\|排序就是 ADR'  → 2
git cat-file -e e3d6f02a:ldvh-base/adrs/adr-2a521398-*.md               → OK

# 测试
npm --prefix plugin test  → 2872 tests / 2850 pass / 2 fail / 19 skipped / 1 todo
```

### 5.1 2 条失败的归因（已证非本批引入）

`plugin/test/recall-action-evidence.test.mjs:40,75` 断言「回合数 ≥ 会话数 − 2」，实测「回合 20 / 会话 30」。该文件**本批未修改**；`plugin/scripts/recall-action-evidence.mjs` 本批只改了 3 处字面（注释、「ADR/Fr」弱前缀、`ldvh_adr_write/read` 工具表项），**未触及回合切分、注入识别、会话筛选逻辑**。用 `git show HEAD:` 取出脚本原版与工作树版分别跑同场景，读数逐字相同（20/30/19）——证明为语料增长导致的既有失败。

### 5.2 `.test-count-baseline` 未下调

保持 `3260`。依据 `run-tests.mjs:137-138`「基线只在**绿跑**且条数增长时前移；刻意不在条数下降时前移：删减用例须经评审」。当前套件含 2 条预存失败非绿，且差额 389 条（本批删 125 条用例 + 更早未下移）本身就是应保留给下一任主控的可核信号。以改基线的方式让套件「看起来绿」属掩盖。

---

## 6. 未验证范围（如实声明）

1. **未重启宿主**：`plugin/lib` 改动后当前 DSH 进程仍加载旧模块；本轮注入文案「四类→三类」要重启后才在 GUI 生效。`ldvh_inspect_loaded_modules` 可核陈旧面。
2. **未重建 Web 产物**：`plugin/web/dist` 被 `.gitignore` 忽略；本批 `client.js`（设置页 i18n）是否进入 bundle 未验证，需 `cd plugin/web && pnpm build:dsh` 后核对。
3. **未做真实 UI 验收六项**（本地开发工作流 Norm 要求）：设置卡片、会话视图、`/ldvh`、`/ldvh/api/health`、停用/重启、卸载清理。
4. **未在 Windows 真机验证**：本批为 JS/TS/MD 文本与文件删除，不触及路径语义、Hook shell 载体、权限模型、换行编码；但按红线 4 只登记为 `unverified`，未做 win32 分支核对。
5. **未推送远端**：`dev` 领先 `origin/dev`；按 `release-branch-discipline` 只推 dev，push 无机械校验（`09 §5.6` 第 6 项），不得声称已机械覆盖。
6. **未逐个通读 125 份事实对象正文**：本批只抽查 13 份判定「历史叙述不可改写」；其余 112 份仅做模式级 grep。该抽样的代表性与遗漏风险如实登记。
7. **未复核 `docs/adr-archive` 与原件的历史版本一致性**：只核了删除时的逐字一致（17/17），未核归档是否曾与原件分歧过。

---

## 7. 后续入口

| 事项 | 所挂 Gate | 状态 |
|---|---|---|
| `specs/26:298` 机械值修正 | `00 §4.4` 独立审核已完成 → 受控提交 | **本批落盘**（见 §4.2） |
| `plugin/lib/friction-writer.js` 的 `INFORMS_TARGET_DIRS` 补 `subgoals` | `01 §11.4`（Code 对齐规范，无需 Human Gate） | **本批落盘**（见 §4.2） |
| `26 §14.1` 例外 / 写入前置条件改造 | `00 §3.2` + `00 §4.4` | 未启动（6 条存量违例，见 §4.1） |
| `32 §4.2:101` F10 句订正 | 规范批 | 未启动 |
| 16 处字面例外之外的规范层处置 | 按 §1 裁定不做（只登记） | 已定 |
| 2 条预存失败的测试断言口径 | 需判断属「改测试」还是「改脚本判定」，涉及语料依赖 | 未启动 |
| 重启宿主 + 重建 dist + UI 验收 | 本地开发工作流 | 未启动 |
