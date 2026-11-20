import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertWebDist, assertWebApi } from "../scripts/require-web-dist.mjs";

const DEPS = { tsx: "*", express: "*", cors: "*", compression: "*", dotenv: "*", "js-yaml": "*" };

function makeFixture({ api = true, shared = true, deps = true, files = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ldvh-pack-gate-"));
  mkdirSync(join(root, "web", "dist"), { recursive: true });
  writeFileSync(join(root, "web", "dist", "index.html"), "<!doctype html>");
  if (api) {
    mkdirSync(join(root, "web", "api"), { recursive: true });
    writeFileSync(join(root, "web", "api", "server.ts"), "// server");
  }
  if (shared) mkdirSync(join(root, "web", "shared"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: deps ? DEPS : {}, files: files ? ["web/api", "web/shared"] : [] }),
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

test("pack gate refuses when web/api/server.ts is absent", () => {
  assert.throws(() => assertWebApi(makeFixture({ api: false })), /api\/server\.ts/);
});

test("pack gate refuses when web/shared is absent", () => {
  assert.throws(() => assertWebApi(makeFixture({ shared: false })), /web\/shared/);
});

test("pack gate refuses when a runtime dependency is not declared", () => {
  const root = makeFixture();
  const p = join(root, "package.json");
  const d = JSON.parse(readFileSync(p, "utf8"));
  delete d.dependencies.tsx;
  writeFileSync(p, JSON.stringify(d));
  assert.throws(() => assertWebApi(root), /tsx/);
});

test("pack gate refuses when web/api or web/shared is not in files", () => {
  assert.throws(() => assertWebApi(makeFixture({ files: false })), /files 未列入 web\/api/);
});

test("pack gate passes when backend entry, shared, deps and files are all present", () => {
  const root = makeFixture();
  assert.equal(assertWebApi(root), join(root, "web", "api", "server.ts"));
});
