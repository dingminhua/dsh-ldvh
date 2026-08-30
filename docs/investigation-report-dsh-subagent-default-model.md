# dsh-subagent-default-model 工程规范调研报告

> 调研目标：为 LDVH（dsh-ldvh）构建 DSH 原生插件提供工程标准参照。
> 参考项目（只读）：`/Users/dmh2002/DshProject/dsh-subagent-default-model`
> 报告日期：2026-09-01

---

## 1. 插件目录结构图

```
dsh-subagent-default-model/                 ← Git 仓库根目录
├── .github/workflows/ci.yml               ← CI：Node 20 + npm ci + npm test + npm pack --dry-run
├── .gitignore                            ← node_modules/ + .DS_Store
├── RELEASING.md                          ← 完整发布流程（含 2FA / tag / 代理 / 验证）
├── PLUGIN_REQUIREMENTS.md                ← DSH 插件开发核心要求（审核版）
├── DEVELOPMENT.md                        ← 本地开发工作流（DSH Desktop）
├── plugin/                               ← ⭐ 插件主目录（NPM 包根目录）
│   ├── package.json                      ← 包配置（NPM 包名、版本、依赖、exports）
│   ├── cordis.patch.yml                  ← Bundle patch 声明
│   ├── lib/
│   │   ├── index.js                      ← Host 侧主逻辑（Cordis 插件入口）
│   │   └── client.js                     ← Client 侧 UI（Web 设置行）
│   ├── test/
│   │   ├── default-model.test.mjs        ← 默认模型注入测试（8 用例）
│   │   ├── failover.test.mjs             ← 连接失败自动切换测试
│   │   └── traceable-proxy.test.mjs      ← Cordis Symbol.for("cordis.original") 回归测试
│   ├── icons/
│   │   ├── ldvh-plugin-icon-128.png      ← 128px 插件图标（供 npm 市场）
│   │   └── ldvh-plugin-icon-64.png      ← 64px 插件图标
│   ├── README.md                         ← 用户文档（简体中文）
│   ├── README.en.md                      ← 用户文档（English）
│   ├── CHANGELOG.md                      ← 版本日志（按 Features / Fixes / Docs 分组）
│   ├── LICENSE                          ← MIT License（Copyright © 2026 LaoDing）
│   └── node_modules/                    ← 本地开发依赖（npm ci 后生成，.gitignore 排除）
└── vendor/                               ← 源码继承来源（dsh-subagent-max）
    └── dsh-subagent-max/
        └── test/settings-row.test.mjs    ← 原型参考
```

**关键设计决策**：插件源码放在 `plugin/` 子目录下，而非仓库根目录。这使得仓库可以承载插件本身的开发文档（`RELEASING.md`、`PLUGIN_REQUIREMENTS.md` 等），同时 `plugin/` 本身就是一个独立的、可直接 `npm pack` 的 NPM 包。`repository.directory` 字段指向 `"plugin"` 告知 npm registry 从哪一级目录读取包数据。

---

## 2. package.json 字段逐项解读

