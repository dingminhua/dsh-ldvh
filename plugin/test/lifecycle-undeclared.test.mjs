import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

test("D8：lifecycle.js 不得把未声明的名字当变量使用", async () => {
  const raw = await readFile(join(LIB, "lifecycle.js"), "utf8");
  const text = raw.split("\n").map((l) => (l.trimStart().startsWith("//") ? "" : l)).join("\n");

  assert.ok(
    !/currentRouteValues\(\s*sessionPersistence\?\.\(\)/.test(text),
    "lifecycle.js 又出现了 `currentRouteValues(sessionPersistence?.())` —— " +
      "sessionPersistence 在本文件里只是属性名，不是变量，该行会抛 ReferenceError（D8）",
  );
  assert.ok(
    !/currentRouteValues\(/.test(text),
    "lifecycle.js 不得再自行取路由：落账署名须来自执行体（09 §5.1「当次实际」）",
  );
  assert.match(
    text,
    /ctx\.get\("sessionPersistence"\)/,
    "provider 构造处仍须经 ctx.get(\"sessionPersistence\") 取服务（与 ldvh-tools 等模块同形）",
  );
});

test("D8：其它模块经 deps 取该服务的形态未被波及（回归对照）", async () => {
  for (const f of ["friction-tools.js", "ldvh-tools.js"]) {
    const raw = await readFile(join(LIB, f), "utf8");
    assert.match(raw, /deps\.sessionPersistence\?\.\(\)/, `${f} 的既有正确形态不得被改动`);
  }
});

test("D8 类检测：模块内以 `X?.(` 形态使用的名字须有声明", async () => {
  const raw = await readFile(join(LIB, "lifecycle.js"), "utf8");
  const text = raw.split("\n").map((l) => (l.trimStart().startsWith("//") ? "" : l)).join("\n");
  const used = new Set();
  for (const m of text.matchAll(/(^|[^.\w$])([a-zA-Z_$][\w$]*)\?\.\(/g)) used.add(m[2]);
  for (const name of used) {
    const declared =
      new RegExp(`\\b(const|let|var)\\s+${name}\\b`).test(text) ||
      new RegExp(`\\bfunction\\s+${name}\\b`).test(text) ||
      new RegExp(`[({,]\\s*${name}\\s*[,}=)]`).test(text) ||
      new RegExp(`${name}\\s*[,=]\\s*(async\\s*)?(\\(|function|\\{|null|undefined)`).test(text) ||
      new RegExp(`\\bfrom\\s+["'][^"']+["']`).test("") ;
    const imported = new RegExp(`import[\\s\\S]{0,400}?\\b${name}\\b[\\s\\S]{0,80}?from`).test(text);
    assert.ok(declared || imported, `lifecycle.js 使用了未声明的 \`${name}?.\``);
  }
});
