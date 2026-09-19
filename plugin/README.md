# dsh-ldvh

[English](README.en.md) | 简体中文

> 当前状态：`1.0.0-dev.1` 开发预览。插件外壳已建立；管辖项目管理、Git Gate 与完整 LDVH Web 仍在迁移中，尚不建议普通用户安装或提交市场。

LD Vibe Harness（LDVH）的 DeepSeek Harness 原生插件。目标是在 DSH 内提供：

- LDVH 会话视图；
- 管辖项目和默认管辖配置管理；
- Git Gate 状态、安装、升级和卸载；
- LDVH Web 信息呈现；
- AI 工作引导与确定性 LDVH CLI 入口。

## 当前已实现

- Host 侧 `/ldvh` 与 `/ldvh/api` 路由骨架；
- Web 路由启用/停用与插件卸载清理；
- 插件设置卡片骨架；
- `conversation.view` 的 LDVH 会话视图骨架；
- Host 路由生命周期测试。

## 尚未实现

- 管辖项目的登记、取消登记和默认项目管理；
- v4 Git Gate validator 与 Hook Manager 迁移；
- 完整 v4 Web；
- 当前 DSH Desktop 的真实安装验收；
- 正式市场截图和发布版本。

## 开发安装

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-ldvh/plugin
```

安装或修改 Host/Client/bundle patch 后需要重启 DSH Desktop。当前开发目标环境（本机观察值，2026-09-20）：

- DSH Desktop `2.0.13`
- `@deepseek-ai/dsh` `0.1.5-rc.2`
- Node.js `>=22.15.0`（代码下限；DSH 宿主 `dsh-plugin-desktop` 自身要求 `^22.19.0 || >=24.0.0`）

本节登记的是开发目标基线，不等于已验证支持：`specs/08` §8 要求的真实 UI 验收六项中，`/ldvh` 与 `/ldvh/api/health` 已实证，设置卡片、会话视图、停用与重启、卸载清理尚未核对。

## 验证

```bash
npm --prefix plugin test
npm --prefix plugin pack --dry-run
```

单元测试只证明已覆盖的机械范围，不证明完整产品能力、当前 DSH 兼容或市场发布条件成立。

## 设计边界

- v4 已验证机械核心优先迁入和适配，不从零重写；
- DSH 提供宿主承载，不取得 LDVH 规范、事实或业务语义权威；
- 管辖登记和 Git Gate 变更必须经明确 Human 操作；
- 不覆盖或自动链入未知第三方 `commit-msg` Hook；
- 不从测试、页面或安装成功推导整体完成。

## License

MIT © LaoDing
