# v4 Web 迁移说明（Step 1：纯迁移）

> 本目录是 v4 `web/`（`ld-vibe-harness-v4` 归档）的整体平移，属「v4 Web 迁移 + 全部管辖联邦视图 + 项目色彩标识」四步计划的第 1 步。
> 迁移纪律：**零功能改动**——src/api/shared 与 v4 逐字节一致（唯一例外见下）；设计语言（ldvh-* 令牌、Tailwind 配置、卡片语言、i18n）原样保留。

## 与 v4 的差异清单（全部为迁移适配，非功能变更）

| 文件 | 差异 | 原因 |
|---|---|---|
| `pnpm-workspace.yaml` | 增加 `allowBuilds: esbuild` | pnpm 11 要求显式批准构建脚本 |
| `src/components/ObjectReportKindFilter.tsx` | `REPORT_KIND_ORDER` 类型改 `NonNullable<StudyReportKind>[]` | v4 遗留类型错（dev 模式不跑 tsc 未暴露）；纯类型级修复，零运行时行为变化 |
| `tests/api/{workcase-presentation-spec-contract, commit-label-contract, fact-field-contract, fact-reading-headings-contract, settings}.test.ts` | specs/仓库根解析支持 `LDVH_SPEC_ROOT` 环境变量覆盖 | v4 测试硬编码仓库布局（web/ 位于仓库根），迁移后 3 级上溯指向 plugin/；默认值保持 v4 布局不变 |
| `tests/api/{commit-dto, project-files}.test.ts` | 仓库根解析支持 `LDVH_ROOT` 覆盖 | 同上（这两个文件夹具需要 LDVH_ROOT 指向含 `ldvh` CLI 的仓库根） |

## 如何运行

```bash
cd plugin/web
pnpm install

# 类型检查 / 构建（无环境依赖）
pnpm run check
pnpm run build

# 契约测试（41 文件 212 用例）
# Node 25 下用 node --import tsx --test（tsx --test 静默不输出）。
# API 依赖 v4 Python Helper（LDVH_ROOT/ldvh）与工作区配置，当前指向 v4 归档：
LDVH_ROOT=<v4 归档绝对路径> \
LDVH_WORKSPACE_ROOT=<v4 工作区（含 LDVH-GOVERNED-PROJECTS.yaml）> \
LDVH_SPEC_ROOT=<v4 归档绝对路径> \
node --import tsx --test tests/api/*.test.ts

# 写测试（settings）需沙箱工作区防污染归档：
cp <v4 工作区>/LDVH-GOVERNED-PROJECTS.yaml /tmp/sandbox/ && \
LDVH_SPEC_ROOT=<v4 归档> LDVH_WORKSPACE_ROOT=/tmp/sandbox \
node --import tsx --test tests/api/settings.test.ts
```

## 挂载模式与数据源（2026-09-08 接线定稿）

- **DSH 挂载（/ldvh）= v5 登记模式**：Web API 子进程经 `LDVH_GOVERNED_PROJECTS_CONFIG` 直读 v5 登记载体（`~/.dsh/ldvh/governed-projects.yaml`，插件安装事务拥有）；治理验证为 Express 侧 Node git 解析（与插件 resolveGitRoot 同语义），**不依赖 v4 Python Helper**。已知边界：v5 调研对象在 `ldvh-base/researches/`（research 读取引擎属后续接线），study 类型列表在 v5 项目上为空是如实呈现；Settings 页对登记载体的写入沿用 v4 轻写入语义（CAS + 原子改名），与插件安装事务并存——07 语义的最终归位属后续。
- **独立开发（restart.sh）= v4 归档模式**：环境变量指向 v4 归档，用于查看 v4 历史数据（152 WC / 103 Spark），行为与迁移前一致。

## 已知状态（2026-09-08 迁移验证）

