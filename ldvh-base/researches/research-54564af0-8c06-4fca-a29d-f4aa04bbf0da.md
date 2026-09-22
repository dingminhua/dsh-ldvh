---
title: mattpocock/skills 技能集调研（v1.2.3：前沿收敛/迷雾中间态/文档负载理论/机械校验缺口——对 dsh-ldvh 的可吸收清单）
status: active
research_question: 开源项目 mattpocock/skills（Matt Pocock 的 agent skills 技能集，v1.2.3）是什么、其流程与文档机制如何构成、边界与成熟度在哪里，对 dsh-ldvh 项目想要做的工作有何可吸收之处？
research_purpose: 为 dsh-ldvh 项目提供对一个同问题域、同宿主生态、但解法路径相反的高热度开源项目的定位理解，并据此形成可被 WorkCase 或 ADR 直接承接的吸收清单。该项目与 LDVH 同属「AI 长程协作的可靠性治理」问题域：它用提示词纪律应对 AI 对齐与上下文漂移，LDVH 用规范源与机械校验应对同一问题域；因此它既是机制设计的参照源（前沿收敛、迷雾中间态、文档负载理论可直接对照 LDVH 讨论系统、对象边界与规范书写），也是保障手段的反例源（其自身几乎不设机械校验，可作为 LDVH 机械锚点路线有效性的外部对照）。本轮调研由 Human 直接指令发起，以项目需求为主，涉及机制吸收的发现按 30 §1.2 显式标注为机制需求。
stopping_reason: sufficient
confirmed_statements:
  - F1 mattpocock/skills 是一套由 38 个可独立加载技能文件组成的技能集，按 promoted 与非 promoted 分桶，其「四方一致」约束目前只由人守规矩维持
  - F2 该项目与 LDVH 的根问题域高度重合而解法路径相反：它用提示词纪律与人守规矩应对 AI 对齐和上下文漂移，LDVH 用规范源与机械校验应对同一问题域
  - F3 该项目把技能可达性做成机器可判的两档，推进阶段与产状态的技能须 Human 触发，纯执行与查询技能可自主调用
  - F4 grilling 用设计树、前沿与分轮把模糊意图收敛为共享理解，以「前沿为空」作为可判定完成谓词，并把判据满足与获得行动授权明确分开
  - F5 grilling 把事实与决定的责任彻底分开，找事实是 AI 不得外推的职责，做决定是用户的职责且必须逐条等待
  - F6 wayfinder 以决策票、阻塞边与前沿承载超出单会话容量的大工程，明确产出决策而非交付物，且每会话至多解决一票
  - F7 wayfinder 的 map 被定义为索引而非存储，一条决策只存在于其工单一处，map 只做摘要与链接而不重述
  - F8 wayfinder 引入迷雾作为「已可行动」与「方向未定」之间的中间态，其入档判据是现在能不能把问题说清楚而非现在能不能回答
  - F9 阶段边界的上下文策略以五选项决策树按序判定，压缩被刻意排在最后，且全部动作被统一解释为「一手源转二手源」的单向代价
  - F10 writing-for-agents 把文档设计拆成两种负载、三级信息层级与「指针措辞决定召回」三组可操作杠杆
  - F11 完成判据被拆为清晰度与要求量两个属性，并识别出「过早完成」失败模式及「先锐化边界、再隐藏后续步骤」的防御顺序
  - F12 writing-for-agents 主张禁止式指令会反向激活被禁行为，并给出 no-op 扫描与「沉积」两个面向存量文档的清理概念
  - F13 CONTEXT.md 被硬性限定为纯术语表，以正名加一句话定义加禁用同义词的形式，并另设「已裁决歧义」段同时防止同义漂移与重复争论
  - F14 ADR 设三条必须同时成立的准入条件，模板被刻意压到最小，并把硬依赖与软依赖的二分落成按依赖强度决定是否写配置指针的写作规则
  - F15 该项目把「机械违规应转为确定性检查、判断类问题才留给标准文档」写成明确规则，并把「仓库无任何护栏」本身定为独立发现项
  - F16 该项目自身几乎不设机械校验，唯一可执行的文档纪律检查未接入 CI、CI 无合并前触发，且一条机械替换清扫曾破坏六个技能的元数据而未被拦截
  - F17 其 git 守卫是黑名单子串匹配而非命令结构解析，双向边界均已实测，既能漏拦结构变体也会误拦命令文本提及
  - F18 其约束失效时表现为 fail-open 而非 fail-closed，并发共享工作区与执行闭环缺口均已有自证记录
  - F19 该项目用 .out-of-scope 知识库按概念而非按工单持久留存被拒请求的论证，以达成制度记忆与去重
  - F20 handoff 载体的设计原则是指针而非复制并强制脱敏，且刻意不落入工作区
uncertain:
  - issue: Flagged ambiguities 段是该项目的通用实践还是本仓库自用扩展？
    reason: 该段出现在其自用 CONTEXT.md，但未出现在其自身发布的 CONTEXT-FORMAT.md 模板与规则段中，全仓仅此一处出现，无任何文档说明其规范地位。
  - issue: 两个上下文预算数字的依据来源未给出，且彼此不一致（约 150k tokens 与约 100K tokens）
    reason: 两数分处 ask-matt 与 wayfinder 两个技能文件，仓库内无引用来源、测量方法或适用模型说明；本调研不据此作出任何预算判断。
  - issue: check-plugin-version 未接入 CI 是历史遗留还是有意设计
    reason: 唯一把它接入 CI 的提交不在 main 分支上，更早历史未穷举，因此只能陈述当前 HEAD 上未接线，不能陈述其成因。
  - issue: CHANGELOG.md 是否被有意豁免 em-dash 禁令
    reason: 禁令清单含该文件而提出禁令的 changeset 范围清单不含，现状为未执行；仓库内无任何明文说明该豁免，属推测范围，不予断言。
  - issue: git 守卫黑名单的完整绕过面未穷举
    reason: 仅实测 6 个样本（含 -C 变体与多空格变体），引号、变量拼接、别名、反斜杠转义等形态未验证，只能陈述已实测的漏拦面。
gaps:
  - description: 该项目多个核心机制的实装状态未逐一验证：retro 在桶 README 中被标为 STUB（仅为设计笔记尚不可用），pr、implement-spec、loop-me、claude-handoff 等 in-progress 技能均未进入 promoted 集。因此本调研引用的部分机制属「已写成但未必已实装」，未逐版本跟踪验证。阻塞建议八与建议十的落地力度评估。
    priority: medium
    blocked_scope: 建议八（正面陈述优先的实证强度）、建议十（ADR 记录价值判据的实证强度）
  - description: 未取得该项目的社区使用反馈与独立评价。本次取证仅基于仓库自身文本（含其自述的失效案例），未采集第三方使用反馈、议题讨论或独立评测，因此「这些机制在真实项目中长期有效」无外部证据支撑；本调研对机制效用的判断均限于设计合理性而非实证有效性。阻塞任何以「该项目已验证有效」为前提的取舍判断。
    priority: medium
    blocked_scope: 全部以「其实证有效性」为前提的取舍判断
  - description: 未获取该仓库的实时量化指标（star 数、安装量、议题净流入等），因本会话环境对其 HTTP 访问受限；本调研不包含任何流行度声明，也不以流行度作为吸收理由。
    priority: low
  - description: 未验证其 harness 清单校验命令（claude plugin validate . --strict）的实际通过状态，因需外部 CLI 且超出只读范围；仅读到其 ADR 的历史声称。
    priority: low
clarification_log:
  - question: 用户所说「matt skills 这个项目」指哪一个？
    answer: mattpocock/skills（Matt Pocock 出品，描述为 Skills for Real Engineers，MIT 许可）。检索发现同名前缀项目众多（含多个中文本地化与 DSH 移植版本、以及一个无关的 mate-matt/matt-skills），已以「上游原版仓库」为对象锁定；用户随后指令在同级目录克隆原版并安排调研，进一步确认对象。
    answered_by: external
