# 事实规范（Norm）设计收敛文档

> **性质**：**汇总文档（consolidated）**，非规范正文，不取得规范效力。
> **来源**：由 9 份同主题的过期分析产出收敛而成，原件已移入 `docs/archive/`（清单见 §9）。收敛**按主题重组**，不是逐份摘要堆叠。
> **基准**：`dev` 分支；收敛时参照 `specs/27-Norm-事实规范.md` 的**现行文本**（已定稿并登记），以及 `plugin/`、`ldvh-base/` 的**当前实际状态**。
> **保留原则**：保留**结论与依据**、保留**未决项**、保留**关键机械证据（文件:行号 / 命令）**；丢弃已被推翻的中途过程（仅记为「已撤回设计」并注明撤回理由）。
> **标注约定**：每条结论标 `[已承接 27]`（`specs/27` 已有对应条文）/ `[未承接]`（结论有效但尚未写入任何规范）/ `[已撤回]`（原设计被推翻）/ `[待决]`（未决项）。
> **未做**：未修改 `specs/`、`plugin/`、`ldvh-base/`；未 `git commit`。

---

## 0. 一页结论

| # | 结论 | 承接状态 |
|---|---|---|
| C1 | 事实规范（Norm）以**事实对象**形态承载于 `ldvh-base/norms/`，与元规范（`specs/`）为**两条绝对基路径**，机械隔离 | `[已承接 27]` §7 |
| C2 | 效力判定：元规范＝**路径决定**（`SPEC_PATH_PATTERN`）；事实规范＝**类型 + 状态**决定（`fact_type_key` + `active`），**与路径无关** | `[未承接]`（散见于 27 §1 措辞，无独立条文） |
| C3 | 专属字段为 `direction_key`（小写 kebab-case），反重复公式 `Count(direction_key=d ∧ active) ≤ 1` | `[已承接 27]` §8、§11 |
| C4 | **`norm_source` 设计已撤回**——事实规范**不需要**指向元规范来「借效力」 | `[已撤回]` + 27 §17 红线 4 明文禁设该字段 |
| C5 | 状态机两值 `active`/`retired`（仿 ADR），无第三态 | `[已承接 27]` §9 |
| C6 | 「成体系」判据＝三条中至少满足两条（多条可独立执行规则 / 明确管辖边界 / 持续消费价值） | `[已承接 27]` §5 |
| C7 | 一方向一规范的**反重复版**：反重复 + 允许合并 + 子主题可拆文件但不升格 + 跨方向引用纪律 | `[已承接 27]` §11 末段 |
| C8 | 正文四段固定 H2 骨架，作为「成体系」的**弱机械门槛（验形）**；语义质量由 AI 审核 + Human Gate（验质） | `[已承接 27]` §8、§17 红线 5 |
| C9 | 唯一性由**三道防线**保障：写入前拒绝 / Git Gate 拦截 / 消费端 fail-closed | `[已承接 27]` §11 |
| C10 | ADR → Norm 的**转向机制缺口未被任何规范闭合**（`retirement_reason` 闭集无法表达「已转入规范」；`superseded-by` 只能指向 ADR） | `[未承接 / 待决]` |
| C11 | **实现侧全部未建**：`ldvh-base/norms/` 不存在、`FACT_DIRECTORIES`/`FACT_TYPES` 无 Norm、无 writer、无 Git Gate 断言 | `[未承接]`（实现缺口，§8） |
| C12 | 启动引导文本假定 `specs/00` 存在，但**安装流程从不创建 `specs/`** —— 悬空假定 | `[未承接 / 待决]` |
| C13 | 语义「同义异名」**无法机械防止**，只有精确排他；防范依赖 AI 创建前查重 + Human Gate | `[已承接 27]` §17 红线 5（部分）；机制为 `[未承接]` |

---

## 1. 两级承载与效力判定（本设计的理论地基）

### 1.1 00 的委托与其悬空史

`specs/00-理念与构成.md` 确立了规范源的两级承载，并把**归属判据的权威指派给「规范模型」**（即 01）：

- `00 §3.3`：「事实规范承载管辖项目的规则，**以事实对象形态承载于事实源**」；同句后半：「其效力来自规范源……不因存放位置而取得规范效力」；
- `00:136`：「**具体归属判断由规范模型定义**」；
- `00 §3.6`（`:152`）：「两级规范**共用同一套受控建立程序**，事实规范不得放松元规范、不得自授效力」。

**机械证据（当时的基线）**：`grep -rc '元规范\|事实规范' specs/*.md` → 当时仅 `00` 命中 **6** 次，**01 及以下 20 份全部 0 行**；01 §4.1 / §9.1 的候选路径**只含** `specs/` 与 `specs/attachments/`，`ldvh-base/` 不在其中。

> **收敛时点复核**：现 `00`=6、**`01`=1**、**`27`=19**，其余 0。即 01 已不再是零命中（01 的 §8.1 已登记 27 号行），但 01 **仍未增设「元/事实归属判据」独立章节**——原调研所指的「00 §3.3 委托悬空」在**判据定义**这一环**未被 01 补上**，而是由 `00 §3.3` + `27 §3`/§5 的组合分别承接（27 号定义了 Norm 类型的对象边界，但未回答「一条规则该归元规范还是事实规范」的一般判据）。**该一般判据仍属 `[未承接]`。**

→ 结论：**00 §3.3 委托给 01 的归属判据，在 01 中曾长期悬空**。这是「事实规范需要独立类型承载」这一主张**最硬的独立必要性证据**（非推测，是机械可核验的实现缺口）。

### 1.2 效力判定的正确模型（Human 纠正后的定论）

**Human 纠正（逐字）**：

> 「规范效力其实和召回机制有关，adr 是等价规范的，**adr 相当于临时规范，adr 能做到规范更要做到**，所以**不存在路径问题**，但是元规范不一样，**元规范是路径决定的**。」

主控复核后认定三条均成立，「效力与路径无关 / 由类型与状态决定」是**关键推论**：

| 维度 | 元规范（`specs/`） | 事实规范（含 ADR、Norm） |
|---|---|---|
| **效力判定** | **路径模式**——`SPEC_PATH_PATTERN = /^specs\/[0-9]{2,}-[^/]+\.md$/`（`plugin/lib/spec-registry.js:29`，原始取证行号为 `:27,29`；模式串与正则内容一致） | **类型 + 状态**——`fact_type_key` + `status: active` |
| 成员资格来源 | `specs/NN-*.md` 路径（`01 §9.1`「候选**只**来自 `specs/<数字>-<标题>.md`」） | 事实源目录 + canonical 对象 |
| 召回方式 | **L0–L4 渐进披露**（按 `canonical_path` 定位，`read-specification-*`） | **按类型召回时机**（义务召回，F0–F4） |
| 对路径的依赖 | **强**（路径不对，内容再对也不进规则源） | **无** |

支撑 ADR 侧「效力不由路径决定」的原文：`specs/22-ADR-决策.md:23`——「ADR 是对 AI 具有持续约束力的法定效力决定……**违背 active ADR 的行动视同违背规范源**」。即 ADR 与规范源**同等约束力**，该效力由**类型 + `active` 状态**决定。

