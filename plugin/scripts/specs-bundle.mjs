#!/usr/bin/env node

import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isExcludedCarrierName } from "../lib/carrier-scan.js";
import {
  FACT_TYPE_BY_SPEC_ID,
  RECALL_CRITERIA_VERSION,
  parseRecallCriteriaTable,
} from "../lib/recall-criteria.js";
import {
  OPERATION_DECLARATIONS_VERSION,
  parseOperationDeclarations,
  parseSpecDocument,
  resolveHeadingPath,
} from "../lib/spec-registry.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const BUNDLE_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "runtime-carriers",
    kind: "copy",
    sourceDir: "plugin-specs",
    targetDir: "plugin-specs",
    stampName: ".plugin-specs-bundle-stamp",
  }),
  Object.freeze({
    name: "recall-criteria",
    kind: "generate",
    sourceDir: "specs",
    targetFile: "lib/recall-criteria.bundle.json",
    stampName: ".recall-criteria-bundle-stamp",
  }),
  Object.freeze({
    name: "operation-declarations",
    kind: "generate",
    sourceDir: "specs",
    targetFile: "lib/operation-declarations.bundle.json",
    stampName: ".operation-declarations-bundle-stamp",
  }),
]);

export function bundlePlan({ repoRoot, packageRoot: root = packageRoot } = {}) {
  if (typeof repoRoot !== "string" || repoRoot === "") {
    throw new Error("[specs-bundle] a repository root is required");
  }
  return BUNDLE_DEFINITIONS.map((definition) => {
    const entry = {
      name: definition.name,
      kind: definition.kind,
      sourceRoot: join(repoRoot, definition.sourceDir),
      stampPath: join(root, definition.stampName),
    };
    if (definition.kind === "copy") {
      entry.bundledRoot = join(root, definition.targetDir);
      entry.filter = (source) => !isExcludedCarrierName(basename(source));
      return entry;
    }
    entry.targetPath = join(root, definition.targetFile);
    return entry;
  });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function buildRecallCriteriaBundle(sourceRoot) {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(`[specs-bundle] recall criteria source corpus not found: ${sourceRoot} (${String(error?.message ?? error)})`);
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const match = /^(\d{2})-/.exec(entry.name);
    if (match === null) continue;
    const type = FACT_TYPE_BY_SPEC_ID[match[1]];
    if (type === undefined) continue;
    files.push({ specId: match[1], type, name: entry.name });
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (files.length === 0) {
    throw new Error(`[specs-bundle] no recall criteria type specs found under ${sourceRoot}`);
  }

  const hash = createHash("sha256");
  const types = {};
  const failures = [];
  for (const file of files) {
    const text = await readFile(join(sourceRoot, file.name), "utf8");
    hash.update(`${file.name}\0`);
    hash.update(text);
    hash.update("\0");
    const result = parseRecallCriteriaTable(text, {
      file: `specs/${file.name}`,
      specId: file.specId,
      type: file.type,
    });
    if (result.ok !== true) {
      failures.push(`specs/${file.name}: ${(result.errors ?? []).map((item) => `${item.code} ${item.message}`).join(" / ")}`);
      continue;
    }
    types[file.type] = {
      specId: file.specId,
      notApplicable: { ...result.values.notApplicable },
      defaultStatuses: [...result.values.defaultStatuses],
      coreFields: [...result.values.coreFields],
      typeAliases: [...result.values.typeAliases],
      relations: result.values.relations.map((relation) => ({
        relationKey: relation.relationKey,
        targets: [...relation.targets],
      })),
    };
  }
  if (failures.length > 0) {
    throw new Error(`[specs-bundle] recall criteria tables failed to parse:\n  ${failures.join("\n  ")}`);
  }
  return {
    version: RECALL_CRITERIA_VERSION,
    fingerprint: hash.digest("hex"),
    types,
  };
}

async function declarationSourceFiles(sourceRoot) {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(`[specs-bundle] operation declaration source corpus not found: ${sourceRoot} (${String(error?.message ?? error)})`);
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (!/^[0-9]{2,}-[^/]+\.md$/.test(entry.name)) continue;
    if (isExcludedCarrierName(entry.name)) continue;
    files.push({ absolutePath: join(sourceRoot, entry.name), repoPath: `specs/${entry.name}` });
  }
  const attachmentsRoot = join(sourceRoot, "attachments");
  let attachments = [];
  try {
    attachments = await readdir(attachmentsRoot, { withFileTypes: true });
  } catch {
    attachments = [];
  }
  for (const entry of attachments) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (!/^[0-9]{2,}\.Att\.[0-9]{2,}-[^/]+\.md$/.test(entry.name)) continue;
    if (isExcludedCarrierName(entry.name)) continue;
    files.push({ absolutePath: join(attachmentsRoot, entry.name), repoPath: `specs/attachments/${entry.name}` });
  }
  files.sort((a, b) => (a.repoPath < b.repoPath ? -1 : a.repoPath > b.repoPath ? 1 : 0));
  if (files.length === 0) {
    throw new Error(`[specs-bundle] no specification corpus found under ${sourceRoot}`);
  }
  return files;
}