implications:
  - finding_ref: F2 该项目与 LDVH 的根问题域高度重合而解法路径相反：它用提示词纪律与人守规矩应对 AI 对齐和上下文漂移，LDVH 用规范源与机械校验应对同一问题域
    implication: 同一问题域的相反解法样本，为「机制可吸收、保障手段不可吸收」划定边界：其分工设计、判据形态与载体结构可对照吸收，其依赖模型自觉的保障手段不可吸收（LDVH 00 §7.1 已定 AI 自述不得作为依据）
  - finding_ref: F4 grilling 用设计树、前沿与分轮把模糊意图收敛为共享理解，以「前沿为空」作为可判定完成谓词，并把判据满足与获得行动授权明确分开
    implication: 「前沿」为 31 号讨论系统提供机械可算的轮内取材判据（只依赖问题依赖关系）；其「判据满足不等于获得授权」与 LDVH 00 §4 同向，可作旁证（见建议三）
  - finding_ref: F8 wayfinder 引入迷雾作为「已可行动」与「方向未定」之间的中间态，其入档判据是现在能不能把问题说清楚而非现在能不能回答
    implication: 识别出 LDVH 20 号 Spark 与 21 号 WorkCase 之间的第三态缺口：「连问题本身都说不清」的方向性内容与 Spark 的单句 question 要求存在张力，属对象边界问题，须提请 Human（见建议四）
  - finding_ref: F10 writing-for-agents 把文档设计拆成两种负载、三级信息层级与「指针措辞决定召回」三组可操作杠杆
    implication: 为 LDVH 规范与引导文本自身提供书写方法论：L0–L4 层级机制已完备，缺的是「指针措辞」这一层纪律；两种负载二分可用于给最小规则引导的常驻成本记账（见建议二，涉受保护内容）
  - finding_ref: F11 完成判据被拆为清晰度与要求量两个属性，并识别出「过早完成」失败模式及「先锐化边界、再隐藏后续步骤」的防御顺序
    implication: 把 21 号 WorkCase 的 done_criteria 从「可被证据判定」单条要求扩展为可操作检查项，并给出了「判据模糊导致提前收口」的具体失败机制（见建议七）
  - finding_ref: F15 该项目把「机械违规应转为确定性检查、判断类问题才留给标准文档」写成明确规则，并把「仓库无任何护栏」本身定为独立发现项
    implication: 为 LDVH 02 §15 提供一个更进取的默认取向（凡机械可判定者默认建检查，写规范为退路），并为 26 号 Friction 提供一个可自动识别的入账信号（无护栏本身即摩擦）（见建议一）
  - finding_ref: F16 该项目自身几乎不设机械校验，唯一可执行的文档纪律检查未接入 CI、CI 无合并前触发，且一条机械替换清扫曾破坏六个技能的元数据而未被拦截
    implication: 支持 LDVH 既有路线的外部负面证据：规则无机械承载必然漂移（其一处禁令已实际漂移 104 处）、校验时机须在提交前而非合并后、机械替换本身会制造回归；与既有 Pitfall 96fb3199、a774d7de 同族，构成跨项目印证
  - finding_ref: F17 其 git 守卫是黑名单子串匹配而非命令结构解析，双向边界均已实测，既能漏拦结构变体也会误拦命令文本提及
    implication: LDVH Git Gate 的直接对照物，结论是不吸收该模型：黑名单子串匹配作为拦截手段双向失准（漏拦 -C 变体、误拦命令内文本提及），LDVH 的路径覆盖式拦截是更可靠形态；仅「被拦时明确告知无权」的反馈形态可作参考（见建议十二）
  - finding_ref: F18 其约束失效时表现为 fail-open 而非 fail-closed，并发共享工作区与执行闭环缺口均已有自证记录
    implication: 三处自证共同印证 LDVH 00 §7.2 的 fail-closed 取向：「解析是自信的而不是 fail-closed 的」可作为 AI 概率性输出的具体可复核案例；「无完成步骤导致前沿永不推进」是一个闭环断裂的完整样本，对 21 号关闭关口与 26 号 Friction 入账有参照价值
  - finding_ref: F19 该项目用 .out-of-scope 知识库按概念而非按工单持久留存被拒请求的论证，以达成制度记忆与去重
    implication: 识别出 LDVH 的真实缺口候选：22 号 retired、20 号 discarded（disposition ≤200 字符）、26 号 Friction 的处置理由均为摘要级，无位置承载「已明确拒绝方向」的完整论证，导致「当初为什么不做」只有摘要可查（见建议十一，须提请 Human）
urls:
  - ref: https://github.com/mattpocock/skills/blob/main/README.md
    title: mattpocock/skills 仓库 README（安装方式、四个失败模式与技能总览）
    summary: 支撑 F2（其根问题域与解法取向）与 F1（技能集构成与参考索引）；其「为什么这些技能存在」一节给出的四个失败模式是判定其与 LDVH 同问题域的关键依据。该文件为面向人类的入口文档。
  - ref: https://github.com/mattpocock/skills/blob/main/CLAUDE.md
    title: 仓库根 CLAUDE.md（AGENTS.md 为其符号链接）
    summary: 支撑 F1、F16 与其一致性约束判定；25 行，承载全部仓库级文字规则（桶与 promoted 约束、文档同步要求、调用方式约束、em-dash 禁令、插件清单校验要求）。是该仓库对 agent 的唯一常驻规则文本。
  - ref: https://github.com/mattpocock/skills/blob/main/CONTEXT.md
    title: 仓库自用 CONTEXT.md（术语表实例）
    summary: 支撑 F13 与其自用实例形态；提供「正名 + 一句话定义 + _Avoid_ 禁用同义词」与「已裁决歧义」段的实际样例。注意该文件仅 30 行且为该仓库自用，其段落设计未见于其发布的模板（见未证实第 1 条）。
  - ref: https://github.com/mattpocock/skills/blob/main/.agents/invocation.md
    title: 技能调用方式规范（用户触发 vs 模型触发）
    summary: 支撑 F3；定义两档可达性的机械字段、描述措辞差异与可达性不变量。是判定其授权分档可被机器执行的关键依据。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md
    title: grilling 技能（访谈原语）
    summary: 支撑 F4、F5；28 行，定义设计树、前沿、分轮格式、完成谓词与事实/决定分工，是该仓库被其自身两个技能与多个流程复用的核心原语。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md
    title: wayfinder 技能（大工程寻路）
    summary: 支撑 F6、F7、F8；128 行，定义决策票、阻塞边、前沿、每会话上限、地图五段骨架与迷雾判据。是本次调研中对 LDVH 对象边界最有增量的来源。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/PHASE-BOUNDARIES.md
    title: 阶段边界决策树（上下文策略五选项）
    summary: 支撑 F9；给出五选项按序判定树、压缩排末位的理由与「一手源转二手源」代价模型。注意其中 token 预算数字无来源（见未证实第 2 条）。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md
    title: writing-for-agents 技能（面向 agent 的文档写作）
    summary: 支撑 F10、F11、F12；81 行，承载两种负载、三级信息层级、指针措辞、完成判据两属性、否定反效果、no-op 扫描与沉积等全部写作方法论。是本次调研中对 LDVH 规范书写最有增量的来源。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md
    title: domain-modeling 技能（领域建模与 ADR 准入）
    summary: 支撑 F13、F14；定义 CONTEXT.md 的硬边界、懒创建纪律、写入时机，以及 ADR 的三条准入条件与最小模板。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/CONTEXT-FORMAT.md
    title: CONTEXT.md 格式规范（该仓库发布的模板）
    summary: 用于判定未证实第 1 条：其模板与规则段均不含「已裁决歧义」段，据以判定该段的规范地位无法确立。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/ADR-FORMAT.md
    title: ADR 格式规范
    summary: 支撑 F14；另用于记录其位置规范（docs/adr/）与其自身实例位置（.agents/adr/）不一致这一发现。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/in-progress/retro/SKILL.md
    title: retro 技能（会话复盘）
    summary: 支撑 F15；承载「机械违规转确定性检查、默认建检查而非写规则」与「无护栏本身是发现项」两条规则。注意该技能在桶 README 中被标为 STUB，其规则未必已实装（见缺口第 1 条）。
  - ref: https://github.com/mattpocock/skills/blob/main/package.json
    title: 仓库 package.json
    summary: 支撑 F16；其 scripts 段是判定「该仓库几乎不设机械校验」的直接依据（仅三个脚本、无 lint/test/typecheck）。
  - ref: https://github.com/mattpocock/skills/blob/main/.github/workflows/release.yml
    title: 唯一 CI 工作流（发布）
    summary: 支撑 F16；用于判定其 CI 只在 push 到 main 时触发、无 pull_request 触发、仅一个发布任务，即所有校验都在合并之后。
  - ref: https://github.com/mattpocock/skills/blob/main/scripts/sync-plugin-version.mjs
    title: 版本同步脚本与其 --check 模式
    summary: 支撑 F16 与未证实第 3 条；该脚本是唯一可执行的文档纪律检查，其 --check 模式在写盘前退出并可被机械消费（主控实测当前通过），但未接入 CI。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh
    title: 危险 git 命令拦截脚本
    summary: 支撑 F17 与未证实第 5 条；25 行，9 条模式 + grep 子串匹配 + exit 2，是 LDVH Git Gate 的直接对照物，其双向失准由主控独立复现验证。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/misc/git-guardrails-claude-code/SKILL.md
    title: git 守卫安装技能
    summary: 支撑 F17 的可安装性判定；用于确认该守卫是可安装模板而非该仓库自身启用的保障（其自身无 pre-commit 配置与钩子）。
  - ref: https://github.com/mattpocock/skills/blob/main/.changeset/fix-yaml-frontmatter-colons.md
    title: YAML 前置元数据修复 changeset
    summary: 支撑 F16 的第二处自证；记录机械替换清扫导致的真实回归（六个技能元数据非法 YAML，被安装器在发现阶段跳过）。
  - ref: https://github.com/mattpocock/skills/blob/main/.changeset/remove-em-dashes-repo-wide.md
    title: 全仓 em-dash 清扫 changeset
    summary: 支撑 F16 与未证实第 4 条；给出禁令的范围清单（不含 CHANGELOG.md），与 CLAUDE.md 的禁令清单（含）不一致，据以标记该豁免为未证实。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/OUT-OF-SCOPE.md
    title: 超出范围知识库规范
    summary: 支撑 F19；定义 .out-of-scope/ 的两个目的、按概念一文件的组织纪律与文件风格要求。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md
    title: handoff 技能（跨会话交接载体）
    summary: 支撑 F20；16 行，给出四条硬约束（存放位置、指针而非复制、必备建议技能段、强制脱敏）。注意该技能目录下无交接文档模板，结构仅由提示词约束（见未证实第 6 条）。
  - ref: https://github.com/mattpocock/skills/blob/main/docs/engineering/implement.md
    title: implement 技能的人类文档页（含常见问题与已知局限）
    summary: 支撑 F18；97 行，承载该仓库自述的三处失效（工单号解析是自信的而非 fail-closed、并发共享工作目录导致提交落错分支、执行技能无完成步骤导致前沿永不推进）。是该仓库最有价值的自证来源。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md
    title: 本地 markdown 追踪器约定
    summary: 支撑 F6、F7；定义地图与子票的纯文本形态、Status/Blocked by 行约定、前沿的目录扫描算法与「写入 claimed 即领取」的凭证规则。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md
    title: setup 技能（每仓库一次性配置）
    summary: 支撑 F1 与 F16；提供「一次配置、多技能消费」的配置分发模式样例，并自述该技能为提示词驱动而非确定性脚本。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/SKILL.md
    title: triage 技能（议题分诊状态机）
    summary: 支撑 F3 的落点验证与 F1 的桶约束；给出「分类角色 + 状态角色」正交模型与规范角色名到实际标签串的解耦映射。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/AGENT-BRIEF.md
    title: agent brief 写作规范
    summary: 支撑 F1 与文档承载纪律相关发现；给出「耐久优先于精确」（禁引路径与行号）、描述行为而非过程、可独立验证的验收判据与显式范围边界四条原则。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md
    title: to-tickets 技能（垂直切片拆分）
    summary: 支撑 F6 的上游环节与 F18 的前沿定义；给出垂直切片四规则、阻塞边与宽重构的 expand-contract 例外路径。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md
    title: tdd 技能（测试驱动开发）
    summary: 支撑「前置同意门」类机制的判定；给出接缝预同意闸门（未确认接缝不得写测试）与同义反复测试反模式（期望值须来自独立事实源）。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md
    title: code-review 技能（双轴审查）
    summary: 支撑「多视角不可合并」类机制的判定；给出标准轴与规范轴分离、各跑独立子代理、明令禁止合并或重排序的理由（防止一轴遮蔽另一轴）。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md
    title: diagnosing-bugs 技能（疑难缺陷诊断）
    summary: 支撑「无证据不得推进」类机制的判定；给出先建反馈回路的硬纪律、可核验的阶段完成判据、以及无法建回路时的 fail-loud 停止条件。
  - ref: https://github.com/mattpocock/skills/blob/main/.agents/adr/0001-explicit-setup-pointer-only-for-hard-dependencies.md
    title: 该仓库 ADR-0001（硬依赖与软依赖二分）
    summary: 支撑 F14；10 行，展示把「配置依赖强度」落成写作规则的样例，与 LDVH 01 §10.1 的负载型/路由型引用二分形成对照。
  - ref: https://github.com/mattpocock/skills/blob/main/.agents/adr/0002-ship-as-a-claude-code-plugin.md
    title: 该仓库 ADR-0002（插件分发决策）
    summary: 支撑 F14 与未证实相关发现；展示「推迟 + 复访触发条件」的决策形态，并用于记录其仍以现在时提及一个已不存在的技能桶（文档与磁盘漂移）。
  - ref: https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/SKILL.md
    title: ask-matt 技能（技能路由器）
    summary: 支撑 F6、F9 的流程全貌与其自承滞后；提供「主流程 + 两个上匝道 + 词汇层 + 独立技能」的组织视图，以及「路由器需随技能变更同步更新、否则路由器会说谎」的自述。
