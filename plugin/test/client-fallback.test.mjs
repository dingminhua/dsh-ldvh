import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

/** 最小 React 替身：够 client.js 加载，不驱动任何交互。 */
function createReactStub() {
	return {
		createElement() { return null; },
		useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
		useEffect() {},
		useRef(value) { return { current: value }; },
	};
}

/**
 * 在 vm 里跑 client.js 的真实工厂并**真正执行**它的探活。
 *
 * checkHealth 是闭包私有的，宿主拿不到——但 sidebar tab 组件一挂载就调它。
 * 这里的 React 替身让 useEffect 立即执行、createElement 遇函数就调用，于是渲染
 * LdvhSidebarTab 会真实地跑一遍 checkHealth，结论通过捕获的状态回调取回。
 * 断言因此落在**客户端自己的结论**上，而不是替身自己算的连通性。
 *
 * useState 的槽位按调用序号分配：client.js 里有多个组件各持 state，替身若共用
 * 一个槽会互相覆盖，读到的就不是被测组件的结论了。
 */
function runClientProbe(fetchImpl, options = {}) {
	const observed = [];
	const slots = new Map();
	let nextSlot = 0;
	const reactStub = {
		createElement(type, props) {
			// 函数型 type 是组件：执行它，探活才真的发生。
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
	// options.location 注入 window.location——模拟浏览器主文档（http/https 源）。
	// 缺省（含既有用例）无 location：client.js 的 webFrameOrigin 走无 location
	// 守卫分支，行为等同 dsh-app 桌面场景（回环直连），既有断言不受影响。
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
	// 真实注册路径：ctx.inject(["betterSidebar"]) → scope.effect → registerTab
	// → component()（lib/client.js 的 registerSidebarTab）。任一环缺失都会让探活
	// 不发生，下面的断言因此会失败而不是被静默跳过。
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
	// 视图状态是 {checking, ready, failed} 三元组——只取这一类写入，其它组件的
	// state 更新不参与断言。
	return { conclusions: () => observed.map((entry) => entry.value).filter((v) => v && typeof v === "object" && "ready" in v && "failed" in v) };
}

test("client probe reports unavailable when the iframe origin is dead, even though the host route answers", async () => {
	// 回归（工单 c6d88dac，计划步骤 3）：原实现探活用相对路径 /ldvh/api/health，
	// 命中**宿主**路由——宿主自己能答 200，于是子进程已死时探活仍报「可用」，
	// 而 iframe 实连的回环地址是空的。这里让二者真实分歧，断言客户端结论。
	//
	// ① 占一个端口再关掉：iframe 要连的那个地址无人监听（子进程已死）。
	const grave = http.createServer(() => {});
	await new Promise((resolve) => grave.listen(0, "127.0.0.1", resolve));
	const deadPort = grave.address().port;
	await new Promise((resolve) => grave.close(resolve));

	// ② 宿主路由：永远「健康」——这正是缺陷③的成因。
	const hostCalls = [];
	const host = http.createServer((req, res) => {
		hostCalls.push(req.url);
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ ok: true, service: "dsh-ldvh", status: "ok", prefix: "/ldvh/api", webPort: deadPort }));
	});
	await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
	const hostBase = `http://127.0.0.1:${host.address().port}`;

	// 复刻真实分路：相对路径 → 宿主主框架转发链；绝对回环 → iframe 真正要连的子进程。
	const fetchImpl = (input, init) => {
		const url = String(input);
		if (url.startsWith("/")) return fetch(hostBase + url, init);
		return fetch(url, init);
	};

	const { conclusions } = runClientProbe(fetchImpl);
	// 探活是异步的：等它把结论写进 state。
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
	// 另一侧：子进程活着时探活须报「可用」——口径对齐不能只朝「不可用」偏。
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
	// 探活 URL 与 iframe 地址同源同端口：绝对回环 + 该端口 + /ldvh/。
	assert.ok(
		loopbackPaths.some((url) => url === `http://127.0.0.1:${childPort}/ldvh/`),
		`probe must hit the iframe's own origin: ${JSON.stringify(loopbackPaths)}`,
	);
});

test("browser-origin documents probe the current origin and accept the host-route health shape", async () => {
	// 2026-10-17 缺陷的行为侧守护（远程访问时管辖项目列表错位）：主文档源为
	// http(s)（浏览器访问，含局域网远程）时，iframe 与探活都必须指向当前
	// origin（宿主 /ldvh 路由）——浏览器里的 127.0.0.1 是**访问设备自己**，
	// 回环直连会读到访问设备本机的登记数据或直接打不开。
	// 健康判据还须接受宿主路由的 { ok, status } 应答形状（宿主 /ldvh/api/health
	// 优先命中插件本地路由，无 success 字段），否则探活恒判 unhealthy。
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
	// 所有绝对地址探活都须落在当前 origin 上——出现子进程直连地址即为缺陷复发。
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
	// 钉住「探活 URL 与 iframe 地址同源同端口」这条判据：探活必须由 ldvhWebOrigin
	// 拼出，不得退回相对路径 /ldvh/api/health（那是宿主路由，报的是宿主健康）。
	assert.ok(
		/function probeLoopback\(path, then\)[\s\S]{0,400}fetch\(ldvhWebOrigin \+ path/.test(source),
		"probe must fetch the loopback origin the iframe uses",
	);
	// 就绪门 = 页面可达 **且** 健康端点自报 success（独立复核指出：只判 resolve
	// 会把 500/503/端口被占一律误报可用）。
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
	// 端口发现仍走宿主（唯一能拿到 webPort 的通道），但它不再充当就绪结论。
	assert.ok(
		/fetch\("\/ldvh\/api\/health", \{ method: "GET", cache: "no-store" \}\)/.test(source),
		"webPort discovery must keep using the host route",
	);
	// 跨源直连用不透明响应：cors 拒绝也 resolve，故连通性结论不受白名单影响。
	assert.ok(/mode: "no-cors"/.test(source), "the loopback probe must tolerate the cors boundary");
});

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
