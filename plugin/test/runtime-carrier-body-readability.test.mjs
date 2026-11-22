import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const PLUGIN_ROOT = join(import.meta.dirname, "..");

const MODULE_CLOSURE = Object.freeze([
  "source-recall.js",
  "recall-injection.js",
  "recall-criteria.js",
  "friction-writer.js",
  "signature-channel.js",
  "after-integrity.js",
  "object-identifier.js",
  "object-reference.js",
  "carrier-scan.js",
  "markdown-structure.js",
  "write-diagnostics.js",
  "coherence-report.js",
  "norm-positioning.js",
  "runtime-carrier-reader.js",
]);

const BODY_MARKER = "ENTRY-BODY-MARKER-ONLY-IN-THE-CARRIER-FILE-4C1D";

const QUERY = "写一条火花记录";

function carrierYaml() {
  return [
    "ldvh_spec:",
    "  spec_key: spark-fact-type",
    "  spec_kind: spec",
    "  title: 火花",
    "  canonical_path: plugin-specs/spark-fact-type.yaml",
    "  positioning: 管火花记录这一事实对象的形态与写入条件",
    "  scope: 要新建或修改火花记录时查阅本文件",
    "  requirements:",
    "    - id: carrier-shell",
    "      title: 载体外壳",
    "      text: |",
    `        火花记录须有唯一标识与正文。${BODY_MARKER}`,
    "",
  ].join("\n");
}

async function withTemp(prefix, fn) {
  const base = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

async function withInstallShape(fn) {
  await withTemp("carrier-body-install-", async (base) => {
    const packageRoot = join(base, "node_modules", "dsh-ldvh", "plugin");
    await mkdir(join(packageRoot, "lib"), { recursive: true });
    for (const name of MODULE_CLOSURE) {
      await cp(join(PLUGIN_ROOT, "lib", name), join(packageRoot, "lib", name));
    }
    await mkdir(join(packageRoot, "node_modules"), { recursive: true });
    await cp(join(PLUGIN_ROOT, "node_modules", "yaml"), join(packageRoot, "node_modules", "yaml"), {
      recursive: true,
    });
    const carrierDir = join(packageRoot, "plugin-specs");
    await mkdir(carrierDir, { recursive: true });
    await writeFile(join(carrierDir, "spark-fact-type.yaml"), carrierYaml(), "utf8");
    const projectRoot = join(base, "project");
    await mkdir(projectRoot, { recursive: true });
    const modules = {
      reader: await import(pathToFileURL(join(packageRoot, "lib", "runtime-carrier-reader.js")).href),
      recall: await import(pathToFileURL(join(packageRoot, "lib", "source-recall.js")).href),
      injection: await import(pathToFileURL(join(packageRoot, "lib", "recall-injection.js")).href),
    };
    return await fn({ packageRoot, projectRoot, modules });
  });
}

function injectedRowOf(text) {
  return text.split("\n").find((line) => line.startsWith("- 载体条目：") && line.includes("spec_key=spark-fact-type"));
}

test("包内安装形态：注入行路径打开的就是注入行点名的那份载体（spec_key 相同，正文只在文件里）", async () => {
  await withInstallShape(async ({ packageRoot, projectRoot, modules }) => {
    const result = await modules.recall.recallForAction({
      action: QUERY,
      root: projectRoot,
      includeSpecs: false,
      limit: 3,
      budgetBytes: 8000,
    });
    const text = modules.injection.renderRecallRow(result);
    const row = injectedRowOf(text);
    assert.notEqual(row, undefined, "该查询须召回 Spark 载体");
    const match = /实读=([^；）]+)/.exec(row);
    assert.notEqual(match, null, "包内形态的注入行须带可直接打开的绝对路径");
    const injectedPath = match[1].trim();
    const realPackageRoot = await realpath(packageRoot);
    assert.equal(
      injectedPath.startsWith(join(realPackageRoot, "plugin-specs")),
      true,
      `注入行路径须落在插件包内：${injectedPath}`,
    );
    const opened = await readFile(injectedPath, "utf8");
    assert.match(opened, /spec_key: spark-fact-type/, "打开的文件须确实是注入行点名的那份载体");
    assert.equal(opened.includes(BODY_MARKER), true, "打开须读到该载体的条目正文");
    assert.equal(text.includes(BODY_MARKER), false, "注入文本不得带条目正文");
  });
});

test("项目内形态：注入行相对路径按项目根打开的就是点名的那份载体", async () => {
  await withTemp("carrier-body-project-", async (projectRoot) => {
    const carrierDir = join(projectRoot, "plugin-specs");
    await mkdir(carrierDir, { recursive: true });
    await writeFile(join(carrierDir, "spark-fact-type.yaml"), carrierYaml(), "utf8");
    const recall = await import("../lib/source-recall.js");
    const injection = await import("../lib/recall-injection.js");
    const result = await recall.recallForAction({
      action: QUERY,
      root: projectRoot,
      includeSpecs: false,
      limit: 3,
      budgetBytes: 8000,
    });
    assert.equal(result.runtimeCarriers.tier, "project");
    const text = injection.renderRecallRow(result);
    const row = injectedRowOf(text);
    assert.notEqual(row, undefined);
    assert.equal(/实读=/.test(row), false, "项目内形态不重复给绝对路径");
    assert.match(row, /plugin-specs\/spark-fact-type\.yaml/);
    const opened = await readFile(join(projectRoot, "plugin-specs", "spark-fact-type.yaml"), "utf8");
    assert.match(opened, /spec_key: spark-fact-type/);
    assert.equal(opened.includes(BODY_MARKER), true);
    assert.equal(text.includes(BODY_MARKER), false);
  });
});

test("包内安装形态：按注入行路径调 readRuntimeCarrier 拿到该载体条目正文", async () => {
  await withInstallShape(async ({ projectRoot, modules }) => {
    const index = await modules.reader.loadRuntimeCarrierIndex({ root: projectRoot });
    assert.equal(index.tier, "package");
    const injectedPath = index.carriers.find((carrier) => carrier.specKey === "spark-fact-type")?.readablePath;
    assert.equal(typeof injectedPath, "string");
    const read = await modules.reader.readRuntimeCarrier({ root: projectRoot, path: injectedPath });
    assert.equal(read.ok, true, JSON.stringify(read.error));
    assert.equal(read.carrier.readablePath, injectedPath);
    assert.equal(
      read.carrier.requirements.some((entry) => entry.text.includes(BODY_MARKER)),
      true,
      "按该路径读全文须真的读到条目正文",
    );
  });
});
