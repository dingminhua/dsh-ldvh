import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

function createReactStub() {
	return {
		createElement() { return null; },
		useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
		useEffect() {},
		useRef(value) { return { current: value }; },
	};
}

test("client apply swallows a settings slot failure and preserves the Host", () => {
	let plugin;
	const errors = [];
	const context = {
		window: { __ModuleLoader__: { load(definition) { plugin = definition.factory((id) => {
			if (id === "react") return createReactStub();
			if (id === "@deepseek-ai/dsh-client-ui-primitives") {
				// 0.1.7 起图标族改用粗细语义后缀（调研 §4.3 致命点 B）。
				return { Toast() {}, IconChevronDownOutlineRegular() {} };
			}
			throw new Error(`unexpected require: ${id}`);
		}); } } },
		document: undefined,
		fetch: async () => ({ json: async () => ({ ok: true }) }),
		console: { error(...args) { errors.push(args); } },
		encodeURIComponent,
	};
	vm.runInNewContext(source, context, { filename: "client.js" });
	assert.ok(plugin && typeof plugin.apply === "function");

	const fakeCtx = {
		effect(register) { register(); },
		get() { return undefined; },
		locale: {
			register() { return () => {}; },
			bind() { return (key) => key; },
		},
		// 0.1.7：设置面改走 configForms 软注入（settingsScope 已删除）。这里让服务
		// 存在但取表单失败，验证 apply 仍然吞掉异常、留下诊断，且宿主侧不受影响。
		inject(names, callback) {
			if (names.includes("configForms")) {
				callback({
					configForms: { get() { throw new Error('configForms: entry "dsh-ldvh" is not served'); } },
					effect(register) { register(); },
				});
			}
			return () => {};
		},
		slots: { inject() { return () => {}; } },
	};

	assert.doesNotThrow(() => plugin.apply(fakeCtx));
	assert.equal(errors.length, 1);
	assert.match(String(errors[0]), /client UI failed to load/);
	assert.match(String(errors[0]), /is not served/);
});
