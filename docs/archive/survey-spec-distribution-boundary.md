# 事实调查：LDVH 自身规范 与 随插件发布 的真实关系

- **调查性质**：只调查事实，不设计、不提方案。所有结论附可复现命令或 `文件:行号`。
- **工作目录**：`/Users/dmh2002/DshProject/dsh-ldvh`（Git 分支 `dev`）
- **未修改**：`specs/`、`plugin/` 任何文件；未执行 `npm publish`；未提交 git。
- **调查时间**：仓库状态 `Sep 11 12:xx`（按文件 mtime）。

---

## 0. 调查方法与范围

- 机械事实来自 `npm pack --dry-run`（`plugin/` 目录，仅 dry-run）、`grep` 源码、读取规范原文。
- 运行时读取路径通过追踪 `plugin/lib/` 的符号引用确定（未运行插件进程）。
- 本调查**未执行**任何会改变磁盘状态的操作，除读取外。

---

## 1. 插件实际发布什么（机械事实）

### 1.1 `plugin/package.json` 的 `files` 白名单

来源：`plugin/package.json:39-48`

```
"files": [
  "lib",            // 插件运行时核心代码（Host + Client + bin）
  "icons",          // 插件图标（ldvh-plugin-icon-64/128.png）
  "cordis.patch.yml",// DSH bundle patch（插件接入声明）
  "web/dist",       // 构建后的前端 SPA（见 1.3 矛盾项）
  "LICENSE",
  "README.md",
  "README.en.md",
  "CHANGELOG.md"
]
```

逐项解释：
- `lib`：插件逻辑全部在此。含 `index.js`（组装层）、`client.js`（浏览器端）、`ldvh-tools.js`、`spec-registry.js`、`governed-projects.js`、`*-writer.js`/`*-tools.js`（各类事实对象机械层）、`git-gate-runner.js`、各类钩子/生命周期模块。
- `icons`：仅图标 PNG，无规范文本。
- `cordis.patch.yml`：`plugin/cordis.patch.yml`（14 行），仅声明插件 id/name，不含 `specs/`。
- `web/dist`：前端构建产物目录（实际存在，`plugin/web/dist/index.html` 等）。**但见 1.3：当前实际不会被打包。**
- `LICENSE` / `README.md` / `README.en.md` / `CHANGELOG.md`：门面文档。

### 1.2 `npm pack --dry-run` 实际打包内容

命令（仅 dry-run，未发布）：
```
cd /Users/dmh2002/DshProject/dsh-ldvh/plugin && npm pack --dry-run
```
输出片段（节选，共 46 个文件，package size 207.6 kB，unpacked 666.1 kB）：
```
npm notice name: dsh-ldvh
npm notice version: 1.0.0-dev.1
npm notice 3.7kB CHANGELOG.md
npm notice 1.1kB LICENSE
npm notice 2.2kB README.en.md
npm notice 1.9kB README.md
npm notice 770B cordis.patch.yml
npm notice 6.0kB icons/ldvh-plugin-icon-64.png
npm notice 18.3kB icons/ldvh-plugin-icon-128.png
npm notice 5.6kB lib/adr-enumeration.js
...（共 36 个 lib/*.js）
npm notice 2.3kB package.json
npm notice total files: 46
```

**结论**：打包内容 = `files` 白名单中实际落盘且未被忽略的文件，即 `lib/`、`icons/`、`cordis.patch.yml`、`LICENSE`、`README.md`、`README.en.md`、`CHANGELOG.md`、`package.json`。**不含 `specs/`、`ldvh-base/`、根目录 `specs/`、`docs/`、`AGENTS.md`、`README.md`（根）/`plugin/README.md` 之外任何内容。**

### 1.3 `specs/` 是否被任何发布路径包含

