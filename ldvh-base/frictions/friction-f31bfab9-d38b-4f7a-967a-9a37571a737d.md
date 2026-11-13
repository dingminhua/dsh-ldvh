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
  - at: 2026-11-10T11:36:53.192Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
  - at: 2026-11-13T20:16:31.633Z
    provider: qoder-global
    model: qmodel_38max
    summary: 补充级更新（保持 open）：实例已消——README:59 被引文件已由 e94cab1f 重建且 git 跟踪、当前唯一 docs 引用可解析；机制缺口未动——09 §5.3 第 5 项范围句与 isSpecOrFactCarrierPath(:444) 均仍不含 plugin/README.md，受保护市场页的悬空引用照样不被拦；不销账（无可指解药、复发条件在），出路仍是范围领域增量须 Human Gate
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

补充级更新（2026-11-14，主控核查，**不构成销账**）：**现象所指的具体悬空引用已消失，但归因的机制缺口原样仍在，故状态保持 open。**

**① 实例已消（有据）。** plugin/README.md:59 现指向的 `../docs/governed-project-lifecycle-verification.md` 已存在且被 git 跟踪（该文件由 `e94cab1f`（2026-11-10）重建、`5463ff4a`（2026-11-14）更新，8200 字节）；本次核验 plugin/README.md 全部 docs 引用仅此一条且可解析。即：现象段「第 59 行指向的文档不存在」在当前树上已不成立。

**② 机制缺口未动（实测）。** 归因订正段指出的真因——docs 引用检查的范围不含 plugin/README.md——两处承载均未变：specs/09 §5.3 第 5 项明文「检查范围限于规范载体与事实载体（`specs/**`、`ldvh-base/**` 与仓库根 `README.md`）」；commit-validation.js 的 `isSpecOrFactCarrierPath`（现 :444）仍只认 `README.md`/`specs/`/`ldvh-base/` 三个前缀。受保护的插件市场页下次再写出悬空 docs 引用时，机械层照样不拦——本条阻碍「未被机械拦下」的机制完整存活，只是这一次恰好没有实例可拦。

**③ 不销账的理由与出路。** 不标 resolved：没有可指的解药——实例消失靠的是被引文件被重建（另一工作线的验收记录），不是检查范围被补上；「阻碍不再复现」不成立（范围缺口在，复发条件在）。不标 voided：承载面（09 §5.3 第 5 项 + isSpecOrFactCarrierPath）都还在，不是「无处可发生」。出路只有归因订正段已写明的那条：把 plugin/README.md 纳入检查范围，属 specs/09 §8.1 第 2 项的领域增量，须 Human Gate——AI 不得单方面改规范或扩实现范围，故本轮不动。
