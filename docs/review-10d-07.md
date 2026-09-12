# 独立对抗审核报告：specs/07-工作对象与管辖范围规范（十维全量）

- **审核对象（唯一）**：`specs/07-工作对象与管辖范围规范.md`（236 行，spec_id `07`，spec_key `work-object-governance-scope`）
- **审核依据**：`01 §12`（独立对抗审核）、`01 §12.3`（十维清单）；00 §3.3/§3.4/§4/§7、01 §6.3/§7/§9.2/§12、02 §8/§13/§15、05 §3.3/§6.1、06 §6.5、08 §5.6/§6、10 §6.5/§7/§8 定向核对
- **机械核验**：`parseSpecDocument(内容, 'specs/07-…md')` → `ok:true`（身份块可解析、H1 一致、canonical_path 一致）；治理相关测试 `node --test test/governed-projects.test.mjs test/governance-scope.test.mjs test/lifecycle.test.mjs test/ldvh-tools.test.mjs test/spec-registry.test.mjs test/web-routes.test.mjs test/client-contract.test.mjs test/web-mount.test.mjs` → **197 passed / 0 failed**；另 5 个事实工具测试文件（adr/friction/pitfall/research/spark）在本机因外部依赖路径缺失（`@deepseek-ai/dsh-tools` 解析到 `app.asar.unpacked` 不存在路径）全部导入失败——环境问题，与 07 无关
- **实现核验对象**：`plugin/lib/governed-projects.js`（332 行）、`plugin/lib/governance-scope.js`（79 行）、`plugin/lib/git-gate-runner.js`、`plugin/lib/host-api.js`、`plugin/lib/index.js`、`plugin/lib/ldvh-tools.js`
- **Git 基线**：dev 分支，工作区干净；07 的提交历史 20 笔，近期两笔实质相关：`7ba7918`（§5.1/§5.4 原子写入归属更正）、`0a0f843`（§2 补精确章节）
- **独立性披露**：见 §8

---

## 1. 文件路径

- 主对象：`specs/07-工作对象与管辖范围规范.md`
- 交叉核对：`specs/00-理念与构成.md`、`specs/01-规范模型基础规范.md`、`specs/02-工作模型基础规范.md`、`specs/05-LDVH CLI规范.md`、`specs/06-事实源与信息溯源规范.md`、`specs/08-DSH环境接入与插件发布规范.md`、`specs/10-Web呈现与交互规范.md`
- 实现：`plugin/lib/governed-projects.js`、`plugin/lib/governance-scope.js`、`plugin/lib/git-gate-runner.js`、`plugin/lib/host-api.js`、`plugin/lib/index.js`、`plugin/lib/ldvh-tools.js`、`plugin/test/governed-projects.test.mjs`（29 测试）、`plugin/test/governance-scope.test.mjs`
- 既有审核：`docs/review-08-vs-audited-set.md`（Q1/F2 涉 07）、`docs/review-08.md`、`docs/audit/implementation-status-registry.md`

---

## 2. 十维逐维结论

一句话总评：**规范本身结构与上位对齐良好、防自欺扎实，但「规范宣称的语义」与「实现实际做到的」之间有五处实质落差（消费方、AI 入口、错误码、空载体三态、linked worktree），其中一处委派落空。**

### D1 价值判据对齐 — 符合
§1 四段结构逐项匹配 `01 §7.1` 第 1 项（目标净价值段 / V-HV 映射连续段 / 相邻承接段 / 不能单独证明段）。V/HV 引用带 00 §6 名称原文：V1 快速定位、V3 边界识别、V6 工作接续、HV2 授权执行受控可续（07:27 ↔ 00:222-237 逐字核对一致）。未使用全区间声明。映射与 07 实际职责（登记定位→V1、fail-closed→V3、可回读登记→V6、机械门禁→HV2）对应成立。

### D2 职责边界与单一权威 — 符合（一处张力见 P3-8）
§3.1 四项与 §5–§7 一一对应；§3.2 划界给 05/06/08–10；§3.3 声明六份相邻规范权威且「不另建第二登记权威」。反向核对：08 §5.6（08:119）「07 是登记位置、Schema、路径、权限目标、三态判定、写入与迁移规则的唯一权威」、05 §3.3（05:69）「07 是管辖判定的唯一权威」、06 §6.5（06:168）「管辖状态检查按 07 §7」、10 §7「沿用 07 §7 消费方表」——四个方向一致，无第二权威。唯一张力：§5.1 写入了设置界面的交互约束（见 D3/P3-8），与自身 scope「不定义 Web 交互细节」（07:11）有轻微越界。

