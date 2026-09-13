# P0 开发中发现的规范矛盾记录

> 性质：开发备忘条目，非规范、非事实对象。
> **处置结果（2026-09-13 补记）**：本矛盾已按候选方向 **A** 修复——00 身份块 `code_consumption` 四键改为 kebab-case（`spec-identity-block` / `spec-read-contract` / `minimal-guidance-profile` / `ldvh-cli-boundary`，第 4 键由 `helper_service_boundary` 更名），随 `d3a9f88`「00 身份块 code_consumption 修合规」提交落地；00 已通过机械解析校验（`spec-registry` 全量自测通过）。本记录作为 P0 阶段发现的矛盾与修复路径保留，供溯源。

## 矛盾：00 `code_consumption` 值与 Att.02 §3 字段格式不一致

**发现时间**：P0 实现批次（spec-registry 解析器对真实语料全量自测时）。

**事实**：

1. `specs/00-理念与构成.md` 身份块 `code_consumption` 现值为下划线格式 4 键：`spec_identity_block`、`spec_read_contract`、`minimal_guidance_profile`、`helper_service_boundary`（回填于 `3e45129`，2026-08-25）。
2. 该 4 键的出处是**旧版 01 §9.3「根级 Code 消费入口（code_consumption 回填方案）」**（3e45129 时的 01），旧文明确以这些下划线字面量定义入口。
3. 01 后续重建（固定章节统一批次）删除了 §9.3 回填方案节；现行 01 与 `specs/attachments/01.Att.02-规范身份字段表.md` §3（根规范身份 profile 表）规定：`code_consumption`「成员使用职责标识符格式且唯一」，而 Att.02 §2 将职责标识符格式定义为 `[a-z][a-z0-9]*(?:-[a-z0-9]+)*`（即 kebab-case，不含下划线）。
4. 因此 00 现值不满足现行 Att.02 §3 的成员格式契约；按 01 §9.2 条件 4（载体一致性）与 §6.2（冲突必须修复，不得选择较方便的一方继续），00 身份块当前不满足当前规则源成立条件（机械解析层面如实拒绝）。

**影响**：

- P0 的 `read-specification-candidates/content` 会把 00 如实报告为资格 gaps（`non_member_candidate`，原因：`identity/field_invalid code_consumption members must match the responsibility-identifier pattern`），L0–L4 当前规则结果不含 00 正文——这暴露真实矛盾而非解析器缺陷。
- 00 是受保护文档（00 §4.3 / 08 §7.6）：修复须走受保护文档流程（展示现有内容与准确候选 → 独立审核 → Human 逐段同意 → 只含 00 的独立 commit）。

**候选修复方向（供 Human 决定，不预设）**：

A. 00 值改为 kebab-case 4 键：`spec-identity-block` / `spec-read-contract` / `minimal-guidance-profile` / `helper-service-boundary`（对齐现行 Att.02 §3；Code 引用点尚未消费这些字面量，改名零迁移成本——P0 本批实现正好是首个消费方，实现按 kebab-case 理解）；
B. 修订 Att.02 §3 放宽成员格式（允许下划线）——与 §2 职责标识符闭集定义冲突，牵动更大；
C. 其它 Human 认定方向。

**P0 实现的临时口径**：解析器按现行 Att.02 §3 严格校验（kebab-case），00 如实报拒；待 Human 修复后 00 自动通过，无需改代码。