**推论（`[已撤回]` 的直接后果）**：事实规范**无需**指向某份元规范来「借效力」——它作为同类事实对象，按自身类型语义取得约束力，**正如 ADR**。

### 1.3 迁移判据（若将来要把某份 `specs/` 内容迁为 Norm）

原调研给出的多维判据，**首要判据是「约束对象」**（D1），发布边界（D3）**必要但不充分**：

- **D1 约束对象（首要）**：约束 LDVH 机制 / 跨项目运作 → 元规范；约束**单一项目**的内容、结构、工程纪律 → 事实规范；
- D2 适用项目数、D4 变更来源、D5 载体、D6 效力来源：支持性判据；
- **D3 发布/分发边界**：**必须保留但不可独木承重**。实测（见 §1.4）表明该边界分隔的是「插件包 vs 管辖项目仓库」，**不是**「元规范 vs 事实规范」。

**未证实**：具体哪些既有 `specs/` 规范可迁移——需逐份按 D1 判定，原件未预列清单（避免未证实断言）。

### 1.4 发布边界的机械事实（澄清一处长期误读）

| 事实 | 证据 |
|---|---|
| 插件 `files` 白名单**既不含 `specs/` 也不含 `ldvh-base/`** | `plugin/package.json:39-48`（`lib` / `icons` / `cordis.patch.yml` / `web/dist` / `LICENSE` / `README*` / `CHANGELOG.md`） |
| `npm pack --dry-run` 实测打包 46 个文件，**无 `specs/`、无 `ldvh-base/`** | `cd plugin && npm pack --dry-run` |
| `specs/` 从**管辖项目 Git 根**读取，不从插件包内解析 | `plugin/lib/ldvh-tools.js:75` `join(projectRoot, "specs")`；`:80` ENOENT → `unavailable` + gap |
| 安装事务**只种子化 `ldvh-base/` 五目录**，从不创建 `specs/` | `plugin/lib/governed-projects.js:13` `FACT_DIRECTORIES`；`:221-226` `initializeFactSource` |
| 全库**无** `specs/` 播种 / 脚手架机制 | `grep -rniE 'seed\|scaffold\|template\|initSpec\|copyFile\|bootstrap' plugin/lib --include=*.js` → 命中全部无关 |
| 规范层**从未立规**「`specs/` 是否随插件发布」 | `specs/08` §7 详规版本号/渠道/README/CHANGELOG，**无一条**涉及 `specs/` 或 `ldvh-base/` 的包内容 |
| 受保护文档与随包文件是**两个正交集合** | `00 §4.3` 点名 `specs/00-理念与构成.md` 为受保护文档，但该文件并不随包发布；受保护的是**修改流程** |

**一处已发现的发布层不一致（与 Norm 无直接关系，但属同批盘点产物）**：`plugin/package.json:43` 列了 `web/dist`，但 dry-run tarball **无任何 `web/` 条目**——因仓库根 `.gitignore:23` 的 `dist/` 命中 `plugin/web/dist`，且 `plugin/` 内无 `.npmignore` 可回退。即前端 SPA 当前也**不随包发布**（与 `plugin/README.md:5`「完整 LDVH Web 仍在迁移中」一致，但白名单与实际产出不符）。`[未承接]`

---

## 2. 对象边界与载体（`[已承接 27]` §6、§7）

### 2.1 什么构成一个对象

一个 Norm 对象 = **一个完整工程方向的成体系规范体系**。判据四条：方向可独立召回、规则可独立检查遵从性、方向定位有清晰边界、正文具有成体系的规则内容。（原设计的「可独立贯彻」四判据——可独立召回 / 可独立核对遵从性 / 可独立违背 / 可独立终态——被 27 §6.1 归纳为上述四条。）

**粒度判据**：对同一主题的多条松散规则，**宁可拆成多份 Norm 也不打包一份**——打包的集合无法逐条贯彻检查，等于没有效力。（与 `22 §6.1`「单条可独立贯彻」同源。）

### 2.2 载体

| 项 | 定案 | 对照 |
|---|---|---|
| 形态 | **多例、一文件一对象** | 仿 `adrs/`、`pitfalls/` |
| 目录 | **`ldvh-base/norms/`** | 与仓库根 `specs/` 为**不同绝对基路径** |
| 文件名 | **`norm-<uid>.md`** | 仿 `adr-<uid>.md`、`friction-<uid>.md` |
| 载体 | Markdown（frontmatter 机器权威 + 正文） | 同 22/23/26 |
| `fact_type_key` | **`norm`** | 原设计为 `factnorm`，**定案为 `norm`**（27 §8） |
| `object_uid` | **UUIDv4，Code 生成，不可变** | 多例类型通用；单例豁免（25）不适用 |

**论辩记录（保留）**：`fact_type_key` 的取值曾在 `factnorm` 与 `fact-spec` 之间比选。选 `norm`（原文档倾向 `factnorm`）的理由是**避免与元规范 `spec` 造成词汇重叠**——该理由在 `factnorm` 上同样成立，最终由 27 号定稿取更短的 `norm`。

**机械隔离的根因（关键推论，非任务书原文）**：`ldvh-base/norms/` **不会**被 `scanSpecCandidates` 收进元规范成员——该扫描器只枚举 `join(projectRoot, "specs")`（`ldvh-tools.js:75,93`）。因此 Norm 实例**不消耗 `SPEC_ID_PATTERN`（`/^[0-9]{2,}$/`, `spec-registry.js:27`）的数字命名空间**，**撞号风险不成立**。

**残留风险（已消解）**：原设计曾把目录基名设为 `specs`（即 `ldvh-base/specs/`），与仓库根 `specs/` 同名，存在**命名歧义风险**。**定案目录名为 `norms`，该风险已消除。** 消解依据见 `survey-dual-read-channels` 的路径隔离检验：

- 全仓按 basename 匹配 `"specs"` 的代码**仅一处**（`ldvh-tools.js:75`）且锚定 `projectRoot`，无同名歧义；
- 无任何代码**递归扫描 `ldvh-base` 寻找 `specs`**（`grep -rn 'ldvh-base' plugin/lib/*.js \| grep -iE 'readdir\|scan\|glob\|walk'` → 仅 `adr-enumeration.js:44` 的注释）；
- `plugin/lib/commit-validation.js` **无任何路径匹配逻辑** → Norm 载体走 Git Gate 不会被误判。

### 2.3 明确排除项

| 相似内容 | 归属 | 判别锚 |
|---|---|---|
| 元规范（LDVH 自身规则） | `specs/` 下 00–27 | 由规范模型定义、经 L0–L4 读取；Norm 承载**管辖项目**规则 |
| ADR（单条决定） | `ldvh-base/adrs/` | ADR＝**点状**决定；Norm＝**面状**体系 |
| Spark（方向悬置） | `ldvh-base/sparks/` | 决策/规则未结晶前住在方向主线，不应有 Norm |
| Pitfall（教训规避） | `ldvh-base/pitfalls/` | 「别这么做」是经验，不是「必须这么做」的规范义务 |
| Research（外部证据） | `ldvh-base/researches/` | 调查支撑，不承载规则 |
| WorkCase（执行项） | `ldvh-base/workcases/` | 授权执行层，不是规则 |
| Friction（待修账） | `ldvh-base/frictions/` | 改进账本，入账不产生修订义务 |
| Goal（目标锚） | `ldvh-base/goal.md` | 目标陈述不是规则 |
| **类型定义规范 27 自身** | `specs/27-Norm-事实规范.md` | 27 是**元规范**，不是 Norm 实例 |
| 方向内子主题拆分文件 | 正文扩展或附件 | **不升格为新方向、不建新 Norm 对象**（27 §11） |

