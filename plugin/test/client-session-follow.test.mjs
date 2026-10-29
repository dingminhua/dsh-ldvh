import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

/**
 * 会话跟随（07 §7，Human 裁定 2026-10-29）的行为守护。
 *
 * 承 client-fallback.test.mjs 的做法：在 vm 里**真实执行** client.js 的工厂与
 * LdvhSidebarTab，断言打在渲染出的 iframe `src` 上，而不是源码片段上。
 *
 * 替身比那份用例多做三件事，三件都是本组判据的前提：
 *  ① **槽位按渲染归零并跨渲染保留**——「同项目不换页」的实现机制是 useState 的
 *     更新函数在项目相同时返回原对象，React 据此不重渲染、src 逐字不变；替身若
 *     每次渲染丢状态，这条判据永远测不到。
 *  ② **useEffect 比对依赖数组并执行 cleanup**——真实 React 在 sessionId 变化时
 *     先跑上一轮的 cleanup（组件里正是 `cancelled = true`），迟到的旧判定因此
 *     不会覆盖新会话。替身若不比对依赖，每帧都会重发判定，旧响应可能晚到并写回
 *     旧项目，测出来的就是替身自己的竞态而不是被测代码的行为。
 *  ③ **记录每次状态写入**——切换后不能靠「src 稳了几帧」收敛：判定未回话时旧
 *     src 本来就稳定，按稳定性读会取到上一个项目的地址。这里以「该会话的判定
 *     已被应答 + 应答之后发生过一次写入」为闸。
 */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 一个端口同时充当宿主路由、iframe 目标与管辖判定端点：
 *   /ldvh/api/health       → 宿主健康应答（webPort 指向自身）
 *   /ldvh/state/governance → 按 sessionId 答管辖判定
 *   其余                    → 页面/探活的 200 应答
 */
