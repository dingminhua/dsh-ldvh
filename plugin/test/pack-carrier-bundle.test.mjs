import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundlePlan, cleanBundles, copyBundles } from "../scripts/specs-bundle.mjs";
import { RUNTIME_CARRIER_DIR } from "../lib/runtime-carrier-reader.js";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function yamlNamesOf(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
}

function makeFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "ldvh-specs-bundle-repo-"));
  const packageRoot = mkdtempSync(join(tmpdir(), "ldvh-specs-bundle-pkg-"));
  mkdirSync(join(repoRoot, "specs"), { recursive: true });
  writeFileSync(join(repoRoot, "specs", "01-demo.md"), "# demo\n");
  const carriers = join(repoRoot, "plugin-specs");
  mkdirSync(carriers, { recursive: true });
  writeFileSync(join(carriers, "alpha.yaml"), "ldvh_spec:\n  spec_key: alpha\n");
  writeFileSync(join(carriers, "beta.yaml"), "ldvh_spec:\n  spec_key: beta\n");
  writeFileSync(join(carriers, "gamma.draft.yaml"), "ldvh_spec:\n  spec_key: gamma\n");
  writeFileSync(join(carriers, "delta.yaml~"), "ldvh_spec:\n  spec_key: delta\n");
  writeFileSync(join(carriers, "epsilon.tmp"), "ldvh_spec:\n  spec_key: epsilon\n");
  writeFileSync(join(carriers, "zeta.bak.yaml"), "ldvh_spec:\n  spec_key: zeta\n");
  mkdirSync(join(carriers, "nested.draft"), { recursive: true });
  writeFileSync(join(carriers, "nested.draft", "eta.yaml"), "ldvh_spec:\n  spec_key: eta\n");
  return { repoRoot, packageRoot };
}

test("copies the runtime carriers into the package at the reader's package tier", async () => {
  const { repoRoot, packageRoot } = makeFixture();
  const plan = bundlePlan({ repoRoot, packageRoot });
  const carrierBundle = plan.find((bundle) => bundle.name === "runtime-carriers");
  const readerPackageTier = resolve(pluginRoot, "lib", "..", RUNTIME_CARRIER_DIR);
  assert.equal(carrierBundle.bundledRoot, join(packageRoot, RUNTIME_CARRIER_DIR));
  assert.equal(join(pluginRoot, RUNTIME_CARRIER_DIR), readerPackageTier);

  await copyBundles({ repoRoot, packageRoot });

  assert.deepEqual(yamlNamesOf(join(packageRoot, RUNTIME_CARRIER_DIR)), ["alpha.yaml", "beta.yaml"]);
  assert.equal(existsSync(join(packageRoot, "specs", "01-demo.md")), true);
});

test("excludes draft and temporary carrier files and directories from the copy", async () => {
  const { repoRoot, packageRoot } = makeFixture();
  await copyBundles({ repoRoot, packageRoot });
  const copied = readdirSync(join(packageRoot, RUNTIME_CARRIER_DIR)).sort();
  assert.deepEqual(copied, ["alpha.yaml", "beta.yaml"]);
  assert.equal(existsSync(join(packageRoot, RUNTIME_CARRIER_DIR, "nested.draft")), false);
});

test("copy replaces a stale in-package target and writes stamps", async () => {
  const { repoRoot, packageRoot } = makeFixture();
  mkdirSync(join(packageRoot, RUNTIME_CARRIER_DIR), { recursive: true });
  writeFileSync(join(packageRoot, RUNTIME_CARRIER_DIR, "stale.yaml"), "stale\n");
  await copyBundles({ repoRoot, packageRoot });
  assert.equal(existsSync(join(packageRoot, RUNTIME_CARRIER_DIR, "stale.yaml")), false);
  assert.equal(existsSync(join(packageRoot, ".specs-bundle-stamp")), true);
  assert.equal(existsSync(join(packageRoot, ".plugin-specs-bundle-stamp")), true);
});

test("clean removes the copied corpora and stamps after packing", async () => {
  const { repoRoot, packageRoot } = makeFixture();
  await copyBundles({ repoRoot, packageRoot });
  await cleanBundles({ packageRoot });
  for (const path of [
    join(packageRoot, "specs"),
    join(packageRoot, RUNTIME_CARRIER_DIR),
    join(packageRoot, ".specs-bundle-stamp"),
    join(packageRoot, ".plugin-specs-bundle-stamp"),
  ]) {
    assert.equal(existsSync(path), false, path);
  }
});

test("clean leaves an unstamped directory untouched", async () => {
  const { packageRoot } = makeFixture();
  mkdirSync(join(packageRoot, RUNTIME_CARRIER_DIR), { recursive: true });
  writeFileSync(join(packageRoot, RUNTIME_CARRIER_DIR, "handwritten.yaml"), "kept\n");
  await cleanBundles({ packageRoot });
  assert.equal(existsSync(join(packageRoot, RUNTIME_CARRIER_DIR, "handwritten.yaml")), true);
});

test("package manifest lists the in-package carrier directory", () => {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  assert.equal(manifest.files.includes(RUNTIME_CARRIER_DIR), true);
});

test("the repository carrier corpus is copied without losing any YAML carrier", async () => {
  const repoRoot = dirname(pluginRoot);
  const plan = bundlePlan({ repoRoot, packageRoot: pluginRoot });
  const carrierBundle = plan.find((bundle) => bundle.name === "runtime-carriers");
  assert.equal(carrierBundle.sourceRoot, join(repoRoot, RUNTIME_CARRIER_DIR));
  assert.equal(carrierBundle.bundledRoot, resolve(pluginRoot, "lib", "..", RUNTIME_CARRIER_DIR));
  const sourceNames = yamlNamesOf(carrierBundle.sourceRoot);
  assert.equal(sourceNames.length > 0, true);

  const packageRoot = mkdtempSync(join(tmpdir(), "ldvh-specs-bundle-real-"));
  await copyBundles({ repoRoot, packageRoot });
  assert.deepEqual(yamlNamesOf(join(packageRoot, RUNTIME_CARRIER_DIR)), sourceNames);
});
