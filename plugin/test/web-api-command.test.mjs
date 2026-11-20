import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWebApiCommand } from "../lib/index.js";

function fixture({ source = false, compiled = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ldvh-web-cmd-"));
  if (source) {
    mkdirSync(join(root, "api"), { recursive: true });
    writeFileSync(join(root, "api", "server.ts"), "// source");
  }
  if (compiled) {
    mkdirSync(join(root, "api-js"), { recursive: true });
    writeFileSync(join(root, "api-js", "server.js"), "// compiled");
  }
  return root;
}

test("源码态（tsx 可用且有源码）选 tsx 源码命令，保住热重载", () => {
  const root = fixture({ source: true, compiled: true });
  const { mode, command } = resolveWebApiCommand(root, { hasTsx: true });
  assert.equal(mode, "source");
  assert.deepEqual(command.argv, ["--import", "tsx", "api/server.ts"]);
});

test("发布态（无 tsx）选编译产物命令", () => {
  const root = fixture({ source: true, compiled: true });
  const { mode, command } = resolveWebApiCommand(root, { hasTsx: false });
  assert.equal(mode, "compiled");
  assert.deepEqual(command.argv, ["api-js/server.js"]);
});

test("有 tsx 但无源码时回退编译产物", () => {
  const root = fixture({ compiled: true });
  assert.equal(resolveWebApiCommand(root, { hasTsx: true }).mode, "compiled");
});

test("选择只由 tsx 与源码决定，不受编译产物存在与否干扰", () => {
  const withCompiled = fixture({ source: true, compiled: true });
  const withoutCompiled = fixture({ source: true });
  assert.equal(resolveWebApiCommand(withCompiled, { hasTsx: true }).mode, "source");
  assert.equal(resolveWebApiCommand(withoutCompiled, { hasTsx: true }).mode, "source");
});
