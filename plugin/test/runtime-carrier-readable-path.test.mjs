import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { pluginRoot, withTemp } from "./helpers.mjs";
import {
  RUNTIME_CARRIER_INJECTION_BYTES,
  RUNTIME_CARRIER_INJECTION_MAX,
  renderRecallRow,
} from "../lib/recall-injection.js";

const RECALL_MODULE_CLOSURE = Object.freeze([
  "source-recall.js",
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
  "recall-injection.js",
]);

const CARRIER_SOURCE_DIR = join(pluginRoot, "..", "plugin-specs");

const SPARK_KEY = "spark-fact-type";
const SPARK_CANONICAL = `plugin-specs/${SPARK_KEY}.yaml`;
const SPARK_QUERY = "写一条火花记录";

async function carrierNames() {
  const entries = await readdir(CARRIER_SOURCE_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name);
}

async function copyCarrierCorpus(targetDir) {
  await mkdir(targetDir, { recursive: true });
  for (const name of await carrierNames()) {
    await cp(join(CARRIER_SOURCE_DIR, name), join(targetDir, name));
  }
}

async function installShapedModules(base) {
  await mkdir(join(base, "lib"), { recursive: true });
  for (const name of RECALL_MODULE_CLOSURE) {
    await cp(join(pluginRoot, "lib", name), join(base, "lib", name));
  }
  await mkdir(join(base, "node_modules"), { recursive: true });
  await cp(join(pluginRoot, "node_modules", "yaml"), join(base, "node_modules", "yaml"), { recursive: true });
}

async function importInstalled(base) {
  const reader = await import(pathToFileURL(join(base, "lib", "runtime-carrier-reader.js")).href);
  const injection = await import(pathToFileURL(join(base, "lib", "recall-injection.js")).href);
  return { reader, injection };
}

function carrierRowsOf(text) {
  return text.split("\n").filter((line) => line.startsWith("- 载体条目："));
}

function readablePathOfRow(row) {
  const match = /实读=([^）]+)/.exec(row);
  return match === null ? null : match[1].trim();
}

test("包内安装形态：注入行给出可直接打开的绝对路径，普通读文件与按路径读载体都能取到条目正文", async () => {
  await withTemp("ldvh-carrier-package-", async (base) => {
    await installShapedModules(base);
    await copyCarrierCorpus(join(base, "plugin-specs"));
    const project = join(base, "project");
    await mkdir(project, { recursive: true });
    await mkdir(join(project, "ldvh-base", "pitfalls"), { recursive: true });

    const { reader, injection } = await importInstalled(base);

    assert.equal(
      (await readdir(join(project, "plugin-specs")).catch(() => null)),
      null,
      "前提：项目根没有 plugin-specs/，否则本条测的不是包内形态",
    );
    assert.equal(
      (await reader.resolveRuntimeCarrierRoot(project)).tier,
      "package",
      "项目内无 plugin-specs/ 时须落到包内副本",
    );

    const matched = await reader.matchRuntimeCarriers({ root: project, query: SPARK_QUERY });
    assert.equal(matched.tier, "package", "包内形态须如实标为 package");
    const candidate = matched.carriers.find((carrier) => carrier.specKey === SPARK_KEY);
    assert.notEqual(candidate, undefined, "该查询须召回 Spark 载体");
    assert.equal(candidate.carrierRootTier, "package");
    assert.equal(candidate.readablePathKind, "absolute", "包内形态下相对项目根的路径读不到，须给绝对路径");
    assert.equal(isAbsolute(candidate.readablePath), true);
    assert.equal(candidate.readablePath, candidate.absolutePath);
    assert.ok(
      candidate.readablePath.endsWith(join("plugin-specs", `${SPARK_KEY}.yaml`)),
      `包内路径须落在插件包内：${candidate.readablePath}`,
    );
    assert.equal(candidate.path, candidate.readablePath, "候选的 path 须是可读路径，而不是读不到的项目内相对路径");

    const rawText = await readFile(candidate.readablePath, "utf8");
    assert.ok(rawText.includes("ldvh_spec"), "注入行给出的路径须能用普通文件读取手段打开");

    const read = await reader.readRuntimeCarrier({ root: project, path: candidate.readablePath });
    assert.equal(read.ok, true, `按注入路径须能读到载体：${JSON.stringify(read.error ?? {})}`);
    assert.equal(read.carrier.specKey, SPARK_KEY);
    assert.equal(read.carrier.carrierRootTier, "package", "读入口须回报解析来源（包内）");
    assert.ok(read.carrier.requirements.length > 0);
    for (const entry of read.carrier.requirements) {
      assert.equal(typeof entry.text, "string");
      assert.ok(entry.text.trim() !== "", "按路径读到的条目须带正文");
    }

    const byCanonical = await reader.readRuntimeCarrier({ root: project, canonicalPath: SPARK_CANONICAL });
    assert.equal(byCanonical.ok, true, "canonical_path 在包内形态下仍须可读（按包根解析）");

    const injected = await injection.buildRecallInjection({
      userText: `帮我${SPARK_QUERY}`,
      projectRoot: project,
      budgetBytes: 2400,
      limit: 3,
    });
    assert.equal(injected.inject, true, `包内形态须仍产出注入：${injected.reason ?? ""}`);
    assert.match(injected.text, /^运行时机制：$/m, "段头保持「运行时机制：」");
    const rows = carrierRowsOf(injected.text);
    assert.ok(rows.length >= 1);
    const rowWithSpark = rows.find((row) => row.includes(`spec_key=${SPARK_KEY}`));
    assert.notEqual(rowWithSpark, undefined, `注入行须包含 Spark 载体：${injected.text}`);
    const rowPath = readablePathOfRow(rowWithSpark);
    assert.notEqual(rowPath, null, `包内形态的注入行须带 实读= 绝对路径：${rowWithSpark}`);
    assert.ok(isAbsolute(rowPath));
    await readFile(rowPath, "utf8");
    assert.equal(rowWithSpark.includes("SECRET"), false);

    const injectedRead = await reader.readRuntimeCarrier({ root: project, path: rowPath });
    assert.equal(injectedRead.ok, true, "注入行给出的路径须能直接驱动载体读取");
    assert.ok(
      injectedRead.carrier.requirements.some((entry) => entry.text.trim() !== ""),
      "注入行 → 读取的闭环须真的取到条目正文",
    );
  });
});

