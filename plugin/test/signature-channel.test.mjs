// Tests for plugin/lib/signature-channel.js: the branded channel between
// the tools layer and the fact-object writers.
//
// Contract authority: specs/03 §6.1 (change_log 署名由 Code 托管) +
// specs/09 机械签名 (provider/model 必须由 Code 从 DSH 权威会话或请求记录
// 取得，不允许 AI 自填、用部署默认值替代或由调用方覆盖).
//
//   - authoritativeSignature(route) wraps a valid route record into the
//     branded carrier; invalid inputs return null.
//   - resolveAuthoritativeSignature(arg) resolves ONLY branded carriers;
//     plain objects / strings / null / structurally forged shapes resolve
//     to null — the writer then renders the change_log entry without
//     provider/model (the deterministic "route unavailable" outcome).
import assert from "node:assert/strict";
import test from "node:test";

import {
	authoritativeSignature,
	resolveAuthoritativeSignature,
} from "../lib/signature-channel.js";

// ---------------------------------------------------------------------------
// authoritativeSignature — factory (tools layer)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// resolveAuthoritativeSignature — writer side
// ---------------------------------------------------------------------------

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
	// A forged object without the module-private Symbol brand cannot carry a
	// payload the resolver will accept — even an object with a Symbol-keyed
	// field of a different symbol resolves to null.
	const forgedSymbol = Symbol("not-the-brand");
	assert.equal(resolveAuthoritativeSignature({ [forgedSymbol]: { provider: "p", model: "m" } }), null);
});

test("branded carriers are opaque: no enumerable leakage of the route payload", () => {
	const carrier = authoritativeSignature({ provider: "p", model: "m" });
	// JSON round-trip drops the Symbol brand — the copy must not resolve.
	const jsonCopy = JSON.parse(JSON.stringify(carrier));
	assert.equal(resolveAuthoritativeSignature(jsonCopy), null);
});
