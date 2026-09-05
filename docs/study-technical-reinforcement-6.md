# Study 技术加固 6 项小稿（v4 调研格式保留 + 技术层补强）

> 性质：**讨论工作稿（非规范、非事实对象）**——基于 2026-09-07 Human 复盘对 v4 Study 现状的判断（落盘格式已收敛 OK，技术层需补强），形成 6 项独立可立项的工程加固项。本稿不进 v5 大稿体系；如确需立 Spark 或升规范候选，按 03 §受控创建流程另走。
> 依据：v4 specs/24-Study-研究报告.md（267 行）+ v4 code/ldvh/facts/contracts.py 第 115-122 行 Study layout + v4 53 份 Study 实例（含 16 份 retired）+ docs/investigation-report-dsh-deep-research.md §2-§5（控制论/信息论调研编排机制）+ docs/team-control-foundation-draft.md §1.1 spawn 形态表 + v5 八维宿主指向表草案 §0.5/§4.4/§8.3。

## 0. 现状判断（v4 实际）

- **落盘格式 OK**：Markdown + YAML frontmatter、10 字段闭集、五段 H2 顺序固定、UID-native + legacy 双读。v4 code/ldvh/facts/contracts.py 第 115-122 行 layout 声明 + Spec 24 §5 Schema 定义闭合，前后端验证一致。
- **技术层未闭合**：53 份 Study 平均 171 行、最长 254 行（`wc -l` 实测，超 Spec 24 §5「必须可见阅读单元」所需物理空间）；16 份 retired、13 份结论「不采用」（30% 退场率，v5 §8.3 第 6 条已警示）；五段结构无 Markdown validator（v4 code/tests/facts 下无 test_study_structure.py）；relations 字段空数组不拒收、目标类型不在闭集不拒收（v4 contracts.py 无约束）；无 EIG 机械停止条件；调研动作与审议漏斗未解耦（v4 + v5 现状都是"调研 = 审议扩散阶段"）。

## 1. T1 调研-审议解耦

**现状**：v4 把"调研"等同于"审议漏斗的扩散阶段"（v5 §4.4 第 1 条「漏斗形态：扩散（读+问+多视角）→ 收敛 → 审查 → 执行」同构）。后果：调研过程中如果触发审议需求，调研子代理被拉进审议漏斗；调研与审议同生同灭，调度复杂且难以机械隔离。

**加固方案**：调研作为**独立动作**，不挂审议。流程：

```
触发：Human 提问 / 主控识别"未知够多"
  │
  ├─ 调研：单 Session 长跑（或 dsh-deep-research 范式：4 角色并行）
  │    工具面：纯读 + web_search + web_fetch（无写、无 commit）
  │    产物：落 Study（research_question / abstract / input_refs / 五段正文）
  │    停机：EIG=0（连续单轮零 confirmed 事实，见 T2）
  │
  └─ 后续：审议如需引用调研结果，按 Study.relations[inspired-by] 拉取
       调研产物已落事实源，审议不再触发调研（避免重复）
```

**技术落点**：
- Spec 24 §5 第 78 行「一个 Study 只承载一个能被独立引用或退出的研究问题」已隐含此原则，加一段「调研动作与审议漏斗解耦」明文。
- 团队控制底座 v5 §1.1 spawn 形态表补第三行「调研模」（见 T6）。

**与 T6 关系**：T1 是设计层、T6 是通道层；T1 不依赖 T6 也能写，但 T6 让 T1 落得清。

## 2. T2 EIG 停止条件（信息论边际增益 = 0）

**现状**：v4 调研无限发散，AI 觉得"还能再查一点"。v5 §7.1 第 2 条已意识到（"在 LDVH 的审议维与反思维中，多方案扩散和调研探索常陷入无限发散"），但**没有工程化**。

**加固方案**（搬 dsh-deep-research §4 + §7.1）：

每轮调研结束检查 `RESEARCHER_SCHEMA` 三态证据：
- `confirmed` 新增 = 0 → 边际增益 = 0
- `uncertain` / `gaps` 仍有高优先级项 → 生成 followUp 子问题
- 连续 2 轮 `confirmed` 新增 = 0 → 立即停机

**技术落点**：
- Study frontmatter 加 `study-eig-rounds` 字段（数组，每轮 `confirmed_count` / `follow_up_count` / `terminated_reason`）
- 调研子代理输出 schema 强校验（confirmed 必填 URL + 置信度三档）
- 写维落盘器最小版接 EIG 字段（停机后允许落 Study，禁续跑）