- `files` 白名单（1.1）：**不含** `specs`、`ldvh-base`、根目录任何 `*.md`（除门面三件）。
- `.npmignore`：仓库内（含 `plugin/`）**未找到** `.npmignore`（`find . -name .npmignore -not -path '*/node_modules/*'` 无结果）。
- `cordis.patch.yml`：`plugin/cordis.patch.yml:1-14`，仅声明插件 id/name，无 `specs/` 引用。
- 构建脚本：`plugin/package.json:49-53` 的 `scripts` 仅有 `test`/`build:web`/`lint`，无把 `specs/` 拷入 `web/dist` 或 `lib` 的步骤；`build:web` 指向 `web/` 子项目单独构建。
- CI：`.github/workflows/ci.yml:40-41` 仅做 `npm pack --dry-run` 校验 + `node --check`，未上传/打包 `specs/`。
- **矛盾项（重要）**：`files` 含 `web/dist`，但 dry-run tarball **没有任何 `web/` 条目**（`npm pack --dry-run | grep -i web` 只命中 `lib/web-mount.js`、`lib/web-preferences.js`，无 `web/dist`）。
  - 机制：仓库根 `.gitignore:23` 含 `dist/`，匹配 `plugin/web/dist`；`git check-ignore plugin/web/dist/index.html` => `plugin/web/dist/index.html`（确认被忽略）。由于 `plugin/` 内无 `.npmignore`，npm 回退到 `.gitignore`，`dist/` 命中 `web/dist` 目录，故 `files` 中的 `web/dist` **实际不产出**。即前端 SPA 当前也不会随包发布（与 `plugin/README.md:5` "完整 LDVH Web 仍在迁移中"一致）。

### 1.4 `.github/` 发布 workflow

- `.github/workflows/` 仅 `ci.yml`（一份）。
- 内容（`.github/workflows/ci.yml:1-41`）：`push`/`pr`/`workflow_dispatch` 触发；`working-directory: plugin`；步骤为 `npm ci` → `npm test` → `node --check` → `npm pack --dry-run`。
- **没有**发布/上传/ `npm publish` / 上传 artifact 到市场的步骤。`permissions: contents: read`。
- 结论：CI 只做单元校验与包内容 dry-run 校验，**不打包、不上传、不发布 `specs/` 或任何额外内容**。

---

## 2. `specs/` 的实际角色（核心项）

### 2.1 谁在运行时读取 `specs/`

在 `plugin/lib/`（排除 `test/`）穷尽搜索 `specs` 引用：

- `plugin/lib/ldvh-tools.js:73-116` —— `scanSpecCandidates(projectRoot)`：
  - `:75` `const specsRoot = join(projectRoot, "specs");`
  - `:78` `readdir(specsRoot, ...)`；`:80` ENOENT 时返回 `{ ok:false, reason:"specs/ directory not found in the governed project" }`
  - `:86` 正则 `/^[0-9]{2,}-[^/]+\.md$/` 收集 `specs/<n>-*.md`
  - `:88-93` 收集 `specs/attachments/<n>.Att.<n>-*.md`
  - `:103` `readFile(join(projectRoot, repoPath), "utf8")` 读取规范文本
  - `:108` `parseSpecDocument(...)`（来自 `spec-registry.js`）解析身份块
- `plugin/lib/ldvh-tools.js:20` `import { parseSpecDocument, extractHeadings, resolveHeadingPath, contentFingerprint, projectLayer } from "./spec-registry.js";`
- `plugin/lib/spec-registry.js`：纯函数解析器，注释 `:5-6` 声明其权威为 `specs/01 §6`、`01.Att.02`、`01.Att.03 §4`。内含常量 `SPEC_PATH_PATTERN = /^specs\/[0-9]{2,}-[^/]+\.md$/`（`:29`）、`ATTACHMENT_PATH_PATTERN`（`:30`）——**路径形态硬编码为 `specs/<n>-*.md`**。
- 其余 `lib/*.js` 中 `specs/...` 仅作为**注释里的权威引用**（如 `adr-tools.js:3` "Authorities: specs/03 §8.2"、`research-session.js:4` "specs/11 §5–§8"），**不读取文件**。

### 2.2 读取是硬编码相对路径 / 包内解析 / 工作区解析

- **结论：从「项目工作区（governed project 的 Git 根）」解析，不是从插件包内解析，也不是硬编码绝对路径。**
- 证据链：
  1. `scanSpecCandidates(projectRoot)` 的 `projectRoot` 来自 `ldvh-tools.js:137,148` 的 `governed.project.path`，而 `governed` 来自 `resolveGovernanceScope(...)`（`governance-scope.js:45`）。
  2. `resolveGovernanceScope` 的 `project.path` 来自登记载体 `ldvh/governed-projects.yaml` 中的 `projects[].path`（`governed-projects.js:73` 投影 `path`；`:204` 用 `realpath(project.path)` 做判定）。
  3. 该登记载体位于 **DSH 用户配置根**（`~/.dsh/ldvh/governed-projects.yaml`，见 `governed-projects.js:11` `REGISTRATION_RELATIVE_PATH = ["ldvh","governed-projects.yaml"]`），由安装事务写入（`governed-projects.js:240-258` `registerProject`、`:260-298` `installProject` 会 `initializeFactSource` + `installHook` + 登记）。
  4. `join(projectRoot, "specs")`（`ldvh-tools.js:75`）=> `specs/` 被定位在**被登记管辖项目的 Git 根目录下**，而非插件安装目录（`node_modules/.../dsh-ldvh/`）内。

