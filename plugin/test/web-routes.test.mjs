import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
		assert.equal(harness.webServer.routes("prefix").length, 2);
	} finally {
		await disposeHarness(harness);
	}
});

test("does not register routes when webEnabled is false", async () => {
	const harness = await createHarness(disabledDocument);
	try {
		assert.equal(harness.webServer.routes("prefix").length, 0);
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
		await waitForRoutes(harness.webServer, 2);

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
		assert.equal(harness.webServer.routes("prefix").length, 2);

		// Turn the web switch off: routes must be removed (service "stopped").
		// The settings watcher chain is asynchronous, so yield a macrotask.
		harness.settings.publish(disabledDocument);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(harness.webServer.routes("prefix").length, 0, "expected routes removed after disabling");

		// Turn it back on: routes must return (service "restarted").
		harness.settings.publish(enabledDocument);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(harness.webServer.routes("prefix").length, 2, "expected routes restored after re-enabling");
	} finally {
		await disposeHarness(harness);
	}
});

test("disposal removes every registered route", async () => {
	const harness = await createHarness(enabledDocument);
	assert.equal(harness.webServer.routes("prefix").length, 2);
	await harness.fiber.dispose();
	assert.equal(harness.webServer.routes("prefix").length, 0, "expected all routes removed after plugin disposal");
	await harness.root.fiber.dispose();
});

test("supports a clean remount", async () => {
	const harness = await createHarness(enabledDocument);
	try {
		await harness.fiber.dispose();
		assert.equal(harness.webServer.routes("prefix").length, 0);

		const remounted = harness.root.registry.plugin(ldvhPlugin);
		await remounted;
		assert.equal(harness.webServer.routes("prefix").length, 2, "expected routes after clean remount");
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
