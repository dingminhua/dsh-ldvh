# A1 单点可行性实测：事实源写入能否进入宿主的 `ctx.fs` 链路

> **性质**：**实验记录**（只读探测 + 一次性 Node 探针；未改动 LDVH 代码或 `specs/`）。
> **日期**：2026-10-03｜**宿主**：`0.2.0-rc.2`（`dsh-v0.2.0-rc.2` / `639ed01539`）
> **问题**（承 `docs/experiment-a1-fs-guard-2026-10-03.md`）：上一轮判定 A1「语义不等价 ⇒ 不该换接」。**Human 指出该推论有误**——「不合拍」的真问题是 LDVH 自造路径**绕过宿主的观察状态机**。本轮实测回答：**事实源写入能否接入该链路、接入后与 CAS 基准能否共存。**
> **结论（先行）**：**能接入、能共存，且实测复现了「绕过」导致的具体坏后果。** 上一轮「不该换接」的判断**应予更正**为「**换通道、留基准**」。

---

## 1. 宿主的写入不是"一个函数"，而是一条有状态的链路

读源码（`packages/fs/tool-fs/src/write.ts:112,115,118,125`、`packages/fs/fs-observation-policy/src/index.ts:65-70,119`、`packages/fs/fs-local/src/index.ts:208-223`）得完整写序：

```
1. ctx.fs.resolve(path, {cwd})            → 稳定的 FsTarget（同一文件同一 targetKey）
                                            write.ts:112
2. ctx.waterfall('fs/write-intent', ...)  → 门禁给出 intent：
      未观察过    → { kind: 'createIfAbsent' }   ← 拒绝盲写
      已观察过    → { kind: 'replaceIfVersion', version }
                                            write.ts:115；gate index.ts:65-70
3. ctx.fs.writeText(target, content, intent, signal, sandboxPolicy)
      → 每目标 withLock + 原子发布；
      → 版本不符抛 FS_STALE_VERSION / 未观察抛 FS_NOT_OBSERVED
                                            write.ts:118；fs-local index.ts:208-223
4. ctx.emit('fs/observed', target, { kind:'present', version: outcome.version }, exec)
                                            write.ts:125
```

**关键**：`fs/observed` 由**写入方自己发出**（第 4 步），门禁的"已观察"状态由**读/写双方共同维护**。因此**任何绕过该链路的写入，都不会更新门禁的观察记录**。

## 2. 实测（复刻宿主口径，一次性探针，已删除）

复刻 `versionOf`（`dev:ino:size:mtimeNs:ctimeNs`）与门禁 `writeIntent` 的两个分支，在**事实源同型路径**上跑四个场景：

| 场景 | 结果 |
|---|---|
| ① 新建（未观察） | 观察 `absent` ⇒ intent = **`createIfAbsent`**（盲写被拒的设计位） |
| ② 写入后观察 | intent = **`replaceIfVersion`**（带上刚观察到的版本） |
| ③ **旁路写入**（模拟 LDVH 现用 `node:fs` 直写）后用旧版本写入 | 旧 version **≠** 当前 version ⇒ 宿主的 `replaceIfVersion` 会以 **`FS_STALE_VERSION` 拒绝** |
| ④ 同时取内容指纹与版本 | 指纹 `47531e9918bf69a4` ｜ version `16777230:95479226:18:…`——**两者独立并存** |

**③ 正是 Human 所担心的"不合拍"的具体形态**：LDVH 用 `node:fs` 改了一个事实对象，宿主的门禁**不知道**；此后 agent 再用宿主的 fs 工具写同一文件，会拿一个**陈旧版本**去比对，**表现是"莫名写不进去"**（`FS_STALE_VERSION`），而根因在 LDVH 绕过状态机。

**④ 证明共存可行**：`content_fingerprint`（SHA-256，`specs/03:143` 要求绑定完整内容）与 `FsVersion`（过期检测令牌）**回答两个不同问题**，同一次写入可以同时持有一一这不冲突。

## 3. 对上一轮结论的更正

