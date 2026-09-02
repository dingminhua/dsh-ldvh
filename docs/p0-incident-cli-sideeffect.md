# 事故记录：库模块携带 CLI 顶层副作用导致插件装载崩溃

> 性质：开发备忘（故障与教训），非规范、非事实对象。
> 发生：P0 实现批次（2026-09-02 之后）。后果：Human 需要从 desktop profile 删除 dsh-ldvh 插件登记。

## 事实经过

1. P0 实现中新增 `plugin/lib/ldvh-tools.js`。
2. 其中一行 `import { cleanGitEnvironment } from "./git-gate-runner.js"` —— 意图复用 Git 环境清洗逻辑。
3. `git-gate-runner.js` 顶层带 CLI 入口副作用：
   ```js
   try { process.exitCode = await main(process.argv.slice(2)); } catch { ... process.exitCode = 1; }
   ```
4. 插件（index.js）因此经 ldvh-tools.js 间接 import 该模块 → 装载时立即以导入者的 argv 执行 `main()` → argv[0] 不是 `git-commit-msg` → 抛错并置 exitCode=1，插件装载链损坏。
5. 表现为"改到一半重启后插件不可用"；Human 从 desktop profile 移除了 dsh-ldvh 依赖（link 残留、管辖登记、Git Hook 均在，工作区改动零丢失）。

## 根因

一个文件同时承担两个身份（CLI 入口 + 可复用库函数），却没有进程入口守卫。任何把它当库 import 的模块都会触发 CLI 行为。

## 对治（已修）

1. `git-gate-runner.js` 加进程入口守卫，只有作为进程入口时才执行 `main()`：
   ```js
   const invokedDirectly = process.argv[1] !== undefined &&
     import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
   if (invokedDirectly) { ...main... }
   ```
2. 纯函数与共享逻辑下沉到无副作用模块 `commit-validation.js`（`cleanGitEnvironment`、`validateMessage`、`snapshotIdentity`、常量）；runner 与 ldvh-tools 都从它 import —— 同时满足 09 §6「单一实现原则」（Git 环境清洗也不再有两份）。
3. 验证：库 import 后 `process.exitCode` 保持 undefined；直接执行仍走 CLI 入口。

## 连带发现（同一批次的第二个缺陷）

共享 `cleanGitEnvironment` 初版把 `extra` 先铺进 env、再执行 GIT_* 剥离，导致 preflight 显式传入的 `GIT_INDEX_FILE` 被一并删除 → 合成索引失效 → Hook preflight 报 `git/index_empty`，hook-manager 两个既有测试回归。
**正确顺序**：先剥离环境变量中的 GIT_*（防继承泄漏），再叠加调用方显式值（防显式值被误删）—— 与 hook-manager 原注释「先剥离、后叠加」一致。
**教训**：抽取共享函数时，"看起来等价"的两份实现（hook-manager 的 cleanGitEnvironment 与 runner 的 cleanEnvironment）语义细节不同（后者不删 GIT_INDEX_FILE），合并时必须逐项比对差异，不能照抄其中一份。

## 纪律建议（供后续批次）

- 任何 `#!/usr/bin/env node` 的模块一旦被库代码引用，必须加进程入口守卫；
- 新增跨模块 import 后，跑一次 `npm test` 且**关注既有测试**（本次正是既有 hook-manager 测试先报警，才暴露出环境问题）；
- 插件改动导致宿主不可用时，先自查 import 链副作用与顶层执行语句，再考虑重启宿主。
