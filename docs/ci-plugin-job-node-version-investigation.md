# CI `plugin` job 失败调查：Node 版本低于代码实际要求

> 目的：查明 CI `plugin` job 长期失败的根因，并给出可验证的处置选项。
> 性质：**调查报告，不具规范效力**，不改动任何代码或规范。结论以实测为准。
> 状态：仅调查，未修复。
> 日期：2026-09-13

## 0. 结论摘要

**单一根因：CI 使用 Node 20，而代码依赖 Node ≥ 22.15 才存在的 `node:zlib` zstd 导出。**

`plugin/lib/zstd-compat.js:26` 以**静态命名导入**引入 `ZstdDecompress`：

```js
import { ZstdDecompress, zstdDecompressSync } from "node:zlib";
```

Node 20 的 `node:zlib` **没有** `ZstdDecompress` 这个导出（[Node 文档](https://nodejs.org/api/zlib.html)：zstd 相关 API 标注 **Added in: v23.8.0, v22.15.0**）。ESM 中静态命名导入不存在的导出是**解析期 `SyntaxError`**，整个模块无法加载。

**这解释了失败数量**：13 个测试文件失败不是 13 个缺陷，而是**一个模块加载失败沿导入链的级联**——`zstd-compat.js` 被 `session-signature.js` 引用，而后者被 `adr-tools`、`friction-tools`、`goal-tools`、`ldvh-tools`、`pitfall-tools`、`research-tools`、`spark-tools` 等**全部工具模块**引用。

| 项 | 值 |
|---|---|
| 直接根因 | `plugin/lib/zstd-compat.js:26` 静态导入 Node 20 不存在的导出 |
| 深层原因 | Node 版本声明（4 处）与代码实际要求不一致 |
| 失败规模 | CI 中 13 个测试文件失败（494 项中 13 项） |
| 本地为何不失败 | 本机 Node v25.9.0，存在该导出 |

## 1. 证据链

### 1.1 CI 报错原文（运行 34749610941）

```
SyntaxError: The requested module 'node:zlib' does not provide an export named 'ZstdDecompress'
```

全部 13 个失败文件报**同一句**，无第二种错误。

### 1.2 受控复现（本机实测，非推断）

| 运行时 | `typeof require('node:zlib').ZstdDecompress` | `zstd-compat` 测试 | plugin 全套 |
|---|---|---|---|
| Node 20（CI 所用） | 不存在 | ✗ 报同一句 SyntaxError | — |
| Node 22.14.0 | `undefined`（无） | — | — |
| **Node 22.15.0** | **`function`** | — | — |
| Node 22.23.2 | `function` | 通过 | **726/726 通过** |
| Node 25.9.0（本机） | `function` | 通过 | 726/726 通过 |

**边界已实测**：22.14.0 无、22.15.0 有——与 Node 文档标注的「Added in: v22.15.0」精确吻合。故下限应表述为 **≥ 22.15.0**，而非笼统的「22」。

Node 20 下的复现输出与 CI 报错**逐字一致**，确认根因。

### 1.3 解析期而非运行期（已用最小实验验证）

```js
import { DefinitelyNotAnExport } from "node:zlib";
// SyntaxError: The requested module 'node:zlib' does not provide an export named 'DefinitelyNotAnExport'
```

即使从不使用该绑定，模块图也无法建立。故 `createZstdDecompressSync()` 内部已有的运行时守卫（`if (typeof zstdDecompressSync !== "function")`，zstd-compat.js:101）**无法生效**——代码根本执行不到那里。

### 1.4 级联路径

```
zstd-compat.js
  └─ session-signature.js:35
       ├─ adr-tools.js        → adr-tools.test.mjs           ✗
       ├─ friction-tools.js   → friction-tools.test.mjs      ✗
       ├─ goal-tools.js       → goal tools 两项用例          ✗
       ├─ ldvh-tools.js       → ldvh-tools.test.mjs          ✗
       ├─ pitfall-tools.js    → pitfall-tools.test.mjs       ✗
       ├─ research-tools.js   → research-tools.test.mjs      ✗
       ├─ spark-tools.js      → spark-tools.test.mjs         ✗
       └─ signature-channel.js → web-routes / lifecycle 等   ✗
```

13 个失败文件与 `session-signature` 导入链**完全对应**，无剩余未解释项。

## 2. 深层原因：版本声明与代码要求不一致

仓库有 **4 处**声明 Node 20，但代码实际要求 ≥22.15：

| 位置 | 当前声明 | 实际要求 |
|---|---|---|
| `.github/workflows/ci.yml:25`（plugin job） | `node-version: 20` | ≥22.15 |
| `.github/workflows/ci.yml:68`（web job） | `node-version: 20` | ≥22.15（web 不经此路径，暂未暴露） |
| `plugin/package.json:25` | `"node": ">=20"` | ≥22.15 |
| `DEVELOPMENT.md:8` | ``- Node.js `>=20` `` | ≥22.15 |

**引入时点**：`zstd-compat.js` 于 `20a1392`（2026-09-02）引入，该提交**未同步调整 CI 的 `node-version`**（`git show --stat 20a1392 -- .github/workflows/ci.yml` 为空）。而 `node-version: 20` 自 CI 创建（`941b3e0`）起从未变更。

即：**CI 从 zstd 引入之日起就开始失败，且此后一直是红的**——与本批 Web 改动无关（详见 §4）。

## 3. 处置选项

### 选项 A（推荐）：CI 升到 Node 22

- 改 `.github/workflows/ci.yml` 两处 `node-version: 20` → `22`；
- 同步 `plugin/package.json` 的 `engines.node` 与 `DEVELOPMENT.md` 为 `>=22.15`。
- **依据**：实测 Node 22.23.2 下 plugin 全套 **726/726 通过**；本机 Node 25 同样全绿。声明与实现就此一致。
- **代价**：需确认使用者的实际运行环境（DSH 宿主）节点版本不低于 22.15。

### 选项 B：改用动态或命名空间导入，维持 Node 20 支持

```js
import * as zlib from "node:zlib";
// 使用时判断 typeof zlib.ZstdDecompress
```

- 把解析期失败改为运行期可降级，使 Node 20 下**其余 12 个测试文件不再受连带影响**。
- **但**：zstd 解压是 `session-signature` 的功能依赖，Node 20 下该功能仍不可用（只能降级或报错）。这属于**功能缺失而非仅测试问题**——需 Human 判断 Node 20 是否仍需支持。

### 选项 C：两者都做

升 CI 到 22（消除红灯），同时改导入形态（避免未来同类导出缺失再次级联）。改动面最大。

## 4. 与本次 Web 改动的无关性（已核）

- 本批改动仅触及 `plugin/web/**` 与 `.github/workflows/ci.yml`；`git diff --stat` 对 `plugin/lib`、`plugin/test`、`plugin/package.json` 为**空**。
- 该 job 在**推送前的三次运行**（34699321948 / 34448446508 / 33512010599）中已在失败。

## 5. 建议同时处理

- **`engines.node` 形同虚设**：声明 `>=20` 而实际需 `>=22.15`，包管理器不会就此拦截，问题只在 CI 暴露。即便选择选项 B，也应把 `engines.node` 改为如实下限。
- **web job 的 `node-version: 20` 同理**：当前 Web 路径未 import zstd 故未失败，但声明与仓库实际要求不一致，属同一类隐患。

## 6. 本节自认未验证范围

1. **未验证 DSH 宿主的实际 Node 版本要求**——若宿主支持 Node 20，则选项 A 需 Human 权衡（本报告未查证，仅指出需查）。
2. **未逐一确认 13 个失败文件的每一行断言**——结论依据「全部报同一句错误」+「导入链完全对应」，未逐个打开。
3. **未运行 Node 21 与 22.0–22.13 区间**——已验证 22.14.0 无、22.15.0 有，边界已实测精确；更低版本按同一文档推断，未逐个实测。
4. **未检查其它 Node 20 → 22 的 API 差异**——升级后是否还有别的低版本 API 依赖，本次未全面排查。
