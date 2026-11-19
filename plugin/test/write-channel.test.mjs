import assert from "node:assert/strict";
import test from "node:test";

const WRITE_MODULES = [
  "spark",
  "pitfall",
  "friction",
  "norm",
  "report",
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

test("写入工具的顶层参数根是开放的（通道外字段不在参数层被拒，且无替代守护）", async () => {
  const descriptors = await writeDescriptors();
  assert.ok(descriptors.length >= 5, "expected at least five fact write tools（ADR 撤除后为五类）");

  for (const { module, descriptor } of descriptors) {
    assert.equal(
      descriptor.parameters.type,
      "object",
      `${module}: parameters must be an object schema`,
    );
    assert.equal(
      descriptor.parameters.additionalProperties,
      undefined,
      `${module} (${descriptor.name}): 宿主参数根隐式开放，additionalProperties 不会出现；`
      + "若此断言失败，说明宿主行为变了，须重新评估 02 §10.5 的承载层次",
    );
    assert.ok(
      typeof descriptor.execute === "function",
      `${module}: writer path must remain wired`,
    );
  }
});

test("对象字段只能经通道传入：顶层不出现任何 frontmatter 字段名", async () => {
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
    const hasChannel = topLevel.some((k) => k.startsWith("frontmatter_"));
    assert.ok(
      hasChannel,
      `${module} (${descriptor.name}): expected a frontmatter_* channel parameter`,
    );
  }
});

