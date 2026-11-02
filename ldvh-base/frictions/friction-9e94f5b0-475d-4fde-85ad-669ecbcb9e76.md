---
title: Git Gate 误把代码/测试当载体致自身无法提交
status: resolved
phenomenon: Git Gate 的守门范围误把任意非 docs 文件（含代码与测试）当规范/事实载体，使验证规则的测试自身触发规则，改动无法通过自有守门；代理通过将范围收窄到 spec/fact 载体修复
relations:
  - relation_key: informs
    target:
      commit: a43883fe5768c480fd49c3f1dacdb06f27021a6b
object_uid: 9e94f5b0-475d-4fde-85ad-669ecbcb9e76
fact_type_key: friction
created_at: 2026-10-12T12:11:34.231Z
change_log:
  - at: 2026-10-12T12:11:34.231Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
  - at: 2026-10-13T21:23:27.934Z
    provider: ds41
    model: deepseek-v4.1-flash
    summary: 销账（Human 2026-10-14 授权）：守门范围已按条文收窄为规范与事实载体，代码/测试不再被当载体；解药为直提路径修复 a43883f，依 02 §8.1 commit 形态承载 informs
  - at: 2026-11-02T09:02:02.398Z
    provider: qoder-global
    model: qfmodel
    summary: 事实更正（非状态转换）——删除 impact 字段（26 §14.2 2026-11-02 存量处置）：影响评级分级制度经 Human 裁定取消，本对象为终态存量，经受控更正显式删除，正文与终态判定逐字不变。。终态判定未变：status/title/phenomenon/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter 值（两处例外，均为「字段之有无」而非「字段之值」：① 2026-10 起可显式删除已退出类型闭集的字段，本次删除：impact；② 2026-11 起可补填新进入类型闭集的字段，本次补填：无），不得改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：Human（老丁）2026-11-02 会话指令「摩擦取消 中 轻 重 这种分级制度」，经 26 §8 撤销 impact 字段、§14.2 登记存量处置口径；本条授权仅覆盖删除该 frontmatter 字段，正文与终态判定逐字不变。
occurrence:
  count: 1
  first_at: 2026-10-12T12:11:08.519Z
  last_at: 2026-10-12T12:11:08.519Z
---

# Git Gate 误把代码/测试当载体致自身无法提交

## 现象
Git Gate 的守门范围误把任意非 docs 文件（含代码与测试）当规范/事实载体，使验证规则的测试自身触发规则，改动无法通过自有守门；代理通过将范围收窄到 spec/fact 载体修复

## 入账依据
守门检查范围过宽：把本应按条文限定于「规范或事实载体」的范围扩大到了任意非 docs 文件，连验证该规则的测试与代码注释都算作主张载体，导致合规改动无法提交自身，是一个真实的设计缺陷

## 处置
解药为提交 `a43883fe5768c480fd49c3f1dacdb06f27021a6b`（直提路径修复，无对应的 ADR/WorkCase 事实对象，故依 02 §8.1 commit 形态承载 informs）：`plugin/lib/commit-validation.js:227` 新增 `isSpecOrFactCarrierPath()`——仅 `README.md`、`specs/**`、`ldvh-base/**` 为真，消费点 `:252` 据此跳过实现载体；09 §5.3 第 5 项条文同步明定「检查范围限于规范载体与事实载体……代码、测试、构建脚本等实现载体不在其列——其对 `docs/` 的提及属实现注释与用例夹具，不构成『以 `docs/` 为权威依据』的主张」。

核验（2026-10-14，第 0 批-核验销账）：按类全载体扫描确认「载体类限定」只有这一处；其余检查（`validation/key_change_unmatched`、`validation/staged_path_uncovered`）刻意作用于整份 staged diff（06 §6.1 K1 双向覆盖，规范所以，非范围过宽），不属本账所指的形态。修复落地后 plugin 套件 1444/1444 通过，其中含该检查的 13 个新用例（正则边界、存量豁免、范围限定与规则注册），即「验证规则的测试自身触发规则」这一现象已由用例面直接证否。
