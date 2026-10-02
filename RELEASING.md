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

- 开发版：`1.0.0-dev.N`。`N` 仅在已存在可区别的上一轮开发版本时递增；**首次正式发布前恒为 `1`**（`specs/08 §7.1`）。
- 首个正式版：`1.0.0`
- 版本变更须同步更新**全部四处版本声明点**（`specs/08 §7.5`，四处必须一致，漂移按 `§10.1` 第 4 项停止条件处理）：`plugin/package.json`、`plugin/CHANGELOG.md`、`README.md` 的版本行、`plugin/README.md` 的版本行；`plugin/package-lock.json` 随 `package.json` 同步。
  - **注意**：仅更新前两处会造成漂移（2026-09 曾实际发生）。`plugin/lib/hook-manager.js` 的 `HOOK_BUNDLE_VERSION` **不是** `package.json.version` 的镜像，不属版本声明点，勿一并改动。

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