---

## 3. 字段契约与状态机（`[已承接 27]` §8、§9）

### 3.1 frontmatter 闭集

| 字段 | 必填性 | 约束 |
|---|---|---|
| `fact_type_key` | 必填 | 唯一合法值 `norm` |
| `object_uid` | 必填 | UUIDv4，Code 生成，创建时落定、永不改变 |
| `title` | 必填 | **≤ 40 字** |
| `status` | 必填 | `active` / `retired`，初态必为 `active` |
| `direction_key` | 必填 | **专属字段**；正则 `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`；同 key 至多一个 active |
| `created_at` | 必填 | RFC3339，Code 填写，**AI 不得填写** |
| `retirement_reason` | 条件 | 闭集 `superseded` / `outdated` / `out-of-scope`；retired 必填、active 禁现 |
| `retired_at` | 条件 | RFC3339，Code 填写；retired 必填、active 禁现 |
| `change_log` | 条件 | 首修后必有；每次**恰好一条** |

**`direction_key` 与 `title` 的区别（保留）**：`direction_key` 是**机器标识**（唯一性校验、索引、跨规范检索）；`title` 是**人类可读短标题**（扫读、Web 呈现）。`direction_key` **不随标题修改而改变**（纯标题修正不改 key）。

### 3.2 专属字段为何无需修改 03

`specs/03` §6.1 定义的是**跨所有事实类型共享的公共身份字段**（`object_uid` / `fact_type_key` / `title` / `created_at` / `status` / `urls` / `relations` / `change_log`），并明文规定「20–24 分别登记本类型实际采用的公共字段和专属字段……只声明采用范围与类型专属增量，**不替代本文的公共语义**」。

先例：22 的 `decision`/`scope`/`trigger_signal`（`specs/22:117-131`）、24 的 `research_question`/`research_purpose`（`specs/24:170`）、20 的 `question`/`scope_boundary`/`intent`（`specs/20:83`）。

→ 结论：`direction_key` 属**标准且合法的类型专属字段**，**无需对 `specs/03` 作实质修改**。同理，`01.Att.02` 只管辖**元规范**身份契约（未知 key 被 `spec-registry.js:132` 拒收），Norm 是事实对象，**不走 `01.Att.02`**，不破坏元规范身份闭集。

### 3.3 状态机

| `status` | 语义 | 必须成立 |
|---|---|---|
| `active` | 规则现行有效，参与遵守预检与讨论装配 | `retirement_reason`、`retired_at` 不得出现 |
| `retired` | 不再适用，保留为只读历史基线 | 两字段必填 |

- 初态必为 `active`；正常转换仅 `active → retired`（Human Gate）；
- **终态不重开**；错误终态按 05 事实更正修正；
- 义务实质变化（非补充观察）走**新对象 + 旧 `retired`**，**不改写旧规则语义**。

**为何沿用 `active`/`retired` 而非 `open`/`resolved`（保留的裁量依据）**：Norm 是「在效力 / 不在效力」的**二元规范义务**，与 ADR 同构；不像 Friction 是「待修账」需三态（26 §141）。先例：`22 §149`。

**方向键复用定案**：同一 `direction_key` 在**历史全集**中可有多份（1 active + N retired）。退役对象保留为只读档案；若未来重启该方向，新对象分配**新 `object_uid`**，方向键**可以复用**。机械校验器的过滤条件是 `status === "active"`。（原设计把「复用」留作待 Human 裁定项，27 号已定案为「允许复用」。）

---

## 4. 唯一性：反重复公式与三道防线（`[已承接 27]` §11）

```
Count(direction_key = d ∧ status = "active") ≤ 1
```

这是**跨对象（跨文件）全局一致性约束**。先例比对（用于选型）：

| 先例 | 检查对象 | 机制 | 启示 |
|---|---|---|---|
| `specs/25-Goal` | 项目级目标单例 | 物理固定路径 `ldvh-base/goal.md` | 适用于全项目唯一对象；**不适合多方向** |
| `spec-registry.js` | 元规范 `canonical_path`/`spec_key` 全局唯一 | `ldvh-tools.js:100-114` 扫描时构建集合全量核对 | 全量汇总核验是标准做法 |
| `governed-projects.js:48-57` | 项目登记 `id`/`path` 唯一 | 遍历 + Set 查重，违规立即中断 | 内存 Set 判重 |
| `adr-writer.js:16` | ADR 状态转移与 CAS | 基于当前指纹与单文件内容做排他更新 | 受控写入入口是写前校验的最佳宿主 |

**三道防线**：

```
[行动发起 / 更新提请]
       │
       ▼
【第 1 道：写入前受控防线】 factnorm/norm writer (create/update)
        └─ 扫描 ldvh-base/norms/，查验 active direction_key 是否冲突
           → 冲突则拒绝写入（ERR_DIRECTION_ALREADY_EXISTS）
       ▼
【第 2 道：提交前终闸防线】 Git Gate (commit-msg / pre-commit hook)
        └─ 离线无状态扫描暂存区与工作树的 ldvh-base/norms/norm-*.md
           → 断言每个文件 direction_key 合法；active key 频次 > 1 则拒绝提交
       ▼
【第 3 道：消费/读取诊断防线】 Helper 读取 & Web (localFactReader) 投影
        └─ 检测到 active 方向冲突 → fail-closed：
           两份冲突规范均不得作为当前生效规则返回
           → gaps: [{ reason: "direction_collision", direction_key: "..." }]
```

第三道防线的规范锚点：`01 §9.1`「同一编号、职责标识符……映射到多个候选时，**全部受影响候选均不得进入成员读取**，直到冲突解除」。

**冲突处置策略**：唯一合法策略是 **Fail-Closed（默认拒绝）**。**不得**猜测哪一份更新、**不得**静默按 mtime 选最新、**不得**降级忽略；必须报错停止受影响行动。

---

## 5. 「成体系」判据：机械能力边界（`[已承接 27]` §5、§8、§17）

### 5.1 现实矛盾（保留，这是判据设计的起点）

「一个方向一份规范」只解决了**非重复性（排他性）**，**不能**从逻辑上推导出**成体系性**。反例：一个开发者可以在 `ldvh-base/norms/norm-<uid>.md` 里只写一句话「所有按钮必须是蓝色的」——它满足方向唯一，但绝不是「成体系」。

### 5.2 诚实结论：只能「弱结构机械判定」，不能「语义完备性机械判定」

**能机械做的（验形）**：