### 2.3 关键答案：新装插件的用户机器上是否会有 `specs/`

**不会自动拥有。**

- `specs/` 既不在 `files` 白名单（1.1）、也不在 dry-run tarball（1.2）、也不在 CI 上传（1.4）。
- `specs/` 是**管辖项目工作区**的资产（`07 §6.1` 定义工作对象 = Git 根 + `ldvh-base/` + `specs/`，见 `specs/07-工作对象与管辖范围规范.md:159`），由用户自己的项目提供，不是插件分发的产物。
- 插件对 `specs/` 的依赖只在 **governed 会话**下触发：`ldvh-tools.js:134-158` `executeReadSpecificationCandidates` 先 `resolveGovernanceScope`，非 governed 直接 `unavailable`；governed 时调 `scanSpecCandidates(governed.project.path)`，若该项目无 `specs/` 则返回 `:80` 的 `"specs/ directory not found in the governed project"`（即 `read-specification-candidates` 返回 `unavailable` + gap）。
- **插件依赖 `specs/` 的功能如何工作**：只有当用户「在某个受 LDVH 管辖、且其 Git 根下自带 `specs/` 的项目内」发起会话时才工作。对一个「只装了插件、但项目里没有 `specs/`」的用户，`read-specification-candidates` 等读取工具会**如实 unavailable**，不会崩溃，也不会从插件包里找规范（插件包里根本没有）。
- 唯一的「随插件自带」规范文本是 `plugin/README.md`/`README.en.md`/`CHANGELOG.md`/`LICENSE`/`cordis.patch.yml` 以及代码注释里引用的规范编号——代码本身（`spec-registry.js`）把 `specs/01` 等当作**权威来源引用**，但解析器读取的 `.md` 文件始终来自项目工作区。

### 2.4 `specs/` 被当作「LDVH 自身资产」还是「项目资产」

- `specs/07-工作对象与管辖范围规范.md:159`：工作对象（=管辖项目的工作对象）**包含** `specs/`，即规范路径是**管辖项目工作区的一部分**——按 07 语义，`specs/` 被视为**项目资产（项目规范源）**。
- `specs/00-理念与构成.md:130-136` §3.3：规范源由「元规范（LDVH 自身）+ 事实规范（管辖项目）」两级承载；`specs/` 目录是规范源的落盘位置，可同时承载元规范与事实规范。
- `spec-registry.js` 把 `specs/00` 视为「根规范（root profile）」并硬编码其固定值（`spec-registry.js:163-168`：`responsibilityKey==="ldvh-root"`、`specId==="00"`、`canonicalPath==="specs/00-理念与构成.md"`、`title==="理念与构成"`）。这说明解析器**预期**被扫描的项目带有一份 `specs/00` 作为根——即它把 `specs/` 当作「某个管辖项目的规范源」，而本项目 `dsh-ldvh` 的 `specs/` 恰好**同时**是 LDVH 的元规范与一份管辖项目规范源（见第 5 项自举）。
- **穷尽搜索结论**：代码层不区分「LDVH 自身 `specs/`」与「项目 `specs/`」——两者走同一 `join(projectRoot,"specs")` 路径；区分只在规范文本内部的 `ldvh-root` / 元规范 vs 事实规范语义层（00 §3.3），不在文件路径层。

---

## 3. 事实源 `ldvh-base/` 的实际角色

### 3.1 谁读取 `ldvh-base/`

在 `plugin/lib/`（排除 `test/`）搜索：

- `plugin/lib/adr-tools.js:52` `const FACT_SOURCE_ROOT_DIR = "ldvh-base";`；`:109` `const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);` 同理 `:165`、`:220`（ADR 读写）。
- `plugin/lib/friction-writer.js:230-231` `readGoalAnchors`：`join(factSourceRoot,"goal.md")`；`:341-342` `objectFilePath`：`join(factSourceRoot, FRICTION_DIRECTORY, ...)`；`FRICTION_DIRECTORY` 见 `:44`。
- `plugin/lib/governed-projects.js:13` `FACT_DIRECTORIES = ["sparks","workcases","adrs","pitfalls","researches"]`；`:120` `const root = join(projectRoot, "ldvh-base");`；`:221-226` `initializeFactSource` 在 `projectRoot/ldvh-base` 下建五个子目录 + `goal.md`。
- `plugin/lib/adr-enumeration.js:50` `const adrsDir = join(projectRoot, "ldvh-base", "adrs");`
- 注释引用：`ldvh-tools.js:477-486`（research/spark/adr/pitfall/friction 机械层）；`index.js:51-57`（Web 桥接读 `ldvh-base/researches/`）。

