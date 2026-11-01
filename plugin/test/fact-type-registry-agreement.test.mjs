// 「已登记事实类型」这一事实在两个模块里各有一份清单，消费面不同：
//   · `source-recall.js` 的 `REGISTERED_FACT_TYPES`——召回侧，决定扫哪些目录；
//   · `object-reference.js` 的 `FACT_TYPE_KEYS`——渲染侧，决定要不要加类型前缀。
//
// 二者**已经漂移过**：`subgoal` 在 2026-11-01 成为 28 号类型时只同步了召回侧，
// 渲染侧漏改，后果是所有子目标对象经 `objectRef()` 渲染成裸 8 位十六进制
// （读者认不出这是子目标），而 2556 条既有用例**没有一条报错**。
//
// 本用例把两份清单机械绑定：新增类型而不同步任一侧，立刻转红。
//
// **为什么不是「从规范源派生」**：那样确实能消除重复，但会把整个召回模块拖进
// 每次渲染路径（`objectRef` 被大量工具响应投影调用）。绑定清单是更小的改动，
// 且失败信息直接指向「你漏改了哪一侧」，比运行期派生更好定位。
import assert from "node:assert/strict";
import test from "node:test";
import { __FACT_TYPE_KEYS_FOR_TEST } from "../lib/object-reference.js";
import { REGISTERED_FACT_TYPES } from "../lib/source-recall.js";

test("两份「已登记事实类型」清单必须逐项相等（漂移即红）", () => {
	const rendered = [...__FACT_TYPE_KEYS_FOR_TEST].sort();
	const recalled = [...REGISTERED_FACT_TYPES].sort();

	const onlyRender = rendered.filter((t) => !recalled.includes(t));
	const onlyRecall = recalled.filter((t) => !rendered.includes(t));

	assert.deepEqual(
		{ onlyRender, onlyRecall },
		{ onlyRender: [], onlyRecall: [] },
		[
			"两份清单已漂移——同一事实（哪些事实类型已登记）出现了两个不一致的答案。",
			onlyRecall.length > 0
				? `  只在召回侧有：${onlyRecall.join(", ")}——渲染侧缺，这些类型经 objectRef() 会退化成裸短 uid。`
				: "",
			onlyRender.length > 0
				? `  只在渲染侧有：${onlyRender.join(", ")}——召回侧缺，这些类型的事实对象不会被扫进任何候选。`
				: "",
			"两侧须同时补：plugin/lib/source-recall.js 的 REGISTERED_FACT_TYPES、",
			"plugin/lib/object-reference.js 的 FACT_TYPE_KEYS。",
		]
			.filter(Boolean)
			.join("\n"),
	);
});

test("每个已登记类型都能渲染出带类型前缀的指称（不得退化为裸短 uid）", async () => {
	const { objectRef } = await import("../lib/object-reference.js");
	const uid = "01978a8b-8e94-4481-80dd-8a44fa0a5ce6";

	for (const type of REGISTERED_FACT_TYPES) {
		assert.equal(
			objectRef({ object_uid: uid, fact_type_key: type }),
			`${type}-01978a8b`,
			`类型「${type}」未渲染出类型前缀——它在 FACT_TYPE_KEYS 里缺失，读者将无法据此辨认对象类型`,
		);
	}
});

test("未登记的类型短名仍须如实退化为裸短 uid（不得猜造前缀）", async () => {
	const { objectRef } = await import("../lib/object-reference.js");
	const uid = "01978a8b-8e94-4481-80dd-8a44fa0a5ce6";

	// 「猜造类型短名会让读者以为该对象属于一个它并不属于的类型——那比缺少类型更坏」
	// （object-reference.js 模块头注释）。本用例守住这条边界：注册表之外一律不加前缀。
	assert.equal(objectRef({ object_uid: uid, fact_type_key: "not-a-registered-type" }), "01978a8b");
	assert.equal(objectRef({ object_uid: uid, fact_type_key: "" }), "01978a8b");
	assert.equal(objectRef({ object_uid: uid }), "01978a8b");
});
