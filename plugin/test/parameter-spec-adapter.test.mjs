import { test } from "node:test";
import assert from "node:assert/strict";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { droppedConstraints, toParameterSpec } from "../lib/parameter-spec-adapter.js";

// ---------------------------------------------------------------------------
// 适配器把既有 JSON Schema 参数表转成宿主 defineTool 的 schema DSL
// （spark-5b0b380e：裸描述符注册时参数表从未被校验）
// ---------------------------------------------------------------------------

function buildTool(parameters) {
  return defineTool({
    name: "probe_tool",
    description: "probe",
    parameters,
    output: { schema: { type: "object", properties: {}, additionalProperties: true }, render: () => [] },
    async execute(args) { return { got: args }; },
  });
}

/** Run the tool, returning the host violation text or null when accepted. */
async function verdict(tool, args) {
  try {
    await tool.execute(args, {});
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

test("嵌套对象的 required 变成逐属性注解并被强制", async () => {
  const spec = toParameterSpec({
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "update"] },
      draft: { type: "object", properties: { title: { type: "string" }, scope: { type: "string" } }, required: ["title"], additionalProperties: false },
    },
    required: ["action"],
    additionalProperties: false,
  });
  const tool = buildTool(spec);

  assert.match(await verdict(tool, { action: "create", draft: { scope: "s" } }), /missing required property "draft\.title"/);
  assert.equal(await verdict(tool, { action: "create", draft: { title: "t" } }), null);
});

test("嵌套对象的字段封闭被强制（未声明键被拒）", async () => {
  const tool = buildTool(toParameterSpec({
    type: "object",
    properties: {
      draft: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false },
    },
  }));
  assert.match(await verdict(tool, { draft: { title: "t", bogus: 1 } }), /draft\.bogus.*is not a declared property/);
});

test("enum 与类型被强制", async () => {
  const tool = buildTool(toParameterSpec({
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "update"] },
      priority: { type: "string", enum: ["P0", "P1"] },
    },
  }));
  assert.match(await verdict(tool, { action: "destroy" }), /"action" must be one of/);
  assert.match(await verdict(tool, { priority: 99 }), /"priority" must be a string/);
});

test("items[].required 不被静默丢弃（数组项必填仍生效）", async () => {
  // 回归护栏：适配器曾给 items 传空集，导致 relations 缺 target 也放行（审核实测反例）。
  const tool = buildTool(toParameterSpec({
    type: "object",
    properties: {
      relations: {
        type: "array",
        items: {
          type: "object",
          properties: { relation_key: { type: "string" }, target: { type: "object", properties: { object_uid: { type: "string" } }, required: ["object_uid"], additionalProperties: false } },
          required: ["relation_key", "target"],
          additionalProperties: false,
        },
      },
    },
  }));
  assert.match(
    await verdict(tool, { relations: [{ relation_key: "informs" }] }),
    /relations\[0\]\.target/,
    "数组项缺必填必须被拒——否则 relations 缺 target 会一路走到 writer",
  );
});

test("oneOf 分支的 required 不被静默丢弃", async () => {
  const tool = buildTool(toParameterSpec({
    type: "object",
    properties: {
      attribution_ref: {
        oneOf: [
          { type: "string" },
          { type: "object", properties: { object_uid: { type: "string" } }, required: ["object_uid"], additionalProperties: false },
        ],
      },
    },
  }));
  // 宿主的 oneOf 报错文案是「must match exactly one oneOf branch (matched 0)」，
  // 不点名具体缺哪个键——故断言只钉「被拒」，不钉文案形态。
  assert.match(await verdict(tool, { attribution_ref: {} }), /attribution_ref.*oneOf/);
  assert.equal(await verdict(tool, { attribution_ref: { object_uid: "u" } }), null);
});

test("object 节点缺 additionalProperties 时补 true（不悄悄收紧）", async () => {
  const spec = toParameterSpec({ type: "object", properties: { open: { type: "object", properties: { a: { type: "string" } } } } });
  assert.equal(spec.open.additionalProperties, true);
  assert.equal(await verdict(buildTool(spec), { open: { a: "x", extra: 1 } }), null, "JSON Schema 的缺省是开放，适配后应保持开放");
});

test("顶层 required 不交给参数层（缺参数由 handler 出信封）", async () => {
  const tool = buildTool(toParameterSpec({
    type: "object",
    properties: { object_uid: { type: "string" } },
    required: ["object_uid"],
    additionalProperties: false,
  }));
  assert.equal(await verdict(tool, {}), null, "缺失顶层参数不得在参数层硬拒，否则丢掉 gaps/follow_up 提示");
});

test("frontmatter_after 补 Code 托管字段，保住「读出再改回去」的往返", async () => {
  const spec = toParameterSpec({
    type: "object",
    properties: {
      frontmatter_after: { type: "object", properties: { title: { type: "string" } }, additionalProperties: false },
    },
  });
  const fields = Object.keys(spec.frontmatter_after.properties);
  for (const managed of ["object_uid", "fact_type_key", "created_at", "change_log"]) {
    assert.ok(fields.includes(managed), `${managed} must be declarable on frontmatter_after`);
  }
  // 未声明的普通字段仍应被拒——补声明不等于把对象变开放。
  assert.match(
    await verdict(buildTool(spec), { frontmatter_after: { title: "t", bogus: 1 } }),
    /frontmatter_after\.bogus/,
  );
});

test("被丢弃的约束可被枚举，不是静默消失", async () => {
  const authored = { type: "object", properties: { limit: { type: "integer", minimum: 1 }, name: { type: "string", pattern: "^x" } } };
  assert.deepEqual(
    droppedConstraints(authored).sort(),
    ["properties.limit.minimum", "properties.name.pattern"],
  );
});
