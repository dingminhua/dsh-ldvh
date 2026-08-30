import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { SettingsProvider } from "@deepseek-ai/dsh-settings";
import * as ldvhPlugin from "../lib/index.js";

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

async function createHarness(document = {}, { withWebServer = true } = {}) {
	const root = new Context();
	const webServer = withWebServer ? new MemoryWebServer() : void 0;
	if (webServer !== void 0) root.provide("webServer", webServer);

	const settings = new MemorySettings(root, document);
	await settings.load().then((loaded) => settings.publish(loaded));
	await root[Symbol.for("cordis.init")]?.();

	const fiber = root.registry.plugin(ldvhPlugin);
	await fiber;

	return { root, settings, webServer, fiber };
}

async function disposeHarness(harness) {
	await harness.fiber.dispose();
	await harness.root.fiber.dispose();
}

const enabledDocument = {
	"dsh-ldvh": { governanceDirectory: "", webEnabled: true }
};
const disabledDocument = {
	"dsh-ldvh": { governanceDirectory: "", webEnabled: false }
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

test("fails closed when the host webServer is absent (no claim, no crash)", async () => {
	const harness = await createHarness({}, { withWebServer: false });
	try {
		// With no webServer the plugin must load and register nothing; the
		// settings row should still be available (settings seam is separate).
		assert.equal(harness.webServer, void 0);
	} finally {
		await disposeHarness(harness);
	}
});

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