object_uid: 54564af0-8c06-4fca-a29d-f4aa04bbf0da
fact_type_key: research
created_at: 2026-09-22T12:39:42.062Z
change_log:
  - at: 2026-09-22T12:39:42.062Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Research 对象
---

## 研究问题

开源项目 mattpocock/skills（Matt Pocock 的 agent skills 技能集，v1.2.3）是什么、其流程与文档机制如何构成、边界与成熟度在哪里，对 dsh-ldvh 项目想要做的工作有何可吸收之处？

本调研为明确方向型：调研对象在启动时已由 Human 界定（本地同级目录已克隆的 mattpocock/skills，HEAD `c55ee46`），无需先行调查阶段。调研范围限于「该项目自身的机制构成」与其「对 LDVH 想做的事的可吸收性」，不覆盖其在第三方项目中的实际效果，也不覆盖 LDVH 自身的规范修订决定。

## 输入与边界

**主要来源与分工**：全部证据取自该项目公开仓库的文本本身。观察点为一个本地克隆（`/Users/dmh2002/DshProject/mattpocock-skills`），HEAD 提交 `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`，`git describe` 为 `v1.2.3-54-gc55ee46`，工作树干净；`urls` 中各条目给出该克隆内文件在 GitHub 上的长期可回指位置。读取方式为静态文本阅读与只读命令，未运行其技能、未安装其插件、未执行需要外部 CLI 的校验命令。

**观察时点与版本**：2026-09-22 观测，对象版本 v1.2.3-54-gc55ee46。该仓库仍在活跃演进（HEAD 之后有未合并分支），本调研的三态结论绑定此版本。

**方法**：一为全文直读——`README.md`、`CLAUDE.md`、`CONTEXT.md`、`.agents/` 全部元文档、`.claude-plugin/` 清单、`scripts/` 全部脚本、`.github/workflows/release.yml`、`.changeset/` 配置与关键 changeset，以及 38 个 `SKILL.md` 中的核心子集与 `.out-of-scope/` 三篇；二为委派取证——三个只读子代理分别覆盖流程控制机制、文档纪律与规范承载、机械校验与工程实现，各自提交逐字摘录与 `文件:行号` 锚点并自证只读；三为主控复核——对子代理提交的关键断言逐条重跑，含独立复现其 git 守卫脚本的边界行为、独立机械核验其清单一致性与 em-dash 分布、独立定位其自证失效段落的行号。子代理结论与主控复核不一致处一律以主控复核为准。

**不覆盖范围**：未运行任何技能以观察实际行为；未采集第三方使用反馈、issue 讨论或独立评测；未通过 API 抓取实时量化指标（本会话环境对 github.com 的 HTTP 访问受限）；未执行其依赖外部 CLI 的清单校验命令；未穷举 git 守卫的绕过面；未跟踪其未合并分支上的能力。

## 关键发现

### F1 mattpocock/skills 是一套由 38 个可独立加载技能文件组成的技能集，按 promoted 与非 promoted 分桶，其「四方一致」约束目前只由人守规矩维持

观察事实：仓库 `skills/` 下按 `engineering/`、`productivity/`（promoted）与 `misc/`、`in-progress/`、`deprecated/`（非 promoted）分桶，共 38 个 `SKILL.md`。`CLAUDE.md` 要求 promoted 桶的每个技能必须在顶层 `README.md` 被引用、且必须出现在 `.claude-plugin/plugin.json` 的 `skills` 数组中，非 promoted 桶则两者都不得出现。主控以脚本独立核验：磁盘 promoted 集合 25、`plugin.json` 声明 25、`README.md` 链接 25、`docs/` 页面 25，四者完全一致且无孤儿；38 个技能目录全部配有 `agents/openai.yaml`。但该一致性没有任何脚本或 CI 校验，属文字规则。

对 LDVH 的价值判断：这是 LDVH 已确立路线的一个外部复现样本——LDVH 的取值是「规则必须有机械承载，否则只是声明」。该项目把同一约束写成必须（`must`）却无机械门禁，而当前四方恰好一致。两点可吸收：（一）「多个派生视图必须与唯一权威一致」这一模式本身正确，可直接对照 LDVH 的规范源身份块与目录基数校验；（二）其一致性靠自律维持而非机械维持，恰是 LDVH 应避免的形态，可作为反例纳入写作纪律。

溯源：https://github.com/mattpocock/skills/blob/main/CLAUDE.md（CLAUDE.md:9）

### F2 该项目与 LDVH 的根问题域高度重合而解法路径相反：它用提示词纪律与人守规矩应对 AI 对齐和上下文漂移，LDVH 用规范源与机械校验应对同一问题域

观察事实：`README.md` 以四个失败模式组织全篇，其一为「Agent 没有做我想要的事」，开篇引《程序员修炼之道》「没有人确切知道自己想要什么」，并把根因定为 misalignment；其四是「我们造出了一坨泥」，指出 agent 让软件熵增速加快。该项目的应对是把工程实践封装为可加载技能（`/grilling`、`/to-spec`、`/to-tickets`、`/implement`、`/tdd`、`/code-review`），载体是提示词与文档。

对 LDVH 的价值判断：两者在问题域上同源（AI 不可靠、人的意图有损、长程漂移），但在解法归属上相反：该项目把解法放在「模型会更听话」的提示词层，LDVH 把解法放在「规则可强制、事实可回读」的承载层。这不是优劣判断，而是吸收边界判断——其**机制设计**（分工、判据、载体形态）可吸收，其**保障手段**（依赖模型自觉）不可吸收，因为 LDVH 的 00 §7.1 已明确「AI 自述不得作为事件已经发生的依据」。

溯源：https://github.com/mattpocock/skills/blob/main/README.md（README.md:84-92）

### F3 该项目把技能可达性做成机器可判的两档，推进阶段与产状态的技能须 Human 触发，纯执行与查询技能可自主调用

观察事实：可达性由两个 harness 各自的机械开关表达——Claude Code 侧用 frontmatter 的 `disable-model-invocation: true`，Codex 侧用 `agents/openai.yaml` 的 `policy.allow_implicit_invocation: false`，`.agents/invocation.md` 要求两侧保持同步。主控实测：38 个技能中带 `disable-model-invocation: true` 的 22 个、不带的 16 个，两侧标记完全 1:1 对齐，零不匹配。该轴另有可达性不变量：用户触发的技能可以调用模型触发的技能，但永远不能到达另一个用户触发的技能。

