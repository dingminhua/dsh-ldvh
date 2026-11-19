# LDVH · LD Vibe Harness

> **开发预览** ｜ 版本 `1.0.0-dev.1` ｜ MIT License（与 DSH 本体同协议）
> 本仓库是 LDVH 的**规范源与事实源**所在，也是 DSH 原生插件 `dsh-ldvh` 的源码仓库。正式发布版本尚未发布，当前不建议普通用户安装。

**一句话**：**对齐 Vibe、协调 Coding。** 让 Human 与 AI 对项目的由来、现状、去向形成一致的认识；借助宿主调度资源，明晰权责、记录火花、确立规范、构建报告、积累经验、发现摩擦，让项目进展更稳定、执行更顺利。

## 截图

| 设置页 1/3：服务与入口 · 代理辅助 · 召回预算 | 设置页 2/3：把关请示 |
|---|---|
| ![LDVH 设置页 1/3](plugin/docs/assets/ldvh-settings-1.png) | ![LDVH 设置页 2/3](plugin/docs/assets/ldvh-settings-2.png) |

| 设置页 3/3：管辖项目（路径已脱敏） | LDVH Web 信息呈现 |
|---|---|
| ![LDVH 设置页 3/3](plugin/docs/assets/ldvh-settings-3.png) | ![LDVH Web](plugin/docs/assets/ldvh-web.png) |

![DSH 内的 LDVH 面板](plugin/docs/assets/ldvh-in-dsh.png)

## 这是什么

LDVH 以 **DSH 原生插件为统一交付形态**，为「人与 AI 协作」提供一套可回读、可追溯的框架：

- **规范源**界定行动边界与流程要求——LDVH 自身的元规范（`specs/`）与项目的事实规范（`ldvh-base/norms/`）；
- **事实源**锚定判断——Goal、SubGoal、Spark、Norm、Report、Pitfall、Friction 七类事实对象；
- **插件**把四种价值交付装进 DSH：AI 工作引导、LDVH CLI 确定性执行、Web 信息呈现、Git 机械守护。

核心价值与业务系统的对应关系（来自根规范 `specs/00` §2.6）：

| 核心价值 | 承接的业务系统 |
|---|---|
| 对齐 Vibe | 目标规划、火花记录、双源召回 |
| 协调 Coding | 把关请示、调研吸收、经验积累、摩擦销账 |

**规范定义 ≠ 已落地能力**：上表是机制设计。插件当前已实现的能力以 [`plugin/README.md`](plugin/README.md) 为准。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `specs/` | 规范源（LDVH 自身的元规范：根规范、模型规范、业务系统规范、事实类型规范、附件） |
| `ldvh-base/` | 事实源（本项目的目标、子目标、火花、规范、报告、经验、摩擦账目） |
| `plugin/` | DSH 原生插件（Host 侧实现、客户端设置面与会话视图、LDVH Web SPA、测试） |
| `docs/` | 临时文档（验证记录、调研与评估记录等；不是规范源与事实源） |
| `icons/` | 插件图标（多尺寸） |
| `plugin/docs/assets/` | 发布用截图（设置页三屏、LDVH Web、DSH 内面板） |
| `LICENSE` | MIT 协议 |
| `DEVELOPMENT.md`、`RELEASING.md` | 历史草稿（过程记录，不具规范效力；现行规则见 `specs/` 与事实源中的 Norm） |

## 快速开始（开发）

```bash
# 安装插件到本机 desktop profile（link: 方式，不复制文件）
dsh plugin --profile desktop add /absolute/path/to/dsh-ldvh/plugin

# 日常验证
npm --prefix plugin ci
npm --prefix plugin test
cd plugin && npm pack --dry-run
```

安装或修改 Host / Client / bundle patch 后需要重启 DSH Desktop（这些部分在进程启动时加载）。目标宿主基线见 `plugin/README.md` 的「宿主兼容」。

## 版本号双轨

对外发布版本与开发迭代版本分离，二者共享主版本、互不污染：

| 轨 | 语法 | 递增时机 | 当前 |
|---|---|---|---|
| 对外发布版本 | `MAJOR.MINOR.PATCH` | 仅正式发布时 | 尚未发布 |
| 开发迭代版本 | 同主版本 + `-dev.N` | 已在上一轮开发版本之后继续迭代时 | `1.0.0-dev.1` |

首次正式发布之前 `-dev.N` 恒为 `1`（没有可区分的上一轮）；发布封存干净版本后，dev 进入下一轮。

## 当前里程碑

1. ✅ **规范体系**：根规范与模型规范、业务系统规范、七类事实类型规范已建立并进入当前规则源
2. ✅ **事实源运行**：Goal / SubGoal / Spark / Norm / Report / Pitfall / Friction 七类对象已在本项目运行
3. ✅ **插件落地**：管辖项目管理、Git Gate、设置页一节、LDVH Web 与会话视图、`ldvh_*` 工具面与规则引导注入均已落地
4. 🔄 **发布准备**：市场门面（README / 截图 / 版本声明点）与发布门禁正在收口
5. ⬜ **首次正式发布**：待发布门禁全项通过后封存 `1.0.0`

## 延伸阅读

- 根规范（LDVH 为什么存在、解决方案与构成、Human 的权利与 AI 的责任）：[`specs/00-理念与构成.md`](specs/00-理念与构成.md)
- 插件市场页（安装、使用、配置项、宿主兼容）：[`plugin/README.md`](plugin/README.md)

## License

MIT © LaoDing