```jsonc
// plugin/package.json
{
  "name": "dsh-subagent-default-model",       // NPM 包名（小写字母/连字符）
  "version": "1.0.0",                        // 语义化版本（semver: major.minor.patch）
  "type": "module",                          // ES Module（必须，不能缺）
  "main": "lib/index.js",                    // Node.js require() 默认入口 → Host 侧

  // ⭐ NPM 包导出映射（dsh-bundle 扫描时需要 ./package.json）
  "exports": {
    ".": "./lib/index.js",                   // Host 侧入口（主包）
    "./client": "./lib/client.js",           // Client 侧入口（Web 设置行）
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"       // ⭐ dsh-client-modules 扫描需要此导出
  },

  // ⭐ DSH Bundle 打包声明
  "files": [                                // npm pack 打包内容白名单
    "lib",
    "icons",
    "cordis.patch.yml",
    "LICENSE",
    "README.md",
    "README.en.md",
    "CHANGELOG.md"
    // 注意：test/ 和 node_modules/ 不在打包范围内
  ],

  // ⭐ DSH 特有配置
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"         // bundle.patch 指向本插件的 patch 文件
    },
    "client": {
      "platform": "web",                     // 声明为 Web 平台插件
      "inject": [                           // 注入依赖（client 运行时需要）
        "@deepseek-ai/dsh-client-ui-primitives"  // 用于 Toast / IconChevronDownOutline14
      ]
    }
  },

  // 脚本
  "scripts": {
    "test": "node --test test/*.test.mjs"   // Node.js 内置测试（--test）
  },

  // 依赖
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.1"  // ⭐ Schema 验证库（见下方专题说明）
  },

  // ⭐ 同级依赖（必须由宿主 DSH 提供）
  "peerDependencies": {
    "@deepseek-ai/dsh-settings": "0.1.0-rc.6",
    "@deepseek-ai/dsh-subagent": "0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-primitives": "^0.1.0-rc.6"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/dsh-client-ui-primitives": {
      "optional": true    // client UI primitives 可选（无界面纯 Host 插件可省）
    }
  },

  // 开发依赖
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",       // Cordis 框架（测试时需要 Context / Service）
    "@deepseek-ai/dsh-settings": "0.1.0-rc.6"
  },

  // 元数据
  "engines": { "node": ">=20" },
  "keywords": ["deepseek-harness", "dsh", "dsh-plugin", "subagent", ...],
  "author": "dingminhua",
  "license": "MIT",
  "repository": { "type": "git", "url": "...", "directory": "plugin" },
  "homepage": "...",
  "bugs": { "url": "..." },
  "icon": "icons/ldvh-plugin-icon-128.png"  // npm 市场和扩展市场图标
}
```

### @deepseek-ai/schemastery 的用途

`schemastery` 是 DSH 自研的 Schema 验证库（基于 `@standard-schema/spec`），用于在 Host 侧定义插件配置的形状约束。在本插件中：

```js
import z from "@deepseek-ai/schemastery";

const MODEL_ENTRY = z.union([
    z.string(),                                     // 简单模型 ID
    z.object({
        provider: z.string(),
        model: z.string(),
        reasoningEffort: z.string()
    })
]);

const SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA = z.object({
    provider: z.string(),
    model: z.string(),
    models: z.array(MODEL_ENTRY).default([]),
    strategy: z.union([z.const("round-robin"), z.const("random")]).default("round-robin"),
    failoverEnabled: z.boolean().default(true)
}).default({});
```

用途：
1. **Schema 定义**：用链式 API 描述配置结构，比原始对象字面量更清晰
2. **默认值填充**：`.default()` 在 Schema 层面声明默认值，解析后自动注入
3. **与 dsh-settings 集成**：`installSettingsSection` 接收 Schema 并用它验证用户配置
4. **类型推断**：IDE 可从 Schema 推断出配置类型

---

## 3. 配置 Schema + 设置面板实现模式

### 3.1 Host 侧：Schema 注册与配置读取

**文件**：`plugin/lib/index.js`

```js
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

// 1. 创建设置命名空间（品牌化字符串）
const SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace("subagent-default-model");

// 2. 定义 Schema（见上节）

// 3. 状态对象（保留在 raw service 上）
const WRAPPED = Symbol.for("dsh-subagent-default-model.wrapped");

export function apply(ctx) {
    const state = {
        settingsSource: void 0,   // 动态配置源（live thunk）
        rrCursor: 0              // round-robin 光标
    };

    // 4. 注册设置段（无条件，确保 Web 侧始终可见）
    installSettingsSection(
        ctx,
        SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
        SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA,
        {},   // base：空对象（默认值由 Schema 提供）
        {
            setSource: (current) => { state.settingsSource = current; },
            onChange: () => {}
        }
    );

    // 5. 读取配置（在包装逻辑中调用）
    // state.settingsSource?.() 返回当前解析后的配置对象
}
```

**关键点**：
- `installSettingsSection` 是 `@deepseek-ai/dsh-settings` 提供的工具函数，将插件的设置 namespace 注册到 `ctx.settings` 服务中
- `setSource` 回调传入一个 thunk，调用它可获取当前解析后的配置（含默认值）
- 配置热重载：用户修改 `~/.dsh/settings.yaml` 后，`setSource` 会被重新调用，下一次派发立即生效

