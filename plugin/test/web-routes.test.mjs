import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { SettingsProvider } from "@deepseek-ai/dsh-settings";
import { parse as parseYaml } from "yaml";
import * as ldvhPlugin from "../lib/index.js";
import { withTemp } from "./helpers.mjs";

class MemorySettings extends SettingsProvider {
	constructor(ctx, document) {
		super(ctx, "settings");
		this.document = document;
	}

	async load() {
		return this.document;
	}

	get writable() {
		return false;
	}
}

/**
 * A minimal in-memory webServer stub: records every register() call so the
 * test can assert route registration / disposal without a real HTTP server.
 */
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

/**
 * Minimal tools-registry stub: records register() calls and hands back
 * disposers, so tests can assert the LDVH tool batch lifecycle without a
 * real dsh-tools service.
 */
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

/**
 * Minimal systemPrompt stub: records section() registrations and their
 * disposers, mirroring the dsh-system-prompt ScopedLayers lifecycle.
 */
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

async function createHarness(document = {}, { withWebServer = true, deferWebServer = false, dshHomePath } = {}) {
	const root = new Context();
	// deferWebServer keeps the MemoryWebServer instance in the harness but
	// withholds the `provide` call: the plugin mounts while webServer is
	// absent, reproducing the real-host ordering where the service comes up
	// only after the plugin fiber already exists.
	const webServer = withWebServer ? new MemoryWebServer() : void 0;
	if (webServer !== void 0 && !deferWebServer) root.provide("webServer", webServer);
	if (dshHomePath !== void 0) root.provide("dshHomePath", dshHomePath);
	// The plugin also injects the P0 AI-facing services; provide recording
	// stubs so its fiber activates in tests exactly like on the real host.
	const tools = new MemoryTools();
	root.provide("tools", tools);
	const systemPrompt = new MemorySystemPrompt();
	root.provide("systemPrompt", systemPrompt);

	const settings = new MemorySettings(root, document);
	await settings.load().then((loaded) => settings.publish(loaded));
	await root[Symbol.for("cordis.init")]?.();

	const fiber = root.registry.plugin(ldvhPlugin);
	await fiber;

	return { root, settings, webServer, tools, systemPrompt, fiber };
}

async function disposeHarness(harness) {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}

const enabledDocument = {
	"dsh-ldvh": { webEnabled: true }
};
const disabledDocument = {
	"dsh-ldvh": { webEnabled: false }
};

/**
 * Route inventory under the current contract:
 *   - 2 web routes (/ldvh/api + /ldvh), gated on the `webEnabled` setting.
 *   - 1 always-on governance-state route (/ldvh/state) for the Client
 *     indicator: it must survive the Web switch, because "is this session
 *     governed?" is a governance signal, not a Web-panel feature.
 */
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

test("does not register web routes when webEnabled is false, but the state route stays mounted", async () => {
	const harness = await createHarness(disabledDocument);
	try {
		// The web routes are unmounted by the switch...
		const apiRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh/api");
		const spaRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh");
		assert.equal(apiRoutes.length, 0, "expected no /ldvh/api route while web is disabled");
		assert.equal(spaRoutes.length, 0, "expected no /ldvh route while web is disabled");
		// ...but the governance-state route must survive: the indicator is a
		// governance signal and must not depend on the Web-presentation switch.
		const stateRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh/state");
		assert.equal(stateRoutes.length, STATE_ROUTE_COUNT, "governance-state route must stay mounted regardless of the web switch");
		assert.equal(harness.webServer.routes("prefix").length, STATE_ROUTE_COUNT);
	} finally {
		await disposeHarness(harness);
	}
});

