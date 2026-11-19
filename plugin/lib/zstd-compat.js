
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

function frameLength(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  if (!isMagic(buffer, offset)) return null;
  let cursor = offset + 4;
  if (cursor >= buffer.length) return null;
  const descriptor = buffer[cursor];
  cursor += 1;

  const fcsFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const reserved = (descriptor >> 3) & 1;
  const checksumFlag = (descriptor >> 2) & 1;
  const dictIdFlag = descriptor & 0x03;
  if (reserved !== 0) return null;

  if (!singleSegment) {
    if (cursor >= buffer.length) return null;
    cursor += 1;
  }

  const dictIdBytes = [0, 1, 2, 4][dictIdFlag];
  if (cursor + dictIdBytes > buffer.length) return null;
  cursor += dictIdBytes;

  const fcsBytes = fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
  if (cursor + fcsBytes > buffer.length) return null;
  cursor += fcsBytes;

  for (;;) {
    if (cursor + 3 > buffer.length) return null;
    const header = buffer[cursor] | (buffer[cursor + 1] << 8) | (buffer[cursor + 2] << 16);
    const lastBlock = header & 1;
    const blockType = (header >> 1) & 0x03;
    const blockSize = header >> 3;
    cursor += 3;
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

async function walkFrames(buffer) {
  const chunks = [];
  let position = 0;
  let torn = false;
  while (position <= buffer.length - 4) {
    if (!isMagic(buffer, position)) {
      const candidate = nextMagic(buffer, position);
      if (candidate === -1) break;
      position = candidate;
      continue;
    }
    const parsed = frameLength(buffer, position);
    if (parsed === null) {
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
      const following = nextMagic(buffer, position + 1);
      if (following === -1) {
        torn = true;
        break;
      }
      position = following;
      continue;
    }
    if (out === null || out.length === 0) {
      torn = true;
      break;
    }
    chunks.push(out);
    position += parsed.length;
  }
  return { chunks, torn };
}

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

export async function decompressZstdStream(buffer) {
  if (buffer.length === 0) return Buffer.alloc(0);
  if (!isMagic(buffer, 0)) throw new Error("input does not start with a zstd frame magic");
  const { chunks } = await walkFrames(buffer);
  if (chunks.length === 0) throw new Error("no zstd frame in the stream decompressed");
  return Buffer.concat(chunks);
}

export function createZstdDecompressSync() {
  if (typeof zstdDecompressSync !== "function") {
    throw new Error("Node zlib zstd decompression is unavailable in this runtime");
  }
  return function decompressFirstFrameSync(buffer) {
    const parsed = frameLength(buffer, 0);
    if (parsed === null) {
      return zstdDecompressSync(buffer);
    }
    return zstdDecompressSync(buffer.subarray(0, parsed.length));
  };
}
