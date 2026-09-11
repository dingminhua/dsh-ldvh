# 双读取通道并存影响调查（主控自查）

> **性质**：**事实调查**，非方案、非候选。
> **缘起**：原派出的调查代理（`8ec2e5a6`）被中止且**未产出任何文件**。主控自行补做其高风险部分。
> **范围**：仅覆盖「两条读规范通道并存」的落地风险；未做穷尽穷举，缺口见文末。
> **基准**：`f6efdad`（工作区干净）。

---

## 一、已查清的冲突点（逐项附证据）

### 1.1 路径隔离 —— **无冲突**（核心结论）

| 通道 | 基路径 | 证据 |
|---|---|---|
| 元规范 | `<projectRoot>/specs/` | `plugin/lib/ldvh-tools.js:75` `join(projectRoot,"specs")` |
| 事实对象 | `<projectRoot>/ldvh-base/` | `plugin/lib/adr-tools.js:52` `FACT_SOURCE_ROOT_DIR="ldvh-base"`；`:109` `join(governed.project.path, FACT_SOURCE_ROOT_DIR)` |

**关键检验**：是否存在任何代码**递归扫描 `ldvh-base` 寻找 `specs`**？

```
$ grep -rn 'ldvh-base' plugin/lib/*.js | grep -iE 'readdir|scan|glob|walk'
  → 仅 adr-enumeration.js:44 的注释，无实际递归扫描
```

**→ 结论：`ldvh-base/norms/` 不会被 `scanSpecCandidates` 收进元规范成员表，不消耗 `SPEC_ID_PATTERN`（`spec-registry.js:27` `/^[0-9]{2,}$/`）数字命名空间。碰撞风险不成立。**

### 1.2 按 basename 匹配 `specs` 的代码 —— **无歧义**

```
$ grep -rn '"specs"' plugin/lib/*.js plugin/web/api/services/*.ts | grep -v '^\S*: *[/*]'
  plugin/lib/ldvh-tools.js:75:  const specsRoot = join(projectRoot, "specs");
```

全仓**仅此一处**，且锚定 `projectRoot`（非 basename 匹配）。**无同名歧义。**

### 1.3 Git Gate 路径特判 —— **无**

```
$ grep -n 'specs\|ldvh-base' plugin/lib/commit-validation.js
  3,4,23: 仅文档注释引用 specs/06、specs/09
```

**无任何路径匹配逻辑** → `ldvh-base/norms/` 下文件走 Git Gate 不会被误判。

### 1.4 `factSourceStatus` 完整性检查 —— **会纳入新目录，且当前已在误报**

`plugin/lib/governed-projects.js:119-137`：对 `FACT_DIRECTORIES` 每项 `lstat`，缺任一项即 `incomplete`。

**实测当前状态**（复现该函数逻辑）：

```
FACT_DIRECTORIES = ["sparks","workcases","adrs","pitfalls","researches"]
missing: [ 'workcases' ]
state:   incomplete
```

**用户可见**：`plugin/lib/client.js:600-608` 把 `incomplete` 列为 `repairable` 并向用户呈现。

**→ 含义**：`workcases` 声明与磁盘不一致**已在产生用户可见的误报**。这是既有缺陷，不是本次设计引入。

---

## 二、测试面（穷尽）

### 2.1 `plugin/test/governed-projects.test.mjs` —— **不会因加目录而失败，但存在测试质量缺陷**

基线：`node --test test/governed-projects.test.mjs` → **29 pass / 0 fail**。

**实测**：临时把 `lib/governed-projects.js:13` 改为含 `"frictions","specs"` 后重跑 → **仍 29 pass / 0 fail**。

**原因**（已定位）：测试**自己复制了一份常量**，与 lib 解耦：

```js
// test:30
const FACT_DIRECTORIES = ["sparks", "workcases", "adrs", "pitfalls", "researches"];
// test:86  —— 断言的是【自己定义的这个】常量，等于自查
assert.deepEqual(FACT_DIRECTORIES, ["sparks", "workcases", "adrs", "pitfalls", "researches"]);
```

**→ 双重后果**：
1. 加目录**不会**触发失败（好消息）；
2. 但该断言**也不校验 lib 的实际清单**——lib 与测试可静默漂移（**缺陷**，本次已实测证实漂移存在：lib 无 `frictions` 而 `friction-writer.js:45` 写入 `frictions/`）。

### 2.2 `plugin/web/tests/api/fact-field-contract.test.ts` —— **会失败，必须同步**

