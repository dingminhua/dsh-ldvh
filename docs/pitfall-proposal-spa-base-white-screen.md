# C1 提案：Pitfall 新建（待 Human 确认）

## 提案对象

| 字段 | 拟填值 |
|---|---|
| `fact_type_key` | pitfall |
| `title` | 无基址构建致 SPA 白屏（拟 ≤30 字） |
| `status` | active（初态） |
| `trigger_signal` | 当 SPA 挂载前缀改变、或构建脚本默认带上 `--base`、或宿主改为独立端口服务该 SPA 时重审本经验。 |
| `scope` | 适用于「SPA 以非根路径前缀挂载、与宿主共享端口」的构建与验证：构建产物引用未挂该前缀时，页面在浏览器中整页空白，而构建过程本身成功且不报错。已验证实例：dsh-ldvh 的 plugin/web（`/ldvh` 前缀，`pnpm build:dsh` 与裸 `vite build` 的差异）。 |

## 查重结论（23 §8 要求，必须记录在提案中）

对照既有 3 个 active Pitfall：

- `Git Gate 双向路径覆盖拦截`——机制为提交路径覆盖校验，无关。
- `首行比较式校验漏掉多余H1`——机制为 Markdown 结构校验的漏检，无关。
- `Electron asar 头偏移误读致解析失败`——机制为二进制归档头解析偏移，无关。

**结论：无同机制既有对象，不构成补充级更新，应新建。**

## 正文（拟）

### 症状
构建命令返回成功（vite 输出 `✓ built in N s`），无任何错误或警告指向资源路径；浏览器打开 SPA 挂载路径时整页空白，开发者工具网络面板可见 JS/CSS 请求指向宿主根路径而非 SPA 前缀路径，返回的是宿主页面或 404。

**识别信号**：页面空白但与构建无关的报错；`index.html` 中 `src`/`href` 以 `/assets/...` 开头而非 `/<prefix>/assets/...`。

### 触发条件
同时满足：(a) SPA 通过宿主挂载在非根前缀（如 `/ldvh`），与宿主共享同一端口；(b) 构建时未指定该前缀（`vite build` 缺少 `--base=/<prefix>/`）；(c) 构建产物目录不作为版本控制内文件被比对或校验。

### 根因
构建工具的 `base` 默认值为 `/`，产物按根路径生成资产引用。该引用相对于**浏览器地址栏的站点根**解析，而非相对于页面所在的前缀路径。因此前缀挂载下引用必然落空。已观察：`--base` 缺失是直接原因。未知：宿主对未知路径的兜底行为在不同部署下是否一致（本实例返回 200 而非 404，使症状更像「空白」而非「资源缺失」）。

### 解决
改用带基址的构建脚本：dsh-ldvh 的 `pnpm build:dsh`（= `tsc -b && vite build --base=/ldvh/ && node scripts/gzip-dist.mjs`）。

**成功信号**：`index.html` 资产引用以 `/ldvh/` 开头；`GET /ldvh` 与 `GET /ldvh/assets/<hash>.js` 均返回 200。
**必要边界**：仅重建即可恢复，无需改源码；但若构建产物已被分发，需重新分发。

### 规避
1. **核对条件**：改 Web 后，检查 `dist/index.html` 的 `src`/`href` 是否全部以挂载前缀开头。
2. **动作**：一律使用带基址的项目构建脚本，不直接调用底层 `vite build`。
3. **机械拦截**：`plugin/web/tests/api/spa-asset-base-contract.test.ts` 在产物存在时校验前缀，违规即失败并打印修复命令；已接入 CI（`.github/workflows/ci.yml` 的 web job 先 `build:dsh` 再跑测试）。
4. **例外**：若该 SPA 改为独立端口或根路径挂载，前缀约束不再适用。

### 验证
已观察：以裸 `vite build` 复现白屏（产物引用 `/assets/...`），守卫测试失败并给出修复提示；以 `build:dsh` 重建后 `/ldvh` 与资产引用均恢复正确，269/269 测试通过。已在全新 clone（无 `dist/`）中复验。
未覆盖：其它构建工具（webpack/rollup 直接配置）的同类行为未验证；宿主兜底路由策略不同的部署未验证。

### 影响与适用范围
**何时可能踩到**：任何「非根前缀挂载 + 共享端口」的 Web 前端构建；尤其当构建产物不入库、且构建成功不校验资源路径时。
**何时可信**：在 Vite 及 `base` 语义相同的构建工具下可信；换用其它构建体系时应重新验证 `base` 等价配置。

## 请 Human 确认

1. 是否创建该 Pitfall（需逐字确认标题、scope）？
2. `title` 是否采用「无基址构建致 SPA 白屏」？
3. `trigger_signal` 是否符合「真实信号、非占位」要求（03 §6.1）？

---

## 处置结果（2026-09-13）

**已按本提案创建，Human 已确认。**

- `object_uid`：`af594d4d-0bcc-4b43-a469-1ebaee928d97`
- 载体：`ldvh-base/pitfalls/pitfall-af594d4d-0bcc-4b43-a469-1ebaee928d97.md`
- 指纹：`05add59d4d10f54617539971532edad3e3eb3f254f46cae7ef5061921c580e4d`
- 状态：`active`；回读 `body_valid: true`

确认项采纳情况：title 采用「无基址构建致 SPA 白屏」（13 字符，≤ 30 字）；`scope` 与 `trigger_signal` 按提案原文落盘。

本文件为该项决定的提案与确认留痕；经验本体以 Pitfall 对象为准，本文件不取得规范效力。
