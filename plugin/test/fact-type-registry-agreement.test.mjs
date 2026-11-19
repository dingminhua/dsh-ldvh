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

	assert.equal(objectRef({ object_uid: uid, fact_type_key: "not-a-registered-type" }), "01978a8b");
	assert.equal(objectRef({ object_uid: uid, fact_type_key: "" }), "01978a8b");
	assert.equal(objectRef({ object_uid: uid }), "01978a8b");
});
