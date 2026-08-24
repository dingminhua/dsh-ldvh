# LDVH v5 移交文档（Handoff）

> 本文档由 v4 会话（`session-342a9fb6-8602-4826-bd34-32f013e96709`，2026-08-24）移交。
> 新会话只需阅读本文件即可无缝接手「LDVH v5 重构」工作，无需重新调研。
> 状态：讨论定稿，待新会话执行。

## 1. 已锁定的决策（Human 已确认）

| # | 决策 | 说明 |
|---|---|---|
| D1 | **v5 取代 v4** | 新 00 声明取代旧 00；v4 仓库整体降级为只读历史档案（`ld-vibe-harness-v4`），不再新建事实、不再作为规则源 |
| D2 | **插件分发形态** | v5 以 DSH（DeepSeek Harness）原生插件形态分发（`dsh plugin add ldvh`，bundle patch 五件套），同时保持开源 |
| D3 | **开源属性不变** | MIT License（已在新仓库根目录），**与 DSH 本体同协议**（DSH 桌面应用与 @deepseek-ai 核心包均 MIT，2026-08-24 核实）；可进 DSH 插件市场（dshfind），接受开源公共契约；开源的本意 = 让他人去做移植（DSH 之外平台的移植由社区完成），同协议降低移植门槛 |
| D4 | **从 00 重构** | 新 00 的 §1（为什么存在）/§2（解决方案）**逐字保留 v4 `specs/00` 原文（Human 决定：一个字都不能改）**，其余按五维重新组织；00 保持薄，只定义「根 + 接口 + 原则」，字段/状态机/模板细节全部下沉到随搬运重建的下位规范 |
| D5 | **新仓库** | `~/DshProject/dsh-ldvh`（remote: github.com/dingminhua/dsh-ldvh），main 分支，当前仅 LICENSE + initial commit |
| D6 | **逐章起草** | 新 00 按大纲 §1–§8 逐章定稿（Human 逐章过目）；§1/§2 已锁定 v4 原文（见 D4），逐章讨论从 §3 起，不整篇写完再返工 |
| D7 | **版本号双轨** | v5 重新起算。对外发布版本（release）从 `1.0.0` 全新计数（与 v4 旧号脱钩）；开发迭代版本（dev）为同主版本带 `-dev.N` 后缀（如 `1.0.0-dev.1`）。二者共享 `MAJOR.MINOR.PATCH`：对外版本仅正式发布时递增，开发版本仅开发迭代时递增，互不污染；发布时封存干净三段式，dev 进入下一轮 |

## 2. 新 00 大纲（v5 重构版，待逐章定稿）

```text
00 理念与构成（v5 重构版）
├─ §1 为什么存在        ← 逐字保留 v4 00 §1 原文（Human 决定：一个字都不能改）：AI 三大缺陷 / Human 四大短板 / 摩擦
├─ §2 解决方案          ← 逐字保留 v4 00 §2 原文（Human 决定：一个字都不能改）：三要素（规范/事实/模板）
│                          + 三通道（Skill 路由 / Git Gate / Web）
│                          + 价值标准 V1-V8 / HV1-HV5
├─ §3 五维工作模型      ← 新增（组织轴）：
│                         读 / 写 / 遵守 / 思考 / 执行（Human 新定 2026-08-24；原「行动」并入「执行」）
│                         每维：最小职责 / 触发条件 / 机械入口 / Human 边界 / 验证证据
├─ §4 机械守护           ← 升格（DSH 时代的新守护层）：
│                         Git Gate 终闸（最后的把关，不入五维）/ 受控写入边界 /
│                         Host Hook 与插件事件（turn-end 锁恢复、pre-step 引导时机）/
│                         单调令牌与冷恢复
├─ §5 技术吸收原则       ← 新增：
│                         技术按「补哪一维的哪个根」进入（问题驱动）
│                         概率召回/隐式记忆绝不进入事实写入（记忆划界）
│                         插件管能力、Skill 管思维（接入分工）
│                         开源插件公共契约义务
├─ §6 价值标准           ← 保留但明确「可观察落地」：
│                         V1-V8 / HV1-HV5 每项要有判据（消化「价值冲突整改」Spark）
├─ §7 边界与授权         ← 精简：行动边界 / 事实源边界 / 授权边界 / Human Gate / Stop
└─ §8 验证与交还         ← 保留治理内核：渐进披露 / 验证层级互不可证 / 交还结构
```

**设计原则**：新 00 只定义根 + 接口 + 原则，不定义字段 + 状态机 + 模板细节；00 保持薄，膨胀从源头掐断。

## 3. 五维闭环与 00 §1/§2 的映射

> ⚠️ 五维定法已于 2026-08-24 被 Human 更新（新定法见 `docs/dev-memo.md` §3）。新定法：**读 / 写 / 遵守 / 思考 / 执行**；Git Hook = 最后的把关，不入五维，是横在五维之上的机械守护层（终闸，归骨架 §4）。下表为新定法：