### 3.2 Client 侧：设置 UI 注册

**文件**：`plugin/lib/client.js`

```js
// 1. 模块加载入口（DSH Client Module Loader 标准格式）
window.__ModuleLoader__.load({
    id: "dsh-subagent-default-model",
    factory: function (require) {
        var React = require("react");
        var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
        var Toast = primitives.Toast;
        // ...
    }
});

// 2. 注入服务声明（必须包含白名单内的服务）
var inject = [
    "sessions",
    "connection",    // ⭐ 必须：含 api.llm.models() 调用
    "slots",         // ⭐ 必须：settings.plugin.item 注入点
    "locale",        // i18n
    "settingsScope", // 设置读写
    "remote",
    "conversationEvents" // trajectory 注册
];

function apply(ctx) {
    // 3. 注册 i18n
    ctx.locale.register(SUBAGENT_ROW_LOCALE, "zh", SUBAGENT_ROW_ZH);
    ctx.locale.register(SUBAGENT_ROW_LOCALE, "en", SUBAGENT_ROW_EN);

    // 4. 绑定设置命名空间
    var subagentScope = ctx.settingsScope.bind({
        namespace: SUBAGENT_MODEL_SETTINGS_NS
    });

    // 5. 注入设置行（settings.plugin.item 槽位）
    ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
            name: "settings.plugin.item",
            key: "subagent-default-model",  // 全局唯一 key
            locale: SUBAGENT_ROW_LOCALE,   // i18n 键
            inject: subagentRowInjected     // 传给组件的 props 工厂
        }, SubagentModelCard);              // React 组件
    });
}

return { apply: apply, inject: inject };
```

### 3.3 设置面板组件结构

```
SubagentModelCard（折叠卡片外壳）
├── 头部按钮（点击展开/收起）
│   ├── 插件图标（64px data URI 内联）
│   ├── 标题 + 描述
│   └── 箭头图标（IconChevronDownOutline14）
└── 展开内容：SubagentModelRow（主设置行）
    ├── 模型路由列表（每行：Provider / Model / 推理强度 / 移除按钮）
    ├── 策略选择（round-robin / random）
    ├── failoverEnabled 复选框
    ├── 保存 / 放弃修改 按钮
    └── 鼓励一下 ★ 链接
```

### 3.4 LDVH 可复制的模式（针对"管辖文件位置 + 前后端端口"）

基于本插件模式，LDVH 设置面板应：

1. **Schema 定义**（Host 侧）：
   ```js
   import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
   import z from "@deepseek-ai/schemastery";

   const LDVH_SETTINGS_SCHEMA = z.object({
       workspacePath: z.string().default("/Users/dmh2002/DshProject/dsh-ldvh"),
       frontendPort: z.number().default(43120),
       backendPort: z.number().default(3081),
       // 可扩展：监控端口、调试标志等
   }).default({});

   export function apply(ctx) {
       installSettingsSection(
           ctx,
           settingsNamespace("dsh-ldvh"),
           LDVH_SETTINGS_SCHEMA,
           {},
           { setSource: (src) => { state.settingsSource = src; } }
       );
   }
   ```

2. **Client 侧 UI**：类似 `SubagentModelCard`，提供：
   - 路径输入（可点击打开文件夹选择器）
   - 前后端端口数字输入（带范围校验）
   - 保存 / 放弃修改 按钮
   - 成功 Toast

3. **关键 API 依赖**：
   - `ctx.slots.inject("settings.plugin.item", ...)` → 注册到"设置 → 插件配置"面板
   - `ctx.settingsScope.bind({ namespace: "dsh-ldvh" })` → 绑定设置命名空间
   - `scope.getSnapshot()` → 读取当前值
   - `scope.set(key, value)` → 持久化

---

## 4. Host/Client 分工模式

### Host 侧（`lib/index.js`）

