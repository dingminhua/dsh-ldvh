import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	extractRouteValuesFromLines,
	extractRouteValuesFromEvents,
	splitJsonlLines,
	currentRouteValues,
	currentRouteValuesFromShellEnvironment,
	shellAuthoritativeSignature,
} from "../lib/session-signature.js";
import { resolveAuthoritativeSignature } from "../lib/signature-channel.js";

async function withShellEnv(overrides, fn) {
	const keys = ["DSH_SESSION_JSONL", "DSH_SESSION_ID", "DSH_HOME"];
	const saved = {};
	for (const key of keys) {
		saved[key] = process.env[key];
		if (process.env[key] !== undefined) delete process.env[key];
	}
	for (const [key, value] of Object.entries(overrides)) {
		process.env[key] = value;
	}
	try {
		return await fn();
	} finally {
		for (const key of keys) {
			if (saved[key] === undefined) {
				if (process.env[key] !== undefined) delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
	}
}

async function withTempDir(prefix, fn) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	try {
		return await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true }).catch(() => {});
	}
}

const ROUTING_LINES = [
	JSON.stringify({ type: "user/prompt", data: { text: "hi" } }),
	JSON.stringify({ type: "model/selection", data: { provider: "zzztoken-glm", model: "glm-5.3" } }),
].join("\n");


test("extractRouteValuesFromLines returns the LAST routing event when there are several", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "p-1", model: "m-1" } }),
		JSON.stringify({ type: "request/context", data: { provider: "p-2", model: "m-2" } }),
		JSON.stringify({ type: "model/selection", data: { provider: "p-3", model: "m-3" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.provider, "p-3");
	assert.equal(result.value.model, "m-3");
	assert.equal(result.value.eventType, "model/selection");
});

test("extractRouteValuesFromLines treats the two routing event types as equivalent", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "p-1", model: "m-1" } }),
		JSON.stringify({ type: "request/context", data: { provider: "p-2", model: "m-2" } }),
	];
	const fromSelection = extractRouteValuesFromLines(lines);
	assert.equal(fromSelection.value.provider, "p-2");
	assert.equal(fromSelection.value.model, "m-2");
	assert.equal(fromSelection.value.eventType, "request/context");
});

test("extractRouteValuesFromLines ignores non-routing event types", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "p-1", model: "m-1" } }),
		JSON.stringify({ type: "tool/result", data: { provider: "noise", model: "noise" } }),
		JSON.stringify({ type: "user/prompt", data: { provider: "noise2", model: "noise2" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.provider, "p-1");
	assert.equal(result.value.model, "m-1");
});

