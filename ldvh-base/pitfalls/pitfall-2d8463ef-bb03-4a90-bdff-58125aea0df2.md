---
title: 已跟踪文件import未跟踪文件致纯净检出即崩
status: active
scope: 任何以 ESM/CJS 跨文件 import 引用新建文件、并把提交边界当作完整性载体的仓库。
object_uid: 2d8463ef-bb03-4a90-bdff-58125aea0df2
fact_type_key: pitfall
created_at: 2026-10-19T04:24:02.869Z
change_log:
  - at: 2026-10-19T04:24:02.869Z
    provider: go
    model: space-bunny
    summary: 闲时辅助经验积累（机械通道）于 2026-10-19T04:23:31.918Z 形成候选
  - at: 2026-10-27T18:17:13.962Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 独立复现验证通过（隔离子代理 59751938，与形成者同模型但上下文隔离）：纯净归档复现 ERR_MODULE_NOT_FOUND、补交提交 e6ca432 与机械检查 7577b2e 均在历史/HEAD 可核、注入未跟踪 import 后检查转红；据 Human 2026-10-28「验证属实即入档」逐条验收指示，draft→active 入档。
  - at: 2026-10-27T18:37:05.823Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: 机械化承载盘点登记（2026-10-28）：tracked-imports.test.mjs:71 的 git ls-files 索引判据；状态与 scope 不变（23 §9.3 补充级更新）。
---

# 已跟踪文件import未跟踪文件致纯净检出即崩

## 症状

仓库 HEAD 中的已提交模块在纯净检出（干净 worktree）上加载即报 `ERR_MODULE_NOT_FOUND`：`adr-tools.js` 通过 `import './object-reference.js'` 引用了一个未随该 commit 提交的文件。本地工作树一切正常，缺陷只在检出后暴露。

## 触发条件

在同一轮工作中新建了文件，又让另一个已跟踪文件 import 它；随后只提交了改动过的已跟踪文件。新建文件停留在未跟踪状态，import 关系却先行进入 HEAD。

## 根因

提交边界与 import 边界不对齐：提交 `e25dc43` 引入了对 `./object-reference.js` 的 import，却没有把该文件纳入同一次提交。两者关联没有任何机械约束，仅靠执行者每次提交时逐个暂存并记忆。

## 解决

（1）在纯净检出上复现并定位缺失模块后，把缺失文件单独补交，切断悬空引用；（2）新增一条机械检查，检测已跟踪文件是否 import 了目录中确实存在、但没有纳入 git 的文件，并配 `test/*.test.mjs` 用例。

## 规避

引入跨文件 import 的同一轮内，提交前用 `git status --porcelain` 确认新建文件已进入暂存区；提交后在干净 worktree 上加载一次受影响模块，把「纯净检出可加载」当作验收项，而不是以本地工作树能运行作为通过依据。

## 验证

已观察：纯净检出的 HEAD 上复现 `ERR_MODULE_NOT_FOUND`；补交缺失文件并安装依赖后，`adr-tools.js` 在纯净检出上可正常加载；新检查的变异测试中，注入一个指向未跟踪文件的 import 后用例立刻失败，说明判据具备可分辨力。未覆盖：同一批被引用的另外几个文件未在纯净检出上逐一验证；修复后跑全量测试出现 3 个失败，测试总数从 1681 变为 1626，原因在观察窗口结束时仍在排查。

独立复现验证（2026-10-28，入档前置）：复现主体为隔离子代理（独立上下文 session 59751938-eb68-42da-a4ee-f2102f9fd730），未参与本候选形成；独立性边界为与形成者同模型（dsh-opencode-go/deepseek-v4.1-flash）、上下文隔离。复现做法：`git archive e25dc43` 导出纯净归档后 `node --input-type=module -e "await import('.../plugin/lib/adr-tools.js')"`；核对 e25dc43 的 `git ls-tree` 无 `object-reference.js` 而 `adr-tools.js:30` 已 import；核对 HEAD 归档四个入口模块可加载；在 /tmp 临时仓库注入指向未跟踪文件的 import 后跑 `test/tracked-imports.test.mjs`。

观察结果：纯净归档上精确复现 `ERR_MODULE_NOT_FOUND: Cannot find module '.../object-reference.js'`；HEAD 归档的 adr/spark/pitfall/workcase 四模块全部加载成功；补交为提交 `e6ca432`（与 e25dc43 相隔 15 个提交），机械检查由 `7577b2e` 引入，注入未跟踪 import 后检查立刻转红（offender 为 `plugin/lib/adr-tools.js → ./ghost.js`）。复现未覆盖：候选所记「修复后全量 1681→1626、3 例失败」未复核（按纪律不跑全量套件）；只验证了加载面，未验证运行期行为。


**机械化承载（2026-10-28 盘点）**：`plugin/test/tracked-imports.test.mjs:71`（含 `:58` 的说明符提取与 `:104` 的空转自检）已把本条的规避实现为机械判据，断言已跟踪源文件的相对 import 目标必须出现在 `git ls-files` 索引中，指向未跟踪文件即失败。覆盖边界：只扫 `plugin/` 下的 `*.js` 静态 ESM；`plugin/scripts/*.mjs`、`plugin/web/*.cjs`、`require()` 与计算型动态 import 均不在扫描面（实测未跟踪的 `.mjs`/`require` 目标保持全绿），且没有「提交后在干净 worktree 加载模块」的 CI 判据。

## 影响与适用范围

任何以 ESM/CJS 跨文件 import 引用新建文件、并把提交边界当作完整性载体的仓库。影响特征：本地不可见，缺陷推迟到他人检出、CI 或干净环境才显现，表现为启动失败而非构建期报错。