| 职责 | 实现方式 |
|------|---------|
| 注册设置 namespace | `installSettingsSection(ctx, namespace, schema, base, callbacks)` |
| 包装子代理服务 | `raw.start = wrappedStart`（覆盖 `ctx.subagents` 的 `start`/`startContinuable`） |
| 监听 agent 循环事件 | `ctx.on("agent/request-error", ...)` / `ctx.on("agent/request", ...)` |
| 注册清理函数 | `ctx.effect(() => cleanupFn, label)` |
| 读取原始服务对象 | `ctx.subagents[Symbol.for("cordis.original")]` |

**Host 侧导出约定**：
```js
export const name = "dsh-subagent-default-model";  // 必须：插件唯一标识
export const inject = ["subagents"];               // 依赖注入（可选）
export function apply(ctx) { /* ... */ }          // 插件主入口
```

### Client 侧（`lib/client.js`）

| 职责 | 实现方式 |
|------|---------|
| 注册 i18n | `ctx.locale.register(ns, "zh", zhObj)` / `ctx.locale.register(ns, "en", enObj)` |
| 注册设置行 | `ctx.slots.inject("settings.plugin.item", ...)` |
| 读写设置 | `ctx.settingsScope.bind({ namespace })` → `scope.getSnapshot()` / `scope.set()` |
| 调用 Host API | `ctx.connection.api.llm.models({})`（通过 RPC） |
| 注册 trajectory | `ctx.conversationEvents.register(def)` |

**Client 侧导出约定**：
```js
var inject = ["sessions", "connection", "slots", "locale", "settingsScope", "remote", ...];
function apply(ctx) { /* 注册 UI */ }
return { apply, inject };
```

### Host ↔ Client 通讯模式

```
Client (client.js)
  ├── ctx.connection.api.llm.models({})     ← RPC 调用 Host API
  ├── ctx.settingsScope (本地读写)           ← 设置读写（自动同步到 Host）
  └── ctx.conversationEvents.register(def)    ← 注册事件处理器

Host (index.js)
  ├── ctx.on("agent/request-error", ...)     ← 监听 agent 循环瀑布
  ├── installSettingsSection(...)             ← 注册设置 namespace（对 Client 可见）
  └── ctx.subagents[Symbol.for("cordis.original")]  ← 包装服务方法
```

**注意**：Client 与 Host 共享 `ctx.settings` 服务，但 Client 通过 `settingsScope` 绑定特定的 namespace。Host 注册的 namespace 对 Client 天然可见（0.1.1-rc.2 已移除白名单）。

---

## 5. cordis.patch.yml 作用解读

**文件**：`plugin/cordis.patch.yml`

```yaml
# dsh-subagent-default-model bundle patch
# 在 bundle 的 plugin 列表中插入一行本插件
- insert:
    - id: dsh-subagent-default-model
      name: 'dsh-subagent-default-model'
```

### patch 操作类型

| 操作 | 作用 | 本插件用法 |
|------|------|-----------|
| `insert` | 在 plugin 列表末尾插入条目 | ⭐ 唯一使用的操作 |
| `remove` | 按 `id` 从 plugin 列表移除条目 | — |
| `disable` | 按 `id` 禁用条目（保留但跳过加载） | — |

### 与 profile 的 cordis.patch.yml 集成

DSH 在加载插件时：

1. 读取当前 profile 的 `cordis.patch.yml`（来自 `~/.dsh/profiles/desktop/cordis.patch.yml`）
2. 扫描所有已安装插件的 `cordis.patch.yml`（来自 `node_modules/*/cordis.patch.yml`）
3. 合并所有 patch 操作（`insert` / `remove` / `disable`）
4. 应用到最终的 bundle plugin 列表

**安装流程**：`dsh plugin --profile desktop add /path/plugin` 会：
- 将插件以 `link:` 形式加入 profile 的 `package.json` dependencies
- 自动 reconcile `dsh.profile.bundles` 列表（添加本插件条目）

**本插件 patch 的作用**：让 DSH bundle 在启动时加载本插件的 Host 侧（`lib/index.js`）和 Client 侧（`lib/client.js`）。

---

## 6. 测试模式

### 6.1 测试框架