- 借元规范（01 §7）与 ADR（22 §8）的做法，定义**必填 H2 共同章节结构**，缺失即拒绝写入。
- 定案的四段骨架（27 §8，全部必填且各段非空）：
  1. `## 方向定位与适用范围`——管什么、不管什么、适用哪些场景
  2. `## 核心规则体系`——核心规则条目，可含 H3 子节
  3. `## 约束与反模式`——明确禁止项与违规后果
  4. `## 验证与遵从性检查`——如何检查是否遵守本规范

**不能机械做的（验质）**：规范是否覆盖该方向的主干脉络？规则之间是否矛盾？深度是否足够指导长程开发？**没有任何确定性代码可以机械证明。**

**补偿方案**：弱机械负责验形，**AI 对抗审核 + Human Gate 负责验质**（对齐 00 §4.2）。

### 5.3 「成体系」的准入判据（27 号定案，替代原「无法判定」的悬置状态）

一个方向的规则构成「成体系」的规范，须满足以下三条中**至少两条**：

1. **多条可独立执行的规则**——不是单条决定或建议，而是规则集合，多个条目各自可被检查遵从性；
2. **明确的管辖边界**——有清晰的「管什么、不管什么」定位，不与其它方向边界严重重叠；
3. **持续消费价值**——在后续方案工作、代码实现、审计核对中会被反复引用，不是一次性结论。

### 5.4 机械保证的硬边界 vs 无法触达的软边界（保留原文判定）

| 机械可完全保证 | 机械无法触达（必须依靠制度/人） |
|---|---|
| 同一 active `direction_key` 的精确物理排他（100%） | **同义异名逃逸**：AI 自造 `web` 与 `frontend` 两个 key，机械校验会放行 |
| `direction_key` 命名格式合规（正则） | **上下位重叠**：建了 `backend` 又建 `express-api`，机械无法辨析包含 |
| 载体物理路径唯一性（文件名与 UID 绑定） | **形式主义空壳**：章节齐全但正文全是废话或只有一条微不足道的规则 |
| 四段骨架章节存在性（缺一即拒绝写入） | **体系完备性判定**：规则是否足以支撑该方向的长程稳定性 |
| 状态机流转合法性（仅 active/retired，终态不可逆） | —— |

**补偿方案**：新增 `direction_key` 必须触发 00 §4.2 Human Gate，提请必须附带项目级方向登记簿与查重结论，由 Human 作出终审判定。

---

## 6. 召回机制与消费点（`[已承接 27]` §10）

### 6.1 与 03 §8 的 F0–F4 对应

Norm 是事实对象，召回严格走 **F0–F4**（`03 §8.1`），**不混用** 01 的 L0–L4：

- **F1**：枚举 active Norm 计数（`direction_key` + `title` + `status`）；
- **F2**：按 `direction_key`、`title`、命中词的候选卡；
- **F3/F4**：按需展开全文与当次机械校验。

默认候选**只含 active**——当前生效规范就是 active 集本身。`retired` 不进入普通候选，只在精确引用或历史追溯时展开。

### 6.2 为什么必须与元规范读取机制不同

| 维度 | 元规范 | 事实规范（Norm） |
|---|---|---|
| 入口工具 | `read-specification-candidates` / `read-specification-content` | `ldvh_*` 事实工具（F0–F4） |
| 扫描基路径 | `projectRoot/specs/` | `projectRoot/ldvh-base/norms/` |
| 分层 | L0–L4 渐进披露 | F0–F4 召回分层 |
| 成员枚举 | `scanSpecCandidates` | Web 事实读取器 `baseDirOf` |

→ 两路径绝对基不同、工具不同、分层不同，即 `00 §3.6`「**分机制**」的落点；但**建立程序**（受控写入、提交契约、Human Gate）**共用**。

### 6.3 四个消费点

1. **遵守预检（义务）**：行动涉及某方向既有规则域时（`02 §13`），以 `direction_key` + 正文「约束与反模式」+「验证与遵从性检查」识别违背；
2. **讨论装配**：讨论装配时作为既有依据来源；
3. **审计核对**：回溯审查；
4. **Web 项目规范看板**：Human 消费——渲染 active Norm 列表（10 号 Web 承接）。

### 6.4 召回前置的诚实纪律

进入条件遵守 `03 §8.2`：规则引导先于事实消费；**新会话 / 压缩 / 委派本身不自动证明必要，也不证明不存在**。AI 展开候选后必须**重新比较当前主题与方向状态**——Norm 被召回**不等于**规则全部适用。

---

## 7. 已撤回与被推翻的设计（不保留全文，只留结论与理由）

### 7.1 `[已撤回]` `norm_source` 效力挂靠字段

**原设计**（`design-fact-norm-in-fact-source.md` §3.3 正文）：Norm 的 `norm_source` 为**必填对象字段**，形状 `{spec_key, canonical_path}`，双字段须分别匹配 `ID_PATTERN` 与 `SPEC_PATH_PATTERN`，并通过 `scanSpecCandidates` 解析为**当前元规范成员**，解析失败则 fail-closed 拒绝写入。原 §6「写前三检查」的检查 A 即为该字段的解析校验。

**撤回理由（Human 纠正 + 主控复核）**：

1. ADR 与规范源**同等约束力**（`22:23`「视同违背规范源」），且该效力由**类型 + `active` 状态**决定，**与路径无关**；
2. 元规范的成员资格由**路径模式机械决定**（`SPEC_PATH_PATTERN`），这才是「位置即效力」的适用对象；
3. `00 §3.3:132`「承载位置与效力来源是两个不同的问题」的**正确读法**是：**元规范**效力由路径决定；**事实规范**效力由类型与状态决定。

**因此**：事实规范**无需**指向某份元规范来「借效力」。

**撤回范围**：原 §3.3 的 `norm_source` 必填字段、原 §3.3 的四步机械校验、原 §6.1「写前三检查」的**检查 A**，**均予撤回**。

**现状态**：`specs/27` §17 红线 4 明文禁设该字段——「不设 `norm_source` 或类似的『指向元规范』字段——事实规范的效力来自规范源层级与 active 状态，不靠路径挂靠（Human 撤回该设计，理由见 00 §3.3）」。`grep -rn 'norm_source' specs/ plugin/` → **仅 `specs/27-Norm-事实规范.md:356` 这条禁令一处**。

**未重新设计、仍是待办的部分**：原 §6「写前三检查」的 **检查 B（不自授效力关键词拦截）** 与 **检查 C（不放松元规范的语义判定）** 在新模型下需重写。核心问题变为：

> 事实规范的约束力来自**类型 + 状态**——那么**什么使它成为「可强制执行规则」**而不只是「一条记录」？

新模型下的机械落点应表述为「事实规范的内容**不得改变元规范已定的**允许/停止/责任/入口/验证」，而非「必须指向某元规范成员」。`[未承接]`

### 7.2 `[已撤回]` 主控的两条推论

| 被撤回的推论 | 撤回理由 |
|---|---|
| 「事实规范本身即规范 → `00 §3.6`『不得放松元规范』还拦得住什么」（据此认为机械落点是空的） | 该推论**基于错误前提**——把 ADR 等同于事实规范。更正后：事实规范（项目侧）与元规范（LDVH 自身）**层级不同**，`00 §3.6` **仍有明确对象**，不存在「拦不住」的问题 |
| 「ADR = 事实规范」 | 按 Human 定义，**事实规范 = 成体系的规范**；ADR = **临时的、单条的决定**。二者**粒度与体系性不同** |