对 LDVH 的价值判断：这是一条**机器可判的授权分档**，与 LDVH 的 Human Gate 同向但粒度更细——它把「谁能发起这个动作」从规范条文变成加载器就能拒绝的字段。可吸收点在粒度：LDVH 当前对「主控可自主发起」与「须 Human 发起」的区分主要在业务系统与 Gate 层面，而该项目给出了「按动作是否会改变状态或推进阶段」来分档的判据，且该判据可由宿主机械执行。需注意其可达性不变量是一条真正的不变量（传递闭包上的单调性），值得作为设计参考。

溯源：https://github.com/mattpocock/skills/blob/main/.agents/invocation.md（．agents/invocation.md:5-8）

### F4 grilling 用设计树、前沿与分轮把模糊意图收敛为共享理解，以「前沿为空」作为可判定完成谓词，并把判据满足与获得行动授权明确分开

观察事实：`/grilling` 把访谈建模为设计树——每个决定分叉出挂在它下面的决定；每轮只问「前沿」，即前置条件已定的那批问题，编号、给出推荐答案、然后等待回答再进入下一轮。一个依赖本轮其他未决问题的问题属于更后一轮。完成判据被写成可判定谓词：「当前沿为空时会话结束：设计树的每个分支都被访问过，没有任何东西被默默假定」；紧接着一条授权闸门：「在用户确认你们已经达成共享理解之前，不要据此行动」。

对 LDVH 的价值判断：这是本次调研中与 LDVH 同构度最高的一处，且它把两件 LDVH 严格区分的事也分开了——**判据满足**不等于**获得授权**。LDVH 的 31 号讨论系统已有「轮次循环 + 收敛判据 + 上限 3 轮」，但「前沿」这一概念提供了 31 号目前没有的东西：一个**只依赖问题依赖关系、不依赖回答内容**的机械可算子集，使「这一轮该问哪些」不再依赖主控的临时判断。可吸收（见建议三、建议四）。同时其完成谓词措辞（「没有任何东西被默默假定」）与 LDVH 反自欺方向一致。

溯源：https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md（skills/productivity/grilling/SKILL.md:6-28）

### F5 grilling 把事实与决定的责任彻底分开，找事实是 AI 不得外推的职责，做决定是用户的职责且必须逐条等待

观察事实：原文把两半写在一句里——「找**事实**是你的工作，永远不是用户的」；「**决定**是用户的：每一条都交给他们并等待」。同段给出不阻塞调度规则：当某个前沿问题需要一个环境事实时派子代理去查，不要就自己能查到的事去问用户；不阻塞——正在跑的探索是一个未决前置，所以只有依赖它的问题等待，本轮其余前沿问题照常发问。grilling 中的事实与决定另按产物分文件承载：决定进 ADR，词汇进 `CONTEXT.md`，外部事实进带引用的 markdown。

对 LDVH 的价值判断：这一条与 LDVH 的 00 §5（AI 责任）与 §4（Human 决定权）分工完全同向，但它补上一个 LDVH 当前未明确的操作细节：**把「不该问用户的问题」判定为「AI 可自查的事实」**，并配套给出并行调度规则。可吸收点在「不阻塞」那半句：LDVH 的调研与讨论都会遇到「等一个外部证据才能继续」的情形，而这里的处置是把等待限制在依赖子集内、其余照常推进，这比整体暂停更省。属机制吸收，且不涉及价值取舍，风险低。

溯源：https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md（skills/productivity/grilling/SKILL.md:26）

### F6 wayfinder 以决策票、阻塞边与前沿承载超出单会话容量的大工程，明确产出决策而非交付物，且每会话至多解决一票

观察事实：`/wayfinder` 面向「想法太大、一个会话装不下、通往目的地的路还看不见」的情形。它把路画成追踪器上的一张**共享地图**，其子票是**决策票**——「所解决的问题是一个决定，而不是要执行的一段构建」。技能明确自我约束为「规划而非动手」，并给出硬上限：「任一模式下，**每会话不得解决超过一票**，研究票除外」；把「想直接动手」这一冲动重新解释为「已到达地图边缘、该交还」的信号。

对 LDVH 的价值判断：这是对 LDVH 21 号 WorkCase 与 20 号 Spark 之间地带的补位。LDVH 有「未定议题」（Spark）与「已批准工单」（WorkCase），但「**为了看清方向而必须先解决的决定**」作为一个可独立领取、可独立阻塞、可独立关闭的单位，当前没有专门载体。其「每会话至多一票」是一个**上限式约束**（而非流程步骤），与 LDVH 的防稀释纪律方向一致：限制单次推进量以保护判断质量。可吸收（见建议五）。另需注意其代价：正因为采用了上限与依赖边，它明确承认并行为需自行搭建，且依赖链一旦不关闭前沿就永不推进（见 F18）。

溯源：https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md（skills/engineering/wayfinder/SKILL.md:7-13,105）

### F7 wayfinder 的 map 被定义为索引而非存储，一条决策只存在于其工单一处，map 只做摘要与链接而不重述

观察事实：地图被明确写成「是一个**索引，不是存储**。它列出已作的决定，并指向持有其细节的票；一条决定恰好存在于一个地方——它的票——所以地图从不重述它，只给要点并链接」。地图正文只有五段固定骨架：目的地、备注、至今已作的决定、尚未明确、超出范围；其中未关闭的票**不**列在地图里，靠查询发现。地图被要求每会话只加载一次低分辨率视图，需要时再按需展开单票全文。

对 LDVH 的价值判断：这与 LDVH 03 §6.2「唯一当前权威载体」和 24 号「frontmatter 是薄索引层、正文是研究主体」是同一设计原则的另一种实现——**索引与内容分离，索引不复制内容**。其额外贡献是给出了索引与内容的**加载粒度纪律**：索引每会话加载一次、内容按需展开。LDVH 已有 F1/F2/F3/F4 分层召回，但在「索引本身如何被书写」上没有成文要求；该项目用一句「索引不重述」把它变成可检查的写作规则。可吸收为写作纪律，成本极低。

溯源：https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md（skills/engineering/wayfinder/SKILL.md:23-53）

### F8 wayfinder 引入迷雾作为「已可行动」与「方向未定」之间的中间态，其入档判据是现在能不能把问题说清楚而非现在能不能回答

观察事实：地图被要求**故意不完整**——在活票之外是「战争迷雾」：那些你能看出要来、但因依赖尚未打开的问题而还钉不下来的决定与调查。迷雾写在地图的「尚未明确」段。它与票的分界判据被明确写成一句：「**迷雾还是票？**判据是你**现在**能不能精确陈述这个问题，**不是**你现在能不能回答它」；并给出两条分支：问题已经清晰时开票（哪怕它被阻塞、暂时动不了），还说不那么清晰时留在迷雾。另有一条防过度切分纪律：不要把迷雾预先切成票大小的小块。

对 LDVH 的价值判断：这是本次调研中对 LDVH **对象边界最有增量**的一处。LDVH 20 号 Spark 承载「方向未定、尚无可执行方案的议题」，21 号 WorkCase 承载「已批准工单」；两者之间的判据是「方案是否已明确」。而「迷雾」揭示了第三种情形：**方案已无法明确，但连问题本身都还说不清**——按 LDVH 现口径它只能落 Spark，而 Spark 的 `question` 字段要求「单句可读」，恰好装不下它。该项目的判据（以「能否说清问题」而非「能否回答」为界）提供了一个可机械化的收敛判据。可吸收（见建议四），但涉及对象边界，须 Human 裁决，不得由调研结论直接改写类型规范。

溯源：https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md（skills/engineering/wayfinder/SKILL.md:82-93）

### F9 阶段边界的上下文策略以五选项决策树按序判定，压缩被刻意排在最后，且全部动作被统一解释为「一手源转二手源」的单向代价

观察事实：阶段被定义为会话内的一块工作（grilling、实现、QA），边界是两块之间；技能明确「**阶段中途没有决定可做**：要么继续，要么把剩下的工作拆给子代理，中途压缩会让 agent 丢失线索」。边界上用五选项按序判定、第一个「是」胜出：能否继续（下一阶段需要本阶段作为一手源，或还剩足够预算）→ 上下文是否与后续无关（清空）→ 是否需要交接（换 harness、换目录、交给同事、阶段中途分叉）→ 任务能否无人值守完成（子代理）→ 否则压缩。压缩被刻意放在最后：「是**默认，不是首选**，它排在底部，因为上面四个问题都更便宜或更精确；从它开始的失败模式是——新会话对一个被摘要压平的决定自信地出错」。所有动作统一用一个代价模型解释：除「继续」外，每个动作都把一手源变成二手源。

对 LDVH 的价值判断：LDVH 已明确把「上下文压缩、上下文预算与 token 管理」划归宿主机制（35 号 §3.2）。因此**token 预算部分不吸收**，属已定边界。但此处有两项不属于宿主实现、属判断规程的内容可吸收：（一）「阶段中途不做该决定」这条**时机纪律**；（二）「一手源转二手源」这一**代价模型**——它把 Continue、清空、交接、子代理、压缩五种手段放在同一把尺子上比较，而不是各自独立。LDVH 的 00 §7.4 交还结构与会话接续目前没有这把尺子，而它对「何时该交接、何时该继续」有直接解释力。可吸收为交还判据素材（见建议六）。

