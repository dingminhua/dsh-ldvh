import assert from "node:assert/strict";
import http from "node:http";
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

function runClientProbe(fetchImpl, options = {}) {
	const observed = [];
	const slots = new Map();
	let nextSlot = 0;
	const reactStub = {
		createElement(type, props) {
			if (typeof type === "function") return type(props || {});
			return { type, props };
		},
		useState(initial) {
			const slot = nextSlot;
			nextSlot += 1;
			if (!slots.has(slot)) slots.set(slot, typeof initial === "function" ? initial() : initial);
			return [slots.get(slot), (next) => { slots.set(slot, next); observed.push({ slot, value: next }); }];
		},
		useEffect(fn) { fn(); },
		useRef(value) { return { current: value }; },
	};

	let plugin;
	const context = {
		window: {
			__ModuleLoader__: { load(definition) { plugin = definition.factory((id) => {
				if (id === "react") return reactStub;
				if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Toast() {}, IconChevronDownOutlineRegular() {} };
				throw new Error(`unexpected require: ${id}`);
			}); } },
			...(options.location ? { location: options.location } : {}),
		},
		document: undefined,
		fetch: fetchImpl,
		console: { error() {} },
		encodeURIComponent,
	};
	vm.runInNewContext(source, context, { filename: "client.js" });

	let rendered = null;
	const ctx = {
		effect(register) { register(); },
		get() { return undefined; },
		locale: { register() { return () => {}; }, bind() { return (key) => key; } },
		inject(names, callback) {
			if (!names.includes("betterSidebar")) return () => {};
			callback({
				betterSidebar: {
					registerTab(def) {
						rendered = def.component({ scope: {} });
						return () => {};
					},
				},
				effect(register) { register(); },
			});
			return () => {};
		},
		slots: { inject() { return () => {}; }, register() { return () => {}; } },
	};
	plugin.apply(ctx);
	assert.ok(rendered !== null, "the sidebar tab must register and render — otherwise no probe ran");
	return { conclusions: () => observed.map((entry) => entry.value).filter((v) => v && typeof v === "object" && "ready" in v && "failed" in v) };
}

test("client probe reports unavailable when the iframe origin is dead, even though the host route answers", async () => {
	const grave = http.createServer(() => {});
	await new Promise((resolve) => grave.listen(0, "127.0.0.1", resolve));
	const deadPort = grave.address().port;
	await new Promise((resolve) => grave.close(resolve));

	const hostCalls = [];
	const host = http.createServer((req, res) => {
		hostCalls.push(req.url);
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ ok: true, service: "dsh-ldvh", status: "ok", prefix: "/ldvh/api", webPort: deadPort }));
	});
	await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
	const hostBase = `http://127.0.0.1:${host.address().port}`;

	const fetchImpl = (input, init) => {
		const url = String(input);
		if (url.startsWith("/")) return fetch(hostBase + url, init);
		return fetch(url, init);
	};

	const { conclusions } = runClientProbe(fetchImpl);
	let seen = [];
	for (let i = 0; i < 40 && seen.length === 0; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		seen = conclusions();
	}
	await new Promise((resolve) => host.close(resolve));

	assert.ok(hostCalls.includes("/ldvh/api/health"), "the host route must have been asked and answered");
	assert.ok(seen.length > 0, "the client probe must have reached a conclusion");
	const final = seen[seen.length - 1];
	assert.equal(final.ready, false, "probe must report NOT ready when the iframe origin is dead");
	assert.equal(final.failed, true, "probe must fall into the failed/unavailable branch");
});