- **210/212 用例通过**。
- **2 个失败为 v4 归档自带漂移**（与迁移无关，证据：断言的源码模式在 v4 自己的归档代码中即不存在，src 与归档逐字节一致）：
  - `study-reading-contract`: "Study keeps the V3-style three-field overview"（期望 `StudyReportMetadata`，v4 代码 8-23 演进后未再更新 8-06 的测试）
  - `changelog-presentation-contract`: "breaking and push-state badges use one presentation"（同型源码断言漂移）
- Express API 对 v4 Python Helper（`LDVH_ROOT/ldvh`）的运行时依赖是**已知耦合**：v5 目标后端是 DSH 插件（`/ldvh/api`），适配属后续步骤，不在纯迁移范围。
- DSH webServer 挂载（替换 `/ldvh` 占位 SPA）属后续步骤。

## 后续步骤（本目标剩余）

2. 色板数据层（governed-projects.yaml `color` 字段 + Settings 色板选择器 + 切换器色点）——**已落地**（项目色彩第三正交维度，`shared/projectColors.ts` + `--ldvh-pj-*` 令牌）
3. 全部管辖作用域（切换器「全部管辖」选项 + 联邦聚焦页 + 联邦聚合 API）——**已落地**（`/federation`、`/federation/objects/:type`，项目色 chip 与筛选）
4. 联邦列表（跨项目聚合 + 项目色 chip + 项目筛选 chips；单项目专属页联邦态灰显）——**已落地**

## 设计语言一致性审计（2026-09-10）

v5 迁移后对整体设计语言做了一致性审计，修复清单与 v5 增量基线见 [`docs/11-v5Web开发增量.md`](./docs/11-v5Web开发增量.md)。要点：

- 事实模型同步收尾：`ObjectStatusFilter` / `CognitionCenter` 的 `study` 兜底键改 `research`；`retirement_reason` 枚举加入 i18n 闭集映射并本地化展示。
- 联邦两页对齐 v4 卡片语言：`ldvh-section-grid`（容器驱动，去 `sm:/md:/xl:` 断点列数）、`ldvh-page-toolbar-action` 令牌按钮、无框 `py-20` 空态/加载态、数字指标改 `text-xl`。
- 清理死类与冗余：`ObjectList` 的 `text-ldvh-text`（未定义令牌）、`ObjectDetail` 标题字号冗余三元式；`StudyTerminalCardContent` 更名 `ResearchTerminalCardContent`。
- 文档：01/10 更新上位规范引用（v5 编号：03 事实模型、10 Web 呈现、09 Code、07 管辖、24 Research）与字号定案；新增 11 号 v5 增量文档并挂入各页面文档索引。

> 契约测试 spec 载体收敛（2026-09-10 后）：v4 编号的 spec 附件与类型规范文件（`08-Web 呈现与交互规范.md`、`22-ADR-决策.md`、`23-Pitfall-踩坑经验.md`、`03/05/08 .Att` 附件）在 v5 已被代码模块取代——`shared/workcaseStatus.ts`（进展分组/四步）、`shared/projectColors.ts`、`src/utils/commitLabels.ts`、`api/services/factFieldContract.ts`、`src/i18n/locales.ts`。相应契约测试（workcase-presentation-spec-contract 前 4 例、commit-label-contract、fact-field-contract、fact-reading-headings-contract）已改为从代码模块自洽断言，**不再依赖 v4 归档，可在 v5 仓库直接解析**。

> 契约测试 v5 现状全绿（2026-09-10 后）：除上文的 spec 载体收敛外，B 类 API 集成用例的 v4 Python Helper 依赖也已解除——治理范围一律改走 Node git 解析分支（`governanceScope` 的 `LDVH_GOVERNED_PROJECTS_CONFIG` v5 登记模式）。为此：`cognition-inbox-contract` 默认读取 dsh-ldvh 所在工作区管辖配置；`project-files` / `commit-dto` 指向自建测试治理 YAML；`changelog-presentation-contract` 的徽章断言对齐 v5 当前源码（Badge 不再带 `ml-1.5`，`headerMetaItems` 内联进类型 chip）。当前 `node --import tsx --test tests/api/*.test.ts` **244/244 全绿**，不再依赖 v4 归档。