test("extractRouteValuesFromLines returns the last event even when earlier events are non-routing", () => {
	const lines = [
		JSON.stringify({ type: "user/prompt", data: { provider: "noise", model: "noise" } }),
		JSON.stringify({ type: "tool/result", data: { provider: "noise2", model: "noise2" } }),
		JSON.stringify({ type: "model/selection", data: { provider: "deepseek-harness", model: "test" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.provider, "deepseek-harness");
	assert.equal(result.value.model, "test");
});


test("extractRouteValuesFromLines preserves the -vision suffix verbatim (zero-cleaning)", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "deepseek-harness", model: "kimi-k3-vision" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.model, "kimi-k3-vision");
	assert.notEqual(result.value.model, "kimi-k3");
});

test("extractRouteValuesFromLines preserves arbitrary routing variant suffixes", () => {
	const lines = [
		JSON.stringify({ type: "request/context", data: { provider: "vendor-x", model: "model-y-2024q4-fast" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.value.model, "model-y-2024q4-fast");
});

test("extractRouteValuesFromLines preserves whitespace inside provider/model values", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "  spaced  ", model: "\tm\t" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.value.provider, "  spaced  ");
	assert.equal(result.value.model, "\tm\t");
});


test("extractRouteValuesFromLines returns ok:false when no routing event exists", () => {
	const lines = [
		JSON.stringify({ type: "user/prompt", data: { text: "hi" } }),
		JSON.stringify({ type: "tool/result", data: { result: "ok" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, false);
	assert.match(result.reason, /no model\/selection or request\/context/);
});

test("extractRouteValuesFromLines returns ok:false on an empty line list", () => {
	const result = extractRouteValuesFromLines([]);
	assert.equal(result.ok, false);
	assert.match(result.reason, /no model\/selection or request\/context/);
});

test("extractRouteValuesFromLines skips lines that fail to JSON.parse", () => {
	const lines = [
		"{ not json",
		"also not json",
		JSON.stringify({ type: "model/selection", data: { provider: "p", model: "m" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.provider, "p");
	assert.equal(result.value.model, "m");
});

test("extractRouteValuesFromLines skips lines with non-object JSON", () => {
	const lines = [
		"42",
		'"a string"',
		"[1,2,3]",
		JSON.stringify({ type: "model/selection", data: { provider: "p", model: "m" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.provider, "p");
});

test("extractRouteValuesFromLines skips lines with no data object", () => {
	const lines = [
		JSON.stringify({ type: "model/selection" }),
		JSON.stringify({ type: "model/selection", data: { provider: "p", model: "m" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.provider, "p");
});

test("extractRouteValuesFromLines reports ok:false when a routing event's data has no provider/model pair", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "p" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, false);
	assert.match(result.reason, /lacks a provider\/model pair/);
});

test("extractRouteValuesFromLines reports ok:false when provider/model are empty strings", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "", model: "m" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, false);
	assert.match(result.reason, /lacks a provider\/model pair/);
});

test("extractRouteValuesFromLines skips blank lines without crashing", () => {
	const lines = [
		"",
		"   ",
		JSON.stringify({ type: "model/selection", data: { provider: "p", model: "m" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.provider, "p");
});


test("splitJsonlLines splits by newline", () => {
	const result = splitJsonlLines("a\nb\nc");
	assert.deepEqual(result, ["a", "b", "c"]);
});

test("splitJsonlLines preserves a trailing partial line", () => {
	const result = splitJsonlLines('{"a":1}\n{"b":2');
	assert.equal(result.length, 2);
	assert.equal(result[0], '{"a":1}');
	assert.equal(result[1], '{"b":2');
});


test("shell environment resolves nothing when no DSH identity is present", async () => {
	await withShellEnv({}, async () => {
		const result = await currentRouteValuesFromShellEnvironment();
		assert.equal(result.ok, false);
		assert.match(result.reason, /DSH_HOME|DSH_SESSION_ID/);
	});
});

test("shell environment resolves via DSH_SESSION_JSONL direct injection", async () => {
	await withTempDir("sig-shell-", async (root) => {
		const log = join(root, "session.jsonl");
		await writeFile(log, ROUTING_LINES, "utf8");
		await withShellEnv({ DSH_SESSION_JSONL: log }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, true, result.reason);
			assert.equal(result.value.provider, "zzztoken-glm");
			assert.equal(result.value.model, "glm-5.3");
		});
	});
});

test("shell environment resolves via the sessions on-disk layout", async () => {
	await withTempDir("sig-shell-", async (home) => {
		const sessionDir = join(home, "sessions", "--encoded-cwd--", "session-abc123");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "session.v3.jsonl.zstd"), ROUTING_LINES, "utf8");
		await withShellEnv({ DSH_HOME: home, DSH_SESSION_ID: "session-abc123" }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, true, result.reason);
			assert.equal(result.value.provider, "zzztoken-glm");
			assert.equal(result.value.model, "glm-5.3");
		});
	});
});

test("shell environment resolves a schema-v4 log (host naming follows the record version)", async () => {
	await withTempDir("sig-shell-", async (home) => {
		const sessionDir = join(home, "sessions", "--encoded-cwd--", "session-v4");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "session.v4.jsonl.zstd"), ROUTING_LINES, "utf8");
		await withShellEnv({ DSH_HOME: home, DSH_SESSION_ID: "session-v4" }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, true, result.reason);
			assert.equal(result.value.provider, "zzztoken-glm");
			assert.equal(result.value.model, "glm-5.3");
		});
	});
});

test("shell environment accepts an uncompressed schema-versioned log", async () => {
	await withTempDir("sig-shell-", async (home) => {
		const sessionDir = join(home, "sessions", "--encoded-cwd--", "session-plain");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "session.v4.jsonl"), ROUTING_LINES, "utf8");
		await withShellEnv({ DSH_HOME: home, DSH_SESSION_ID: "session-plain" }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, true, result.reason);
			assert.equal(result.value.model, "glm-5.3");
		});
	});
});

