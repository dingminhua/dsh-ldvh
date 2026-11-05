---
title: 候选指纹计入可省略初态致写拒并重复提问
status: active
scope: 适用于 LDVH create 类受控写入的候选指纹比对与 21 §6.3 路由答复复用：凡调用方可省略、且取值由 Code 钉死的初态字段被计入指纹时，同一候选在预检与写入之间的两种等价写法会被判为不同内容，进而拒绝写入并以失配的键重问 Human。边界：本条只覆盖 status 这一可省略初态例外；其余调用方可控且会逐字落盘的字段（如 change_summary）仍须纳入指纹，不在放宽范围内。
object_uid: 636bdb3b-3fcd-4024-ad1a-cf37b664063f
fact_type_key: pitfall
created_at: 2026-11-04T15:12:46.165Z
change_log:
  - at: 2026-11-04T15:12:46.165Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累·审核段据缓冲条目 7200455e-be10-456f-8dbd-9f8e4d7ab347 形成候选（11 §10.2 第 3 项）
---

# 候选指纹计入可省略初态致写拒并重复提问

## 症状

建单请求在第一次已取得 Human 路由答复后，写入步骤仍被拒并返回 `workcase/candidate_changed`，随后同一候选被再次路由询问。逐字引证：

```
写入时却报 `workcase/candidate_changed`，于是重跑预检、再问一次
来源：本次材料 turn 2 的 assistant 回复「机制 A · 指纹把可选字段算成内容」段；同回复正文给出的取证位置为 plugin/lib/workcase-writer.js:2466 的 computeCreateCandidateFingerprint 确定性比对，以及 ~/.dsh/ldvh/workcase-route-decisions.json 中 20:54 / 20:59 两条同 request 的账目记录
```

## 触发条件

- create 候选的预检与写入由两次不同拼装提交：一侧省略可省略的初态字段 `status`，另一侧显式写 `status: "draft"`；
- 该字段的取值最终由 Code 钉死（21 §9：create 只能以 draft 出生，其它值由校验器拒绝）；
- 路由答复以候选内容指纹为复用键（`workcase-route-ledger.js`）。

反例（不触发）：两侧提交同一份 draft；或变化的是会逐字落盘的 `change_summary`／`gist` 等字段——此时 `candidate_changed` 是正确拦截，不属本机制。

## 根因

`computeCreateCandidateFingerprint` 把调用方 draft 的全部字段（含 `status`）纳入 sha256，而 create 把初态钉死为 `draft`：省略 status 与显式写 `status:"draft"` 会落成同一个对象，却算出两个不同指纹（实测 `c6dad294…` 与 `f0a3b48f…`）。该指纹同时是写入侧 `candidate_changed` 的比对基准和路由账本的复用键，因此一处「等价写法被当成不同内容」同时制造两个后果：① 写入被拒；② 已答答复不被复用，同一问题被原样再问一遍。更深一层，「候选内容身份」的定义混入了「由 Code 决定、调用方可省略」的字段，使身份函数与对象身份不一致。

## 解决

在 `computeCreateCandidateFingerprint` 中把 `status` 作为唯一例外剥离后再算指纹；`change_summary` 等其余调用方可控且会落盘的字段仍保留。非 `draft` 的 status 不因剥离而放行：仍由预检与写入共用的 `evaluateCreateCandidate` 以 `initial_state_violation` 在两条路径上分别拒绝。成功信号：预检不带 status、写入带 `status:"draft"` 时指纹相同且写入放行；同一候选重试命中 route ledger 并标为 reused，不再向 Human 提问。

## 规避

核对条件：一次 create 的预检与写入若由不同次调用拼装，且 draft 中存在「省略 vs 显式默认值」差异，先确认该字段是否由 Code 钉死。

动作：
1. 把 precheck 返回的 `candidate_fingerprint` 传给写入侧作 `expected_candidate_fingerprint`；
2. 收到 `candidate_changed` 时，先比对两份 draft 是否只差可省略初态（status），不要立即重跑预检并向 Human 再问一次；
3. 确认只是等价写法差异后，按同一内容重试写入；路由侧应据同一指纹复用既有答复。

例外：字段真正参与落盘内容（change_summary、gist、serves 等）或取值不由 Code 钉死时，差异必须按 `candidate_changed` 拒绝，不得以本条为由放宽。

## 验证

已观察（2026-11-04，本仓）：
- `~/.dsh/ldvh/workcase-route-decisions.json` 中 2026-11-04T12:54:45Z（本地 20:54）与 12:59:36Z（本地 20:59）两条记录为同一句 78 字符 request，指纹分别为 `c6dad294…` 与 `f0a3b48f…`，与代码注释所记现场一致；
- `plugin/test/workcase-precheck-create.test.mjs` 的两条回归用例实测通过（`node --test`：2 pass / 0 fail）：省略 status 与显式 `status=draft` 同指纹且写入放行；改 `gist` 并补 status 仍返回 `workcase/candidate_changed`。

未覆盖：
1. 修复目前只在工作树中（`plugin/lib/workcase-writer.js` 未提交），未在宿主真实会话复跑完整「预检→路由→写入」链路，只做了指纹与写入用例；
2. 其他 writer 的 create 指纹是否同样计入可省略初态，未逐一核对；
3. 账本两条记录只能证明同 request 被问了两次，无法从账本本身量化重复提问造成的注意力损失。

## 影响与适用范围

适用于 LDVH create 类受控写入的候选指纹比对与 21 §6.3 路由答复复用：凡调用方可省略、且取值由 Code 钉死的初态字段被计入指纹时，同一候选在预检与写入之间的两种等价写法会被判为不同内容，进而拒绝写入并以失配的键重问 Human。边界：本条只覆盖 status 这一可省略初态例外；其余调用方可控且会逐字落盘的字段（如 change_summary）仍须纳入指纹，不在放宽范围内。

任何经 `ldvh_workcase_write(action=create)` 建单、且预检与写入分两次拼装提交的场合都可能踩到；经验可信的前提是指纹仍以「调用方可省略且由 Code 钉死的初态」为唯一例外，其余字段仍受同一一致性约束。若指纹算法、create 初态规则或路由账本的复用键改变，本条须重新核对。