溯源：https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/PHASE-BOUNDARIES.md（skills/engineering/ask-matt/PHASE-BOUNDARIES.md:5,19-51）

### F10 writing-for-agents 把文档设计拆成两种负载、三级信息层级与「指针措辞决定召回」三组可操作杠杆

观察事实：**两种负载**——上下文负载是常驻材料在 agent 窗口上的成本（`AGENTS.md` 一行、技能描述、每轮都在上下文体里花钱的文本），认知负载是人在「有哪些文档、何时该取哪份」上的成本，且原文明确「人是索引」，认知负载不是要最小化的成本而是人类能动性的代价。**三级层级**——文件内步骤、文件内参考（被按需查阅，允许是扁平平级集合）、被披露的参考（推到单独文件、由上下文指针触达）。**指针措辞**——「**指针的措辞**、而不是它的目标，决定了 agent 何时触达该材料以及多可靠；一个必备目标藏在措辞软弱的指针后面是一个方差缺陷：先锐化措辞，只有锐化失败才内联」。渐进披露的判定测试是「分支」：每条分支都需要的内联，只有部分分支才到的推到指针后。

对 LDVH 的价值判断：这是对 LDVH **规范与引导文本自身书写**的直接方法论增量。LDVH 已有 L0–L4 渐进披露（01 §10.2）与最小规则引导（01 §10.4），层级机制本身完备；缺的是「指针该怎么写」这一层——LDVH 的引导文本与规范交叉引用目前没有措辞纪律，「措辞决定召回率、且弱措辞是方差缺陷」这一判断可直接对照 01 §10.4。另「两种负载」的二分对 LDVH 也有解释力：LDVH 的最小规则引导正属常驻上下文负载，其每轮成本可被显式记账。可吸收为规范书写要求（见建议二）。

溯源：https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md（skills/productivity/writing-for-agents/SKILL.md:10-43）

### F11 完成判据被拆为清晰度与要求量两个属性，并识别出「过早完成」失败模式及「先锐化边界、再隐藏后续步骤」的防御顺序

观察事实：每个步骤都终止于一个完成判据。原文给判据两个属性：**清晰度**——agent 能否分辨做完与没做完；模糊边界（如「已达成理解」）会招致「**过早完成**」：在真正做完之前就结束该步骤、注意力滑向「已经做完」。并指出拉力来源与防御顺序：可见的**后续步骤**提供拉力，判据的清晰度提供抵抗力；「按顺序防御：**先锐化边界**（局部且便宜）；只有当它本质模糊**且**你观察到抢跑时，才用拆分序列的方式把后续步骤藏起来」。第二个属性是**要求量**——「每个被改动的模型都有交代」相比于「产出一份变更清单」强制了更彻底的功夫；且要求量不绑定步骤，「每条规则都已落实」同样约束一整套平级参考。最强的判据同时可检查且穷尽。

对 LDVH 的价值判断：这一条对 LDVH 21 号 WorkCase 的 `done_criteria` 与 02 §15 复核制度有直接的方法论价值。LDVH 已要求 `done_criteria`「可被证据判定」，但只有一条要求（可判定）；此处把它拆成**清晰度**与**要求量**两维，并识别出「判据模糊会导致提前收口」这一具体失败机制及其防御顺序。可吸收为 WorkCase 计划步骤的书写纪律（见建议七）。注意该判断来自提示词工程语境，LDVH 吸收时须落到字段书写要求，而非新增机制。

溯源：https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md（skills/productivity/writing-for-agents/SKILL.md:45-52）

### F12 writing-for-agents 主张禁止式指令会反向激活被禁行为，并给出 no-op 扫描与「沉积」两个面向存量文档的清理概念

观察事实：**否定**被列为与杠杆相邻的失败模式：「用禁止来导向会把被禁行为拖进上下文，并让它**更**可用，而不是更不可用」，主张改为正面陈述目标行为，禁止式指令只在无法正面表述时作为硬护栏保留、且须配对正面目标。**no-op**：逐句猎捕「模型默认就已经遵守、因而什么都没说的指令」，其判据「相对于默认它是否改变行为」，且明确「该判据是模型相对的，不是读者相对的」。**沉积**：没有修剪纪律时，文档的默认命运是「因为加进去感觉安全、删掉感觉有风险而沉下来的过期层」。

对 LDVH 的价值判断：这条是对 LDVH 规范书写习惯的一次**实质性挑战**，且触及根边界，须 Human 裁决，不得由调研结论直接适用。事实判断部分：LDVH 规范大量使用「不得」「禁止」「不可」式表述，其中相当一部分是**真正的强制边界**（如受控入口拒绝、Stop Conditions），按该项目的判据属「无法正面表述的硬护栏」，保留正确；但另一部分可能是**可用正面表述替代的行为导向**，按此理论其效果可能被削弱。可吸收点是引入「正面陈述优先、禁止式需说明为何无法正面表述」这一**书写检查项**，而非改写既有规范。同时 no-op 扫描与沉积两个概念对应 LDVH 规范源的真实风险：规范只增不减。此为高风险建议（见建议八）。

溯源：https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md（skills/productivity/writing-for-agents/SKILL.md:74-80）

### F13 CONTEXT.md 被硬性限定为纯术语表，以正名加一句话定义加禁用同义词的形式，并另设「已裁决歧义」段同时防止同义漂移与重复争论

观察事实：`domain-modeling` 用绝对句划界：「`CONTEXT.md` 应当完全没有实现细节。不要把它当成规格、草稿本或实现决定的仓库。它是术语表，且什么都不是」。写入时机为「解析即写、不批量」，创建方式为懒创建且**不得**预先建议创建（缺文件时「静默继续，不要标记其缺失、不要建议提前创建」）。格式为每条术语给出正名、一两句定义与 `_Avoid_:` 禁用同义词列表。仓库自用实例另有一段「已裁决歧义」，登记的是**曾经混用、现已裁定**的历史，每条带 `Resolved:` 结论（例：「backlog 曾经同时指承载议题的工具与其中的工作体；裁定：工具是**Issue tracker**，backlog 不再作为领域术语使用」）。

对 LDVH 的价值判断：两点增量。第一，`_Avoid_` 反义清单是一种**低成本防漂移**手段：它不仅定义「正名是什么」，还显式登记「不要用什么词」，使同义漂移可被检查——LDVH 的 01.Att.01 双语术语表登记了正名、缩写、机器表示与唯一定义来源，但没有「避免表达」列。第二，「已裁决歧义」段承载的是**裁定过程的历史**，防止同一个混用被反复重新争论；LDVH 目前的对应物分散在 ADR（决策）与 22 号的 retired 机制中，没有「术语层面的已裁决歧义」这一专门位置。两点均属低风险增补（见建议九）。注意：该段未出现在其自身发布的模板中（见未证实第 1 条），吸收时应视为实例经验而非已成文规范。

溯源：https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md（skills/engineering/domain-modeling/SKILL.md:40,60-64）

### F14 ADR 设三条必须同时成立的准入条件，模板被刻意压到最小，并把硬依赖与软依赖的二分落成按依赖强度决定是否写配置指针的写作规则

观察事实：ADR 的准入是三条**必须同时成立**的条件：难逆（日后改变主意的代价是有意义的）、无背景会困惑（未来的读者会问「他们当初为什么这么做」）、真实取舍（确实有备选，且为特定理由选了其一）；「三条缺任何一条就跳过这份 ADR」。模板被压到最小：「一到三句话：背景是什么、我们决定了什么、为什么。就这样。一份 ADR 可以就是一个段落」，并明确「价值在于记录**作出过**一个决定以及**为什么**，而不在于填满章节」。本仓库自身的 ADR 另展示了另一种用法：ADR-0001 全文 10 行，把「**硬依赖**技能（`to-tickets`/`to-spec`/`triage`）必须在正文写 setup 指针」与「**软依赖**技能（`diagnose`/`tdd`/`improve-codebase-architecture`）只用模糊散文引用」这一二分，落成一条按依赖强度决定是否写指针的写作规则，理由是「让软依赖技能保持 token 轻，并避免把 setup 指针 cargo-cult 到它不承重的地方」。

对 LDVH 的价值判断：LDVH 22 号 ADR 的准入判据是「可独立召回、可独立检查遵从性、可独立违背、可独立终态」——这是**效力落地**角度的判据；该项目的三条是**记录价值**角度的判据。两者互不替代、可以并存：LDVH 的判据回答「这条决定能不能被贯彻」，该项目的判据回答「这个决定值不值得记」。LDVH 当前只有前者，因此「决定虽可以贯彻但记下来没意义」这一情形无判据可拦。另 ADR-0001 的硬/软依赖二分是一种把「配置依赖强度」显式化的写法，对 LDVH 规范交叉引用（01 §10.1 负载型/路由型引用二分）有对照价值——两者都在解决「引用要不要承重」的同一问题，且 LDVH 的二分更细。可吸收为 ADR 准入的**补充**判据（见建议十），不得覆盖既有四条。

溯源：https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md（skills/engineering/domain-modeling/SKILL.md:66-74）

### F15 该项目把「机械违规应转为确定性检查、判断类问题才留给标准文档」写成明确规则，并把「仓库无任何护栏」本身定为独立发现项

