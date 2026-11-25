import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");


const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createServer(decisions) {
	const stateCalls = [];
	const delivered = new Map();
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, "http://127.0.0.1");
		if (url.pathname === "/ldvh/api/health") {
			res.setHeader("content-type", "application/json; charset=utf-8");
			res.end(JSON.stringify({ ok: true, service: "dsh-ldvh", status: "ok", prefix: "/ldvh/api", webPort: server.address().port }));
			return;
		}
		if (url.pathname === "/ldvh/state/governance") {
			const sessionId = url.searchParams.get("sessionId") ?? "";
			stateCalls.push(sessionId);
			const decision = decisions[sessionId] ?? { ok: true, state: "unknown", project: null };
			res.setHeader("content-type", "application/json; charset=utf-8");
			res.end(JSON.stringify(decision));
			delivered.set(sessionId, (delivered.get(sessionId) ?? 0) + 1);
			return;
		}
		res.setHeader("content-type", "text/html");
		res.end("<html>ok</html>");
	});
	return { server, stateCalls, delivered };
}

function frameSrc(node) {
	if (!node || typeof node !== "object") return null;
	if (node.type === "iframe") return node.props.src ?? "";
	const children = node.props.children;
	const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
	for (const child of list) {
		const found = frameSrc(child);
		if (found !== null) return found;
	}
	return null;
}

function createHarness(fetchImpl, sessionIdRef, delivered) {
	const slots = new Map();
	const effectSlots = new Map();
	let tabComponent = null;
	let writes = 0;
	let cursor = 0;

	const sameDeps = (a, b) => {
		if (a === undefined || b === undefined) return false;
		if (a.length !== b.length) return false;
		return a.every((value, index) => Object.is(value, b[index]));
	};

	const reactStub = {
		createElement(type, props, ...children) {
			if (typeof type === "function") return type(props || {});
			const merged = { ...(props || {}) };
			if (children.length > 0) merged.children = children.length === 1 ? children[0] : children;
			return { type, props: merged };
		},
		useState(initial) {
			const slot = cursor;
			cursor += 1;
			if (!slots.has(slot)) slots.set(slot, typeof initial === "function" ? initial() : initial);
			return [slots.get(slot), (next) => {
				writes += 1;
				slots.set(slot, typeof next === "function" ? next(slots.get(slot)) : next);
			}];
		},
		useEffect(fn, deps) {
			const slot = cursor;
			cursor += 1;
			const previous = effectSlots.get(slot);
			if (previous && sameDeps(previous.deps, deps)) return;
			if (previous && typeof previous.cleanup === "function") previous.cleanup();
			const cleanup = fn();
			effectSlots.set(slot, { deps, cleanup: typeof cleanup === "function" ? cleanup : null });
		},
		useRef(value) {
			const slot = cursor;
			cursor += 1;
			if (!slots.has(slot)) slots.set(slot, { current: value });
			return slots.get(slot);
		},
	};

	let plugin;
	const messageListeners = [];
	vm.runInNewContext(source, {
		window: {
			addEventListener: (kind, handler) => { if (kind === "message") messageListeners.push(handler); },
			location: undefined,
			__ModuleLoader__: { load(definition) { plugin = definition.factory((id) => {
				if (id === "react") return reactStub;
				if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Toast() {}, IconChevronDownOutlineRegular() {} };
				throw new Error(`unexpected require: ${id}`);
			}); } },
		},
		document: undefined,
		fetch: fetchImpl,
		console: { error() {} },
		encodeURIComponent,
		setTimeout,
		clearTimeout,
	}, { filename: "client.js" });

	plugin.apply({
		effect(register) { register(); },
		get() { return undefined; },
		locale: { register() { return () => {}; }, bind() { return (key) => key; } },
		inject(names, callback) {
			if (!names.includes("betterSidebar")) return () => {};
			callback({
				betterSidebar: { registerTab(def) { tabComponent = def.component; return () => {}; } },
				effect(register) { register(); },
			});
			return () => {};
		},
		slots: { inject() { return () => {}; }, register() { return () => {}; } },
	});

	function render() {
		cursor = 0;
		return tabComponent({ scope: { sessionId: sessionIdRef.current } });
	}

	async function switchAndSettle(run, sessionId, maxTicks = 200) {
		const writesBefore = writes;
		const deliveredBefore = sessionId === null ? 0 : (delivered.get(sessionId) ?? 0);
		run();
		if (sessionId !== null) {
			for (let i = 0; i < maxTicks && (delivered.get(sessionId) ?? 0) <= deliveredBefore; i += 1) {
				render();
				await wait(5);
			}
			assert.ok((delivered.get(sessionId) ?? 0) > deliveredBefore, `管辖判定必须以 ${sessionId} 被询问并应答：${JSON.stringify([...delivered.keys()])}`);
		}
		for (let i = 0; i < maxTicks && writes === writesBefore; i += 1) {
			render();
			await wait(5);
		}
		assert.ok(writes > writesBefore, `${sessionId ?? "无会话"} 的判定必须回写一次状态`);
		let src = null;
		for (let i = 0; i < 40 && src === null; i += 1) {
			src = frameSrc(render());
			if (src === null) await wait(5);
		}
		return src;
	}

	function remount() {
		slots.clear();
		effectSlots.clear();
		cursor = 0;
		return render();
	}

	function reportNavigation(pathname, projectId) {
		const frameWindow = { __isTheFrameWindow: true };
		for (const handler of messageListeners) {
			handler({ source: frameWindow, data: { type: "ldvh:navigate", pathname, projectId } });
		}
	}

	async function waitForFrame(maxTicks = 80) {
		for (let i = 0; i < maxTicks; i += 1) {
			const src = frameSrc(render());
			if (src !== null) return src;
			await wait(10);
		}
		return null;
	}

	return { render, remount, waitForFrame, switchAndSettle, reportNavigation };
}

