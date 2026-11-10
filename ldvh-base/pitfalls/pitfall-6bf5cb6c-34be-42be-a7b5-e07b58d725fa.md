---
title: 路径重复拼接致受检清单滤空而门禁静默放行
status: active
scope: 本仓提交前 lint 门禁（`plugin/lib/git-gate-runner.js` 的 `stagedLintFiles` 与 `checkLint`，及其在 pre-commit 与 preflight 的调用点）中一切「先按路径过滤、再以零个受检对象判定无需检查」的场景；凡工具输出的路径基准与工具 cwd 不是同一目录（worktree 与 workspaceRoot 不同层、monorepo 子包、`git -C` 混用）的校验脚本均可能踩到。经验可信边界：只覆盖本条证据链所及的这一处 lint 门禁与其他门禁中同形的空集分支。
object_uid: 6bf5cb6c-34be-42be-a7b5-e07b58d725fa
fact_type_key: pitfall
created_at: 2026-11-03T19:38:44.108Z
change_log:
  - at: 2026-11-03T19:38:44.108Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累·审核段据缓冲条目 13b3a131-f77e-429c-831a-d1326fb2b359 形成候选（11 §10.2 第 3 项）
  - at: 2026-11-10T11:35:25.270Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
---

# 路径重复拼接致受检清单滤空而门禁静默放行

## 症状
提交前的 lint 门禁打印 passed、退出码 0，但本次提交的 JS 文件一个都没有被 eslint 检查。识别信号是两条同时成立：提交 diff 里有 `.js`/`.mjs` 改动，门禁输出里却没有任何文件名与 eslint 结果——它与「本次提交不含 lint 面内文件」的合法跳过同形，肉眼无法区分。缺陷暴露在受检清单的构造：实现把 git 给的仓库相对路径又拼了一次 workspaceRoot，得到 `plugin/plugin/lib/x.js`，`access` 全部失败、整批被剔，空清单落入跳过分支。

> 我把两者相加拼成了 `plugin/plugin/lib/x.js`，`access` 失败 → 整批滤空 → 空清单按「跳过」处理 → **门照样打印 passed**
> 来源：本次观察材料 turn 3 的 assistant 回复正文：callout「我第一版实现是错的，而且门在静默放行」段，以及正文「已修复路径映射：之前的实现多加了一层前缀，导致文件被全部过滤掉，lint 因而静默放行」

## 触发条件
三个条件同时成立才会踩到：① 受检文件清单来自 `git diff --cached --name-status`，路径是相对仓库根（worktree）的；② `workspaceRoot` 不等于仓库根——生产形态里 workspaceRoot 是本仓 `plugin/`，worktree 是仓库根，两者共享 `plugin` 这一段；③ 换算代码把相对路径与 workspaceRoot 直接相加，而不是先算 workspaceRoot 相对 worktree 的前缀。叠加条件：存在性检查（`access`）失败即把文件从清单剔除，且空清单在外层仍按通过处理。

## 根因
「空清单即放行」不是单层决定，而是门禁契约与实现共同作用的结果：契约规定零个文件时**不得**以空参数调用 eslint（实测不带参数的 eslint 会扫描当前目录、退化成全仓），所以零文件被约定为「本次没有可查的东西」而跳过；实现里该跳过返回 ok，外层与真正的「检查通过」同形输出 passed。真正的缺陷在上游——路径换算多加一层前缀使每个受检文件 `access` 失败，失败又被当作「不在 lint 面内」静默剔除，于是「本提交有文件、但路径全被算错」被压成了契约里合法的「本提交没有文件」。已观察：路径换算多加一层前缀这一实现错误、`access` 失败即剔除、空清单走跳过分支并打印 passed；未知：材料未逐字给出跳过分支与外层输出的代码位置与措辞，本条据可观察行为判断「跳过与通过同形」。

## 解决
修正路径换算：先算 `workspaceRoot` 相对 worktree 的前缀，再用该前缀把 git 的仓库相对路径换算为 workspaceRoot 下的路径；只有换算后确实不在 workspaceRoot 之下的路径才丢弃，保留下来的文件再做 `access` 存在性检查。落点可见于 `plugin/lib/git-gate-runner.js` 的路径基准换算注释与实现（先算前缀再换算、越界路径才丢弃）。成功信号：同一提交的受检清单不再为空，eslint 真的收到这些文件并产出结果。

## 规避
① 路径换算一律以「git 输出以哪为基准」为准显式换算，绝不把相对路径与可能含同名段的根直接相加；② 文件存在性检查失败必须报出路径与计数并计入失败——`access` 失败是「路径算错了」的强信号，不是「不属本面」；③ 受检集合为空时反向核对：diff 里明明有本面扩展名的文件却得到空清单，就是失败而不是跳过；④ 门禁输出必须区分「跳过（零受检对象）」与「通过（受检对象全过）」，跳过时打印受检对象数；⑤ 提交前做一次实拍：故意把一个必检文件改坏，确认门禁真的会红，而不是看它打印 passed。

## 验证
已观察：第一版实现下受检文件被全部滤空、门禁仍打印 passed；路径映射的多加前缀被修正后，这批文件重新进入 lint 清单（材料自述「已修复路径映射」）。未覆盖：修复后同一条提交的 lint 输出未逐字给出；「空清单」跳过分支与外层 passed 的措辞是否已改为可区分状态未核对；本条只覆盖提交前 lint 门禁一处，其它门禁是否存在同形的「空集即通过」分支未逐一检查。

## 影响与适用范围
本仓提交前 lint 门禁（`plugin/lib/git-gate-runner.js` 的 `stagedLintFiles` 与 `checkLint`，及其在 pre-commit 与 preflight 的调用点）中一切「先按路径过滤、再以零个受检对象判定无需检查」的场景；凡工具输出的路径基准与工具 cwd 不是同一目录（worktree 与 workspaceRoot 不同层、monorepo 子包、`git -C` 混用）的校验脚本均可能踩到。经验可信边界：只覆盖本条证据链所及的这一处 lint 门禁与其他门禁中同形的空集分支。

展开：最容易踩到的是「git 给出的路径基准」与「工具 cwd」不一致的场合，以及任何先按路径过滤、再以「零个对象」判定无需检查的门禁（lint、类型检查、用例选择器、审计扫描）。当门禁已改成空集即失败、或路径换算已改为显式基准后，本条触发条件不再成立，应重审。
