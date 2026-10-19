---
title: 机械通道只校验 commit 格式致死链接入账
status: resolved
phenomenon: 摩擦 relations / evidence_locator 里的 commit 引用只做 40 位十六进制格式校验，两个在本仓库与 remote 中都不存在的 hash 仍能入账并在界面渲染为死链接。
impact: medium
relations:
  - relation_key: informs
    target:
      commit: c465d9c762f105ae83884ea1922866573c9f05a2
object_uid: b2bec775-2814-405c-8398-e37bf7bf0afd
fact_type_key: friction
created_at: 2026-10-18T19:58:10.597Z
change_log:
  - at: 2026-10-18T19:58:10.597Z
    provider: go
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
  - at: 2026-10-18T20:03:53.571Z
    provider: go
    model: space-bunny
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
  - at: 2026-10-18T20:15:52.341Z
    provider: go
    model: space-bunny
    summary: 补充观察：count 2 → 3（36 §9 第 2 项）
  - at: 2026-10-18T20:15:52.345Z
    provider: go
    model: space-bunny
    summary: 阈值流转 observing → open（count 3 ≥ 3，36 §9 第 4 项）
  - at: 2026-10-19T03:09:30.616Z
    provider: go
    model: space-bunny
    summary: 补充观察：count 3 → 4（36 §9 第 2 项）
  - at: 2026-10-19T04:07:42.620Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 销账：commit 引用可解析性校验已三路径闭合并实测生效，open → resolved
occurrence:
  count: 4
  first_at: 2026-10-18T19:57:52.999Z
  last_at: 2026-10-19T03:06:22.770Z
  human_return_at: null
---

# 机械通道只校验 commit 格式致死链接入账

## 现象
摩擦 relations / evidence_locator 里的 commit 引用只做 40 位十六进制格式校验，两个在本仓库与 remote 中都不存在的 hash 仍能入账并在界面渲染为死链接。

## 入账依据
可归因到唯一一处判定——写入侧第 243 行仅做 `COMMIT_PATTERN.test(target.commit)`；只要把这一处改为先在仓中解析 hash 再放行，同类账目会在写入当场被拦下，不必等到界面上出现死链再逐条回查来源。

补充观察（2026-10-18T20:03:33.504Z）：材料 turn 6 的现象与既有账目 uid=b2bec775（机械通道只校验 commit 格式致死链接入账）是同一阻碍：机械层对 relations[] 里 informs 指向的 evidence_locator.commit 只做 40 位 hex 格式判断便放行，致不存在的 hash 写入事实源、界面渲染为死链接。材料给出的机械证据与该账目描述逐项吻合——同一 commit 字段、同一格式校验、同一死链接后果——非新阻碍，故判 same-obstacle 而非 new-obstacle。turn 7 中助手对该 hash 做了数据更正并在 git-gate-runner.js 与 ldvh-tools.js 两个入口补 git 解析拦截，属同一阻碍的处置，不构成第二笔账目。须说明：材料因长度上限被截断（turn 6 末尾断在「这两个 commit 位于**另」，turn 7 中出现 `</excerpt>` `</parameter>` 残留并断在「用 git stash 对照：」），全量回归结果尚未落定，但上述同一性判定所需的关键原文已在材料内完整出现，不受截断影响。

补充观察（2026-10-18T20:15:08.143Z）：引证出自材料 assistant 的「## 结论三」标题行：提交 message 里以 friction-41a43496: 引用的那份摩擦载体至今不在仓库里，且没有任何规则看这一眼。该现象与既有账目 b2bec775-2814-405c-8398-e37bf7bf0afd「机械通道只校验 commit 格式致死链接入账」是同一阻碍：机械通道只放行格式合规的 message，message 正文里引用的摩擦载体本身从未进入任何一笔提交（材料叙述 git log --all 与 git ls-tree 均零条、git status 显示为未跟踪），死链照样随提交入账且无人拦截；材料结论二（Git Gate 入口 grep -c signature = 0，只做 validateMessage 结构检查，与 precheck 入口的 checkSignatureAgainstRoute 不等价）是同一根机制的另一表现——Gate 校验形式而不校验语义取值。故判 same-obstacle 并命中该 uid，不另立新账目。本材料因长度上限被截断（末句断在「但**它从未进入任何一笔提交」处），结论三之后若另有现象不在本次观察范围内，故未据未见部分立账。

