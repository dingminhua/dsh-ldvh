# A1 前置实测：宿主 `ctx.fs` 版本守卫能否替代 LDVH 的 content_fingerprint CAS

> **性质**：**实验记录**（只读探测 + 一个一次性 Node 探针；未改动 LDVH 代码或 `specs/`）。
> **日期**：2026-10-03｜**宿主**：`0.2.0-rc.2`（`dsh-v0.2.0-rc.2` / `639ed01539`）
> **问题**（承 `docs/audit-wheel-census-full-2026-10-03.md` A1）：6 个事实写入器用 `node:fs` 自建原子写、未走宿主的 `ctx.fs.writeText` 版本守卫。**换接是否可行、是否等价？**
> **结论（先行）**：**部分可行、不等价**。宿主 `FsVersion` 是**过期检测令牌**（opaque，且语义上"不得解释"），**不是内容指纹**；而 `specs/03` 要求 `content_fingerprint` 绑定**完整内容**。**故不能整体替换**——但宿主写入路径仍有可取的**原子性与并发锁**。

---

## 1. 两边的语义（源码核验）

### 1.1 宿主 `FsVersion`

| 项 | 内容 |
|---|---|
| 声明 | 「**Opaque file-version token** — the freshness token a write/edit guards against. The local backend derives it from **high-resolution stat identity and freshness fields**… consumers may display related metadata but **MUST NOT interpret this token**」（`packages/fs/fs/src/types.ts:28-34`） |
| 本地后端取值 | `FsVersion(\`${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}\`)`（`packages/fs/fs-local/src/fsio.ts:75-77`） |
| 用途 | `writeText(target, content, expected?: FsWriteIntent)`；`expected.kind === 'replaceIfVersion'` 时比对版本，不符抛 **`FS_STALE_VERSION`**；另有 `createIfAbsent`（防盲写，未读先写抛 `FS_NOT_OBSERVED`）（`fs-local/src/index.ts:214-223`） |
| 原子性 | 文档承诺「**Atomically** create or replace UTF-8 text」；实现为每目标 `withLock` + 宿主自己的 `writeFileAtomic`（`:208`、`:239`） |

### 1.2 LDVH `content_fingerprint`

| 项 | 内容 |
|---|---|
| 算法 | **SHA-256 内容哈希**：`createHash("sha256").update(content, "utf8").digest("hex")`（`spark-writer.js:574`） |
| CAS 流程 | 读对象 → 算指纹 → 与调用方给的上次观察比对 → 不符返回 `spark/cas_conflict`（`spark-writer.js:953-957`） |
| 规范要求 | `specs/03:143`：「`content_fingerprint` 是受控读写使用的**完整当前载体指纹**：它**绑定**当次实际 Working Tree 中对象 canonical 载体的**完整内容**……**不得以对象重新序列化、缓存摘要或 AI 自述替代实际载体指纹**」 |

## 2. 实测（一次性探针，已删除）

复刻宿主 `versionOf` 口径与 LDVH 的 SHA-256，对同一文件做三种操作：

| 操作 | 宿主 `FsVersion` | LDVH SHA-256 |
|---|---|---|
| 写入 A | `…:21:1791013559783805924:…` | `2e27fbb1…` |
| 改写为**不同长度**的内容 C | **变化** | **变化** |
| 改写为**同长度**内容 B + 把 `mtime` 拨回旧值 | **仍变化** | **仍变化** |

**关键观察**：第二次实验中，`mtimeNs` **未能拨回**（`utimes` 后 `stat` 读回的 mtime 与目标值不同），且 `ctimeNs` **必然变化**（内核维护，用户态不可回拨）。

⇒ **推翻了我先前的推断**（我原以为"同长度改写 + 时间戳复原"能让 `FsVersion` 漏判）。实测表明：**`FsVersion` 作过期检测是可靠的**——任何真实写入都会改变该 token。

**但它仍然不是内容指纹**，证据在**声明层**而非行为层：宿主明文规定该 token 是 opaque 的、消费者「**MUST NOT interpret**」、只用于 stale 检查；它**回答不了**「当前内容是否就是我读到的那份」这个问题——而 `specs/03` 的 CAS 要的正是后者。

## 3. 判定：部分可行、不等价