| 00 §1 根缺陷 | 五维 | 对治机制 |
|---|---|---|
| AI 上下文依赖（不知道缺什么、用推断补全） | **读** | 渐进读取：规则引导 → F0 → F1/F2 → F3/F4（v5 补预热层） |
| AI 无连续状态（前说后忘、重复犯错） | **写** | 受控写入：事实对象 + 指纹 CAS + 跨会话回读 |
| 前说后忘、重复犯错（约束与经验不生效） | **遵守** | 遵守记录 + ADR + Pitfall：预检落实、约束必须改变行动方案 |
| AI 概率性输出（会错、会幻觉、单次成功不可外推） | **思考** | 自发辩证：判断分层（相关/适用/授权/完成）+ 独立复核/多视角对抗 |
| Human 进展断续（任务难以接续） | **执行** | 完成 WC 的流程：Gate1 冻结 → 执行循环 → 复核 → Gate2 关闭 → 交还 |

参考：v4 仓库 `ldvh-base/studies/study-01M0SPKT43E1SBWCMB6N675DXQ`（五维闭环 Study，active，正文在 v4 工作区未提交——需要时可从 v4 仓库受控读取）。

## 4. 四根支柱：DSH 技术吸收清单

按「补哪一维的哪个根」估值（已在 v4 会话完成源码级验证）：

| 支柱 | 吸收来源 | 补的根 | 承载方向 |
|---|---|---|---|
| **插件五件套 + Host Hook** | dsh-agent-teams 五件套（ctx.tools / systemPrompt.section / 事件 / Web 路由 / workspace 目录）+ DSH 事件（agent/pre-step、turn/end、agent/status、internal/service） | 执行（机械把关） | v5 接入层；LDVH 28 个 Helper 操作注册为 `ldvh_call` 原生工具 |
| **Team 队长式执行** | agent-teams 调度器 / attempt 单调令牌 / 冷恢复 / 归档 | 行动（进展断续） | WorkCase 执行模型：work items 拆给 durable 成员并行；attempt 令牌做写回机械边界（A3 范本）；冷恢复兜底；产物仍只经受控写入 |
| **turn/end 锁恢复** | dsh-solo-thinking（checkpointRefreshingAt/returningAt 自动恢复） | 执行（事后挽回） | WorkCase item 中断自动恢复；ThinkingSpace 纯值投影作 Code 层参考（不迁移事实写入） |
| **记忆/事实预热** | OpenViking dsh-memory-plugin（占位 user message 注入、事件回收、pending 离线队列、CJK 感知预算）+ Hindsight（快速预热层） | 读（上下文依赖） | 会话启动自动注入相关事实卡（open Spark F2 + 相关 ADR/Pitfall 候选）；最小干预形态；概率召回绝不进入事实写入 |

**划界红线**：
- 不搬 agent-teams 团队状态机/任务 DAG/成员角色模型作为 LDVH 事实或规则
- 不搬 solo-thinking 思考树/Handoff 作为事实交换协议（Agent 自述文本无指纹验证）
- 不采用「浮层 + 轮询 + 事件注入」的 Web 形态（保持四层阅读器：字段级直读/卡片网格/语义详情/扩展阅读）
- 受控写入只能经 Helper；Git Gate 仍是最终闸门
- **AI 面向语义文本单一权威来源、逐字节一致、不复制规则正文、不成第二规则源**——载体可变：DSH 深度绑定下薄 Skill 三职责由插件 systemPrompt.section / pre-step 事件 / ldvh_call 工具承接，Skill 未必存在（Human 定 2026-08-24，见 dev-memo 待定项 17）

## 5. v4 仓库可引用资产清单

v4 仓库路径：`/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4`（只读参考）

**新创建的 Study（本次会话受控创建，未提交）**：
- `ldvh-base/studies/study-01M0SVF6TRFH0VFYZN1V36ZMVA.md` ——「LDVH 深度绑定 DeepSeek Harness 的机制调研与分层方案」（UID `01a033b7-9b58-7c41-b7fb-f50ec66fd36a`），四层方案 L0/L1/L2/L3 的完整论证

**既有 active Study（受控读取过全文）**：
- `study-01M0PQHMRVEA4B4ERAPS9XAS7B` —— dsh-agent-teams 插件调研与吸收价值分析（F1-F8 / A1-A4 / 6 场景）
- `study-01M0SHBPFGFCXT94B0G5V18JZ0` —— dsh-solo-thinking 插件研究报告（思考树/Handoff/ThinkingSpace/turn-end 锁恢复）
- `study-01M0MWX3ZHFQTSN9E5MNW24F0T` —— OpenViking DSH 记忆插件分析
- `study-01M0MWEBBKFPSS89E3KE5QD2DH` —— Hindsight 集成研究（记忆预热）
- `study-01M0SPKT43E1SBWCMB6N675DXQ` —— 五维闭环方案（读/写/思考/行动/ADR-Pitfall 确保执行）