export async function buildOperationDeclarationsBundle(sourceRoot) {
  const files = await declarationSourceFiles(sourceRoot);
  const hash = createHash("sha256");
  const declarations = {};
  const failures = [];
  for (const file of files) {
    const text = await readFile(file.absolutePath, "utf8");
    hash.update(`${file.repoPath}\0`);
    hash.update(text);
    hash.update("\0");
    const rows = parseOperationDeclarations(text, (headingPath) => resolveHeadingPath(text, headingPath).ok);
    if (rows.size === 0) continue;
    const identity = parseSpecDocument(text, file.repoPath);
    if (identity.ok !== true) {
      failures.push(`${file.repoPath}: 身份块解析失败（${identity.error.code}: ${identity.error.message}）`);
      continue;
    }
    const source = identity.value.identity.responsibilityKey;
    for (const [key, row] of rows) {
      if (row.anchor_errors.length > 0) {
        failures.push(`${file.repoPath}: "${key}" 的声明锚点不可解析（${row.anchor_errors.join("; ")}）`);
        continue;
      }
      if (Object.hasOwn(declarations, key)) {
        failures.push(`${file.repoPath}: operation_key "${key}" 与 ${declarations[key].source_path} 重复`);
        continue;
      }
      declarations[key] = {
        operation_key: key,
        summary: row.summary,
        effect: row.effect,
        arguments_contract: row.arguments_contract,
        result_contract: row.result_contract,
        source,
        source_path: file.repoPath,
      };
    }
  }
  if (failures.length > 0) {
    throw new Error(`[specs-bundle] operation declarations failed to parse:\n  ${failures.join("\n  ")}`);
  }
  if (Object.keys(declarations).length === 0) {
    throw new Error(`[specs-bundle] no operation declaration table found under ${sourceRoot}`);
  }
  const sorted = {};
  for (const key of Object.keys(declarations).sort()) sorted[key] = declarations[key];
  return {
    version: OPERATION_DECLARATIONS_VERSION,
    fingerprint: hash.digest("hex"),
    generated_from: "specs/",
    declarations: sorted,
  };
}

async function generateBundle(bundle) {
  const data = bundle.name === "operation-declarations"
    ? await buildOperationDeclarationsBundle(bundle.sourceRoot)
    : await buildRecallCriteriaBundle(bundle.sourceRoot);
  await mkdir(dirname(bundle.targetPath), { recursive: true });
  await writeFile(bundle.targetPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`[specs-bundle] generated ${bundle.targetPath} from ${bundle.sourceRoot}`);
}

export async function copyBundles({ repoRoot, packageRoot: root = packageRoot } = {}) {
  const plan = bundlePlan({ repoRoot, packageRoot: root });
  for (const bundle of plan) {
    const sourceInfo = await stat(bundle.sourceRoot).catch(() => null);
    if (sourceInfo === null || !sourceInfo.isDirectory()) {
      throw new Error(`[specs-bundle] source corpus not found: ${bundle.sourceRoot}`);
    }
    await mkdir(root, { recursive: true });
    if (bundle.kind === "copy") {
      await rm(bundle.bundledRoot, { recursive: true, force: true });
      await cp(bundle.sourceRoot, bundle.bundledRoot, { recursive: true, filter: bundle.filter });
      console.log(`[specs-bundle] copied ${bundle.sourceRoot} -> ${bundle.bundledRoot}`);
    } else {
      await rm(bundle.targetPath, { recursive: true, force: true });
      await generateBundle(bundle);
    }
    await writeFile(bundle.stampPath, `${new Date().toISOString()}\n`);
  }
  return plan;
}

export async function cleanBundles({ packageRoot: root = packageRoot } = {}) {
  const plan = bundlePlan({ repoRoot: dirname(root), packageRoot: root });
  for (const bundle of plan) {
    if (await pathExists(bundle.stampPath)) {
      if (bundle.kind === "copy") {
        await rm(bundle.bundledRoot, { recursive: true, force: true });
        console.log(`[specs-bundle] removed generated ${bundle.bundledRoot}`);
      } else {
        await rm(bundle.targetPath, { force: true });
        console.log(`[specs-bundle] removed generated ${bundle.targetPath}`);
      }
      await rm(bundle.stampPath, { force: true });
    } else if (bundle.kind === "copy") {
      console.log(`[specs-bundle] no stamp present — leaving ${bundle.bundledRoot} untouched`);
    } else {
      console.log(`[specs-bundle] no stamp present — leaving ${bundle.targetPath} untouched`);
    }
  }
  return plan;
}

async function main(argv) {
  const mode = argv[2];
  const roots = { repoRoot: dirname(packageRoot), packageRoot };
  if (mode === "copy") {
    await copyBundles(roots);
    return;
  }
  if (mode === "clean") {
    await cleanBundles(roots);
    return;
  }
  console.error("usage: node scripts/specs-bundle.mjs copy|clean");
  process.exitCode = 1;
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