function createServer(decisions) {
	const stateCalls = [];
	const delivered = new Map(); // sessionId -> 已应答次数
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
			// 未登记的会话如实答 unknown——与真实端点对未知 sessionId 的 fail-closed 同形。
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

/** 取渲染结果里 iframe 的 src；无 iframe（加载中/失败态）回 null。 */
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
		if (a === undefined || b === undefined) return false; // 未给依赖：每帧都算变化（对齐 React 的省略形态）
		if (a.length !== b.length) return false;
		return a.every((value, index) => Object.is(value, b[index]));
	};

	const reactStub = {
		createElement(type, props, ...children) {
			// 函数型 type 是组件：执行它，判定与探活才真的发生。
			if (typeof type === "function") return type(props || {});
			// children 是第 3+ 个实参，须收进 props.children——否则 iframe 作为包裹
			// div 的子节点在这棵节点树里整个消失，frameSrc 恒回 null。
			const merged = { ...(props || {}) };
			if (children.length > 0) merged.children = children.length === 1 ? children[0] : children;
			return { type, props: merged };
		},
		useState(initial) {
			const slot = cursor;
			cursor += 1;
			if (!slots.has(slot)) slots.set(slot, typeof initial === "function" ? initial() : initial);
			return [slots.get(slot), (next) => {
				writes += 1; // 更新函数被**调用**即计一次，不论返回值是否变化
				slots.set(slot, typeof next === "function" ? next(slots.get(slot)) : next);
			}];
		},
		useEffect(fn, deps) {
			const slot = cursor;
			cursor += 1;
			const previous = effectSlots.get(slot);
			if (previous && sameDeps(previous.deps, deps)) return; // 依赖未变：不重跑（真实 React 语义）
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
	// 位置记忆的 postMessage 通道：client.js 在装载期注册 window 的 message 监听
	// （无 addEventListener 时它按「测试环境」守卫跳过）。这里把它接出来，用例
	// 才能模拟 Web 侧上报「我停在 /ldvh/objects/spark/<uid>，属于 alpha」。
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
	}, { filename: "client.js" });

	// 真实注册路径：plugin.apply → ctx.inject(["betterSidebar"]) → scope.effect
	// → registerTab → component()。任一环缺失都会让 tabComponent 为 null，
	// render 因此抛错而不是静默跳过。
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
		cursor = 0; // 同一次渲染内按调用序分配槽位，跨渲染复用（真实 React 的语义）
		return tabComponent({ scope: { sessionId: sessionIdRef.current } });
	}

	/**
	 * 把宿主切会话的动作交给 run()（通常改 sessionIdRef.current），然后等**该会话**
	 * 的判定被应答、且应答之后确实发生过一次状态写入，再返回该帧 iframe 的 src。
	 *
	 * 等待的每一拍都必须**先渲染**：判定是在组件的 useEffect 里发出的，而替身只在
	 * render() 里执行 effect。先等后渲染会让首帧从未发生、判定从未被询问。
	 */
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

	/** 模拟宿主卸载并重挂该 tab 的组件：组件 state 归零，模块级记忆保留。 */
	function remount() {
		slots.clear();
		effectSlots.clear();
		cursor = 0;
		return render();
	}

	/** 模拟 Web 侧上报停留位置（postMessage）；source 须不是 window 本身。 */
	function reportNavigation(pathname, projectId) {
		const frameWindow = { __isTheFrameWindow: true };
		for (const handler of messageListeners) {
			handler({ source: frameWindow, data: { type: "ldvh:navigate", pathname, projectId } });
		}
	}

	/** 只渲染不切换：等 iframe 出现（判定与探活都是异步的）。 */
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
	// 复刻真实分路：相对路径走宿主主框架转发链，绝对地址是 iframe 真正要连的 origin。
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

		// 判定未回话的首帧不得渲染 iframe：先以「无项目」地址加载、回话后再整页
		// 重载，等于每开一次白闪一次——正是本段要消掉的抖动。
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

		// 同项目的另一会话：src 必须**逐字不变**。换 src 就是让 iframe 重新载入
		// 文档，正在阅读的详情随之丢失（Human 裁定「仅项目变化才换页」）。
		const same = await harness.switchAndSettle(() => { sessionId.current = "s-2"; }, "s-2");
		assert.equal(same, first, "同项目切会话时 src 必须逐字不变（不重载页面）");

		// 跨项目才允许换，且换成新项目的参数。
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

		// 用户在 alpha 里点开某个对象：Web 侧上报深链接**及其归属项目**。
		harness.reportNavigation("/ldvh/objects/spark/abc", "alpha");

		// 同会话**重挂**（切 tab 再切回，组件 state 归零、模块记忆保留）：既有的
		// 位置记忆特性必须原样保住。用 render 是测不到这点的——src 只在判定回话
		// 那一刻拼一次并存进 state，无关重渲染故意为之不动它（否则页内导航后一次
		// 重渲染就会重载文档）；重挂才会重新走一遍判定与拼装。
		const back = frameSrc(harness.remount());
		const settledBack = back !== null ? back : await harness.waitForFrame();
		assert.ok(settledBack !== null && /objects\/spark\/abc/.test(settledBack), `同项目重挂须沿用深链接：${settledBack}`);
		assert.match(settledBack, /[?&]ldvhProject=alpha(&|$)/, `沿用深链接时项目参数须在：${settledBack}`);

		// 切到别的项目的会话：带着 alpha 的对象路径开 beta 只会是「对象不存在」，
		// 故必须落回 beta 首页——这是「跟随」不等于「盲沿用旧地址」的分界。
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

		// 切到一个判不出归属的会话（未管辖、判定未完成、入口不可达都算）。
		// 此时若按「无项目」重拼地址，src 会**丢掉项目参数**——iframe 随之重载，
		// Web 回落到自身选择链（记忆里的项目），呈现的可能是第三个项目。那等于
		// 被一次判不出把人从当前项目带走，违反 §8「跟随判据不可得」行的
		// 「保持 Web 自身既有项目选择与当前呈现」。故 src 必须逐字不变。
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
		// 「保持当前呈现」的前提是**已有**呈现；首帧无呈现可保持，故不带参数，
		// 由 Web 用自身选择链决定——这条与上一条共同界定同一句规范的两种形态。
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
		// 只打断判定端点：其余（宿主 health、/ldvh/ 页面）照常应答。
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
