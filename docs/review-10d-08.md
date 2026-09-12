# 十维独立对抗审核报告：specs/08-DSH环境接入与插件发布规范

- **被审对象**：`specs/08-DSH环境接入与插件发布规范.md`（224 行，spec_id `08`，spec_key `dsh-environment-integration`）
- **审核者角色**：LDVH 独立对抗审核者（依 `01 §12.3` 十维规程，单对象专项）
- **工作区状态**：Git 分支 `dev`，工作区干净；HEAD 含最近两次修改 `0a0f843`、`0a1b2d3`
- **上位规范**：00 理念与构成、01 规范模型基础、02 工作模型基础、06 事实源与信息溯源（本轮 `basis` 已补 06）
- **机械核验**：`parseSpecDocument` 存在于 `plugin/lib/spec-registry.js`（API 第一实参内容、第二 `specs/08-…`，未实跑——理由见第 9 节）；`grep -rn` / `git log` / 代码通读 `plugin/lib/*` 已执行；`plugin` 测试未在本轮运行（非 08 文本结论，见边界）
- **独立性披露**：见第 8 节

---

## 1. 文件路径

主对象：`specs/08-DSH环境接入与插件发布规范.md`（224 行，身份块 1–19，固定八章 24/34/47/70/90/121/130/161/176/194/217，§5–§7 领域正文，§8 验证表，§9–§11 收尾）

核对代码：`plugin/lib/index.js`、`lifecycle.js`、`hook-manager.js`、`governed-projects.js`、`guidance.js`、`ldvh-tools.js`、`git-gate-runner.js`、`client.js`
核对上位：`specs/00`(§3.4/§3.5/§4.2/§4.3/§4.4/§7)、`specs/01`(§7/§9/§10.4/§12)、`specs/02`(§8/§9/§19)、`specs/05`(§5.1/§10)、`specs/06`(§6.1/§6.3)、`specs/07`(§5.2/§5.6)、`docs/audit/08-protected-doc-mapping-correction.md`

---

## 2. 十维逐维结论

### D1 — 价值判据对齐：符合
- 08 §1（行 26–32）明确"解决缺少统一宿主接入"的问题，并列出 V1/V3/HV2/V4/V5/HV3 的归属，**本轮已补 00 §6 名称原文**（行 28：「V1 快速定位」「V3 边界识别」「HV2 授权执行受控可续」「V4 稳定推进」「V5 据实判断」「HV3 入档闭环节点可验」）—— 前轮 F1 已修复。
- §1 末段（行 32）与 §4.3（行 88）均明确"manifest 存在 / 工具注册成功 / 钩子安装 / 发布完成 只证明相应机械范围，不单独证明能力可用、授权成立、价值兑现"——与 00 §6 价值判据的"据实判断"纪律一致。
- 攻击结论：价值对齐无新偏离。

### D2 — 职责边界与单一权威：符合
- 08 §3.1/§3.2/§3.3（行 49–68）明确"本文负责 / 不负责 / 相邻唯一权威"。§3.3（行 68）"08 只定义 DSH 宿主接入点、部署形态与发布门面，不另建第二权威"—— 与 05/06/07/09/10 的唯一权威声明不冲突。
- 攻击点：§6 描述 `ctx.invariants.register`、`ctx.tools.guard`、`ctx.userQuestions.ask` 等 DSH 宿主服务时，措辞为"DSH 正式…入口/服务"，未声称 08 自创第二权威——措辞正确（见 D4 对"当前可用"的拆分）。

### D3 — 反过度设计：基本符合，1 处偏重（中低）
- §5（30 行，5.1–5.6 六子节）、§6（单章承载 6 类机制）、§7（31 行，7.1–7.7 七子节）体量偏大，但 08 是 LDVH↔DSH 的**唯一接口规范**，承载面天然宽；拆分反而制造跨章引用。判定：整体合理，不拆。
- **偏重发现（中低）**：§5.2（行 98）细述 DSH 工具执行全序 `pre-policy → guards → around-dispatch → post-policy → 内容终结 → 通知`，这是 **DSH 宿主内部行为**，非 LDVH 接入语义；08 作为接入规范详述宿主内部链路属越界细述，可改为"执行链次序由 DSH 宿主定义，08 不重述"的条件式引用。属 D3 红线附近（避免复述宿主内部）。
- §11 反过度设计红线（行 217–224）六条清晰，与 §3.2 第 5 项"红色禁止"呼应。

