# P0 实施计划：最小插件替代 Skill

> 性质：开发实施计划（含最小吸收记录），非规范、非事实对象。
> 依据：specs/01 §10.3–10.4、specs/05 §5–§9、specs/06 §6.2、specs/07 §7、specs/08 §5–§6、docs/dsh-plugin-binding-plan.md §13.1/P0/§15、dev-memo 决策 #29/#31/#32。
> 日期：2026-09-02 之后首个开发批次。
> **状态（2026-09-13 更新）**：实现完成；测试已由独立代理完成并全绿（plugin 726/726、web 269/269，见 `docs/archive/ci-plugin-job-node-version-investigation.md` 与 `92d1fed` 验证记录）；真实宿主验证已完成（`docs/p0-restart-verification.md` 五项验证通过）；受控提交随开发持续推进。本文件保留为 P0 实施计划与落地记录。

## 0.1 实现落地记录（补充）

已交付模块（plugin/lib/）：

| 模块 | 职责 | 关键验证 |
|---|---|---|
| `spec-registry.js` | 身份块解析（01.Att.02 §1–5 闭集契约）+ 标题路径解析（01 §10.3 歧义拒绝）+ L0–L4 投影（01.Att.03 §4） | 真实语料 13/14 全 PASS（01–10 + 3 附件；00 因已知规范矛盾如实报拒，见 docs/p0-spec-inconsistency-note.md） |
| `zstd-compat.js` | 多帧 zstd 流解压（DSH 会话按事件逐帧压缩追加，单次 sync 只解第一帧） | 与 `zstd -dc` 字节级一致（2.9MB 真实会话）；帧内伪 magic 不丢帧；撕裂尾帧只解完整帧 |
| `session-signature.js` | 机械签名尾读：sessionPersistence.locate(agent.session.header) → 多帧解压 → 末条 model/selection\|request/context 逐字提取 | 4 个真实会话提取成功；零清理原则硬编码；无路由事件 → unverifiable 不猜 |
| `governance-scope.js` | 会话 cwd → 三态判定（07 fail-closed） | 复用 governed-projects.js 单一实现；登记损坏 → unavailable |
| `commit-validation.js` | 共享提交校验核心（06 §6.1/§6.2）——validateMessage / checkKeyChangesAgainstDiff / snapshotIdentity | 09 §6 单一实现纪律：git-gate-runner.js 重构为引用本模块，Gate 与 precheck 同一 validator |
| `ldvh-tools.js` | 5 工具（resolve-governance-scope / read-specification-candidates / read-specification-content / discover-ldvh-capabilities / precheck-git-commit），05 §8 envelope + 操作声明表 | 5 个 schema 全部通过真实 dsh-tools assertSupportedJsonSchema；registerLdvhTools 在假 ctx 注册成功；**render 契约回归测试**（5 op × 6 outcome 断言返回内容块数组 + 执行 DSH 实际调用的 `.some()`） |
| `guidance-text.js` | 七锚点最小引导文本（**候选，待 Human 确认**——受保护类「插件 AI 面向语义文本」08 §7.6） | governed → 七锚点；not_governed → 空串（组装时过滤=零干扰）；unavailable → fail-closed 提示 |
| `index.js`（改） | inject 增加 tools/systemPrompt；systemPrompt.section（函数文本每次组装求值）；**agent-scoped 工具注册**（agent/session-start → agent.ctx.tools.register，per-agent 可见性——not_governed 会话在管辖会话并存时也零干扰） | 89 既有测试全绿（补 tools/systemPrompt stub service） |

关键设计决策（实现中发现并解决）：

> **验证纪律更正（本批事故后）**：上表 `ldvh-tools.js` 原验证记录「schema 通过 + 假 ctx 注册成功」**两项均不足以证明工具可用**——二者都通过的情况下，5 个工具曾因 `output.render` 返回字符串而在 `result.content.some(...)` 处整批静默失效（现象 `content.some is not a function`）。`ctx.tools.register` 只校验 schema，不校验 `render` 返回值形状；假 ctx 只验注册调用不报错，验不到结果交付阶段。此后工具验证必须覆盖 `execute → schema → render → content` 全链，并优先使用 DSH 导出的真实校验器（`assertSupportedJsonSchema` / `validateJsonSchemaValue`）做机械复核。详见 docs/p0-incident-tool-render-contract.md。

