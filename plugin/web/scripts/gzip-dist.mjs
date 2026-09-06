/**
 * build:dsh 后处理：为 dist 静态资产生成 .gz 预压缩副本（零依赖，node:zlib）。
 * spaHandler 在 Accept-Encoding: gzip 时优先返回 .gz（Content-Encoding: gzip）。
 * 动态 API 压缩由 Express compression 中间件负责（api/app.ts）。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist', import.meta.url).pathname;
const GZIP_EXTENSIONS = ['.js', '.css', '.html', '.svg', '.json'];

async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collect(full));
    else if (GZIP_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith('.gz')) out.push(full);
  }
  return out;
}

const files = await collect(dist);
let total = 0;
let saved = 0;
for (const file of files) {
  const original = await readFile(file);
  const compressed = gzipSync(original, { level: 9 });
  await writeFile(`${file}.gz`, compressed);
  total += original.length;
  saved += original.length - compressed.length;
}
console.log(`gzip: ${files.length} files, ${(total / 1024).toFixed(0)}KB -> saved ${(saved / 1024).toFixed(0)}KB (${((saved / total) * 100).toFixed(0)}%)`);