**与 dsh-deep-research 关系**：直接搬 `src/index.ts:257-265` 的"零增益即停机"模式，schema 字段名可对齐 `RESEARCHER_SCHEMA`。

## 3. T3 五段结构 validator

**现状**：v4 Spec 24 §5「五个 H2 精确唯一、顺序固定、非空」+ §11.5「H2 缺失/重复/乱序/空内容则暂停」——**但 v4 实际无 validator**（v4 code/tests/facts 下无 test_study_structure.py）。当前是 v4 Helper 缺位 / Spec 写在前 / Code 未跟。

**加固方案**：

```js
// 伪代码
function validateStudyStructure(markdown) {
  const required = ['研究问题', '输入与边界', '关键发现', '建议', '后续分流'];
  const h2Set = new Set();
  for (const h2 of extractH2(markdown)) {
    if (h2Set.has(h2)) throw 'duplicate H2';
    h2Set.add(h2);
  }
  for (const r of required) {
    if (!h2Set.has(r)) throw 'missing H2: ' + r;
  }
  // 顺序校验
  const actual = [...h2Set];
  if (JSON.stringify(actual) !== JSON.stringify(required)) throw 'H2 order wrong';
  // 非空校验（每段至少一段非空白内容）
  for (const h2 of required) {
    if (sectionBody(markdown, h2).trim().length === 0) throw 'H2 empty: ' + h2;
  }
}
```

**技术落点**：
- v4 code 已有 test_atomic_write.py / test_yaml_portability.py 等同型 parser 测试，套用 test_study_structure.py。
- v5 plugin/lib 落盘器最小版接此 validator（落盘前必过，失败拒收 + 报告结构缺陷）。
- 修复 ≠ 重写：v4 Helper 受控创建流程已含「Code 验证可机械部分」（Spec 24 §9「可证明范围」），validator 是补这块的空白。

## 4. T4 关系边执行约束

**现状**：Spec 24 §7.1 关闭 `supersedes` / `depends-on` 为禁止关系类型；`inspired-by` / `informs` 闭集。但 v4 code 不拒收空 relations 数组、不拒收目标类型不在闭集（如指向 Pitfall 但 relations 字段写 `cites`）。

**加固方案**：

```js
function validateRelations(relations, factTypeKey) {
  const ALLOWED_KEYS = { 'study': ['inspired-by', 'informs'] };
  for (const rel of relations) {
    if (!ALLOWED_KEYS[factTypeKey].includes(rel.relation_key)) throw 'invalid relation_key';
    if (!ALLOWED_TARGET_TYPES[rel.relation_key].includes(rel.target.fact_type_key)) throw 'invalid target type';
  }
}
```

**技术落点**：
- v4 contracts.py 第 121 行 `relation_keys=("inspired-by", "informs")` 已是闭集——只差「拒收不在闭集的输入」这一步。
- v5 plugin/lib 落盘器最小版接此 validator；与 T3 同一管道（frontmatter validator）。

## 5. T5 体量闸（人可读带宽）

**现状**：v4 53 份 Study 平均 171 行、最长 254 行（`wc -l` 实测）。v5 §8.3 第 6 条「Study 均 160+ 行、WC 八判据逐条核对——超出人的可读带宽，LDVH 反着来」已定为警示，但**未设阈值**。

**加固方案**：
- **硬上限**：单份 Study ≤ 150 行（frontmatter + 五段正文合计），超出 → 落盘器拒收 + 报告「请压缩 abstract 或拆后续分流为独立 WorkCase」。
- **软上限**：120 行，触发建议而非拒收（落盘器返回 warning，可被主控覆盖）。
- **配套**：abstract ≤ 800 字符、recommendation_summary ≤ 600 字符、research_question ≤ 500 字符（参考 Spec 24 §5 已设的「不复制整段正文」原则）。

**技术落点**：
- 落盘器最小版加行数 / 字符数检查（行数 = 物理字节切行；字符数按 Unicode codepoint）。
- 体量闸与 T3 互不冲突：T3 查结构、T5 查体量；两道闸顺序先结构后体量。

## 6. T6 调研模 spawn 形态分离

**现状**：团队控制底座 v5 §1.1 spawn 形态表**只列两模**（审议模 dormant 物化 / 执行模 staged 批准），**没有调研模**。后果：调研子代理要么走审议模（dormant + 多方向）——过重；要么走执行模（Gate1 + staged）——过严。

**加固方案**：

