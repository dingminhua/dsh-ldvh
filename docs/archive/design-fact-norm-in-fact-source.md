# 「事实规范（项目规则）作为事实对象」设计候选

> 性质：**设计候选文档，非规范正文，不构成立项或生效**。
> 依据：LDVH 00 §4.2——新增事实模型（事实类型）属 Human 根决定事项；本文件只出候选，不声称已生效。
> 既定方向（Human 已批准，不再论证）：
> 1. 事实规范存放位置 = `ldvh-base/norms/`；
> 2. 新增一类事实类型，编号 **27** 可用（20–26 已占用）；
> 3. 元规范（`specs/`）保持独立通道；事实规范随其他事实对象，**不同事实对象有不同召回机制**。
> 约束：未修改 `specs/` 任何文件，未 `git commit`。所有事实断言附 `文件:行号` 或可复现命令，并标注【已证实 / 未证实 / 残留风险】。

---

## 0. 证据基线（本人独立复核）

| # | 复核项 | 位置 / 命令 | 结果 | 状态 |
|---|---|---|---|---|
| B1 | 00 支持事实规范以事实对象承载于事实源 | `specs/00-理念与构成.md:132` | 「事实规范承载管辖项目的规则，以事实对象形态承载于事实源」 | 【已证实】 |
| B2 | 承载位置 ≠ 效力来源；效力来自规范源 | `specs/00-理念与构成.md:132` 后半句 | 同上句，「其效力来自规范源……不因存放位置而取得规范效力」 | 【已证实】 |
| B3 | 两级共用同一受控建立程序；不得放松元规范、不得自授效力 | `specs/00-理念与构成.md:152` | 「两级规范共用同一套受控建立程序，事实规范不得放松元规范、不得自授效力」 | 【已证实】 |
| B4 | 元规范与事实规范仅出现于 00 | `grep -c '元规范\|事实规范' specs/0[1-9]*.md` | 01–09 全部 0 行；仅 00 命中 | 【已证实】 |
| B5 | 元规范候选路径仅 `specs/` 与 `specs/attachments/` | `specs/01-规范模型基础规范.md` §9.1（行 209–215） | `ldvh-base/` 不在元规范候选路径 | 【已证实】 |
| B6 | Web 事实读取按 `ldvh-base/<type-dir>` | `plugin/web/api/services/localFactReader.ts:14,99` | `baseDirOf = join(scope.worktreeLocator,'ldvh-base',FACT_TYPE_DIRS[type])` | 【已证实】 |
| B7 | 插件种子化目录清单（漂移点） | `plugin/lib/governed-projects.js:13` | `FACT_DIRECTORIES=["sparks","workcases","adrs","pitfalls","researches"]` | 【已证实】 |
| B8 | Web 侧类型目录映射（漂移点） | `plugin/web/api/services/localFactReader.ts:14-21` | `FACT_TYPE_DIRS={workcase:'workcases',adr:'adrs',pitfall:'pitfalls',spark:'sparks',research:'researches',friction:'frictions'}` | 【已证实】 |
| B9 | `workcases` 在清单但 `ldvh-base/workcases/` 实际不存在 | `find ldvh-base -maxdepth 1 -type d` | 实际子目录：`sparks adrs pitfalls researches`（无 workcases、无 frictions） | 【已证实】 |
| B10 | `frictions` 由 writer 写入但不在种子清单 | `plugin/lib/friction-writer.js:45` + B7 | `FRICTION_DIRECTORY="frictions"`；B7 无 `frictions` → `initializeFactSource` 不 mkdir | 【已证实】 |
| B11 | `goal.md` 单例不在 FACT_DIRECTORIES | `ldvh-base/goal.md` 存在；B7 无 `goal` | 单例走专属路径，不在多例清单 | 【已证实】 |
| B12 | 元规范编号命名空间（不与事实对象撞号） | `plugin/lib/spec-registry.js:27,29` | `SPEC_ID_PATTERN=/^[0-9]{2,}$/`、`SPEC_PATH_PATTERN=/^specs\/[0-9]{2,}-[^/]+\.md$/` | 【已证实】 |
| B13 | 元规范扫描只扫 `join(projectRoot,"specs")` | `plugin/lib/ldvh-tools.js:75-93` | `scanSpecCandidates` 仅枚举 `specs/` 与 `specs/attachments/` | 【已证实】 |
| B14 | 现有类型采用 markdown 载体且 frontmatter 为机器权威 | `plugin/web/api/services/localFactReader.ts:23-34,44-49` | `FACT_TYPE_CARRIERS` 中 adr/pitfall/spark/research/friction='.md'；`carrierFor` 返回 'markdown' | 【已证实】 |
| B15 | ADR 状态机先例 | `specs/22-ADR-决策.md:121-156` | `active`/`retired` + `superseded-by` 关系 + `retirement_reason`/`retired_at` | 【已证实】 |
| B16 | 元规范读取入口 | `specs/01-规范模型基础规范.md:267` | `read-specification-candidates`(L0–L2) / `read-specification-content`(L3/L4)，按 `responsibility_key` | 【已证实】 |
| B17 | 事实召回按「类型来源」组织 | `specs/03-事实模型基础规范.md:227` | 「具体类型来源定义本类型的召回时机……03 不建立所有类型共用的触发词」 | 【已证实】 |
| B18 | 03 公共身份字段与单例豁免 | `specs/03-事实模型基础规范.md:127-133` | `object_uid`/`fact_type_key` 单例可声明不采用（25 号先例，路径即身份） | 【已证实】 |
| B19 | 03 类型规范共同结构（十角色） | `specs/03-事实模型基础规范.md:348-378` | §11.1 十角色、§11.2 必填问题、§5.3 十三问 | 【已证实】 |
| B20 | 27 为可用编号段 | `specs/01-规范模型基础规范.md:183-191` | 20–24 预留段、25/26 扩展段；27/28/29 未用 | 【已证实】 |

