import assert from "node:assert/strict";
import test from "node:test";

import {
	authoritativeSignature,
	resolveAuthoritativeSignature,
} from "../lib/signature-channel.js";


test("authoritativeSignature wraps a valid route record", () => {
	const carrier = authoritativeSignature({ provider: "workbuddy", model: "deepseek-v4.1-flash" });
	assert.ok(carrier, "valid route must produce a carrier");
	const resolved = resolveAuthoritativeSignature(carrier);
	assert.deepEqual(resolved, { provider: "workbuddy", model: "deepseek-v4.1-flash" });
});

test("authoritativeSignature rejects invalid route records", () => {
	assert.equal(authoritativeSignature(null), null);
	assert.equal(authoritativeSignature(undefined), null);
	assert.equal(authoritativeSignature("workbuddy"), null);
	assert.equal(authoritativeSignature({}), null);
	assert.equal(authoritativeSignature({ provider: "p" }), null);
	assert.equal(authoritativeSignature({ model: "m" }), null);
	assert.equal(authoritativeSignature({ provider: "", model: "m" }), null);
	assert.equal(authoritativeSignature({ provider: "p", model: "" }), null);
});


test("resolveAuthoritativeSignature ignores plain objects (specs/09: no caller-supplied signatures)", () => {
	assert.equal(resolveAuthoritativeSignature({ provider: "forged", model: "self-filled" }), null);
	assert.equal(resolveAuthoritativeSignature({ provider: "ldvh-controlled-write", model: "research-writer.createResearchObject" }), null);
	assert.equal(resolveAuthoritativeSignature({}), null);
});

test("resolveAuthoritativeSignature ignores non-objects and null", () => {
	assert.equal(resolveAuthoritativeSignature(null), null);
	assert.equal(resolveAuthoritativeSignature(undefined), null);
	assert.equal(resolveAuthoritativeSignature("forged"), null);
	assert.equal(resolveAuthoritativeSignature(42), null);
});

test("resolveAuthoritativeSignature rejects structurally forged carriers (no reachable brand payload)", () => {
	const forgedSymbol = Symbol("not-the-brand");
	assert.equal(resolveAuthoritativeSignature({ [forgedSymbol]: { provider: "p", model: "m" } }), null);
});

test("branded carriers are opaque: no enumerable leakage of the route payload", () => {
	const carrier = authoritativeSignature({ provider: "p", model: "m" });
	const jsonCopy = JSON.parse(JSON.stringify(carrier));
	assert.equal(resolveAuthoritativeSignature(jsonCopy), null);
});
