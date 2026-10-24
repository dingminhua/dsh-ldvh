# 本地开发工作流（DSH Desktop）

## 当前目标环境

- DSH Desktop `0.2.1-rc.3`
- `@deepseek-ai/dsh` `0.2.1-rc.3`
- desktop profile：`~/.dsh/profiles/desktop`
- Node.js `>=22.15.0`（`lib/zstd-compat.js` 依赖 `node:zlib` 的 zstd API，自 v22.15.0 起提供；DSH 宿主 `dsh-plugin-desktop` 自身要求 `^22.19.0 || >=24.0.0`，CI 取 `22.19`）

## 首次安装

```bash
dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-ldvh/plugin
```

插件以本地 `link:` 方式加入 desktop profile。Host/Client/bundle patch 在进程启动时加载，因此安装或修改后需退出并重新打开 DSH Desktop。

## 日常验证

```bash
npm --prefix plugin ci
npm --prefix plugin test
npm --prefix plugin pack --dry-run
```

`npm test` 走 `plugin/scripts/run-tests.mjs` 包装：在 Linux/macOS 上传 `--test-force-exit`（Node ≥22.14，仓库下限 22.15 已覆盖）——web-routes 一族用例挂载插件后，偶有连到本机 `127.0.0.1` 的 TCP 句柄残留到进程收尾，令测试进程在结果全部打印后仍空等约 84 秒。该 flag 只在测试完成后立即退出进程，不改变任何用例结果。

`npm pack` 的 prepack 会把仓库根 `specs/` 复制进 `plugin/specs/`（postpack 清理；两者均被 `plugin/.gitignore` 忽略，包内副本只是发布产物）。受辖会话的规范语料按三级回退解析（`specs/01 §10.3`）：项目根 `specs/` → 插件包父目录（即本仓库根——link 安装形态，以根规范载体 `00-理念与构成.md` 辨认）→ 插件包内 `specs/`（npm 安装形态）。因此在**其他受辖项目**里经 link 安装的插件直接读本仓库的 `specs/`，无需向项目复制语料。手工创建的 `plugin/specs/`（无 stamp 文件）不会被 postpack 删除。

在 **Windows 上不传**该 flag：强制退出会与 undici 尚在收尾的 `fetch` 句柄相撞，触发 libuv 原生断言（`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`）。原生断言无法被用例捕获——整个 runner 进程直接中止，报告里该文件失败而**没有任何失败用例**。Windows 实测该 flag 也不省时（全套 38.0s vs 37.9s），故略去零代价。上游：<https://github.com/nodejs/node/issues/58091>、<https://github.com/undici/undici/issues/5680>。

基准方法（real+cpu 双指标、抗本机负载噪声）见 `plugin/scripts/bench-tests.sh`。

当前还必须进行真实 UI 验收：设置卡片、LDVH 会话视图、`/ldvh`、`/ldvh/api/health`、停用/重启及卸载清理。

Windows npm（node v24.19 打包版）实测：`npm --prefix plugin pack --dry-run` 不认 `--prefix`，会去当前工作目录找 `package.json` 并报 ENOENT——`npm --prefix plugin ci` / `test` 不受影响。打包核对须 `cd plugin` 后直接 `npm pack --dry-run`（prepack/postpack 照常执行）。

## Windows 平台说明

CI 跑 `ubuntu-latest`；以下为 Windows（开发机之一）上实测的平台差异，全部已在代码/测试中各自处置。

**已修复的实现缺陷（非测试问题）**：

- **Git 路径转义**：`core.quotepath` 默认为 `true` 时 Git 会把非 ASCII 路径 C 转义（`"specs/13-\346\211\277..."`）。这会让 ① `diff --git` 行匹配不到、`changedPaths` 读成空集，从而把每一条关键变更都误判为「未匹配」（假阻断）；② `git show :<转义路径>` 直接报「path does not exist」，使可读的 §7.2/承重声明载体被读成不可读。修复：在 `cleanGitEnvironment`（唯一的 Git 调用边界）统一注入 `core.quotepath=false`，并把路径列举改用 `-z` NUL 分隔。
- **`fs.watch` 遇 8.3 短路径**：`fs.watch(dir, { recursive: true })` 后写入该目录，会让进程以 libuv 原生断言中止——`Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c, line 72`。`os.tmpdir()` 在本机返回短名（`C:\Users\ADMINI~1\...`），正是触发条件。原生断言**无法被 try/catch 捕获**，若宿主的 `webRoot` 含短名组件，会连带整个 DSH 宿主进程一起崩。修复：`web-mount.js` 在建立 watcher 前先 `realpathSync.native` 取长名；测试夹具同样用长名。上游：<https://github.com/libuv/libuv/issues/5010>、<https://github.com/nodejs/node/issues/63638>。

**测试断言中的平台口径（未削弱任何断言）**：

- **`mode & 0o777`**：Windows 忽略 POSIX 权限位（实测 `0o666`），故该断言按平台分支；ACL 核验不可得时按既有红线 **fail-closed**，行为不变。
- **`realpathSync` vs `realpathSync.native`**：产品侧用 `.native`（展开短名），测试侧若用非 `.native` 便只剩 `Administrator` vs `ADMINI~1` 之差，故测试改用 `.native` 与产品对齐。
- **`path.resolve` 为平台相关**：以 `/` 开头在 Windows 是「当前盘符相对」，期望值改用同一解析器构造，`null` 两条（越界防护）不动。
- **`ESM import` 绝对路径**：`import('D:\\...')` 会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（协议 `d:`），改用 `pathToFileURL().href`。
- **临时目录清理**：句柄可短暂滞后于其属主（HTTP server / `fs.watch` 异步关闭），立即 `rm` 会在**未泄漏**的目录上报 EBUSY；`withTemp` 做有界重试，真泄漏仍会失败。

**已知限制（不可断言，登记而非掩盖）**：`fs.watch` 短路径的原生中止与 `--test-force-exit` 的 `UV_HANDLE_CLOSING` 中止都是**进程级 abort**，用例内无法捕获或断言，因此不作为用例存在——前者由产品侧的短名规范化防住，后者由 `scripts/run-tests.mjs` 在 Windows 上不传该 flag 防住。

## 红线

- 不手工复制插件文件进 profile 的 node_modules；
- 不在 DSH 安装目录内修改官方包以“修好”兼容；
- 不因单元测试通过就声明支持当前 DSH；
- 管辖/Git Gate 实现先按 v4 迁移清单吸收成熟代码。