**时间语境的事实依据（机械验证，保留）**：ADR 相关条文写作时，「元规范/事实规范」的说法**尚不存在**。

| 时刻 | 提交 | 事件 | 当时 00 是否含「元规范」 |
|---|---|---|---|
| 09-10 01:02 | `347f4ed` | 22 号定稿并登记（写入「不把 ADR 变成规则源」） | **否**（`grep -c 元规范` = 0） |
| 09-10 11:11 | `53a8df1` | 22 号升为「法定效力决定…视同违背规范源」 | **否**（= 0） |
| 09-10 15:04 | `652ca37` | **00 §2 才引入「元规范与事实规范」** | 是（首次） |

```bash
git show 347f4ed:specs/00-理念与构成.md | grep -c '元规范'   # → 0
git show 53a8df1:specs/00-理念与构成.md | grep -c '元规范'   # → 0
```

且当时的术语是**单一「规范源」**：`53a8df1` 版 `00 §3.3` 首句为「规范源是可强制执行规则的**唯一内容来源**……」，而现版为「……**由元规范与事实规范两级承载**……」。

→ 正确读法：ADR 条文中的「规范源」指当时那个**未分级的单一概念**，而非今天的「元规范」或「事实规范」。

### 7.3 `[已撤回]` 「ADR 转入规范是记录升格为规范」的表述

更正后：ADR 转入事实规范是「**临时的单条决定**被**成体系的事实规范**取代」——是**粒度与体系性的跃迁**，不是效力层级的跃迁。（`research-adr-to-norm-boundary.md` 附录 B.4）

### 7.4 已被规范定案、不再是待决项的原设计问题

| 原设计问题 | 原状态 | 定案 |
|---|---|---|
| 状态机选 `active`/`retired` 还是 `open`/`resolved` | 待 Human 裁定 | **`active`/`retired`**（27 §9） |
| `direction_key` 命名是否定案 | 待裁定 | **定案**（27 §8，正则已写死） |
| 骨架章节是否绝对必填 | 推荐强制 | **强制**（27 §8「必须全部存在且各段非空」） |
| 新增 `direction_key` 是否必经 Human 批准 | 推荐确立 | **确立**（27 §15 项 1） |
| 事实类型命名 `factnorm` / `fact-spec` | 推荐 `factnorm` | **`norm`**（27 §8） |
| 方向退役后 `direction_key` 能否复用 | 待裁定 | **允许复用**，`object_uid` 必须重新生成（27 §11） |
| 目录命名歧义（原设计为 `ldvh-base/specs/`） | 残留风险 R1 | **定案目录名 `norms`，风险消除** |
| 「方向」粒度导致判据不可执行（5 个 vs ~42 个） | 原调研指出为最大模糊点 | **由 27 §12 方向清单 + §6.1 粒度判据承接**；清单为**参考指引**，不强制逐条建 Norm |

---

## 8. 未决项与实现缺口（`[未承接]` —— 本文件的重点保留内容）

### 8.1 `[待决]` O1：ADR → Norm 的转向机制缺口（**未被任何规范闭合**）

**22 号已承认该转向**，但**没有承载它的机制**：

| 检查项 | 实际 | 依据 |
|---|---|---|
| `retirement_reason` 闭集 | `superseded` / `outdated` / `out-of-scope` —— **无「已转入规范」一项** | `specs/22:127` |
| `superseded-by` 目标约束 | **只能指向 ADR**（该新 ADR 须已存在可解析） | `specs/22:162` |
| 状态闭集 | 仅 `active`/`retired`，无第三态 | `specs/22:149` |
| 终态不重开 | 「决策要再变更时创建新 ADR」 | `specs/22:170` |
| 22 承认转向存在 | 「已被完整承接进规范源的可强制执行规则的决策（规则本身由规范源承载，ADR 作为决策来源被引用但**不再承担约束**）」 | `specs/22 §6.3:99` |
| 22 红线 | 「**不把 ADR 变成规则源**——决策被承接为可强制执行规则时由规范源承载，ADR 保持记录身份」 | `specs/22 §15:275` |

**三条互斥的处置困境**（保留分析）：

- 若该决策被完整承接后应 `retired` → **用哪个 `retirement_reason`？** 三值都不准确（既不是被新 ADR 替代，也不是环境变化失效，也不是范围不再属于本项目——它**被更完整的承载取代了**）；
- 若想留一条「我转到哪份规范了」的链接 → **`superseded-by` 只能指向 ADR**，指向规范会被判为不可解析；
- 若不 retired、保持 `active` → ADR **继续承担约束**，与 §6.3「不再承担约束」**直接矛盾**，且造成**双重约束**。

**现状实证**：本仓库 `ldvh-base/adrs/` 仅 1 个实例、**无 retired 实例** → 该缺口**尚未被真实使用暴露**，是**潜在**而非已发生的问题。

**27 号现有的处置口径（不是解决，是转交）**：`27 §3.2` 项 6 写「ADR 被事实规范承接后的退役由 **22 号的 `retirement_reason` 闭集扩展或 `change_log` 注记**处理，本类型不定义 ADR 的退役细节」。**即缺口被显式转交 22 号，22 号尚未处理。**

**三种可能界定的权衡（保留，供裁定）**：

| 界定 | 内容 | 判断 |
|---|---|---|
| **A 并列承载** | ADR 不 retired，规范另行建立 | ❌ 双重约束、双重权威，违反 `00 §3.6` |
| **B 接管承载**（倾向） | 规范完整承载后 ADR `retired` | ✅ 与 `22 §6.3` 字面一致；⚠️ 需补 `retirement_reason` 取值或放宽 `superseded-by` 目标域；⚠️ 需定「完整承载」判据 |
| **C 部分承载** | 规范只承接决策的一部分 | ⚠️ 粒度判据复杂，易造成「两条都管一半」的模糊地带 |

**关联待决（原件列出、尚未定）**：

- 转向的**触发条件**（ADR 何时「应」转为 Norm）；
- 转向的**方向性**（规范缩回为单条 ADR 是否可能——未定义）；
- **链接的承载形态**：若要一条「该 ADR 已由某规范承载」的指针，**不能走 `relations`**（`relations.target` 须可解析为事实对象 `object_uid`，而元规范不是事实对象；22 号从未把此类指针写进 `relations`）。可用先例：`21:130` 的 `serves` 字段——**目标不满足 `relations` 公共形状时，用普通标量字段承载，并显式声明它不是 `relations`**；
- **约束力交接时点**：是否存在「两者皆有效」的窗口；
- 是否触及 `00 §4.2`（新增终态理由或新关系类型 → 属「改写可强制执行规则」或「重排事实模型」，**须 Human 决定**）。

**未证实的部分（据实）**：是否存在真实的「ADR 需转为 Norm」实例需求（当前 **0 实例**）；Human 对转向的确切预期形态；该转向应由 00 / 22 / 新规范承载。