### 3.2 路径是固定 / 相对项目 / 可配置

- **相对项目、固定目录名、不可配置。**
- 证据：`FACT_SOURCE_ROOT_DIR = "ldvh-base"`（硬编码常量，`adr-tools.js:52`），所有读取均 `join(governed.project.path, "ldvh-base")`。
- 唯一环境变量在 `lib/` 是 `process.env.LDVH_WEB_API_PORT`（`index.js:45`），**没有**任何 `LDVH_BASE_*` / `SPEC_*` / 设置项可改变 `ldvh-base` 或 `specs` 的路径（见 `grep -rnoE "process.env.[A-Z_]+" plugin/lib/` 仅 `LDVH_WEB_API_PORT` 一项；`grep` 设置项亦无 fact/spec 路径配置）。
- 路径的「项目根」`governed.project.path` 来自登记载体（同 2.2），用户不能改登记文件位置（`07:91` "用户不能修改登记文件位置"）。

### 3.3 事实类型当前实际落盘（目录与文件）

本仓库 `ldvh-base/`（`ls -la ldvh-base/`）实际状态：

| 目录/文件 | 状态 | 条目数 |
|---|---|---|
| `ldvh-base/goal.md` | 存在 | 1（项目目标，`goal_key: project-goal`，`ldvh-base/goal.md:1-5`） |
| `ldvh-base/sparks/` | 存在 | 2 条目 |
| `ldvh-base/workcases/` | **缺失** | 0（FACT_DIRECTORIES 列了 `workcases`，但本仓库未建——`ldvh-base/workcases MISSING`） |
| `ldvh-base/adrs/` | 存在 | 1 条目 |
| `ldvh-base/pitfalls/` | 存在 | 2 条目 |
| `ldvh-base/researches/` | 存在 | 19 条目 |

- `FACT_DIRECTORIES`（`governed-projects.js:13`）规定的五个类型目录中，**本仓库 `workcases` 未初始化**（`initializeFactSource` 会建全部五个，但本仓库 `ldvh-base` 是手工/历史态，缺 `workcases`）。
- 类型与规范对应：spark=20、workcase=21、adr=22、pitfall=23、research=24、goal=25（`goal.md` 单例）、friction=26（`friction-writer.js` 写 `ldvh-base/frictions/`，但 `FACT_DIRECTORIES` 未列 `frictions`——见矛盾项）。

### 3.4 `ldvh-base/` 是否随插件发布

- **不随插件发布。** 同 1.1/1.2：`files` 白名单不含 `ldvh-base`，dry-run tarball 无 `ldvh-base`。
- `ldvh-base/` 由**安装事务**在用户项目内创建（`governed-projects.js:260-298` `installProject` → `initializeFactSource` `:221-226`），是**项目工作区资产**，不是插件分发包内容。
- 即：新装插件用户在**自己的项目**里只有执行「安装/登记」后才会生成 `ldvh-base/`（`07 §6` 工作对象的一部分）。

---

## 4. 规范对发布边界的现有规定

### 4.1 08 号规范关于发布、分发、包内容

来源：`specs/08-DSH环境接入与插件发布规范.md`

- §7 标题「发布与公共门面」（`:128`）。
- §7.1 版本号双轨制（`:130-132`）：对外 `MAJOR.MINOR.PATCH`，开发 `同主版本-dev.N`。
- §7.2 分发渠道（`:134-136`）：「DSH 插件市场（主要渠道）/ 本地 asar 加载 / 源码安装」。**未提及 `specs/` 或 `ldvh-base/` 是否随包。**
- §7.3 README（`:138-140`）：README 是市场第一眼界面，须与实际能力一致，是 00 §4.3 受保护文档。
- §7.4 CHANGELOG（`:142-144`）：Keep a Changelog，条目须由已提交变更支撑。
- §7.5 版本声明点（`:146-148`）：CHANGELOG + manifest 版本 + README 版本行三者一致。
- §7.6 受保护文档承接（`:150-152`）：00 §4.3 五类在 DSH 域映射为 `00`(`specs/00-理念与构成.md`)、`README`(`README.md`)、插件 AI 面向语义文本、`LICENSE`、`版本声明点`(CHANGELOG+manifest+README 版本行)。**五类清单中 `00` 以文件路径 `specs/00-理念与构成.md` 形式出现，但这指的是「受保护文档的修改流程」，不是「`specs/` 随包发布」。**
- §7.7 Output Envelope 宿主承载（`:154-156`）：交还产物存 `~/.dsh/ldvh/`，**「不进项目事实源目录」**（明示 handovers 不进 `ldvh-base/`）。
- §8 验证与证据边界（`:158-171`）：manifest/files 合规只证明机械范围。
- §9 Human Gate（`:173-189`）：改变分发渠道、受保护文档登记位置等须 Human Gate。
- **逐条摘引关键点**：08 全文**没有任何一条**规定 `specs/` 或 `ldvh-base/` 「随插件发布」或「不随插件发布」。`files` 白名单与打包事实（第 1 项）是代码/配置层事实，规范层未就此立规。