### D3 反过度设计 — 判定：不过度（本对象重点，结论与「重点提示」的怀疑方向相反）
- **§5 约 70 行、7 个子节是否过重**：逐节核对消费方——§5.1 方向→`index.js` 的 dshHomePath 解析；§5.2 Schema→`validateDocument`（governed-projects.js:45-82）逐字段对应；§5.3 判定→`governance-scope.js` 三态；§5.4/§5.7 入口→`host-api.js` Web 端点；§5.6 写入→`withFileLock`+`writeFileAtomic`（governed-projects.js:7,235-259）。**每个子节都有规范消费方与实现锚点，无空转章节**。管辖登记本来就是 07 的唯一主题，70 行承载 7 个可执行契约不算膨胀。
- **§5.6 细化到权限位（0700/0600/ACL）是否应属 09**：不成立。08 §3.3 与 08 §5.6（08:119）两处明文把「权限目标」划归 07 唯一权威，08 §6（08:123）只核验宿主满足性。若把权限目标移去 09，反而制造 07/08/09 三方既定分工的漂移。权限位级别是这条权威链的既定设计，不是过度设计。
- **§4.3 是否必要**：必要。`01 §7.1` 第 4 项强制 `### 4.3 明确排除与证明边界` 为固定章节，且 07 存在「已登记被误当作生效/许可」的混淆风险，该节有实际内容（07:81-83）。
- 残留的过度嫌疑只有一处：§5.1「不提供路径输入、选择、复制或打开目录入口」（07:91）是纯交互层约束，归 10 更合适（P3-8）。

### D4 技术可实现性与能力真实性 — **部分不成立（本对象重点，5 项实证缺口）**
已实现且核实：
- 登记载体 `ldvh/governed-projects.yaml`：`grep -rn 'governed-projects' plugin/` 命中 30+ 处，`REGISTRATION_RELATIVE_PATH`（governed-projects.js:11）与 07 §5.1 逐字一致；
- 原子写入：`withFileLock`+`writeFileAtomic`（`@deepseek-ai/dsh-atomic-write`），临时文件+原子 replace+锁+fingerprint 守卫，29 个测试覆盖原子创建、fingerprint 冲突、幂等、回滚（governed-projects.test.mjs:131-365）；
- 权限目标：`mode: 0o600, dirMode: 0o700`（governed-projects.js:234,239,247,259,327）与 §5.6 的 0600/0700 一致；
- 三态判定：`governed/not_governed/unavailable` 与 `governance-scope.js` 逐字一致，损坏载体 fail-closed 有测试（governance-scope.test.mjs:26,67）；
- §6 工作对象：Git 根 + `ldvh-base/`（FACT_DIRECTORIES，governed-projects.js:17）+ `specs/`（ldvh-tools.js scanSpecCandidates）均有实现对应；
- 00 §3.4 五层分别判断：07 §5.4 条件启用（环境接入/当前可用分开）、§7:174「本表只定义语义接口，不证明任一消费方已经实现」——设计意图与实现存在明确分离 ✓。

不成立（详见 §3 问题清单 P2-2/P2-3/P2-4/P2-5/P3-6/P3-7）：
1. **§5.4 AI 入口无实现**：`ldvh-tools.js` 只有 5 个操作（resolve-governance-scope / read-specification-candidates / read-specification-content / discover-ldvh-capabilities / precheck-git-commit），**没有登记写入操作**；登记实际只能经 Web 安装事务（host-api.js:38 `/governed-projects/install`）。
2. **§5.4 五个细分错误码零命中**：`user_config_root_unavailable`、`registration_carrier_unavailable`、`registration_permission_unverified`、`registration_access_denied`、`registration_schema_invalid` 在 plugin/ 全域（含 web/，排除 node_modules）零命中；实现实际使用另一套码（`registration_unavailable`、`conflict`、`candidate_invalid`）。
3. **Git Gate 消费行无实现**：`git-gate-runner.js` 的 main() 只做 message/diff 校验，**不读登记载体、不做管辖状态检查**（文件内无 resolveGovernanceScope/readGovernedProject 任何引用）。
4. **§5.6 Windows ACL fail-closed 无实现**：lib 中无任何 ACL 核验代码。
5. **§5.6 v4 一次性迁移无实现**：`LDVH-GOVERNED-PROJECTS` 在 plugin/lib 零命中。