### 8.2 `[待决]` O2：启动引导与安装供给不一致（bootstrap 缺口）

**机械事实**：

- `plugin/lib/guidance-text.js:81` 的注入文本首句为「本会话工作锚点（**`specs/00-理念与构成.md`**）：」；
- 但**安装事务从不创建 `specs/`**（`governed-projects.js:13,221-226` 只种子化 `ldvh-base/` 五目录）；
- `specs/00` 的**存在性无代码强制**：`spec-registry.js:163` 只是**条件校验**（若某文件声明自己是 root，则其 `responsibilityKey`/`specId`/`canonicalPath`/`title` 必须取固定值），**不是存在性要求**；
- 全库检索确认**无任何代码创建 `specs/`**。

→ 当前状态下引导文本**引用了一个安装从不创建的文件**。按 `00 §7.1` 防自欺锚点，这属**超出依据支持的声明**。

**处置二选一（须显式提请 Human，不得由 AI 自行认定）**：(i) 安装/登记时供给 `specs/` 初始内容；或 (ii) 引导文本改为按实际扫描结果动态调整。

**注**：这不是规范问题，是**实现与引导不一致**，属**能力承载缺口**。

### 8.3 `[未承接]` O3：`spec_id` 命名空间分隔（**已被 Norm 载体设计绕过，但根问题仍在**）

**机械事实**：`spec-registry.js:26-29` 的三个模式 + `:18` 的 `SPEC_FIELDS` 全套身份字段要求 + `scanSpecCandidates`（`ldvh-tools.js:100-114`）**无差别扫描** → 管辖项目若往 `specs/` 丢一份普通 `audit-spec.md`，会被与 00–27 的 LDVH 机制规范**同表返回、同表校验**，且 `spec_id` 命名空间**无元/事实分隔**。

**Norm 设计对此的贡献**：Norm 落在 `ldvh-base/norms/`（元规范扫描器**不覆盖**该路径），因此**不必**再去 `specs/` 里争编号 —— 这条痛点对 Norm 类型**已被绕过**。

**但仍未被规范闭合的部分**：一份「项目自身规范」若被误写成 `specs/<NN>-*.md`，01 §9.2 会把它当**完整元规范成员**（含独立审核、同等权威）。**这条误用路径没有机械或规范的拦截**。`27 §4.3` 只在 Norm 类型的排除项里声明「元规范不适用本类型」，未禁止项目把规范写进 `specs/`。

### 8.4 `[未承接]` O4：语义「同义异名」的防范机制未落地

**开放取值域**是定案（不能封闭：LDVH 元规范无法预测所有项目的业务与技术边界；`00 §3.3:136`「元规范不替项目定规则，事实规范不替 LDVH 定机制」）。语法约束（`direction_key` 正则）**已定案并可机械校验**。

**但开放取值的核心风险——同一方向被命名为不同 key（`web` vs `frontend` vs `client-ui`）——机械层无法防止。** 原设计给出的四轨防范中：

| 轨道 | 状态 |
|---|---|
| ① 机械层精确排他（同 key 全局唯一） | `[已承接 27]` §11 三道防线 |
| ② **项目级规范登记簿**（声明已确立的方向 key 清单与职责定义） | **`[未承接]`** —— 27 §12 的方向清单是**LVH 侧参考指引**，不是**项目级**登记簿 |
| ③ **AI 创建前强制查重**（检索既有 active Norm 的 `direction_key`、`title` 及正文定位，做语义相似性比对） | **`[部分承接]`** —— 27 §11 要求「查重结论必须记录在创建提案中」，但**无机械强制**（无检查器） |
| ④ Human Gate 最终裁定 | `[已承接 27]` §15 项 1 |

**残留风险**：`direction_key` 的精确排他（机械）**不能**防止语义重叠；27 §17 红线 5 承认「语义质量由 AI 审核与 Human Gate 保障」，但**没有申明「同义异名」这一具体失效模式的补偿是否充分**。

### 8.5 `[未承接]` O5：实现侧全部未建（**当前最大的落地缺口**）

**实测（收敛时状态）**：

```bash
$ ls ldvh-base/
adrs  goal.md  pitfalls  researches  sparks        # 无 norms/
$ grep -n 'FACT_DIRECTORIES = ' plugin/lib/governed-projects.js
13:const FACT_DIRECTORIES = ["sparks", "workcases", "adrs", "pitfalls", "researches"];   # 无 norms/frictions
$ grep -n 'FACT_TYPES = ' plugin/web/api/services/factFieldContract.ts
8:export const FACT_TYPES = ['workcase', 'adr', 'pitfall', 'spark', 'research', 'friction'] as const   # 无 norm
$ grep -n 'norm_source' specs/ plugin/   # 仅 specs/27:356 的禁令
```

**待建清单（原设计已列全，此处保留为可执行清单）**：

| 层 | 文件:行 | 动作 |
|---|---|---|
| plugin 常量 | `plugin/lib/governed-projects.js:13` | `FACT_DIRECTORIES` 加 `"norms"`；**并顺带修正既有漂移**：加 `"frictions"`、移除 `"workcases"`（21 未建、目录不存在 → 消除「声明-缺失」漂移） |
| plugin 测试 | `plugin/test/governed-projects.test.mjs:30,86` | 同步常量（**注意**：该测试**自己复制了一份常量**，`deepEqual` 断言的是自己那份 = 自查，与 lib **解耦**、可静默漂移——实测已验证漂移存在） |
| web 常量 | `plugin/web/api/services/factFieldContract.ts:8` | `FACT_TYPES` 加 `'norm'` |
| web 测试 | `plugin/web/tests/api/fact-field-contract.test.ts:48` | `assert.deepEqual(FACT_TYPES, [...])` **必须同步**，否则测试失败（此处断言的是**导入的真实常量**，与上一条相反） |
| web 映射 | `plugin/web/api/services/localFactReader.ts:14,23` | `FACT_TYPE_DIRS` 加 `norm: 'norms'`；`FACT_TYPE_CARRIERS` 加 `norm: '.md'` |
| 写入器 | `plugin/lib/norm-writer.js`（新建） | `createNorm`/`readNorm`/`updateNorm`；**内嵌第一道防线**（active `direction_key` 单例排他校验） |
| 工具入口 | `plugin/lib/ldvh-tools.js` | 注册 `read-fact-norms` 与受控写入入口；读取扫描时加冲突检测与 gap 报告 |
| Git Gate | `plugin/lib/hook-manager.js` / commit-msg | 第二道防线：扫描 `ldvh-base/norms/norm-*.md`，active key 频次 > 1 则拒绝提交 |
| Web 视图 | `plugin/web/src/pages/` | 项目规范看板：active Norm 列表 + 方向键 + 标题（承接 `27 §10`、10 号 Web） |

**顺带发现的两处既有漂移（`[未承接]`，与 Norm 同一批盘点产物）**：

