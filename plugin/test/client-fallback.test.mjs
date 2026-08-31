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
				return { Toast() {}, IconChevronDownOutline14() {} };
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
		settingsScope: { bind() { return {}; } },
		slots: { inject() { throw new Error('keyed slot "settings.plugin.item" requires options.key'); } },
	};

	assert.doesNotThrow(() => plugin.apply(fakeCtx));
	assert.equal(errors.length, 1);
	assert.match(String(errors[0]), /client UI failed to load/);
	assert.match(String(errors[0]), /requires options.key/);
});