### D5 身份、编号、引用和格式 — 符合（一处引用对应弱、一处委派落空归 D7）
- 身份块：`parseSpecDocument` 返回 `ok:true`；spec_id 07、kind spec、canonical_path 与实际路径一致、`parent_spec`/`relation` 成对空串；01 §8.1 登记表有 07 行（01:186）。
- basis = `[ldvh-root, specification-model-foundation, work-model-foundation]` 与 §2 三项 1:1、顺序一致（01 §7.1 第 2 项 ✓）。
- 固定八章逐字：§1–§4（含 3.1/3.2/3.3、4.1/4.2/4.3）、领域正文 §5–§7、§8–§11 收尾，编号连续，§5.1–§5.7 连续；§8 验证表七列表头齐全（07:180）。
- **跨规范引用逐一核对，全部真实存在**：00 §3.3（00:130）、00 §3.4（00:138）、00 §4（00:156）、00 §4.2（00:164）、00 §4.3（00:170）、00 §7.2（00:257）、00 §7.3（00:265）；01 §7（01:127）、01 §9（01:244）、01 §10（01:317）、01 §12（01:390）；02 §13（02:152「## 13. 规则遵守（业务系统）」）、02 §8（02:117「## 8. 编排（能力承载）」）、02 §15（02:166「## 15. 复核与校验（制度）」）；08 §5.6（08:117「### 5.6 管辖登记接入」）、08 §6（08:121「## 6. 机械守护部署」，含「对 07 登记载体，08 只核验宿主满足 07 已定义的…原子写入、冲突拒绝与回读要求」——07:130/160 的归属表述与 08:123 精确互指）；内部引用 §5.5（07:135）存在。
- **0a0f843 补正核验**：§2 第 3 项所引 02 §13/§8/§15 章节号与标题全部真实且分类标注（业务系统/能力承载/制度）准确；但 02 §8 的**内容**（子代理委派、通信、成本控制）与「管辖判定作为执行前边界」的语义对应弱——§13（规则遵守：预检结论机械承载、应暂停处实际执行）与 §15（机械校验）对应成立，§8 对应勉强（P3-10）。
- 07 对 08 的三处引用（07:130/160/169）按 01 §10.1 二分属路由型（职责归属），08 不需入 basis——与 review-08 对反向边的分析一致，无环。

### D6 防自欺与不能单独证明的边界 — 符合（本维度是 07 的强项）
三态判定这一「重灾区」有明确的自证边界声明：§1:31「登记载体存在、判定成功、路径解析、文件写入或消费方放行，只能证明当次机械范围，不能单独证明项目应受管辖、行动适用、授权成立、工作完成或价值兑现」——直接覆盖「登记状态不能单独证明什么」；§4.3:83、§8 表「可证明范围」列逐行限定（不证明项目清单语义正确/管辖正当性/授权）、§8:188 末段、§9.2「Human 决定只证明决定及其作用范围」、§7:174「本表只定义语义接口，不证明任一消费方已经实现」。机械拒绝与停止层暂停互不替代（07:176 ↔ 00 §7.2）。无发现。

### D7 规范内部一致性与反例检验 — 有发现（5 个反例成立，见 §4）
重点攻击的「7ba7918 归属更正」：**更正本身站得住**——07 §5.6（07:140-144）确实完整定义了写入算法（读验证→版本守卫或锁→同目录临时文件→flush→原子 replace→回读；禁止 delete-then-write；冲突码；Windows 失败模式；权限目标），08 §6（08:123）确实明文「只核验…不复制其写入算法」，08 §5.6（08:119）确实声明 07 唯一权威——三方（07 定义/08 核验/09 实现）在文本上闭合，且实现侧（withFileLock+writeFileAtomic+09 域测试）真实存在。**漂移风险主要不在文本而在消费**：08 §6 的写守卫（`writeText replaceIfVersion`/`fs/write-intent` waterfall）在 plugin/lib 零挂载——登记写入走插件自备的 `@deepseek-ai/dsh-atomic-write`，不经过宿主写守卫通道（见反例 RE-5）。其余反例见 §4。

### D8 草案、修复、Human 决定和提交闭环 — 基本闭合（一处时序瑕疵）
- `git log --oneline -- specs/07-…md`：20 笔。近期实质相关两笔：
  - `7ba7918`（§5.1/§5.4 归属更正，2 行改动）：diff 与 commit message 的「关键变更」逐条对应 ✓；**无先行独立审核记录入档**（docs/ 全域 grep `7ba7918` 零命中）。按 01 §12.1 可归为非实质性引用更正（不改变规则本身，只对齐既定三方分工）；但其改动「权威归属表述」，处于实质/非实质边界。事后追认存在：`0a0f843` 同日入档的 `docs/review-08-vs-audited-set.md` D1 条目逐字引用并核验了更正后的 07:130 与 08 §5.6/§6 的一致性（P3-12，残留风险低）。
  - `0a0f843`（§2 补精确章节，1 行改动）：**有独立审核记录**——review-08-vs-audited-set.md F2 明文标记「已审 07 §2 第 3 项同样无章节号（07:38），第七轮收敛未修」，本笔即为该发现的修复，审核先于/同笔入档 ✓；补正内容经本审核复核准确（D5）。