1. **工具 agent-scoped 而非全局**：dsh-tools ScopedLayers 支持从 agent.ctx 注册（shadow 语义）；全局注册会让并存的 not_governed 会话看到工具，违反 §15 条 1。session-start 事件 → 按 agent 注册/注销；agent/disposed 清理登记。
2. **precheck 与 Git Gate 共享 validator**：抽 commit-validation.js；git-gate-runner.js 引用之；06 §6.3「同一 validator」落实。
3. **签名源不经 shell 环境变量**：直接 ctx.get("sessionPersistence").locate(agent.session.header)——与 dsh-shell-env 注入 DSH_SESSION_JSONL 同源（读其源码证实），Host 进程内直达，机械签名的「Helper 内固化形态」就此定案（09-02 快照遗留项闭环）。
4. **00 规范矛盾如实暴露**：code_consumption 下划线值 vs Att.02 §3 kebab 正则（矛盾记录见 docs/p0-spec-inconsistency-note.md，待 Human 决定修复方向；解析器按现行契约严格拒绝，修复后自动通过）。

## 0. 前置实测结论（本会话已完成，源码级验证）

1. **工具注册缝**（`@deepseek-ai/dsh-tools` lib/index.js）：`ctx.tools.register(definition)`，definition 含 `name/parameters(output.input?)/execute(args, exec)/timeoutMs` 与 `output: { schema, render }`；`output.schema` 受强制 JSON Schema 子集约束（type/properties/required/additionalProperties/items/enum/const/oneOf + 注释键）。工具名不可为 `run_code`。注册经 ScopedLayers 支持 agent 级 shadow；本插件用全局注册（会话无关的只读操作）。
2. **会话身份链路**（P0 前置实测核心问题，答案肯定）：
   - `exec.agent` 是 Agent 对象（非字符串），`exec.agent.session.header.id` 即 session id（dsh-shell-env `collect()` 实证）；
   - `ctx.get("sessionPersistence").locate(agent.session.header)` → `{kind:"jsonl", path}`（dsh-session-persistence-jsonl `locate()` 实证，纯计算不触盘）；
   - `DSH_SESSION_JSONL` 环境变量本身是 shell 工具执行时的注入值（dsh-shell-env `session-persistence` contributor），**Host 插件工具内不经 shell 也能拿到同一路径**——这就是 Helper 内机械签名尾读的固化形态（P0 待定案项落点）。
3. **签名机械源**（对 6 个真实会话尾读验证）：JSONL 流中 `request/context` 事件 `data` 含 `{provider, model, contextWindow}`；`model/selection` 事件同形。取「末条 model/selection 或 request/context」逐字注入，零清理原则（决策 #29）。子代理会话可能无路由事件——此时 precheck 返回 `unverifiable` 并给出缺口，不猜测。
4. **systemPrompt 注入**（`@deepseek-ai/dsh-system-prompt`）：`ctx.systemPrompt.section({name, order, text})` 返回 disposer；`text` 可为静态串或 `(context)=>string` **每次组装求值**；全局段所有会话共享，agent 级经 `agent.ctx` 注册可 shadow（dsh-agent `installModelSelection` 示范了 scoped 用法）。段 order 用 `FIRST_PARTY_SECTION_ORDER` 之外的稀疏正值（官方保留负值与既有键位）。
5. **会话启动事件**：`ctx.on("agent/session-start", ({agent, ...payload}) => …)`（dsh-agent-loop 1191 emit，dsh-goal 519 消费示范）；payload 携带 agent 对象。**但会话冷启动注入用静态 section 即可**——text 每次组装求值的特性意味着无需事件监听就能在组装时动态判断管辖状态。

## 1. 范围与非目标

**P0 范围**（binding-plan P0 八条 + §15 九条中的 1–9）：

1. 会话启动管辖三态判定（governed/not_governed/unavailable）；
2. governed 会话最小规则引导（01 §10.4 七锚点）；
3. DSH 原生工具注册（第一批 5 个）；
4. 规范候选与内容读取（L0–L4）；
5. capability discovery；
6. precheck-git-commit（含机械签名尾读固化）；
7. not_governed 零干扰；
8. unavailable fail-closed；
9. 规范读取吸收 v4 已验证算法。

**非目标**（不做，防蔓延）：行动前引导（pre-step 事件面）、模板路由、事实对象操作（F0–F4）、Web SPA、Helper CLI 形态、Output Envelope、授权包。§15 第 10 条（Skill 退役）已由决策 #32 完成。

