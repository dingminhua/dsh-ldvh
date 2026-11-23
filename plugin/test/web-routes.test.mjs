import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { parse as parseYaml } from "yaml";
import * as ldvhPlugin from "../lib/index.js";
import { withTemp } from "./helpers.mjs";

async function removeTreeWithRetry(target, attempts = 10) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			await rm(target, { recursive: true, force: true });
			return;
		} catch (error) {
			const retryable = error?.code === "EBUSY" || error?.code === "EPERM" || error?.code === "ENOTEMPTY";
			if (!retryable || attempt >= attempts) throw error;
			await new Promise((done) => setTimeout(done, 50 * attempt));
		}
	}
}

class MemoryWebServer {
	constructor() {
		this.registered = [];
	}

	register(route) {
		const entry = { ...route, removed: false };
		this.registered.push(entry);
		return () => { entry.removed = true; };
	}

	routes(kind) {
		return this.registered.filter((entry) => !entry.removed && (kind === void 0 || entry.kind === kind));
	}
}

class MemoryTools {
	constructor() {
		this.registered = [];
	}

	register(definition) {
		const entry = { ...definition, removed: false };
		this.registered.push(entry);
		return () => { entry.removed = true; };
	}

	live() {
		return this.registered.filter((entry) => !entry.removed);
	}
}

class MemorySystemPrompt {
	constructor() {
		this.sections = [];
	}

	section(section) {
		const entry = { ...section, removed: false };
		this.sections.push(entry);
		return () => { entry.removed = true; };
	}

	live() {
		return this.sections.filter((entry) => !entry.removed);
	}
}

class MemoryConnection {
	constructor(behavior = {}) {
		this.behavior = behavior;
		this.seen = [];
	}

	requestRejection(req) {
		this.seen.push(req);
		if (typeof this.behavior.rejection === "function") return this.behavior.rejection(req);
		return this.behavior.rejection ?? undefined;
	}
}

async function createHarness(config = {}, { withWebServer = true, deferWebServer = false, dshHomePath, connection = {} } = {}) {
	const root = new Context();
	const webServer = withWebServer ? new MemoryWebServer() : void 0;
	if (webServer !== void 0 && !deferWebServer) root.provide("webServer", webServer);
	if (dshHomePath !== void 0) root.provide("dshHomePath", dshHomePath);
	const memoryConnection = new MemoryConnection(connection);
	root.provide("connection", memoryConnection);
	const tools = new MemoryTools();
	root.provide("tools", tools);
	const systemPrompt = new MemorySystemPrompt();
	root.provide("systemPrompt", systemPrompt);

	await root[Symbol.for("cordis.init")]?.();

	const fiber = root.registry.plugin(ldvhPlugin, config);
	await fiber;

	return { root, webServer, tools, systemPrompt, memoryConnection, fiber };
}

async function disposeHarness(harness) {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}

const enabledDocument = { webEnabled: true };
const disabledDocument = { webEnabled: false };

const WEB_ROUTE_COUNT = 2;
const STATE_ROUTE_COUNT = 1;
const TOTAL_ROUTE_COUNT = WEB_ROUTE_COUNT + STATE_ROUTE_COUNT;

test("registers both prefix routes when webServer exists and web is enabled by default", async () => {
	const harness = await createHarness();
	try {
		const apiRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh/api");
		const spaRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh");
		assert.equal(apiRoutes.length, 1, "expected exactly one /ldvh/api route");
		assert.equal(spaRoutes.length, 1, "expected exactly one /ldvh route");
	} finally {
		await disposeHarness(harness);
	}
});

test("registers routes when web is explicitly enabled", async () => {
	const harness = await createHarness(enabledDocument);
	try {
		assert.equal(harness.webServer.routes("prefix").length, TOTAL_ROUTE_COUNT);
	} finally {
		await disposeHarness(harness);
	}
});

