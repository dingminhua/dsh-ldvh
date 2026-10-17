#!/usr/bin/env node
// dsh-ldvh — package-time specification-corpus bundling (specs/01 §10.3 三级
// 回退的第三级：插件包内 specs/)。
//
//   copy  (prepack)  — 把仓库根的 specs/ 复制进包体，使 `npm pack` 发布的包
//                      自带语料（npm 安装不存在开发布局，读取只能走包内目录）。
//                      同时写入 stamp 文件，记录本次包内 specs/ 由脚本生成。
//   clean (postpack) — 移除生成的包内副本与 stamp。stamp 守卫意味着手工创建的
//                      plugin/specs 永不被打包动作删除。
//
// 生成的包内目录被 gitignore（plugin/.gitignore）；仓库根的 specs/ 始终是唯一
// 的自著语料源，包内副本只是发布产物。即使 clean 未执行（打包中途失败），
// 读取侧的回退顺序（dev-checkout 先于 plugin-bundle）也保证残留副本不会遮蔽
// 源仓库目录——本脚本的清理是尽力而为而非保证。

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