### D4 — 技术可实现性与能力真实性（本对象重点）：有条件符合，4 处能力—现实缺口
按 `00 §3.4` 五层（设计意图 / 实现存在 / 环境接入 / 当前可用 / 实际验证）分别核：

| 08 声称能力 | 代码证据（plugin/lib） | 五层判定 |
|---|---|---|
| §5.2 `ctx.tools.register(...)` 返回 disposer | `ldvh-tools.js:468` 等多处 `ctx.tools.register(toolDescriptor(...))` | 设计意图✓ 实现存在✓ 当前可用✓（LDVH 已消费） |
| §5.2 `ctx.tools.guard(guard)` 单调守卫 + `ToolArgsError` + 执行链全序 | **plugin/lib 全局零命中** `ctx.tools.guard`/`ToolArgsError`；`toolDescriptor`（ldvh-tools.js:431）仅 `{name,description,parameters,output,execute}`，无 `guard` 字段 | 设计意图✓（DSH 或提供）**当前可用✗ LDVH 未消费、spec 未验证** |
| §5.3 `system-prompt/assemble` / `agent/pre-step` | `lifecycle.js:222-223` `ctx.on("system-prompt/assemble"…)`、`ctx.on("agent/pre-step"…)` | ✓✓✓ |
| §5.4 六事件 `agent/created`/`session-start`/`pre-step`/`turn-stopping`/`system-prompt/assemble`/`session/event` | `lifecycle.js:222-237` 全部挂载；`tools/change` 注明"LDVH 当前未消费"（与 §5.4 文本一致） | ✓✓✓（诚实标注未消费） |
| §5.5 `ctx.userQuestions.ask(request)`（validation + scoped answerer） | **plugin/lib 零命中 `userQuestions`**；LDVH 未注册问询面 | 设计意图✓（DSH 或提供）**当前可用✗ LDVH 未消费、spec 未验证** |
| §5.6 `ctx.get('dshHomePath')` 服务 | `index.js:230` `ctx.get("dshHomePath")` 消费（宿主 provide，LDVH 不提供） | ✓✓✓（环境接入✓） |
| §6 运行时不变量 `ctx.invariants.register(packageName, installer)` | **plugin/lib 零命中 `invariants.register`/`ctx.invariants`** | 设计意图✓（DSH 或提供）**当前可用✗ LDVH 未消费、spec 未验证** |
| §6 文件观察 `fs/observed` / `writeText(...,{version})` / `editText` / `fs/write-intent` | **plugin/lib 零命中**（仅 web/dist 打包产物含同名字符串，非源码实现） | 设计意图✓（DSH 或提供）**当前可用✗ LDVH 未消费、spec 未验证** |
| §6 Git Gate 部署（common-dir hooks/commit-msg、managed 确认、conflict 零写入） | `hook-manager.js` 完整实现：`resolveIdentity` 用 `--git-common-dir`、`inspectHook` 状态机 `absent/outdated/conflict/managed/unavailable`、`installHook` 仅非 conflict/unavailable 才写、`atomicReplace` 版本守卫 | ✓✓✓（最强实现） |
| §6 安装事务（登记+ldvh-base+Hook，全必需，失败回滚） | `governed-projects.js:264` `installProject`：factSource + hook + register 三步，catch 内移除 managed Hook / ldvh-base 回滚 | ✓✓✓ |
| §6 启动只读状态检查全部登记项目 | `index.js:328-339` 启动 `ensureRegistrationCarrier`→`readGovernedProjects`→每项目 `inspectHook`（只读、不静默安装） | ✓✓✓ |
| §7.7 Output Envelope 宿主承载 | **代码零 `output.envelope` 命中**（仅 `ldvh-tools.js` 的 `envelope()` 是 05 §8 共同响应，非 Output Envelope）；08 文本如实"承载未建"（行 159） | 设计意图✓ 当前可用✗ **但 08 已条件式披露，合规** |

