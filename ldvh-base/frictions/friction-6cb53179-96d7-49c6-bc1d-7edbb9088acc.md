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
  - at: 2026-09-28T13:01:34.438Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充修复进展：提交 2827baf 直接修掉本阻碍（候选路径探测＋解释器不可用标记＋preflight 拒装＋ELECTRON_RUN_AS_NODE 防 fail-open，实测未注入 PATH 时全量 1019/1019）；因路由判定为直接执行、无 WorkCase 解药对象，按 26 §9.2 机械上无法销账，状态保持 open。如实登记三处边界：该组合在 26 号内无承载位（临时登记于入账依据段内）、本条仍在 open 计数中度量失真、销账与否留待该对象被处理时决定
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

### 修复进展与不销账说明（登记于此，非处置段）

**阻碍已消除**：提交 `2827baf`（`fix(hook): 提交钩子自行解析 node 解释器，杜绝「找不到解释器」被当作校验生效`）直接修复了本账目。钩子改为候选路径探测（安装时烘焙绝对路径优先，`node`／`nodejs` 兜底），探测失败时输出固定标记并以 127 退出；`preflight` 见到该标记即拒绝安装，不再把「校验器无法启动」当作「拦截生效」。同时以 `ELECTRON_RUN_AS_NODE=1` 调用解释器——宿主为 Electron 时烘焙的绝对路径就是 Electron 二进制，直接 exec 会撞单实例锁后以 0 退出，构成 fail-open（实测：同一坏消息在该路径下退出 0，加该标志后才正确拒绝）。实测口径：修复前未注入 PATH 的 shell 中全量套件 19 项失败，修复后 1019/1019 全过；本仓钩子已重装至 `1.0.0-dev.2`。

**为何不销账（并入 open 的机械原因）**：`26 §9.2` 要求 `open → resolved` 必带 1..n 条 `informs` 指向**解药对象**（ADR/WorkCase 的 `object_uid`）。本修复经 Human 判定为「直接执行」、未建 WorkCase，而 commit 级修复不产生事实对象（§9.2 明写 commit 级修复「不进结构化关系」），故**当前不存在可指向的解药对象**，机械上无法销账。本账目保持 `open`，销账与否留待该对象被处理时决定。

**登记位置的临时性（规范缺口，如实登记）**：§9.2 为 commit 级修复指定的承载是「处置段以自然语言＋commit hash 承载」，而 §8 规定处置段仅在 `resolved`/`deferred` 时出现、§9.1 又要求 `resolved` 必带 `informs` 目标。三者合读后，「commit 级解药 ＋ 无解药对象 ＋ 保持 open」这一组合**在 26 号内没有任何承载位**；本条登记于入账依据段内，是**因该缺口而选的临时承载**，不主张其为规范认可的形态。本对象不自行修订 26 号。

**度量失真（如实登记）**：本账目仍计入 `open` 计数与「解决率」分母（§12 的 dogfood 度量），而其阻碍已消除——即在度量上表现为一条长期挂账的未解摩擦。该失真在销账或改判前持续存在，消费方不得据 open 计数推断本条仍待修。