test("shell environment reads the highest schema version when a session carries two logs", async () => {
	await withTempDir("sig-shell-", async (home) => {
		const sessionDir = join(home, "sessions", "--encoded-cwd--", "session-bumped");
		await mkdir(sessionDir, { recursive: true });
		const frozenV3 = JSON.stringify({
			type: "model/selection",
			data: { provider: "old-provider", model: "old-model" },
		});
		await writeFile(join(sessionDir, "session.v3.jsonl.zstd"), frozenV3, "utf8");
		await writeFile(join(sessionDir, "session.v4.jsonl.zstd"), ROUTING_LINES, "utf8");
		await withShellEnv({ DSH_HOME: home, DSH_SESSION_ID: "session-bumped" }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, true, result.reason);
			assert.equal(result.value.provider, "zzztoken-glm", "the frozen v3 log must not be tail-read once v4 exists");
			assert.equal(result.value.model, "glm-5.3");
		});
	});
});

test("shell environment ignores log names that carry no schema version", async () => {
	await withTempDir("sig-shell-", async (home) => {
		const sessionDir = join(home, "sessions", "--encoded-cwd--", "session-noversion");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "session.jsonl.zstd"), ROUTING_LINES, "utf8");
		await withShellEnv({ DSH_HOME: home, DSH_SESSION_ID: "session-noversion" }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, false);
			assert.match(result.reason, /no session log/);
		});
	});
});

test("shell environment fails closed when the session log has no routing events", async () => {
	await withTempDir("sig-shell-", async (home) => {
		const sessionDir = join(home, "sessions", "--encoded-cwd--", "session-abc123");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(
			join(sessionDir, "session.v3.jsonl.zstd"),
			JSON.stringify({ type: "user/prompt", data: { text: "hi" } }) + "\n",
			"utf8",
		);
		await withShellEnv({ DSH_HOME: home, DSH_SESSION_ID: "session-abc123" }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, false);
			assert.match(result.reason, /no model\/selection or request\/context/);
		});
	});
});

test("shell environment fails closed when no session log matches the id", async () => {
	await withTempDir("sig-shell-", async (home) => {
		await mkdir(join(home, "sessions"), { recursive: true });
		await withShellEnv({ DSH_HOME: home, DSH_SESSION_ID: "session-none" }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, false);
			assert.match(result.reason, /no session log/);
		});
	});
});

test("shell environment fails closed on ambiguous session matches", async () => {
	await withTempDir("sig-shell-", async (home) => {
		for (const cwd of ["--cwd-a--", "--cwd-b--"]) {
			const sessionDir = join(home, "sessions", cwd, "session-dup");
			await mkdir(sessionDir, { recursive: true });
			await writeFile(join(sessionDir, "session.v3.jsonl.zstd"), ROUTING_LINES, "utf8");
		}
		await withShellEnv({ DSH_HOME: home, DSH_SESSION_ID: "session-dup" }, async () => {
			const result = await currentRouteValuesFromShellEnvironment();
			assert.equal(result.ok, false);
			assert.match(result.reason, /ambiguous/);
		});
	});
});

test("shell environment rejects an unsafe DSH_SESSION_ID path segment", async () => {
	await withShellEnv({ DSH_HOME: "/tmp", DSH_SESSION_ID: "../../etc" }, async () => {
		const result = await currentRouteValuesFromShellEnvironment();
		assert.equal(result.ok, false);
		assert.match(result.reason, /safe path segment/);
	});
});


test("shellAuthoritativeSignature returns a branded carrier the channel resolves", async () => {
	await withTempDir("sig-shell-", async (root) => {
		const log = join(root, "session.jsonl");
		await writeFile(log, ROUTING_LINES, "utf8");
		await withShellEnv({ DSH_SESSION_JSONL: log }, async () => {
			const carrier = await shellAuthoritativeSignature();
			assert.ok(carrier, "carrier must be produced when the route resolves");
			assert.deepEqual(resolveAuthoritativeSignature(carrier), {
				provider: "zzztoken-glm",
				model: "glm-5.3",
			});
		});
	});
});

