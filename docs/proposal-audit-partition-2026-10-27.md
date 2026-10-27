# 21 号建前审核机制修订候选（2026-10-27）

> 状态：**候选**，未并入 `specs/21`。落盘须经 Human 决定（00 §4.2）与 01 §9.2 第 8/9 项程序。
> 实现侧已按本候选改造（`plugin/lib/workcase-writer.js`、`plugin/lib/workcase-tools.js`），
> 测试见 `plugin/test/workcase-audit-partitions.test.mjs`。

## 一、为什么改：实测

`record_audit` 的 3 轮上限（`PRE_AUDIT_ENTRIES_PER_MATTER_MAX = 3`）按
`candidate_fingerprint`（`plan`+`scope` 整体内容指纹）计数。但审核-修订循环中
每轮修订都改 `plan`/`scope`、指纹必然变化，计数随之归零——上限结构性不可达。

实测数据（`ldvh-base/workcases/` 全量 YAML 解析）：

| 工单 | 建前审核自述轮次 | `pre_reviews` 实存 | 单指纹最高条数 |
|---|---|---|---|
| `workcase-996e207a` | 6 轮（62d331bd → 0a64920d） | 4 条，4 个指纹各 1 条 | 1 |
| `workcase-c36b0208` | 4 轮 | 3 条 | 2 |
| 全库 | — | 10 条 | 2 |

`pre_gate1_audit_round_cap` 在本仓库**零触发**。

第二层：覆盖闸要求 `candidate_fingerprint` 等于当前 `plan`+`scope` 的**整体**
指纹，任何一处改动都使前次 `pass` 失效、必须全量重审（996e207a 第五轮只
「刷正行号引用」仍整份重审），单轮审核时间长、轮次多。

## 二、改什么：三处口径

### 2.1 分区（增量审核）

审核的分区单位：

- `plan` 每个步骤一个分区，id `plan#1`、`plan#2`……；
- `scope` 每个条目一个分区（「做什么」「明确不做什么」「允许的顺带修缮」
  标签下的每个 `- ` 项），id `scope:<标签>#N`。

分区指纹取**内容**的哈希（`plan` 项整体；`scope` 条目的类别 + 正文），
**不含索引**——增删步骤不使其余分区漂移。

`pre_reviews` 条目新增 `covered_partitions: [{id, fingerprint}]`，记录该次
审核覆盖的分区及其内容指纹。覆盖闸从「存在一条整体指纹 `pass`」改为
「**当前每个分区的指纹**都被某条合格条目覆盖」；未变分区可跨轮、跨修订、
跨 `rebatch` 沿用既有 `pass`。

### 2.2 轮次（单门 3 次）

`pre_reviews` 条目新增 `round_index`（正整数）。轮次上限按**不同
`round_index` 值的个数**计数，不因修订或 `rebatch` 重置：

- 同一轮的多个**分片**并行审核共享同一个 `round_index`，故**分片不占额外轮次**；
- 达 3 轮后拒绝开启第 4 轮（`workcase/pre_gate1_audit_round_cap`），对象保持
  `draft`，转 Human 裁决。

### 2.3 `rebatch` 保留审核流水

原口径「重批后 `pre_reviews` 清零」改为「保留为历史」：

- 分区指纹按内容匹配，旧条目覆盖的旧内容不会被误用为「当前内容已审」；
  清不清零不影响覆盖闸正确性；
- 清零会把轮次计数一并丢掉，使「重批后再审 3 轮」成为绕过上限的新路径；
- 「该次审核确实发生过」是历史事实，保留流水比压缩成一句摘要更可回读。

## 三、逐节对照

### 3.1 §8 字段表 `pre_reviews` 行

**旧**（摘）：`{at, provider, model, summary, session_id, session_source, auditor_origin, candidate_fingerprint, verdict}`；`candidate_fingerprint` 为「该次审核针对的 `plan`+`scope` 内容指纹」……

**新**（摘）：`{at, provider, model, summary, session_id, session_source, auditor_origin, candidate_fingerprint, covered_partitions, round_index, verdict}`。

- `candidate_fingerprint` 保留为**整体**指纹（与 `gate_1.authorization_fingerprint`
  同源），只用于整体形态的存量条目与兼容判定；
