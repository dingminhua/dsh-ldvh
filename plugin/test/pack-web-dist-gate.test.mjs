import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertWebDist, assertWebApi } from "../scripts/require-web-dist.mjs";

const DEPS = { express: "*", cors: "*", compression: "*", dotenv: "*", "js-yaml": "*" };

function makeFixture({ api = true, shared = true, deps = true, files = true, npmignore = true, tsx = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ldvh-pack-gate-"));
  mkdirSync(join(root, "web", "dist"), { recursive: true });
  writeFileSync(join(root, "web", "dist", "index.html"), "<!doctype html>");
  if (api) {
    mkdirSync(join(root, "web", "api-js"), { recursive: true });
    writeFileSync(join(root, "web", "api-js", "server.js"), "// server");
  }
  if (shared) mkdirSync(join(root, "web", "shared-js"), { recursive: true });
  if (npmignore) writeFileSync(join(root, "web", ".npmignore"), "node_modules\n");
  const dependencies = deps ? { ...DEPS } : {};
  if (tsx) dependencies.tsx = "*";
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies, files: files ? ["web/dist", "web/api-js", "web/shared-js"] : [] }),
  );
  return root;
}

test("pack gate refuses when web/dist/index.html is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "ldvh-pack-gate-"));
  assert.throws(() => assertWebDist(root), /pack gate/);
});

test("pack gate passes when web/dist/index.html is present", () => {
  const root = mkdtempSync(join(tmpdir(), "ldvh-pack-gate-"));
  mkdirSync(join(root, "web", "dist"), { recursive: true });
  writeFileSync(join(root, "web", "dist", "index.html"), "<!doctype html>");
  assert.equal(assertWebDist(root), join(root, "web", "dist", "index.html"));
});

test("pack gate refuses when compiled web/api-js/server.js is absent", () => {
  assert.throws(() => assertWebApi(makeFixture({ api: false })), /api-js\/server\.js/);
});

test("pack gate refuses when web/shared-js is absent", () => {
  assert.throws(() => assertWebApi(makeFixture({ shared: false })), /web\/shared-js/);
});

test("pack gate refuses when a runtime dependency is not declared", () => {
  const root = makeFixture();
  const p = join(root, "package.json");
  const d = JSON.parse(readFileSync(p, "utf8"));
  delete d.dependencies.express;
  writeFileSync(p, JSON.stringify(d));
  assert.throws(() => assertWebApi(root), /express/);
});

test("pack gate refuses when tsx is declared (esbuild build-script pitfall, issue #3)", () => {
  assert.throws(() => assertWebApi(makeFixture({ tsx: true })), /不应含 tsx/);
});

test("pack gate refuses when compiled dirs are not in files", () => {
  assert.throws(() => assertWebApi(makeFixture({ files: false })), /files 未列入 web\/dist/);
});

test("pack gate refuses when web/dist is not in files even though the directory exists", () => {
  const root = makeFixture();
  const p = join(root, "package.json");
  const d = JSON.parse(readFileSync(p, "utf8"));
  d.files = ["web/api-js", "web/shared-js"];
  writeFileSync(p, JSON.stringify(d));
  assert.throws(() => assertWebApi(root), /files 未列入 web\/dist/);
});

test("pack gate refuses when web/.npmignore is absent (#1 regression)", () => {
  assert.throws(() => assertWebApi(makeFixture({ npmignore: false })), /\.npmignore 不存在/);
});

test("pack gate passes when compiled entry, shared-js, deps, files and .npmignore are all present", () => {
  const root = makeFixture();
  assert.equal(assertWebApi(root), join(root, "web", "api-js", "server.js"));
});