test("shellAuthoritativeSignature returns null when the authoritative record is unavailable", async () => {
	await withShellEnv({}, async () => {
		const carrier = await shellAuthoritativeSignature();
		assert.equal(carrier, null);
	});
});

test("host path: currentRouteValues consumes the official open().read() entry, not a private locate()", async () => {
	const ROUTING = [
		{ type: "model/selection", data: { provider: "vendor-a", model: "model-x" } },
		{ type: "assistant/message", data: { turn: 1, message: { content: [{ type: "text", text: "noise" }] } } },
		{ type: "request/context", data: { provider: "vendor-b", model: "model-y-vision" } },
	];
	let opened = 0;
	let readCalls = 0;
	let locateCalls = 0;
	const persistence = {
		open(id, access) {
			opened += 1;
			assert.equal(access, "read", "日志读取必须使用只读访问，不得取得写所有权");
			assert.equal(id, "session-1");
			return Promise.resolve({
				id,
				header: { id },
				read() {
					readCalls += 1;
					return Promise.resolve({ eventState: "owned", events: ROUTING });
				},
				async [Symbol.asyncDispose]() {},
			});
		},
		get locate() {
			locateCalls += 1;
			return undefined;
		},
	};
	const agent = { session: { header: { id: "session-1", cwd: "/tmp/x" } } };
	const result = await currentRouteValues(persistence, agent);
	assert.equal(result.ok, true, `应经宿主入口取到签名：${JSON.stringify(result)}`);
	assert.equal(result.value.provider, "vendor-b");
	assert.equal(result.value.model, "model-y-vision");
	assert.equal(opened, 1, "必须经 open() 取句柄");
	assert.ok(readCalls >= 1, "必须经 handle.read() 读取事件");
	assert.equal(locateCalls, 0, "不得再调用 private 的 locate()");
});

test("both entries yield the identical signature for the same log (swap must not change values)", async () => {
	const ROUTING = [
		{ type: "model/selection", data: { provider: "vendor-a", model: "model-x" } },
		{ type: "assistant/message", data: { turn: 1, message: { content: [{ type: "text", text: "noise" }] } } },
		{ type: "request/context", data: { provider: "vendor-b", model: "model-y-vision" } },
		{ type: "turn/end", data: { turn: 1 } },
	];
	const viaEvents = extractRouteValuesFromEvents([...ROUTING].reverse());
	const viaLines = extractRouteValuesFromLines(ROUTING.map((event) => JSON.stringify(event)));
	assert.equal(viaEvents.ok, true);
	assert.equal(viaLines.ok, true);
	assert.deepEqual(
		{ provider: viaEvents.value.provider, model: viaEvents.value.model, eventType: viaEvents.value.eventType },
		{ provider: viaLines.value.provider, model: viaLines.value.model, eventType: viaLines.value.eventType },
		"两条入口取到的署名必须逐字一致（含 -vision 后缀不得被清洗）"
	);
	assert.equal(viaEvents.value.model, "model-y-vision", "零清洗：后缀保留");
});

test("host handle path takes the NEWEST routing event, not the oldest (ordering guard)", async () => {
	const OLDEST = { type: "model/selection", data: { provider: "old-vendor", model: "old-model" } };
	const NEWEST = { type: "request/context", data: { provider: "new-vendor", model: "new-model" } };
	const persistence = {
		open() {
			return Promise.resolve({
				read: () => Promise.resolve({ eventState: "owned", events: [OLDEST, NEWEST] }),
				async [Symbol.asyncDispose]() {},
			});
		},
	};
	const agent = { session: { header: { id: "session-1", cwd: "/tmp/x" } } };
	const result = await currentRouteValues(persistence, agent);
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.value.provider, "new-vendor", "必须取最新一条 routing 事件（正序返回时须反转）");
	assert.equal(result.value.model, "new-model");
});
