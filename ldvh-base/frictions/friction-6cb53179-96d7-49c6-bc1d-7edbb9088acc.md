---
title: 提交钩子依赖 PATH 中的 node
status: open
phenomenon: "Git Gate 提交钩子以裸 `exec node` 调用校验器，当会话 shell 的 PATH 不含 node 时提交被以 `exec: node: not found`（exit 1）拒绝，阻断者为 shell 而非校验器。"
attribution: .git/hooks/commit-msg:18 的裸 `exec node` 与 06 §6.5 Git Gate「机械守护终闸、提交前不可绕过」的语义之间存在缺口：钩子未使用绝对路径或候选路径探测，故校验器不可执行时提交被拒的原因无法与校验不通过区分。
impact: medium
serves: SG-3
object_uid: 6cb53179-96d7-49c6-bc1d-7edbb9088acc
fact_type_key: friction
created_at: 2026-09-28T02:59:31.277Z
change_log:
  - at: 2026-09-28T02:59:31.277Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Friction 对象
---

# 提交钩子依赖 PATH 中的 node

## 现象

Git Gate 提交钩子以裸 `exec node` 调用校验器，当会话 shell 的 PATH 不含 node 时提交被以 `exec: node: not found`（exit 1）拒绝，阻断者为 shell 而非校验器。

本次实测证据（2026-09-28，提交 research-35afd456 时）：

- `.git/hooks/commit-msg` 第 18 行逐字为 `exec node '/Users/dmh2002/DshProject/dsh-ldvh/plugin/lib/git-gate-runner.js' "$@"`，未使用绝对路径，也未探测候选路径。
- 执行 `git commit` 时钩子报 `.git/hooks/commit-msg: line 18: exec: node: not found`，退出码 1，提交未创建。
- 同机 `/opt/homebrew/bin/node` 存在且为 v25.9.0（`/opt/homebrew/bin/node -> ../Cellar/node/25.9.0_3/bin/node`）；`which -a node` 在会话 shell 中无输出。
- `bash -lc 'which node'` 同样返回 `command not found`，即该 PATH 缺失不限于非登录 shell，登录 shell 亦未取得 node。
- 在命令中显式 `export PATH="/opt/homebrew/bin:$PATH"` 后，同一候选消息提交成功，Git Gate 输出 `LDVH Git Gate (commit-msg) passed` 与 `snapshot_identity`。

频次与性质：任何 PATH 不含 node 的 shell 执行触及 `ldvh-base/` 的提交都会命中，属可重复触发的系统性阻碍，非一次性偶发。本次在单个会话内即命中一次并即时绕过。

## 入账依据

**为何算重复出现**：触发条件是「shell 的 PATH 不含 node」这一环境状态与「提交触及受管载体」的组合，两者都不是一次性事件——同一会话的每次受控提交都在该环境下执行，换一个未配置 node 的 shell 亦复现。它不依赖本次内容，故属跨行动累积的阻碍证据。

**归因到哪**：归因指向 Git Gate 提交钩子对解释器路径的硬依赖，即 `.git/hooks/commit-msg:18` 的裸 `exec node` 与 06 §6.5「Git Gate 是机械守护终闸、提交前不可绕过」的语义要求之间存在缺口。钩子由 ldvh-hook-bundle 生成（文件头登记 `ldvh-native-commit-msg-hook: v1` 与 `ldvh-hook-bundle-version: 1.0.0-dev.1`），属 LDVH 自身的机械守护件，其可执行性由 LDVH 负责；会话 shell 的 PATH 不由 LDVH 控制，故不判为环境方责任。此处不采用「环境该修」的归因——那会把守卫件的可执行性依赖成一条未书写的环境约定，而该约定在 06 或 08/09 中均无承载。

**修了会改善什么**：若钩子以绝对路径或候选路径探测取得 node，则「提交被拒」的观测原因将恒为校验结论本身。这一点是本次入账的核心理由——现状下 exit 1 存在两种成因（校验不通过 / 找不到解释器），二者在观测上不可区分，而 06 §6.5 的「非 passed 即阻断」整条语义建立在「阻断即校验结论」之上。使用者无法仅凭退出码判断应当修正内容还是修复环境。

**边界说明（与 `--no-verify` 无关）**：本次并未绕过校验，也未使用 `--no-verify`；校验实际执行并通过，被拒的是「找到校验器」这一步。因此本账目不指向任何绕过行为，只指向守卫件自身的可执行性缺口。