**关键推论（独立得出，非任务书原文）**：
- 由 B5+B13：**`ldvh-base/norms/` 不会被 `scanSpecCandidates` 收进元规范成员**——它扫描的是 `projectRoot/specs`（仓库根），不是 `ldvh-base/norms`。这正是「项目规范进 `ldvh-base/norms/` 而不进 `specs/`」能消解撞号风险的根因（B12 的命名空间只作用于仓库根 `specs/`）。
- 由 B6+B13：事实规范经 Web 事实读取器（`ldvh-base/norms/`）召回，元规范经 `read-specification-*`（`specs/`）召回；**两条入口、两个绝对基路径，天然隔离**。
- 由 B3：本设计可以「分机制（存储/召回/呈现）」，但**不可以「分建立程序」**——事实规范的创建/更新/终态必须复用 03 §9 受控读写与 06 提交契约，且新增可强制执行规则须经 00 §4.2 Human Gate。

---

## 1. 对象边界（粒度、查重、排除项）

### 1.1 一个对象 = 一条可独立贯彻的项目规则义务
一份事实规范对象 = **一个管辖项目内、可独立召回、可独立核对遵从性、可独立失效的强制/约定性规则义务单元**。判据（仿 22 §91 的「可独立贯彻」粒度）：
- 可独立召回：按 `scope` + `title` 能稳定命中；
- 可独立核对遵从性：任一相关行动能对照本条回答「守没守」；
- 可独立违背：装配淘汰/预检拦截时能指向「哪条事实规范」；
- 可独立终态：不再适用时单独 `retired`，不牵连其它规则。

**粒度判据（建议落地）**：对同一主题的多条松散规则，宁可拆成多份事实规范也不打包一份——打包的集合无法逐条贯彻检查，等于没有效力（与 22 §91 同源）。一份文件 = 一个对象（多例、一文件一对象，仿 `adrs/`）。

### 1.2 查重判据
创建前对照既有 **active** 事实规范的 `title` / `scope` / `obligation` 语义比对（AI 语义判断，03 §8.2 不建相似度自动裁决）。同主题规则已存在且仍适用 → **不新建**，走补充级更新并入既有对象；已存在但义务实质变化 → 走替代路径（新对象 + 旧 `retired`，不改写旧义务语义）。查重结论必须记录在创建提案中。

### 1.3 明确不属于本类型（排除项）
| 相似内容 | 归属 | 判别锚 |
|---|---|---|
| 元规范（LDVH 自身规则） | `specs/` 下 00–26 等 | 由规范模型定义、经 L0–L4 读取；事实规范承载的是**管辖项目**规则（B1、B2） |
| ADR（已定决策） | `ldvh-base/adrs/` | ADR=决策+理由+备选；事实规范=义务+适用条件。决策被承接为可强制执行规则时由**事实规范**承载其内容，ADR 保留决策谱系（22 §23、§275） |
| Spark（方向悬置） | `ldvh-base/sparks/` | 决策/规则未结晶前住在方向主线，不应有事实规范 |
| Pitfall（教训规避） | `ldvh-base/pitfalls/` | 「别这么做」是经验不是「必须这么做」的规范义务 |
| Research（外部证据） | `ldvh-base/researches/` | 调查支撑，不承载决定/规则 |
| WorkCase（执行项） | `ldvh-base/workcases/`（待建） | 授权执行层，不是规则 |
| Friction（待修账） | `ldvh-base/frictions/` | 改进账本，入账不产生修订义务 |
| Goal（目标锚） | `ldvh-base/goal.md` | 目标陈述不是规则 |
| **类型定义规范 27 本身** | `specs/27-….md` | 27 是**元规范**（定义本类型），不是事实规范实例；实例落 `ldvh-base/norms/` |