## 2. 最小吸收记录（执行纪律 #10）

| v5 能力 | v4 位置 | v4 Code/tests | 处理决定与理由 |
|---|---|---|---|
| 管辖三态判定 | v4 02 工作对象与管辖 | code/ldvh/governance/resolver.py | **提取算法、重写边界**：三态语义（governed/not_governed/unavailable + fail-closed）已由 v5 07 §5 定案且 v5 已有 governed-projects.js 实现（realpath+Git 根解析），复用 v5 既有代码，吸收 v4「显式定位符优先、不向上遍历」经验 |
| L0–L2 候选投影 | v4 01/05 | code/ldvh/specs/projection.py（172 行，L0/L1/L2 item 构造）+ identity.py（445 行 YAML 身份块解析）+ markdown.py（476 行 H1/YAML 围栏定位） | **保留算法、重写边界**：层级内容闭集（L0=key/id/编号/标题/路径；L1=+positioning/scope；L2=+关系字段与章节目录）按 v5 01.Att.03 §4 执行；v5 YAML 解析用 `yaml` 包（已是依赖）+ 逐字段闭集校验（01.Att.02 §1 契约：重复 key 拒绝、未知字段拒绝、双引号 string） |
| L3 标题路径唯一性 | v4 01 §10.3 同源 | markdown.py 标题解析 | **直接复用算法**：H2/H3 逐字匹配、重复/歧义拒绝、不选首个；行号 1-based |
| L4 全文 | v4 05 | repository.py | **直接复用**：读文件 + 指纹 + 完成范围披露 |
| precheck 三值结果 | v4 03 §9 + precheck.py（123 行） | precheck.py + validation.py（1049 行） | **提取并适配**：v5 只做 06 §6.2 四项检查（header/关键变更/列表项-diff 对应/trailer 两行），v4 的平台影响、事实分层、Human-Gate trailer 检查**明确不迁移**（v5 已废除）；snapshot_identity 算法直接用 v5 git-gate-runner.js 既有 sha256(diff+\0+message)——06 §6.3 要求 precheck 与 Gate 同一 validator，v5 runner 就是当前 validator |
| 机械签名尾读 | v4 无（09-02 会话新验证） | — | **新实现**（有本会话前置实测依据）：sessionPersistence.locate + zstd 流式尾读 + 末条 model/selection|request/context 提取 |
| 能力发现 | v4 04 §能力发现 | cli.py | **按 v5 05 §6.2 重写**：五态 availability（已声明/已实现/当次可调用/部分可调用/不可用）是 v5 新契约 |

**吸收红线**：不恢复 v4 向上遍历、过渡合规机制、旧字段/状态机；v4 的 1049 行 validation.py 只取「body 结构检查」约 120 行语义。

## 3. 模块设计（plugin/lib/）

```
plugin/lib/
├── index.js                  # 既有：web 路由/设置/载体生命周期；新增 tools+systemPrompt 接线
├── governed-projects.js      # 既有：登记/Hook 事务（不动）
├── hook-manager.js           # 既有（不动）
├── git-gate-runner.js        # 既有（不动，precheck 复用其算法常量）
├── host-api.js               # 既有（不动）
├── session-signature.js      # 新：机械签名尾读（locate + zstd 尾读 + 末条路由事件）
├── spec-registry.js          # 新：规范身份块解析 + L0–L4 投影（纯函数，无 IO 依赖注入）
├── governance-scope.js       # 新：会话 cwd → 三态判定（复用 governed-projects.js + realpath 链）
└── ldvh-tools.js             # 新：5 个工具定义（execute + output schema/render），注册入口 registerLdvhTools(ctx)
```

### 3.1 governance-scope.js — 三态判定

- 输入：会话 cwd（来自 `exec.agent.session.header.cwd` 或 systemPrompt 组装上下文）；输出：`{state: "governed"|"not_governed"|"unavailable", project?, detail}`。
- 判定链：readGovernedProjects（既有）→ 对每个登记项目 realpath 比对 cwd 前缀（同一 Git 根）→ 命中即 governed；登记读取失败（损坏/权限）→ **unavailable**（fail-closed，07 §5 三态语义）；未命中 → not_governed。
- **零干扰承诺**：not_governed 时工具组整体不注册（见 3.5 注册时机）。

### 3.2 spec-registry.js — 规范解析与 L0–L4

