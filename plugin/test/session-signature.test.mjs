// Tests for plugin/lib/session-signature.js: pure mechanical tail-read of
// routing events from a session JSONL stream.
//
// Contract authority: dev-memo 2026-09-02 (decision #29).
//   - extractRouteValuesFromLines: walk from the END, return the LAST
//     model/selection or request/context routing event verbatim.
//   - splitJsonlLines: split by newline.
//   - Zero-cleaning: never strip -vision suffixes, never filter, never
//     substitute a "current" value.
//   - A line that fails to parse is skipped (a torn tail write must not
//     fabricate a signature).
//   - When no routing event is found, return { ok: false, reason: ... }.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	extractRouteValuesFromLines,
	splitJsonlLines,
	currentRouteValuesFromShellEnvironment,
	shellAuthoritativeSignature,
} from "../lib/session-signature.js";
import { resolveAuthoritativeSignature } from "../lib/signature-channel.js";

/** Run fn with the DSH shell env keys replaced by overrides (restored after). */
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

// ---------------------------------------------------------------------------
// extractRouteValuesFromLines — happy paths
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// extractRouteValuesFromLines — zero-cleaning
// ---------------------------------------------------------------------------

test("extractRouteValuesFromLines preserves the -vision suffix verbatim (zero-cleaning)", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "deepseek-harness", model: "kimi-k3-vision" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.model, "kimi-k3-vision");
	// explicit non-cleaning: no normalization to "kimi-k3"
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
	// A real JSONL string is not trimmed; the implementation must not
	// trim either.
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "  spaced  ", model: "\tm\t" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.value.provider, "  spaced  ");
	assert.equal(result.value.model, "\tm\t");
});

// ---------------------------------------------------------------------------
// extractRouteValuesFromLines — failure modes
// ---------------------------------------------------------------------------

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
		JSON.stringify({ type: "model/selection" }), // missing data
		JSON.stringify({ type: "model/selection", data: { provider: "p", model: "m" } }),
	];
	const result = extractRouteValuesFromLines(lines);
	assert.equal(result.ok, true);
	assert.equal(result.value.provider, "p");
});

test("extractRouteValuesFromLines reports ok:false when a routing event's data has no provider/model pair", () => {
	const lines = [
		JSON.stringify({ type: "model/selection", data: { provider: "p" } }), // missing model
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

// ---------------------------------------------------------------------------
// splitJsonlLines
// ---------------------------------------------------------------------------

test("splitJsonlLines splits by newline", () => {
	const result = splitJsonlLines("a\nb\nc");
	assert.deepEqual(result, ["a", "b", "c"]);
});

test("splitJsonlLines preserves a trailing partial line", () => {
	// A torn tail write ends in a fragment without a newline; the split
	// returns it as the last element so the extractor can decide whether
	// to parse it or skip.
	const result = splitJsonlLines('{"a":1}\n{"b":2');
	assert.equal(result.length, 2);
	assert.equal(result[0], '{"a":1}');
	assert.equal(result[1], '{"b":2');
});

// ---------------------------------------------------------------------------
// currentRouteValuesFromShellEnvironment — the Code channel for DSH
// shell-child scripts (specs/09 机械签名)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// shellAuthoritativeSignature — branded carrier for direct writer calls
// ---------------------------------------------------------------------------

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
