# v5 下位规范重建执行计划

> 性质：开发备忘/执行计划，非规范、非事实对象。
> 目的：供新会话 AI 执行者按本计划继续 LDVH v5 下位规范重建。
> 更新：2026-08-25（01 重建闭环后）。

## 0. 开工必读（执行者纪律）

1. **本仓库受 LDVH 管辖**（`governed_single`，配置 `/Users/dmh2002/DshProject/LDVH-GOVERNED-PROJECTS.yaml`）。若会话技能目录有 `ldvh` 技能，先加载；Git Gate 运行器与管辖判定 CLI 过渡期借用 v4 launcher：`/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4/ldvh`。
2. **受控提交流程（每个 commit 都必须）**：
   - 明确声明候选文件清单，只 stage 声明文件，核对真实 Index 路径集合与 staged diff；
   - 完整 message 写入工作树外临时文件（`/tmp/`），调用 `ldvh call precheck-git-commit`（request 含 `work_object_locators: ["/Users/dmh2002/DshProject/dsh-ldvh"]` 与 `arguments.message`），必须 `outcome=ok` 且 `result.mechanical_outcome=passed`；
   - 不带 `--no-verify` 的真实 `git commit -F /tmp/msg.txt`，确认 stderr 出现 `LDVH Git Gate (commit-msg) passed` 且 `snapshot_identity` 与预检一致；
   - 提交后回读：`git cat-file -p HEAD | sed '1,/^$/d' | diff /tmp/msg.txt -` 必须字节一致；
   - message 三行 trailer：`LDVH-Product-Name: deepseek-harness` / `LDVH-Model-Name: deepseek-v4-pro` / `Human-Gate: <Human 授权事实>`；body 必须含唯一 `关键变更:` 小标题与 `- ` 列表项，**每个 bullet 必须与 diff 逐条对应**（历史教训：message 声称但 diff 没有 = 纪律事故）。
   - **过渡期 header 格式**：v4 Gate 强制 `type(scope)`，合法 scope 闭集 = `adr, code, config, docs, pitfall, rules, runtime, spark, specs, study, tests, web, workcase`（如 `docs(docs):`、`docs(specs):`）。决策 #15（Human 定）：v5 重建后 header 只留 type 去掉 scope（如 `docs: …`）——**该规则等 v5 提交契约（06）与 v5 Git Gate 重建时才生效，此前继续用双段格式**。
3. **受保护文档**（00 §5.4.2 五类）：00、README、插件 AI 面向语义文本、LICENSE、版本声明点。任何修改必须逐段展示现有与拟改内容 + 经 Human 明确同意 + 只含该文档的独立 commit。
4. **不 push**：远端副作用需 Human 单独授权；本计划内一律不 push。
5. **不凭记忆**：动手前读 `docs/dev-memo.md`（决策 #1–#15、待定项 1–21）、`specs/00`、`specs/01`；事实/经验召回按 00 §5.2 与吸收账 `docs/study-absorption.md`。
6. **下位规范起草纪律**：每份规范 = 草案 → 双独立审核（价值审核：对照 00 §4 V1–V8/HV1–HV5 判据 + DSH 可实现性 + 防自欺判据；承接审核：与 00/01 一致性、不越权）→ 修复 → Human 审 → 受控提交。规范不设生命周期状态（01 §5.2）：文件存在 + 登记在册 + 提交经 Human 同意即当前规则源成员；身份块**无 status 字段**。

## 1. 当前状态快照（2026-08-25）

- dev 分支 31 个提交，全部未 push；工作树应保持干净。
- `specs/00-理念与构成.md`：六章定稿；身份块经 01 校准回填（无 status、`dimensions` 六维、`code_consumption` 4 键：spec_identity_block / spec_read_contract / minimal_guidance_profile / helper_service_boundary）。
- `specs/01-规范模型基础规范.md`：定稿（编号终表 §6.1：01 规范模型 / 02 事实模型 / 03 行动模板 / 04 六维工作模型 / 05 Helper 服务 / 06 事实源与信息溯源 / 07 工作对象与管辖 / 08 环境接入 / 09 Code / 10 Web；20–24 事实类型段；30–38 行动模板段；附件 `<父编号>.Att.<序号>`）。
- 决策 #1–#15（含 #15：Git 提交 header 只留 type 去掉 scope，重建时生效）；待定项 1–21。
- 关键衔接文档：`docs/dev-memo.md`（决策/待定项/快照）、`docs/00-audit.md`（审计入口与历轮结论）、`docs/study-absorption.md`（吸收账）、`docs/v4-problem-ledger.md`（v4 病灶）、`docs/dsh-platform-facts.md`（宿主能力清单）、`docs/v5-handoff.md`（D1–D7）。

## 2. 执行计划（按序）

### 步骤 1：待定项 11 展开（docs 小动作，先做）