1. **`frictions` 由 writer 写入但不在种子清单**：`plugin/lib/friction-writer.js:45` 定义 `FRICTION_DIRECTORY="frictions"`，而 `FACT_DIRECTORIES` 无 `frictions` → `initializeFactSource` 不 mkdir，依赖运行时补救；
2. **`workcases` 在清单但目录不存在**：`FACT_DIRECTORIES` 含 `workcases`，但本仓库 `ldvh-base/` **无** `workcases/`。
   - **实际后果（已产生用户可见误报）**：`governed-projects.js:119-137` 对 `FACT_DIRECTORIES` 每项 `lstat`，缺任一项即 `incomplete`；`plugin/lib/client.js:600-608` 把 `incomplete` 列为 `repairable` **向用户呈现**。实测当前状态：`missing: ['workcases']`，`state: incomplete`。

**残留未证实（原件据实标注）**：

- `05` Helper 当前是否已可调用 `scanSpecCandidates` 做解析校验（原为 `norm_source` 所需；该字段已撤回，故此问题的**紧迫性下降**，但「受控写入入口能否调用规范枚举」仍是实现前提）；
- Web 侧类型枚举的消费点**是否全部**会被 `FactType` 类型系统捕获（部分可能用字符串字面量而非 `FactType`）；
- i18n / 图标 / Tab 配置是否存在按类型的 UI 映射表；
- 未构造真实项目实测「新增类型 → 安装 → 写入 → Web 呈现」全链路。

### 8.6 `[待决]` O6：`00 §3.3` 的中文表述在事实规范侧的适用性

`00 §3.3` 原文「其效力来自规范源……不因存放位置而取得规范效力」。在「事实规范＝类型 + 状态决定效力」的新模型下，**该句在事实规范这一侧需要重新解释或澄清，可能触及 00 修订（Human Gate）**。

**未证实**：该模型（「事实规范 = 规范等价物」）**目前是从 `22:23` 与 Human 判据推出的解释，尚未在任何规范中明文确立**，需经规范程序确认。

### 8.7 `[待决]` O7：ADR 文本的时代语境标注

`22` 的「不把 ADR 变成规则源」写于「元规范/事实规范」分层引入**之前**（时间线见 §7.2）。`22` 条文中的「规范源」指**当时未分级的单一概念**。**是否需要在 22 号中标注这一时代语境**，属待定（未做）。

---

## 9. 机械证据索引（集中，便于复核）

**元规范模型**

```bash
plugin/lib/spec-registry.js:27   SPEC_ID_PATTERN   = /^[0-9]{2,}$/
plugin/lib/spec-registry.js:29   SPEC_PATH_PATTERN = /^specs\/[0-9]{2,}-[^/]+\.md$/   # ← 路径即资格
plugin/lib/spec-registry.js:18   SPEC_FIELDS（全套身份字段闭集）
plugin/lib/spec-registry.js:132  未知 identity key 被拒收
plugin/lib/spec-registry.js:163  条件校验：声明 root 则四字段须取固定值（非存在性强制）
plugin/lib/ldvh-tools.js:75      scanSpecCandidates: join(projectRoot, "specs")
specs/01-规范模型基础规范.md      §9.1 候选路径仅 specs/ 与 specs/attachments/
```

**事实源与发布边界**

```bash
plugin/lib/governed-projects.js:13        FACT_DIRECTORIES = ["sparks","workcases","adrs","pitfalls","researches"]
plugin/lib/governed-projects.js:119-137   factSourceStatus: 每项 lstat，缺任一项 → incomplete
plugin/lib/governed-projects.js:221-226   initializeFactSource: 只 mkdir FACT_DIRECTORIES（无 specs/）
plugin/lib/client.js:600-608              incomplete → repairable，向用户呈现
plugin/lib/adr-tools.js:52,109            FACT_SOURCE_ROOT_DIR="ldvh-base"
plugin/lib/commit-validation.js           （无路径匹配逻辑）
plugin/package.json:39-48                 files 白名单（不含 specs/、ldvh-base/）
plugin/package.json:43                    含 web/dist，但实际不打包（.gitignore:23 dist/ 命中）
plugin/lib/guidance-text.js:81            引导文本假定 specs/00 存在
```

**双通道隔离检验**

```bash
grep -rn '"specs"' plugin/lib/*.js plugin/web/api/services/*.ts | grep -v '^\S*: *[/*]'
  → 仅 ldvh-tools.js:75 一处，且锚定 projectRoot
grep -rn 'ldvh-base' plugin/lib/*.js | grep -iE 'readdir|scan|glob|walk'
  → 仅 adr-enumeration.js:44 注释，无递归扫描
```

**ADR 转向缺口**

```bash
sed -n '99p'  specs/22-ADR-决策.md   # §6.3 承认「已被完整承接进规范源…不再承担约束」
sed -n '275p' specs/22-ADR-决策.md   # §15 红线「不把 ADR 变成规则源」
sed -n '127p' specs/22-ADR-决策.md   # retirement_reason 闭集三值
sed -n '149p' specs/22-ADR-决策.md   # 状态闭集 active/retired
sed -n '162p' specs/22-ADR-决策.md   # superseded-by 只能指向 ADR
sed -n '130p' specs/21-WorkCase-工作项.md  # serves 先例：标量字段而非 relations
ls ldvh-base/adrs/                   # 1 实例，无 retired
```

**规范源与事实源的两级（00）**

```bash
grep -rc '元规范\|事实规范' specs/*.md    # 收敛时点：00=6、01=1、27=19，其余 0
specs/00-理念与构成.md:132               # §3.3 事实规范以事实对象形态承载于事实源
specs/00-理念与构成.md:136               # §3.3 具体归属判断由规范模型定义
specs/00-理念与构成.md:152               # §3.6 两级共用同一套受控建立程序
specs/00-理念与构成.md:170-182           # §4.3 受保护内容五类
```

---

## 10. 原件映射（收敛来源 ⇄ 本文章节）

| 归档原件 | 被吸收的章节 | 处置 |
|---|---|---|
| `design-fact-norm-in-fact-source.md` | §1.1、§2、§3、§4、§6、**§7.1（撤回，含附录 A）**、§8.3、§8.5 | 结论与证据保留；被推翻的 `norm_source` 全文按「一句撤回 + 理由 + 撤回范围」收敛 |
| `design-one-direction-one-norm.md` | §2.2（载体与命名比选）、§3、§4、§5、§5.4 | 六问设计的**已定案部分**归入 §3–§5；未定案部分归入 §8.4 |
| `proposal-fact-norm-foundation.md` | §1.1、§1.3（D1–D6 判据）、§1.4、§8.3 | 立项论证的**事实基线**保留；**§4「效力机制」与 §6.3 的 `norm_source` 依赖已随 §7.1 撤回** |
| `adversarial-fact-norm-necessity.md` | §1.1、§7.2（时间语境之一半）、§8.2、§8.3、§8.4（反方弱点） | **对抗结论保留**（「新文档解决不了承载位置冲突」「01 的洞 vs 新权威」）；其反对的**具体形态**（新建独立基础规范文档）已被 27 号以**事实类型规范**形态绕过 |
| `survey-dual-read-channels.md` | §2.2（隔离检验）、§8.5（实现清单 + frictions/workcases 漂移） | 事实调查结论与文件:行号全保留 |
| `survey-spec-distribution-boundary.md` | §1.4 | 发布边界机械事实全保留；**「20 份/5732 行」等规模快照已过期（现为 21 份含 27 号），不保留** |
| `research-adr-to-norm-boundary.md` | §8.1（O1）、§7.2、§7.3 | 缺口分析、三界定权衡、`21:130` 先例全保留；附录 B 的更正保留 |
| `survey-software-directions.md` | §5（成体系判据）、§7.4（方向粒度） | **42 方向清单与量级估计不搬入**（27 §12 已承接为规范内清单，且规范清单是权威）；**§4.3 对判据的六处边界质疑保留为设计输入** |
| `spec-drift-inventory-2026-09-11.md` | §7.2、§8.3、§8.5 | **D1–D6 收敛时点已基本消解**（见 §11）；其**方法论**（机械扫描 + 不采信旧计划结论）保留 |

