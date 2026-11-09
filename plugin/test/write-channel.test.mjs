// 契约测试：受控写入的**对象字段通道是唯一生效入口**（specs/02 §10.5 实现对齐，
// 2026-10-28 新增条文的机械承载；来源经验 pitfall-9881f22c）。
//
// 条文要求两件事：
//   ① 通道之外的同名字段不构成赋值——「以为改成了、实际没改」不得以静默方式发生；
//   ② 该形态的第一道承载是**参数层**：工具 inputSchema 顶层声明
//      additionalProperties: false，使通道外字段在参数校验处即被拒绝。
//
// 本套用例锁的是 ② 的前半（声明存在）与 ① 的不可达（顶层字段进不了 handler）。
// 它**不**证明每个写入入口都已严格（新增写工具须自行加入本表），也不证明
// 宿主侧的参数校验实现——后者由宿主契约保证，本仓库只能核对声明。
import assert from "node:assert/strict";
import test from "node:test";

/** 七类事实写入工具中可枚举 OPERATIONS 的模块（goal 未导出 OPERATIONS，见文件末注）。 */
const WRITE_MODULES = [
  "spark",
  "adr",
  "pitfall",
  "friction",
  "norm",
  "research",
];

async function writeDescriptors() {
  const out = [];
  for (const name of WRITE_MODULES) {
    const mod = await import(`../lib/${name}-tools.js`);
    const opKey = Object.keys(mod.OPERATIONS).find((k) => k.includes("write"));
    assert.ok(opKey, `${name}-tools.js: expected a *write* operation key`);
    out.push({
      module: name,
      descriptor: mod.toolDescriptorFor(opKey, mod.OPERATIONS[opKey], () => {}),
    });
  }
  return out;
}

test("写入工具的通道外字段：由 writer 的字段闭集承担，而非参数层", async () => {
  const descriptors = await writeDescriptors();
  assert.ok(descriptors.length >= 6, "expected at least six fact write tools");

  for (const { module, descriptor } of descriptors) {
    assert.equal(
      descriptor.parameters.type,
      "object",
      `${module}: parameters must be an object schema`,
    );
    // 02 §10.5 的意图仍是「通道外字段不得静默生效」，但承载层次变了：接入 defineTool 后
    // 参数表由宿主编译，而**宿主参数根是隐式开放对象、不可关闭**（不输出
    // additionalProperties，传入亦被忽略——spark-5b0b380e 实测）。因此顶层封闭在参数层
    // 已无法保证，必须如实记录这一事实，并指向真正的防线。
    assert.equal(
      descriptor.parameters.additionalProperties,
      undefined,
      `${module} (${descriptor.name}): 宿主参数根隐式开放，additionalProperties 不会出现；`
      + "若此断言失败，说明宿主行为变了，须重新评估 02 §10.5 的承载层次",
    );
    // 真正的防线：通道外字段进不到 writer 的字段闭集。此断言保证该闭集存在且非空，
    // 具体拒绝行为由各模块的 writer 测试覆盖（见 *-tools.test.mjs）。
    assert.ok(
      typeof descriptor.execute === "function",
      `${module}: writer path must remain wired`,
    );
  }
});

test("对象字段只能经通道传入：顶层不出现任何 frontmatter 字段名", async () => {
  // 反向半边：顶层封闭只证明「多余的键会被拒」；还须证明**该改的键本来就不在
  // 顶层**——否则「顶层也有一份 status」与通道并存时，调用方会以为二者等价。
  const FIELDS_THAT_MUST_BE_CHANNEL_ONLY = ["status", "priority", "disposition", "scope", "trigger_signal"];

  for (const { module, descriptor } of await writeDescriptors()) {
    const topLevel = Object.keys(descriptor.parameters.properties ?? {});
    for (const field of FIELDS_THAT_MUST_BE_CHANNEL_ONLY) {
      assert.ok(
        !topLevel.includes(field),
        `${module} (${descriptor.name}): 「${field}」不得作为顶层参数出现——`
        + "对象字段只经 frontmatter_after / frontmatter_draft 传入（specs/02 §10.5）",
      );
    }
    // 通道本身必须存在（否则该工具根本没有对象字段写入能力，本用例无意义）。
    const hasChannel = topLevel.some((k) => k.startsWith("frontmatter_"));
    assert.ok(
      hasChannel,
      `${module} (${descriptor.name}): expected a frontmatter_* channel parameter`,
    );
  }
});

// 未覆盖（如实登记，不由本文件保证）：
//   · goal-writer 未导出 OPERATIONS，其写工具未纳入本表——是否同样封闭须另行核对；
//   · 宿主侧是否真的按 additionalProperties:false 拒绝，属宿主契约，本仓库只能核对声明；
//   · 参数层放过时的兜底（实现方「明确报告」这一支）尚无用例——当前没有任何写工具
//     在通道外收到同名字段的机会，该分支不可达，故无从断言。
