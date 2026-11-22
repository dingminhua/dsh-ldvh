import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundlePlan, cleanBundles, copyBundles } from "../scripts/specs-bundle.mjs";
import { RUNTIME_CARRIER_DIR } from "../lib/runtime-carrier-reader.js";
import {
  RECALL_CRITERIA_VERSION,
  loadRecallCriteria,
  loadRecallCriteriaBundle,
  parseRecallCriteriaTable,
} from "../lib/recall-criteria.js";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function yamlNamesOf(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
}

function criteriaTable({ status, core, alias, relations }) {
  return [
    "| 判据项（recall-criteria/v1） | 本类型规则 | 机械值 | 依据/理由 |",
    "|---|---|---|---|",
    "| 召回时机 | 任意 |  | 说明 |",
    `| 默认候选状态 | 见机械值 | ${status} | 说明 |`,
    `| 核心语义字段 | 见机械值 | ${core} | 说明 |`,
    `| 类型词别名 | 见机械值 | ${alias} | 说明 |`,
    `| 关系展开 | 见机械值 | ${relations} | 说明 |`,
    "| F3/F4 展开 | 不采用 |  | 说明 |",
    "| 条数上限归属 | 不采用 | 不采用 | 说明 |",
  ].join("\n");
}

function makeFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "ldvh-specs-bundle-repo-"));
  const packageRoot = mkdtempSync(join(tmpdir(), "ldvh-specs-bundle-pkg-"));
  mkdirSync(join(repoRoot, "specs"), { recursive: true });
  writeFileSync(join(repoRoot, "specs", "01-demo.md"), "# demo\n");
  writeFileSync(
    join(repoRoot, "specs", "20-Goal-项目目标.md"),
    `# 目标\n\n${criteriaTable({ status: "不采用", core: "不采用", alias: "不采用", relations: "不采用" })}\n`,
  );
  writeFileSync(
    join(repoRoot, "specs", "22-Spark-火花.md"),
    `# 火花\n\n${criteriaTable({ status: "open", core: "question, summary", alias: "火花", relations: "merged-into->spark" })}\n`,
  );
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
  assert.equal(existsSync(join(packageRoot, "specs", "01-demo.md")), false);
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
  assert.equal(existsSync(join(packageRoot, ".plugin-specs-bundle-stamp")), true);
  assert.equal(existsSync(join(packageRoot, ".recall-criteria-bundle-stamp")), true);
  assert.equal(existsSync(join(packageRoot, ".specs-bundle-stamp")), false);
  assert.equal(existsSync(join(packageRoot, "specs")), false);
  assert.equal(existsSync(join(packageRoot, "lib", "recall-criteria.bundle.json")), true);
});

test("the bundle plan carries only the runtime carriers and the generated criteria data file, never the authoring specs", () => {
  const { repoRoot, packageRoot } = makeFixture();
  const plan = bundlePlan({ repoRoot, packageRoot });
  assert.deepEqual(plan.map((bundle) => bundle.name), ["runtime-carriers", "recall-criteria"]);
  assert.deepEqual(plan.map((bundle) => bundle.kind), ["copy", "generate"]);
  const carrierBundle = plan.find((bundle) => bundle.name === "runtime-carriers");
  const criteriaBundle = plan.find((bundle) => bundle.name === "recall-criteria");
  assert.equal(carrierBundle.bundledRoot, join(packageRoot, RUNTIME_CARRIER_DIR));
  assert.equal(criteriaBundle.sourceRoot, join(repoRoot, "specs"));
  assert.equal(criteriaBundle.targetPath, join(packageRoot, "lib", "recall-criteria.bundle.json"));
  assert.equal(criteriaBundle.stampPath, join(packageRoot, ".recall-criteria-bundle-stamp"));
  assert.equal(plan.some((bundle) => bundle.bundledRoot === join(packageRoot, "specs")), false);
  assert.equal(plan.some((bundle) => bundle.targetPath === join(packageRoot, "specs")), false);
  assert.equal(plan.some((bundle) => basename(bundle.bundledRoot ?? bundle.targetPath) === "specs"), false);
});

test("packing leaves the authoring specs out of the package entirely", async () => {
  const { repoRoot, packageRoot } = makeFixture();
  await copyBundles({ repoRoot, packageRoot });
  assert.equal(existsSync(join(packageRoot, "specs")), false);
  assert.equal(existsSync(join(packageRoot, RUNTIME_CARRIER_DIR)), true);
  assert.equal(existsSync(join(packageRoot, "lib", "recall-criteria.bundle.json")), true);
  assert.deepEqual(
    readdirSync(packageRoot).sort(),
    [".plugin-specs-bundle-stamp", ".recall-criteria-bundle-stamp", "lib", RUNTIME_CARRIER_DIR].sort(),
  );
});