- `covered_partitions` 为**该次审核覆盖的分区**（Code 按当前候选计算指纹，
  调用方只给 id，不能自填指纹）；
- `round_index` 为**同一审核事项的第几轮**（Code 分配，分片共享同值）。

### 3.2 §9.2 审核上限条

**旧**：计数读 `pre_reviews` 中 `candidate_fingerprint` **相同**的条目数；「同一次审核事项」以该指纹为界——指纹一变即为新事项，计数归零。

**新**：计数读 `pre_reviews` 中**不同 `round_index` 值的个数**；同一轮的多个
分片共享同一 `round_index`、不重复计数。轮次不因 `plan`/`scope` 修订或
`rebatch` 重置；达 3 轮后拒绝第 4 轮。**理由**：原口径下修订即换指纹、
计数归零，上限从未生效（实测 996e207a 建前审 6 轮）。

### 3.3 §9.2 C2 局部重批条

**旧**：重批后 `pre_reviews` 清零，且**必须**如此（旧条目指纹必然失配）。

**新**：重批后 `pre_reviews` **保留为历史**，不清零；覆盖闸按分区内容指纹
匹配，旧条目不会覆盖重批后的新内容。重批只作废**受影响范围**的覆盖，未变
分区沿用既有 `pass`；轮次跨重批累计。

### 3.4 §8 状态表 `open` 行

**旧**：`pre_reviews` 保留为历史（须至少一条的 `candidate_fingerprint` 与当前 `plan`+`scope` 指纹一致）。

**新**：`pre_reviews` 保留为历史（Gate 1 时须每个当前分区均被某条 `pass` 覆盖；见 §14 Gate 1 前置）。

### 3.5 §14 Gate 1 前置·覆盖闸

**旧**：须存在一条 `pre_reviews`，其 `candidate_fingerprint` ＝ 当前 `plan`+`scope` 内容指纹、`verdict = pass` 且 `auditor_origin = "subagent"`。

**新**：须**当前候选的每一个分区**都被某条 `pre_reviews` 覆盖——该条
`verdict = pass`、`auditor_origin = "subagent"`，且其 `covered_partitions`
含该分区的**当前内容指纹**。存量整体形态条目（无 `covered_partitions`）在
其 `candidate_fingerprint` 等于当前整体指纹时覆盖全部分区。任一分区未被覆盖
即拒绝批准（`workcase/pre_gate1_audit_not_covering_candidate`，报告未覆盖分区 id）。

### 3.6 §14 `record_audit` 通道

**旧**上限门禁：本事项（`candidate_fingerprint` 相同）条目数达 3 时拒绝第 4 条。

**新**上限门禁：本审核事项的**不同 `round_index` 值个数**达 3 时，拒绝开启
第 4 轮（同一轮的分片追加不受限）。参数面新增 `covered_partitions`（分区 id
数组，省略即全部分区）与 `round_index`（省略即 Code 分配新轮）。

### 3.7 §15.1 建前独立审核表行 / §16 验证表

对应条件 ③④ 与两表的「成立条件」「未满足时的处理」按上述口径改写：
③ 改为分区覆盖判定；④ 改为轮次上限判定。

## 四、未覆盖与边界（如实登记）

1. **不证明审核质量**：分区覆盖只证明「每个分区有一条针对其当前内容的
   `pass` 结论」；不证明该分区被实质审过、审得对。与改造前的边界同口径。
2. **分区 id 随内容变化**：调用方沿用旧 id 会被拒绝（fail closed），须按
   当前分区重取——这是有意的，避免「用旧分区声明覆盖新内容」。
3. **存量条目**：无 `covered_partitions` / `round_index` 的历史条目按整体形态
   判定、按出现顺序各占一轮（legacy 兼容），不使存量对象凭空获得额度，也不
   使其被追溯拒绝。
4. **复核轴不在本单**：`reviews` 的「同一次复核事项最多 3 次」仍按原口径，
   对称改造另行提请。
5. **Web 呈现层**：徽标仍只判「存在 `pass` 条目」，不重算分区覆盖
   （`plugin/web/docs/10` §4.2.1 的既有边界，本单不改）。