---

## 2. 身份与载体

| 项 | 设计 | 对照现有类型 |
|---|---|---|
| 形态 | 多例、一文件一对象 | 仿 `adrs/`、`pitfalls/`、`frictions/`（B9 实测子目录均为多例） |
| 目录 | `ldvh-base/norms/` | Human 指定；与仓库根 `specs/`（元规范）为不同绝对基路径，机械隔离（B5/B6/B13） |
| 文件名 | `factnorm-<object_uid>.md` | 仿 `adr-<uid>.md`、`friction-<uid>.md`（B14 的 `{type}-<uid>` 形态） |
| 载体 | Markdown（frontmatter 机器权威 + 正文），同 22/23/26 | B14：`carrierFor` 返回 'markdown' 的类型之一 |
| `fact_type_key` | **采用** = `factnorm`（小写 kebab，03 §6.1 值域） | 仿 `adr`/`friction`（20 §107、22 §105） |
| `object_uid` | **采用** = Code 生成 UUIDv4（多例，不可变） | 仿多例类型；单例豁免（25）不适用本类型 |

**残留风险 R1**：目录基名 `specs` 在 `ldvh-base/norms/` 与仓库根 `specs/` 两处重复，可能误导人类/工具。机械上两条入口基路径不同（B6 vs B13），不冲突；建议在 27 号规范与 Web 文案中明确标注「事实规范源目录 ≠ 元规范目录」。需在 Human 裁定时确认是否接受该命名。

---

## 3. 字段契约

### 3.1 公共字段采用

| 公共字段 | 采用 | 说明 |
|---|---|---|
| `object_uid` | ✅ 必填 | UUIDv4，Code 托管（B18） |
| `fact_type_key` | ✅ 必填 | 唯一合法值 `factnorm` |
| `title` | ✅ 必填 | 短标题，不承载完整义务 |
| `created_at` | ✅ 必填 | Code 托管 |
| `status` | ✅ 必填 | `active`/`retired`（见 §4） |
| `change_log` | ✅ 首修后必有 | 受控更新留痕 |
| `urls` | 条件 | 仅承载长期消费价值的外部资料 |
| `relations` | 条件 | 仅终态 `superseded` 时出现（见 §4） |

### 3.2 专属字段

| 字段 | 类型 | 必填/条件 | 语义与边界 |
|---|---|---|---|
| `scope` | string | 必填 | 规则适用对象/边界（哪些文件、目录、流程、角色）；正文须逐字包含 |
| `obligation` | string | 必填 | 可强制执行的规则义务陈述（MUST/SHOULD）；机械校验：非空、单句可读 |
| `norm_source` | object | **必填** | **效力挂靠字段**（见 §3.3） |
| `retirement_reason` | string(闭集) | 仅 `retired` | `superseded`/`outdated`/`out-of-scope`/`project-changed` |
| `retired_at` | RFC3339 | 仅 `retired` | Code 填写 |

### 3.3 效力挂靠字段 `norm_source`（核心设计）

**形状**（结构化，仿 03 §7.2 关系证据 locator 的封闭形态）：

```yaml
norm_source:
  spec_key: "<责任标识符，如 fact-model-foundation / code-practice-spec>"
  canonical_path: "specs/09-Code实践与测试规范.md"
```

- `canonical_path`：必须匹配 `SPEC_PATH_PATTERN`（`plugin/lib/spec-registry.js:29`）。
- `spec_key`：必须匹配 `ID_PATTERN`（`spec-registry.js:26`）。

**必填性**：创建即必填；缺失 → 写前校验失败（fail closed）。一份事实规范**必须**显式挂靠某个元规范成员，否则「效力来自规范源」（B2）无从机械锚定。

**机械校验（解析为当前规范源成员）**：
1. 调用 `scanSpecCandidates(projectRoot)`（`ldvh-tools.js:75`）得到 `members[]`；
2. 校验 `norm_source.canonical_path` ∈ `members[*].canonical_path` 且对应 `identity.responsibilityKey === norm_source.spec_key`；
3. 该成员 `spec_kind === "spec"`（非 attachment），且 `parseSpecDocument` 通过（即当前确为规则源成员，B13）；
4. 任一不满足 → 写入拒绝，返回 gap（「norm_source 未解析为当前规范源成员」），不落盘、不提交。