test("clean removes the copied corpora and stamps after packing", async () => {
  const { repoRoot, packageRoot } = makeFixture();
  await copyBundles({ repoRoot, packageRoot });
  await cleanBundles({ packageRoot });
  for (const path of [
    join(packageRoot, "specs"),
    join(packageRoot, RUNTIME_CARRIER_DIR),
    join(packageRoot, "lib", "recall-criteria.bundle.json"),
    join(packageRoot, ".specs-bundle-stamp"),
    join(packageRoot, ".plugin-specs-bundle-stamp"),
    join(packageRoot, ".recall-criteria-bundle-stamp"),
  ]) {
    assert.equal(existsSync(path), false, path);
  }
  assert.deepEqual(readdirSync(packageRoot).filter((name) => name !== "lib"), []);
  assert.deepEqual(readdirSync(join(packageRoot, "lib")), []);
});

test("clean leaves an unstamped directory untouched", async () => {
  const { packageRoot } = makeFixture();
  mkdirSync(join(packageRoot, RUNTIME_CARRIER_DIR), { recursive: true });
  writeFileSync(join(packageRoot, RUNTIME_CARRIER_DIR, "handwritten.yaml"), "kept\n");
  await cleanBundles({ packageRoot });
  assert.equal(existsSync(join(packageRoot, RUNTIME_CARRIER_DIR, "handwritten.yaml")), true);
});

test("package manifest lists the in-package carrier directory and not the authoring specs", () => {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  assert.equal(manifest.files.includes(RUNTIME_CARRIER_DIR), true);
  assert.equal(manifest.files.includes("specs"), false);
  assert.equal(manifest.files.some((entry) => entry === "specs" || entry.startsWith("specs/")), false);
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


test("the generated criteria data file carries exactly the values parsed from the authoring specs", async () => {
  const { repoRoot, packageRoot } = makeFixture();
  await copyBundles({ repoRoot, packageRoot });
  const bundleFile = join(packageRoot, "lib", "recall-criteria.bundle.json");
  const raw = JSON.parse(readFileSync(bundleFile, "utf8"));
  assert.equal(raw.version, RECALL_CRITERIA_VERSION);
  assert.deepEqual(Object.keys(raw.types).sort(), ["goal", "spark"]);

  const specsDir = join(repoRoot, "specs");
  const loaded = await loadRecallCriteriaBundle(bundleFile);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
  assert.equal(loaded.tier, "package-data");
  assert.equal(loaded.fingerprint, raw.fingerprint);
  for (const [type, entry] of Object.entries(raw.types)) {
    const name = readdirSync(specsDir).find((file) => file.startsWith(`${entry.specId}-`));
    const parser = parseRecallCriteriaTable(readFileSync(join(specsDir, name), "utf8"), {
      file: `specs/${name}`,
      specId: entry.specId,
      type,
    });
    assert.equal(parser.ok, true, name);
    assert.deepEqual(loaded.byType.get(type).values, parser.values, `生成物与规范源逐值不符：${type}`);
  }
});

test("the real repository criteria data file matches every value the parser reads from specs/", async () => {
  const repoRoot = dirname(pluginRoot);
  const packageRoot = mkdtempSync(join(tmpdir(), "ldvh-specs-bundle-criteria-real-"));
  await copyBundles({ repoRoot, packageRoot });
  const bundleFile = join(packageRoot, "lib", "recall-criteria.bundle.json");

  const fromSpecs = await loadRecallCriteria(join(repoRoot, "specs"));
  const fromBundle = await loadRecallCriteriaBundle(bundleFile);
  assert.equal(fromSpecs.ok, true);
  assert.equal(fromBundle.ok, true, JSON.stringify(fromBundle.errors));
  assert.equal(fromBundle.tier, "package-data");
  assert.equal(fromBundle.fingerprint, fromSpecs.fingerprint, "指纹须与规范源同法计算");
  assert.deepEqual([...fromBundle.byType.keys()].sort(), [...fromSpecs.byType.keys()].sort());
  for (const [type, table] of fromSpecs.byType) {
    assert.deepEqual(fromBundle.byType.get(type).values, table.values, `生成物与 specs/ 逐值不符：${type}`);
  }
});