- `parseIdentityBlock(markdownText)`：按 01.Att.02 §1 契约——文件第一行唯一 H1、空行后唯一 yaml 围栏、`ldvh_spec`/`ldvh_attachment` 单顶层、字段闭集校验、重复 key 拒绝、双引号 string。返回 `{kind, spec_key/attachment_key, spec_id, title, canonical_path, parent_spec, relation, positioning, scope, basis, authorized_attachments, dimensions, supersedes, related_specs, yamlLine}` 或拒绝原因。
- `projectL0/L1/L2(identity, headings)`：按 01.Att.03 §4 内容闭集投影。
- `resolveHeadingPath(markdownText, headingPath)`：H2/H3 逐字匹配、歧义拒绝、1-based 行号。
- `contentFingerprint(text)`：sha256。
- 纯函数模块，无宿主依赖——独立可测（与实现者分离的测试代理友好）。

### 3.3 session-signature.js — 机械签名

- `currentRouteValues(ctx, agent)`：`ctx.get("sessionPersistence")` → `locate(agent.session.header)` → kind 非 jsonl 返回 `{unavailable, reason}`；否则 zstd 解压流式尾读（读最后 ~256KB 解压窗口，跨行边界对齐），从后向前找末条 `model/selection` 或 `request/context`，逐字返回 `{provider, model}`。
- 零清理原则硬编码在实现：不剥后缀、不筛选路由、不换源。
- 找不到路由事件 → `{unavailable, reason: "session has no routing events"}`（调用方映射 unverifiable）。

### 3.4 ldvh-tools.js — 第一批工具

全部 operation_key 按 05 §6.1 形状登记（工具内嵌声明表，供 discover 消费）。统一响应 envelope 按 05 §8：`operation_key, result, scope, sources, gaps, verification, follow_up` + `outcome`（partial/unavailable/rejected/invalid_request/执行错误）。

| 工具名 | operation_key | effect | 输入 | 输出要点 |
|---|---|---|---|---|
| `ldvh_resolve_governance_scope` | `resolve-governance-scope` | read | `{}`（cwd 从 exec.agent 取） | 三态 + 项目身份 + 来源（登记指纹） |
| `ldvh_read_specification_candidates` | `read-specification-candidates` | read | `{responsibility_key?}`（缺省=全部候选） | L0–L2 投影数组 + 来源视图 + gaps（01 §10.3：不接受编号/标题/路径回退） |
| `ldvh_read_specification_content` | `read-specification-content` | read | `{responsibility_key, heading_path?}` | L3（heading_path 精确唯一）或 L4 全文 + 行号 + 指纹 + 未展开范围 |
| `ldvh_discover_capabilities` | `discover-ldvh-capabilities` | read | `{operation_key?}` | 五态 availability 表 + 声明回指 |
| `ldvh_precheck_git_commit` | `precheck-git-commit` | read | `{message}`（Index 即当前 staged） | 三值 mechanical_outcome + snapshot_identity + 逐项检查结果 + 签名机械源回显 |

- 工具命名：DSH 工具名带 `ldvh_` 前缀（与宿主工具名空间区分），operation_key 无前缀（05 语义身份）——08 §5.2 允许二者不同。
- precheck 输入契约：message 文本 + 当前 Index diff；检查四项按 06 §6.2；**与 Git Gate 同一 validator**：抽出 validateMessage 与 snapshot 计算为共享纯函数（git-gate-runner.js 改为引用同一模块——不复制第二实现）。
- 签名检查项：trailer 两行存在且非空 + **可回指当次权威记录**——precheck 内调 `currentRouteValues`，trailer 值与末条路由事件逐字比对（不一致 = failed，列出机械源值）。

### 3.5 注册时机与零干扰（index.js 接线）