```ts
// :48  —— 断言的是【导入的】FACT_TYPES
assert.deepEqual(FACT_TYPES, ['workcase','adr','pitfall','spark','research','friction']);
```

与 2.1 相反：此处 `deepEqual` 比对的是 `factFieldContract.ts:10` 导入的真实常量。

**→ 新增事实类型 `factnorm` 必须同步改此行，否则测试失败。**

### 2.3 其它

- `plugin/test/ldvh-tools.test.mjs:72,109,131,143-146`：使用**虚构夹具** `specs/11-规范示例一.md`、`specs/12-规范示例二.md`（`title:"规范示例一"`、`positioning:"p1"`），写入临时项目根。**与真实 11/12 号规范无关**；将来若把 11/12 重编为 30/31，**这些夹具不得跟着改**。

---

## 三、Web 侧类型枚举（源头 + 传播）

**唯一源头**：`plugin/web/api/services/factFieldContract.ts:10`

```ts
export const FACT_TYPES = ['workcase','adr','pitfall','spark','research','friction'] as const
export type FactType = (typeof FACT_TYPES)[number]
```

`FactType` 是**派生类型**，因此新增类型会**在编译期传播**到消费点（这是好性质：编译器会指出遗漏）。

**已识别的消费点**（`grep -l` 命中，非穷尽）：
- `plugin/web/api/services/localFactReader.ts`（`FACT_TYPE_DIRS` :14、`FACT_TYPE_CARRIERS` :23）
- `plugin/web/src/utils/`：`commitLabels.ts`、`objectSignals.ts`、`api.ts`、`listStatus.ts`、`fieldFormats.ts`
- `plugin/web/src/components/`：`WorkCaseProgressFilter.tsx`、`StatusBadge.tsx`、`ObjectIdentityActions.tsx` 等

**未做**：上述消费点是否**全部**会被类型系统捕获（部分可能用字符串字面量而非 `FactType`）。**这是残留未证实项。**

---

## 四、插件侧改动点

| 文件:行 | 现值 | 加 `specs` 后 |
|---|---|---|
| `plugin/lib/governed-projects.js:13` | `["sparks","workcases","adrs","pitfalls","researches"]` | 需含 `specs`（并处理 `frictions`/`workcases` 漂移） |
| `plugin/web/api/services/localFactReader.ts:14` | `FACT_TYPE_DIRS` 6 项 | 加 `factnorm: 'specs'` |
| `plugin/web/api/services/localFactReader.ts:23` | `FACT_TYPE_CARRIERS` 6 项 | 加 `factnorm: '.md'` |
| `plugin/web/api/services/factFieldContract.ts:10` | `FACT_TYPES` 6 项 | 加 `'factnorm'` |
| `plugin/web/tests/api/fact-field-contract.test.ts:48` | 硬编码 6 项 | **必须同步**，否则测试失败 |

---

## 五、残留未证实范围（据实）

1. **工具注册表**：未核 `OPERATIONS`（`ldvh-tools.js`）与 `discover-ldvh-capabilities` 的输出是否需扩展以暴露新类型。
2. **Web 消费点穷尽性**：未逐一核实上述组件是否均被 `FactType` 类型系统覆盖；可能存在字符串字面量硬编码。
3. **i18n / 图标 / Tab 配置**：未系统排查是否存在按类型的 UI 映射表。
4. **`05.Att.01` 字段契约**：`factFieldContract.ts` 注释自称「与 05.Att.01、type bindings 机械核对」，但测试注释称「不再依赖 v4 归档的 `05.Att.01`」——两者说法是否一致，**未核**。
5. **端到端**：未构造真实项目实测「新增类型 → 安装 → 写入 → Web 呈现」全链路。

---

## 六、复现命令

```bash
cd /Users/dmh2002/DshProject/dsh-ldvh
grep -n 'FACT_DIRECTORIES = ' plugin/lib/governed-projects.js
grep -n 'FACT_TYPES = ' plugin/web/api/services/factFieldContract.ts
grep -n 'FACT_TYPE_DIRS\|FACT_TYPE_CARRIERS' plugin/web/api/services/localFactReader.ts
grep -rn '"specs"' plugin/lib/*.js plugin/web/api/services/*.ts | grep -v '^\S*: *[/*]'
grep -n 'specs\|ldvh-base' plugin/lib/commit-validation.js
cd plugin && node --test test/governed-projects.test.mjs
```