- Human Gate：两笔均未触及 07 §9.1 三项领域增量（未改载体位置/Schema/权限目标/迁移规则/登记方向/判定方式/工作对象边界）→ 无需 Human Gate ✓。§5.1 明文记录 Human 已对登记契约确认（07:89）。
- 提交闭环：两笔均带 `LDVH-Provider`/`LDVH-Model` 受控尾注、「关键变更」与 diff 一致 ✓。
- 07 当前状态（01 §6.3 三态）：至少为**设计基线**（§5.1 Human 确认明文）；实际被作为当前规则源消费（本会话管辖判定生效、plugin spec-registry 扫描 specs/、01 §8.1 已登记）。01 §9.2 十二项中可机械核验项通过（1-6、10、11 抽核：路径/H1/身份块/结构/basis/登记/受控提交）；第 8/9 项有七轮审计与 §5.1 明文支撑；**第 12 项（来源视图指纹绑定）未逐项取证 → gaps**。

### D9 审核自身是否与风险匹配 — 见 §5、§6
未跳过任何维度；深度分配与对象的基础性匹配（详见 §6 反向核对）。

### D10 中文语义清晰、术语一致与机器表示对应 — 基本符合（三处机器表示脱节）
- 术语：「登记载体」全文 18 处统一（无「登记/载体」变体混用）；「工作对象」「管辖判定」「消费方」用法一致。
- 三态机器表示：`governed`/`not_governed`/`unavailable` 与 `governance-scope.js` 逐字一致 ✓；§7 前置状态契约 `available`/`unavailable` 与 08 §5.6（08:119「宿主 ACL/沙箱结果映射为 07 的 available 或 unavailable」）一致 ✓。
- **`~/.dsh` 表述复核（前轮 08 审核 Q1）**：07 §5.1（07:91）「用户配置根必须通过 **DSH/Electron 正式 user-data/config API** 解析，不硬编码 `~/.dsh`」↔ 08 §5.6（08:119）「宿主以 **DSH_HOME 环境变量与 `~/.dsh` 默认根**提供，**无 Electron userData 级 API**」。实现侧无硬编码（dshHomePath thunk，lib 中 `~/.dsh`/`homedir` 零命中）✓。**Q1 仍未定案**：07 的「DSH/Electron 正式 user-data/config API」措辞在 08 核验「无 Electron userData 级 API」的事实下偏松——`ctx.get('dshHomePath')` 服务是否即 07 所要求的满足形式，仍需 Human/来源确认。从 07 侧看该措辞未恶化，但也没有被收紧（P3-13）。
- 机器表示脱节三处：§5.4 五个错误码（P2-2）、§5.6 `rejected`/`conflict` 斜杠双码（P3-9）、§5.3 空载体情形（P2-3）。

---

## 3. 问题清单（分级 + 引文行号 + 复现）

> 分级：P1 = 推翻规范成立性；P2 = 实质问题，须修复或明确披露/定案；P3 = 轻微，措辞或完备性。**本轮无 P1。**

### P2-1 §7 Skill 行委派落空：「08 §5.6 宿主接入定案」不存在所指标内容
- 引文：07:169「Skill | **是否保留由 08 §5.6 宿主接入定案**；保留且前置条件成立后，执行前检查当前项目是否在管辖列表」
- 复现：`sed -n '117,119p' specs/08-DSH环境接入与插件发布规范.md` —— 08 §5.6 全文只有三句：唯一权威声明、接入点（dshHomePath）、不复制 Schema/写入规程。**通节无任何「Skill 是否保留」的定案**。08:54 只把「Skill 侧宿主接入点」列为 08 §3.1 职责，同样不是定案。
- 影响：07 把 Skill 消费行的前置决定委派给一个不存在该内容的章节——「委派落空」；读者按 07:169 去读 08 §5.6 找不到答案。plugin 中也无任何 Skill 实现（无 skills 目录）。
- 处置建议：要么 08 §5.6 补登 Skill 去留定案，要么 07 §7 改为「是否保留尚未定案，定案归属待来源建立」。