**核心发现（D4）**：08 §5.2 的 guard 通道、§6 的 `invariants.register` 与文件观察策略，均以"DSH 正式入口"口吻陈述，但 LDVH 插件代码**未消费**三者，且 §8 验证表（8 行）**未将其列为验证对象**。这与 §5.4「LDVH 当前未消费 tools/change」的诚实标注形成对照——说明 08 对已声明的宿主缝，**未统一标注 LDVH 是否实际消费**，验证纪律在 §6 六机制上出现空洞。按 `00 §3.4` 这属于"实现存在/环境接入"层可成立、"当前可用/实际验证"层未证；08 未把该层缺口显式列为 gap，是其自欺防线在 §6 上的薄弱点。

### D5 — 身份、编号、引用和格式：符合（1 处链式前缀老问题）
- 身份块（行 1–19）合规：`spec_key`/`spec_id`/`parent_spec:""`/`relation:""`/`basis` 四成员/`dimensions` 齐全。
- 固定八章标题逐字（行 24/34/47/70/90/121/130/161/176/194/217），H3 3.1–3.3 / 4.1–4.3 逐字，与 01 §7 一致。✓
- **basis 与 §2 清单 1:1**（前轮 F3 已修复）：basis `[00,01,02,06]` ↔ §2 四项 `[ldvh-root / specification-model-foundation / work-model-foundation / source-of-truth-traceability]`，第 4 项补 `06 §6.3 / §6.1` 精确章节。✓
- 跨规范引用章节**逐项可解析**：00 §3.4/§3.5/§4.2/§4.3/§4.4/§7.2/§7.3/§7.4（均存在）；01 §7/§9/§10.4/§12（存在）；02 §8/§9/§19（存在）；05 §5.1/§10（存在）；06 §6.1/§6.3（存在）；07 为路由型无 § 号（允许）。**无悬空引用**。
- §7.6 五类映射（行 154）与 00 §4.3 五类（00:172：00/README/插件AI面向语义文本/LICENSE/版本声明点）**逐项对应**，且"插件 AI 面向语义文本"已更正为 `ldvh:minimal-guidance` 段（与 `docs/audit/08-protected-doc-mapping-correction.md` 及 `guidance-text.js` 一致）。✓
- **老问题残留（轻微）**：§2 第 1 项（行 38）首处带 `00 ` 前缀，同项内 §3.5/§4.3/§4.4/§7 链式省略前缀——与 07 既有写法一致，前轮判"可接受链式引用"，本轮维持。

### D6 — 防自欺与不能单独证明的边界：符合（强）
- §1（行 32）、§4.3（行 88）、§8 表末段（行 174）三处一致强调"机械结果只证明对应机械范围，不单独证明能力可用/授权成立/价值兑现"。
- §7.7（行 159）"机器承载建成前…不得声明已存在宿主承载"—— 正面约束状态类自述，符合 `docs/audit/README.md`"规范正文只承载要求"原则。
- §8 验证表每行均含"可证明范围 / 未满足时的处理"两列，把"不能单独证明"落到逐对象。✓
- 攻击点：08 对 §6 的 invariants/file-observation/userQuestions **未做"未消费=gap"标注**（见 D4），是 D6 防线在 §6 上的局部弱化，但非明文违规。