观察事实：`retro` 技能把编码标准违规先分类：**机械违规**（固定句法模式、被禁 API、import 形状、文件位置规则）「得到一个确定性检查，没有商量余地」，并给出默认取向「**默认建检查，而非写规则**」；`CODING_STANDARDS.md` 只留给真正的**判断类问题**（跨文件一致性、「与周围风格一致」这类任何护栏都无法替代的判断）。同一文件另把「仓库没有任何护栏」（没有 pre-commit 钩子、也没有跑 lint/typecheck/test 的 CI 任务）本身定为一项独立发现，理由是「一个未被 lint 的仓库是一个持续存在的错失机会，而不是一个中性的默认值」。

对 LDVH 的价值判断：这与 LDVH 02 §15「机械校验仅在存在规范已定义的确定性内容时适用，不替代主控判断」同向，但方向更进取：LDVH 的表述是「有确定性内容时才建机械校验」，该项目的是「**凡机械可判定者默认建检查**」。后者对 LDVH 的增量在于**默认取向**——把「写进规范」从首选降为退路，可减少“规则写了但没人守”的形态。此判断有独立的本地印证：该项目自己的文档纪律正因无机械承载而漂移（见 F16）。另「无护栏本身是发现项」这一条对 LDVH 26 号 Friction 有直接价值：它给出了一个可自动识别的摩擦入账信号，而非等待人工察觉。

溯源：https://github.com/mattpocock/skills/blob/main/skills/in-progress/retro/SKILL.md（skills/in-progress/retro/SKILL.md:18-19）

### F16 该项目自身几乎不设机械校验，唯一可执行的文档纪律检查未接入 CI、CI 无合并前触发，且一条机械替换清扫曾破坏六个技能的元数据而未被拦截

观察事实：`package.json` 只定义三个脚本（`changeset`、`version`、`check-plugin-version`），不存在 `lint`/`test`/`typecheck`。其中 `check-plugin-version`（比较 `package.json` 与 `plugin.json` 版本）是唯一可执行的文档纪律检查，主控实测它当前通过；但它**未接入 CI**——全仓检索该命令在 `.github/` 下零命中。CI 只有 `.github/workflows/release.yml` 一个工作流，只在 push 到 main 时触发，主控实测其触发条件中 `pull_request` 出现 0 次，即所有校验都发生在合并之后，没有合并前门禁。仓库无 `.husky`、无任何 linter/formatter 配置。两处自证：其一，`CLAUDE.md` 明令禁止 em-dash，但主控实测 `CHANGELOG.md` 仍含 104 处（分布 68 行），该禁令无任何脚本或 CI 强制（见未证实第 4 条）；其二，一条全仓 em-dash 清扫因为「机械替换」把未加引号的 `description` 变成非法 YAML，changeset 自述「导致 skills.sh 在发现阶段跳过全部六个，它们无法被列出或经由 `npx skills` 安装」——而这一破损**未被任何机械门禁拦截**，靠人工发现后补修。

对 LDVH 的价值判断：这是本次调研中支持 LDVH 现有路线的**最强负面证据**，价值在于它是「同类项目在同问题域上的失败样本」，而非我们需要吸收的做法。三点可直接对照：（一）「规则写了但没有机械承载」必然漂移——该项目的一处禁令已实际漂移 104 处，印证 LDVH 00 §7.1「凡声称机械规则已被保障、而其实现与来源规范不一致或不存在，即构成超出依据支持的声明」；（二）**校验时机**至关重要——其校验全在合并之后，LDVH 的 Git Gate 位于提交前，是更早的拦截点；（三）**机械替换本身会制造回归**——其 em-dash 清扫的自我告诫原句「永远不要做无脑字符替换」正来自这次事故，而 LDVH 已在 Pitfall `首行比较式校验漏掉多余H1`（96fb3199）与 `校验假定形式与语义一一对应`（a774d7de）中记录过同族经验，本发现为这两条经验提供了**跨项目的外部印证**。

溯源：https://github.com/mattpocock/skills/blob/main/package.json（package.json:11-15）

### F17 其 git 守卫是黑名单子串匹配而非命令结构解析，双向边界均已实测，既能漏拦结构变体也会误拦命令文本提及

观察事实：其 `block-dangerous-git.sh` 定义 9 条危险模式（`git push`、`git reset --hard`、`git clean -fd`、`git clean -f`、`git branch -D`、`git checkout .`、`git restore .`、`push --force`、`reset --hard`），逐个以 `grep -qE` 对完整命令串做匹配，命中则向 stderr 打印 BLOCKED 并 `exit 2`；被拦时「Claude 会看到一条消息，告诉它无权访问这些命令」。主控独立复现（只读，测试后工作区仍干净，`git status --porcelain` 为空）：应拦三类全部 `exit 2`；应放行两类全部 `exit 0`；**漏拦**——`git -C /tmp/x push` 得 `exit 0`、`git  push`（双空格）得 `exit 0`；**误拦**——`git commit -m "git push later"` 得 `exit 2`、`echo "git reset --hard"` 得 `exit 2`、`grep -r "git push" docs/` 得 `exit 2`。即它既不解析 argv 结构，也不区分「真执行」与「文本提及」。该技能是**可安装模板**而非本仓库自身启用的保障：本仓库无 pre-commit 配置、`.git/hooks` 下只有 `.sample`。

对 LDVH 的价值判断：这是 LDVH Git Gate 的**直接对照物**，价值在边界证据而非机制。两者取向相反：该项目用「命令串黑名单」——实施简单，但天然双向失准（漏拦结构变体＋误拦文本提及）；LDVH 的 Git Gate 用「受控提交的路径覆盖与机械预检」（LDVH 已有 Pitfall `Git Gate 双向路径覆盖拦截` 86d23c1a）。本发现的意义是把两者并置：**黑名单子串匹配作为拦截手段不可靠**，其漏拦面（`-C` 变体）恰是真实可绕过路径，误拦面（命令内文本提及）则会在不涉及危险动作时打断正常工作。因此该模型**不吸收**；但「被拦时向发起方明确告知无权」这一**反馈形态**可保留参考。另需注意其守卫给的是 `exit 2`（宿主拦截约定码），属可被机械消费的返回，与 LDVH 的 fail-closed 取向可对照。

溯源：https://github.com/mattpocock/skills/blob/main/skills/misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh（skills/misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh:6-23）

### F18 其约束失效时表现为 fail-open 而非 fail-closed，并发共享工作区与执行闭环缺口均已有自证记录

观察事实：三处自证。其一，工单号解析：`/implement #2` 在全新会话中「是针对 agent 能看到的任何编号列表解析的，可能是一个 todo 文件、一份清单或另一个工作列表，而不是配置好的追踪器」，并明确「该解析是**自信的而不是 fail-closed 的**，所以在它已经开始之前错误并不明显」，补救措施是人工传完整引用并要求先复述标题。其二，并发：现场报告描述了「一个会话里的 `git commit --amend` 落到另一个会话的提交上、一个 stash 从 `refs/stash` 消失、以及提交落到错误分支」，根因是「这些会话共享一个工作目录、一个索引和一个 HEAD」，结论是「今天想要并行，你是在自己组装」。其三，闭环缺口：`implement`「**没有完成步骤**。它终止于提交，从不触碰工作项」，不回写工单、不执行 code-review 的发现、不勾选验收项，需人工收口；并指出这在依赖链上最致命，因为前沿的定义正是「阻塞者全部关闭的票」——「如果什么都不被关闭，就永远不会有任何东西变得可见地解除阻塞」。

对 LDVH 的价值判断：这三处自证共同指向 LDVH 00 §7.2 的核心取向——**fail-closed**。其价值有三：（一）「解析是自信的而不是 fail-closed 的」是对 AI 概率性输出的精准描述，且它发生在一个具体可复核的场景（编号解析），可作为 LDVH「AI 自述不得作为依据」的外部案例；（二）并发共享工作区导致提交落错分支，印证 LDVH 对受控提交与写入原子性的要求，且它给出的补救（worktrees）自承不完整（stash 跨 worktree 共享），说明此类问题不能靠局部补丁解决；（三）「没有完成步骤导致前沿永不推进」是一个**闭环断裂**的完整案例：单看每个环节都成立（提交成功、技能执行完毕），但整体因缺一个收口动作而停摆。这对 LDVH 21 号 WorkCase 的关闭关口与 26 号 Friction 的入账都有直接参照价值。

溯源：https://github.com/mattpocock/skills/blob/main/docs/engineering/implement.md（docs/engineering/implement.md:53-75）

### F19 该项目用 .out-of-scope 知识库按概念而非按工单持久留存被拒请求的论证，以达成制度记忆与去重

观察事实：该机制规定「仓库中的 `.out-of-scope/` 目录存放被拒功能请求的持久记录」，并给出两个目的：**制度记忆**——「为什么一个功能被拒绝，使推理在议题关闭时不会丢失」；**去重**——「当一个匹配先前拒绝的新议题进来时，技能可以呈现先前的决定，而不是重新争论它」。组织方式有明确纪律：「每个**概念**一个文件，而不是每个议题一个文件。多个请求同一件事的议题归入一个文件之下」，并另设「先前请求」段登记历史议题号（实例中可见「#44」「#106」与对应请求标题）。文件风格被要求「以放松、可读的风格书写，更像一份简短的设计文档而不是一条数据库条目」。实例两篇均以「本项目**不会**做 X」开头，随后是「为什么这超出范围」的多段论证。