### P2-2 §5.4 AI 入口与五个细分错误码：规范枚举与实现完全脱节
- 引文：07:130（AI 入口：LDVH CLI 先只读再写入登记文件）、07:133（`user_config_root_unavailable`…`registration_schema_invalid` 五码闭集）
- 复现：`grep -n 'name: "' plugin/lib/ldvh-tools.js` → 仅 5 个操作，无登记写入；`grep -rn 'registration_permission_unverified\|registration_carrier_unavailable\|user_config_root_unavailable' plugin/`（排除 node_modules，含 web/）→ **0 命中**；实现实际错误码为 `registration_unavailable`/`conflict`/`candidate_invalid`（governed-projects.js:150,164,196 等）。登记唯一入口是 Web 安装事务 `host-api.js:38 /governed-projects/install`。
- 影响：07 §5.4 定义的 AI 入口语义与五码机器表示既未实现、也未按 05 §6.1 声明为公开操作（能力发现无法呈现其「已声明未实现」状态）；`docs/audit/implementation-status-registry.md` 亦未登记此缺口。§5.4 的条件启用（08 核验完成前返回 unavailable）没有承载面。
- 注意：§5.4 条件句「以下入口方可启用」提供了一定的前瞻辩护，但「返回五码」本身是可执行语义，无实现亦无披露。

### P2-3 「载体尚未创建」（ENOENT）的三态归属：07 §5.3、§8 与实现、10 §8 三方不一致
- 引文：07:115「任一前置条件**不可取得**、不可解析或未核验时，直接返回 `unavailable`」；07:182「定案载体**存在**并可唯一解析」；10 §8「登记文件缺失 → 显示『尚未初始化』」
- 复现：`plugin/lib/governance-scope.js:63`——`registration.value.projects.length === 0` → `not_governed`；`readGovernedProjectIndex` 对 ENOENT 返回 `success({initialized:false, projects:[]})`（governed-projects.js:193-194）。即实现把「载体不存在」判为 **not_governed**，而 07:115/182 的字面读法是 **unavailable**，10 §8 又单列第三种呈现「尚未初始化」。
- 影响：三态判定是 07 的核心语义，其最常见初始状态（全新安装、载体未建）在规范文本、实现、Web 呈现三处各说各话。实践后果被 `index.js:322-330` 启动时 `ensureRegistrationCarrier` 自动建空载体缓解，但语义本身未定案。

### P2-4 §5.3「linked worktree 通过 Git common-dir 确定性识别同一项目」：判定实现不含 common-dir
- 引文：07:124「linked worktree 通过 Git common-dir 确定性识别同一项目，不在配置中保存 branch、remote 或 worktree 列表」
- 复现：`grep -n 'common' plugin/lib/governance-scope.js` → 0 命中；判定是纯 containment 字符串匹配（governance-scope.js:64-78，且注释明言「零 fs 调用/纯字符串比较」）。common-dir 只出现在登记与装钩路径（governed-projects.js:118 `resolveGitRoot` 返回 gitCommonDir；08 §6 Git Hook 装到 common-dir）。
- 反例复现（见 RE-2）：登记主 worktree 后在 linked worktree 中开会话 → `not_governed`，与 07:124 的宣称相悖。
- 辩护空间：该句位于「`path` 持久化」段落，可窄读为「登记时路径识别」；但「识别同一项目」的自然读法覆盖判定，且 §6:161「单项目单 worktree」的「worktree」未定义是主 worktree 还是任意 worktree——语义悬空。

### P2-5 Git Gate 消费行无实现：Hook 侧 fail-closed 承诺落空且未披露
- 引文：07:168「Git Gate | 前置条件成立后，在 Git Hook 事件中**检查管辖状态**；未管辖时阻断提交」；07:172「受控操作、**Hook 提交**和 Skill 执行均 fail-closed、不得继续」
- 复现：`grep -rn 'resolveGovernanceScope\|readGovernedProject' plugin/lib/git-gate-runner.js plugin/lib/commit-validation.js plugin/lib/hook-manager.js` → 0 命中。commit-msg runner 只校验 message/diff/index（git-gate-runner.js:22-53），不读登记载体。
- 影响：登记载体损坏/项目已不在列表而 Hook 残留时，Hook 不会按 07:172 fail-closed，提交照常走 message 校验。07:174「不证明任一消费方已经实现」提供了规范侧的诚实披露，但 `docs/audit/implementation-status-registry.md` 未登记此缺口（该登记册的既定用途正是此类披露）。

### P3-6 §5.6「高风险写入」无判据、Windows ACL fail-closed 无实现
- 引文：07:142「Windows 继承 DSH 用户配置目录 ACL，不伪造 POSIX mode、不扩大到其它用户，**ACL 无法核验时高风险写入 fail-closed**」
- 复现：全 lib 无 ACL 核验代码；「高风险」一词在 07 内无定义（何为高风险写入？）。Node 的 mode 在 Windows 上本就被忽略（与「继承 ACL」相容），但「无法核验→fail-closed」这条规则没有任何机械承载。
- 处置建议：给出判据（如：目标已存在且属其它用户/不可写即高风险）或改为条件式「ACL 核验能力建立前，Windows 侧不声称已满足本条」。