**为什么能机械校验**：`scanSpecCandidates` 是元规范成员的唯一权威枚举（B13），事实规范的 `norm_source` 指针只能指向其中一员；解析失败即 fail closed，从入口阻断「无源规范」与「假源规范」。

**无法机械覆盖的部分（如实说明）**：「不得放松元规范」的**语义**相符性（事实规范义务是否真与所挂靠元规范一致、未放宽）**不能**仅靠路径解析保证，需 Human Gate 在创建时判定（见 §6）。

---

## 4. 状态与生命周期

状态闭集两值，仿 ADR（B15）：

| `status` | 语义 | 必须成立 |
|---|---|---|
| `active` | 规则现行有效，参与预检与装配 | `retirement_reason`、`retired_at`、`relations` 均不得出现 |
| `retired` | 规则不再适用，保留为历史基线 | `retirement_reason` 与 `retired_at` 必填；`retirement_reason=superseded` 时 `relations` 必含恰好一条 `superseded-by`；其他理由时 `relations` 禁止出现 |

- 初态必为 `active`；
- 正常转换仅 `active → retired`（Human Gate：规则废止/替代）；
- 终态不重开；错误终态按 05 事实更正修正；
- 义务实质变化（非补充新观察）走新对象 + 旧 `retired`，不改写旧义务语义（仿 22/23）。

**为何沿用 active/retired 而非 open/resolved**：事实规范是「在效力 / 不在效力」的二元规范义务，与 ADR 同构；不像 Friction 是「待修账」需要 open/resolved/deferred 三态（26 §141）。落点：参照 22 §149 两态先例。

---

## 5. 召回机制（Human 强调整点）

### 5.1 与 03 §8 四层对应
事实规范是事实对象，召回严格走 **F0–F4**（03 §8.1，B17），**不混用** 01 的 L0–L4（B16）。层级映射：
- F0：管辖项目 / `factnorm` 类型计数 / 当前 active 事实规范集指纹；
- F1：active 事实规范的 `title`+`scope`+`obligation` 最小卡片（恢复基线）；
- F2：按 `scope`/稳定引用命中候选（行动落入某 scope 时）；
- F3：展开 `factnorm-<uid>.md` 全文 + 当次机械校验；
- F4：展开 `norm_source` 指向的元规范成员相关条款核对「是否放松」。

### 5.2 为什么必须与元规范读取机制不同
| 维度 | 元规范 | 事实规范 |
|---|---|---|
| 入口工具 | `read-specification-candidates` / `read-specification-content` | `ldvh_*` 事实工具（F0–F4） |
| 扫描基路径 | `projectRoot/specs/` | `projectRoot/ldvh-base/norms/` |
| 分层 | L0–L4（渐进披露） | F0–F4（召回分层） |
| 成员枚举 | `scanSpecCandidates` | Web 事实读取器 `baseDirOf` |

两路径绝对基不同、工具不同、分层不同——这正是 B3「分机制」的落点；但**建立程序**（受控写入、提交契约、Human Gate）共用（§6/§8）。

### 5.3 具体召回触发条件（AI 应召回本项目的 active 事实规范）
1. **行动前预检 / 讨论装配**：主控即将在受管辖项目内行动，且该行动落入某 active 事实规范的 `scope`；
2. **写入/提交前**：主控即将写入或提交、且目标文件/目录/流程属于某事实规范 `scope`；
3. **显式询问**：主控问「本项目有没有关于 X 的规则/约定」——精确引用稳定事实，进入 F2/F3；
4. **事实预热**：08 环境接入 / 05 Helper 在已满足事实消费进入条件（03 §8.2）时，把 active 事实规范的 `scope`+`obligation` 摘要作为恢复入口/卡片注入（不得把概率召回变事实声明）；
5. **Web 规则书视图**：Human 消费——渲染 active 事实规范列表（10 号 Web 承接）。

进入条件遵守 03 §8.2：规则引导先于事实消费；新会话/压缩/委派本身不自动证明必要，也不证明不存在。

---

## 6. 与元规范的边界（机械落点）

**铁律**（B3）：事实规范不得放松元规范、不得自授效力。