对 LDVH 的价值判断：这是对 LDVH 的一个**真实缺口候选**。LDVH 有 ADR 的 retired（带 `retirement_reason` 闭集）、20 号 Spark 的 discarded（带 `disposition`，≤200 字符）、26 号 Friction，但三者的处置理由都是**摘要级**：22 号明确「正文`建议`段最后一条必须显式回答本对象在何种条件下仍可被回查」，而 Spark 的 `disposition` 上限 200 字符且明确「终态原因说明是给后续读者与人扫读的定位信息，不是完整处置记录」。LDVH 当前**没有**为「已明确拒绝的方向」提供承载完整论证的位置，因此「为什么当初不做这件事」在 LDVH 中只有摘要可查。该项目的机制提供了一种候选形态（按概念聚合、含完整推理、登记历史请求引用）。此建议涉及可能的对象边界变化，须 Human 裁决（见建议十一）。

溯源：https://github.com/mattpocock/skills/blob/main/skills/engineering/triage/OUT-OF-SCOPE.md（skills/engineering/triage/OUT-OF-SCOPE.md:3-17）

### F20 handoff 载体的设计原则是指针而非复制并强制脱敏，且刻意不落入工作区

观察事实：`/handoff` 要求「写一份交接文档，总结当前对话，使一个全新的 agent 能继续工作」，并给出四条硬约束：**存放位置**——「保存到用户操作系统的临时目录，**不是**当前工作区」；**内容形态**——「不要重复其他工件（specs、plans、ADRs、issues、commits、diffs）已经记录的内容，改为按路径或 URL 引用它们」；**必备段**——含「建议技能」段，点名下一个 agent 应当调用哪些技能；**脱敏**——「涂掉任何敏感信息，例如 API 密钥、密码或可识别个人的信息」。另有一个同源变体把这个载体交给后台 agent 而非存盘，差异仅在最后一步。

对 LDVH 的价值判断：两点与 LDVH 同向且可互补。第一，「**指针而非复制**」与 LDVH 03 §6.1「唯一当前权威载体」、以及本项目 Research/WorkCase 的「不复制相邻来源」纪律完全一致——它的增量在于把这条纪律写成了交接载体的**具体写作要求**（禁止重复，改为引用）。第二，「**刻意不落入工作区**」这一位置约束值得注意：LDVH 的交还产物与 Output Envelope 是会话内产物，而交接文件若落入工作区就会成为未受控的第二事实源——该项目用「写到 OS 临时目录」这一位置选择规避了该风险。第三，「必须带建议技能段」是一个把「下一步入口」显式化的低成本手段，与 LDVH 00 §7.4 交还必须包含「继续入口」同向。另需注意其局限：该技能目录下**没有**交接文档模板，结构只由提示词正文约束（见未证实第 6 条），即它是一份写作指南而非可机械校验的格式。

溯源：https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md（skills/productivity/handoff/SKILL.md:8-14）

## 未证实与缺口

**未证实（uncertain）**：