test("client probe reports ready when the iframe origin serves, and probes that same origin", async () => {
	const child = http.createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<html>ok</html>"); });
	await new Promise((resolve) => child.listen(0, "127.0.0.1", resolve));
	const childPort = child.address().port;

	const host = http.createServer((_req, res) => {
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ ok: true, service: "dsh-ldvh", status: "ok", prefix: "/ldvh/api", webPort: childPort }));
	});
	await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
	const hostBase = `http://127.0.0.1:${host.address().port}`;

	const loopbackPaths = [];
	const fetchImpl = (input, init) => {
		const url = String(input);
		if (url.startsWith("/")) return fetch(hostBase + url, init);
		loopbackPaths.push(url);
		return fetch(url, init);
	};

	const { conclusions } = runClientProbe(fetchImpl);
	let seen = [];
	for (let i = 0; i < 40 && seen.length === 0; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		seen = conclusions();
	}
	child.closeAllConnections?.();
	await new Promise((resolve) => child.close(resolve));
	await new Promise((resolve) => host.close(resolve));

	assert.ok(seen.length > 0, "the client probe must have reached a conclusion");
	const final = seen[seen.length - 1];
	assert.equal(final.ready, true, "probe must report ready when the iframe origin serves");
	assert.ok(
		loopbackPaths.some((url) => url === `http://127.0.0.1:${childPort}/ldvh/`),
		`probe must hit the iframe's own origin: ${JSON.stringify(loopbackPaths)}`,
	);
});

test("browser-origin documents probe the current origin and accept the host-route health shape", async () => {
	const host = http.createServer((req, res) => {
		if (req.url === "/ldvh/") { res.setHeader("content-type", "text/html"); res.end("<html>ok</html>"); return; }
		if (req.url === "/ldvh/api/health") {
			res.setHeader("content-type", "application/json; charset=utf-8");
			res.end(JSON.stringify({ ok: true, service: "dsh-ldvh", status: "ok", prefix: "/ldvh/api", webPort: 3299 }));
			return;
		}
		res.statusCode = 404; res.end();
	});
	await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
	const hostBase = `http://127.0.0.1:${host.address().port}`;

	const absoluteProbes = [];
	const fetchImpl = (input, init) => {
		const url = String(input);
		if (url.startsWith("/")) return fetch(hostBase + url, init);
		absoluteProbes.push(url);
		return fetch(url, init);
	};

	const { conclusions } = runClientProbe(fetchImpl, {
		location: { protocol: "http:", origin: hostBase, href: `${hostBase}/` },
	});
	let seen = [];
	for (let i = 0; i < 40 && seen.length === 0; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 50));
		seen = conclusions();
	}
	host.closeAllConnections?.();
	await new Promise((resolve) => host.close(resolve));

	assert.ok(seen.length > 0, "the client probe must have reached a conclusion");
	const final = seen[seen.length - 1];
	assert.equal(final.ready, true, "probe must report ready when the current origin serves /ldvh and host-shape health");
	assert.ok(
		absoluteProbes.length > 0 && absoluteProbes.every((url) => url.startsWith(hostBase)),
		`browser-origin probes must target the current origin, got: ${JSON.stringify(absoluteProbes)}`,
	);
	assert.ok(
		!absoluteProbes.includes("http://127.0.0.1:3299/ldvh/") && !absoluteProbes.includes("http://127.0.0.1:3299/ldvh/api/health"),
		"a browser-origin document must never probe the loopback web-api child directly",
	);
});

test("client probe URL is the iframe's own origin, not the host route", () => {
	assert.ok(
		/function probeLoopback\(path, then\)[\s\S]{0,400}fetch\(ldvhWebOrigin \+ path/.test(source),
		"probe must fetch the loopback origin the iframe uses",
	);
	assert.ok(
		/function probeHealthStatus\(then\)/.test(source),
		"the probe must distinguish 'reachable' from 'healthy'",
	);
	assert.ok(
		/body && body\.success === true/.test(source),
		"the health probe must read the child's own success flag, not just connectivity",
	);
	assert.ok(
		/probeLoopback\("\/ldvh\/", function \(pageReachable\)/.test(source),
		"the readiness gate must first probe the iframe's SPA path on that origin",
	);
	assert.ok(
		/fetch\("\/ldvh\/api\/health", \{ method: "GET", cache: "no-store" \}\)/.test(source),
		"webPort discovery must keep using the host route",
	);
	assert.ok(/mode: "no-cors"/.test(source), "the loopback probe must tolerate the cors boundary");
});

test("client apply swallows a settings slot failure and preserves the Host", () => {
	let plugin;
	const errors = [];
	const context = {
		window: { __ModuleLoader__: { load(definition) { plugin = definition.factory((id) => {
			if (id === "react") return createReactStub();
			if (id === "@deepseek-ai/dsh-client-ui-primitives") {
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
