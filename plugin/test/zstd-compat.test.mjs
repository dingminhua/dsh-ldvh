// Tests for plugin/lib/zstd-compat.js: multi-frame zstd stream decompression.
//
// The implementation walks zstd frame boundaries to handle the
// per-event-frame append pattern of DSH session logs. We exercise the
// stream from end to end using node:zlib's zstdCompressSync helper, and
// also throw at it the trickier cases (a magic byte pattern that happens
// to appear inside a frame's payload, a torn final frame, and an input
// that isn't zstd at all).
import assert from "node:assert/strict";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import { createZstdDecompressSync, decompressZstdStream } from "../lib/zstd-compat.js";

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("decompressZstdStream returns a single frame's payload", async () => {
	const payload = Buffer.from("hello zstd world\n");
	const compressed = zstdCompressSync(payload);
	const out = await decompressZstdStream(compressed);
	assert.equal(out.toString("utf8"), "hello zstd world\n");
});

test("decompressZstdStream concatenates multiple independent frames", async () => {
	const frames = [
		Buffer.from("frame-A "),
		Buffer.from("frame-B "),
		Buffer.from("frame-C"),
	];
	const compressed = Buffer.concat(frames.map((frame) => zstdCompressSync(frame)));
	const out = await decompressZstdStream(compressed);
	assert.equal(out.toString("utf8"), "frame-A frame-B frame-C");
});

test("decompressZstdStream returns empty buffer on empty input", async () => {
	const out = await decompressZstdStream(Buffer.alloc(0));
	assert.equal(out.length, 0);
});

// ---------------------------------------------------------------------------
// Spurious magic inside frame data must not drop frames
// ---------------------------------------------------------------------------

test("decompressZstdStream survives a payload that contains the magic 0x28 B5 2F FD inside compressed data", async () => {
	// Build a payload whose plaintext contains the zstd frame magic bytes
	// 0x28 0xB5 0x2F 0xFD. zstdCompressSync may then emit those bytes
	// inside the encoded frame body (highly likely for the LZ-match step).
	const payload = Buffer.concat([
		Buffer.from("prefix-"),
		Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
		Buffer.from("-suffix-"),
		Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
		Buffer.from("-end"),
	]);
	const compressed = zstdCompressSync(payload);
	const out = await decompressZstdStream(compressed);
	assert.equal(out.toString("utf8"), payload.toString("utf8"));
});

test("decompressZstdStream skips a spurious magic byte between two real frames", async () => {
	// Manually craft: frame1 || 0x28 B5 2F FD || frame2
	// The spurious magic must be detected as not-a-frame-start, and frame2
	// must still decompress correctly.
	const frame1 = zstdCompressSync(Buffer.from("AAA "));
	const frame2 = zstdCompressSync(Buffer.from("BBB"));
	const noise = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x00, 0x00]);
	const combined = Buffer.concat([frame1, noise, frame2]);
	const out = await decompressZstdStream(combined);
	assert.equal(out.toString("utf8"), "AAA BBB");
});

// ---------------------------------------------------------------------------
// Torn tail
// ---------------------------------------------------------------------------

test("decompressZstdStream decompresses complete frames and silently skips a torn tail", async () => {
	const frame1 = zstdCompressSync(Buffer.from("good-frame-1\n"));
	const frame2 = zstdCompressSync(Buffer.from("good-frame-2\n"));
	// Append a torn half: first 4 bytes of a third frame
	const frame3Head = zstdCompressSync(Buffer.from("torn-frame\n")).subarray(0, 4);
	const combined = Buffer.concat([frame1, frame2, frame3Head]);
	const out = await decompressZstdStream(combined);
	// Torn tail is discarded; only complete frames survive
	assert.equal(out.toString("utf8"), "good-frame-1\ngood-frame-2\n");
});

test("decompressZstdStream throws when every frame is torn (no complete frame)", async () => {
	const frame1 = zstdCompressSync(Buffer.from("only-frame\n"));
	const torn = frame1.subarray(0, 4);
	await assert.rejects(decompressZstdStream(torn), /no zstd frame/);
});

// ---------------------------------------------------------------------------
// Non-zstd inputs
// ---------------------------------------------------------------------------

test("decompressZstdStream throws when the input does not start with a zstd magic", async () => {
	const notZstd = Buffer.from("this is plain text, definitely not zstd\n");
	await assert.rejects(decompressZstdStream(notZstd), /does not start with a zstd frame magic/);
});

test("decompressZstdStream throws when the input is just a four-byte zstd magic with no frame body", async () => {
	// The four-byte magic is the legitimate zstd frame header start, but a
	// 4-byte payload has no body to decompress — the implementation reports
	// it as "no zstd frame in the stream decompressed" rather than the
	// "does not start with a zstd frame magic" branch. The contract is that
	// BOTH branches throw, so accept either message.
	const noise = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
	await assert.rejects(decompressZstdStream(noise), /zstd/);
});

// ---------------------------------------------------------------------------
// Sync single-frame helper
// ---------------------------------------------------------------------------

test("createZstdDecompressSync returns the native zstdDecompressSync function", () => {
	const fn = createZstdDecompressSync();
	assert.equal(typeof fn, "function");
	const payload = Buffer.from("sync\n");
	const compressed = zstdCompressSync(payload);
	assert.equal(fn(compressed).toString("utf8"), "sync\n");
});

test("createZstdDecompressSync only decompresses the first frame, leaving trailing data untouched", () => {
	// This is the documented contract: sync is retained only for single-frame
	// callers. The shim's reason for existing is the multi-frame append
	// pattern; the sync helper is not the multi-frame answer.
	const fn = createZstdDecompressSync();
	const frame1 = zstdCompressSync(Buffer.from("first\n"));
	const frame2 = zstdCompressSync(Buffer.from("second\n"));
	const combined = Buffer.concat([frame1, frame2]);
	const out = fn(combined);
	assert.equal(out.toString("utf8"), "first\n");
});