### D7 — 规范内部一致性与反例检验（重点）：发现 4 处反例/弱点
- **反例 A（§6 conflict 判定，低）**：08 行 125"非 LDVH 资产一律 `conflict` 且零写入"。构造：若 Human 自建 `commit-msg` 钩子内容与 LDVH 渲染体**逐字节相同**，`parseManagedHook`（hook-manager.js:64）会因含 `# ldvh-native-commit-msg-hook: v1 sha256:` 标记判定 `owned:true,valid:true` → 状态 `managed`（version 一致）或 `outdated`，**非 conflict**。即"非 LDVH 资产"的判定实为"内容无 LDVH 标记"，而非"路径非 LDVH 创建"。实现正确（相同内容即视为 managed），但 08 措辞"非 LDVH 资产"易误读为"路径归属"——建议改为"内容非 LDVH 标记资产"。
- **反例 B（§6 启动检查性能，低）**：08 行 126"每次 DSH 启动对**全部**登记项目执行一次只读状态检查"，未设项目数上限或并发界。`readGovernedProjects`→每项目 `inspectHook`（多次 `git rev-parse`）。若登记 100 个项目，启动检查为同步串行（index.js:331 未 `Promise.all`）。但实际为 fire-and-forget `.then`（不阻塞启动），故影响有限；建议补"性能约束/上限"一句。
- **反例 C（§6 回滚残留，低）**：08 行 127"回滚本次**可安全回滚**的变化"。`installProject` catch（governed-projects.js:285-300）对 Hook 移除失败、`ldvh-base` 移除失败仅 `rollback.push(...)` 返回，存在"部分已删"残留态且无重试/告警入口——与"可安全回滚"措辞自洽（仅回滚安全部分），但残留态处理未向用户暴露修复路径，建议补"残留态呈现"。
- **反例 D（§7.1 版本双轨制，中低）**：08 行 134"对外 SemVer 仅正式发布递增；开发 `-dev.N` 每次迭代递增"。构造：一次提交**同时含 bugfix 与 feature**，应递增 MINOR（feature）还是 PATCH（bugfix）？规范未定义混合变更的递增规则。Human 已定 D7 仅定"双轨不污染"，未定混合 bump 选择。属规则完备性缺口。
- **08↔06 边界（✓）**：08 §6"事件检查用 06 定义的同一 validator"——`installHook` 渲染钩子 `exec node git-commit-msg …`，由 `git-gate-runner.js` 承接 06 §6.3 validator；08 只定义部署形态、06 定义检查语义，分工清楚，无双定义（前轮 F3 已通过补 06 入 basis 收敛）。
- **08↔07 边界（✓）**：08 §5.6"08 只承接宿主接入，不复制 07 Schema"；07 §5.6 定义写入要求、08 §6"只核验宿主满足 07 已定义要求"—— 双向无真空。且提交 `0a1b2d3` 已删 10 §6.5 对 08 §6 的逐字复述，改路由型引用，消除前轮发现的双定义隐患。✓
- **08↔05 边界（✓）**：08 §5.2"05 定义的 LDVH CLI 操作经 ctx.tools.register 接入"；05 §5.1 明确 DSH 工具名 ≠ operation_key（语义身份分离）—— 分工清楚。

### D8 — 草案、修复、Human 决定和提交闭环：基本符合（1 处需澄清）
- **§7.6 更正闭环**：`903aa30` 将"插件 AI 面向语义文本"承载由 `systemPrompt.section` 改为现行 `ldvh:minimal-guidance`；`docs/audit/08-protected-doc-mapping-correction.md` 记录"已由 Human 同意（2026-09-12）"并依 `docs/audit/README.md` 原则移出正文。
  - **澄清（重要）**：任务提示"查 §7.6 修改是否走了 00 §4.3 五步"。经核，00 §4.3 五步（展示候选/说明差异/独立审核/Human 明确同意/独立提交）约束对象是**五类受保护内容本身**（00/README/AI文本/LICENSE/版本声明点），而 08 §7.6 是**规范正文对这五类承载位置的登记描述**，08 本身不在 00 §4.3 受保护清单内。故该更正属"规范编辑"，受 `01 §12` 独立对抗审核约束，而非 00 §4.3 五步。前轮 review-08 将"是否走 00 §4.3 五步"作为存疑点，是**适用判据误用**；本审核纠正：该更正经 `docs/audit/` 记录 + 独立审核归档，闭环成立。
