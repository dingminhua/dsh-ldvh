// dsh-ldvh — 称呼文本的单一代码来源
//
// Authority: ldvh-base/norms/norm-67137333《AI 与 Human 的协作约定》第 1 条。
//
// **第二来源风险（审查 MINOR-19）**：Norm 正文写「你好，老丁」，代码里再写一个
// 常量即构成第二来源——Norm 经 Human 改成别的称呼时代码不会跟随。缓解：
// `plugin/test/greeting-enforcer.test.mjs` 断言本常量与 Norm 第 1 条原文逐字一致；
// Norm 改称呼而测试未同步即转红。

/** 受辖根会话每回合回复的起首称呼（与 Norm 第 1 条逐字一致）。 */
export const GREETING_TEXT = "你好，老丁";
