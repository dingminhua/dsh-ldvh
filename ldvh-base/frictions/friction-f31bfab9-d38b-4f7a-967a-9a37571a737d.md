---
title: README 悬空 docs 引用未被机械拦下
status: open
phenomenon: plugin/README.md 第 59 行指向的 docs 目录校验记录文档在仓库中不存在（git ls-files docs 为 0），该悬空引用仍留在受保护文档中且此前未被任何检查拦下。
attribution: 受控提交与机械守护门禁的 docs 引用检查（specs/09 §5.3 第 5 项）适用范围限于 specs/**、ldvh-base/** 与仓库根 README.md，不含插件市场页 plugin/README.md，故该页的悬空引用不在任何机械检查的覆盖内；存在性校验本身是有的，缺的是该路径的覆盖。
object_uid: f31bfab9-d38b-4f7a-967a-9a37571a737d
fact_type_key: friction
created_at: 2026-11-04T05:29:37.458Z
change_log:
  - at: 2026-11-04T05:29:37.458Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-04T05:49:55.552Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 3 → 4（11 §9 第 2 项）
occurrence:
  count: 4
  first_at: 2026-11-03T11:28:38.167Z
  last_at: 2026-11-04T05:31:28.755Z
---

# README 悬空 docs 引用未被机械拦下

## 现象
plugin/README.md 第 59 行指向的 docs 目录校验记录文档在仓库中不存在（git ls-files docs 为 0），该悬空引用仍留在受保护文档中且此前未被任何检查拦下。

**归因订正（2026-11-04，主控核实）**：本账目原登记「检查只核形式、不核存在性」，经实测代码该说法不成立——`checkDocsReferences` 一直以候选树路径集合解析被引目标的存在性（`commit-validation.js` 的 `exists: (p) => candidatePaths.has(p)`），悬空引用会被判 `validation/docs_reference_dangling`。悬空引用本身属实（文件确已随 ec19ba6 删除），但**未被拦下的原因是范围不含 plugin/README.md**，而不是缺少存在性校验。`:325` 的 `isSpecOrFactCarrierPath` 只认仓库根 `README.md` 与 `specs/`、`ldvh-base/`，插件市场页不在其内。故本条若要真正消解，改的是**检查范围**（属 specs/09 §8.1 第 2 项的领域增量，须 Human Gate），不是再加一条存在性校验。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-11-03T11:28:38.167Z，session-de17289f-42ab-41bd-9177-8125557f14b3 @ 13）根位在 `plugin/lib/git-gate-runner.js:535`：`mainPreCommit` 调用 `runSharedChecks(root, indexFile)` 时**漏了第三个参数 `message`**。
（来源：13）
2. （2026-11-03T12:37:21.514Z，session-de17289f-42ab-41bd-9177-8125557f14b3 @ turn 7..13）消息里明明有可解析引用 `abe1820`，pre-commit 照样拒。
来源：主控会话 turn 13 助手回复（本次观察材料窗口内）
3. （2026-11-04T04:40:28.007Z，session-c2428bdb-d83a-4442-acb7-3ee07ad15ed3 @ 1）plugin/README.md 第 59 行指向 docs 目录下的 governed-project-lifecycle-verification.md；git ls-files docs 为 0，文件已不存在
（来源：1）

## 入账依据
该悬空引用可被读者当场核验失败（指向的文件不存在），其根源在于受控提交门禁的 docs 引用检查**范围不含 plugin/README.md**，而该页正是 00 §4.3 受保护文档中的插件市场页（10 §7.6 登记的两条 README 路径之一）——受保护文档却落在检查范围之外，这一缺口可被具体指出，补上范围即可消除此类悬空引用，预计会有明显改善。订正后的依据不再主张「缺少存在性校验」：该校验已存在且工作正常（见上方归因订正）。

补充观察（2026-11-04T05:31:28.755Z）：引证陈述了 15 条事实对象正文引用的是 docs/ 被清空时删掉的文档，同段紧接着说明其中 4 条把已不存在的《重建总纲》当作一手依据——这正是「悬空 docs 引用未被机械拦下」的又一实例，而非单点笔误。与既有账目比对：friction-f31bfab9 的归因落在受控提交与机械守护的 docs 引用检查的覆盖范围，本条同属该检查口径漏过的悬空引用，归因落点与机制模式相同，故按 26 §6.2 判为同一阻碍（命中 open 账目，交机械层补充计数），不另立新笔。需要说明的是：本条材料里这些悬空引用在事实上还连带「判据链已不可回查却仍留 open、被读成待办」的后果，若主控认为状态语义需单列，可在该账目补充更新时一并考虑；本次仍按根源归入既有账目，不按措辞另开。另：观察组 stale-spec-section-citation-in-
逐字引证：33 条 open 中 15 条的正文引用了随 ec19ba6（2026-10-12 清空 docs/）删除的文档
（来源：1）