test("项目内形态：注入行沿用仓库相对路径，且该路径可直接打开", async () => {
  await withTemp("ldvh-carrier-project-", async (base) => {
    await installShapedModules(base);
    await copyCarrierCorpus(join(base, "plugin-specs"));
    const project = join(base, "project");
    await copyCarrierCorpus(join(project, "plugin-specs"));
    await mkdir(join(project, "ldvh-base", "pitfalls"), { recursive: true });

    const { reader, injection } = await importInstalled(base);

    const resolved = await reader.resolveRuntimeCarrierRoot(project);
    assert.equal(resolved.tier, "project", "项目内 plugin-specs/ 须优先于包内副本");

    const matched = await reader.matchRuntimeCarriers({ root: project, query: SPARK_QUERY });
    const candidate = matched.carriers.find((carrier) => carrier.specKey === SPARK_KEY);
    assert.notEqual(candidate, undefined);
    assert.equal(candidate.carrierRootTier, "project");
    assert.equal(candidate.readablePathKind, "project-relative");
    assert.equal(candidate.readablePath, SPARK_CANONICAL);
    assert.equal(isAbsolute(candidate.readablePath), false);
    await readFile(resolve(project, candidate.readablePath), "utf8");

    const read = await reader.readRuntimeCarrier({ root: project, path: candidate.readablePath });
    assert.equal(read.ok, true);
    assert.equal(read.carrier.carrierRootTier, "project");

    const injected = await injection.buildRecallInjection({
      userText: `帮我${SPARK_QUERY}`,
      projectRoot: project,
      budgetBytes: 2400,
      limit: 3,
    });
    assert.equal(injected.inject, true);
    const rows = carrierRowsOf(injected.text);
    const rowWithSpark = rows.find((row) => row.includes(`spec_key=${SPARK_KEY}`));
    assert.notEqual(rowWithSpark, undefined);
    assert.equal(readablePathOfRow(rowWithSpark), null, "项目内形态不重复给绝对路径（相对项目根即可读）");
    assert.ok(rowWithSpark.includes(SPARK_CANONICAL));
    assert.match(injected.text, /正文按行内路径按需读取|实读=/);
  });
});

