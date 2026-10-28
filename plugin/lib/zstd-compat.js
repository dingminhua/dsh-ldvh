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
  return MAGIC.every((byte, i) => buffer[offset + i] === byte);
}

function nextMagic(buffer, from) {
  for (let offset = Math.max(from, 4); offset <= buffer.length - 4; offset += 1) {
    if (isMagic(buffer, offset)) return offset;
  }
  return -1;
}

/**
 * 一帧 zstd 在字节流里占多长——返回 { length } 或 null（帧头不完整/非法）。
 *
 * **为什么必须自己算，而不是「解一帧、看剩下什么」**：本模块原先依赖
 * 「ZstdDecompress 喂进剩余字节时只解第一帧、把尾部留在流里」这一行为，
 * 再用 nextMagic 找下一个帧起点。该行为**随 Node 版本变化**：v24.22 起
 * transform 一次解完全部帧（实测 3 帧输入 → 一次输出三帧拼接），于是循环
 * 每前进一帧就把剩余全部再解一遍，重复量随帧数平方增长——真实会话日志
 * 2.34MB 解出 5.6GB（放大 2389 倍），直接撞上 V8 字符串上限。zlib 也不
 * 暴露 bytesRead（实测 undefined），无法据此切帧。故帧边界只能由帧格式
 * 本身给出，这样与 Node 版本无关。
 *
 * 格式（RFC 8878 §3.1）：Magic(4) | Frame_Header_Descriptor(1) |
 * [Window_Descriptor(0/1)] | [Dictionary_ID(0/1/2/4)] | [Frame_Content_Size(0/1/2/4/8)]
 * | 若干 Block：Block_Header(3) + Block_Data | [Content_Checksum(0/4)]
 */
function frameLength(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  if (!isMagic(buffer, offset)) return null;
  let cursor = offset + 4;
  if (cursor >= buffer.length) return null;
  const descriptor = buffer[cursor];
  cursor += 1;

  const fcsFlag = descriptor >> 6;            // 0..3
  const singleSegment = (descriptor >> 5) & 1;
  const reserved = (descriptor >> 3) & 1;     // 必须为 0
  const checksumFlag = (descriptor >> 2) & 1;
  const dictIdFlag = descriptor & 0x03;
  if (reserved !== 0) return null;

  // Window_Descriptor 只在非 single-segment 时出现。
  if (!singleSegment) {
    if (cursor >= buffer.length) return null;
    cursor += 1;
  }

  // Dictionary_ID：flag 1→1 字节、2→2、3→4。
  const dictIdBytes = [0, 1, 2, 4][dictIdFlag];
  if (cursor + dictIdBytes > buffer.length) return null;
  cursor += dictIdBytes;

  // Frame_Content_Size：flag 0 时 single-segment 才有 1 字节，否则 0。
  const fcsBytes = fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
  if (cursor + fcsBytes > buffer.length) return null;
  cursor += fcsBytes;

  // 走 Block 头：3 字节小端，bit0 = last_block，bits1-2 = type，bits3+ = size。
  for (;;) {
    if (cursor + 3 > buffer.length) return null;
    const header = buffer[cursor] | (buffer[cursor + 1] << 8) | (buffer[cursor + 2] << 16);
    const lastBlock = header & 1;
    const blockType = (header >> 1) & 0x03;
    const blockSize = header >> 3;
    cursor += 3;
    // 0=Raw、1=RLE（1 字节）、2=Compressed、3=Reserved（非法）
    if (blockType === 3) return null;
    const dataBytes = blockType === 1 ? 1 : blockSize;
    if (cursor + dataBytes > buffer.length) return null;
    cursor += dataBytes;
    if (lastBlock) break;
  }

  if (checksumFlag) {
    if (cursor + 4 > buffer.length) return null;
    cursor += 4;
  }
  return { length: cursor - offset };
}

/** Decompress exactly the frames that parse; return { chunks, torn }. */
async function walkFrames(buffer) {
  const chunks = [];
  let position = 0;
  let torn = false;
  while (position <= buffer.length - 4) {
    // 帧边界由帧格式给出（frameLength），不依赖 zlib 是否停在帧边界。
    // 起点不在魔数上时，按既有语义向前找下一个候选（容忍帧间噪声）。
    if (!isMagic(buffer, position)) {
      const candidate = nextMagic(buffer, position);
      if (candidate === -1) break;
      position = candidate;
      continue;
    }
    const parsed = frameLength(buffer, position);
    if (parsed === null) {
      // 帧头不完整或非法：若后面还有候选，可能是伪魔数，继续找；
      // 找不到就按「撕裂的尾部」结束（尾部丢弃，绝不猜测）。
      const following = nextMagic(buffer, position + 1);
      if (following === -1) {
        torn = true;
        break;
      }
      position = following;
      continue;
    }
    const slice = buffer.subarray(position, position + parsed.length);
    let out;
    try {
      out = await decompressOneFrame(slice);
    } catch {
      // 帧长算得出但解不开：同样按伪魔数处理，跳到下一个候选。
      const following = nextMagic(buffer, position + 1);
      if (following === -1) {
        torn = true;
        break;
      }
      position = following;
      continue;
    }
    if (out === null || out.length === 0) {
      // 边界处无可解内容：视为撕裂的末帧。Stop.
      torn = true;
      break;
    }
    chunks.push(out);
    position += parsed.length;
  }
  return { chunks, torn };
}

/**
 * 解**恰好一帧**。调用方保证 slice 起于帧魔数且恰为一帧（frameLength 给出
 * 的字节数），故这里无论 zlib 是「只解一帧」还是「解完所有帧」都得到同一
 * 结果——这正是与 Node 版本解耦的关键。
 */
function decompressOneFrame(slice) {
  return new Promise((resolve, reject) => {
    const transform = new ZstdDecompress();
    const chunks = [];
    transform.on("data", (chunk) => chunks.push(chunk));
    transform.on("end", () => resolve(Buffer.concat(chunks)));
    transform.on("error", reject);
    transform.end(slice);
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

/**
 * 解**恰好第一帧**的同步助手（保留给单帧调用方）。
 *
 * **不再直接返回 node 的 `zstdDecompressSync`**：该函数「只解首帧」是旧行为，
 * v24.22 起改为解完全部帧（实测两帧输入 → `first\nsecond\n`）。直接外露它，
 * 同一个调用在不同 Node 上会得到不同长度——与 `decompressZstdStream` 修复前
 * 的同类版本漂移。故此处用 frameLength 切出首帧再解，契约在任何版本上都成立。
 */
export function createZstdDecompressSync() {
  if (typeof zstdDecompressSync !== "function") {
    throw new Error("Node zlib zstd decompression is unavailable in this runtime");
  }
  return function decompressFirstFrameSync(buffer) {
    const parsed = frameLength(buffer, 0);
    if (parsed === null) {
      // 首帧不可判定时退回原生实现：保持既有「非法输入由 zlib 报错」的语义。
      return zstdDecompressSync(buffer);
    }
    return zstdDecompressSync(buffer.subarray(0, parsed.length));
  };
}