### 4.2 00 §4.3 受保护内容与发布的关系

来源：`specs/00-理念与构成.md:170-182`

- `:170` `### 4.3 受保护内容`
- `:172` 「00、README、插件 AI 面向语义文本、LICENSE 和版本声明点是受保护内容。其任何内容修改都必须先展示现有内容与准确候选、说明差异与原因、经过独立审核并取得 Human 明确同意，且形成只包含相应受保护文档的独立提交。」
- `:182` Human 决定权不能被主控/规范/事实/工具/环境入口替代。
- 08 §7.6（`:152`）把 00 §4.3 五类映射到 DSH 域，其中 `00` 以 `specs/00-理念与构成.md` 路径承接。
- **关系**：受保护内容是「修改流程受控」，与「是否随 npm 包发布」是**正交**的两件事。受保护清单未包含整个 `specs/`，只点名 `specs/00-理念与构成.md` 这一份（作为「00」规范载体）。`ldvh-base/` 不在受保护清单。

### 4.3 是否有规范已提到「某些规范不随插件发布」

- **穷尽搜索 `specs/`**：`grep -rn -E "不随插件|不发布|随插件发布|未随|仅.*项目|项目资产|自身资产|不打包" specs/` 命中均为无关语境（ADR 粒度、goal 单例、Code 副本、08 manifest/README 一致性）。
- **未找到**任何规范条文明示「`specs/` 不随插件发布」「`ldvh-base/` 不随插件发布」或「某些规范随包、某些不随」。
- 最接近的间接表述：08 §7.7「不进项目事实源目录」（指 handovers 不进 `ldvh-base/`，非指发布）；00 §3.3 两级承载区分元规范/事实规范（语义层，非分发层）。

### 4.4 `docs/` 下既有发布边界讨论

- `grep -rln -E "发布|分发|npm|包内容|随插件|specs/|ldvh-base" docs/` 命中约 30 个文件，但**定向搜索** `发布边界|随插件发布|包内容|不随插件|specs.*不发布|specs.*分发` 在 `docs/` **无命中**（除 `investigation-report-dsh-subagent-default-model.md` 文件名命中但内容无关）。
- `docs/architecture-dialogue-2026-09-03-mnemon-base.md:22` 讨论过「规范类文档 vs 项目业务规范」边界议题（建议立 Practice 类型），但属设计建议、未落地为规范，且未涉及 npm 分发。
- `docs/00-revision-candidate-2026-09-10-r3.md:263`、「r4:242」提到「本包未写入 `specs/00-理念与构成.md`」——指**开发提交**未动 `specs/00`，非指发布边界。
- **结论**：`docs/` 下**未找到**关于「`specs/`/`ldvh-base/` 与 npm 发布边界」的专题讨论。

---

## 5. 本仓库的自举性质

### 5.1 本仓库是否也是「管辖项目」

- 登记载体实测：`/Users/dmh2002/.dsh/ldvh/governed-projects.yaml`（本机 DSH 用户配置根下）：
  ```yaml
  schema_version: 1
  governance_instance_name: DSH Project LDVH Governance
  product_description: LDVH governed projects for this DSH user configuration.
  projects:
    - id: dsh-ldvh
      path: /Users/dmh2002/DshProject/dsh-ldvh
      name: dsh-ldvh
  default_project_id: dsh-ldvh
  ```
- 该载体由 `governed-projects.js:11` `REGISTRATION_RELATIVE_PATH = ["ldvh","governed-projects.yaml"]` 定义，位于 DSH 用户配置根（`DSH_HOME=/Users/dmh2002/.dsh`）。
- **结论**：`dsh-ldvh` 仓库**自身被登记为受管辖项目**（id `dsh-ldvh`，path 即本仓库根）。
- 仓库内 `ldvh-base/` 已部分初始化（3.3），`specs/` 完整存在（第 6 项），印证它同时是一个被 LDVH 自身管辖的工作区。