- **框架**：Node.js 内置 `--test`  runner（`node --test test/*.test.mjs`）
- **断言**：`node:assert/strict`
- **无额外测试依赖**：仅使用 `@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-settings`

### 6.2 测试辅助：Mock Cordis Context

```js
// 创建内存化的 SettingsProvider（不读写文件系统）
class MemorySettings extends SettingsProvider {
    constructor(ctx, document) {
        super(ctx, "settings");
        this.document = document;
    }
    async load() { return this.document; }
    get writable() { return false; }
}

// 创建测试 harness
async function createHarness(document = {}) {
    const root = new Context();
    const calls = [];
    const subagents = {
        async start(name, request) { calls.push({ type: "start", name, request }); return { name, request }; },
        async startContinuable(spec) { calls.push({ type: "startContinuable", spec }); return spec; }
    };
    root.provide("subagents", subagents);

    const settings = new MemorySettings(root, document);
    await settings.load().then((loaded) => settings.publish(loaded));
    await root[Symbol.for("cordis.init")]?.();
    const fiber = root.registry.plugin(defaultModelPlugin);
    await fiber;

    return { root, settings, subagents, calls, fiber };
}
```

**关键 mock 手段**：
- `Context` 提供 Cordis 运行时环境
- `root.provide("subagents", ...)` 注入 mock 服务
- `MemorySettings` 提供内存化配置（替代文件系统）
- `root.registry.plugin(plugin)` 手动激活插件（替代 bundle 加载）
- `root.waterfall(eventName, payload, next)` 手动派发瀑布事件

### 6.3 测试覆盖

| 测试文件 | 覆盖内容 | 用例数 |
|---------|---------|--------|
| `default-model.test.mjs` | 单模型注入、无配置保留、显式覆盖、round-robin 热重载、continuable、仅 start 模式、服务还原重载 | 8 |
| `failover.test.mjs` | subagent-only gate、连接失败码匹配、round-robin/random 策略、池耗尽、disposal 清理、reasoningEffort 丢弃、sticky within run | 11 |
| `traceable-proxy.test.mjs` | `Symbol.for("cordis.original")` 回归验证 | 1 |

### 6.4 瀑布事件手动派发

```js
// 模拟 agent/request-error 瀑布
function dispatchRequestError(ctx, agent, opts = {}) {
    return ctx.waterfall("agent/request-error", {
        agent, turn: opts.turn ?? 1, step: opts.step ?? 1,
        provider: opts.provider,
        failure: opts.failure ?? { message: "boom", code: "RATE_LIMIT" },
        signal: new AbortController().signal
    }, () => Promise.resolve(void 0));
}

// 模拟 agent/request 瀑布
function dispatchRequest(ctx, agent, seed, opts = {}) {
    return ctx.waterfall("agent/request", {
        agent, turn: opts.turn ?? 1, step: opts.step ?? 1,
        signal: new AbortController().signal
    }, () => Promise.resolve(seed));
}
```

### 6.5 集成测试

```js
// integration.mjs：派发与生命周期集成测试
// prove.mjs：Cordis traceable-proxy 回归测试
```

---

## 7. 发布流程（完整步骤清单）

