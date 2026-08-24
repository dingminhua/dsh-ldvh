# 49 份 Study 吸收账（dsh-ldvh 技术吸收备忘）

> 依据：v4 `ldvh-base/studies/` 全部 49 份（33 active / 16 retired）前置元数据通读 + 关键对象正文精读，观察时点 2026-08-24。
> 性质：开发备忘，非规范、非事实对象。
> 总原则：**不再借用第三方技术**——DSH 宿主能力直接用（自家平台）、宿主没有的内部重实现、第三方只吸收原理（零运行时依赖）；LDVH 可对外「提供」MCP server（DSH 经 ctx.mcpClient 原生消费）。

## 1. 可吸收清单（按五维：读/写/遵守/思考/执行）

### 读维（对治上下文依赖）
| 吸收项 | 来源 | 落账 |
|---|---|---|
| 双层消费模型：公共必读层 + 类型差异触发层；ADR 常驻决策边界摘要、Pitfall 症状/技术栈分发、Study 按需；L0 容量上限与失效规则 | study-01M03DH7VPFJ | 内部实现（预热注入逻辑）；配 ctx.tokenMeter + CJK 预算 |
| 记忆/事实预热工程模式：事件回收、带来源标签占位 user message 注入、pending 离线队列、CJK 预算 | study-01M0MWX3ZHFQ + study-01M0MWEBBKFP（Hindsight） | 只吸收工程模式内部实现；Hindsight 不再作第三方集成 |
| 代码图谱索引（本地图谱+查询+可提交快照） | study-01KZXN5TXNE1（Codebase MCP） | 原理吸收；若做则内部实现；红线：运行时索引≠事实 |
| 规则精确读取默认路径、技能登记填值分工 | study-01KZYHHEQYE5（残留修正）+ study-01KZXN5TXNFN | 重建 09/Skill 时消化 |

### 写维（对治无连续状态）
| 吸收项 | 来源 | 落账 |
|---|---|---|
| 局部补丁写入：请求语义粒度与发布粒度分离；JSON Patch 风格+稳定 ID+片段绑定指纹；内存重建后仍完整校验/CAS/回读/审计 | study-01KZXN5TXNEX（+01M09W） | 内部实现（减摩擦，P1 解药之一）；不引入 CRDT/OT |
| 五类事实生命周期行为清单 | study-01M09ZNYA8F3 | 下沉为下位规范/模板 |
| 4 项高影响摩擦修正（draft→create 对齐、托管字段扩散、全库审计 partial、promote 约束矛盾） | study-01M0ADT0SQEH | 重建 05 时直接修正 |

### 遵守维（ADR/Pitfall/遵守记录）
| 吸收项 | 来源 | 落账 |
|---|---|---|
| 授权证据绑定 Human Gate + 执行点 fail-closed；WC 外实施类动作即无授权 | study-01KZXN5TXNE2（OWASP/NIST 调研） | §7 授权边界；配 ctx.authorization/permission-presets |
| 预检落实记录升格为「使用证据」（约束必须改变行动方案） | study-01M0SPKT43E1（五维闭环）+ 22/23 规范 | §3 遵守维核心机制 |

### 思考维（自发辩证）
| 吸收项 | 来源 | 落账 |
|---|---|---|
| 独立复核并行纪律：单一写所有者、先写清输出/汇总人/不修改范围 | study-01KZXN5TXNE2（Codex 协作） | 辩证执行体的分派纪律 |
| 模板五机制：触发/排除契约、步骤停止条件、反逃避信号、证据化完成门禁、分层评测 | study-01KZXN5TXNE3（agent-skills） | 行动模板重建时吸收 |
| 路由架构：热路径+按需加载+explicit-mode-gate；验证收据 | study-01M0MWVYTTE0（Aegis） | 薄 Skill 路由与交还验证吸收机制，不复制技能文本 |
| 新鲜视角循环（ralph 形态）+ 多视角对抗（workflow） | 宿主原生 + study-01M0PQHMRVEA | 辩证执行体选型 |

### 执行维（WC 流程 + 三通道宿主化 + 守护层）
| 吸收项 | 来源 | 落账 |
|---|---|---|
| Team 队长式执行 + attempt 单调令牌 + 冷恢复 | study-01M0PQHMRVEA（agent-teams）+ study-01M0SVF6TRFH | 内部重实现；先核对 ctx.goalRoundDriver（race-fenced）能否直接承载 |
| 团队编排层结构（Role Contract/Task List/计划门禁/状态投影） | study-01KZXN5TXNED（WorkBuddy） | 21/34 修订方向 + Web 表达参考 |
| Hook 定位收口：Hook=生产过程资产的机械事件闸门（Git Gate 署名 + Stop 交还闸门）；Git Gate+Skill 零适配为最小接入层 | study-01M0C713FPF9 + study-01M0BCG5WTEY | §4 机械守护的定位依据 |
| turn/end 锁恢复 + ThinkingSpace 纯值投影 | study-01M0SHBPFGFC + study-01M0SVF6TRFH | 内部实现（不迁多 Session 复制） |
| CLI 减摩擦三件套（--request/--example/--fields） | study-01M014CFAVEZ（65 会话统计：38.5% 直调+155 次 heredoc） | 被插件工具直通（ldvh_call）承接 |
| 两层输出契约（人类可读 + 机器可读 Envelope） | study-01KZXN5TXNFT | §8 交还结构 |
| 显式 ldvh check（watcher 只作失效信号；Git Hook 最后门禁） | study-01KZXN5TXNEM | 守护层 check 入口 |
| 对话交互封装（userQuestions/plan-mode/authorization/Isolated Session 验收条/slash 命令/message-feedback） | 宿主原生（见 dsh-platform-facts.md） | 执行维三通道宿主化 |

