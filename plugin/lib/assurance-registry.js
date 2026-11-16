// dsh-ldvh — 强制面/保证面 name 的冻结登记（解析面）
//
// Authority: specs/27 §6.1（声明的 name 须可解析）。
//
// **为什么是显式登记而不是扫源码**（审查 MAJOR-11）：writer 的拒绝码大多是
// `failure("norm/body_invalid")` 一类字符串字面量，扫源码既脆弱又会把共享码
// （如 `invalid_request`）算进去；`test:` 面在发布包里根本不存在。故本文件是
// **唯一登记处**：新增拒绝码或保证面时在此登记，并由 schema–writer 一致性用例
// 断言「登记集 ⊆ 代码真实存在的字面量」。
//
// 变更本文件须走受控提交；登记项删除即声明失效（解析不到 ⇒ 披露 invalid）。

/** writer 面可解析的拒绝码（冻结登记）。 */
export const WRITER_REJECTION_CODES = Object.freeze([
  "norm/frontmatter_invalid",
  "norm/body_invalid",
  "norm/direction_key_invalid",
  "norm/direction_key_conflict",
  "norm/status_required",
  "norm/transition_illegal",
  "norm/fingerprint_mismatch",
]);

/** 保证面（pre-injector）可解析的 name（冻结登记）。 */
export const GUARANTEE_SURFACE_IDS = Object.freeze([
  "greeting-prefix",
]);
