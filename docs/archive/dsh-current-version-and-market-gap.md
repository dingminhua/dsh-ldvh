# 当前 DSH 版本兼容性与插件市场差距评估

> 性质：开发设计输入，非规范、非事实对象。
> 评估对象：`dsh-ldvh` 当前 `dev` 分支与本机 DSH Desktop。
> 参考：同级 `dsh-subagent-default-model/PLUGIN_REQUIREMENTS.md`、`DEVELOPMENT.md`、`RELEASING.md`、`plugin/screenshots.json`、市场提交 YAML。
> 状态：当前快照评估；DSH 或市场规则变化后需重测。

## 1. 当前环境事实

| 项目 | 当前值 |
|---|---|
| DSH Desktop | `dsh-plugin-desktop 2.0.4` |
| `@deepseek-ai/dsh` | `0.1.2-alpha.1` |
| `@deepseek-ai/dsh-settings` | `0.1.2-alpha.1` |
| `@deepseek-ai/dsh-client-ui-primitives` | `0.1.2-alpha.1` |
| LDVH 插件版本 | `1.0.0-dev.1` |
| LDVH 当前 peer | `@deepseek-ai/dsh-settings: 0.1.0-rc.6` |
| 本地测试依赖 | `@deepseek-ai/dsh-settings 0.1.0-rc.6` |

## 2. 是否已经符合加入市场要求

**结论：尚不符合。** 当前只有插件骨架，不能作为可发布市场版本提交。

### 2.1 已具备

- `plugin/package.json`；
- `type: module`、`main`、完整 exports（包括 `./package.json`）；
- `dsh.bundle.patch` 与 Client 声明；
- `plugin/cordis.patch.yml`；
- Host/Client 入口；
- MIT 根许可证；
- Node >= 20；
- npm package 名与仓库元数据；
- 7 项 Host 路由生命周期测试通过；
- `npm pack --dry-run` 可以产出 tarball。

### 2.2 阻断市场提交的缺口

| 缺口 | 当前证据/影响 |
|---|---|
| 插件包缺 `README.md` / `README.en.md` | package `files` 声明了文件，但当前不存在；用户无安装/配置/限制文档 |
| 插件包缺 `CHANGELOG.md` | 发布变化不可回查 |
| 插件包缺 `LICENSE` | 根 LICENSE 不会因 `files` 白名单自动进入 plugin tarball；当前 dry-run 只有 4 个文件 |
| 缺 `plugin/icons/` | package 声明 `icon: icons/ldvh-plugin-icon-128.png`，但 tarball 中无该文件，市场图标会失效 |
| 缺 `plugin/screenshots.json` 与截图资产 | 当前市场采用作者自持 screenshots.json；尚无截图，也尚无可用完整 UI 可截 |
| 缺 CI | 无 `.github/workflows/ci.yml`，市场前不能证明 npm ci/test/pack |
| 缺市场登记 YAML | 尚未形成 awesome-dsh-plugin 对应提交项；需确定 category（建议 development/productivity，按市场闭集现取） |
| tarball 不完整 | 当前 dry-run 仅 `cordis.patch.yml`、`lib/client.js`、`lib/index.js`、`package.json`，没有文档、图标、Web dist、Python 核心 |
| 产品能力未完成 | 管辖项目管理、Git Gate、v4 Web、真实 DSH 安装验证均未完成；README 不可提前宣传 |
| 尚未发布 npm 正式版本 | 当前 `1.0.0-dev.1`；市场 URL 可指 Git 子目录，但正式入市前仍需可安装、可验证版本策略 |

## 3. 是否支持当前 DSH 版本

**结论：尚不能声明支持；package 声明当前明确不兼容。**

### 3.1 明确不兼容点

1. 当前 DSH 的 `@deepseek-ai/dsh-settings` 是 `0.1.2-alpha.1`，而插件 peer 精确锁死 `0.1.0-rc.6`；npm 安装会产生 peer 冲突或错误兼容声明。
2. `devDependencies` 仍用 `0.1.0-rc.6`，当前单元测试只证明旧 Settings API 下的行为，不证明当前 DSH。
3. package 尚未声明 `@deepseek-ai/dsh-client-ui-primitives` peer（只写了 peer meta，没有实际 peer key），而 Client 会 require 它。
4. 当前 Client 使用 `conversation.view`；实时 Inspect 已确认当前 DSH 2.0.4 中该 Slot 存在、kind=list、scope=session、id/order/label 协议匹配，**接口形状初步兼容**，但尚未真实安装渲染。
5. 当前 Host 使用 `webServer.register(prefix)`；实时 Inspect 已确认当前版本接口匹配，**接口形状初步兼容**，但尚未在真实插件 fiber 中加载。
6. 当前 Settings Service 已支持 namespace 注册、revision、update/replace/mutate；现有 `installSettingsSection` 形态需用 `0.1.2-alpha.1` 重新安装依赖并测试。

### 3.2 当前版本兼容计划

参考同级已更新插件，peer 范围改为：

```json
"@deepseek-ai/dsh-settings": "^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0",
"@deepseek-ai/dsh-client-ui-primitives": "^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0"
```

但这只能在以下验证完成后写入：

1. 本地 devDependency 升到 `0.1.2-alpha.1`；
2. 单元测试通过；
3. `dsh plugin --profile desktop add <plugin>` link 安装；
4. 重启 DSH Desktop 2.0.4；
5. 设置卡片真实出现并可保存；
6. `conversation.view` 的 LDVH tab 真实出现；
7. `/ldvh` 与 `/ldvh/api/health` 可访问；
8. 停用/重启/卸载清理验证；
9. `npm pack --dry-run` 内容完整；
10. 如需保留 rc.6 兼容，另在旧版本环境跑矩阵；否则首发只声明当前版本范围，不虚报旧版支持。

## 4. 计划调整

### P0：当前 DSH 兼容基线（先于业务迁移）

- 更新 peer/dev 依赖到当前 DSH；
- 重新生成 lockfile；
- 对当前 Settings/WebServer/conversation.view 接口重测；
- 真实 link 安装并验证 Host/Client；
- 记录当前支持矩阵。

### P1：市场工程基线

- 补 plugin README 双语、CHANGELOG、LICENSE、icons；
- 新增 CI；
- 补 `screenshots.json`（待真实 UI 完成后截图）；
- `npm pack --dry-run` 检查白名单；
- 准备市场登记 YAML；
- 正式发布前跑安装、卸载、升级测试。

### P2：产品能力完成

- 按 `docs/v4-governance-git-gate-migration-checklist.md` 迁移管辖与 Git Gate；
- 迁入 v4 Web；
- 完成设置页管辖项目/Git Gate 管理；
- 再生成真实截图和正式市场文案。

## 5. 当前可声明范围

可以声明：

- 插件骨架已建立；
- Host 路由生命周期单元测试 7/7；
- 当前 DSH 的目标 Slot 与 WebServer API 经 Inspect 确认存在且形状匹配；
- 市场与当前版本差距已识别。

不能声明：

- 已支持 DSH Desktop 2.0.4；
- 已满足插件市场要求；
- 可供用户安装使用；
- 管辖项目、Git Gate、v4 Web 已实现；
- 已兼容旧 rc.6 与当前 alpha 的版本矩阵。