### P3-7 §5.6 v4 一次性迁移无实现
- 引文：07:144「v4 配置只作为一次性迁移输入…迁移前规范化路径并向 Human 展示完整 v5 候选；Human 确认后写入新载体」
- 复现：`grep -rn 'LDVH-GOVERNED-PROJECTS\|migration' plugin/lib/*.js` → 无 v4 载体读取代码（命中的 migration 均为 guidance 状态迁移行）。v4 用户当前无迁移路径；规范未声明该能力未建。

### P3-8 §5.1 交互层约束越过自身 scope；「实际路径如实呈现」指代不明
- 引文：07:11（scope）「不定义 Web 交互细节」；07:91「设置界面…**不展示实际绝对路径，也不提供路径输入、选择、复制或打开目录入口**」；07:144「**实际路径由 Web 和 AI 响应如实呈现**」
- 问题：① 07:91 的按钮级约束是 Web 交互细节，与 scope 自我声明张力（可辩护为登记安全语义边界，但「复制/打开目录入口」明显是交互层）；② 07:144 的「实际路径」若指载体绝对路径则与 07:91「不展示实际绝对路径」直接冲突，若指迁移后项目路径则通顺——指代不明，两种读法必有一处冲突或含混。实现侧 `ldvh-tools.js:127` 以相对路径 `ldvh/governed-projects.yaml` 呈现来源，未提供裁决依据。

### P3-9 §5.6「并发冲突返回 `rejected`/`conflict`」双码指代不清
- 引文：07:142。复现：实现只返回 `conflict`（governed-projects.js:250,253,315,324）；`rejected` 是 05 §8 envelope 的 outcome 词（ldvh-tools.js:10 注释可见），不是登记写入的错误码。斜杠写法读者无法确定是「二选一」还是「envelope outcome/error code 两层」。建议改为「冲突以 `conflict` 错误码拒绝（envelope 层表现为 `rejected`）」或只保留一码。

### P3-10 §2 第 3 项引用 02 §8 对应弱
- 引文：07:39「02 §13 规则遵守（业务系统）、§8 编排（能力承载）与 §15 复核与校验（制度）对管辖判定作为执行前边界落实与复核的机制指向」
- 复现：02 §13（02:152-158，预检/暂停/00 §4/08 承接）与 §15（02:166-173，机械校验）对应成立；02 §8（02:117-122）内容为子代理委派/通信/成本控制，机制指向只列 08/04，与「管辖判定作为执行前边界」无直接语义对应。章节号与标题真实（非悬空引用），但依据强度掺水。

### P3-11 空载体自动创建的触发语义未入规范
- 引文：07:142（§5.6 首句）「**登记或取消仅由 Human 明确意图触发**」
- 复现：`plugin/lib/index.js:322-330` 启动时 `ensureRegistrationCarrier` 自动创建空载体并记日志；git 历史 `ee66771`「07管辖登记自动创建恢复为无确认」表明这是有意的 Human 决定，但 07 §5.6 只写了登记/取消的触发约束，未写「空载体可由插件启动自动创建」这一例外。严格读者可判实现违约；宽读者可辩「创建空载体既非登记也非取消」。建议补一句定案。

### P3-12 7ba7918 无先行独立审核记录（时序瑕疵，事后已追认）
- 复现：`grep -rn '7ba7918' docs/` → 0 命中；该笔改动「权威归属表述」，处 01 §12.1 实质/非实质边界（01 §12.1 要求「无法确定时按较高风险审核」）。事后 `0a0f843` 入档的 review-08-vs-audited-set.md D1 逐字核验了更正后文本与 08 的一致性，实质风险已消除，但「Human 决定前完成审核」的顺序未走足。

### P3-13 「DSH/Electron 正式 user-data/config API」措辞偏松（沿用前轮 Q1，未定案）
- 引文：07:91 ↔ 08:119「无 Electron userData 级 API」「DSH_HOME 环境变量与 ~/.dsh 默认根提供」。`ctx.get('dshHomePath')` 服务是否即 07 所要求的满足形式未经 Human 确认。实现无硬编码 ✓，风险为表述层。

---

## 4. 反例清单（维度 7 主动构造）