> 权威来源：[`RELEASING.md`](https://github.com/dingminhua/dsh-subagent-default-model/blob/main/RELEASING.md)

### 前置条件

```bash
npm whoami        # 应显示 dmh2002
# 若开启 2FA：npm publish 时需在浏览器确认一步
# 网络：代理 127.0.0.1:7897（git 和 npm 均已配置）
```

### 完整步骤

```bash
cd /Users/dmh2002/DshProject/dsh-subagent-default-model

# 步骤 1：确认代码与测试（应全部通过）
npm --prefix plugin test

# 步骤 2：更新版本号
# 手动修改 plugin/package.json 的 version 字段，或：
npm --prefix plugin version patch|minor|major --no-git-tag-version
# 假设目标版本为 X.Y.Z

# 步骤 3：更新 CHANGELOG.md
# 在 plugin/CHANGELOG.md 顶部新增：
# ## X.Y.Z (YYYY-MM-DD)
# ### Features / Fixes / Docs（按需分组）
# 参考现有 1.0.0 的格式

# 步骤 4：提交并打 git tag
git add plugin/package.json plugin/CHANGELOG.md
git commit -m "chore: 版本升级至 X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <一句话说明>"
git push origin main
git push origin vX.Y.Z

# 步骤 5：发布到 npm
cd plugin
npm publish

# 步骤 6：若账号开启 2FA
# npm publish 会打印浏览器确认 URL（如 https://www.npmjs.com/auth/cli/<id>）
# 用浏览器打开 → 登录 → 点击确认 → 终端自动继续
# 建议勾选 "Do not challenge ... for the next 5 minutes" 避免重复验证

# 步骤 7：验证发布成功
npm view dsh-subagent-default-model version         # 应为 X.Y.Z
npm view dsh-subagent-default-model dist-tags.latest # 应为 X.Y.Z
```

### 发布后本地使用

```bash
# npm registry 版本（发布后安装）
cd ~/.dsh/profiles/desktop
npm install dsh-subagent-default-model

# 本地开发（link: 安装，改码重启生效）
dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-subagent-default-model/plugin
# 重启 DSH Desktop
```

### 版本号规则

- `major`：破坏性变更（如 API 签名变更）
- `minor`：新功能（向后兼容）
- `patch`：Bug 修复

### npm pack 打包内容

`package.json` 的 `files` 字段白名单限定：
- ✅ `lib/`（源码）
- ✅ `icons/`（图标）
- ✅ `cordis.patch.yml`
- ✅ `LICENSE`
- ✅ `README.md` + `README.en.md`
- ✅ `CHANGELOG.md`
- ❌ `test/`（不打包）
- ❌ `node_modules/`（不打包）

---

## 8. 插件管理相关

### 8.1 插件生命周期

```
dsh plugin --profile desktop add <path>  ← 安装（首次/重装）
    ↓
DSH Desktop 启动
    ↓
Bundle 加载 cordis.patch.yml 中的插件列表
    ↓
对每个插件：
    ├── 加载 lib/index.js（Host 侧）→ apply(ctx) → 注册服务/事件/设置段
    └── 加载 lib/client.js（Client 侧）→ __ModuleLoader__.load → 注册 UI
    ↓
插件激活，运行中（热重载：settings.yaml 变更 → setSource 回调触发）
    ↓
DSH Desktop 退出（⌘Q）
    ↓
ctx.effect 清理函数执行 → 服务方法还原、事件监听器移除
```

### 8.2 与关键 peer 依赖的关系

| peer 依赖 | 版本 | 作用 |
|-----------|------|------|
| `@deepseek-ai/dsh-settings` | `0.1.0-rc.6` | 提供 `installSettingsSection` / `settingsNamespace` / `SettingsProvider` |
| `@deepseek-ai/dsh-subagent` | `0.1.0-rc.6` | 提供 `ctx.subagents` 服务（`start`/`startContinuable`） |
| `@deepseek-ai/dsh-client-ui-primitives` | `^0.1.0-rc.6` | 可选，提供 `Toast` / `IconChevronDownOutline14` 等 UI 组件 |

### 8.3 dsh.bundle.patch 机制

```jsonc
// plugin/package.json
"dsh": {
    "bundle": {
        "patch": "./cordis.patch.yml"   // 指向本插件的 patch 文件
    }
}
```

DSH bundle 在启动时：
1. 读取所有已安装插件的 `package.json` → `dsh.bundle.patch` 路径
2. 加载并合并所有 `cordis.patch.yml`
3. 应用 `insert` / `remove` / `disable` 操作到 plugin 列表
4. 实例化最终列表中的每个插件

---

## 9. 可复用于 LDVH 的规范 + 需另行调研的缺口

### 9.1 可直接复用的规范

| 规范项 | 复制方式 |
|--------|---------|
| 目录结构 | `plugin/` 子目录承载插件源码，`lib/index.js` + `lib/client.js` 分工 |
| package.json | 复制 `files`/`exports`/`dsh.bundle.patch`/`dsh.client` 结构 |
| `@deepseek-ai/schemastery` | 直接使用 `z.object().default({})` 模式定义配置 Schema |
| `@deepseek-ai/dsh-settings` | 使用 `installSettingsSection` / `settingsNamespace` 注册设置 |
| Cordis Host 模式 | `export const name/inject; export function apply(ctx)` |
| Cordis Client 模式 | `window.__ModuleLoader__.load({ id, factory })` + `inject` 数组 |
| `Symbol.for("cordis.original")` | 包装服务时获取原始对象 |
| `ctx.effect()` | 注册清理函数 |
| `ctx.on()` / `ctx.waterfall()` | 监听事件瀑布 |
| Web 设置行注册 | `ctx.slots.inject("settings.plugin.item", ...)` |
| i18n 注册 | `ctx.locale.register(ns, "zh", obj)` |
| 测试模式 | `node --test` + `MemorySettings extends SettingsProvider` + `createHarness` 模式 |
| CI 配置 | `.github/workflows/ci.yml`（Node 20 + npm ci + npm test + npm pack --dry-run） |
| 双语 README | `README.md` + `README.en.md` |
| CHANGELOG 格式 | `## X.Y.Z (YYYY-MM-DD)` + `### Features / Fixes / Docs` |
| MIT 许可证 | 版权 `Copyright (c) 2026 LaoDing` |
| 图标文件 | `icons/ldvh-plugin-icon-128.png` + `64.png`（data URI 内联到 Client） |

### 9.2 需要另行调研的缺口

#### 缺口 1：Tab / Sidebar 主界面入口

**当前状态**：`dsh-subagent-default-model` 是一个纯路由插件，不注册任何 Tab 或 Sidebar 入口。

**DSH 原生 Tab/Sidebar 机制**（需进一步调研）：
- DSH 内置插件如何注册 `settings.general.item` / `settings.plugin.item` 以外的入口？
- `ctx.slots.inject("main.tab", ...)` / `ctx.slots.inject("sidebar.item", ...)` 是否存在？
- Tab/Sidebar 入口的组件注册模式（React 组件还是纯 HTML）？
- 入口的图标、标题、激活条件如何定义？

**调研建议**：
1. 检查 `@deepseek-ai/dsh-client-ui-primitives` 的导出（Tab/Sidebar 相关组件）
2. 检查 DSH 源码中的 Slot 树（`ctx.slots` 的完整路径）
3. 查看 DSH 官方插件（如 `dsh-tools`）是否有 Tab/Sidebar 注册示例

#### 缺口 2：Web 服务进程生命周期

**当前状态**：`dsh-subagent-default-model` 无独立 Web 服务进程，所有功能通过 Cordis Host/Client 模式实现。

**可能需要的 Web 服务场景**：
- LDVH 可能需要启动一个本地 HTTP 服务（用于前端调试 / API 代理 / 文件监控）
- 如何在 DSH 插件中启动 Node.js `http.Server`？
- 生命周期管理：`ctx.effect(() => server.close(), "ldvh-server")`
- DSH Desktop 退出时如何保证服务被正确关闭？

**调研建议**：
1. 检查 `@deepseek-ai/cordis` 的 Service 扩展机制
2. 参考 DSH 官方插件是否有 HTTP 服务示例
3. 确认 DSH Desktop 的进程管理策略（插件服务是否受 DSH 控制）

#### 缺口 3：cordis.patch.yml 高级操作

**当前仅使用了 `insert`**。如果 LDVH 需要条件性加载、依赖声明、顺序控制，需要调研：
- `remove` / `disable` 的实际效果
- patch 中是否可以声明插件依赖（加载顺序）
- `id` 与 `name` 的区别（`id` 是否必须唯一？）
- patch 是否支持变量替换（如 `${profile.name}`）？

#### 缺口 4：client.js 的 API 能力边界

**当前使用的能力**：
- `ctx.connection.api.*`（RPC 调用 Host API）
- `ctx.settingsScope`（设置读写）
- `ctx.conversationEvents.register`（trajectory 事件注册）
- `ctx.locale`（i18n）

**需要确认的能力**：
- `ctx.slots` 的完整可用路径（除了 `settings.plugin.item`）
- `ctx.remote` 的使用场景
- Client 能否注册新的 Cordis Service？
- Client 能否访问 `window` 对象（`window.__ModuleLoader__` 之外）？

---

## 10. 开放问题（questions）

### 10.1 Tab/Sidebar 注册

1. **Q1**：DSH 插件如何注册主界面 Tab（如"LDVH" Tab）？是 `ctx.slots.inject("main.tab", ...)` 还是其他路径？
2. **Q2**：Sidebar 项（左侧导航）的注册机制是什么？是否有标准路径？
3. **Q3**：Tab/Sidebar 入口的组件是否必须使用 `@deepseek-ai/dsh-client-ui-primitives` 中的组件，还是可以用原生 HTML/CSS？
4. **Q4**：多个插件同时注册同一个 Tab key 时，DSH 如何处理冲突？

### 10.2 配置持久化

5. **Q5**：`installSettingsSection` 的 `base` 参数与 Schema 的 `.default()` 优先级谁更高？
6. **Q6**：设置保存是同步还是异步？`scope.set()` 返回 Promise 还是直接成功？
7. **Q7**：如果用户在 DSH 设置界面手动编辑 `settings.yaml`，插件如何感知并热重载？

### 10.3 Host/Client 边界

8. **Q8**：Client 侧的 `ctx.connection.api` 有哪些可用的 API 方法？`llm.models({})` 之外还有什么？
9. **Q9**：Client 能否直接调用 Host 的自定义 Service（通过 `ctx.get("serviceName")`）？还是必须通过 `api.*` RPC？
10. **Q10**：当 Host 注册的 Service 尚未挂载时，Client 的 `ctx.connection.api` 是否可用？

### 10.4 插件安装与卸载

11. **Q11**：`dsh plugin --profile desktop remove` 是否会清理插件注册的所有设置 namespace？
12. **Q12**：插件卸载后，`~/.dsh/settings.yaml` 中的插件配置段是否会被保留（作为"已卸载插件的残留"）？
13. **Q13**：一个插件能否同时被多个 profile 加载？是否存在全局插件（对所有 profile 生效）？

### 10.5 Web 服务与进程

14. **Q14**：DSH Desktop 的插件进程模型是什么？插件的 Node.js 代码运行在哪个进程中（主进程 / 渲染进程 / 子进程）？
15. **Q15**：如果 LDVH 需要启动本地 HTTP 服务器（端口如 43121），是否应该在 Host 侧用 `ctx.effect()` 管理，并在插件卸载时清理？

### 10.6 CI/CD 与发布

16. **Q16**：GitHub Actions 发布时如何处理 2FA？是否需要 granular access token？
17. **Q17**：发布后 `npm view` 的 registry 缓存延迟通常是多久？是否有办法主动刷新？

---

## 附录：关键文件路径速查

| 文件 | 路径 |
|------|------|
| Host 侧入口 | `plugin/lib/index.js` |
| Client 侧入口 | `plugin/lib/client.js` |
| Bundle patch | `plugin/cordis.patch.yml` |
| 包配置 | `plugin/package.json` |
| 单元测试 | `plugin/test/*.test.mjs` |
| 用户文档 | `plugin/README.md` + `plugin/README.en.md` |
| 版本日志 | `plugin/CHANGELOG.md` |
| 许可证 | `plugin/LICENSE` |
| 图标 | `plugin/icons/ldvh-plugin-icon-{64,128}.png` |
| CI 配置 | `.github/workflows/ci.yml` |
| 发布流程 | `RELEASING.md` |
| 开发规范 | `DEVELOPMENT.md` |
| 审核要求 | `PLUGIN_REQUIREMENTS.md` |
| Cordis 框架 | `@deepseek-ai/cordis` |
| 设置服务 | `@deepseek-ai/dsh-settings` |
| Schema 库 | `@deepseek-ai/schemastery` |
| UI 组件 | `@deepseek-ai/dsh-client-ui-primitives` |

---

*报告生成时间：2026-09-01 | 调研者：LDVH 调研子代理 | 参考项目：dingminhua/dsh-subagent-default-model*
