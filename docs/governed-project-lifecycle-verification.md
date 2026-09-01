# 管辖项目生命周期验证记录

## 当前实现范围

- 设置页选择实际 Git 根目录；
- 安装事务：登记、初始化 `ldvh-base/` 五类目录、安装或升级 Git common-dir `commit-msg` Hook；
- 检查：登记、Git 根、common-dir、事实源、Hook 所有权、正文 digest 与 bundle 版本；
- 卸载 Hook：只删除 LDVH 托管 Hook，保留登记与 `ldvh-base/`；
- 取消管辖：先卸载 Hook，再移除登记，保留 `ldvh-base/`；
- DSH Host 启动时自动检查全部登记项目一次，不自动修改。

## macOS 验证

观察环境：macOS、Node.js、系统 Git、临时 Git 仓库。

已真实验证：

1. 候选路径必须为实际 Git 根，仓库子目录被拒绝；
2. 首次安装创建 `ldvh-base/{sparks,workcases,adrs,pitfalls,studies}`；
3. 首次安装创建登记文件，并把首个项目设为默认；
4. Hook 安装在 Git common-dir `hooks/commit-msg`；
5. Hook marker 正文 digest 与 bundle 版本可回读为 `managed`；
6. 真实 `git commit` 中非法 message 被阻断；
7. 符合当前最小 Gate 契约的 message 被放行；
8. 卸载 Hook 后登记和 `ldvh-base/` 保留；
9. 再次安装可以修复缺失 Hook，不重复登记；
10. 取消管辖移除登记并自动卸载 Hook，同时保留 `ldvh-base/`。

## Windows 范围

已在代码中实现但本轮未在真实 Windows 主机验证：

- 盘符绝对路径和 UNC 路径由 Node/Git realpath 与 Git 根解析承接；
- Hook 预检在 `win32` 下通过 `sh` 调用，避免直接执行无扩展名脚本；
- 登记文件原子替换使用 DSH atomic-write；Windows 继承用户配置目录 ACL，不伪造 POSIX ACL；
- DSH Terminal 的 PowerShell/cmd 启动由 Desktop 宿主实现，LDVH 不自行选择或提权。

未验证风险：Git Bash/MSYS `sh` 是否在目标 Windows DSH 环境可发现、NTFS 文件占用导致原子替换失败时的实际错误呈现、UNC 与 junction 的真实行为。以上范围保持 `unverified`，不得宣称 Windows 完整验收通过。