test("stays inactive when the host webServer is absent (no apply, no claim, no crash)", async () => {
	// New semantics: the plugin declares `inject: ["webServer"]`, so without
	// the service its fiber stays INACTIVE and apply() never runs. The harness
	// keeps a MemoryWebServer instance (deferWebServer) but never provides it —
	// a headless composition. `await fiber` on an INACTIVE fiber settles
	// immediately (it does not hang), no route is claimed, and nothing crashes.
	const harness = await createHarness({}, { deferWebServer: true });
	try {
		assert.equal(harness.root.get("webServer"), void 0, "webServer service must not be provided");
		assert.equal(harness.webServer.routes("prefix").length, 0, "no route must be claimed while the plugin stays inactive");
	} finally {
		await disposeHarness(harness);
	}
});

test("registers both routes when webServer is provided after the plugin mounts (inject race regression)", async () => {
	// Regression for the injection timing bug: the plugin used to snapshot
	// ctx.get("webServer") during apply, so mounting before the host webServer
	// service came up froze the value as undefined and silently skipped route
	// registration forever. With `inject: ["webServer"]` the fiber stays
	// INACTIVE until the service appears; providing it afterwards must notify →
	// reload → re-run apply() and register both routes.
	const harness = await createHarness({}, { deferWebServer: true });
	try {
		// Mounted before webServer existed: nothing claimed yet.
		assert.equal(harness.webServer.routes("prefix").length, 0, "no routes before webServer is provided");

		// The host now brings the webServer service up.
		harness.root.provide("webServer", harness.webServer);

		// The notify → reload → apply chain settles asynchronously; poll.
		await waitForRoutes(harness.webServer, TOTAL_ROUTE_COUNT);

		const apiRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh/api");
		const spaRoutes = harness.webServer.routes("prefix").filter((r) => r.path === "/ldvh");
		assert.equal(apiRoutes.length, 1, "expected exactly one /ldvh/api route");
		assert.equal(spaRoutes.length, 1, "expected exactly one /ldvh route");
	} finally {
		await disposeHarness(harness);
	}
});

/**
 * Poll until the given webServer records the expected number of live prefix
 * routes (used when activation settles asynchronously after a service is
 * provided post-mount). Fails the test on timeout.
 */
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

test("publishing webEnabled false unregisters routes; true re-registers them", async () => {
	const harness = await createHarness(enabledDocument);
	try {
		assert.equal(harness.webServer.routes("prefix").length, TOTAL_ROUTE_COUNT);

		// Turn the web switch off: the web routes must be removed, but the
		// governance-state route must remain mounted.
		harness.settings.publish(disabledDocument);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(harness.webServer.routes("prefix").length, STATE_ROUTE_COUNT, "expected web routes removed, state route kept");

		// Turn it back on: the web routes must return.
		harness.settings.publish(enabledDocument);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(harness.webServer.routes("prefix").length, TOTAL_ROUTE_COUNT, "expected routes restored after re-enabling");
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

/**
 * Poll for a file to appear (the plugin's startup carrier chain is
 * fire-and-forget, so the write is not awaited by apply()).
 * Returns the file content once readable; fails the test on timeout.
 */
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

/**
 * Drive one registered prefix handler in memory and return { status, body }.
 * The harness records handlers rather than serving HTTP, so tests call them
 * directly with a minimal req/res pair.
 */
async function callRoute(webServer, path, query) {
	const route = webServer.routes("prefix").find((r) => path.startsWith(r.path));
	assert.ok(route !== undefined, `no registered prefix route serves ${path}`);
	const url = new URL(path + (query === undefined ? "" : query), "http://ldvh.local");
	const chunks = [];
	const res = {
		statusCode: 0,
		headers: {},
		setHeader(name, value) { this.headers[name] = value; },
		end(text) { chunks.push(String(text)); }
	};
	await route.handler({ url: url.toString(), method: "GET" }, res);
	return { status: res.statusCode, body: chunks.length === 0 ? null : JSON.parse(chunks.join("")) };
}

// ---------------------------------------------------------------------------
// /ldvh/state/governance endpoint behaviour
// ---------------------------------------------------------------------------

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
		await rm(tempRoot, { recursive: true, force: true });
	}
});
