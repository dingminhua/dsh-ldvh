# 事故记录：工具 output.render 返回字符串导致整批 LDVH 工具静默失效

> 性质：开发备忘（故障与教训），非规范、非事实对象。
> 发生：P0 实现批次（2026-09-02 之后），真实宿主运行期。现象：`content.some is not a function`；Human 关闭插件。

## 事实经过

1. `plugin/lib/ldvh-tools.js` 的 `registerLdvhTools` 用 `ctx.tools.register` 注册 5 个 `ldvh_*` 工具。
2. 其中 `output.render` 返回一个**字符串**：
   ```js
   render(result) { ...; return lines.join("\n"); }
   ```
3. DSH `dsh-tools` 在结果交付阶段对每个工具结果执行（`lib/index.js`）：
   ```js
   if (!result.isError && result.content.some((block) => block.type === "image"))
   ```
   `content` 由 `render` 的返回值填充，必须是**内容块数组**。字符串没有 `.some` → 抛 `content.some is not a function`。
4. 后果：5 个工具全部无法向模型交付任何结果——注册成功、schema 校验通过、handler 逻辑正确，但结果永远到不了模型。是**整批静默失效**，不是单工具报错。

## 根因

`render` 的返回值契约（数组 of 内容块）只在 `harness.defineTool` / `defineTool` 路径上被强制校验：

- `dsh-cordis-host-runner/lib/types/guard.js:469` `assertRenderedContent()` 会校验并抛出带教学信息的错误。
- 但该函数只包裹 `harness.defineTool`，**不作用于 `ctx.tools.register`**。

`ctx.tools.register`（`dsh-tools/lib/index.js:2782`）只校验：
`output` 是对象、`output.render` 是函数、`assertSupportedJsonSchema(output.schema)`、`timeoutMs`、`name`。

**它不校验 `render` 的返回值形状。** 于是形状错误逃逸到运行期，且只在真实调用时暴露。

## 对治（已修）

1. `renderEnvelope(operationKey, value)` 抽为导出的纯函数，`render` 改为透传，使契约可脱离 `ctx.tools` 测试。
2. 修掉同批第二个契约违规：`gaps` schema 原为 `items: { type: "string" }`，但 `scanSpecCandidates` 推入结构化对象 `{ responsibility_key, canonical_path, reason }`（05 §8 溯源要求）→ 带 gap 的响应会被 schema 校验拒掉。渲染时对象 gap 走 `JSON.stringify`，不再输出 `[object Object]`。
3. 回归测试：遍历 5 operation × 6 outcome 渲染，断言返回数组、每块有 `type`/`text`，并执行 DSH 实际调用的那句 `.some(...)`。
4. 全量 `node --test` 260 项通过（新增 4 项）。

## 联网调研后的定案（第二轮，2026-09）

就「是否改用 `defineTool`」「output schema 该严该松」两点做了外部调研与本地多插件比对。

### 1. 不迁移 `defineTool`（此前提议已撤回）

`ctx.tools.register` 是 DSH 插件的**主流写法**，不是缺陷路径：dsh-mnemon、dsh-sub-cli、dsh-deep-research、dsh-plan-mode 全部用它。且 `defineTool` 的 `parameters` 是另一种格式（DSL 值 schema 映射），与 `register` 的原始 JSON Schema **不兼容**——实测直接套用报 `parameters.type must be a value schema object`。「迁移换取强校验」是把一种主流写法换成另一种，无收益，撤回。

### 2. 采纳 dsh-mnemon 的 `text()` 单一包装

所有插件都返回数组，但分两派：

| 写法 | 使用者 | 特点 |
|---|---|---|
| 每工具手写 `[{ type: "text", text }]` | dsh-sub-cli、dsh-deep-research、dsh-plan-mode | 正确，但重复 N 次，任一次手滑即复发 |
| `text(value)` 统一包装 | **dsh-mnemon** | 只写一次，想返回字符串也自动变正确格式 |

已改为后者：`text()` 是工具输出的唯一出口，`renderEnvelope` 经它返回。**该 bug 由此从「当前不存在」变成「结构上不可能」。**

### 3. `output.schema` 改为开放（与 dsh-mnemon 一致）

关键区分：**`output.schema` 约束的是自己的 handler 返回值，不是模型输出**；模型输出由 `parameters` 约束。

- `parameters` → 保持严格（约束模型，严格是对的）
- `output.schema` → 改为 `{ type: "object", additionalProperties: true }`

行业共识亦支持放宽（OpenAI 结构化输出文档、Anthropic strict tool use、PhantomFill 等 schema 设计研究）：**不要用 schema 强迫输出方说谎，required 要少，enum 要留逃生值**。过度严格的自伤我们已经付过一次——`gaps` 字段即证据。

## 教训（可复用规则）

1. **DSH 的 `ctx.tools.register` 是弱校验路径**：它只验 schema，不验 `render` 返回值。`defineTool` 路径才有 `assertRenderedContent` 兜底。凡绕过 `defineTool` 直连 `register` 的工具，`render` 契约必须靠自有测试锁住。
2. **「注册成功 + schema 通过」不等于「工具可用」**：本批次 P0 计划文档原话是「5 个 schema 全部通过真实 dsh-tools assertSupportedJsonSchema；registerLdvhTools 在假 ctx 注册成功」——两处都验了，都通过了，工具却完全不可用。假 ctx 只验注册调用不报错，验不到结果交付阶段。
3. **结果交付阶段是独立于 handler 的失败域**：handler 全绿、既有测试全绿，`content.some` 仍能整批击穿。测试必须覆盖 `execute → schema → render → content` 全链，而不是只覆盖 `execute`。
4. **用 DSH 自己的校验器做机械验证**：`@deepseek-ai/dsh-tools` 导出 `assertSupportedJsonSchema` / `assertObjectJsonSchema` / `validateJsonSchemaValue` / `parameterSchemaSpecToJsonSchema`。本次即以此端到端复核（schema 零违规 + render 数组 + `.some()` 正常返回 false）。比自造断言可靠。

### 4. 权威依据（外部 + 本地双重确认）

| 来源 | 结论 |
|---|---|
| MCP 官方 SDK `@modelcontextprotocol/sdk` v1.30.0（协议 2025-11-25）`CallToolResultSchema` | `content: z.array(ContentBlockSchema).default([])`，注释「If the Tool does not define an outputSchema, this field MUST be present」；`TextContent = { type: literal('text'), text: string }` |
| DSH 自带 MCP 客户端 `dsh-mcp-client` | 输出 schema 为 `{ content: { type: "array", items: {} } }`，`render` 返回 `[{ type: "text", text: extractText(...) }]` |
| dsh-mnemon / dsh-sub-cli / dsh-deep-research / dsh-plan-mode | 无一例外返回内容块数组 |

### 5. 复核结论（机械验证，DSH 真实校验器）

5 个工具逐一：`assertSupportedJsonSchema(output.schema)` OK、`assertObjectJsonSchema(parameters)` OK、`validateJsonSchemaValue` 零违规、`render` 返回数组、`content.some(...)` 正常返回 false。

防回归测试已锁住：schema 保持开放（`additionalProperties === true` 且无 `properties`）、每个 descriptor 声明完整注册契约。

注：`parameters` 走 `register` 原始 JSON Schema 分支（`type` + `properties` + `additionalProperties: false`），**不**走 `defineTool` 的 DSL 分支（`parameterSchemaSpecToJsonSchema`，要求 `properties` 为值 schema 映射）。两者格式不同，不可直接复用。
