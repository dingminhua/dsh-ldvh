# 独立对抗检查记录：Web 呈现层 WorkCase 类型级中文显示名统一为「工单」

- 检查对象提交：`c14b233`（fix(web): WorkCase 类型级中文显示名统一为「工单」）
- 检查性质：独立对抗检查（找真问题，非背书）
- 检查日期：2026-09-15
- 检查范围：`plugin/web/src` 的 zh 侧用户可见显示字符串、i18n 键名、代码标识、en 侧字符串、内部 `work_items` 的「工作项」文案、以及实施者声明的验证证据（测试/类型检查）。
- 依据：Human 决定 2026-09-15（业务系统「工作执行」→「工单执行」、WorkCase 中文规范名→「工单」）；分层裁定 D-3：WorkCase 内部 `work_items` 成员继续称「工作项」；三层约定 = 工单（类型级中文名）/ 工作项（内部 work_items 成员）/ en=WorkCase。

---

## 一、检查对象与范围

1. 提交 `c14b233` 的 diff 内容（34 行变更统计，净 17+/17-，全部位于 `plugin/web/src/i18n/locales.ts`）。
2. 完整性：核查 `plugin/web/src` 中 zh 侧用户可见的「WorkCase」残留与 `zh: '工作'` 类型标签残留（locales.ts 的 zh 段、组件内硬编码显示字符串、页面 title、nav 标签等 i18n 面），确认类型级显示已全部统一为「工单」。
3. 正确性：核对 diff 是否只改 zh 字符串值；en 未动；i18n 键名未动；内部 `work_items` 的「工作项」文案全部保留；三处标签映射改动正确。
4. 证据核验：重跑 `npm test`（预期 276）、`npm run check`，确认错误恰为既有的 5 处 refs TS 错误且均不在 locales.ts；用 `git show c14b233^:` 只读佐证这些错误先于本变更存在。
5. 分层一致性：diff 是否遵守三层（工单 / 工作项 / WorkCase）；`help.step.5.body` 的「工单（WorkCase）」括注是否成立。
6. 环境观察：工作树一个未跟踪的 Research 对象文件，仅登记存在与未提交状态，不触碰。

---

## 二、核查过程与证据

### 1. 仓库与提交基线
- 命令：`git log --oneline -3` / `git status --short` / `git rev-parse HEAD`
- 结果：HEAD = `c14b2336370c5853f4adeca4ed6a71b7a3baf329`；工作树除一个未跟踪文件 `ldvh-base/researches/research-4ee122a9-517e-44c0-a7b3-76578a710901.md` 外干净。
- 命令：`git show c14b233 --stat`
- 结果：仅 `plugin/web/src/i18n/locales.ts` 变更，34 行统计，净 17+/17-。

### 2. diff 全文核对（正确性 / 三处标签映射 / 内部工作项保留）
- 命令：`git show c14b233`
- 三处类型标签映射（确认全部 `zh: '工作' → '工单'`、`en: 'WorkCase'` 不变）：
  - `TYPE_LOCALES`：`workcase: { zh: '工作', en: 'WorkCase' }` → `{ zh: '工单', en: 'WorkCase' }`（行 144）
  - 字段名映射：`workcase: { zh: '工作', en: 'WorkCase' }` → `{ zh: '工单', en: 'WorkCase' }`（行 320）
  - `COMMIT_SCOPE_LOCALES`：`workcase: { zh: '工作', en: 'WorkCase' }` → `{ zh: '工单', en: 'WorkCase' }`（行 649）