| | 调研模 | 审议模 | 执行模 |
|---|---|---|---|
| 物化时机 | 单 Session 长跑，无 dormant | 2-4 方向 dormant 物化 | 任务 DAG staged |
| 工具面 | **纯读**（web_search / web_fetch / fact 读取，**无写、无 commit**） | 信道 A/C | 信道 B（任务书） |
| 终态 | 落 Study + 停机 | returned 封存 | 任务 terminal |
| 依据 | dsh-deep-research 单 Session 范式 | solo-thinking 生命周期 | AgentTeams staged 语义 |
| 上限 | EIG 停机（见 T2） | 深度/分支纯函数断言 | Gate1/Gate2 夹住 |

**技术落点**：
- 团队控制底座 v5 §1.1 spawn 形态表加第三行「调研模」+ §1.6 成本控制补调研 EIG 闸。
- 调研子代理工具白名单：minReadSet = [read-fact-object-candidates, read-spec-content, web_search, web_fetch]，明确禁写。
- 调研产物走写维落盘器（不绑代码交付，与底座 §1.7 一致）。

## 7. 六项依赖排序

```
T1（设计层）   T2（schema）  T6（通道层）
   ↓              ↓             ↓
T4（约束）   T3（validator）  T5（体量闸）
   ↓              ↓             ↓
        落盘器最小版（先有 T1/T6 设计，才有 T3/T4/T5 落点）
```

**实施顺序（与底座 v5 §2 一致）**：
1. **落盘器最小版先行**（写维当前缺位，T3/T4/T5 都依赖它）
2. T1（设计层补 Spec 24 段 + 底座 §1.1 调研模行）→ 立即可写
3. T2（schema 字段 + dsh-deep-research 范式搬入）→ 立即可写
4. T6（spawn 形态表补行）→ 与 T1 同批
5. T3/T4/T5（落盘器接 validator）→ 落盘器落地后

## 8. 验证锚点

| 断言 | 证据 | 类型 |
|---|---|---|
| v4 Study 格式已收敛 | v4 specs/24-Study-研究报告.md §5 Schema + contracts.py 第 115-122 行 | v4 规范源 + Code |
| v4 Study 平均 171 行 / 最长 254 行 | `wc -l ldvh-base/studies/*.md` 实测 | 物理事实 |
| v4 Study 16 份 retired、13 份结论不采用 | `grep -c "^status: retired" ldvh-base/studies/*.md` = 16 命中；八维表 §0.5 / §8.3 已统计 | 物理事实 + 引用 |
| v4 code 无 test_study_structure.py | `ls code/tests/facts/` 实测 | 物理事实 |
| v4 relations 字段无拒收逻辑 | v4 contracts.py 第 121 行仅声明闭集，无执行约束 | 物理事实 |
| EIG 停止条件理论依据 | dsh-deep-research §4 + 信息论 EIG 概念 | 开发输入 |
| 调研-审议解耦设计依据 | Human 2026-09-07 复盘（"调研是工具，不是维度"+ "一起触发太复杂"） | 决策记录 |
| 团队控制底座现状 | docs/team-control-foundation-draft.md §1.1 spawn 形态表（仅两模） | 开发输入 |

## 9. 不在范围（明确划出）

- **不写 v5 大稿**：本稿不进 v5 八维表主稿体系。如需立 Spark → 走 03 §受控创建流程（参考八维表 §0.5「ADR 常驻枚举接线」路径）。
- **不改 v4 specs/24**：本稿是 v5 待建项，v4 是只读历史档案（v5-handoff D1）。
- **不绑当前 0.1.2-rc.1 升级**：六项不依赖 DSH 上游 API 变更，独立可立项。
- **不触碰已 Human 终审的底座 v5**：T6 是补一行 + 补一段，不动 v5 五条承重决定；如 Human 终审认本稿，可单独走「调研模补丁」流程。

## 10. 立项建议

按 03 §5.3 现行五类事实对象 + v5 §8.3「人可读带宽」原则，本稿作为 **Spark 候选**（不值得立规范候选，但跨会话有保留价值——可能 09 月底才有 v5 实施期）。

**Spark 候选 metadata**（如要落档）：
- `fact_type_key: spark`
- `trigger_signal: "study-technical-reinforcement-2026-09-07"`
- `relation`: `inspired-by` → `study-01M0SVF6TRFH0VFYZN1V36ZMVA`（v4 DSH 深度绑定调研报告）
- `recommendation_summary`: "6 项技术加固可独立立项；T1/T2/T6 设计层立即可写；T3/T4/T5 待落盘器最小版先行"
- `disposition_summary`: 留空（active）

是否起 Spark 候选档需 Human 决定；本稿以工作稿形态存在至 Human 拍板。