### 5.2 自举关系描述（自我指涉）

- `specs/00-理念与构成.md` 是 **LDVH 的元规范（根规范）**：`spec-registry.js:163-168` 把 `responsibilityKey==="ldvh-root"`、`specId==="00"`、`canonicalPath==="specs/00-理念与构成.md"`、`title==="理念与构成"` 硬编码为根 profile 固定值。
- 本仓库 `dsh-ldvh` 既是「LDVH 工具本身的开发仓库」，又是「一个被 LDVH 管辖的项目」。于是：
  - 它的 `specs/00`（元规范）**定义**了「规范源由元规范+事实规范两级承载」「`specs/` 是管辖项目工作对象的一部分」（07 §6.1）、「插件是能力承载形态、不是规则来源」（00 §3.3 `:148`）。
  - 同时，这份 `specs/00` 又**作为本项目 `dsh-ldvh` 的规范源**，被同一插件（`ldvh-tools.js` 的 `scanSpecCandidates`）在「当前会话位于 `dsh-ldvh` 工作区」时读取——即**插件读取定义它自己的规范**。
  - 即：**LDVH 插件（随包不含 `specs/`）运行时，在它自己的开发仓库里，会去读 `specs/00` 这个「元规范」；而这个元规范恰好规定「`specs/` 是管辖项目资产、插件不创造规则」。**
  - 这就是自举：元规范的载体（本仓库 `specs/`）既是「定义 LDVH 的规则」，又是「一份受 LDVH 管辖的项目规范源」。两者在同一目录重合，靠 00 §3.3 的「元规范 vs 事实规范」语义层区分，而非靠物理位置区分（第 2.4 项已证代码层不区分）。
- **重要辨析**：`specs/00` 作为「元规范」的权威效力来自 00 §3.3 的语义声明，**不依赖**它是否被 npm 发布——一个只装插件、项目里没 `specs/` 的用户，其会话是 `unavailable` 规范读取（2.3），但插件其他能力（管辖判定、Git Gate、事实源读写）仍工作，因为那些能力不依赖 `specs/` 文本（它们依赖 `ldvh-base/` 与登记载体）。

### 5.3 其它「管辖项目」实例

- 本机登记载体仅 `dsh-ldvh` 一个项目（`governed-projects.yaml` 如上）。
- 仓库外是否还有其它管辖项目实例：**未查到**（本机 `~/.dsh/ldvh/governed-projects.yaml` 是唯一的登记载体；搜索未涉及其它机器/用户配置）。
- 注：规范层（07 §5）允许任意 Git 项目被登记为管辖项目，但本调查**只在本仓库与本机配置范围内取证**，不推测其它机器状态。

---

## 6. 规模事实

### 6.1 总行数与按类分布

命令：`wc -l specs/*.md`（实测，**20 份** `.md`，非任务所述「21 份」）

> 任务清单写「specs/ 下 21 份规范」，实测 `ls specs/*.md | wc -l` = **20**（`00-12` 共 13 份 + `20-26` 共 7 份；`attachments/` 为子目录不计）。以下按 20 份列。

| 编号 | 文件 | 行数 | 类 |
|---|---|---|---|
| 00 | 理念与构成 | 277 | 基础（元规范根） |
| 01 | 规范模型基础规范 | 411 | 基础（元规范/模型） |
| 02 | 工作模型基础规范 | 258 | 基础 |
| 03 | 事实模型基础规范 | 473 | 基础 |
| 04 | 业务系统基础规范 | 400 | 基础 |
| 05 | LDVH CLI规范 | 274 | 基础（LDVH 机制） |
| 06 | 事实源与信息溯源规范 | 248 | 基础（LDVH 机制） |
| 07 | 工作对象与管辖范围规范 | 236 | 基础（LDVH 机制） |
| 08 | DSH环境接入与插件发布规范 | 221 | 基础（LDVH 机制） |
| 09 | Code实践与测试规范 | 172 | 基础（LDVH 机制） |
| 10 | Web呈现与交互规范 | 226 | 基础（LDVH 机制） |
| 11 | 调研系统规范 | 313 | 基础（业务系统） |
| 12 | 讨论系统规范 | 270 | 基础（业务系统） |
| 20 | Spark-火花 | 291 | 事实类型 |
| 21 | WorkCase-工作项 | 343 | 事实类型 |
| 22 | ADR-决策 | 275 | 事实类型 |
| 23 | Pitfall-踩坑经验 | 250 | 事实类型 |
| 24 | Research-调研报告 | 336 | 事实类型 |
| 25 | Goal-项目目标 | 195 | 事实类型 |
| 26 | Friction-摩擦账本 | 263 | 事实类型 |
| **合计** | | **5732** | |