- **近期修改 `0a0f843` / `0a1b2d3` 的独立复审（关键）**：两提交修改了 08 的 `basis`（补 06）、§2 第 3 项（补 §19）、§1 V/HV 名称。但 `docs/review-08.md` / `docs/review-08-vs-audited-set.md` 审查的是**修改前**的 08（222 行、basis 三成员）。`0a1b2d3` 在同一次提交中"审核报告入档 + 08 修复"，即**审查与修复同提交、缺修复后的第二次独立复审**—— 依 `01 §12.4`，修复应经独立复审。本 `review-10d-08` 即承担该复审职责：确认修复后 08 在 F1/F2/F3 上已收敛，但新暴露 D4 能力缺口（见第 3 节）。
- **08 当前态（01 §6.3 三态）**：08 仍处 `dev` 分支、近期仍在修，宜判为**候选（candidate）**，未达"当前规则源"；进入 01 §9.2 全条件判定前须先消 D4 缺口。

### D9 — 审核自身是否与风险匹配：匹配（见边界）
- 08 是 LDVH↔DSH 宿主的**唯一接口规范**且承接受保护文档登记，风险权重高。本审核执行了：全文通读、代码通读（plugin/lib 关键文件）、`grep` 机械核验、跨规范章节解析、git 历史回溯、反例构造（A–D）。
- 深度匹配：未仅靠"已审核"结论，对前轮"自洽/有条件自洽"结论做了反向攻击，发现 D4 能力—现实缺口为前轮未覆盖的新风险。
- 未覆盖范围（第 7 节）已显式声明，不夸大结论。

### D10 — 中文语义清晰、术语一致与机器表示对应：基本符合（2 处残留）
- **决策 #11 指针（低）**：08 §11（行 221–222）"（决策 #11）"指向 `docs/dev-memo.md` #11「先只做好 DSH」（非 `22-ADR-决策.md`——前轮 review 误标为 22 号 ADR）。该决策是**设计备忘录编号**，无 active/retired 状态字段（仅 ADR 有状态闭集，22 §9）。故"决策 #11 时效性"**无法机械核验**，且作为红线禁止依据缺乏版本化追踪。风险低（属设计输入，08 §2 已声明决策材料归设计输入），但建议改指具状态的对象或注明"截至 2026-09-12 仍适用"。
- **`~/.dsh` 表述张力（前轮 Q1，低中，残留）**：08 §5.6（行 119）"宿主以 DSH_HOME 环境变量与 ~/.dsh 默认根提供"（经 `dshHomePath` 服务，可重定向）；但 §7.7（行 159）直书"DSH home 下 `~/.dsh/ldvh/ 域`"—— 在 DSH_HOME 另设根时 §7.7 失准，与 §5.6 内部不一致。建议 §7.7 改为"dshHomePath 下 `ldvh/` 域"。
- **机器表示对应**：hook 状态 `absent/outdated/conflict/managed/unavailable` 与 `hook-manager.js:inspectHook` 返回值一致 ✓；`Merge-Touched` 声明不在 08 范围（属 06），不要求。
- 其余术语（managed / conflict / governed / available）在 08/07/代码间一致。

---

## 3. 问题清单（分级 + 引文行号 + 复现）

### 重要（无）

### 中等（2 项）
- **M1 — §8 验证表未覆盖 §6 六机制中的 4 类及 §5.5/§5.6 接入面（能力真实性缺口）**
  引文：§6（行 121–128）定义 6 类机制，但 §8 验证表（行 163–172）仅列 manifest/工具注册/引导面/Git Gate/权限/版本声明点/README/CHANGELOG 共 8 行；**运行时不变量、文件观察策略、`userQuestions`、dshHomePath 四类无验证行**。
  依据：08 自身 §8 纪律"未执行和不可用范围保留为 gaps"（行 174），但上述 4 机制在 §8 既未列验证行、也未在 §6 标注"LDVH 当前未消费"（对照 §5.4 对 `tools/change` 的诚实标注）。`plugin/lib` 全局零命中 `invariants.register`/`userQuestions`/`fs/observed`/`writeText`。
  复现：`grep -rn "invariants.register\|userQuestions\|fs/observed\|writeText" plugin/lib/`（src，非 dist）；`sed -n '121,128p;163,172p' specs/08-DSH环境接入与插件发布规范.md`。
  建议：在 §6 每类机制补"LDVH 当前是否消费 / 验证入口"标注，或在 §8 增对应验证行。

