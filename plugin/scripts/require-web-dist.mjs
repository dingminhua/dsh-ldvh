import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_RUNTIME_DEPS = ["express", "cors", "compression", "dotenv", "js-yaml"];

export function assertWebDist(root) {
  const entry = join(root, "web", "dist", "index.html");
  if (!existsSync(entry)) {
    throw new Error(`pack gate: ${entry} 不存在；先运行 npm run build:web（plugin/web 需已 pnpm install）再 pack/publish`);
  }
  return entry;
}

export function assertWebApi(root) {
  const server = join(root, "web", "api-js", "server.js");
  if (!existsSync(server)) {
    throw new Error(`pack gate: ${server} 不存在——web-api 子进程改为直接执行编译产物，缺此入口则面板不可用`);
  }
  const serverSource = readFileSync(server, "utf8");
  if (!/LDVH_WEB_PORT=\$\{actualPort\}/.test(serverSource)) {
    throw new Error(`pack gate: ${server} 未上报实际端口——编译产物与 web/api/server.ts 不同步，先运行 npm run build:web 重新生成 api-js/server.js；否则动态端口下探活与面板将不可用`);
  }
  const shared = join(root, "web", "shared-js");
  if (!existsSync(shared)) {
    throw new Error(`pack gate: ${shared} 不存在——web/api 运行时从 ../shared-js 读取通用实现`);
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declared = manifest.dependencies ?? {};
  for (const name of WEB_RUNTIME_DEPS) {
    if (declared[name] === undefined) {
      throw new Error(`pack gate: dependencies 未声明 ${name}——web-api 运行时需要它，缺此声明则安装后子进程启动失败`);
    }
  }
  if (declared.tsx !== undefined) {
    throw new Error(`pack gate: dependencies 不应含 tsx——tsx 带入 esbuild 构建脚本，会被 pnpm 11 默认审批门拒绝（issue #3）；后端已改为编译产物直跑`);
  }
  const files = manifest.files ?? [];
  for (const dir of ["web/dist", "web/api-js", "web/shared-js"]) {
    if (!files.includes(dir)) {
      throw new Error(`pack gate: files 未列入 ${dir}——该目录不进包则运行物缺失`);
    }
  }
  const npmignore = join(root, "web", ".npmignore");
  if (!existsSync(npmignore)) {
    throw new Error(`pack gate: ${npmignore} 不存在——缺它则 web/.gitignore 的 dist 规则会把 web/dist 连带排除出包`);
  }
  return server;
}

const self = resolve(fileURLToPath(import.meta.url));
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === self) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  try {
    assertWebDist(root);
    assertWebApi(root);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