function originFetch(hostBase) {
	return (input, init) => {
		const url = String(input);
		return fetch(url.startsWith("/") ? hostBase + url : url, init);
	};
}

async function withServer(decisions, run) {
	const { server, stateCalls, delivered } = createServer(decisions);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const hostBase = `http://127.0.0.1:${server.address().port}`;
	try {
		await run({ hostBase, stateCalls, delivered });
	} finally {
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve));
	}
}

test("iframe 地址带上当前会话所属管辖项目，判定经 sessionId 取得", async () => {
	await withServer({
		"s-alpha": { ok: true, state: "governed", project: { id: "alpha", name: "Alpha" } },
	}, async ({ hostBase, stateCalls, delivered }) => {
		const sessionId = { current: "s-alpha" };
		const harness = createHarness(originFetch(hostBase), sessionId, delivered);

		assert.equal(frameSrc(harness.render()), null, "判定未回话的首帧不应渲染 iframe");

		const src = await harness.switchAndSettle(() => {}, "s-alpha");
		assert.ok(src !== null, "判定回话后必须渲染出 iframe");
		assert.ok(stateCalls.includes("s-alpha"), `管辖判定必须以 sessionId 询问：${JSON.stringify(stateCalls)}`);
		assert.match(src, /[?&]ldvhProject=alpha(&|$)/, `src 须携带会话项目参数：${src}`);
	});
});

test("同项目切会话不换页，跨项目才换", async () => {
	await withServer({
		"s-1": { ok: true, state: "governed", project: { id: "alpha", name: "Alpha" } },
		"s-2": { ok: true, state: "governed", project: { id: "alpha", name: "Alpha 另一工作树" } },
		"s-3": { ok: true, state: "governed", project: { id: "beta", name: "Beta" } },
	}, async ({ hostBase, delivered }) => {
		const sessionId = { current: "s-1" };
		const harness = createHarness(originFetch(hostBase), sessionId, delivered);
		const first = await harness.switchAndSettle(() => {}, "s-1");
		assert.ok(first !== null && /[?&]ldvhProject=alpha(&|$)/.test(first), `首个会话须落在 alpha：${first}`);

		const same = await harness.switchAndSettle(() => { sessionId.current = "s-2"; }, "s-2");
		assert.equal(same, first, "同项目切会话时 src 必须逐字不变（不重载页面）");

		const moved = await harness.switchAndSettle(() => { sessionId.current = "s-3"; }, "s-3");
		assert.ok(moved !== null && /[?&]ldvhProject=beta(&|$)/.test(moved), `跨项目须换成 beta：${moved}`);
	});
});

