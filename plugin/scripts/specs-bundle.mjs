#!/usr/bin/env node

import { access, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(dirname(packageRoot), "specs");
const bundledRoot = join(packageRoot, "specs");
const stampPath = join(packageRoot, ".specs-bundle-stamp");

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const mode = process.argv[2];

if (mode === "copy") {
  const sourceInfo = await stat(sourceRoot).catch(() => null);
  if (sourceInfo === null || !sourceInfo.isDirectory()) {
    console.error(`[specs-bundle] source corpus not found: ${sourceRoot}`);
    process.exit(1);
  }
  await rm(bundledRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  await cp(sourceRoot, bundledRoot, { recursive: true });
  await writeFile(stampPath, `${new Date().toISOString()}\n`);
  console.log(`[specs-bundle] copied ${sourceRoot} -> ${bundledRoot}`);
} else if (mode === "clean") {
  if (await pathExists(stampPath)) {
    await rm(bundledRoot, { recursive: true, force: true });
    await rm(stampPath, { force: true });
    console.log(`[specs-bundle] removed generated ${bundledRoot}`);
  } else {
    console.log("[specs-bundle] no stamp present — leaving plugin/specs untouched");
  }
} else {
  console.error("usage: node scripts/specs-bundle.mjs copy|clean");
  process.exit(1);
}