- 基础规范 `00-12`：13 份，共 `277+411+258+473+400+274+248+236+221+172+226+313+270 = 3479` 行。
- 事实类型 `20-26`：7 份，共 `291+343+275+250+336+195+263 = 1953` 行。
- `attachments/` 子目录（规范附件）未计入行数统计。

### 6.2 内容明显是「LDVH 自身机制」的规范

判据：标题/范围（scope）直接声明定义 LDVH 的 CLI、事实源、管辖、宿主接入、Code、Web 等**机制边界**，而非某个外部产品的领域需求。

- **05 LDVH CLI规范**：标题即「LDVH CLI」，定义 LDVH 自有命令行（`05:6,10` positioning/scope 明示「LDVH CLI」）。
- **06 事实源与信息溯源规范**：定义管辖项目事实源载体与受控提交（06 §5.1 `:91-93`），是 LDVH 的 Git 机械守护机制。
- **07 工作对象与管辖范围规范**：定义登记制度与管辖判定（07 §6 `:159` 工作对象含 `specs/`/`ldvh-base/`），LDVH 治理机制。
- **08 DSH环境接入与插件发布规范**：定义插件 manifest/工具注册/发布（08:6,10），LDVH 宿主接入机制。
- **09 Code实践与测试规范**：实现与测试纪律（09:6 scope），LDVH 工程机制。
- **10 Web呈现与交互规范**：Web 呈现/交互（10:6 scope），LDVH 前端机制。
- **00 理念与构成**：元规范根，定义 LDVH 自身理念/构成（00:92「LDVH 的构成包括…」），是「元规范」本身。
- **01 规范模型基础规范**：定义规范身份块/披露层（01 §6、01.Att.02/03），是规范自身的模型，对所有 specs（含 LDVH 与外部项目）生效——属「元层级机制」。

### 6.3 内容更像「项目/产品领域」的规范（判读与判据）

判据：本仓库 `specs/` 全部是 **LDVH 工具自身的规范源**，按 00 §3.3 属「元规范」层级；严格说**没有一份是某个外部产品的领域规范**。但可作如下判读：

- **事实类型规范 `20-26`（Spark/WorkCase/ADR/Pitfall/Research/Goal/Friction）**：它们定义的是**领域中立的事实对象模板**，设计为「任一受管辖项目」实例化使用（00 §3.3：「事实对象可以承载规范（事实规范）」、事实类型以事实对象形态承载于事实源）。其内容（如 ADR 的 decision/scope、Research 的调研报告结构）是**跨项目的领域中立模板**，不像 05-10 那样绑定 LDVH 专有机制。判读：20-26 更偏「事实规范/领域模板」，05-10（及 00-04、11-12）更偏「LDVH 自身机制/结构」。
- **业务系统规范 `11 调研`、`12 讨论`**：定义 LDVH 六大业务系统中的两个（04 §4 列调研/讨论/工作执行/规则遵守/目标与蓝图/记忆与反思），属 LDVH 自身业务过程结构，非外部产品领域。
- **结论性判读**：在本仓库语境下，`specs/` 整体是 LDVH 的**元规范+事实类型模板**；与外部「产品领域规范」的对立，在 00 §3.3 语义层表现为「元规范（LDVH 自身，00-12、含 20-26 的模板定义）」vs「事实规范（某管辖项目在其 `specs/`/`ldvh-base/` 中承载的、针对该项目的规则与事实）」。本仓库 `specs/` 不扮演「某外部产品领域规范」角色——它扮演的是「元规范 + 可复用事实类型定义」角色。这一自我指涉在第 5.2 项已描述。

---

## 7. 发现的矛盾 / 不一致清单

1. **`files` 含 `web/dist` 但实际不打包**（1.3）：`plugin/package.json:43` 列 `web/dist`，但 `npm pack --dry-run` 无 `web/` 条目；根 `.gitignore:23` `dist/` 命中 `plugin/web/dist`，且无 `.npmignore` 回退。→ `web/dist` 当前**不随包发布**（前端 SPA 缺失于发布包）。与 `plugin/README.md:5`「完整 LDVH Web 仍在迁移中」状态一致，但 `files` 白名单与实际产出不符。