| 能力 | 宿主 `writeText` | LDVH 自建 | 可否替代 |
|---|---|---|---|
| **写入原子性** | ✅ 承诺原子 + `writeFileAtomic` + 每目标锁 | ✅ 临时文件 + 回读比对 + `rename` | **可替代**（宿主更强：多了锁） |
| **过期检测**（"文件是否被动过"） | ✅ `FS_STALE_VERSION`（含 `ctimeNs`，实测可靠） | ✅ 内容哈希比对 | **可替代**（但语义不同，见下） |
| **内容指纹**（"内容是否为 X"） | ❌ **不提供**（opaque，且禁止解释） | ✅ SHA-256 | **不可替代** |
| **写后回读** | ✅ 返回 `{operation, version, before, after}` | ✅ 自建回读比对 | 可替代 |

**结论**：
- **不可整体替换**——`specs/03:143` 要求的 `content_fingerprint` 必须由 LDVH 计算并绑内容；宿主的 `FsVersion` 不能满足，且**不得**拿它冒充（那正是 03 禁止的「以缓存摘要替代实际载体指纹」）。
- **可部分采纳**——宿主的**原子写 + 每目标锁**比 LDVH 自建更强（自建版无锁，`spark-writer.js:611-621` 的注释也承认只靠随机 tmp 后缀避免并发 clobber）。**可行的折中**：写入经 `ctx.fs.writeText` 获得原子性与锁，**同时**由 LDVH 自行计算并绑定 `content_fingerprint`（两者并存，各司其职）。

## 4. 由此更正普查 A1 的两处表述

上一份普查（`docs/audit-wheel-census-full-2026-10-03.md`）A1 中：
1. **「不防『读后他方改动』」——不准确**：宿主 `FsVersion` 实测能可靠检测他方改动；LDVH 现在的 SHA-256 同样能。**两者都能**，差别不在"能不能检测"，而在**令牌的语义可解释性**（内容指纹可回答"内容是否为 X"，`FsVersion` 不能）。
2. **「应换接」——应收窄为「部分换接」**：换的是**写入的原子性与锁**，不是 CAS 基准。CAS 基准（内容指纹）必须由 LDVH 保留。

## 5. 未做 / 未证实

| # | 项 |
|---|---|
| U1 | 未实测 `ctx.fs.writeText` 在**真实 LDVH 写入点位**上的行为（本次只做语义与探针级对照，未接线试跑） |
| U2 | 未验证宿主 `writeFileAtomic` 与 LDVH 自建版在**权限位保留**（`existing?.mode`）、符号链接、Windows DACL 上的差异（宿主的 `fs-local` 有这些处理，LDVH 自建版未见对应逻辑） |
| U3 | 未评估换接对 6 个 writer 的**写后回读语义**（LDVH 的回读是"内容逐字比对"，宿主返回 `before/after` 但不做内容比对）的连带影响 |
| U4 | 未测 `sandboxPolicy` 参数在 LDVH 运行环境下的实际取值（宿主 doc 称"a bare backend ignores it"） |
| U5 | 本次为**静态语义 + 一次性探针**，未做端到端写入测试 |

## 6. 建议

1. **A1 不宜作为"换接轮子"处理，而应作为"补强"处理**：写入路径可经 `ctx.fs.writeText` 获得宿主级原子与锁，但 `content_fingerprint` 必须由 LDVH 自算自绑——**两者并存**，不是替换关系。
2. **优先级下调**：既然 CAS 基准本就必须自持，A1 的收益从"消除自造轮子"降为"增强原子性与并发安全"。**它不再是"宿主已有而我们自造"的典型，而是"宿主有一半、我们需要另一半"。**
3. **顺带登记一处真实差距**：LDVH 自建原子写**无锁**（仅靠随机 tmp 后缀避让），宿主的每目标 `withLock` 更强。若要提升并发安全，这是**明确该采纳宿主的点**。
4. **`specs/08` §6 该行的状态应如实更新**：不是"半消费待补"，而是"**写侧不在本期采用（语义不等价），故该缝的写侧维持未消费**"——须按该节纪律如实报告，不得主张版本屏障已生效。

---

**本记录为只读探测产出**：未修改 `plugin/` 与 `specs/`、未创建事实对象；探针目录 `/tmp/a1-probe` 已删除。