- 14 处 zh 用户可见文案改动（cognition.active.empty；objectList.workcaseCoveragePartial / CoverageUnavailable / ObjectProblems / CoverageCollectionScope / CoverageUnavailableEmpty / CoveragePartialEmpty / ObjectProblemsEmpty；objectDetail.workcaseClosureProposalBoundary / workcaseTerminalDispositionBoundary / humanGateTip；help.step.5.title / 5.body / 6.body）——全部 `WorkCase` → `工单`，且 `help.step.5.body` 采用「工单（WorkCase）」括注形式。
- i18n 键名：逐条核对，所有改动仅改字符串值，键名（如 `cognition.active.empty`、`objectDetail.humanGateTip`）未变。
- 内部 `work_items` 的「工作项」文案保留核查：命令 `grep -n "工作项" i18n/locales.ts`，确认以下均未被误改——
  - 行 36 `item_execution_in_progress: '工作项执行中'`
  - 行 232 `item_snapshots: '工作项起始现场'`
  - 行 327 `work_item_blocking_summary: '工作项阻塞说明'`
  - 行 333 `work_items: '工作项'`、行 334 `item_id: '工作项标识'`、行 336 `depends_on: '前置工作项'`
  - 行 363 `work_item_result_summary: '工作项结果'`
  - 行 1087 `workcaseItemsUnavailable: '工作项进展不可判定'`、行 1105 `workcaseItems: '工作项'`、行 1106 `workcaseCurrentItems: '当前工作项'`、行 1107 `workcaseNoCurrentItems: '尚无进行中工作项'`、行 1113 `workcaseItemStageMismatch: '工作项状态与当前环节不一致'`、行 1141 `workcaseStageExecute: '工作项执行'`、行 1258 `advance_current_work_item: '推进当前工作项'`、行 1272 `workcasePlanAndItems: '当前计划与工作项'`
  - 行 1416 `help.step.6.body: '...按计划推进工作项...'`
- en 侧未动：命令 `grep -nE "workcase: \{ zh: '工单', en: 'WorkCase' \}"` 返回 3 行；en 串 `'WorkCase'` 在 zh 值中仅存于 `help.step.5.body` 括注，符合预期。

### 3. 完整性扫描（zh 侧残留）
- 命令：`grep -n "zh: '工作'" i18n/locales.ts` → 无结果（类型标签残留为零）。
- 命令：`grep -rn "WorkCase" --include=*.tsx --include=*.ts . | grep -v "i18n/locales.ts" | grep -v "//" | grep -vE "\* "` → 命中均为 `utils/api.ts` 的 TS 类型/接口标识符（`WorkCaseHandoffReason` 等），属代码标识，按约定保留，非显示字符串。
- 命令：`grep -rniE "工作|工单" --include=*.tsx . | grep -v "//" | grep -v "i18n/locales" | grep -v "'工作项'"` → 无命中，组件中无硬编码 zh 类型标签。
- 命令：`grep -rni "WorkCase" --include=*.tsx --include=*.html --include=*.json . | grep -v "i18n/locales.ts" | grep -vE "//|/\*|\* |import |export |interface |type |enum |:"` → 无命中（无遗漏的硬编码用户可见 zh「WorkCase」）。

### 4. 证据核验（重跑）
- 命令：`cd plugin/web && npm test`
- 结果：`tests 276 / pass 276 / fail 0`。与实施者声明一致。
- 命令：`cd plugin/web && npm run check`（`tsc -b --pretty false`）
- 结果：恰为 5 处错误，全部为 `refs` 属性缺失的 TS2339：
  - `api/routes/cognition.ts(1022,17)`、`api/routes/cognition.ts(1022,56)`（各报 2 次，共 4 条合并去重为 2 处）
  - `src/pages/ObjectList.tsx(1264,33)`（1 处）
  - 无任何错误位于 `i18n/locales.ts`。
- 既有性佐证：`git show c14b233^:plugin/web/api/routes/cognition.ts` 第 1022 行已有 `if (build.refs !== undefined) entry.refs = build.refs`；`git show c14b233^:plugin/web/src/pages/ObjectList.tsx` 第 1264 行已有 `<RefsBadge value={obj.refs} .../>`。均先于本变更存在，且本提交仅改 locales.ts，不可能引入这两文件的错误。