1. **`Flagged ambiguities` 段的规范地位无法判定**。它出现在该仓库自用 `CONTEXT.md`，但**未出现在**其自身发布的 `CONTEXT-FORMAT.md` 模板与规则段中，全仓仅此一处出现。因此无法判定它是「已被采纳但模板未同步的通用实践」还是「本仓库一次性自用扩展」。吸收建议九时应视为实例经验，不得声称其为该项目成文规范。
2. **两个上下文预算数字互不一致且均无依据来源**。「smart zone 约 150k tokens」与「wayfinder 工单尺寸约 100K tokens」分处两个文件，仓库内无引用来源、测量方法或适用模型说明，且两数彼此不一致。本调研不据此作出任何预算判断。
3. **`check-plugin-version` 未接线是历史遗留还是有意设计**。唯一把它接入 CI 的提交不在 main 上（属另一分支），更早历史未穷举，因此只能陈述「在当前 HEAD 上未接线」，不能陈述其成因。
4. **`CHANGELOG.md` 是否被有意豁免 em-dash 禁令**。禁令清单含该文件，而提出禁令的 changeset 范围清单不含，现状为未执行；仓库内无任何明文说明该豁免。属推测范围，不予断言。
5. **git 守卫黑名单的完整绕过面未穷举**。仅实测 6 个样本（含 `-C` 变体与多空格变体），引号、变量拼接、别名、`\` 转义等形态未验证，因此只能陈述「已实测的漏拦面」，不能陈述「绕过面仅限于此」。

**缺口（gaps）**：

1. **该项目多个核心机制的实装状态未逐一验证**（优先级 medium）。`retro` 在桶 README 中被标为「STUB：仅为设计笔记，尚不可用」，`pr`、`implement-spec`、`loop-me`、`claude-handoff` 等 in-progress 技能均未进入 promoted 集。因此本调研引用的部分机制（尤其 F15 的 retro 规则、F19 的 out-of-scope 之外的 in-progress 内容）属「已写成但未必已实装」，未逐版本跟踪验证。**该缺口阻塞**：建议八（正面陈述优先）与建议十（ADR 补充判据）的落地力度评估——若其上游机制本身仍是草案，则其经验的实证强度低于已 promoted 机制。
2. **未取得该项目的社区使用反馈与独立评价**（优先级 medium）。本次取证仅基于仓库自身文本（含其自述的失效案例），未采集第三方使用反馈、议题讨论或独立评测。因此「这些机制在真实项目中长期有效」无外部证据支撑，本调研对机制效用的判断均限于「设计合理性」而非「实证有效性」。**该缺口阻塞**：任何以「该项目已验证有效」为前提的取舍判断。
3. **未获取该仓库的实时量化指标**（优先级 low）。未通过 API 抓取 star 数、安装量、议题净流入等实时指标（本会话环境对其 HTTP 访问受限），因此本调研不包含任何流行度声明，也不以流行度作为吸收理由。
4. **未验证其 harness 清单校验命令的实际通过状态**（优先级 low）。其 `CLAUDE.md` 要求触碰清单后运行的外部校验命令未实际执行（需外部 CLI），仅读到其 ADR 声称通过；该命令当前是否通过属未覆盖范围。

## 建议

以下建议均为调研结论，**不是决定**；采纳与否由 Human 与该项目的讨论/决定通道裁决。每条建议给出目标对象类型、预期目标、验收条件与创建/更新判断。

**建议一：吸收「机械违规默认转确定性检查」的处置取向，落到 02 §15 复核与校验制度的实施取向，或作为一条事实规范（Norm）候选。**
目标对象类型：事实规范候选（27 号 Norm）或 02 号规范的修订提案。
预期目标：为「同一类错误被独立复核反复发现」的情形给出一条默认处置——先问「这条能不能由确定性检查拦住」，能则建检查；只有判断类问题才留在规范文本或复核清单里。
验收条件：出现一个真实案例时，能对照该默认取向作出「建检查」而非「补写规则」的选择，且该选择在后续复核中不再复发同一错误。
创建判断：若 LDVH 已有 ≥2 例「规则已写但同类错误复现」的记录，则该缺口成立，值得建立；若尚无此类记录，则先作为 Spark 悬置，等待触发。

**建议二：吸收「指针措辞决定召回可靠性」与「两种负载」作为规范与引导文本的书写要求，落到 01 §10.4 最小规则引导与规范交叉引用的书写纪律。**
目标对象类型：01 号规范的修订提案（涉及受保护内容须走 00 §4.3 程序）。
预期目标：规范源中「指向他处的引用」具备可检查的措辞要求，使被引用材料的召回不再依赖读者自行判断；常驻上下文负载被显式记账。
验收条件：抽查若干条既有交叉引用，能据此判出「措辞是否足以触发召回」，且弱措辞可被识别为缺陷而非风格差异。
创建判断：该建议触及受保护内容，须先取得 Human 对「是否开展此项修订」的决定。

**建议三：吸收「前沿」概念作为 31 号讨论系统轮次内的取材判据。**
目标对象类型：31 号规范的修订提案。
预期目标：31 号当前的「扩散 → 收敛」在每轮内的提问取材上获得一个机械可算的子集（只依赖问题依赖关系、不依赖回答内容），减少主控临时判断带来的方差。
验收条件：同一讨论问题在两次独立执行中，同一轮提出的问题集合大体一致（差异可由依赖关系解释），而非由主控即兴决定。
创建判断：属机制增补且不改变讨论系统的职责边界，风险较低；建议以 Spark 记录 → 讨论 → 规范修订的常规路径推进。

**建议四：就「迷雾」所揭示的第三态是否需要在 LDVH 中增设承载，提请 Human 裁决。**
目标对象类型：Human 决定（可能涉及 20 号 Spark 的对象边界或新类型候选）。
预期目标：明确「连问题本身都还说不清」的方向性内容在 LDVH 中的承载方式。当前 20 号 Spark 的 `question` 字段要求「单句可读」，与该状态存在张力。
验收条件：Human 对下列选项作出作用范围清楚的选择——（甲）维持现状，要求 Spark 在入档前先把问题说清（代价：此类内容无处安放）；（乙）放宽 Spark 的 `question` 要求并承认其存在「问题未成形」子态；（丙）新设承载类型（属 00 §3.1 业务系统/类型变化，须走根决定程序）。
创建判断：**必须提请 Human**，不得由调研结论直接改写类型规范。该问题与既有 Spark `71930c4a`（LDVH 体系结构性未完善）可能相关，提请前应核对。

**建议五：就「决策票」是否需要在 21 号 WorkCase 之外独立承载，提请 Human 裁决。**
目标对象类型：Human 决定（可能涉及 21/20 号规范的边界调整）。
预期目标：明确「为看清方向而必须先解决的决定」在 LDVH 中是否需要一个可独立领取、可独立阻塞、可独立关闭的单位，还是可由 Spark + WorkCase 组合承接。
验收条件：给出一份「方向性决定」的真实样例，能据此判出它在 LDVH 现有类型下如何落档；若无法落档，则缺口成立。
创建判断：**必须提请 Human**；同时应先核对既有 Spark `e1a27426`（工单执行线八阶段推进总纲）与 `27a9dbfc`（WorkCase 承载层与 attempt 接缝）是否已覆盖该地带，避免重复建对象。

**建议六：吸收「一手源转二手源」代价模型与「阶段中途不做上下文决定」的时机纪律，作为交还与交接口的判断素材。**
目标对象类型：02 号或 00 §7.4 交还结构的判据素材（不新增机制）。
预期目标：为「此处该继续、该交接、还是该另起会话」提供一把统一的尺子，使选择可被解释而非凭感觉。
验收条件：一次真实的交接决策能被回溯说明「为什么不用继续、为什么不用别的选项」，且理由落在该代价模型上。
创建判断：属判据补充而非机制新增；若认为无需对象化，可先在会话内使用并观察是否真的被用到（HV4 效用先行）。

**建议七：吸收「完成判据的清晰度与要求量二分」及「过早完成」失败模式，落到 21 号 WorkCase `done_criteria` 的书写纪律。**
目标对象类型：21 号规范的修订提案（或既有书写指南的更细说明）。
预期目标：`done_criteria` 的书写从「可被证据判定」单条要求，扩展为可操作的检查项，并明确「判据模糊会导致提前收口」这一失败机制。
验收条件：抽查既有 WorkCase 的 `done_criteria`，能据此识别出「清晰但要求量不足」与「要求量足但不可判定」两类缺陷。
创建判断：属字段书写要求而非状态机改动，风险较低；建议以 Spark 记录 → 讨论 → 规范修订推进。

**建议八：就「正面陈述优先」这一书写检查项是否引入，提请 Human 裁决；不建议立即改写既有规范。**
目标对象类型：Human 决定（涉及 00/01 号受保护内容与全部既有规范的书写习惯）。
预期目标：明确 LDVH 是否引入「行为导向优先正面陈述、禁止式表述需说明为何无法正面表述」这一检查项。
验收条件：Human 对「引入 / 不引入 / 先试点再定」作出范围清楚的选择；如引入，须同时明确其**不追溯**既有规范。
创建判断：**必须提请 Human**。理由：该主张来自提示词工程语境，其结论能否迁移到「以规范源为权威、由机械校验落实」的 LDVH 语境尚未验证；且 LDVH 的禁止式表述中相当一部分属真正的强制边界，改写风险高。建议先以单一规范为试点观察效果，不全面推行。

**建议九：吸收「_Avoid_ 禁用同义词列」与「已裁决歧义」两处低风险增补，落到 01.Att.01 双语术语表的字段扩展。**
目标对象类型：01.Att.01 附件更新提案（授权附件，须由其父规范授权范围内进行）。
预期目标：术语表不仅登记正名，还显式登记「避免表达」，使同义漂移可被检查；并新增「已裁决歧义」位置承载裁定历史。
验收条件：更新后能回答「某个曾混用的词现在该用哪个」与「当初为什么这么裁定」，且不需要翻阅会话记录。
创建判断：属附件内容扩充且不建立新规则，风险低；但须确认 01.Att.01 的授权范围是否允许承载「避免表达」这类内容（其定位为「登记术语，不取得定义职责」）。

**建议十：把「记录价值」三条判据作为 22 号 ADR 准入的补充候选，提请讨论。**
目标对象类型：22 号规范的修订提案。
预期目标：在 LDVH 既有的「可独立贯彻/检查遵从性/可独立违背/可独立终态」之外，补充「难逆、无背景会困惑、真实取舍」这组「是否值得记」的判据，拦住「可贯彻但记录无意义」的决定。
验收条件：能据此拒绝一份满足既有四条判据、但不满足记录价值判据的 ADR 提案，且理由可回指。
创建判断：需先核对 22 号是否已隐含此类判据（本次未逐条穷举其 §6.3 全部排除项），确认无重复后再提请。

**建议十一：就「已明确拒绝的方向是否需要承载完整论证」提请 Human 裁决。**
目标对象类型：Human 决定（可能涉及新承载位置或既有类型字段扩展）。
预期目标：解决「为什么当初不做这件事」在 LDVH 中只有摘要（Spark `disposition` ≤200 字符）可查的问题。
验收条件：给出一份「曾被明确拒绝、后来又有人重新提议」的真实样例，能据此判出现有摘要是否足以阻止重复争论；若不是，则缺口成立。
创建判断：**必须提请 Human**，因为新增承载位置可能触及事实类型闭集。属本次调研识别出的最值得优先处理缺口之一（与 F19 对应）。

**建议十二：明确不吸收的两项，记入后续分流以免重复评估。**
（一）**不吸收其 git 守卫的黑名单子串模型**（F17）——已实测其双向失准（漏拦 `-C` 变体、误拦命令内文本提及），LDVH 的路径覆盖式 Git Gate 是更可靠的形态，无需改动。
（二）**不吸收其上下文压缩与 token 预算管理**（F9 的一部分）——LDVH 35 号 §3.2 已明确将上下文压缩、上下文预算与 token 管理划归宿主机制，属已定边界，不因本次调研而改变。
创建判断：两项均建议以「已评估、不吸收」结论记录在后续分流中，无需建对象；若未来出现新证据（如其守卫改用结构解析、或 LDVH 宿主机制变化使压缩策略需要业务层判断），则重新评估。

## 后续分流

1. **建议一（机械违规转检查）**：先核对 LDVH 是否已有「规则已写但同类错误复现」的记录（可查 Friction 与 Pitfall 的 `contributed-to` 关联）。信号：出现第 2 例同类复现且既有规则未拦住 → 创建 Spark → 讨论 → 27 号 Norm 候选。若长期无此类记录，可继续不对象化。
2. **建议二（指针措辞与两种负载）**：触及受保护内容，**先提请 Human 决定是否开展修订**。信号：Human 明确同意 → 按 01 号修订程序（独立对抗审核 + Human 决定）推进；Human 不同意 → 记录为「已评估、暂不修订」，不重复提请。
3. **建议三（前沿）**：创建 Spark 记录该候选，服务 SG-1。信号：Spark 被讨论收敛出明确方案 → 31 号规范修订。若讨论中发现 LDVH 的「格式驱动收敛判据」已足以覆盖，则关闭 Spark 为 `discarded` 并写明理由。
4. **建议四（迷雾第三态）**：**立即提请 Human**（属对象边界问题）。提请前先读既有 Spark `71930c4a` 全文，确认不重复。信号：Human 选择甲/乙/丙任一项 → 按选择进入相应路径（乙/丙涉及规范修订或根决定程序）。
5. **建议五（决策票）**：**提请 Human**。提请前先读 Spark `e1a27426` 与 `27a9dbfc` 全文核对覆盖情况。信号：确认未被覆盖 → 缺口成立，按 Human 选择推进；已覆盖 → 记入既有 Spark 的 `refs`，不新建。
6. **建议六（一手源转二手源代价模型）**：不建对象，**先在 LDVH 实际会话中试用**该判断尺子。信号：累计 ≥3 次交接决策实际引用了该模型且被证明有用（HV4 效用可对应）→ 创建 Spark 提议写入 02 或 00 §7.4；若从未被实际引用 → 不对象化。
7. **建议七（完成判据二分）**：创建 Spark，服务 SG-1。信号：Spark 收敛 → 21 号规范修订。可与建议一合并讨论（二者同属「规则书写质量」主题），避免碎片化。
8. **建议八（正面陈述优先）**：**提请 Human**，并同时提出「先单一规范试点」这一降级选项。信号：Human 选择试点 → 选定一条规范试行并在复盘中观察；Human 选择不引入 → 记录结论与理由，不重复提请。**注意**：本建议与既有 Pitfall 中的书写经验可能冲突，提请时应一并列出。
9. **建议九（术语表增补）**：核对 01.Att.01 授权范围后，创建 Spark 或直接进入附件更新提案。信号：确认授权范围允许 → 走附件更新；不允许 → 记录为「需先修订父规范授权范围」。
10. **建议十（ADR 记录价值判据）**：先做一次 22 号 §6.3 的完整核对（确认无重复），再创建 Spark。信号：确认无重复 → Spark → 22 号修订；已隐含 → 不对象化，在本次调研对象 `refs` 中标注。
11. **建议十一（拒绝论证承载）**：**提请 Human**，列为优先项。信号：Human 认可缺口 → 讨论承载形态（新位置 vs 既有类型字段扩展）；Human 不认可 → 记录结论。
12. **建议十二（两项不吸收）**：不需要对象化。作为本次调研对象的结论保留；若未来出现新证据（其守卫改结构解析、或 LDVH 宿主压缩机制变化），重新评估并在新调研中处置。
13. **本调研对象自身**：在建议一至十二全部取得去向（对象化、不对象化或已提请）之前保持 `active`；全部处置完成后，若结论已被下游完全承接，按 24 §9 转为 `retired`（`retirement_reason=superseded` 或 `out-of-scope`），并在正文建议段最后一条显式说明本对象在何种条件下仍可被回查。