- **M2 — §5.2 断言 `ctx.tools.guard` 单调守卫与 `ToolArgsError`，LDVH 未消费且代码零证据**
  引文：08 行 98"守卫通道 `ctx.tools.guard(guard)` 注册单调守卫（任何 guard 可拒不可放行…执行链全序…）"。
  依据：`plugin/lib` 无 `ctx.tools.guard` / `ToolArgsError`；`toolDescriptor`（ldvh-tools.js:431）形态为 `{name,description,parameters,output,execute}`，无 `guard`。该 API 可能是 DSH 宿主提供（设计意图层成立），但 LDVH 未接入、08 未验证、§8 未列验证行。属 D4"当前可用/实际验证"层未证。
  复现：`grep -rn "tools.guard\|ToolArgsError" plugin/lib/`；`sed -n '98p' specs/08-DSH环境接入与插件发布规范.md`。
  建议：将 guard 通道标注为"DSH 宿主可选缝，LDVH 当前未接入，验证待补"，或实现并补验证行。

### 低–中（1 项）
- **L1 — §7.1 版本双轨制对"同次提交含 bugfix+feature"未定义递增规则（反例 D）**
  引文：08 行 134。依据：SemVer MINOR vs PATCH 选择未覆盖混合变更。复现：`sed -n '134p' specs/08-DSH环境接入与插件发布规范.md`。建议：补"混合变更取较高层级（feature→MINOR）"或明示由 Human 发布时定。

### 轻微（3 项）
- **S1 — §5.2 复述 DSH 宿主内部工具执行全序（D3 越界细述）**：行 98 `pre-policy → guards → … → 通知` 属宿主内部行为。建议条件式引用。
- **S2 — §7.7 `~/.dsh/ldvh/` 与 §5.6 DSH_HOME 可重定向根表述张力（前轮 Q1 残留）**：行 159 vs 行 119。建议统一为 dshHomePath。
- **S3 — §2 第 1 项链式省略 `00 ` 前缀（老问题）**：行 38。与 07 一致，可接受。

### 存疑（1 项，低）
- **Q — 决策 #11 指针无状态追踪**：行 221–222。指 `docs/dev-memo.md` #11（非 ADR），无 active/retired 字段，时效性不可机械核验。建议改指具状态对象或注日期。

---

## 4. 反例清单（维度 7）

| 编号 | 反例构造 | 08 表述 | 实际结果 | 判定 |
|---|---|---|---|---|
| A | Human 自建 commit-msg 钩子内容与 LDVH 渲染体逐字节相同 | 行 125"非 LDVH 资产一律 conflict" | `parseManagedHook` 判 `owned:true`→`managed`/`outdated`，**非 conflict** | 实现正确，措辞宜改"内容非 LDVH 标记" |
| B | 登记 100 个项目，每次启动全量只读检查 | 行 126"全部登记项目一次只读检查" | 串行 `inspectHook`，无上限/并发界（但 fire-and-forget 不阻塞） | 补性能约束一句 |
| C | 安装事务中 Hook/ldvh-base 移除失败 | 行 127"回滚可安全回滚的变化" | catch 仅 `rollback.push` 返回，残留态无修复入口 | 补残留态呈现 |
| D | 一次提交同时含 bugfix 与 feature | 行 134 双轨制 | MINOR/PATCH 递增未定义 | 规则完备性缺口（L1） |

---

## 5. 跳过的维度与依据（维度 9 边界）

