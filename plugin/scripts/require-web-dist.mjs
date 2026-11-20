import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function assertWebDist(root) {
  const entry = join(root, "web", "dist", "index.html");
  if (!existsSync(entry)) {
    throw new Error(`pack gate: ${entry} 不存在；先运行 npm run build:web（plugin/web 需已 pnpm install）再 pack/publish`);
  }
  return entry;
}

const self = resolve(fileURLToPath(import.meta.url));
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === self) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  try {
    assertWebDist(root);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