test("跨项目不沿用别的项目的深链接；同项目重挂时保住它", async () => {
	await withServer({
		"s-a": { ok: true, state: "governed", project: { id: "alpha", name: "Alpha" } },
		"s-b": { ok: true, state: "governed", project: { id: "beta", name: "Beta" } },
	}, async ({ hostBase, delivered }) => {
		const sessionId = { current: "s-a" };
		const harness = createHarness(originFetch(hostBase), sessionId, delivered);
		await harness.switchAndSettle(() => {}, "s-a");

		harness.reportNavigation("/ldvh/objects/spark/abc", "alpha");

		const back = frameSrc(harness.remount());
		const settledBack = back !== null ? back : await harness.waitForFrame();
		assert.ok(settledBack !== null && /objects\/spark\/abc/.test(settledBack), `同项目重挂须沿用深链接：${settledBack}`);
		assert.match(settledBack, /[?&]ldvhProject=alpha(&|$)/, `沿用深链接时项目参数须在：${settledBack}`);

		const moved = await harness.switchAndSettle(() => { sessionId.current = "s-b"; }, "s-b");
		assert.ok(moved !== null, "跨项目切换后须渲染出页面");
		assert.ok(!/objects\/spark\/abc/.test(moved), `跨项目不得沿用别的项目的深链接：${moved}`);
		assert.match(moved, /[?&]ldvhProject=beta(&|$)/, `跨项目须落在新项目并带其参数：${moved}`);
		assert.ok(/\/ldvh\/(\?|$)/.test(moved), `跨项目须回新项目首页：${moved}`);
	});
});

test("已呈现某项目后切到判不出归属的会话：保持当前呈现，不把人带走", async () => {
	await withServer({
		"s-a": { ok: true, state: "governed", project: { id: "alpha", name: "Alpha" } },
		"s-lost": { ok: true, state: "unknown", project: null },
	}, async ({ hostBase, delivered }) => {
		const sessionId = { current: "s-a" };
		const harness = createHarness(originFetch(hostBase), sessionId, delivered);
		const shown = await harness.switchAndSettle(() => {}, "s-a");
		assert.ok(shown !== null && /[?&]ldvhProject=alpha(&|$)/.test(shown), `先须落在 alpha：${shown}`);

		const kept = await harness.switchAndSettle(() => { sessionId.current = "s-lost"; }, "s-lost");
		assert.equal(kept, shown, "判定不可得时不得改变已呈现的项目（src 逐字不变＝不重载）");
	});
});

test("首个会话就判不出时照常打开，交回 Web 自身选择链", async () => {
	await withServer({
		"s-lost": { ok: true, state: "not_governed", project: null },
	}, async ({ hostBase, delivered }) => {
		const sessionId = { current: "s-lost" };
		const harness = createHarness(originFetch(hostBase), sessionId, delivered);
		const src = await harness.switchAndSettle(() => {}, "s-lost");
		assert.ok(src !== null, "首个会话判不出也须渲染出页面");
		assert.ok(!/ldvhProject=/.test(src), `首帧不得凭空带项目参数：${src}`);
	});
});

test("判不出所属项目时不带项目参数（交回 Web 自身选择链）", async () => {
	await withServer({
		"s-unknown": { ok: true, state: "unknown", project: null },
		"s-notgov": { ok: true, state: "not_governed", project: null },
		"s-unavail": { ok: false, state: "unavailable", detail: "registration unreadable" },
	}, async ({ hostBase, delivered }) => {
		for (const id of ["s-unknown", "s-notgov", "s-unavail"]) {
			const sessionId = { current: id };
			const harness = createHarness(originFetch(hostBase), sessionId, delivered);
			const src = await harness.switchAndSettle(() => {}, id);
			assert.ok(src !== null, `${id} 仍须渲染出页面，不因判定失败而空白`);
			assert.ok(!/ldvhProject=/.test(src), `${id} 判不出项目，src 不得带项目参数：${src}`);
		}
	});
});

test("管辖判定不可达时页面照常打开，不带项目参数", async () => {
	await withServer({}, async ({ hostBase, delivered }) => {
		const brokenFetch = (input, init) => {
			const url = String(input);
			if (url.includes("/ldvh/state/governance")) return Promise.reject(new Error("state route down"));
			return fetch(url.startsWith("/") ? hostBase + url : url, init);
		};
		const sessionId = { current: "s-down" };
		const harness = createHarness(brokenFetch, sessionId, delivered);
		const src = await harness.switchAndSettle(() => {}, null);
		assert.ok(src !== null, "判定端点故障不得让页面空白（跟随是增强，不是前置条件）");
		assert.ok(!/ldvhProject=/.test(src), `判定不可达时不得凭空带上项目参数：${src}`);
	});
});

