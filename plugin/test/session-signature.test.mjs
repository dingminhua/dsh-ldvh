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
import {
	extractRouteValuesFromLines,
	splitJsonlLines,
} from "../lib/session-signature.js";

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
