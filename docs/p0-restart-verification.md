# P0 重启后五项验证记录

> 性质：开发验证记录（实测留档），非规范、非事实对象。
> 依据：docs/p0-implementation-plan.md（待验五项）、docs/p0-incident-tool-render-contract.md（本次修复背景）。
> 时间：2026-09-02，修复 `output.render` 返回字符串事故 + 采纳 dsh-mnemon `text()` 写法之后，DSH Desktop 重启后实测。

## 结论摘要

| # | 项目 | 结果 |
|---|---|---|
| ① | 管辖会话可见 `ldvh_*` 五工具 | 通过（真实会话实调） |
| ② | 七锚点引导段注入 | 通过（真实会话可见） |
| ③ | `resolve-governance-scope` 返回 governed | 通过（真实会话实调） |
| ④ | 非管辖工作区零干扰 | 通过（真实 DSH 会话实测：0 工具、无引导段） |
| ⑤ | 无 LDVH Git Gate 误执行 | 通过（Hook 版本一致、重启后零提交、runner 自检正常） |

五项闭环。**插件在真实宿主上可用**——证据是五个工具的结果均成功送达模型，此前事故的失败点（结果交付阶段）已打通。

## ① 五工具可见（真实会话）

本会话工具列表含 `ldvh_resolve_governance_scope`、`ldvh_read_specification_candidates`、`ldvh_read_specification_content`、`ldvh_discover_capabilities`、`ldvh_precheck_git_commit`，且逐个实调成功。

## ② 引导段注入（真实会话）

运行中子代理报告其系统提示含「LDVH 管辖会话最小引导」段，含身份块 / §2 根方案 / 八维 / Human 决定权等锚点。

注：段名是「LDVH 管辖会话最小引导」，不是导出常量 `GUIDANCE_SECTION_NAME` 的值 `ldvh:minimal-guidance`。首次核查按常量名检索未命中，属查法错误，非未注入。

## ③ 管辖判定（真实会话）

实调 `ldvh_resolve_governance_scope` → `state: governed`。

## ④ 非管辖零干扰

### 4.1 一次失败的探测（作废，留档以免重蹈）

首个探测让子代理 `cd /tmp/ldvh-zero-interference-probe` 后报告所见，结果报「5 个 ldvh 工具 + 引导段存在」，看似 ④ 失败。

**该探测无效，已作废。** 原因：管辖判定读的是会话创建时写入 header 的 `cwd`，不是 agent 事后 `cd` 的位置。子代理的会话 cwd 继承自本会话（dsh-ldvh，已登记），因此它是管辖会话，看到工具是**正确行为**。该探测实际测的是「子代理是否继承父会话管辖状态」，而非「非管辖工作区零干扰」。

### 4.2 判定侧验证（真实登记文件副本）

以 `~/.dsh/ldvh/governed-projects.yaml` 的副本为输入：

| cwd | 判定 |
|---|---|
| `/Users/dmh2002/DshProject/dsh-ldvh` | governed |
| `/Users/dmh2002/DshProject/dsh-mnemon` | not_governed |
| `/Users/dmh2002/DshProject/dsh-sub-cli` | not_governed |
| `/tmp/ldvh-zero-interference-probe` | not_governed |
| `/Users/dmh2002`（上级目录） | not_governed（不向上遍历） |
| `/Users/dmh2002/DshProject`（上级目录） | not_governed |
| `/Users/dmh2002/DshProject/dsh-ldvh-evil`（前缀陷阱） | unavailable（目录不存在，fail-closed） |

路径边界正确：`dsh-ldvh-evil` 这类同前缀兄弟目录不会被误判为 governed。

### 4.3 注册门控验证（双向，受控临时 DSH_HOME）

沙箱禁止写 `~/.dsh`（EPERM），故不改动真实登记文件，改用两个受控载体跑真实门控逻辑：

