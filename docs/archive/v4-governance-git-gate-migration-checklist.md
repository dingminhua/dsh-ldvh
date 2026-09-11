# v4 管辖登记与 Git Gate 精确迁移清单

> 性质：开发设计输入，非规范、非事实对象。
> 依据：v4 只读代码/测试调查、v5 `specs/06`–`specs/09`、`docs/dsh-plugin-binding-plan.md` 第 14 章。
> 目的：在实施前逐文件明确原样吸收、提取适配、重写边界、废弃和新增，避免从零重写成熟机械核心。
> 状态：候选，待 Human 对关键取舍确认后实施。

## 1. 总体迁移策略

1. Python 机械核心继续使用 Python，并打包进 `plugin/python/`；第一阶段不把成熟 validator、Hook Manager 或 Git identity 算法迁写为 JavaScript。
2. JavaScript 只负责 DSH Host/Client 接入、设置 UI、Host–Client 调用、Human Gate、生命周期和状态呈现。
3. v4 代码复制后先保持模块边界和测试，再最小修改配置载体、规则源定位、runner 路径与授权入口。
4. 每项修改必须对照 v5 当前规范；v4 只提供工程算法和失败经验，不恢复规范权威。

## 2. 管辖登记迁移清单

### 2.1 原样迁入或仅改 import 根

| v4 来源 | v5 目标 | 处理 |
|---|---|---|
| `code/ldvh/governance/git.py` | `plugin/python/ldvh/governance/git.py` | 原样迁入 Git 环境隔离、realpath、worktree/common-dir 观察与失败分类；另增 v5 路径边界测试，不顺手改算法 |
| `code/ldvh/governance/models.py` | `plugin/python/ldvh/governance/models.py` | 保留 frozen/slots dataclass、MappingProxyType 和构造期强约束；公共结果模型另行适配三态 |
| `code/ldvh/governance/signature_guard.py` | `plugin/python/ldvh/governance/signature_guard.py` | 保留算法；是否继续进入 v5 署名契约由 06 最终决定 |
| `code/tests/governance/test_git.py` | `plugin/python/tests/governance/test_git.py` | 尽量原样迁入；补当前平台和 DSH 路径边界 |
| `code/tests/governance/test_models.py` | `plugin/python/tests/governance/test_models.py` | 先迁入，再按 v5 三态调整断言 |

### 2.2 提取并适配

| v4 来源 | v5 目标/变化 |
|---|---|
| `governance/configuration.py` | 新 `registration.py` 或保留原名；文件固定为 `<DSH user config>/ldvh/governed-projects.yaml`；加入 `schema_version: 1`；移除向上发现、多起点、多配置冲突；`default_project_id` 始终存在 |
| `governance/resolver.py` | 保留 Git identity 匹配、缺口与安全诊断算法；公共结果收口为 `governed/not_governed/unavailable`；多项目/混合范围只作内部 unavailable 诊断，不作公共成功状态 |
| `helper/operations/governance_scope_operation.py` | 保留请求解析与来源回指思路；移除 `arguments.workspace_root` 自动发现语义，改为 Host 注入 user-data 配置根 |
| `web/api/services/governedProjectsSettings.ts` | 不直接迁入 Web；把 YAML 字段闭集、fingerprint、CAS、原子替换、回滚、回读算法移到 Python 登记服务 |
| `web/api/services/governanceScope.ts` | 子进程 Helper 壳退役；其强结果校验、失败不缓存、fingerprint 失效策略提取到 Host/Client 状态层 |
| `web/api/services/workspaceWorktrees.ts` | 仅吸收 `realpath + git worktree list` 的请求路径校验；workspace 扫描和多项目聚合退役 |
| `web/api/routes/settings.ts` | 不迁 Express 路由；用 DSH Host 私有调用或正式 API 承载 read/register/unregister/set-default |

### 2.3 必须新增