test("webEnabled false: routes stay registered but answer 404; the state route is unaffected", async () => {
	const harness = await createHarness(disabledDocument);
	try {
		const apiRoute = harness.webServer.routes("prefix").find((r) => r.path === "/ldvh/api");
		const spaRoute = harness.webServer.routes("prefix").find((r) => r.path === "/ldvh");
		assert.ok(apiRoute, "expected the /ldvh/api route to stay registered");
		assert.ok(spaRoute, "expected the /ldvh route to stay registered");

		for (const path of ["/ldvh/api", "/ldvh"]) {
			const res = await callRoute(harness.webServer, path, undefined);
			assert.equal(res.status, 404, `expected 404 from ${path} while web is disabled`);
			assert.equal(res.body?.error?.code, "LDVH_WEB_DISABLED", `expected a gating reason from ${path}`);
		}

		const stateRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh/state");
		assert.equal(stateRoutes.length, STATE_ROUTE_COUNT, "governance-state route must stay mounted regardless of the web switch");
		assert.equal(harness.webServer.routes("prefix").length, TOTAL_ROUTE_COUNT);
	} finally {
		await disposeHarness(harness);
	}
});

test("trust fence short-circuits /ldvh/api with the connection rejection status before any handler work", async () => {
	const harness = await createHarness({}, { connection: { rejection: 401 } });
	try {
		const result = await callRoute(harness.webServer, "/ldvh/api/health");
		assert.equal(result.status, 401, "the connection trust fence must win before the health shortcut, governance, or the proxy");
		assert.equal(harness.memoryConnection.seen.length, 1, "requestRejection must be consulted exactly once per request");
	} finally {
		await disposeHarness(harness);
	}
});

test("trust fence short-circuits /ldvh/state with 403 and admits the state route when the connection returns undefined", async () => {
	const rejectedHarness = await createHarness({}, { connection: { rejection: 403 } });
	try {
		const result = await callRoute(rejectedHarness.webServer, "/ldvh/state/governance", "?sessionId=anything");
		assert.equal(result.status, 403, "the state route must honour the connection rejection status");
	} finally {
		await disposeHarness(rejectedHarness);
	}
	const admittedHarness = await createHarness({}, { connection: { rejection: undefined } });
	try {
		const result = await callRoute(admittedHarness.webServer, "/ldvh/state/governance", "?sessionId=not-a-known-session");
		assert.equal(result.status, 200);
		assert.equal(result.body.state, "unknown", "an admitted request must reach the normal handler flow");
	} finally {
		await disposeHarness(admittedHarness);
	}
});

test("stays inactive when the host webServer is absent (no apply, no claim, no crash)", async () => {
	const harness = await createHarness({}, { deferWebServer: true });
	try {
		assert.equal(harness.root.get("webServer"), void 0, "webServer service must not be provided");
		assert.equal(harness.webServer.routes("prefix").length, 0, "no route must be claimed while the plugin stays inactive");
	} finally {
		await disposeHarness(harness);
	}
});

test("registers both routes when webServer is provided after the plugin mounts (inject race regression)", async () => {
	const harness = await createHarness({}, { deferWebServer: true });
	try {
		assert.equal(harness.webServer.routes("prefix").length, 0, "no routes before webServer is provided");

		harness.root.provide("webServer", harness.webServer);

		await waitForRoutes(harness.webServer, TOTAL_ROUTE_COUNT);

		const apiRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh/api");
		const spaRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh");
		assert.equal(apiRoutes.length, 1, "expected exactly one /ldvh/api route");
		assert.equal(spaRoutes.length, 1, "expected exactly one /ldvh route");
	} finally {
		await disposeHarness(harness);
	}
});