### 6.1 机械落点（写前校验，fail closed）
入口：受控创建/更新（05/09，复用 03 §9）。
- **检查 A（效力挂靠）**：`norm_source` 必须解析为当前元规范成员（§3.3 四步）；失败 → 拒绝写入 + gap。
- **检查 B（不自授效力）**：事实规范正文/字段**不得**包含「本规范授予/扩张/覆盖/修改元规范效力」「relaxes/overrides 元规范」类自授表述；出现 → 拒绝写入。机械形态：命中否定性关键词闭集（如 `覆盖元规范`、`放松`、`自授效力`、`绕过`、`override`），交由 05 在草案校验阶段拦截。
- **检查 C（不放松）的语义部分**：`obligation` 与所挂靠元规范条款是否一致、未放宽——**不可纯机械判定**，由 Human Gate 在创建/更新提案中判定（见 6.2）。

### 6.2 Human Gate（授权落点）
- 创建事实规范 = **新增可强制执行规则**，属 00 §4.2「新增、改写或扩张可强制执行规则」+「接受来源规则要求交由 Human 处理的重大取舍」→ 必须 Human 决定；
- 终态流转（retired/superseded）同样 Human Gate；
- 勘误级更新（拼写、scope 细化、补充证据）走受控更新留痕；**义务实质变化**不得走更新，必须新对象 + 旧 retired（仿 22 §110）。

### 6.3 fail 时怎么办
- 检查 A/B 失败：零写入、返回 `partial_scope`/gap（03 §9.8），受影响范围保持暂停，不落盘、不提交、不声明成功；
- 检查 C 存疑：提案呈 Human Gate，未获作用范围清楚回应前受影响事项暂停（00 §4.4）。

---

## 7. Web 呈现（最小改动清单）

现有链路：`localFactReader.ts` 按 `FACT_TYPE_DIRS` 定基路径、`FACT_TYPE_CARRIERS` 定后缀、`carrierFor` 定载体（B6/B14）。

**Web 侧最小改动（`plugin/web/`，属 plugin 改动，本候选仅列，不在本次实施）**：
1. `FACT_TYPE_DIRS` 增加 `factnorm: 'specs'`（→ `ldvh-base/norms/`）；
2. `FACT_TYPE_CARRIERS` 增加 `factnorm: '.md'`；
3. `carrierFor` 的 markdown 类型列表（B14:44-49）增加 `factnorm`；
4. 文件名校验正则（B6:385-392）已通用引用 `FACT_TYPE_CARRIERS[type]`，无需改；
5. 10 号 Web 新增「事实规范 / 项目规则书」卡片视图（active 列表 + `scope`+`obligation` 呈现），承接 §5.3.5。

---

## 8. 受控操作

复用 03 §9 契约，不另立写入路径：
- **草案**（§9.3）：派生类型来源、Schema 指纹、允许/托管字段边界；不占 UID、不写源；
- **创建**（§9.4）：消费草案 → Code 生成 `object_uid`/`created_at` → 校验类型字段（含 §3.3 检查 A/B）→ 原子写入 `ldvh-base/norms/factnorm-<uid>.md` → 写后精确回读 → 返回 `actual_ref`/指纹/机械结果；Human Gate 前置；
- **更新**（§9.5）：完整 after 替换 + 恰好一条 `change_log`；义务变化走新对象；
- **终态**（§9 / §4 本设计）：`active→retired` 经 Human Gate，写 `retirement_reason`/`retired_at`；
- **多对象**（§9.6）：替代关系（新+旧 retired）若需原子，须 05/09 显式定义，否则保持两对象各自原状交还；
- **提交**：复用 06 提交契约与 Git Gate 终闸（01 §9.2.11 不变量）。

---

## 9. 目录对齐（一并修正漂移）

**现状漂移（B7–B11）**：
- `FACT_DIRECTORIES`（plugin）含 `workcases` 但 `ldvh-base/workcases/` 不存在（21 未建）→ 声明-实际不符；
- `frictions` 由 writer 写入（B10）却不在 `FACT_DIRECTORIES` → `initializeFactSource` 不 mkdir，依赖运行时补救；
- `goal.md` 单例不在清单（合理，单例专属路径）。

**对齐后完整清单（建议）**：

`plugin/lib/governed-projects.js` `FACT_DIRECTORIES`：
```js
const FACT_DIRECTORIES = ["sparks", "adrs", "pitfalls", "researches", "frictions", "specs"];
// 移除 "workcases"：21 未建、目录不存在；待 21 落地时再加回，消除「声明-缺失」漂移
```

`plugin/web/api/services/localFactReader.ts` `FACT_TYPE_DIRS`：
```js
export const FACT_TYPE_DIRS = {
  spark: 'sparks',
  adr: 'adrs',
  pitfall: 'pitfalls',
  research: 'researches',
  friction: 'frictions',
  factnorm: 'specs',   // 新增：事实规范（27 号类型）
  // workcase: 'workcases'  // 21 落地时再加回
};
```