把「内部关联五环节必决问题清单」写入 `docs/dev-memo.md` 待定项 11，作为 02 起草的检查表：
① **声明**：relations 字段形状、relation-key 闭集（按事实类型）、应声明项与创建入口强制点；② **证据**：关系必须指向证据（v4 05 L208 曾禁止关系承载证据——v5 反转），证据形态与校验深度（机械存在性 + AI 语义复核的边界，证据深度待 Human 定）；③ **谱系/承接**：拆分谱系、共同线索、routed-to/contributed-to/informs 家族是否结构化承载（与待定项 15 Intent 改名联动）；④ **消费与召回**：F0–F4 召回分层（注意：L0–L4 是规范读取分层、F0–F4 是事实召回分层，不混用）、关系边展开的容量预算、Web 图浏览以关系数据为骨架；⑤ **机械校验与服务**：闭集校验、目标完整性、不猜边红线（v4 05 L560 保留）、正向 relation_source_refs / 反向 relation_targets 检索。
另记 v4 实证：ADR 0/8、Pitfall 0/8、Spark 77/103、WorkCase 94/152、Study 17/51 声明关系；稀疏的另一半原因是声明摩擦高（吸收账 Obsidian 行「零摩擦链接文化」）：对治 = 创建入口应声明项 + 候选关系提示（AI 确认后写入，不自动写）。

### 步骤 2：起草 02 事实模型基础规范

要点（草案须覆盖）：五类事实（ADR/Pitfall/Spark/WorkCase/Study，编号段 20–24 的公共层）的公共字段与载体契约；受控创建/更新/读取（指纹 CAS、写后回读、完整性审计）；**关系声明五环节**（按步骤 1 清单落章）；`dimensions` 声明；与 00 §5.2 事实源边界、§3.2 受控创建与入档/事实预热注入、§3.3 三层防线、§4.3 证据纪律的承接。触达待定项 14–16（生命周期改进、Intent 改名、命名）时**只给方案呈 Human 定，不自行决定**。起草后按纪律 6 走双审核 + Human 审 + 受控提交（`docs(specs):`）。

### 步骤 3：起草 03 行动模板基础规范

要点：行动模板五机制（触发与排除契约、步骤停止条件、反逃避信号、完成门禁、分层评测）；快通道（00 §5.5 风险分层，快通道由行动模板定义、层级数/判断标准/声明方式统一定义）；预检落实记录（遵守维机械承载，格式由本文定义——00 §5.5.1 落点）；与 00 §3.2/§5.4/§5.5 承接。

### 步骤 4：起草 04 六维工作模型规范（单篇）

六维各占一章（读/写/遵守/审查/执行/检讨），每章只定：职责、判据、关键机制指向（指向 02/03/05/06/20–24/30–38 等）——机制细节不复制进本文；某维长大后按最小充分修改拆分，不预先拆分。

### 步骤 5：起草 05 Helper 服务规范

要点：插件工具直通契约（操作注册为宿主原生工具、AI 经工具直通）；请求/响应 envelope（沿用 v4 04.Att 契约语义，v5 化）；规范读取 L0–L4 与事实召回 F0–F4 的操作接口；`responsibility_key` 输入字段 = 目标规范的 `spec_key`/`attachment_key`（与 01 §7 一致）；与 00 §3.1 工具面承接。

### 步骤 6：起草 06 事实源与信息溯源规范

要点：事实载体（有 Git 可溯源 + 有组织可消费，00 §5.2）；溯源边界与**受控提交契约**（预检、Git Gate 终闸、署名 trailer、message 契约——**写入决策 #15**：v5 header 只留 type 去掉 scope，v5 Git Gate 重建时生效）；规则源成员管理；与 00 §3.3 机械守护承接。

### 步骤 7–10：07 工作对象与管辖 / 08 环境接入 / 09 Code / 10 Web

要点分别：受辖判定与工作对象边界（07）；插件接入、引导面（最小引导 profile 预算）、Hook 部署与 Git Gate 承接（08）；Code 实现与测试纪律（09）；四层阅读器与交互（10，呈现纪律沿用吸收账「内联可视化使用纪律」）。每份同样走步骤 2 的流程。

### 步骤 11：20–24 事实类型规范段 + 30–38 行动模板规范段

按 01 §6.1 登记表逐一注册起草；先 20/21/22/23/24（事实类型，与 02 联动），后 30–38（行动模板实例，与 03 联动）。

### 步骤 12：v5 自己的 Helper 服务与 Git Gate 实现

过渡期借用的 v4 launcher 替换为 v5 实现（受控替换，见 dev-memo 过渡期条目）；Git Gate 按 06 契约（type-only header）重建。

## 3. 完成定义与交还

- 每个步骤完成 = 文件落笔 + 双独立审核报告 + Human 审 + 受控提交（message 与 diff 逐条对应 + 字节一致 + 工作树干净）；
- 每完成一份规范，更新 01 §6.1 登记表（如注册新编号）并同步相关交叉引用；
- 会话结束时更新 `docs/dev-memo.md` §9 快照（本计划执行进度）与 `docs/00-audit.md`（如进行过审计）；
- 不 push、不改受保护文档（00/README/LICENSE/版本声明点/插件 AI 语义文本）未经 §5.4.2 流程。

## 4. 红线（Stop Conditions 摘要）

- 任何声称必须与 diff/grep 实证一致；替换类编辑必须 grep 验证落点；
- 预检非 `passed` 或 Git Gate 拒绝时停止，修正后重来，不绕过；
- Human 未明确同意的内容不得写入提交；
- 发现本计划与现行规范冲突时，先呈 Human 决定，不自行改计划。