- **跳过 09/10 全文逐维审计**：按并行分工，09/10 由另审者负责；本轮仅以 08 引用段落（09 §6 Output Envelope、10 §6.5）做交叉一致性核对，未对 09/10 独立十维审计。
- **跳过 DSH 宿主源码（0.1.2-rc.1 / 0.1.5-alpha.1）双版对照重跑**：08 正文自述"源码双版对照核验 2026-09-10"，本轮未重新执行宿主源码 diff，仅核 08 表述内部自洽与 LDVH 侧代码能否印证。
- **跳过 `parseSpecDocument` 实跑**：API 陷阱（内容第一实参、`specs/<f>` 第二），本轮以 `grep` 章节结构 + 代码通读替代；结构正确性已由 `grep -nE "^## [0-9]"` 确认。
- **跳过 plugin 测试运行**：`node --test` 非 08 文本结论必需；先前轮 558 测中 5 失败均为 `@deepseek-ai/dsh-tools` 模块缺失（环境依赖），与 08 无关。

---

## 6. 风险档位反向核对结论

- 前两轮 review-08 / review-08-vs-audited-set 给 08 的档位为「自洽 / 有条件自洽」。
- 反向攻击后：治理层（D1/D2/D5/D6/D7 边界）**确实自洽**，前轮 F1/F2/F3 已修复；但 **D4 暴露前轮未覆盖的新风险**——§5.2 guard 通道、§6 invariants.register / 文件观察策略、§5.5 userQuestions 三类宿主缝 LDVH **未消费且 §8 未验证**，且 §7.1 混合版本递增规则缺失。
- **反向核对结论**：将档位由「自洽」下调为 **「有条件合格」**——治理与引用层合格，能力真实性层存在 4 处"实现存在但未消费/未验证"缺口，须补标注或实现后方可判合格。档位下调依据充分，非形式问题。

---

## 7. 未覆盖范围与保证边界

- 未覆盖：09/10 全文审计（并行分工）；DSH 宿主 0.1.2/0.1.5 源码双版 diff；plugin 测试运行；`22-ADR-决策` 全量（仅定位 #11 非 ADR）。
- 保证边界：本审核基于截至 HEAD 的 `specs/` 文本 + `plugin/lib` 源码 + git 历史；若上位（00/01/02/06）后续变更章节号，08 相应引用须同步复核。本报告仅说明对象/范围/依据/发现/边界，不构成"08 已进入当前规则源"的结论（该结论须由 01 §9.2 全条件独立判定）。

---

## 8. 独立性披露

- 本审核由未参与 08 候选形成的独立执行体完成，与形成 08 当前候选的同一角色隔离。
- 对前轮"自洽"结论采取**独立攻击、不盲信**立场：前轮 F1/F2/F3 经重取证确认已修复（成立），但新构造 D4 攻击发现前轮未覆盖的能力缺口（M1/M2/L1）。
- 未修改任何文件（严格遵守约束），仅产出本报告 `docs/review-10d-08.md`。
- 机械核验命令与文件:行号均已附于各发现，可供复现。

---

## 9. 总体结论

**有条件合格。**

08 在治理层（价值对齐 D1、单一权威 D2、引用闭合 D5、防自欺 D6、08↔05/06/07 边界 D7）自洽，前轮 F1/F2/F3 已收敛；但能力真实性层（D4）存在 4 处"宿主缝声明但 LDVH 未消费、§8 未验证"的缺口（M1 验证表覆盖空洞、M2 guard 通道零证据），加 §7.1 混合版本递增规则缺失（L1）与 §7.7/`~/.dsh` 表述张力（S2）。修复路径：① §6 每类机制补"LDVH 当前是否消费 / 验证入口"标注或在 §8 增验证行（消 M1/M2）；② §7.1 补混合变更递增规则（消 L1）；③ §7.7 改 dshHomePath 表述（消 S2）；④ §5.2 去宿主内部执行链复述（消 S1）。消缺后 08 即可判合格并进入 01 §9.2 当前规则源判定。