---

## 11. 收敛时点的漂移复核（对 `spec-drift-inventory` 的机械复检）

原件 `spec-drift-inventory-2026-09-11.md` 列的 D1–D6，在**本次收敛时点**的实测状态：

| 原编号 | 原偏移 | 复检结果 | 证据 |
|---|---|---|---|
| **D1** | 「行动模板」在 12 份规范存活（共 53 处） | **已消解**（仅剩 1 处） | `grep -rc '行动模板' specs/*.md specs/attachments/*.md \| grep -v ':0'` → 仅 `specs/04-业务系统基础规范.md:1` |
| **D2** | `04-行动模板基础规范.md` 整份悬空 | **已处置** | 现为 `specs/04-业务系统基础规范.md`，`spec_key: business-system-foundation`，`title: 业务系统基础规范` |
| **D3** | 21 号 WorkCase 规范缺失但被 10 处引用 | **已消解** | `specs/21-WorkCase-工作项.md` 已存在 |
| **D4** | `02` 章节号断层（5 处 `### 19.x`/`20.x` 挂在 `## 21`/`22` 下） | **已消解** | 全 21 份扫描 `### N.M` 与所属 `## N` 不匹配 → **零命中** |
| **D5** | `01.Att.01` 术语表「行动模板」溯源指向不存在的依据 | **已消解** | `grep -n '行动模板' specs/attachments/01.Att.01-LDVH双语术语表.md` → **无命中** |
| **D6** | `01` 编号表登记 04 行、`:135`/`:190` 定义 `30–38` 行动模板段 | **已消解** | `01:135` 现为「04 定义 `30–35` **业务系统**规范共同结构」；`01:174` 现为「04 \| 业务系统基础规范 \| …」；`01:190` 已登记 **27 \| Norm-事实规范** |
| —— | 批 1 术语替换（技术支撑→能力承载等） | 原件已标「已完成」 | `grep -rc '技术支撑' specs/` → 0 |

**结论**：`spec-drift-inventory` 的六项偏移**全部已消解或已处置**。其作为「偏移盘点」的**时效价值已用尽**，仅其**方法论与未处置范围声明**（未逐字通读、未排查语义层偏移）仍具参考价值——这也是本文件 §8 未决项清单存在的理由。

---

## 12. 已证实 / 未证实 / 残留风险

### 已证实（机械可复现）

1. 元规范候选路径仅 `specs/` 与 `specs/attachments/`；成员资格由 `SPEC_PATH_PATTERN` 决定；`ldvh-base/` 不在其中。
2. Norm 载体设计（`ldvh-base/norms/norm-<uid>.md`）与元规范扫描器**路径隔离**，不消耗数字命名空间，不撞号。
3. `specs/` 从管辖项目 Git 根读取；插件包**既不含 `specs/` 也不含 `ldvh-base/`**；安装**从不创建 `specs/`**。
4. 引导文本引用 `specs/00`，而安装不供给 → **悬空假定**。
5. `specs/00-理念与构成.md` 与 `specs/27-Norm-事实规范.md` 是两级承载与 Norm 类型的**现行权威文本**；27 号已定稿并登记。
6. `22 §6.3:99`/`§15:275` 承认「决策可被承接进规范源」，而 `22:127`/`:162`/`:149` 的闭集**无法表达该事件**；本仓库 `adrs/` 无 retired 实例（缺口未被触发）。
7. `specs/03` §6.1 允许类型专属字段增量 → `direction_key` 无需修改 03 正文。
8. `direction_key` 的精确排他与骨架校验可机械实现；**语义同义异名不可机械防止**。
9. 实现侧全部未建（`norms/` 目录、常量、writer、Git Gate 断言、Web 契约与视图）。
10. 既有漂移两处：`frictions` 不在种子清单；`workcases` 在清单但目录不存在（已产生用户可见 `incomplete` 误报）。
11. `spec-drift-inventory` 的 D1–D6 在收敛时点**全部已消解或已处置**（§11）。

### 未证实（需 Human / 后续核实）

1. 「管辖项目会有大量自身规范」——**仍是推测**，无第二个真实项目样本（本机登记载体仅 `dsh-ldvh` 一个）。
2. 具体哪些既有 `specs/` 规范可迁移为 Norm（需逐份按 D1 判定）。
3. 未来是否决定「插件捆绑元规范」——决定发布边界能否成为可操作差异。
4. 是否存在真实的 ADR→Norm 转向需求（当前 **0 实例**）。
5. Web 类型枚举的消费点是否全部被 `FactType` 覆盖；是否存在按类型的 UI 映射表。
6. 受控写入入口能否调用规范枚举（`scanSpecCandidates` 是 lib 层函数，未证实已被 05 复用）。
7. 「事实规范 = 规范等价物」模型尚未在任何规范中明文确立（目前是从 `22:23` 与 Human 判据推出的**解释**）。

### 残留风险

1. **`00 §3.3` 措辞与新模型的张力**：若「效力由类型与状态决定」被正式确立，`00 §3.3`「其效力来自规范源」在**事实规范**侧需重新解释或澄清，**可能触及 00 修订（Human Gate）**。
2. **实现缺口敞口**：Norm 类型已定稿，但**无写入器、无 Git Gate 断言、无 Web 契约** → **三道防线一道未建**。在实现落地前，`direction_key` 排他**仅是规范文本**，任何一次 `mkdir` + 手写文件都能绕过。
3. **语义重叠敞口**：同义异名无机械补偿；项目级方向登记簿**未建**，查重**无机械强制**。
4. **ADR 转向缺口敞口**：缺口已被 27 号**转交** 22 号，22 号未处理；一旦出现第一条「决策被规范完整承接」的实例，将立即面对「用哪个 `retirement_reason`」的无解问题，且存在双重约束窗口。
5. **本章各项「未证实」全部构成**「机制已设计但依据未实证」的风险面（`00 §6.3` 第二款）。
6. **收敛本身的信息损耗**：本文件按主题重组，**必然丢弃**原件中的部分过程性推理（尤其各代理的逐条攻击与反驳）。原件已归档保留 git 历史，如需回溯决策过程，应查 `docs/archive/` 下对应文件**原文**，而非本文件的转述。

---

*本文件为汇总文档，不取得规范效力。规则以 `specs/` 原文为准。*