2. **`FACT_DIRECTORIES` 与 `friction` 目录不一致**（3.1/3.3）：`governed-projects.js:13` 列 `sparks,workcases,adrs,pitfalls,researches`（五类），但 `friction-writer.js` 实际写 `ldvh-base/frictions/`（`friction-writer.js:8,342`），而 `frictions` **不在** `FACT_DIRECTORIES`；`initializeFactSource`（`:221-226`）也不会建 `frictions`。即 Friction（26 号事实类型）的落盘目录未被「事实源初始化」逻辑覆盖。

3. **本仓库 `ldvh-base/workcases` 缺失**（3.3）：`FACT_DIRECTORIES` 含 `workcases`，但本仓库 `ldvh-base/` 实际无 `workcases/` 目录（21 号 WorkCase 事实类型的落盘位置未初始化）。

4. **任务清单「21 份规范」与实测「20 份」不符**（6.1）：`ls specs/*.md` = 20 份。可能任务方把 `attachments/` 子目录或某草稿计入；本报告以实测为准。

5. **规范层对「发布边界」留白**（4.1/4.3）：08 号规范 §7 详尽规定版本号/分发渠道/README/CHANGELOG，却**未规定** `specs/`、`ldvh-base/` 是否随包。代码事实（不打包）与规范事实（未立规）之间存在**规范空白**——这本身是事实，不是「应不该打包」的建议。

6. **受保护文档清单 vs 实际发布内容错位**（4.2）：00 §4.3 把 `specs/00-理念与构成.md` 列为受保护文档，但 `specs/00` 并不随插件发布（1.2）；受保护的是「修改流程」，而该文件在被管辖项目（如本仓库）工作区内才存在。即「受保护文档」与「随包分发文件」是两个正交集合，易混淆，但规范未澄清二者关系。

---

## 8. 已查证 / 未查到 / 残留不确定

### 已查证（有命令或行号支撑）
- `files` 白名单内容与逐项含义（1.1，`plugin/package.json:39-48`）。
- dry-run 实际打包文件集合、不含 `specs/`/`ldvh-base/`（1.2，命令输出）。
- 无 `.npmignore`、`cordis.patch.yml` 无 `specs/` 引用、CI 不发布（1.3-1.4）。
- `specs/` 由 `ldvh-tools.js:73-116` 从 `governed.project.path` 解析、非包内、非绝对硬编码（2.1-2.2）。
- 新装插件用户不自动拥有 `specs/`；依赖功能在 governed 且项目自带 `specs/` 时工作（2.3）。
- `ldvh-base/` 由 `governed-projects.js` 在用户项目内创建、路径硬编码 `ldvh-base`、不可配置（3.1-3.4）。
- 08 §7 发布规定原文与「未提及 specs/ 发布」事实（4.1）；00 §4.3 原文（4.2）；无规范明示「不随插件发布」（4.3）；docs 无专题讨论（4.4）。
- 本仓库自身被登记为管辖项目（5.1，实测 yaml）；自举关系（5.2）；本机仅此一实例（5.3）。
- 规模：20 份、5732 行、分类（第 6 项）。

### 未查到（搜索无结果，非推测）
- 规范中明示「`specs/` 不随插件发布 / 随插件发布」的条文：**未找到**（4.3）。
- `docs/` 中「发布边界」专题讨论：**未找到**（4.4）。
- 本机以外其它管辖项目实例：**未查到**（仅本机配置取证，5.3）。
- 改变 `ldvh-base`/`specs` 路径的设置项或环境变量：**未找到**（`lib/` 仅 `LDVH_WEB_API_PORT`，3.2）。

### 残留不确定（如实标注）
- npm 对 `files` 含 `web/dist` 却因 `.gitignore` 被排除的**精确内部优先级**（1.3）：本报告以 dry-run 实证「不打包」为准，未深究 npm 源码的 `files` vs `.gitignore` 优先级细节——属机制解释层面的不确定，不影响「当前不产出」的事实结论。
- `friction-writer.js` 写 `ldvh-base/frictions/` 但 `frictions` 不在 `FACT_DIRECTORIES`：是否为有意（Friction 走单独初始化）还是遗漏，本报告**未判定**，仅记录事实（矛盾项 2）。
- 本仓库 `ldvh-base/workcases` 缺失是「未初始化」还是「有意不建」：**未判定**（矛盾项 3）。
- 其它机器/用户的管辖登记状态：超出本调查取证范围，标注为未查到（5.3）。

---

*本报告为事实底稿，不含设计或方案建议。所有结论均可由上列命令/`文件:行号` 复现。*
