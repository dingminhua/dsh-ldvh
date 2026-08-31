# dsh-ldvh 发布流程

> 当前仍为开发预览。只有市场要求、当前 DSH 兼容、产品能力和真实安装验收均完成后，才可正式发布。

## 发布前门禁

1. 工作区和 release commit 干净；
2. `npm --prefix plugin ci`；
3. `npm --prefix plugin test`；
4. `npm --prefix plugin pack --dry-run`，核对 README、LICENSE、图标、Web dist 和 Python 核心均进入包；
5. 在支持矩阵中的 DSH Desktop 真实安装、重启、升级、停用、卸载验证；
6. README/CHANGELOG 不超前宣传；
7. `plugin/screenshots.json` URL 可访问且截图对应当前版本；
8. 市场登记 YAML 与 package 元数据一致。

## 版本

- 开发版：`1.0.0-dev.N`
- 首个正式版：`1.0.0`
- 版本变更同步更新 `plugin/package.json` 与 `plugin/CHANGELOG.md`。

## 发布

```bash
cd plugin
npm publish
```

发布后核对：

```bash
npm view dsh-ldvh version
npm view dsh-ldvh dist-tags.latest
```

Git tag 必须指向包含实际发布代码的提交。npm 2FA 按 npm CLI 提示在浏览器确认，不绕过认证。