### 呈现与发布
| 吸收项 | 来源 | 落账 |
|---|---|---|
| 内联可视化使用纪律（不迁渲染通道、只迁纪律） | study-01KZXN5TXNFD + study-01M09WTFFQE5 | Web 呈现纪律 |
| 开源发布契约（OpenSSF OSPS Baseline + GitHub 治理/Release） | study-01KZXN5TXNEJ | D3 落地依据；CHANGELOG/声明点补齐 |
| 跨平台再验证纪律（平台声明生命周期、路径级机械扫描+AI 复核） | study-01KZXN5TXNEW | 重建 09 时消化 |
| Windows 平台验证证据 | study-01KZXN5TXNEP | 平台声明沿用 |

## 2. 明确不引入（结论性否定）

| 对象 | 来源 | 理由 |
|---|---|---|
| Obsidian 本体 | study-01KZXN5TXNFK | AI 侧关联发现已被 Helper 覆盖；Human 侧「双向链接+图谱浏览」作为 Web 能力形态**内部实现**（根因是关系数据稀疏：ADR 0/8、Pitfall 0/8 声明关系）。另吸收「零摩擦链接文化」启发：稀疏的另一半原因是声明摩擦高，v5 对治 = 创建入口应声明项 + 候选关系提示（AI 确认后写入，不自动写） |
| Kiro/Beads | study-01KZXN5TXNFV | 组织单位是 feature 粒度；H5 需独立方向锚；仅作 00 重梳理外部参照 |
| Task Master AI | study-01KZXN5TXNFP | 外部任务编排，不替代 WorkCase |
| 浮层+轮询+事件注入 Web 形态 | study-01M0PQHMRVEA | 红线：保持四层阅读器 |
| OpenViking/solo-thinking 产品形态 | study-01M0MWX3ZHFQ + study-01M0SHBPFGFC | 隐式长记忆/思考树与显式受控事实哲学冲突；只吸收工程模式 |
| Aegis 技能文本 | study-01M0MWVYTTE0 | 只借鉴路由与验证收据机制 |
| CRDT/OT | study-01KZXN5TXNEX + 01M09W | 无实时多人需求前不引入 |
| Firecrawl | study-01KZXN5TXNE5 | 仅证据获取候选，非默认依赖 |
| Superpowers/Symphony/Codex 工作流 | study-01KZXN5TXNEC/01KZXN5TXNF5/01KZXN5TXNF7 | 过程设计参考，不改变 Gate |
| Multica 产品形态（供应商无关运行时/Skills 导出/Docker 服务化/可回放执行日志/自动评论） | study-01M0TK7RF8EXQSYR2534B3C9J6 | 决策 #11 非 DSH 不考虑 + 决策 #10 审计向机制已砍 + 待定项 17 Skill 消失；Inbox 式「只在该决策时通知 Human」已对齐 §5.4.3 决策提请，无需吸收；仅确认「规则层 vs 操作系统层」上下层互补定位 |

> 增补（2026-08-25）：上表末行为 2026-08-24 通读 49 份之后新增 Study（Multica，观察时点 2026-08-25）的评估结论，按 Human 指示落账。

**已登记待评估（增补 2026-08-25）**：
- dsh-agent-conductor（study-01M0TKFAJCFNM8ZW5JWD5XHJQ6）：DSH 会话内把自包含任务派给**封装好的外部 Agent CLI**（非第三方代码依赖）无头执行并回收结果。Skill 形态在 v5 将变为其它形式（待定项 17），先登记产品存在，吸收判断延后。

## 3. 教训账（v5 重建时消化）

1. **过度设计淤积**（study-01KZXN5TXNEJ + study-01KZXN5TXNFA）：创建单个 Spark 穿越 7 份规范、23 条 Stop、18 项重型协议、80/20 场景倒置——新 00「薄」原则与模板「快通道」的量化依据。
2. **研究→执行断层**（16 retired 中 13 个「不引入」）：吸收项直接落 WorkCase/ADR，不停留 Study。
3. **规范—代码结构投影耦合**（study-01KZXN5TXNFA 3 项）：新 Code 与规范语义绑定。
4. **规范残留**（study-01KZYHHEQYE5 5 处）：新规范一次性清理，不留死路径。
5. **条款日落机制**（study-01KZXN5TXNEJ + study-01M014CFAVEZ）：新 00 是否纳入比例原则/日落防再膨胀——待 Human 定。
6. **旧 00 兑现度已被验证**（study-01KZZRT5G8FV）：25 操作可用、237 对象完整、1888/1903 测试通过、HV4 如实报缺口——支持保守对待 §1/§2。
7. **会话统计与可比性**（study-01M014CFAVEZ + study-01KZYHHEQYE5）：轨迹日志/SQLite 查询可作审计载体，方法试跑先于因果结论。

## 4. 事实对象关联（诊断备忘）

- 实测：ADR 0/8、Pitfall 0/8、Study 17/49、Spark 77/103、WorkCase 94/152 声明 relations。
- 内部解法方向：受控创建时关系声明收紧（应声明项）；关系闭集补「指向证据」（禁凭空猜，05 L560 红线保留）；Web 图浏览以关系数据为骨架内部实现。