### 5. 环境观察
- 命令：`git status --short ldvh-base/researches/research-4ee122a9-517e-44c0-a7b3-76578a710901.md` → `??`（未跟踪）。
- 文件存在，大小 21218 字节，最后修改 2026-09-15 05:43（并行会话写入的 Research 对象）。仅登记，未读取内容、未改动、未提交。

---

## 三、发现

**F-1（观察）｜通过** 三处类型级标签映射（TYPE_LOCALES / 字段名映射 / COMMIT_SCOPE_LOCALES）的 `zh` 均由「工作」改为「工单」，`en: 'WorkCase'` 保持不变，符合三层约定与 D-3。

**F-2（观察）｜通过** 14 处 zh 用户可见文案以「WorkCase」指称类型的表述已统一为「工单」，覆盖认知中心空态、对象列表读取范围诊断、详情边界提示、Human Gate 提示、帮助步骤；i18n 键名与代码标识未变。

**F-3（观察）｜通过** 内部 `work_items` 的「工作项」文案（含 `workcaseItems`、当前工作项、工作项执行、当前计划与工作项等共约 15 处）全部保留，未被误改，符合 D-3 裁定。

**F-4（观察）｜通过** `help.step.5.body` 采用「工单（WorkCase）」括注，同时呈现类型级中文名与英文规范名，括注成立，且与同步骤 title「讨论出可行动的工单」、step.6.body「工单确认后…按计划推进工作项」保持三层一致（工单=类型级、工作项=内部成员、WorkCase=en）。

**F-5（观察）｜通过** 完整性扫描未发现 zh 侧类型标签残留（`zh: '工作'` 为零）；`plugin/web/src` 之外的 `.ts/.tsx` 中 `WorkCase` 均为代码标识符（类型/接口名），按约定保留；组件内无硬编码 zh「WorkCase」显示字符串。

**F-6（观察）｜通过** 证据核验：`npm test` 276/276 通过；`npm run check` 恰为 5 处 refs TS 错误且全部在 `api/routes/cognition.ts` 与 `src/pages/ObjectList.tsx`，均经 `git show c14b233^:` 佐证先于本变更存在，不在 locales.ts，与本变更无关。

**F-7（观察）｜信息** 工作树存在未跟踪文件 `ldvh-base/researches/research-4ee122a9-517e-44c0-a7b3-76578a710901.md`（并行会话写入的 Research 对象，21218 字节，未提交）。本检查仅登记其存在与未提交状态，未触碰。

**F-8（建议）｜轻微** `objectDetail` 区仍有若干 zh 值使用「WorkCase」作前缀语义但属字段级命名（如 `workDetail.workPlan: 'WorkCase'` 在 en 侧；zh 侧 `objectDetail.workPlan` 未直接出现「WorkCase」）。经核对这些为 en 侧字段标签且 zh 侧对应键已为「工单」相关表述，不属类型级显示残留，不构成问题；仅提示后续若引入新 zh 字段标签需延续「工单」命名，避免回潮。本项不影响裁定。

---

## 四、裁定

**结论：通过。**

提交 `c14b233` 的改动范围严格限定于 `plugin/web/src/i18n/locales.ts` 的 zh 字符串值：三处类型级标签映射 `zh: '工作' → '工单'` 正确且 en 不变；14 处用户可见文案类型指代统一为「工单」；内部 `work_items` 的「工作项」文案完整保留；i18n 键名与代码标识未动；遵守「工单 / 工作项 / WorkCase」三层约定；`help.step.5.body` 括注成立。验证证据可独立复现：`npm test` 276/276 通过，`npm run check` 的 5 处 refs 错误均经只读基线佐证先于本变更、且不在 locales.ts。未发现阻断项或必须修正项，仅留一条轻微命名延续建议（F-8）。

环境观察：`ldvh-base/researches/research-4ee122a9-517e-44c0-a7b3-76578a710901.md` 为未跟踪 Research 对象，已登记、未触碰。