**10 个 open Spark（v4，待 v5 承接）**：
- P1：`01KZXN5TXNEKMANG1WTFBKT5FW`（ADR/Pitfall/Study 作用强化及触发事件）、`01M0CJ65VZFD6S9TZNBY9M50VE`（前置流程与任务规模比例失调——过度合规削弱信任）、`01M0F484B0FSV865NC0N4CA8B1`（Skill 与 Hook 架构设计）、`01M0R8YQ9XFNDTZGE3Y7VGN21J`（价值冲突整改）、`01M0RANDTPFBATNPQWBWREV612`（AI 创建事实对象身份问题防范）
- P2：`01KZXN5TXNF3Q93ENWZBB5GHHY`（多项目聚合）、`01KZXN5TXNFTKR60XNHDPSKV6D`（LDVH 价值审计）、`01M0MY3Q15F0XRAKEQRRAHHXJS`（DSH Cordis Plugin 事实预热）、`01M0PWGHMKFEE89EP7YJWPJ0YD`（LDVH Team 机制融合需求分析）、`01M0S87JQMF9XTSC2WF7E09DB6`（写入层分层机械门）

**16 个 retired Study 的教训**：13 个结论实质为「不引入/不采用」，9 个因 v3→v4 基线批量作废——教训：研究→执行断层，新 v5 必须把可吸收部分落成 WorkCase/ADR，不停留在 Study。

**关键事实（已实测）**：
- v4 在 DSH 上的部署：Skill 已部署 `~/.agents/skills/ldvh/SKILL.md` 但版本过期；Git Gate（commit-msg）managed/aligned；DSH 无项目级 Stop 事件（unverified）
- DSH 桌面 profile 已安装 `@nanmicoder/dsh-agent-teams@0.1.13`
- DSH 宿主：`@deepseek-ai/dsh 0.1.1-rc.2`（desktop 2.0.2），五件套接缝源码级验证成立

## 6. 起步顺序（新会话执行）

1. **骨架** ✅（已完成）：`.gitignore`（.venv/node_modules/.DS_Store 等）+ `README.md` 占位（声明 v5 定位：取代 v4、插件分发、开源）+ 版本号双轨（对外 `1.0.0` / 开发 `1.0.0-dev.N`，见 D7）+ 本文档已就位
2. **起草新 00**（进行中）：落点规范源根 `specs/00-理念与构成.md`；§1/§2 已逐字锁定 v4 原文（见 D4），逐章讨论从 §3 起，Human 逐章过目；最新设计共识（五维新定/防自欺/三件套/深度绑定）见 `docs/dev-memo.md`
3. **登记管辖** ✅（已完成，2026-08-24）：按「独立工作区 dogfood」办理——新建独立配置 `/Users/dmh2002/DshProject/LDVH-GOVERNED-PROJECTS.yaml`（**不沿用**旧 `poker_hud_projects` 配置），登记 `dsh-ldvh` 为唯一管辖项目并设为 `default_project_id`；实测 `resolve-governance-scope` 返回 `config_status: valid` / `scope_status: governed_single` / `governed_project_id: dsh-ldvh`。此后事实写入走新规则。旧配置仍管辖 v4/poker 项目，其退役时点待 Human 重新决策
4. **内核验证**：Helper CLI + Git Gate 在新仓库跑通一个真实任务（五维闭环试金石，先于大规模搬运）
5. **选择性搬运**：8 ADR / 8 Pitfall → 10 open Spark 承接 → 高价值 Study 结论（受控重建，不复制文件）
6. **DSH 绑定**：插件五件套 + 记忆预热 + 队长式执行（在新骨架上直接长）

## 7. 风险与约束备忘

- **过度合规（P1）**：新版本设计目标必须是「同样的治理效果，更低的摩擦」——插件工具直通（不用 bash 拼 JSON）、事件自动恢复（不用人工续跑）本身就是减负手段
- **取代的落地**：旧仓库冻结为档案馆（`ldvh-v4-archive` 或 remote 引用），`LDVH-GOVERNED-PROJECTS.yaml` 只登记新仓库；迁移期唯一活跃工作区
- **搬运必须受控**：批量搬运走 `create-fact-object` 受控重建（新 UID/指纹/change_log），05 禁止直写 `ldvh-base/`，不得 git 直接复制事实文件
- **09 §5.1 冲突**：插件模式打破「唯一接入单元：薄 Skill」，新 00 必须重新定义「插件管能力（机械半边）/ Skill 管思维（语义半边）」的分工；2026-08-24 深化：DSH 深度绑定下**插件即接入形态、Skill 未必存在**（dev-memo 待定项 17）
- **Host Hook 缺口**：DSH 无原生 Stop 事件，v5 的 WorkCase 交还检查要么走 turn/end 等价物，要么经 dsh-bridges 桥接（均需验证）
- **记忆划界**：任何概率召回/隐式记忆结果只能作为上下文候选提示，永远不能自动变成事实对象或改变受控写入路径