| 新文件/能力 | 内容 |
|---|---|
| `plugin/python/ldvh/governance/registration.py` | v5 Schema、载体创建/读取、CAS、原子 replace、写后回读、Unix 权限/Windows ACL 边界 |
| `register_governed_project_operation.py` | 注册项目；路径必须是 realpath 后的 Git 根；ID/路径唯一；首项目默认行为待 Human 确认 |
| `unregister_governed_project_operation.py` | 取消登记；默认项目删除行为待 Human 确认 |
| `set_default_governed_project_operation.py` | 明确设置默认项目，避免把删除副作用隐式成“列表第一项” |
| `migrate_legacy_governance_operation.py` | v4 配置只作手动导入；预览候选、Human 确认、保留旧文件 |
| Host 私有调用层 | Client 设置页读取项目列表、登记/取消/设默认；只传 JSON DTO，不传活对象 |
| Client 设置 UI | 默认配置目录、实际载体路径、项目列表、添加/取消/设默认、unavailable/gaps/冲突呈现 |

### 2.4 明确废弃

- v4 `LDVH-GOVERNED-PROJECTS.yaml` 作为当前权威；
- 父目录向上发现与 `arguments.workspace_root` 猜测；
- 多配置合并、多项目/多 worktree 聚合；
- `LDVH_ROOT`、`LDVH_WORKSPACE_ROOT` 默认推导；
- Web 通过 `execFile` 调根 `ldvh`；
- Web 直接写 YAML；
- v4 `.venv`、`__pycache__`、`.ldvh-test-runs`。

## 3. Git Gate 迁移清单

### 3.1 原样迁入或仅改 import 根

| v4 来源 | v5 目标 | 处理 |
|---|---|---|
| `code/ldvh/commits/validation.py` | `plugin/python/ldvh/commits/validation.py` | 原样迁入纯函数 validator；规则契约投影适配后再调整 |
| `commits/git_adapter.py` | 同路径 | 原样保留 Index/HEAD 观察、snapshot_identity、漂移、merge/temp-file 检查 |
| `commits/precheck.py` | 同路径 | 保留共享编排，供 Helper precheck 与 Hook 共用 |
| `commits/contract_source.py` | 同路径 | 保留 fingerprint 算法；规则源位置改由插件明确解析，不再同仓猜测 |
| `hooks/commit_msg.py` | 同路径 | 保留 Gate 输入绑定和 allow/block 映射；runner/规则源适配 |
| `signature.py` | 同路径 | 保留归一化；trailer 名称按 v5 06 当前契约对齐 |
| `facts/content.py`、`facts/schema.py`、`facts/contracts.py` | 同路径 | 作为 staged fact candidate 的共享事实校验依赖迁入 |
| `helper/operations/commit_precheck_operation.py` | 同路径 | 保留不暴露 index_file 的外部边界 |
| `helper/operations/git_hooks_status_operation.py` | 同路径 | 保留只读状态 DTO，删去无关 Skill/Stop gate 字段或按 v5 决定适配 |

### 3.2 Hook Manager 提取适配

| v4 来源 | v5 变化 |
|---|---|
| `code/ldvh/git_hooks/commit_msg.py` | 保留 marker+body digest、bundle version、common-dir、worktree 枚举、HookState、原子写、回滚、真实 preflight、Git 配置注入拒绝；runner 改为插件包内稳定 launcher；Human Gate 改由 DSH UI 承载 |
| 根 `ldvh` launcher | 不原样使用仓库根 launcher/.venv 自动切换；新增插件包内稳定 launcher，明确 Python 依赖与平台行为 |
| `environment_sync.py` | 只吸收 inspect/update 事务与对齐思想；改造成插件 Host 操作，不保留 Skill 同步职责 |
| `.git/hooks/commit-msg` 模板 | 保留“薄 wrapper，只绑定事件，不带规则正文”；目标 runner 与 v5 配置根/规则源参数调整 |

### 3.3 原样迁移的测试优先级

1. `code/tests/git_hooks/test_commit_msg.py` 全套 23 项；
2. `code/tests/commits/test_commit_validation.py`；
3. `code/tests/commits/test_git_adapter.py`；
4. `code/tests/commits/test_contract_source.py`；
5. `code/tests/helper/test_commit_precheck_operation.py`；
6. `code/tests/platform/test_native_windows.py` 中路径和 Git 环境注入部分。

新增测试：

