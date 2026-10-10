// D8 回归护栏：模块内被当变量使用的名字，必须确有声明。
//
// 形态：`lifecycle.js` 曾写 `currentRouteValues(sessionPersistence?.(), agent)`，
// 而 `sessionPersistence` 在该文件里**只是别处对象的属性名**，从未声明为变量。
// 该行**每次都抛 ReferenceError**，异常被执行体收口成日志，运行载体上不留痕——
// 外观与「机制没跑」完全相同。单元测试抓不到它：只要那条路径在测试里未被走到。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

test("D8：lifecycle.js 不得把未声明的名字当变量使用", async () => {
  const raw = await readFile(join(LIB, "lifecycle.js"), "utf8");
  const text = raw.split("\n").map((l) => (l.trimStart().startsWith("//") ? "" : l)).join("\n");

  // 该行须经 ctx.get 取服务，而不是引用一个裸名字
  assert.ok(
    !/currentRouteValues\(\s*sessionPersistence\?\.\(\)/.test(text),
    "lifecycle.js 又出现了 `currentRouteValues(sessionPersistence?.())` —— " +
      "sessionPersistence 在本文件里只是属性名，不是变量，该行会抛 ReferenceError（D8）",
  );
  assert.match(
    text,
    /currentRouteValues\(\s*ctx\.get\("sessionPersistence"\)/,
    "须经 ctx.get(\"sessionPersistence\") 取服务（与 ldvh-tools 等模块同形）",
  );
});

test("D8：其它模块经 deps 取该服务的形态未被波及（回归对照）", async () => {
  for (const f of ["adr-tools.js", "friction-tools.js", "ldvh-tools.js"]) {
    const raw = await readFile(join(LIB, f), "utf8");
    assert.match(raw, /deps\.sessionPersistence\?\.\(\)/, `${f} 的既有正确形态不得被改动`);
  }
});

test("D8 类检测：模块内以 `X?.(` 形态使用的名字须有声明", async () => {
  // 保守检测：只就该文件实际用到的可疑名做判定，避免误报
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
      new RegExp(`\\bfrom\\s+["'][^"']+["']`).test("") ; // import 形式另判
    const imported = new RegExp(`import[\\s\\S]{0,400}?\\b${name}\\b[\\s\\S]{0,80}?from`).test(text);
    assert.ok(declared || imported, `lifecycle.js 使用了未声明的 \`${name}?.\``);
  }
});