- `ctx.inject(["tools", "systemPrompt"], ...)` 或 apply 内 `ctx.get` 逐个防御（tools/systemPrompt 均为宿主必备服务，直接 inject）。
- **systemPrompt**：注册全局段 `ldvh:minimal-guidance`，order 取 1500 区间稀疏值（官方正段 0–9900 已占用键位之间的空隙，选 1550）。text 为**函数**：每次组装时调用 `resolveGovernanceScope(cwd)`——`context.agent` 存在且 governed → 返回七锚点引导文本；not_governed → 返回空串（零干扰：section 空文本被 assemble 过滤）；unavailable → 返回 fail-closed 提示段（告知 LDVH 管辖状态不可用、受控操作应暂停）。not_governed/unavailable 时**不注册工具**。
- **tools**：同一判定函数决定是否 `ctx.tools.register`。governed → 注册 5 个；not_governed → 不注册（零干扰）；unavailable → 不注册（fail-closed，不提供可能基于损坏登记的操作）。
- **cwd 来源**：systemPrompt 组装 context.agent.session.header.cwd；工具 exec.agent.session.header.cwd。二处同源（Agent 对象）。
- 每次组装求值 → 会话中途安装/取消管辖在下一轮组装生效，无需重启。

### 3.6 七锚点引导文本（01 §10.4）

最小引导不复制规范正文，只给锚点与一句话指引 + 读取入口提示：

```
【LDVH 管辖会话最小引导】
本项目受 LDVH 管辖。工作前锚点（详见 specs/00-理念与构成.md）：
1. 身份块——每个 specs/ 载体首部 ldvh_spec/ldvh_attachment 声明身份与依据
2. §2 根方案——八维工作模型 + 三类语义要素 + 规范源/事实源 + 插件四交付
3. §3.1 八维——读/写/遵守/审议/复核/执行/反思/沉淀
4. §4 Human 决定权——根决定清单与 Human Gate
5. §5 AI 责任——单一主控最终负责、非全知、委派不转责
6. §6 双轨价值——V1–V8/HV1–HV5
7. §7 防自欺/Stop/交还——机械锚点、暂停条件、最小交还结构
规则读取：ldvh_read_specification_candidates / ldvh_read_specification_content（L0–L4 渐进）
能力发现：ldvh_discover_capabilities；受控提交前：ldvh_precheck_git_commit
```

（内容在实现时按 00 当前定稿文本校准锚点名；受保护文档纪律——这是「插件 AI 面向语义文本」，属 08 §7.6 受保护类，本批先以候选形式实现，提交前经 Human 确认文本。）

## 4. §15 完成条件映射

| §15 条 | 本批覆盖方式 |
|---|---|
| 1 not_governed 零干扰 | 3.5：不注册工具 + section 空文本 |
| 2 governed 最小引导 | 3.5/3.6 |
| 3 unavailable 不被猜态 | 3.1 fail-closed + 提示段 |
| 4 “修改某个 spec”能拿到规则 | candidates(L0–L2)→content(L3/L4) 链路 |
| 5 普通代码改动不触发完整治理 | 工具是被动只读；引导文本不强制流程 |
| 6 不复制规范正文/第二规则源 | 3.6 只给锚点；工具读原文 |
| 7 诚实降级 | unavailable 分支 + 各工具 unavailable outcome |
| 8 user-data 跨平台测试 | 登记读取走既有 governed-projects.js（已有测试）；本批新增模块纯函数化 |
| 9 吸收 v4 已验证算法 | §2 吸收记录 |
| 10 Skill 退役 | 已完成（决策 #32） |

## 5. 验证计划

1. 单元测试（独立测试代理，决策 #17）：spec-registry（身份块闭集/拒绝/投影/标题歧义）、governance-scope（三态）、session-signature（尾读/无事件边界）、ldvh-tools envelope（05 §8 字段齐备/outcome 分类）。
2. 集成测试：真实 specs/ 目录解析全量 00–10 + attachments；临时 Git 仓库 precheck 全链（含 staged diff 与签名一致性）。
3. 真实验收：DSH Desktop 重启后——本会话（dsh-ldvh 为 governed）可见 ldvh_* 工具与引导段；另一 not_governed 工作区会话零干扰。
4. 受控提交：Git Gate（message 契约 + 关键变更逐条对应 diff + 机械签名 trailer）。

## 6. 风险与边界

- systemPrompt 组装时做 realpath+Git 调用有 I/O 成本——缓存判定结果 keyed by cwd+登记指纹，登记变化时失效（缓存只影响性能不影响语义，仍每次组装求值函数本身）。
- zstd 解压依赖：宿主有 zstd 二进制（会话流就是 zstd）；优先用 Node 内置 zlib zstd（Node 22+）或宿主依赖，不引第三方。**实测确认：`zstd` CLI 在本机可用**；实现时探测可用解压途径，全不可用 → 签名项 unverifiable（fail-closed，不猜）。
- 受保护文本纪律：七锚点文本提交前呈 Human 确认。