补充观察（2026-10-19T03:06:22.770Z）：材料仅含 turn 9 一轮，且在「六、远比我关心的问题」表格中途截断（止于「09 §5.1：precheck 与」），我只能就所见部分判断。可见部分中，构成系统性阻碍且可归因的，是「③ 依据对象可解析」这一缺口：规范要求 message 引用的摩擦对象须存在，机械校验实际「只抽关键变更里的 UUID/hash」，被引用的 friction-41a43496 既不在扫描面内又至今未入 git，机械通道因此未能拦住一条悬空引用，而提交 message 结构本身逐条合规放行。这与既有账目 uid=b2bec775-2814-405c-8398-e37bf7bf0afd（open）「机械通道只校验 commit 格式致死链接入账」是同一阻碍——同一对象（提交 message 的机械校验）、同一缺口（只做标识符/格式层面的校验、不校验引用对象可解析性）、同一后果（悬空摩擦引用凭格式合规通过），故判为同一账目的又一次出现，不新建条目。另两处缺口我不据此新建：②「Gate 全文无签名取值校验」虽被材料称为「规范声称有终闸，实际没有」，但其机制（终闸未实现规范要求的取值来源校验）与我所见唯一一条以「终闸」命名的账目 uid=1fa58a01「终闸触发与取值同源于被检查方」（取值源自身信，而非缺项）不同，且该段证据在材料中被截断，不能确定；「中文只有契约强制的那部分受保护」与 uid=257f5046「机械判据未覆盖的属性在修轴中静默漂移」仅部分相似（材料所述漂移发生在一次提交中，而非修轴过程中），材料也未把它单列为阻碍。我不对任何账目该不该修、该不该销账或影响评级作判断，那些不在本机制权限内；因材料截断，截断部分是否另有未记录阻碍，我照实声明无法判断，不作推测。

## 处置
定位（2026-10-19）：本条入账依据所指的那处判定（写入侧「仅做 `COMMIT_PATTERN.test`」）**已在 HEAD 中不存在**。三条路径现在都做可解析性校验：
- update 路径 `plugin/lib/friction-writer.js:746-755`：`target.commit` 与 `evidence_locator.commit` 两处来源的 hash 都过 `gitCommitResolver`，无 resolver 时 fail-closed；
- correct 路径 `plugin/lib/friction-writer.js:958-968`：同口径；
- create 路径不适用——`friction-writer.js:511` 明确拒绝 create 携带 relations（26 §11：informs 只随 resolved 流转挂载）。

另两个入口也已接同一校验器：Git Gate `plugin/lib/git-gate-runner.js:370`（以 `git cat-file -e <hash>^{commit}` 作 resolver）、预检 `plugin/lib/ldvh-tools.js:669`。校验器本体是 `plugin/lib/commit-validation.js` 的 `checkFrictionCommitTargets`，无 resolver 时同样 fail-closed。

不重复建第二套判定（09 §5.5 同一 validator）：调用方注入 resolver，writer 不自行执行 git。

实测验证（2026-10-19，本次销账操作中自然发生）：给本条写销账时，`relations[].target.commit` 因凭记忆填写、后半段有误，写入被以 `friction/relation_target_unresolvable: commit c465d9c6... does not resolve to an existing commit in this repository` 直接拒绝，未落盘。用 `git rev-parse HEAD` 取得真值 `c465d9c762f105ae83884ea1922866573c9f05a2` 后才写入成功。这正是本条所要求的「写入当场拦下」在真实操作中生效。

边界（据实声明）：本条所记的**对象**是 relations / evidence_locator 里的 commit 引用，这一面已闭合。同一载体中第三、第四条补充观察另外记下了一类相邻缺口——提交 message 正文引用的摩擦载体本身不入仓库、机械通道不查其可解析性——那属于提交消息校验面，与本条的 commit 引用面不是同一个可修位置，未在本次处置范围内，如仍成立应由独立账目承载。销账只就本条现象（commit 引用死链）作出。

销账依据：所记现象的可修位置已全部改为 fail-closed 并有正向/反向用例覆盖（`plugin/test/friction-writer.test.mjs` 的 target.commit 与 evidence_locator.commit 两路，各含不可解析、无 resolver、正向放行三种形态）。解药分散在多次受控提交中、没有单一对象身份，按 26 §9.2 的 commit 例外以本次核对所依据的提交登记（见 relations）。