要点：`frictions` 补进 plugin 种子清单（与 web 对齐）；`specs` 作为事实类型目录加入两侧；`workcases` 两侧同步移除至 21 建成为止。

---

## 10. 反过度设计检验（00 §6.3 硬要求）

| 检验项 | 回应 |
|---|---|
| **回应第 1 章哪个问题** | 00 §1 痛点 4「历史经验与教训无法积累」+ 痛点延伸：管辖项目自身规则随对话消散、无受控写入、无状态闭集、无预检引用契约 → 与 22/23/26 同一类「项目稳定信息无法跨会话接续」问题，本类型补「项目规则」这一缺失载体 |
| **落实第 2 章哪项根方案** | 00 §2 根方案「规范源由元规范与事实规范两级承载」+ §3.3「事实规范以事实对象形态承载于事实源」。本设计把「两级承载」从纯文字落为可机械区分的存储/召回/呈现双通道，不新增语义构成要素（B3、00 §3.2） |
| **影响哪些 V / HV** | 主要 V3（边界识别：行动落入已知规则在预检即暴露）、V5（据实判断：违背可回指「哪条事实规范」）、V6（跨会话恢复规则基线）、V8（持续积累）；HV3（入档闭环节点可验）、HV5（项目规则演进脉络可循）。与 22/23/26 同源，不新开价值账本 |
| **新增什么负担与风险** | 负担：① 新增类型定义规范 27（元规范侧）；② 新增 `ldvh-base/norms/` 目录与 Web 读取分支；③ 每条创建/更新增加 `norm_source` 解析校验；④ 漂移修正（§9）连带改动 plugin 两侧。风险 R1：目录基名 `specs` 两处重复可能误导（§2 残留风险）；风险 R2：`norm_source` 仅机械保证「指向有效成员」，语义「不放松」仍需 Human Gate，存在人工判断被绕过的可能（见 §6.3） |
| **以什么证据核对** | ① 目录隔离：命令 `find ldvh-base -maxdepth 1` 与 `scanSpecCandidates` 扫描基对比（B5/B6/B9/B13）；② 命名空间不撞：B12 的 `SPEC_PATH_PATTERN` 仅作用于仓库根 `specs/`，事实规范实例在 `ldvh-base/norms/` 不消耗数字编号（本设计 §2 结论）；③ 状态机/字段复用：对照 22 §121-156、B15；④ 反过度设计：对照 03 §15 红线（不为低频/未来可能造字段） |

**答不出的部分（如实）**：
- `norm_source` 能否在 05/09 当前实现中直接调用 `scanSpecCandidates` 做解析校验——需确认 05 Helper 是否暴露该枚举入口（B13 是 lib 层函数，未证实已被 05 复用为校验依赖）。标注【未证实】。
- 事实规范与 ADR 在「决策被承接为可强制执行规则」时的精确边界（22 §275 称此时由规范源承载）——本设计将此类内容归事实规范，但需 27 号规范与 22 号在 Human 审核时最终划清，避免重叠收养。【未证实 / 待裁定】

---

## 11. 编号与上位关系建议

| 项 | 建议 | 依据 |
|---|---|---|
| 事实类型编号 | **27** | Human 批准；B20 可用 |
| 类型定义规范 | `specs/27-事实规范类型.md`（**元规范**，进仓库根 `specs/`，被 `scanSpecCandidates` 收为成员） | 仿 20–26 均为 `specs/` 下元规范；B13 |
| 该规范 `spec_id` | `"27"` | B12/B20 |
| 该规范 `spec_key` | `"factnorm-fact-type"` | 仿 `adr-fact-type`/`friction-fact-type`（20 §3、26 §3） |
| `parent_spec` / `relation` | 空（仿 22 头）；`basis` 含 `fact-model-foundation`、本类型相关元规范 | 03 §11、22 §8 |
| 01 §8.1 登记 | 新增一行 `27 | 事实规范 / FactNorm | 知识层事实类型：管辖项目规则、active/retired、norm_source 效力挂靠与受控操作` | 01 §8.1（B16 区） |
| 实例 `object_uid` | 采用 UUIDv4（多例） | §2 |
| 实例是否消耗 `spec_id` 数字命名空间 | **否** | 实例在 `ldvh-base/norms/`，不在仓库根 `specs/`；B12 命名空间不覆盖 → 消解撞号风险（本设计核心优势） |
| 实例 `norm_source` 指向上位 | 指向**实际授权该规则的元规范成员**（如 `specs/09-…md`），而非固定指向 27 | §3.3；一份项目规则挂靠其真正效力来源 |

---

## 12. 真实冲突清单（若有）+ 消解方案