| 载体（登记内容） | 会话 cwd | 判定 | 工具数 | 引导段长度 |
|---|---|---|---|---|
| 仅登记 dsh-ldvh | dsh-ldvh | governed | 5 | 561 |
| 仅登记 dsh-ldvh | **dsh-mnemon** | **not_governed** | **0** | **0** |
| 仅登记 dsh-mnemon | dsh-mnemon | governed | 5 | 561 |
| 仅登记 dsh-mnemon | **dsh-ldvh** | **not_governed** | **0** | **0** |

双向对称成立：会话 cwd 与登记不匹配时，工具零注册、引导段为空串（组装时被过滤）。

三态门控补充（同一门控逻辑）：

| 状态 | 工具数 | 引导段 |
|---|---|---|
| governed | 5 | 561 字符 |
| not_governed | 0 | 0（零干扰） |
| unavailable | 0 | 189 字符（fail-closed 提示，非静默） |

### 4.4 真实宿主会话验证（Human 执行探测，已闭环）

Human 在 DSH GUI 中新建了一个工作目录为 `dsh-mnemon` 的会话，并使用提示词探测：

1. 报告 shell cwd 与会话启动 cwd；2. 统计 `ldvh_` 工具数；3. 检查系统提示是否含「LDVH 管辖会话最小引导」或 {身份块, 八维, Human 决定权}；4. 自评是否受管辖。

探测结果：

| 检查 | 结果 |
|---|---|
| shell cwd / 会话启动 cwd | 均为 `/Users/dmh2002/DshProject/dsh-mnemon`（两者一致 → 探测有效） |
| `ldvh_` 工具数 | **0**（该会话共 108 个工具，全集中无任何 `ldvh_` 前缀） |
| 引导段 | **NO** |
| 自评 | not governed |

**结论：④ 在真实宿主会话中成立。**

对照：同一台机器、同一 DSH 进程、同一份插件代码下，dsh-ldvh 会话可见 5 个 `ldvh_*` 工具，dsh-mnemon 会话可见 0 个——agent-scoped 注册隔离在真实宿主下产生实际差异。

探测设计要点（针对 4.1 的失败教训）：第 1 题强制分别报告 shell cwd 与会话启动 cwd，以避免「agent 事后 cd 改变不了会话 cwd」这一歧义再次导致误判。

附带观察：探测会话报告其运行时记忆中存在「LDVH 提交签名值零清理原则」条目。该条目是 MNEMON 记忆数据，跨会话全局可见，**不受 LDVH 管辖隔离约束**（隔离只作用于工具注册与系统提示段注入）。当前无害（内容为签名原则），但意味着写入记忆的 LDVH 相关内容会全局可见，与会话级注入的作用域不同。

### 4.5 本项的可信边界（闭环后更新）

已闭环：判定逻辑、注册门控、引导段取值、**真实 DSH 会话观察**（4.4）。
曾尝试但未采用的路径：`--profile headless` 不存在且沙箱禁止创建，未绕过。

## ⑤ Git Gate 无误执行

- 已装 Hook 经 `hook-manager.js` 自身逻辑机械校验：`{ owned: true, valid: true, version: "1.0.0-dev.1" }`，与 `plugin/package.json` 的 `1.0.0-dev.1` 一致——装的是当前代码版本，无旧逻辑残留。
- 最后一次提交 `2026-09-02 06:31`，验证时刻 `14:01`：重启后无任何提交，Hook 未被误触发。
- `git-gate-runner.js` CLI 自检正常（正确拒绝相对路径参数）。

## 附带：precheck 全链路实测（真实宿主）

1. 首次 precheck 故意填错 `LDVH-Provider/LDVH-Model` → `failed`（正确）。
2. 改填本会话权威路由值后仍 `failed`，查实因为：未 `git add` → `git/index_empty` + 三条 `key_change_unmatched`。**均为正确行为，非缺陷**——关键变更列出的文件确实未暂存。
3. `git add` 后重跑 → **`passed`**。

证明签名机械溯源、暂存区 diff 对应、header 校验整条链路在真实宿主上连通。验证后已 `git reset`，工作区回到干净状态。

## 清理

临时载体、探测目录、登记文件备份均已删除；`~/.dsh/ldvh/governed-projects.yaml` 未被修改（内容仍为仅 dsh-ldvh，mtime 未变）。