test("读入口只认载体根内的已存在载体：越界与不存在都拒", async () => {
  await withTemp("ldvh-carrier-read-boundary-", async (base) => {
    await installShapedModules(base);
    await copyCarrierCorpus(join(base, "plugin-specs"));
    const project = join(base, "project");
    await mkdir(project, { recursive: true });
    const realBase = await realpath(base);
    const outside = join(realBase, "outside.yaml");
    await writeFile(outside, "ldvh_spec:\n  spec_key: outside\n", "utf8");

    const { reader } = await importInstalled(base);

    const outsideRead = await reader.readRuntimeCarrier({ root: project, path: outside });
    assert.equal(outsideRead.ok, false, "越出载体根的路径不得被读");
    assert.equal(outsideRead.error.code, "carrier/path_outside_root");

    const missing = await reader.readRuntimeCarrier({
      root: project,
      path: join(realBase, "plugin-specs", "no-such-carrier.yaml"),
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "carrier/not_found");

    const both = await reader.readRuntimeCarrier({
      root: project,
      specKey: SPARK_KEY,
      path: join(realBase, "plugin-specs", `${SPARK_KEY}.yaml`),
    });
    assert.equal(both.ok, false);
    assert.equal(both.error.code, "carrier/request_invalid");
  });
});

test("注入渲染：包内候选带 实读= 绝对路径，项目内候选不带；体量与载体行数受既有上限约束", () => {
  const secretBody = "SECRET-ENTRY-BODY-MUST-NOT-BE-INJECTED";
  const positioning = "管火花记录这一事实对象的形态与写入条件";
  const scope = "要新建或修改火花记录时查阅本文件";
  const packageCandidate = {
    specKey: SPARK_KEY,
    title: "火花",
    canonicalPath: SPARK_CANONICAL,
    absolutePath: "/opt/dsh/node_modules/dsh-ldvh/plugin/plugin-specs/spark-fact-type.yaml",
    readablePath: "/opt/dsh/node_modules/dsh-ldvh/plugin/plugin-specs/spark-fact-type.yaml",
    readablePathKind: "absolute",
    carrierRootTier: "package",
    positioning,
    scope,
    entries: [{ id: "carrier-shell", title: "载体外壳", text: secretBody }],
    entryIds: ["carrier-shell"],
  };
  const projectCandidate = {
    ...packageCandidate,
    readablePath: SPARK_CANONICAL,
    readablePathKind: "project-relative",
    carrierRootTier: "project",
  };
  const buildResult = (candidates) => ({
    ok: true,
    specs: [],
    facts: [],
    runtimeCarriers: {
      available: true,
      candidates,
      counts: { scanned: candidates.length, hits: candidates.length, returned: candidates.length },
      truncated: false,
    },
    unchecked: { specs: [], facts: [], runtimeCarriers: [] },
    budget: { limitBytes: 12000, usedBytes: 0, limit: 3 },
    partial: false,
    truncated: false,
    provesApplicability: false,
  });

  const packageText = renderRecallRow(buildResult([packageCandidate]));
  assert.match(packageText, /^运行时机制：$/m);
  assert.ok(
    packageText.includes("实读=/opt/dsh/node_modules/dsh-ldvh/plugin/plugin-specs/spark-fact-type.yaml"),
    "包内候选须在行内给出可读绝对路径",
  );
  assert.ok(packageText.includes("可直接打开"), "段末须披露 实读= 的含义");
  assert.equal(packageText.includes(secretBody), false, "注入不得带条目正文");

  const projectText = renderRecallRow(buildResult([projectCandidate]));
  assert.match(projectText, /^运行时机制：$/m);
  assert.equal(projectText.includes("实读="), false, "项目内候选不重复贴绝对路径");
  assert.ok(projectText.includes(SPARK_CANONICAL));

  const bulk = renderRecallRow(buildResult([
    packageCandidate,
    { ...packageCandidate, specKey: "pitfall-fact-type", title: "踩坑经验", canonicalPath: "plugin-specs/pitfall-fact-type.yaml", readablePath: "/opt/dsh/node_modules/dsh-ldvh/plugin/plugin-specs/pitfall-fact-type.yaml" },
    { ...packageCandidate, specKey: "norm-fact-type", title: "事实规范", canonicalPath: "plugin-specs/norm-fact-type.yaml", readablePath: "/opt/dsh/node_modules/dsh-ldvh/plugin/plugin-specs/norm-fact-type.yaml" },
  ]));
  const bulkRows = carrierRowsOf(bulk);
  assert.ok(bulkRows.length >= 1 && bulkRows.length <= RUNTIME_CARRIER_INJECTION_MAX);
  assert.ok(Buffer.byteLength(bulkRows.join("\n"), "utf8") <= RUNTIME_CARRIER_INJECTION_BYTES);
  for (const row of bulkRows) {
    assert.ok(row.includes("— "), "路径不得把定位与 positioning 挤掉");
    assert.ok(row.includes("；何时查阅："), "路径不得把何时查阅挤掉");
  }
});