- unborn repository（尚无 HEAD）；
- 插件升级后 runner 路径与 bundle 版本变化；
- DSH Human Gate 取消/拒绝时零写入；
- 设置页选择实际 Git 根后，“安装”不可选地执行登记、创建或校验 `ldvh-base/`、安装或更新 Hook；任一步失败均不得显示已就绪；
- 独立 clone 单独确认，linked worktree 共享一次安装；
- 第三方 commit-msg/prepare-commit-msg 冲突呈现且零写入。

### 3.4 明确废弃

- `prepare-commit-msg` 安装形态；
- legacy `.githooks-v4` 作为新安装目标（只保留精确旧资产迁移兼容）；
- 旧署名 trailer；
- v4 根 launcher + `.venv` 运行时形态；
- 同仓 `inspect_colocated_repository(ldvh.__file__)` 猜规则源；
- Skill 同步与 Host Stop gate 在 Git Gate 安装动作中的捆绑。

## 4. DSH 接入新增层

| 平台 | 新增能力 |
|---|---|
| Host | Python launcher/worker 生命周期；管辖登记和 Git Gate 状态服务；Client 私有 JSON 调用；DSH 用户配置根；Human Gate；插件升级状态 |
| Client | 插件设置完整 section/card；项目列表；Git Gate `absent/managed/outdated/conflict/unavailable`；检查/安装/升级/卸载按钮；common-dir/worktree 展示；第三方 Hook 冲突说明 |
| Web | `/ldvh` 页面只消费 Host/Helper DTO，不直接解析第二份 YAML 或 Hook 文件 |

## 5. 实施批次

### 批次 A：兼容与市场基线

- 更新 DSH peer 范围和锁文件；
- 补齐 plugin README/README.en/CHANGELOG/LICENSE/icons/screenshots.json；
- 新增 CI 与 npm pack 检查；
- 在当前 DSH Desktop 上真实 link 安装并验证 Client/Host。

### 批次 B：管辖只读核心

- 迁入 `governance/git.py`、models 和原测试；
- 实现 v5 registration 只读解析与三态；
- Host/Client 显示配置路径、项目列表与 unavailable；
- 不写入、不迁移旧文件。

### 批次 C：管辖写入

- register/unregister/set-default；
- CAS、原子 replace、权限、回读；
- 手动 v4 导入预览/确认；
- DSH Human Gate 和设置 UI。

### 批次 D：Git Gate 只读 inspect

- 迁入 HookState/common-dir/worktree 枚举；
- 设置页显示状态和诊断；
- DSH 启动时自动 inspect 全部登记项目，设置页“检查”也只读执行同一检查；
- 新增项目由“安装”事务完成登记、`ldvh-base/` 初始化与 Hook 安装，不再采用“先登记后只 inspect”的旧方案。

### 批次 E：Git Gate 安装/升级/卸载

- 迁入 manager 事务、rollback 和 preflight；
- 设置页 Host 先按 OS 用户权限自动执行；权限拒绝时 fail-closed，并生成统一 LDVH CLI 的 macOS/Windows 正确命令及 DSH Terminal 降级入口，不把 `ctx.approval.request()` 或 Agent `sandbox_permissions` 误用到空闲设置按钮；
- “卸载”只卸载 Hook并保留登记与 `ldvh-base/`；“取消管辖”自动卸载 Hook、移除登记并保留 `ldvh-base/`；
- 第三方 Hook conflict 零写入；
- linked worktree/独立 clone 验证。

### 批次 F：共享 validator 与 precheck

- 迁入 commit validator、Git adapter、contract source、事实 candidate 校验；
- Hook 和 Helper 使用同一实现；
- provider/model 署名机械来源对齐当前 DSH。

## 6. 实施前待 Human 确认

1. 首个登记项目是否自动成为默认项目；
2. 删除当前默认项目时是否必须同时指定替代默认；
3. 默认配置目录是否固定在 DSH_HOME 内；
4. v4 配置是否只允许手动导入且保留旧文件；
5. 第三方 commit-msg 是否继续 v4 的 conflict/零写入（建议是）；
6. 已定案：新增项目的“安装”一次明确执行登记、`ldvh-base/` 初始化和 Hook 安装；启动自动 inspect，写入不自动发生；
7. Python 核心是否按本清单打包进插件而不迁写 JavaScript（建议是）。
