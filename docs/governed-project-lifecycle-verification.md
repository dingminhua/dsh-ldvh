# 管辖项目生命周期验证记录

本文件是**验证记录**，不承载规范效力（状态与实现说明的承载位置见 `specs/01 §7.2`）。
所有结论均来自真机实测，不是读代码推断。

## 当前实现范围

- 设置页选择实际 Git 根目录；
- 安装事务：登记、初始化 `ldvh-base/` 各类型目录、安装或升级 Git common-dir 的 `commit-msg` 与 `pre-commit` Hook；
- 检查：登记、Git 根、common-dir、事实源、Hook 所有权、正文 digest 与 bundle 版本；
- 卸载 Hook：只删除 LDVH 托管 Hook，保留登记与 `ldvh-base/`；
- 取消管辖：先卸载 Hook，再移除登记，保留 `ldvh-base/`；
- DSH Host 启动时自动检查全部登记项目一次，不自动修改。

## macOS 验证

观察环境：macOS、Node.js、系统 Git、临时 Git 仓库。

已真实验证 10 项（清单与下节 Windows 同，历史结论保留）：

1. 候选路径必须为实际 Git 根，仓库子目录被拒绝；
2. 首次安装创建 `ldvh-base/` 各类型目录；
3. 首次安装创建登记文件，并把首个项目设为默认；
4. Hook 安装在 Git common-dir `hooks/commit-msg`；
5. Hook marker 正文 digest 与 bundle 版本可回读为 `managed`；
6. 真实 `git commit` 中非法 message 被阻断；
7. 符合当前最小 Gate 契约的 message 被放行；
8. 卸载 Hook 后登记和 `ldvh-base/` 保留；
9. 再次安装可以修复缺失 Hook，不重复登记；
10. 取消管辖移除登记并自动卸载 Hook，同时保留 `ldvh-base/`。

## Windows 验证（2026-11-10，真机实测）

观察环境：Windows 11、Node.js v24.22.1、Git for Windows 2.56.0、临时 Git 仓库。
全部 10 项在真实 Windows 主机上逐条执行并通过，承载用例为
`plugin/test/windows-lifecycle-verification.test.mjs`（`node --test` 可重复运行）。

| # | 项 | 结果 |
|---|---|---|
| ① | 候选路径必须为实际 Git 根，仓库子目录被拒绝 | 通过 |
| ② | 首次安装创建 `ldvh-base/` 各类型目录 | 通过 |
| ③ | 首次安装创建登记文件并把首个项目设为默认 | 通过 |
| ④ | Hook 装入 Git common-dir `hooks/commit-msg` | 通过 |
| ⑤ | Hook 的 bundle 版本可回读且与期望一致，状态为 `managed` | 通过 |
| ⑥ | 真实 `git commit` 中非法 message 被阻断 | 通过 |
| ⑦ | 符合最小 Gate 契约的 message 被放行 | 通过 |
| ⑧ | 卸载 Hook 后登记与 `ldvh-base/` 保留 | 通过 |
| ⑨ | 再次安装可修复缺失 Hook，且不重复登记 | 通过 |
| ⑩ | 取消管辖移除登记并自动卸载 Hook，保留 `ldvh-base/` | 通过 |

### 与旧记录的两处实质性更正

1. **`ldvh-base` 目录数由「五类」更正为七类**：现为
   `sparks / workcases / adrs / pitfalls / researches / frictions / norms`。
   旧记录与本文件原版本写「五类」（`sparks, workcases, adrs, pitfalls, studies`），
   `studies` 已不存在，`researches`/`frictions`/`norms` 后加。② 项最初照旧记录断言，
   在真机上因 `studies` 不存在而红——**是记录过期，不是实现缺陷**。
2. **`pre-commit` 与 `commit-msg` 两枚 Hook**：旧记录只提 `commit-msg`。实测
   `installProject` 同时装两枚，`inspectHook` 也按两枚报告。

### Windows 权限判据（同期修订）

`evaluateRegistrationEntry` 原先在 `win32` 上**无条件**返回
`registration_permission_unverified`，理由是「本实现没有 ACL 核验器」。该前提不成立：
`icacls` 随系统提供、可稳定读取 DACL。无条件 fail-closed 的后果是 CLI 登记入口在
Windows 上永久不可用，而 `specs/08 §5.6` 明文预期 Windows 可写（「Windows 目标文件
占用导致 replace 失败时明确返回失败」）。

现行判据（与 Unix 侧「目录 0700 **与** 文件 0600」同构）：

