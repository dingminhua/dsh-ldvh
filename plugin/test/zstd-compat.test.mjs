import assert from "node:assert/strict";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import { createZstdDecompressSync, decompressZstdStream } from "../lib/zstd-compat.js";


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


test("decompressZstdStream survives a payload that contains the magic 0x28 B5 2F FD inside compressed data", async () => {
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
	const frame1 = zstdCompressSync(Buffer.from("AAA "));
	const frame2 = zstdCompressSync(Buffer.from("BBB"));
	const noise = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x00, 0x00]);
	const combined = Buffer.concat([frame1, noise, frame2]);
	const out = await decompressZstdStream(combined);
	assert.equal(out.toString("utf8"), "AAA BBB");
});


test("decompressZstdStream decompresses complete frames and silently skips a torn tail", async () => {
	const frame1 = zstdCompressSync(Buffer.from("good-frame-1\n"));
	const frame2 = zstdCompressSync(Buffer.from("good-frame-2\n"));
	const frame3Head = zstdCompressSync(Buffer.from("torn-frame\n")).subarray(0, 4);
	const combined = Buffer.concat([frame1, frame2, frame3Head]);
	const out = await decompressZstdStream(combined);
	assert.equal(out.toString("utf8"), "good-frame-1\ngood-frame-2\n");
});

test("decompressZstdStream throws when every frame is torn (no complete frame)", async () => {
	const frame1 = zstdCompressSync(Buffer.from("only-frame\n"));
	const torn = frame1.subarray(0, 4);
	await assert.rejects(decompressZstdStream(torn), /no zstd frame/);
});


test("decompressZstdStream throws when the input does not start with a zstd magic", async () => {
	const notZstd = Buffer.from("this is plain text, definitely not zstd\n");
	await assert.rejects(decompressZstdStream(notZstd), /does not start with a zstd frame magic/);
});

test("decompressZstdStream throws when the input is just a four-byte zstd magic with no frame body", async () => {
	const noise = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
	await assert.rejects(decompressZstdStream(noise), /zstd/);
});


test("createZstdDecompressSync returns the native zstdDecompressSync function", () => {
	const fn = createZstdDecompressSync();
	assert.equal(typeof fn, "function");
	const payload = Buffer.from("sync\n");
	const compressed = zstdCompressSync(payload);
	assert.equal(fn(compressed).toString("utf8"), "sync\n");
});

test("createZstdDecompressSync only decompresses the first frame, leaving trailing data untouched", () => {
	const fn = createZstdDecompressSync();
	const frame1 = zstdCompressSync(Buffer.from("first\n"));
	const frame2 = zstdCompressSync(Buffer.from("second\n"));
	const combined = Buffer.concat([frame1, frame2]);
	const out = fn(combined);
	assert.equal(out.toString("utf8"), "first\n");
});


test("多帧解压的输出量与帧数线性，不得重复拼接（Node 版本无关）", async () => {
	const parts = [];
	const frames = [];
	for (let i = 0; i < 12; i += 1) {
		const text = `event-${String(i).padStart(2, "0")}\n`;
		parts.push(text);
		frames.push(zstdCompressSync(Buffer.from(text)));
	}
	const expected = parts.join("");
	const out = await decompressZstdStream(Buffer.concat(frames));
	assert.equal(out.toString("utf8"), expected);
	assert.equal(out.length, Buffer.byteLength(expected));
});

test("首帧之后带真实帧、且中间夹伪魔数，仍逐帧只解一次", async () => {
	const frameA = zstdCompressSync(Buffer.from("AAA "));
	const frameB = zstdCompressSync(Buffer.from("BBB "));
	const frameC = zstdCompressSync(Buffer.from("CCC"));
	const noise = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02, 0x03, 0x04]);
	const out = await decompressZstdStream(Buffer.concat([frameA, noise, frameB, frameC]));
	assert.equal(out.toString("utf8"), "AAA BBB CCC");
});