async function waitForRoutes(webServer, expectedCount, timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (webServer.routes("prefix").length === expectedCount) return;
		if (Date.now() >= deadline) {
			assert.fail(`expected ${expectedCount} prefix routes within ${timeoutMs}ms; got ${webServer.routes("prefix").length}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test("webEnabled true: gated routes let requests through to their handlers", async () => {
	const harness = await createHarness(enabledDocument);
	try {
		assert.equal(harness.webServer.routes("prefix").length, TOTAL_ROUTE_COUNT);

		const res = await callRoute(harness.webServer, "/ldvh/api/__no_such_endpoint__", undefined);
		assert.notEqual(res.body?.error?.code, "LDVH_WEB_DISABLED", "enabled switch must let the request reach the handler");

	} finally {
		await disposeHarness(harness);
	}
});

test("disposal removes every registered route", async () => {
	const harness = await createHarness(enabledDocument);
	assert.equal(harness.webServer.routes("prefix").length, TOTAL_ROUTE_COUNT);
	await harness.fiber.dispose();
	assert.equal(harness.webServer.routes("prefix").length, 0, "expected all routes removed after plugin disposal (state route included)");
	await harness.root.fiber.dispose();
});

test("supports a clean remount", async () => {
	const harness = await createHarness(enabledDocument);
	try {
		await harness.fiber.dispose();
		assert.equal(harness.webServer.routes("prefix").length, 0);

		const remounted = harness.root.registry.plugin(ldvhPlugin);
		await remounted;
		assert.equal(harness.webServer.routes("prefix").length, TOTAL_ROUTE_COUNT, "expected routes after clean remount");
		await remounted.dispose();
	} finally {
		await harness.root.fiber.dispose();
	}
});

async function waitForCarrier(filePath, timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			return await readFile(filePath, "utf8");
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
		if (Date.now() >= deadline) {
			assert.fail(`registration carrier ${filePath} did not appear within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
}

test("apply() ensures the empty registration carrier when dshHomePath is available", async () => {
	await withTemp("dsh-ldvh-web-routes-", async (tempRoot) => {
		const dshHomePath = (...segments) => join(tempRoot, ...segments);
		const harness = await createHarness({}, { dshHomePath });
		try {
			const carrierPath = join(tempRoot, "ldvh", "governed-projects.yaml");
			const content = await waitForCarrier(carrierPath);
			const document = parseYaml(content);
			assert.equal(document.schema_version, 1, "freshly created carrier must declare schema_version 1");
			assert.deepEqual(document.projects, [], "freshly created carrier must register no projects");
		} finally {
			await disposeHarness(harness);
		}
	});
});

async function callRoute(webServer, path, query) {
	const route = webServer.routes("prefix").find((r) => path.startsWith(r.path));
	assert.ok(route !== undefined, `no registered prefix route serves ${path}`);
	const url = new URL(path + (query === undefined ? "" : query), "http://ldvh.local");
	const chunks = [];
	const res = {
		statusCode: 0,
		headers: {},
		setHeader(name, value) { this.headers[name] = value; },
		end(text) { if (text !== undefined) chunks.push(String(text)); }
	};
	await route.handler({ url: url.toString(), method: "GET" }, res);
	return { status: res.statusCode, body: chunks.length === 0 ? null : JSON.parse(chunks.join("")) };
}


test("state endpoint answers unknown for an untracked sessionId (fail-closed, never guessed)", async () => {
	const harness = await createHarness();
	try {
		const result = await callRoute(harness.webServer, "/ldvh/state/governance", "?sessionId=not-a-known-session");
		assert.equal(result.status, 200);
		assert.equal(result.body.state, "unknown", "an untracked session must not be guessed as governed or not_governed");
		assert.equal(result.body.project, null);
	} finally {
		await disposeHarness(harness);
	}
});

test("state endpoint rejects a request with neither sessionId nor cwd", async () => {
	const harness = await createHarness();
	try {
		const result = await callRoute(harness.webServer, "/ldvh/state/governance", "");
		assert.equal(result.status, 400);
		assert.equal(result.body.ok, false);
	} finally {
		await disposeHarness(harness);
	}
});

test("state endpoint resolves a cwd directly against the real registration", async () => {
	const tempRoot = await mkdtemp(join(tmpdir(), "dsh-ldvh-state-"));
	const dshHomePath = (...segments) => join(tempRoot, ...segments);
	try {
		await mkdir(join(tempRoot, "ldvh"), { recursive: true });
		await writeFile(
			join(tempRoot, "ldvh", "governed-projects.yaml"),
			[
				"schema_version: 1",
				"governance_instance_name: t",
				"product_description: t",
				"projects:",
				"  - id: probe-project",
				`    path: ${tempRoot}`,
				"    name: probe-project",
				"default_project_id: probe-project",
				""
			].join("\n"),
			"utf8"
		);
		const harness = await createHarness({}, { dshHomePath });
		try {
			const governed = await callRoute(harness.webServer, "/ldvh/state/governance", "?cwd=" + encodeURIComponent(tempRoot));
			assert.equal(governed.body.state, "governed");
			assert.equal(governed.body.project.name, "probe-project");

			const outside = await callRoute(harness.webServer, "/ldvh/state/governance", "?cwd=" + encodeURIComponent(join(tempRoot, "..")));
			assert.equal(outside.body.state, "not_governed");
			assert.equal(outside.body.project, null);
		} finally {
			await disposeHarness(harness);
		}
	} finally {
		await removeTreeWithRetry(tempRoot);
	}
});