- 读取方式：PowerShell `Get-Acl` 取**结构化** DACL（`IdentityReference` +
  `FileSystemRights` + `AccessControlType`），不解析 `icacls` 文本；
- 核验范围：**载体目录与载体文件两处**都核验（文件不存在时不核验，属正常初态）；
- 判据方向：**白名单**——只承认当前用户、`NT AUTHORITY\SYSTEM`、
  `BUILTIN\Administrators`、`OWNER RIGHTS`；其余主体（`Everyone`、`BUILTIN\Users`、
  `Authenticated Users`、`CREATOR OWNER`、任何域组、任何未知 SID）一律算「扩大」；
  显式 `Deny` 不算扩大；
- 结果：任一处 ACL 读不到 → `permission_unverified`（fail-closed）；任一处存在越界
  主体 → `permission_unverified`（**与 Unix 侧「权限过宽」同一错误码**），并交出
  `widenedTo`；本实现**不**顺手修改 ACL。

**该判据的边界（据实，不掩饰）**：

1. 只核对「是否扩大到其它用户」这一条规范要求，**不**核对加密、审计、完整性级别等
   ACL 其它属性；放行**不等于**主张这些属性安全。
2. **`BUILTIN\Administrators` 被放行是一处明示的弱化**：它确实是「其它用户」。拒绝它
   会使 Windows 上任何管理员账户的目录都不可用（Windows 默认给 Administrators 完全
   控制），登记功能等于无法运行。故它保护的是「非管理员的其它用户」，**不保护
   同机管理员之间**。
3. 白名单之外的主体一律拒绝，故**新增一个合法主体（如企业环境自定义服务账户）会被
   判为越界**——这是有意的保守方向：宁可拒绝并要求人工处理，也不默认放行。

### 修订史（2026-11-10，两轮）

第一轮把 `icacls` 文本解析 + 黑名单当作实现；**独立审核实测出四类问题**，其中一类是
**fail-open**：

| # | 缺陷 | 后果 |
|---|---|---|
| 1 | 按空白剥离首行前缀，路径**含空格**即截错 | `Everyone` 越界**漏检 → 放行**（`C:\Users\<含空格的用户名>\…` 即触发）|
| 2 | UNC 首行（`\\srv\share\…`）同型 | 同上 |
| 3 | 黑名单只挡枚举到的内置主体 | 域组 / SID 形态 / 自建组全漏 |
| 4 | 只核目录、不核文件 | 「目录 0700 与文件 0600」的文件半边缺失 |

第二轮按审核建议改为 `Get-Acl` 结构化读取 + 白名单 + 目录/文件双检，上述四类从根上消除，
并补了对应的行为级守卫（含空格路径、文件级 ACL、跨平台同码）。

同期修正：载体 **schema 校验**原只存在于 Unix 分支尾部，`win32` 提前 return 后从不执行，
于是 `schema_version: 99` 的载体在 Windows 上被判合格。现已抽为平台无关函数，两侧都核对。

### 仍未覆盖（如实登记）

- **Linux**：同一契约下运行，仅 CI 覆盖，未做真机验收。
- **UNC 与 junction 的真实行为**：本文件所列 10 项均在本地盘符路径下执行，未覆盖
  `\\server\share\…` 与 NTFS junction 的实际语义。`Get-Acl` 对 UNC 路径的可用性
  **未实测**（改写后不再依赖路径与主体的分隔解析，但共享上的权限语义仍需真机验证）。
- **ACL 读不到时的 fail-closed 分支**：无法在本机构造「DACL 读不到而目录仍可达」的
  场景（用 `icacls /deny` 构造后核验器仍能读到），该分支存在但**无实测样本**，
  对应用例以显式 skip 登记，不静默通过。
- **域环境**：`DOMAIN\...` 组与 SID 形态主体在本机（工作组）无法构造，白名单会把它们
  判为越界——方向保守，但未在真实域环境验证过「合法域账户会被拒」的实际影响。
- **`%TEMP%` 与真实 DSH 根的 ACL 差异**：`closure-items` 的运行时探针在 `%TEMP%` 下
  探测入口可用性，而真实根（`<homedir>\.dsh`）的 ACL 可能不同；探针已放宽为「只问
  入口能不能走通」，但二者不等价这一点未消除。
- **NTFS 文件占用导致原子替换失败时的错误呈现**：未构造该竞争场景实测。
- 上述未覆盖项**不得**据本文件宣称 Windows 已完整验收通过。

## 复现方式

```bash
cd plugin
node --test test/windows-lifecycle-verification.test.mjs   # Windows 10 项
node --test test/windows-acl-verification.test.mjs         # Windows 权限判据
```
