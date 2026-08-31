# 本地开发工作流（DSH Desktop）

## 当前目标环境

- DSH Desktop `2.0.4`
- `@deepseek-ai/dsh` `0.1.2-alpha.1`
- desktop profile：`~/.dsh/profiles/desktop`
- Node.js `>=20`

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

当前还必须进行真实 UI 验收：设置卡片、LDVH 会话视图、`/ldvh`、`/ldvh/api/health`、停用/重启及卸载清理。

## 红线

- 不手工复制插件文件进 profile 的 node_modules；
- 不在 DSH 安装目录内修改官方包以“修好”兼容；
- 不因单元测试通过就声明支持当前 DSH；
- 管辖/Git Gate 实现先按 v4 迁移清单吸收成熟代码。
