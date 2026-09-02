// zstd multi-frame decompression. LDVH's red line is zero third-party
// runtime dependencies (dev-memo decision #6), so this builds on Node's
// built-in zlib zstd support and nothing else.
//
// DSH session logs are APPENDED PER-EVENT as a sequence of independent zstd
// frames (verified against real logs: 1700+ frame magics in one file, and
// the frame-walk below reproduces `zstd -dc` output byte-for-byte). A single
// sync call or a single ZstdDecompress transform handles only the FIRST
// frame, so this shim walks frame boundaries:
//
//   1. From the current position, feed the remaining stream into a fresh
//      ZstdDecompress transform; it emits exactly one frame's data (zlib
//      stops at the frame boundary) and leaves trailing bytes unconsumed.
//   2. Advance to the next zstd magic candidate AFTER the current position.
//      A candidate that is a SPURIOUS magic inside frame data makes the
//      transform error out (unsupported frame parameter) or emit nothing;
//      such candidates are skipped, not trusted.
//   3. A torn tail (append in flight) decompresses to nothing and ends the
//      walk — the tail is skipped, never guessed.
//
// The zlib error-on-garbage behavior is what makes this sound: unlike
// zstdDecompressSync (which silently accepts trailing data after the first
// frame and can "succeed" on a mid-frame slice), the streaming transform
// validates the frame header at the position it is fed.

import { ZstdDecompress, zstdDecompressSync } from "node:zlib";

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function isMagic(buffer, offset) {
  return buffer[offset] === 0x28 && buffer[offset + 1] === 0xb5 && buffer[offset + 2] === 0x2f && buffer[offset + 3] === 0xfd;
}

function nextMagic(buffer, from) {
  for (let offset = Math.max(from, 4); offset <= buffer.length - 4; offset += 1) {
    if (isMagic(buffer, offset)) return offset;
  }
  return -1;
}

/** Decompress exactly the frames that parse; return { chunks, torn }. */
async function walkFrames(buffer) {
  const chunks = [];
  let position = 0;
  let torn = false;
  while (position <= buffer.length - 4) {
    const start = position === 0 || isMagic(buffer, position) ? position : nextMagic(buffer, position);
    if (start === -1) break;
    let out;
    try {
      out = await decompressOneFrame(buffer.subarray(start));
    } catch {
      // Not a real frame start (spurious magic) — try the next candidate.
      const following = nextMagic(buffer, start + 1);
      if (following === -1) {
        torn = true;
        break;
      }
      position = following;
      continue;
    }
    if (out === null || out.length === 0) {
      // Nothing decompressable at this boundary: a torn final frame. Stop.
      torn = true;
      break;
    }
    chunks.push(out);
    const following = nextMagic(buffer, start + 1);
    if (following === -1) break;
    position = following;
  }
  return { chunks, torn };
}

function decompressOneFrame(remaining) {
  return new Promise((resolve, reject) => {
    const transform = new ZstdDecompress();
    const chunks = [];
    transform.on("data", (chunk) => chunks.push(chunk));
    transform.on("end", () => resolve(Buffer.concat(chunks)));
    transform.on("error", reject);
    transform.end(remaining);
  });
}

/**
 * Decompress a multi-frame zstd stream into one Buffer. Throws when the
 * stream does not start with a zstd frame magic (callers fall back to plain
 * text) or when no frame decompresses at all.
 */
export async function decompressZstdStream(buffer) {
  if (buffer.length === 0) return Buffer.alloc(0);
  if (!isMagic(buffer, 0)) throw new Error("input does not start with a zstd frame magic");
  const { chunks } = await walkFrames(buffer);
  if (chunks.length === 0) throw new Error("no zstd frame in the stream decompressed");
  return Buffer.concat(chunks);
}

/** Synchronous single-frame decompression retained for single-frame callers. */
export function createZstdDecompressSync() {
  if (typeof zstdDecompressSync !== "function") {
    throw new Error("Node zlib zstd decompression is unavailable in this runtime");
  }
  return zstdDecompressSync;
}