- **RE-1（成立，P2-3）DSH 配置根设在工作区内**：§5.3/§6:160 断言载体「位于项目 Git Working Tree 之外」。若用户把 `DSH_HOME` 指到某管辖项目工作树内的路径，载体落入工作树：① 与 07:160 的「之外」断言矛盾；② 载体会成为 Git Gate 的树内文件、被误当受管载体候选；③ 判定读取自己所在项目的树内文件。规范与实现（dshHomePath 无「是否在登记项目内」检查）均无守卫。规则不完备。
- **RE-2（成立，P2-4）linked worktree 会话**：登记 `/repo`（主 worktree）→ `git worktree add /wt` → 在 `/wt` 开会话。判定实现只做 containment 匹配 → `not_governed`，而 07:124 宣称「linked worktree 通过 Git common-dir 确定性识别同一项目」。同一项目的主/链接 worktree 得到相反判定；Hook 因装在 common-dir 反而对 `/wt` 生效——「Hook 管辖、会话不管辖」的割裂。
- **RE-3（部分成立）两 AI 会话并发登记同一项目**：实现的答案确定——`withFileLock` 串行化；同 id+同 path 的后来者幂等返回 success（不重复写入，符合 07:176「已登记时不重复写入」）；同 path 不同 id → `conflict`「project id or path is already registered」（先持锁者赢）；带过期 fingerprint → `conflict`「refresh before retry」。**谁赢**有答案，但**重试语义**只在实现的错误消息里，07 §5.6 未定义（且不带 fingerprint 的调用者拿到的是 last-writer-wins 而非冲突拒绝——版本守卫是可选参数）。规范粒度不足。
- **RE-4（成立，P2-5）登记文件损坏时消费方行为**：CLI ✓ fail-closed（ldvh-tools.js:138-143 对非 governed 一律 unavailable envelope）；Web ✓（10 §8「不可读…显示 unavailable，不得伪装为未管辖」，host-api scope 端点透传 unavailable）；**Git Gate ✗——hook 不读载体，损坏时提交照常校验放行**，07:172「Hook 提交…fail-closed」落空。
- **RE-5（成立，观察）7ba7918 更正的漂移面**：文本三方闭合（07 §5.6 定义 / 08 §6 核验声明 / 09 域实现+测试）；但 08 §6 的核验通道（`writeText replaceIfVersion`、`fs/write-intent` waterfall）在 plugin/lib **零挂载**（grep 零命中）——登记写入走插件自备 `@deepseek-ai/dsh-atomic-write`+文件锁。「08 核验宿主满足性」目前是文本承诺，无机械消费面。不会「再次漂移」成文本矛盾，但核验义务无承载。
- **RE-6（不成立，验证通过）大小写/junction 路径**：07:124「不得用简单 lowercase 冒充规范化」——实现用 `realpath`（大小写不敏感文件系统上返回盘上规范大小写）+精确比较，未用 lowercase hack；junction/symlink 由 realpath 解析。核验通过。
- **RE-7（不成立，验证通过）嵌套仓库**（补充检验）：工作目录为登记项目内嵌套的独立 Git 仓库时，实现按 containment 判 `governed`；07:120「当前路径须解析为存在的真实 Git 根」的严格读法（先解析 cwd 的 Git 根再比对）会判 `not_governed`。轻微字面偏差，实践影响小（登记根本身是 Git 根），列入 P3 观察不入清单。

---

## 5. 跳过的维度与依据（维度 9 自查）

**十维全部覆盖，无跳过维度。** 主动压缩的范围与依据：
1. **02/03/04 全文通读**：未通读，仅定向读 02 §8/§13/§15、04 §10 相关行——依据：本轮对象是 07，上位一致性已由七轮累积审计（review-round2–6、review-upper-chain-summary）覆盖，本审核只复核 07 直接引用的章节。
2. **30/31 调研/讨论规范**：未读——依据：07 与其无引用关系（grep 无交集）。
3. **web/ 前端代码逐行**：仅核对 API 端点与契约测试（client-contract/web-routes/web-mount 三文件 197 测试通过），未逐行读前端源码——依据：Web 交互权威在 10，07 只定语义接口。
4. **`@deepseek-ai/dsh-atomic-write` 包内部**（writeFileAtomic 的临时文件/rename 实现细节、Windows EBUSY 行为）：按包名、选项签名（mode/dirMode）与 29 个通过测试取信，未读包源码——这是本审核最大的取信点，已在 §7 声明。
5. **2f53eed 之前的 15 笔历史提交**：未逐笔复审——依据：既有七轮审计记录在档。
6. **Windows 实机行为**：无 Windows 环境，ACL/EPERM 分支只能静态核验（结论：无实现）。

---

## 6. 风险档位反向核对结论