经独立核对，**未发现本方案与 00/01/03 的真实冲突**。需注意的边界（非冲突，但须显式承接）：
1. **B3「共用建立程序」≠「共用读取机制」**：本设计分读取/召回（F vs L）但共用受控写入与 Human Gate——与 B3 一致，无冲突。
2. **`ldvh-base/norms/` 与仓库根 `specs/` 同名**：非规范冲突，是命名歧义风险（R1），靠「两绝对基路径 + 文案标注」消解，不违任何规范。
3. **事实规范 vs ADR 边界**：属定义细化待裁定项（§10 末尾），非已存在冲突。

> 若后续 27 号规范起草时发现与 00 §3.3/§3.6 或 03 §5.3/§11 存在无法调和的冲突，按 00 §7.2 暂停受影响范围并呈 Human，不静默绕过。

---

## 13. 最小改动清单（分列）

**specs/ 侧（本次不实施，仅登记候选；须走 00 §4.2 + 01 §12 独立审核后落）**：
- 新增 `specs/27-事实规范类型.md`（元规范，定义本类型十角色，见 03 §11.1）；
- 在 `specs/01-规范模型基础规范.md` §8.1 登记表新增 27 行（修改 specs/ 须独立审核 + Human 同意，受 00 §4.3 受保护内容边界约束——01 是否属受保护内容以 00 §4.3 为准）。

**plugin/ 侧（本次不实施，仅列）：**
- `plugin/lib/governed-projects.js:13`：`FACT_DIRECTORIES` 加入 `"frictions"`、`"specs"`，移除 `"workcases"`（至 21 建）；
- `plugin/web/api/services/localFactReader.ts:14`：`FACT_TYPE_DIRS` 加入 `factnorm: 'specs'`、`friction` 已在；`:23` `FACT_TYPE_CARRIERS` 加入 `factnorm: '.md'`；`:44-49` `carrierFor` 列表加 `factnorm`；
- 05 Helper / 09 Code：在受控创建/更新入口实现 §3.3 检查 A（norm_source 解析）+ 检查 B（不自授效力关键词拦截）；
- 10 号 Web：新增事实规范（项目规则书）卡片视图。

---

## 14. 已证实 / 未证实 / 残留风险

**已证实**：B1–B20 全部（见 §0 表格，均附 `文件:行号` 或可复现命令）。

**未证实**：
- U1：05 Helper 当前是否已可调用 `scanSpecCandidates` 做 `norm_source` 解析校验（§10 末尾）；
- U2：事实规范与 ADR 在「决策→可强制执行规则」边界的最终划分（§10 末尾）；
- U3：27 号规范起草是否会触发 01 §4.3 受保护内容边界（01 是否属受保护内容），影响 specs/ 改动是否需要独立提交隔离。

**残留风险**：
- R1：目录基名 `specs` 两处重复可能误导人类/工具（§2、§10）；
- R2：`norm_source` 机械校验只保证「指向有效成员」，语义「不放松元规范」仍依赖 Human Gate，存在人工判断被绕过的可能（§6.3）；
- R3：`workcases` 从两侧移除后若 21 未同步补回，将产生新的「类型已定义但目录未种子化」漂移——须与 21 落地协同（§9）。

---

## 15. 需 Human 裁定事项

1. **目录命名**：接受 `ldvh-base/norms/`（与仓库根 `specs/` 同名，R1）还是改用 `ldvh-base/norms/` 之类无歧义名？Human 原话指定 `ldvh-base/norms/`，但同名风险请确认是否接受。
2. **状态机**：确认沿用 `active`/`retired`（仿 ADR）而非 `open`/`resolved`（仿 Friction）？
3. **`norm_source` 形态**：确认采用「`spec_key` + `canonical_path` 双字段结构化」还是仅 `canonical_path` 单字段？
4. **与 ADR 边界**：当某 ADR 决策被承接为可强制执行规则时，规则内容归事实规范还是仍在 ADR？需 27 与 22 在审核时划清（U2）。
5. **生效路径**：本候选不声称生效；落地须经 00 §4.2 Human 根决定 + 01 §12 独立审核 + 走 06 受控提交。是否现在即启动该路径，还是仅存档为候选？

---

## 附录 A：主控对 `norm_source` 设计的**撤回**（2026-09-11，依 Human 纠正）

> 本附录由主控追加，**推翻本文件正文 §3 的 `norm_source={spec_key,canonical_path}` 设计**。保留原文以供追溯，但**以本附录为准**。

### A.1 Human 的纠正（逐字）

> 「规范效力其实和召回机制有关，adr 是等价规范的，**adr 相当于临时规范，adr 能做到规范更要做到**，所以**不存在路径问题**，但是元规范不一样，**元规范是路径决定的**。」

