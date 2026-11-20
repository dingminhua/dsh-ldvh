import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_RUNTIME_DEPS = ["tsx", "express", "cors", "compression", "dotenv", "js-yaml"];

export function assertWebDist(root) {
  const entry = join(root, "web", "dist", "index.html");
  if (!existsSync(entry)) {
    throw new Error(`pack gate: ${entry} 不存在；先运行 npm run build:web（plugin/web 需已 pnpm install）再 pack/publish`);
  }
  return entry;
}

export function assertWebApi(root) {
  const server = join(root, "web", "api", "server.ts");
  if (!existsSync(server)) {
    throw new Error(`pack gate: ${server} 不存在——web-api 子进程默认以 --import tsx api/server.ts 启动，缺此入口则面板不可用`);
  }
  const shared = join(root, "web", "shared");
  if (!existsSync(shared)) {
    throw new Error(`pack gate: ${shared} 不存在——web/api 运行时从 ../shared 读取通用实现`);
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declared = manifest.dependencies ?? {};
  for (const name of WEB_RUNTIME_DEPS) {
    if (declared[name] === undefined) {
      throw new Error(`pack gate: dependencies 未声明 ${name}——web-api 运行时需要它，缺此声明则安装后子进程启动失败`);
    }
  }
  const files = manifest.files ?? [];
  for (const dir of ["web/api", "web/shared"]) {
    if (!files.includes(dir)) {
      throw new Error(`pack gate: files 未列入 ${dir}——该目录不进包则后端运行物缺失`);
    }
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
