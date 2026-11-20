import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertWebDist } from "../scripts/require-web-dist.mjs";

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