### A.2 主控独立复核：三条均成立

**① ADR 是「规范等价物」，效力不靠路径** —— 22 原文直接支持：

`22:23`（§5 定位）：
> **ADR 是对 AI 具有持续约束力的法定效力决定**……违背 active ADR 的行动**视同违背规范源**。

「视同违背规范源」= ADR 与规范源**同等约束力**，且该效力由**类型 + `active` 状态**决定，**与文件路径无关**。

**② 元规范是「路径决定的」** —— 机械证据：

```js
// plugin/lib/spec-registry.js:27-30
const SPEC_ID_PATTERN     = /^[0-9]{2,}$/;
const SPEC_PATH_PATTERN   = /^specs\/[0-9]{2,}-[^/]+\.md$/;   // ← 路径即资格
```

`01 §9.1`：候选**只**来自 `specs/<至少两位数字>-<规范标题>.md`。

→ **元规范的成员资格由路径模式机械决定**；路径不对，内容再对也不进规则源。

**③ 效力与召回机制相关** —— 两类召回路径不同：

| | 召回方式 | 依据 |
|---|---|---|
| 元规范 | **L0–L4 渐进披露**（按 `canonical_path` 定位） | `01 §6`、`read-specification-*` |
| ADR | **义务召回**（行动前预检、讨论装配） | `22:23`「行动前预检与讨论装配时被义务召回」 |

### A.3 结构性结论（本设计应采用的模型）

| 维度 | 元规范 | 事实规范（含 ADR） |
|---|---|---|
| **效力判定** | 路径模式（`SPEC_PATH_PATTERN`） | **类型 + 状态**（`fact_type_key` + `active`） |
| **成员资格来源** | `specs/NN-*.md` 路径 | 事实源目录 + canonical 对象 |
| **召回** | L0–L4 按路径渐进披露 | 按类型召回时机（义务召回） |
| **对路径的依赖** | **强**（路径错即失效） | **无** |

### A.4 撤回的后果：事实规范**不需要** `norm_source`

原设计假定「事实规范必须挂靠元规范成员才能取得效力」。**该假定与 00 §3.3 的真实语义相反**：

- `00 §3.3:132`「承载位置与效力来源是两个不同的问题」的**正确读法**是：
  - **元规范**：效力由**路径**决定（位置即效力）；
  - **事实规范**：效力由**类型与状态**决定（位置不影响效力）。
- 因此事实规范**无需**指向某份元规范来「借效力」——它作为**同类事实对象**，按自身类型语义取得约束力，正如 ADR。

**推论**：原 §3 的 `norm_source` 必填字段、以及原 §6「写前三检查」中的 A 项（norm_source 解析校验），**均予撤回**。

### A.5 保留的部分（未被推翻）

以下原设计**不受本撤回影响**，仍然成立：

1. 对象边界、载体形态（`ldvh-base/norms/`，多例，`factnorm-<uid>.md`）
2. 状态机 `active`/`retired`（**Human 已裁定**，2026-09-11）
3. 与元规范的**边界纪律**：`00 §3.6`「不得放松元规范、不得自授效力」仍需机械落点 —— 但落点**不是** `norm_source`，而是「事实规范不得创设**元规范级别的**规则」（见 A.6）
4. F0–F4 召回分层
5. Web 与目录改动清单

### A.6 待重新设计的部分

原 §6 的「写前三检查」需按新模型重写。新模型下的核心问题变为：

- 事实规范的约束力来自**类型 + 状态** —— 那么**什么使它成为「可强制执行规则」**而不只是「一条记录」？
- 与 ADR 的分工：`22 §6.3:99` 说「已被完整承接进规范源的决策，**ADR 不再承担约束**」——在**事实规范即规范**的新模型下，这句话的含义需重新厘清（**这正是 `docs/research-adr-to-norm-boundary.md` 的课题**）。
- `00 §3.6`「不得放松元规范」的机械落点：应表述为「事实规范的内容不得**改变元规范已定的**允许/停止/责任/入口/验证」，而非「必须指向某元规范成员」。

### A.7 残留风险

- 本撤回**未重新设计** §6 的检查机制，只指出原设计不成立 —— 新机制是待办。
- 「事实规范 = 规范等价物」这一模型**尚未在任何规范中明文确立**；它目前是从 `22:23` 与 Human 判据推出的**解释**，需经规范程序确认。
- 若该模型确立，则 `00 §3.3` 的中文表述（「其效力来自规范源」）在**事实规范**这一侧需要重新解释或澄清，**可能触及 00 修订（Human Gate）**。