**判定：高风险档、十维全量审核——档位认定正确，本审核深度与之匹配。** 反向核对依据：
1. **爆炸半径**：07 决定「哪些项目受管辖」，是所有其它规范适用性的前提（本会话引导词明示「不在管辖项目内，规范可能不适用」）；其三态判定在每次 prompt 组装与每次工具调用上运行（governance-scope.js:37-39 注释）——错判直接影响全部受控操作的放行/拒绝。
2. **近期变更性质**：7ba7918 改动权威归属表述（07/08/09 三方分工的关键接缝），0a0f843 改依据清单——均处于「可能改变可强制执行规则」的边界，按 01 §12.1「无法确定时按较高风险审核」应全量。
3. **实证**：本审核发现 5 项 P2 中 4 项与「能力真实性/消费闭环」相关——恰好证明该对象的风险确实落在实现与消费面，全量+实现核验的深度是必要的，不是过度。
4. 审核投入与对象体量比：236 行规范 ↔ 通读 + 6 个实现文件 + 197 项测试 + 7 份规范交叉 + 20 笔提交史——比例合理。

---

## 7. 未覆盖范围与保证边界

1. **包内部取信**：`@deepseek-ai/dsh-atomic-write` 的 writeFileAtomic 是否严格「同目录临时文件+flush+原子 replace」未读源码核验；若该包实现有偏差，P2 清单中「原子写入已实现」的结论需降级为「已委托实现」。
2. **Windows/Linux 实机**：0700/0600、ACL 继承、EBERM/占用失败模式均未实机验证；本报告对 §5.6 Windows 子句的结论仅限「无实现代码」。
3. **来源视图指纹**（01 §9.2 第 12 项）：未取证当前来源视图与 Human 决定绑定的指纹一致性，07 的当前规则源成员资格第 12 项保留为 gaps。
4. **历史七轮结论**：本审核复核了其涉 07 的关键结论（review-08-vs-audited-set Q1/F2/D1），未重验其全部证据链。
5. **本报告不证明 07 正确**：按 01 §12.4，审核完成不证明规范正确，也不自动使其进入/保持当前规则源；上述 gaps 不冒充通过。

---

## 8. 独立性披露

- **审核者**：LDVH 独立对抗审核者（隔离子代理会话），未参与 07 或任何 specs 文件的候选形成；工作区内无本审核者此前写入。
- **对象与候选**：审核对象为 dev 分支 HEAD（`0a1b2d3`）工作树中的 `specs/07-工作对象与管辖范围规范.md`（236 行，工作区干净，无未提交候选）；近期两笔修改 `7ba7918`/`0a0f843` 的 diff 逐一比对。
- **实际攻击方向**：① §5 权重与权限位级别（反过度设计，结论：不成立）；② 实现真实性五点（载体/原子写入/权限/消费方/迁移）；③ 三态语义的反例构造（ENOENT、worktree、并发、损坏、配置根入树）；④ 7ba7918 更正的三方闭合与漂移面；⑤ 跨规范引用逐一存在性 + 02 精确章节补正的内容对应；⑥ 术语与机器表示（~/.dsh、五码、双码）。
- **发现**：0 P1 / 5 P2 / 8 P3，反例 5 成立 2 不成立（RE-6/RE-7 验证通过）。
- **未覆盖**：见 §5、§7。
- **独立性边界**：与候选形成者同模型家族（本 harness 的 glm 模型，候选由 workbuddy/deepseek 渠道形成），上下文完全隔离；机械证据（grep/测试/parseSpecDocument 输出）均可复现，主观判断（如 02 §8 对应弱、权限位归 07 不算过度）已给出推理链与引文，供父代理复核。

---

## 9. 总体结论：**有条件合格**

规范文本本身：结构、上位对齐、防自欺、引用真实性、价值映射全部合格，且 7ba7918/0a0f843 两笔近期修改方向正确、文本闭合。不合格的是**规范语义与实现/消费面之间的五处落差**——其中 Skill 行委派落空（P2-1）是文本问题须修；P2-2/3/4/5 是语义未定案或能力缺口未披露，规范可以选择修文本、补实现或在 implementation-status-registry 登记披露，三者任一即可闭环。

**合格条件**（满足任一处置路径后可升为合格）：
1. 修复 P2-1（Skill 行委派：08 §5.6 补定案或 07 改为「未定案」）；
2. 定案 P2-3（ENOENT 三态：07 §5.3 明确「载体尚未创建」的归属，与实现/10 §8 对齐）；
3. 定案或披露 P2-4（linked worktree 判定：实现补 common-dir 识别，或 07 §5.3/§6 明确「仅主 worktree 判 governed」）；
4. 披露 P2-2/P2-5（AI 入口、五错误码、Git Gate 管辖检查：补实现，或在 implementation-status-registry 登记为已声明未实现）。

P3 各项可随下轮常规清理处理，不阻断合格。
