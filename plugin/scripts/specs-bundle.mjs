#!/usr/bin/env node

import { access, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isExcludedCarrierName } from "../lib/carrier-scan.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const BUNDLE_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "runtime-carriers",
    sourceDir: "plugin-specs",
    targetDir: "plugin-specs",
    stampName: ".plugin-specs-bundle-stamp",
  }),
]);

export function bundlePlan({ repoRoot, packageRoot: root = packageRoot } = {}) {
  if (typeof repoRoot !== "string" || repoRoot === "") {
    throw new Error("[specs-bundle] a repository root is required");
  }
  return BUNDLE_DEFINITIONS.map((definition) => ({
    name: definition.name,
    sourceRoot: join(repoRoot, definition.sourceDir),
    bundledRoot: join(root, definition.targetDir),
    stampPath: join(root, definition.stampName),
    filter: (source) => !isExcludedCarrierName(basename(source)),
  }));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function copyBundles({ repoRoot, packageRoot: root = packageRoot } = {}) {
  const plan = bundlePlan({ repoRoot, packageRoot: root });
  for (const bundle of plan) {
    const sourceInfo = await stat(bundle.sourceRoot).catch(() => null);
    if (sourceInfo === null || !sourceInfo.isDirectory()) {
      throw new Error(`[specs-bundle] source corpus not found: ${bundle.sourceRoot}`);
    }
    await rm(bundle.bundledRoot, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await cp(bundle.sourceRoot, bundle.bundledRoot, { recursive: true, filter: bundle.filter });
    await writeFile(bundle.stampPath, `${new Date().toISOString()}\n`);
    console.log(`[specs-bundle] copied ${bundle.sourceRoot} -> ${bundle.bundledRoot}`);
  }
  return plan;
}

export async function cleanBundles({ packageRoot: root = packageRoot } = {}) {
  const plan = bundlePlan({ repoRoot: dirname(root), packageRoot: root });
  for (const bundle of plan) {
    if (await pathExists(bundle.stampPath)) {
      await rm(bundle.bundledRoot, { recursive: true, force: true });
      await rm(bundle.stampPath, { force: true });
      console.log(`[specs-bundle] removed generated ${bundle.bundledRoot}`);
    } else {
      console.log(`[specs-bundle] no stamp present — leaving ${bundle.bundledRoot} untouched`);
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