| 上一轮的表述 | 更正后 |
|---|---|
| 「A1 **语义不等价** ⇒ **不该换接**」 | **语义不等价成立**（`FsVersion` ≠ `content_fingerprint`），但**推论错误**：「用什么 API 写盘」与「CAS 基准是什么」是**两件独立的事**。正确结论是「**换通道、留基准**」 |
| 「收益只剩每目标 `withLock` 一项」 | 收益不止锁：**接入后宿主的观察状态机才真正看到 LDVH 的写入**——这是"合拍"的承重点，比锁重要 |
| 「写入路径维持自造是合理选择」 | 不成立。自造路径的代价是**长期与宿主状态机不一致**，且宿主演进时不会被通知 |

**推断错误的成因（如实记录）**：我把"两个版本令牌不等价"与"两条写入通道不可换"当成一件事，用一个正确的前提推出了错误的结论。

## 4. 换接的技术形状（已确认可行）

**换接点已定位**：`plugin/lib/spark-writer.js:609` 的 `atomicWriteFile(filePath, content)` —— 6 个 writer 各有一份同型实现。

**为何当前接不上**：writer 是**纯函数层**，`atomicWriteFile` 作用域内无 `ctx`；`ctx` 在更外层（`registerSparkTools(ctx, deps)`，`spark-tools.js:806`），但它调用 `createSparkObject({...})`（`:396`、`:416`）时未把 `ctx`/`fs` 传入。

**可行形状**（**共存而非替换**）：

```js
// 目标形状（示意，未实施）
async function atomicWriteFile(filePath, content, fsPort) {
  if (fsPort) {                       // ← 新：有宿主入口就走宿主链路
    const target = await fsPort.resolve(filePath);
    const intent = await fsPort.waterfall('fs/write-intent', target);
    await fsPort.writeText(target, content, intent);
    return;
  }
  // ← 旧：无宿主入口时保持原自建路径（回退）
  …
}
```

`content_fingerprint` 的**计算位置与算法完全不变**（仍在内容生成后由 LDVH 自算 SHA-256），故 `specs/03` 的 CAS 基准不受换接影响。

## 5. 未做 / 未证实

| # | 项 |
|---|---|
| U1 | **未在真实 host ctx 上试跑**——本探针复刻的是宿主**源码口径**，未在运行宿主里注入 `ctx.fs` 实测（需改代码接线，属下一步） |
| U2 | 未实测 `ctx.fs.resolve` 对**项目内事实源路径**的 `cwd` 解析（LDVH 的路径来自 `factSourceRoot`，需确认与 `sessionResolveOptions` 的 `cwd` 一致） |
| U3 | 未确认 `sandboxPolicy` 在 LDVH 运行环境（`danger-full-access`）下是否需要显式传入 |
| U4 | 未评估换接后**写后回读**语义的替代：LDVH 现为"写完立刻读回逐字比对"，宿主 `writeText` 返回 `before/after` 但不做内容比对——需决定保留回读还是改用返回值 |
| U5 | 未验证 `createIfAbsent` 与 LDVH「创建前查重」纪律的一致性（方向上一致，未逐条核对） |
| U6 | 未评估 6 个 writer 的**平台差异**（宿主的 `fs-local` 处理权限位、符号链接、Windows DACL；LDVH 自建版未见对应逻辑） |

## 6. 建议的推进顺序

1. **单 writer 试跑**（spark，最小）：接线 `ctx.fs`，只在**有宿主入口时**走宿主链路，保留自建为回退。验证四条：①`resolve` 能否解析事实源路径；②`writeText` 在真实宿主的行为（含 `sandboxPolicy`）；③写后回读语义；④**写完后宿主的观察记录是否更新**（这是"合拍"的判据）。
2. **补守卫测试**：断言「经 LDVH 写入后，宿主的 `fs/observed` 记录随之更新」——这是把"合拍"变成可回归判据。
3. 逐 writer 推广（6 个），每个独立验证。
4. **更新 `specs/08` §6 的消费账**：fs 缝写侧由「未消费」改为「已消费」，并说明 `content_fingerprint` 仍由 LDVH 自持的理由（语义不同，非未消费）。

---

**本记录为只读探测产出**：未修改 `plugin/` 与 `specs/`、未创建事实对象；探针目录 `/tmp/a1f` 已删除。