test("会话标识缺失时不去问管辖判定", async () => {
	await withServer({}, async ({ hostBase, stateCalls, delivered }) => {
		const sessionId = { current: "" };
		const harness = createHarness(originFetch(hostBase), sessionId, delivered);
		const src = await harness.switchAndSettle(() => {}, null);
		assert.ok(src !== null, "无会话标识也须渲染出页面");
		assert.ok(!/ldvhProject=/.test(src), `无会话标识不得带项目参数：${src}`);
		assert.deepEqual(stateCalls, [], "sessionId 为空不得请求管辖判定端点");
	});
});

test("health 迟到也能让桌面 iframe 落在真实端口，不永久停在 3299", async () => {
	const delivered = new Map();
	let webPort = 0;
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, "http://127.0.0.1");
		if (url.pathname === "/ldvh/api/health") {
			setTimeout(() => {
				res.setHeader("content-type", "application/json; charset=utf-8");
				res.end(JSON.stringify({ ok: true, service: "dsh-ldvh", status: "ok", prefix: "/ldvh/api", webPort }));
			}, 120);
			return;
		}
		if (url.pathname === "/ldvh/state/governance") {
			const sessionId = url.searchParams.get("sessionId") ?? "";
			delivered.set(sessionId, (delivered.get(sessionId) ?? 0) + 1);
			res.setHeader("content-type", "application/json; charset=utf-8");
			res.end(JSON.stringify({ ok: true, state: "governed", project: { id: "alpha", name: "Alpha" } }));
			return;
		}
		res.setHeader("content-type", "text/html");
		res.end("<html>ok</html>");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	webPort = server.address().port;
	const hostBase = `http://127.0.0.1:${webPort}`;
	try {
		assert.notEqual(webPort, 3299, "夹具端口须不同于默认 3299，才能验出端口回落");
		const sessionId = { current: "s-late" };
		const harness = createHarness(originFetch(hostBase), sessionId, delivered);
		const src = await harness.switchAndSettle(() => {}, "s-late");
		assert.ok(src !== null, "迟到的 health 也不该让 iframe 空白");
		assert.ok(src.includes(`127.0.0.1:${webPort}/`), `src 须落在 health 回报的真实端口，不得停在 3299：${src}`);
		assert.ok(!src.includes("127.0.0.1:3299/"), `src 不得残留默认 3299：${src}`);
	} finally {
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve));
	}
});

test("health 先报端口 0 后给真实端口：重试链耗尽前能拿到，不缓存失败态", async () => {
	const delivered = new Map();
	let webPort = 0;
	const startedAt = Date.now();
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, "http://127.0.0.1");
		if (url.pathname === "/ldvh/api/health") {
			const reported = Date.now() - startedAt < 500 ? 0 : webPort;
			res.setHeader("content-type", "application/json; charset=utf-8");
			res.end(JSON.stringify({ ok: true, service: "dsh-ldvh", status: "ok", prefix: "/ldvh/api", webPort: reported }));
			return;
		}
		if (url.pathname === "/ldvh/state/governance") {
			const sessionId = url.searchParams.get("sessionId") ?? "";
			delivered.set(sessionId, (delivered.get(sessionId) ?? 0) + 1);
			res.setHeader("content-type", "application/json; charset=utf-8");
			res.end(JSON.stringify({ ok: true, state: "governed", project: { id: "alpha", name: "Alpha" } }));
			return;
		}
		res.setHeader("content-type", "text/html");
		res.end("<html>ok</html>");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	webPort = server.address().port;
	const hostBase = `http://127.0.0.1:${webPort}`;
	try {
		const sessionId = { current: "s-zero" };
		const harness = createHarness(originFetch(hostBase), sessionId, delivered);
		const src = await harness.switchAndSettle(() => {}, "s-zero", 600);
		assert.ok(src !== null, "端口 0 窗口过后仍须渲染出 iframe");
		assert.ok(src.includes(`127.0.0.1:${webPort}/`), `重试链须在耗尽前拿到真实端口，不得停在默认：${src}`);
	} finally {
		server.closeAllConnections?.();
		await new Promise((resolve) => server.close(resolve));
	}
});
